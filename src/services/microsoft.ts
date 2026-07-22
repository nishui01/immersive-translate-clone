import type { TranslateResult } from '../types'

let cachedToken: { token: string; expiresAt: number } | null = null

async function getAuthToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token
  }
  const res = await fetch('https://edge.microsoft.com/translate/auth', {
    method: 'GET',
  })
  if (!res.ok) {
    throw new Error(`Microsoft auth HTTP ${res.status}`)
  }
  const token = (await res.text()).trim()
  // JWT tokens are valid ~10 min; be conservative.
  cachedToken = { token, expiresAt: now + 8 * 60 * 1000 }
  return token
}

export async function translateMicrosoft(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<TranslateResult> {
  const token = await getAuthToken()
  const params = new URLSearchParams({ 'api-version': '3.0', to: targetLang })
  if (sourceLang !== 'auto') params.set('from', sourceLang)
  const url = `https://api.cognitive.microsofttranslator.com/translate?${params.toString()}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify([{ Text: text }]),
  })
  if (!res.ok) {
    throw new Error(`Microsoft Translate HTTP ${res.status}`)
  }
  const data = (await res.json()) as Array<{
    translations: Array<{ text: string }>
    detectedLanguage?: { language: string }
  }>
  const first = data?.[0]
  if (!first?.translations?.[0]) {
    throw new Error('Microsoft Translate: unexpected response shape')
  }
  return {
    text: first.translations[0].text,
    detected: first.detectedLanguage?.language,
  }
}
