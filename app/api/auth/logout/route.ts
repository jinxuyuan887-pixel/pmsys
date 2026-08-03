import { getDb } from "../../../../db";
import { sessions } from "../../../../db/schema";
import { eq } from "drizzle-orm";
import { sessionToken, tokenHash } from "../../../auth";
import { BASE_PATH } from "../../../base-path";

export async function POST(request:Request){
  const token=sessionToken(request);
  if(token){const db=await getDb();await db.delete(sessions).where(eq(sessions.tokenHash,await tokenHash(token)))}
  const secure=new URL(request.url).protocol==="https:"?"; Secure":"";
  return Response.json({ok:true},{headers:{"set-cookie":`eap_session=; Path=${BASE_PATH || "/"}; HttpOnly${secure}; SameSite=Lax; Max-Age=0`}});
}
