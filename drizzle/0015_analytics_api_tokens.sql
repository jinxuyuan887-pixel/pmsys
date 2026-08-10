CREATE TABLE `api_tokens` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `token_hash` text NOT NULL,
  `scopes` text DEFAULT 'analytics:read' NOT NULL,
  `user_id` integer,
  `active` integer DEFAULT true NOT NULL,
  `expires_at` text,
  `last_used_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);
CREATE INDEX `api_tokens_active_idx` ON `api_tokens` (`active`, `expires_at`);
