create index if not exists arena_tickets_room_idx on public.arena_tickets(room_id);
create index if not exists match_results_room_idx on public.match_results(room_id);
