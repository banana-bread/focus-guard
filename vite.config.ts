import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        'service-worker': resolve(__dirname, 'src/service-worker.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
        'blocked/blocked': resolve(__dirname, 'src/blocked/blocked.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'src/popup/popup.html', dest: 'popup' },
        { src: 'src/popup/popup.css', dest: 'popup' },
        { src: 'src/blocked/blocked.html', dest: 'blocked' },
        { src: 'src/blocked/blocked.css', dest: 'blocked' },
      ],
    }),
  ],
});
