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
