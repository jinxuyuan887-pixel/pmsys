import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, loginAttempts, sessions, users } from "../../../../db/schema";
import { passwordHash, randomHex, tokenHash } from "../../../auth";

export async function POST(request:Request){
  try{
    const {username,password}=await request.json() as {username?:string;password?:string};
    const normalized=String(username??"").trim(),ip=request.headers.get("cf-connecting-ip")??request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown";
    const db=await getDb(),windowStart=new Date(Date.now()-15*60*1000).toISOString();
    const [recent]=await db.select({count:sql<number>`count(*)`}).from(loginAttempts).where(and(eq(loginAttempts.username,normalized),eq(loginAttempts.ipAddress,ip),eq(loginAttempts.succeeded,false),gte(loginAttempts.createdAt,windowStart)));
    if(Number(recent?.count??0)>=5)return Response.json({error:"登录失败次数过多，请15分钟后再试"},{status:429,headers:{"retry-after":"900"}});
    const [user]=await db.select().from(users).where(eq(users.username,normalized)).limit(1);
    if(!user||!user.active||await passwordHash(String(password??""),user.passwordSalt)!==user.passwordHash){
      await db.batch([
        db.insert(loginAttempts).values({username:normalized||"空账号",ipAddress:ip,succeeded:false}),
        db.insert(auditLogs).values({username:normalized||"未知账号",action:"失败",entityType:"登录",entityId:ip,summary:"账号登录失败"})
      ]);
      return Response.json({error:"账号或密码错误"},{status:401});
    }
    const token=randomHex(),expiresAt=new Date(Date.now()+7*86400000).toISOString();
    await db.batch([
      db.insert(sessions).values({tokenHash:await tokenHash(token),userId:user.id,expiresAt}),
      db.insert(loginAttempts).values({username:normalized,ipAddress:ip,succeeded:true}),
      db.insert(auditLogs).values({userId:user.id,username:user.username,action:"成功",entityType:"登录",entityId:ip,summary:"账号登录成功"})
    ]);
    const secure=new URL(request.url).protocol==="https:"?"; Secure":"";
    return Response.json({user:{id:user.id,username:user.username,name:user.name,role:user.role,mustChangePassword:user.mustChangePassword}},{headers:{"set-cookie":`eap_session=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=604800`}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"登录失败"},{status:500})}
}
