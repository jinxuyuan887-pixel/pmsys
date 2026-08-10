import { analyticsJson, requireAnalyticsPrincipal } from "../../../../analytics-auth";
import { analyticsPeriod, buildRisks, loadAnalyticsData } from "../../../../analytics-data";

export async function GET(request: Request) {
  const auth = await requireAnalyticsPrincipal(request); if (auth.response || !auth.principal) return auth.response;
  try {
    const url = new URL(request.url), period = analyticsPeriod(url), data = await loadAnalyticsData(auth.principal);
    const severity = url.searchParams.get("severity"), type = url.searchParams.get("type");
    const risks = buildRisks(data, period).filter(risk => (!severity || risk.severity === severity) && (!type || risk.type === type));
    return analyticsJson({
      meta: { period, generatedAt: new Date().toISOString() },
      summary: { total: risks.length, high: risks.filter(risk => risk.severity === "high").length, medium: risks.filter(risk => risk.severity === "medium").length, low: risks.filter(risk => risk.severity === "low").length },
      risks,
    });
  } catch (error) { return analyticsJson({ error: error instanceof Error ? error.message : "读取风险分析失败" }, { status: 400 }); }
}
