import type { Settings } from '../types'

const STYLE_ID = 'it-style'

// Inject (or refresh) the extension's CSS based on current style settings.
export function applyStyle(settings: Settings) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.documentElement.appendChild(style)
  }
  const color = settings.translationColor || '#4F46E5'
  const fontSize = settings.fontSize || 90
  style.textContent = `
    .it-translation {
      display: block;
      width: 100%;
      clear: both;
      margin: 0.5em 0 0 !important;
      padding: 0 !important;
      color: ${color} !important;
      font-size: ${fontSize}% !important;
      line-height: 1.7 !important;
      font-weight: 400 !important;
      font-style: normal !important;
      text-align: inherit !important;
      text-indent: 0 !important;
      word-break: break-word;
      overflow-wrap: break-word;
      transition: opacity 0.2s ease;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }
    .it-translation.it-loading { opacity: 0.5; font-style: italic !important; font-size: 80% !important; }
    .it-translation.it-error { color: #dc2626 !important; font-size: 80% !important; }
    #it-sel-popup {
      position: fixed;
      z-index: 2147483647;
      max-width: 420px;
      min-width: 160px;
      padding: 10px 14px;
      background: #ffffff;
      color: #111827;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.18);
      font-size: 14px;
      line-height: 1.55;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #it-sel-popup .it-sel-src { color: #6b7280; font-size: 12px; margin-bottom: 4px; }
    #it-sel-popup .it-sel-dst { color: ${color}; }
    #it-sel-popup .it-sel-loading { color: #9ca3af; font-style: italic; }
    #it-sel-popup .it-sel-close {
      position: absolute; top: 4px; right: 8px; cursor: pointer;
      color: #9ca3af; font-size: 14px; line-height: 1;
    }
  `
}

export function removeStyle() {
  document.getElementById(STYLE_ID)?.remove()
}
