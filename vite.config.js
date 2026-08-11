import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import blobAssetPlugin from "./vite-plugin-blob.js";
import svgUse from "./vite-plugin-svg-use.js";
import { VitePWA } from "vite-plugin-pwa";

const host = process.env.TAURI_DEV_HOST;
const isTauri = !!process.env.TAURI_DEV_HOST || !!process.env.TAURI_ENV_PLATFORM;

const tauriPwaStub = () => ({
  name: 'tauri-pwa-stub',
  resolveId(id) {
    if (isTauri && id === 'virtual:pwa-register') return id;
  },
  load(id) {
    if (isTauri && id === 'virtual:pwa-register') return 'export const registerSW = () => {};';
  }
});

export default defineConfig(async () => ({
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  plugins: [
    tauriPwaStub(),
    react(),
    blobAssetPlugin(),
    svgUse(),
    !isTauri && VitePWA({ registerType: 'autoUpdate' }),
  ].filter(Boolean),

  clearScreen: false,

  base: "./",

  resolve: {
    alias: {
      "!lucide": "/node_modules/lucide-static/icons",
      "!simpleicons": "/node_modules/simple-icons/icons",
      "!": "/node_modules",

      events: "/node_modules/events/events.js",
    },
  },

  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },

  worker: {
    format: "es",
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));