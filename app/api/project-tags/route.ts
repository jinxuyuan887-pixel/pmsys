import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, projectTags } from "../../../db/schema";
import { requireApiUser } from "../../auth";
import { isAdministrator } from "../../project-access";

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  const db=await getDb();return Response.json({tags:await db.select().from(projectTags).orderBy(asc(projectTags.name))});
}
export async function POST(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  if(!isAdministrator(auth.user))return Response.json({error:"仅管理员可维护标签库"},{status:403});
  const body=await request.json() as {name?:string};const name=String(body.name??"").trim();
  if(!name||name.length>30)return Response.json({error:"标签名称需为1至30字"},{status:400});
  try{const db=await getDb(),[tag]=await db.insert(projectTags).values({name}).returning();await db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"创建",entityType:"项目标签",entityId:String(tag.id),summary:`创建项目标签：${name}`});return Response.json({tag},{status:201})}catch{return Response.json({error:"标签名称已存在"},{status:409})}
}
export async function PATCH(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  if(!isAdministrator(auth.user))return Response.json({error:"仅管理员可维护标签库"},{status:403});
  const body=await request.json() as {id?:number;enabled?:boolean};if(!body.id)return Response.json({error:"id is required"},{status:400});
  const db=await getDb(),[tag]=await db.update(projectTags).set({enabled:Boolean(body.enabled)}).where(eq(projectTags.id,body.id)).returning();
  return tag?Response.json({tag}):Response.json({error:"标签不存在"},{status:404});
}
