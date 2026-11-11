import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
    },
    // amazon-cognito-identity-js (and its crypto deps) reference Node's
    // `global`, which the browser doesn't have — Vite needs this alias to
    // load it at all, regardless of which page mounts first.
    define: {
        global: 'globalThis',
    },
});
