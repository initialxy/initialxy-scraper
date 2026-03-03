import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    outDir: path.join(process.cwd(), 'src/renderer'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        ui_panel: path.join(process.cwd(), 'src/renderer/ui_panel.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
    sourcemap: false,
    minify: false,
  },
});
