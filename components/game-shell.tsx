'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { GameCanvas, type GameCanvasHandle, type GameMetrics } from '@/components/game-canvas';
import type { SnapshotMessage, WormSnapshot } from '@/lib/game/types';
import type { GatewayToClient } from '@/lib/realtime/protocol';

type Phase = 'boot' | 'menu' | 'matching' | 'playing' | 'reconnecting' | 'dead' | 'error';
type Profile = { nickname: string; best_mass: number; kills: number; matches: number; coins: number };
type GlobalLeader = { rank: number; nickname: string; bestMass: number; kills: number; matches: number; coins: number };

const DEFAULT: GameMetrics = { mass: 34, kills: 0, combo: 0, rank: 1, players: 1, speed: 0 };
const EMPTY_PROFILE: Profile = { nickname: 'Игрок', best_mass: 0, kills: 0, matches: 0, coins: 0 };

export function GameShell() {
  const [phase, setPhase] = useState<Phase>('boot');
  const [nickname, setNickname] = useState('Игрок');
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [globalLeaders, setGlobalLeaders] = useState<GlobalLeader[]>([]);
  const [roomId, setRoomId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [snapshot, setSnapshot] = useState<SnapshotMessage | null>(null);
  const [metrics, setMetrics] = useState<GameMetrics>(DEFAULT);
  const [ping, setPing] = useState(0);
  const [boost, setBoost] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<GameCanvasHandle | null>(null);
  const leaderAt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(650);
  const desiredOnline = useRef(false);
  const deadRef = useRef(false);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }, []);

  const loadLeaderboard = useCallback(async () => {
    try {
      const response = await fetch('/api/leaderboard', { cache: 'no-store' });
      const data = await response.json();
      if (response.ok && Array.isArray(data.leaders)) setGlobalLeaders(data.leaders.slice(0, 8));
    } catch {
      // Leaderboard is non-critical for entering the arena.
    }
  }, []);

  const loadSession = useCallback(async () => {
    const response = await fetch('/api/session', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Сессия недоступна');
    if (data.profile) {
      setProfile(data.profile);
      setNickname(data.profile.nickname || 'Игрок');
    }
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSession(), loadLeaderboard()])
      .then(() => { if (!cancelled) setPhase('menu'); })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Ошибка запуска');
          setPhase('error');
        }
      });
    return () => { cancelled = true; };
  }, [loadLeaderboard, loadSession]);

  const disconnect = useCallback(() => {
    desiredOnline.current = false;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (pingTimer.current) clearInterval(pingTimer.current);
    const socket = wsRef.current;
    wsRef.current = null;
    socket?.close();
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  const connectSocket = useCallback((room: string, arenaTicket: string, name: string) => {
    if (!desiredOnline.current) return;
    const base = process.env.NEXT_PUBLIC_GAME_WS_URL?.trim() || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`;
    const url = new URL(base);
    url.searchParams.set('ticket', arenaTicket);
    const ws = new WebSocket(url);
    let socketPlayer = '';
    wsRef.current = ws;

    if (pingTimer.current) clearInterval(pingTimer.current);

    ws.addEventListener('open', () => {
      reconnectDelay.current = 650;
    });

    ws.addEventListener('message', (event) => {
      let msg: GatewayToClient;
      try { msg = JSON.parse(String(event.data)) as GatewayToClient; } catch { return; }

      if (msg.type === 'ready') {
        socketPlayer = msg.playerId;
        setPlayerId(msg.playerId);
        ws.send(JSON.stringify({ type: 'join', name }));
        setPhase(deadRef.current ? 'dead' : 'playing');
        return;
      }
      if (msg.type === 'snapshot') {
        canvasRef.current?.setSnapshot(msg);
        const now = performance.now();
        if (now - leaderAt.current > 260) {
          leaderAt.current = now;
          setSnapshot(msg);
        }
        return;
      }
      if (msg.type === 'world') {
        canvasRef.current?.setWorld(msg);
        return;
      }
      if (msg.type === 'pong') {
        setPing(Math.max(0, Math.round((Date.now() - msg.at) / 2)));
        return;
      }
      if (msg.type === 'event') {
        if (msg.event === 'death' && msg.playerId === socketPlayer) {
          deadRef.current = true;
          setPhase('dead');
          setBoost(false);
          showToast('Тело рассыпалось в массу.');
          setTimeout(() => {
            void loadSession().catch(() => {});
            void loadLeaderboard();
          }, 450);
        } else if (msg.event === 'core' && msg.playerId === socketPlayer) {
          showToast(msg.mutation === 'shield' ? 'CORE: щит поглотит удар' : 'CORE: OVERDRIVE активирован');
        } else if (msg.event === 'boss' && msg.playerId === socketPlayer) {
          showToast(`LEVIATHAN повержен · +${msg.reward}`);
        }
      }
    });

    ws.addEventListener('close', () => {
      if (wsRef.current !== ws || !desiredOnline.current) return;
      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(8000, Math.round(delay * 1.7));
      if (!deadRef.current) setPhase('reconnecting');
      reconnectTimer.current = setTimeout(() => {
        void (async () => {
          try {
            const response = await fetch('/api/ticket', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ roomId: room }),
            });
            const data = await response.json();
            if (!response.ok || !data.ticket) throw new Error('ticket_refresh_failed');
            connectSocket(room, data.ticket, name);
          } catch {
            setError('Связь с ареной потеряна');
            setPhase('menu');
            desiredOnline.current = false;
            deadRef.current = false;
            void loadLeaderboard();
          }
        })();
      }, delay);
    });

    ws.addEventListener('error', () => ws.close());
    pingTimer.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', at: Date.now() }));
    }, 1800);
  }, [loadLeaderboard, loadSession, showToast]);

  const play = useCallback(async () => {
    setError('');
    setPhase('matching');
    setMetrics(DEFAULT);
    deadRef.current = false;
    try {
      const response = await fetch('/api/matchmake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nickname }),
      });
      const data = await response.json();
      if (!response.ok || !data.roomId || !data.ticket) throw new Error(data.error || 'Матчмейкинг не ответил');
      setRoomId(data.roomId);
      desiredOnline.current = true;
      connectSocket(data.roomId, data.ticket, data.nickname || nickname);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка подключения');
      setPhase('menu');
    }
  }, [connectSocket, nickname]);

  const respawn = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      deadRef.current = false;
      setMetrics(DEFAULT);
      ws.send(JSON.stringify({ type: 'join', name: nickname }));
      setPhase('playing');
      return;
    }
    deadRef.current = false;
    setPhase('reconnecting');
  }, [nickname]);

  const sendInput = useCallback((input: Parameters<NonNullable<React.ComponentProps<typeof GameCanvas>['onInput']>>[0]) => {
    const ws = wsRef.current;
    if (phase === 'playing' && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', input }));
  }, [phase]);

  const back = useCallback(() => {
    disconnect();
    deadRef.current = false;
    setSnapshot(null);
    setRoomId('');
    setPlayerId('');
    setBoost(false);
    setPhase('menu');
    setTimeout(() => {
      void loadSession().catch(() => {});
      void loadLeaderboard();
    }, 300);
  }, [disconnect, loadLeaderboard, loadSession]);

  const leaders = useMemo(() => snapshot ? [...snapshot.worms].sort((a, b) => b.mass - a.mass).slice(0, 6) : [], [snapshot]);
  const inArena = phase === 'playing' || phase === 'dead' || phase === 'reconnecting';

  return <main className="game-root">
    <div className="ambient a1"/><div className="ambient a2"/>
    {inArena ? <GameCanvas ref={canvasRef} playerId={playerId} onInput={sendInput} onMetrics={setMetrics} boost={boost}/> : <MenuBackdrop/>}

    {inArena ? <>
      <header className="top-hud">
        <div className="brand-chip"><span>W</span><div><b>WORM ARENA</b><small>LIVE WORLD</small></div></div>
        <div className="connection-chip"><i className={phase === 'reconnecting' ? 'mid' : ping < 90 ? 'good' : ping < 170 ? 'mid' : 'bad'}/>{phase === 'reconnecting' ? 'reconnect' : `${ping || '…'} ms`} <em>•</em> {roomId.slice(0, 6)}</div>
      </header>
      <section className="mass-panel"><small>МАССА</small><strong>{metrics.mass}</strong><div className="mass-track"><span style={{width:`${Math.min(100,Math.sqrt(metrics.mass/900)*100)}%`}}/></div><footer><b>{massClass(metrics.mass)}</b><span>{metrics.speed} u/s</span></footer></section>
      <section className="combat-panel"><div><small>МЕСТО</small><b>#{metrics.rank}<em>/{metrics.players}</em></b></div><div><small>КИЛЛЫ</small><b>{metrics.kills}</b></div><div><small>КОМБО</small><b>x{Math.max(1,metrics.combo)}</b></div></section>
      <aside className="leaderboard"><header><span>ТОП АРЕНЫ</span><b>{snapshot?.worms.length ?? 0} live</b></header>{leaders.map((worm: WormSnapshot, index) => <div key={worm.id} className={worm.id === playerId ? 'me' : ''}><i>{index + 1}</i><span>{worm.elite ? '♛ ' : ''}{worm.name}</span><b>{Math.round(worm.mass)}</b></div>)}</aside>
      <button className={`boost-button ${boost ? 'pressed' : ''}`} onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => { event.preventDefault(); setBoost(true); }} onPointerUp={() => setBoost(false)} onPointerCancel={() => setBoost(false)} disabled={phase !== 'playing'}><span>BOOST</span><small>держи</small></button>
      <div className="tip-chip">Резкий поворот не отменяет импульс. Массу надо перекладывать заранее.</div>
    </> : null}

    {toast ? <div className="toast">{toast}</div> : null}
    {phase === 'boot' ? <Center text="Запускаем мир" sub="OIDC · сеть · физика"/> : null}
    {phase === 'matching' ? <Center text="Ищем живую арену" sub="Подбираем комнату и authoritative host"/> : null}
    {phase === 'reconnecting' ? <Center text="Возвращаемся в арену" sub={`Повторное соединение · ${Math.round(reconnectDelay.current / 100) / 10}с`}/> : null}

    {phase === 'menu' ? <>
      <section className="menu-card">
        <div className="menu-kicker"><i/> PERSISTENT MULTIPLAYER</div>
        <h1>WORM<br/><span>ARENA</span></h1>
        <p>Не верёвка из кружков. Тяжёлое тело сохраняет импульс, хвост догоняет траекторию, а жирный червь требует планировать поворот заранее.</p>
        <label className="name-field"><span>ИМЯ</span><input maxLength={18} value={nickname} onChange={(event: ChangeEvent<HTMLInputElement>) => setNickname(event.target.value)}/></label>
        <button className="play-button" onClick={play}><span>ВОЙТИ В АРЕНУ</span><b>→</b></button>
        {error ? <div className="inline-error">{error}</div> : null}
        <div className="profile-strip"><div><small>РЕКОРД</small><b>{profile.best_mass}</b></div><div><small>КИЛЛЫ</small><b>{profile.kills}</b></div><div><small>МАТЧИ</small><b>{profile.matches}</b></div><div><small>МОНЕТЫ</small><b>{profile.coins}</b></div></div>
      </section>
      <aside className="global-board">
        <header><span>ГЛОБАЛЬНЫЙ ТОП</span><small>verified runs</small></header>
        {globalLeaders.length ? globalLeaders.map((leader) => <div key={`${leader.rank}:${leader.nickname}`}><i>{leader.rank}</i><span>{leader.nickname}</span><b>{leader.bestMass}</b></div>) : <p>Рейтинг пуст. Первый подтверждённый забег заберёт вершину.</p>}
      </aside>
    </> : null}

    {phase === 'dead' ? <section className="death-card"><small>RUN COMPLETE</small><h2>{metrics.mass}<span> массы</span></h2><div className="death-stats"><div><span>киллы</span><b>{metrics.kills}</b></div><div><span>место</span><b>#{metrics.rank}</b></div><div><span>пинг</span><b>{ping}ms</b></div></div><button onClick={respawn}>ЕЩЁ РАЗ</button><button className="ghost" onClick={back}>В меню</button></section> : null}
    {phase === 'error' ? <section className="center-card"><b>Онлайн не запустился</b><p>{error}</p><button onClick={() => location.reload()}>Повторить</button></section> : null}
  </main>;
}

function Center({ text, sub }: { text: string; sub: string }) {
  return <div className="center-card"><div className="loader"/><b>{text}</b><span>{sub}</span></div>;
}

function MenuBackdrop() {
  return <div className="menu-world"><div className="grid-floor"/><div className="demo-worm">{Array.from({length:13},(_,index)=><i key={index}/>)}</div></div>;
}

function massClass(mass: number) {
  return mass < 70 ? 'ЛЁГКИЙ' : mass < 160 ? 'ПЛОТНЫЙ' : mass < 300 ? 'ТЯЖЁЛЫЙ' : mass < 520 ? 'МАССИВНЫЙ' : 'ТИТАН';
}
