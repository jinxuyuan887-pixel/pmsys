import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("analytics API tokens are hashed, scoped, expirable, and locally ignored", async () => {
  const [schema, migration, auth, creator, ignore] = await Promise.all([
    read("db/schema.ts"), read("drizzle/0015_analytics_api_tokens.sql"), read("app/analytics-auth.ts"),
    read("scripts/create-analytics-token.mjs"), read(".gitignore"),
  ]);
  assert.match(schema, /apiTokens/);
  assert.match(migration, /token_hash/);
  assert.match(migration, /analytics:read/);
  assert.match(auth, /Bearer/);
  assert.match(auth, /tokenHash\(bearer\)/);
  assert.match(auth, /analytics:read/);
  assert.doesNotMatch(auth, /eq\(apiTokens\.tokenHash,bearer\)/);
  assert.match(creator, /randomBytes\(32\)/);
  assert.match(creator, /createHash\("sha256"\)/);
  assert.match(creator, /mode: 0o600/);
  assert.match(ignore, /\.secrets/);
});

test("weekly analytics expose stable project, workload, task, finance, and risk summaries", async () => {
  const [data, weekly, projects, workload, tasks, risks] = await Promise.all([
    read("app/analytics-data.ts"), read("app/api/v1/analytics/weekly/route.ts"),
    read("app/api/v1/analytics/projects/route.ts"), read("app/api/v1/analytics/workload/route.ts"),
    read("app/api/v1/analytics/tasks/route.ts"), read("app/api/v1/analytics/risks/route.ts"),
  ]);
  for (const source of [weekly, projects, workload, tasks, risks]) {
    assert.match(source, /requireAnalyticsPrincipal/);
    assert.match(source, /analyticsPeriod/);
    assert.match(source, /analyticsJson/);
  }
  assert.match(weekly, /deliveryAmountChangeRate/);
  assert.match(weekly, /taskCompletionNote/);
  assert.match(projects, /projectProgress/);
  assert.match(workload, /consultants/);
  assert.match(workload, /projectManagers/);
  assert.match(workload, /taskOwners/);
  assert.match(tasks, /overdueDays/);
  for (const rule of ["task_overdue", "record_pending", "payment_pending", "service_risk", "project_schedule", "project_stalled", "annual_delivery_gap"]) {
    assert.match(data, new RegExp(rule));
  }
  assert.match(risks, /severity/);
});

test("analytics documentation records date, authorization, and HTTPS constraints", async () => {
  const docs = await read("docs/analytics-api.md");
  assert.match(docs, /Authorization: Bearer/);
  assert.match(docs, /service_date/);
  assert.match(docs, /approved_at/);
  assert.match(docs, /completed_at/);
  assert.match(docs, /HTTPS/);
});
