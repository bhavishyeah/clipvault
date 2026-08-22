# VOLT

The fastest way to move anything between devices. Save text, links, and images from one device, access them instantly from another.

## Tech Stack

- **Frontend:** React 19 + Vite 8
- **Auth & Database:** Supabase (PostgreSQL, Row Level Security, Realtime)
- **Image Storage:** Cloudinary
- **PWA:** vite-plugin-pwa (installable on Android)
- **Hosting:** Vercel

## Getting Started

```bash
npm install
npm run dev
```

### Environment Variables

```
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_CLOUDINARY_CLOUD_NAME=your-cloud-name
VITE_CLOUDINARY_UPLOAD_PRESET=your-upload-preset
```

Vercel also needs: `SUPABASE_SERVICE_ROLE_KEY`

## Features

- Email/password + QR anonymous login
- Username system (@username identity)
- Global paste detection (Ctrl+V)
- Image upload (JPG/PNG, 10MB max)
- Real-time cross-device sync
- Pin, search, sort, edit, delete clips
- Drag-and-drop reorder for pinned clips
- Optimistic UI, undo delete, duplicate detection
- Code snippet detection
- Dark/light theme
- Bulk actions, export vault
- Rate limiting, analytics
- Error boundary, offline caching
- Installable PWA

## Deployment

Auto-deploys via GitHub → Vercel.

## License

Private project.
