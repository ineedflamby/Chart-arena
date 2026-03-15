/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_WS_URL?: string;
    readonly VITE_RPC_URL?: string;
    readonly VITE_ESCROW?: string;
    readonly VITE_MOTO?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
