CREATE TABLE `provider_generation_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`module_id` text NOT NULL,
	`capability` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`operation` text NOT NULL,
	`provider_task_id` text,
	`provider_request_id` text,
	`status` text NOT NULL,
	`request_payload_json` text NOT NULL,
	`response_payload_json` text,
	`error_payload_json` text,
	`asset_ids_json` text DEFAULT '[]' NOT NULL,
	`submitted_at` text NOT NULL,
	`completed_at` text,
	`duration_ms` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_generation_audits_job_operation_idx` ON `provider_generation_audits` (`job_id`,`capability`,`operation`);--> statement-breakpoint
CREATE INDEX `provider_generation_audits_owner_submitted_idx` ON `provider_generation_audits` (`owner_user_id`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `provider_generation_audits_provider_submitted_idx` ON `provider_generation_audits` (`provider`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `provider_generation_audits_status_submitted_idx` ON `provider_generation_audits` (`status`,`submitted_at`);