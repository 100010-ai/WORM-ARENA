# Deployment status

The live Supabase project is provisioned, migrations are tracked, and the `arena-control` Edge Function is deployed. Vercel deployment should run from `main` with Node 22.

Production runtime configuration is intentionally minimal:
- public Supabase URL
- public Supabase publishable key
- Vercel-provided OIDC identity

No permanent privileged Supabase credential is required on Vercel.
