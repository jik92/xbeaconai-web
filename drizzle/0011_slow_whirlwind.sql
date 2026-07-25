CREATE TABLE `video_create_material_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`shot_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`storage_kind` text,
	`content_id` text,
	`input_version_id` text,
	`job_id` text,
	`error_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `video_create_projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot_id`) REFERENCES `video_create_shots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `video_create_material_versions_shot_created_idx` ON `video_create_material_versions` (`shot_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `video_create_material_versions_project_idx` ON `video_create_material_versions` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `video_create_material_versions_job_idx` ON `video_create_material_versions` (`job_id`);--> statement-breakpoint
ALTER TABLE `video_create_shots` ADD `current_material_version_id` text;--> statement-breakpoint
INSERT INTO `video_create_material_versions` (
	`id`, `project_id`, `shot_id`, `source`, `status`, `storage_kind`, `content_id`, `created_at`, `updated_at`
)
SELECT
	lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) ||
	'-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
	`project_id`,
	`id`,
	CASE WHEN EXISTS (
		SELECT 1 FROM `media_assets` WHERE `media_assets`.`id` = `video_create_shots`.`video_asset_id`
	) THEN 'library_replacement' ELSE 'ai_generated' END,
	'succeeded',
	CASE WHEN EXISTS (
		SELECT 1 FROM `media_assets` WHERE `media_assets`.`id` = `video_create_shots`.`video_asset_id`
	) THEN 'asset' ELSE 'artifact' END,
	`video_asset_id`,
	`created_at`,
	`updated_at`
FROM `video_create_shots`
WHERE `video_asset_id` IS NOT NULL;--> statement-breakpoint
UPDATE `video_create_shots`
SET `current_material_version_id` = (
	SELECT `id`
	FROM `video_create_material_versions`
	WHERE `video_create_material_versions`.`shot_id` = `video_create_shots`.`id`
	ORDER BY `created_at` DESC
	LIMIT 1
)
WHERE `video_asset_id` IS NOT NULL;
