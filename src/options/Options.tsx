import { useEffect, useState } from 'react'
import type { DisplayMode, ServiceId, Settings, TranslateResult } from '../types'
import { DEFAULT_SETTINGS, LANGUAGES } from '../config'
import { getSettings, saveSettings } from '../utils/storage'

function send<T = unknown>(message: unknown): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message as never, (res) => resolve(res as T))
  })
}

export default function Options() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [testText, setTestText] = useState('Hello, this is a test of the immersive translation extension.')
  const [testOut, setTestOut] = useState('')
  const [testing, setTesting] = useState(false)
  const [testErr, setTestErr] = useState('')

  useEffect(() => {
    getSettings().then((v) => {
      setS(v)
      setLoaded(true)
    })
  }, [])

  async function update(patch: Partial<Settings>) {
    const next = { ...s, ...patch, openai: { ...s.openai, ...(patch.openai ?? {}) } }
    setS(next)
    await saveSettings(patch)
    setSavedAt(Date.now())
  }

  async function runTest() {
    setTesting(true)
    setTestErr('')
    setTestOut('')
    const res = await send<{ ok: boolean; result?: TranslateResult; error?: string }>({
      type: 'TRANSLATE_TEXT',
      payload: {
        text: testText,
        sourceLang: s.sourceLang,
        targetLang: s.targetLang,
        service: s.service,
        openai: s.openai,
      },
    })
    if (res?.ok && res.result) {
      setTestOut(res.result.text)
    } else {
      setTestErr(res?.error || '翻译失败')
    }
    setTesting(false)
  }

  if (!loaded) return <div className="loading">加载中…</div>

  return (
    <div className="container">
      <h1>沉浸式翻译 · 设置</h1>

      <section className="card">
        <h2>通用</h2>
        <div className="grid">
          <label className="field">
            <span>目标语言</span>
            <select value={s.targetLang} onChange={(e) => update({ targetLang: e.target.value })}>
              {LANGUAGES.filter((l) => l.code !== 'auto').map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>源语言</span>
            <select value={s.sourceLang} onChange={(e) => update({ sourceLang: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>显示方式</span>
            <select value={s.displayMode} onChange={(e) => update({ displayMode: e.target.value as DisplayMode })}>
              <option value="dual">双语对照</option>
              <option value="translationOnly">仅显示译文</option>
            </select>
          </label>
          <label className="field">
            <span>译文字号 (%)</span>
            <input type="number" min={50} max={150} value={s.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) || 90 })} />
          </label>
          <label className="field">
            <span>译文颜色</span>
            <input type="color" value={s.translationColor}
              onChange={(e) => update({ translationColor: e.target.value })} />
          </label>
        </div>
        <div className="switches">
          <label className="switch">
            <input type="checkbox" checked={s.autoTranslate}
              onChange={(e) => update({ autoTranslate: e.target.checked })} />
            <span>访问网页时自动翻译</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={s.translateSelection}
              onChange={(e) => update({ translateSelection: e.target.checked })} />
            <span>划词翻译（选中文字后显示译文）</span>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>翻译服务</h2>
        <label className="field">
          <span>服务</span>
          <select value={s.service} onChange={(e) => update({ service: e.target.value as ServiceId })}>
            <option value="google">Google 翻译（免费，无需配置）</option>
            <option value="microsoft">微软翻译（免费，无需配置）</option>
            <option value="openai">AI 大模型（OpenAI 兼容，需配置）</option>
          </select>
        </label>

        {s.service === 'openai' && (
          <div className="grid ai">
            <label className="field full">
              <span>API Key</span>
              <input type="password" value={s.openai.apiKey} placeholder="sk-..."
                onChange={(e) => update({ openai: { ...s.openai, apiKey: e.target.value } })} />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input type="text" value={s.openai.baseURL} placeholder="https://api.openai.com/v1"
                onChange={(e) => update({ openai: { ...s.openai, baseURL: e.target.value } })} />
            </label>
            <label className="field">
              <span>模型</span>
              <input type="text" value={s.openai.model} placeholder="gpt-4o-mini"
                onChange={(e) => update({ openai: { ...s.openai, model: e.target.value } })} />
            </label>
            <p className="tip">支持任何兼容 OpenAI Chat Completions 的接口，例如 OpenAI、DeepSeek、Moonshot、本地 Ollama 等。</p>
          </div>
        )}
      </section>

      <section className="card">
        <h2>翻译测试</h2>
        <textarea rows={3} value={testText} onChange={(e) => setTestText(e.target.value)} />
        <button className="btn" onClick={runTest} disabled={testing}>{testing ? '翻译中…' : '测试翻译'}</button>
        {testErr && <p className="error">⚠ {testErr}</p>}
        {testOut && <p className="ok">译文：{testOut}</p>}
      </section>

      <section className="card">
        <h2>域名规则</h2>
        <label className="field full">
          <span>始终翻译（每行一个域名，如 example.com）</span>
          <textarea rows={3} value={s.alwaysTranslate.join('\n')}
            onChange={(e) => update({ alwaysTranslate: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
        </label>
        <label className="field full">
          <span>永不翻译（每行一个域名）</span>
          <textarea rows={3} value={s.neverTranslate.join('\n')}
            onChange={(e) => update({ neverTranslate: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
        </label>
      </section>

      <p className="saved">{savedAt ? '✓ 设置已保存' : ''}</p>
    </div>
  )
}
