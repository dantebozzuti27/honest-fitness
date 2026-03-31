import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Keep vendor chunks stable for better long-term caching.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          cognito: ['amazon-cognito-identity-js'],
          idb: ['idb'],
        }
      }
    }
  }
})
