ALTER TABLE `users` RENAME COLUMN "email" TO "phone";--> statement-breakpoint
UPDATE `users`
SET `phone` = 'legacy:' || `id`, `status` = 'disabled', `updated_at` = CURRENT_TIMESTAMP;--> statement-breakpoint
CREATE TABLE `sms_verification_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`purpose` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sms_codes_phone_purpose_created_idx` ON `sms_verification_codes` (`phone`,`purpose`,`created_at`);--> statement-breakpoint
DROP INDEX `users_email_unique`;--> statement-breakpoint
DROP INDEX `users_email_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_idx` ON `users` (`phone`);
