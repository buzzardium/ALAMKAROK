# ALAMKAROK

Static ALAMKAROK room app.

## Chat + points setup
Run `chat_points.sql` once in the Supabase SQL Editor for an existing project. It adds:
- Room chat history
- Emoji quick-chat buttons
- Participant point totals
- +1 / +5 / +10 point giving
- Atomic point updates
- Realtime chat updates

`config.js` is intentionally preserved separately and must not be replaced.


## Shared playlist cards + room search
For an existing Supabase project, run `shared_playlists_search.sql` once in the Supabase SQL Editor. This creates room-scoped shared playlist cards and song records, with realtime publication enabled.
- My List can be shared as one or more room-visible playlist cards.
- Any room member can open a card to append its songs to their own private My List.
- Room search scans titles in all shared playlists, supports small spelling errors, and lets members add a result directly to Shared Queue.
