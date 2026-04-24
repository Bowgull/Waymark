-- Add plain-technical user-facing message to app_logs.
-- Shown prominently in the Logs viewer above the raw technical message.

ALTER TABLE app_logs ADD COLUMN user_message TEXT;
