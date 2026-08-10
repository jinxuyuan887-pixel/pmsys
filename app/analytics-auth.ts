import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { apiTokens, users } from "../db/schema";
import { requireApiUser, tokenHash, type CurrentUser } from "./auth";

export type AnalyticsPrincipal = {
  kind: "token" | "session";
  name: string;
  scopes: string[];
  user: CurrentUser | null;
};

const unauthorized = (message = "缺少有效的分析 API Token") =>
  Response.json({ error: message }, { status: 401, headers: { "cache-control": "no-store" } });

export async function requireAnalyticsPrincipal(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!bearer) {
    const auth = await requireApiUser(request);
    if (auth.response || !auth.user) return { principal: null, response: unauthorized() };
    return {
      principal: { kind: "session", name: auth.user.username, scopes: ["analytics:read"], user: auth.user } satisfies AnalyticsPrincipal,
      response: null,
    };
  }
  if (bearer.length < 32 || bearer.length > 256) return { principal: null, response: unauthorized() };

  const db = await getDb();
  const hashed = await tokenHash(bearer);
  const [row] = await db.select().from(apiTokens).where(and(eq(apiTokens.tokenHash, hashed), eq(apiTokens.active, true))).limit(1);
  const now = new Date().toISOString();
  if (!row || (row.expiresAt && row.expiresAt < now)) return { principal: null, response: unauthorized("API Token 不存在、已停用或已过期") };
  const scopes = row.scopes.split(/[\s,]+/).map(scope => scope.trim()).filter(Boolean);
  if (!scopes.includes("analytics:read")) return { principal: null, response: Response.json({ error: "Token 缺少 analytics:read 权限" }, { status: 403 }) };

  let user: CurrentUser | null = null;
  if (row.userId) {
    const [boundUser] = await db.select({
      id: users.id, username: users.username, name: users.name, role: users.role, mustChangePassword: users.mustChangePassword,
    }).from(users).where(and(eq(users.id, row.userId), eq(users.active, true))).limit(1);
    if (!boundUser) return { principal: null, response: unauthorized("Token 绑定的账号不存在或已停用") };
    user = boundUser;
  }
  await db.update(apiTokens).set({ lastUsedAt: sql`CURRENT_TIMESTAMP` }).where(eq(apiTokens.id, row.id));
  return {
    principal: { kind: "token", name: row.name, scopes, user } satisfies AnalyticsPrincipal,
    response: null,
  };
}

export function analyticsJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  return Response.json(data, { ...init, headers });
}
