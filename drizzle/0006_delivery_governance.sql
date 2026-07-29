ALTER TABLE `projects` ADD `version` integer DEFAULT 1 NOT NULL;
ALTER TABLE `form_links` ADD `submission_count` integer DEFAULT 0 NOT NULL;
ALTER TABLE `form_links` ADD `status` text DEFAULT '有效' NOT NULL;
ALTER TABLE `service_records` ADD `updated_at` text DEFAULT '' NOT NULL;
ALTER TABLE `service_records` ADD `approved_at` text;

CREATE TABLE `project_versions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` integer NOT NULL,
  `version` integer NOT NULL,
  `payload` text NOT NULL,
  `changed_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `audit_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer,
  `username` text NOT NULL,
  `action` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `summary` text NOT NULL,
  `before_payload` text,
  `after_payload` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `delivery_tasks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` integer NOT NULL,
  `service_id` integer NOT NULL,
  `title` text NOT NULL,
  `planned_quantity` integer DEFAULT 1 NOT NULL,
  `planned_date` text,
  `owner` text,
  `status` text DEFAULT '待安排' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `weekly_snapshots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `week_start` text NOT NULL,
  `payload` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX `project_versions_project_idx` ON `project_versions` (`project_id`, `version`);
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`, `entity_id`);
CREATE INDEX `delivery_tasks_project_idx` ON `delivery_tasks` (`project_id`, `service_id`);
CREATE INDEX `weekly_snapshots_week_idx` ON `weekly_snapshots` (`week_start`);
