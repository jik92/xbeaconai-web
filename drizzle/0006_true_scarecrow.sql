CREATE TABLE `admin_credit_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`admin_user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`credits` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_credit_grants_admin_idempotency_idx` ON `admin_credit_grants` (`admin_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `admin_credit_grants_user_created_idx` ON `admin_credit_grants` (`user_id`,`created_at`);