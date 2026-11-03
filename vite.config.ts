import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./",
  build: {
    rollupOptions: {
      input: {
        popup: "popup.html",
        content: "src/content/content.ts",
        "page-toolbar": "src/content/page-toolbar.ts",
        background: "src/background/background.ts",
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
