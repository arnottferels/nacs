import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/nacs/" : "/",
  plugins: [react(), tailwindcss(), mkcert()],
  optimizeDeps: {
    exclude: ["@undecaf/barcode-detector-polyfill", "@undecaf/zbar-wasm"],
  },
  preview: {
    port: 4321,
    strictPort: true,
    host: true,
    cors: true,
    allowedHosts: true,
  },
  server: {
    port: 4321,
    strictPort: true,
    host: true,
    cors: true,
    allowedHosts: true,
  },
}));
