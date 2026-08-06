CREATE TABLE `project_tags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX `project_tags_name_unique` ON `project_tags` (`name`);
INSERT INTO `project_tags` (`name`) VALUES ('制造业'),('金融'),('互联网'),('政府'),('年度服务'),('专项活动');
