export {}

declare global {
  interface Window {
    __HF_BOOT_START__?: number
    gtag?: (...args: unknown[]) => void
  }
}


