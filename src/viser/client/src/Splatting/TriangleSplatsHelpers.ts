import * as THREE from "three";

/**Generate spherical harmonics shader source code for a given degree.*/
export function getSHShaderSource(sh_degree: number) {
  const source = `
    const float SH_C0 = 0.28209479177387814;
    const float SH_C1 = 0.4886025119029199;
    const float SH_C2[5] = float[](
        1.092548430592079,
        -1.092548430592079,
        0.31539156525252005,
        -1.092548430592079,
        0.5462742152960395
    );
    const float SH_C3[7] = float[](
        -0.5900435899266435,
        2.890611442640554,
        -0.4570457994644658,
        0.3731763325901154,
        -0.4570457994644658,
        1.445305721320277,
        -0.5900435899266435
    );

    vec3 computeSH(vec3 dir, vec3 f_dc, vec3 f_rest[15]) {
      vec3 result = SH_C0 * f_dc;
      if (${sh_degree} == 0) return result;

      float x = dir.x;
      float y = dir.y;
      float z = dir.z;

      // Degree 1
      result += SH_C1 * (-y * f_rest[0] + z * f_rest[1] - x * f_rest[2]);
      if (${sh_degree} == 1) return result;

      // Degree 2
      float xx = x * x, yy = y * y, zz = z * z;
      float xy = x * y, yz = y * z, xz = x * z;
      result += SH_C2[0] * xy * f_rest[3] +
                SH_C2[1] * yz * f_rest[4] +
                SH_C2[2] * (2.0 * zz - xx - yy) * f_rest[5] +
                SH_C2[3] * xz * f_rest[6] +
                SH_C2[4] * (xx - yy) * f_rest[7];
      if (${sh_degree} == 2) return result;

      // Degree 3
      result += SH_C3[0] * y * (3.0 * xx - yy) * f_rest[8] +
                SH_C3[1] * xy * z * f_rest[9] +
                SH_C3[2] * y * (4.0 * zz - xx - yy) * f_rest[10] +
                SH_C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * f_rest[11] +
                SH_C3[4] * x * (4.0 * zz - xx - yy) * f_rest[12] +
                SH_C3[5] * z * (xx - yy) * f_rest[13] +
                SH_C3[6] * x * (xx - 3.0 * yy) * f_rest[14];
      return result;
    }
  `;
  return source;
}

/**Parameters for creating triangle splats geometry and material.*/
export interface TriangleSplatsParams {
  vertices: Float32Array; // (V, 3) - 3D vertex positions
  triangle_indices: Uint32Array; // (T, 3) - triangle face indices
  opacities: Float32Array; // (V,) - vertex opacity
  colors?: Uint8Array; // (V, 3) - direct RGB colors (optional)
  features_dc?: Float32Array; // (V, 3) - DC (constant) SH coefficient (unflattened)
  features_rest?: Float32Array; // (V, SH_rest, 3) - higher-order SH coefficients (unflattened)
  sh_degree?: number; // Maximum SH degree (0-3)
  sigma?: number; // Global sigma parameter for edge softness
  camera: THREE.Camera;
}

/**Create triangle splats geometry from mesh data.*/
export function createTriangleSplatsGeometry(
  vertices: Float32Array,
  triangle_indices: Uint32Array,
  opacities: Float32Array,
  vertex_weights: Float32Array | undefined,
  colors: Uint8Array | undefined,
  features_dc: Float32Array | undefined,
  features_rest: Float32Array | undefined,
  sh_degree: number,
): THREE.BufferGeometry {
  const restComponentCount =
    sh_degree > 0 ? (sh_degree + 1) ** 2 - 1 : 0;
  const numTriangles = triangle_indices.length / 3;
  const numVertices = numTriangles * 3;

  const unrolledVertices = new Float32Array(numVertices * 3);
  const triangleCenters = new Float32Array(numTriangles * 3);
  const unrolledBarycentrics = new Float32Array(numVertices * 3);
  const unrolledOpacities = new Float32Array(numVertices);
  const triangleMinWeights = new Float32Array(numVertices);
  
  // Store the original vertex index for each vertex (for SH texture lookup)
  const vertexIndices = new Float32Array(numVertices);
  
  // Store all three vertex indices for each triangle vertex (for color interpolation)
  const triangleVertexIndices0 = new Float32Array(numVertices);
  const triangleVertexIndices1 = new Float32Array(numVertices);
  const triangleVertexIndices2 = new Float32Array(numVertices);
  
  // Store the three triangle vertex coordinates for each vertex (for geometric distance calculation)
  const triangleVertices0 = new Float32Array(numVertices * 3);  // First vertex
  const triangleVertices1 = new Float32Array(numVertices * 3);  // Second vertex
  const triangleVertices2 = new Float32Array(numVertices * 3);  // Third vertex

  // Store opacities of all 3 vertices for each vertex to compute min weight in shader
  const triangleOpacities0 = new Float32Array(numVertices);
  const triangleOpacities1 = new Float32Array(numVertices);
  const triangleOpacities2 = new Float32Array(numVertices);

  // Only create SH data for ORIGINAL vertices (not unrolled), to save texture memory
  const useSH = !!features_dc;
  const numOriginalVertices = vertices.length / 3;
  const shData = useSH ? new Float32Array(numOriginalVertices * 48) : null;

  // Pack SH coefficients for original vertices first
  if (shData && features_dc) {
    for (let vIdx = 0; vIdx < numOriginalVertices; vIdx++) {
      const shOff = vIdx * 48;
      // DC component (degree 0): 1 coefficient = 3 floats (RGB)
      shData[shOff + 0] = features_dc[vIdx * 3 + 0];
      shData[shOff + 1] = features_dc[vIdx * 3 + 1];
      shData[shOff + 2] = features_dc[vIdx * 3 + 2];
      
      if (features_rest && restComponentCount > 0) {
        // Rest components: stored as (V, SH_rest, 3) where SH_rest = (sh_degree+1)^2 - 1
        const restSize = restComponentCount * 3;
        const srcStart = vIdx * restSize;
        for (let k = 0; k < restSize; k++) {
          shData[shOff + 3 + k] = features_rest[srcStart + k];
        }
      }
    }
  }

  // Now unroll triangles
  for (let i = 0; i < numTriangles; i++) {
    // Get the three vertex indices for this triangle
    const v0Idx = triangle_indices[i * 3 + 0];
    const v1Idx = triangle_indices[i * 3 + 1];
    const v2Idx = triangle_indices[i * 3 + 2];

    // Compute triangle center for sorting
    triangleCenters[i * 3 + 0] = (vertices[v0Idx * 3 + 0] + vertices[v1Idx * 3 + 0] + vertices[v2Idx * 3 + 0]) / 3.0;
    triangleCenters[i * 3 + 1] = (vertices[v0Idx * 3 + 1] + vertices[v1Idx * 3 + 1] + vertices[v2Idx * 3 + 1]) / 3.0;
    triangleCenters[i * 3 + 2] = (vertices[v0Idx * 3 + 2] + vertices[v1Idx * 3 + 2] + vertices[v2Idx * 3 + 2]) / 3.0;

    // CRITICAL FIX: Always use opacities (sigmoid values 0-1) for min_weight calculation
    // vertex_weights contains raw pre-sigmoid values which can be negative!
    const w0 = opacities[v0Idx];
    const w1 = opacities[v1Idx];
    const w2 = opacities[v2Idx];
    const triangleMinWeight = Math.min(w0, w1, w2);

    for (let j = 0; j < 3; j++) {
      const vIdx = triangle_indices[i * 3 + j];
      const targetIdx = i * 3 + j;

      // Positions
      unrolledVertices[targetIdx * 3] = vertices[vIdx * 3];
      unrolledVertices[targetIdx * 3 + 1] = vertices[vIdx * 3 + 1];
      unrolledVertices[targetIdx * 3 + 2] = vertices[vIdx * 3 + 2];

      // Store original vertex index
      vertexIndices[targetIdx] = vIdx;
      
      // Store all three triangle vertex indices for color interpolation
      triangleVertexIndices0[targetIdx] = v0Idx;
      triangleVertexIndices1[targetIdx] = v1Idx;
      triangleVertexIndices2[targetIdx] = v2Idx;

      // Barycentrics
      unrolledBarycentrics[targetIdx * 3 + j] = 1.0;

      // Opacity
      unrolledOpacities[targetIdx] = opacities[vIdx];
      
      // Store triangle vertices for all three vertices of the triangle
      triangleVertices0[targetIdx * 3 + 0] = vertices[v0Idx * 3];
      triangleVertices0[targetIdx * 3 + 1] = vertices[v0Idx * 3 + 1];
      triangleVertices0[targetIdx * 3 + 2] = vertices[v0Idx * 3 + 2];
      
      triangleVertices1[targetIdx * 3 + 0] = vertices[v1Idx * 3];
      triangleVertices1[targetIdx * 3 + 1] = vertices[v1Idx * 3 + 1];
      triangleVertices1[targetIdx * 3 + 2] = vertices[v1Idx * 3 + 2];
      
      triangleVertices2[targetIdx * 3 + 0] = vertices[v2Idx * 3];
      triangleVertices2[targetIdx * 3 + 1] = vertices[v2Idx * 3 + 1];
      triangleVertices2[targetIdx * 3 + 2] = vertices[v2Idx * 3 + 2];

      // Store opacities for min_weight calculation
      triangleOpacities0[targetIdx] = opacities[v0Idx];
      triangleOpacities1[targetIdx] = opacities[v1Idx];
      triangleOpacities2[targetIdx] = opacities[v2Idx];
      triangleMinWeights[targetIdx] = triangleMinWeight;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.BufferAttribute(unrolledVertices, 3),
  );
  geom.setAttribute(
    "aBarycentric",
    new THREE.BufferAttribute(unrolledBarycentrics, 3),
  );
  geom.setAttribute("aOpacity", new THREE.BufferAttribute(unrolledOpacities, 1));
  geom.setAttribute(
    "aVertexIndex",
    new THREE.BufferAttribute(vertexIndices, 1),
  );
  
  // Add triangle vertex indices for color interpolation
  geom.setAttribute(
    "aTriangleVertexIdx0",
    new THREE.BufferAttribute(triangleVertexIndices0, 1),
  );
  geom.setAttribute(
    "aTriangleVertexIdx1",
    new THREE.BufferAttribute(triangleVertexIndices1, 1),
  );
  geom.setAttribute(
    "aTriangleVertexIdx2",
    new THREE.BufferAttribute(triangleVertexIndices2, 1),
  );
  
  // Add triangle vertex coordinates for geometric distance calculation
  geom.setAttribute(
    "aTriangleV0",
    new THREE.BufferAttribute(triangleVertices0, 3),
  );
  geom.setAttribute(
    "aTriangleV1",
    new THREE.BufferAttribute(triangleVertices1, 3),
  );
  geom.setAttribute(
    "aTriangleV2",
    new THREE.BufferAttribute(triangleVertices2, 3),
  );
  
  geom.setAttribute("aTriangleOpacity0", new THREE.BufferAttribute(triangleOpacities0, 1));
  geom.setAttribute("aTriangleOpacity1", new THREE.BufferAttribute(triangleOpacities1, 1));
  geom.setAttribute("aTriangleOpacity2", new THREE.BufferAttribute(triangleOpacities2, 1));
  geom.setAttribute(
    "aTriangleMinWeight",
    new THREE.BufferAttribute(triangleMinWeights, 1),
  );

  // Store triangle centers for efficient sorting
  (geom as any).triangleCenters = triangleCenters;

  if (shData) {
    // Store SH data in a data texture to avoid exceeding WebGL attribute limit
    // Use original vertex count (not unrolled) to minimize texture size
    const numOriginalVertices = vertices.length / 3;
    
    // Each vertex has 48 floats (12 RGBA pixels)
    const pixelsPerVertex = 12;
    const totalPixels = numOriginalVertices * pixelsPerVertex;
    
    // Use a 1024-wide 2D texture to avoid height limits (max height is usually 8k or 16k)
    // 1.1M vertices * 12 pixels = 13.3M pixels. 13.3M / 1024 = 13000 rows. fits in 16k.
    const texWidth = 1024;
    const texHeight = Math.ceil(totalPixels / texWidth);
    
    // Allocate full texture data
    const rgbaData = new Float32Array(texWidth * texHeight * 4);
    // Copy the flat SH data which is already packed as 48 floats per vertex
    rgbaData.set(shData);
    
    const shDataTexture = new THREE.DataTexture(
      rgbaData,
      texWidth,
      texHeight,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    shDataTexture.magFilter = THREE.NearestFilter;
    shDataTexture.minFilter = THREE.NearestFilter;
    shDataTexture.needsUpdate = true;
    
    // Store the texture on the geometry for later use
    (geom as any).shDataTexture = shDataTexture;
    console.log("SH DataTexture created:", {
      size: `${texWidth}x${texHeight}`,
      totalPixels,
      originalVertices: numOriginalVertices,
    });
  }

  if (colors) {
    const unrolledColors = new Float32Array(numVertices * 3);
    for (let i = 0; i < numTriangles * 3; i++) {
      const vIdx = triangle_indices[i];
      unrolledColors[i * 3] = colors[vIdx * 3] / 255.0;
      unrolledColors[i * 3 + 1] = colors[vIdx * 3 + 1] / 255.0;
      unrolledColors[i * 3 + 2] = colors[vIdx * 3 + 2] / 255.0;
    }
    geom.setAttribute("aColor", new THREE.BufferAttribute(unrolledColors, 3));
  }

  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  console.log("TriangleSplats geometry created:", {
    numVertices,
    numTriangles,
    bbox: geom.boundingBox,
    firstVertex: unrolledVertices.slice(0, 3),
    firstOpacity: unrolledOpacities[0],
    hasColor: !!colors,
    useSH,
  });

  // Add an index buffer for efficient sorting
  const indices = new Uint32Array(numVertices);
  for (let i = 0; i < numVertices; i++) {
    indices[i] = i;
  }
  geom.setIndex(new THREE.BufferAttribute(indices, 1));

  return geom;
}

/**Create triangle splats material with shaders.*/
export function createTriangleSplatsMaterial(
  camera: THREE.Camera,
  sh_degree: number,
  colors: Uint8Array | undefined,
  features_dc: Float32Array | undefined,
  sigma: number,
  shDataTexture?: THREE.DataTexture,
  debugShaderLogging = false,
  enableDebugPrintfExtension = false,
): THREE.ShaderMaterial {
  const useSH = !!features_dc;
  const defines = {
    USE_DEBUG_PRINTF: enableDebugPrintfExtension ? 1 : 0,
  };
  // No vertex attribute declarations needed - we'll use texture sampling instead

  const vertexShader = `
    in float aTriangleMinWeight;
    in vec3 aBarycentric;
    in vec3 aTriangleV0;
    in vec3 aTriangleV1;
    in vec3 aTriangleV2;
    in float aTriangleOpacity0;
    in float aTriangleOpacity1;
    in float aTriangleOpacity2;
    in float aVertexIndex;
    in float aTriangleVertexIdx0;
    in float aTriangleVertexIdx1;
    in float aTriangleVertexIdx2;
    ${colors ? "in vec3 aColor;" : ""}

    out vec3 vColor;
    out vec3 vColor0;  // Color at vertex 0
    out vec3 vColor1;  // Color at vertex 1
    out vec3 vColor2;  // Color at vertex 2
    out vec2 vScreenPos0;  // Screen position of vertex 0
    out vec2 vScreenPos1;  // Screen position of vertex 1
    out vec2 vScreenPos2;  // Screen position of vertex 2
    out float vTriangleMinWeight;
    out float vPhiCenterScale;
    out vec2 vNormal0;
    out vec2 vNormal1;
    out vec2 vNormal2;
    out float vOffset0;
    out float vOffset1;
    out float vOffset2;

    uniform vec3 worldCameraPosition;
    uniform vec2 uResolution;
    uniform float sigma;
    uniform float uEnableShaderLogging;
    ${useSH ? "uniform sampler2D shDataTexture;" : ""}

    ${useSH ? getSHShaderSource(sh_degree) : ""}

    // Fetch SH data from RGBA texture (1024 wide)
    vec4 fetchSHDataAt(int vertexIdx, int i) {
      ivec2 texSize = textureSize(shDataTexture, 0);
      int pixelIdx = vertexIdx * 12 + i;
      int x = pixelIdx % texSize.x;
      int y = pixelIdx / texSize.x;
      return texelFetch(shDataTexture, ivec2(x, y), 0);
    }

    // Compute SH color for a specific vertex
    vec3 computeVertexColor(int vertexIdx, vec3 worldPos) {
      vec3 f_dc = fetchSHDataAt(vertexIdx, 0).xyz;
      if (${sh_degree} == 0) {
        vec3 dir = normalize(worldPos - worldCameraPosition);
        return max(SH_C0 * f_dc + 0.5, vec3(0.0));
      }

      vec3 f_rest[15];
      vec4 sh0 = fetchSHDataAt(vertexIdx, 0); f_rest[0] = vec3(sh0.w, 0.0, 0.0);
      vec4 sh1 = fetchSHDataAt(vertexIdx, 1); f_rest[0].yz = sh1.xy; f_rest[1] = vec3(sh1.zw, 0.0);
      vec4 sh2 = fetchSHDataAt(vertexIdx, 2); f_rest[1].z = sh2.x; f_rest[2] = sh2.yzw;
      
      if (${sh_degree} > 1) {
        vec4 sh3 = fetchSHDataAt(vertexIdx, 3); f_rest[3] = sh3.xyz; f_rest[4] = vec3(sh3.w, 0.0, 0.0);
        vec4 sh4 = fetchSHDataAt(vertexIdx, 4); f_rest[4].yz = sh4.xy; f_rest[5] = vec3(sh4.zw, 0.0);
        vec4 sh5 = fetchSHDataAt(vertexIdx, 5); f_rest[5].z = sh5.x; f_rest[6] = sh5.yzw;
      }
      
      if (${sh_degree} > 2) {
        vec4 sh6 = fetchSHDataAt(vertexIdx, 6); f_rest[7] = sh6.xyz; f_rest[8] = vec3(sh6.w, 0.0, 0.0);
        vec4 sh7 = fetchSHDataAt(vertexIdx, 7); f_rest[8].yz = sh7.xy; f_rest[9] = vec3(sh7.zw, 0.0);
        vec4 sh8 = fetchSHDataAt(vertexIdx, 8); f_rest[9].z = sh8.x; f_rest[10] = sh8.yzw;
        vec4 sh9 = fetchSHDataAt(vertexIdx, 9); f_rest[11] = sh9.xyz; f_rest[12] = vec3(sh9.w, 0.0, 0.0);
        vec4 sh10 = fetchSHDataAt(vertexIdx, 10); f_rest[12].yz = sh10.xy; f_rest[13] = vec3(sh10.zw, 0.0);
        vec4 sh11 = fetchSHDataAt(vertexIdx, 11); f_rest[13].z = sh11.x; f_rest[14] = sh11.yzw;
      }
      
      vec3 dir = normalize(worldPos - worldCameraPosition);
      return max(computeSH(dir, f_dc, f_rest) + 0.5, vec3(0.0));
    }

    void main() {
        vTriangleMinWeight = aTriangleMinWeight;
      
      // CUDA: skip if min_weight < 0.01
        if (vTriangleMinWeight < 0.01) {
          gl_Position = vec4(0.0, 0.0, 0.0, -1.0);
          return;
      }

      // CUDA preprocessCUDA backface culling: compute normal and check against camera direction
      // Step 1: Compute triangle normal via cross product in world space
      vec3 edge1 = aTriangleV1 - aTriangleV0;
      vec3 edge2 = aTriangleV2 - aTriangleV0;
      vec3 normal_world = cross(edge1, edge2);
      
      // Step 2: Transform normal to view space (using upper 3x3 of modelViewMatrix)
      vec3 normalView = mat3(modelViewMatrix) * normal_world;
      float normalLen = length(normalView);
      if (normalLen > 1e-4) {
        normalView = normalize(normalView);
      }
      
      // Step 3: Compute triangle center and view direction at center
      vec3 centerWorld = (aTriangleV0 + aTriangleV1 + aTriangleV2) / 3.0;
      vec3 centerView = (modelViewMatrix * vec4(centerWorld, 1.0)).xyz;
      vec3 viewDir = normalize(-centerView);
      
      // Step 4: Compute dot product with camera direction
      float cos_theta = dot(normalView, viewDir);
      
      // Step 5: Flip normal if necessary (ensure it faces camera)
      if (cos_theta > 0.0) {
        normalView = -normalView;
        cos_theta = -cos_theta;
      }
      
      // Step 6: Reject edge-on triangles (threshold = 0.001 from CUDA)
      if (abs(cos_theta) < 0.001) {
        gl_Position = vec4(0.0, 0.0, 0.0, -1.0);
        return;
      }

      // Calculate Clip Space positions of the 3 triangle vertices
      vec4 c0 = projectionMatrix * modelViewMatrix * vec4(aTriangleV0, 1.0);
      vec4 c1 = projectionMatrix * modelViewMatrix * vec4(aTriangleV1, 1.0);
      vec4 c2 = projectionMatrix * modelViewMatrix * vec4(aTriangleV2, 1.0);
      
      // Perspective culling
      if (c0.w <= 0.0 && c1.w <= 0.0 && c2.w <= 0.0) {
          gl_Position = vec4(0.0, 0.0, 0.0, -1.0);
          return;
      }

        // Exact CUDA-style projection: (ndc + 1.0) * S * 0.5 - 0.5
        // This shifts pixel centers by 0.5 compared to standard WebGL
        vec2 projected[3];
        projected[0] = ((c0.xy / c0.w) + 1.0) * uResolution * 0.5 - 0.5;
        projected[1] = ((c1.xy / c1.w) + 1.0) * uResolution * 0.5 - 0.5;
        projected[2] = ((c2.xy / c2.w) + 1.0) * uResolution * 0.5 - 0.5;

        // Store projected vertex positions for fragment shader
        vScreenPos0 = projected[0];
        vScreenPos1 = projected[1];
        vScreenPos2 = projected[2];

        // Incenter calculation (used for consistent winding)
        float sideA = distance(projected[1], projected[2]);
        float sideB = distance(projected[2], projected[0]);
        float sideC = distance(projected[0], projected[1]);
        float perimeter = sideA + sideB + sideC;
        if (perimeter < 1.0) {
          gl_Position = vec4(0.0, 0.0, 0.0, -1.0);
          return;
        }
        vec2 incenter = (sideA * projected[0] + sideB * projected[1] + sideC * projected[2]) / perimeter;

      // Compute max distance from incenter to triangle vertices in pixel space
      float distance_points = 0.0;
      for (int i = 0; i < 3; i++) {
        float d = distance(projected[i], incenter);
        if (d > distance_points) distance_points = d;
      }

      // Mirror CUDA thresholds: if triangle projects too large or too small, skip it
      // (CUDA uses thresholds like >1600 or <1)
      if (distance_points > 1600.0 || distance_points < 1.0) {
        gl_Position = vec4(0.0, 0.0, 0.0, -1.0);
        return;
      }
      
      float stopping_influence = 0.01;
      float ratio = stopping_influence / vTriangleMinWeight;
      float exponent = 1.0 / sigma;

      vec2 edgeNormals[3];
      float edgeOffsets[3];
      float computedSize = 0.0;
      float lastDist = -1e-4;

      for (int i = 0; i < 3; i++) {
        vec2 current = projected[i];
        vec2 next = projected[(i + 1) % 3];
        vec2 edge = next - current;
        vec2 normal = vec2(edge.y, -edge.x);
        float len = length(normal);
        if (len > 1e-4) {
          normal /= len;
        }
        float offset = -(normal.x * current.x + normal.y * current.y);
        float dist = normal.x * incenter.x + normal.y * incenter.y + offset;
        if (dist > 0.0) {
          normal = -normal;
          offset = -offset;
          dist = -dist;
        }
        
        float shrinkSize = computedSize;
        if (shrinkSize == 0.0) {
          shrinkSize = dist * pow(ratio, exponent);
          computedSize = shrinkSize;
        }
        float offsetWithShrink = offset - shrinkSize;
        edgeNormals[i] = normal;
        edgeOffsets[i] = offsetWithShrink;
        lastDist = dist;
      }
      
      // TODO: Implement proper CUDA dist > -1 check
      // For now, skip this filter as it may be too aggressive
      // The fragment shader will handle most degenerate cases via alpha threshold

      vNormal0 = edgeNormals[0];
      vNormal1 = edgeNormals[1];
      vNormal2 = edgeNormals[2];
      vOffset0 = edgeOffsets[0];
      vOffset1 = edgeOffsets[1];
      vOffset2 = edgeOffsets[2];

      float safeDist = lastDist;
      if (safeDist >= 0.0) {
        safeDist = -1e-4;
      }
      vPhiCenterScale = 1.0 / safeDist;

      // Compute colors at all three vertices using SH
      if (${useSH ? "true" : "false"}) {
          vec3 worldPos0 = (modelMatrix * vec4(aTriangleV0, 1.0)).xyz;
          vec3 worldPos1 = (modelMatrix * vec4(aTriangleV1, 1.0)).xyz;
          vec3 worldPos2 = (modelMatrix * vec4(aTriangleV2, 1.0)).xyz;
          
          int vIdx0 = int(aTriangleVertexIdx0);
          int vIdx1 = int(aTriangleVertexIdx1);
          int vIdx2 = int(aTriangleVertexIdx2);
          
          vColor0 = computeVertexColor(vIdx0, worldPos0);
          vColor1 = computeVertexColor(vIdx1, worldPos1);
          vColor2 = computeVertexColor(vIdx2, worldPos2);
          
          // Current vertex color (used as fallback)
          vColor = computeVertexColor(int(aVertexIndex), (modelMatrix * vec4(position, 1.0)).xyz);
      } else {
          ${colors ? "vColor = aColor; vColor0 = aColor; vColor1 = aColor; vColor2 = aColor;" : "vColor = vec3(1.0); vColor0 = vec3(1.0); vColor1 = vec3(1.0); vColor2 = vec3(1.0);"}
      }

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    in vec3 vColor;
    in vec3 vColor0;
    in vec3 vColor1;
    in vec3 vColor2;
    in vec2 vScreenPos0;
    in vec2 vScreenPos1;
    in vec2 vScreenPos2;
    in float vTriangleMinWeight;
    in float vPhiCenterScale;
    in vec2 vNormal0;
    in vec2 vNormal1;
    in vec2 vNormal2;
    in float vOffset0;
    in float vOffset1;
    in float vOffset2;

    out vec4 fragColor;

    uniform float sigma;
    uniform float uEnableShaderLogging;

    // Compute barycentric coordinates in screen space (matching CUDA implementation)
    vec3 computeBarycentric(vec2 p, vec2 a, vec2 b, vec2 c) {
      vec2 v0 = b - a;
      vec2 v1 = c - a;
      vec2 v2 = p - a;
      
      float denom = v0.x * v1.y - v1.x * v0.y;
      if (abs(denom) < 1e-6) {
        return vec3(1.0/3.0, 1.0/3.0, 1.0/3.0);  // Degenerate triangle
      }
      
      float invDen = 1.0 / denom;
      float b0 = (v2.x * v1.y - v1.x * v2.y) * invDen;  // Weight for vertex b
      float b1 = (-v2.x * v0.y + v0.x * v2.y) * invDen;  // Weight for vertex c
      float b2 = 1.0 - b0 - b1;  // Weight for vertex a
      
      return vec3(b2, b0, b1);  // Return in order (a, b, c)
    }

    void main() {
       // Match CUDA's pixel sampling (at pixel center)
       vec2 pixf = gl_FragCoord.xy;

       float d0 = dot(vNormal0, pixf) + vOffset0;
       float d1 = dot(vNormal1, pixf) + vOffset1;
       float d2 = dot(vNormal2, pixf) + vOffset2;

       if (d0 > 0.0 || d1 > 0.0 || d2 > 0.0) {
        discard;
       }

       // CUDA Shrinking
      float max_val = max(d0, max(d1, d2));

       float phi_final = max_val * vPhiCenterScale;
       float Cx = max(0.0, pow(max(phi_final, 0.0), sigma));

      float finalAlpha = min(0.99, vTriangleMinWeight * Cx);
       
       // Debug: Log fragment shader statistics (only on first few pixels to avoid spam)
       if (uEnableShaderLogging > 0.5 && gl_FragCoord.x < 5.0 && gl_FragCoord.y < 5.0) {
           float distToEdge = -max_val;
           bool insideTriangle = (d0 <= 0.0 && d1 <= 0.0 && d2 <= 0.0);
           bool passAlpha = finalAlpha >= 1.0 / 255.0;
           // Note: printf not available, using discard to signal issues
       }
       
       if (finalAlpha < 1.0 / 255.0) discard;

       // Compute screen-space barycentric coordinates (matching CUDA)
       vec3 bary = computeBarycentric(pixf, vScreenPos0, vScreenPos1, vScreenPos2);
       
       // Interpolate color using screen-space barycentric coordinates
       vec3 interpColor = bary.x * vColor0 + bary.y * vColor1 + bary.z * vColor2;
       
       fragColor = vec4(interpColor * finalAlpha, finalAlpha);
    }
  `;


  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines,
    uniforms: {
      worldCameraPosition: { value: (camera.position as THREE.Vector3).clone() },
      sigma: { value: sigma }, 
      uEnableShaderLogging: { value: debugShaderLogging ? 1.0 : 0.0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }, // Initial value
      ...(useSH && shDataTexture ? { shDataTexture: { value: shDataTexture } } : {}),
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,    // Use CustomBlending for forward accumulation: C_out = C_src * α + C_dst * (1 - α)
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    side: THREE.DoubleSide,
  });
  
  return material;
}
