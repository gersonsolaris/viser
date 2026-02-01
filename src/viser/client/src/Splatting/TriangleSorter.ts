import * as THREE from "three";

/**Update geometry index buffer based on sorted triangle indices.
 * 
 * Takes the sorted triangle indices and reorganizes the index buffer
 * to change the rendering order without moving other attribute data.
 * 
 * This is much faster than reordering all attributes.
 */
export function updateGeometryIndexByTriangleSort(
  geometry: THREE.BufferGeometry,
  sortedTriangleIndices: Uint32Array
): void {
  const numTriangles = sortedTriangleIndices.length;
  const verticesPerTriangle = 3;
  
  const indexAttr = geometry.index;
  if (!indexAttr) return;

  const indexArray = indexAttr.array as Uint32Array;
  
  for (let newTriIdx = 0; newTriIdx < numTriangles; newTriIdx++) {
    const oldTriIdx = sortedTriangleIndices[newTriIdx];
    
    // Each triangle in the unrolled geometry corresponds to 3 consecutive vertices
    const baseOffset = oldTriIdx * verticesPerTriangle;
    indexArray[newTriIdx * 3] = baseOffset;
    indexArray[newTriIdx * 3 + 1] = baseOffset + 1;
    indexArray[newTriIdx * 3 + 2] = baseOffset + 2;
  }

  indexAttr.needsUpdate = true;
}

/**Directly set the geometry index buffer from a prepared array.
 * 
 * Faster than iterating on the main thread.
 */
export function setGeometryIndexBuffer(
  geometry: THREE.BufferGeometry,
  preparedIndexArray: Uint32Array
): void {
  const indexAttr = geometry.index;
  if (!indexAttr) return;

  const indexArray = indexAttr.array as Uint32Array;
  indexArray.set(preparedIndexArray);
  indexAttr.needsUpdate = true;
}

/**Reorder geometry attributes based on sorted triangle indices.
 *
 * (Legacy function - kept for compatibility but preferred is updateGeometryIndexByTriangleSort)
 */
export function reorderGeometryByTriangleSort(
  geometry: THREE.BufferGeometry,
  sortedTriangleIndices: Uint32Array
): THREE.BufferGeometry {
  const numTriangles = sortedTriangleIndices.length;
  const verticesPerTriangle = 3;
  const totalVertices = numTriangles * verticesPerTriangle;

  // ... (rest of the original function if needed, but we'll use the new one)
  const newGeometry = geometry.clone();
  updateGeometryIndexByTriangleSort(newGeometry, sortedTriangleIndices);
  return newGeometry;
}

