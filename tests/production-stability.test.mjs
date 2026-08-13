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

test("project manager assignment accepts active accounts and supports multi-select", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const route = await read("app/api/projects/route.ts");
  assert.match(dashboard, /filter\(account=>account\.active\)/);
  assert.match(dashboard, /name="managerIds"/);
  assert.match(dashboard, /currentUser\.role==="项目经理"/);
  assert.match(dashboard, /可多选；项目经理新建时默认选择本人/);
  assert.match(route, /normalizeProjectManagers/);
  assert.doesNotMatch(route, /eq\(users\.role,"项目经理"\)/);
  assert.match(route, /eq\(users\.active,true\)/);
  assert.match(route, /至少选择一人/);
});

test("project services capture contract detail without a draft action", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const route = await read("app/api/projects/route.ts");
  assert.match(dashboard, /name="contractDetail"/);
  assert.match(dashboard, /合同详情说明，如：压力管理专题讲座/);
  assert.match(dashboard, /s\.contractDetail\|\|"未填写合同详情说明"/);
  assert.doesNotMatch(dashboard, /保存草稿/);
  assert.match(route, /合同详情说明不能超过500字/);
});

test("task management supports CRUD filters and service record links", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const route = await read("app/api/tasks/route.ts");
  const styles = await read("app/globals.css");
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
  assert.match(route, /derivedTaskStatus/);
  assert.match(route, /\["已验收","已完成"\]/);
  assert.match(dashboard, /项目级任务/);
  assert.match(dashboard, /lockProject=\{Boolean\(taskRecordTarget\)\}/);
  assert.match(dashboard, /所属项目（任务已锁定）/);
  assert.match(dashboard, /record\.projectId===projectId&&\(!isAcceptedRecord\(record\)\|\|recordIds\.includes\(record\.id\)\)/);
  assert.match(route, /只能关联同一项目下尚未验收的有效服务记录/);
  assert.match(route, /records\.length>0&&records\.every/);
  assert.match(styles, /\.task-actions \.primary\{[^}]*background:var\(--blue\)[^}]*color:#fff!important/);
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

test("external and manager records follow the unified two-stage acceptance flow", async () => {
  const dashboard = await readFile(new URL("../app/ui/DashboardApp.tsx", import.meta.url), "utf8");
  const recordsRoute = await readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8");
  const linksRoute = await readFile(new URL("../app/api/form-links/route.ts", import.meta.url), "utf8");
  assert.match(dashboard, /台账模板随服务内容自动匹配/);
  assert.match(dashboard, /function TaskRecordMethodDialog/);
  assert.match(dashboard, /项目经理填写/);
  assert.match(dashboard, /外部填写链接/);
  assert.match(dashboard, /onGenerated/);
  assert.match(dashboard, /function AcceptanceRecordForm/);
  assert.match(dashboard, /补全信息并完成验收/);
  assert.match(linksRoute, /status:"待填写"/);
  assert.match(recordsRoute, /eq\(serviceRecords\.status,"待填写"\)/);
  assert.match(recordsRoute, /status="待验收"/);
  assert.match(recordsRoute, /validateForAcceptance/);
  assert.match(recordsRoute, /const hasFrozenFinance=isAccepted\(nextStatus\)/);
  assert.match(recordsRoute, /recordTypeForServiceName\(target\.service\.name\)/);
  assert.match(linksRoute, /record:pendingRecord/);
});

test("consultant aggregation uses approved provider records and frozen cost prices", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  assert.match(dashboard, /\["consultants", "♧", "咨询师归集"\]/);
  assert.match(dashboard, /function Consultants/);
  assert.match(dashboard, /records\.filter\(isAcceptedRecord\)/);
  assert.match(dashboard, /record\.payload\.data\?\.provider/);
  assert.match(dashboard, /consultantCost\(record\)/);
  assert.match(dashboard, /materialCost\(record\)/);
  assert.match(dashboard, /record\.costAmountSnapshot/);
  assert.match(dashboard, /同一咨询师的不同服务、不同验收成本分别归集/);
  assert.match(dashboard, /输入姓名模糊搜索/);
});

test("service records use date ranges, assessment records, and split cost inputs", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const externalForm = await read("app/form/[token]/service-form.tsx");
  const recordRoute = await read("app/api/records/route.ts");
  const linkRoute = await read("app/api/form-links/route.ts");
  const recordTypes = await read("app/service-record-types.ts");
  for (const source of [dashboard, externalForm]) {
    assert.match(source, /name="startDate"/);
    assert.match(source, /name="endDate"/);
  }
  for (const type of ["讲座／团辅活动记录","心理咨询台账","培训活动记录","驻场服务记录","EAP宣传记录","心理测评记录"]) assert.match(recordTypes, new RegExp(type));
  for (const source of [dashboard, linkRoute, recordRoute]) assert.match(source, /recordTypeForServiceName/);
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
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const schema = await read("db/schema.ts");
  const migration = await read("drizzle/0013_form_link_remark.sql");
  assert.match(route, /randomHex\(24\)/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /submissionCount/);
  assert.match(route, /请填写活动备注，方便识别该链接/);
  assert.match(route, /remark,expiresAt/);
  assert.match(dashboard, /name="remark"/);
  assert.match(dashboard, /link\.remark\|\|"历史链接未填写备注"/);
  assert.match(schema, /remark: text\("remark"\)\.notNull\(\)\.default\(""\)/);
  assert.match(migration, /ALTER TABLE `form_links` ADD `remark` text DEFAULT '' NOT NULL/);
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

test("external forms use the selected record type and defer full validation to acceptance", async () => {
  const form = await read("app/form/[token]/service-form.tsx");
  const route = await read("app/api/records/route.ts");
  for (const service of ["线上咨询","线下咨询","驻场咨询"]) {
    assert.match(form, new RegExp(service));
    assert.match(route, new RegExp(service));
  }
  assert.match(form, /meta\.formType==="心理咨询台账"/);
  assert.match(form, /咨询时长（分钟）/);
  assert.match(form, /咨询概括/);
  assert.match(form, /defaultValue=\{meta\.startDate\}/);
  assert.match(route, /validateInitiation\(type,body\.data\)/);
  assert.match(route, /validateForAcceptance\(type,nextPayload\.data\)/);
  assert.match(route, /咨询时长必须大于0且不超过1440分钟/);
});

test("P0 acceptance, payment, cent-precision amounts, and selectable VAT project closure are enforced", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const projectRoute = await read("app/api/projects/route.ts");
  const recordsRoute = await read("app/api/records/route.ts");
  const money = await read("app/money.ts");
  const uploadRoute = await read("app/api/upload/route.ts");
  const migration = await read("drizzle/0012_acceptance_payment_closure.sql");
  assert.match(dashboard, /function ProjectClosureDialog/);
  assert.match(dashboard, /验收后更新项目进度/);
  assert.match(dashboard, /确认支付/);
  assert.match(projectRoute, /action==="close"/);
  assert.match(projectRoute, /includeVatCost=body\.includeVatCost!==false/);
  assert.match(projectRoute, /taxRateBasisPoints=includeVatCost\?600:0/);
  assert.match(dashboard, /增加增值税成本（6%）/);
  assert.match(dashboard, /minimumFractionDigits:2,maximumFractionDigits:2/);
  assert.match(dashboard, /step="0\.01"/);
  assert.match(recordsRoute, /roundMoney\(unitPrice\*quantityOf/);
  assert.match(money, /Math\.round\(\(value \+ Number\.EPSILON\) \* 100\) \/ 100/);
  assert.match(projectRoute, /已验收记录成本未支付/);
  assert.match(recordsRoute, /action==="payment"/);
  assert.match(recordsRoute, /refreshLinkedTasks/);
  assert.match(uploadRoute, /成果报告/);
  assert.match(uploadRoute, /客户评价/);
  assert.match(migration, /payment_status/);
  assert.match(migration, /closed_at/);
});

test("dashboard scope, tags, presales, annual billing, satisfaction, and file library are implemented", async () => {
  const dashboard = await read("app/ui/DashboardApp.tsx");
  const projectRoute = await read("app/api/projects/route.ts");
  const recordRoute = await read("app/api/records/route.ts");
  const filesRoute = await read("app/api/files/route.ts");
  const access = await read("app/project-access.ts");
  const tagMigration = await read("drizzle/0014_project_tags.sql");
  assert.match(dashboard, /dashboardManagerId/);
  assert.match(dashboard, /全局所有项目/);
  assert.match(dashboard, /的项目<\/option>/);
  assert.match(dashboard, /project\.managerIds\?\.includes\(dashboardManagerId\)/);
  assert.match(dashboard, /name="priority"/);
  assert.match(dashboard, /name="tags"/);
  assert.match(dashboard, /name="presalesContributorIds"/);
  assert.match(dashboard, /name="financialContractNo"/);
  assert.match(dashboard, /可在创建后编辑补录/);
  assert.match(dashboard, /标书撰写、方案设计、测评设计/);
  assert.match(dashboard, /annual-time/);
  assert.match(dashboard, /name="satisfaction"/);
  assert.match(dashboard, /max="10" step="0\.01"/);
  assert.match(dashboard, /function ProjectFileLibrary/);
  assert.match(projectRoute, /年包按时间确认收入/);
  assert.match(projectRoute, /财务合同编号不能超过100字/);
  assert.match(recordRoute, /满意度必须是0到10分之间、最多两位小数/);
  assert.match(filesRoute, /library=url\.searchParams\.get\("library"\)==="1"/);
  assert.match(access, /payload\.managerIds\.includes\(user\.id\)/);
  assert.match(tagMigration, /CREATE TABLE `project_tags`/);
});
