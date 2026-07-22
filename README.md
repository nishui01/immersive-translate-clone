# 沉浸式翻译 · Immersive Translate Clone

一个受 [沉浸式翻译](https://immersivetranslate.com/) 启发的双语网页翻译浏览器扩展（Chrome / Edge，Manifest V3）。在任意网页原文下方显示译文，支持划词翻译、多种翻译服务与 AI 大模型翻译。

## ✨ 功能特性

- **双语对照翻译** — 自动识别网页段落，在原文下方注入译文，保留原排版。
- **划词翻译** — 选中任意文字，自动弹出译文气泡。
- **右键翻译** — 选中文字后通过右键菜单翻译。
- **快捷键开关** — `Alt+T` 一键开关当前页面翻译。
- **多种翻译服务**
  - Google 翻译（免费，开箱即用，无需配置）
  - 微软翻译（免费，无需配置）
  - AI 大模型翻译（OpenAI 兼容接口，支持 OpenAI / DeepSeek / Moonshot / 本地 Ollama 等，需填 API Key）
- **显示模式** — 双语对照 / 仅显示译文。
- **样式可调** — 译文颜色、字号自定义。
- **域名规则** — 始终翻译 / 永不翻译指定站点。
- **动态内容** — MutationObserver 自动翻译动态加载的内容。
- **翻译缓存** — 后台 Service Worker 内存缓存，减少重复请求。

## 📦 安装

### 方式一：加载已构建版本

1. 运行 `npm install && npm run build`，生成 `dist/` 目录。
2. 打开 Chrome / Edge → 地址栏输入 `chrome://extensions`。
3. 打开右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择项目下的 `dist` 目录。
5. 扩展图标出现在工具栏，点击即可使用。

### 方式二：开发模式（热更新）

```bash
npm install
npm run dev
```

按终端提示加载扩展，修改源码会自动重载。

## 🚀 使用

1. 打开任意外文网页，点击工具栏扩展图标 → 「开启翻译」，或按 `Alt+T`。
2. 译文会逐段出现在原文下方。
3. 选中文字会自动弹出译文气泡。
4. 点击弹窗内「⚙ 高级设置」进入设置页：
   - 切换翻译服务、目标语言、显示模式、样式。
   - 使用 AI 大模型时填写 API Key / Base URL / 模型名。
   - 配置域名规则。
   - 在「翻译测试」区域验证服务是否可用。

## 🛠 技术栈

- **Manifest V3** Service Worker + Content Script
- **TypeScript** + **Vite** + [@crxjs/vite-plugin](https://github.com/crxjs/crxjs)
- **React**（弹窗与设置页 UI）

## 📁 项目结构

```
src/
├── background/      # Service Worker：翻译 API 代理、消息中枢、状态、快捷键、右键菜单
│   └── index.ts
├── content/         # 内容脚本：DOM 段落识别、双语注入、MutationObserver、划词翻译
│   ├── index.ts
│   ├── dom.ts
│   ├── page-translator.ts
│   ├── selection.ts
│   ├── messaging.ts
│   └── style.ts
├── services/        # 翻译服务实现（Google / Microsoft / OpenAI 兼容）+ 批量与缓存
│   ├── google.ts
│   ├── microsoft.ts
│   ├── openai.ts
│   └── index.ts
├── popup/           # 工具栏弹窗（React）
├── options/         # 设置页（React）
├── utils/           # Chrome storage 封装
├── config.ts        # 默认设置与语言列表
└── types/           # 共享类型
```

## ⚙️ 工作原理

1. **内容脚本**在页面加载后读取设置，按需翻译。通过 `TreeWalker` 收集值得翻译的块级文本元素（`p`/`h1-h6`/`li`/`blockquote`/`td` 等，以及纯文本叶子 `div`/`span`），跳过代码、表单、脚本及已翻译节点。
2. 文本按 20 条一批经消息发送到 **后台 Service Worker**，由其调用翻译服务（避免 CORS、统一限流与缓存）。
3. 译文以 `<span class="it-translation">` 注入原文元素内部，逐批填充，实现渐进式翻译。
4. `MutationObserver` 监听新增节点，去抖后增量翻译。
5. 语言启发式判断跳过「目标语言与原文一致」的段落，减少无意义请求。

## 📝 说明

- 免费 Google / 微软接口为非官方端点，仅用于学习交流，可能受限于速率或可用性，请勿用于商业场景。
- AI 大模型翻译质量更高，但需自备 API Key 且按量计费。

## 📄 License

MIT
