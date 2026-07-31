import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, formLinks, projects } from "../../../db/schema";
import { randomHex, requireApiUser } from "../../auth";
import { appPath } from "../../base-path";

const allowedTypes=["心理咨询台账","讲座／团辅活动记录","培训活动记录","驻场服务记录","EAP宣传记录"];

export async function POST(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const body=await request.json() as {projectId?:number;serviceId?:number;formType?:string;expiresInDays?:number;maxSubmissions?:number};
    const projectId=Number(body.projectId),serviceId=Number(body.serviceId),max=Math.min(100,Math.max(1,Number(body.maxSubmissions)||1));
    if(!projectId||!serviceId)return Response.json({error:"请选择项目和服务内容"},{status:400});
    if(!allowedTypes.includes(String(body.formType)))return Response.json({error:"填写表单类型不正确"},{status:400});
    const db=await getDb(),[row]=await db.select().from(projects).where(and(eq(projects.id,projectId),isNull(projects.archivedAt))).limit(1);
    const project=row?JSON.parse(row.payload) as {name?:string;services?:Array<{id:number;name:string}>}:null;
    const service=project?.services?.find(item=>item.id===serviceId);
    if(!project||!service)return Response.json({error:"项目或服务内容不存在"},{status:400});
    const token=randomHex(24).toUpperCase(),days=Number(body.expiresInDays);
    const expiresAt=days>0&&days<=365?new Date(Date.now()+days*86400000).toISOString():null;
    const [link]=await db.insert(formLinks).values({token,projectId,serviceId,formType:String(body.formType),expiresAt,maxSubmissions:max}).returning();
    await db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"生成",entityType:"外部填写链接",entityId:String(link.id),summary:`生成外部链接：${project.name}｜${service.name}`});
    return Response.json({token,path:appPath(`/form/${token}`),link},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"链接生成失败"},{status:500})}
}

export async function GET(request:Request){
  try{
    const url=new URL(request.url),token=url.searchParams.get("token");
    const db=await getDb();
    if(!token){
      const auth=await requireApiUser(request);if(auth.response)return auth.response;
      const rows=await db.select().from(formLinks).orderBy(desc(formLinks.createdAt)).limit(200);
      return Response.json({links:rows});
    }
    const [link]=await db.select().from(formLinks).where(eq(formLinks.token,token)).limit(1);
    if(!link||link.status!=="有效"||link.expiresAt&&new Date(link.expiresAt)<new Date()||link.submissionCount>=link.maxSubmissions)return Response.json({error:"链接不存在、已过期或已达到提交次数"},{status:404});
    const [row]=await db.select().from(projects).where(and(eq(projects.id,link.projectId),isNull(projects.archivedAt))).limit(1);
    const project=row?JSON.parse(row.payload) as {name?:string;services?:Array<{id:number;name:string;unit:string}>}:null;
    const service=project?.services?.find(item=>item.id===link.serviceId);
    if(!project||!service)return Response.json({error:"对应项目或服务已归档"},{status:404});
    return Response.json({projectName:project.name??"对应项目",serviceName:service.name,unit:service.unit??"次",formType:link.formType});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"链接读取失败"},{status:500})}
}

export async function PATCH(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  const body=await request.json() as {id?:number;status?:string};
  if(!body.id||!["有效","已停用"].includes(String(body.status)))return Response.json({error:"参数不正确"},{status:400});
  const db=await getDb(),[link]=await db.update(formLinks).set({status:String(body.status)}).where(eq(formLinks.id,body.id)).returning();
  if(!link)return Response.json({error:"链接不存在"},{status:404});
  await db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:body.status==="已停用"?"停用":"启用",entityType:"外部填写链接",entityId:String(link.id),summary:`${body.status==="已停用"?"停用":"启用"}外部填写链接`});
  return Response.json({link});
}
