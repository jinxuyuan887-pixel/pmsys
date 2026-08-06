import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { fileAttachments, formLinks, projects } from "../../../db/schema";
import { requireApiUser } from "../../auth";
import { deleteFile, putFile } from "../../file-storage";

const allowed=new Set([
  "image/jpeg","image/png","application/pdf",
  "application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const ext=/\.(jpe?g|png|pdf|pptx?|docx?|xlsx?)$/i;
const projectCategories=new Set(["成果报告","发票","客户评价"]);

export async function POST(request:Request){
  try{
    const data=await request.formData(),token=String(data.get("token")??""),projectId=Number(data.get("projectId"))||null,category=String(data.get("category")??"").trim()||null;
    let uploadedBy="";
    if(token){
      const db=await getDb(),[link]=await db.select().from(formLinks).where(eq(formLinks.token,token)).limit(1);
      if(!link||link.status!=="有效"||link.expiresAt&&new Date(link.expiresAt)<new Date()||link.submissionCount>=link.maxSubmissions)return Response.json({error:"链接不存在、已过期或已达到提交次数"},{status:401});
      uploadedBy="外部填写人";
    }else{
      const auth=await requireApiUser(request);if(auth.response)return auth.response;
      uploadedBy=auth.user!.username;
      if(projectId){
        if(!category||!projectCategories.has(category))return Response.json({error:"请选择正确的项目附件分类"},{status:400});
        const db=await getDb(),[project]=await db.select({id:projects.id,archivedAt:projects.archivedAt}).from(projects).where(eq(projects.id,projectId)).limit(1);
        if(!project||project.archivedAt)return Response.json({error:"项目不存在或已归档"},{status:400});
      }
    }
    const file=data.get("file");
    if(!(file instanceof File))return Response.json({error:"请选择文件"},{status:400});
    if(file.size<=0||file.size>20*1024*1024)return Response.json({error:"文件大小必须在20MB以内"},{status:400});
    if(!allowed.has(file.type)||!ext.test(file.name))return Response.json({error:"仅支持图片、PDF、Office文档"},{status:400});
    const safeName=file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g,"_");
    const key=`${projectId?"project-files":"service-files"}/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}-${safeName}`;
    await putFile(key,await file.arrayBuffer());
    const db=await getDb();
    const [saved]=await db.insert(fileAttachments).values({storageKey:key,originalName:file.name,contentType:file.type,size:file.size,uploadedBy,formToken:token||null,projectId,category}).returning();
    return Response.json({id:saved.id,key,name:file.name,size:file.size});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"上传失败"},{status:500})}
}

export async function DELETE(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  const id=Number(new URL(request.url).searchParams.get("id"));if(!id)return Response.json({error:"id is required"},{status:400});
  const db=await getDb(),[file]=await db.select().from(fileAttachments).where(and(eq(fileAttachments.id,id),isNull(fileAttachments.deletedAt))).limit(1);
  if(!file)return Response.json({error:"附件不存在"},{status:404});
  await deleteFile(file.storageKey);
  await db.update(fileAttachments).set({deletedAt:new Date().toISOString()}).where(eq(fileAttachments.id,id));
  return Response.json({deleted:true});
}
