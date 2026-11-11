import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from GitHub Pages at https://pitt-cic.github.io/SpaceBook/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/SpaceBook/',
})
