CREATE TABLE IF NOT EXISTS `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `artifacts_owner_idx` ON `artifacts` (`owner_user_id`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `asset_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`storage_prefix` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `asset_folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `asset_folders_storage_prefix_unique` ON `asset_folders` (`storage_prefix`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `asset_folders_owner_parent_idx` ON `asset_folders` (`owner_user_id`,`parent_id`,`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`jti` text NOT NULL,
	`password_version` integer NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `auth_sessions_jti_unique` ON `auth_sessions` (`jti`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `auth_sessions_jti_idx` ON `auth_sessions` (`jti`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `credit_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `credit_charges_job_id_unique` ON `credit_charges` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `credit_charges_job_idx` ON `credit_charges` (`job_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`module_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer NOT NULL,
	`stage` text NOT NULL,
	`overall_execution_mode` text NOT NULL,
	`values_json` text NOT NULL,
	`video_model` text,
	`execution_plan_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`result_json` text,
	`error_json` text,
	`parent_job_id` text,
	`idempotency_key` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`provider_model` text,
	`provider_task_id` text,
	`provider_status` text,
	`provider_submitted_at` text,
	`provider_deadline_at` text,
	`provider_cancel_state` text DEFAULT 'none',
	`staging_keys_json` text DEFAULT '[]' NOT NULL,
	`job_schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_module_created_idx` ON `jobs` (`module_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_status_created_idx` ON `jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_owner_created_idx` ON `jobs` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `jobs_idempotency_idx` ON `jobs` (`owner_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`original_name` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_sec` real,
	`asset_kind` text DEFAULT 'media' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`description` text,
	`product_group_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`sharing_scope` text DEFAULT 'private' NOT NULL,
	`folder_id` text,
	`expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`) REFERENCES `asset_folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_assets_storage_key_unique` ON `media_assets` (`storage_key`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `media_assets_storage_key_idx` ON `media_assets` (`storage_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_assets_owner_kind_idx` ON `media_assets` (`owner_user_id`,`asset_kind`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `migration_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`source_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `notifications_source_idx` ON `notifications` (`user_id`,`type`,`source_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `object_cleanup` (
	`object_key` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_attempt_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recharge_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`package_id` text NOT NULL,
	`amount_cny` integer NOT NULL,
	`credits` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`request_fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `recharge_orders_user_idempotency_idx` ON `recharge_orders` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`default_ratio` text DEFAULT '9:16' NOT NULL,
	`language` text DEFAULT 'zh-CN' NOT NULL,
	`task_notifications` integer DEFAULT true NOT NULL,
	`autoplay_results` integer DEFAULT false NOT NULL,
	`default_asset_folder_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_asset_folder_id`) REFERENCES `asset_folders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_text` text NOT NULL,
	`credits` integer DEFAULT 2480 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`password_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_idx` ON `users` (`email`);