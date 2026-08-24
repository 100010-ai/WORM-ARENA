# Runtime configuration

Required on Vercel/runtime:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Vercel injects `VERCEL_OIDC_TOKEN` automatically. Do not create or commit it manually.

`NEXT_PUBLIC_GAME_WS_URL` is optional. When omitted, the client opens `/api/ws` on the current origin.

The Supabase URL and publishable key are public configuration, not privileged credentials. They are mirrored in `vercel.json` for reproducible zero-touch deploys while the connected Vercel integration does not expose Project Environment Variable writes. Never put `SUPABASE_SERVICE_ROLE_KEY` in Vercel or the browser.
