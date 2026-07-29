CREATE TABLE `service_catalog` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_unit` text DEFAULT '场' NOT NULL,
	`category` text DEFAULT '其他服务' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_catalog_name_unique` ON `service_catalog` (`name`);