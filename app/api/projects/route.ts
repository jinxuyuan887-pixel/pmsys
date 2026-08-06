import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, deliveryTaskRecords, deliveryTasks, projects, projectTags, projectVersions, serviceRecords, users } from "../../../db/schema";
import { requireApiUser } from "../../auth";
import { canAccessProject, isAdministrator } from "../../project-access";

type ProjectInput = { id: number; name?: string; manager?:string; managerIds?:number[]; _version?: number; [key: string]: unknown };
const clean = (project: ProjectInput) => {
  const services=Array.isArray(project.services)?project.services as ServiceInput[]:[];
  const payload = { ...project, total:services.reduce((sum,service)=>sum+Number(service.quantity)*Number(service.unitPrice),0) };
  delete payload._version;
  return payload;
};

type ServiceInput={id:number;name:string;contractDetail?:string;unit?:string;quantity:number;unitPrice:number;costPrice?:number;completed?:number;billingMode?:"delivery"|"annual-time"};
function validateProject(project:ProjectInput){
  if(!String(project.name??"").trim())return "请填写项目名称";
  const services=Array.isArray(project.services)?project.services as ServiceInput[]:[];
  for(const service of services){
    if(!Number.isSafeInteger(Number(service.id))||!String(service.name??"").trim())return "服务内容信息不完整";
    if(!Number.isFinite(Number(service.quantity))||Number(service.quantity)<=0||Number(service.quantity)>100000)return "服务数量必须大于0且不超过100000";
    if(!Number.isFinite(Number(service.unitPrice))||Number(service.unitPrice)<0||Number(service.unitPrice)>100000000)return "服务单价不符合要求";
    if(!Number.isFinite(Number(service.costPrice??0))||Number(service.costPrice??0)<0)return "成本单价不能为负数";
    if(!["delivery","annual-time"].includes(String(service.billingMode??"delivery")))return "服务计费方式不正确";
    if(String(service.contractDetail??"").length>500)return "合同详情说明不能超过500字";
  }
  const start=String(project.start??""),end=String(project.end??"");
  if(start&&end&&start>end)return "项目结束日期不能早于开始日期";
  if(!["P0","P1","P2"].includes(String(project.priority??"P1")))return "项目优先级不正确";
  if(Array.isArray(project.tags)&&project.tags.some(tag=>typeof tag!=="string"||tag.length>30))return "项目标签不正确";
  if(String(project.presalesWork??"").length>1000)return "售前工作内容不能超过1000字";
  if(String(project.financialContractNo??"").length>100)return "财务合同编号不能超过100字";
  return null;
}

async function validateProjectTags(db:Awaited<ReturnType<typeof getDb>>,project:ProjectInput,existingTags:string[]=[]){
  const submitted=Array.isArray(project.tags)?Array.from(new Set(project.tags.map(String))):[];
  if(!submitted.length)return null;
  const rows=await db.select().from(projectTags).where(inArray(projectTags.name,submitted));
  const allowed=new Set(rows.filter(tag=>tag.enabled||existingTags.includes(tag.name)).map(tag=>tag.name));
  return submitted.every(tag=>allowed.has(tag))?null:"项目只能选择标签库中已启用的标签";
}

async function normalizeProjectManagers(db:Awaited<ReturnType<typeof getDb>>,project:ProjectInput){
  const submittedIds=Array.isArray(project.managerIds)
    ? Array.from(new Set(project.managerIds.map(Number).filter(Number.isSafeInteger)))
    : [];
  const legacyNames=submittedIds.length===0
    ? String(project.manager??"").split(/[、,，]/).map(name=>name.trim()).filter(Boolean)
    : [];
  const conditions=[eq(users.active,true)];
  const managerRows=submittedIds.length
    ? await db.select({id:users.id,name:users.name}).from(users).where(and(...conditions,inArray(users.id,submittedIds)))
    : legacyNames.length
      ? await db.select({id:users.id,name:users.name}).from(users).where(and(...conditions,inArray(users.name,legacyNames)))
      : [];
  const byId=new Map(managerRows.map(manager=>[manager.id,manager]));
  const byName=new Map(managerRows.map(manager=>[manager.name,manager]));
  const selected=(submittedIds.length
    ? submittedIds.map(id=>byId.get(id)).filter(Boolean)
    : legacyNames.map(name=>byName.get(name)).filter(Boolean)) as Array<{id:number;name:string}>;
  if(selected.length==0||(submittedIds.length&&selected.length!==submittedIds.length)||(legacyNames.length&&selected.length!==legacyNames.length)){
    return {error:"请从系统已有的启用项目经理账号中至少选择一人"} as const;
  }
  return {project:{...project,managerIds:selected.map(manager=>manager.id),manager:selected.map(manager=>manager.name).join("、")}} as const;
}

export async function GET(request: Request) {
  const auth = await requireApiUser(request); if (auth.response) return auth.response;
  try {
    const db = await getDb();
    const includeArchived=new URL(request.url).searchParams.get("includeArchived")==="1";
    const allRows = includeArchived
      ? await db.select().from(projects).orderBy(asc(projects.id))
      : await db.select().from(projects).where(isNull(projects.archivedAt)).orderBy(asc(projects.id));
    const rows=isAdministrator(auth.user!)?allRows:allRows.filter(row=>canAccessProject(auth.user!,JSON.parse(row.payload)));
    const delivered=await db.select({
      projectId:serviceRecords.projectId,
      serviceId:serviceRecords.serviceId,
      quantity:sql<number>`sum(CAST(COALESCE(json_extract(${serviceRecords.payload}, '$.data.quantity'), 1) AS REAL))`
    }).from(serviceRecords).where(and(inArray(serviceRecords.status,["已验收","已完成"]),isNull(serviceRecords.deletedAt))).groupBy(serviceRecords.projectId,serviceRecords.serviceId);
    const totals=new Map(delivered.map(item=>[`${item.projectId}:${item.serviceId}`,Number(item.quantity)||0]));
    return Response.json({ projects: rows.map(row => {
      const project=JSON.parse(row.payload) as {services?:ServiceInput[]};
      return {...project,total:(project.services??[]).reduce((sum,service)=>sum+Number(service.quantity)*Number(service.unitPrice),0),services:(project.services??[]).map(service=>({...service,completed:totals.get(`${row.id}:${service.id}`)??0})),_version:row.version,_archivedAt:row.archivedAt,_closedAt:row.closedAt,_closedBy:row.closedBy,_taxRateBasisPoints:row.taxRateBasisPoints,_taxAmount:row.taxAmount,_finalRevenue:row.finalRevenue,_finalCost:row.finalCost,_finalProfit:row.finalProfit,_isDemo:row.isDemo};
    }) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取项目失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request); if (auth.response || !auth.user) return auth.response;
  try {
    const body = await request.json() as { project?: ProjectInput };
    if (!body.project?.id) return Response.json({ error: "project is required" }, { status: 400 });
    const validation=validateProject(body.project);if(validation)return Response.json({error:validation},{status:400});
    const db = await getDb();
    const tagError=await validateProjectTags(db,body.project);if(tagError)return Response.json({error:tagError},{status:400});
    const normalized=await normalizeProjectManagers(db,body.project);
    if("error" in normalized)return Response.json({error:normalized.error},{status:400});
    const project=normalized.project;
    if(!isAdministrator(auth.user)&&!canAccessProject(auth.user,project))return Response.json({error:"项目经理新建项目时必须将本人设为项目经理"},{status:403});
    const payload = JSON.stringify(clean(project));
    const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, body.project.id)).limit(1);
    if (existing) return Response.json({ error: "项目编号已存在，请刷新后重试" }, { status: 409 });
    await db.batch([
      db.insert(projects).values({ id: body.project.id, payload, version: 1, isDemo:false }),
      db.insert(projectVersions).values({ projectId: body.project.id, version: 1, payload, changedBy: auth.user.username }),
      db.insert(auditLogs).values({ userId: auth.user.id, username: auth.user.username, action: "创建", entityType: "项目", entityId: String(body.project.id), summary: `创建项目：${project.name ?? body.project.id}`, afterPayload: payload }),
    ]);
    return Response.json({ project: { ...clean(project), _version: 1 } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创建项目失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(request); if (auth.response || !auth.user) return auth.response;
  try {
    const body = await request.json() as { project?: ProjectInput; expectedVersion?: number; audit?: boolean; action?:string; id?:number };
    if(body.action==="close"&&body.id){
      const db=await getDb(),[current]=await db.select().from(projects).where(and(eq(projects.id,body.id),isNull(projects.archivedAt))).limit(1);
      if(!current)return Response.json({error:"项目不存在、已归档或已经结项"},{status:404});
      const project=JSON.parse(current.payload) as ProjectInput & {services?:ServiceInput[]};
      if(!canAccessProject(auth.user,project))return Response.json({error:"无权操作该项目"},{status:403});
      const records=await db.select().from(serviceRecords).where(and(eq(serviceRecords.projectId,body.id),isNull(serviceRecords.deletedAt)));
      const accepted=records.filter(record=>["已验收","已完成"].includes(record.status));
      const delivered=new Map<number,number>();
      for(const record of accepted){
        const payload=JSON.parse(record.payload) as {data?:Record<string,unknown>};
        delivered.set(record.serviceId,(delivered.get(record.serviceId)??0)+Number(payload.data?.quantity??1));
      }
      const blockers:string[]=[];
      for(const service of project.services??[]){
        if(service.billingMode==="annual-time"){
          if(String(project.end??"")>new Date().toISOString().slice(0,10))blockers.push(`${service.name}为年包按时间确认收入，项目尚未到期`);
          continue;
        }
        const actual=delivered.get(service.id)??0;
        if(actual<Number(service.quantity))blockers.push(`${service.name}尚差 ${Number(service.quantity)-actual} ${service.unit??"次"}未验收`);
      }
      const pending=records.filter(record=>["待填写","待审核","待验收"].includes(record.status));
      if(pending.length)blockers.push(`仍有 ${pending.length} 条服务记录待填写或待验收`);
      const missingCost=accepted.filter(record=>record.costAmountSnapshot===null||record.costAmountSnapshot===undefined);
      if(missingCost.length)blockers.push(`仍有 ${missingCost.length} 条已验收记录缺少成本`);
      const unpaid=accepted.filter(record=>record.paymentStatus!=="已支付");
      if(unpaid.length)blockers.push(`仍有 ${unpaid.length} 条已验收记录成本未支付`);
      const tasks=await db.select().from(deliveryTasks).where(eq(deliveryTasks.projectId,body.id));
      if(tasks.length){
        const links=await db.select().from(deliveryTaskRecords).where(inArray(deliveryTaskRecords.taskId,tasks.map(task=>task.id)));
        const acceptedById=new Map(accepted.map(record=>[record.id,record]));
        const incomplete=tasks.filter(task=>{
          const quantity=links.filter(link=>link.taskId===task.id).reduce((sum,link)=>{
            const record=acceptedById.get(link.recordId);if(!record)return sum;
            const payload=JSON.parse(record.payload) as {data?:Record<string,unknown>};
            return sum+Number(payload.data?.quantity??1);
          },0);
          return quantity<task.plannedQuantity;
        });
        if(incomplete.length)blockers.push(`仍有 ${incomplete.length} 个交付任务未完成`);
      }
      if(blockers.length)return Response.json({error:"项目暂不能结项",blockers},{status:409});
      const now=new Date().toISOString(),payload=clean({...project,status:"已结项"}),nextVersion=current.version+1;
      const finalRevenue=Number(payload.total??0),finalCost=accepted.reduce((sum,record)=>sum+Number(record.costAmountSnapshot??0),0);
      const taxRateBasisPoints=600,taxAmount=Math.round(finalRevenue*taxRateBasisPoints/10000),finalProfit=finalRevenue-finalCost-taxAmount;
      await db.batch([
        db.update(projects).set({payload:JSON.stringify(payload),version:nextVersion,closedAt:now,closedBy:auth.user.username,archivedAt:now,taxRateBasisPoints,taxAmount,finalRevenue,finalCost,finalProfit,updatedAt:now}).where(eq(projects.id,body.id)),
        db.insert(projectVersions).values({projectId:body.id,version:nextVersion,payload:JSON.stringify(payload),changedBy:auth.user.username}),
        db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"结项",entityType:"项目",entityId:String(body.id),summary:`项目结项：${project.name??body.id}，收入${finalRevenue}，成本${finalCost}，税费${taxAmount}`,beforePayload:current.payload,afterPayload:JSON.stringify(payload)})
      ]);
      return Response.json({closed:true,id:body.id,closedAt:now,finance:{revenue:finalRevenue,cost:finalCost,taxRateBasisPoints,taxAmount,profit:finalProfit}});
    }
    if(body.action==="restore"&&body.id){
      const db=await getDb(),[current]=await db.select().from(projects).where(eq(projects.id,body.id)).limit(1);
      if(!current)return Response.json({error:"项目不存在"},{status:404});
      if(!canAccessProject(auth.user,JSON.parse(current.payload)))return Response.json({error:"无权操作该项目"},{status:403});
      if(current.closedAt)return Response.json({error:"已结项项目不可直接恢复，如需重开请联系系统管理员"},{status:400});
      await db.batch([
        db.update(projects).set({archivedAt:null,updatedAt:sql`CURRENT_TIMESTAMP`}).where(eq(projects.id,body.id)),
        db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"恢复",entityType:"项目",entityId:String(body.id),summary:`恢复项目：${JSON.parse(current.payload).name??body.id}`})
      ]);
      return Response.json({restored:true,id:body.id});
    }
    if (!body.project?.id || !body.expectedVersion) return Response.json({ error: "project and expectedVersion are required" }, { status: 400 });
    const validation=validateProject(body.project);if(validation)return Response.json({error:validation},{status:400});
    const db = await getDb();
    const [current] = await db.select().from(projects).where(eq(projects.id, body.project.id)).limit(1);
    if (!current) return Response.json({ error: "项目不存在" }, { status: 404 });
    const currentPayload=JSON.parse(current.payload) as ProjectInput;
    const tagError=await validateProjectTags(db,body.project,Array.isArray(currentPayload.tags)?currentPayload.tags as string[]:[]);if(tagError)return Response.json({error:tagError},{status:400});
    if(!canAccessProject(auth.user,currentPayload))return Response.json({error:"无权操作该项目"},{status:403});
    if(current.closedAt)return Response.json({error:"已结项项目不可修改"},{status:400});
    if (current.version !== body.expectedVersion) {
      return Response.json({ error: "项目已被其他人更新，请刷新后再修改", current: { ...JSON.parse(current.payload), _version: current.version } }, { status: 409 });
    }
    const normalized=await normalizeProjectManagers(db,body.project);
    if("error" in normalized)return Response.json({error:normalized.error},{status:400});
    const project=normalized.project;
    const payload = JSON.stringify(clean(project));
    const nextVersion = current.version + 1;
    const updated = await db.update(projects).set({ payload, version: nextVersion, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(projects.id, body.project.id), eq(projects.version, body.expectedVersion))).returning();
    if (!updated.length) return Response.json({ error: "项目已被其他人更新，请刷新后再修改" }, { status: 409 });
    await db.insert(projectVersions).values({ projectId: body.project.id, version: nextVersion, payload, changedBy: auth.user.username });
    if(body.audit)await db.insert(auditLogs).values({ userId: auth.user.id, username: auth.user.username, action: "修改", entityType: "项目", entityId: String(body.project.id), summary: `手动修改项目：${project.name ?? body.project.id}`, beforePayload: current.payload, afterPayload: payload });
    return Response.json({ project: { ...clean(project), _version: nextVersion } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存项目失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser(request); if (auth.response || !auth.user) return auth.response;
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });
    const db = await getDb();
    const [current] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!current) return Response.json({ error: "项目不存在" }, { status: 404 });
    if(!canAccessProject(auth.user!,JSON.parse(current.payload)))return Response.json({error:"无权操作该项目"},{status:403});
    const archivedAt=new Date().toISOString();
    await db.batch([
      db.update(projects).set({archivedAt,updatedAt:sql`CURRENT_TIMESTAMP`}).where(eq(projects.id,id)),
      db.insert(auditLogs).values({ userId: auth.user.id, username: auth.user.username, action: "归档", entityType: "项目", entityId: String(id), summary: `归档项目：${JSON.parse(current.payload).name ?? id}`, beforePayload: current.payload }),
    ]);
    return Response.json({ archived: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除项目失败" }, { status: 500 });
  }
}
