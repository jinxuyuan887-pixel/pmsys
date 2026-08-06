import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { fileAttachments } from "../../../db/schema";
import { requireApiUser } from "../../auth";
import { getFile } from "../../file-storage";

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  const url=new URL(request.url),id=Number(url.searchParams.get("id")),recordId=Number(url.searchParams.get("recordId")),projectId=Number(url.searchParams.get("projectId"));
  const db=await getDb();
  if(recordId){
    const files=await db.select({id:fileAttachments.id,name:fileAttachments.originalName,size:fileAttachments.size,contentType:fileAttachments.contentType,createdAt:fileAttachments.createdAt})
      .from(fileAttachments).where(and(eq(fileAttachments.recordId,recordId),isNull(fileAttachments.deletedAt)));
    return Response.json({files});
  }
  if(projectId){
    const files=await db.select({id:fileAttachments.id,name:fileAttachments.originalName,size:fileAttachments.size,contentType:fileAttachments.contentType,category:fileAttachments.category,createdAt:fileAttachments.createdAt})
      .from(fileAttachments).where(and(eq(fileAttachments.projectId,projectId),isNull(fileAttachments.deletedAt)));
    return Response.json({files});
  }
  if(!id)return Response.json({error:"id, recordId or projectId is required"},{status:400});
  const [file]=await db.select().from(fileAttachments).where(and(eq(fileAttachments.id,id),isNull(fileAttachments.deletedAt))).limit(1);
  if(!file||(!file.recordId&&!file.projectId))return Response.json({error:"附件不存在"},{status:404});
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
