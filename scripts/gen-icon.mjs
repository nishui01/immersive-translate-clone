// Generates a simple 128x128 PNG icon using only Node built-ins (zlib).
// Run: node scripts/gen-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIZE = 128

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function hexToRGB(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

function lerp(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t))
}

function makePng(size) {
  const top = hexToRGB('#4F46E5')
  const bot = hexToRGB('#7C3AED')
  const white = [255, 255, 255]
  const radius = Math.round(size * 0.22)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter byte
    for (let x = 0; x < size; x++) {
      // rounded corners mask
      const cx = Math.min(x, size - 1 - x)
      const cy = Math.min(y, size - 1 - y)
      const inCorner = cx < radius && cy < radius
      const dist = Math.sqrt((radius - cx) ** 2 + (radius - cy) ** 2)
      const inside = !inCorner || dist <= radius
      let rgb = lerp(top, bot, y / size)
      // white "T" mark: horizontal bar + vertical stem
      const tTop = Math.round(size * 0.30)
      const tBarH = Math.round(size * 0.12)
      const tStemW = Math.round(size * 0.12)
      const tStemTop = tTop + tBarH
      const tStemBottom = Math.round(size * 0.72)
      const cxMid = size / 2
      const inBar = y >= tTop && y < tTop + tBarH && x >= Math.round(size * 0.28) && x < Math.round(size * 0.72)
      const inStem = x >= cxMid - tStemW / 2 && x < cxMid + tStemW / 2 && y >= tStemTop && y < tStemBottom
      if (inBar || inStem) rgb = white
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = inside ? rgb[0] : 0
      raw[o + 1] = inside ? rgb[1] : 0
      raw[o + 2] = inside ? rgb[2] : 0
      raw[o + 3] = inside ? 255 : 0
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const idat = deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const outDir = join(__dirname, '..', 'src', 'assets')
mkdirSync(outDir, { recursive: true })
for (const size of [16, 48, 128]) {
  writeFileSync(join(outDir, `icon${size}.png`), makePng(size))
}
// keep a generic icon.png too (used by web_accessible_resources references)
writeFileSync(join(outDir, 'icon.png'), makePng(128))
console.log('Icons generated at src/assets/')
