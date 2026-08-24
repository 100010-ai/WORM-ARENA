import { arenaControl, controlErrorCode, getSupabaseServerConfig } from '@/lib/server/control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  try {
    const { url } = getSupabaseServerConfig();
    const control = await arenaControl<{ ok?: boolean; error?: string }>({ action: 'health' });
    if (!control?.ok) {
      return Response.json(
        { ok: false, version: '4.1.1', database: 'unknown', diagnostic: control?.error ?? 'control_unavailable' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
    return Response.json(
      {
        ok: true,
        version: '4.1.1',
        control: 'ok',
        supabaseHost: new URL(url).host,
        latencyMs: Date.now() - startedAt,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const diagnostic = controlErrorCode(error);
    console.error('[health] failed', { diagnostic });
    return Response.json(
      { ok: false, version: '4.1.1', diagnostic },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
