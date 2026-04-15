ALTER TABLE training_blocks ADD COLUMN block_type TEXT NOT NULL DEFAULT 'fighter';
ALTER TABLE sessions ADD COLUMN block_type TEXT NOT NULL DEFAULT 'fighter';
