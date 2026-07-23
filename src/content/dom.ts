// DOM helpers: find translatable blocks, inject/remove translations.

const TRANSLATABLE_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TD', 'TH',
  'FIGCAPTION', 'DT', 'DD', 'SUMMARY', 'CAPTION',
])
// div/span are only translated when they have no element children (pure text leaves).
const LEAF_TEXT_TAGS = new Set(['DIV', 'SPAN', 'A', 'STRONG', 'EM', 'B', 'I'])
const EXCLUDE_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA',
  'INPUT', 'SELECT', 'OPTION', 'SVG', 'OBJECT', 'VIDEO', 'AUDIO', 'CANVAS',
  'BUTTON', 'IFRAME', 'TEMPLATE',
])

// Elements that own a block layout and live in a flow container — for these we
// insert the translation as a *sibling* (after the element). This is the key
// fix for the "translation aligns to a floating image / leading bullet" issue:
// by living outside the original element, the translation can't be pushed around
// by floats or inline content inside the original paragraph.
const SIBLING_INSERT_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION',
  'DT', 'DD', 'SUMMARY', 'CAPTION',
])
// Container-like elements where a sibling insertion would break layout
// (e.g. <li>, <td>) — for these we keep the translation as a child.

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
  // Use a <div> (block) instead of <span> so the translation naturally occupies
  // its own line and we can apply clear/width reliably for both insertion modes.
  const node = document.createElement('div')
  node.className = TRANSLATION_CLASS + (state === 'loading' ? ' it-loading' : state === 'error' ? ' it-error' : '')
  node.setAttribute('data-it', '1')
  node.textContent = text
  return node
}

// Decide whether the translation for this element should be inserted as a
// sibling (after it) or as a child. Sibling insertion avoids being affected by
// floats / inline content inside the original element — BUT it can break layout
// when the parent uses flexbox or grid (the new <div> becomes a flex/grid item
// and may jump to the start of the container). So we check the parent's
// computed display and only use sibling insertion for normal block parents.
function shouldInsertAsSibling(el: HTMLElement): boolean {
  if (!SIBLING_INSERT_TAGS.has(el.tagName)) return false
  const parent = el.parentElement
  if (!parent) return false
  // Cache-aware check: getComputedStyle can be expensive, but we only call it
  // once per element during injection.
  const parentDisplay = getComputedStyle(parent).display
  // If the parent is a flex or grid container, inserting a sibling <div> would
  // create a new flex/grid item and likely break the layout (e.g. the
  // translation appears in the top-left corner). Fall back to child insertion.
  if (parentDisplay.includes('flex') || parentDisplay.includes('grid')) {
    return false
  }
  return true
}

export function injectTranslation(el: HTMLElement, text: string, state: 'loading' | 'done' | 'error') {
  removeTranslation(el)
  const node = createTranslationEl(text, state)
  el.setAttribute(TRANSLATED_ATTR, '1')
  if (shouldInsertAsSibling(el) && el.parentElement) {
    // Insert as the next sibling so the translation lives outside the original
    // element's inline flow — this is what makes it align to the paragraph's
    // left edge instead of to a leading image/bullet.
    el.after(node)
  } else {
    el.appendChild(node)
  }
}

export function removeTranslation(el: HTMLElement) {
  // Child mode: a direct child with the translation class.
  const child = el.querySelector(':scope > .' + TRANSLATION_CLASS)
  if (child) {
    child.remove()
    return
  }
  // Sibling mode: a following sibling with the translation class.
  const next = el.nextElementSibling
  if (next && next.classList?.contains(TRANSLATION_CLASS)) {
    next.remove()
  }
}

export function clearAllTranslations(_root: ParentNode = document.body) {
  const nodes = document.querySelectorAll(`[${TRANSLATED_ATTR}]`)
  nodes.forEach((n) => {
    const el = n as HTMLElement
    el.removeAttribute(TRANSLATED_ATTR)
    // Reset inline styles applied by display-mode handling.
    el.style.removeProperty('font-size')
    el.style.removeProperty('line-height')
    el.style.removeProperty('display')
    removeTranslation(el)
  })
  // Also clean up any orphaned translation nodes (defensive).
  document.querySelectorAll('.' + TRANSLATION_CLASS).forEach((n) => {
    const t = n as HTMLElement
    if (!t.closest('[' + TRANSLATED_ATTR + ']')) t.remove()
  })
}
