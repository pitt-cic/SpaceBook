import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Absolute base path. The deploy workflow overrides it with `--base` using the
// path from actions/configure-pages: "/" on the private-repo Pages domain,
// "/SpaceBook/" if the repo is public. Relative "./" breaks when the page is
// opened at a sub-path such as /SpaceBook/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
})
