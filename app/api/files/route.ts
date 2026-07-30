import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { fileAttachments } from "../../../db/schema";
import { requireApiUser } from "../../auth";

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  const url=new URL(request.url),id=Number(url.searchParams.get("id")),recordId=Number(url.searchParams.get("recordId"));
  const db=await getDb();
  if(recordId){
    const files=await db.select({id:fileAttachments.id,name:fileAttachments.originalName,size:fileAttachments.size,contentType:fileAttachments.contentType,createdAt:fileAttachments.createdAt})
      .from(fileAttachments).where(and(eq(fileAttachments.recordId,recordId),isNull(fileAttachments.deletedAt)));
    return Response.json({files});
  }
  if(!id)return Response.json({error:"id or recordId is required"},{status:400});
  const [file]=await db.select().from(fileAttachments).where(and(eq(fileAttachments.id,id),isNull(fileAttachments.deletedAt))).limit(1);
  if(!file||!file.recordId)return Response.json({error:"附件不存在"},{status:404});
  const {env}=await import("cloudflare:workers"),object=await env.BUCKET.get(file.storageKey);
  if(!object)return Response.json({error:"文件不存在"},{status:404});
  const inline=url.searchParams.get("inline")==="1"&&file.contentType.startsWith("image/");
  return new Response(object.body,{headers:{
    "content-type":file.contentType,
    "content-disposition":`${inline?"inline":"attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    "x-content-type-options":"nosniff",
    "cache-control":"private, no-store"
  }});
}
