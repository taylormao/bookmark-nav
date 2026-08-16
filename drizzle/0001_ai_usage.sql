CREATE TABLE `ai_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature` text NOT NULL,
	`provider` text NOT NULL,
	`success` integer NOT NULL,
	`duration_ms` integer,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
