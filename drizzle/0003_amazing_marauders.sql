CREATE TABLE `provider_credentials` (
	`name` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`nonce` text NOT NULL,
	`auth_tag` text NOT NULL,
	`last_four` text NOT NULL,
	`updated_by_user_id` text,
	`updated_at` text NOT NULL
);
