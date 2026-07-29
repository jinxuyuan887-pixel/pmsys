CREATE TABLE `form_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`project_id` integer NOT NULL,
	`service_id` integer NOT NULL,
	`form_type` text NOT NULL,
	`expires_at` text,
	`max_submissions` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_links_token_unique` ON `form_links` (`token`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`service_id` integer NOT NULL,
	`record_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT '待审核' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
