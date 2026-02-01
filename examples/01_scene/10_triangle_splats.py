"""Triangle splats

Viser includes a WebGL-based triangle splatting renderer.

Triangle splatting uses triangular mesh primitives with spherical harmonics
for view-dependent color rendering, providing efficient visualization of
large-scale point cloud data.

**Features:**

* :meth:`viser.SceneApi.add_triangle_splats` to add a triangle splat object
* Spherical harmonics for view-dependent colors
* Efficient rendering of large-scale geometry

.. note::
    This example requires the test data file:

    .. code-block:: bash

        # The data/point_cloud_state_dict.pt file should already exist
        python examples/01_scene/10_triangle_splats.py
"""

from __future__ import annotations

import time
from pathlib import Path

import math
import numpy as np
import torch
import tyro

import viser


def sigmoid(x: np.ndarray) -> np.ndarray:
    """
    Calculates the element-wise sigmoid of any input (number or array).
    """
    return 1 / (1 + np.exp(-x))


def opacity_activation(
    vertex_weight: np.ndarray, opacity_floor: float = 0.9999
) -> np.ndarray:
    """Convert vertex weights to opacities using a sigmoid function.

    Args:
        vertex_weight: (V, 1) array of vertex weights

    Returns:
        (V, 1) array of opacities in [0, 1]
    """
    return opacity_floor + (1.0 - opacity_floor) * sigmoid(vertex_weight)


def load_triangle_splats(checkpoint_path: Path):
    """Load triangle splatting data from checkpoint.

    Args:
        checkpoint_path: Path to point_cloud_state_dict.pt file

    Returns:
        Dictionary with vertices, triangle_indices, features, opacities, etc.
    """
    print(f"Loading triangle splats from {checkpoint_path}...")
    start_time = time.time()

    state = torch.load(checkpoint_path, map_location="cpu")

    # Extract data following the structure in triangle_model.py
    vertices = state["triangles_points"].float().detach().numpy()  # (V, 3)
    triangle_indices = state["_triangle_indices"].int().detach().numpy()  # (T, 3)
    vertex_weight = state["vertex_weight"].float().detach().numpy()  # (V, 1)
    sigma = float(state["sigma"])
    active_sh_degree = int(state["active_sh_degree"])
    features_dc = state["features_dc"].float().detach().numpy()  # (V, 1, 3)
    features_rest = state["features_rest"].float().detach().numpy()  # (V, D, 3)

    # Convert vertex_weight to opacity using sigmoid
    opacities = opacity_activation(vertex_weight)  # (V, 1)
    opacities = opacities.reshape(-1)  # (V,)

    num_vertices = vertices.shape[0]
    num_triangles = triangle_indices.shape[0]

    print(f"Loaded in {time.time() - start_time:.2f} seconds")
    print(f"  Vertices: {num_vertices:,}")
    print(f"  Triangles: {num_triangles:,}")
    print(f"  SH degree: {active_sh_degree}")
    print(f"  Sigma: {sigma}")

    return {
        "vertices": vertices,
        "triangle_indices": triangle_indices,
        "opacities": opacities,
        "features_dc": features_dc,
        "features_rest": features_rest,
        "sh_degree": 3,  # active_sh_degree,
        "sigma": sigma,
        "vertex_weight": vertex_weight,
    }


def main(
    checkpoint_path: Path = Path(__file__).parent.parent.parent
    / "data"
    / "point_cloud_state_dict.pt",
    use_direct_colors: bool = False,
) -> None:
    """Visualize triangle splatting data.

    Args:
        checkpoint_path: Path to the triangle splats checkpoint file.
        use_direct_colors: If True, convert SH to RGB colors for simpler rendering.
    """
    server = viser.ViserServer()
    server.gui.configure_theme(dark_mode=True)

    # Load triangle splats data
    data = load_triangle_splats(checkpoint_path)

    # Optionally convert SH features to direct RGB colors
    if use_direct_colors:
        print("Converting SH features to RGB colors...")
        # Simple DC-only evaluation: color = 0.5 + SH_C0 * features_dc
        SH_C0 = 0.28209479177387814
        features_dc = data["features_dc"]  # (V, 1, 3)
        colors = 0.5 + SH_C0 * features_dc.reshape(-1, 3)  # (V, 3)
        colors = np.clip(colors, 0.0, 1.0)
        colors_uint8 = (colors * 255).astype(np.uint8)

        splat_handle = server.scene.add_triangle_splats(
            name="/triangle_splats",
            vertices=data["vertices"],
            triangle_indices=data["triangle_indices"],
            opacities=data["opacities"],
            colors=colors_uint8,
            sigma=math.exp(data["sigma"]),
            vertex_weights=data["vertex_weight"],
        )
    else:
        # Use SH features for view-dependent colors
        splat_handle = server.scene.add_triangle_splats(
            name="/triangle_splats",
            vertices=data["vertices"],
            triangle_indices=data["triangle_indices"],
            opacities=data["opacities"],
            features_dc=data["features_dc"],
            features_rest=data["features_rest"],
            sh_degree=data["sh_degree"],
            sigma=math.exp(data["sigma"]),
            vertex_weights=data["vertex_weight"],
        )

    # Add coordinate frame for reference
    server.scene.add_frame(
        name="/frame",
        axes_length=1.0,
        axes_radius=0.02,
    )

    # Add GUI controls
    with server.gui.add_folder("Triangle Splats"):
        sigma_slider = server.gui.add_slider(
            "Sigma",
            min=-15.0,
            max=10.0,
            step=0.1,
            initial_value=data["sigma"],
        )
        opacity_scale = server.gui.add_slider(
            "Opacity Scale",
            min=0.0,
            max=100.0,
            step=0.5,
            initial_value=99.0,  # Default to 20x scale for better visibility with reduced alpha threshold
        )
        reset_button = server.gui.add_button("Reset View")

    # Handle sigma updates
    @sigma_slider.on_update
    def _(_) -> None:
        splat_handle.sigma = math.exp(sigma_slider.value)

    # Handle opacity scale updates
    @opacity_scale.on_update
    def _(_) -> None:
        new_opacities = opacity_activation(
            data["vertex_weight"], opacity_floor=opacity_scale.value / 100.0
        ).reshape(-1)  # (V,)
        splat_handle.opacities = new_opacities

    # Handle reset button
    @reset_button.on_click
    def _(_) -> None:
        for client in server.get_clients().values():
            client.camera.position = (3.0, 3.0, 3.0)
            client.camera.look_at = (0.0, 0.0, 0.0)

    print("\nVisualization ready!")
    print("  - Adjust 'Sigma' to control triangle edge softness")
    print("  - Adjust 'Opacity Scale' to change overall transparency")
    print("  - Click 'Reset View' to reset camera position")
    print("  - Open http://localhost:8080 in your browser")

    # Keep server running
    while True:
        time.sleep(1.0)


if __name__ == "__main__":
    tyro.cli(main)
