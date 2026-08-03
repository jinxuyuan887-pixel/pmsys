import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("production migration preserves history and freezes delivery money", async () => {
  const sql = await read("drizzle/0008_production_stability.sql");
  assert.match(sql, /archived_at/);
  assert.match(sql, /deleted_at/);
  assert.match(sql, /unit_price_snapshot/);
  assert.match(sql, /amount_snapshot/);
  assert.match(sql, /is_demo/);
  assert.match(sql, /file_attachments/);
});

test("record API uses soft deletion and server-side amount snapshots", async () => {
  const route = await read("app/api/records/route.ts");
  assert.doesNotMatch(route, /delete\(serviceRecords\)/);
  assert.match(route, /amountSnapshot/);
  assert.match(route, /unitPriceSnapshot/);
  assert.match(route, /deletedAt/);
  assert.match(route, /projectService\(projectId,serviceId\)/);
  assert.match(route, /costUnitSnapshot/);
  assert.match(route, /costAmountSnapshot/);
  assert.match(route, /profitRateBasisPoints/);
  assert.match(route, /咨询师成本和物料成本/);
});

test("record cost migration supports frozen profit calculations", async () => {
  const sql = await read("drizzle/0009_record_cost_profit.sql");
  assert.match(sql, /cost_unit_snapshot/);
  assert.match(sql, /cost_amount_snapshot/);
  assert.match(sql, /profit_rate_basis_points/);
});

test("full demo portfolio seeds ten projects and two hundred service records", async () => {
  const sql = await read("drizzle/0010_seed_full_demo_portfolio.sql");
  assert.match(sql, /n < 10/);
  assert.match(sql, /seq < 200/);
  assert.match(sql, /seq % 20 = 0 THEN '待审核'/);
  for (const service of ["EAP大使培训","心理讲座","心理团辅","线上咨询","线下咨询","驻场咨询","心理测评","EAP宣传"]) {
    assert.match(sql, new RegExp(service));
  }
  assert.match(sql, /`is_demo`/);
  assert.doesNotMatch(sql, /audit_logs/);
});

test("service record project selection supports fuzzy searching", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  assert.match(dashboard, /function ProjectSearchSelect/);
  assert.match(dashboard, /\.includes\(normalized\)/);
  assert.match(dashboard, /aria-autocomplete="list"/);
  assert.match(dashboard, /allowAll projects=/);
  assert.match(dashboard, /name="projectId" projects=/);
});

test("project and service record views filter by project manager", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  assert.match(dashboard, /const \[managerFilter,setManagerFilter\]=useState\("all"\)/);
  assert.match(dashboard, /projectHasManager\(project,managerFilter\)/);
  assert.match(dashboard, /全部项目经理/);
  assert.match(dashboard, /managerProjectIds\.has\(record\.projectId\)/);
  assert.match(dashboard, /onManagerFilterChange\(event\.target\.value\);setProjectId\("all"\)/);
});

test("project managers come from active manager accounts and support multi-select", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const route = await read("app/api/projects/route.ts");
  assert.match(dashboard, /account\.role==="项目经理"&&account\.active/);
  assert.match(dashboard, /name="managerIds"/);
  assert.match(dashboard, /currentUser\.role==="项目经理"/);
  assert.match(dashboard, /可多选；项目经理新建时默认选择本人/);
  assert.match(route, /normalizeProjectManagers/);
  assert.match(route, /eq\(users\.role,"项目经理"\)/);
  assert.match(route, /eq\(users\.active,true\)/);
  assert.match(route, /至少选择一人/);
});

test("project services capture contract detail without a draft action", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const route = await read("app/api/projects/route.ts");
  assert.match(dashboard, /name="contractDetail"/);
  assert.match(dashboard, /合同详情说明用于区分同一大类下的具体服务细项/);
  assert.match(dashboard, /s\.contractDetail\|\|"未填写合同详情说明"/);
  assert.doesNotMatch(dashboard, /保存草稿/);
  assert.match(route, /合同详情说明不能超过500字/);
});

test("task management supports CRUD filters and service record links", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const route = await read("app/api/tasks/route.ts");
  const migration = await read("drizzle/0011_task_record_links.sql");
  assert.match(dashboard, /\["tasks", "☑", "任务管理"\]/);
  assert.match(dashboard, /function TaskManagement/);
  assert.match(dashboard, /新增服务记录/);
  assert.match(dashboard, /record\.status==="待审核"/);
  assert.match(dashboard, /审核/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /已完成任务必须至少关联一条服务记录/);
  assert.match(route, /只能关联同一项目、同一服务下的有效服务记录/);
  assert.match(migration, /delivery_task_records/);
});

test("service records expose a read-only detail view with image previews", async () => {
  const dashboard = await readFile(new URL("../app/ui/DashboardApp.tsx", import.meta.url), "utf8");
  const filesRoute = await readFile(new URL("../app/api/files/route.ts", import.meta.url), "utf8");
  assert.match(dashboard, /onView=\{\(record\)=>\{setViewingRecord\(record\);setModal\("viewRecord"\)\}\}/);
  assert.match(dashboard, />查看<\/button>/);
  assert.match(dashboard, /function ViewRecordDialog/);
  assert.match(dashboard, /<Attachments recordId=\{record\.id\} previewImages\/>/);
  assert.match(dashboard, /file\.contentType\?\.startsWith\("image\/"\)/);
  assert.match(filesRoute, /searchParams\.get\("inline"\)==="1"/);
  assert.match(filesRoute, /"x-content-type-options":"nosniff"/);
});

test("external link dialog omits the redundant pending-review control", async () => {
  const dashboard = await readFile(new URL("../app/ui/DashboardApp.tsx", import.meta.url), "utf8");
  const recordsRoute = await readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(dashboard, /提交后进入待审核状态/);
  assert.match(dashboard, /提交后自动归集并进入待审核/);
  assert.match(dashboard, /className="full">允许提交次数/);
  assert.match(recordsRoute, /body\.token\?"待审核":"已完成"/);
});

test("consultant aggregation uses approved provider records and frozen cost prices", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  assert.match(dashboard, /\["consultants", "♧", "咨询师归集"\]/);
  assert.match(dashboard, /function Consultants/);
  assert.match(dashboard, /record\.status==="已完成"/);
  assert.match(dashboard, /record\.payload\.data\?\.provider/);
  assert.match(dashboard, /consultantCost\(record\)/);
  assert.match(dashboard, /materialCost\(record\)/);
  assert.match(dashboard, /record\.costAmountSnapshot/);
  assert.match(dashboard, /同一咨询师的不同服务、不同审核价格分别归集/);
  assert.match(dashboard, /输入姓名模糊搜索/);
});

test("service records use date ranges, assessment records, and split cost inputs", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const externalForm = await read("app/form/[token]/service-form.tsx");
  const recordRoute = await read("app/api/records/route.ts");
  const linkRoute = await read("app/api/form-links/route.ts");
  for (const source of [dashboard, externalForm]) {
    assert.match(source, /name="startDate"/);
    assert.match(source, /name="endDate"/);
  }
  for (const source of [dashboard, linkRoute, recordRoute]) assert.match(source, /心理测评记录/);
  assert.match(dashboard, /name="consultantCostUnit"/);
  assert.match(dashboard, /name="materialCostUnit"/);
  assert.match(recordRoute, /consultantCostOf/);
  assert.match(recordRoute, /materialCostOf/);
  assert.match(recordRoute, /服务结束日期不能早于开始日期/);
  assert.match(dashboard, /咨询师成本/);
  assert.match(dashboard, /物料成本/);
});

test("new project price inputs start blank instead of displaying zero", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  assert.match(dashboard, /item\.unitPrice===0\?"":item\.unitPrice/);
  assert.match(dashboard, /\(item\.costPrice\?\?0\)===0\?"":item\.costPrice/);
});

test("project deletion is archival and demo projects are marked", async () => {
  const route = await read("app/api/projects/route.ts");
  assert.doesNotMatch(route, /delete\(projects\)/);
  assert.match(route, /archivedAt/);
  assert.match(route, /_isDemo/);
});

test("external links support management and strong random tokens", async () => {
  const route = await read("app/api/form-links/route.ts");
  assert.match(route, /randomHex\(24\)/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /submissionCount/);
});

test("external link copy supports HTTP deployments and the pmsys base path", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  assert.match(dashboard, /window\.isSecureContext/);
  assert.match(dashboard, /document\.execCommand\("copy"\)/);
  assert.match(dashboard, /location\.origin\}\$\{appPath\(`/);
  assert.doesNotMatch(dashboard, /navigator\.clipboard\?\.writeText/);
});

test("project reset restores the original seven-item service catalog", async () => {
  const reset = await read("scripts/reset-projects-and-catalog.sql");
  for (const service of ["EAP大使培训","心理讲座","心理团辅","线上咨询","线下咨询","驻场咨询","心理测评"]) {
    assert.match(reset, new RegExp(service));
  }
  assert.doesNotMatch(reset, /EAP宣传/);
  for (const table of ["file_attachments","form_links","service_records","delivery_tasks","weekly_snapshots","project_versions","projects"]) {
    assert.match(reset, new RegExp(`DELETE FROM ${table}`));
  }
});

test("external forms show consultation fields only for consultation services", async () => {
  const form = await read("app/form/[token]/service-form.tsx");
  const route = await read("app/api/records/route.ts");
  for (const service of ["线上咨询","线下咨询","驻场咨询"]) {
    assert.match(form, new RegExp(service));
    assert.match(route, new RegExp(service));
  }
  assert.match(form, /consultationServices\.has\(meta\.serviceName\)/);
  assert.match(form, /咨询时长（分钟）/);
  assert.match(form, /咨询概括/);
  assert.match(route, /validateExternalService\(target\.service\.name,body\.data\)/);
  assert.match(route, /type=recordTypeForService\(target\.service\.name,type\)/);
  assert.match(route, /咨询时长必须大于0且不超过1440分钟/);
});
