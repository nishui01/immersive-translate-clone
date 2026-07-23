// Copy the PDF.js worker file into the public/ directory so Vite serves it
// alongside the extension bundle. The worker is then referenced via
// chrome.runtime.getURL('pdf.worker.min.mjs') at runtime.
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const src = resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
const destDir = resolve(root, 'public')
const dest = resolve(destDir, 'pdf.worker.min.mjs')

if (!existsSync(src)) {
  console.error('[copy-worker] Source not found:', src)
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
copyFileSync(src, dest)
console.log('[copy-worker] Copied pdf.worker.min.mjs to public/')
