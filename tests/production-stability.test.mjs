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
  assert.match(route, /请填写本次成本单价后再审核通过/);
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
