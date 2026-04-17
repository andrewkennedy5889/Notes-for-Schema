import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@server': path.resolve(__dirname, 'server'),
    },
  },
  build: {
    // Split third-party libs into named chunks so they cache independently
    // and parallel-load, trimming the single 900kB+ bundle down.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('react-router') || /[\\/]node_modules[\\/]react[\\/]/.test(id) || /[\\/]node_modules[\\/]scheduler[\\/]/.test(id)) {
            return 'vendor-react';
          }
          if (id.includes('@dnd-kit')) return 'vendor-dnd';
          if (id.includes('lucide-react')) return 'vendor-icons';
          return undefined;
        },
      },
    },
    // Raise the noise-floor; our chunks are now well-split.
    chunkSizeWarningLimit: 700,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/images': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      '/prototypes': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
});
