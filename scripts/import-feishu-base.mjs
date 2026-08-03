import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = new Map(process.argv.slice(2).map((value, index, all) => {
  if (!value.startsWith("--")) return [value, true];
  const next = all[index + 1];
  return [value, next && !next.startsWith("--") ? next : true];
}));

const sourceDir = String(args.get("--source-dir") || "/private/tmp");
const databasePath = String(args.get("--database"));
const apply = args.has("--apply");
if (!databasePath) throw new Error("--database is required");

function readRows(name) {
  const envelope = JSON.parse(readFileSync(`${sourceDir}/eap-base-${name}.json`, "utf8"));
  const { data, fields, record_id_list: recordIds, has_more: hasMore } = envelope.data;
  if (hasMore) throw new Error(`${name} still has unread pages`);
  return recordIds.map((id, index) => ({
    id,
    fields: Object.fromEntries(fields.map((field, fieldIndex) => [field, data[index][fieldIndex]])),
  }));
}

const projects = readRows("projects");
const mappings = readRows("mappings");
const sessions = readRows("sessions");
const pools = readRows("pools");
const updates = readRows("updates");
const catalog = readRows("catalog");
const baseTasks = readRows("tasks");

const first = (value) => Array.isArray(value) ? value[0] : value;
const linkedId = (value) => Array.isArray(value) && value[0]?.id ? value[0].id : null;
const selected = (value) => {
  const item = first(value);
  return typeof item === "string" ? item : "";
};
const person = (value) => Array.isArray(value) && value[0]?.name ? value[0].name : "";
const numeric = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const day = (value) => typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "";
const sql = (value) => value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const jsonSql = (value) => sql(JSON.stringify(value));

const managerUsernames = new Map([
  ["蓝津建", "lanjinjian"],
  ["邹晓红", "zouxiaohong"],
  ["程慧", "chenghui"],
]);

const projectBySourceId = new Map();
projects.forEach((project, index) => {
  projectBySourceId.set(project.id, {
    ...project,
    localId: 100001 + index,
    manager: person(project.fields["项目负责人"]),
  });
});

const catalogBySourceId = new Map();
catalog.forEach((item, index) => {
  catalogBySourceId.set(item.id, {
    localId: index + 1,
    name: String(item.fields["内部服务名称"] || "其他服务").trim(),
    unit: selected(item.fields["默认交付单位"]) || "项目",
    category: selected(item.fields["标准服务大类"]) || "其他服务",
    enabled: selected(item.fields["启用状态"]) !== "停用",
  });
});

const mappingBySourceId = new Map();
const servicesByProject = new Map();
mappings.forEach((mapping, index) => {
  const project = projectBySourceId.get(linkedId(mapping.fields["关联项目"]));
  if (!project) return;
  const catalogItem = catalogBySourceId.get(linkedId(mapping.fields["内部标准服务"]));
  const contractQuantity = numeric(mapping.fields["合同数量"]);
  const sourceCompleted = numeric(mapping.fields["已完成数量"]);
  const quantityProvisional = contractQuantity <= 0;
  const quantity = contractQuantity > 0 ? contractQuantity : Math.max(sourceCompleted, 1);
  const explicitUnitPrice = numeric(mapping.fields["合同单价"]);
  const totalPrice = numeric(mapping.fields["合同总价（非必填）"]) || numeric(mapping.fields["合同服务金额"]);
  const unitPrice = explicitUnitPrice > 0 ? explicitUnitPrice : totalPrice > 0 && quantity > 0 ? totalPrice / quantity : 0;
  const service = {
    id: 200001 + index,
    name: catalogItem?.name || String(mapping.fields["合同内服务名称（客户原文）"] || "其他服务").trim(),
    contractName: String(mapping.fields["合同内服务名称（客户原文）"] || "").trim(),
    unit: selected(mapping.fields["服务单位"]) || catalogItem?.unit || "项目",
    quantity,
    completed: 0,
    unitPrice,
    costPrice: 0,
    sourceMappingRecordId: mapping.id,
    sourceContractQuantity: contractQuantity || null,
    sourceCompletedQuantity: sourceCompleted,
    quantityProvisional,
    managementMethod: selected(mapping.fields["管理方式"]),
    incomeSettlement: selected(mapping.fields["收入结算方式"]),
    specification: String(mapping.fields["服务规格描述（合同原文）"] || "").trim(),
  };
  mappingBySourceId.set(mapping.id, { ...mapping, project, service });
  const list = servicesByProject.get(project.id) || [];
  list.push(service);
  servicesByProject.set(project.id, list);
});

function recordType(serviceName) {
  if (serviceName.includes("测评")) return "心理测评记录";
  if (serviceName.includes("咨询") || serviceName.includes("热线")) return "心理咨询台账";
  if (serviceName.includes("驻场")) return "驻场服务记录";
  if (serviceName.includes("培训") || serviceName.includes("讲座")) return "培训活动记录";
  if (serviceName.includes("宣传") || serviceName.includes("课程")) return "EAP宣传记录";
  return "讲座／团辅活动记录";
}

const importedRecords = [];
const importedTasks = [];
const importedQuantityByMapping = new Map();
const addImportedQuantity = (mappingId, quantity) => {
  importedQuantityByMapping.set(mappingId, (importedQuantityByMapping.get(mappingId) || 0) + quantity);
};

sessions.forEach((session) => {
  const mappingId = linkedId(session.fields["合同内服务名称（从合同服务映射选择）"]);
  const mapping = mappingBySourceId.get(mappingId);
  const fallbackProject = projectBySourceId.get(linkedId(session.fields["关联项目"]));
  if (!mapping) {
    if (fallbackProject) {
      importedTasks.push({
        projectId: fallbackProject.localId,
        serviceId: 0,
        title: String(session.fields["场次主题"] || session.fields["场次编码"] || "客户交付场次").trim(),
        plannedDate: day(session.fields["计划时间"]) || null,
        owner: String(session.fields["服务专家/咨询师（非必填）"] || fallbackProject.manager || "").trim() || null,
        status: "待安排",
        sourceRecordId: session.id,
      });
    }
    return;
  }
  const returnStatus = selected(session.fields["回传状态"]);
  const completed = returnStatus === "已审核通过";
  const serviceDate = day(session.fields["实际完成时间（非必填）"]) || day(session.fields["计划时间"]);
  importedTasks.push({
    projectId: mapping.project.localId,
    serviceId: mapping.service.id,
    title: String(session.fields["场次主题"] || session.fields["场次编码"] || "客户交付场次").trim(),
    plannedDate: day(session.fields["计划时间"]) || null,
    owner: String(session.fields["服务专家/咨询师（非必填）"] || mapping.project.manager || "").trim() || null,
    status: completed ? "已完成" : "待安排",
    sourceRecordId: session.id,
  });
  if (!completed) return;
  const quantity = 1;
  const unitPrice = numeric(mapping.service.unitPrice);
  importedRecords.push({
    projectId: mapping.project.localId,
    serviceId: mapping.service.id,
    recordType: recordType(mapping.service.name),
    serviceDate,
    status: "已完成",
    unitPrice: unitPrice || null,
    amount: unitPrice || null,
    payload: {
      type: recordType(mapping.service.name),
      data: {
        source: "飞书客户交付场次迁移",
        provider: String(session.fields["服务专家/咨询师（非必填）"] || mapping.project.manager || "待补充").trim(),
        date: serviceDate,
        quantity,
        summary: String(session.fields["场次主题"] || "客户交付场次").trim(),
        participants: numeric(session.fields["参与人数（非必填）"]) || null,
        duration: numeric(session.fields["服务时长（非必填）"]) || null,
        feedback: String(session.fields["客户反馈（非必填）"] || "").trim() || null,
        nextAction: String(session.fields["后续动作（非必填）"] || "").trim() || null,
        sourceSessionRecordId: session.id,
        costPending: true,
      },
      uploaded: [],
    },
  });
  addImportedQuantity(mappingId, quantity);
});

const poolBySourceId = new Map();
pools.forEach((pool) => {
  const mappingId = linkedId(pool.fields["关联合同服务映射"]);
  const mapping = mappingBySourceId.get(mappingId);
  if (!mapping) return;
  poolBySourceId.set(pool.id, { ...pool, mapping });
});

updates.forEach((update) => {
  const pool = poolBySourceId.get(linkedId(update.fields["关联持续服务消耗池"]));
  if (!pool) return;
  const quantity = numeric(update.fields["本周期消耗次数"]);
  if (quantity <= 0) return;
  const approved = selected(update.fields["项目经理审核状态"]) === "审核通过";
  const serviceDate = day(update.fields["截止日期"]) || day(pool.fields["服务周期开始日期"]);
  const unitPrice = numeric(pool.mapping.service.unitPrice);
  importedRecords.push({
    projectId: pool.mapping.project.localId,
    serviceId: pool.mapping.service.id,
    recordType: recordType(pool.mapping.service.name),
    serviceDate,
    status: approved ? "已完成" : "待审核",
    unitPrice: approved && unitPrice > 0 ? unitPrice : null,
    amount: approved && unitPrice > 0 ? unitPrice * quantity : null,
    payload: {
      type: recordType(pool.mapping.service.name),
      data: {
        source: "飞书周期消耗更新迁移",
        provider: person(update.fields["更新人"]) || pool.mapping.project.manager || "待补充",
        date: serviceDate,
        quantity,
        summary: String(update.fields["更新记录名称"] || pool.fields["消耗池名称"] || "周期消耗更新").trim(),
        sourceUpdateRecordId: update.id,
        sourcePoolRecordId: pool.id,
        costPending: approved,
      },
      uploaded: [],
    },
  });
  if (approved) addImportedQuantity(pool.mapping.id, quantity);
});

// Preserve the Base-calculated completed quantity exactly. This also covers
// historical consumption that predates the retained period update rows.
for (const [mappingId, mapping] of mappingBySourceId) {
  const expected = numeric(mapping.fields["已完成数量"]);
  const imported = importedQuantityByMapping.get(mappingId) || 0;
  const adjustment = expected - imported;
  if (adjustment <= 0) continue;
  const unitPrice = numeric(mapping.service.unitPrice);
  importedRecords.push({
    projectId: mapping.project.localId,
    serviceId: mapping.service.id,
    recordType: recordType(mapping.service.name),
    serviceDate: day(mapping.project.fields["启动日期"]),
    status: "已完成",
    unitPrice: unitPrice || null,
    amount: unitPrice > 0 ? unitPrice * adjustment : null,
    payload: {
      type: recordType(mapping.service.name),
      data: {
        source: "飞书历史累计迁移",
        provider: mapping.project.manager || "待补充",
        date: day(mapping.project.fields["启动日期"]),
        quantity: adjustment,
        summary: `迁移飞书已完成累计数量 ${adjustment}`,
        sourceMappingRecordId: mappingId,
        costPending: true,
      },
      uploaded: [],
    },
  });
  addImportedQuantity(mappingId, adjustment);
}

let importedBaseTaskCount = 0;
for (const task of baseTasks) {
  const project = projectBySourceId.get(linkedId(task.fields["关联项目"]));
  if (!project) continue;
  importedBaseTaskCount += 1;
  importedTasks.push({
    projectId: project.localId,
    serviceId: 0,
    title: String(task.fields["任务名称"] || "项目推进任务").trim(),
    plannedDate: day(task.fields["截止日期"]) || null,
    owner: person(task.fields["负责人"]) || project.manager || null,
    status: selected(task.fields["任务状态"]) || "待安排",
    sourceRecordId: task.id,
  });
}

const accountSpecs = [
  { username: "lanjinjian", name: "蓝津建" },
  { username: "zouxiaohong", name: "邹晓红" },
  { username: "chenghui", name: "程慧" },
].map((account) => {
  const password = `${randomBytes(6).toString("base64url")}Aa9!`;
  const salt = randomBytes(16).toString("hex");
  const passwordHash = pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return { ...account, password, salt, passwordHash };
});

const statements = ["PRAGMA foreign_keys=OFF;", "BEGIN IMMEDIATE;"];
statements.push(
  "DELETE FROM file_attachments;",
  "DELETE FROM form_links;",
  "DELETE FROM service_records;",
  "DELETE FROM delivery_tasks;",
  "DELETE FROM weekly_snapshots;",
  "DELETE FROM project_versions;",
  "DELETE FROM projects;",
  "DELETE FROM service_catalog;",
  "DELETE FROM audit_logs;",
  "DELETE FROM login_attempts;",
  "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username <> 'ydleapadmin');",
  "DELETE FROM users WHERE username <> 'ydleapadmin';",
);

for (const item of catalogBySourceId.values()) {
  statements.push(`INSERT INTO service_catalog (id,name,default_unit,category,enabled) VALUES (${item.localId},${sql(item.name)},${sql(item.unit)},${sql(item.category)},${item.enabled ? 1 : 0});`);
}

for (const project of projectBySourceId.values()) {
  const fields = project.fields;
  const serviceList = servicesByProject.get(project.id) || [];
  const contractAmount = numeric(fields["合同金额"]);
  const serviceAmount = serviceList.reduce((sum, service) => sum + numeric(service.quantity) * numeric(service.unitPrice), 0);
  const stage = selected(fields["项目阶段"]);
  const riskLevel = selected(fields["风险等级（非必填）"]);
  const payload = {
    id: project.localId,
    name: String(fields["项目名称"] || fields["客户名称"] || project.id).trim(),
    manager: project.manager,
    managerUsername: managerUsernames.get(project.manager) || null,
    status: stage === "验收结项" ? "已完成" : stage ? "执行中" : "待启动",
    risk: riskLevel === "高" ? "风险" : riskLevel === "中" ? "预警" : "正常",
    start: day(fields["启动日期"]),
    end: day(fields["计划结项日期"]),
    total: contractAmount || serviceAmount,
    contract: String(fields["合同编号"] || fields["项目编码"] || "").trim(),
    services: serviceList,
    customerName: String(fields["客户名称"] || "").trim(),
    projectCode: String(fields["项目编码"] || "").trim(),
    incomeMode: selected(fields["收入模式"]),
    setupStatus: selected(fields["建项检查状态"]),
    source: "feishu-base",
    sourceProjectRecordId: project.id,
  };
  statements.push(`INSERT INTO projects (id,payload,version,is_demo) VALUES (${project.localId},${jsonSql(payload)},1,0);`);
  statements.push(`INSERT INTO project_versions (project_id,version,payload,changed_by) VALUES (${project.localId},1,${jsonSql(payload)},'飞书迁移');`);
}

for (const account of accountSpecs) {
  statements.push(`INSERT INTO users (username,name,role,password_hash,password_salt,active,must_change_password) VALUES (${sql(account.username)},${sql(account.name)},'项目经理',${sql(account.passwordHash)},${sql(account.salt)},1,1);`);
}

for (const task of importedTasks) {
  statements.push(`INSERT INTO delivery_tasks (project_id,service_id,title,planned_date,owner,status) VALUES (${task.projectId},${task.serviceId},${sql(task.title)},${sql(task.plannedDate)},${sql(task.owner)},${sql(task.status)});`);
}

for (const record of importedRecords) {
  const now = new Date().toISOString();
  statements.push(`INSERT INTO service_records (project_id,service_id,record_type,service_date,payload,status,unit_price_snapshot,amount_snapshot,cost_unit_snapshot,cost_amount_snapshot,profit_rate_basis_points,updated_at,approved_at) VALUES (${record.projectId},${record.serviceId},${sql(record.recordType)},${sql(record.serviceDate)},${jsonSql(record.payload)},${sql(record.status)},${record.unitPrice ?? "NULL"},${record.amount ?? "NULL"},NULL,NULL,NULL,${sql(now)},${record.status === "已完成" ? sql(now) : "NULL"});`);
}

statements.push(
  `INSERT INTO audit_logs (user_id,username,action,entity_type,entity_id,summary) SELECT id,username,'导入','飞书数据','migration',${sql(`导入 ${projects.length} 个项目、${mappings.length} 条合同服务、${importedRecords.length} 条服务记录和 ${importedTasks.length} 条交付任务`)} FROM users WHERE username='ydleapadmin';`,
  "COMMIT;",
  "PRAGMA foreign_keys=ON;",
);

const provisionalServices = [...mappingBySourceId.values()].filter((mapping) => mapping.service.quantityProvisional).length;
const report = {
  projects: projects.length,
  managerAssignments: Object.fromEntries([...managerUsernames.keys()].map((name) => [name, projects.filter((project) => person(project.fields["项目负责人"]) === name).length])),
  services: mappingBySourceId.size,
  provisionalServices,
  serviceRecords: importedRecords.length,
  completedRecords: importedRecords.filter((record) => record.status === "已完成").length,
  pendingRecords: importedRecords.filter((record) => record.status === "待审核").length,
  deliveryTasks: importedTasks.length,
  skippedUnlinkedBaseTasks: baseTasks.length - importedBaseTaskCount,
  catalogs: catalogBySourceId.size,
};

console.log(JSON.stringify(report, null, 2));
if (!apply) process.exit(0);

const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
const backupPath = `/private/tmp/eap-before-feishu-import-${timestamp}.sqlite`;
const backup = spawnSync("/usr/bin/sqlite3", [databasePath, `.backup '${backupPath}'`], { encoding: "utf8" });
if (backup.status !== 0) throw new Error(`database backup failed: ${backup.stderr || backup.stdout}`);

const migration = spawnSync("/usr/bin/sqlite3", [databasePath], {
  input: statements.join("\n"),
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});
if (migration.status !== 0) throw new Error(`database import failed: ${migration.stderr || migration.stdout}`);

const credentialsPath = `/private/tmp/eap-created-accounts-${timestamp}.json`;
writeFileSync(credentialsPath, JSON.stringify(accountSpecs.map(({ username, name, password }) => ({ username, name, temporaryPassword: password })), null, 2));
chmodSync(credentialsPath, 0o600);

const verification = spawnSync("/usr/bin/sqlite3", [databasePath,
  "SELECT 'projects',count(*) FROM projects UNION ALL SELECT 'services',sum(json_array_length(json_extract(payload,'$.services'))) FROM projects UNION ALL SELECT 'records',count(*) FROM service_records UNION ALL SELECT 'tasks',count(*) FROM delivery_tasks UNION ALL SELECT 'accounts',count(*) FROM users;"],
  { encoding: "utf8" },
);
if (verification.status !== 0) throw new Error(`database verification failed: ${verification.stderr || verification.stdout}`);

console.log(JSON.stringify({
  applied: true,
  backupPath,
  credentialsPath,
  verification: verification.stdout.trim().split("\n"),
  checksum: createHash("sha256").update(statements.join("\n")).digest("hex"),
}, null, 2));
