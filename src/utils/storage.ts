import { DEFAULT_SETTINGS, STORAGE_KEY } from '../config'
import type { Settings } from '../types'

export async function getSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY], (result) => {
      const stored = result[STORAGE_KEY] as Partial<Settings> | undefined
      resolve({ ...DEFAULT_SETTINGS, ...stored, openai: { ...DEFAULT_SETTINGS.openai, ...(stored?.openai ?? {}) } })
    })
  })
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const next: Settings = {
    ...current,
    ...patch,
    openai: { ...current.openai, ...(patch.openai ?? {}) },
  }
  await new Promise<void>((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: next }, () => resolve())
  })
  return next
}

export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area === 'sync' && changes[STORAGE_KEY]) {
      const stored = changes[STORAGE_KEY].newValue as Partial<Settings>
      cb({ ...DEFAULT_SETTINGS, ...stored, openai: { ...DEFAULT_SETTINGS.openai, ...(stored.openai ?? {}) } })
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
