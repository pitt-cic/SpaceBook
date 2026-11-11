import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Relative asset paths: the private-repo Pages URL serves from the site root,
// while a public repo would serve from /SpaceBook/. './' works for both.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
})
