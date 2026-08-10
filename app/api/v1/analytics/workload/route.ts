import { analyticsJson, requireAnalyticsPrincipal } from "../../../../analytics-auth";
import { analyticsHelpers, analyticsPeriod, loadAnalyticsData } from "../../../../analytics-data";

type Workload = { name: string; recordCount: number; quantity: number; durationMinutes: number; amount: number; cost: number; projectIds: Set<number> };
const empty = (name: string): Workload => ({ name, recordCount: 0, quantity: 0, durationMinutes: 0, amount: 0, cost: 0, projectIds: new Set() });
const serialize = (row: Workload) => ({ ...row, projectIds: [...row.projectIds], projectCount: row.projectIds.size });

export async function GET(request: Request) {
  const auth = await requireAnalyticsPrincipal(request); if (auth.response || !auth.principal) return auth.response;
  try {
    const period = analyticsPeriod(new URL(request.url)), data = await loadAnalyticsData(auth.principal);
    const { inPeriod, isAccepted, quantityOf } = analyticsHelpers;
    const records = data.records.filter(record => isAccepted(record.status) && inPeriod(record.serviceDate, period));
    const consultants = new Map<string, Workload>(), managers = new Map<string, Workload>();
    for (const record of records) {
      const provider = String(record.payload.data?.provider ?? "").trim() || "未填写服务人员";
      const consultant = consultants.get(provider) ?? empty(provider);
      consultant.recordCount += 1; consultant.quantity += quantityOf(record); consultant.durationMinutes += Number(record.payload.data?.duration ?? 0) || 0;
      consultant.amount += Number(record.amountSnapshot ?? 0); consultant.cost += Number(record.costAmountSnapshot ?? 0); consultant.projectIds.add(record.projectId); consultants.set(provider, consultant);
      const project = data.projects.find(item => item.id === record.projectId);
      for (const managerName of String(project?.data.manager ?? "未指定项目经理").split("、").map(name => name.trim()).filter(Boolean)) {
        const manager = managers.get(managerName) ?? empty(managerName);
        manager.recordCount += 1; manager.quantity += quantityOf(record); manager.durationMinutes += Number(record.payload.data?.duration ?? 0) || 0;
        manager.amount += Number(record.amountSnapshot ?? 0); manager.cost += Number(record.costAmountSnapshot ?? 0); manager.projectIds.add(record.projectId); managers.set(managerName, manager);
      }
    }
    const owners = Array.from(data.tasks.filter(task => inPeriod(task.plannedDate, period)).reduce((map, task) => {
      const name = task.owner || "未指定负责人", row = map.get(name) ?? { name, planned: 0, completed: 0, overdue: 0, projectIds: new Set<number>() };
      row.planned += 1; row.completed += task.status === "已完成" ? 1 : 0; row.overdue += task.status !== "已完成" && Boolean(task.plannedDate && task.plannedDate < period.asOf) ? 1 : 0; row.projectIds.add(task.projectId); map.set(name, row); return map;
    }, new Map<string, { name: string; planned: number; completed: number; overdue: number; projectIds: Set<number> }>()).values()).map(row => ({ ...row, projectIds: [...row.projectIds], projectCount: row.projectIds.size }));
    return analyticsJson({
      meta: { period, generatedAt: new Date().toISOString(), workloadBasis: "服务人员工作量按已验收记录的实际服务日期统计；多项目经理项目会同时计入每位项目经理" },
      consultants: [...consultants.values()].map(serialize).sort((a, b) => b.quantity - a.quantity),
      projectManagers: [...managers.values()].map(serialize).sort((a, b) => b.quantity - a.quantity),
      taskOwners: owners.sort((a, b) => b.planned - a.planned),
    });
  } catch (error) { return analyticsJson({ error: error instanceof Error ? error.message : "读取工作量失败" }, { status: 400 }); }
}
