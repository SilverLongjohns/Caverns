-- One-shot wipe after character creation revamp.
-- Existing rows were created under the old class-based stat model and no longer round-trip cleanly.
DELETE FROM character_stash;
DELETE FROM character_shop_state;
DELETE FROM characters;
