CREATE TABLE `provider_credential_checks` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`checked_at` text NOT NULL
);
