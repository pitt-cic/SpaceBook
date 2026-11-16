import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from GitHub Pages at https://pitt-cic.github.io/SpaceBook/
// The deploy workflow overrides this with `--base` using the path from
// actions/configure-pages, so CI always matches the actual Pages URL.
// Relative "./" breaks when the page is opened at a sub-path such as /SpaceBook/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/SpaceBook/',
})
