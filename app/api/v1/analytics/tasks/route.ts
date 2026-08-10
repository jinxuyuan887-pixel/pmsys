import { analyticsJson, requireAnalyticsPrincipal } from "../../../../analytics-auth";
import { analyticsHelpers, analyticsPeriod, loadAnalyticsData } from "../../../../analytics-data";

export async function GET(request: Request) {
  const auth = await requireAnalyticsPrincipal(request); if (auth.response || !auth.principal) return auth.response;
  try {
    const url = new URL(request.url), period = analyticsPeriod(url), data = await loadAnalyticsData(auth.principal), status = url.searchParams.get("status") ?? "all";
    const projectById = new Map(data.projects.map(project => [project.id, project]));
    const tasks = data.tasks.filter(task => status === "completed" ? task.status === "已完成" : status === "incomplete" ? task.status !== "已完成" : status === "overdue" ? task.status !== "已完成" && Boolean(task.plannedDate && task.plannedDate < period.asOf) : true).map(task => ({
      ...task, projectName: projectById.get(task.projectId)?.data.name, manager: projectById.get(task.projectId)?.data.manager,
      inPeriod: analyticsHelpers.inPeriod(task.plannedDate, period), overdueDays: task.status !== "已完成" && task.plannedDate && task.plannedDate < period.asOf ? analyticsHelpers.diffDays(task.plannedDate, period.asOf) : 0,
    })).sort((a, b) => Number(b.overdueDays) - Number(a.overdueDays) || String(a.plannedDate ?? "9999").localeCompare(String(b.plannedDate ?? "9999")));
    return analyticsJson({ meta: { period, generatedAt: new Date().toISOString() }, tasks });
  } catch (error) { return analyticsJson({ error: error instanceof Error ? error.message : "读取任务分析失败" }, { status: 400 }); }
}
