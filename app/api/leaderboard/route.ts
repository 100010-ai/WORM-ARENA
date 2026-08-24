import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/server/control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Row = {
  rank: number | string;
  nickname: string;
  best_mass: number;
  kills: number;
  matches: number;
  coins: number;
};

export async function GET() {
  const { data, error } = await db.rpc('get_global_leaderboard', { p_limit: 20 });
  if (error) {
    console.error('leaderboard', error);
    return Response.json({ error: 'leaderboard_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  const leaders = ((data ?? []) as Row[]).map((row) => ({
    rank: Number(row.rank),
    nickname: row.nickname,
    bestMass: row.best_mass,
    kills: row.kills,
    matches: row.matches,
    coins: row.coins,
  }));

  return Response.json({ leaders }, { headers: { 'cache-control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=20' } });
}
