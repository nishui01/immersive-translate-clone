import { useEffect, useState } from 'react'
import type { RuntimeMessage, Settings } from '../types'
import { DEFAULT_SETTINGS, LANGUAGES } from '../config'

function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => resolve(res as T))
  })
}

// Detect whether the active tab is a PDF.
// Chrome's built-in PDF viewer serves a viewer.html wrapper, but the URL still
// ends in .pdf in the vast majority of cases. We also accept the
// chrome://pdf-viewer/ scheme used by some Chrome variants.
function isPdfUrl(url: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('chrome://pdf-viewer')) return true
  if (url.startsWith('blob:')) return true // can't be sure, but allow
  // Crude but effective: most direct PDF links end with .pdf (optionally with query/hash).
  return /\.pdf(\?.*)?(#.*)?$/i.test(url)
}

export default function Popup() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [busy, setBusy] = useState(false)
  const [isPdf, setIsPdf] = useState(false)
  const [tabUrl, setTabUrl] = useState<string>('')

  useEffect(() => {
    send<{ ok: boolean; settings: Settings }>({ type: 'GET_STATE' }).then((res) => {
      if (res?.ok) setSettings(res.settings)
    })
    // Detect PDF on the active tab so we can feature the PDF button.
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const url = tab?.url || ''
      setTabUrl(url)
      setIsPdf(isPdfUrl(url))
    })
    const listener = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'sync' && changes.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...changes.settings.newValue })
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  async function toggle() {
    setBusy(true)
    const res = await send<{ ok: boolean; enabled: boolean }>({ type: 'TOGGLE_TRANSLATION' })
    if (res?.ok) setSettings((s) => ({ ...s, enabled: res.enabled }))
    setBusy(false)
  }

  async function patch(p: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...p }))
    await send<{ ok: boolean }>({ type: 'SET_STATE', payload: p })
  }

  function openOptions() {
    chrome.runtime.openOptionsPage()
  }

  // Open our PDF viewer, optionally pre-loading the active tab's URL.
  async function openPdfViewer(fileUrl?: string) {
    const viewerBase = chrome.runtime.getURL('src/pdf/viewer.html')
    const viewerUrl = fileUrl ? viewerBase + '?file=' + encodeURIComponent(fileUrl) : viewerBase
    await chrome.tabs.create({ url: viewerUrl })
    window.close()
  }

  async function translateCurrentPdf() {
    if (!tabUrl) return
    await openPdfViewer(tabUrl)
  }

  async function openLocalPdf() {
    // Open the viewer without a ?file= param — the viewer itself shows a
    // prominent "Open PDF" button + drag-and-drop area.
    await openPdfViewer()
  }

  return (
    <div className="wrap">
      <header>
        <span className="logo">译</span>
        <span className="title">沉浸式翻译</span>
      </header>

      <button className={`toggle ${settings.enabled ? 'on' : ''}`} onClick={toggle} disabled={busy}>
        {busy ? '处理中…' : settings.enabled ? '✓ 翻译已开启' : '开启翻译'}
      </button>

      {/* PDF entry — featured when the current tab is a PDF, secondary otherwise */}
      {isPdf ? (
        <button className="pdf-btn pdf-btn-primary" onClick={translateCurrentPdf}>
          📄 翻译此 PDF
        </button>
      ) : (
        <button className="pdf-btn" onClick={openLocalPdf}>
          📄 翻译 PDF 文件…
        </button>
      )}
      <div className="pdf-hint">
        {isPdf ? '将当前 PDF 在翻译查看器中打开' : '打开翻译查看器，再选择本地 PDF 或拖入文件'}
      </div>

      <div className="row">
        <label>目标语言</label>
        <select value={settings.targetLang} onChange={(e) => patch({ targetLang: e.target.value })}>
          {LANGUAGES.filter((l) => l.code !== 'auto').map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <label>翻译服务</label>
        <select value={settings.service} onChange={(e) => patch({ service: e.target.value as Settings['service'] })}>
          <option value="google">Google（免费）</option>
          <option value="microsoft">微软（免费）</option>
          <option value="openai">AI 大模型</option>
        </select>
      </div>

      <div className="row">
        <label>显示方式</label>
        <select value={settings.displayMode} onChange={(e) => patch({ displayMode: e.target.value as Settings['displayMode'] })}>
          <option value="dual">双语对照</option>
          <option value="translationOnly">仅译文</option>
        </select>
      </div>

      <div className="footer">
        <button className="link" onClick={openOptions}>
          ⚙ 高级设置
        </button>
        <span className="hint">Alt+T 快捷开关</span>
      </div>
    </div>
  )
}
