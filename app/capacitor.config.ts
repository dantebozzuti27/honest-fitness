import type { CapacitorConfig } from '@capacitor/cli'

/**
 * iOS App Store submission requires a native wrapper.
 * This config enables packaging the existing Vite build (`dist/`) into a Capacitor iOS app.
 *
 * After installing deps:
 * - `npm run ios:build`
 * - `npx cap add ios`  (first time, generates ios/ folder)
 * - `npm run cap:open:ios`
 */
const config: CapacitorConfig = {
  appId: 'com.honestfitness.app',
  appName: 'HonestFitness',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // Keep the default production behavior (load bundled assets).
    // Dev live-reload can be enabled locally via `npx cap run ios -l --external`.
  }
}

export default config


