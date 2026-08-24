import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getVercelOidcToken } from '@vercel/oidc';

export class ArenaControlError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, status?: number, options?: ErrorOptions) {
    super(code, options);
    this.name = 'ArenaControlError';
    this.code = code;
    this.status = status;
  }
}

function requiredEnv(name:string){
  const value=process.env[name]?.trim();
  if(!value)throw new ArenaControlError(`env_missing_${name.toLowerCase()}`);
  return value;
}
export function getSupabaseServerConfig(){
  const url=requiredEnv('SUPABASE_URL').replace(/\/$/,'');
  return{url,publishableKey:requiredEnv('SUPABASE_PUBLISHABLE_KEY'),controlUrl:`${url}/functions/v1/arena-control`};
}

export const hashSession=(token:string)=>createHash('sha256').update(token).digest('hex');
export const sanitizeName=(v:unknown)=>String(v??'').trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,18)||'Игрок';
export function controlErrorCode(error:unknown){
  if(error instanceof ArenaControlError)return error.code;
  if(error instanceof Error&&error.message)return `internal_${error.message.toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,48)}`;
  return 'internal_unknown';
}

export async function arenaControl<T=Record<string,unknown>>(body:Record<string,unknown>):Promise<T>{
  const{controlUrl}=getSupabaseServerConfig();
  let oidc:string|undefined;
  try{oidc=await getVercelOidcToken();}
  catch(error){throw new ArenaControlError('oidc_unavailable',undefined,{cause:error});}
  if(!oidc)throw new ArenaControlError('oidc_unavailable');

  let response:Response;
  try{
    response=await fetch(controlUrl,{method:'POST',headers:{authorization:`Bearer ${oidc}`,'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  }catch(error){
    throw new ArenaControlError('control_network',undefined,{cause:error});
  }
  const data=await response.json().catch(()=>({error:'invalid_control_response'}));
  if(!response.ok){
    const remote=String(data?.error||'unknown').toLowerCase().replace(/[^a-z0-9_]+/g,'_').slice(0,48);
    throw new ArenaControlError(`control_${response.status}_${remote}`,response.status);
  }
  return data as T;
}

function canonical(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;const obj=value as Record<string,unknown>;return `{${Object.keys(obj).sort().map(k=>`${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;}
export function signBus<T>(data:T,secret:string){return{data,sig:createHmac('sha256',secret).update(canonical(data)).digest('hex')}}
export function verifyBus<T>(payload:unknown,secret:string):T|null{if(!payload||typeof payload!=='object')return null;const p=payload as{data?:T;sig?:string};if(!p.sig||!/^[0-9a-f]{64}$/i.test(p.sig))return null;const expected=createHmac('sha256',secret).update(canonical(p.data)).digest(),actual=Buffer.from(p.sig,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected)?p.data as T:null;}
