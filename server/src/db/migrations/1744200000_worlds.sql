-- Up Migration

CREATE TABLE worlds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  seed             bigint NOT NULL DEFAULT 0,
  owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invite_code      text NOT NULL,
  state            jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_account_id, name),
  UNIQUE (invite_code)
);
CREATE INDEX worlds_owner_idx ON worlds(owner_account_id);

CREATE TABLE world_members (
  world_id   uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, account_id)
);
CREATE INDEX world_members_account_idx ON world_members(account_id);

-- Nuke existing characters so we can add a NOT NULL world_id without backfill.
DELETE FROM characters;

ALTER TABLE characters
  ADD COLUMN world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  ADD COLUMN overworld_pos jsonb;

CREATE INDEX characters_world_id_idx ON characters(world_id);

-- Down Migration
ALTER TABLE characters DROP COLUMN IF EXISTS overworld_pos;
ALTER TABLE characters DROP COLUMN IF EXISTS world_id;
DROP TABLE IF EXISTS world_members;
DROP TABLE IF EXISTS worlds;
