import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, deliveryTaskRecords, deliveryTasks, projects, serviceRecords } from "../../../db/schema";
import { requireApiUser } from "../../auth";

type TaskInput={
  id?:number;
  projectId?:number;
  serviceId?:number;
  title?:string;
  description?:string;
  plannedQuantity?:number;
  plannedDate?:string;
  owner?:string;
  status?:string;
  recordIds?:number[];
};

function taskError(task:TaskInput){
  if(!Number.isSafeInteger(Number(task.projectId))||!Number.isSafeInteger(Number(task.serviceId)))return "请选择项目和对应服务";
  if(!String(task.title??"").trim())return "请填写任务名称";
  if(String(task.title??"").trim().length>100)return "任务名称不能超过100字";
  if(String(task.description??"").length>1000)return "任务说明不能超过1000字";
  if(!Number.isFinite(Number(task.plannedQuantity))||Number(task.plannedQuantity)<=0||Number(task.plannedQuantity)>100000)return "计划数量必须大于0且不超过100000";
  if(task.plannedDate&&!/^\d{4}-\d{2}-\d{2}$/.test(String(task.plannedDate)))return "请选择正确的计划日期";
  if(!["未完成","已完成"].includes(String(task.status)))return "任务状态不正确";
  return null;
}

async function validateTaskRelations(db:Awaited<ReturnType<typeof getDb>>,task:TaskInput){
  const projectId=Number(task.projectId),serviceId=Number(task.serviceId);
  const [projectRow]=await db.select().from(projects).where(and(eq(projects.id,projectId),isNull(projects.archivedAt))).limit(1);
  if(!projectRow)return "项目不存在或已归档";
  const project=JSON.parse(projectRow.payload) as {services?:Array<{id:number}>};
  if(!project.services?.some(service=>service.id===serviceId))return "所选服务不属于该项目";
  const recordIds=Array.from(new Set((task.recordIds??[]).map(Number).filter(Number.isSafeInteger)));
  if(task.status==="已完成"&&!recordIds.length)return "已完成任务必须至少关联一条服务记录";
  if(recordIds.length){
    const rows=await db.select({id:serviceRecords.id,projectId:serviceRecords.projectId,serviceId:serviceRecords.serviceId})
      .from(serviceRecords).where(and(inArray(serviceRecords.id,recordIds),isNull(serviceRecords.deletedAt)));
    if(rows.length!==recordIds.length||rows.some(record=>record.projectId!==projectId||record.serviceId!==serviceId)){
      return "只能关联同一项目、同一服务下的有效服务记录";
    }
  }
  return null;
}

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  try{
    const url=new URL(request.url),status=url.searchParams.get("status")??"all",start=url.searchParams.get("start"),end=url.searchParams.get("end");
    const conditions=[];
    if(status==="completed")conditions.push(eq(deliveryTasks.status,"已完成"));
    if(status==="incomplete")conditions.push(ne(deliveryTasks.status,"已完成"));
    if(start)conditions.push(gte(deliveryTasks.plannedDate,start));
    if(end)conditions.push(lte(deliveryTasks.plannedDate,end));
    const db=await getDb();
    const tasks=await db.select().from(deliveryTasks).where(conditions.length?and(...conditions):undefined).orderBy(asc(deliveryTasks.plannedDate),desc(deliveryTasks.id));
    const taskIds=tasks.map(task=>task.id);
    const links=taskIds.length?await db.select().from(deliveryTaskRecords).where(inArray(deliveryTaskRecords.taskId,taskIds)):[];
    const recordIds=Array.from(new Set(links.map(link=>link.recordId)));
    const records=recordIds.length?await db.select({
      id:serviceRecords.id,projectId:serviceRecords.projectId,serviceId:serviceRecords.serviceId,
      recordType:serviceRecords.recordType,serviceDate:serviceRecords.serviceDate,status:serviceRecords.status,payload:serviceRecords.payload
    }).from(serviceRecords).where(inArray(serviceRecords.id,recordIds)):[];
    const recordsById=new Map(records.map(record=>[record.id,{...record,payload:JSON.parse(record.payload)}]));
    return Response.json({tasks:tasks.map(task=>({
      ...task,
      recordIds:links.filter(link=>link.taskId===task.id).map(link=>link.recordId),
      records:links.filter(link=>link.taskId===task.id).map(link=>recordsById.get(link.recordId)).filter(Boolean)
    }))});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"读取任务失败"},{status:500})}
}

export async function POST(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const task=await request.json() as TaskInput;
    const validation=taskError(task);if(validation)return Response.json({error:validation},{status:400});
    const db=await getDb(),relationError=await validateTaskRelations(db,task);
    if(relationError)return Response.json({error:relationError},{status:400});
    const recordIds=Array.from(new Set((task.recordIds??[]).map(Number).filter(Number.isSafeInteger)));
    const [created]=await db.insert(deliveryTasks).values({
      projectId:Number(task.projectId),serviceId:Number(task.serviceId),title:String(task.title).trim(),
      description:String(task.description??"").trim(),plannedQuantity:Number(task.plannedQuantity),
      plannedDate:String(task.plannedDate??"")||null,owner:String(task.owner??"").trim()||auth.user.name,status:String(task.status)
    }).returning();
    await db.batch([
      ...recordIds.map(recordId=>db.insert(deliveryTaskRecords).values({taskId:created.id,recordId})),
      db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"创建",entityType:"任务",entityId:String(created.id),summary:`创建任务：${created.title}`,afterPayload:JSON.stringify({...task,recordIds})})
    ]);
    return Response.json({task:{...created,recordIds}},{status:201});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"创建任务失败"},{status:500})}
}

export async function PATCH(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const task=await request.json() as TaskInput;
    if(!task.id)return Response.json({error:"task id is required"},{status:400});
    const validation=taskError(task);if(validation)return Response.json({error:validation},{status:400});
    const db=await getDb(),[current]=await db.select().from(deliveryTasks).where(eq(deliveryTasks.id,task.id)).limit(1);
    if(!current)return Response.json({error:"任务不存在"},{status:404});
    const relationError=await validateTaskRelations(db,task);if(relationError)return Response.json({error:relationError},{status:400});
    const recordIds=Array.from(new Set((task.recordIds??[]).map(Number).filter(Number.isSafeInteger)));
    const [updated]=await db.update(deliveryTasks).set({
      projectId:Number(task.projectId),serviceId:Number(task.serviceId),title:String(task.title).trim(),
      description:String(task.description??"").trim(),plannedQuantity:Number(task.plannedQuantity),
      plannedDate:String(task.plannedDate??"")||null,owner:String(task.owner??"").trim()||auth.user.name,
      status:String(task.status),updatedAt:sql`CURRENT_TIMESTAMP`
    }).where(eq(deliveryTasks.id,task.id)).returning();
    await db.batch([
      db.delete(deliveryTaskRecords).where(eq(deliveryTaskRecords.taskId,task.id)),
      ...recordIds.map(recordId=>db.insert(deliveryTaskRecords).values({taskId:task.id!,recordId})),
      db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"修改",entityType:"任务",entityId:String(task.id),summary:`修改任务：${updated.title}`,beforePayload:JSON.stringify(current),afterPayload:JSON.stringify({...updated,recordIds})})
    ]);
    return Response.json({task:{...updated,recordIds}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"修改任务失败"},{status:500})}
}

export async function DELETE(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const id=Number(new URL(request.url).searchParams.get("id"));if(!id)return Response.json({error:"id is required"},{status:400});
    const db=await getDb(),[current]=await db.select().from(deliveryTasks).where(eq(deliveryTasks.id,id)).limit(1);
    if(!current)return Response.json({error:"任务不存在"},{status:404});
    await db.batch([
      db.delete(deliveryTaskRecords).where(eq(deliveryTaskRecords.taskId,id)),
      db.delete(deliveryTasks).where(eq(deliveryTasks.id,id)),
      db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"删除",entityType:"任务",entityId:String(id),summary:`删除任务：${current.title}`,beforePayload:JSON.stringify(current)})
    ]);
    return Response.json({deleted:true,id});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"删除任务失败"},{status:500})}
}
