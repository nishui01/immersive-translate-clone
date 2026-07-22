import type { TranslateResult } from '../types'

// Free Google Translate endpoint (gtx client). No API key required.
// Runs from the background service worker, so host_permissions apply.
export async function translateGoogle(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<TranslateResult> {
  const sl = sourceLang === 'auto' ? 'auto' : sourceLang
  // Normalize target: Google uses zh-CN / zh-TW as-is.
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx' +
    `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(targetLang)}&dt=t` +
    `&q=${encodeURIComponent(text)}`

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!res.ok) {
    throw new Error(`Google Translate HTTP ${res.status}`)
  }
  const data = await res.json()
  // data[0] is an array of [translatedSegment, originalSegment, ...]
  const segments = data?.[0] as unknown[] | undefined
  if (!Array.isArray(segments)) {
    throw new Error('Google Translate: unexpected response shape')
  }
  const translated = segments
    .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? '') : ''))
    .join('')
  const detected = typeof data?.[2] === 'string' ? (data[2] as string) : undefined
  return { text: translated, detected }
}
