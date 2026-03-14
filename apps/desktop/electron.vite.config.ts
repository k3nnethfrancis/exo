import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      outDir: "dist/main",
    },
    plugins: [externalizeDepsPlugin({ exclude: ["@exo/core"] })],
    resolve: {
      alias: {
        "@shared": path.resolve(currentDirectory, "src/shared"),
      },
    },
  },
  preload: {
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        output: {
          entryFileNames: "index.js",
          format: "cjs",
        },
      },
    },
    plugins: [externalizeDepsPlugin({ exclude: ["@exo/core"] })],
    resolve: {
      alias: {
        "@shared": path.resolve(currentDirectory, "src/shared"),
      },
    },
  },
  renderer: {
    build: {
      outDir: "dist/renderer",
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": path.resolve(currentDirectory, "src/renderer/src"),
        "@shared": path.resolve(currentDirectory, "src/shared"),
      },
    },
  },
});
