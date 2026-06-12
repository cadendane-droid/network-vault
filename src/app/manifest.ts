import type { MetadataRoute } from 'next';

// TODO: Drop the real icon PNGs into public/ — Chrome won't report the app
// as installable until these four files exist:
//   public/icon-192.png          — 192×192
//   public/icon-512.png          — 512×512
//   public/icon-maskable-512.png — 512×512, artwork inside the maskable safe zone
//   public/apple-touch-icon.png  — 180×180 (referenced from src/app/layout.tsx)

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Almura',
    short_name: 'Almura',
    description: 'Know your people, deeply.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F4ECDD',
    theme_color: '#B95B35', // --terracotta-500, oklch(0.578 0.132 42) in sRGB
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
