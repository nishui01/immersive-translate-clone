import type { Settings, TranslateResult } from '../types'

const LANG_LABEL: Record<string, string> = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  ar: 'Arabic',
  it: 'Italian',
  pt: 'Portuguese',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  hi: 'Hindi',
  tr: 'Turkish',
  pl: 'Polish',
  nl: 'Dutch',
}

export async function translateOpenAI(
  text: string,
  sourceLang: string,
  targetLang: string,
  openai: Settings['openai'],
): Promise<TranslateResult> {
  if (!openai.apiKey) {
    throw new Error('OpenAI API key is not configured. Open the options page to set it.')
  }
  const targetLabel = LANG_LABEL[targetLang] ?? targetLang
  const system = `You are a professional translator. Translate the user's text into ${targetLabel}. ` +
    `Preserve meaning, tone, formatting and line breaks. Reply with ONLY the translation, no explanations, no quotes.`
  const user = sourceLang === 'auto' ? text : `Translate from ${LANG_LABEL[sourceLang] ?? sourceLang} to ${targetLabel}:\n\n${text}`
  const baseURL = openai.baseURL.replace(/\/+$/, '')
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openai.apiKey}`,
    },
    body: JSON.stringify({
      model: openai.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenAI HTTP ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data?.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('OpenAI: empty response')
  }
  return { text: content }
}
