import * as THREE from "three";

/**Comprehensive filtering analysis simulating all GPU-side checks.
 * This helps identify which filters are eliminating triangles. */
export function analyzeDetailedFiltering(
  vertices: Float32Array,
  triangle_indices: Uint32Array,
  opacities: Float32Array,
  camera: THREE.Camera,
  cameraProjMatrix: THREE.Matrix4,
  debug: boolean = false
): void {
  if (!debug) return;

  const numTriangles = triangle_indices.length / 3;
  const STOPPING_INFLUENCE = 0.01;
  const BACKFACE_THRESHOLD = 0.001;
  const DISTANCE_THRESHOLD_MAX = 1600.0;
  const DISTANCE_THRESHOLD_MIN = 1.0;
  const PERIMETER_THRESHOLD = 1.0;
  
  // Use actual resolution from viewport, not window size
  const canvas = document.querySelector('canvas');
  const resolution_w = canvas?.clientWidth || window.innerWidth;
  const resolution_h = canvas?.clientHeight || window.innerHeight;
  const resolution = resolution_w;  // Use width for consistency with shader
  
  console.log(`[Filtering Analysis] Using resolution: ${resolution_w}x${resolution_h}`);
  
  let stats = {
    totalTriangles: 0,
    passMinWeight: 0,
    passBackfaceCull: 0,
    passPerspectiveCull: 0,
    passDistanceFilter: 0,
    passPerimeterFilter: 0,
    distanceDistribution: { tiny: 0, small: 0, medium: 0, large: 0, huge: 0 },    distanceDistributionFiltered: { tiny: 0, small: 0, medium: 0, large: 0, huge: 0 },
    hugeTriangleSamples: [] as {idx: number, distance: number, perimeter: number}[],  };
  
  // Get camera matrices
  const viewMatrix = camera.matrixWorldInverse;
  const projMatrix = cameraProjMatrix;
  
  for (let i = 0; i < numTriangles; i++) {
    stats.totalTriangles++;
    
    const v0Idx = triangle_indices[i * 3];
    const v1Idx = triangle_indices[i * 3 + 1];
    const v2Idx = triangle_indices[i * 3 + 2];

    // Get vertices
    const v0 = new THREE.Vector3(vertices[v0Idx * 3], vertices[v0Idx * 3 + 1], vertices[v0Idx * 3 + 2]);
    const v1 = new THREE.Vector3(vertices[v1Idx * 3], vertices[v1Idx * 3 + 1], vertices[v1Idx * 3 + 2]);
    const v2 = new THREE.Vector3(vertices[v2Idx * 3], vertices[v2Idx * 3 + 1], vertices[v2Idx * 3 + 2]);
    
    // Get opacities (min_weight)
    const w0 = opacities[v0Idx];
    const w1 = opacities[v1Idx];
    const w2 = opacities[v2Idx];
    const minWeight = Math.min(w0, w1, w2);
    
    // Filter 1: Min weight
    if (minWeight < STOPPING_INFLUENCE) {
      continue;
    }
    stats.passMinWeight++;
    
    // Filter 2: Backface culling
    const edge1 = new THREE.Vector3().subVectors(v1, v0);
    const edge2 = new THREE.Vector3().subVectors(v2, v0);
    const normal_world = new THREE.Vector3().crossVectors(edge1, edge2);
    
    const normal_view = new THREE.Vector3().copy(normal_world).applyMatrix3(new THREE.Matrix3().setFromMatrix4(viewMatrix));
    const center_world = new THREE.Vector3().addVectors(v0, v1).add(v2).multiplyScalar(1/3);
    const center_view = new THREE.Vector3().copy(center_world).applyMatrix4(viewMatrix);
    const viewDir = new THREE.Vector3().copy(center_view).multiplyScalar(-1).normalize();
    
    let cos_theta = normal_view.dot(viewDir);
    if (cos_theta > 0) {
      normal_view.multiplyScalar(-1);
      cos_theta = -cos_theta;
    }
    
    if (Math.abs(cos_theta) < BACKFACE_THRESHOLD) {
      continue;
    }
    stats.passBackfaceCull++;
    
    // Filter 3: Perspective culling
    // Correct matrix order: projection * view * world
    const c0 = new THREE.Vector4().copy(new THREE.Vector4(v0.x, v0.y, v0.z, 1))
      .applyMatrix4(viewMatrix)
      .applyMatrix4(projMatrix);
    const c1 = new THREE.Vector4().copy(new THREE.Vector4(v1.x, v1.y, v1.z, 1))
      .applyMatrix4(viewMatrix)
      .applyMatrix4(projMatrix);
    const c2 = new THREE.Vector4().copy(new THREE.Vector4(v2.x, v2.y, v2.z, 1))
      .applyMatrix4(viewMatrix)
      .applyMatrix4(projMatrix);
    
    if (c0.w <= 0.0 && c1.w <= 0.0 && c2.w <= 0.0) {
      continue;
    }
    stats.passPerspectiveCull++;
    
    // Filter 4: Distance filtering
    const p0 = new THREE.Vector2((c0.x / c0.w + 1.0) * resolution * 0.5 - 0.5, (c0.y / c0.w + 1.0) * resolution * 0.5 - 0.5);
    const p1 = new THREE.Vector2((c1.x / c1.w + 1.0) * resolution * 0.5 - 0.5, (c1.y / c1.w + 1.0) * resolution * 0.5 - 0.5);
    const p2 = new THREE.Vector2((c2.x / c2.w + 1.0) * resolution * 0.5 - 0.5, (c2.y / c2.w + 1.0) * resolution * 0.5 - 0.5);
    
    // Incenter
    const sideA = p1.distanceTo(p2);
    const sideB = p2.distanceTo(p0);
    const sideC = p0.distanceTo(p1);
    const perimeter = sideA + sideB + sideC;
    
    // Filter 5: Perimeter
    if (perimeter < PERIMETER_THRESHOLD) {
      continue;
    }
    stats.passPerimeterFilter++;
    
    const incenter = new THREE.Vector2(
      (sideA * p0.x + sideB * p1.x + sideC * p2.x) / perimeter,
      (sideA * p0.y + sideB * p1.y + sideC * p2.y) / perimeter
    );
    
    // Compute max distance from incenter
    const d0 = p0.distanceTo(incenter);
    const d1 = p1.distanceTo(incenter);
    const d2 = p2.distanceTo(incenter);
    const distance_points = Math.max(d0, d1, d2);
    
    // Debug: Track distance distribution and large triangle samples
    if (i < 10) {
      console.log(`Triangle ${i}: distance_points=${distance_points.toFixed(2)}, perimeter=${perimeter.toFixed(2)}, projected=[${p0.x.toFixed(1)},${p0.y.toFixed(1)}] [${p1.x.toFixed(1)},${p1.y.toFixed(1)}] [${p2.x.toFixed(1)},${p2.y.toFixed(1)}]`);
    }
    
    if (distance_points > DISTANCE_THRESHOLD_MAX || distance_points < DISTANCE_THRESHOLD_MIN) {
      // Track filtered distances
      if (distance_points < 0.5) stats.distanceDistributionFiltered.tiny++;
      else if (distance_points < 1.0) stats.distanceDistributionFiltered.small++;
      else if (distance_points < 100) stats.distanceDistributionFiltered.medium++;
      else if (distance_points < 1600) stats.distanceDistributionFiltered.large++;
      else {
        stats.distanceDistributionFiltered.huge++;
        // Collect samples of huge triangles
        if (stats.hugeTriangleSamples.length < 5) {
          stats.hugeTriangleSamples.push({idx: i, distance: distance_points, perimeter});
        }
      }
      continue;
    }
    stats.passDistanceFilter++;
    
    // Track passing distances
    if (distance_points < 0.5) stats.distanceDistribution.tiny++;
    else if (distance_points < 1.0) stats.distanceDistribution.small++;
    else if (distance_points < 100) stats.distanceDistribution.medium++;
    else if (distance_points < 1600) stats.distanceDistribution.large++;
    else stats.distanceDistribution.huge++;
  }

  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║     Triangle Splats Detailed Filtering Analysis (CPU Simulation)   ║
╠════════════════════════════════════════════════════════════════════╣
║ Total triangles:                       ${stats.totalTriangles.toString().padStart(10)}              ║
║ Pass min_weight check:                 ${stats.passMinWeight.toString().padStart(10)} (${(stats.passMinWeight/stats.totalTriangles*100).toFixed(2).padStart(5)}%)         ║
║ Pass backface culling:                 ${stats.passBackfaceCull.toString().padStart(10)} (${(stats.passBackfaceCull/stats.totalTriangles*100).toFixed(2).padStart(5)}%)         ║
║ Pass perspective culling:              ${stats.passPerspectiveCull.toString().padStart(10)} (${(stats.passPerspectiveCull/stats.totalTriangles*100).toFixed(2).padStart(5)}%)         ║
║ Pass distance filter:                  ${stats.passDistanceFilter.toString().padStart(10)} (${(stats.passDistanceFilter/stats.totalTriangles*100).toFixed(2).padStart(5)}%)         ║
║ Pass perimeter filter (>1):            ${stats.passPerimeterFilter.toString().padStart(10)} (${(stats.passPerimeterFilter/stats.totalTriangles*100).toFixed(2).padStart(5)}%)         ║
╠════════════════════════════════════════════════════════════════════╣
║ Distance Distribution (PASSED filters):                            ║
║   < 0.5px:     ${stats.distanceDistribution.tiny.toString().padStart(8)}                           ║
║   0.5-1.0px:   ${stats.distanceDistribution.small.toString().padStart(8)}                           ║
║   1-100px:     ${stats.distanceDistribution.medium.toString().padStart(8)}                           ║
║   100-1600px:  ${stats.distanceDistribution.large.toString().padStart(8)}                           ║
║   >1600px:     ${stats.distanceDistribution.huge.toString().padStart(8)}                           ║
╠════════════════════════════════════════════════════════════════════╣
║ Distance Distribution (FILTERED OUT):                              ║
║   < 0.5px:     ${stats.distanceDistributionFiltered.tiny.toString().padStart(8)}                           ║
║   0.5-1.0px:   ${stats.distanceDistributionFiltered.small.toString().padStart(8)}                           ║
║   1-100px:     ${stats.distanceDistributionFiltered.medium.toString().padStart(8)}                           ║
║   100-1600px:  ${stats.distanceDistributionFiltered.large.toString().padStart(8)}                           ║
║   >1600px:     ${stats.distanceDistributionFiltered.huge.toString().padStart(8)}   (TOO LARGE!)      ║
╠════════════════════════════════════════════════════════════════════╣
║ Sample HUGE Triangles (>1600px) Being Filtered:                    ║
${stats.hugeTriangleSamples.map((s, idx) => `║   [${idx}] Triangle ${s.idx}: distance=${s.distance.toFixed(0)}px, perimeter=${s.perimeter.toFixed(0)}px       ║`).join('\n')}
╚════════════════════════════════════════════════════════════════════╝`);
}

/**Estimate fragment shader filtering impact (alpha threshold filtering).*/
export function analyzeFragmentShaderFiltering(
  vertices: Float32Array,
  triangle_indices: Uint32Array,
  opacities: Float32Array,
  camera: THREE.Camera,
  projectionMatrix: THREE.Matrix4,
  sigma: number = 0.0001,
  debug: boolean = false
): void {
  if (!debug) return;

  const numTriangles = triangle_indices.length / 3;
  const STOPPING_INFLUENCE = 0.01;
  const BACKFACE_THRESHOLD = 0.001;
  const PERIMETER_THRESHOLD = 1.0;
  const DISTANCE_THRESHOLD_MIN = 1.0;
  const DISTANCE_THRESHOLD_MAX = 1600.0;
  const ALPHA_THRESHOLD = 1.0 / 255.0;

  const viewMatrix = camera.matrixWorldInverse;
  const projMatrix = projectionMatrix;
  const resolution = Math.min(2560, Math.max(800, window.innerWidth));

  let alphaStats = {
    totalFragments: 0,
    passAlphaCheck: 0,
    failAlphaCheck: 0,
    alphaValues: [] as number[],
    phiCenterScaleValues: [] as number[],
    cxValues: [] as number[],
  };

  // Sample triangles to estimate alpha filtering impact
  for (let i = 0; i < Math.min(numTriangles, 1000); i++) {
    const v0Idx = triangle_indices[i * 3];
    const v1Idx = triangle_indices[i * 3 + 1];
    const v2Idx = triangle_indices[i * 3 + 2];

    const v0 = new THREE.Vector3(vertices[v0Idx * 3], vertices[v0Idx * 3 + 1], vertices[v0Idx * 3 + 2]);
    const v1 = new THREE.Vector3(vertices[v1Idx * 3], vertices[v1Idx * 3 + 1], vertices[v1Idx * 3 + 2]);
    const v2 = new THREE.Vector3(vertices[v2Idx * 3], vertices[v2Idx * 3 + 1], vertices[v2Idx * 3 + 2]);

    const w0 = opacities[v0Idx];
    const w1 = opacities[v1Idx];
    const w2 = opacities[v2Idx];
    const minWeight = Math.min(w0, w1, w2);
    
    if (minWeight < STOPPING_INFLUENCE) continue;

    // Check backface
    const edge1 = v1.clone().sub(v0);
    const edge2 = v2.clone().sub(v0);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2);
    
    const centerWorld = new THREE.Vector3().addVectors(v0, v1).add(v2).multiplyScalar(1/3);
    const centerView = centerWorld.clone().applyMatrix4(viewMatrix);
    const viewDir = new THREE.Vector3(0, 0, -1);
    const cos_theta = new THREE.Vector3().copy(normal).normalize().dot(viewDir.normalize());
    
    if (Math.abs(cos_theta) < BACKFACE_THRESHOLD) continue;

    // Check perspective culling
    const c0 = new THREE.Vector4(v0.x, v0.y, v0.z, 1)
      .applyMatrix4(viewMatrix)
      .applyMatrix4(projMatrix);
    const c1 = new THREE.Vector4(v1.x, v1.y, v1.z, 1)
      .applyMatrix4(viewMatrix)
      .applyMatrix4(projMatrix);
    const c2 = new THREE.Vector4(v2.x, v2.y, v2.z, 1)
      .applyMatrix4(viewMatrix)
      .applyMatrix4(projMatrix);
    
    if (c0.w <= 0.0 && c1.w <= 0.0 && c2.w <= 0.0) continue;

    // Screen space positions
    const p0 = new THREE.Vector2((c0.x / c0.w + 1.0) * resolution * 0.5, (c0.y / c0.w + 1.0) * resolution * 0.5);
    const p1 = new THREE.Vector2((c1.x / c1.w + 1.0) * resolution * 0.5, (c1.y / c1.w + 1.0) * resolution * 0.5);
    const p2 = new THREE.Vector2((c2.x / c2.w + 1.0) * resolution * 0.5, (c2.y / c2.w + 1.0) * resolution * 0.5);
    
    const sideA = p1.distanceTo(p2);
    const sideB = p2.distanceTo(p0);
    const sideC = p0.distanceTo(p1);
    const perimeter = sideA + sideB + sideC;
    
    if (perimeter < PERIMETER_THRESHOLD) continue;

    const incenter = new THREE.Vector2(
      (sideA * p0.x + sideB * p1.x + sideC * p2.x) / perimeter,
      (sideA * p0.y + sideB * p1.y + sideC * p2.y) / perimeter
    );
    
    const d0 = p0.distanceTo(incenter);
    const d1 = p1.distanceTo(incenter);
    const d2 = p2.distanceTo(incenter);
    const distance_points = Math.max(d0, d1, d2);
    
    if (distance_points > DISTANCE_THRESHOLD_MAX || distance_points < DISTANCE_THRESHOLD_MIN) continue;

    // Estimate fragment shader alpha values
    // vPhiCenterScale = 1.0 / safeDist where safeDist is the distance from incenter
    // The shader uses: if (safeDist >= 0.0) safeDist = -1e-4;
    // Then: vPhiCenterScale = 1.0 / safeDist
    let safeDist = -distance_points; // Negative distance to center (safeDist < 0)
    if (safeDist >= 0.0) {
      safeDist = -1e-4;
    }
    const phiCenterScale = 1.0 / safeDist; // This will be negative
    
    // Sample a few pixel positions within the triangle
    const sampleCount = Math.min(9, Math.ceil(perimeter / 10));
    for (let s = 0; s < sampleCount; s++) {
      const baryX = Math.random();
      const baryY = Math.random() * (1 - baryX);
      const baryZ = 1 - baryX - baryY;
      
      const pixelX = baryX * p0.x + baryY * p1.x + baryZ * p2.x;
      const pixelY = baryX * p0.y + baryY * p1.y + baryZ * p2.y;
      
      // Compute signed distances to edges
      const n0 = new THREE.Vector2(-(p1.y - p0.y), p1.x - p0.x).normalize();
      const n1 = new THREE.Vector2(-(p2.y - p1.y), p2.x - p1.x).normalize();
      const n2 = new THREE.Vector2(-(p0.y - p2.y), p0.x - p2.x).normalize();
      
      const offset0 = -n0.dot(p0);
      const offset1 = -n1.dot(p1);
      const offset2 = -n2.dot(p2);
      
      const d0_sample = n0.x * pixelX + n0.y * pixelY + offset0;
      const d1_sample = n1.x * pixelX + n1.y * pixelY + offset1;
      const d2_sample = n2.x * pixelX + n2.y * pixelY + offset2;
      
      if (d0_sample > 0 || d1_sample > 0 || d2_sample > 0) continue; // Outside triangle
      
      // Alpha computation
      const max_val = Math.max(d0_sample, Math.max(d1_sample, d2_sample));
      const phi_final = max_val * phiCenterScale;
      const Cx = Math.max(0.0, Math.pow(Math.max(phi_final, 0.0), sigma));
      const finalAlpha = Math.min(0.99, minWeight * Cx);
      
      alphaStats.totalFragments++;
      alphaStats.phiCenterScaleValues.push(phiCenterScale);
      alphaStats.cxValues.push(Cx);
      alphaStats.alphaValues.push(finalAlpha);
      
      if (finalAlpha >= ALPHA_THRESHOLD) {
        alphaStats.passAlphaCheck++;
      } else {
        alphaStats.failAlphaCheck++;
      }
    }
  }

  const avgAlpha = alphaStats.alphaValues.length > 0
    ? alphaStats.alphaValues.reduce((a, b) => a + b) / alphaStats.alphaValues.length
    : 0;
  const avgPhiScale = alphaStats.phiCenterScaleValues.length > 0
    ? alphaStats.phiCenterScaleValues.reduce((a, b) => a + b) / alphaStats.phiCenterScaleValues.length
    : 0;
  const avgCx = alphaStats.cxValues.length > 0
    ? alphaStats.cxValues.reduce((a, b) => a + b) / alphaStats.cxValues.length
    : 0;

  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║   Fragment Shader Alpha Filtering Analysis (Estimated)             ║
╠════════════════════════════════════════════════════════════════════╣
║ Sampled triangles:                     ${alphaStats.totalFragments.toString().padStart(10)}              ║
║ Fragments passing alpha check:         ${alphaStats.passAlphaCheck.toString().padStart(10)} (${alphaStats.totalFragments > 0 ? (alphaStats.passAlphaCheck/alphaStats.totalFragments*100).toFixed(2) : '0.00'}.padStart(5)}%)         ║
║ Fragments failing alpha check:         ${alphaStats.failAlphaCheck.toString().padStart(10)} (${alphaStats.totalFragments > 0 ? (alphaStats.failAlphaCheck/alphaStats.totalFragments*100).toFixed(2) : '0.00'}.padStart(5)}%)         ║
╠════════════════════════════════════════════════════════════════════╣
║ Alpha Statistics:                                                  ║
║   Average alpha:                       ${avgAlpha.toFixed(6)}                           ║
║   Average vPhiCenterScale:             ${avgPhiScale.toFixed(6)}                           ║
║   Average Cx (softness):               ${avgCx.toFixed(6)}                           ║
║   Sigma parameter (softness):          ${sigma.toFixed(10)}         ║
╚════════════════════════════════════════════════════════════════════╝`);
}

/** Compute filtering statistics for triangle splatting.
 * Analyzes how many triangles would be filtered at each stage. */
export function analyzeTriangleFiltering(
  vertices: Float32Array,
  triangle_indices: Uint32Array,
  opacities: Float32Array,
  _camera: THREE.Camera,
  debug: boolean = false
): {
  minWeightFiltered: number;
  totalTriangles: number;
  filterPercentage: number;
  weightStats: { min: number; max: number; mean: number; median: number };
} {
  if (!debug) {
    return {
      minWeightFiltered: 0,
      totalTriangles: 0,
      filterPercentage: 0,
      weightStats: { min: 0, max: 0, mean: 0, median: 0 },
    };
  }

  const numTriangles = triangle_indices.length / 3;
  const STOPPING_INFLUENCE = 0.01;
  
  let minWeightFiltered = 0;
  const triangleMinWeights: number[] = [];
  let minWeightOverall = Infinity;
  let maxWeightOverall = -Infinity;
  let sumWeights = 0;

  for (let i = 0; i < numTriangles; i++) {
    const v0Idx = triangle_indices[i * 3];
    const v1Idx = triangle_indices[i * 3 + 1];
    const v2Idx = triangle_indices[i * 3 + 2];

    // CRITICAL FIX: Use opacities (sigmoid values 0-1), not raw vertex_weights (can be negative)
    const w0 = opacities[v0Idx];
    const w1 = opacities[v1Idx];
    const w2 = opacities[v2Idx];
    const minWeight = Math.min(w0, w1, w2);
    
    triangleMinWeights.push(minWeight);
    sumWeights += minWeight;
    minWeightOverall = Math.min(minWeightOverall, minWeight);
    maxWeightOverall = Math.max(maxWeightOverall, minWeight);

    if (minWeight < STOPPING_INFLUENCE) {
      minWeightFiltered++;
    }
  }

  const meanWeight = sumWeights / numTriangles;
  const sortedWeights = triangleMinWeights.sort((a, b) => a - b);
  const medianWeight = sortedWeights[Math.floor(numTriangles / 2)];

  const filterPercentage = (minWeightFiltered / numTriangles) * 100;
  const remainingTriangles = numTriangles - minWeightFiltered;
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║         Triangle Splats Filtering Analysis (CPU-side)             ║
╠═══════════════════════════════════════════════════════════════════╣
║ Total triangles:              ${numTriangles.toString().padStart(10)}                   ║
║ Filtered by min_weight < 0.01: ${minWeightFiltered.toString().padStart(10)} (${filterPercentage.toFixed(2).padStart(5)}%)        ║
║ Remaining for GPU:             ${remainingTriangles.toString().padStart(10)} (${(100 - filterPercentage).toFixed(2).padStart(5)}%)        ║
╟───────────────────────────────────────────────────────────────────╢
║ Triangle Min-Weight Statistics:                                   ║
║   Min:    ${minWeightOverall.toExponential(4).padStart(10)}                               ║
║   Max:    ${maxWeightOverall.toExponential(4).padStart(10)}                               ║
║   Mean:   ${meanWeight.toExponential(4).padStart(10)}                               ║
║   Median: ${medianWeight.toExponential(4).padStart(10)}                               ║
╚═══════════════════════════════════════════════════════════════════╝`);

  return {
    minWeightFiltered,
    totalTriangles: numTriangles,
    filterPercentage,
    weightStats: {
      min: minWeightOverall,
      max: maxWeightOverall,
      mean: meanWeight,
      median: medianWeight,
    },
  };
}