/*
 * 明辨康途 · 3D 躯干查看器（three.js）
 * 由 index.html 懒加载：只在用户点「3D 视图」时才会下载本模块与模型。
 *
 * 轻量增强：
 *   1. 器官标签（HTML 覆盖层，随模型旋转跟随，指针穿透，可点击）
 *   2. 选中互斥：材质逐个克隆，避免共享材质导致的高亮串色/闪烁
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
  const labelMap = options.labels || {};

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

  /* 标签层：绝对定位覆盖在 canvas 上，默认不拦截指针 */
  const labelLayer = document.createElement('div');
  labelLayer.className = 'body3d-labels';
  canvas.parentElement.appendChild(labelLayer);

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
      return;
    }
    /* 每个器官克隆独立材质，避免多个器官共享材质导致高亮互相影响 */
    obj.material = Array.isArray(obj.material)
      ? obj.material.map(m => m.clone())
      : obj.material.clone();
    obj.userData.part = obj.name;
    obj.userData.baseEmissive = 0x000000;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'organ-label';
    el.textContent = labelMap[obj.name] || obj.name;
    el.setAttribute('aria-label', '选择' + el.textContent);
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      if (typeof onPick === 'function') onPick(obj.name);
    });
    labelLayer.appendChild(el);
    obj.userData.labelEl = el;

    organs.push(obj);
  });

  scene.add(root);
  root.updateMatrixWorld(true);

  /* 预先算好每个器官的世界坐标中心，用于标签投影 */
  const tmpBox = new THREE.Box3();
  organs.forEach(o => {
    /* 防御：外部模型的 accessor 包围盒可能不准，这里按顶点重算一次 */
    if (o.geometry) {
      o.geometry.computeBoundingBox();
      o.geometry.computeBoundingSphere();
    }
    tmpBox.setFromObject(o);
    o.userData.center = tmpBox.getCenter(new THREE.Vector3());
  });

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

  const labelVec = new THREE.Vector3();
  /* 每个器官标签在屏幕上的微调，避免挤在一起 */
  const LABEL_OFFSET = {
    heart: [-26, -4], lung: [26, -16], stomach: [-28, 6],
    liver: [30, 2], kidney: [30, 22], intestine: [0, 30]
  };
  let raf = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);

    /* 标签跟随：把器官中心投影到屏幕坐标 */
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 420;
    organs.forEach(o => {
      const el = o.userData.labelEl;
      if (!el || !o.userData.center) return;
      labelVec.copy(o.userData.center).project(camera);
      const visible = labelVec.z < 1 && Math.abs(labelVec.x) < 1.15 && Math.abs(labelVec.y) < 1.15;
      if (!visible) { el.style.display = 'none'; return; }
      el.style.display = '';
      const off = LABEL_OFFSET[o.name] || [0, 0];
      const x = (labelVec.x * 0.5 + 0.5) * w + off[0];
      const y = (-labelVec.y * 0.5 + 0.5) * h + off[1];
      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
    });
  }
  loop();

  function setSelection(ids) {
    const active = ids || new Set();
    organs.forEach(o => {
      const on = active.has(o.name);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        if (!m.emissive) return;
        m.emissive.setHex(on ? 0x1fa89d : 0x000000);
        m.emissiveIntensity = on ? 0.6 : 0;
      });
      if (o.userData.labelEl) o.userData.labelEl.classList.toggle('on', on);
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
    if (labelLayer && labelLayer.parentElement) labelLayer.parentElement.removeChild(labelLayer);
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
