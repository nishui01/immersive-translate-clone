import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    target: 'es2020',
    rollupOptions: {
      // Explicitly include the PDF viewer HTML as a build entry so Vite
      // processes its <script src="./viewer.ts"> and <link href="./viewer.css">
      // references. Without this, @crxjs copies the HTML verbatim and the
      // referenced TS/CSS files are never compiled — resulting in a blank page.
      input: {
        viewer: resolve(__dirname, 'src/pdf/viewer.html'),
      },
      output: {
        chunkFileNames: 'assets/chunk-[hash].js',
      },
    },
  },
})
