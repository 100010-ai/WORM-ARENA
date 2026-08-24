import { randomBytes,randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { arenaControl,controlErrorCode,hashSession } from '@/lib/server/control';

export const runtime='nodejs';
const COOKIE='wa_session';
const opts={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax' as const,path:'/',maxAge:60*60*24*30};

export async function GET(request:Request){
  const cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)wa_session=([^;]+)/)?.[1];
  if(cookie){
    try{return NextResponse.json(await arenaControl({action:'session_get',tokenHash:hashSession(decodeURIComponent(cookie))}));}
    catch(error){console.warn('[session] existing session unavailable',{diagnostic:controlErrorCode(error)});}
  }
  const token=randomBytes(32).toString('base64url'),playerId=randomUUID();
  try{
    const data=await arenaControl({action:'session_create',tokenHash:hashSession(token),playerId,nickname:'Игрок'});
    const response=NextResponse.json(data);
    response.cookies.set(COOKIE,token,opts);
    return response;
  }catch(error){
    const diagnostic=controlErrorCode(error);
    console.error('[session] bootstrap failed',{diagnostic});
    return NextResponse.json({error:'session_bootstrap_failed',diagnostic},{status:503,headers:{'cache-control':'no-store'}});
  }
}
