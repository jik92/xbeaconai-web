CREATE TABLE `qianchuan_advertisers` (
	`id` text PRIMARY KEY NOT NULL,
	`binding_id` text NOT NULL,
	`advertiser_id` text NOT NULL,
	`name` text NOT NULL,
	`account_role` text DEFAULT 'ADVERTISER' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `qianchuan_bindings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qianchuan_advertisers_binding_advertiser_idx` ON `qianchuan_advertisers` (`binding_id`,`advertiser_id`);--> statement-breakpoint
CREATE INDEX `qianchuan_advertisers_binding_idx` ON `qianchuan_advertisers` (`binding_id`);--> statement-breakpoint
CREATE TABLE `qianchuan_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`auth_user_id` text NOT NULL,
	`subject_id` text,
	`subject_name` text DEFAULT '' NOT NULL,
	`subject_type` text DEFAULT 'AGENCY' NOT NULL,
	`access_token_ciphertext` text NOT NULL,
	`access_token_nonce` text NOT NULL,
	`access_token_auth_tag` text NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`refresh_token_nonce` text NOT NULL,
	`refresh_token_auth_tag` text NOT NULL,
	`access_token_expires_at` text NOT NULL,
	`refresh_token_expires_at` text NOT NULL,
	`default_advertiser_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qianchuan_bindings_owner_auth_user_idx` ON `qianchuan_bindings` (`owner_user_id`,`auth_user_id`);--> statement-breakpoint
CREATE INDEX `qianchuan_bindings_owner_idx` ON `qianchuan_bindings` (`owner_user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `qianchuan_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`advertiser_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`campaign_id` text,
	`ad_id` text,
	`creative_id` text,
	`request_payload_json` text NOT NULL,
	`report_summary_json` text,
	`request_id` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`binding_id`) REFERENCES `qianchuan_bindings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qianchuan_deliveries_owner_idempotency_idx` ON `qianchuan_deliveries` (`owner_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `qianchuan_deliveries_owner_updated_idx` ON `qianchuan_deliveries` (`owner_user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `qianchuan_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`advertiser_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`upstream_material_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`request_id` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`binding_id`) REFERENCES `qianchuan_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qianchuan_materials_account_asset_idx` ON `qianchuan_materials` (`advertiser_id`,`asset_id`,`kind`);--> statement-breakpoint
CREATE INDEX `qianchuan_materials_owner_idx` ON `qianchuan_materials` (`owner_user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `qianchuan_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `qianchuan_oauth_states_owner_idx` ON `qianchuan_oauth_states` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `qianchuan_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`report_date` text NOT NULL,
	`level` text NOT NULL,
	`metrics_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`delivery_id`) REFERENCES `qianchuan_deliveries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qianchuan_reports_delivery_date_level_idx` ON `qianchuan_reports` (`delivery_id`,`report_date`,`level`);--> statement-breakpoint
CREATE INDEX `qianchuan_reports_owner_date_idx` ON `qianchuan_reports` (`owner_user_id`,`report_date`);