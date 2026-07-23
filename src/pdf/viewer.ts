import * as pdfjsLib from 'pdfjs-dist'
import type { Settings, ServiceId, TranslateResult } from '../types'
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

interface TextLine {
  text: string
  y: number
  x: number
  height: number
}

interface TextParagraph {
  text: string
  lines: TextLine[]
}

// ── State ──────────────────────────────────────────────────────
let settings: Settings = DEFAULT_SETTINGS
let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
let scale = 1.3
let translateEnabled = true
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
    { id: 'google', label: 'Google（免费）' },
    { id: 'microsoft', label: '微软（免费）' },
    { id: 'openai', label: 'AI 大模型' },
  ]
  services.forEach((s) => {
    const opt = el('option', undefined, s.label) as HTMLOptionElement
    opt.value = s.id
    serviceSelect.appendChild(opt)
  })
  serviceSelect.value = settings.service

  const translateBtn = el('button', 'tb-btn tb-translate', '✓ 译文开')
  translateBtn.id = 'btn-translate'

  right.append(zoomOut, zoomLabel, zoomIn, langSelect, serviceSelect, translateBtn)
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
    const page = parseInt((e.target as HTMLInputElement).value)
    goToPage(page)
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
    const lang = (e.target as HTMLSelectElement).value
    settings.targetLang = lang
    await saveSettings({ targetLang: lang })
    // Re-translate all rendered pages
    renderedPages.clear()
    translatingPages.clear()
    if (pdfDoc) renderAllPages()
  })

  document.getElementById('service-select')!.addEventListener('change', async (e) => {
    const service = (e.target as HTMLSelectElement).value as ServiceId
    settings.service = service
    await saveSettings({ service })
    renderedPages.clear()
    translatingPages.clear()
    if (pdfDoc) renderAllPages()
  })

  document.getElementById('btn-translate')!.addEventListener('click', () => {
    translateEnabled = !translateEnabled
    const btn = document.getElementById('btn-translate')!
    btn.textContent = translateEnabled ? '✓ 译文开' : '译文关'
    btn.classList.toggle('off', !translateEnabled)
    // Show/hide translation panels
    document.querySelectorAll('.page-translation').forEach((p) => {
      ;(p as HTMLElement).style.display = translateEnabled ? '' : 'none'
    })
  })
}

function updateZoom() {
  document.getElementById('zoom-label')!.textContent = `${Math.round(scale * 100)}%`
  // Re-render all pages at new scale
  renderedPages.clear()
  if (pdfDoc) renderAllPages()
}

function goToPage(pageNum: number) {
  const total = pdfDoc?.numPages ?? 1
  pageNum = Math.max(1, Math.min(total, pageNum))
  ;(document.getElementById('page-input') as HTMLInputElement).value = String(pageNum)
  const pageEl = document.getElementById(`page-${pageNum}`)
  if (pageEl) pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ── PDF loading ────────────────────────────────────────────────
async function loadPdf(url: string) {
  currentFileUrl = url
  const content = document.getElementById('content')!
  content.innerHTML = ''
  renderedPages.clear()
  translatingPages.clear()

  // Loading indicator
  const loading = el('div', 'loading', '正在加载 PDF…')
  content.appendChild(loading)

  try {
    const loadingTask = pdfjsLib.getDocument({
      url,
      // Disable range requests for blob URLs / cross-origin
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
    const errEl = el('div', 'error', `加载 PDF 失败：${(err as Error).message}`)
    content.appendChild(errEl)
  }
}

// ── Page rendering ─────────────────────────────────────────────
async function renderAllPages() {
  if (!pdfDoc) return
  const content = document.getElementById('content')!

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const pageWrapper = el('div', 'page-wrapper')
    pageWrapper.id = `page-${pageNum}`

    const pageLabel = el('div', 'page-label', `第 ${pageNum} 页`)
    pageWrapper.appendChild(pageLabel)

    const canvas = el('canvas', 'page-canvas')
    canvas.id = `canvas-${pageNum}`
    pageWrapper.appendChild(canvas)

    const translationPanel = el('div', 'page-translation')
    translationPanel.id = `translation-${pageNum}`
    if (!translateEnabled) translationPanel.style.display = 'none'
    pageWrapper.appendChild(translationPanel)

    content.appendChild(pageWrapper)
  }

  // Lazy render pages with IntersectionObserver
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
    { rootMargin: '300px' },
  )

  document.querySelectorAll('.page-wrapper').forEach((p) => observer.observe(p))
}

async function renderPage(pageNum: number) {
  if (!pdfDoc || renderedPages.has(pageNum)) return
  renderedPages.add(pageNum)

  const canvas = document.getElementById(`canvas-${pageNum}`) as HTMLCanvasElement
  if (!canvas) return

  try {
    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale })
    const ctx = canvas.getContext('2d')!

    // High-DPI rendering
    const dpr = window.devicePixelRatio || 1
    canvas.width = viewport.width * dpr
    canvas.height = viewport.height * dpr
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    ctx.scale(dpr, dpr)

    await page.render({ canvasContext: ctx, viewport }).promise

    // Extract and translate text
    if (translateEnabled) {
      void extractAndTranslate(page, pageNum)
    }
  } catch (err) {
    console.error(`Failed to render page ${pageNum}:`, err)
  }
}

// ── Text extraction & grouping ─────────────────────────────────
async function extractAndTranslate(page: pdfjsLib.PDFPageProxy, pageNum: number) {
  if (translatingPages.has(pageNum)) return
  translatingPages.add(pageNum)

  const panel = document.getElementById(`translation-${pageNum}`)
  if (!panel) return

  // Loading placeholder
  panel.innerHTML = ''
  const loadingEl = el('div', 'translation-loading', '正在翻译…')
  panel.appendChild(loadingEl)

  try {
    const textContent = await page.getTextContent()
    const items = textContent.items.filter(
      (i): i is PdfTextItem => 'str' in i && typeof (i as PdfTextItem).str === 'string',
    )
    const paragraphs = groupTextItems(items as PdfTextItem[])

    if (paragraphs.length === 0) {
      panel.innerHTML = '<div class="translation-empty">此页无可翻译文本</div>'
      return
    }

    // Translate in batches
    const texts = paragraphs.map((p) => p.text)
    const results = await translateBatch(
      texts,
      settings.sourceLang,
      settings.targetLang,
      settings.service,
      settings.openai,
    )

    // Display translations
    panel.innerHTML = ''
    paragraphs.forEach((para, idx) => {
      const result = results[idx]
      const translated = result?.text?.trim()
      if (!translated || translated === para.text) return

      const block = el('div', 'translation-block')
      const orig = el('div', 'translation-orig', para.text)
      const trans = el('div', 'translation-dst', translated)
      block.appendChild(orig)
      block.appendChild(trans)
      panel.appendChild(block)
    })

    if (panel.children.length === 0) {
      panel.innerHTML = '<div class="translation-empty">无需翻译</div>'
    }
  } catch (err) {
    panel.innerHTML = `<div class="translation-error">翻译失败：${(err as Error).message}</div>`
  } finally {
    translatingPages.delete(pageNum)
  }
}

function groupTextItems(items: PdfTextItem[]): TextParagraph[] {
  // Filter empty items and sort by position
  const filtered = items
    .filter((i) => i.str.trim().length > 0)
    .map((i) => ({
      text: i.str,
      x: i.transform[4],
      y: i.transform[5],
      height: i.height || 12,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x)

  if (filtered.length === 0) return []

  // Group into lines (items with similar y position)
  const lines: TextLine[][] = []
  for (const item of filtered) {
    const lastLine = lines[lines.length - 1]
    if (lastLine && Math.abs(lastLine[0].y - item.y) < 3) {
      lastLine.push(item)
    } else {
      lines.push([item])
    }
  }

  // Join items within each line (sorted by x)
  const textLines: TextLine[] = lines.map((line) => ({
    text: line
      .sort((a, b) => a.x - b.x)
      .map((i) => i.text)
      .join(''),
    y: line[0].y,
    x: Math.min(...line.map((i) => i.x)),
    height: line[0].height,
  }))

  // Group lines into paragraphs (small vertical gap = same paragraph)
  const paragraphs: TextParagraph[] = []
  for (const line of textLines) {
    const lastPara = paragraphs[paragraphs.length - 1]
    if (lastPara) {
      const prevLine = lastPara.lines[lastPara.lines.length - 1]
      const gap = prevLine.y - line.y
      if (gap < line.height * 1.5) {
        lastPara.lines.push(line)
        lastPara.text += '\n' + line.text
        continue
      }
    }
    paragraphs.push({ text: line.text, lines: [line] })
  }

  // Filter out paragraphs that are too short (likely noise)
  return paragraphs.filter((p) => p.text.trim().length >= 2)
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

  // Drag-and-drop handlers
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
      const tip = el('div', 'dropzone-error', '只支持 PDF 文件')
      dropzone.querySelector('.dropzone-error')?.remove()
      dropzone.appendChild(tip)
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

  // Global drag-and-drop: drop a PDF anywhere on the window to load it.
  window.addEventListener('dragover', (e) => {
    e.preventDefault()
  })
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
