import { and, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { deliveryTasks, projects, serviceRecords } from "../db/schema";
import type { AnalyticsPrincipal } from "./analytics-auth";
import { canAccessProject } from "./project-access";

type AnalyticsService = {
  id: number; name: string; unit?: string; quantity?: number; unitPrice?: number;
  billingMode?: "delivery" | "annual-time";
};
export type AnalyticsProject = typeof projects.$inferSelect & {
  data: {
    id?: number; name?: string; manager?: string; managerIds?: number[]; status?: string; risk?: string;
    start?: string; end?: string; services?: AnalyticsService[]; tags?: string[]; total?: number; [key: string]: unknown;
  };
};
export type AnalyticsRecord = Omit<typeof serviceRecords.$inferSelect, "payload"> & {
  payload: { data?: Record<string, unknown>; uploaded?: string[]; type?: string };
};
export type AnalyticsTask = typeof deliveryTasks.$inferSelect;
export type AnalyticsPeriod = { start: string; end: string; previousStart: string; previousEnd: string; asOf: string };
export type AnalyticsData = { projects: AnalyticsProject[]; records: AnalyticsRecord[]; tasks: AnalyticsTask[] };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateOnly = (value?: string | null) => String(value ?? "").slice(0, 10);
const parseJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
};
const diffDays = (from: string, to: string) => Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);
const inPeriod = (value: string | null | undefined, period: AnalyticsPeriod) => {
  const date = dateOnly(value); return Boolean(date && date >= period.start && date <= period.end);
};
const isAccepted = (status: string) => ["已验收", "已完成"].includes(status);
const quantityOf = (record: AnalyticsRecord) => Number(record.payload.data?.quantity ?? 1) || 0;
const currentChinaDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function analyticsPeriod(url: URL): AnalyticsPeriod {
  const requestedStart = url.searchParams.get("weekStart") ?? url.searchParams.get("start");
  let start = requestedStart ?? currentChinaDate();
  if (!datePattern.test(start)) throw new Error("日期必须使用 YYYY-MM-DD 格式");
  if (!requestedStart) {
    const weekday = new Date(`${start}T00:00:00Z`).getUTCDay();
    start = addDays(start, -((weekday + 6) % 7));
  }
  const end = url.searchParams.get("end") ?? addDays(start, 6);
  if (!datePattern.test(end) || end < start) throw new Error("结束日期不能早于开始日期");
  if (diffDays(start, end) > 366) throw new Error("单次分析范围不能超过366天");
  const duration = diffDays(start, end) + 1;
  return { start, end, previousStart: addDays(start, -duration), previousEnd: addDays(start, -1), asOf: currentChinaDate() };
}

export async function loadAnalyticsData(principal: AnalyticsPrincipal): Promise<AnalyticsData> {
  const db = await getDb();
  const projectRows = await db.select().from(projects);
  const parsed = projectRows.map(row => ({ ...row, data: parseJson<AnalyticsProject["data"]>(row.payload, {}) }));
  const visible = principal.user ? parsed.filter(project => canAccessProject(principal.user!, project.data)) : parsed;
  const projectIds = visible.map(project => project.id);
  if (!projectIds.length) return { projects: [], records: [], tasks: [] };
  const [recordRows, taskRows] = await Promise.all([
    db.select().from(serviceRecords).where(and(inArray(serviceRecords.projectId, projectIds), isNull(serviceRecords.deletedAt))),
    db.select().from(deliveryTasks).where(inArray(deliveryTasks.projectId, projectIds)),
  ]);
  return {
    projects: visible,
    records: recordRows.map(row => ({ ...row, payload: parseJson<AnalyticsRecord["payload"]>(row.payload, {}) })),
    tasks: taskRows,
  };
}

function timeProgress(project: AnalyticsProject, asOf: string) {
  const start = dateOnly(project.data.start as string), end = dateOnly(project.data.end as string);
  if (!start || !end || end <= start) return 0;
  return Math.max(0, Math.min(100, Math.round(diffDays(start, asOf) / Math.max(1, diffDays(start, end)) * 100)));
}

export function projectProgress(project: AnalyticsProject, records: AnalyticsRecord[], asOf: string) {
  const accepted = records.filter(record => record.projectId === project.id && isAccepted(record.status));
  const delivered = new Map<number, number>();
  for (const record of accepted) delivered.set(record.serviceId, (delivered.get(record.serviceId) ?? 0) + quantityOf(record));
  const services = project.data.services ?? [];
  const total = services.reduce((sum, service) => sum + Number(service.quantity ?? 0), 0);
  const completed = services.reduce((sum, service) => {
    const quantity = Number(service.quantity ?? 0);
    return sum + (service.billingMode === "annual-time" ? quantity * timeProgress(project, asOf) / 100 : Math.min(quantity, delivered.get(service.id) ?? 0));
  }, 0);
  return total > 0 ? Math.max(0, Math.min(100, Math.round(completed / total * 100))) : 0;
}

export type RiskItem = {
  id: string; type: string; severity: "high" | "medium" | "low"; projectId: number; projectName: string;
  title: string; reason: string; owner: string; date: string | null;
};

export function buildRisks(data: AnalyticsData, period: AnalyticsPeriod): RiskItem[] {
  const risks: RiskItem[] = [];
  const projectById = new Map(data.projects.map(project => [project.id, project]));
  const projectName = (id: number) => String(projectById.get(id)?.data.name ?? `项目 ${id}`);
  const ownerOf = (id: number) => String(projectById.get(id)?.data.manager ?? "未指定");
  for (const task of data.tasks) {
    if (task.status !== "已完成" && task.plannedDate && task.plannedDate < period.asOf) risks.push({
      id: `task-overdue-${task.id}`, type: "task_overdue", severity: diffDays(task.plannedDate, period.asOf) >= 7 ? "high" : "medium",
      projectId: task.projectId, projectName: projectName(task.projectId), title: `任务逾期：${task.title}`,
      reason: `计划日期为 ${task.plannedDate}，当前仍未完成`, owner: task.owner || ownerOf(task.projectId), date: task.plannedDate,
    });
  }
  for (const record of data.records) {
    const updated = dateOnly(record.updatedAt || record.createdAt);
    if (["待填写", "待审核", "待验收"].includes(record.status) && diffDays(updated, period.asOf) >= 3) risks.push({
      id: `record-pending-${record.id}`, type: "record_pending", severity: diffDays(updated, period.asOf) >= 7 ? "high" : "medium",
      projectId: record.projectId, projectName: projectName(record.projectId), title: `${record.recordType}${record.status}`,
      reason: `已停留 ${diffDays(updated, period.asOf)} 天`, owner: ownerOf(record.projectId), date: updated,
    });
    if (isAccepted(record.status) && record.paymentStatus !== "已支付" && record.approvedAt && diffDays(dateOnly(record.approvedAt), period.asOf) >= 7) risks.push({
      id: `payment-${record.id}`, type: "payment_pending", severity: diffDays(dateOnly(record.approvedAt), period.asOf) >= 30 ? "high" : "medium",
      projectId: record.projectId, projectName: projectName(record.projectId), title: `${record.recordType}成本待支付`,
      reason: `验收后已 ${diffDays(dateOnly(record.approvedAt), period.asOf)} 天未确认支付`, owner: ownerOf(record.projectId), date: dateOnly(record.approvedAt),
    });
    const serviceRisk = String(record.payload.data?.risk ?? "");
    if (["需要跟进", "重点关注"].includes(serviceRisk) && (inPeriod(record.serviceDate, period) || inPeriod(record.updatedAt, period))) risks.push({
      id: `service-risk-${record.id}`, type: "service_risk", severity: serviceRisk === "重点关注" ? "high" : "medium",
      projectId: record.projectId, projectName: projectName(record.projectId), title: `${record.recordType}：${serviceRisk}`,
      reason: "服务记录已标记风险；分析接口不返回咨询概括等敏感明细", owner: String(record.payload.data?.provider ?? ownerOf(record.projectId)), date: record.serviceDate,
    });
  }
  for (const project of data.projects.filter(project => !project.archivedAt && !["已结项", "已完成"].includes(String(project.data.status)))) {
    const progress = projectProgress(project, data.records, period.asOf);
    const end = dateOnly(project.data.end as string);
    if (end && diffDays(period.asOf, end) >= 0 && diffDays(period.asOf, end) <= 30 && progress < 70) risks.push({
      id: `project-schedule-${project.id}`, type: "project_schedule", severity: progress < 40 ? "high" : "medium",
      projectId: project.id, projectName: projectName(project.id), title: "项目临近结束但交付进度偏低",
      reason: `距离结束 ${diffDays(period.asOf, end)} 天，当前进度 ${progress}%`, owner: ownerOf(project.id), date: end,
    });
    const activities = [project.updatedAt, ...data.records.filter(record => record.projectId === project.id).map(record => record.updatedAt), ...data.tasks.filter(task => task.projectId === project.id).map(task => task.updatedAt)].map(dateOnly).filter(Boolean).sort();
    const lastActivity = activities.at(-1) ?? dateOnly(project.data.start as string);
    if (lastActivity && diffDays(lastActivity, period.asOf) >= 14) risks.push({
      id: `project-stalled-${project.id}`, type: "project_stalled", severity: diffDays(lastActivity, period.asOf) >= 30 ? "high" : "medium",
      projectId: project.id, projectName: projectName(project.id), title: "项目长期无进展记录",
      reason: `最近一次更新距今 ${diffDays(lastActivity, period.asOf)} 天`, owner: ownerOf(project.id), date: lastActivity,
    });
    for (const service of (project.data.services ?? []).filter(service => service.billingMode === "annual-time")) {
      const time = timeProgress(project, period.asOf), delivered = data.records.filter(record => record.projectId === project.id && record.serviceId === service.id && isAccepted(record.status)).reduce((sum, record) => sum + quantityOf(record), 0);
      const delivery = Math.min(100, Math.round(delivered / Math.max(1, Number(service.quantity ?? 1)) * 100));
      if (time - delivery >= 20) risks.push({
        id: `annual-${project.id}-${service.id}`, type: "annual_delivery_gap", severity: time - delivery >= 40 ? "high" : "medium",
        projectId: project.id, projectName: projectName(project.id), title: `年度服务交付落后：${service.name}`,
        reason: `时间进度 ${time}%，实际验收比例 ${delivery}%`, owner: ownerOf(project.id), date: end || null,
      });
    }
  }
  const severityOrder = { high: 0, medium: 1, low: 2 };
  return risks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.projectId - b.projectId);
}

export const analyticsHelpers = { dateOnly, inPeriod, isAccepted, quantityOf, diffDays, addDays };
