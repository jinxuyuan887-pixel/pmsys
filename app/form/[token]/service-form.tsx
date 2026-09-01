"use client";

import { useEffect, useState } from "react";
import { appPath } from "../../base-path";

export default function ExternalServiceForm({token}:{token:string}) {
  const [meta,setMeta]=useState<{projectName:string;serviceName:string;unit:string;formType:string;startDate:string;quantity:number}|null>(null);
  const [error,setError]=useState("");
  const [done,setDone]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  useEffect(()=>{fetch(appPath(`/api/form-links?token=${encodeURIComponent(token)}`)).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);setMeta(data)}).catch(error=>setError(error.message))},[token]);
  async function submit(formData:FormData){
    if(submitting)return;
    setSubmitting(true);setError("");
    const files=formData.getAll("files").filter((file):file is File=>file instanceof File&&file.size>0);
    const uploaded:string[]=[];
    for(const file of files){
      const upload=new FormData(); upload.append("file",file);upload.append("token",token);
      const response=await fetch(appPath("/api/upload"),{method:"POST",body:upload});
      if(response.ok){const data=await response.json();uploaded.push(data.key)}
      else{const data=await response.json().catch(()=>({}));setError(data.error??`附件“${file.name}”上传失败`);setSubmitting(false);return}
    }
    const data:Record<string,string>={};
    formData.forEach((value,key)=>{if(typeof value==="string")data[key]=value});
    const response=await fetch(appPath("/api/records"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,type:meta?.formType,uploaded,data})});
    if(response.ok)setDone(true);
    else{const result=await response.json().catch(()=>({}));setError(result.error??"提交失败，请检查填写内容后重试");setSubmitting(false)}
  }
  if(done)return <main className="external-page"><section className="success-card"><span>✓</span><h1>记录提交成功</h1><p>内容已进入EAP项目管理系统，等待项目经理验收。</p></section></main>;
  if(error&&!meta)return <main className="external-page"><section className="success-card"><h1>链接无法使用</h1><p>{error}</p></section></main>;
  if(!meta)return <main className="external-page"><section className="success-card"><p>正在读取服务信息…</p></section></main>;
  const isConsultation=meta.formType==="心理咨询台账";
  const isInterview=meta.formType==="心理访谈记录";
  return <main className="external-page"><section className="external-card"><div className="external-brand">♥ <strong>EAP 服务记录</strong></div><h1>提交服务执行记录</h1><p className="external-tip">已绑定：{meta.projectName} · {meta.serviceName}。无需选择项目，提交后自动归集。</p>
    <form action={submit}><div className="form-grid"><label>服务内容<input value={meta.serviceName} disabled/></label><label>记录类型<input value={meta.formType} disabled/></label><label>服务人员<input name="provider" placeholder="可由项目经理验收时补充"/></label>
      <label>服务开始日期<input name="startDate" type="date" required defaultValue={meta.startDate}/></label><label>服务结束日期<input name="endDate" type="date"/></label><label>实际服务数量（{meta.unit}）<input name="quantity" type="number" min="1" defaultValue={meta.quantity} required/></label>
      {isInterview?<>
        <div className="full form-section-heading">受访者基本信息</div>
        <label>受访者姓名<input name="intervieweeName" required/></label><label>性别<select name="gender"><option value="">请选择</option><option>男</option><option>女</option><option>其他</option></select></label><label>年龄<input name="age" type="number" min="1" max="120"/></label><label>学历<input name="education"/></label><label>司龄<input name="companyTenure"/></label><label>部门<input name="department"/></label><label>岗位<input name="position"/></label><label>婚姻状况<input name="maritalStatus"/></label><label>子女数<input name="childrenCount" type="number" min="0"/></label><label>手机号<input name="phone" type="tel"/></label><label className="full">访谈原因<textarea name="interviewReason" required/></label>
        <label>心理测评风险等级<select name="testRiskLevel" required><option value="">请选择</option><option>红码</option><option>橙码</option><option>黄码</option><option>绿码</option></select></label><label>心理健康风险等级<select name="riskLevel" required><option value="">请选择</option><option>高风险</option><option>中风险</option><option>低风险</option><option>无明显风险</option></select></label><label>风险等级与测评是否一致<select name="riskConsistent"><option value="">请选择</option><option>一致</option><option>不一致</option><option>无法判断</option></select></label>
        <label className="full">后续心理服务方案建议<textarea name="serviceSuggestions" placeholder="可填写心理咨询、心理热线、转介就医等建议"/></label>
        <div className="full form-section-heading">访谈要点记录</div>
        {[["真实性","answerAuthenticity"],["情绪状况","emotionStatus"],["家庭与生活状况","familyLifeStatus"],["工作压力状况","workStressStatus"],["压力应对方式","copingStyle"],["人际支持状况","socialSupportStatus"],["身体健康状况","physicalHealthStatus"],["对公司是否有其他需求","companyNeeds"]].map(([label,name])=><label className="full" key={name}>{label}<textarea name={name}/></label>)}
        <div className="full form-section-heading">访谈过程评估</div><label>思维表达清晰程度<select name="expressionClarity"><option value="">请选择</option><option>清晰</option><option>基本清晰</option><option>混乱</option></select></label><label>认知能力<select name="cognition"><option value="">请选择</option><option>较高</option><option>正常</option><option>偏低</option></select></label><label className="full">访谈过程补充说明<textarea name="processNotes"/></label>
        <div className="full form-section-heading">评估综述</div><label className="full">基本介绍<textarea name="basicIntroduction"/></label><label className="full">重点分析<textarea name="keyAnalysis"/></label><label className="full">访谈评估综述<textarea name="assessmentSummary" required/></label><label className="full">评估建议<textarea name="assessmentAdvice"/></label><label>访谈日期<input name="interviewDate" type="date" required/></label><label>咨询师姓名<input name="consultantName" required/></label>
      </>:isConsultation?<><label>咨询方式<select name="method" defaultValue=""><option value="">请选择</option><option>线上咨询</option><option>线下咨询</option><option>驻场咨询</option></select></label><label>咨询时长（分钟）<input name="duration" type="number" min="1"/></label><label className="full">咨询概括<textarea name="summary"/></label><label className="full">风险情况<select name="risk" defaultValue=""><option value="">请选择</option><option>无风险</option><option>需要跟进</option><option>重点关注</option></select></label></>:
      <><label>活动主题<input name="topic"/></label><label>参与人数<input name="participants" type="number" min="1"/></label><label className="full">活动地点<input name="location"/></label><label className="full">活动内容及效果<textarea name="summary"/></label></>}
      <label className="full">现场图片、课件及签到表<input name="files" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx"/></label></div>
      {error&&<p className="form-error">{error}</p>}<button className="primary external-submit" disabled={submitting}>{submitting?"正在提交，请勿重复操作…":"确认提交"}</button></form></section></main>;
}
