# Runtime architecture

Browser -> Next.js guest session/matchmaking -> one-time arena ticket -> Vercel WebSocket gateway.

Each gateway joins `arena:<roomId>` on Supabase Realtime. A Postgres lease elects one gateway as authoritative simulation host. All cross-gateway messages are HMAC signed with the room bus secret. Only gateways obtain that secret through the OIDC-protected Supabase Edge Function.

The host runs at 30 Hz, broadcasts snapshots at 12 Hz and world food state at 3 Hz. It stores a room snapshot every 3 seconds. If the host disappears, another gateway claims the expired lease and restores the latest snapshot.

The Canvas renderer runs independently from React. React receives low-rate HUD metrics only, preventing the network stream from causing component rerenders every frame.
