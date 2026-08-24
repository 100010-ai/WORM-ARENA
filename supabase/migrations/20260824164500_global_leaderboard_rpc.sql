create or replace function public.get_global_leaderboard(p_limit integer default 20)
returns table(
  rank bigint,
  player_id uuid,
  nickname text,
  best_mass integer,
  kills integer,
  matches integer,
  coins integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    row_number() over (order by p.best_mass desc, p.kills desc, p.matches asc, p.created_at asc) as rank,
    p.id as player_id,
    p.nickname,
    p.best_mass,
    p.kills,
    p.matches,
    p.coins
  from public.profiles p
  where p.matches > 0
  order by p.best_mass desc, p.kills desc, p.matches asc, p.created_at asc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.get_global_leaderboard(integer) from public;
grant execute on function public.get_global_leaderboard(integer) to anon, authenticated, service_role;
