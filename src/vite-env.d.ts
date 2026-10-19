/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  // Test builds only (the iOS Simulator workflow): see lib/apiBase.ts.
  readonly VITE_E2E_ALLOW_NATIVE_LOOPBACK?: string
  readonly VITE_BUILD_TIME: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
