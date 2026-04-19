-- Rename posture_corrective session type to mobility.
-- Table name posture_session_exercises stays (shared with foundation_run).
-- Only the sessions.type string value migrates.

UPDATE sessions SET type = 'mobility' WHERE type = 'posture_corrective';
