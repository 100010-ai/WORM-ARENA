# WORM ARENA Online

Server-authoritative browser arena with deliberately heavy worm physics.

## Stack
- Next.js 16 App Router + React 19 + TypeScript
- Canvas 2D renderer outside the React render loop
- Vercel Functions / Fluid Compute WebSocket gateway
- Supabase Postgres + Realtime Broadcast
- Supabase Edge Function `arena-control`
- Vercel OIDC for keyless server authentication

The browser never receives Supabase privileged credentials. Guest identity uses an HttpOnly random session token, WebSocket entry uses one-time arena tickets, and cross-gateway room messages are HMAC-signed with a per-room secret.
