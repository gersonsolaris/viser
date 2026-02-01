/** Triangle splatting implementation for viser.
 *
 * Triangle splatting uses triangular mesh primitives with spherical harmonics
 * for view-dependent color rendering, providing efficient visualization of
 * large-scale point cloud data.
 *
 * Forward rendering pipeline:
 * 1. Compute view-dependent colors from SH coefficients (Vertex Shader)
 * 2. Create triangle geometry with unrolled barycentric coordinates
 * 3. Sort triangles by depth for correct forward accumulation blending
 * 4. Rasterize triangles with soft-edge alpha and pre-multiplied alpha blending
 */

import React from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";
import {
  createTriangleSplatsGeometry,
  createTriangleSplatsMaterial,
} from "./TriangleSplatsHelpers";
import {
  analyzeTriangleFiltering,
  analyzeDetailedFiltering,
  analyzeFragmentShaderFiltering,
} from "./TriangleSplatsAnalyze";
import { setGeometryIndexBuffer } from "./TriangleSorter";

interface TriangleSplatsProps {
  vertices: Float32Array; // (V, 3) - 3D vertex positions
  triangle_indices: Uint32Array; // (T, 3) - triangle face indices
  opacities: Float32Array; // (V,) - vertex opacity
  vertex_weights?: Float32Array; // (V,) - raw weights pre-sigmoid
  colors?: Uint8Array; // (V, 3) - direct RGB colors (optional)
  features_dc?: Float32Array; // (V, 3) - DC (constant) SH coefficient (unflattened)
  features_rest?: Float32Array; // (V, SH_rest, 3) - higher-order SH coefficients (unflattened)
  sh_degree?: number; // Maximum SH degree (0-3)
  sigma?: number; // Global sigma parameter for edge softness
  debugShaderLogging?: boolean; // Enable GLSL-side logging when supported
}

export const TriangleSplatsObject = React.forwardRef<
  THREE.Group,
  TriangleSplatsProps & { children?: React.ReactNode }
>(function TriangleSplatsObject(
  {
    vertices,
    triangle_indices,
    opacities,
    vertex_weights,
    colors,
    features_dc,
    features_rest,
    sh_degree = 3,
    sigma = 1.0,
    debugShaderLogging = true,
    children,
  },
  ref,
) {
  const { camera, gl } = useThree();
  const meshRef = React.useRef<THREE.Mesh>(null);
  const prevCameraMatrixRef = React.useRef<THREE.Matrix4>(new THREE.Matrix4());
  const lastSortTimeRef = React.useRef<number>(0);

  const workerRef = React.useRef<Worker | null>(null);
  const isSortingRef = React.useRef<boolean>(false);
  const currentRequestIdRef = React.useRef<number>(0);

  console.log(`Rendering with sigma: ${sigma}`);

  const supportsDebugPrintf = React.useMemo(() => {
    const context = gl.getContext?.();
    if (!context) return false;
    return (
      !!context.getExtension("EXT_debug_printf") ||
      !!context.getExtension("GL_EXT_debug_printf")
    );
  }, [gl]);

  React.useEffect(() => {
    if (!debugShaderLogging || supportsDebugPrintf) {
      return;
    }
    console.warn(
      "[TriangleSplats] Shader debug logging requested, but EXT_debug_printf / GL_EXT_debug_printf is unavailable in this WebGL context. Shader printf statements will not appear.",
    );
  }, [debugShaderLogging, supportsDebugPrintf]);

  React.useEffect(() => {
    const context = gl.getContext?.();
    const version = context
      ? context.getParameter(context.VERSION) ?? "unknown"
      : "no context";
    console.info(
      `[TriangleSplats] WebGL version: ${version}; debug logging ${debugShaderLogging ? "enabled" : "disabled"}; EXT_debug_printf support: ${supportsDebugPrintf}`,
    );
  }, [gl, debugShaderLogging, supportsDebugPrintf]);

  // Handle worker initialization and mesh re-sorting
  React.useEffect(() => {
    workerRef.current = new Worker(
      new URL("./TriangleSortWorker.ts", import.meta.url)
    );
    workerRef.current.onmessage = (e) => {
      if (e.data.error) {
        console.error("Sort worker error:", e.data.error);
        isSortingRef.current = false;
        return;
      }
      const { preparedIndexArray, requestId } = e.data;
      if (requestId === currentRequestIdRef.current) {
        if (meshRef.current && meshRef.current.geometry) {
           setGeometryIndexBuffer(meshRef.current.geometry, preparedIndexArray);
        }
      }
      isSortingRef.current = false;
    };
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Create base geometry once
  const geometry = React.useMemo(() => {
    const geo = createTriangleSplatsGeometry(
      vertices,
      triangle_indices,
      opacities,
      vertex_weights,
      colors,
      features_dc,
      features_rest,
      sh_degree ?? 0,
    );
    
    // Log filtering statistics - use opacities (not vertex_weights)!
    analyzeTriangleFiltering(vertices, triangle_indices, opacities, camera);
    
    // Detailed filter analysis - runs on every mount to show all stages
    analyzeDetailedFiltering(vertices, triangle_indices, opacities, camera, camera.projectionMatrix);
    
    // Estimate fragment shader alpha filtering impact
    analyzeFragmentShaderFiltering(vertices, triangle_indices, opacities, camera, camera.projectionMatrix, sigma ?? 0.0001);
    
    return geo;
  }, [
    vertices,
    triangle_indices,
    opacities,
    vertex_weights,
    features_dc,
    features_rest,
    sh_degree,
    colors,
    camera,
    sigma,
  ]);

  const material = React.useMemo(() => {
    const shDataTexture = (geometry as any).shDataTexture;
    const enableDebugPrintf = debugShaderLogging && supportsDebugPrintf;
    return createTriangleSplatsMaterial(
      camera,
      sh_degree ?? 0,
      colors,
      features_dc,
      sigma ?? 1.0,
      shDataTexture,
      debugShaderLogging,
      enableDebugPrintf,
    );
  }, [camera, sh_degree, features_dc, colors, sigma, geometry, debugShaderLogging, supportsDebugPrintf]);

  // Update camera position uniform and sort triangles when camera moves
  useFrame(() => {
    if (material) {
      camera.getWorldPosition(material.uniforms.worldCameraPosition.value);
      material.uniforms.sigma.value = sigma;
      material.uniforms.uEnableShaderLogging.value = debugShaderLogging ? 1.0 : 0.0;
      
      const size = new THREE.Vector2();
      gl.getDrawingBufferSize(size);
      material.uniforms.uResolution.value.copy(size);
    }

    // Sort triangles by depth with throttling and worker
    if (meshRef.current && geometry && !isSortingRef.current) {
      const now = performance.now();
      const timeSinceLastSort = now - lastSortTimeRef.current;
      
      const cameraMatrix = camera.matrixWorldInverse;
      const changed = !cameraMatrix.equals(prevCameraMatrixRef.current);

      if (changed && timeSinceLastSort > 100) {
          const triangleCenters = (geometry as any).triangleCenters;
          if (triangleCenters && workerRef.current) {
              isSortingRef.current = true;
              currentRequestIdRef.current++;
              
              const numTriangles = triangle_indices.length / 3;
              
              // Recalculate modelViewMatrix to be 100% sure it's up to date
              const modelViewMatrix = new THREE.Matrix4();
              modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, meshRef.current.matrixWorld);
              
              workerRef.current.postMessage({
                  numTriangles,
                  centers: triangleCenters,
                  viewMatrix: modelViewMatrix.elements,
                  requestId: currentRequestIdRef.current
              });
              
              prevCameraMatrixRef.current.copy(cameraMatrix);
              lastSortTimeRef.current = now;
          }
      }
    }
  });

  return (
    <group ref={ref}>
      <mesh ref={meshRef} geometry={geometry} material={material} />
      {children}
    </group>
  );
});

