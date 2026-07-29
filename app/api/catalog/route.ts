import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditLogs, serviceCatalog } from "../../../db/schema";
import { requireApiUser } from "../../auth";

export async function GET(request:Request){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  try{
    const db=await getDb();
    return Response.json({items:await db.select().from(serviceCatalog).orderBy(asc(serviceCatalog.id))});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"读取失败"},{status:500})}
}

export async function PUT(request:Request){
  const auth=await requireApiUser(request);if(auth.response)return auth.response;
  try{
    const body=await request.json() as {items?:Array<{id:number;name:string;defaultUnit:string;category:string;enabled:boolean}>};
    if(!Array.isArray(body.items))return Response.json({error:"items is required"},{status:400});
    if(body.items.length>200)return Response.json({error:"服务目录不能超过200项"},{status:400});
    const names=new Set<string>();
    for(const item of body.items){
      const name=String(item.name??"").trim();
      if(!Number.isSafeInteger(Number(item.id))||!name||name.length>50||names.has(name))return Response.json({error:"服务目录存在空名称、重复名称或无效编号"},{status:400});
      names.add(name);
    }
    const db=await getDb();
    const before=await db.select().from(serviceCatalog).orderBy(asc(serviceCatalog.id));
    await db.batch([
      db.delete(serviceCatalog),
      ...(body.items.length?[db.insert(serviceCatalog).values(body.items.map(item=>({...item,name:item.name.trim()})))]:[]),
      db.insert(auditLogs).values({userId:auth.user.id,username:auth.user.username,action:"修改",entityType:"服务目录",entityId:"catalog",summary:"修改服务目录",beforePayload:JSON.stringify(before),afterPayload:JSON.stringify(body.items)})
    ]);
    return Response.json({ok:true});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"保存失败"},{status:500})}
}
