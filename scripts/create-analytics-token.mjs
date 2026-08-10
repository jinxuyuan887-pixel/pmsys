import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const valueAfter = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const databasePath = valueAfter("--db") ?? process.env.NODE_DATABASE_PATH;
const name = valueAfter("--name") ?? "本地 Codex 周度分析";
const outputPath = resolve(valueAfter("--out") ?? ".secrets/pmsys-analytics.token");
const userIdValue = valueAfter("--user-id");
const expiresDaysValue = valueAfter("--expires-days");

if (!databasePath) {
  console.error("请通过 --db 或 NODE_DATABASE_PATH 指定本地 SQLite 数据库。");
  process.exit(2);
}
const userId = userIdValue ? Number(userIdValue) : null;
if (userIdValue && !Number.isSafeInteger(userId)) {
  console.error("--user-id 必须是有效的整数。");
  process.exit(2);
}
const expiresDays = expiresDaysValue ? Number(expiresDaysValue) : 365;
if (!Number.isSafeInteger(expiresDays) || expiresDays < 1 || expiresDays > 3650) {
  console.error("--expires-days 必须是1到3650之间的整数。");
  process.exit(2);
}

const database = new Database(resolve(databasePath));
const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_tokens'").get();
if (!table) {
  console.error("数据库尚未执行 0015_analytics_api_tokens.sql 迁移。");
  process.exit(3);
}
if (userId) {
  const user = database.prepare("SELECT id FROM users WHERE id=? AND active=1").get(userId);
  if (!user) {
    console.error("绑定的用户不存在或已停用。");
    process.exit(3);
  }
}

const token = `pmsys_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const expiresAt = new Date(Date.now() + expiresDays * 86400000).toISOString();
database.prepare("INSERT INTO api_tokens(name,token_hash,scopes,user_id,expires_at) VALUES(?,?,?,?,?)")
  .run(name, tokenHash, "analytics:read", userId, expiresAt);
database.close();

await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
await chmod(dirname(outputPath), 0o700);
await writeFile(outputPath, `${token}\n`, { mode: 0o600 });
await chmod(outputPath, 0o600);
console.log(`只读分析 Token 已保存到：${outputPath}`);
console.log(`有效期至：${expiresAt}`);
console.log("明文 Token 未输出到终端，且 .secrets/ 已被 Git 忽略。");
