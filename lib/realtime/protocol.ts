import type { PlayerInput,ServerEvent,SnapshotMessage,WorldMessage } from '@/lib/game/types';
export type ClientToGateway={type:'join';name:string}|{type:'input';input:PlayerInput}|{type:'ping';at:number};
export type GatewayToClient=SnapshotMessage|WorldMessage|ServerEvent|{type:'ready';playerId:string;roomId:string;host:boolean}|{type:'pong';at:number;serverTime:number}|{type:'error';message:string};
export type BusMessage={kind:'join';playerId:string;name:string;at:number}|{kind:'leave';playerId:string;at:number}|{kind:'heartbeat';playerId:string;at:number}|{kind:'input';playerId:string;input:PlayerInput;at:number};
