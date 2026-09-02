import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { projects, serviceRecords } from "../../../../../db/schema";
import { requireApiUser } from "../../../../auth";
import { canAccessProject } from "../../../../project-access";
import PDFDocument, { registerStdFonts } from "pdfkit-browser";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import fontDataUrl from "../../../../../public/fonts/NotoSansSC-Regular.ttf?inline";

const labels:Record<string,string>={intervieweeName:"受访者姓名",gender:"性别",age:"年龄",education:"学历",companyTenure:"司龄",department:"部门",position:"岗位",maritalStatus:"婚姻状况",childrenCount:"子女数",phone:"手机号",interviewReason:"访谈原因",testRiskLevel:"心理测评风险等级",riskLevel:"心理健康风险等级",riskConsistent:"风险等级与测评是否一致",serviceSuggestions:"后续心理服务方案建议",answerAuthenticity:"作答真实性",emotionStatus:"情绪状况",familyLifeStatus:"家庭与生活状况",workStressStatus:"工作压力状况",copingStyle:"压力应对方式",socialSupportStatus:"人际支持状况",physicalHealthStatus:"身体健康状况",companyNeeds:"对公司是否有其他需求",expressionClarity:"思维表达清晰程度",cognition:"认知能力",processNotes:"访谈过程补充说明",basicIntroduction:"基本介绍",keyAnalysis:"重点分析",assessmentSummary:"访谈评估综述",assessmentAdvice:"评估建议",interviewDate:"访谈日期",interviewStartTime:"访谈开始时间",duration:"访谈时长（分钟）",consultantName:"咨询师姓名"};
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
  if(new URL(request.url).searchParams.get("format")==="html"){
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>心理访谈报告-${escape(data.intervieweeName||record.id)}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#18212f;max-width:900px;margin:0 auto;padding:36px;line-height:1.7}h1{text-align:center;margin-bottom:6px}h2{font-size:18px;border-left:4px solid #2563eb;padding-left:10px;margin-top:28px}.meta{text-align:center;color:#64748b;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 28px}.item{padding:8px 0;border-bottom:1px solid #e5e7eb;white-space:pre-wrap}.item b{display:block;color:#475569;font-size:13px}.item span{display:block}@media print{body{padding:0}button{display:none}}button{display:block;margin:28px auto;padding:10px 22px;background:#2563eb;color:#fff;border:0;border-radius:6px}@media(max-width:600px){body{padding:18px}.grid{grid-template-columns:1fr}}</style></head><body><h1>心理测评风险人员测后访谈报告</h1><div class="meta">项目：${escape(project.name)} · 记录编号：${record.id} · 状态：${escape(record.status)}</div><h2>访谈记录</h2><div class="grid">${rows}</div><button onclick="window.print()">打印 / 导出 PDF</button></body></html>`;
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","content-disposition":`inline; filename="interview-${record.id}.html"`}});
  }
  registerStdFonts(Helvetica);
  const fontData=fontDataUrl.startsWith("data:")?Buffer.from(fontDataUrl.split(",",2)[1],"base64"):new Uint8Array();
  const chunks:Buffer[]=[];
  const pdf= new PDFDocument({size:"A4",margin:42,info:{Title:`心理测评风险人员测后访谈报告-${record.id}`,Author:"壹点灵 EAP"}});
  pdf.on("data",(chunk:Buffer)=>chunks.push(chunk));
  const finished=new Promise<void>((resolve,reject)=>{pdf.on("end",()=>resolve());pdf.on("error",reject)});
  pdf.registerFont("cn",fontData);pdf.font("cn");
  const blue="#1f6f8b",muted="#64748b";
  pdf.fillColor(blue).fontSize(19).text("♥  壹点灵 EAP",{continued:false});
  pdf.moveDown(0.7).fillColor("#17202b").fontSize(22).text("心理测评风险人员测后访谈报告",{align:"center"});
  pdf.moveDown(0.25).fillColor(muted).fontSize(9).text(`项目：${project.name??""}  ·  记录编号：${record.id}  ·  状态：${record.status}`,{align:"center"});
  pdf.moveDown(0.7).strokeColor(blue).lineWidth(2).moveTo(42,pdf.y).lineTo(553,pdf.y).stroke();
  pdf.moveDown(0.8).fillColor(blue).fontSize(13).text("访谈记录");pdf.moveDown(0.35);
  const entries=Object.entries(labels).filter(([key])=>data[key]!==undefined&&data[key]!=="");
  const width=511;
  for(const [key,label] of entries){
    const value=String(data[key]);
    pdf.fillColor(muted).fontSize(8).text(label,{width});
    pdf.moveDown(0.12).fillColor("#17202b").fontSize(10).text(value,{width,lineGap:2});
    pdf.moveDown(0.18).strokeColor("#dbe3e8").lineWidth(0.5).moveTo(42,pdf.y).lineTo(553,pdf.y).stroke();
    pdf.moveDown(0.35);
  }
  pdf.moveDown(0.5).fillColor(blue).fontSize(9).text("本报告由壹点灵 EAP 项目管理系统生成",{align:"center"});
  pdf.moveDown(0.6).fillColor("#b4232d").circle(490,pdf.y+20,28).lineWidth(1.5).stroke();
  pdf.fontSize(8).text("示例电子签章",445,pdf.y+16,{width:90,align:"center"});
  pdf.end();
  await finished;
  return new Response(Buffer.concat(chunks),{headers:{"content-type":"application/pdf","content-disposition":`attachment; filename="interview-${record.id}.pdf"`}});
}
