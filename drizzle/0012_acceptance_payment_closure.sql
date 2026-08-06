ALTER TABLE `projects` ADD `closed_at` text;
ALTER TABLE `projects` ADD `closed_by` text;
ALTER TABLE `projects` ADD `tax_rate_basis_points` integer;
ALTER TABLE `projects` ADD `tax_amount` integer;
ALTER TABLE `projects` ADD `final_revenue` integer;
ALTER TABLE `projects` ADD `final_cost` integer;
ALTER TABLE `projects` ADD `final_profit` integer;

ALTER TABLE `service_records` ADD `payment_status` text DEFAULT '待支付' NOT NULL;
ALTER TABLE `service_records` ADD `paid_at` text;
ALTER TABLE `service_records` ADD `paid_by` text;

ALTER TABLE `file_attachments` ADD `project_id` integer;
ALTER TABLE `file_attachments` ADD `category` text;

UPDATE `service_records` SET `status` = '已验收' WHERE `status` = '已完成';

CREATE INDEX `file_attachments_project_idx` ON `file_attachments` (`project_id`);
CREATE INDEX `service_records_payment_idx` ON `service_records` (`project_id`, `payment_status`);
