import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, sessions, users } from "../../../db/schema";
import { passwordHash, randomHex, requireApiUser } from "../../auth";

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  const db=await getDb();const rows=await db.select({id:users.id,username:users.username,name:users.name,role:users.role,active:users.active,createdAt:users.createdAt}).from(users).orderBy(asc(users.id));
  return Response.json({accounts:rows});
}
export async function POST(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  const body=await request.json() as {username?:string;name?:string;role?:string;password?:string};
  if(!body.username||!body.name||String(body.password??"").length<6)return Response.json({error:"请完整填写账号信息"},{status:400});
  const salt=randomHex(16),db=await getDb();
  const role=["管理员","项目经理"].includes(String(body.role))?String(body.role):"项目经理";
  const [created]=await db.insert(users).values({username:body.username.trim(),name:body.name.trim(),role,passwordSalt:salt,passwordHash:await passwordHash(String(body.password),salt),mustChangePassword:true}).returning();
  await db.insert(auditLogs).values({userId:auth.user!.id,username:auth.user!.username,action:"创建",entityType:"账号",entityId:String(created.id),summary:`创建账号：${created.username}`});
  return Response.json({ok:true},{status:201});
}
export async function PATCH(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  const body=await request.json() as {id?:number;active?:boolean;newPassword?:string};
  const db=await getDb();
  if(body.newPassword!==undefined){
    if(auth.user!.username!=="ydleapadmin")return Response.json({error:"仅系统主管理员可重置其他账号密码"},{status:403});
    if(!body.id||body.id===auth.user!.id||body.newPassword.length<6)return Response.json({error:"临时密码至少6位"},{status:400});
    const salt=randomHex(16);
    await db.batch([
      db.update(users).set({passwordSalt:salt,passwordHash:await passwordHash(body.newPassword,salt),mustChangePassword:true}).where(eq(users.id,body.id)),
      db.delete(sessions).where(eq(sessions.userId,body.id)),
      db.insert(auditLogs).values({userId:auth.user!.id,username:auth.user!.username,action:"重置",entityType:"账号密码",entityId:String(body.id),summary:`重置账号密码：${targetName(body.id)}`})
    ]);
    return Response.json({ok:true});
  }
  if(!body.id||body.id===auth.user!.id)return Response.json({error:"不能停用当前账号"},{status:400});
  const [target]=await db.select().from(users).where(eq(users.id,body.id)).limit(1);
  if(target?.username==="ydleapadmin")return Response.json({error:"系统主管理员不能停用"},{status:400});
  await db.batch([
    db.update(users).set({active:Boolean(body.active)}).where(eq(users.id,body.id)),
    ...(!body.active?[db.delete(sessions).where(eq(sessions.userId,body.id))]:[]),
    db.insert(auditLogs).values({userId:auth.user!.id,username:auth.user!.username,action:body.active?"启用":"停用",entityType:"账号",entityId:String(body.id),summary:`${body.active?"启用":"停用"}账号：${target?.username??body.id}`})
  ]);
  return Response.json({ok:true});
}

function targetName(id:number){return String(id)}
