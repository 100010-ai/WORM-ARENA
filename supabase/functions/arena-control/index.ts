import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';

const TEAM_SLUG = '100010-ais-projects';
const PROJECT_NAME = 'worm-arena';
const SUBJECT_PREFIX = `owner:${TEAM_SLUG}:project:${PROJECT_NAME}:environment:`;
const ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;
const AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

type Body = Record<string, unknown> & { action?: string };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
const safeName = (v: unknown) => String(v ?? '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18) || 'Игрок';

async function verifyVercel(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('missing_oidc');
  const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUDIENCE });
  if (typeof payload.sub !== 'string' || !payload.sub.startsWith(SUBJECT_PREFIX)) throw new Error('wrong_subject');
  const environment = payload.sub.slice(SUBJECT_PREFIX.length);
  if (environment !== 'production' && environment !== 'preview') throw new Error('wrong_environment');
  return payload;
}

async function sessionByHash(tokenHash: string) {
  const now = new Date().toISOString();
  const { data, error } = await db.from('guest_sessions').select('player_id,expires_at').eq('token_hash', tokenHash).gt('expires_at', now).maybeSingle();
  if (error || !data) return null;
  void db.from('guest_sessions').update({ last_seen_at: now }).eq('token_hash', tokenHash);
  return data;
}
async function profile(playerId: string) {
  const { data } = await db.from('profiles').select('id,nickname,best_mass,kills,matches,coins').eq('id', playerId).maybeSingle();
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try { await verifyVercel(req); } catch { return json({ error: 'unauthorized_gateway' }, 401); }
  let body: Body;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const action = body.action;
  try {
    if (action === 'health') {
      const { error } = await db.from('profiles').select('id').limit(1);
      if (error) throw error;
      return json({ ok: true, database: 'ok' });
    }
    if (action === 'session_create') {
      if (!isUuid(body.playerId) || !isHash(body.tokenHash)) return json({ error: 'bad_session' }, 400);
      const nickname = safeName(body.nickname);
      const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
      const { error: pe } = await db.from('profiles').upsert({ id: body.playerId, nickname, last_seen_at: new Date().toISOString() }, { onConflict: 'id' });
      if (pe) throw pe;
      const { error: se } = await db.from('guest_sessions').upsert({ token_hash: body.tokenHash, player_id: body.playerId, expires_at: expiresAt, last_seen_at: new Date().toISOString() }, { onConflict: 'token_hash' });
      if (se) throw se;
      return json({ playerId: body.playerId, profile: await profile(body.playerId), expiresAt });
    }
    if (action === 'session_get') {
      if (!isHash(body.tokenHash)) return json({ error: 'bad_session' }, 400);
      const s = await sessionByHash(body.tokenHash); if (!s) return json({ error: 'session_expired' }, 401);
      return json({ playerId: s.player_id, profile: await profile(s.player_id) });
    }
    if (action === 'matchmake') {
      if (!isHash(body.tokenHash)) return json({ error: 'bad_session' }, 400);
      const s = await sessionByHash(body.tokenHash); if (!s) return json({ error: 'session_expired' }, 401);
      const nickname = safeName(body.nickname);
      const { data: roomId, error } = await db.rpc('matchmake_arena', { p_player_id: s.player_id, p_nickname: nickname, p_max_players: 24 });
      if (error || !roomId) throw error ?? new Error('no_room');
      const ticket = crypto.randomUUID(), expiresAt = new Date(Date.now() + 90_000).toISOString();
      const { error: te } = await db.from('arena_tickets').insert({ ticket, room_id: roomId, player_id: s.player_id, expires_at: expiresAt }); if (te) throw te;
      return json({ roomId, ticket, nickname, playerId: s.player_id });
    }
    if (action === 'ticket_refresh') {
      if (!isHash(body.tokenHash) || !isUuid(body.roomId)) return json({ error: 'bad_request' }, 400);
      const s = await sessionByHash(body.tokenHash); if (!s) return json({ error: 'session_expired' }, 401);
      const { data: m } = await db.from('arena_members').select('room_id').eq('room_id', body.roomId).eq('player_id', s.player_id).maybeSingle();
      if (!m) return json({ error: 'membership_missing' }, 403);
      const ticket=crypto.randomUUID(), expiresAt=new Date(Date.now()+90_000).toISOString();
      const { error }=await db.from('arena_tickets').insert({ticket,room_id:body.roomId,player_id:s.player_id,expires_at:expiresAt});if(error)throw error;
      return json({ticket,expiresAt});
    }
    if (action === 'ticket_consume') {
      if (!isUuid(body.ticket)) return json({ error: 'bad_ticket' }, 400);
      const { data: pass, error }=await db.rpc('consume_arena_ticket',{p_ticket:body.ticket});
      if(error)throw error;
      if(!pass)return json({error:'ticket_invalid'},401);
      return json(pass);
    }
    if (action === 'host_claim') {
      if(!isUuid(body.roomId)||!isUuid(body.hostToken))return json({error:'bad_host'},400);
      const {data,error}=await db.rpc('claim_arena_host',{p_room_id:body.roomId,p_host_token:body.hostToken});if(error)throw error;return json(data);
    }
    if (action === 'host_heartbeat') {
      if(!isUuid(body.roomId)||!isUuid(body.hostToken))return json({error:'bad_host'},400);
      const {data,error}=await db.rpc('arena_host_heartbeat',{p_room_id:body.roomId,p_host_token:body.hostToken,p_snapshot:body.snapshot??null});if(error)throw error;return json({ok:Boolean(data)});
    }
    if (action === 'host_release') {
      if(!isUuid(body.roomId)||!isUuid(body.hostToken))return json({error:'bad_host'},400);
      const {error}=await db.rpc('release_arena_host',{p_room_id:body.roomId,p_host_token:body.hostToken,p_snapshot:body.snapshot??null});if(error)throw error;return json({ok:true});
    }
    if (action === 'member_heartbeat') {
      if(!isUuid(body.roomId)||!isUuid(body.playerId))return json({error:'bad_member'},400);
      await db.from('arena_members').update({last_seen_at:new Date().toISOString()}).eq('room_id',body.roomId).eq('player_id',body.playerId);return json({ok:true});
    }
    if (action === 'member_leave') {
      if(!isUuid(body.roomId)||!isUuid(body.playerId))return json({error:'bad_member'},400);
      await db.from('arena_members').delete().eq('room_id',body.roomId).eq('player_id',body.playerId);return json({ok:true});
    }
    if (action === 'record_result') {
      if(!isUuid(body.roomId)||!isUuid(body.hostToken)||!isUuid(body.playerId))return json({error:'bad_result'},400);
      const {data,error}=await db.rpc('record_verified_result',{p_room_id:body.roomId,p_host_token:body.hostToken,p_player_id:body.playerId,p_mass:Number(body.mass)||0,p_kills:Number(body.kills)||0});if(error)throw error;return json({ok:Boolean(data)});
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (error) {
    console.error('arena-control', action, error);
    return json({ error: 'control_failed' }, 500);
  }
});
