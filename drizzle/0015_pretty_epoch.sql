CREATE TABLE `ark_portrait_groups` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`project_name` text DEFAULT 'default' NOT NULL,
	`status` text NOT NULL,
	`claim_token` text NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `custom_portraits` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`owner_user_id` text NOT NULL,
	`group_id` text,
	`ark_asset_id` text,
	`status` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_portraits_ark_asset_id_unique` ON `custom_portraits` (`ark_asset_id`);--> statement-breakpoint
CREATE INDEX `custom_portraits_owner_created_idx` ON `custom_portraits` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `custom_portraits_owner_status_idx` ON `custom_portraits` (`owner_user_id`,`status`);