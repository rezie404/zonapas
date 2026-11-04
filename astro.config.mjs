import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://zonapas.web.id',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
