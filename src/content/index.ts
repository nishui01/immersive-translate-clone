import type { RuntimeMessage, Settings } from '../types'
import { getSettings, onSettingsChanged } from '../utils/storage'
import { pageTranslator } from './page-translator'
import { initSelectionTranslation, updateSelectionSettings, translateSelection } from './selection'

function hostname(): string {
  try {
    return location.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function matchesDomain(list: string[], host: string): boolean {
  if (!host) return false
  return list.some((entry) => {
    const e = entry.trim().toLowerCase().replace(/^www\./, '')
    if (!e) return false
    return host === e || host.endsWith('.' + e)
  })
}

function effectiveEnabled(settings: Settings): boolean {
  const host = hostname()
  if (matchesDomain(settings.neverTranslate, host)) return false
  if (matchesDomain(settings.alwaysTranslate, host)) return true
  return settings.enabled || settings.autoTranslate
}

async function bootstrap() {
  const settings = await getSettings()
  pageTranslator.configure(settings)
  initSelectionTranslation(settings)

  if (effectiveEnabled(settings)) {
    pageTranslator.enable()
  }

  // React to live setting changes from other contexts (options page, popup).
  onSettingsChanged((next) => {
    pageTranslator.configure(next)
    updateSelectionSettings(next)
    const want = effectiveEnabled(next)
    if (want && !pageTranslator.enabled) pageTranslator.enable()
    else if (!want && pageTranslator.enabled) pageTranslator.disable()
  })
}

// Handle control messages from the background / popup.
chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  ;(async () => {
    switch (message.type) {
      case 'TOGGLE_TRANSLATION': {
        const settings = await getSettings()
        pageTranslator.configure(settings)
        const want = effectiveEnabled(settings)
        if (want && !pageTranslator.enabled) pageTranslator.enable()
        else if (!want && pageTranslator.enabled) pageTranslator.disable()
        sendResponse({ ok: true, enabled: pageTranslator.enabled })
        break
      }
      case 'SET_STATE': {
        const settings = await getSettings()
        pageTranslator.configure(settings)
        updateSelectionSettings(settings)
        const want = effectiveEnabled(settings)
        if (want && !pageTranslator.enabled) pageTranslator.enable()
        else if (!want && pageTranslator.enabled) pageTranslator.disable()
        sendResponse({ ok: true })
        break
      }
      case 'TRANSLATE_SELECTION_CONTEXT': {
        void translateSelection()
        sendResponse({ ok: true })
        break
      }
      default:
        sendResponse({ ok: true })
    }
  })()
  return true
})

void bootstrap()
