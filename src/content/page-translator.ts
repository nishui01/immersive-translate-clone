import type { Settings } from '../types'
import { translateBatchViaBg } from './messaging'
import { applyStyle, removeStyle } from './style'
import {
  collectBlocks,
  injectTranslation,
  removeTranslation,
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
  // Periodic re-scan timers for SPA pages that load content dynamically
  // (e.g. MSN, React/Vue SPAs). After enabling, we re-scan every few seconds
  // for a short window to catch late-arriving content that the initial pass
  // and the MutationObserver might miss.
  private rescanTimer: number | null = null
  private rescanCount = 0
  private static readonly RESCAN_INTERVAL = 3000 // 3 seconds
  private static readonly RESCAN_MAX = 10 // 10 scans = ~30 seconds total

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
    this.startRescan()
    this.runId++
    void this.translateAll(this.runId)
  }

  disable() {
    this.enabled = false
    this.runId++ // invalidate in-flight work
    this.stopObserver()
    this.stopRescan()
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
      // Slightly longer debounce for SPA pages that load content in bursts.
      this.debounceTimer = window.setTimeout(() => {
        if (!this.enabled || !this.settings) return
        const id = this.runId
        void this.translateNew(id)
      }, 600)
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

  /** Periodically re-scan for new content on SPA pages. */
  private startRescan() {
    this.stopRescan()
    this.rescanCount = 0
    this.rescanTimer = window.setInterval(() => {
      if (!this.enabled || !this.settings) {
        this.stopRescan()
        return
      }
      this.rescanCount++
      if (this.rescanCount > PageTranslator.RESCAN_MAX) {
        this.stopRescan()
        return
      }
      // Look for untranslated blocks; if found, translate them.
      const id = this.runId
      void this.translateNew(id)
    }, PageTranslator.RESCAN_INTERVAL)
  }

  private stopRescan() {
    if (this.rescanTimer) {
      window.clearInterval(this.rescanTimer)
      this.rescanTimer = null
    }
    this.rescanCount = 0
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
    // collectBlocks skips elements that already have data-it-translated,
    // so this naturally finds only new/untranslated content.
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
          removeTranslation(b.el)
          b.el.removeAttribute('data-it-translated')
        }
      })
      // yield to the UI between chunks
      await new Promise((r) => setTimeout(r, 16))
    }
  }

  private findTranslation(el: HTMLElement): HTMLElement | null {
    // Sibling-inserted: look at the immediate next sibling.
    const next = el.nextElementSibling
    if (next && next.classList?.contains(TRANSLATION_CLASS)) {
      return next as HTMLElement
    }
    // Child-inserted: look for a direct child.
    return el.querySelector(':scope > .' + TRANSLATION_CLASS) as HTMLElement | null
  }

  private applyDisplayMode(el: HTMLElement) {
    if (!this.settings) return
    const translation = this.findTranslation(el)
    if (this.settings.displayMode === 'translationOnly') {
      // Hide the original text entirely (works for both sibling and child
      // insertion: with sibling insertion the original is a separate element,
      // so display:none is safe and clean; with child insertion the original
      // text nodes collapse but the translation child still shows).
      el.style.setProperty('display', 'none', 'important')
      translation?.style.removeProperty('display')
    } else {
      el.style.removeProperty('display')
      translation?.style.removeProperty('display')
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
