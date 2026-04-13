CREATE TABLE `journal_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `date` integer NOT NULL,
  `type` text NOT NULL,
  `content` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX `idx_journal_date` ON `journal_entries` (`date`);
CREATE INDEX `idx_journal_type_date` ON `journal_entries` (`type`, `date`);
