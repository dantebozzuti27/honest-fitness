import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js (and a few of its transitive deps) reference
  // Node's `global` object directly. Browsers don't expose `global`; the
  // canonical Vite fix is to alias it to `globalThis`. Without this the dev
  // server crashes on first auth import with "ReferenceError: global is not
  // defined". Production builds work because Rollup tree-shakes the offending
  // path differently, but dev needs the explicit shim.
  define: {
    global: 'globalThis',
  },
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
