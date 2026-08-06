"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { appPath } from "../base-path";
import { recordTypeForServiceName } from "../service-record-types";

type Service = {
  id: number;
  name: string;
  contractDetail?: string;
  unit: string;
  quantity: number;
  completed: number;
  unitPrice: number;
  costPrice?: number;
  billingMode?: "delivery"|"annual-time";
};

type Project = {
  id: number;
  name: string;
  manager: string;
  managerIds?: number[];
  status: "执行中" | "待启动" | "待结项" | "已结项" | "已完成";
  risk: "正常" | "预警" | "风险";
  start: string;
  end: string;
  total: number;
  contract: string;
  financialContractNo?: string;
  services: Service[];
  priority?:"P0"|"P1"|"P2";
  tags?:string[];
  presalesContributorIds?:number[];
  presalesWork?:string;
  _version?: number;
  _archivedAt?: string|null;
  _closedAt?: string|null;
  _closedBy?: string|null;
  _taxRateBasisPoints?:number|null;
  _taxAmount?:number|null;
  _finalRevenue?:number|null;
  _finalCost?:number|null;
  _finalProfit?:number|null;
  _isDemo?: boolean;
};

type ServiceTemplate = {id:number;name:string;defaultUnit:string;category:string;enabled:boolean};
type ProjectTag={id:number;name:string;enabled:boolean};
type ServiceRecord = {
  id:number;projectId:number;serviceId:number;recordType:string;status:string;createdAt:string;updatedAt?:string;approvedAt?:string|null;
  unitPriceSnapshot?:number|null;amountSnapshot?:number|null;
  costUnitSnapshot?:number|null;costAmountSnapshot?:number|null;profitRateBasisPoints?:number|null;
  paymentStatus?:string;paidAt?:string|null;paidBy?:string|null;
  payload:{data?:Record<string,unknown>;uploaded?:string[];type?:string};
};
type DeliveryTask={
  id:number;projectId:number;serviceId:number;title:string;description:string;plannedQuantity:number;
  plannedDate?:string|null;owner?:string|null;status:string;createdAt:string;updatedAt:string;
  recordIds:number[];records?:ServiceRecord[];
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
  ["tasks", "☑", "任务管理"],
  ["records", "▤", "服务记录"],
  ["consultants", "♧", "咨询师归集"],
  ["links", "↗", "填写链接"],
  ["governance", "◫", "操作日志"],
  ["catalog", "☷", "服务目录"],
  ["files", "▤", "项目资料库"],
  ["accounts", "♙", "账号管理"],
] as const;

function projectProgress(project: Project) {
  const total = project.services.reduce((sum, item) => sum + item.quantity, 0);
  const completed = project.services.reduce((sum, item) => sum + (item.billingMode==="annual-time"?item.quantity*timeProgress(project)/100:item.completed), 0);
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
  return project.services.length>0?project.services.every(service=>service.billingMode==="annual-time"?timeProgress(project)>=100:service.quantity>0&&service.completed>=service.quantity):project.status==="已完成";
}
function withAutomaticStatus(project:Project):Project{
  if(project._closedAt||project.status==="已结项")return {...project,status:"已结项"};
  if(isProjectFinished(project))return {...project,status:"待结项"};
  return ["已完成","待结项"].includes(project.status)?{...project,status:"执行中"}:project;
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
const isAcceptedRecord=(record:ServiceRecord)=>["已验收","已完成"].includes(record.status);

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
  const [modal, setModal] = useState<"project" | "service" | "link" | "managerRecord" | "taskRecordMethod" | "viewRecord" | "reviewRecord" | "acceptRecord" | "editRecord" | "closeProject" | "account" | "profile" | "securityNotice" | "catalog" | null>(currentUser.mustChangePassword?"securityNotice":null);
  const [catalog,setCatalog]=useState<ServiceTemplate[]>(defaultCatalog);
  const [tagLibrary,setTagLibrary]=useState<ProjectTag[]>([]);
  const [projectManagerAccounts,setProjectManagerAccounts]=useState<ProjectManagerAccount[]>([]);
  const [records,setRecords]=useState<ServiceRecord[]>([]);
  const [editingRecord,setEditingRecord]=useState<ServiceRecord|null>(null);
  const [viewingRecord,setViewingRecord]=useState<ServiceRecord|null>(null);
  const [reviewingRecord,setReviewingRecord]=useState<ServiceRecord|null>(null);
  const [taskRecordTarget,setTaskRecordTarget]=useState<DeliveryTask|null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [query, setQuery] = useState("");
  const [managerFilter,setManagerFilter]=useState("all");
  const isAdmin=currentUser.role.includes("管理员")||currentUser.username==="ydleapadmin";
  const [dashboardManagerId,setDashboardManagerId]=useState<number|"all">(isAdmin?"all":currentUser.id);
  const [projectView,setProjectView]=useState<"all"|"active"|"finished"|"archived">("all");
  const [toast, setToast] = useState("");
  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const frozenAmountProgress=(project:Project)=>{
    const total=project.services.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0);
    return total?Math.round(projectFinance(project).revenue/total*100):0;
  };
  const projectFinance=(project:Project)=>{
    const approved=records.filter(record=>record.projectId===project.id&&isAcceptedRecord(record));
    const annualServiceIds=new Set(project.services.filter(service=>service.billingMode==="annual-time").map(service=>service.id));
    const deliveryRevenue=approved.filter(record=>!annualServiceIds.has(record.serviceId)).reduce((sum,record)=>sum+(record.amountSnapshot??0),0);
    const annualRevenue=project.services.filter(service=>service.billingMode==="annual-time").reduce((sum,service)=>sum+Math.round(service.quantity*service.unitPrice*timeProgress(project)/100),0);
    const revenue=deliveryRevenue+annualRevenue;
    const cost=approved.reduce((sum,record)=>sum+(record.costAmountSnapshot??0),0);
    const missingCost=approved.some(record=>record.costAmountSnapshot===null||record.costAmountSnapshot===undefined);
    return {revenue,cost,missingCost,profitRate:revenue>0&&!missingCost?(revenue-cost)/revenue*100:null};
  };
  const productionProjects=projects.filter(project=>!project._isDemo&&!project._archivedAt);
  const dashboardManager=dashboardManagerId==="all"?null:projectManagerAccounts.find(account=>account.id===dashboardManagerId)??(dashboardManagerId===currentUser.id?currentUser:null);
  const dashboardProjects=dashboardManagerId==="all"
    ? productionProjects
    : productionProjects.filter(project=>project.managerIds?.includes(dashboardManagerId)||(!project.managerIds?.length&&Boolean(dashboardManager)&&projectHasManager(project,dashboardManager!.name)));
  const dashboardAverage=dashboardProjects.length?Math.round(dashboardProjects.reduce((sum,project)=>sum+projectProgress(project),0)/dashboardProjects.length):0;
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
  useEffect(()=>{fetch(appPath("/api/project-tags")).then(r=>r.ok?r.json():Promise.reject()).then((data:{tags?:ProjectTag[]})=>setTagLibrary(data.tags??[])).catch(()=>undefined)},[]);

  useEffect(()=>{
    fetch(appPath("/api/accounts"),{cache:"no-store"})
      .then(response=>response.ok?response.json():Promise.reject())
      .then((data:{accounts?:ProjectManagerAccount[]})=>setProjectManagerAccounts((data.accounts??[]).filter(account=>account.active)))
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
  async function addProjectTag(name:string){
    const response=await fetch(appPath("/api/project-tags"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});
    const data=await response.json() as {tag?:ProjectTag;error?:string};if(!response.ok||!data.tag){notify(data.error??"标签创建失败");return}setTagLibrary(items=>[...items,data.tag!]);notify("项目标签已添加");
  }
  async function toggleProjectTag(tag:ProjectTag){
    const response=await fetch(appPath("/api/project-tags"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:tag.id,enabled:!tag.enabled})});if(!response.ok){notify("标签状态更新失败");return}setTagLibrary(items=>items.map(item=>item.id===tag.id?{...item,enabled:!item.enabled}:item));
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function dismissModal(){
    setModal(null);
    if(["taskRecordMethod","managerRecord","link"].includes(String(modal)))setTaskRecordTarget(null);
  }

  function openProject(project?: Project) {
    setEditing(project ? structuredClone(project) : null);
    setModal("project");
  }

  async function restoreProject(id:number){
    const response=await fetch(appPath("/api/projects"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"restore",id})});
    if(!response.ok){notify("项目恢复失败，请重试");return}
    await refreshProjects();notify("项目已恢复到项目清单");
  }
  async function archiveProject(project:Project){
    if(!window.confirm(`确认归档项目“${project.name}”吗？归档后可恢复，服务记录不会删除。`))return;
    const response=await fetch(appPath(`/api/projects?id=${project.id}`),{method:"DELETE"});if(!response.ok){notify("项目归档失败");return}await refreshProjects();notify("项目已安全归档，可在已归档列表恢复");
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
      financialContractNo: String(form.get("financialContractNo")??"").trim(),
      total: submittedServices.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
      start: String(form.get("start")),
      end: String(form.get("end")),
      status: String(form.get("status")) as Project["status"],
      priority: String(form.get("priority")||"P1") as Project["priority"],
      tags: form.getAll("tags").map(String),
      presalesContributorIds: form.getAll("presalesContributorIds").map(Number).filter(Number.isSafeInteger),
      presalesWork: String(form.get("presalesWork")??"").trim(),
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
      billingMode: String(form.get("billingMode")||"delivery") as Service["billingMode"],
    };
    updateProject(selected.id,p=>({ ...p, services: [...p.services, service] }),true);
    setModal(null);
    notify("服务内容已添加");
  }

  async function saveManagerRecord(form:FormData){
    const value=(name:string)=>String(form.get(name)??"");
    const projectId=Number(form.get("projectId"));
    const serviceId=Number(form.get("serviceId"));
    const quantity=Number(form.get("quantity"))||1;
    const uploaded:string[]=[];
    for(const file of form.getAll("files")){
      if(file instanceof File&&file.size>0){const upload=new FormData();upload.append("file",file);const response=await fetch(appPath("/api/upload"),{method:"POST",body:upload});if(response.ok){const data=await response.json();uploaded.push(data.key)}}
    }
    const payload={source:"项目经理填写",projectId,serviceId,recordType:value("recordType"),provider:value("provider"),startDate:value("startDate"),endDate:value("endDate"),quantity,consultantCostUnit:value("consultantCostUnit")===""?undefined:Number(form.get("consultantCostUnit")),materialCostUnit:value("materialCostUnit")===""?undefined:Number(form.get("materialCostUnit")),summary:value("summary"),method:value("method"),duration:value("duration")===""?undefined:Number(form.get("duration")),risk:value("risk"),topic:value("topic"),participants:value("participants")===""?undefined:Number(form.get("participants")),location:value("location"),status:"待验收"};
    const response=await fetch(appPath("/api/records"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:payload.recordType,data:payload,uploaded})}).catch(()=>null);
    if(!response?.ok){const data=await response?.json().catch(()=>({})) as {error?:string}|undefined;notify(data?.error??"服务记录保存失败，项目进度未变更");return}
    const result=await response.json() as {record?:ServiceRecord};
    const targetTask=taskRecordTarget;
    if(targetTask&&result.record){
      const attached=await attachRecordToTask(targetTask,result.record.id);
      if(!attached){
        setModal(null);setTaskRecordTarget(null);
        await Promise.all([refreshRecords(),refreshProjects()]);
        notify("服务记录已保存，但关联任务失败，请在任务编辑中手动关联");return
      }
    }
    setModal(null);
    setTaskRecordTarget(null);
    await Promise.all([refreshRecords(),refreshProjects()]);
    notify(targetTask?"服务记录已保存并关联任务，待验收后自动完成":"服务记录已保存，待验收后更新项目进度");
  }

  async function attachRecordToTask(task:DeliveryTask,recordId:number){
    const response=await fetch(appPath("/api/tasks"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({
      ...task,recordIds:Array.from(new Set([...task.recordIds,recordId]))
    })});
    return response.ok;
  }

  async function saveEditedRecord(form:FormData){
    if(!editingRecord)return;
    const projectId=Number(form.get("projectId")),serviceId=Number(form.get("serviceId")),quantity=Number(form.get("quantity"))||1;
    const oldQuantity=Number(editingRecord.payload.data?.quantity??1),wasCompleted=isAcceptedRecord(editingRecord);
    const consultantCostValue=form.get("consultantCostUnit"),materialCostValue=form.get("materialCostUnit");
    const optionalNumber=(name:string)=>{const raw=form.get(name);return raw===null||String(raw)===""?undefined:Number(raw)};
    const value=(name:string)=>String(form.get(name)??"");
    const data={...editingRecord.payload.data,projectId,serviceId,recordType:value("recordType"),provider:value("provider"),startDate:value("startDate"),endDate:value("endDate"),quantity,...(consultantCostValue!==null&&String(consultantCostValue)!==""?{consultantCostUnit:Number(consultantCostValue)}:{}),...(materialCostValue!==null&&String(materialCostValue)!==""?{materialCostUnit:Number(materialCostValue)}:{}),satisfaction:optionalNumber("satisfaction"),summary:value("summary"),method:value("method"),duration:optionalNumber("duration"),risk:value("risk"),topic:value("topic"),participants:optionalNumber("participants"),location:value("location")};
    const response=await fetch(appPath("/api/records"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:editingRecord.id,type:String(form.get("recordType")),data})});
    if(!response.ok){notify("记录修改失败，请重试");return}
    void oldQuantity;void wasCompleted;
    setModal(null);setEditingRecord(null);await Promise.all([refreshRecords(),refreshProjects()]);notify("服务记录已修改，金额与相关状态已同步更新");
  }

  function acceptRecord(record:ServiceRecord){
    setReviewingRecord(record);setModal("acceptRecord");
  }

  async function completeAcceptance(form:FormData){
    if(!reviewingRecord)return;
    const numberOrUndefined=(name:string)=>{const raw=form.get(name);return raw===null||String(raw)===""?undefined:Number(raw)};
    const value=(name:string)=>String(form.get(name)??"");
    const data={...reviewingRecord.payload.data,provider:value("provider"),startDate:value("startDate"),endDate:value("endDate"),quantity:Number(form.get("quantity"))||1,consultantCostUnit:numberOrUndefined("consultantCostUnit"),materialCostUnit:numberOrUndefined("materialCostUnit"),satisfaction:numberOrUndefined("satisfaction"),summary:value("summary"),method:value("method"),duration:numberOrUndefined("duration"),risk:value("risk"),topic:value("topic"),participants:numberOrUndefined("participants"),location:value("location")};
    const response=await fetch(appPath("/api/records"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:reviewingRecord.id,status:"已验收",type:String(form.get("recordType")),data})});
    const result=await response.json().catch(()=>({})) as {error?:string};
    if(!response.ok){notify(result.error??"请补齐所有必填信息后再验收");return}
    setModal(null);setReviewingRecord(null);
    await Promise.all([refreshRecords(),refreshProjects()]);notify("服务记录已验收，关联任务状态已自动更新");
  }

  async function togglePayment(record:ServiceRecord){
    const next=record.paymentStatus==="已支付"?"待支付":"已支付";
    if(!window.confirm(next==="已支付"?"确认该条服务成本已经支付吗？":"确认撤销该条成本的已支付标记吗？"))return;
    const response=await fetch(appPath("/api/records"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:record.id,action:"payment",paymentStatus:next})});
    const data=await response.json().catch(()=>({})) as {error?:string};
    if(!response.ok){notify(data.error??"支付状态更新失败");return}
    await refreshRecords();notify(next==="已支付"?"成本已标记为已支付":"已恢复为待支付");
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
            {isAdmin&&<section className="dashboard-scope"><div><strong>看板范围</strong><small>默认查看全局，也可切换到某位项目经理</small></div><select aria-label="看板项目经理范围" value={dashboardManagerId} onChange={event=>setDashboardManagerId(event.target.value==="all"?"all":Number(event.target.value))}><option value="all">全局所有项目</option>{projectManagerAccounts.map(manager=><option value={manager.id} key={manager.id}>{manager.name}的项目</option>)}</select></section>}
            <section className="kpi-grid">
              <Kpi icon="▣" tone="blue" label={dashboardManagerId==="all"?"全部项目":"个人项目"} value={dashboardProjects.length} note={dashboardManagerId==="all"?"全局正式项目":`仅统计${dashboardManager?.name??"当前人"}作为项目经理的项目`} />
              <Kpi icon="▷" tone="green" label="执行中" value={dashboardProjects.filter((p) => p.status === "执行中"&&!isProjectFinished(p)).length} note={`平均完成率 ${dashboardAverage}%`} />
              <Kpi icon="✓" tone="blue" label="已结束" value={dashboardProjects.filter(isProjectFinished).length} note="交付明细长期保留" />
              <Kpi icon="□" tone="amber" label="待启动" value={dashboardProjects.filter(project=>project.status==="待启动").length} note="尚未开始执行" />
            </section>
            <section className="dashboard-grid">
              <Panel title="项目进度概览" action="查看全部" onAction={() => setPage("projects")} wide>
                <div className="table project-overview">
                  <div className="tr th"><span>项目名称</span><span>项目经理</span><span>时间进度</span><span>服务进度</span><span>状态</span></div>
                  {[...dashboardProjects].sort((a,b)=>(a.priority??"P1").localeCompare(b.priority??"P1")).slice(0,8).map((p) => <button className="tr" key={p.id} onClick={() => setSelectedId(p.id)}>
                    <span className="project-name">{p.name}{p._isDemo&&<small className="demo-tag">示例</small>}</span><span>{p.manager}</span>
                    <Progress value={timeProgress(p)} />
                    <Progress value={projectProgress(p)} green />
                    <Status value={p._closedAt?"已结项":isProjectFinished(p)?"待结项":p.status} />
                  </button>)}
                </div>
              </Panel>
              <Panel title="最新服务记录" action="查看全部" onAction={() => setPage("records")} wide>
                <div className="recent-list">
                  {records.filter(record=>dashboardProjects.some(project=>project.id===record.projectId)).slice(0,4).map(record=>{const project=projects.find(item=>item.id===record.projectId),service=project?.services.find(item=>item.id===record.serviceId),provider=String(record.payload.data?.provider??"").trim()||(record.status==="待填写"?"等待咨询师填写":"未填写");return <div key={record.id}><span><strong>{service?.name??record.recordType}｜{provider}</strong><small>{String(record.payload.data?.date??record.createdAt.slice(0,10))} · {project?.name??"对应项目"}</small></span><Status value={isAcceptedRecord(record)?"已验收":record.status}/></div>})}
                  {!records.some(record=>dashboardProjects.some(project=>project.id===record.projectId))&&<div><span><strong>暂无服务记录</strong><small>完成内部填写或外部提交后将在这里显示</small></span></div>}
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
                <div className="card-head"><Status value={p._closedAt?"已结项":isProjectFinished(p)?"待结项":p.status}/>{!p._archivedAt&&<button onClick={(e)=>{e.stopPropagation(); openProject(p)}}>•••</button>}</div>
                <h3><Status value={p.priority??"P1"}/> {p.name} {p._isDemo&&<small className="demo-tag">示例数据</small>}</h3><p>{p.contract}{p.financialContractNo?` · 财务合同编号：${p.financialContractNo}`:""} · 项目经理：{p.manager}</p>{Boolean(p.tags?.length)&&<div className="project-tag-list">{p.tags!.map(tag=><small key={tag}>{tag}</small>)}</div>}
                <div className="big-progress"><span><b>服务进度</b><strong>{projectProgress(p)}%</strong></span><Progress value={projectProgress(p)} green/></div>
                <div className="card-stats"><span>项目总价<strong>{money(p.total)}</strong></span><span>服务项<strong>{p.services.length}</strong></span><span>{p._closedAt?"项目状态":isProjectFinished(p)?"结项状态":"剩余天数"}<strong>{p._closedAt?"已结项":isProjectFinished(p)?"待结项":p.status==="待启动"?"未开始":`${remainingDays(p)}天`}</strong></span></div>
                <div className="card-foot"><span>{p.start} — {p.end}</span><span>{p._archivedAt?(p._closedAt?<span>已结项归档</span>:<button onClick={(e)=>{e.stopPropagation();restoreProject(p.id)}}>恢复项目</button>):<><button onClick={(e)=>{e.stopPropagation();openProject(p)}}>编辑</button><button className="danger-text" onClick={(e)=>{e.stopPropagation();void archiveProject(p)}}>归档</button>{isProjectFinished(p)&&<button className="primary" onClick={(e)=>{e.stopPropagation();setSelectedId(p.id);setModal("closeProject")}}>结项</button>}</>}</span></div>
              </article>)}
              {visibleProjects.length===0&&<div className="empty-records project-empty"><strong>{projectView==="finished"?"暂无已结束项目":"当前条件下暂无项目"}</strong><span>{projectView==="finished"?"所有服务任务完成后，项目会自动归集到这里，交付明细仍可随时查看。":"可以调整筛选条件或新建项目。"}</span></div>}
            </div>
          </section>
        )}

        {selected && (
          <section className="detail-layout">
            <button className="back" onClick={()=>setSelectedId(null)}>← 返回项目列表</button>
            {selected._archivedAt&&<div className="catalog-note">{selected._closedAt?`该项目已于 ${new Date(selected._closedAt).toLocaleDateString("zh-CN")} 结项归档。税费 ${money(selected._taxAmount??0)}，最终利润 ${money(selected._finalProfit??0)}。`:"该项目已归档，目前仅供查看。如需继续交付，请先在“已归档”清单中恢复项目。"}</div>}
            <div className="detail-summary">
              <div><small>项目总价</small><strong>{money(selected.total)}</strong></div>
              <div><small>服务执行进度</small><strong>{projectProgress(selected)}%</strong></div>
              <div><small>项目总利润率</small><strong className="profit-number">{projectFinance(selected).missingCost?"待补历史成本":projectFinance(selected).profitRate===null?"待产生交付":`${projectFinance(selected).profitRate!.toFixed(1)}%`}</strong></div>
              <div><small>服务项数</small><strong>{selected.services.length} 项</strong></div>
            </div>
            <div className="project-meta"><span><small>优先级</small><Status value={selected.priority??"P1"}/></span><span><small>项目经理</small><strong>{selected.manager}</strong></span><span><small>项目标签</small><strong>{selected.tags?.join("、")||"未设置"}</strong></span><span><small>财务合同编号</small><strong>{selected.financialContractNo||"待补录"}</strong></span><span><small>售前参与人</small><strong>{selected.presalesContributorIds?.map(id=>projectManagerAccounts.find(account=>account.id===id)?.name).filter(Boolean).join("、")||"未设置"}</strong></span>{selected.presalesWork&&<span className="wide"><small>售前工作内容</small><strong>{selected.presalesWork}</strong></span>}</div>
            <div className="progress-explain">
              <div><span>数量进度</span><strong>{projectProgress(selected)}%</strong><small>已执行数量 ÷ 合同约定数量</small></div>
              <div><span>金额进度</span><strong>{frozenAmountProgress(selected)}%</strong><small>交付 {money(projectFinance(selected).revenue)} · {projectFinance(selected).missingCost?"部分历史成本待补":`成本 ${money(projectFinance(selected).cost)}`}</small></div>
              <div><span>时间进度</span><strong>{timeProgress(selected)}%</strong><small>已过项目天数 ÷ 项目总天数</small></div>
              <div><span>剩余服务数量</span><strong>{selected.services.filter(service=>service.billingMode!=="annual-time").reduce((sum,service)=>sum+Math.max(0,service.quantity-service.completed),0)}</strong><small>仅统计按交付验收的服务数量</small></div>
            </div>
            <div className="section-title"><div><h2>项目服务内容</h2><p>不同客户的服务数量、单位和单价均可独立配置</p></div>{!selected._archivedAt&&<span className="section-actions"><button onClick={()=>setModal("service")}>＋ 添加服务</button>{isProjectFinished(selected)&&<button className="primary" onClick={()=>setModal("closeProject")}>项目结项</button>}</span>}</div>
            <div className="service-table">
              <div className="service-row heading"><span>服务内容</span><span>计量方式</span><span>单价</span><span>合同金额</span><span>执行进度</span><span>操作</span></div>
              {selected.services.map((s)=><div className="service-row" key={s.id}>
                <span><strong>{s.name}</strong><small>{s.contractDetail||"未填写合同详情说明"} · {s.billingMode==="annual-time"?"年包按时间确认收入":"按交付验收"}</small></span><span>{s.billingMode==="annual-time"?`时间 ${timeProgress(selected)}%`:`${s.completed}/${s.quantity} ${s.unit}`}</span><span>{money(s.unitPrice)}/{s.unit}</span><span>{money(s.unitPrice*s.quantity)}</span>
                <span><Progress value={s.billingMode==="annual-time"?timeProgress(selected):Math.round(s.completed/s.quantity*100)} green/></span>
                <span>{!selected._archivedAt&&<button onClick={()=>setModal("link")}>生成填写链接</button>}</span>
              </div>)}
            </div>
          </section>
        )}

        {page === "records" && !selected && <Records records={records} projects={projects.filter(project=>!project._archivedAt)} managerFilter={managerFilter} onManagerFilterChange={setManagerFilter} refresh={async()=>{await Promise.all([refreshRecords(),refreshProjects()])}} notify={notify} onManagerRecord={()=>setModal("managerRecord")} onLink={()=>setModal("link")} onView={(record)=>{setViewingRecord(record);setModal("viewRecord")}} onReview={(record)=>{setReviewingRecord(record);setModal("reviewRecord")}} onAccept={acceptRecord} onPayment={togglePayment} onEdit={(record)=>{setEditingRecord(record);setModal("editRecord")}}/>}
        {page === "tasks" && !selected && <TaskManagement projects={projects.filter(project=>!project._archivedAt)} records={records} currentUser={currentUser} managers={projectManagerAccounts} notify={notify} onAddRecord={task=>{setTaskRecordTarget(task);setModal("taskRecordMethod")}} onReview={record=>{setReviewingRecord(record);setModal("reviewRecord")}} onAccept={acceptRecord} onView={record=>{setViewingRecord(record);setModal("viewRecord")}}/>}
        {page === "consultants" && !selected && <Consultants records={records} projects={projects} onView={(record)=>{setViewingRecord(record);setModal("viewRecord")}}/>}
        {page === "links" && !selected && <ExternalLinks projects={projects} notify={notify} onAdd={()=>setModal("link")}/>}
        {page === "governance" && !selected && <Governance/>}
        {page === "catalog" && !selected && <ServiceCatalog items={catalog} tags={tagLibrary} canManageTags={isAdmin} onChange={saveCatalog} onAdd={()=>setModal("catalog")} onAddTag={addProjectTag} onToggleTag={toggleProjectTag}/>}
        {page === "files" && !selected && <ProjectFileLibrary projects={projects}/>}
        {page === "accounts" && !selected && <Accounts currentUser={currentUser} notify={notify} onAdd={()=>setModal("account")}/>}
      </main>

      {modal && <div className="modal-backdrop" onMouseDown={()=>{if(!currentUser.mustChangePassword)dismissModal()}}>
        <div className="modal" onMouseDown={(e)=>e.stopPropagation()}>
          {!currentUser.mustChangePassword&&<button className="close" onClick={dismissModal}>×</button>}
          {modal === "project" && <ProjectForm editing={editing} catalog={catalog} tagLibrary={tagLibrary} projectManagers={projectManagerAccounts} currentUser={currentUser} onSave={saveProject}/>}
          {modal === "service" && <ServiceForm catalog={catalog} onSave={saveService}/>}
          {modal === "link" && <LinkDialog
            projects={projects.filter(project=>!project._archivedAt)}
            selectedProjectId={taskRecordTarget?.projectId??selected?.id}
            lockProject={Boolean(taskRecordTarget)}
            notify={notify}
            onGenerated={taskRecordTarget?async record=>{const attached=await attachRecordToTask(taskRecordTarget,record.id);await refreshRecords();notify(attached?"外部填写记录已创建并关联任务":"填写链接已生成，但关联任务失败，请在任务编辑中手动关联")}:undefined}
            close={dismissModal}
          />}
          {modal === "managerRecord" && <ManagerRecordForm projects={projects.filter(project=>!project._archivedAt)} defaultProjectId={taskRecordTarget?.projectId} defaultServiceId={taskRecordTarget?.serviceId||undefined} lockProject={Boolean(taskRecordTarget)} onSave={saveManagerRecord} close={()=>{setModal(null);setTaskRecordTarget(null)}}/>}
          {modal === "taskRecordMethod" && taskRecordTarget && <TaskRecordMethodDialog
            task={taskRecordTarget}
            project={projects.find(project=>project.id===taskRecordTarget.projectId)}
            onManager={()=>setModal("managerRecord")}
            onExternal={()=>setModal("link")}
            close={dismissModal}
          />}
          {modal === "viewRecord" && viewingRecord && <ViewRecordDialog record={viewingRecord} projects={projects} close={()=>{setModal(null);setViewingRecord(null)}}/>}
          {modal === "reviewRecord" && reviewingRecord && <ReviewRecordDialog record={reviewingRecord} projects={projects} notify={notify} close={()=>{setModal(null);setReviewingRecord(null)}} onApproved={async()=>{setModal(null);setReviewingRecord(null);await Promise.all([refreshRecords(),refreshProjects()])}}/>}
          {modal === "acceptRecord" && reviewingRecord && <AcceptanceRecordForm record={reviewingRecord} projects={projects} onSave={completeAcceptance} close={()=>{setModal(null);setReviewingRecord(null)}}/>}
          {modal === "editRecord" && editingRecord && <EditRecordForm record={editingRecord} projects={projects.filter(project=>!project._archivedAt)} onSave={saveEditedRecord} close={()=>{setModal(null);setEditingRecord(null)}}/>}
          {modal === "closeProject" && selected && <ProjectClosureDialog project={selected} records={records.filter(record=>record.projectId===selected.id)} notify={notify} close={()=>setModal(null)} onClosed={async()=>{setModal(null);setSelectedId(null);await Promise.all([refreshProjects(),refreshRecords()]);setPage("projects")}}/>}
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
  const kind = ["风险","已退回"].includes(value)?"red":["预警","待填写","待审核","待验收","待支付","待结项"].includes(value)?"amber":["已完成","已交付","已验收","已支付","已结项","执行中","正常"].includes(value)?"green":"blue";
  return <span className={`status ${kind}`}>{value}</span>;
}

function ProjectForm({editing,catalog,tagLibrary,projectManagers,currentUser,onSave}:{editing:Project|null;catalog:ServiceTemplate[];tagLibrary:ProjectTag[];projectManagers:ProjectManagerAccount[];currentUser:CurrentUser;onSave:(data:FormData)=>void}) {
  const available=catalog.filter(item=>item.enabled);
  const initialManagerIds=editing?.managerIds?.length
    ? editing.managerIds
    : editing
      ? projectManagers.filter(account=>editing.manager.split("、").includes(account.name)).map(account=>account.id)
      : currentUser.role==="项目经理"
        ? [currentUser.id]
        : [];
  const [selectedManagerIds,setSelectedManagerIds]=useState<number[]>(initialManagerIds);
  const [services,setServices]=useState<Service[]>(()=>editing?.services ?? [{id:Date.now(),name:available[0]?.name??"",contractDetail:"",unit:available[0]?.defaultUnit??"场",quantity:1,completed:0,unitPrice:0,costPrice:0,billingMode:"delivery"}]);
  const serviceTotal=services.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0);
  function updateService(id:number,key:keyof Service,value:string){
    setServices(items=>items.map(item=>item.id===id?{...item,[key]:["quantity","unitPrice","costPrice"].includes(key)?Number(value):value}:item));
  }
  return <form action={onSave}><div className="modal-title"><h2>{editing?"编辑项目":"新增项目"}</h2><p>直接录入项目及服务信息，无需读取或解析合同。</p></div>
    <div className="form-grid"><label className="full">项目名称<input name="name" required defaultValue={editing?.name}/></label>
      <label>合同编号<input name="contract" required defaultValue={editing?.contract}/></label>
      <label>财务合同编号（选填）<input name="financialContractNo" maxLength={100} defaultValue={editing?.financialContractNo} placeholder="可在创建后编辑补录"/></label>
      <div className="manager-picker"><span>项目经理</span><small>可多选；项目经理新建时默认选择本人</small><div>{projectManagers.map(manager=><label key={manager.id}><input type="checkbox" name="managerIds" value={manager.id} checked={selectedManagerIds.includes(manager.id)} onChange={event=>setSelectedManagerIds(ids=>event.target.checked?[...ids,manager.id]:ids.filter(id=>id!==manager.id))}/><span><strong>{manager.name}</strong><small>@{manager.username}</small></span></label>)}</div>{!projectManagers.length&&<em>暂无启用中的项目经理账号，请先在账号管理中创建或启用。</em>}{projectManagers.length>0&&!selectedManagerIds.length&&<em>请至少选择一位项目经理</em>}</div>
      <label>项目总价（自动计算）<input type="text" disabled value={money(serviceTotal)}/></label><label>项目状态<select name="status" defaultValue={["待启动","执行中"].includes(editing?.status??"")?editing?.status:"执行中"}><option>执行中</option><option>待启动</option></select></label>
      <label>项目优先级<select name="priority" defaultValue={editing?.priority??"P1"}><option>P0</option><option>P1</option><option>P2</option></select></label>
      <label>开始日期<input name="start" type="date" required defaultValue={editing?.start}/></label><label>结束日期<input name="end" type="date" required defaultValue={editing?.end}/></label>
      <label>合同文件（选填）<input type="file" accept=".pdf,.doc,.docx"/></label>
      <div className="full tag-picker"><span>项目标签</span><small>从标签库选择，可多选</small><div>{tagLibrary.filter(tag=>tag.enabled||editing?.tags?.includes(tag.name)).map(tag=><label key={tag.id}><input type="checkbox" name="tags" value={tag.name} defaultChecked={editing?.tags?.includes(tag.name)}/>{tag.name}</label>)}</div>{!tagLibrary.length&&<em>暂无可用标签，请先在服务目录页维护标签库。</em>}</div>
      <div className="full manager-picker"><span>售前参与人</span><small>可多选，不影响项目权限</small><div>{projectManagers.map(person=><label key={person.id}><input type="checkbox" name="presalesContributorIds" value={person.id} defaultChecked={editing?.presalesContributorIds?.includes(person.id)}/><span><strong>{person.name}</strong><small>@{person.username}</small></span></label>)}</div></div>
      <label className="full">售前工作内容<textarea name="presalesWork" maxLength={1000} defaultValue={editing?.presalesWork} placeholder="例如：标书撰写、方案设计、测评设计等"/></label>
      <div className="full service-builder">
        <div className="builder-title"><span><strong>项目服务内容</strong><small>年包服务可选择“按时间确认收入”，无需创建12条虚拟记录</small></span><button type="button" onClick={()=>setServices(items=>[...items,{id:Date.now(),name:available[0]?.name??"",contractDetail:"",unit:available[0]?.defaultUnit??"场",quantity:1,completed:0,unitPrice:0,costPrice:0,billingMode:"delivery"}])}>＋ 添加服务</button></div>
        <div className="builder-head"><span>服务大类／合同详情说明</span><span>计费方式</span><span>单位</span><span>数量</span><span>销售单价</span><span>成本单价</span><span>金额小计</span><span/></div>
        {services.map(item=><div className="builder-row" key={item.id}>
          <div className="builder-service"><select required value={item.name} onChange={e=>{const template=available.find(x=>x.name===e.target.value);setServices(items=>items.map(x=>x.id===item.id?{...x,name:e.target.value,unit:template?.defaultUnit??x.unit}:x))}}>{available.map(template=><option key={template.id}>{template.name}</option>)}</select><input required maxLength={500} placeholder="合同详情说明，如：压力管理专题讲座" value={item.contractDetail??""} onChange={e=>updateService(item.id,"contractDetail",e.target.value)}/></div>
          <select value={item.billingMode??"delivery"} onChange={e=>updateService(item.id,"billingMode",e.target.value)}><option value="delivery">按交付验收</option><option value="annual-time">年包按时间确认</option></select>
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
      <label>计费方式<select name="billingMode"><option value="delivery">按交付验收</option><option value="annual-time">年包按时间确认收入</option></select></label>
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

function RecordDetailFields({recordType,data={},required=false}:{recordType:string;data?:Record<string,unknown>;required?:boolean}){
  return recordType==="心理咨询台账"?<>
    <label>咨询方式<select name="method" required={required} defaultValue={String(data.method??"")}><option value="">请选择</option><option>线上咨询</option><option>线下咨询</option><option>驻场咨询</option></select></label>
    <label>咨询时长（分钟）<input name="duration" type="number" min="1" required={required} defaultValue={data.duration===undefined?"":Number(data.duration)}/></label>
    <label>风险情况<select name="risk" required={required} defaultValue={String(data.risk??"")}><option value="">请选择</option><option>无风险</option><option>需要跟进</option><option>重点关注</option></select></label>
    <label className="full">咨询概括<textarea name="summary" required={required} defaultValue={String(data.summary??"")}/></label>
  </>:<>
    <label>活动主题<input name="topic" required={required} defaultValue={String(data.topic??"")}/></label>
    <label>参与人数<input name="participants" type="number" min="1" required={required} defaultValue={data.participants===undefined?"":Number(data.participants)}/></label>
    <label className="full">活动地点<input name="location" required={required} defaultValue={String(data.location??"")}/></label>
    <label className="full">活动内容及效果<textarea name="summary" required={required} defaultValue={String(data.summary??"")}/></label>
  </>;
}

function ManagerRecordForm({projects,defaultProjectId,defaultServiceId,lockProject=false,onSave,close}:{projects:Project[];defaultProjectId?:number;defaultServiceId?:number;lockProject?:boolean;onSave:(d:FormData)=>void;close:()=>void}) {
  const [projectId,setProjectId]=useState(defaultProjectId??projects[0]?.id??0);
  const current=projects.find(project=>project.id===projectId);
  const [serviceId,setServiceId]=useState(defaultServiceId??current?.services[0]?.id??0);
  const [consultantCostUnit,setConsultantCostUnit]=useState("");
  const [materialCostUnit,setMaterialCostUnit]=useState("");
  const selectedService=current?.services.find(service=>service.id===serviceId)??current?.services[0];
  const recordType=recordTypeForServiceName(selectedService?.name??"");
  const totalCost=consultantCostUnit!==""&&materialCostUnit!==""?Number(consultantCostUnit)+Number(materialCostUnit):null;
  const profitRate=selectedService&&selectedService.unitPrice>0&&totalCost!==null?(selectedService.unitPrice-totalCost)/selectedService.unitPrice*100:null;
  return <form action={onSave}><div className="modal-title"><h2>项目经理发起服务</h2><p>台账模板随服务内容自动匹配；发起时只需填写项目、服务、开始日期和数量。</p></div>
    <div className="record-source"><span>填写身份</span><strong>项目经理 · 当前登录账号</strong></div>
    <div className="form-grid">{lockProject?<label>所属项目（任务已锁定）<input value={current?.name??"项目不存在"} readOnly/><input name="projectId" type="hidden" value={projectId}/></label>:<label>所属项目<ProjectSearchSelect name="projectId" projects={projects} value={projectId} onChange={value=>{const id=Number(value),project=projects.find(item=>item.id===id);setProjectId(id);setServiceId(project?.services[0]?.id??0);setConsultantCostUnit("");setMaterialCostUnit("")}}/></label>}
      <label>服务内容<select name="serviceId" value={serviceId} onChange={e=>{setServiceId(Number(e.target.value));setConsultantCostUnit("");setMaterialCostUnit("")}}>{current?.services.map(service=><option value={service.id} key={service.id}>{service.name}（剩余 {Math.max(0,service.quantity-service.completed)} {service.unit}）</option>)}</select></label>
      <label>台账模板（自动匹配）<input name="recordType" value={recordType} readOnly/></label>
      <label>服务人员<input name="provider" placeholder="可在验收时补充"/></label>
      <label>服务开始日期<input name="startDate" type="date" required/></label><label>服务结束日期<input name="endDate" type="date"/></label><label>本次完成数量<input name="quantity" type="number" min="1" defaultValue="1" required/></label>
      <label>咨询师成本单价（元）<input name="consultantCostUnit" type="number" min="0" step="0.01" value={consultantCostUnit} onChange={e=>setConsultantCostUnit(e.target.value)} placeholder="验收时必填"/></label>
      <label>物料成本单价（元）<input name="materialCostUnit" type="number" min="0" step="0.01" value={materialCostUnit} onChange={e=>setMaterialCostUnit(e.target.value)} placeholder="验收时必填，无成本填0"/></label>
      <div className="profit-preview"><small>服务单价</small><strong>{money(selectedService?.unitPrice??0)}</strong><small>单条利润率</small><strong className={profitRate!==null&&profitRate<0?"negative-profit":""}>{profitRate===null?"填写成本后计算":`${profitRate.toFixed(1)}%`}</strong></div>
      <RecordDetailFields recordType={recordType}/>
      <label className="full">现场图片、课件及其他资料<input name="files" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx"/></label></div>
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary">发起服务，进入待验收</button></div></form>;
}
function LinkDialog({projects,selectedProjectId,lockProject=false,notify,onGenerated,close}:{projects:Project[];selectedProjectId?:number;lockProject?:boolean;notify:(s:string)=>void;onGenerated?:(record:ServiceRecord)=>void|Promise<void>;close:()=>void}) {
  const [projectId,setProjectId]=useState(selectedProjectId??projects[0]?.id??0);
  const [link,setLink]=useState("");
  const [remark,setRemark]=useState("");
  const current=projects.find(project=>project.id===projectId);
  const [serviceId,setServiceId]=useState(current?.services[0]?.id??0);
  const selectedService=current?.services.find(service=>service.id===serviceId)??current?.services[0];
  const formType=recordTypeForServiceName(selectedService?.name??"");
  async function generate(form:FormData){
    const response=await fetch(appPath("/api/form-links"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectId,serviceId,formType,remark,startDate:String(form.get("startDate")),quantity:Number(form.get("quantity"))||1,expiresInDays:Number(form.get("expiresInDays"))||undefined,maxSubmissions:1})});
    const data=await response.json().catch(()=>({})) as {path?:string;record?:ServiceRecord;error?:string};
    if(!response.ok||!data.path||!data.record){notify(data.error??"链接生成失败，请重试");return}
    if(onGenerated)await onGenerated(data.record);
    setLink(`${window.location.origin}${data.path}`);
  }
  return <form action={generate}><div className="modal-title"><h2>发起外部填写服务</h2><p>生成链接时同步创建一条“待填写”记录；咨询师提交后自动进入待验收。</p></div>
    {!link?<div className="form-grid">{lockProject?<label className="full">对应项目（任务已锁定）<input value={current?.name??"项目不存在"} readOnly/></label>:<label className="full">对应项目<ProjectSearchSelect projects={projects} value={projectId} onChange={value=>{const id=Number(value),project=projects.find(item=>item.id===id);setProjectId(id);setServiceId(project?.services[0]?.id??0)}}/></label>}
      <label className="full">对应服务内容<select name="serviceId" value={serviceId} onChange={event=>setServiceId(Number(event.target.value))} required>{current?.services.map(service=><option value={service.id} key={service.id}>{service.name}（{service.unit}）</option>)}</select></label>
      <label>台账模板（自动匹配）<input name="formType" value={formType} readOnly/></label><label>服务开始日期<input name="startDate" type="date" required/></label>
      <label>服务数量<input name="quantity" type="number" min="1" defaultValue="1" required/></label><label>链接有效期<select name="expiresInDays"><option value="7">7天</option><option value="30">30天</option><option value="">永久有效</option></select></label>
      <label className="full">活动备注<textarea name="remark" value={remark} onChange={event=>setRemark(event.target.value)} maxLength={200} required placeholder="如：8月压力管理团辅｜王老师｜第一场"/></label></div>:
      <div className="generated-link"><span>✓</span><h3>外部填写服务已发起</h3><p>{link}</p><small>活动备注：{remark}</small><small>服务记录已显示为“待填写”，咨询师提交后转为“待验收”</small></div>}
    <div className="modal-actions"><button type="button" onClick={close}>关闭</button>{!link?<button className="primary">生成链接</button>:<button type="button" className="primary" onClick={async()=>notify(await copyText(link)?"填写链接已复制":"复制失败，请手动选择链接复制")}>复制链接</button>}</div>
  </form>;
}

function TaskRecordMethodDialog({task,project,onManager,onExternal,close}:{task:DeliveryTask;project?:Project;onManager:()=>void;onExternal:()=>void;close:()=>void}){
  return <div className="task-record-method"><div className="modal-title"><h2>新增任务服务记录</h2><p>{project?.name??"所属项目"} · {task.title}</p></div>
    <div className="record-method-options">
      <button type="button" onClick={onManager}><span>项目经理填写</span><strong>立即发起，进入待验收</strong><small>适合项目经理已经掌握服务时间、数量等基本信息的情况。</small></button>
      <button type="button" onClick={onExternal}><span>外部填写链接</span><strong>先生成待填写记录</strong><small>把链接发给咨询师填写，提交后自动转为待验收并保留在当前任务。</small></button>
    </div>
    <div className="modal-actions"><button type="button" onClick={close}>取消</button></div>
  </div>;
}

function TaskManagement({projects,records,currentUser,managers,notify,onAddRecord,onReview,onAccept,onView}:{
  projects:Project[];records:ServiceRecord[];currentUser:CurrentUser;managers:ProjectManagerAccount[];
  notify:(message:string)=>void;onAddRecord:(task:DeliveryTask)=>void;onReview:(record:ServiceRecord)=>void;onAccept:(record:ServiceRecord)=>void;onView:(record:ServiceRecord)=>void;
}){
  const [tasks,setTasks]=useState<DeliveryTask[]>([]);
  const [status,setStatus]=useState<"all"|"completed"|"incomplete">("all");
  const [start,setStart]=useState(""),[end,setEnd]=useState("");
  const [editing,setEditing]=useState<DeliveryTask|null>(null);
  const [showForm,setShowForm]=useState(false);
  const recordsSignature=records.map(record=>`${record.id}:${record.status}`).join(",");
  const load=useCallback(async()=>{
    const query=new URLSearchParams({status});
    if(start)query.set("start",start);if(end)query.set("end",end);
    const response=await fetch(appPath(`/api/tasks?${query}`),{cache:"no-store"});
    if(response.ok){const data=await response.json() as {tasks?:DeliveryTask[]};setTasks(data.tasks??[])}
  },[end,start,status]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load,recordsSignature]);
  const projectFor=(task:DeliveryTask)=>projects.find(project=>project.id===task.projectId);
  const taskRecords=(task:DeliveryTask)=>task.recordIds.map(id=>records.find(record=>record.id===id)).filter((record):record is ServiceRecord=>Boolean(record));
  async function save(task:Omit<DeliveryTask,"id"|"createdAt"|"updatedAt"|"records"> & {id?:number}){
    const response=await fetch(appPath("/api/tasks"),{method:task.id?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(task)});
    const data=await response.json() as {error?:string};
    if(!response.ok){notify(data.error??"任务保存失败");return}
    setShowForm(false);setEditing(null);await load();notify(task.id?"任务修改成功":"任务创建成功");
  }
  async function remove(task:DeliveryTask){
    if(!window.confirm(`确认删除任务“${task.title}”吗？服务记录本身不会删除。`))return;
    const response=await fetch(appPath(`/api/tasks?id=${task.id}`),{method:"DELETE"});
    if(!response.ok){notify("任务删除失败");return}
    await load();notify("任务已删除，关联服务记录已保留");
  }
  const completed=tasks.filter(task=>task.status==="已完成").length;
  return <section className="content-card task-management">
    <div className="section-title"><div><h2>项目经理任务管理</h2><p>任务按项目管理，可关联多条、多类服务；关联记录全部验收后自动完成</p></div><button className="primary" onClick={()=>{setEditing(null);setShowForm(true)}}>＋ 新增任务</button></div>
    <div className="task-summary"><div><small>当前列表</small><strong>{tasks.length}</strong></div><div><small>已完成</small><strong>{completed}</strong></div><div><small>未完成</small><strong>{tasks.length-completed}</strong></div><div><small>待处理关联记录</small><strong>{tasks.reduce((sum,task)=>sum+taskRecords(task).filter(record=>["待填写","待审核","待验收"].includes(record.status)).length,0)}</strong></div></div>
    <div className="task-filters">
      <label>完成状态<select value={status} onChange={event=>setStatus(event.target.value as typeof status)}><option value="all">全部任务</option><option value="incomplete">未完成</option><option value="completed">已完成</option></select></label>
      <label>计划开始日期<input type="date" value={start} onChange={event=>setStart(event.target.value)}/></label>
      <label>计划结束日期<input type="date" value={end} onChange={event=>setEnd(event.target.value)}/></label>
      <button onClick={()=>{setStatus("all");setStart("");setEnd("")}}>重置筛选</button>
    </div>
    <div className="task-list">
      {tasks.map(task=>{
        const project=projectFor(task),linked=taskRecords(task),pending=linked.filter(record=>["待填写","待审核","待验收"].includes(record.status));
        const serviceTypeCount=new Set(linked.map(record=>record.serviceId)).size;
        return <article className="task-card" key={task.id}>
          <div className="task-card-main"><Status value={task.status}/><span><strong>{task.title}</strong><small>{project?.name??"项目已归档"} · 项目级任务</small></span><time>{task.plannedDate||"未设置日期"}</time></div>
          {task.description&&<p>{task.description}</p>}
          <div className="task-meta"><span>负责人<strong>{task.owner||"未分配"}</strong></span><span>服务类型<strong>{serviceTypeCount} 类</strong></span><span>关联记录<strong>{linked.length} 条</strong></span><span>交付状态<strong>{linked.filter(isAcceptedRecord).length} 已验收 / {pending.length} 待处理</strong></span></div>
          {linked.length>0&&<div className="task-records">{linked.map(record=>{const service=project?.services.find(item=>item.id===record.serviceId);return <div key={record.id}><span><strong>{service?.name??record.recordType}</strong><small>{record.recordType} · {recordStartDate(record.payload.data)||record.createdAt.slice(0,10)} · {String(record.payload.data?.provider||"未填写服务人员")}</small></span><Status value={isAcceptedRecord(record)?"已验收":record.status}/><button onClick={()=>onView(record)}>查看</button>{record.status==="待审核"&&<button className="review-task-record" onClick={()=>onReview(record)}>审核</button>}{record.status==="待验收"&&<button className="review-task-record" onClick={()=>onAccept(record)}>验收</button>}</div>})}</div>}
          <div className="task-actions"><button className="primary" onClick={()=>onAddRecord(task)}>＋ 新增服务记录</button><button onClick={()=>{setEditing(task);setShowForm(true)}}>编辑任务</button><button className="danger-text" onClick={()=>remove(task)}>删除任务</button></div>
        </article>;
      })}
      {!tasks.length&&<div className="empty-records"><strong>当前条件下暂无任务</strong><span>可以新建任务，也可以继续在“服务记录”板块直接填写记录。</span></div>}
    </div>
    {showForm&&<div className="modal-backdrop" onMouseDown={()=>{setShowForm(false);setEditing(null)}}><div className="modal" onMouseDown={event=>event.stopPropagation()}><button className="close" onClick={()=>{setShowForm(false);setEditing(null)}}>×</button><TaskForm editing={editing} projects={projects} records={records} managers={managers} currentUser={currentUser} onSave={save} close={()=>{setShowForm(false);setEditing(null)}}/></div></div>}
  </section>;
}

function TaskForm({editing,projects,records,managers,currentUser,onSave,close}:{
  editing:DeliveryTask|null;projects:Project[];records:ServiceRecord[];managers:ProjectManagerAccount[];currentUser:CurrentUser;
  onSave:(task:Omit<DeliveryTask,"id"|"createdAt"|"updatedAt"|"records"> & {id?:number})=>void;close:()=>void;
}){
  const [projectId,setProjectId]=useState(editing?.projectId??projects[0]?.id??0);
  const project=projects.find(item=>item.id===projectId);
  const [recordIds,setRecordIds]=useState<number[]>(editing?.recordIds??[]);
  const matchingRecords=records.filter(record=>record.projectId===projectId&&(!isAcceptedRecord(record)||recordIds.includes(record.id)));
  function changeProject(value:number){setProjectId(value);setRecordIds([])}
  function submit(form:FormData){
    onSave({
      id:editing?.id,projectId,serviceId:0,title:String(form.get("title")),description:String(form.get("description")),
      plannedQuantity:Math.max(1,recordIds.length),plannedDate:String(form.get("plannedDate")),owner:String(form.get("owner")),
      status:"未完成",recordIds
    });
  }
  return <form action={submit}><div className="modal-title"><h2>{editing?"编辑任务":"新增任务"}</h2><p>任务属于项目，可同时关联该项目下多条、多类尚未验收的服务记录。</p></div>
    <div className="form-grid"><label className="full">任务名称<input name="title" required maxLength={100} defaultValue={editing?.title}/></label>
      <label>所属项目<ProjectSearchSelect projects={projects} value={projectId} onChange={value=>changeProject(Number(value))}/></label>
      <label>计划日期<input name="plannedDate" type="date" defaultValue={editing?.plannedDate??""}/></label>
      <label>负责人<select name="owner" defaultValue={editing?.owner??currentUser.name}>{managers.map(manager=><option value={manager.name} key={manager.id}>{manager.name}</option>)}</select></label>
      <label>完成状态<input disabled value="关联记录全部验收后完成"/></label>
      <label className="full">任务说明<textarea name="description" maxLength={1000} defaultValue={editing?.description} placeholder="填写执行要求、时间安排、交付标准等"/></label>
      <div className="full task-record-picker"><span>关联服务记录</span><small>可跨服务类型选择多条未验收记录；任务内现有的已验收记录会保留用于追溯。</small>{matchingRecords.length?<div>{matchingRecords.map(record=>{const service=project?.services.find(item=>item.id===record.serviceId);return <label key={record.id}><input type="checkbox" checked={recordIds.includes(record.id)} disabled={isAcceptedRecord(record)} onChange={event=>setRecordIds(ids=>event.target.checked?[...ids,record.id]:ids.filter(id=>id!==record.id))}/><span><strong>{service?.name??record.recordType}</strong><small>{record.recordType} · {recordStartDate(record.payload.data)||record.createdAt.slice(0,10)} · {String(record.payload.data?.provider||"未填写")} · {record.status}</small></span></label>})}</div>:<em>该项目下暂无未验收服务记录，可先创建任务，再从任务卡片直接新增服务记录。</em>}</div>
    </div>
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary">{editing?"保存修改":"创建任务"}</button></div>
  </form>;
}

function Records({records,projects,managerFilter,onManagerFilterChange,refresh,notify,onManagerRecord,onLink,onView,onReview,onAccept,onPayment,onEdit}:{records:ServiceRecord[];projects:Project[];managerFilter:string;onManagerFilterChange:(manager:string)=>void;refresh:()=>Promise<void>;notify:(s:string)=>void;onManagerRecord:()=>void;onLink:()=>void;onView:(record:ServiceRecord)=>void;onReview:(record:ServiceRecord)=>void;onAccept:(record:ServiceRecord)=>void;onPayment:(record:ServiceRecord)=>void;onEdit:(record:ServiceRecord)=>void}) {
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
  const filtered=timeFiltered.filter(record=>recordStatus==="all"||(recordStatus==="delivered"&&isAcceptedRecord(record))||(recordStatus==="pending"&&!isAcceptedRecord(record))).sort((a,b)=>recordDate(b).getTime()-recordDate(a).getTime()||(b.id-a.id));
  const recordTimestamp=(record:ServiceRecord)=>{
    const value=isAcceptedRecord(record)&&record.approvedAt?record.approvedAt:record.updatedAt||record.createdAt;
    return new Date(value).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  };
  function serviceFor(record:ServiceRecord){return projects.find(item=>item.id===record.projectId)?.services.find(item=>item.id===record.serviceId)}
  function isDemoRecord(record:ServiceRecord){return Boolean(projects.find(item=>item.id===record.projectId)?._isDemo)}
  function recordAmount(record:ServiceRecord){return record.amountSnapshot??null}
  const deliveryFinance=(items:ServiceRecord[])=>{
    const approved=items.filter(record=>isAcceptedRecord(record)&&!isDemoRecord(record));
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
  return <section className="content-card"><div className="section-title"><div><h2>服务记录</h2><p>先发起、后补全验收；只有已验收记录计入交付金额</p></div><div className="record-actions"><button className="primary" onClick={onManagerRecord}>＋ 项目经理发起</button><button onClick={onLink}>↗ 外部填写</button></div></div>
    <div className="entry-guide"><div><span>项目经理发起</span><strong>发起后进入待验收</strong><small>只需项目、服务、类型、开始日期和数量</small></div><div><span>外部填写</span><strong>生成链接即显示待填写</strong><small>咨询师提交后自动进入待验收</small></div></div>
    <div className="live-status"><i/> 数据自动刷新 · 最近同步 {new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</div>
    <div className="delivery-summary">
      <div><small>本周正式交付金额</small><span className="delivery-metric"><strong>{money(weekFinance.amount)}</strong><em className={weekFinance.profitRate!==null&&weekFinance.profitRate<0?"negative-profit":""}>利润率 {profitRateLabel(weekFinance.profitRate)}</em></span></div>
      <div><small>本月正式交付金额</small><span className="delivery-metric"><strong>{money(monthFinance.amount)}</strong><em className={monthFinance.profitRate!==null&&monthFinance.profitRate<0?"negative-profit":""}>利润率 {profitRateLabel(monthFinance.profitRate)}</em></span></div>
      <div><small>当前正式筛选金额</small><span className="delivery-metric"><strong>{money(filteredFinance.amount)}</strong><em className={filteredFinance.profitRate!==null&&filteredFinance.profitRate<0?"negative-profit":""}>利润率 {profitRateLabel(filteredFinance.profitRate)}</em></span></div>
      <div><small>当前已验收记录</small><strong>{filtered.filter(isAcceptedRecord).length} 条</strong></div>
    </div>
    <div className="records-filter record-project-filters"><label><span>项目经理</span><select value={managerFilter} onChange={event=>{onManagerFilterChange(event.target.value);setProjectId("all")}}><option value="all">全部项目经理</option>{managers.map(manager=><option value={manager} key={manager}>{manager}</option>)}</select></label><label className="project-search-filter"><span>所属项目</span><ProjectSearchSelect allowAll projects={managerProjects} value={projectId} onChange={setProjectId}/></label></div>
    <div className="records-filter"><span>服务日期</span>{([["week","本周"],["month","本月"],["all","全部"],["custom","自定义"]] as const).map(([value,label])=><button type="button" key={value} className={period===value?"active":""} onClick={()=>setPeriod(value)}>{label}</button>)}{period==="custom"&&<><input type="date" value={start} onChange={e=>setStart(e.target.value)}/><em>至</em><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></>}</div>
    <div className="tabs record-status-tabs"><button className={recordStatus==="all"?"active":""} onClick={()=>setRecordStatus("all")}>全部 {timeFiltered.length}</button><button className={recordStatus==="delivered"?"active":""} onClick={()=>setRecordStatus("delivered")}>已验收 {timeFiltered.filter(isAcceptedRecord).length}</button><button className={recordStatus==="pending"?"active":""} onClick={()=>setRecordStatus("pending")}>待处理 {timeFiltered.filter(record=>!isAcceptedRecord(record)).length}</button></div>
    <div className="records-table"><div className="records-row heading"><span>执行时间</span><span>项目／服务</span><span>服务人员</span><span>完成数量</span><span>交付金额</span><span>成本／利润率</span><span>资料</span><span>状态／时间</span><span>操作</span></div>
      {filtered.length===0?<div className="empty-records"><strong>当前时间范围暂无服务记录</strong><span>可切换本周、本月、全部或自定义日期查看</span></div>:filtered.map(record=>{
        const data=record.payload.data??{},amount=recordAmount(record),service=serviceFor(record);
        const provider=String(data.provider??"").trim()||(record.status==="待填写"?"等待咨询师填写":"未填写");
        return <div className="records-row" key={record.id}><span>{recordDateRange(record)}</span><span>{recordLabel(record)}</span><span>{provider}</span><span>{Number(data.quantity??1)} {service?.unit??"次"}</span><span className="amount-cell">{amount===null?"验收后冻结":money(amount)}</span><span className="profit-cell">{record.costAmountSnapshot===null||record.costAmountSnapshot===undefined?<><strong>{record.status==="待填写"?"尚未填写":"验收时填写"}</strong><small>{record.status==="待填写"?"等待外部提交":"成本与利润率"}</small></>:<><strong>{money(record.costAmountSnapshot)}</strong><small className={(record.profitRateBasisPoints??0)<0?"negative-profit":""}>{record.profitRateBasisPoints===null||record.profitRateBasisPoints===undefined?"—":`${(record.profitRateBasisPoints/100).toFixed(1)}%`}</small>{isAcceptedRecord(record)&&<Status value={record.paymentStatus??"待支付"}/>}</>}</span><Attachments recordId={record.id}/><span className="record-time"><Status value={isAcceptedRecord(record)?"已验收":record.status}/><small>{record.status==="待填写"?"发起":isAcceptedRecord(record)?"验收":"提交/修改"} {recordTimestamp(record)}</small></span><span className="row-actions"><button onClick={()=>onView(record)}>查看</button>{record.status==="待审核"&&<button onClick={()=>onReview(record)}>审核</button>}{record.status==="待验收"&&<button onClick={()=>onAccept(record)}>验收</button>}{isAcceptedRecord(record)&&<button onClick={()=>onPayment(record)}>{record.paymentStatus==="已支付"?"撤销支付":"确认支付"}</button>}<button onClick={()=>onEdit(record)}>修改</button><button className="danger-action" disabled={deletingId===record.id} onClick={()=>remove(record)}>{deletingId===record.id?"作废中…":"作废"}</button></span></div>
      })}
    </div>
  </section>;
}

function Consultants({records,projects,onView}:{records:ServiceRecord[];projects:Project[];onView:(record:ServiceRecord)=>void}){
  const approved=records.filter(record=>isAcceptedRecord(record)&&String(record.payload.data?.provider??"").trim());
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
    <div className="section-title"><div><h2>咨询师归集</h2><p>仅统计已验收交付记录；咨询师成本与物料成本分别归集展示</p></div></div>
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
    <div className="consultant-section-title"><div><h3>服务价格汇总</h3><p>同一咨询师的不同服务、不同验收成本分别归集</p></div><span>{priceGroups.length} 个价格项</span></div>
    <div className="consultant-price-table">
      <div className="consultant-price-row heading"><span>咨询师</span><span>服务内容</span><span>咨询师成本</span><span>物料成本</span><span>服务数量</span><span>记录数</span><span>累计总成本</span></div>
      {priceGroups.map(group=><div className="consultant-price-row" key={`${group.provider}-${group.serviceName}-${group.consultantPrice}-${group.materialPrice}`}><strong>{group.provider}</strong><span>{group.serviceName}</span><span className="consultant-price">{money(group.consultantPrice)} / {group.unit}</span><span>{money(group.materialPrice)} / {group.unit}</span><span>{group.quantity} {group.unit}</span><span>{group.count} 条</span><strong>{money(group.total)}</strong></div>)}
      {!priceGroups.length&&<div className="empty-records"><strong>暂无符合条件的已验收记录</strong><span>服务记录验收通过后，将自动归集到这里</span></div>}
    </div>
    <div className="consultant-section-title detail-title"><div><h3>服务明细</h3><p>数据与服务记录同步，按执行时间从近到远排列</p></div><span>{filtered.length} 条</span></div>
    <div className="consultant-detail-table">
      <div className="consultant-detail-row heading"><span>执行时间</span><span>咨询师</span><span>项目／服务</span><span>服务数量</span><span>咨询师成本</span><span>物料成本</span><span>总成本</span><span>验收时间</span><span>操作</span></div>
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
  topic:"活动主题",participants:"参与人数",location:"活动地点",satisfaction:"满意度（10分制）",source:"填写来源"
};
function ViewRecordDialog({record,projects,close}:{record:ServiceRecord;projects:Project[];close:()=>void}){
  const project=projects.find(item=>item.id===record.projectId);
  const service=project?.services.find(item=>item.id===record.serviceId);
  const data=record.payload.data??{};
  const hidden=new Set(["projectId","serviceId","recordType","status","costUnit","consultantCostUnit","materialCostUnit","formToken"]);
  const details=Object.entries(data).filter(([key,value])=>!hidden.has(key)&&value!==""&&value!==null&&value!==undefined);
  const timestamp=isAcceptedRecord(record)&&record.approvedAt?record.approvedAt:record.updatedAt||record.createdAt;
  return <div className="review-dialog view-record-dialog">
    <div className="modal-title"><h2>查看服务记录</h2><p>以下为该条记录当前保存的完整填写内容、状态与附件。</p></div>
    <div className="review-head"><div><small>所属项目</small><strong>{project?.name??"项目已归档"}</strong></div><div><small>服务内容</small><strong>{service?.name??record.recordType}</strong></div><div><small>记录类型</small><strong>{record.recordType}</strong></div><Status value={isAcceptedRecord(record)?"已验收":record.status}/></div>
    <section className="review-section"><h3>填写内容</h3><div className="review-details">
      {details.length?details.map(([key,value])=><div className={key==="summary"?"wide":""} key={key}><small>{recordFieldLabels[key]??key}</small><strong>{String(value)}</strong></div>):<div className="wide"><small>填写内容</small><strong>暂无其他填写内容</strong></div>}
    </div></section>
    <section className="review-section"><h3>活动资料与附件</h3><Attachments recordId={record.id} previewImages/></section>
    <section className="review-section record-meta"><h3>记录信息</h3><div className="review-details">
      <div><small>提交时间</small><strong>{new Date(record.createdAt).toLocaleString("zh-CN")}</strong></div>
      <div><small>{isAcceptedRecord(record)?"验收时间":"最近修改时间"}</small><strong>{new Date(timestamp).toLocaleString("zh-CN")}</strong></div>
      <div><small>完成数量</small><strong>{Number(data.quantity??1)} {service?.unit??"次"}</strong></div>
      {isAcceptedRecord(record)&&<div><small>成本支付</small><strong>{record.paymentStatus??"待支付"}{record.paidAt?` · ${new Date(record.paidAt).toLocaleDateString("zh-CN")}`:""}</strong></div>}
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
  const hidden=new Set(["projectId","serviceId","recordType","status","costUnit","consultantCostUnit","materialCostUnit","formToken"]);
  const details=Object.entries(data).filter(([key,value])=>!hidden.has(key)&&value!==""&&value!==null&&value!==undefined);
  const totalCost=consultantCostUnit!==""&&materialCostUnit!==""?Number(consultantCostUnit)+Number(materialCostUnit):null;
  const profitRate=service&&service.unitPrice>0&&totalCost!==null?(service.unitPrice-totalCost)/service.unitPrice*100:null;
  async function approve(){
    if(consultantCostUnit===""||materialCostUnit==="")return;
    setSubmitting(true);
    const response=await fetch(appPath("/api/records"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:record.id,status:"待验收",data:{consultantCostUnit:Number(consultantCostUnit),materialCostUnit:Number(materialCostUnit)}})});
    const result=await response.json().catch(()=>({})) as {error?:string};
    if(!response.ok){setSubmitting(false);notify(result.error??"审核失败，请重试");return}
    await onApproved();notify("审核通过，成本已冻结并进入待验收");
  }
  return <div className="review-dialog">
    <div className="modal-title"><h2>审核服务记录</h2><p>核对外部提交内容并补齐成本；审核通过后进入待验收。</p></div>
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
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button type="button" className="primary" disabled={consultantCostUnit===""||materialCostUnit===""||submitting} onClick={approve}>{submitting?"审核处理中…":"审核并送验收"}</button></div>
  </div>;
}

function AcceptanceRecordForm({record,projects,onSave,close}:{record:ServiceRecord;projects:Project[];onSave:(form:FormData)=>void;close:()=>void}){
  const data=record.payload.data??{};
  const project=projects.find(item=>item.id===record.projectId);
  const service=project?.services.find(item=>item.id===record.serviceId);
  const recordType=recordTypeForServiceName(service?.name??record.recordType);
  const [consultantCostUnit,setConsultantCostUnit]=useState(String(data.consultantCostUnit??data.costUnit??""));
  const [materialCostUnit,setMaterialCostUnit]=useState(String(data.materialCostUnit??""));
  const totalCost=consultantCostUnit!==""&&materialCostUnit!==""?Number(consultantCostUnit)+Number(materialCostUnit):null;
  const profitRate=service&&service.unitPrice>0&&totalCost!==null?(service.unitPrice-totalCost)/service.unitPrice*100:null;
  return <form action={onSave} className="review-dialog">
    <div className="modal-title"><h2>验收服务记录</h2><p>请补齐并核对全部必填信息。验收通过后冻结交付金额、成本与利润率。</p></div>
    <div className="review-head"><div><small>所属项目</small><strong>{project?.name??"项目已归档"}</strong></div><div><small>服务内容</small><strong>{service?.name??record.recordType}</strong></div><Status value="待验收"/></div>
    <div className="form-grid">
      <label>台账模板（自动匹配）<input name="recordType" value={recordType} readOnly/></label>
      <label>服务人员<input name="provider" required defaultValue={String(data.provider??"")}/></label>
      <label>服务开始日期<input name="startDate" type="date" required defaultValue={recordStartDate(data)}/></label>
      <label>服务结束日期<input name="endDate" type="date" required defaultValue={recordEndDate(data)}/></label>
      <label>本次完成数量<input name="quantity" type="number" min="1" required defaultValue={Number(data.quantity??1)}/></label>
      <label>咨询师成本单价（元）<input name="consultantCostUnit" type="number" min="0" step="0.01" required value={consultantCostUnit} onChange={event=>setConsultantCostUnit(event.target.value)}/></label>
      <label>物料成本单价（元）<input name="materialCostUnit" type="number" min="0" step="0.01" required value={materialCostUnit} onChange={event=>setMaterialCostUnit(event.target.value)} placeholder="无成本请填0"/></label>
      <label>满意度（10分制，选填）<input name="satisfaction" type="number" min="0" max="10" step="0.01" defaultValue={data.satisfaction===undefined?"":Number(data.satisfaction)} placeholder="支持两位小数"/></label>
      <div className="profit-preview"><small>服务单价</small><strong>{money(service?.unitPrice??0)}</strong><small>验收后利润率</small><strong className={profitRate!==null&&profitRate<0?"negative-profit":""}>{profitRate===null?"填写成本后计算":`${profitRate.toFixed(1)}%`}</strong></div>
      <RecordDetailFields recordType={recordType} data={data} required/>
    </div>
    <section className="review-section"><h3>已上传资料</h3><Attachments recordId={record.id} previewImages/></section>
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary">补全信息并完成验收</button></div>
  </form>;
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

function ProjectAttachments({projectId}:{projectId:number}){
  const [files,setFiles]=useState<Array<{id:number;name:string;category?:string|null;size?:number}>>([]);
  useEffect(()=>{fetch(appPath(`/api/files?projectId=${projectId}`)).then(response=>response.ok?response.json():{files:[]}).then(data=>setFiles(data.files??[])).catch(()=>undefined)},[projectId]);
  if(!files.length)return <div className="empty-records compact"><span>尚未上传结项资料</span></div>;
  return <div className="project-file-list">{files.map(file=><a key={file.id} href={appPath(`/api/files?id=${file.id}`)} target="_blank" rel="noreferrer"><Status value={file.category??"其他资料"}/><span><strong>{file.name}</strong><small>{file.size?`${(file.size/1024/1024).toFixed(1)} MB`:"项目资料"}</small></span></a>)}</div>;
}

function ProjectClosureDialog({project,records,notify,close,onClosed}:{project:Project;records:ServiceRecord[];notify:(message:string)=>void;close:()=>void;onClosed:()=>Promise<void>}){
  const [submitting,setSubmitting]=useState(false);
  const [serverBlockers,setServerBlockers]=useState<string[]>([]);
  const accepted=records.filter(isAcceptedRecord),pending=records.filter(record=>["待填写","待审核","待验收"].includes(record.status));
  const unpaid=accepted.filter(record=>record.paymentStatus!=="已支付"),missingCost=accepted.filter(record=>record.costAmountSnapshot===null||record.costAmountSnapshot===undefined);
  const revenue=project.services.reduce((sum,service)=>sum+service.quantity*service.unitPrice,0);
  const cost=accepted.reduce((sum,record)=>sum+Number(record.costAmountSnapshot??0),0),tax=Math.round(revenue*0.06),profit=revenue-cost-tax;
  const satisfactionScores=accepted.map(record=>Number(record.payload.data?.satisfaction)).filter(Number.isFinite);
  const averageSatisfaction=satisfactionScores.length?satisfactionScores.reduce((sum,value)=>sum+value,0)/satisfactionScores.length:null;
  async function uploadCategory(files:FormDataEntryValue[],category:string){
    for(const file of files){
      if(!(file instanceof File)||file.size===0)continue;
      const upload=new FormData();upload.append("file",file);upload.append("projectId",String(project.id));upload.append("category",category);
      const response=await fetch(appPath("/api/upload"),{method:"POST",body:upload});
      if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:string};throw new Error(data.error??`${category}上传失败`)}
    }
  }
  async function submit(form:FormData){
    setSubmitting(true);setServerBlockers([]);
    try{
      await uploadCategory(form.getAll("resultFiles"),"成果报告");
      await uploadCategory(form.getAll("invoiceFiles"),"发票");
      await uploadCategory(form.getAll("evaluationFiles"),"客户评价");
      const response=await fetch(appPath("/api/projects"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"close",id:project.id})});
      const data=await response.json().catch(()=>({})) as {error?:string;blockers?:string[]};
      if(!response.ok){setServerBlockers(data.blockers??[data.error??"项目暂不能结项"]);setSubmitting(false);return}
      await onClosed();notify("项目已结项归档，税费和最终利润已冻结");
    }catch(error){notify(error instanceof Error?error.message:"结项失败，请重试");setSubmitting(false)}
  }
  return <form action={submit} className="closure-dialog"><div className="modal-title"><h2>项目结项</h2><p>系统将校验交付、验收、任务和成本支付状态，并按项目总价自动核算6%税费。</p></div>
    <div className="closure-checks"><div><small>服务进度</small><strong>{projectProgress(project)}%</strong><Status value={isProjectFinished(project)?"已完成":"未完成"}/></div><div><small>待处理记录</small><strong>{pending.length} 条</strong><Status value={pending.length?"待处理":"正常"}/></div><div><small>项目平均满意度</small><strong>{averageSatisfaction===null?"暂无评分":`${averageSatisfaction.toFixed(2)} / 10`}</strong><Status value={satisfactionScores.length?"已汇总":"选填"}/></div><div><small>未支付成本</small><strong>{unpaid.length} 条</strong><Status value={unpaid.length?"待支付":"已支付"}/></div><div><small>缺少成本</small><strong>{missingCost.length} 条</strong><Status value={missingCost.length?"待补充":"正常"}/></div></div>
    <section className="closure-finance"><h3>结项财务预览</h3><div><span>项目收入<strong>{money(revenue)}</strong></span><span>服务成本<strong>{money(cost)}</strong></span><span>税费（6%）<strong>{money(tax)}</strong></span><span>预计利润<strong>{money(profit)}</strong></span></div></section>
    <section className="closure-files"><h3>结项资料</h3><div className="form-grid"><label>成果报告<input name="resultFiles" type="file" multiple accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"/></label><label>发票<input name="invoiceFiles" type="file" multiple accept=".pdf,.jpg,.jpeg,.png"/></label><label className="full">客户评价<input name="evaluationFiles" type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"/></label></div><ProjectAttachments projectId={project.id}/></section>
    {serverBlockers.length>0&&<div className="closure-blockers"><strong>暂不能结项，请先处理：</strong><ul>{serverBlockers.map(blocker=><li key={blocker}>{blocker}</li>)}</ul></div>}
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary" disabled={submitting}>{submitting?"正在校验并结项…":"确认结项并归档"}</button></div>
  </form>;
}

type ExternalLink={id:number;token:string;projectId:number;serviceId:number;formType:string;remark:string;expiresAt?:string|null;maxSubmissions:number;submissionCount:number;status:string;createdAt:string;lastUsedAt?:string|null};
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
  return <section className="content-card"><div className="section-title"><div><h2>外部填写链接</h2><p>通过活动备注识别每个链接，并集中查看有效期、提交次数和使用状态</p></div><button className="primary" onClick={onAdd}>＋ 生成填写链接</button></div>
    <div className="link-table"><div className="link-row heading"><span>项目／服务</span><span>活动备注</span><span>表单类型</span><span>提交进度</span><span>有效期</span><span>状态</span><span>操作</span></div>
      {links.map(link=><div className="link-row" key={link.id}><strong>{label(link)}</strong><span className="link-remark">{link.remark||"历史链接未填写备注"}</span><span>{link.formType}</span><span>{link.submissionCount}/{link.maxSubmissions}</span><span>{link.expiresAt?new Date(link.expiresAt).toLocaleDateString("zh-CN"):"永久"}</span><Status value={link.status}/><span><button onClick={async()=>notify(await copyText(`${location.origin}${appPath(`/form/${link.token}`)}`)?"填写链接已复制":"复制失败，请手动选择链接复制")}>复制</button><button onClick={()=>toggle(link)}>{link.status==="有效"?"停用":"启用"}</button></span></div>)}
      {!links.length&&<div className="empty-records"><strong>还没有生成外部填写链接</strong><span>生成后可在这里统一查看和停用</span></div>}
    </div>
  </section>;
}

function EditRecordForm({record,projects,onSave,close}:{record:ServiceRecord;projects:Project[];onSave:(d:FormData)=>void;close:()=>void}) {
  const data=record.payload.data??{};
  const [projectId,setProjectId]=useState(record.projectId||projects[0]?.id||0);
  const [serviceId,setServiceId]=useState(record.serviceId||projects[0]?.services[0]?.id||0);
  const [consultantCostUnit,setConsultantCostUnit]=useState(String(data.consultantCostUnit??data.costUnit??record.costUnitSnapshot??""));
  const [materialCostUnit,setMaterialCostUnit]=useState(String(data.materialCostUnit??0));
  const current=projects.find(project=>project.id===projectId);
  const service=current?.services.find(item=>item.id===serviceId)??current?.services[0];
  const recordType=recordTypeForServiceName(service?.name??record.recordType);
  const totalCost=consultantCostUnit!==""&&materialCostUnit!==""?Number(consultantCostUnit)+Number(materialCostUnit):null;
  const profitRate=service&&service.unitPrice>0&&totalCost!==null?(service.unitPrice-totalCost)/service.unitPrice*100:null;
  return <form action={onSave}><div className="modal-title"><h2>修改服务记录</h2><p>可修改内部或外部提交内容，保存后金额与进度同步更新。</p></div>
    <div className="form-grid"><label>所属项目<ProjectSearchSelect name="projectId" projects={projects} value={projectId} onChange={value=>{const id=Number(value),project=projects.find(item=>item.id===id);setProjectId(id);setServiceId(project?.services[0]?.id??0)}}/></label>
      <label>服务内容<select name="serviceId" value={serviceId} onChange={event=>setServiceId(Number(event.target.value))}>{current?.services.map(service=><option value={service.id} key={service.id}>{service.name}</option>)}</select></label>
      <label>台账模板（自动匹配）<input name="recordType" value={recordType} readOnly/></label>
      <label>服务人员<input name="provider" required={isAcceptedRecord(record)} defaultValue={String(data.provider??"")}/></label>
      <label>服务开始日期<input name="startDate" type="date" required defaultValue={recordStartDate(data)}/></label><label>服务结束日期<input name="endDate" type="date" required={isAcceptedRecord(record)} defaultValue={String(data.endDate??"")}/></label><label>本次完成数量<input name="quantity" type="number" min="1" required defaultValue={Number(data.quantity??1)}/></label>
      <label>咨询师成本单价（元）<input name="consultantCostUnit" type="number" min="0" step="0.01" value={consultantCostUnit} onChange={e=>setConsultantCostUnit(e.target.value)} required={isAcceptedRecord(record)} placeholder="验收时必填"/></label>
      <label>物料成本单价（元）<input name="materialCostUnit" type="number" min="0" step="0.01" value={materialCostUnit} onChange={e=>setMaterialCostUnit(e.target.value)} required={isAcceptedRecord(record)} placeholder="无物料成本请填0"/></label>
      <label>满意度（10分制，选填）<input name="satisfaction" type="number" min="0" max="10" step="0.01" defaultValue={data.satisfaction===undefined?"":Number(data.satisfaction)} placeholder="支持两位小数"/></label>
      <div className="profit-preview"><small>单条利润率</small><strong className={profitRate!==null&&profitRate<0?"negative-profit":""}>{profitRate===null?"填写成本后计算":`${profitRate.toFixed(1)}%`}</strong></div>
      <RecordDetailFields recordType={recordType} data={data} required={isAcceptedRecord(record)}/></div>
    <div className="modal-actions"><button type="button" onClick={close}>取消</button><button className="primary">保存修改</button></div></form>;
}
function ServiceCatalog({items,tags,canManageTags,onChange,onAdd,onAddTag,onToggleTag}:{items:ServiceTemplate[];tags:ProjectTag[];canManageTags:boolean;onChange:(items:ServiceTemplate[])=>void;onAdd:()=>void;onAddTag:(name:string)=>Promise<void>;onToggleTag:(tag:ProjectTag)=>Promise<void>}) {
  const [tagName,setTagName]=useState("");
  return <section className="content-card"><div className="section-title"><div><h2>服务目录</h2><p>统一维护服务名称；项目中的数量、单位和金额仍分别设置</p></div><button className="primary" onClick={onAdd}>＋ 新增服务名称</button></div>
    <div className="catalog-note">服务目录仅定义“提供什么服务”，不设置统一价格。修改名称后，新建项目将使用最新目录。</div>
    <div className="catalog-table"><div className="catalog-row heading"><span>服务名称</span><span>分类</span><span>默认单位</span><span>使用项目数</span><span>状态</span><span>操作</span></div>
      {items.map(item=><div className="catalog-row" key={item.id}><strong>{item.name}</strong><span>{item.category}</span><span>{item.defaultUnit}</span><span>—</span><Status value={item.enabled?"正常":"已停用"}/><span><button onClick={()=>onChange(items.map(x=>x.id===item.id?{...x,enabled:!x.enabled}:x))}>{item.enabled?"停用":"启用"}</button><button className="danger-text" onClick={()=>onChange(items.filter(x=>x.id!==item.id))}>删除</button></span></div>)}
    </div>
    <section className="tag-library"><div className="section-title"><div><h2>项目标签库</h2><p>项目只能选择标签库中的标签，停用后不影响历史项目</p></div></div>
      {canManageTags&&<form className="tag-create" action={async form=>{const name=String(form.get("tagName")??"").trim();if(!name)return;await onAddTag(name);setTagName("")}}><input name="tagName" value={tagName} maxLength={30} onChange={event=>setTagName(event.target.value)} placeholder="输入新标签，如：金融、年度服务"/><button className="primary">＋ 添加标签</button></form>}
      <div className="tag-library-list">{tags.map(tag=><div key={tag.id}><Status value={tag.enabled?"正常":"已停用"}/><strong>{tag.name}</strong>{canManageTags&&<button onClick={()=>void onToggleTag(tag)}>{tag.enabled?"停用":"启用"}</button>}</div>)}{!tags.length&&<div className="empty-records compact"><span>暂无项目标签</span></div>}</div>
    </section></section>;
}

type ProjectLibraryFile={id:number;projectId:number;name:string;category?:string|null;size?:number;contentType?:string;createdAt:string};
function ProjectFileLibrary({projects}:{projects:Project[]}){
  const [files,setFiles]=useState<ProjectLibraryFile[]>([]),[query,setQuery]=useState(""),[projectId,setProjectId]=useState<number|"all">("all"),[category,setCategory]=useState("all");
  useEffect(()=>{fetch(appPath("/api/files?library=1"),{cache:"no-store"}).then(response=>response.ok?response.json():{files:[]}).then(data=>setFiles(data.files??[])).catch(()=>undefined)},[]);
  const categories=Array.from(new Set(files.map(file=>file.category).filter(Boolean) as string[])).sort((a,b)=>a.localeCompare(b,"zh-CN"));
  const visible=files.filter(file=>(projectId==="all"||file.projectId===projectId)&&(category==="all"||file.category===category)&&(!query.trim()||file.name.toLowerCase().includes(query.trim().toLowerCase())||projects.find(project=>project.id===file.projectId)?.name.toLowerCase().includes(query.trim().toLowerCase())));
  return <section className="content-card"><div className="section-title"><div><h2>项目资料库</h2><p>跨项目检索成果报告、发票、客户评价等资料，下载后可直接复用</p></div></div>
    <div className="library-filters"><label><span>搜索资料</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="输入文件名或项目名"/></label><label><span>所属项目</span><ProjectSearchSelect allowAll projects={projects.filter(project=>!project._archivedAt)} value={projectId} onChange={setProjectId}/></label><label><span>资料类别</span><select value={category} onChange={event=>setCategory(event.target.value)}><option value="all">全部类别</option>{categories.map(item=><option key={item}>{item}</option>)}</select></label></div>
    <div className="library-list"><div className="library-row heading"><span>文件名</span><span>所属项目</span><span>类别</span><span>大小</span><span>上传时间</span><span>操作</span></div>{visible.map(file=><div className="library-row" key={file.id}><strong>{file.name}</strong><span>{projects.find(project=>project.id===file.projectId)?.name??"已归档项目"}</span><Status value={file.category??"其他资料"}/><span>{file.size?`${(file.size/1024/1024).toFixed(1)} MB`:"—"}</span><span>{new Date(file.createdAt).toLocaleDateString("zh-CN")}</span><a href={appPath(`/api/files?id=${file.id}`)} target="_blank" rel="noreferrer">下载复用</a></div>)}{!visible.length&&<div className="empty-records"><strong>暂无匹配资料</strong><span>项目结项时上传的资料会自动汇入这里</span></div>}</div>
  </section>;
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
