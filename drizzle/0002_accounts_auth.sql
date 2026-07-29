CREATE TABLE `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `name` text NOT NULL,
  `role` text DEFAULT '项目经理' NOT NULL,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `must_change_password` integer DEFAULT true NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
--> statement-breakpoint
CREATE TABLE `sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `users` (`username`,`name`,`role`,`password_hash`,`password_salt`,`active`,`must_change_password`)
VALUES ('lanlan666','系统管理员','管理员','d201c369c6fdb2d308d825836dc9b1a653e2647f99d70cd16a9f84bb64f748af','612d0f2acbebd91efcff003bc4f41e9f',true,true);
