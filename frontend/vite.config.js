import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    proxy: {
      '/ws': {
        target: 'http://127.0.0.1:3000',
        ws: true
      },
      '/api': {
        target: 'http://127.0.0.1:3000'
      }
    }
  }
})
