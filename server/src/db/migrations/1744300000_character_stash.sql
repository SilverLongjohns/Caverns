-- Up Migration

DROP TABLE IF EXISTS account_stash;

CREATE TABLE character_stash (
  character_id uuid PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  items        jsonb NOT NULL DEFAULT '[]',
  gold         int   NOT NULL DEFAULT 0,
  capacity     int   NOT NULL DEFAULT 20
);

-- Down Migration

DROP TABLE IF EXISTS character_stash;

CREATE TABLE account_stash (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  items      jsonb NOT NULL DEFAULT '[]',
  gold       int   NOT NULL DEFAULT 0
);
