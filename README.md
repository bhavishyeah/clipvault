# ClipVault

A privacy-focused cross-device clipboard vault. Save copied text, links, screenshots, and images from one device, then access them from another.

## Tech Stack

- **Frontend:** React 19 + Vite 8
- **Auth & Database:** Supabase (PostgreSQL, Row Level Security, Realtime)
- **Image Storage:** Cloudinary (new uploads) + Supabase Storage (legacy)
- **PWA:** vite-plugin-pwa (installable on Android)
- **Hosting:** Vercel

## Getting Started

```bash
# Install dependencies
npm install

# Create .env with your credentials
cp .env.example .env

# Start development server
npm run dev
```

### Environment Variables

```
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_CLOUDINARY_CLOUD_NAME=your-cloud-name
VITE_CLOUDINARY_UPLOAD_PRESET=your-upload-preset
```

## Features

- Email/password authentication
- Global paste detection (Ctrl+V on desktop)
- Mobile text/link input with paste box
- Image upload via file picker and drag-and-drop (JPG/PNG, max 10MB)
- Real-time cross-device sync
- Pin, search, filter, copy, download, and delete clips
- Optimistic UI for instant feedback
- Delete confirmation modal
- Toast notifications for all actions
- Dark glassmorphism design
- Fully responsive (desktop + mobile)
- Installable PWA

## Deployment

The project auto-deploys via GitHub → Vercel. Ensure environment variables are set in Vercel project settings before deploying.

## Database

Run `supabase/schema.sql` in the Supabase SQL Editor to set up the `clips` table, RLS policies, storage bucket, and Realtime.

## License

Private project.
