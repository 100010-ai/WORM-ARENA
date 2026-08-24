begin;

alter table public.arena_rooms
  add column if not exists bus_topic text;

update public.arena_rooms
set bus_topic = encode(extensions.gen_random_bytes(24), 'hex')
where bus_topic is null or length(bus_topic) < 32;

alter table public.arena_rooms
  alter column bus_topic set default encode(extensions.gen_random_bytes(24), 'hex'),
  alter column bus_topic set not null;

create unique index if not exists arena_rooms_bus_topic_uidx on public.arena_rooms(bus_topic);

create or replace function public.claim_arena_host(p_room_id uuid, p_host_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
  v_snapshot jsonb;
  v_secret text;
  v_topic text;
begin
  update public.arena_rooms
  set host_token = p_host_token,
      host_expires_at = now() + interval '9 seconds',
      updated_at = now()
  where id = p_room_id
    and status = 'open'
    and (host_token is null or host_expires_at is null or host_expires_at < now() or host_token = p_host_token)
  returning true, snapshot, bus_secret, bus_topic
  into v_claimed, v_snapshot, v_secret, v_topic;

  return jsonb_build_object(
    'claimed', coalesce(v_claimed, false),
    'snapshot', v_snapshot,
    'busSecret', v_secret,
    'busTopic', v_topic
  );
end;
$$;

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
  v_bus_topic text;
  v_snapshot jsonb;
begin
  update public.arena_tickets
  set last_used_at = now()
  where ticket = p_ticket
    and expires_at > now()
    and last_used_at is null
  returning room_id, player_id into v_room_id, v_player_id;

  if not found then return null; end if;

  select r.bus_secret, r.bus_topic, r.snapshot
  into v_bus_secret, v_bus_topic, v_snapshot
  from public.arena_rooms r
  where r.id = v_room_id and r.status = 'open';

  if not found then return null; end if;

  if not exists (
    select 1
    from public.arena_members m
    where m.room_id = v_room_id
      and m.player_id = v_player_id
      and m.last_seen_at >= now() - interval '35 seconds'
  ) then return null; end if;

  return jsonb_build_object(
    'roomId', v_room_id,
    'playerId', v_player_id,
    'busSecret', v_bus_secret,
    'busTopic', v_bus_topic,
    'snapshot', v_snapshot
  );
end;
$$;

revoke all on function public.claim_arena_host(uuid, uuid) from public, anon, authenticated;
revoke all on function public.consume_arena_ticket(uuid) from public, anon, authenticated;
grant execute on function public.claim_arena_host(uuid, uuid) to service_role;
grant execute on function public.consume_arena_ticket(uuid) to service_role;

commit;
