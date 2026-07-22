// Shared types across the extension.

export type ServiceId = 'google' | 'microsoft' | 'openai'

export interface ServiceConfig {
  id: ServiceId
  label: string
  needsKey: boolean
  // For AI services: base URL + model + key
  apiKey?: string
  baseURL?: string
  model?: string
}

export type DisplayMode = 'dual' | 'translationOnly' | 'originalOnly'

export interface Settings {
  enabled: boolean
  targetLang: string
  sourceLang: string // 'auto' by default
  service: ServiceId
  displayMode: DisplayMode
  // style
  fontSize: number // percentage relative to original, e.g. 90
  translationColor: string
  showOriginal: boolean
  // domain rules
  alwaysTranslate: string[]
  neverTranslate: string[]
  // AI service config
  openai: {
    apiKey: string
    baseURL: string
    model: string
  }
  // behaviour
  translateSelection: boolean
  autoTranslate: boolean
}

export interface TranslateRequest {
  text: string
  sourceLang: string
  targetLang: string
  service: ServiceId
  openai: Settings['openai']
}

export interface TranslateResult {
  text: string
  detected?: string
  fromCache?: boolean
}

// Messages between content script / popup / options and the background worker.
export type RuntimeMessage =
  | { type: 'TRANSLATE_TEXT'; payload: TranslateRequest }
  | { type: 'TRANSLATE_BATCH'; payload: { items: string[]; sourceLang: string; targetLang: string; service: ServiceId; openai: Settings['openai'] } }
  | { type: 'GET_STATE' }
  | { type: 'SET_STATE'; payload: Partial<Settings> }
  | { type: 'TOGGLE_TRANSLATION' }
  | { type: 'TRANSLATE_PAGE_FROM_POPUP'; payload: { enabled: boolean } }
  | { type: 'PAGE_TRANSLATED'; payload: { count: number } }
  | { type: 'GET_TAB_STATE' }
  | { type: 'TRANSLATE_SELECTION_CONTEXT' }

export interface TabState {
  enabled: boolean
  translated: boolean
  count: number
}
