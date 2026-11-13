/*
 * 生成低模躯干 GLB：node tools/build-body-glb.js
 * 纯几何拼装（椭球 + 环放样），器官各自成独立命名网格，供 three.js 拾取。
 * 输出：site/models/body.glb
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'site', 'models', 'body.glb');

/* ---------- 几何构建 ---------- */
function ellipsoid(sx, sy, sz, cx, cy, cz, segU, segV) {
  const pos = [];
  const idx = [];
  for (let v = 0; v <= segV; v++) {
    const theta = (v / segV) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let u = 0; u <= segU; u++) {
      const phi = (u / segU) * Math.PI * 2;
      pos.push(cx + sx * st * Math.cos(phi), cy + sy * ct, cz + sz * st * Math.sin(phi));
    }
  }
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = v * (segU + 1) + u;
      const b = a + segU + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { pos, idx };
}

/* 沿 y 轴放样：rings = [{y, rx, rz, cx, cz}] */
function loft(rings, segU) {
  const pos = [];
  const idx = [];
  rings.forEach(r => {
    const cx = r.cx || 0;
    const cz = r.cz || 0;
    for (let u = 0; u < segU; u++) {
      const phi = (u / segU) * Math.PI * 2;
      pos.push(cx + r.rx * Math.cos(phi), r.y, cz + r.rz * Math.sin(phi));
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    const base = i * segU;
    const next = base + segU;
    for (let u = 0; u < segU; u++) {
      const u2 = (u + 1) % segU;
      idx.push(base + u, next + u, base + u2, next + u, next + u2, base + u2);
    }
  }
  return { pos, idx };
}

function merge(parts) {
  const pos = [];
  const idx = [];
  let offset = 0;
  parts.forEach(p => {
    p.pos.forEach(v => pos.push(v));
    p.idx.forEach(i => idx.push(i + offset));
    offset += p.pos.length / 3;
  });
  return { pos, idx };
}

/* ---------- 身体（头 + 颈 + 躯干 + 四肢） ---------- */
const body = merge([
  ellipsoid(0.105, 0.135, 0.105, 0, 1.58, 0, 18, 12),
  loft([{ y: 1.44, rx: 0.055, rz: 0.055 }, { y: 1.36, rx: 0.062, rz: 0.062 }], 14),
  loft([
    { y: 1.36, rx: 0.20, rz: 0.105 },
    { y: 1.26, rx: 0.185, rz: 0.115 },
    { y: 1.12, rx: 0.155, rz: 0.105 },
    { y: 1.00, rx: 0.135, rz: 0.095 },
    { y: 0.90, rx: 0.165, rz: 0.105 },
    { y: 0.84, rx: 0.15, rz: 0.095 }
  ], 20),
  /* 左臂 / 右臂 */
  loft([{ y: 1.33, rx: 0.055, rz: 0.055, cx: -0.235 }, { y: 1.12, rx: 0.045, rz: 0.045, cx: -0.27 }, { y: 0.92, rx: 0.038, rz: 0.038, cx: -0.285 }], 12),
  loft([{ y: 1.33, rx: 0.055, rz: 0.055, cx: 0.235 }, { y: 1.12, rx: 0.045, rz: 0.045, cx: 0.27 }, { y: 0.92, rx: 0.038, rz: 0.038, cx: 0.285 }], 12),
  /* 左腿 / 右腿 */
  loft([{ y: 0.86, rx: 0.085, rz: 0.085, cx: -0.09 }, { y: 0.46, rx: 0.062, rz: 0.062, cx: -0.095 }, { y: 0.06, rx: 0.05, rz: 0.05, cx: -0.1 }], 12),
  loft([{ y: 0.86, rx: 0.085, rz: 0.085, cx: 0.09 }, { y: 0.46, rx: 0.062, rz: 0.062, cx: 0.095 }, { y: 0.06, rx: 0.05, rz: 0.05, cx: 0.1 }], 12)
]);

/* ---------- 器官 ---------- */
const organs = [
  ['heart', ellipsoid(0.055, 0.065, 0.05, 0.02, 1.20, 0.02, 14, 10), '#e26d63'],
  ['lung', merge([
    ellipsoid(0.07, 0.125, 0.055, -0.105, 1.21, 0, 14, 10),
    ellipsoid(0.07, 0.125, 0.055, 0.105, 1.21, 0, 14, 10)
  ]), '#e5a3b4'],
  ['stomach', ellipsoid(0.07, 0.055, 0.05, -0.055, 1.05, 0.02, 14, 10), '#f0b98a'],
  ['liver', ellipsoid(0.105, 0.055, 0.055, 0.075, 1.06, 0.01, 14, 10), '#b9785a'],
  ['kidney', merge([
    ellipsoid(0.03, 0.055, 0.03, -0.095, 1.02, -0.03, 12, 8),
    ellipsoid(0.03, 0.055, 0.03, 0.095, 1.02, -0.03, 12, 8)
  ]), '#b58bd0'],
  ['intestine', ellipsoid(0.115, 0.06, 0.055, 0, 0.965, 0.02, 16, 10), '#e8b06a']
];

/* ---------- 写入 glTF 二进制 ---------- */
const meshes = [{ name: 'body', geo: body, color: [0.82, 0.88, 0.87, 0.3], alpha: true, organ: false }]
  .concat(organs.map(([name, geo, color]) => ({
    name, geo, color: hexToRgb(color), alpha: false, organ: true
  })));

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, 1];
}

function normalsFor(pos) {
  const out = [];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    out.push(x / len, y / len, z / len);
  }
  return out;
}

const accessors = [];
const bufferViews = [];
const gltfMeshes = [];
const materials = [];
const nodes = [];
let byteOffset = 0;
const chunks = [];

function pushBuffer(arr, target) {
  const f32 = new Float32Array(arr);
  const buf = Buffer.from(f32.buffer);
  chunks.push(buf);
  const view = { buffer: 0, byteOffset, byteLength: buf.length };
  if (target) view.target = target;
  bufferViews.push(view);
  byteOffset += buf.length;
  return bufferViews.length - 1;
}

function pushIndices(arr) {
  const u16 = new Uint16Array(arr);
  const buf = Buffer.from(u16.buffer);
  chunks.push(buf);
  const view = { buffer: 0, byteOffset, byteLength: buf.length };
  bufferViews.push(view);
  byteOffset += buf.length;
  return bufferViews.length - 1;
}

meshes.forEach((mesh, mi) => {
  const nrm = normalsFor(mesh.geo.pos);
  const posView = pushBuffer(mesh.geo.pos, 34962);
  const nrmView = pushBuffer(nrm, 34962);
  const idxView = pushIndices(mesh.geo.idx);

  accessors.push({ bufferView: posView, componentType: 5126, count: mesh.geo.pos.length / 3, type: 'VEC3', min: [-0.4, 0, -0.3], max: [0.4, 1.75, 0.3] });
  accessors.push({ bufferView: nrmView, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
  accessors.push({ bufferView: idxView, componentType: 5123, count: mesh.geo.idx.length, type: 'SCALAR' });

  materials.push({
    name: mesh.name + '-mat',
    pbrMetallicRoughness: {
      baseColorFactor: mesh.color,
      metallicFactor: 0,
      roughnessFactor: 0.85
    },
    alphaMode: mesh.alpha ? 'BLEND' : 'OPAQUE',
    doubleSided: mesh.alpha
  });

  gltfMeshes.push({
    name: mesh.name,
    primitives: [{
      attributes: { POSITION: mi * 3, NORMAL: mi * 3 + 1 },
      indices: mi * 3 + 2,
      material: mi
    }]
  });

  nodes.push({ name: mesh.name, mesh: mi });
});

const bin = Buffer.concat(chunks);
const json = {
  asset: { version: '2.0', generator: 'mingbian-kangtu-body-builder' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes: gltfMeshes,
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: bin.length }]
};

let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

const binPad = (4 - (bin.length % 4)) % 4;
const binBuf = binPad ? Buffer.concat([bin, Buffer.alloc(binPad, 0)]) : bin;

const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0);      // glTF
out.writeUInt32LE(2, 4);               // version
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBuf.length, 12);
out.writeUInt32LE(0x4e4f534a, 16);     // JSON
jsonBuf.copy(out, 20);
const binStart = 20 + jsonBuf.length;
out.writeUInt32LE(binBuf.length, binStart);
out.writeUInt32LE(0x004e4942, binStart + 4); // BIN
binBuf.copy(out, binStart + 8);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log('已生成', OUT, (out.length / 1024).toFixed(0) + ' KB');
console.log('网格：', meshes.map(m => m.name).join(', '));