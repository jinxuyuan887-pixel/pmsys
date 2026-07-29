import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs } from "../../../db/schema";
import { requireApiUser } from "../../auth";

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  try{
    const db=await getDb();
    const rows=await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt),desc(auditLogs.id)).limit(500);
    const logs=rows.filter(log=>{
      if(log.entityType==="周报快照")return false;
      if(log.entityType==="项目"&&log.action==="修改"&&!log.summary.startsWith("手动修改项目："))return false;
      if(log.beforePayload&&log.afterPayload&&log.beforePayload===log.afterPayload)return false;
      return log.username==="外部填写人"||log.entityType==="登录"||Boolean(log.userId);
    });
    return Response.json({logs});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"读取治理数据失败"},{status:500})}
}
