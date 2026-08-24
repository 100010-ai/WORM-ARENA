'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { SKINS } from '@/lib/game/config';
import type { PlayerInput, SnapshotMessage, WorldMessage, WormSnapshot } from '@/lib/game/types';

export type GameMetrics={mass:number;kills:number;combo:number;rank:number;players:number;speed:number};
export type GameCanvasHandle={setSnapshot(v:SnapshotMessage):void;setWorld(v:WorldMessage):void};
type Props={playerId:string;boost:boolean;onInput(v:PlayerInput):void;onMetrics(v:GameMetrics):void};

export const GameCanvas=forwardRef<GameCanvasHandle,Props>(function GameCanvas({playerId,boost,onInput,onMetrics},ref){
  const canvas=useRef<HTMLCanvasElement|null>(null),snap=useRef<SnapshotMessage|null>(null),world=useRef<WorldMessage|null>(null);
  const camera=useRef({x:0,y:0,zoom:1}),pointer=useRef({x:0,y:0,active:false}),seq=useRef(0),lastInput=useRef(0),lastMetrics=useRef(0),space=useRef(false);
  useImperativeHandle(ref,()=>({setSnapshot:v=>{snap.current=v},setWorld:v=>{world.current=v}}),[]);
  useEffect(()=>{
    const c=canvas.current;if(!c)return;const ctx=c.getContext('2d',{alpha:false});if(!ctx)return;
    let raf=0,last=performance.now();
    const resize=()=>{const dpr=Math.min(2,window.devicePixelRatio||1);const w=innerWidth,h=innerHeight;if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);c.style.width=`${w}px`;c.style.height=`${h}px`;ctx.setTransform(dpr,0,0,dpr,0,0);}};
    const setPoint=(e:PointerEvent)=>{pointer.current={x:e.clientX-innerWidth/2,y:e.clientY-innerHeight/2,active:true};};
    const kd=(e:KeyboardEvent)=>{if(e.code==='Space'){space.current=true;e.preventDefault();}};const ku=(e:KeyboardEvent)=>{if(e.code==='Space')space.current=false;};
    window.addEventListener('resize',resize);c.addEventListener('pointermove',setPoint,{passive:true});c.addEventListener('pointerdown',setPoint,{passive:true});window.addEventListener('keydown',kd);window.addEventListener('keyup',ku);resize();
    const frame=(now:number)=>{const dt=Math.min(.05,(now-last)/1000);last=now;resize();draw(ctx,innerWidth,innerHeight,dt,now);raf=requestAnimationFrame(frame)};
    const draw=(g:CanvasRenderingContext2D,w:number,h:number,dt:number,now:number)=>{
      g.fillStyle='#061015';g.fillRect(0,0,w,h);const s=snap.current,me=s?.worms.find(x=>x.id===playerId);
      if(me){const extrap=Math.min(.10,Math.max(0,(Date.now()-s!.serverTime)/1000));const tx=me.x+me.vx*extrap,ty=me.y+me.vy*extrap;const desiredZoom=Math.max(.48,Math.min(1.05,1.06-Math.log2(Math.max(34,me.mass)/34)*.115));const follow=1-Math.exp(-6.5*dt);camera.current.x+=(tx-camera.current.x)*follow;camera.current.y+=(ty-camera.current.y)*follow;camera.current.zoom+=(desiredZoom-camera.current.zoom)*(1-Math.exp(-4*dt));}
      const cam=camera.current;g.save();g.translate(w/2,h/2);g.scale(cam.zoom,cam.zoom);g.translate(-cam.x,-cam.y);
      drawArena(g,cam,w,h);if(world.current)drawFood(g,world.current.foods,cam,w,h);if(s){const order=[...s.worms].sort((a,b)=>a.id===playerId?1:b.id===playerId?-1:a.mass-b.mass);for(const worm of order)drawWorm(g,worm,worm.id===playerId,now);}
      g.restore();
      if(me){const aim=pointer.current.active?Math.atan2(pointer.current.y,pointer.current.x):me.angle;if(now-lastInput.current>32){lastInput.current=now;onInput({seq:++seq.current,angle:aim,boost:boost||space.current,clientTime:Date.now()});}
        if(now-lastMetrics.current>150){lastMetrics.current=now;const leaders=[...(s?.worms??[])].sort((a,b)=>b.mass-a.mass);onMetrics({mass:Math.round(me.mass),kills:me.kills,combo:me.combo,rank:Math.max(1,leaders.findIndex(x=>x.id===playerId)+1),players:leaders.length,speed:Math.round(Math.hypot(me.vx,me.vy))});}}
    };
    function visible(x:number,y:number,cam:{x:number;y:number;zoom:number},w:number,h:number,pad=100){const hw=w/(2*cam.zoom)+pad,hh=h/(2*cam.zoom)+pad;return x>cam.x-hw&&x<cam.x+hw&&y>cam.y-hh&&y<cam.y+hh;}
    function drawArena(g:CanvasRenderingContext2D,cam:{x:number;y:number;zoom:number},w:number,h:number){const step=140;const hw=w/(2*cam.zoom)+step,hh=h/(2*cam.zoom)+step;g.lineWidth=1/cam.zoom;g.strokeStyle='rgba(109,174,180,.055)';g.beginPath();for(let x=Math.floor((cam.x-hw)/step)*step;x<cam.x+hw;x+=step){g.moveTo(x,cam.y-hh);g.lineTo(x,cam.y+hh)}for(let y=Math.floor((cam.y-hh)/step)*step;y<cam.y+hh;y+=step){g.moveTo(cam.x-hw,y);g.lineTo(cam.x+hw,y)}g.stroke();const r=world.current?.worldRadius??3400;g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.strokeStyle='rgba(255,93,81,.32)';g.lineWidth=8;g.stroke();g.beginPath();g.arc(0,0,r-24,0,Math.PI*2);g.strokeStyle='rgba(255,93,81,.07)';g.lineWidth=42;g.stroke();}
    function drawFood(g:CanvasRenderingContext2D,foods:WorldMessage['foods'],cam:{x:number;y:number;zoom:number},w:number,h:number){for(const f of foods){if(!visible(f.x,f.y,cam,w,h,40))continue;const r=f.core?14:3.2+Math.min(4,f.value*.6);if(f.core){g.shadowBlur=32;g.shadowColor='#64f4ff';g.fillStyle='#b9fbff';g.beginPath();g.arc(f.x,f.y,r+Math.sin(performance.now()*.006)*2,0,Math.PI*2);g.fill();g.shadowBlur=0;g.strokeStyle='rgba(80,235,255,.7)';g.lineWidth=3;g.beginPath();g.arc(f.x,f.y,r+9,0,Math.PI*2);g.stroke();}else{g.fillStyle=`hsl(${f.hue} 78% 64%)`;g.beginPath();g.arc(f.x,f.y,r,0,Math.PI*2);g.fill();}}}
    function drawWorm(g:CanvasRenderingContext2D,wm:WormSnapshot,isMe:boolean,now:number){const colors=SKINS[wm.skin%SKINS.length];const pts=[{x:wm.x,y:wm.y},...wm.body];if(pts.length<2)return;g.save();g.lineCap='round';g.lineJoin='round';g.shadowColor=wm.elite?'rgba(255,76,108,.6)':isMe?'rgba(90,228,255,.38)':'rgba(0,0,0,.25)';g.shadowBlur=wm.elite?28:isMe?18:9;g.strokeStyle='rgba(0,0,0,.46)';g.lineWidth=wm.radius*2.22;path(g,pts);g.stroke();const grad=g.createLinearGradient(wm.x-wm.radius*3,wm.y-wm.radius*3,wm.x+wm.radius*3,wm.y+wm.radius*3);grad.addColorStop(0,colors[0]);grad.addColorStop(1,colors[1]);g.strokeStyle=grad;g.lineWidth=wm.radius*1.72;path(g,pts);g.stroke();g.shadowBlur=0;
      if(wm.boosting){g.strokeStyle='rgba(255,255,255,.32)';g.lineWidth=wm.radius*.28;path(g,pts.slice(0,Math.min(9,pts.length)));g.stroke();}
      const fx=Math.cos(wm.angle),fy=Math.sin(wm.angle),sx=-fy,sy=fx;const eyeF=wm.radius*.45,eyeS=wm.radius*.43,er=Math.max(2.5,wm.radius*.18);for(const side of [-1,1]){const ex=wm.x+fx*eyeF+sx*eyeS*side,ey=wm.y+fy*eyeF+sy*eyeS*side;g.fillStyle='#f7fbff';g.beginPath();g.arc(ex,ey,er,0,Math.PI*2);g.fill();g.fillStyle='#071016';g.beginPath();g.arc(ex+fx*er*.45,ey+fy*er*.45,er*.48,0,Math.PI*2);g.fill();}
      if(wm.shield){g.strokeStyle=`rgba(117,242,255,${.45+Math.sin(now*.01)*.15})`;g.lineWidth=3;g.beginPath();g.arc(wm.x,wm.y,wm.radius*1.55,0,Math.PI*2);g.stroke();}
      if(wm.elite){g.fillStyle='#ff8ba0';g.font=`700 ${Math.max(14,wm.radius*.65)}px system-ui`;g.textAlign='center';g.fillText('LEVIATHAN',wm.x,wm.y-wm.radius*1.8);}else if(!isMe){g.fillStyle='rgba(236,246,248,.8)';g.font='600 12px system-ui';g.textAlign='center';g.fillText(wm.name,wm.x,wm.y-wm.radius*1.65);}g.restore();}
    function path(g:CanvasRenderingContext2D,pts:{x:number;y:number}[]){g.beginPath();g.moveTo(pts[0].x,pts[0].y);if(pts.length===2){g.lineTo(pts[1].x,pts[1].y);return;}for(let i=1;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];g.quadraticCurveTo(a.x,a.y,(a.x+b.x)/2,(a.y+b.y)/2);}const p=pts.at(-1)!;g.lineTo(p.x,p.y);}
    raf=requestAnimationFrame(frame);return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize);c.removeEventListener('pointermove',setPoint);c.removeEventListener('pointerdown',setPoint);window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);};
  },[boost,onInput,onMetrics,playerId]);
  return <canvas ref={canvas} className="game-canvas" aria-label="Игровая арена"/>;
});
