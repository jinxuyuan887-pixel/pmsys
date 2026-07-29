import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, fileAttachments, formLinks, projects, serviceRecords } from "../../../db/schema";
import { requireApiUser } from "../../auth";

const allowedTypes=["讲座／团辅活动记录","心理咨询台账","培训活动记录","驻场服务记录","EAP宣传记录","心理测评记录"];
const quantityOf=(data?:Record<string,unknown>)=>Number(data?.quantity??1);
const hasCost=(data?:Record<string,unknown>)=>data?.costUnit!==undefined&&data?.costUnit!==null&&data?.costUnit!=="";
const costOf=(data?:Record<string,unknown>)=>Number(data?.costUnit);
const dateOf=(data?:Record<string,unknown>)=>String(data?.date??"");
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(new Date(`${value}T00:00:00`).getTime());
function validate(type:string,data?:Record<string,unknown>){
  const quantity=quantityOf(data);
  if(!allowedTypes.includes(type))return "记录类型不正确";
  if(!Number.isFinite(quantity)||quantity<=0||quantity>100000)return "完成数量必须大于0且不超过100000";
  if(!validDate(dateOf(data)))return "请选择正确的服务日期";
  if(!String(data?.provider??"").trim())return "请填写服务人员";
  if(!String(data?.summary??"").trim())return "请填写服务执行情况";
  return null;
}
async function projectService(projectId:number,serviceId:number){
  const db=await getDb();
  const [row]=await db.select().from(projects).where(and(eq(projects.id,projectId),isNull(projects.archivedAt))).limit(1);
  if(!row)return null;
  const project=JSON.parse(row.payload) as {name?:string;services?:Array<{id:number;name:string;unitPrice:number;quantity:number}>};
  const service=project.services?.find(item=>item.id===serviceId);
  return service?{row,project,service}:null;
}
async function linkFiles(keys:string[],recordId:number,token?:string){
  if(!keys.length)return;
  const db=await getDb();
  for(const key of keys){
    const [file]=await db.select().from(fileAttachments).where(and(eq(fileAttachments.storageKey,key),isNull(fileAttachments.deletedAt))).limit(1);
    if(file&&(!token||file.formToken===token))await db.update(fileAttachments).set({recordId}).where(eq(fileAttachments.id,file.id));
  }
}

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  try{
    const url=new URL(request.url),page=Math.max(1,Number(url.searchParams.get("page"))||1),pageSize=Math.min(1000,Math.max(10,Number(url.searchParams.get("pageSize"))||1000));
    const conditions=[isNull(serviceRecords.deletedAt)];
    const start=url.searchParams.get("start"),end=url.searchParams.get("end"),status=url.searchParams.get("status");
    if(start)conditions.push(gte(serviceRecords.serviceDate,start));
    if(end)conditions.push(lte(serviceRecords.serviceDate,end));
    if(status&&["已完成","待审核"].includes(status))conditions.push(eq(serviceRecords.status,status));
    const db=await getDb();
    const [rows,totalRows]=await Promise.all([
      db.select().from(serviceRecords).where(and(...conditions)).orderBy(desc(serviceRecords.serviceDate),desc(serviceRecords.updatedAt),desc(serviceRecords.id)).limit(pageSize).offset((page-1)*pageSize),
      db.select({count:sql<number>`count(*)`}).from(serviceRecords).where(and(...conditions))
    ]);
    return Response.json({records:rows.map(row=>({...row,payload:JSON.parse(row.payload)})),page,pageSize,total:Number(totalRows[0]?.count??0)});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"读取失败"},{status:500})}
}

export async function POST(request:Request){
  let reservedToken:string|undefined;
  try{
    const body=await request.json() as {token?:string;type?:string;data?:Record<string,unknown>;uploaded?:string[]};
    const auth=!body.token?await requireApiUser(request):null;
    if(auth?.response)return auth.response;
    const db=await getDb();
    let projectId=Number(body.data?.projectId)||0,serviceId=Number(body.data?.serviceId)||0,type=String(body.type??"");
    if(body.token){
      const now=new Date().toISOString();
      const available=await db.update(formLinks).set({submissionCount:sql`${formLinks.submissionCount} + 1`,lastUsedAt:now})
        .where(and(eq(formLinks.token,body.token),eq(formLinks.status,"有效"),sql`${formLinks.submissionCount} < ${formLinks.maxSubmissions}`,sql`(${formLinks.expiresAt} IS NULL OR ${formLinks.expiresAt} >= ${now})`)).returning();
      const link=available[0];
      if(!link)return Response.json({error:"链接不存在、已过期或已达到提交次数"},{status:404});
      reservedToken=body.token;projectId=link.projectId;serviceId=link.serviceId;type=link.formType;
      body.data={...body.data,projectId,serviceId,source:"外部链接填写"};
    }
    const validation=validate(type,body.data);if(validation)throw new Error(validation);
    const target=await projectService(projectId,serviceId);if(!target)throw new Error("项目或服务内容不存在，可能已归档");
    const status=body.token?"待审核":"已完成";
    const quantity=quantityOf(body.data);
    const unitPrice=status==="已完成"?Number(target.service.unitPrice)||0:null;
    if(status==="已完成"&&!hasCost(body.data))throw new Error("请填写本次成本单价后再保存");
    if(status==="已完成"&&Number(unitPrice)<=0)throw new Error("当前服务单价为0，无法计算利润率，请先修改项目服务单价");
    const costUnit=status==="已完成"?costOf(body.data):null;
    if(costUnit!==null&&(!Number.isFinite(costUnit)||costUnit<0||costUnit>100000000))throw new Error("成本单价必须为0或正数");
    const profitRate=unitPrice&&costUnit!==null?Math.round((unitPrice-costUnit)/unitPrice*10000):null;
    const [record]=await db.insert(serviceRecords).values({
      projectId,serviceId,recordType:type,serviceDate:dateOf(body.data),
      payload:JSON.stringify({...body,data:{...body.data,status}}),status,
      unitPriceSnapshot:unitPrice,amountSnapshot:unitPrice===null?null:Math.round(unitPrice*quantity),
      costUnitSnapshot:costUnit,costAmountSnapshot:costUnit===null?null:Math.round(costUnit*quantity),profitRateBasisPoints:profitRate,
      updatedAt:new Date().toISOString(),approvedAt:status==="已完成"?new Date().toISOString():null
    }).returning();
    await linkFiles(body.uploaded??[],record.id,body.token);
    await db.insert(auditLogs).values({userId:auth?.user?.id,username:auth?.user?.username??"外部填写人",action:"提交",entityType:"服务记录",entityId:String(record.id),summary:`提交${type}`,afterPayload:JSON.stringify(body)});
    return Response.json({record},{status:201});
  }catch(error){
    if(reservedToken){const db=await getDb();await db.update(formLinks).set({submissionCount:sql`max(0, ${formLinks.submissionCount} - 1)`}).where(eq(formLinks.token,reservedToken)).catch(()=>undefined)}
    const message=error instanceof Error?error.message:"提交失败";
    return Response.json({error:message},{status:message.includes("请")||message.includes("不存在")||message.includes("成本")||message.includes("单价")?400:500});
  }
}

export async function PATCH(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const body=await request.json() as {id?:number;status?:string;data?:Record<string,unknown>;type?:string;uploaded?:string[]};
    if(!body.id)return Response.json({error:"id is required"},{status:400});
    if(body.status&&!["待审核","已完成"].includes(body.status))return Response.json({error:"状态不正确"},{status:400});
    const db=await getDb(),[current]=await db.select().from(serviceRecords).where(and(eq(serviceRecords.id,body.id),isNull(serviceRecords.deletedAt))).limit(1);
    if(!current)return Response.json({error:"记录不存在"},{status:404});
    const currentPayload=JSON.parse(current.payload) as {data?:Record<string,unknown>;type?:string;uploaded?:string[]};
    const nextPayload=body.data?{...currentPayload,data:{...currentPayload.data,...body.data},type:body.type??currentPayload.type,uploaded:body.uploaded??currentPayload.uploaded}:currentPayload;
    const type=String(body.type??current.recordType),nextStatus=body.status??current.status;
    const validation=validate(type,nextPayload.data);if(validation)return Response.json({error:validation},{status:400});
    const projectId=Number(nextPayload.data?.projectId)||current.projectId,serviceId=Number(nextPayload.data?.serviceId)||current.serviceId;
    const target=await projectService(projectId,serviceId);if(!target)return Response.json({error:"项目或服务内容不存在，可能已归档"},{status:400});
    const unitPrice=nextStatus==="已完成"?Number(target.service.unitPrice)||0:null,now=new Date().toISOString();
    if(nextStatus==="已完成"&&!hasCost(nextPayload.data))return Response.json({error:"请填写本次成本单价后再审核通过"},{status:400});
    if(nextStatus==="已完成"&&Number(unitPrice)<=0)return Response.json({error:"当前服务单价为0，无法计算利润率，请先修改项目服务单价"},{status:400});
    const costUnit=nextStatus==="已完成"?costOf(nextPayload.data):null;
    if(costUnit!==null&&(!Number.isFinite(costUnit)||costUnit<0||costUnit>100000000))return Response.json({error:"成本单价必须为0或正数"},{status:400});
    const profitRate=unitPrice&&costUnit!==null?Math.round((unitPrice-costUnit)/unitPrice*10000):null;
    const [record]=await db.update(serviceRecords).set({
      status:nextStatus,projectId,serviceId,recordType:type,serviceDate:dateOf(nextPayload.data),payload:JSON.stringify(nextPayload),
      unitPriceSnapshot:unitPrice,amountSnapshot:unitPrice===null?null:Math.round(unitPrice*quantityOf(nextPayload.data)),
      costUnitSnapshot:costUnit,costAmountSnapshot:costUnit===null?null:Math.round(costUnit*quantityOf(nextPayload.data)),profitRateBasisPoints:profitRate,
      updatedAt:now,approvedAt:nextStatus==="已完成"?(current.status==="已完成"?current.approvedAt??now:now):null
    }).where(eq(serviceRecords.id,body.id)).returning();
    await db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:body.status==="已完成"?"审核通过":"修改",entityType:"服务记录",entityId:String(body.id),summary:body.status==="已完成"?`审核通过${record.recordType}`:`修改${record.recordType}`,beforePayload:current.payload,afterPayload:record.payload});
    return Response.json({record});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"更新失败"},{status:500})}
}

export async function DELETE(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const id=Number(new URL(request.url).searchParams.get("id"));if(!id)return Response.json({error:"id is required"},{status:400});
    const db=await getDb(),[current]=await db.select().from(serviceRecords).where(and(eq(serviceRecords.id,id),isNull(serviceRecords.deletedAt))).limit(1);
    if(!current)return Response.json({error:"记录不存在"},{status:404});
    const deletedAt=new Date().toISOString();
    await db.batch([
      db.update(serviceRecords).set({deletedAt,deletedBy:auth.user.username,updatedAt:deletedAt}).where(eq(serviceRecords.id,id)),
      db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"作废",entityType:"服务记录",entityId:String(id),summary:`作废${current.recordType}`,beforePayload:current.payload})
    ]);
    return Response.json({deleted:true,id});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"删除失败"},{status:500})}
}
