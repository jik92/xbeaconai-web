ALTER TABLE `video_create_material_versions` ADD `subtitles_composed` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `video_create_material_versions` SET `subtitles_composed` = true WHERE `source` = 'subtitle_composed';
