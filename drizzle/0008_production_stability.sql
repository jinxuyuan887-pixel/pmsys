ALTER TABLE `projects` ADD `archived_at` text;
ALTER TABLE `projects` ADD `is_demo` integer DEFAULT false NOT NULL;
UPDATE `projects` SET `is_demo` = 1 WHERE `id` IN (910001,910002,910003);

ALTER TABLE `service_records` ADD `unit_price_snapshot` integer;
ALTER TABLE `service_records` ADD `amount_snapshot` integer;
ALTER TABLE `service_records` ADD `deleted_at` text;
ALTER TABLE `service_records` ADD `deleted_by` text;
ALTER TABLE `service_records` ADD `service_date` text DEFAULT '' NOT NULL;
UPDATE `service_records` SET `service_date` = COALESCE(json_extract(`payload`, '$.data.date'), substr(`created_at`, 1, 10));
UPDATE `service_records`
SET `unit_price_snapshot` = (
  SELECT CAST(json_extract(service.value, '$.unitPrice') AS INTEGER)
  FROM `projects`, json_each(`projects`.`payload`, '$.services') AS service
  WHERE `projects`.`id` = `service_records`.`project_id`
    AND CAST(json_extract(service.value, '$.id') AS INTEGER) = `service_records`.`service_id`
),
`amount_snapshot` = (
  SELECT CAST(json_extract(service.value, '$.unitPrice') AS INTEGER) *
    CAST(COALESCE(json_extract(`service_records`.`payload`, '$.data.quantity'), 1) AS INTEGER)
  FROM `projects`, json_each(`projects`.`payload`, '$.services') AS service
  WHERE `projects`.`id` = `service_records`.`project_id`
    AND CAST(json_extract(service.value, '$.id') AS INTEGER) = `service_records`.`service_id`
)
WHERE `status` = '已完成';

ALTER TABLE `form_links` ADD `last_used_at` text;

CREATE TABLE `file_attachments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `storage_key` text NOT NULL,
  `original_name` text NOT NULL,
  `content_type` text NOT NULL,
  `size` integer NOT NULL,
  `uploaded_by` text NOT NULL,
  `form_token` text,
  `record_id` integer,
  `deleted_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX `file_attachments_storage_key_unique` ON `file_attachments` (`storage_key`);
CREATE INDEX `service_records_project_status_idx` ON `service_records` (`project_id`,`status`,`deleted_at`);
CREATE INDEX `service_records_service_date_idx` ON `service_records` (`service_id`,`created_at`);
CREATE INDEX `form_links_project_idx` ON `form_links` (`project_id`,`status`);

CREATE TABLE `login_attempts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `ip_address` text NOT NULL,
  `succeeded` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `login_attempts_lookup_idx` ON `login_attempts` (`username`,`ip_address`,`created_at`);
