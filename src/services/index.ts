import type { ServiceId, Settings, TranslateRequest, TranslateResult } from '../types'
import { translateGoogle } from './google'
import { translateMicrosoft } from './microsoft'
import { translateOpenAI } from './openai'

// In-memory translation cache (per service-worker lifetime).
const cache = new Map<string, TranslateResult>()
const CACHE_LIMIT = 2000

function cacheKey(service: ServiceId, sl: string, tl: string, text: string) {
  return `${service}|${sl}|${tl}|${text}`
}

function putCache(key: string, value: TranslateResult) {
  if (cache.size >= CACHE_LIMIT) {
    // drop oldest entry (Map preserves insertion order)
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
  cache.set(key, { ...value, fromCache: true })
}

export async function translate(request: TranslateRequest): Promise<TranslateResult> {
  const { text, sourceLang, targetLang, service, openai } = request
  const key = cacheKey(service, sourceLang, targetLang, text)
  const hit = cache.get(key)
  if (hit) return hit

  let result: TranslateResult
  switch (service) {
    case 'google':
      result = await translateGoogle(text, sourceLang, targetLang)
      break
    case 'microsoft':
      result = await translateMicrosoft(text, sourceLang, targetLang)
      break
    case 'openai':
      result = await translateOpenAI(text, sourceLang, targetLang, openai)
      break
    default:
      throw new Error(`Unknown translation service: ${service as string}`)
  }
  putCache(key, result)
  return result
}

// Translate many short paragraphs with a concurrency limit and simple retry.
export async function translateBatch(
  items: string[],
  sourceLang: string,
  targetLang: string,
  service: ServiceId,
  openai: Settings['openai'],
  concurrency = 5,
): Promise<TranslateResult[]> {
  const results: TranslateResult[] = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      const text = items[index]
      try {
        results[index] = await translate({ text, sourceLang, targetLang, service, openai })
      } catch (err) {
        // one retry after a short delay
        try {
          await new Promise((r) => setTimeout(r, 400))
          results[index] = await translate({ text, sourceLang, targetLang, service, openai })
        } catch {
          results[index] = { text: '' }
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
