ALTER TABLE `video_create_shots` ADD `audio_artifact_id` text;--> statement-breakpoint
ALTER TABLE `video_create_shots` ADD `subtitle_cues_json` text DEFAULT '[]' NOT NULL;