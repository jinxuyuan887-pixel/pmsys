PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

DELETE FROM file_attachments;
DELETE FROM form_links;
DELETE FROM delivery_task_records;
DELETE FROM service_records;
DELETE FROM delivery_tasks;
DELETE FROM weekly_snapshots;
DELETE FROM project_versions;
DELETE FROM projects;

DELETE FROM service_catalog;
INSERT INTO service_catalog (id, name, default_unit, category, enabled) VALUES
  (1, 'EAP大使培训', '场', '培训', 1),
  (2, '心理讲座', '场', '活动', 1),
  (3, '心理团辅', '场', '活动', 1),
  (4, '线上咨询', '人次', '心理咨询', 1),
  (5, '线下咨询', '人次', '心理咨询', 1),
  (6, '驻场咨询', '天', '心理咨询', 1),
  (7, '心理测评', '人次', '测评', 1);

DELETE FROM audit_logs
WHERE entity_type NOT IN ('登录', '账号', '账号密码');

COMMIT;
PRAGMA foreign_keys = ON;
VACUUM;
