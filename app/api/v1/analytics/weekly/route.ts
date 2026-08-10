import { analyticsJson, requireAnalyticsPrincipal } from "../../../../analytics-auth";
import { analyticsHelpers, analyticsPeriod, buildRisks, loadAnalyticsData, projectProgress } from "../../../../analytics-data";

export async function GET(request: Request) {
  const auth = await requireAnalyticsPrincipal(request); if (auth.response || !auth.principal) return auth.response;
  try {
    const period = analyticsPeriod(new URL(request.url));
    const data = await loadAnalyticsData(auth.principal);
    const { inPeriod, isAccepted, quantityOf } = analyticsHelpers;
    const executed = data.records.filter(record => inPeriod(record.serviceDate, period));
    const accepted = data.records.filter(record => isAccepted(record.status) && inPeriod(record.approvedAt, period));
    const previousPeriod = { ...period, start: period.previousStart, end: period.previousEnd };
    const previousAccepted = data.records.filter(record => isAccepted(record.status) && inPeriod(record.approvedAt, previousPeriod));
    const plannedTasks = data.tasks.filter(task => inPeriod(task.plannedDate, period));
    const completedTasks = data.tasks.filter(task => task.status === "已完成" && inPeriod(task.updatedAt, period));
    const risks = buildRisks(data, period);
    const amount = accepted.reduce((sum, record) => sum + Number(record.amountSnapshot ?? 0), 0);
    const cost = accepted.reduce((sum, record) => sum + Number(record.costAmountSnapshot ?? 0), 0);
    const previousAmount = previousAccepted.reduce((sum, record) => sum + Number(record.amountSnapshot ?? 0), 0);
    const statusBacklog = ["待填写", "待审核", "待验收"].map(status => ({ status, count: data.records.filter(record => record.status === status).length }));
    return analyticsJson({
      meta: { period, generatedAt: new Date().toISOString(), principal: auth.principal.name, taskCompletionNote: "任务缺少独立 completedAt，当前按状态和 updatedAt 近似统计本期完成数" },
      summary: {
        activeProjects: data.projects.filter(project => !project.archivedAt).length,
        servicesExecuted: executed.length,
        serviceQuantity: executed.reduce((sum, record) => sum + quantityOf(record), 0),
        servicesAccepted: accepted.length,
        acceptedQuantity: accepted.reduce((sum, record) => sum + quantityOf(record), 0),
        deliveryAmount: amount, deliveryCost: cost, deliveryProfit: amount - cost,
        profitRate: amount > 0 ? Number(((amount - cost) / amount * 100).toFixed(2)) : null,
        tasksPlanned: plannedTasks.length, tasksCompletedApproximate: completedTasks.length,
        overdueTasks: risks.filter(risk => risk.type === "task_overdue").length,
        riskCount: risks.length, highRiskCount: risks.filter(risk => risk.severity === "high").length,
      },
      comparison: {
        previousPeriod: { start: period.previousStart, end: period.previousEnd },
        previousDeliveryAmount: previousAmount,
        deliveryAmountChange: amount - previousAmount,
        deliveryAmountChangeRate: previousAmount > 0 ? Number(((amount - previousAmount) / previousAmount * 100).toFixed(2)) : null,
      },
      statusBacklog,
      projects: data.projects.filter(project => !project.archivedAt).map(project => ({
        id: project.id, name: project.data.name, manager: project.data.manager, status: project.data.status,
        progress: projectProgress(project, data.records, period.asOf), end: project.data.end,
        acceptedThisPeriod: accepted.filter(record => record.projectId === project.id).length,
        amountThisPeriod: accepted.filter(record => record.projectId === project.id).reduce((sum, record) => sum + Number(record.amountSnapshot ?? 0), 0),
        riskCount: risks.filter(risk => risk.projectId === project.id).length,
      })),
      topRisks: risks.slice(0, 20),
    });
  } catch (error) {
    return analyticsJson({ error: error instanceof Error ? error.message : "生成周度分析失败" }, { status: 400 });
  }
}
