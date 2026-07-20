CREATE TABLE `ad_script_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`job_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`input_json` text NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ad_script_projects_owner_updated_idx` ON `ad_script_projects` (`owner_user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ad_script_projects_owner_idempotency_idx` ON `ad_script_projects` (`owner_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `ad_script_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`current_version_id` text,
	`final_score` integer,
	`compliance_passed` integer,
	`iteration_count` integer DEFAULT 0 NOT NULL,
	`error_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `ad_script_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_script_variants_project_ordinal_idx` ON `ad_script_variants` (`project_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `ad_script_variants_project_idx` ON `ad_script_variants` (`project_id`);--> statement-breakpoint
CREATE TABLE `ad_script_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`source` text NOT NULL,
	`parent_version_id` text,
	`round` integer NOT NULL,
	`script` text NOT NULL,
	`score_json` text NOT NULL,
	`compliance_json` text NOT NULL,
	`change_summary` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `ad_script_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_script_versions_variant_sequence_idx` ON `ad_script_versions` (`variant_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `ad_script_versions_variant_created_idx` ON `ad_script_versions` (`variant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `credit_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_refunds_job_idx` ON `credit_refunds` (`job_id`);