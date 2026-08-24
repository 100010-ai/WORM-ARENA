# Runtime architecture

Browser -> Next.js guest session/matchmaking -> one-time arena ticket -> Vercel WebSocket gateway.

Each gateway joins an opaque `arena-bus:<busTopic>` Supabase Realtime channel. `busTopic` is a per-room random value that is never returned to the browser; the public room UUID cannot be used to discover the server bus. A Postgres lease elects one gateway as authoritative simulation host. All cross-gateway messages are also HMAC signed with a separate per-room bus secret. Only gateways obtain the topic and secret through the OIDC-protected Supabase Edge Function.

The host runs at 30 Hz, broadcasts snapshots at 12 Hz and world food state at 3 Hz. It stores a room snapshot every 3 seconds. If the host disappears, another gateway claims the expired lease and restores the latest snapshot.

The Canvas renderer runs independently from React. React receives low-rate HUD metrics only, preventing the network stream from causing component rerenders every frame.
