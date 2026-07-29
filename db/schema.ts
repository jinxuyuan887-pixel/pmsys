import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey(),
  payload: text("payload").notNull(),
  version: integer("version").notNull().default(1),
  archivedAt: text("archived_at"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projectVersions = sqliteTable("project_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  version: integer("version").notNull(),
  payload: text("payload").notNull(),
  changedBy: text("changed_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  username: text("username").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  summary: text("summary").notNull(),
  beforePayload: text("before_payload"),
  afterPayload: text("after_payload"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const serviceRecords = sqliteTable("service_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  serviceId: integer("service_id").notNull(),
  recordType: text("record_type").notNull(),
  serviceDate: text("service_date").notNull().default(""),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("待审核"),
  unitPriceSnapshot: integer("unit_price_snapshot"),
  amountSnapshot: integer("amount_snapshot"),
  costUnitSnapshot: integer("cost_unit_snapshot"),
  costAmountSnapshot: integer("cost_amount_snapshot"),
  profitRateBasisPoints: integer("profit_rate_basis_points"),
  deletedAt: text("deleted_at"),
  deletedBy: text("deleted_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  approvedAt: text("approved_at"),
});

export const formLinks = sqliteTable("form_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  projectId: integer("project_id").notNull(),
  serviceId: integer("service_id").notNull(),
  formType: text("form_type").notNull(),
  expiresAt: text("expires_at"),
  maxSubmissions: integer("max_submissions").notNull().default(1),
  submissionCount: integer("submission_count").notNull().default(0),
  status: text("status").notNull().default("有效"),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const fileAttachments = sqliteTable("file_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  formToken: text("form_token"),
  recordId: integer("record_id"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const deliveryTasks = sqliteTable("delivery_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  serviceId: integer("service_id").notNull(),
  title: text("title").notNull(),
  plannedQuantity: integer("planned_quantity").notNull().default(1),
  plannedDate: text("planned_date"),
  owner: text("owner"),
  status: text("status").notNull().default("待安排"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const weeklySnapshots = sqliteTable("weekly_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekStart: text("week_start").notNull(),
  payload: text("payload").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const serviceCatalog = sqliteTable("service_catalog", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().unique(),
  defaultUnit: text("default_unit").notNull().default("场"),
  category: text("category").notNull().default("其他服务"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("项目经理"),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const loginAttempts = sqliteTable("login_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  ipAddress: text("ip_address").notNull(),
  succeeded: integer("succeeded", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
