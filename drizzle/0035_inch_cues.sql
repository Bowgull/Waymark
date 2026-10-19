-- Units (E2E 2026-10-19b M4): Josh reads short distances in inches. The
-- McGill curl-up cue said "a few centimetres". Text only: one cue rewritten,
-- nothing else touched.
UPDATE exercises
SET form_cues = 'On your back, one knee bent, one leg straight, hands under the low back to keep its natural curve. Brace lightly and lift the head and shoulders about an inch as one unit. No chin tuck, no neck crank. Hold, then lower.'
WHERE id = 'ex-mcgill-curl-up';
