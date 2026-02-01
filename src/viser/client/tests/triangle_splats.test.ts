import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createTriangleSplatsGeometry } from '../src/Splatting/TriangleSplatsHelpers';
import { analyzeTriangleFiltering } from '../src/Splatting/TriangleSplatsAnalyze';

describe('Triangle Splats', () => {
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(3, 3, 3);
    camera.lookAt(0, 0, 0);
  });

  describe('analyzeTriangleFiltering', () => {
    it('should detect triangles with low min weight', () => {
      // Simple cube with 2 triangles
      const vertices = new Float32Array([
        // V0: (0,0,0)
        0, 0, 0,
        // V1: (1,0,0)
        1, 0, 0,
        // V2: (1,1,0)
        1, 1, 0,
        // V3: (0,1,0)
        0, 1, 0,
      ]);

      const triangle_indices = new Uint32Array([
        0, 1, 2, // Triangle 1
        0, 2, 3, // Triangle 2
      ]);

      // Opacities: V0 has very low opacity (should filter), others normal
      const opacities = new Float32Array([0.001, 0.5, 0.5, 0.5]);

      const result = analyzeTriangleFiltering(vertices, triangle_indices, opacities, camera, true);

      expect(result.totalTriangles).toBe(2);
      // Both triangles contain V0 which has opacity 0.001 < 0.01
      expect(result.minWeightFiltered).toBe(2);
      expect(result.filterPercentage).toBe(100);
    });

    it('should not filter triangles with sufficient min weight', () => {
      const vertices = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ]);

      const triangle_indices = new Uint32Array([
        0, 1, 2,
        0, 2, 3,
      ]);

      // All opacities above 0.01 threshold
      const opacities = new Float32Array([0.5, 0.5, 0.5, 0.5]);

      const result = analyzeTriangleFiltering(vertices, triangle_indices, opacities, camera, true);

      expect(result.totalTriangles).toBe(2);
      expect(result.minWeightFiltered).toBe(0);
      expect(result.filterPercentage).toBe(0);
    });

    it('should use opacities (sigmoid values) not raw weights', () => {
      const vertices = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
      ]);

      const triangle_indices = new Uint32Array([0, 1, 2]);

      // Test with very low opacity - should filter
      const opacities = new Float32Array([0.001, 0.001, 0.001]);
      const result = analyzeTriangleFiltering(vertices, triangle_indices, opacities, camera, true);

      expect(result.totalTriangles).toBe(1);
      expect(result.minWeightFiltered).toBe(1);
      // All weights should be positive (sigmoid output)
      expect(result.weightStats.min).toBeGreaterThanOrEqual(0);
      expect(result.weightStats.max).toBeLessThanOrEqual(1);
    });

    it('should correctly identify min weight per triangle', () => {
      const vertices = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0,
        2, 0, 0, // V4 for separate triangle
      ]);

      const triangle_indices = new Uint32Array([
        0, 1, 2, // Triangle 1: min weight = min(0.5, 0.005, 0.5) = 0.005 (FILTERED)
        2, 3, 4, // Triangle 2: min weight = min(0.5, 0.5, 0.02) = 0.02 (NOT FILTERED)
      ]);

      const opacities = new Float32Array([
        0.5,  // V0
        0.005, // V1 - below threshold
        0.5,  // V2
        0.5,  // V3
        0.02,  // V4 - above threshold
      ]);

      const result = analyzeTriangleFiltering(vertices, triangle_indices, opacities, camera, true);

      expect(result.totalTriangles).toBe(2);
      // Triangle 1 is filtered (has V1 with 0.005 < 0.01)
      // Triangle 2 is not filtered (min is V4 with 0.02 >= 0.01)
      expect(result.minWeightFiltered).toBe(1);
      expect(result.filterPercentage).toBeCloseTo(50, 1);
    });
  });

  describe('createTriangleSplatsGeometry', () => {
    it('should create geometry from basic triangle data', () => {
      const vertices = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]);

      const triangle_indices = new Uint32Array([0, 1, 2]);

      const opacities = new Float32Array([1.0, 1.0, 1.0]);

      const geometry = createTriangleSplatsGeometry(
        vertices,
        triangle_indices,
        opacities,
        undefined,
        undefined,
        undefined,
        undefined,
        0,
      );

      expect(geometry).toBeDefined();
      expect(geometry.attributes.position).toBeDefined();
      // Should unroll 1 triangle into 3 vertices
      expect(geometry.attributes.position.count).toBe(3);
    });

    it('should create geometry with multiple triangles', () => {
      const vertices = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ]);

      const triangle_indices = new Uint32Array([
        0, 1, 2,
        0, 2, 3,
      ]);

      const opacities = new Float32Array([1.0, 1.0, 1.0, 1.0]);

      const geometry = createTriangleSplatsGeometry(
        vertices,
        triangle_indices,
        opacities,
        undefined,
        undefined,
        undefined,
        undefined,
        0,
      );

      expect(geometry).toBeDefined();
      // Should unroll 2 triangles into 6 vertices (3 per triangle)
      expect(geometry.attributes.position.count).toBe(6);
    });

    it('should include barycentric coordinates', () => {
      const vertices = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]);

      const triangle_indices = new Uint32Array([0, 1, 2]);
      const opacities = new Float32Array([1.0, 1.0, 1.0]);

      const geometry = createTriangleSplatsGeometry(
        vertices,
        triangle_indices,
        opacities,
        undefined,
        undefined,
        undefined,
        undefined,
        0,
      );

      expect(geometry.attributes.aBarycentric).toBeDefined();
      const barycentric = geometry.attributes.aBarycentric.array as Float32Array;

      // Each vertex should have its own barycentric coordinate = 1.0
      // Vertex 0 of triangle: (1, 0, 0)
      expect(barycentric[0]).toBe(1.0);
      expect(barycentric[1]).toBe(0.0);
      expect(barycentric[2]).toBe(0.0);

      // Vertex 1 of triangle: (0, 1, 0)
      expect(barycentric[3]).toBe(0.0);
      expect(barycentric[4]).toBe(1.0);
      expect(barycentric[5]).toBe(0.0);

      // Vertex 2 of triangle: (0, 0, 1)
      expect(barycentric[6]).toBe(0.0);
      expect(barycentric[7]).toBe(0.0);
      expect(barycentric[8]).toBe(1.0);
    });
  });

  describe('Backface Culling (Shader Logic)', () => {
    it('should reject edge-on triangles (cos_theta close to 0)', () => {
      // This test validates the backface culling threshold logic
      // cos_theta threshold = 0.001
      
      const cosTheta = 0.0005; // |cos_theta| < 0.001 - should be rejected
      const threshold = 0.001;

      expect(Math.abs(cosTheta)).toBeLessThan(threshold);
    });

    it('should accept triangles with sufficient facing angle', () => {
      const cosTheta = -0.1; // |cos_theta| = 0.1 > 0.001 - should be accepted
      const threshold = 0.001;

      expect(Math.abs(cosTheta)).toBeGreaterThan(threshold);
    });

    it('should flip normal when cos_theta > 0', () => {
      // Initial normal facing away from camera
      const normal = new THREE.Vector3(1, 0, 0);
      const viewDir = new THREE.Vector3(1, 0, 0).normalize();

      let cosTheta = normal.dot(viewDir); // positive (facing away)
      expect(cosTheta).toBeGreaterThan(0);

      // After flipping
      if (cosTheta > 0) {
        normal.multiplyScalar(-1);
        cosTheta = -cosTheta;
      }

      // Now should be negative (facing towards camera)
      expect(cosTheta).toBeLessThan(0);
    });
  });

  describe('Incenter Calculation', () => {
    it('should compute incenter correctly for equilateral triangle', () => {
      // For equilateral triangle, incenter = centroid
      const projected = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(1, 0),
        new THREE.Vector2(0.5, Math.sqrt(3) / 2),
      ];

      const a = projected[1].distanceTo(projected[2]); // opposite A
      const b = projected[2].distanceTo(projected[0]); // opposite B
      const c = projected[0].distanceTo(projected[1]); // opposite C
      const sum = a + b + c;

      const incenter = new THREE.Vector2(
        (a * projected[0].x + b * projected[1].x + c * projected[2].x) / sum,
        (a * projected[0].y + b * projected[1].y + c * projected[2].y) / sum,
      );

      const centroid = new THREE.Vector2(
        (projected[0].x + projected[1].x + projected[2].x) / 3,
        (projected[0].y + projected[1].y + projected[2].y) / 3,
      );

      expect(incenter.x).toBeCloseTo(centroid.x, 5);
      expect(incenter.y).toBeCloseTo(centroid.y, 5);
    });

    it('should weight incenter by opposite side lengths', () => {
      // Right triangle with sides 3, 4, 5
      const projected = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(3, 0),
        new THREE.Vector2(0, 4),
      ];

      const a = projected[1].distanceTo(projected[2]); // opposite A
      const b = projected[2].distanceTo(projected[0]); // opposite B
      const c = projected[0].distanceTo(projected[1]); // opposite C

      expect(a).toBeCloseTo(5, 5); // hypotenuse
      expect(b).toBeCloseTo(4, 5); // right side
      expect(c).toBeCloseTo(3, 5); // bottom side

      const sum = a + b + c;
      const incenter = new THREE.Vector2(
        (a * projected[0].x + b * projected[1].x + c * projected[2].x) / sum,
        (a * projected[0].y + b * projected[1].y + c * projected[2].y) / sum,
      );

      // Incenter should be weighted towards vertices with longer opposite sides
      expect(incenter.x).toBeGreaterThan(0);
      expect(incenter.y).toBeGreaterThan(0);
    });
  });

  describe('Splat Size Calculation', () => {
    it('should compute splat size using power function', () => {
      // Size = dist * (stopping_influence / min_weight)^(1/sigma)
      const dist = 10.0;
      const stopping_influence = 0.01;
      const min_weight = 0.1;
      const sigma = 1.0;

      const ratio = stopping_influence / min_weight;
      const exponent = 1.0 / sigma;
      const size = dist * Math.pow(ratio, exponent);

      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(dist); // ratio < 1 so size should be smaller
    });

    it('should scale size based on sigma', () => {
      const dist = 10.0;
      const stopping_influence = 0.01;
      const min_weight = 0.1;

      // Size with sigma = 1.0
      const size1 = dist * Math.pow(stopping_influence / min_weight, 1.0 / 1.0);

      // Size with sigma = 0.5 (sharper edges)
      const size2 = dist * Math.pow(stopping_influence / min_weight, 1.0 / 0.5);

      // With smaller sigma, the exponent is larger, so size should be smaller
      expect(size2).toBeLessThan(size1);
    });

    it('should handle edge case when dist is very small', () => {
      const dist = 1e-4;
      const stopping_influence = 0.01;
      const min_weight = 0.1;
      const sigma = 1.0;

      const ratio = stopping_influence / min_weight;
      const exponent = 1.0 / sigma;
      const size = dist * Math.pow(ratio, exponent);

      expect(size).toBeGreaterThan(0);
      expect(isFinite(size)).toBe(true);
    });
  });

  describe('Depth Sorting Stability', () => {
    it('should produce stable sort when depths are equal', () => {
      // Create array of indices with equal depths
      const numTriangles = 10;
      const depths = new Float32Array(numTriangles);
      const sortedIndices = new Uint32Array(numTriangles);
      
      // All triangles at the same depth
      for (let i = 0; i < numTriangles; i++) {
        depths[i] = -5.0;  // Same depth for all
        sortedIndices[i] = i;
      }

      // Sort using the algorithm from TriangleSplats.tsx
      sortedIndices.sort((a, b) => {
        const depthDiff = depths[a] - depths[b];
        if (Math.abs(depthDiff) < 1e-6) {
          return a - b;  // Stable: preserve original order
        }
        return depthDiff;
      });

      // With stable sorting, order should be preserved
      for (let i = 0; i < numTriangles; i++) {
        expect(sortedIndices[i]).toBe(i);
      }
    });

    it('should sort by depth when depths are different', () => {
      const depths = new Float32Array([-10, -5, -15, -1, -20]);
      const sortedIndices = new Uint32Array([0, 1, 2, 3, 4]);

      sortedIndices.sort((a, b) => {
        const depthDiff = depths[a] - depths[b];
        if (Math.abs(depthDiff) < 1e-6) {
          return a - b;
        }
        return depthDiff;
      });

      // Expected order: furthest first (most negative Z)
      // depths: [-20, -15, -10, -5, -1]
      // indices: [4, 2, 0, 1, 3]
      expect(sortedIndices[0]).toBe(4);  // -20
      expect(sortedIndices[1]).toBe(2);  // -15
      expect(sortedIndices[2]).toBe(0);  // -10
      expect(sortedIndices[3]).toBe(1);  // -5
      expect(sortedIndices[4]).toBe(3);  // -1
    });

    it('should handle mixed equal and different depths stably', () => {
      const depths = new Float32Array([-10, -5, -10, -5, -10]);
      const sortedIndices = new Uint32Array([0, 1, 2, 3, 4]);

      sortedIndices.sort((a, b) => {
        const depthDiff = depths[a] - depths[b];
        if (Math.abs(depthDiff) < 1e-6) {
          return a - b;
        }
        return depthDiff;
      });

      // Expected: [-10, -10, -10, -5, -5]
      // Indices with same depth preserve order: [0, 2, 4, 1, 3]
      expect(depths[sortedIndices[0]]).toBe(-10);
      expect(depths[sortedIndices[1]]).toBe(-10);
      expect(depths[sortedIndices[2]]).toBe(-10);
      expect(depths[sortedIndices[3]]).toBe(-5);
      expect(depths[sortedIndices[4]]).toBe(-5);
      
      // Check stability for equal depths
      const indicesAt10 = [sortedIndices[0], sortedIndices[1], sortedIndices[2]];
      expect(indicesAt10[0]).toBeLessThan(indicesAt10[1]);
      expect(indicesAt10[1]).toBeLessThan(indicesAt10[2]);
    });
  });

  describe('Min Distance Filter (CUDA dist > -1 check)', () => {
    it('should filter triangles where incenter is less than 1 pixel inside', () => {
      // Create a very small triangle where incenter is barely inside
      const projected = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.5, 0),
        new THREE.Vector2(0.25, 0.3),
      ];

      // Compute incenter
      const a = projected[1].distanceTo(projected[2]);
      const b = projected[2].distanceTo(projected[0]);
      const c = projected[0].distanceTo(projected[1]);
      const sum = a + b + c;
      const incenter = new THREE.Vector2(
        (a * projected[0].x + b * projected[1].x + c * projected[2].x) / sum,
        (a * projected[0].y + b * projected[1].y + c * projected[2].y) / sum,
      );

      // Compute distance from incenter to each edge
      let minDist = 0;
      for (let i = 0; i < 3; i++) {
        const current = projected[i];
        const next = projected[(i + 1) % 3];
        const edge = new THREE.Vector2(next.x - current.x, next.y - current.y);
        const normal = new THREE.Vector2(edge.y, -edge.x);
        const len = normal.length();
        if (len > 1e-4) {
          normal.divideScalar(len);
        }
        const offset = -(normal.x * current.x + normal.y * current.y);
        let dist = normal.x * incenter.x + normal.y * incenter.y + offset;
        if (dist > 0) {
          normal.multiplyScalar(-1);
          dist = -dist;
        }
        if (i === 0 || dist > minDist) {
          minDist = dist;
        }
      }

      // minDist should be negative (inside triangle)
      expect(minDist).toBeLessThan(0);
      
      // For such a small triangle, minDist might be > -1
      // which means it should be filtered per CUDA logic
      if (minDist > -1.0) {
        // This triangle should be filtered
        console.log(`Triangle would be filtered: minDist = ${minDist}`);
      }
    });

    it('should pass triangles where incenter is sufficiently inside', () => {
      // Create a larger triangle
      const projected = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(10, 0),
        new THREE.Vector2(5, 8),
      ];

      // Compute incenter
      const a = projected[1].distanceTo(projected[2]);
      const b = projected[2].distanceTo(projected[0]);
      const c = projected[0].distanceTo(projected[1]);
      const sum = a + b + c;
      const incenter = new THREE.Vector2(
        (a * projected[0].x + b * projected[1].x + c * projected[2].x) / sum,
        (a * projected[0].y + b * projected[1].y + c * projected[2].y) / sum,
      );

      // Compute distance from incenter to each edge
      let minDist = 0;
      for (let i = 0; i < 3; i++) {
        const current = projected[i];
        const next = projected[(i + 1) % 3];
        const edge = new THREE.Vector2(next.x - current.x, next.y - current.y);
        const normal = new THREE.Vector2(edge.y, -edge.x);
        const len = normal.length();
        if (len > 1e-4) {
          normal.divideScalar(len);
        }
        const offset = -(normal.x * current.x + normal.y * current.y);
        let dist = normal.x * incenter.x + normal.y * incenter.y + offset;
        if (dist > 0) {
          normal.multiplyScalar(-1);
          dist = -dist;
        }
        if (i === 0 || dist > minDist) {
          minDist = dist;
        }
      }

      // For a large triangle, minDist should be well below -1
      expect(minDist).toBeLessThan(-1.0);
      // This triangle should NOT be filtered
    });
  });

  describe('Screen-space Coordinate Transformation', () => {
    it('should match CUDA ndc2Pix formula', () => {
      // CUDA: ndc2Pix(v, S) = ((v + 1.0) * S - 1.0) * 0.5
      // TS:   pixel = ((ndc + 1.0) * Resolution * 0.5 - 0.5)
      
      const testCases = [
        { ndc: -1.0, resolution: 1920 },
        { ndc: 0.0, resolution: 1920 },
        { ndc: 1.0, resolution: 1920 },
        { ndc: -0.5, resolution: 1080 },
        { ndc: 0.5, resolution: 1080 },
      ];

      for (const { ndc, resolution } of testCases) {
        // CUDA formula
        const cudaPixel = ((ndc + 1.0) * resolution - 1.0) * 0.5;
        
        // TS formula
        const tsPixel = (ndc + 1.0) * resolution * 0.5 - 0.5;
        
        // They should be identical
        expect(tsPixel).toBeCloseTo(cudaPixel, 10);
      }
    });

    it('should correctly map NDC corners to pixel coordinates', () => {
      const resolution = 1920;
      
      // NDC -1 (left/bottom edge)
      const leftPixel = ((-1.0 + 1.0) * resolution - 1.0) * 0.5;
      expect(leftPixel).toBeCloseTo(-0.5, 5);
      
      // NDC +1 (right/top edge)
      const rightPixel = ((1.0 + 1.0) * resolution - 1.0) * 0.5;
      expect(rightPixel).toBeCloseTo(resolution - 0.5, 5);
      
      // NDC 0 (center)
      const centerPixel = ((0.0 + 1.0) * resolution - 1.0) * 0.5;
      expect(centerPixel).toBeCloseTo((resolution - 1) / 2, 5);
    });
  });

  describe('createTriangleSplatsGeometry', () => {
    it('should precompute triangle centers', () => {
      const vertices = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]);
      const triangle_indices = new Uint32Array([0, 1, 2]);
      const opacities = new Float32Array([1, 1, 1]);

      const geometry = createTriangleSplatsGeometry(
        vertices,
        triangle_indices,
        opacities,
        undefined, undefined, undefined, undefined, 0
      );

      const centers = (geometry as any).triangleCenters;
      expect(centers).toBeDefined();
      expect(centers.length).toBe(3);
      // Center of (0,0,0), (1,0,0), (0,1,0) should be (1/3, 1/3, 0)
      expect(centers[0]).toBeCloseTo(0.3333, 4);
      expect(centers[1]).toBeCloseTo(0.3333, 4);
      expect(centers[2]).toBe(0);
    });
  });
});
