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
      {isInterview?<><label>访谈日期<input name="interviewDate" type="date" required/></label><label>访谈开始时间<input name="interviewStartTime" type="time" required/></label><label>访谈时长（分钟）<input name="duration" type="number" min="1" max="1440" required/></label></>:<><label>服务开始日期<input name="startDate" type="date" required defaultValue={meta.startDate}/></label><label>服务结束日期<input name="endDate" type="date"/></label></>}<label>实际服务数量（{meta.unit}）<input name="quantity" type="number" min="1" defaultValue={meta.quantity} required/></label>
      {isInterview?<>
        <div className="full form-section-heading">受访者基本信息</div>
        <label>受访者姓名<input name="intervieweeName" required/></label><label>性别<select name="gender"><option value="">请选择</option><option>男</option><option>女</option><option>其他</option></select></label><label>年龄<input name="age" type="number" min="1" max="120"/></label><label>学历<input name="education"/></label><label>司龄<input name="companyTenure"/></label><label>部门<input name="department"/></label><label>岗位<input name="position"/></label><label>婚姻状况<input name="maritalStatus"/></label><label>子女数<input name="childrenCount" type="number" min="0"/></label><label>手机号<input name="phone" type="tel"/></label><label className="full example-field">访谈原因<small>建议 50 字左右。例如：因心理测评结果为橙码，进一步了解近期情绪与压力来源。</small><textarea name="interviewReason" required placeholder="请填写触发本次访谈的原因"/></label>
        <label>心理测评风险等级<select name="testRiskLevel" required><option value="">请选择</option><option>红码</option><option>橙码</option><option>黄码</option><option>绿码</option></select></label><label>心理健康风险等级<select name="riskLevel" required><option value="">请选择</option><option>高风险</option><option>中风险</option><option>低风险</option><option>无明显风险</option></select></label><label>风险等级与测评是否一致<select name="riskConsistent"><option value="">请选择</option><option>一致</option><option>不一致</option><option>无法判断</option></select></label>
        <label className="full example-field">后续心理服务方案建议<small>建议 50 字左右。示例：建议安排 1—2 次心理咨询，并持续关注睡眠与情绪变化。</small><textarea name="serviceSuggestions" placeholder="可填写心理咨询、心理热线、转介就医等建议"/></label>
        <div className="full form-section-heading">访谈要点记录</div>
        {[['作答真实性','answerAuthenticity','例如：受访者独立完成测评，作答过程认真，结果可信。'],['情绪状况','emotionStatus','例如：近期情绪总体稳定，偶有焦虑和疲惫感。'],['家庭与生活状况','familyLifeStatus','例如：家庭关系和谐，暂无明显经济压力。'],['工作压力状况','workStressStatus','例如：近期工作量增加，主要压力来自项目节点。'],['压力应对方式','copingStyle','例如：通常通过运动、与朋友交流来缓解压力。'],['人际支持状况','socialSupportStatus','例如：与同事关系正常，能够获得家人和朋友支持。'],['身体健康状况','physicalHealthStatus','例如：近期睡眠时间偏短，无重大身体不适。'],['对公司是否有其他需求','companyNeeds','例如：希望获得睡眠改善和压力管理方面的支持。']].map(([label,name,example])=><label className="full example-field" key={name}>{label}<small>建议 50 字左右。{example}</small><textarea name={name} placeholder={example}/></label>)}
        <div className="full form-section-heading">访谈过程评估</div><label>思维表达清晰程度<select name="expressionClarity"><option value="">请选择</option><option>清晰</option><option>基本清晰</option><option>混乱</option></select></label><label>认知能力<select name="cognition"><option value="">请选择</option><option>较高</option><option>正常</option><option>偏低</option></select></label><label className="full example-field">访谈过程补充说明<small>建议 50 字左右。示例：受访者配合度较好，能够围绕问题进行较完整的表达。</small><textarea name="processNotes" placeholder="请补充访谈过程中的观察"/></label>
        <div className="full form-section-heading">评估综述</div><label className="full example-field">基本介绍<small>建议 50 字左右。示例：来访者岗位为 XX，访谈中整体心理状态尚可。</small><textarea name="basicIntroduction" placeholder="请概括受访者基本情况"/></label><label className="full example-field">重点分析<small>建议 100 字左右。示例：主要压力来自工作负荷与睡眠节律变化，当前支持系统较稳定。</small><textarea name="keyAnalysis" placeholder="请填写需要重点关注的因素"/></label><label className="full example-field">访谈评估综述<small>建议 200 字左右。示例：综合访谈表现，受访者当前风险为中等，建议持续关注情绪和睡眠变化。</small><textarea name="assessmentSummary" required placeholder="请填写综合评估结论"/></label><label className="full example-field">评估建议<small>建议 50 字左右。示例：建议开展压力应对和睡眠管理辅导，必要时转介专业机构。</small><textarea name="assessmentAdvice" placeholder="请填写后续建议"/></label><label>咨询师姓名<input name="consultantName" required/></label>
      </>:isConsultation?<><label>咨询方式<select name="method" defaultValue=""><option value="">请选择</option><option>线上咨询</option><option>线下咨询</option><option>驻场咨询</option></select></label><label>咨询时长（分钟）<input name="duration" type="number" min="1"/></label><label className="full">咨询概括<textarea name="summary"/></label><label className="full">风险情况<select name="risk" defaultValue=""><option value="">请选择</option><option>无风险</option><option>需要跟进</option><option>重点关注</option></select></label></>:
      <><label>活动主题<input name="topic"/></label><label>参与人数<input name="participants" type="number" min="1"/></label><label className="full">活动地点<input name="location"/></label><label className="full">活动内容及效果<textarea name="summary"/></label></>}
      <label className="full">现场图片、课件及签到表<input name="files" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx"/></label></div>
      {error&&<p className="form-error">{error}</p>}<button className="primary external-submit" disabled={submitting}>{submitting?"正在提交，请勿重复操作…":"确认提交"}</button></form></section></main>;
}
