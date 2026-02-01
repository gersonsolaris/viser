/**Triangle sorting worker for non-blocking depth-based sorting.
 *
 * Runs triangle sorting in a background thread to avoid blocking the render thread.
 * Uses an efficient counting sort approach for fast z-sorting.
 */

interface SortRequest {
  numTriangles: number;
  centers: Float32Array; // (T, 3) - Pre-computed triangle centers
  viewMatrix: Float32Array; // Row-major 4x4 matrix
  requestId: number;
}

interface SortResult {
  preparedIndexArray: Uint32Array; // (3*T) - Fully prepared index buffer
  requestId: number;
}

/**Sort triangles by depth and prepare index buffer.
 */
function sortAndPrepareIndexBuffer(
  numTriangles: number,
  centers: Float32Array,
  viewMatrix: Float32Array
): Uint32Array {
  // Step 1: Compute depth for each triangle
  // Using exactly the same indices as Three.js modelViewMatrix
  const m20 = viewMatrix[2];
  const m21 = viewMatrix[6];
  const m22 = viewMatrix[10];
  const m23 = viewMatrix[14];

  const floatDepths = new Float32Array(numTriangles);
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  for (let i = 0; i < numTriangles; i++) {
    const x = centers[i * 3];
    const y = centers[i * 3 + 1];
    const z = centers[i * 3 + 2];

    // Camera space Z
    const z_cam = m20 * x + m21 * y + m22 * z + m23;
    floatDepths[i] = z_cam;

    if (z_cam < minDepth) minDepth = z_cam;
    if (z_cam > maxDepth) maxDepth = z_cam;
  }

  // Step 2: Map depths to 16-bit integer range [0, 65535]
  const range = maxDepth - minDepth;
  if (range <= 1e-7) {
    const indices = new Uint32Array(numTriangles * 3);
    for (let i = 0; i < numTriangles; i++) {
      indices[i * 3] = i * 3;
      indices[i * 3 + 1] = i * 3 + 1;
      indices[i * 3 + 2] = i * 3 + 2;
    }
    return indices;
  }

  const depthsInt = new Uint32Array(numTriangles);
  const scale = 65535 / range;
  for (let i = 0; i < numTriangles; i++) {
    // BACK-TO-FRONT: Furthest (minDepth) should be rendered first.
    // Map furthest objects to depthIdx 0.
    depthsInt[i] = Math.floor((floatDepths[i] - minDepth) * scale);
  }

  // Step 3: Counting sort
  const counts = new Uint32Array(65536);
  for (let i = 0; i < numTriangles; i++) {
    counts[depthsInt[i]]++;
  }

  const offsets = new Uint32Array(65536);
  let currentOffset = 0;
  for (let i = 0; i < 65536; i++) {
    const count = counts[i];
    offsets[i] = currentOffset;
    currentOffset += count;
  }

  const sortedIndices = new Uint32Array(numTriangles);
  for (let i = 0; i < numTriangles; i++) {
    const depthIdx = depthsInt[i];
    sortedIndices[offsets[depthIdx]++] = i;
  }

  // Step 4: Prepare the full index buffer
  const preparedIndexArray = new Uint32Array(numTriangles * 3);
  for (let i = 0; i < numTriangles; i++) {
    const oldTriIdx = sortedIndices[i];
    const baseOffset = oldTriIdx * 3;
    preparedIndexArray[i * 3] = baseOffset;
    preparedIndexArray[i * 3 + 1] = baseOffset + 1;
    preparedIndexArray[i * 3 + 2] = baseOffset + 2;
  }

  return preparedIndexArray;
}

/**Handle sort requests from the main thread.*/
self.onmessage = (event: MessageEvent<SortRequest>) => {
  const { numTriangles, centers, viewMatrix, requestId } = event.data;

  try {
    const preparedIndexArray = sortAndPrepareIndexBuffer(
      numTriangles,
      centers,
      viewMatrix
    );

    const result: SortResult = {
      preparedIndexArray,
      requestId,
    };

    // @ts-ignore
    self.postMessage(result, [preparedIndexArray.buffer]);
  } catch (error) {
    console.error("Worker sort failed:", error);
    // @ts-ignore
    self.postMessage({ error: String(error), requestId });
  }
};

export {};
