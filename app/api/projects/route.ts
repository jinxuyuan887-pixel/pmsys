import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, projects, projectVersions, serviceRecords, users } from "../../../db/schema";
import { requireApiUser } from "../../auth";

type ProjectInput = { id: number; name?: string; manager?:string; managerIds?:number[]; _version?: number; [key: string]: unknown };
const clean = (project: ProjectInput) => {
  const payload = { ...project };
  delete payload._version;
  return payload;
};

type ServiceInput={id:number;name:string;contractDetail?:string;unit:string;quantity:number;unitPrice:number;costPrice?:number;completed?:number};
function validateProject(project:ProjectInput){
  if(!String(project.name??"").trim())return "请填写项目名称";
  const services=Array.isArray(project.services)?project.services as ServiceInput[]:[];
  for(const service of services){
    if(!Number.isSafeInteger(Number(service.id))||!String(service.name??"").trim())return "服务内容信息不完整";
    if(!Number.isFinite(Number(service.quantity))||Number(service.quantity)<=0||Number(service.quantity)>100000)return "服务数量必须大于0且不超过100000";
    if(!Number.isFinite(Number(service.unitPrice))||Number(service.unitPrice)<0||Number(service.unitPrice)>100000000)return "服务单价不符合要求";
    if(!Number.isFinite(Number(service.costPrice??0))||Number(service.costPrice??0)<0)return "成本单价不能为负数";
    if(String(service.contractDetail??"").length>500)return "合同详情说明不能超过500字";
  }
  const start=String(project.start??""),end=String(project.end??"");
  if(start&&end&&start>end)return "项目结束日期不能早于开始日期";
  return null;
}

async function normalizeProjectManagers(db:Awaited<ReturnType<typeof getDb>>,project:ProjectInput){
  const submittedIds=Array.isArray(project.managerIds)
    ? Array.from(new Set(project.managerIds.map(Number).filter(Number.isSafeInteger)))
    : [];
  const legacyNames=submittedIds.length===0
    ? String(project.manager??"").split(/[、,，]/).map(name=>name.trim()).filter(Boolean)
    : [];
  const conditions=[eq(users.role,"项目经理"),eq(users.active,true)];
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
    const rows = includeArchived
      ? await db.select().from(projects).orderBy(asc(projects.id))
      : await db.select().from(projects).where(isNull(projects.archivedAt)).orderBy(asc(projects.id));
    const delivered=await db.select({
      projectId:serviceRecords.projectId,
      serviceId:serviceRecords.serviceId,
      quantity:sql<number>`sum(CAST(COALESCE(json_extract(${serviceRecords.payload}, '$.data.quantity'), 1) AS REAL))`
    }).from(serviceRecords).where(and(eq(serviceRecords.status,"已完成"),isNull(serviceRecords.deletedAt))).groupBy(serviceRecords.projectId,serviceRecords.serviceId);
    const totals=new Map(delivered.map(item=>[`${item.projectId}:${item.serviceId}`,Number(item.quantity)||0]));
    return Response.json({ projects: rows.map(row => {
      const project=JSON.parse(row.payload) as {services?:ServiceInput[]};
      return {...project,services:(project.services??[]).map(service=>({...service,completed:totals.get(`${row.id}:${service.id}`)??0})),_version:row.version,_archivedAt:row.archivedAt,_isDemo:row.isDemo};
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
    const normalized=await normalizeProjectManagers(db,body.project);
    if("error" in normalized)return Response.json({error:normalized.error},{status:400});
    const project=normalized.project;
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
    if(body.action==="restore"&&body.id){
      const db=await getDb(),[current]=await db.select().from(projects).where(eq(projects.id,body.id)).limit(1);
      if(!current)return Response.json({error:"项目不存在"},{status:404});
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
