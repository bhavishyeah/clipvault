import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: [
        'favicon.svg',
        'icons.svg',
      ],

      manifest: {
        name: 'ClipVault',
        short_name: 'ClipVault',
        description: 'Your private cross-device clipboard vault',
        theme_color: '#08090f',
        background_color: '#08090f',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities'],

 icons: [
  {
    src: '/pwa-192.png',
    sizes: '192x192',
    type: 'image/png',
    purpose: 'any maskable',
  },
  {
    src: '/pwa-512.png',
    sizes: '512x512',
    type: 'image/png',
    purpose: 'any maskable',
  },
],
        share_target: {
  action: '/',
  method: 'GET',
  enctype: 'application/x-www-form-urlencoded',
  params: {
    title: 'title',
    text: 'text',
    url: 'url',
  },
},
      },

     workbox: {
  cleanupOutdatedCaches: true,
  navigateFallback: '/index.html',
},

      devOptions: {
        enabled: true,
      },
    }),
  ],
})