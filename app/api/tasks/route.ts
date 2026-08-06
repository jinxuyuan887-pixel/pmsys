import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, deliveryTaskRecords, deliveryTasks, projects, serviceRecords } from "../../../db/schema";
import { requireApiUser } from "../../auth";
import type { CurrentUser } from "../../auth";
import { canAccessProject } from "../../project-access";

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
  if(!Number.isSafeInteger(Number(task.projectId)))return "请选择所属项目";
  if(!String(task.title??"").trim())return "请填写任务名称";
  if(String(task.title??"").trim().length>100)return "任务名称不能超过100字";
  if(String(task.description??"").length>1000)return "任务说明不能超过1000字";
  if(task.plannedDate&&!/^\d{4}-\d{2}-\d{2}$/.test(String(task.plannedDate)))return "请选择正确的计划日期";
  if(!["未完成","已完成"].includes(String(task.status)))return "任务状态不正确";
  return null;
}

const isAccepted=(status:string)=>["已验收","已完成"].includes(status);
function derivedTaskStatus(plannedQuantity:number,records:Array<{status:string;payload:unknown}>){
  void plannedQuantity;
  return records.length>0&&records.every(record=>isAccepted(record.status))?"已完成":"未完成";
}

async function validateTaskRelations(db:Awaited<ReturnType<typeof getDb>>,task:TaskInput,user:CurrentUser){
  const projectId=Number(task.projectId);
  const [projectRow]=await db.select().from(projects).where(and(eq(projects.id,projectId),isNull(projects.archivedAt))).limit(1);
  if(!projectRow)return "项目不存在或已归档";
  if(!canAccessProject(user,JSON.parse(projectRow.payload)))return "无权操作该项目的任务";
  const recordIds=Array.from(new Set((task.recordIds??[]).map(Number).filter(Number.isSafeInteger)));
  if(recordIds.length){
    const existingLinks=task.id?await db.select().from(deliveryTaskRecords).where(eq(deliveryTaskRecords.taskId,task.id)):[];
    const existingIds=new Set(existingLinks.map(link=>link.recordId));
    const rows=await db.select({id:serviceRecords.id,projectId:serviceRecords.projectId,status:serviceRecords.status})
      .from(serviceRecords).where(and(inArray(serviceRecords.id,recordIds),isNull(serviceRecords.deletedAt)));
    if(rows.length!==recordIds.length||rows.some(record=>record.projectId!==projectId||(isAccepted(record.status)&&!existingIds.has(record.id)))){
      return "只能关联同一项目下尚未验收的有效服务记录";
    }
  }
  return null;
}

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const url=new URL(request.url),status=url.searchParams.get("status")??"all",start=url.searchParams.get("start"),end=url.searchParams.get("end");
    const conditions=[];
    if(start)conditions.push(gte(deliveryTasks.plannedDate,start));
    if(end)conditions.push(lte(deliveryTasks.plannedDate,end));
    const db=await getDb();
    const projectRows=await db.select({id:projects.id,payload:projects.payload}).from(projects);
    const allowed=new Set(projectRows.filter(row=>canAccessProject(auth.user!,JSON.parse(row.payload))).map(row=>row.id));
    const allTasks=await db.select().from(deliveryTasks).where(conditions.length?and(...conditions):undefined).orderBy(asc(deliveryTasks.plannedDate),desc(deliveryTasks.id));
    const tasks=allTasks.filter(task=>allowed.has(task.projectId));
    const taskIds=tasks.map(task=>task.id);
    const links=taskIds.length?await db.select().from(deliveryTaskRecords).where(inArray(deliveryTaskRecords.taskId,taskIds)):[];
    const recordIds=Array.from(new Set(links.map(link=>link.recordId)));
    const records=recordIds.length?await db.select({
      id:serviceRecords.id,projectId:serviceRecords.projectId,serviceId:serviceRecords.serviceId,
      recordType:serviceRecords.recordType,serviceDate:serviceRecords.serviceDate,status:serviceRecords.status,payload:serviceRecords.payload
    }).from(serviceRecords).where(inArray(serviceRecords.id,recordIds)):[];
    const recordsById=new Map(records.map(record=>[record.id,{...record,payload:JSON.parse(record.payload)}]));
    const derivedTasks=tasks.map(task=>{
      const taskRecords=links.filter(link=>link.taskId===task.id).map(link=>recordsById.get(link.recordId)).filter(Boolean) as Array<{status:string;payload:unknown}>;
      return {...task,status:derivedTaskStatus(task.plannedQuantity,taskRecords),recordIds:links.filter(link=>link.taskId===task.id).map(link=>link.recordId),records:taskRecords};
    });
    return Response.json({tasks:derivedTasks.filter(task=>status==="completed"?task.status==="已完成":status==="incomplete"?task.status!=="已完成":true)});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"读取任务失败"},{status:500})}
}

export async function POST(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const task=await request.json() as TaskInput;
    const validation=taskError(task);if(validation)return Response.json({error:validation},{status:400});
    const db=await getDb(),relationError=await validateTaskRelations(db,task,auth.user);
    if(relationError)return Response.json({error:relationError},{status:400});
    const recordIds=Array.from(new Set((task.recordIds??[]).map(Number).filter(Number.isSafeInteger)));
    const linkedRecords=recordIds.length?await db.select({status:serviceRecords.status,payload:serviceRecords.payload}).from(serviceRecords).where(and(inArray(serviceRecords.id,recordIds),isNull(serviceRecords.deletedAt))):[];
    const [created]=await db.insert(deliveryTasks).values({
      projectId:Number(task.projectId),serviceId:0,title:String(task.title).trim(),
      description:String(task.description??"").trim(),plannedQuantity:Math.max(1,recordIds.length),
      plannedDate:String(task.plannedDate??"")||null,owner:String(task.owner??"").trim()||auth.user.name,status:derivedTaskStatus(recordIds.length,linkedRecords)
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
    const relationError=await validateTaskRelations(db,task,auth.user);if(relationError)return Response.json({error:relationError},{status:400});
    const recordIds=Array.from(new Set((task.recordIds??[]).map(Number).filter(Number.isSafeInteger)));
    const linkedRecords=recordIds.length?await db.select({status:serviceRecords.status,payload:serviceRecords.payload}).from(serviceRecords).where(and(inArray(serviceRecords.id,recordIds),isNull(serviceRecords.deletedAt))):[];
    const [updated]=await db.update(deliveryTasks).set({
      projectId:Number(task.projectId),serviceId:0,title:String(task.title).trim(),
      description:String(task.description??"").trim(),plannedQuantity:Math.max(1,recordIds.length),
      plannedDate:String(task.plannedDate??"")||null,owner:String(task.owner??"").trim()||auth.user.name,
      status:derivedTaskStatus(recordIds.length,linkedRecords),updatedAt:sql`CURRENT_TIMESTAMP`
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
    const [projectRow]=await db.select({payload:projects.payload}).from(projects).where(eq(projects.id,current.projectId)).limit(1);
    if(!projectRow||!canAccessProject(auth.user,JSON.parse(projectRow.payload)))return Response.json({error:"无权删除该任务"},{status:403});
    await db.batch([
      db.delete(deliveryTaskRecords).where(eq(deliveryTaskRecords.taskId,id)),
      db.delete(deliveryTasks).where(eq(deliveryTasks.id,id)),
      db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"删除",entityType:"任务",entityId:String(id),summary:`删除任务：${current.title}`,beforePayload:JSON.stringify(current)})
    ]);
    return Response.json({deleted:true,id});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"删除任务失败"},{status:500})}
}
