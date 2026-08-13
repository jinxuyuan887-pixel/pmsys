import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, deliveryTaskRecords, deliveryTasks, fileAttachments, formLinks, projects, serviceRecords } from "../../../db/schema";
import { requireApiUser } from "../../auth";
import { roundMoney } from "../../money";
import type { CurrentUser } from "../../auth";
import { canAccessProject } from "../../project-access";
import { recordTypeForServiceName } from "../../service-record-types";

const allowedTypes=["讲座／团辅活动记录","心理咨询台账","培训活动记录","驻场服务记录","EAP宣传记录","心理测评记录"];
const quantityOf=(data?:Record<string,unknown>)=>Number(data?.quantity??1);
const hasValue=(value:unknown)=>value!==undefined&&value!==null&&value!=="";
const hasCost=(data?:Record<string,unknown>)=>(hasValue(data?.consultantCostUnit)&&hasValue(data?.materialCostUnit))||hasValue(data?.costUnit);
const consultantCostOf=(data?:Record<string,unknown>)=>Number(data?.consultantCostUnit??data?.costUnit??0);
const materialCostOf=(data?:Record<string,unknown>)=>Number(data?.materialCostUnit??0);
const costOf=(data?:Record<string,unknown>)=>consultantCostOf(data)+materialCostOf(data);
const dateOf=(data?:Record<string,unknown>)=>String(data?.startDate??data?.date??"");
const endDateOf=(data?:Record<string,unknown>)=>String(data?.endDate??data?.startDate??data?.date??"");
const isAccepted=(status:string)=>["已验收","已完成"].includes(status);
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(new Date(`${value}T00:00:00`).getTime());
async function accessibleProjectIds(db:Awaited<ReturnType<typeof getDb>>,user:CurrentUser){
  const rows=await db.select({id:projects.id,payload:projects.payload}).from(projects);
  return rows.filter(row=>canAccessProject(user,JSON.parse(row.payload))).map(row=>row.id);
}
function validateInitiation(type:string,data?:Record<string,unknown>){
  const quantity=quantityOf(data);
  if(!allowedTypes.includes(type))return "记录类型不正确";
  if(!Number.isFinite(quantity)||quantity<=0||quantity>100000)return "完成数量必须大于0且不超过100000";
  if(!validDate(dateOf(data)))return "请选择正确的服务开始日期";
  if(hasValue(data?.endDate)&&!validDate(endDateOf(data)))return "请选择正确的服务结束日期";
  if(hasValue(data?.endDate)&&endDateOf(data)<dateOf(data))return "服务结束日期不能早于开始日期";
  return null;
}
function validateForAcceptance(type:string,data?:Record<string,unknown>){
  const initiation=validateInitiation(type,data);if(initiation)return initiation;
  if(!hasValue(data?.endDate)||!validDate(String(data?.endDate)))return "验收前请填写正确的服务结束日期";
  if(String(data?.endDate)<dateOf(data))return "服务结束日期不能早于开始日期";
  if(!String(data?.provider??"").trim())return "请填写服务人员";
  if(!String(data?.summary??"").trim())return "请填写服务执行情况";
  if(hasValue(data?.satisfaction)){
    const satisfaction=Number(data?.satisfaction);
    if(!Number.isFinite(satisfaction)||satisfaction<0||satisfaction>10||Math.abs(satisfaction*100-Math.round(satisfaction*100))>1e-8)return "满意度必须是0到10分之间、最多两位小数";
  }
  if(type==="心理咨询台账"){
    if(!["线上咨询","线下咨询","驻场咨询"].includes(String(data?.method??"")))return "请选择正确的咨询方式";
    const duration=Number(data?.duration);
    if(!Number.isFinite(duration)||duration<=0||duration>1440)return "咨询时长必须大于0且不超过1440分钟";
    if(!["无风险","需要跟进","重点关注"].includes(String(data?.risk??"")))return "请选择风险情况";
  }else{
    if(!String(data?.topic??"").trim())return "请填写活动主题";
    const participants=Number(data?.participants);
    if(!Number.isFinite(participants)||participants<=0||participants>100000)return "参与人数必须大于0且不超过100000";
    if(!String(data?.location??"").trim())return "请填写活动地点";
  }
  return null;
}
async function projectService(projectId:number,serviceId:number){
  const db=await getDb();
  const [row]=await db.select().from(projects).where(and(eq(projects.id,projectId),isNull(projects.archivedAt))).limit(1);
  if(!row)return null;
  const project=JSON.parse(row.payload) as {name?:string;manager?:string;managerIds?:number[];services?:Array<{id:number;name:string;unitPrice:number;quantity:number}>};
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

async function refreshLinkedTasks(db:Awaited<ReturnType<typeof getDb>>,recordId:number){
  const links=await db.select().from(deliveryTaskRecords).where(eq(deliveryTaskRecords.recordId,recordId));
  const taskIds=Array.from(new Set(links.map(link=>link.taskId)));
  if(!taskIds.length)return;
  const tasks=await db.select().from(deliveryTasks).where(inArray(deliveryTasks.id,taskIds));
  const allLinks=await db.select().from(deliveryTaskRecords).where(inArray(deliveryTaskRecords.taskId,taskIds));
  const recordIds=Array.from(new Set(allLinks.map(link=>link.recordId)));
  const records=recordIds.length?await db.select().from(serviceRecords).where(and(inArray(serviceRecords.id,recordIds),isNull(serviceRecords.deletedAt))):[];
  const byId=new Map(records.map(record=>[record.id,record]));
  for(const task of tasks){
    const linkedRecords=allLinks.filter(link=>link.taskId===task.id).map(link=>byId.get(link.recordId)).filter(Boolean);
    const completed=linkedRecords.length>0&&linkedRecords.every(record=>record&&isAccepted(record.status));
    await db.update(deliveryTasks).set({status:completed?"已完成":"未完成",updatedAt:sql`CURRENT_TIMESTAMP`}).where(eq(deliveryTasks.id,task.id));
  }
}

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const url=new URL(request.url),page=Math.max(1,Number(url.searchParams.get("page"))||1),pageSize=Math.min(1000,Math.max(10,Number(url.searchParams.get("pageSize"))||1000));
    const conditions=[isNull(serviceRecords.deletedAt)];
    const start=url.searchParams.get("start"),end=url.searchParams.get("end"),status=url.searchParams.get("status");
    if(start)conditions.push(gte(serviceRecords.serviceDate,start));
    if(end)conditions.push(lte(serviceRecords.serviceDate,end));
    if(status&&["已验收","已完成","待验收","待审核","待填写"].includes(status))conditions.push(eq(serviceRecords.status,status));
    const db=await getDb();
    const allowed=await accessibleProjectIds(db,auth.user);
    if(!allowed.length)return Response.json({records:[],page,pageSize,total:0});
    conditions.push(inArray(serviceRecords.projectId,allowed));
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
    let pendingRecord:typeof serviceRecords.$inferSelect|undefined;
    if(body.token){
      const now=new Date().toISOString();
      const available=await db.update(formLinks).set({submissionCount:sql`${formLinks.submissionCount} + 1`,lastUsedAt:now})
        .where(and(eq(formLinks.token,body.token),eq(formLinks.status,"有效"),sql`${formLinks.submissionCount} < ${formLinks.maxSubmissions}`,sql`(${formLinks.expiresAt} IS NULL OR ${formLinks.expiresAt} >= ${now})`)).returning();
      const link=available[0];
      if(!link)return Response.json({error:"链接不存在、已过期或已达到提交次数"},{status:404});
      reservedToken=body.token;projectId=link.projectId;serviceId=link.serviceId;type=link.formType;
      const candidates=await db.select().from(serviceRecords).where(and(eq(serviceRecords.projectId,projectId),eq(serviceRecords.serviceId,serviceId),eq(serviceRecords.status,"待填写"),isNull(serviceRecords.deletedAt)));
      pendingRecord=candidates.find(record=>{
        const payload=JSON.parse(record.payload) as {data?:Record<string,unknown>};
        return payload.data?.formToken===body.token;
      });
      const pendingPayload=pendingRecord?JSON.parse(pendingRecord.payload) as {data?:Record<string,unknown>}:{data:{}};
      body.data={...pendingPayload.data,...body.data,projectId,serviceId,source:"外部链接填写"};
    }
    const target=await projectService(projectId,serviceId);if(!target)throw new Error("项目或服务内容不存在，可能已归档");
    if(auth?.user&&!canAccessProject(auth.user,target.project))return Response.json({error:"无权在该项目发起服务记录"},{status:403});
    type=recordTypeForServiceName(target.service.name);
    body.data={...body.data,recordType:type};
    const validation=validateInitiation(type,body.data);if(validation)throw new Error(validation);
    const now=new Date().toISOString(),status="待验收";
    const recordValues={
      projectId,serviceId,recordType:type,serviceDate:dateOf(body.data),
      payload:JSON.stringify({...body,data:{...body.data,status}}),status,
      unitPriceSnapshot:null,amountSnapshot:null,costUnitSnapshot:null,costAmountSnapshot:null,profitRateBasisPoints:null,
      updatedAt:now,approvedAt:null
    };
    const [record]=pendingRecord
      ?await db.update(serviceRecords).set(recordValues).where(eq(serviceRecords.id,pendingRecord.id)).returning()
      :await db.insert(serviceRecords).values(recordValues).returning();
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
    const body=await request.json() as {id?:number;status?:string;data?:Record<string,unknown>;type?:string;uploaded?:string[];action?:string;paymentStatus?:string};
    if(!body.id)return Response.json({error:"id is required"},{status:400});
    if(body.status&&!["待填写","待审核","待验收","已验收"].includes(body.status))return Response.json({error:"状态不正确"},{status:400});
    const db=await getDb(),[current]=await db.select().from(serviceRecords).where(and(eq(serviceRecords.id,body.id),isNull(serviceRecords.deletedAt))).limit(1);
    if(!current)return Response.json({error:"记录不存在"},{status:404});
    const allowed=await accessibleProjectIds(db,auth.user);if(!allowed.includes(current.projectId))return Response.json({error:"无权操作该服务记录"},{status:403});
    if(body.action==="payment"){
      if(!isAccepted(current.status))return Response.json({error:"服务记录验收完成后才能确认支付"},{status:400});
      if(!["待支付","已支付"].includes(String(body.paymentStatus)))return Response.json({error:"支付状态不正确"},{status:400});
      if(current.costAmountSnapshot===null||current.costAmountSnapshot===undefined)return Response.json({error:"记录缺少成本，不能确认支付"},{status:400});
      const paymentStatus=String(body.paymentStatus),now=new Date().toISOString();
      const [record]=await db.update(serviceRecords).set({paymentStatus,paidAt:paymentStatus==="已支付"?now:null,paidBy:paymentStatus==="已支付"?auth.user.username:null,updatedAt:now}).where(eq(serviceRecords.id,body.id)).returning();
      await db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:paymentStatus==="已支付"?"确认支付":"撤销支付",entityType:"服务记录",entityId:String(body.id),summary:`${paymentStatus==="已支付"?"确认":"撤销"}${current.recordType}成本支付`,beforePayload:JSON.stringify(current),afterPayload:JSON.stringify(record)});
      return Response.json({record});
    }
    const currentPayload=JSON.parse(current.payload) as {data?:Record<string,unknown>;type?:string;uploaded?:string[]};
    const nextPayload=body.data?{...currentPayload,data:{...currentPayload.data,...body.data},type:body.type??currentPayload.type,uploaded:body.uploaded??currentPayload.uploaded}:currentPayload;
    let type=String(body.type??current.recordType);const nextStatus=body.status??current.status;
    const projectId=Number(nextPayload.data?.projectId)||current.projectId,serviceId=Number(nextPayload.data?.serviceId)||current.serviceId;
    const target=await projectService(projectId,serviceId);if(!target)return Response.json({error:"项目或服务内容不存在，可能已归档"},{status:400});
    if(!canAccessProject(auth.user,target.project))return Response.json({error:"无权将记录转移到该项目"},{status:403});
    type=recordTypeForServiceName(target.service.name);
    nextPayload.type=type;nextPayload.data={...nextPayload.data,recordType:type};
    const validation=nextStatus==="已验收"?validateForAcceptance(type,nextPayload.data):validateInitiation(type,nextPayload.data);if(validation)return Response.json({error:validation},{status:400});
    if(body.status==="已验收"&&current.status!=="待验收")return Response.json({error:"只有待验收记录可以执行验收"},{status:400});
    const hasFrozenFinance=isAccepted(nextStatus);
    const unitPrice=hasFrozenFinance?Number(target.service.unitPrice)||0:null,now=new Date().toISOString();
    if(hasFrozenFinance&&!hasCost(nextPayload.data))return Response.json({error:"请填写咨询师成本和物料成本后再提交验收"},{status:400});
    if(hasFrozenFinance&&Number(unitPrice)<=0)return Response.json({error:"当前服务单价为0，无法计算利润率，请先修改项目服务单价"},{status:400});
    const consultantCostUnit=hasFrozenFinance?consultantCostOf(nextPayload.data):null;
    const materialCostUnit=hasFrozenFinance?materialCostOf(nextPayload.data):null;
    const costUnit=hasFrozenFinance?costOf(nextPayload.data):null;
    if([consultantCostUnit,materialCostUnit,costUnit].some(value=>value!==null&&(!Number.isFinite(value)||value<0||value>100000000)))return Response.json({error:"咨询师成本和物料成本必须为0或正数"},{status:400});
    if(hasFrozenFinance)nextPayload.data={...nextPayload.data,consultantCostUnit,materialCostUnit,costUnit};
    const profitRate=unitPrice&&costUnit!==null?Math.round((unitPrice-costUnit)/unitPrice*10000):null;
    const [record]=await db.update(serviceRecords).set({
      status:nextStatus,projectId,serviceId,recordType:type,serviceDate:dateOf(nextPayload.data),payload:JSON.stringify(nextPayload),
      unitPriceSnapshot:unitPrice,amountSnapshot:unitPrice===null?null:roundMoney(unitPrice*quantityOf(nextPayload.data)),
      costUnitSnapshot:costUnit,costAmountSnapshot:costUnit===null?null:roundMoney(costUnit*quantityOf(nextPayload.data)),profitRateBasisPoints:profitRate,
      updatedAt:now,approvedAt:isAccepted(nextStatus)?(isAccepted(current.status)?current.approvedAt??now:now):null
    }).where(eq(serviceRecords.id,body.id)).returning();
    await db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:body.status==="已验收"?"验收通过":body.status==="待验收"?"审核通过":"修改",entityType:"服务记录",entityId:String(body.id),summary:body.status?`${body.status}：${record.recordType}`:`修改${record.recordType}`,beforePayload:current.payload,afterPayload:record.payload});
    await refreshLinkedTasks(db,record.id);
    return Response.json({record});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"更新失败"},{status:500})}
}

export async function DELETE(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const id=Number(new URL(request.url).searchParams.get("id"));if(!id)return Response.json({error:"id is required"},{status:400});
    const db=await getDb(),[current]=await db.select().from(serviceRecords).where(and(eq(serviceRecords.id,id),isNull(serviceRecords.deletedAt))).limit(1);
    if(!current)return Response.json({error:"记录不存在"},{status:404});
    const allowed=await accessibleProjectIds(db,auth.user);if(!allowed.includes(current.projectId))return Response.json({error:"无权作废该服务记录"},{status:403});
    const deletedAt=new Date().toISOString();
    await db.batch([
      db.update(serviceRecords).set({deletedAt,deletedBy:auth.user.username,updatedAt:deletedAt}).where(eq(serviceRecords.id,id)),
      db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"作废",entityType:"服务记录",entityId:String(id),summary:`作废${current.recordType}`,beforePayload:current.payload})
    ]);
    await refreshLinkedTasks(db,id);
    return Response.json({deleted:true,id});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"删除失败"},{status:500})}
}
