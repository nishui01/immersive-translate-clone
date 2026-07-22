// DOM helpers: find translatable blocks, inject/remove translations.

const TRANSLATABLE_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TD', 'TH',
  'FIGCAPTION', 'DT', 'DD', 'SUMMARY', 'CAPTION', 'DT', 'DD',
])
// div/span are only translated when they have no element children (pure text leaves).
const LEAF_TEXT_TAGS = new Set(['DIV', 'SPAN', 'A', 'STRONG', 'EM', 'B', 'I'])
const EXCLUDE_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA',
  'INPUT', 'SELECT', 'OPTION', 'SVG', 'OBJECT', 'VIDEO', 'AUDIO', 'CANVAS',
  'BUTTON', 'IFRAME', 'TEMPLATE',
])

export const TRANSLATION_CLASS = 'it-translation'
export const TRANSLATED_ATTR = 'data-it-translated'

function inExcludedContext(el: Element): boolean {
  let node: Element | null = el
  while (node) {
    if (EXCLUDE_TAGS.has(node.tagName)) return true
    if (node.id === 'it-sel-popup') return true
    if (node.classList?.contains(TRANSLATION_CLASS)) return true
    if (node.getAttribute?.('contenteditable') === 'true') return true
    node = node.parentElement
  }
  return false
}

function hasElementChildren(el: Element): boolean {
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].nodeType === 1) return true
  }
  return false
}

function meaningfulText(el: Element): string {
  // Use textContent; fall back gracefully. Trim and collapse internal whitespace conservatively.
  const raw = (el.textContent || '').replace(/\s+/g, ' ').trim()
  return raw
}

const HAS_LETTER = /\p{L}/u
function isWorthTranslating(text: string): boolean {
  if (text.length < 1) return false
  if (!HAS_LETTER.test(text)) return false
  // skip pure numbers/short tokens
  if (text.length <= 2 && !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)) return false
  return true
}

function charRatios(text: string) {
  let cjk = 0
  let kana = 0
  let hangul = 0
  let latin = 0
  let letters = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code >= 0x4e00 && code <= 0x9fff) cjk++
    else if (code >= 0x3040 && code <= 0x30ff) kana++
    else if (code >= 0xac00 && code <= 0xd7af) hangul++
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin++
    if (HAS_LETTER.test(ch)) letters++
  }
  const denom = text.length || 1
  return {
    cjk: cjk / denom,
    kana: kana / denom,
    hangul: hangul / denom,
    latin: latin / denom,
    letters: letters / denom,
  }
}

// Heuristic: skip elements that already look like the target language.
export function isLikelySameLanguage(text: string, targetLang: string): boolean {
  const r = charRatios(text)
  if (targetLang.startsWith('zh')) {
    return r.cjk > 0.4 && r.kana < 0.05 && r.hangul < 0.05
  }
  if (targetLang === 'ja') {
    return r.kana > 0.1 || (r.cjk > 0.4 && r.kana > 0.02)
  }
  if (targetLang === 'ko') {
    return r.hangul > 0.2
  }
  if (targetLang === 'en') {
    return r.cjk < 0.02 && r.kana < 0.02 && r.hangul < 0.02 && r.latin > 0.5
  }
  return false
}

export interface CollectedBlock {
  el: HTMLElement
  text: string
}

export function collectBlocks(
  root: ParentNode = document.body,
  max = 1000,
  targetLang?: string,
): CollectedBlock[] {
  const out: CollectedBlock[] = []
  const rootEl = root as Element
  // Manual DFS so that once a block-level element is collected we do NOT recurse
  // into its descendants — this is what prevents duplicate translations of nested
  // inline elements (e.g. <strong>/<span> inside a <p>).
  const stack: Element[] = []
  const startNodes = rootEl.children?.length ? Array.from(rootEl.children) : [rootEl]
  for (let i = startNodes.length - 1; i >= 0; i--) stack.push(startNodes[i])

  while (stack.length) {
    if (out.length >= max) break
    const el = stack.pop()!
    if (EXCLUDE_TAGS.has(el.tagName)) continue
    if (el.classList?.contains(TRANSLATION_CLASS)) continue
    if (el.getAttribute(TRANSLATED_ATTR)) continue
    if (inExcludedContext(el)) continue

    const tag = el.tagName
    const isBlock = TRANSLATABLE_TAGS.has(tag)
    const isLeafText = LEAF_TEXT_TAGS.has(tag) && !hasElementChildren(el)

    if (isBlock || isLeafText) {
      const text = meaningfulText(el)
      if (isWorthTranslating(text)) {
        const sameLang = targetLang ? isLikelySameLanguage(text, targetLang) : false
        if (!sameLang) {
          out.push({ el: el as HTMLElement, text })
        }
        // Treat this element as a single translation unit; do not descend.
        continue
      }
      // Not worth translating (e.g. empty): still descend to find inner content.
    }

    // Recurse: push children in reverse so they are visited in document order.
    const kids = el.children
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
  return out
}

export function createTranslationEl(text: string, state: 'loading' | 'done' | 'error'): HTMLElement {
  const node = document.createElement('span')
  node.className = TRANSLATION_CLASS + (state === 'loading' ? ' it-loading' : state === 'error' ? ' it-error' : '')
  node.setAttribute('data-it', '1')
  node.textContent = text
  return node
}

export function injectTranslation(el: HTMLElement, text: string, state: 'loading' | 'done' | 'error') {
  // Remove any previous translation node for this element.
  removeTranslation(el)
  const node = createTranslationEl(text, state)
  el.setAttribute(TRANSLATED_ATTR, '1')
  el.appendChild(node)
}

export function removeTranslation(el: HTMLElement) {
  const existing = el.querySelector(':scope > .it-translation')
  if (existing) existing.remove()
}

export function clearAllTranslations(root: ParentNode = document.body) {
  const nodes = root.querySelectorAll(`[${TRANSLATED_ATTR}]`)
  nodes.forEach((n) => {
    n.removeAttribute(TRANSLATED_ATTR)
    removeTranslation(n as HTMLElement)
  })
}
