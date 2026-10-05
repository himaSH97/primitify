import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        app: resolve(root, 'app.html'),
        index: resolve(root, 'index.html'),
        concept: resolve(root, 'concept.html'),
      },
    },
  },
})