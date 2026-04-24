// File: visuals/test-file.three.js
// title: Rotating Cube — quick test
(function () {
if (!window.THREE) { console.error('THREE not loaded'); return; }

// Scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 3);

// Renderer (transparent)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(3, 5, 2);
scene.add(dir);

// Cube
const geom = new THREE.BoxGeometry(1, 1, 1);
const mat = new THREE.MeshStandardMaterial({ color: 0x44aa88, roughness: 0.4, metalness: 0.1 });
const cube = new THREE.Mesh(geom, mat);
scene.add(cube);

// Resize
function onResize() {
const w = window.innerWidth, h = window.innerHeight;
camera.aspect = w / h;
camera.updateProjectionMatrix();
renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);

// Animate (react to CB_AUDIO {rms, peak, bands})
let hue = 0.5;
let last = performance.now();
function animate() {
const now = performance.now();
const dt = (now - last) / 1000;
last = now;

  const audio = window.CB_AUDIO || { rms: 0, peak: 0, bands: [] };
const rms = Math.max(0, Math.min(1, Number(audio.rms) || 0));
const peak = Math.max(0, Math.min(1, Number(audio.peak) || 0));

const speed = 0.6 + rms * 2.0;
cube.rotation.x += dt * (0.5 * speed);
cube.rotation.y += dt * (0.8 * speed);

const s = 1 + rms * 0.8;
cube.scale.set(s, s, s);

hue = (hue + dt * 0.05 + peak * 0.1) % 1;
if (mat.color && mat.color.setHSL) mat.color.setHSL(hue, 0.6, 0.5);

renderer.render(scene, camera);
requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Optional: quick debug line every ~2s
let t = 0;
function debugLog(ts) {
t += ts;
if (t > 2000) {
t = 0;
const a = window.CB_AUDIO || {};
try { console.log('CB_AUDIO rms:', (a.rms || 0).toFixed(3), 'peak:', (a.peak || 0).toFixed(3)); } catch (_) {}
}
requestAnimationFrame(debugLog);
}
requestAnimationFrame(debugLog);
})();
