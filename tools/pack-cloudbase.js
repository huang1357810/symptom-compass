/*
 * 打包 site/ 为 dist-cloudbase.zip（腾讯云 CloudBase 静态托管上传用）
 * 用法：node tools/pack-cloudbase.js
 *
 * 零依赖：内置 zlib.deflateRaw + 手写 ZIP 结构。
 * zip 内文件位于根目录（index.html 在第一层），可直接拖到静态托管。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'dist-cloudbase.zip');

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff;
}

function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
}

function walk(dir, base) {
  const out = [];
  for (const ent of fs.readdirSync(dir)) {
    if (ent === '.DS_Store' || ent === 'Thumbs.db') continue;
    const full = path.join(dir, ent);
    const rel = base ? base + '/' + ent : ent;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full, rel));
    } else if (st.isFile()) {
      out.push({ full, rel });
    }
  }
  return out;
}

function buildZip(entries) {
  const now = new Date();
  const time = dosTime(now);
  const date = dosDate(now);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const item of entries) {
    const data = fs.readFileSync(item.full);
    const nameBuf = Buffer.from(item.rel, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);              // UTF-8 文件名
    local.writeUInt16LE(8, 8);                   // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const localBuf = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

function main() {
  if (!fs.existsSync(SITE)) {
    console.error('找不到 site/ 目录');
    process.exit(1);
  }

  const files = walk(SITE, '');
  if (!files.length) {
    console.error('site/ 下没有文件');
    process.exit(1);
  }

  const zip = buildZip(files);
  fs.writeFileSync(OUT, zip);

  /* 自检：读回中央目录数量 */
  const readBack = fs.readFileSync(OUT);
  const eocdPos = readBack.length - 22;
  const entries = readBack.readUInt16LE(eocdPos + 10);
  if (entries !== files.length) {
    console.error('ZIP 自检失败：条目数 ' + entries + ' != ' + files.length);
    process.exit(1);
  }

  const raw = files.reduce((sum, f) => sum + fs.statSync(f.full).size, 0);
  console.log('已生成 ' + OUT);
  console.log('文件 ' + files.length + ' 个 ｜ 原始 ' + (raw / 1024).toFixed(1) + ' KB ｜ 压缩后 ' + (zip.length / 1024).toFixed(1) + ' KB');
  console.log('示例：' + files.slice(0, 5).map(f => f.rel).join(', '));
}

main();