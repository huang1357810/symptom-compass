/*
 * 明辨康途 · 3D 躯干查看器（three.js）
 * 由 index.html 懒加载：只在用户点「3D 视图」时才会下载本模块与模型。
 */
import * as THREE from './three.module.js';
import { GLTFLoader } from './GLTFLoader.js';
import { OrbitControls } from './OrbitControls.js';

export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

export async function createBodyViewer(options) {
  const canvas = options.canvas;
  const url = options.url;
  const onPick = options.onPick;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  camera.position.set(0.9, 1.3, 2.1);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb8b4, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(2, 3, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45);
  fill.position.set(-2, 1.4, -1.6);
  scene.add(fill);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.98, 0);
  controls.minDistance = 1.1;
  controls.maxDistance = 4.2;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI - 0.35;

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;

  const organs = [];
  root.traverse(obj => {
    if (!obj.isMesh) return;
    if (obj.name === 'body') {
      const mat = obj.material;
      mat.transparent = true;
      mat.opacity = 0.3;
      mat.depthWrite = false;
      mat.side = THREE.DoubleSide;
      mat.roughness = 0.9;
      obj.renderOrder = 2;
    } else {
      obj.userData.part = obj.name;
      organs.push(obj);
    }
  });
  scene.add(root);

  function resize() {
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 420;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0;
  let downY = 0;

  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(organs, false);
    if (hits.length && typeof onPick === 'function') onPick(hits[0].object.name);
  }

  function onDown(ev) {
    downX = ev.clientX;
    downY = ev.clientY;
  }
  function onUp(ev) {
    /* 拖动旋转时不触发选中 */
    if (Math.abs(ev.clientX - downX) < 6 && Math.abs(ev.clientY - downY) < 6) pick(ev);
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  function setSelection(ids) {
    const active = ids || new Set();
    organs.forEach(o => {
      const on = active.has(o.name);
      o.material.emissive.setHex(on ? 0x1fa89d : 0x000000);
      o.material.emissiveIntensity = on ? 0.6 : 0;
    });
  }

  function setBodyOpacity(value) {
    root.traverse(obj => {
      if (obj.isMesh && obj.name === 'body') obj.material.opacity = value;
    });
  }

  function dispose() {
    cancelAnimationFrame(raf);
    if (observer) observer.disconnect();
    else window.removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    controls.dispose();
    root.traverse(obj => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    renderer.dispose();
  }

  return { setSelection, setBodyOpacity, dispose, resize };
}