import type { RuntimeMessage, Settings, TranslateRequest, TranslateResult } from '../types'

export function sendMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response as T)
      })
    } catch {
      resolve(undefined as unknown as T)
    }
  })
}

export async function translateViaBg(request: TranslateRequest): Promise<TranslateResult | null> {
  const res = await sendMessage<{ ok: boolean; result?: TranslateResult; error?: string }>({
    type: 'TRANSLATE_TEXT',
    payload: request,
  })
  return res?.ok ? res.result ?? null : null
}

export async function translateBatchViaBg(
  items: string[],
  settings: Settings,
): Promise<TranslateResult[]> {
  const res = await sendMessage<{ ok: boolean; results?: TranslateResult[]; error?: string }>({
    type: 'TRANSLATE_BATCH',
    payload: {
      items,
      sourceLang: settings.sourceLang,
      targetLang: settings.targetLang,
      service: settings.service,
      openai: settings.openai,
    },
  })
  return res?.ok ? res.results ?? [] : []
}
