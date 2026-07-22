import { useEffect, useState } from 'react'
import type { RuntimeMessage, Settings } from '../types'
import { DEFAULT_SETTINGS, LANGUAGES } from '../config'

function send<T = unknown>(message: RuntimeMessage): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => resolve(res as T))
  })
}

export default function Popup() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    send<{ ok: boolean; settings: Settings }>({ type: 'GET_STATE' }).then((res) => {
      if (res?.ok) setSettings(res.settings)
    })
    const listener = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'sync' && changes.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...changes.settings.newValue })
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  async function toggle() {
    setBusy(true)
    const res = await send<{ ok: boolean; enabled: boolean }>({ type: 'TOGGLE_TRANSLATION' })
    if (res?.ok) setSettings((s) => ({ ...s, enabled: res.enabled }))
    setBusy(false)
  }

  async function patch(p: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...p }))
    await send<{ ok: boolean }>({ type: 'SET_STATE', payload: p })
  }

  function openOptions() {
    chrome.runtime.openOptionsPage()
  }

  return (
    <div className="wrap">
      <header>
        <span className="logo">译</span>
        <span className="title">沉浸式翻译</span>
      </header>

      <button className={`toggle ${settings.enabled ? 'on' : ''}`} onClick={toggle} disabled={busy}>
        {busy ? '处理中…' : settings.enabled ? '✓ 翻译已开启' : '开启翻译'}
      </button>

      <div className="row">
        <label>目标语言</label>
        <select value={settings.targetLang} onChange={(e) => patch({ targetLang: e.target.value })}>
          {LANGUAGES.filter((l) => l.code !== 'auto').map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <label>翻译服务</label>
        <select value={settings.service} onChange={(e) => patch({ service: e.target.value as Settings['service'] })}>
          <option value="google">Google（免费）</option>
          <option value="microsoft">微软（免费）</option>
          <option value="openai">AI 大模型</option>
        </select>
      </div>

      <div className="row">
        <label>显示方式</label>
        <select value={settings.displayMode} onChange={(e) => patch({ displayMode: e.target.value as Settings['displayMode'] })}>
          <option value="dual">双语对照</option>
          <option value="translationOnly">仅译文</option>
        </select>
      </div>

      <div className="footer">
        <button className="link" onClick={openOptions}>
          ⚙ 高级设置
        </button>
        <span className="hint">Alt+T 快捷开关</span>
      </div>
    </div>
  )
}
