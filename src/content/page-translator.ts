import type { Settings } from '../types'
import { translateBatchViaBg } from './messaging'
import { applyStyle, removeStyle } from './style'
import {
  collectBlocks,
  injectTranslation,
  clearAllTranslations,
  TRANSLATION_CLASS,
} from './dom'

const CHUNK = 20
const MAX_BLOCKS = 800

class PageTranslator {
  settings: Settings | null = null
  enabled = false
  private runId = 0
  private observer: MutationObserver | null = null
  private debounceTimer: number | null = null

  configure(settings: Settings) {
    const prev = this.settings
    this.settings = settings
    if (!this.enabled) return
    applyStyle(settings)
    // If translation-affecting settings changed, retranslate.
    const needsRetranslate =
      !prev ||
      prev.targetLang !== settings.targetLang ||
      prev.sourceLang !== settings.sourceLang ||
      prev.service !== settings.service ||
      prev.openai.apiKey !== settings.openai.apiKey ||
      prev.openai.baseURL !== settings.openai.baseURL ||
      prev.openai.model !== settings.openai.model ||
      prev.displayMode !== settings.displayMode
    if (needsRetranslate) {
      this.refresh()
    }
  }

  enable() {
    if (!this.settings) return
    if (this.enabled) return
    this.enabled = true
    applyStyle(this.settings)
    this.startObserver()
    this.runId++
    void this.translateAll(this.runId)
  }

  disable() {
    this.enabled = false
    this.runId++ // invalidate in-flight work
    this.stopObserver()
    clearAllTranslations()
    removeStyle()
  }

  refresh() {
    if (!this.enabled) return
    this.runId++
    clearAllTranslations()
    void this.translateAll(this.runId)
  }

  private startObserver() {
    if (this.observer) return
    this.observer = new MutationObserver((mutations) => {
      // Ignore mutations that only add our own translation nodes / style,
      // so injecting translations doesn't trigger redundant re-translation.
      let external = false
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) {
            external = true
            break
          }
          const el = node as Element
          const ours =
            el.classList?.contains(TRANSLATION_CLASS) ||
            el.id === 'it-style' ||
            el.tagName === 'STYLE' ||
            el.getAttribute?.('data-it') === '1'
          if (!ours) {
            external = true
            break
          }
        }
        if (external) break
      }
      if (!external) return
      if (this.debounceTimer) window.clearTimeout(this.debounceTimer)
      this.debounceTimer = window.setTimeout(() => {
        if (!this.enabled || !this.settings) return
        const id = this.runId
        void this.translateNew(id)
      }, 400)
    })
    this.observer.observe(document.body, { childList: true, subtree: true })
  }

  private stopObserver() {
    this.observer?.disconnect()
    this.observer = null
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private async translateAll(id: number) {
    const settings = this.settings!
    const blocks = collectBlocks(document.body, MAX_BLOCKS, settings.targetLang)
    await this.translateBlocks(blocks, id, settings)
    this.notifyTranslated()
  }

  private async translateNew(id: number) {
    const settings = this.settings!
    if (id !== this.runId) return
    const blocks = collectBlocks(document.body, 200, settings.targetLang)
    if (!blocks.length) return
    await this.translateBlocks(blocks, id, settings)
  }

  private async translateBlocks(
    blocks: { el: HTMLElement; text: string }[],
    id: number,
    settings: Settings,
  ) {
    for (let i = 0; i < blocks.length; i += CHUNK) {
      if (id !== this.runId) return // cancelled
      const chunk = blocks.slice(i, i + CHUNK)
      // Insert loading placeholders immediately for a responsive feel.
      chunk.forEach((b) => {
        if (!b.el.getAttribute('data-it-translated')) {
          injectTranslation(b.el, '正在翻译…', 'loading')
        }
      })
      const texts = chunk.map((b) => b.text)
      const results = await translateBatchViaBg(texts, settings)
      if (id !== this.runId) return // cancelled
      chunk.forEach((b, idx) => {
        const translated = results[idx]?.text?.trim()
        if (translated && translated !== b.text) {
          injectTranslation(b.el, translated, 'done')
          this.applyDisplayMode(b.el)
        } else {
          // no translation or identical: remove placeholder
          const ph = b.el.querySelector(':scope > .' + TRANSLATION_CLASS)
          if (ph) ph.remove()
          b.el.removeAttribute('data-it-translated')
        }
      })
      // yield to the UI between chunks
      await new Promise((r) => setTimeout(r, 16))
    }
  }

  private applyDisplayMode(el: HTMLElement) {
    if (!this.settings) return
    const translation = el.querySelector(':scope > .' + TRANSLATION_CLASS) as HTMLElement | null
    if (this.settings.displayMode === 'translationOnly') {
      // Collapse original text via font-size:0 (can't display:none because the
      // translation is a child). Size the translation in px so it's still visible.
      const base = parseFloat(getComputedStyle(el).fontSize) || 16
      const px = (base * (this.settings.fontSize || 92)) / 100
      el.style.setProperty('font-size', '0', 'important')
      el.style.setProperty('line-height', '0', 'important')
      translation?.style.setProperty('font-size', `${px}px`, 'important')
      translation?.style.setProperty('line-height', '1.6', 'important')
    } else {
      el.style.removeProperty('font-size')
      el.style.removeProperty('line-height')
      translation?.style.removeProperty('font-size')
      translation?.style.removeProperty('line-height')
    }
  }

  private notifyTranslated() {
    const count = document.querySelectorAll('[data-it-translated]').length
    try {
      chrome.runtime.sendMessage({ type: 'PAGE_TRANSLATED', payload: { count } }, () => {
        // ignore response
      })
    } catch {
      // ignore
    }
  }
}

export const pageTranslator = new PageTranslator()
