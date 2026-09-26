# ALAMKAROK MVP

A mobile-friendly internet-based shared YouTube queue. One host phone displays the YouTube player; everyone in the room sees the shared queue, adds links, and can press Previous / Play-Pause / Next / Shuffle.

## What is included
- Create room + 5-character room code
- QR code for joining
- Required participant name
- Automatic participant colors
- Shared real-time queue
- Everyone can add YouTube links
- Everyone can use Previous / Play-Pause / Next
- Everyone can shuffle the queue
- Host-only YouTube player
- Automatic next video when a video ends

## Setup
1. Create a free Supabase project.
2. In Supabase, enable **Anonymous Sign-Ins** under Authentication -> Providers.
3. Open SQL Editor and run `schema.sql`.
4. In Project Settings -> API, copy the Project URL and anon/public key.
5. Put them into `config.js`.
6. Upload this folder to a static host such as Vercel, Netlify, Cloudflare Pages, or GitHub Pages.

## Important MVP note
The included SQL policies are deliberately permissive to make the prototype easy to run. Before using this for a public production service, add proper room-membership RLS and server-side validation/rate limiting.

## Local testing
Because the app is static, you can serve the folder with any static server, for example:

`python3 -m http.server 8080`

Then open `http://localhost:8080`.

## YouTube
The host uses the official YouTube IFrame Player API. Other phones do not load the video player; they send playback commands through the room.

Updated: shared move up/down, remove video, host-only volume, autoplay-next handling, and preserved Supabase config.
