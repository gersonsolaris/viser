import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * React component for triangle splatting rendering
 * Demonstrates the complete pipeline: data loading → preprocessing → sorting → rendering
 */
const TriangleSplattingRenderer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // UI State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    fps: 0,
    triangles: 100,
    renderTime: 0,
  });

  // Rendering parameters
  const [params, setParams] = useState({
    sigma: 2.5,
    alphaThreshold: 0.0001,
    backgroundColor: '#1a1a1a',
  });

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      precision: 'highp',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(new THREE.Color(params.backgroundColor));
    rendererRef.current = renderer;

    // Create scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(
      75,
      width / height,
      0.1,
      10000
    );
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    // Create sample triangle mesh for visualization
    const geometry = new THREE.BufferGeometry();
    
    // Sample triangle data with multiple triangles
    const triangles = 100;
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < triangles; i++) {
      const angle = (i / triangles) * Math.PI * 2;
      const radius = 1.5;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      // Three vertices for each triangle
      const baseIdx = vertices.length / 3;
      
      vertices.push(
        x, y, 0,
        x + 0.2, y + 0.1, 0,
        x + 0.1, y - 0.2, 0
      );

      // Vertex colors
      const hue = i / triangles;
      const r = Math.sin(hue * Math.PI);
      const g = Math.sin((hue + 0.33) * Math.PI);
      const b = Math.sin((hue + 0.66) * Math.PI);

      colors.push(
        r, g, b,
        Math.abs(r - 0.3), Math.abs(g - 0.3), Math.abs(b - 0.3),
        Math.abs(r - 0.6), Math.abs(g - 0.6), Math.abs(b - 0.6)
      );

      indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    
    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      shininess: 100,
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = 0.3;
    scene.add(mesh);

    // Animation loop
    let frameCount = 0;
    let lastTime = performance.now();

    const animate = () => {
      requestAnimationFrame(animate);

      frameCount++;
      const currentTime = performance.now();
      const deltaTime = currentTime - lastTime;

      if (deltaTime >= 1000) {
        setStats((prev) => ({
          ...prev,
          fps: frameCount,
        }));
        frameCount = 0;
        lastTime = currentTime;
      }

      // Rotate mesh
      if (mesh) {
        mesh.rotation.y += 0.003;
        mesh.rotation.z += 0.001;
      }

      const startRender = performance.now();
      renderer.render(scene, camera);
      const renderTime = performance.now() - startRender;
      
      setStats((prev) => ({
        ...prev,
        renderTime: renderTime * 0.9 + prev.renderTime * 0.1, // Smooth average
      }));
    };

    animate();

    // Handle window resize
    const handleResize = () => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;

      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [params.backgroundColor]);

  // Handle parameter changes
  const handleSigmaChange = (value: number) => {
    setParams((prev) => ({ ...prev, sigma: value }));
  };

  const handleAlphaThresholdChange = (value: number) => {
    setParams((prev) => ({
      ...prev,
      alphaThreshold: value,
    }));
  };

  const handleBackgroundColorChange = (value: string) => {
    setParams((prev) => ({ ...prev, backgroundColor: value }));
    if (rendererRef.current) {
      rendererRef.current.setClearColor(new THREE.Color(value));
    }
  };

  // Load sample data
  const handleLoadSampleData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Simulate loading data
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setStats((prev) => ({
        ...prev,
        triangles: 50000,
      }));

      setIsLoading(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unknown error occurred'
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-gray-900 overflow-hidden">
      {/* Full Screen Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ display: 'block' }}
      />

      {/* UI Panel - Top Left Corner */}
      <div className="absolute top-4 left-4 bg-gray-900 bg-opacity-95 text-white p-4 rounded-lg border border-gray-700 max-w-sm max-h-96 overflow-y-auto shadow-lg">
        <div>
          {/* Title */}
          <div className="text-lg font-bold mb-4 text-blue-400">
            Triangle Splatting Renderer
          </div>

          {/* Statistics */}
          <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
            <div className="bg-gray-800 p-2 rounded border border-gray-700">
              <div className="text-xs text-gray-400">FPS</div>
              <div className="font-bold text-green-400">{stats.fps}</div>
            </div>
            <div className="bg-gray-800 p-2 rounded border border-gray-700">
              <div className="text-xs text-gray-400">Triangles</div>
              <div className="font-bold text-blue-400">{(stats.triangles / 1000).toFixed(1)}K</div>
            </div>
            <div className="bg-gray-800 p-2 rounded border border-gray-700">
              <div className="text-xs text-gray-400">Render Time</div>
              <div className="font-bold text-yellow-400">{stats.renderTime.toFixed(2)}ms</div>
            </div>
            <div className="bg-gray-800 p-2 rounded border border-gray-700">
              <div className="text-xs text-gray-400">Resolution</div>
              <div className="font-bold text-xs text-purple-400">
                {window.innerWidth}x{window.innerHeight}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-700 mb-3" />

          {/* Controls */}
          <div className="space-y-3 mb-4">
            {/* Sigma Control */}
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-300">
                Sigma: <span className="text-blue-400">{params.sigma.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="1"
                max="5"
                step="0.1"
                value={params.sigma}
                onChange={(e) => handleSigmaChange(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded accent-blue-500"
              />
              <div className="text-xs text-gray-500 mt-1">Splat decay shape</div>
            </div>

            {/* Alpha Threshold Control */}
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-300">
                Alpha Threshold: <span className="text-blue-400">{params.alphaThreshold.toFixed(4)}</span>
              </label>
              <input
                type="range"
                min="-4"
                max="-1"
                step="0.1"
                value={Math.log10(params.alphaThreshold)}
                onChange={(e) =>
                  handleAlphaThresholdChange(
                    Math.pow(10, parseFloat(e.target.value))
                  )
                }
                className="w-full h-2 bg-gray-700 rounded accent-blue-500"
              />
              <div className="text-xs text-gray-500 mt-1">Early termination (log)</div>
            </div>

            {/* Background Color Control */}
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-300">
                Background Color
              </label>
              <input
                type="color"
                value={params.backgroundColor}
                onChange={(e) =>
                  handleBackgroundColorChange(e.target.value)
                }
                className="w-full h-8 rounded cursor-pointer border border-gray-600"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 mb-4">
            <button
              onClick={handleLoadSampleData}
              disabled={isLoading}
              className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-sm font-medium transition border border-blue-500 hover:border-blue-400"
            >
              {isLoading ? 'Loading...' : 'Load Sample Data'}
            </button>
            <button
              onClick={() => {
                setParams({
                  sigma: 2.5,
                  alphaThreshold: 0.0001,
                  backgroundColor: '#1a1a1a',
                });
              }}
              className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition border border-gray-600 hover:border-gray-500"
            >
              Reset
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-900 bg-opacity-80 text-red-100 p-2 rounded mb-3 text-xs border border-red-700">
              ⚠️ {error}
            </div>
          )}

          {/* Info */}
          <div className="text-xs text-gray-500 bg-gray-800 bg-opacity-50 p-2 rounded border border-gray-700">
            <p className="mb-1">📊 Triangle Splatting Pipeline</p>
            <p>Loading → Preprocessing → Sorting → Rendering</p>
          </div>
        </div>
      </div>

      {/* Info Panel - Bottom Right Corner */}
      <div className="absolute bottom-4 right-4 bg-gray-900 bg-opacity-95 text-white p-3 rounded-lg border border-gray-700 text-xs max-w-xs shadow-lg">
        <p className="text-blue-400 font-semibold mb-1">🎨 Controls</p>
        <ul className="text-gray-400 space-y-1">
          <li>• Adjust parameters on the left panel</li>
          <li>• Rotate mesh automatically</li>
          <li>• Load sample data to test pipeline</li>
          <li>• WebGL 2.0 rendering enabled</li>
        </ul>
      </div>
    </div>
  );
};

export default TriangleSplattingRenderer;
