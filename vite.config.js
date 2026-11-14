import { defineConfig } from 'vite';

// The game and the database view both call /api. In development Vite forwards it to `npm run api`.
const proxy = { '/api': process.env.BAKERY_API || 'http://127.0.0.1:8080' };
export default defineConfig({
  server: { proxy },
  preview: { proxy },
  base: './',
  // Phaser is one ~1.5 MB chunk; that is expected for a game.
  build: { chunkSizeWarningLimit: 1600, rollupOptions: { input: { game: 'index.html', demo: 'demo.html' } } },
});
