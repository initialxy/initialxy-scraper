import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  if (mode === 'development') {
    return {
      server: {
        port: 5173,
      },
    };
  }
  return {
    build: {
      outDir: path.join(process.cwd(), 'src/renderer/ui'),
      emptyOutDir: false,
      rollupOptions: {
        input: {
          ui_panel: path.join(process.cwd(), 'src/renderer/ui/ui_panel.ts'),
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
  };
});
