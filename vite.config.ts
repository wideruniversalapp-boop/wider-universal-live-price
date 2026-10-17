import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Emulator exports and backups are large and rewritten often; watching them also blocks
    // the emulator's export rename on Windows.
    watch: { ignored: ['**/.emulator-data/**', '**/firebase-export-*/**', '**/backups/**', '**/extraction/**', '**/data/**'] },
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          pdf: ['jspdf', 'jspdf-autotable'],
          sheets: ['xlsx', 'papaparse'],
        },
      },
    },
  },
});
