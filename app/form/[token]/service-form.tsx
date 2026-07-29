"use client";

import { useEffect, useState } from "react";

export default function ExternalServiceForm({token}:{token:string}) {
  const [meta,setMeta]=useState<{projectName:string;serviceName:string;unit:string;formType:string}|null>(null);
  const [error,setError]=useState("");
  const [done,setDone]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  useEffect(()=>{fetch(`/api/form-links?token=${encodeURIComponent(token)}`).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);setMeta(data)}).catch(error=>setError(error.message))},[token]);
  async function submit(formData:FormData){
    if(submitting)return;
    setSubmitting(true);setError("");
    const files=formData.getAll("files").filter((file):file is File=>file instanceof File&&file.size>0);
    const uploaded:string[]=[];
    for(const file of files){
      const upload=new FormData(); upload.append("file",file);upload.append("token",token);
      const response=await fetch("/api/upload",{method:"POST",body:upload});
      if(response.ok){const data=await response.json();uploaded.push(data.key)}
      else{const data=await response.json().catch(()=>({}));setError(data.error??`附件“${file.name}”上传失败`);setSubmitting(false);return}
    }
    const data:Record<string,string>={};
    formData.forEach((value,key)=>{if(typeof value==="string")data[key]=value});
    const response=await fetch("/api/records",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,type:meta?.formType,uploaded,data})});
    if(response.ok)setDone(true);
    else{const result=await response.json().catch(()=>({}));setError(result.error??"提交失败，请检查填写内容后重试");setSubmitting(false)}
  }
  if(done)return <main className="external-page"><section className="success-card"><span>✓</span><h1>记录提交成功</h1><p>内容已进入EAP项目管理系统，等待项目经理审核。</p></section></main>;
  if(error&&!meta)return <main className="external-page"><section className="success-card"><h1>链接无法使用</h1><p>{error}</p></section></main>;
  if(!meta)return <main className="external-page"><section className="success-card"><p>正在读取服务信息…</p></section></main>;
  return <main className="external-page"><section className="external-card"><div className="external-brand">♥ <strong>EAP 服务记录</strong></div><h1>提交服务执行记录</h1><p className="external-tip">已绑定：{meta.projectName} · {meta.serviceName}。无需选择项目，提交后自动归集。</p>
    <form action={submit}><div className="form-grid"><label>服务内容<input value={meta.serviceName} disabled/></label><label>服务人员<input name="provider" required/></label>
      <label>服务日期<input name="date" type="date" required/></label><label>实际服务数量（{meta.unit}）<input name="quantity" type="number" min="1" defaultValue="1" required/></label>
      {meta.formType==="心理咨询台账"?<><label>咨询方式<select name="method"><option>线上咨询</option><option>线下咨询</option><option>驻场咨询</option></select></label><label>咨询时长（分钟）<input name="duration" type="number"/></label><label className="full">问题类型<input name="issueType" placeholder="职场、家庭、情绪等"/></label><label className="full">咨询概况<textarea name="summary" required/></label><label className="full">风险情况<select name="risk"><option>无风险</option><option>需要跟进</option><option>重点关注</option></select></label></>:
      <><label>活动主题<input name="topic" required/></label><label>参与人数<input name="participants" type="number"/></label><label className="full">活动地点<input name="location"/></label><label className="full">活动内容及效果<textarea name="summary" required/></label></>}
      <label className="full">现场图片、课件及签到表<input name="files" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx"/></label></div>
      {error&&<p className="form-error">{error}</p>}<button className="primary external-submit" disabled={submitting}>{submitting?"正在提交，请勿重复操作…":"确认提交"}</button></form></section></main>;
}
