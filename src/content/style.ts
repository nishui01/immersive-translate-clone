import type { Settings } from '../types'

const STYLE_ID = 'it-style'

// Inject (or refresh) the extension's CSS based on current style settings.
export function applyStyle(settings: Settings) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.documentElement.appendChild(style)
  }
  const color = settings.translationColor || '#4b5563'
  const fontSize = settings.fontSize || 92
  style.textContent = `
    /* Translation block — used for both sibling-inserted and child-inserted modes.
       Key layout goals:
       - display:block so the translation always lives on its own line
       - clear:both so a floating image inside the original paragraph can't push
         the translation to the right or make it wrap early
       - No explicit width: block elements naturally fill their container's
         content width, and setting width:100% can cause overflow in padded
         or flex containers (leading to the "top-left corner" bug)
       - inherit text-align so the translation follows the original alignment
    */
    .it-translation {
      display: block !important;
      clear: both !important;
      margin: 4px 0 0 !important;
      padding: 0 !important;
      color: ${color} !important;
      font-size: ${fontSize}% !important;
      line-height: 1.65 !important;
      font-weight: 400 !important;
      font-style: normal !important;
      text-align: inherit !important;
      text-indent: 0 !important;
      letter-spacing: normal !important;
      word-break: break-word;
      overflow-wrap: break-word;
      hyphens: none;
      transition: opacity 0.2s ease;
    }
    .it-translation.it-loading {
      opacity: 0.55;
      font-style: italic !important;
    }
    .it-translation.it-error {
      color: #dc2626 !important;
      font-size: 80% !important;
    }
    /* Selection popup — uses position:absolute (set inline) so it works even
       when an ancestor has transform/filter (which would break position:fixed) */
    #it-sel-popup {
      position: absolute;
      z-index: 2147483647;
      max-width: 420px;
      min-width: 160px;
      padding: 10px 14px;
      background: #ffffff;
      color: #111827;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.18);
      font-size: 14px;
      line-height: 1.55;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #it-sel-popup .it-sel-src { color: #6b7280; font-size: 12px; margin-bottom: 4px; }
    #it-sel-popup .it-sel-dst { color: ${color}; }
    #it-sel-popup .it-sel-loading { color: #9ca3af; font-style: italic; }
    #it-sel-popup .it-sel-close {
      position: absolute; top: 4px; right: 8px; cursor: pointer;
      color: #9ca3af; font-size: 14px; line-height: 1;
    }
    /* Floating "Translate this PDF" badge injected on native PDF viewer pages */
    #it-pdf-fab {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 18px;
      border: none;
      border-radius: 28px;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      box-shadow: 0 6px 20px rgba(79, 70, 229, 0.45);
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    #it-pdf-fab:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 28px rgba(79, 70, 229, 0.55);
    }
  `
}

export function removeStyle() {
  document.getElementById(STYLE_ID)?.remove()
}
