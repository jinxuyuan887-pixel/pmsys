import { analyticsJson, requireAnalyticsPrincipal } from "../../../../analytics-auth";
import { analyticsHelpers, analyticsPeriod, buildRisks, loadAnalyticsData, projectProgress } from "../../../../analytics-data";

export async function GET(request: Request) {
  const auth = await requireAnalyticsPrincipal(request); if (auth.response || !auth.principal) return auth.response;
  try {
    const url = new URL(request.url), period = analyticsPeriod(url), data = await loadAnalyticsData(auth.principal);
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const risks = buildRisks(data, period), { inPeriod, isAccepted, quantityOf } = analyticsHelpers;
    const rows = data.projects.filter(project => includeArchived || !project.archivedAt).map(project => {
      const records = data.records.filter(record => record.projectId === project.id);
      const accepted = records.filter(record => isAccepted(record.status) && inPeriod(record.approvedAt, period));
      const tasks = data.tasks.filter(task => task.projectId === project.id);
      return {
        id: project.id, name: project.data.name, manager: project.data.manager, managerIds: project.data.managerIds ?? [],
        status: project.data.status, risk: project.data.risk, priority: project.data.priority, tags: project.data.tags ?? [],
        start: project.data.start, end: project.data.end, archivedAt: project.archivedAt,
        progress: projectProgress(project, data.records, period.asOf),
        period: {
          acceptedRecords: accepted.length, acceptedQuantity: accepted.reduce((sum, record) => sum + quantityOf(record), 0),
          amount: accepted.reduce((sum, record) => sum + Number(record.amountSnapshot ?? 0), 0),
          cost: accepted.reduce((sum, record) => sum + Number(record.costAmountSnapshot ?? 0), 0),
          plannedTasks: tasks.filter(task => inPeriod(task.plannedDate, period)).length,
          completedTasksApproximate: tasks.filter(task => task.status === "已完成" && inPeriod(task.updatedAt, period)).length,
        },
        backlog: {
          pendingRecords: records.filter(record => ["待填写", "待审核", "待验收"].includes(record.status)).length,
          unpaidRecords: records.filter(record => isAccepted(record.status) && record.paymentStatus !== "已支付").length,
          overdueTasks: tasks.filter(task => task.status !== "已完成" && task.plannedDate && task.plannedDate < period.asOf).length,
        },
        risks: risks.filter(risk => risk.projectId === project.id),
      };
    });
    return analyticsJson({ meta: { period, generatedAt: new Date().toISOString() }, projects: rows });
  } catch (error) { return analyticsJson({ error: error instanceof Error ? error.message : "读取项目分析失败" }, { status: 400 }); }
}
