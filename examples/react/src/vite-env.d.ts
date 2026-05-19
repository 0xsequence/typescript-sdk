/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OMS_PUBLIC_API_KEY?: string
  readonly VITE_OMS_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
