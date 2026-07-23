import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  targetLang: 'zh-CN',
  sourceLang: 'auto',
  service: 'google',
  displayMode: 'dual',
  fontSize: 92,
  translationColor: '#6B7280',
  showOriginal: true,
  alwaysTranslate: [],
  neverTranslate: [],
  openai: {
    apiKey: '',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  translateSelection: true,
  autoTranslate: false,
}

export const STORAGE_KEY = 'settings'

// Languages offered in the UI (code -> label).
export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'auto', label: '自动检测' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁体中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'pl', label: 'Polski' },
  { code: 'nl', label: 'Nederlands' },
]
