import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, formLinks, projects, serviceRecords } from "../../../db/schema";
import { randomHex, requireApiUser } from "../../auth";
import { appPath } from "../../base-path";
import { recordTypeForServiceName } from "../../service-record-types";
import { canAccessProject } from "../../project-access";

export async function POST(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const body=await request.json() as {projectId?:number;serviceId?:number;formType?:string;remark?:string;startDate?:string;quantity?:number;expiresInDays?:number;maxSubmissions?:number};
    const projectId=Number(body.projectId),serviceId=Number(body.serviceId),max=Math.min(100,Math.max(1,Number(body.maxSubmissions)||1));
    if(!projectId||!serviceId)return Response.json({error:"请选择项目和服务内容"},{status:400});
    const remark=String(body.remark??"").trim();
    if(!remark)return Response.json({error:"请填写活动备注，方便识别该链接"},{status:400});
    if(remark.length>200)return Response.json({error:"活动备注不能超过200字"},{status:400});
    const startDate=String(body.startDate??""),quantity=Number(body.quantity);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate))return Response.json({error:"请选择服务开始日期"},{status:400});
    if(!Number.isFinite(quantity)||quantity<=0||quantity>100000)return Response.json({error:"服务数量必须大于0且不超过100000"},{status:400});
    const db=await getDb(),[row]=await db.select().from(projects).where(and(eq(projects.id,projectId),isNull(projects.archivedAt))).limit(1);
    const project=row?JSON.parse(row.payload) as {name?:string;manager?:string;managerIds?:number[];services?:Array<{id:number;name:string}>}:null;
    const service=project?.services?.find(item=>item.id===serviceId);
    if(!project||!service)return Response.json({error:"项目或服务内容不存在"},{status:400});
    if(!canAccessProject(auth.user,project))return Response.json({error:"无权为该项目生成填写链接"},{status:403});
    const formType=recordTypeForServiceName(service.name);
    const token=randomHex(24).toUpperCase(),days=Number(body.expiresInDays);
    const expiresAt=days>0&&days<=365?new Date(Date.now()+days*86400000).toISOString():null;
    const [link]=await db.insert(formLinks).values({token,projectId,serviceId,formType,remark,expiresAt,maxSubmissions:max}).returning();
    let pendingRecord:typeof serviceRecords.$inferSelect|undefined;
    try{
      [pendingRecord]=await db.insert(serviceRecords).values({
        projectId,serviceId,recordType:formType,serviceDate:startDate,status:"待填写",
        payload:JSON.stringify({type:formType,data:{projectId,serviceId,recordType:formType,startDate,quantity,source:"外部填写待办",formToken:token,status:"待填写"}}),
        updatedAt:new Date().toISOString()
      }).returning();
    }catch(error){
      await db.update(formLinks).set({status:"已停用"}).where(eq(formLinks.id,link.id));
      throw error;
    }
    await db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"生成",entityType:"外部填写链接",entityId:String(link.id),summary:`生成外部链接：${project.name}｜${service.name}`});
    return Response.json({token,path:appPath(`/form/${token}`),link,record:pendingRecord},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"链接生成失败"},{status:500})}
}

export async function GET(request:Request){
  try{
    const url=new URL(request.url),token=url.searchParams.get("token");
    const db=await getDb();
    if(!token){
      const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
      const rows=await db.select().from(formLinks).orderBy(desc(formLinks.createdAt)).limit(200);
      const projectRows=await db.select({id:projects.id,payload:projects.payload}).from(projects);
      const allowed=new Set(projectRows.filter(row=>canAccessProject(auth.user!,JSON.parse(row.payload))).map(row=>row.id));
      return Response.json({links:rows.filter(row=>allowed.has(row.projectId))});
    }
    const [link]=await db.select().from(formLinks).where(eq(formLinks.token,token)).limit(1);
    if(!link||link.status!=="有效"||link.expiresAt&&new Date(link.expiresAt)<new Date()||link.submissionCount>=link.maxSubmissions)return Response.json({error:"链接不存在、已过期或已达到提交次数"},{status:404});
    const [row]=await db.select().from(projects).where(and(eq(projects.id,link.projectId),isNull(projects.archivedAt))).limit(1);
    const project=row?JSON.parse(row.payload) as {name?:string;services?:Array<{id:number;name:string;unit:string}>}:null;
    const service=project?.services?.find(item=>item.id===link.serviceId);
    if(!project||!service)return Response.json({error:"对应项目或服务已归档"},{status:404});
    const candidates=await db.select().from(serviceRecords).where(and(eq(serviceRecords.projectId,link.projectId),eq(serviceRecords.serviceId,link.serviceId),eq(serviceRecords.status,"待填写"),isNull(serviceRecords.deletedAt)));
    const pending=candidates.find(record=>{const payload=JSON.parse(record.payload) as {data?:Record<string,unknown>};return payload.data?.formToken===token});
    const pendingData=pending?(JSON.parse(pending.payload) as {data?:Record<string,unknown>}).data:{};
    return Response.json({projectName:project.name??"对应项目",serviceName:service.name,unit:service.unit??"次",formType:recordTypeForServiceName(service.name),startDate:pendingData?.startDate??"",quantity:pendingData?.quantity??1});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"链接读取失败"},{status:500})}
}

export async function PATCH(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  const body=await request.json() as {id?:number;status?:string};
  if(!body.id||!["有效","已停用"].includes(String(body.status)))return Response.json({error:"参数不正确"},{status:400});
  const db=await getDb(),[current]=await db.select().from(formLinks).where(eq(formLinks.id,body.id)).limit(1);
  if(!current)return Response.json({error:"链接不存在"},{status:404});
  const [projectRow]=await db.select({payload:projects.payload}).from(projects).where(eq(projects.id,current.projectId)).limit(1);
  if(!projectRow||!canAccessProject(auth.user,JSON.parse(projectRow.payload)))return Response.json({error:"无权操作该填写链接"},{status:403});
  const [link]=await db.update(formLinks).set({status:String(body.status)}).where(eq(formLinks.id,body.id)).returning();
  if(!link)return Response.json({error:"链接不存在"},{status:404});
  await db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:body.status==="已停用"?"停用":"启用",entityType:"外部填写链接",entityId:String(link.id),summary:`${body.status==="已停用"?"停用":"启用"}外部填写链接`});
  return Response.json({link});
}
