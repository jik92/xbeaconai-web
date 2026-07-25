CREATE TABLE `module_output_folder_defaults` (
	`owner_user_id` text NOT NULL,
	`module_id` text NOT NULL,
	`folder_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `asset_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_output_folder_defaults_owner_module_idx` ON `module_output_folder_defaults` (`owner_user_id`,`module_id`);--> statement-breakpoint
CREATE INDEX `module_output_folder_defaults_folder_idx` ON `module_output_folder_defaults` (`folder_id`);