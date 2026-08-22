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
        name: 'VOLT',
        short_name: 'VOLT',
        description: 'The fastest way to move anything between devices',
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
        skipWaiting: true,
        clientsClaim: true,

        // Runtime caching for offline support
        runtimeCaching: [
          {
            // Cache Cloudinary images for offline viewing
            urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cloudinary-images',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache Google favicons for link previews
            urlPattern: /^https:\/\/www\.google\.com\/s2\/favicons.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'favicon-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache Fontshare fonts
            urlPattern: /^https:\/\/(api|cdn)\.fontshare\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fontshare-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },

      devOptions: {
        enabled: false,
      },
    }),
  ],
})
