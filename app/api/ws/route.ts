import { createClient } from '@supabase/supabase-js';
import { experimental_upgradeWebSocket } from '@vercel/functions';
import { ArenaEngine } from '@/lib/game/server-engine';
import { GAME } from '@/lib/game/config';
import type { ServerEvent } from '@/lib/game/types';
import type { BusMessage, ClientToGateway } from '@/lib/realtime/protocol';
import { arenaControl, sanitizeName, signBus, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, verifyBus } from '@/lib/server/control';

export const runtime='nodejs';
export const maxDuration=300;
type VSocket={send(data:string):void;on(event:'message',fn:(data:unknown)=>void):void;on(event:'close'|'error',fn:()=>void):void};
type TicketPass={roomId:string;playerId:string;busSecret:string;snapshot?:unknown};
type HostClaim={claimed:boolean;snapshot?:unknown;busSecret?:string};

export async function GET(request:Request){
  const ticket=new URL(request.url).searchParams.get('ticket');
  if(!ticket)return new Response('Ticket required',{status:401});
  let pass:TicketPass;
  try{pass=await arenaControl<TicketPass>({action:'ticket_consume',ticket});}
  catch{return new Response('Ticket invalid',{status:401});}
  return experimental_upgradeWebSocket((ws:VSocket)=>{void runGateway(ws,pass);},{maxPayload:64*1024});
}

async function runGateway(ws:VSocket,pass:TicketPass){
  const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const topic=`arena:${pass.roomId}`;
  const hostToken=crypto.randomUUID();
  let busSecret=pass.busSecret;
  let engine:ArenaEngine|null=null,isHost=false,closed=false;
  let simTimer:ReturnType<typeof setInterval>|null=null,controlTimer:ReturnType<typeof setInterval>|null=null;
  let lastSnapshotAt=Date.now(),lastStep=performance.now(),snapshotDivider=0,worldDivider=0,persistDivider=0;
  const send=(v:unknown)=>{try{ws.send(JSON.stringify(v));}catch{/* closed */}};
  const channel=supabase.channel(topic,{config:{broadcast:{self:true,ack:false}}});
  const broadcast=async(event:string,data:unknown)=>channel.send({type:'broadcast',event,payload:signBus(data,busSecret)});

  const onEngineEvent=(event:ServerEvent)=>{
    void broadcast('game_event',event);
    if(event.event==='death'&&isHost)void arenaControl({action:'record_result',roomId:pass.roomId,hostToken,playerId:event.playerId,mass:event.mass,kills:event.kills}).catch(()=>{});
  };
  const startHost=(snapshot?:unknown)=>{
    if(engine||closed)return;
    engine=new ArenaEngine(pass.roomId,onEngineEvent,snapshot);
    isHost=true;send({type:'event',event:'host',host:true});lastStep=performance.now();
    simTimer=setInterval(()=>{
      if(!engine||closed)return;
      const n=performance.now(),dt=Math.min(.05,Math.max(.001,(n-lastStep)/1000));lastStep=n;engine.step(dt,Date.now());
      snapshotDivider++;worldDivider++;persistDivider++;
      if(snapshotDivider>=Math.round(GAME.tickRate/GAME.snapshotRate)){snapshotDivider=0;void broadcast('snapshot',engine.snapshot());}
      if(worldDivider>=Math.round(GAME.tickRate/GAME.worldRate)){worldDivider=0;void broadcast('world',engine.world());}
      if(persistDivider>=GAME.tickRate*3){persistDivider=0;void arenaControl({action:'host_heartbeat',roomId:pass.roomId,hostToken,snapshot:engine.serialize()}).then((r:any)=>{if(r?.ok===false)stopHost();}).catch(()=>{});}
    },1000/GAME.tickRate);
  };
  const stopHost=()=>{isHost=false;engine=null;if(simTimer){clearInterval(simTimer);simTimer=null;}};
  const tryClaim=async()=>{
    if(isHost||closed)return;
    try{const claim=await arenaControl<HostClaim>({action:'host_claim',roomId:pass.roomId,hostToken});if(claim.claimed){if(claim.busSecret)busSecret=claim.busSecret;startHost(claim.snapshot??pass.snapshot);}}catch{/* next control tick retries */}
  };

  channel
    .on('broadcast',{event:'bus'},({payload}:{payload:unknown})=>{const m=verifyBus<BusMessage>(payload,busSecret);if(!m||!engine)return;if(m.kind==='join')engine.joinPlayer(m.playerId,m.name);else if(m.kind==='heartbeat')engine.heartbeat(m.playerId);else if(m.kind==='input')engine.input(m.playerId,m.input);})
    .on('broadcast',{event:'snapshot'},({payload}:{payload:unknown})=>{const m=verifyBus(payload,busSecret);if(!m)return;lastSnapshotAt=Date.now();send(m);})
    .on('broadcast',{event:'world'},({payload}:{payload:unknown})=>{const m=verifyBus(payload,busSecret);if(m)send(m);})
    .on('broadcast',{event:'game_event'},({payload}:{payload:unknown})=>{const m=verifyBus(payload,busSecret);if(m)send(m);})
    .subscribe(async (status: string)=>{if(status!=='SUBSCRIBED')return;await tryClaim();send({type:'ready',playerId:pass.playerId,roomId:pass.roomId,host:isHost});});

  ws.on('message',(raw:unknown)=>{
    let msg:ClientToGateway;try{msg=JSON.parse(String(raw)) as ClientToGateway;}catch{return;}
    if(msg.type==='join'){void broadcast('bus',{kind:'join',playerId:pass.playerId,name:sanitizeName(msg.name),at:Date.now()} satisfies BusMessage);return;}
    if(msg.type==='input'){
      const i=msg.input;if(!i||!Number.isFinite(i.angle)||!Number.isFinite(i.seq)||Math.abs(Number(i.angle))>1e6)return;
      const clean={seq:Math.max(0,Math.floor(i.seq)),angle:Number(i.angle),boost:Boolean(i.boost),clientTime:Number.isFinite(i.clientTime)?Number(i.clientTime):Date.now()};
      void broadcast('bus',{kind:'input',playerId:pass.playerId,input:clean,at:Date.now()} satisfies BusMessage);return;
    }
    if(msg.type==='ping')send({type:'pong',at:msg.at,serverTime:Date.now()});
  });

  const close=async()=>{if(closed)return;closed=true;if(simTimer)clearInterval(simTimer);if(controlTimer)clearInterval(controlTimer);if(isHost)await arenaControl({action:'host_release',roomId:pass.roomId,hostToken,snapshot:engine?.serialize()??null}).catch(()=>{});await supabase.removeChannel(channel);};
  ws.on('close',()=>{void close();});ws.on('error',()=>{void close();});
  controlTimer=setInterval(()=>{
    if(closed)return;
    void broadcast('bus',{kind:'heartbeat',playerId:pass.playerId,at:Date.now()} satisfies BusMessage);
    void arenaControl({action:'member_heartbeat',roomId:pass.roomId,playerId:pass.playerId}).catch(()=>{});
    if(!isHost&&Date.now()-lastSnapshotAt>4500)void tryClaim();
  },2600);
}
