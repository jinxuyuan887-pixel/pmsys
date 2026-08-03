"use client";

import { useEffect, useMemo, useState } from "react";
import { appPath } from "../base-path";

type Service = {
  id: number;
  name: string;
  contractDetail?: string;
  unit: string;
  quantity: number;
  completed: number;
  unitPrice: number;
  costPrice?: number;
};

type Project = {
  id: number;
  name: string;
  manager: string;
  managerIds?: number[];
  status: "执行中" | "待启动" | "已完成";
  risk: "正常" | "预警" | "风险";
  start: string;
  end: string;
  total: number;
  contract: string;
  services: Service[];
  _version?: number;
  _archivedAt?: string|null;
  _isDemo?: boolean;
};

type ServiceTemplate = {id:number;name:string;defaultUnit:string;category:string;enabled:boolean};
type ServiceRecord = {
  id:number;projectId:number;serviceId:number;recordType:string;status:string;createdAt:string;updatedAt?:string;approvedAt?:string|null;
  unitPriceSnapshot?:number|null;amountSnapshot?:number|null;
  costUnitSnapshot?:number|null;costAmountSnapshot?:number|null;profitRateBasisPoints?:number|null;
  payload:{data?:Record<string,unknown>;uploaded?:string[];type?:string};
};
type CurrentUser={id:number;username:string;name:string;role:string;mustChangePassword:boolean};
type ProjectManagerAccount={id:number;username:string;name:string;role:string;active:boolean};
const defaultCatalog:ServiceTemplate[] = [
  {id:1,name:"EAP大使培训",defaultUnit:"场",category:"培训",enabled:true},
  {id:2,name:"心理讲座",defaultUnit:"场",category:"活动",enabled:true},
  {id:3,name:"心理团辅",defaultUnit:"场",category:"活动",enabled:true},
  {id:4,name:"线上咨询",defaultUnit:"人次",category:"心理咨询",enabled:true},
  {id:5,name:"线下咨询",defaultUnit:"人次",category:"心理咨询",enabled:true},
  {id:6,name:"驻场咨询",defaultUnit:"天",category:"心理咨询",enabled:true},
  {id:7,name:"心理测评",defaultUnit:"人次",category:"测评",enabled:true},
];

const nav = [
  ["dashboard", "⌂", "工作台"],
  ["projects", "▣", "项目管理"],
  ["records", "▤", "服务记录"],
  ["consultants", "♧", "咨询师归集"],
  ["links", "↗", "填写链接"],
  ["governance", "◫", "操作日志"],
  ["catalog", "☷", "服务目录"],
  ["accounts", "♙", "账号管理"],
] as const;

function projectProgress(project: Project) {
  const total = project.services.reduce((sum, item) => sum + item.quantity, 0);
  const completed = project.services.reduce((sum, item) => sum + item.completed, 0);
  return total ? Math.round((completed / total) * 100) : 0;
}
function timeProgress(project:Project){
  const start=new Date(project.start).getTime(),end=new Date(project.end).getTime(),now=Date.now();
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 0;
  return Math.max(0,Math.min(100,Math.round((now-start)/(end-start)*100)));
}
function remainingDays(project:Project){
  const end=new Date(`${project.end}T23:59:59`).getTime();
  return Number.isFinite(end)?Math.max(0,Math.ceil((end-Date.now())/86400000)):0;
}
function isProjectFinished(project:Project){
  return project.services.length>0?project.services.every(service=>service.quantity>0&&service.completed>=service.quantity):project.status==="已完成";
}
function withAutomaticStatus(project:Project):Project{
  if(isProjectFinished(project))return {...project,status:"已完成"};
  return project.status==="已完成"?{...project,status:"执行中"}:project;
}
function projectHasManager(project:Project,manager:string){
  return project.manager.split("、").map(name=>name.trim()).includes(manager);
}

function money(value: number) {
  return `¥${value.toLocaleString("zh-CN")}`;
}
const recordStartDate=(data?:Record<string,unknown>)=>String(data?.startDate??data?.date??"");
const recordEndDate=(data?:Record<string,unknown>)=>String(data?.endDate??data?.startDate??data?.date??"");
const consultantCost=(record:ServiceRecord)=>Number(record.payload.data?.consultantCostUnit??record.payload.data?.costUnit??record.costUnitSnapshot??0);
const materialCost=(record:ServiceRecord)=>Number(record.payload.data?.materialCostUnit??0);

async function copyText(text:string){
  try{
    if(navigator.clipboard&&window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch{
    // HTTP and restricted browser contexts fall back to a temporary text box.
  }
  const input=document.createElement("textarea");
  input.value=text;
  input.setAttribute("readonly","");
  input.style.position="fixed";
  input.style.left="-9999px";
  document.body.appendChild(input);
  input.select();
  input.setSelectionRange(0,input.value.length);
  const copied=document.execCommand("copy");
  input.remove();
  return copied;
}

export default function DashboardApp({currentUser}:{currentUser:CurrentUser}) {
  const [page, setPage] = useState("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modal, setModal] = useState<"project" | "service" | "link" | "managerRecord" | "viewRecord" | "reviewRecord" | "editRecord" | "account" | "profile" | "securityNotice" | "catalog" | null>(currentUser.mustChangePassword?"securityNotice":null);
  const [catalog,setCatalog]=useState<ServiceTemplate[]>(defaultCatalog);
  const [projectManagerAccounts,setProjectManagerAccounts]=useState<ProjectManagerAccount[]>([]);
  const [records,setRecords]=useState<ServiceRecord[]>([]);
  const [editingRecord,setEditingRecord]=useState<ServiceRecord|null>(null);
  const [viewingRecord,setViewingRecord]=useState<ServiceRecord|null>(null);
  const [reviewingRecord,setReviewingRecord]=useState<ServiceRecord|null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [query, setQuery] = useState("");
  const [managerFilter,setManagerFilter]=useState("all");
  const [projectView,setProjectView]=useState<"all"|"active"|"finished"|"archived">("all");
  const [toast, setToast] = useState("");
  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const frozenAmountProgress=(project:Project)=>{
    const total=project.services.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0);
    const delivered=records.filter(record=>record.projectId===project.id&&record.status==="已完成").reduce((sum,record)=>sum+(record.amountSnapshot??0),0);
    return total?Math.round(delivered/total*100):0;
  };
  const projectFinance=(project:Project)=>{
    const approved=records.filter(record=>record.projectId===project.id&&record.status==="已完成");
    const revenue=approved.reduce((sum,record)=>sum+(record.amountSnapshot??0),0);
    const cost=approved.reduce((sum,record)=>sum+(record.costAmountSnapshot??0),0);
    const missingCost=approved.some(record=>record.costAmountSnapshot===null||record.costAmountSnapshot===undefined);
    return {revenue,cost,missingCost,profitRate:revenue>0&&!missingCost?(revenue-cost)/revenue*100:null};
  };
  const productionProjects=projects.filter(project=>!project._isDemo&&!project._archivedAt);
  const average = productionProjects.length?Math.round(productionProjects.reduce((s, p) => s + projectProgress(p), 0) / productionProjects.length):0;
  const projectManagers=useMemo(()=>Array.from(new Set(projects.flatMap(project=>project.manager.split("、").map(name=>name.trim()).filter(Boolean)))).sort((a,b)=>a.localeCompare(b,"zh-CN")),[projects]);
  const managerScopedProjects=projects.filter(project=>managerFilter==="all"||projectHasManager(project,managerFilter));

  const visibleProjects = useMemo(
    () => projects.filter(project=>managerFilter==="all"||projectHasManager(project,managerFilter)).filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).filter(project=>
      projectView==="archived"?Boolean(project._archivedAt):
      !project._archivedAt&&(projectView==="all"||(projectView==="finished"&&isProjectFinished(project))||(projectView==="active"&&!isProjectFinished(project)))
    ),
    [projects, query,projectView,managerFilter]
  );

  async function refreshProjects(){
    const response=await fetch(appPath("/api/projects?includeArchived=1"),{cache:"no-store"}).catch(()=>null);
    if(response?.ok){const data=await response.json() as {projects?:Project[]};setProjects(data.projects??[])}
  }

  useEffect(() => {
    let active = true;
    fetch(appPath("/api/projects?includeArchived=1"))
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { projects?: Project[] }) => {
        if (active) setProjects(data.projects??[]);
      })
      .catch(() => notify("项目数据读取失败，请刷新重试"));
    return () => { active = false; };
  }, []);

  useEffect(()=>{
    fetch(appPath("/api/catalog")).then(r=>r.ok?r.json():Promise.reject()).then((data:{items?:ServiceTemplate[]})=>{if(data.items?.length)setCatalog(data.items)}).catch(()=>undefined);
  },[]);

  useEffect(()=>{
    fetch(appPath("/api/accounts"),{cache:"no-store"})
      .then(response=>response.ok?response.json():Promise.reject())
      .then((data:{accounts?:ProjectManagerAccount[]})=>setProjectManagerAccounts((data.accounts??[]).filter(account=>account.role==="项目经理"&&account.active)))
      .catch(()=>notify("项目经理账号读取失败，请刷新重试"));
  },[]);

  async function refreshRecords(){
    const response=await fetch(appPath("/api/records"),{cache:"no-store"}).catch(()=>null);
    if(response?.ok){const data=await response.json() as {records?:ServiceRecord[]};setRecords(data.records??[])}
  }

  useEffect(()=>{
    const initial=window.setTimeout(refreshRecords,0);
    const interval=window.setInterval(()=>{void refreshRecords();void refreshProjects()},5000);
    const onVisible=()=>{if(document.visibilityState==="visible"){void refreshRecords();void refreshProjects()}};
    document.addEventListener("visibilitychange",onVisible);
    return()=>{window.clearTimeout(initial);window.clearInterval(interval);document.removeEventListener("visibilitychange",onVisible)};
  },[]);

  async function saveCatalog(next:ServiceTemplate[]){
    const previous=catalog;setCatalog(next);
    const response=await fetch(appPath("/api/catalog"),{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({items:next})}).catch(()=>null);
    if(!response?.ok){setCatalog(previous);const data=await response?.json().catch(()=>({})) as {error?:string}|undefined;notify(data?.error??"服务目录保存失败，已恢复原数据")}
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function openProject(project?: Project) {
    setEditing(project ? structuredClone(project) : null);
    setModal("project");
  }

  async function deleteProject(id: number) {
    if (!window.confirm("确认归档这个项目吗？归档后不再进入日常统计，项目、服务记录和附件仍将长期保留。")) return;
    const response=await fetch(appPath(`/api/projects?id=${id}`),{method:"DELETE"});
    if(!response.ok){notify("项目归档失败，请刷新后重试");return}
    await refreshProjects();
    if (selectedId === id) setSelectedId(null);
    notify("项目已归档，历史交付明细已保留");
  }
  async function restoreProject(id:number){
    const response=await fetch(appPath("/api/projects"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"restore",id})});
    if(!response.ok){notify("项目恢复失败，请重试");return}
    await refreshProjects();notify("项目已恢复到项目清单");
  }

  async function persistProject(next:Project,expectedVersion:number,audit=false){
    const response=await fetch(appPath("/api/projects"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({project:next,expectedVersion,audit})});
    const data=await response.json() as {project?:Project;error?:string;current?:Project};
    if(response.status===409){if(data.current)setProjects(items=>items.map(item=>item.id===next.id?data.current!:item));notify(data.error??"数据已更新，请重试");return null}
    if(!response.ok){notify(data.error??"保存失败，请重试");return null}
    if(data.project)setProjects(items=>items.map(item=>item.id===next.id&&item._version===expectedVersion?data.project!:item));
    return data.project??null;
  }

  function updateProject(projectId:number,change:(project:Project)=>Project,audit=false){
    setProjects(items=>{
      const current=items.find(item=>item.id===projectId);
      if(!current)return items;
      const next=withAutomaticStatus(change(current)),expected=current._version??1;
      void persistProject(next,expected,audit);
      return items.map(item=>item.id===projectId?next:item);
    });
  }

  async function saveProject(form: FormData) {
    const base: Project = editing ?? {
      id: Date.now(),
      name: "",
      manager: "",
      status: "执行中",
      risk: "正常",
      start: "",
      end: "",
      total: 0,
      contract: "",
      services: [],
    };
    const submittedServices = JSON.parse(String(form.get("services") || "[]")) as Service[];
    const next: Project = withAutomaticStatus({
      ...base,
      name: String(form.get("name")),
      managerIds: form.getAll("managerIds").map(Number).filter(Number.isSafeInteger),
      manager: projectManagerAccounts.filter(manager=>form.getAll("managerIds").map(Number).includes(manager.id)).map(manager=>manager.name).join("、"),
      contract: String(form.get("contract")),
      total: Number(form.get("total")) || submittedServices.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
      start: String(form.get("start")),
      end: String(form.get("end")),
      status: String(form.get("status")) as Project["status"],
      services: submittedServices,
    });
    const response=await fetch(appPath("/api/projects"),{method:editing?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(editing?{project:next,expectedVersion:editing._version??1,audit:true}:{project:next})});
    const data=await response.json() as {project?:Project;error?:string;current?:Project};
    if(!response.ok){if(data.current)setProjects(items=>items.map(item=>item.id===next.id?data.current!:item));notify(data.error??"项目保存失败");return}
    const saved=data.project??next;
    setProjects((items) => editing ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]);
    setModal(null);
    notify(editing ? "项目修改成功" : "项目创建成功");
  }

  function saveService(form: FormData) {
    if (!selected) return;
    const service: Service = {
      id: Date.now(),
      name: String(form.get("name")),
      contractDetail: String(form.get("contractDetail")).trim(),
      unit: String(form.get("unit")),
      quantity: Number(form.get("quantity")),
      completed: 0,
      unitPrice: Number(form.get("unitPrice")),
      costPrice: Number(form.get("costPrice")),
    };
    updateProject(selected.id,p=>({ ...p, services: [...p.services, service] }),true);
    setModal(null);
    notify("服务内容已添加");
  }

  async function saveManagerRecord(form:FormData){
    const projectId=Number(form.get("projectId"));
    const serviceId=Number(form.get("serviceId"));
    const quantity=Number(form.get("quantity"))||1;
    const uploaded:string[]=[];
    for(const file of form.getAll("files")){
      if(file instanceof File&&file.size>0){const upload=new FormData();upload.append("file",file);const response=await fetch(appPath("/api/upload"),{method:"POST",body:upload});if(response.ok){const data=await response.json();uploaded.push(data.key)}}
    }
    const payload={source:"项目经理填写",projectId,serviceId,recordType:String(form.get("recordType")),provider:String(form.get("provider")),startDate:String(form.get("startDate")),endDate:String(form.get("endDate")),quantity,consultantCostUnit:Number(form.get("consultantCostUnit")),materialCostUnit:Number(form.get("materialCostUnit")),summary:String(form.get("summary")),status:"已完成"};
    const response=await fetch(appPath("/api/records"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:payload.recordType,data:payload,uploaded})}).catch(()=>null);
    if(!response?.ok){const data=await response?.json().catch(()=>({})) as {error?:string}|undefined;notify(data?.error??"服务记录保存失败，项目进度未变更");return}
    setModal(null);
    await Promise.all([refreshRecords(),refreshProjects()]);
    notify("服务记录已保存，项目进度已更新");
  }

  async function saveEditedRecord(form:FormData){
    if(!editingRecord)return;
    const projectId=Number(form.get("projectId")),serviceId=Number(form.get("serviceId")),quantity=Number(form.get("quantity"))||1;
    const oldQuantity=Number(editingRecord.payload.data?.quantity??1),wasCompleted=editingRecord.status==="已完成";
    const consultantCostValue=form.get("consultantCostUnit"),materialCostValue=form.get("materialCostUnit");
    const data={...editingRecord.payload.data,projectId,serviceId,recordType:String(form.get("recordType")),provider:String(form.get("provider")),startDate:String(form.get("startDate")),endDate:String(form.get("endDate")),quantity,...(consultantCostValue!==null&&String(consultantCostValue)!==""?{consultantCostUnit:Number(consultantCostValue)}:{}),...(materialCostValue!==null&&String(materialCostValue)!==""?{materialCostUnit:Number(materialCostValue)}:{}),summary:String(form.get("summary"))};
    const response=await fetch(appPath("/api/records"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:editingRecord.id,type:String(form.get("recordType")),data})});
    if(!response.ok){notify("记录修改失败，请重试");return}
    void oldQuantity;void wasCompleted;
    setModal(null);setEditingRecord(null);await Promise.all([refreshRecords(),refreshProjects()]);notify("服务记录已修改，冻结金额与项目进度已同步更新");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">♥</span><strong>EAP 项目管理</strong></div>
        <nav>
          {nav.map(([key, icon, label]) => (
            <button key={key} className={page === key ? "active" : ""} onClick={() => { setPage(key); setSelectedId(null); }}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </nav>
        <button className="sidebar-bottom" onClick={()=>setModal("profile")}><span className="avatar small">{currentUser.name.slice(0,1)}</span><div><strong>{currentUser.name}</strong><small>{currentUser.role}</small></div><span>⌄</span></button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><h1>{selected ? selected.name : page === "dashboard" ? "项目管理总览" : nav.find((n) => n[0] === page)?.[2]}</h1>
          <p>{selected ? `${selected.contract} · ${selected.start} 至 ${selected.end}` : "实时掌握项目进度与服务交付情况"}</p></div>
          <div className="header-actions">
            <button className="primary" onClick={() => openProject()}>＋ 新增项目</button>
          </div>
        </header>

        {page === "dashboard" && !selected && (
          <>
            <section className="kpi-grid">
              <Kpi icon="▣" tone="blue" label="正式项目" value={productionProjects.length} note="示例与归档项目不计入" />
              <Kpi icon="▷" tone="green" label="执行中" value={productionProjects.filter((p) => p.status === "执行中"&&!isProjectFinished(p)).length} note={`平均完成率 ${average}%`} />
              <Kpi icon="✓" tone="blue" label="已结束" value={productionProjects.filter(isProjectFinished).length} note="交付明细长期保留" />
              <Kpi icon="□" tone="amber" label="待启动" value={productionProjects.filter(project=>project.status==="待启动").length} note="尚未开始执行" />
            </section>
            <section className="dashboard-grid">
              <Panel title="项目进度概览" action="查看全部" onAction={() => setPage("projects")} wide>
                <div className="table project-overview">
                  <div className="tr th"><span>项目名称</span><span>项目经理</span><span>时间进度</span><span>服务进度</span><span>状态</span></div>
                  {projects.filter(project=>!project._archivedAt).slice(0,8).map((p) => <button className="tr" key={p.id} onClick={() => setSelectedId(p.id)}>
                    <span className="project-name">{p.name}{p._isDemo&&<small className="demo-tag">示例</small>}</span><span>{p.manager}</span>
                    <Progress value={timeProgress(p)} />
                    <Progress value={projectProgress(p)} green />
                    <Status value={isProjectFinished(p)?"已完成":p.status} />
                  </button>)}
                </div>
              </Panel>
              <Panel title="最新服务记录" action="查看全部" onAction={() => setPage("records")} wide>
                <div className="recent-list">
                  {records.slice(0,4).map(record=>{const project=projects.find(item=>item.id===record.projectId),service=project?.services.find(item=>item.id===record.serviceId);return <div key={record.id}><span><strong>{service?.name??record.recordType}｜{String(record.payload.data?.provider??"未填写")}</strong><small>{String(record.payload.data?.date??record.createdAt.slice(0,10))} · {project?.name??"对应项目"}</small></span><Status value={record.status==="已完成"?"已交付":record.status}/></div>})}
                  {!records.length&&<div><span><strong>暂无服务记录</strong><small>完成内部填写或外部提交后将在这里显示</small></span></div>}
                </div>
              </Panel>
            </section>
          </>
        )}

        {page === "projects" && !selected && (
          <section className="content-card">
            <div className="toolbar"><div className="search">⌕<input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="搜索项目名称"/></div>
              <div className="filters manager-select"><label><span>项目经理</span><select value={managerFilter} onChange={event=>setManagerFilter(event.target.value)}><option value="all">全部项目经理</option>{projectManagers.map(manager=><option value={manager} key={manager}>{manager}</option>)}</select></label></div></div>
            <div className="tabs project-tabs"><button className={projectView==="all"?"active":""} onClick={()=>setProjectView("all")}>全部项目 {managerScopedProjects.filter(p=>!p._archivedAt).length}</button><button className={projectView==="active"?"active":""} onClick={()=>setProjectView("active")}>进行中 {managerScopedProjects.filter(project=>!project._archivedAt&&!isProjectFinished(project)).length}</button><button className={projectView==="finished"?"active":""} onClick={()=>setProjectView("finished")}>已结束 {managerScopedProjects.filter(project=>!project._archivedAt&&isProjectFinished(project)).length}</button><button className={projectView==="archived"?"active":""} onClick={()=>setProjectView("archived")}>已归档 {managerScopedProjects.filter(project=>project._archivedAt).length}</button></div>
            <div className="project-cards">
              {visibleProjects.map((p)=><article key={p.id} onClick={()=>setSelectedId(p.id)}>
                <div className="card-head"><Status value={isProjectFinished(p)?"已完成":p.status}/><button onClick={(e)=>{e.stopPropagation(); openProject(p)}}>•••</button></div>
                <h3>{p.name} {p._isDemo&&<small className="demo-tag">示例数据</small>}</h3><p>{p.contract} · 项目经理：{p.manager}</p>
                <div className="big-progress"><span><b>服务进度</b><strong>{projectProgress(p)}%</strong></span><Progress value={projectProgress(p)} green/></div>
                <div className="card-stats"><span>项目总价<strong>{money(p.total)}</strong></span><span>服务项<strong>{p.services.length}</strong></span><span>{isProjectFinished(p)?"项目状态":"剩余天数"}<strong>{isProjectFinished(p)?"已结束":p.status==="待启动"?"未开始":`${remainingDays(p)}天`}</strong></span></div>
                <div className="card-foot"><span>{p.start} — {p.end}</span><span>{p._archivedAt?<button onClick={(e)=>{e.stopPropagation();restoreProject(p.id)}}>恢复项目</button>:<><button onClick={(e)=>{e.stopPropagation();openProject(p)}}>编辑</button><button className="danger-text" onClick={(e)=>{e.stopPropagation();deleteProject(p.id)}}>归档</button></>}</span></div>
              </article>)}
              {visibleProjects.length===0&&<div className="empty-records project-empty"><strong>{projectView==="finished"?"暂无已结束项目":"当前条件下暂无项目"}</strong><span>{projectView==="finished"?"所有服务任务完成后，项目会自动归集到这里，交付明细仍可随时查看。":"可以调整筛选条件或新建项目。"}</span></div>}
            </div>
          </section>
        )}

        {selected && (
          <section className="detail-layout">
            <button className="back" onClick={()=>setSelectedId(null)}>← 返回项目列表</button>
            {selected._archivedAt&&<div className="catalog-note">该项目已归档，目前仅供查看。如需继续交付，请先在“已归档”清单中恢复项目。</div>}
            <div className="detail-summary">
              <div><small>项目总价</small><strong>{money(selected.total)}</strong></div>
              <div><small>服务执行进度</small><strong>{projectProgress(selected)}%</strong></div>
              <div><small>项目总利润率</small><strong className="profit-number">{projectFinance(selected).missingCost?"待补历史成本":projectFinance(selected).profitRate===null?"待产生交付":`${projectFinance(selected).profitRate!.toFixed(1)}%`}</strong></div>
              <div><small>服务项数</small><strong>{selected.services.length} 项</strong></div>
            </div>
            <div className="progress-explain">
              <div><span>数量进度</span><strong>{projectProgress(selected)}%</strong><small>已执行数量 ÷ 合同约定数量</small></div>
              <div><span>金额进度</span><strong>{frozenAmountProgress(selected)}%</strong><small>交付 {money(projectFinance(selected).revenue)} · {projectFinance(selected).missingCost?"部分历史成本待补":`成本 ${money(projectFinance(selected).cost)}`}</small></div>
              <div><span>时间进度</span><strong>{timeProgress(selected)}%</strong><small>已过项目天数 ÷ 项目总天数</small></div>
              <div><span>剩余服务数量</span><strong>{selected.services.reduce((sum,service)=>sum+Math.max(0,service.quantity-service.completed),0)}</strong><small>合同数量减去已审核交付数量</small></div>
            </div>
            <div className="section-title"><div><h2>项目服务内容</h2><p>不同客户的服务数量、单位和单价均可独立配置</p></div>{!selected._archivedAt&&<button className="primary" onClick={()=>setModal("service")}>＋ 添加服务</button>}</div>
            <div className="service-table">
              <div className="service-row heading"><span>服务内容</span><span>计量方式</span><span>单价</span><span>合同金额</span><span>执行进度</span><span>操作</span></div>
              {selected.services.map((s)=><div className="service-row" key={s.id}>
                <span><strong>{s.name}</strong><small>{s.contractDetail||"未填写合同详情说明"}</small></span><span>{s.completed}/{s.quantity} {s.unit}</span><span>{money(s.unitPrice)}/{s.unit}</span><span>{money(s.unitPrice*s.quantity)}</span>
                <span><Progress value={Math.round(s.completed/s.quantity*100)} green/></span>
                <span>{!selected._archivedAt&&<button onClick={()=>setModal("link")}>生成填写链接</button>}</span>
              </div>)}
            </div>
          </section>
        )}

        {page === "records" && !selected && <Records records={records} projects={projects.filter(project=>!project._archivedAt)} managerFilter={managerFilter} onManagerFilterChange={setManagerFilter} refresh={async()=>{await Promise.all([refreshRecords(),refreshProjects()])}} notify={notify} onManagerRecord={()=>setModal("managerRecord")} onLink={()=>setModal("link")} onView={(record)=>{setViewingRecord(record);setModal("viewRecord")}} onReview={(record)=>{setReviewingRecord(record);setModal("reviewRecord")}} onEdit={(record)=>{setEditingRecord(record);setModal("editRecord")}}/>}
        {page === "consultants" && !selected && <Consultants records={records} projects={projects} onView={(record)=>{setViewingRecord(record);setModal("viewRecord")}}/>}
        {page === "links" && !selected && <ExternalLinks projects={projects} notify={notify} onAdd={()=>setModal("link")}/>}
        {page === "governance" && !selected && <Governance/>}
        {page === "catalog" && !selected && <ServiceCatalog items={catalog} onChange={saveCatalog} onAdd={()=>setModal("catalog")}/>}
        {page === "accounts" && !selected && <Accounts currentUser={currentUser} notify={notify} onAdd={()=>setModal("account")}/>}
      </main>

      {modal && <div className="modal-backdrop" onMouseDown={()=>{if(!currentUser.mustChangePassword)setModal(null)}}>
        <div className="modal" onMouseDown={(e)=>e.stopPropagation()}>
          {!currentUser.mustChangePassword&&<button className="close" onClick={()=>setModal(null)}>×</button>}
          {modal === "project" && <ProjectForm editing={editing} catalog={catalog} projectManagers={projectManagerAccounts} currentUser={currentUser} onSave={saveProject}/>}
          {modal === "service" && <ServiceForm catalog={catalog} onSave={saveService}/>}
          {modal === "link" && <LinkDialog projects={projects.filter(project=>!project._archivedAt)} selectedProjectId={selected?.id} notify={notify} close={()=>setModal(null)}/>}
          {modal === "managerRecord" && <ManagerRecordForm projects={projects.filter(project=>!project._archivedAt)} onSave={saveManagerRecord} close={()=>setModal(null)}/>}
          {modal === "viewRecord" && viewingRecord && <ViewRecordDialog record={viewingRecord} projects={projects} close={()=>{setModal(null);setViewingRecord(null)}}/>}
          {modal === "reviewRecord" && reviewingRecord && <ReviewRecordDialog record={reviewingRecord} projects={projects} notify={notify} close={()=>{setModal(null);setReviewingRecord(null)}} onApproved={async()=>{setModal(null);setReviewingRecord(null);await Promise.all([refreshRecords(),refreshProjects()])}}/>}
          {modal === "editRecord" && editingRecord && <EditRecordForm record={editingRecord} projects={projects.filter(project=>!project._archivedAt)} onSave={saveEditedRecord} close={()=>{setModal(null);setEditingRecord(null)}}/>}
          {modal === "account" && <AccountForm notify={notify} close={()=>setModal(null)}/>}
          {modal === "profile" && <ProfileForm user={currentUser} forced={currentUser.mustChangePassword} notify={notify} close={()=>setModal(null)}/>}
          {modal === "securityNotice" && <SecurityNotice user={currentUser} onConfirm={()=>setModal("profile")}/>}
          {modal === "catalog" && <CatalogForm onSave={(item)=>{saveCatalog([...catalog,item]);setModal(null);notify("服务名称已加入目录")}}/>}
        </div>
      </div>}
      {toast && <div className="toast">✓ {toast}</div>}
    </div>
  );
}

function Kpi({icon,tone,label,value,note}:{icon:string;tone:string;label:string;value:number;note:string}) {
  return <article className="kpi"><span className={`kpi-icon ${tone}`}>{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{note}</small></div></article>;
}
function Panel({title,action,onAction,children,wide}:{title:string;action?:string;onAction?:()=>void;children:React.ReactNode;wide?:boolean}) {
  return <section className={`panel ${wide?"wide":""}`}><header><h2>{title}</h2>{action&&<button onClick={onAction}>{action} ›</button>}</header>{children}</section>;
}
function Progress({value,green}:{value:number;green?:boolean}) {
  return <span className={`progress ${green?"green":""}`}><i><b style={{width:`${value}%`}}/></i><em>{value}%</em></span>;
}
function Status({value}:{value:string}) {
  const kind = ["风险","已退回"].includes(value)?"red":["预警","待审核"].includes(value)?"amber":["已完成","已交付","执行中","正常"].includes(value)?"green":"blue";
  return <span className={`status ${kind}`}>{value}</span>;
}

function ProjectForm({editing,catalog,projectManagers,currentUser,onSave}:{editing:Project|null;catalog:ServiceTemplate[];projectManagers:ProjectManagerAccount[];currentUser:CurrentUser;onSave:(data:FormData)=>void}) {
  const available=catalog.filter(item=>item.enabled);
  const initialManagerIds=editing?.managerIds?.length
    ? editing.managerIds
    : editing
      ? projectManagers.filter(account=>editing.manager.split("、").includes(account.name)).map(account=>account.id)
      : currentUser.role==="项目经理"
        ? [currentUser.id]
        : [];
  const [selectedManagerIds,setSelectedManagerIds]=useState<number[]>(initialManagerIds);
  const [services,setServices]=useState<Service[]>(()=>editing?.services ?? [{id:Date.now(),name:available[0]?.name??"",contractDetail:"",unit:available[0]?.defaultUnit??"场",quantity:1,completed:0,unitPrice:0,costPrice:0}]);
  const serviceTotal=services.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0);
  function updateService(id:number,key:keyof Service,value:string){
    setServices(items=>items.map(item=>item.id===id?{...item,[key]:["quantity","unitPrice","costPrice"].includes(key)?Number(value):value}:item));
  }
  return <form action={onSave}><div className="modal-title"><h2>{editing?"编辑项目":"新增项目"}</h2><p>直接录入项目及服务信息，无需读取或解析合同。</p></div>
    <div className="form-grid"><label className="full">项目名称<input name="name" required defaultValue={editing?.name}/></label>
      <label>合同编号<input name="contract" required defaultValue={editing?.contract}/></label>
      <div className="manager-picker"><span>项目经理</span><small>可多选；项目经理新建时默认选择本人</small><div>{projectManagers.map(manager=><label key={manager.id}><input type="checkbox" name="managerIds" value={manager.id} checked={selectedManagerIds.includes(manager.id)} onChange={event=>setSelectedManagerIds(ids=>event.target.checked?[...ids,manager.id]:ids.filter(id=>id!==manager.id))}/><span><strong>{manager.name}</strong><small>@{manager.username}</small></span></label>)}</div>{!projectManagers.length&&<em>暂无启用中的项目经理账号，请先在账号管理中创建或启用。</em>}{projectManagers.length>0&&!selectedManagerIds.length&&<em>请至少选择一位项目经理</em>}</div>
      <label>项目总价（元）<input name="total" type="number" placeholder={`留空则按服务合计 ${serviceTotal} 元`} defaultValue={editing?.total}/></label><label>项目状态<select name="status" defaultValue={editing?.status}><option>执行中</option><option>待启动</option><option>已完成</option></select></label>
      <label>开始日期<input name="start" type="date" required defaultValue={editing?.start}/></label><label>结束日期<input name="end" type="date" required defaultValue={editing?.end}/></label>
      <label>合同文件（选填）<input type="file" accept=".pdf,.doc,.docx"/></label>
      <div className="full service-builder">
        <div className="builder-title"><span><strong>项目服务内容</strong><small>服务大类从统一目录选择；合同详情说明用于区分同一大类下的具体服务细项</small></span><button type="button" onClick={()=>setServices(items=>[...items,{id:Date.now(),name:available[0]?.name??"",contractDetail:"",unit:available[0]?.defaultUnit??"场",quantity:1,completed:0,unitPrice:0,costPrice:0}])}>＋ 添加服务</button></div>
        <div className="builder-head"><span>服务大类／合同详情说明</span><span>单位</span><span>数量</span><span>销售单价</span><span>成本单价</span><span>金额小计</span><span/></div>
        {services.map(item=><div className="builder-row" key={item.id}>
          <div className="builder-service"><select required value={item.name} onChange={e=>{const template=available.find(x=>x.name===e.target.value);setServices(items=>items.map(x=>x.id===item.id?{...x,name:e.target.value,unit:template?.defaultUnit??x.unit}:x))}}>{available.map(template=><option key={template.id}>{template.name}</option>)}</select><input required maxLength={500} placeholder="合同详情说明，如：压力管理专题讲座" value={item.contractDetail??""} onChange={e=>updateService(item.id,"contractDetail",e.target.value)}/></div>
          <select value={item.unit} onChange={e=>updateService(item.id,"unit",e.target.value)}><option>场</option><option>人次</option><option>小时</option><option>天</option><option>期</option><option>份</option></select>
          <input type="number" min="1" value={item.quantity} onChange={e=>updateService(item.id,"quantity",e.target.value)}/>
          <input type="number" min="0" placeholder="填写销售单价" value={item.unitPrice===0?"":item.unitPrice} onChange={e=>updateService(item.id,"unitPrice",e.target.value)}/>
          <input type="number" min="0" placeholder="填写成本单价" value={(item.costPrice??0)===0?"":item.costPrice} onChange={e=>updateService(item.id,"costPrice",e.target.value)}/>
          <strong>{money(item.quantity*item.unitPrice)}</strong>
          <button type="button" disabled={services.length===1} onClick={()=>setServices(items=>items.filter(x=>x.id!==item.id))}>×</button>
        </div>)}
        <div className="builder-total"><span>服务金额合计</span><strong>{money(serviceTotal)}</strong></div>
        <input type="hidden" name="services" value={JSON.stringify(services)}/>
      </div>
    </div>
    <div className="modal-actions"><button className="primary" type="submit" disabled={!selectedManagerIds.length}>{editing?"保存修改":"创建项目"}</button></div>
  </form>;
}
function ServiceForm({catalog,onSave}:{catalog:ServiceTemplate[];onSave:(d:FormData)=>void}) {
  return <form action={onSave}><div className="modal-title"><h2>添加项目服务</h2><p>从服务目录选择名称，数量和单价按当前项目独立设置。</p></div>
    <div className="form-grid"><label className="full">服务大类<select name="name" required>{catalog.filter(x=>x.enabled).map(item=><option key={item.id}>{item.name}</option>)}</select></label>
      <label className="full">合同详情说明<input name="contractDetail" required maxLength={500} placeholder="标注合同约定的具体服务细项"/></label>
      <label>计量单位<select name="unit"><option>场</option><option>人次</option><option>小时</option><option>天</option><option>期</option><option>份</option></select></label>
      <label>服务数量<input name="quantity" type="number" min="1" required/></label><label>服务单价（元）<input name="unitPrice" type="number" min="0" required placeholder="填写销售单价"/></label><label>成本单价（元）<input name="costPrice" type="number" min="0" placeholder="填写成本单价"/></label>
      <label>统计方式<select><option>审核通过后自动累计</option><option>手动更新进度</option><option>按完成状态统计</option></select></label>
      <label className="full">自定义字段<div className="custom-field-row"><input placeholder="字段名称"/><select><option>文本</option><option>数字</option><option>日期</option><option>金额</option><option>文件</option></select><button type="button">＋ 添加字段</button></div></label></div>
    <div className="modal-actions"><button type="button">取消</button><button className="primary" type="submit">确认添加</button></div>
  </form>;
}

function ProjectSearchSelect({projects,value,onChange,name,allowAll=false,placeholder="输入项目名称搜索"}:{
  projects:Project[];
  value:number|"all";
  onChange:(value:number|"all")=>void;
  name?:string;
  allowAll?:boolean;
  placeholder?:string;
}) {
  const selectedLabel=value==="all"?"全部项目":projects.find(project=>project.id===value)?.name??"";
  const [query,setQuery]=useState(selectedLabel);
  const [open,setOpen]=useState(false);
  const [activeIndex,setActiveIndex]=useState(0);
  const normalized=query.trim().toLocaleLowerCase("zh-CN");
  const choices=[
    ...(allowAll?[{id:"all" as const,name:"全部项目",contract:"查看所有项目"}]:[]),
    ...projects.map(project=>({id:project.id,name:project.name,contract:project.contract})),
  ].filter(item=>!normalized||item.name.toLocaleLowerCase("zh-CN").includes(normalized));
  function choose(id:number|"all"){
    const label=id==="all"?"全部项目":projects.find(project=>project.id===id)?.name??"";
    onChange(id);setQuery(label);setOpen(false);setActiveIndex(0);
  }
  return <div className="project-combobox">
    {name&&<input type="hidden" name={name} value={value}/>}
    <div className="project-combobox-input">
      <span aria-hidden="true">⌕</span>
      <input
        role="combobox"
        aria-label="搜索并选择项目"
        aria-expanded={open}
        aria-controls="project-search-options"
        aria-autocomplete="list"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={event=>{setOpen(true);setActiveIndex(0);event.currentTarget.select()}}
        onChange={event=>{setQuery(event.target.value);setOpen(true);setActiveIndex(0)}}
        onBlur={()=>window.setTimeout(()=>setOpen(false),120)}
        onKeyDown={event=>{
          if(event.key==="ArrowDown"){event.preventDefault();setOpen(true);setActiveIndex(index=>Math.min(index+1,Math.max(choices.length-1,0)))}
          if(event.key==="ArrowUp"){event.preventDefault();setActiveIndex(index=>Math.max(index-1,0))}
          if(event.key==="Enter"&&open&&choices[activeIndex]){event.preventDefault();choose(choices[activeIndex].id)}
          if(event.key==="Escape"){event.preventDefault();setOpen(false);setQuery(selectedLabel)}
        }}
      />
      <button type="button" aria-label="展开项目列表" onMouseDown={event=>event.preventDefault()} onClick={()=>setOpen(current=>!current)}>⌄</button>
    </div>
    {open&&<div className="project-combobox-options" id="project-search-options" role="listbox">
      {choices.length?choices.slice(0,50).map((item,index)=><button
        type="button"
        role="option"
        aria-selected={item.id===value}
        className={`${item.id===value?"selected ":""}${index===activeIndex?"active":""}`}
        key={item.id}
        onMouseDown={event=>event.preventDefault()}
        onMouseEnter={()=>setActiveIndex(index)}
        onClick={()=>choose(item.id)}
      ><span>{item.name}</span><small>{item.contract}</small></button>):<div className="project-combobox-empty">未找到匹配项目，请尝试其他关键词</div>}
      {choices.length>50&&<div className="project-combobox-hint">结果较多，请继续输入关键词缩小范围</div>}
    </div>}
  </div>;
}

function ManagerRecordForm({projects,onSave,close}:{projects:Project[];onSave:(d:FormData)=>void;close:()=>void}) {
  const [projectId,setProjectId]=useState(projects[0]?.id??0);
  const current=projects.find(project=>project.id===projectId);
  const [serviceId,setServiceId]=useState(current?.services[0]?.id??0);
  const [consultantCostUnit,setConsultantCostUnit]=useState("");
  const [materialCostUnit,setMaterialCostUnit]=useState("");
  const selectedService=current?.services.find(service=>service.id===serviceId)??current?.services[0];
  const totalCost=consultantCostUnit!==""&&materialCostUnit!==""?Number(consultantCostUnit)+Number(materialCostUnit):null;
  const profitRate=selectedService&&selectedService.unitPrice>0&&totalCost!==null?(selectedService.unitPrice-totalCost)/selectedService.unitPrice*100:null;
  return <form action={onSave}><div className="modal-title"><h2>项目经理填写服务记录</h2><p>填写成本后保存，系统自动计算本条记录利润率并计入项目汇总。</p></div>
    <div className="record-source"><span>填写身份</span><strong>项目经理 · 当前登录账号</strong></div>
    <div className="form-grid"><label>所属项目<ProjectSearchSelect name="projectId" projects={projects} value={projectId} onChange={value=>{const id=Number(value),project=projects.find(item=>item.id===id);setProjectId(id);setServiceId(project?.services[0]?.id??0);setConsultantCostUnit("");setMaterialCostUnit("")}}/></label>
      <label>服务内容<select name="serviceId" value={serviceId} onChange={e=>{setServiceId(Number(e.target.value));setConsultantCostUnit("");setMaterialCostUnit("")}}>{current?.services.map(service=><option value={service.id} key={service.id}>{service.name}（剩余 {Math.max(0,service.quantity-service.completed)} {service.unit}）</option>)}</select></label>
      <label>记录类型<select name="recordType"><option>讲座／团辅活动记录</option><option>心理咨询台账</option><option>培训活动记录</option><option>驻场服务记录</option><option>EAP宣传记录</option><option>心理测评记录</option></select></label>
      <label>服务人员<input name="provider" required placeholder="讲师、咨询师或项目经理"/></label>
      <label>服务开始日期<input name="startDate" type="date" required/></label><label>服务结束日期<input name="endDate" type="date" required/></label><label>本次完成数量<input name="quantity" type="number" min="1" defaultValue="1" required/></label>
      <label>咨询师成本单价（元）<input name="consultantCostUnit" type="number" min="0" step="0.01" value={consultantCostUnit} onChange={e=>setConsultantCostUnit(e.target.value)} required placeholder="必填"/></label>
      <label>物料成本单价（元）<input name="materialCostUnit" type="number" min="0" step="0.01" value={materialCostUnit} onChange={e=>setMaterialCostUnit(e.target.value)} required placeholder="无物料成本请填0"/></label>
      <div className="profit-preview"><small>服务单价</small><strong>{money(selectedService?.unitPrice??0)}</strong><small>单条利润率</small><strong className={profitRate!==null&&profitRate<0?"negative-profit":""}>{profitRate===null?"填写成本后计算":`${profitRate.toFixed(1)}%`}</strong></div>
      <label className="full">服务执行情况<textarea name="summary" required placeholder="填写活动主题、参与人数、咨询时长、执行效果等"/></label>
      <label className="full">现场图片、课件及其他资料<input name="files" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx"/></label></div>
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary">保存记录并更新进度</button></div></form>;
}
function LinkDialog({projects,selectedProjectId,notify,close}:{projects:Project[];selectedProjectId?:number;notify:(s:string)=>void;close:()=>void}) {
  const [projectId,setProjectId]=useState(selectedProjectId??projects[0]?.id??0);
  const [link,setLink]=useState("");
  const current=projects.find(project=>project.id===projectId);
  async function generate(form:FormData){
    const response=await fetch(appPath("/api/form-links"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectId,serviceId:Number(form.get("serviceId")),formType:String(form.get("formType")),expiresInDays:Number(form.get("expiresInDays"))||undefined,maxSubmissions:Number(form.get("maxSubmissions"))||1})});
    if(!response.ok){notify("链接生成失败，请重试");return}
    const data=await response.json() as {path:string};setLink(`${window.location.origin}${data.path}`);
  }
  return <form action={generate}><div className="modal-title"><h2>生成项目专属填写链接</h2><p>先绑定项目和服务。外部人员无需选择项目，提交后自动归集并进入待审核。</p></div>
    {!link?<div className="form-grid"><label className="full">对应项目<ProjectSearchSelect projects={projects} value={projectId} onChange={value=>setProjectId(Number(value))}/></label>
      <label className="full">对应服务内容<select name="serviceId" key={projectId} required>{current?.services.map(service=><option value={service.id} key={service.id}>{service.name}（{service.unit}）</option>)}</select></label>
      <label>填写表单<select name="formType"><option>心理咨询台账</option><option>讲座／团辅活动记录</option><option>培训活动记录</option><option>驻场服务记录</option><option>EAP宣传记录</option><option>心理测评记录</option></select></label><label>链接有效期<select name="expiresInDays"><option value="7">7天</option><option value="30">30天</option><option value="">永久有效</option></select></label>
      <label className="full">允许提交次数<select name="maxSubmissions"><option value="1">仅一次</option><option value="9999">可重复提交</option></select></label></div>:
      <div className="generated-link"><span>✓</span><h3>项目专属链接已生成</h3><p>{link}</p><small>外部页面不显示项目金额，记录将自动归集至已绑定项目</small></div>}
    <div className="modal-actions"><button type="button" onClick={close}>关闭</button>{!link?<button className="primary">生成链接</button>:<button type="button" className="primary" onClick={async()=>notify(await copyText(link)?"填写链接已复制":"复制失败，请手动选择链接复制")}>复制链接</button>}</div>
  </form>;
}
function Records({records,projects,managerFilter,onManagerFilterChange,refresh,notify,onManagerRecord,onLink,onView,onReview,onEdit}:{records:ServiceRecord[];projects:Project[];managerFilter:string;onManagerFilterChange:(manager:string)=>void;refresh:()=>Promise<void>;notify:(s:string)=>void;onManagerRecord:()=>void;onLink:()=>void;onView:(record:ServiceRecord)=>void;onReview:(record:ServiceRecord)=>void;onEdit:(record:ServiceRecord)=>void}) {
  const [period,setPeriod]=useState<"week"|"month"|"all"|"custom">("month");
  const [recordStatus,setRecordStatus]=useState<"all"|"delivered"|"pending">("all");
  const [projectId,setProjectId]=useState<"all"|number>("all");
  const [start,setStart]=useState(""),[end,setEnd]=useState("");
  const [deletingId,setDeletingId]=useState<number|null>(null);
  const recordDate=(record:ServiceRecord)=>new Date(recordStartDate(record.payload.data)||record.createdAt);
  const recordDateRange=(record:ServiceRecord)=>{const data=record.payload.data,start=recordStartDate(data),end=recordEndDate(data);return start&&end&&start!==end?`${new Date(start).toLocaleDateString("zh-CN")} 至 ${new Date(end).toLocaleDateString("zh-CN")}`:new Date(start||record.createdAt).toLocaleDateString("zh-CN")};
  const today=new Date();today.setHours(23,59,59,999);
  const weekStart=new Date(today);weekStart.setDate(today.getDate()-((today.getDay()+6)%7));weekStart.setHours(0,0,0,0);
  const monthStart=new Date(today.getFullYear(),today.getMonth(),1);
  const managers=Array.from(new Set(projects.map(project=>project.manager.trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,"zh-CN"));
  const managerProjects=projects.filter(project=>managerFilter==="all"||projectHasManager(project,managerFilter));
  const managerProjectIds=new Set(managerProjects.map(project=>project.id));
  const inRange=(record:ServiceRecord)=>{
    const date=recordDate(record);
    if(period==="week")return date>=weekStart&&date<=today;
    if(period==="month")return date>=monthStart&&date<=today;
    if(period==="custom")return (!start||date>=new Date(`${start}T00:00:00`))&&(!end||date<=new Date(`${end}T23:59:59`));
    return true;
  };
  const projectFiltered=records.filter(record=>managerProjectIds.has(record.projectId)&&(projectId==="all"||record.projectId===projectId));
  const timeFiltered=projectFiltered.filter(inRange);
  const filtered=timeFiltered.filter(record=>recordStatus==="all"||(recordStatus==="delivered"&&record.status==="已完成")||(recordStatus==="pending"&&record.status==="待审核")).sort((a,b)=>recordDate(b).getTime()-recordDate(a).getTime()||(b.id-a.id));
  const recordTimestamp=(record:ServiceRecord)=>{
    const value=record.status==="已完成"&&record.approvedAt?record.approvedAt:record.updatedAt||record.createdAt;
    return new Date(value).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  };
  function serviceFor(record:ServiceRecord){return projects.find(item=>item.id===record.projectId)?.services.find(item=>item.id===record.serviceId)}
  function isDemoRecord(record:ServiceRecord){return Boolean(projects.find(item=>item.id===record.projectId)?._isDemo)}
  function recordAmount(record:ServiceRecord){return record.amountSnapshot??null}
  const deliveryFinance=(items:ServiceRecord[])=>{
    const approved=items.filter(record=>record.status==="已完成"&&!isDemoRecord(record));
    const amount=approved.reduce((sum,record)=>sum+(recordAmount(record)??0),0);
    const cost=approved.reduce((sum,record)=>sum+(record.costAmountSnapshot??0),0);
    return {amount,cost,profitRate:amount>0?(amount-cost)/amount*100:null};
  };
  const weekFinance=deliveryFinance(projectFiltered.filter(record=>{const date=recordDate(record);return date>=weekStart&&date<=today}));
  const monthFinance=deliveryFinance(projectFiltered.filter(record=>{const date=recordDate(record);return date>=monthStart&&date<=today}));
  const filteredFinance=deliveryFinance(filtered);
  const profitRateLabel=(value:number|null)=>value===null?"暂无交付":`${value.toFixed(1)}%`;
  function recordLabel(record:ServiceRecord){
    const project=projects.find(item=>item.id===record.projectId),service=serviceFor(record);
    return `${project?.name??"外部提交"}｜${service?.name??record.recordType}`;
  }
  async function remove(record:ServiceRecord){
    if(!window.confirm("确认作废这条服务记录吗？作废后不再计入项目进度和交付金额，但操作记录会长期保留。"))return;
    setDeletingId(record.id);
    const response=await fetch(appPath(`/api/records?id=${record.id}`),{method:"DELETE"});
    if(!response.ok){setDeletingId(null);notify("删除失败，请重试");return}
    await refresh();setDeletingId(null);notify("服务记录已作废，全部统计数据已实时更新");
  }
  return <section className="content-card"><div className="section-title"><div><h2>服务记录</h2><p>金额仅后台可见；仅“已完成”记录计入交付金额</p></div><div className="record-actions"><button className="primary" onClick={onManagerRecord}>＋ 项目经理填写</button><button onClick={onLink}>↗ 生成外部填写链接</button></div></div>
    <div className="entry-guide"><div><span>内部填写</span><strong>项目经理登录后台填写</strong><small>保存后直接更新项目执行进度</small></div><div><span>外部填写</span><strong>咨询师／讲师通过链接填写</strong><small>外部页面不显示金额，提交后进入待审核</small></div></div>
    <div className="live-status"><i/> 数据自动刷新 · 最近同步 {new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
    <div className="delivery-summary">
      <div><small>本周正式交付金额</small><span className="delivery-metric"><strong>{money(weekFinance.amount)}</strong><em className={weekFinance.profitRate!==null&&weekFinance.profitRate<0?"negative-profit":""}>利润率 {profitRateLabel(weekFinance.profitRate)}</em></span></div>
      <div><small>本月正式交付金额</small><span className="delivery-metric"><strong>{money(monthFinance.amount)}</strong><em className={monthFinance.profitRate!==null&&monthFinance.profitRate<0?"negative-profit":""}>利润率 {profitRateLabel(monthFinance.profitRate)}</em></span></div>
      <div><small>当前正式筛选金额</small><span className="delivery-metric"><strong>{money(filteredFinance.amount)}</strong><em className={filteredFinance.profitRate!==null&&filteredFinance.profitRate<0?"negative-profit":""}>利润率 {profitRateLabel(filteredFinance.profitRate)}</em></span></div>
      <div><small>当前已完成记录</small><strong>{filtered.filter(record=>record.status==="已完成").length} 条</strong></div>
    </div>
    <div className="records-filter record-project-filters"><label><span>项目经理</span><select value={managerFilter} onChange={event=>{onManagerFilterChange(event.target.value);setProjectId("all")}}><option value="all">全部项目经理</option>{managers.map(manager=><option value={manager} key={manager}>{manager}</option>)}</select></label><label className="project-search-filter"><span>所属项目</span><ProjectSearchSelect allowAll projects={managerProjects} value={projectId} onChange={setProjectId}/></label></div>
    <div className="records-filter"><span>服务日期</span>{([["week","本周"],["month","本月"],["all","全部"],["custom","自定义"]] as const).map(([value,label])=><button type="button" key={value} className={period===value?"active":""} onClick={()=>setPeriod(value)}>{label}</button>)}{period==="custom"&&<><input type="date" value={start} onChange={e=>setStart(e.target.value)}/><em>至</em><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></>}</div>
    <div className="tabs record-status-tabs"><button className={recordStatus==="all"?"active":""} onClick={()=>setRecordStatus("all")}>全部 {timeFiltered.length}</button><button className={recordStatus==="delivered"?"active":""} onClick={()=>setRecordStatus("delivered")}>已交付 {timeFiltered.filter(record=>record.status==="已完成").length}</button><button className={recordStatus==="pending"?"active":""} onClick={()=>setRecordStatus("pending")}>待审核 {timeFiltered.filter(record=>record.status==="待审核").length}</button></div>
    <div className="records-table"><div className="records-row heading"><span>执行时间</span><span>项目／服务</span><span>服务人员</span><span>完成数量</span><span>交付金额</span><span>成本／利润率</span><span>资料</span><span>状态／时间</span><span>操作</span></div>
      {filtered.length===0?<div className="empty-records"><strong>当前时间范围暂无服务记录</strong><span>可切换本周、本月、全部或自定义日期查看</span></div>:filtered.map(record=>{
        const data=record.payload.data??{},amount=recordAmount(record),service=serviceFor(record);
        return <div className="records-row" key={record.id}><span>{recordDateRange(record)}</span><span>{recordLabel(record)}</span><span>{String(data.provider??"未填写")}</span><span>{Number(data.quantity??1)} {service?.unit??"次"}</span><span className="amount-cell">{amount===null?"审核后冻结":money(amount)}</span><span className="profit-cell">{record.status==="已完成"?(record.costAmountSnapshot===null||record.costAmountSnapshot===undefined?<><strong>待补成本</strong><small>飞书历史数据</small></>:<><strong>{money(record.costAmountSnapshot)}</strong><small className={(record.profitRateBasisPoints??0)<0?"negative-profit":""}>{record.profitRateBasisPoints===null||record.profitRateBasisPoints===undefined?"—":`${(record.profitRateBasisPoints/100).toFixed(1)}%`}</small></>):<small>审核时填写</small>}</span><Attachments recordId={record.id}/><span className="record-time"><Status value={record.status==="已完成"?"已交付":record.status}/><small>{record.status==="已完成"?"审核":"提交/修改"} {recordTimestamp(record)}</small></span><span className="row-actions"><button onClick={()=>onView(record)}>查看</button>{record.status==="待审核"&&<button onClick={()=>onReview(record)}>审核</button>}<button onClick={()=>onEdit(record)}>修改</button><button className="danger-action" disabled={deletingId===record.id} onClick={()=>remove(record)}>{deletingId===record.id?"作废中…":"作废"}</button></span></div>
      })}
    </div>
  </section>;
}

function Consultants({records,projects,onView}:{records:ServiceRecord[];projects:Project[];onView:(record:ServiceRecord)=>void}){
  const approved=records.filter(record=>record.status==="已完成"&&String(record.payload.data?.provider??"").trim());
  const consultants=Array.from(new Set(approved.map(record=>String(record.payload.data?.provider).trim()))).sort((a,b)=>a.localeCompare(b,"zh-CN"));
  const [consultant,setConsultant]=useState("all");
  const [query,setQuery]=useState("");
  const visibleConsultants=consultants.filter(name=>name.toLowerCase().includes(query.trim().toLowerCase()));
  const filtered=approved.filter(record=>consultant==="all"||String(record.payload.data?.provider).trim()===consultant)
    .sort((a,b)=>new Date(recordStartDate(b.payload.data)||b.createdAt).getTime()-new Date(recordStartDate(a.payload.data)||a.createdAt).getTime()||b.id-a.id);
  const totalQuantity=filtered.reduce((sum,record)=>sum+Number(record.payload.data?.quantity??1),0);
  const totalConsultantCost=filtered.reduce((sum,record)=>sum+consultantCost(record)*Number(record.payload.data?.quantity??1),0);
  const totalMaterialCost=filtered.reduce((sum,record)=>sum+materialCost(record)*Number(record.payload.data?.quantity??1),0);
  const servicesFor=(record:ServiceRecord)=>{
    const project=projects.find(item=>item.id===record.projectId);
    return {project,service:project?.services.find(item=>item.id===record.serviceId)};
  };
  const priceGroups=Array.from(filtered.reduce((groups,record)=>{
    const {service}=servicesFor(record);
    const provider=String(record.payload.data?.provider).trim();
    const consultantPrice=consultantCost(record),materialPrice=materialCost(record),price=consultantPrice+materialPrice;
    const key=`${provider}\u0000${service?.name??record.recordType}\u0000${consultantPrice}\u0000${materialPrice}`;
    const current=groups.get(key)??{provider,serviceName:service?.name??record.recordType,unit:service?.unit??"次",consultantPrice,materialPrice,price,quantity:0,count:0,total:0};
    current.quantity+=Number(record.payload.data?.quantity??1);current.count+=1;current.total+=record.costAmountSnapshot??0;
    groups.set(key,current);return groups;
  },new Map<string,{provider:string;serviceName:string;unit:string;consultantPrice:number;materialPrice:number;price:number;quantity:number;count:number;total:number}>()).values())
    .sort((a,b)=>a.provider.localeCompare(b.provider,"zh-CN")||a.serviceName.localeCompare(b.serviceName,"zh-CN")||b.price-a.price);
  return <section className="content-card consultant-page">
    <div className="section-title"><div><h2>咨询师归集</h2><p>仅统计已审核交付记录；咨询师成本与物料成本分别归集展示</p></div></div>
    <div className="consultant-summary">
      <div><small>已归集咨询师</small><strong>{consultant==="all"?consultants.length:filtered.length?1:0} 人</strong></div>
      <div><small>累计服务数量</small><strong>{totalQuantity.toLocaleString("zh-CN")}</strong></div>
      <div><small>累计咨询师成本</small><strong>{money(totalConsultantCost)}</strong></div>
      <div><small>累计物料成本</small><strong>{money(totalMaterialCost)}</strong></div>
    </div>
    <div className="consultant-filter">
      <label><span>搜索咨询师</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="输入姓名模糊搜索"/></label>
      <label><span>咨询师姓名</span><select value={consultant} onChange={event=>setConsultant(event.target.value)}><option value="all">全部咨询师</option>{visibleConsultants.map(name=><option value={name} key={name}>{name}</option>)}</select></label>
      {consultant!=="all"&&<button type="button" onClick={()=>{setConsultant("all");setQuery("")}}>清除筛选</button>}
    </div>
    <div className="consultant-section-title"><div><h3>服务价格汇总</h3><p>同一咨询师的不同服务、不同审核价格分别归集</p></div><span>{priceGroups.length} 个价格项</span></div>
    <div className="consultant-price-table">
      <div className="consultant-price-row heading"><span>咨询师</span><span>服务内容</span><span>咨询师成本</span><span>物料成本</span><span>服务数量</span><span>记录数</span><span>累计总成本</span></div>
      {priceGroups.map(group=><div className="consultant-price-row" key={`${group.provider}-${group.serviceName}-${group.consultantPrice}-${group.materialPrice}`}><strong>{group.provider}</strong><span>{group.serviceName}</span><span className="consultant-price">{money(group.consultantPrice)} / {group.unit}</span><span>{money(group.materialPrice)} / {group.unit}</span><span>{group.quantity} {group.unit}</span><span>{group.count} 条</span><strong>{money(group.total)}</strong></div>)}
      {!priceGroups.length&&<div className="empty-records"><strong>暂无符合条件的已审核记录</strong><span>审核服务记录并填写成本后，将自动归集到这里</span></div>}
    </div>
    <div className="consultant-section-title detail-title"><div><h3>服务明细</h3><p>数据与服务记录同步，按执行时间从近到远排列</p></div><span>{filtered.length} 条</span></div>
    <div className="consultant-detail-table">
      <div className="consultant-detail-row heading"><span>执行时间</span><span>咨询师</span><span>项目／服务</span><span>服务数量</span><span>咨询师成本</span><span>物料成本</span><span>总成本</span><span>审核时间</span><span>操作</span></div>
      {filtered.map(record=>{
        const {project,service}=servicesFor(record),data=record.payload.data??{};
        const quantity=Number(data.quantity??1),start=recordStartDate(data),end=recordEndDate(data);
        return <div className="consultant-detail-row" key={record.id}><span>{start&&end&&start!==end?`${start} 至 ${end}`:start||new Date(record.createdAt).toLocaleDateString("zh-CN")}</span><strong>{String(data.provider).trim()}</strong><span><strong>{project?.name??"已归档项目"}</strong><small>{service?.name??record.recordType}</small></span><span>{quantity} {service?.unit??"次"}</span><span className="consultant-price">{money(consultantCost(record))} / {service?.unit??"次"}</span><span>{money(materialCost(record))} / {service?.unit??"次"}</span><strong>{record.costAmountSnapshot===null||record.costAmountSnapshot===undefined?"—":money(record.costAmountSnapshot)}</strong><span>{new Date(record.approvedAt??record.updatedAt??record.createdAt).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</span><button onClick={()=>onView(record)}>查看</button></div>;
      })}
      {!filtered.length&&<div className="empty-records"><strong>暂无服务明细</strong><span>请更换咨询师筛选条件</span></div>}
    </div>
  </section>;
}

const recordFieldLabels:Record<string,string>={
  provider:"服务人员",date:"服务日期（历史）",startDate:"服务开始日期",endDate:"服务结束日期",quantity:"完成数量",summary:"服务执行情况",
  consultantCostUnit:"咨询师成本单价",materialCostUnit:"物料成本单价",
  method:"咨询方式",duration:"咨询时长（分钟）",issueType:"问题类型",risk:"风险情况",
  topic:"活动主题",participants:"参与人数",location:"活动地点",source:"填写来源"
};
function ViewRecordDialog({record,projects,close}:{record:ServiceRecord;projects:Project[];close:()=>void}){
  const project=projects.find(item=>item.id===record.projectId);
  const service=project?.services.find(item=>item.id===record.serviceId);
  const data=record.payload.data??{};
  const hidden=new Set(["projectId","serviceId","recordType","status","costUnit","consultantCostUnit","materialCostUnit"]);
  const details=Object.entries(data).filter(([key,value])=>!hidden.has(key)&&value!==""&&value!==null&&value!==undefined);
  const timestamp=record.status==="已完成"&&record.approvedAt?record.approvedAt:record.updatedAt||record.createdAt;
  return <div className="review-dialog view-record-dialog">
    <div className="modal-title"><h2>查看服务记录</h2><p>以下为该条记录当前保存的完整填写内容、状态与附件。</p></div>
    <div className="review-head"><div><small>所属项目</small><strong>{project?.name??"项目已归档"}</strong></div><div><small>服务内容</small><strong>{service?.name??record.recordType}</strong></div><div><small>记录类型</small><strong>{record.recordType}</strong></div><Status value={record.status==="已完成"?"已交付":record.status}/></div>
    <section className="review-section"><h3>填写内容</h3><div className="review-details">
      {details.length?details.map(([key,value])=><div className={key==="summary"?"wide":""} key={key}><small>{recordFieldLabels[key]??key}</small><strong>{String(value)}</strong></div>):<div className="wide"><small>填写内容</small><strong>暂无其他填写内容</strong></div>}
    </div></section>
    <section className="review-section"><h3>活动资料与附件</h3><Attachments recordId={record.id} previewImages/></section>
    <section className="review-section record-meta"><h3>记录信息</h3><div className="review-details">
      <div><small>提交时间</small><strong>{new Date(record.createdAt).toLocaleString("zh-CN")}</strong></div>
      <div><small>{record.status==="已完成"?"审核时间":"最近修改时间"}</small><strong>{new Date(timestamp).toLocaleString("zh-CN")}</strong></div>
      <div><small>完成数量</small><strong>{Number(data.quantity??1)} {service?.unit??"次"}</strong></div>
    </div></section>
    <div className="modal-actions"><button type="button" className="primary" onClick={close}>关闭</button></div>
  </div>;
}
function ReviewRecordDialog({record,projects,notify,close,onApproved}:{record:ServiceRecord;projects:Project[];notify:(s:string)=>void;close:()=>void;onApproved:()=>Promise<void>}){
  const [consultantCostUnit,setConsultantCostUnit]=useState("");
  const [materialCostUnit,setMaterialCostUnit]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const project=projects.find(item=>item.id===record.projectId);
  const service=project?.services.find(item=>item.id===record.serviceId);
  const data=record.payload.data??{};
  const hidden=new Set(["projectId","serviceId","recordType","status","costUnit","consultantCostUnit","materialCostUnit"]);
  const details=Object.entries(data).filter(([key,value])=>!hidden.has(key)&&value!==""&&value!==null&&value!==undefined);
  const totalCost=consultantCostUnit!==""&&materialCostUnit!==""?Number(consultantCostUnit)+Number(materialCostUnit):null;
  const profitRate=service&&service.unitPrice>0&&totalCost!==null?(service.unitPrice-totalCost)/service.unitPrice*100:null;
  async function approve(){
    if(consultantCostUnit===""||materialCostUnit==="")return;
    setSubmitting(true);
    const response=await fetch(appPath("/api/records"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:record.id,status:"已完成",data:{consultantCostUnit:Number(consultantCostUnit),materialCostUnit:Number(materialCostUnit)}})});
    const result=await response.json().catch(()=>({})) as {error?:string};
    if(!response.ok){setSubmitting(false);notify(result.error??"审核失败，请重试");return}
    await onApproved();notify("审核通过，交付金额、成本和利润率已冻结");
  }
  return <div className="review-dialog">
    <div className="modal-title"><h2>审核服务记录</h2><p>请先核对外部人员提交的完整内容和附件，再填写本次成本并审核通过。</p></div>
    <div className="review-head"><div><small>所属项目</small><strong>{project?.name??"项目已归档"}</strong></div><div><small>服务内容</small><strong>{service?.name??record.recordType}</strong></div><div><small>记录类型</small><strong>{record.recordType}</strong></div><Status value="待审核"/></div>
    <section className="review-section"><h3>提交内容</h3><div className="review-details">
      {details.map(([key,value])=><div className={key==="summary"?"wide":""} key={key}><small>{recordFieldLabels[key]??key}</small><strong>{String(value)}</strong></div>)}
    </div></section>
    <section className="review-section"><h3>活动资料与附件</h3><Attachments recordId={record.id} previewImages/></section>
    <section className="review-section review-finance"><h3>审核及成本确认</h3><div className="review-finance-grid">
      <div><small>服务单价</small><strong>{money(service?.unitPrice??0)} / {service?.unit??"次"}</strong></div>
      <label>咨询师成本单价（元）<input aria-label="审核咨询师成本单价" type="number" min="0" step="0.01" value={consultantCostUnit} onChange={e=>setConsultantCostUnit(e.target.value)} required placeholder="必填后方可审核"/></label>
      <label>物料成本单价（元）<input aria-label="审核物料成本单价" type="number" min="0" step="0.01" value={materialCostUnit} onChange={e=>setMaterialCostUnit(e.target.value)} required placeholder="无物料成本请填0"/></label>
      <div><small>合计成本单价</small><strong>{totalCost===null?"填写成本后计算":money(totalCost)}</strong></div>
      <div><small>本次交付金额</small><strong>{money((service?.unitPrice??0)*Number(data.quantity??1))}</strong></div>
      <div><small>单条利润率</small><strong className={profitRate!==null&&profitRate<0?"negative-profit":""}>{profitRate===null?"填写成本后计算":`${profitRate.toFixed(1)}%`}</strong></div>
    </div></section>
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button type="button" className="primary" disabled={consultantCostUnit===""||materialCostUnit===""||submitting} onClick={approve}>{submitting?"审核处理中…":"审核通过"}</button></div>
  </div>;
}

function Attachments({recordId,previewImages=false}:{recordId:number;previewImages?:boolean}){
  const [files,setFiles]=useState<Array<{id:number;name:string;contentType?:string;size?:number}>>([]);
  useEffect(()=>{fetch(appPath(`/api/files?recordId=${recordId}`)).then(response=>response.ok?response.json():{files:[]}).then(data=>setFiles(data.files??[])).catch(()=>undefined)},[recordId]);
  if(!files.length)return <span>无附件</span>;
  if(previewImages)return <div className="attachment-gallery">{files.map(file=>{
    const isImage=file.contentType?.startsWith("image/");
    return <a className={isImage?"image-attachment":"file-attachment"} key={file.id} href={appPath(`/api/files?id=${file.id}${isImage?"&inline=1":""}`)} target="_blank" rel="noreferrer">
      {isImage?<>
        <span className="sr-only">{file.name}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={appPath(`/api/files?id=${file.id}&inline=1`)} alt={file.name}/>
      </>:<span className="file-icon">文档</span>}
      <span><strong>{file.name}</strong><small>{isImage?"点击查看大图":"点击打开或下载"}{file.size?` · ${(file.size/1024/1024).toFixed(1)} MB`:""}</small></span>
    </a>;
  })}</div>;
  return <span className="attachment-links">{files.map(file=><a key={file.id} href={appPath(`/api/files?id=${file.id}`)} target="_blank" rel="noreferrer">{file.name}</a>)}</span>;
}

type ExternalLink={id:number;token:string;projectId:number;serviceId:number;formType:string;expiresAt?:string|null;maxSubmissions:number;submissionCount:number;status:string;createdAt:string;lastUsedAt?:string|null};
function ExternalLinks({projects,notify,onAdd}:{projects:Project[];notify:(s:string)=>void;onAdd:()=>void}){
  const [links,setLinks]=useState<ExternalLink[]>([]);
  async function load(){const response=await fetch(appPath("/api/form-links"),{cache:"no-store"});if(response.ok){const data=await response.json();setLinks(data.links??[])}}
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[]);
  async function toggle(link:ExternalLink){
    const next=link.status==="有效"?"已停用":"有效";
    const response=await fetch(appPath("/api/form-links"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:link.id,status:next})});
    if(!response.ok){notify("链接状态修改失败");return}await load();notify(`链接已${next==="有效"?"启用":"停用"}`);
  }
  const label=(link:ExternalLink)=>{const project=projects.find(item=>item.id===link.projectId),service=project?.services.find(item=>item.id===link.serviceId);return `${project?.name??"已归档项目"}｜${service?.name??link.formType}`};
  return <section className="content-card"><div className="section-title"><div><h2>外部填写链接</h2><p>集中查看链接有效期、提交次数和使用状态，可随时停用</p></div><button className="primary" onClick={onAdd}>＋ 生成填写链接</button></div>
    <div className="link-table"><div className="link-row heading"><span>项目／服务</span><span>表单类型</span><span>提交进度</span><span>有效期</span><span>状态</span><span>操作</span></div>
      {links.map(link=><div className="link-row" key={link.id}><strong>{label(link)}</strong><span>{link.formType}</span><span>{link.submissionCount}/{link.maxSubmissions}</span><span>{link.expiresAt?new Date(link.expiresAt).toLocaleDateString("zh-CN"):"永久"}</span><Status value={link.status}/><span><button onClick={async()=>notify(await copyText(`${location.origin}${appPath(`/form/${link.token}`)}`)?"填写链接已复制":"复制失败，请手动选择链接复制")}>复制</button><button onClick={()=>toggle(link)}>{link.status==="有效"?"停用":"启用"}</button></span></div>)}
      {!links.length&&<div className="empty-records"><strong>还没有生成外部填写链接</strong><span>生成后可在这里统一查看和停用</span></div>}
    </div>
  </section>;
}

function EditRecordForm({record,projects,onSave,close}:{record:ServiceRecord;projects:Project[];onSave:(d:FormData)=>void;close:()=>void}) {
  const data=record.payload.data??{};
  const [projectId,setProjectId]=useState(record.projectId||projects[0]?.id||0);
  const [consultantCostUnit,setConsultantCostUnit]=useState(String(data.consultantCostUnit??data.costUnit??record.costUnitSnapshot??""));
  const [materialCostUnit,setMaterialCostUnit]=useState(String(data.materialCostUnit??0));
  const current=projects.find(project=>project.id===projectId);
  const service=current?.services.find(item=>item.id===record.serviceId)??current?.services[0];
  const totalCost=consultantCostUnit!==""&&materialCostUnit!==""?Number(consultantCostUnit)+Number(materialCostUnit):null;
  const profitRate=service&&service.unitPrice>0&&totalCost!==null?(service.unitPrice-totalCost)/service.unitPrice*100:null;
  return <form action={onSave}><div className="modal-title"><h2>修改服务记录</h2><p>可修改内部或外部提交内容，保存后金额与进度同步更新。</p></div>
    <div className="form-grid"><label>所属项目<ProjectSearchSelect name="projectId" projects={projects} value={projectId} onChange={value=>setProjectId(Number(value))}/></label>
      <label>服务内容<select name="serviceId" key={projectId} defaultValue={projectId===record.projectId?record.serviceId:current?.services[0]?.id}>{current?.services.map(service=><option value={service.id} key={service.id}>{service.name}</option>)}</select></label>
      <label>记录类型<select name="recordType" defaultValue={record.recordType}><option>讲座／团辅活动记录</option><option>心理咨询台账</option><option>培训活动记录</option><option>驻场服务记录</option><option>EAP宣传记录</option><option>心理测评记录</option></select></label>
      <label>服务人员<input name="provider" required defaultValue={String(data.provider??"")}/></label>
      <label>服务开始日期<input name="startDate" type="date" required defaultValue={recordStartDate(data)}/></label><label>服务结束日期<input name="endDate" type="date" required defaultValue={recordEndDate(data)}/></label><label>本次完成数量<input name="quantity" type="number" min="1" required defaultValue={Number(data.quantity??1)}/></label>
      <label>咨询师成本单价（元）<input name="consultantCostUnit" type="number" min="0" step="0.01" value={consultantCostUnit} onChange={e=>setConsultantCostUnit(e.target.value)} required={record.status==="已完成"} placeholder={record.status==="待审核"?"可在审核时填写":"必填"}/></label>
      <label>物料成本单价（元）<input name="materialCostUnit" type="number" min="0" step="0.01" value={materialCostUnit} onChange={e=>setMaterialCostUnit(e.target.value)} required={record.status==="已完成"} placeholder="无物料成本请填0"/></label>
      <div className="profit-preview"><small>单条利润率</small><strong className={profitRate!==null&&profitRate<0?"negative-profit":""}>{profitRate===null?"填写成本后计算":`${profitRate.toFixed(1)}%`}</strong></div>
      <label className="full">服务执行情况<textarea name="summary" required defaultValue={String(data.summary??"")}/></label></div>
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary">保存修改</button></div></form>;
}
function ServiceCatalog({items,onChange,onAdd}:{items:ServiceTemplate[];onChange:(items:ServiceTemplate[])=>void;onAdd:()=>void}) {
  return <section className="content-card"><div className="section-title"><div><h2>服务目录</h2><p>统一维护服务名称；项目中的数量、单位和金额仍分别设置</p></div><button className="primary" onClick={onAdd}>＋ 新增服务名称</button></div>
    <div className="catalog-note">服务目录仅定义“提供什么服务”，不设置统一价格。修改名称后，新建项目将使用最新目录。</div>
    <div className="catalog-table"><div className="catalog-row heading"><span>服务名称</span><span>分类</span><span>默认单位</span><span>使用项目数</span><span>状态</span><span>操作</span></div>
      {items.map(item=><div className="catalog-row" key={item.id}><strong>{item.name}</strong><span>{item.category}</span><span>{item.defaultUnit}</span><span>—</span><Status value={item.enabled?"正常":"已停用"}/><span><button onClick={()=>onChange(items.map(x=>x.id===item.id?{...x,enabled:!x.enabled}:x))}>{item.enabled?"停用":"启用"}</button><button className="danger-text" onClick={()=>onChange(items.filter(x=>x.id!==item.id))}>删除</button></span></div>)}
    </div></section>;
}
function CatalogForm({onSave}:{onSave:(item:ServiceTemplate)=>void}) {
  return <form action={(form)=>onSave({id:Date.now(),name:String(form.get("name")),category:String(form.get("category")),defaultUnit:String(form.get("unit")),enabled:true})}><div className="modal-title"><h2>新增服务名称</h2><p>目录不保存价格，不同项目可以使用不同数量和单价。</p></div>
    <div className="form-grid"><label className="full">服务名称<input name="name" required placeholder="如：心理嘉年华"/></label><label>服务分类<select name="category"><option>心理咨询</option><option>活动</option><option>培训</option><option>测评</option><option>宣传</option><option>其他服务</option></select></label>
      <label>默认计量单位<select name="unit"><option>场</option><option>人次</option><option>小时</option><option>天</option><option>期</option><option>份</option></select></label></div>
    <div className="modal-actions"><button type="button">取消</button><button className="primary">保存到服务目录</button></div></form>;
}
type AuditLog={id:number;username:string;action:string;entityType:string;entityId:string;summary:string;createdAt:string};
function Governance(){
  const [logs,setLogs]=useState<AuditLog[]>([]);
  const [start,setStart]=useState(""),[end,setEnd]=useState(""),[username,setUsername]=useState("all");
  async function load(){const response=await fetch(appPath("/api/governance"),{cache:"no-store"});if(response.ok){const data=await response.json();setLogs(data.logs??[])}}
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[]);
  const usernames=Array.from(new Set(logs.map(log=>log.username))).sort((a,b)=>a.localeCompare(b,"zh-CN"));
  const filtered=logs.filter(log=>{
    const time=new Date(`${log.createdAt}Z`);
    return (username==="all"||log.username===username)&&(!start||time>=new Date(`${start}T00:00:00`))&&(!end||time<=new Date(`${end}T23:59:59`));
  });
  return <section className="content-card"><div className="section-title"><div><h2>操作日志</h2><p>记录项目及服务记录的创建、修改、审核和删除操作，便于追溯</p></div></div>
    <div className="audit-filters"><label>开始时间<input type="date" value={start} onChange={event=>setStart(event.target.value)}/></label><label>结束时间<input type="date" value={end} onChange={event=>setEnd(event.target.value)}/></label><label>操作账号<select value={username} onChange={event=>setUsername(event.target.value)}><option value="all">全部账号</option>{usernames.map(item=><option value={item} key={item}>{item}</option>)}</select></label><button type="button" onClick={()=>{setStart("");setEnd("");setUsername("all")}}>重置筛选</button><span>共 {filtered.length} 条记录</span></div>
    <div className="audit-list">{filtered.length?filtered.map(log=><div key={log.id}><span className="audit-action">{log.action}</span><span><strong>{log.summary}</strong><small>{log.entityType} #{log.entityId}</small></span><span>{log.username}</span><time>{new Date(`${log.createdAt}Z`).toLocaleString("zh-CN")}</time></div>):<div className="empty-records"><strong>当前筛选条件下暂无操作记录</strong><span>可以调整操作时间或账号后查看</span></div>}</div>
  </section>;
}
function Accounts({currentUser,notify,onAdd}:{currentUser:CurrentUser;notify:(s:string)=>void;onAdd:()=>void}) {
  const [items,setItems]=useState<Array<{id:number;name:string;username:string;role:string;active:boolean}>>([]);
  async function load(){const response=await fetch(appPath("/api/accounts"));if(response.ok){const data=await response.json();setItems(data.accounts??[])}}
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[]);
  async function toggle(item:{id:number;active:boolean}){await fetch(appPath("/api/accounts"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,active:!item.active})});await load()}
  async function resetPassword(item:{id:number;name:string}){
    const password=window.prompt(`请为“${item.name}”设置新的临时密码（至少6位）：`);
    if(password===null)return;
    if(password.length<6){notify("临时密码至少6位");return}
    if(!window.confirm(`确认重置“${item.name}”的密码吗？该账号下次登录时必须修改密码。`))return;
    const response=await fetch(appPath("/api/accounts"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,newPassword:password})});
    const data=await response.json();notify(response.ok?"密码已重置，请将临时密码单独告知该用户":data.error??"密码重置失败");
  }
  return <section className="content-card"><div className="section-title"><div><h2>账号设置</h2><p>当前仅管理员、项目经理两种可创建身份，均拥有完整查看和编辑权限</p></div><button className="primary" onClick={onAdd}>＋ 创建账号</button></div>
    <div className="account-list">{items.map(a=><div key={a.id}><span className="avatar">{a.name[0]}</span><span><strong>{a.name}</strong><small>@{a.username}</small></span><span>{a.role}</span><Status value={a.active?"正常":"已停用"}/><span className="account-actions">{currentUser.username==="ydleapadmin"&&a.username!=="ydleapadmin"&&<button onClick={()=>resetPassword(a)}>重置密码</button>}{a.username!=="ydleapadmin"&&<button onClick={()=>toggle(a)}>{a.active?"停用":"启用"}</button>}</span></div>)}</div>
  </section>;
}
function AccountForm({notify,close}:{notify:(s:string)=>void;close:()=>void}) {
  async function save(form:FormData){const response=await fetch(appPath("/api/accounts"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:String(form.get("name")),username:String(form.get("username")),role:String(form.get("role")),password:String(form.get("password"))})});if(!response.ok){notify("账号创建失败，请检查账号是否重复");return}notify("账号创建成功，首次登录需修改密码");close();window.location.reload()}
  return <form action={save}><div className="modal-title"><h2>创建系统账号</h2><p>当前账号均拥有完整权限；角色用于后续版本权限升级。</p></div>
    <div className="form-grid"><label>姓名<input name="name" required/></label><label>登录账号<input name="username" required/></label>
      <label>身份角色<select name="role"><option>项目经理</option><option>管理员</option></select></label><label>初始密码<input name="password" type="password" minLength={6} required/></label></div>
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary">创建账号</button></div>
  </form>;
}
function SecurityNotice({user,onConfirm}:{user:CurrentUser;onConfirm:()=>void}){
  return <div className="security-notice"><div className="security-shield">✓</div><div className="modal-title"><h2>请先完成账号安全设置</h2><p>检测到您正在使用初始密码登录。为确保账号及项目数据安全，请立即设置仅您本人知晓的新密码。</p></div>
    <div className="security-user"><span className="avatar">{user.name.slice(0,1)}</span><div><small>当前登录账号</small><strong>{user.username}</strong><em>{user.name} · {user.role}</em></div></div>
    <div className="security-tips"><span>新密码至少 8 位</span><span>建议同时包含字母和数字</span><span>请勿与他人共享登录密码</span></div>
    <div className="modal-actions"><button className="primary" type="button" onClick={onConfirm}>确认并修改密码</button></div>
  </div>;
}
function ProfileForm({user,forced,notify,close}:{user:CurrentUser;forced:boolean;notify:(s:string)=>void;close:()=>void}) {
  async function save(form:FormData){const next=String(form.get("newPassword")),confirm=String(form.get("confirmPassword"));if(next!==confirm){notify("两次输入的新密码不一致");return}const response=await fetch(appPath("/api/auth/password"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({oldPassword:String(form.get("oldPassword")),newPassword:next})});const data=await response.json();if(!response.ok){notify(data.error??"密码修改失败");return}notify("密码修改成功，请重新登录");await fetch(appPath("/api/auth/logout"),{method:"POST"});window.location.href=appPath("/login")}
  return <form action={save}><div className="modal-title"><h2>{forced?"首次登录，请修改密码":"个人中心"}</h2><p>{forced?"为保障账号安全，修改临时密码后才能继续使用。":"查看账号信息或修改登录密码。"}</p></div>
    <div className="form-grid"><label>姓名<input disabled value={user.name}/></label><label>登录账号<input disabled value={user.username}/></label><label>当前身份<input disabled value={user.role}/></label><label>原密码<input name="oldPassword" type="password" required/></label><label>新密码<input name="newPassword" type="password" minLength={8} required/></label><label>确认新密码<input name="confirmPassword" type="password" minLength={8} required/></label></div>
    <div className="modal-actions">{!forced&&<button type="button" onClick={close}>取消</button>}<button type="button" onClick={async()=>{await fetch(appPath("/api/auth/logout"),{method:"POST"});window.location.href=appPath("/login")}}>退出登录</button><button className="primary">保存新密码</button></div></form>;
}
