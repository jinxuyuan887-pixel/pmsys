import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { projects, serviceRecords } from "../../../../../db/schema";
import { requireApiUser } from "../../../../auth";
import { canAccessProject } from "../../../../project-access";

const labels:Record<string,string>={intervieweeName:"受访者姓名",gender:"性别",age:"年龄",education:"学历",companyTenure:"司龄",department:"部门",position:"岗位",maritalStatus:"婚姻状况",childrenCount:"子女数",phone:"手机号",interviewReason:"访谈原因",testRiskLevel:"心理测评风险等级",riskLevel:"心理健康风险等级",riskConsistent:"风险等级与测评是否一致",serviceSuggestions:"后续心理服务方案建议",answerAuthenticity:"作答真实性",emotionStatus:"情绪状况",familyLifeStatus:"家庭与生活状况",workStressStatus:"工作压力状况",copingStyle:"压力应对方式",socialSupportStatus:"人际支持状况",physicalHealthStatus:"身体健康状况",companyNeeds:"对公司是否有其他需求",expressionClarity:"思维表达清晰程度",cognition:"认知能力",processNotes:"访谈过程补充说明",basicIntroduction:"基本介绍",keyAnalysis:"重点分析",assessmentSummary:"访谈评估综述",assessmentAdvice:"评估建议",interviewDate:"访谈日期",consultantName:"咨询师姓名"};
const escape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await requireApiUser(request);if(auth.response||!auth.user)return auth.response;
  const id=Number((await params).id);if(!id)return new Response("Not found",{status:404});
  const db=await getDb(),[record]=await db.select().from(serviceRecords).where(and(eq(serviceRecords.id,id),isNull(serviceRecords.deletedAt))).limit(1);
  if(!record||record.recordType!=="心理访谈记录")return new Response("访谈记录不存在",{status:404});
  const [projectRow]=await db.select().from(projects).where(and(eq(projects.id,record.projectId),isNull(projects.archivedAt))).limit(1);
  if(!projectRow||!canAccessProject(auth.user,JSON.parse(projectRow.payload)))return new Response("无权查看",{status:403});
  const project=JSON.parse(projectRow.payload) as {name?:string};const data=(JSON.parse(record.payload) as {data?:Record<string,unknown>}).data??{};
  const rows=Object.entries(labels).filter(([key])=>data[key]!==undefined&&data[key]!=="").map(([key,label])=>`<div class="item"><b>${label}</b><span>${escape(data[key]).replace(/\n/g,"<br>")}</span></div>`).join("");
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>心理访谈报告-${escape(data.intervieweeName||record.id)}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#18212f;max-width:900px;margin:0 auto;padding:36px;line-height:1.7}h1{text-align:center;margin-bottom:6px}h2{font-size:18px;border-left:4px solid #2563eb;padding-left:10px;margin-top:28px}.meta{text-align:center;color:#64748b;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 28px}.item{padding:8px 0;border-bottom:1px solid #e5e7eb;white-space:pre-wrap}.item b{display:block;color:#475569;font-size:13px}.item span{display:block}@media print{body{padding:0}button{display:none}}button{display:block;margin:28px auto;padding:10px 22px;background:#2563eb;color:#fff;border:0;border-radius:6px}@media(max-width:600px){body{padding:18px}.grid{grid-template-columns:1fr}}</style></head><body><h1>心理测评风险人员测后访谈报告</h1><div class="meta">项目：${escape(project.name)} · 记录编号：${record.id} · 状态：${escape(record.status)}</div><h2>访谈记录</h2><div class="grid">${rows}</div><button onclick="window.print()">打印 / 导出 PDF</button></body></html>`;
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","content-disposition":`inline; filename="interview-${record.id}.html"`}});
}
