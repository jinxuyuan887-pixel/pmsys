# 周度分析 API

系统提供一组只读分析接口，供 Codex、MCP Server、CLI 或周报自动化调用。接口不会新增、修改或删除项目、任务和服务记录；Token 的最近使用时间属于安全审计元数据。

## 认证

推荐使用独立的 Bearer Token：

```http
Authorization: Bearer pmsys_xxx
```

Token 明文只保存在调用端，本系统数据库仅保存 SHA-256 哈希。Token 必须包含 `analytics:read` 权限，可以绑定一个系统账号；绑定后自动继承该账号的项目可见范围。未绑定账号的 Token 可读取全局数据，应只发给项目管理员。

本地生成：

```bash
npm run api-token:create -- --db /absolute/path/to/local.sqlite
```

默认写入 `.secrets/pmsys-analytics.token`，该目录已加入 `.gitignore`。也可以追加：

```bash
--name "Codex 周报" --user-id 3 --expires-days 365 --out .secrets/codex-weekly.token
```

## 日期口径

- 默认取中国时区当前自然周，周一至周日。
- `weekStart=YYYY-MM-DD` 指定周开始日期。
- 也可使用 `start=YYYY-MM-DD&end=YYYY-MM-DD` 指定范围，最多366天。
- 服务工作量按实际服务日期 `service_date` 统计。
- 收入、成本和利润按验收时间 `approved_at` 统计。
- 任务计划量按 `planned_date` 统计。
- 当前任务缺少独立 `completed_at`，本期完成数暂按“已完成且 updated_at 在范围内”近似计算，响应的 `taskCompletionNote` 会明确提示。

## 接口

### 周度总览

`GET /pmsys/api/v1/analytics/weekly?weekStart=2026-08-03`

返回项目数量、服务工作量、已验收量、收入成本利润、本周任务、环比、积压状态和高优风险。

### 项目进度

`GET /pmsys/api/v1/analytics/projects?weekStart=2026-08-03`

返回每个项目当前进度、本期交付、任务、积压、年度服务和项目风险。增加 `includeArchived=1` 可包含归档项目。

### 人员工作量

`GET /pmsys/api/v1/analytics/workload?weekStart=2026-08-03`

按服务人员、项目经理和任务负责人聚合。一个项目有多位项目经理时，项目交付会同时计入每位项目经理。

### 任务分析

`GET /pmsys/api/v1/analytics/tasks?weekStart=2026-08-03&status=overdue`

`status` 支持 `all`、`completed`、`incomplete`、`overdue`。

### 风险分析

`GET /pmsys/api/v1/analytics/risks?weekStart=2026-08-03&severity=high`

支持 `severity=high|medium|low` 和 `type` 过滤。当前规则包括：任务逾期、记录久未处理、验收后未支付、服务风险、项目临期低进度、项目长期停滞、年度服务交付落后。

## 调用示例

```bash
curl -H "Authorization: Bearer $(tr -d '\n' < .secrets/pmsys-analytics.token)" \
  "http://localhost:5173/pmsys/api/v1/analytics/weekly?weekStart=2026-08-03"
```

线上开放给远程 MCP 前必须配置 HTTPS，不应通过明文 HTTP 传输 Token。
