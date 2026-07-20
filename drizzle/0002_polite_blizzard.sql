CREATE TABLE `video_create_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`input_json` text NOT NULL,
	`recommendation_json` text,
	`current_job_id` text,
	`final_artifact_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text,
	`error_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `video_create_projects_owner_updated_idx` ON `video_create_projects` (`owner_user_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `video_create_projects_owner_idempotency_idx` ON `video_create_projects` (`owner_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `video_create_script_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`label` text NOT NULL,
	`current_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `video_create_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_create_sections_project_ordinal_idx` ON `video_create_script_sections` (`project_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `video_create_sections_project_idx` ON `video_create_script_sections` (`project_id`);--> statement-breakpoint
CREATE TABLE `video_create_script_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`source` text NOT NULL,
	`parent_version_id` text,
	`text` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `video_create_script_sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_create_versions_section_sequence_idx` ON `video_create_script_versions` (`section_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `video_create_versions_section_idx` ON `video_create_script_versions` (`section_id`);--> statement-breakpoint
CREATE TABLE `video_create_shots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`script_section_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`prompt` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`job_id` text,
	`video_asset_id` text,
	`audio_enabled` integer DEFAULT true NOT NULL,
	`subtitle_enabled` integer DEFAULT true NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `video_create_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`script_section_id`) REFERENCES `video_create_script_sections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_create_shots_project_ordinal_idx` ON `video_create_shots` (`project_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `video_create_shots_project_idx` ON `video_create_shots` (`project_id`);