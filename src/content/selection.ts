import type { Settings } from '../types'
import { translateViaBg } from './messaging'

let popup: HTMLDivElement | null = null
let hideTimer: number | null = null
let activeSettings: Settings | null = null
let lastSelectionText = ''

export function initSelectionTranslation(settings: Settings) {
  activeSettings = settings
  // Re-bind is harmless; listeners are added once.
}

export function updateSelectionSettings(settings: Settings) {
  activeSettings = settings
}

function removePopup() {
  if (popup) {
    popup.remove()
    popup = null
  }
}

function ensurePopup(): HTMLDivElement {
  if (popup) return popup
  popup = document.createElement('div')
  popup.id = 'it-sel-popup'
  popup.innerHTML = `<div class="it-sel-close">×</div>`
  document.documentElement.appendChild(popup)
  popup.querySelector('.it-sel-close')?.addEventListener('click', removePopup)
  // Hide when clicking outside.
  popup.addEventListener('mouseenter', () => {
    if (hideTimer) window.clearTimeout(hideTimer)
  })
  popup.addEventListener('mouseleave', scheduleHide)
  return popup
}

function scheduleHide() {
  if (hideTimer) window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(removePopup, 2500)
}

function positionPopup(rect: DOMRect) {
  const el = ensurePopup()
  const margin = 8
  // Use position:absolute with page coordinates (rect + scroll) instead of
  // position:fixed. fixed positioning breaks when an ancestor has transform/
  // filter/will-change (creating a containing block), causing the popup to jump
  // to the top-left corner of that ancestor. absolute positioning relative to
  // document.documentElement is robust against these CSS containment effects.
  const pageTop = rect.bottom + window.scrollY + margin
  const pageLeft = rect.left + window.scrollX
  // Clamp within viewport (in page coordinates)
  const maxTop = window.scrollY + window.innerHeight - 140
  const maxLeft = window.scrollX + window.innerWidth - 440
  el.style.position = 'absolute'
  el.style.top = `${Math.min(pageTop, maxTop)}px`
  el.style.left = `${Math.max(window.scrollX + margin, Math.min(pageLeft, maxLeft))}px`
}

export async function translateSelection() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!text || text.length < 1 || !activeSettings) {
    removePopup()
    return
  }
  lastSelectionText = text
  const rect = sel!.getRangeAt(0).getBoundingClientRect()
  positionPopup(rect)
  const el = ensurePopup()
  el.innerHTML = `<div class="it-sel-close">×</div><div class="it-sel-loading">正在翻译…</div>`
  el.querySelector('.it-sel-close')?.addEventListener('click', removePopup)

  const result = await translateViaBg({
    text,
    sourceLang: activeSettings.sourceLang,
    targetLang: activeSettings.targetLang,
    service: activeSettings.service,
    openai: activeSettings.openai,
  })

  if (!popup) return // closed already
  if (text !== lastSelectionText) return // selection changed
  const dst = result?.text?.trim() || '翻译失败'
  const srcLine = text.length > 80 ? text.slice(0, 80) + '…' : text
  popup.innerHTML = `<div class="it-sel-close">×</div><div class="it-sel-src">${escapeHtml(srcLine)}</div><div class="it-sel-dst">${escapeHtml(dst)}</div>`
  popup.querySelector('.it-sel-close')?.addEventListener('click', removePopup)
  scheduleHide()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Listen for mouseup to trigger selection translation.
let mouseTimer: number | null = null
document.addEventListener(
  'mouseup',
  () => {
    if (!activeSettings?.translateSelection) return
    if (mouseTimer) window.clearTimeout(mouseTimer)
    mouseTimer = window.setTimeout(() => {
      const text = window.getSelection()?.toString().trim() ?? ''
      if (text.length >= 1) void translateSelection()
    }, 200)
  },
  true,
)

// Hide popup on scroll / resize.
window.addEventListener('scroll', removePopup, true)
window.addEventListener('resize', removePopup)
