import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { fileAttachments, projects, serviceRecords } from "../../../db/schema";
import { requireApiUser } from "../../auth";
import type { CurrentUser } from "../../auth";
import { getFile } from "../../file-storage";
import { canAccessProject } from "../../project-access";

async function accessibleProjectIds(db:Awaited<ReturnType<typeof getDb>>,user:CurrentUser){
  const rows=await db.select({id:projects.id,payload:projects.payload}).from(projects);
  return new Set(rows.filter(row=>canAccessProject(user,JSON.parse(row.payload))).map(row=>row.id));
}

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  const url=new URL(request.url),id=Number(url.searchParams.get("id")),recordId=Number(url.searchParams.get("recordId")),projectId=Number(url.searchParams.get("projectId")),library=url.searchParams.get("library")==="1";
  const db=await getDb();
  const allowed=await accessibleProjectIds(db,auth.user);
  if(library){
    const files=await db.select({id:fileAttachments.id,projectId:fileAttachments.projectId,name:fileAttachments.originalName,size:fileAttachments.size,contentType:fileAttachments.contentType,category:fileAttachments.category,createdAt:fileAttachments.createdAt})
      .from(fileAttachments).where(isNull(fileAttachments.deletedAt));
    return Response.json({files:files.filter(file=>file.projectId&&allowed.has(file.projectId))});
  }
  if(recordId){
    const [record]=await db.select({projectId:serviceRecords.projectId}).from(serviceRecords).where(eq(serviceRecords.id,recordId)).limit(1);
    if(!record||!allowed.has(record.projectId))return Response.json({error:"无权查看该附件"},{status:403});
    const files=await db.select({id:fileAttachments.id,name:fileAttachments.originalName,size:fileAttachments.size,contentType:fileAttachments.contentType,createdAt:fileAttachments.createdAt})
      .from(fileAttachments).where(and(eq(fileAttachments.recordId,recordId),isNull(fileAttachments.deletedAt)));
    return Response.json({files});
  }
  if(projectId){
    if(!allowed.has(projectId))return Response.json({error:"无权查看该项目资料"},{status:403});
    const files=await db.select({id:fileAttachments.id,name:fileAttachments.originalName,size:fileAttachments.size,contentType:fileAttachments.contentType,category:fileAttachments.category,createdAt:fileAttachments.createdAt})
      .from(fileAttachments).where(and(eq(fileAttachments.projectId,projectId),isNull(fileAttachments.deletedAt)));
    return Response.json({files});
  }
  if(!id)return Response.json({error:"id, recordId or projectId is required"},{status:400});
  const [file]=await db.select().from(fileAttachments).where(and(eq(fileAttachments.id,id),isNull(fileAttachments.deletedAt))).limit(1);
  if(!file||(!file.recordId&&!file.projectId))return Response.json({error:"附件不存在"},{status:404});
  let targetProjectId=file.projectId;
  if(!targetProjectId&&file.recordId){const [record]=await db.select({projectId:serviceRecords.projectId}).from(serviceRecords).where(eq(serviceRecords.id,file.recordId)).limit(1);targetProjectId=record?.projectId??null}
  if(!targetProjectId||!allowed.has(targetProjectId))return Response.json({error:"无权下载该附件"},{status:403});
  const body=await getFile(file.storageKey);
  if(!body)return Response.json({error:"文件不存在"},{status:404});
  const inline=url.searchParams.get("inline")==="1"&&file.contentType.startsWith("image/");
  return new Response(body,{headers:{
    "content-type":file.contentType,
    "content-disposition":`${inline?"inline":"attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    "x-content-type-options":"nosniff",
    "cache-control":"private, no-store"
  }});
}
