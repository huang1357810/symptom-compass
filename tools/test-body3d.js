/*
 * 3D 躯干自测：node tools/test-body3d.js
 * 校验 GLB 结构、器官网格命名、vendor 模块与页面的懒加载/降级接线
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const errors = [];

/* ---------- 1. GLB ---------- */
const glbPath = path.join(ROOT, 'site', 'models', 'body.glb');
if (!fs.existsSync(glbPath)) {
  errors.push('缺少 site/models/body.glb（先跑 node tools/build-body-glb.js）');
} else {
  const buf = fs.readFileSync(glbPath);
  if (buf.length < 20) {
    errors.push('GLB 文件过小');
  } else {
    if (buf.readUInt32LE(0) !== 0x46546c67) errors.push('GLB magic 不是 glTF');
    if (buf.readUInt32LE(4) !== 2) errors.push('GLB 版本不是 2');
    if (buf.readUInt32LE(8) !== buf.length) errors.push('GLB 头部长度与实际文件不一致');

    const jsonLen = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== 0x4e4f534a) errors.push('缺少 JSON chunk');
    const jsonText = buf.subarray(20, 20 + jsonLen).toString('utf8');
    let json = null;
    try {
      json = JSON.parse(jsonText);
    } catch (e) {
      errors.push('GLB JSON 解析失败：' + e.message);
    }

    if (json) {
      const binStart = 20 + jsonLen;
      if (binStart + 8 > buf.length) {
        errors.push('缺少 BIN chunk');
      } else {
        const binLen = buf.readUInt32LE(binStart);
        if (buf.readUInt32LE(binStart + 4) !== 0x004e4942) errors.push('BIN chunk 类型错误');
        const declared = json.buffers && json.buffers[0] ? json.buffers[0].byteLength : -1;
        const padded = binLen;
        if (declared !== padded && declared !== padded - 3 && declared !== padded - 2 && declared !== padded - 1) {
          errors.push('buffer.byteLength 与 BIN chunk 不一致：' + declared + ' vs ' + padded);
        }
      }

      const needMeshes = ['body', 'heart', 'lung', 'stomach', 'liver', 'kidney', 'intestine'];
      const names = (json.meshes || []).map(m => m.name);
      needMeshes.forEach(n => {
        if (names.indexOf(n) === -1) errors.push('GLB 缺少网格 ' + n);
      });

      (json.meshes || []).forEach(m => {
        const prim = (m.primitives || [])[0];
        if (!prim) { errors.push(m.name + ' 没有 primitive'); return; }
        ['POSITION', 'NORMAL'].forEach(attr => {
          if (prim.attributes[attr] === undefined) errors.push(m.name + ' 缺少 ' + attr);
        });
        if (prim.indices === undefined) errors.push(m.name + ' 缺少索引');
        if (prim.material === undefined) errors.push(m.name + ' 缺少材质');
      });

      const accessorCount = (json.accessors || []).length;
      if (accessorCount < (json.meshes || []).length * 3) errors.push('accessor 数量不足');
    }
  }
}

/* ---------- 2. vendor 模块 ---------- */
const vendorDir = path.join(ROOT, 'site', 'vendor');
const needVendor = [
  'body3d.js', 'three.module.js', 'three.core.js',
  'GLTFLoader.js', 'BufferGeometryUtils.js', 'SkeletonUtils.js', 'OrbitControls.js'
];
needVendor.forEach(f => {
  const p = path.join(vendorDir, f);
  if (!fs.existsSync(p)) errors.push('缺少 vendor/' + f);
  else if (fs.statSync(p).size < 200) errors.push('vendor/' + f + ' 内容异常（过小）');
});

/* three.module.js 必须指向同目录的 three.core.js */
const threePath = path.join(vendorDir, 'three.module.js');
if (fs.existsSync(threePath)) {
  const code = fs.readFileSync(threePath, 'utf8');
  if (code.indexOf("'./three.core.js'") === -1) errors.push('three.module.js 未指向同目录 three.core.js');
  if (code.indexOf("from 'three'") !== -1) errors.push('three.module.js 残留裸导入 three');
}

/* GLTFLoader 的相对依赖必须已改正 */
const gltfPath = path.join(vendorDir, 'GLTFLoader.js');
if (fs.existsSync(gltfPath)) {
  const code = fs.readFileSync(gltfPath, 'utf8');
  if (code.indexOf("from './three.module.js'") === -1) errors.push('GLTFLoader 未改为相对导入 three.module.js');
  if (code.indexOf("'../utils/") !== -1) errors.push('GLTFLoader 仍有 ../utils 相对路径');
}

/* ---------- 3. 页面接线 ---------- */
const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const checks = [
  ['./vendor/body3d.js', '缺少动态 import 3D 模块'],
  ['./models/body.glb', '缺少模型路径'],
  ['body3dBtn', '缺少 3D 视图按钮'],
  ['canWebGL', '缺少 WebGL 能力检测'],
  ['2.5D', '缺少降级提示文案'],
  ['body3dCanvas', '缺少 3D 画布']
];
checks.forEach(([needle, msg]) => {
  if (html.indexOf(needle) === -1) errors.push(msg + '（' + needle + '）');
});

/* ---------- 4. Service Worker 缓存 ---------- */
const sw = fs.readFileSync(path.join(ROOT, 'site', 'sw.js'), 'utf8');
['./vendor/three.module.js', './vendor/body3d.js', './models/body.glb'].forEach(f => {
  if (sw.indexOf(f) === -1) errors.push('sw.js 未缓存 ' + f);
});

if (errors.length) {
  console.error('3D 视图校验失败：\n  ' + errors.join('\n  '));
} else {
  const size = fs.existsSync(glbPath) ? (fs.statSync(glbPath).size / 1024).toFixed(0) + ' KB' : '?';
  let vendorSize = 0;
  needVendor.forEach(f => { vendorSize += fs.statSync(path.join(vendorDir, f)).size; });
  console.log('GLB ' + size + '，vendor ' + (vendorSize / 1048576).toFixed(2) + ' MB，校验通过');
}
process.exit(errors.length ? 1 : 0);