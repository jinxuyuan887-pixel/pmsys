import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { sessions, users } from "../db/schema";

export type CurrentUser={id:number;username:string;name:string;role:string;mustChangePassword:boolean};
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes)).map(value=>value.toString(16).padStart(2,"0")).join("");

export async function passwordHash(password:string,salt:string){
  const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:encoder.encode(salt),iterations:100000},key,256));
}
export async function tokenHash(token:string){return hex(await crypto.subtle.digest("SHA-256",encoder.encode(token)))}
export function randomHex(bytes=24){return Array.from(crypto.getRandomValues(new Uint8Array(bytes))).map(value=>value.toString(16).padStart(2,"0")).join("")}
export function sessionToken(request:Request){return request.headers.get("cookie")?.match(/(?:^|;\s*)eap_session=([^;]+)/)?.[1]??null}
export async function userForToken(token:string|null):Promise<CurrentUser|null>{
  if(!token)return null;
  const db=await getDb(),hashed=await tokenHash(token);
  const [row]=await db.select({id:users.id,username:users.username,name:users.name,role:users.role,mustChangePassword:users.mustChangePassword}).from(sessions).innerJoin(users,eq(sessions.userId,users.id)).where(and(eq(sessions.tokenHash,hashed),gt(sessions.expiresAt,new Date().toISOString()),eq(users.active,true))).limit(1);
  return row??null;
}
export async function requireApiUser(request:Request){
  const user=await userForToken(sessionToken(request));
  if(!user)return {user:null,response:Response.json({error:"请先登录"},{status:401})};
  return {user,response:null};
}
