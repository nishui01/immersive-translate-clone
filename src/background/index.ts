import { getSettings, saveSettings } from '../utils/storage'
import { translate, translateBatch } from '../services'
import type { RuntimeMessage, TabState } from '../types'

// Per-tab translation state (kept in memory; not persisted).
const tabStates = new Map<number, TabState>()

function setBadge(tabId: number, enabled: boolean) {
  const text = enabled ? 'ON' : ''
  try {
    chrome.action.setBadgeText({ text, tabId })
    chrome.action.setBadgeBackgroundColor({ color: '#4F46E5', tabId })
  } catch {
    // ignore (e.g. during startup)
  }
}

function getTabState(tabId: number): TabState {
  return tabStates.get(tabId) ?? { enabled: false, translated: false, count: 0 }
}

function setTabState(tabId: number, patch: Partial<TabState>) {
  const next = { ...getTabState(tabId), ...patch }
  tabStates.set(tabId, next)
  setBadge(tabId, next.enabled)
}

async function sendToActiveTab(message: RuntimeMessage): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id != null) {
    try {
      await chrome.tabs.sendMessage(tab.id, message)
    } catch {
      // content script may not be loaded (e.g. chrome:// pages); ignore
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  // Seed default settings on first install.
  await getSettings()
  // Context menu: translate selection.
  try {
    chrome.contextMenus.create({
      id: 'translate-selection',
      title: '翻译选中文本 (Translate selection)',
      contexts: ['selection'],
    })
  } catch {
    // already exists
  }
  // Context menu: open the current PDF page in our translator viewer.
  // documentUrlPatterns restricts it to .pdf URLs so it only shows up where it's useful.
  try {
    chrome.contextMenus.create({
      id: 'translate-pdf-page',
      title: '📄 用沉浸式翻译打开此 PDF',
      contexts: ['page'],
      documentUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*', '*://*/*.pdf#*', 'file:///*.pdf'],
    })
  } catch {
    // already exists
  }
  // Context menu: open a PDF link target in our translator viewer.
  try {
    chrome.contextMenus.create({
      id: 'translate-pdf-link',
      title: '📄 用沉浸式翻译打开此 PDF 链接',
      contexts: ['link'],
      targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*', '*://*/*.pdf#*', 'file:///*.pdf'],
    })
  } catch {
    // already exists
  }
  // Context menu: a general entry that opens the viewer (file picker) from any page.
  try {
    chrome.contextMenus.create({
      id: 'open-pdf-translator',
      title: '📄 打开 PDF 翻译器',
      contexts: ['page'],
    })
  } catch {
    // already exists
  }
})

function openPdfViewer(fileUrl?: string) {
  const viewerBase = chrome.runtime.getURL('src/pdf/viewer.html')
  const viewerUrl = fileUrl ? viewerBase + '?file=' + encodeURIComponent(fileUrl) : viewerBase
  void chrome.tabs.create({ url: viewerUrl })
}

// Keyboard shortcut: toggle translation on the active tab.
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-translation') return
  const settings = await getSettings()
  const next = !settings.enabled
  await saveSettings({ enabled: next })
  await sendToActiveTab({ type: 'TOGGLE_TRANSLATION' })
})

// Context menu: translate selection in the active tab.
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'translate-selection': {
      if (!tab?.id) return
      try {
        void chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_SELECTION_CONTEXT' })
      } catch {
        // ignore
      }
      return
    }
    case 'translate-pdf-page': {
      // Open the current page's URL in our viewer.
      const url = info.pageUrl || tab?.url
      if (url) openPdfViewer(url)
      return
    }
    case 'translate-pdf-link': {
      // Open the link target in our viewer.
      if (info.linkUrl) openPdfViewer(info.linkUrl)
      return
    }
    case 'open-pdf-translator': {
      openPdfViewer()
      return
    }
  }
})

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  // Use an async IIFE and return true to keep the channel open.
  ;(async () => {
    const tabId = sender.tab?.id
    switch (message.type) {
      case 'TRANSLATE_TEXT': {
        try {
          const result = await translate(message.payload)
          sendResponse({ ok: true, result })
        } catch (err) {
          sendResponse({ ok: false, error: (err as Error).message })
        }
        break
      }
      case 'TRANSLATE_BATCH': {
        try {
          const { items, sourceLang, targetLang, service, openai } = message.payload
          const results = await translateBatch(items, sourceLang, targetLang, service, openai)
          sendResponse({ ok: true, results })
        } catch (err) {
          sendResponse({ ok: false, error: (err as Error).message })
        }
        break
      }
      case 'GET_STATE': {
        const settings = await getSettings()
        sendResponse({ ok: true, settings })
        break
      }
      case 'SET_STATE': {
        const next = await saveSettings(message.payload)
        // Broadcast to every tab so they update live.
        broadcast({ type: 'SET_STATE', payload: message.payload }).catch(() => {})
        sendResponse({ ok: true, settings: next })
        break
      }
      case 'TOGGLE_TRANSLATION': {
        const settings = await getSettings()
        const next = !settings.enabled
        await saveSettings({ enabled: next })
        // Broadcast to every tab so they all follow the master toggle.
        await broadcast({ type: 'SET_STATE', payload: { enabled: next } })
        sendResponse({ ok: true, enabled: next })
        break
      }
      case 'TRANSLATE_PAGE_FROM_POPUP': {
        if (tabId != null) {
          setTabState(tabId, { enabled: message.payload.enabled })
        }
        sendResponse({ ok: true })
        break
      }
      case 'PAGE_TRANSLATED': {
        if (tabId != null) {
          setTabState(tabId, { translated: true, count: message.payload.count, enabled: getTabState(tabId).enabled || true })
        }
        sendResponse({ ok: true })
        break
      }
      case 'GET_TAB_STATE': {
        if (tabId != null) {
          sendResponse({ ok: true, tabState: getTabState(tabId) })
        } else {
          sendResponse({ ok: true, tabState: { enabled: false, translated: false, count: 0 } })
        }
        break
      }
      default: {
        sendResponse({ ok: false, error: 'unknown message type' })
      }
    }
  })()
  return true // keep message channel open for async response
})

async function broadcast(message: RuntimeMessage) {
  const tabs = await chrome.tabs.query({})
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return
      try {
        await chrome.tabs.sendMessage(tab.id, message)
      } catch {
        // ignore tabs without our content script
      }
    }),
  )
}

// Clean up state when a tab is closed.
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId)
})
