-- Skip reason capture. Feeds the nightly reactive replan with an honest
-- signal instead of forcing the coach to infer from wellness/HR.
-- skip_reason: enum string ('too_sore' | 'low_sleep' | 'schedule' | 'low_drive' | 'sick' | 'injury' | 'other')
-- skip_reason_detail: body part for injury, or free text for other.

ALTER TABLE `sessions` ADD COLUMN `skip_reason` text;
ALTER TABLE `sessions` ADD COLUMN `skip_reason_detail` text;
