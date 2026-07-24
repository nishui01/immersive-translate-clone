import * as pdfjsLib from 'pdfjs-dist'
import type { Settings, ServiceId } from '../types'
import { getSettings, saveSettings } from '../utils/storage'
import { translateBatch } from '../services'
import { DEFAULT_SETTINGS, LANGUAGES } from '../config'

// ── PDF.js worker ──────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs')

// ── Types ──────────────────────────────────────────────────────
interface PdfTextItem {
  str: string
  dir: string
  width: number
  height: number
  transform: number[]
  fontName: string
  hasEOL: boolean
}

/** A single line of text with its position in viewport pixels. */
interface TextLine {
  text: string
  left: number
  top: number
  width: number
  height: number
  fontSize: number
}

/** OCR word result from tesseract.js. */
interface OcrWord {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

type DisplayMode = 'original' | 'dual' | 'translation'

// ── State ──────────────────────────────────────────────────────
let settings: Settings = DEFAULT_SETTINGS
let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
let scale = 1.3
let displayMode: DisplayMode = 'dual'
let translateEnabled = true
let ocrEnabled = true
let currentFileUrl: string | null = null
let currentFileName = 'PDF'
const renderedPages = new Set<number>()
const translatingPages = new Set<number>()

// ── DOM helpers ────────────────────────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

// ── UI building ────────────────────────────────────────────────
function buildApp() {
  const app = document.getElementById('app')!
  app.innerHTML = ''

  // Toolbar
  const toolbar = el('div', 'toolbar')

  const left = el('div', 'tb-left')
  const openBtn = el('button', 'tb-btn', '📂 打开 PDF')
  openBtn.id = 'btn-open'
  left.appendChild(openBtn)
  const fileNameSpan = el('span', 'tb-filename', currentFileName)
  fileNameSpan.id = 'filename'
  left.appendChild(fileNameSpan)

  const center = el('div', 'tb-center')
  const prevBtn = el('button', 'tb-btn', '‹')
  prevBtn.id = 'btn-prev'
  const pageInput = el('input', 'tb-page-input') as HTMLInputElement
  pageInput.id = 'page-input'
  pageInput.type = 'number'
  pageInput.min = '1'
  pageInput.value = '1'
  const pageSep = el('span', 'tb-page-sep', '/ ')
  const totalPages = el('span', 'tb-total', '0')
  totalPages.id = 'total-pages'
  const nextBtn = el('button', 'tb-btn', '›')
  nextBtn.id = 'btn-next'
  center.append(prevBtn, pageInput, pageSep, totalPages, nextBtn)

  const right = el('div', 'tb-right')
  const zoomOut = el('button', 'tb-btn', '−')
  zoomOut.id = 'btn-zoom-out'
  const zoomLabel = el('span', 'tb-zoom', '130%')
  zoomLabel.id = 'zoom-label'
  const zoomIn = el('button', 'tb-btn', '+')
  zoomIn.id = 'btn-zoom-in'

  const langSelect = el('select', 'tb-select') as HTMLSelectElement
  langSelect.id = 'lang-select'
  LANGUAGES.filter((l) => l.code !== 'auto').forEach((l) => {
    const opt = el('option', undefined, l.label) as HTMLOptionElement
    opt.value = l.code
    langSelect.appendChild(opt)
  })
  langSelect.value = settings.targetLang

  const serviceSelect = el('select', 'tb-select') as HTMLSelectElement
  serviceSelect.id = 'service-select'
  const services: { id: ServiceId; label: string }[] = [
    { id: 'google', label: 'Google' },
    { id: 'microsoft', label: '微软' },
    { id: 'openai', label: 'AI' },
  ]
  services.forEach((s) => {
    const opt = el('option', undefined, s.label) as HTMLOptionElement
    opt.value = s.id
    serviceSelect.appendChild(opt)
  })
  serviceSelect.value = settings.service

  // Display mode toggle (three-state)
  const modeBtn = el('button', 'tb-btn tb-mode', '双语')
  modeBtn.id = 'btn-mode'
  modeBtn.title = '切换显示模式：原文 / 双语 / 仅译文'

  // OCR toggle
  const ocrBtn = el('button', 'tb-btn tb-ocr', '🔍 OCR 开')
  ocrBtn.id = 'btn-ocr'
  ocrBtn.title = '对图片型 PDF 启用 OCR 文字识别'

  right.append(zoomOut, zoomLabel, zoomIn, langSelect, serviceSelect, ocrBtn, modeBtn)
  toolbar.append(left, center, right)
  app.appendChild(toolbar)

  // Content area
  const content = el('div', 'content')
  content.id = 'content'
  app.appendChild(content)

  // Hidden file input
  const fileInput = el('input') as HTMLInputElement
  fileInput.type = 'file'
  fileInput.accept = '.pdf,application/pdf'
  fileInput.id = 'file-input'
  fileInput.style.display = 'none'
  app.appendChild(fileInput)

  bindEvents()
}

function bindEvents() {
  document.getElementById('btn-open')!.addEventListener('click', () => {
    document.getElementById('file-input')!.click()
  })

  document.getElementById('file-input')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    currentFileName = file.name
    await loadPdf(url)
  })

  document.getElementById('btn-prev')!.addEventListener('click', () => {
    goToPage(Math.max(1, parseInt((document.getElementById('page-input') as HTMLInputElement).value) - 1))
  })
  document.getElementById('btn-next')!.addEventListener('click', () => {
    const total = pdfDoc?.numPages ?? 1
    goToPage(Math.min(total, parseInt((document.getElementById('page-input') as HTMLInputElement).value) + 1))
  })
  document.getElementById('page-input')!.addEventListener('change', (e) => {
    goToPage(parseInt((e.target as HTMLInputElement).value))
  })

  document.getElementById('btn-zoom-in')!.addEventListener('click', () => {
    scale = Math.min(3, scale + 0.2)
    updateZoom()
  })
  document.getElementById('btn-zoom-out')!.addEventListener('click', () => {
    scale = Math.max(0.5, scale - 0.2)
    updateZoom()
  })

  document.getElementById('lang-select')!.addEventListener('change', async (e) => {
    settings.targetLang = (e.target as HTMLSelectElement).value
    await saveSettings({ targetLang: settings.targetLang })
    renderedPages.clear()
    translatingPages.clear()
    if (pdfDoc) renderAllPages()
  })
  document.getElementById('service-select')!.addEventListener('change', async (e) => {
    settings.service = (e.target as HTMLSelectElement).value as ServiceId
    await saveSettings({ service: settings.service })
    renderedPages.clear()
    translatingPages.clear()
    if (pdfDoc) renderAllPages()
  })

  // Three-state display mode toggle
  document.getElementById('btn-mode')!.addEventListener('click', () => {
    const modes: DisplayMode[] = ['dual', 'translation', 'original']
    const idx = modes.indexOf(displayMode)
    displayMode = modes[(idx + 1) % modes.length]
    const btn = document.getElementById('btn-mode')!
    const labels: Record<DisplayMode, string> = {
      dual: '双语',
      translation: '仅译文',
      original: '仅原文',
    }
    btn.textContent = labels[displayMode]
    applyDisplayMode()
  })

  // OCR toggle
  document.getElementById('btn-ocr')!.addEventListener('click', () => {
    ocrEnabled = !ocrEnabled
    const btn = document.getElementById('btn-ocr')!
    btn.textContent = ocrEnabled ? '🔍 OCR 开' : '🔍 OCR 关'
    btn.classList.toggle('off', !ocrEnabled)
    if (ocrEnabled) {
      // Re-process pages that had no text
      renderedPages.clear()
      translatingPages.clear()
      if (pdfDoc) renderAllPages()
    }
  })
}

function applyDisplayMode() {
  document.querySelectorAll('.page-wrapper').forEach((pw) => {
    const canvas = pw.querySelector('.page-canvas') as HTMLCanvasElement
    const overlay = pw.querySelector('.page-text-layer') as HTMLElement
    if (!canvas || !overlay) return

    if (displayMode === 'original') {
      // Only show the original PDF — hide all overlays, canvas full opacity
      canvas.style.opacity = '1'
      overlay.style.display = 'none'
    } else if (displayMode === 'dual') {
      // Dual mode: canvas stays fully visible (images/charts crisp), overlays
      // show BOTH original text and translation below it.
      canvas.style.opacity = '1'
      overlay.style.display = ''
      overlay.querySelectorAll('.text-item').forEach((item) => {
        const orig = item.querySelector('.text-orig') as HTMLElement
        const trans = item.querySelector('.text-trans') as HTMLElement
        if (orig) orig.style.display = ''
        // In dual mode, translation appears below the original, not on top
        if (trans) {
          trans.style.position = 'relative'
          trans.style.top = '100%'
        }
      })
    } else {
      // Translation only: dim the canvas (chart/layout still faintly visible
      // for context) and show only the translation
      canvas.style.opacity = '0.25'
      overlay.style.display = ''
      overlay.querySelectorAll('.text-item').forEach((item) => {
        const orig = item.querySelector('.text-orig') as HTMLElement
        if (orig) orig.style.display = 'none'
        const trans = item.querySelector('.text-trans') as HTMLElement
        if (trans) {
          trans.style.position = 'relative'
          trans.style.top = '0'
        }
      })
    }
  })
}

function updateZoom() {
  document.getElementById('zoom-label')!.textContent = `${Math.round(scale * 100)}%`
  renderedPages.clear()
  translatingPages.clear()
  if (pdfDoc) renderAllPages()
}

function goToPage(pageNum: number) {
  const total = pdfDoc?.numPages ?? 1
  pageNum = Math.max(1, Math.min(total, pageNum))
  ;(document.getElementById('page-input') as HTMLInputElement).value = String(pageNum)
  document.getElementById(`page-${pageNum}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ── PDF loading ────────────────────────────────────────────────
async function loadPdf(url: string) {
  currentFileUrl = url
  const content = document.getElementById('content')!
  content.innerHTML = ''
  renderedPages.clear()
  translatingPages.clear()

  const loading = el('div', 'loading', '正在加载 PDF…')
  content.appendChild(loading)

  try {
    const loadingTask = pdfjsLib.getDocument({
      url,
      disableRange: url.startsWith('blob:'),
    })
    pdfDoc = await loadingTask.promise
    loading.remove()
    document.getElementById('filename')!.textContent = currentFileName
    document.getElementById('total-pages')!.textContent = String(pdfDoc.numPages)
    ;(document.getElementById('page-input') as HTMLInputElement).max = String(pdfDoc.numPages)
    renderAllPages()
  } catch (err) {
    loading.remove()
    content.appendChild(el('div', 'error', `加载 PDF 失败：${(err as Error).message}`))
  }
}

// ── Page rendering ─────────────────────────────────────────────
async function renderAllPages() {
  if (!pdfDoc) return
  const content = document.getElementById('content')!
  content.innerHTML = ''

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const pageWrapper = el('div', 'page-wrapper')
    pageWrapper.id = `page-${pageNum}`
    const pageLabel = el('div', 'page-label', `第 ${pageNum} 页`)
    pageWrapper.appendChild(pageLabel)
    content.appendChild(pageWrapper)
  }

  // Lazy render with IntersectionObserver
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.id.replace('page-', ''))
          void renderPage(pageNum)
          observer.unobserve(entry.target)
        }
      }
    },
    { rootMargin: '500px' },
  )
  document.querySelectorAll('.page-wrapper').forEach((p) => observer.observe(p))
}

async function renderPage(pageNum: number) {
  if (!pdfDoc || renderedPages.has(pageNum)) return
  renderedPages.add(pageNum)

  const pageWrapper = document.getElementById(`page-${pageNum}`) as HTMLElement
  if (!pageWrapper) return

  try {
    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale })
    const dpr = window.devicePixelRatio || 1

    // Container that holds canvas + text overlay, sized exactly to the page
    const renderArea = el('div', 'page-render-area')
    renderArea.style.width = `${viewport.width}px`
    renderArea.style.height = `${viewport.height}px`

    // Canvas: the rendered PDF page image (preserves all layout, images, icons)
    const canvas = el('canvas', 'page-canvas') as HTMLCanvasElement
    canvas.width = viewport.width * dpr
    canvas.height = viewport.height * dpr
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    await page.render({ canvasContext: ctx, viewport }).promise
    renderArea.appendChild(canvas)

    // Text overlay layer: positioned absolutely on top of canvas
    const textLayer = el('div', 'page-text-layer')
    renderArea.appendChild(textLayer)

    pageWrapper.appendChild(renderArea)

    // Apply current display mode
    if (displayMode === 'original') {
      canvas.style.opacity = '1'
      textLayer.style.display = 'none'
    } else if (displayMode === 'dual') {
      canvas.style.opacity = '1'
    } else {
      canvas.style.opacity = '0.25'
    }

    // Extract text and create overlays
    if (translateEnabled) {
      void extractAndOverlay(page, viewport, textLayer, canvas, pageNum)
    }
  } catch (err) {
    console.error(`Failed to render page ${pageNum}:`, err)
    pageWrapper.appendChild(el('div', 'error', `渲染第 ${pageNum} 页失败：${(err as Error).message}`))
  }
}

// ── Text extraction & overlay creation ────────────────────────
async function extractAndOverlay(
  page: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport,
  textLayer: HTMLElement,
  canvas: HTMLCanvasElement,
  pageNum: number,
) {
  if (translatingPages.has(pageNum)) return
  translatingPages.add(pageNum)

  // Loading indicator
  const loadingEl = el('div', 'overlay-loading', '正在提取文本…')
  loadingEl.style.position = 'absolute'
  loadingEl.style.top = '8px'
  loadingEl.style.left = '8px'
  textLayer.appendChild(loadingEl)

  try {
    const textContent = await page.getTextContent()
    const items = textContent.items.filter(
      (i): i is PdfTextItem => 'str' in i && typeof (i as PdfTextItem).str === 'string',
    ) as PdfTextItem[]

    // Group items into lines with viewport-space coordinates
    const lines = groupTextItemsIntoLines(items, viewport)

    if (lines.length === 0) {
      // No extractable text — this is an image-based PDF page
      loadingEl.remove()
      if (ocrEnabled) {
        const ocrLoading = el('div', 'overlay-loading', '未检测到文本，正在 OCR 识别…')
        ocrLoading.style.position = 'absolute'
        ocrLoading.style.top = '8px'
        ocrLoading.style.left = '8px'
        textLayer.appendChild(ocrLoading)
        await ocrAndOverlay(canvas, textLayer, viewport)
        ocrLoading.remove()
      } else {
        const hint = el('div', 'overlay-hint', '此页无可提取文本。启用 OCR 以识别图片中的文字。')
        hint.style.position = 'absolute'
        hint.style.top = '8px'
        hint.style.left = '8px'
        textLayer.appendChild(hint)
      }
      return
    }

    // Create overlay elements for each line
    lines.forEach((line) => {
      const item = createTextItem(line)
      textLayer.appendChild(item)
    })
    loadingEl.remove()

    // Translate all lines in batch
    await translateLines(lines, textLayer)
  } catch (err) {
    loadingEl.remove()
    console.error(`Translation failed for page ${pageNum}:`, err)
    const errEl = el('div', 'overlay-error', `翻译失败：${(err as Error).message}`)
    errEl.style.position = 'absolute'
    errEl.style.top = '8px'
    errEl.style.left = '8px'
    textLayer.appendChild(errEl)
  } finally {
    translatingPages.delete(pageNum)
  }
}

/**
 * Group PDF text items into lines, computing viewport-space coordinates.
 * Uses pdfjsLib.Util.transform to convert PDF coordinates to viewport coordinates.
 */
function groupTextItemsIntoLines(
  items: PdfTextItem[],
  viewport: pdfjsLib.PageViewport,
): TextLine[] {
  // Compute viewport-space position for each item
  const positioned = items
    .filter((i) => i.str.trim().length > 0)
    .map((i) => {
      // Transform: apply viewport transform to the item's transform matrix
      const tx = pdfjsLib.Util.transform(viewport.transform, i.transform)
      const fontSize = Math.hypot(tx[2], tx[3]) || (i.height || 12) * viewport.scale
      return {
        text: i.str,
        left: tx[4],
        // tx[5] is the baseline; top of the text is above the baseline
        top: tx[5] - fontSize,
        width: (i.width || 0) * viewport.scale,
        height: fontSize,
        fontSize,
      }
    })
    .sort((a, b) => a.top - b.top || a.left - b.left)

  if (positioned.length === 0) return []

  // Group into lines: items with similar top position (within half font size)
  const lineGroups: typeof positioned[] = []
  for (const item of positioned) {
    const lastGroup = lineGroups[lineGroups.length - 1]
    if (lastGroup) {
      const lastItem = lastGroup[0]
      if (Math.abs(lastItem.top - item.top) < lastItem.fontSize * 0.5) {
        lastGroup.push(item)
        continue
      }
    }
    lineGroups.push([item])
  }

  // Merge items in each line into a single TextLine
  return lineGroups.map((group) => {
    const sorted = group.sort((a, b) => a.left - b.left)
    const text = sorted.map((i) => i.text).join('').trim()
    const left = Math.min(...sorted.map((i) => i.left))
    const top = Math.min(...sorted.map((i) => i.top))
    const right = Math.max(...sorted.map((i) => i.left + i.width))
    const fontSize = Math.max(...sorted.map((i) => i.fontSize))
    return {
      text,
      left,
      top,
      width: right - left,
      height: fontSize * 1.2, // include line spacing
      fontSize,
    }
  }).filter((l) => l.text.length > 0)
}

/** Create a positioned overlay element for a text line. */
function createTextItem(line: TextLine): HTMLElement {
  const item = el('div', 'text-item')
  item.style.left = `${line.left}px`
  item.style.top = `${line.top}px`
  item.style.width = `${line.width}px`
  item.style.height = `${line.height}px`
  item.style.fontSize = `${line.fontSize}px`
  item.dataset.original = line.text

  const orig = el('div', 'text-orig', line.text)
  item.appendChild(orig)

  // Placeholder for translation (filled later)
  const trans = el('div', 'text-trans', '')
  trans.style.display = 'none'
  item.appendChild(trans)

  return item
}

/** Batch-translate all lines and update their overlay elements. */
async function translateLines(lines: TextLine[], textLayer: HTMLElement) {
  if (lines.length === 0) return

  // Translate in chunks of 20
  const CHUNK = 20
  for (let i = 0; i < lines.length; i += CHUNK) {
    const chunk = lines.slice(i, i + CHUNK)
    const texts = chunk.map((l) => l.text)
    const results = await translateBatch(
      texts,
      settings.sourceLang,
      settings.targetLang,
      settings.service,
      settings.openai,
    )
    chunk.forEach((line, idx) => {
      const translated = results[idx]?.text?.trim()
      if (!translated || translated === line.text) return

      // Find the corresponding overlay element
      const items = textLayer.querySelectorAll('.text-item')
      const item = items[i + idx] as HTMLElement
      if (!item) return

      const trans = item.querySelector('.text-trans') as HTMLElement
      if (trans) {
        trans.textContent = translated
        trans.style.display = ''
        // In dual mode: translation sits below the original text (not on top)
        if (displayMode === 'dual') {
          trans.style.position = 'relative'
          trans.style.top = '100%'
        }
      }
      // Mark as translated so CSS shows the translation
      item.classList.add('translated')
    })
    // Yield to UI
    await new Promise((r) => setTimeout(r, 16))
  }
}

// ── OCR for image-based PDFs ──────────────────────────────────

/** OCR line result from tesseract.js (loosely typed to avoid version mismatch). */
interface OcrLine {
  text: string
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

async function ocrAndOverlay(
  canvas: HTMLCanvasElement,
  textLayer: HTMLElement,
  viewport: pdfjsLib.PageViewport,
) {
  try {
    // Dynamically import tesseract.js (reduces initial bundle size)
    const { createWorker } = await import('tesseract.js')

    // Create worker with local worker path (avoids CDN/CSP issues in extension)
    const workerPath = chrome.runtime.getURL('tesseract-worker.min.js')
    // Core and lang data loaded from CDN (these are WASM/data, not scripts — allowed by CSP)
    const corePath = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5'
    const langPath = 'https://tessdata.projectnaptha.com/4.0.0'

    // Determine OCR language based on target language setting
    const ocrLang = settings.targetLang.startsWith('zh') ? 'chi_sim+eng' : 'eng'

    const worker = await createWorker(ocrLang, 1, {
      workerPath,
      corePath,
      langPath,
      logger: () => {}, // suppress logs
    })

    // Run OCR on the canvas — use type assertion because tesseract.js v5
    // types may not expose .lines/.words directly on the Page type.
    const result = await worker.recognize(canvas)
    await worker.terminate()

    // Try to get lines from the result; fall back to words, then to full text.
    const data = result.data as unknown as {
      text?: string
      lines?: OcrLine[]
      words?: OcrWord[]
    }

    let lines: TextLine[] = []

    if (data.lines && data.lines.length > 0) {
      // Best case: tesseract returns lines with bounding boxes
      lines = data.lines
        .filter((l) => l.text.trim().length > 0)
        .map((l) => ocrLineToTextLine(l, canvas))
    } else if (data.words && data.words.length > 0) {
      // Fall back to words: group them into lines ourselves
      lines = groupOcrWordsIntoLines(data.words, canvas)
    } else if (data.text && data.text.trim().length > 0) {
      // Last resort: just show the full text as a single block at the top
      lines = [{
        text: data.text.trim(),
        left: 20,
        top: 20,
        width: canvas.clientWidth - 40,
        height: 20,
        fontSize: 16,
      }]
    }

    if (lines.length === 0) {
      textLayer.appendChild(el('div', 'overlay-hint', 'OCR 未识别到文字。'))
      return
    }

    // Create overlays for each OCR line
    lines.forEach((line) => {
      const item = createTextItem(line)
      textLayer.appendChild(item)
    })

    // Translate OCR'd lines
    await translateLines(lines, textLayer)
  } catch (err) {
    console.error('OCR failed:', err)
    textLayer.appendChild(el('div', 'overlay-error', `OCR 失败：${(err as Error).message}`))
  }
}

/** Convert a tesseract.js OCR line to our TextLine format. */
function ocrLineToTextLine(line: OcrLine, canvas: HTMLCanvasElement): TextLine {
  const scaleX = canvas.clientWidth / canvas.width
  const scaleY = canvas.clientHeight / canvas.height
  const height = (line.bbox.y1 - line.bbox.y0) * scaleY || 14
  return {
    text: line.text.trim(),
    left: line.bbox.x0 * scaleX,
    top: line.bbox.y0 * scaleY,
    width: (line.bbox.x1 - line.bbox.x0) * scaleX,
    height,
    fontSize: height * 0.85,
  }
}

/** Group OCR words into lines based on vertical position. */
function groupOcrWordsIntoLines(words: OcrWord[], canvas: HTMLCanvasElement): TextLine[] {
  if (words.length === 0) return []

  // Sort by y position (top to bottom), then x (left to right)
  const sorted = words
    .filter((w) => w.text.trim().length > 0)
    .sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0))

  // Group into lines: words with similar y0 (within 5px)
  const lineGroups: OcrWord[][] = []
  for (const word of sorted) {
    const lastGroup = lineGroups[lineGroups.length - 1]
    if (lastGroup) {
      const lastWord = lastGroup[0]
      if (Math.abs(lastWord.bbox.y0 - word.bbox.y0) < 5) {
        lastGroup.push(word)
        continue
      }
    }
    lineGroups.push([word])
  }

  // Convert each group to a TextLine
  // OCR coordinates are in canvas pixel space; scale to display space
  const scaleX = canvas.clientWidth / canvas.width
  const scaleY = canvas.clientHeight / canvas.height

  return lineGroups.map((group) => {
    const sortedG = group.sort((a, b) => a.bbox.x0 - b.bbox.x0)
    const text = sortedG.map((w) => w.text).join(' ').trim()
    const left = Math.min(...sortedG.map((w) => w.bbox.x0)) * scaleX
    const top = Math.min(...sortedG.map((w) => w.bbox.y0)) * scaleY
    const right = Math.max(...sortedG.map((w) => w.bbox.x1)) * scaleX
    const bottom = Math.max(...sortedG.map((w) => w.bbox.y1)) * scaleY
    const height = (bottom - top) || 14
    return {
      text,
      left,
      top,
      width: right - left,
      height,
      fontSize: height * 0.85,
    }
  }).filter((l) => l.text.length > 0)
}

// ── Empty state ────────────────────────────────────────────────
function showEmptyState() {
  const content = document.getElementById('content')!
  content.innerHTML = ''
  const empty = el('div', 'empty-state')

  const dropzone = el('div', 'dropzone')
  dropzone.id = 'dropzone'
  const icon = el('div', 'dropzone-icon', '📄')
  const title = el('div', 'dropzone-title', '打开 PDF 进行翻译')
  const desc = el('div', 'dropzone-desc', '点击选择文件，或将 PDF 文件拖到此区域')
  const pickBtn = el('button', 'dropzone-btn', '选择 PDF 文件')
  pickBtn.addEventListener('click', () => {
    document.getElementById('file-input')!.click()
  })
  dropzone.append(icon, title, desc, pickBtn)

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropzone.classList.add('dragover')
  })
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover')
  })
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault()
    dropzone.classList.remove('dragover')
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      dropzone.querySelector('.dropzone-error')?.remove()
      dropzone.appendChild(el('div', 'dropzone-error', '只支持 PDF 文件'))
      return
    }
    const url = URL.createObjectURL(file)
    currentFileName = file.name
    await loadPdf(url)
  })

  empty.appendChild(dropzone)
  content.appendChild(empty)
}

// ── Init ───────────────────────────────────────────────────────
async function init() {
  settings = await getSettings()
  buildApp()

  // Global drag-and-drop
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', async (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return
    const url = URL.createObjectURL(file)
    currentFileName = file.name
    await loadPdf(url)
  })

  const params = new URLSearchParams(location.search)
  const fileUrl = params.get('file')
  if (fileUrl) {
    currentFileName = decodeURIComponent(fileUrl.split('/').pop() || 'PDF')
    await loadPdf(fileUrl)
  } else {
    showEmptyState()
  }
}

void init()
