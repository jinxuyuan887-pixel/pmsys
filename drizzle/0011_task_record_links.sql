ALTER TABLE `delivery_tasks` ADD `description` text DEFAULT '' NOT NULL;

CREATE TABLE `delivery_task_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `task_id` integer NOT NULL,
  `record_id` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX `delivery_task_records_unique`
  ON `delivery_task_records` (`task_id`, `record_id`);
CREATE INDEX `delivery_task_records_task_idx`
  ON `delivery_task_records` (`task_id`);
CREATE INDEX `delivery_task_records_record_idx`
  ON `delivery_task_records` (`record_id`);
