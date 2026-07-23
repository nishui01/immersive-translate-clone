import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Copy PDF.js worker
const pdfSrc = resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
const destDir = resolve(root, 'public')
const pdfDest = resolve(destDir, 'pdf.worker.min.mjs')

if (!existsSync(pdfSrc)) {
  console.error('[copy-worker] PDF.js source not found:', pdfSrc)
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
copyFileSync(pdfSrc, pdfDest)
console.log('[copy-worker] Copied pdf.worker.min.mjs to public/')

// Copy Tesseract.js worker (for OCR of image-based PDFs)
const tessSrc = resolve(root, 'node_modules/tesseract.js/dist/worker.min.js')
const tessDest = resolve(destDir, 'tesseract-worker.min.js')

if (existsSync(tessSrc)) {
  copyFileSync(tessSrc, tessDest)
  console.log('[copy-worker] Copied tesseract-worker.min.js to public/')
} else {
  console.warn('[copy-worker] Tesseract worker not found at:', tessSrc)
  console.warn('[copy-worker] OCR will fall back to CDN loading.')
}
