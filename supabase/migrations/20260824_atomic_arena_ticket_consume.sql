create or replace function public.consume_arena_ticket(p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_player_id uuid;
  v_bus_secret text;
  v_snapshot jsonb;
begin
  update public.arena_tickets
  set last_used_at = now()
  where ticket = p_ticket and expires_at > now() and last_used_at is null
  returning room_id, player_id into v_room_id, v_player_id;
  if not found then return null; end if;

  select r.bus_secret, r.snapshot into v_bus_secret, v_snapshot
  from public.arena_rooms r
  where r.id = v_room_id and r.status = 'open';
  if not found then return null; end if;

  if not exists (
    select 1 from public.arena_members m
    where m.room_id = v_room_id and m.player_id = v_player_id
      and m.last_seen_at >= now() - interval '35 seconds'
  ) then return null; end if;

  return jsonb_build_object(
    'roomId', v_room_id, 'playerId', v_player_id,
    'busSecret', v_bus_secret, 'snapshot', v_snapshot
  );
end;
$$;

revoke all on function public.consume_arena_ticket(uuid) from public, anon, authenticated;
grant execute on function public.consume_arena_ticket(uuid) to service_role;
