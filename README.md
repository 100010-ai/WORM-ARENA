# WORM ARENA Online

A server-authoritative browser arena with deliberately heavy worm physics.

## Stack
- Next.js 16 App Router + React 19 + TypeScript
- Canvas 2D renderer outside the React render loop
- Vercel Functions / Fluid Compute WebSocket gateway
- Supabase Postgres for persistent profile/match/room state
- Supabase Realtime Broadcast as the cross-instance room bus
- Supabase Edge Function `arena-control` for privileged DB operations
- Vercel OIDC for keyless Vercel -> Supabase authentication

## Security model
- Browser never receives Supabase service-role credentials.
- Browser never needs a Supabase Auth JWT.
- Guest identity is a random HttpOnly session token; only its SHA-256 hash is stored.
- One-time arena tickets authorize WebSocket connections.
- Vercel calls `arena-control` using its short-lived OIDC identity.
- `arena-control` owns the Supabase service role internally.
- Each room has a random server-only Realtime bus topic, separate from the room UUID.
- Realtime arena messages are HMAC-signed with an independent per-room secret. The client receives neither the bus topic nor the secret.
- Physics, collisions, mass, kills and verified result persistence are host-authoritative.

## Physics
Mass affects angular acceleration, maximum turn rate, acceleration, lateral grip, radius and body inertia. The body uses a constrained Verlet-like chain, so a heavy worm keeps momentum through a sharp turn instead of rotating like a sprite.

## Environment
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are required server runtime variables. Their current public values are mirrored in `vercel.json` to make clean Vercel deployments reproducible. `VERCEL_OIDC_TOKEN` is injected automatically by Vercel. `SUPABASE_SERVICE_ROLE_KEY` is never stored in this repository or Vercel config.

## Deploy
The repository contains the complete Supabase migration history used by the live project plus the `arena-control` Edge Function source. The live Supabase project is already provisioned and `arena-control` is deployed.
