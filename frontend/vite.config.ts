import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@tiptap")) return "editor";
          if (id.includes("katex")) return "math";
          return "vendor";
        },
      },
    },
  },
});
