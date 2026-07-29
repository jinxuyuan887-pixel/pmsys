import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLogs, sessions, users } from "../../../../db/schema";
import { passwordHash, randomHex, requireApiUser } from "../../../auth";

export async function POST(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  const {oldPassword,newPassword}=await request.json() as {oldPassword?:string;newPassword?:string};
  if(String(newPassword??"").length<8)return Response.json({error:"新密码至少8位"},{status:400});
  const db=await getDb(),[current]=await db.select().from(users).where(eq(users.id,auth.user!.id)).limit(1);
  if(!current||await passwordHash(String(oldPassword??""),current.passwordSalt)!==current.passwordHash)return Response.json({error:"原密码不正确"},{status:400});
  const salt=randomHex(16);
  await db.batch([
    db.update(users).set({passwordSalt:salt,passwordHash:await passwordHash(String(newPassword),salt),mustChangePassword:false}).where(eq(users.id,current.id)),
    db.delete(sessions).where(eq(sessions.userId,current.id)),
    db.insert(auditLogs).values({userId:current.id,username:current.username,action:"修改",entityType:"账号密码",entityId:String(current.id),summary:"用户修改登录密码"})
  ]);
  return Response.json({ok:true});
}
