-- Up Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider text NOT NULL,
  provider_id   text NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, provider_id)
);

CREATE TABLE characters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  class             text NOT NULL,
  level             int  NOT NULL DEFAULT 1,
  xp                int  NOT NULL DEFAULT 0,
  stat_allocations  jsonb NOT NULL DEFAULT '{}',
  equipment         jsonb NOT NULL DEFAULT '{}',
  inventory         jsonb NOT NULL DEFAULT '[]',
  consumables       jsonb NOT NULL DEFAULT '[]',
  gold              int  NOT NULL DEFAULT 0,
  keychain          jsonb NOT NULL DEFAULT '[]',
  in_use            boolean NOT NULL DEFAULT false,
  last_played_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX characters_account_id_idx ON characters(account_id);

CREATE TABLE account_stash (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  items      jsonb NOT NULL DEFAULT '[]',
  gold       int   NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token       text PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_account_id_idx ON sessions(account_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

-- Down Migration
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS account_stash;
DROP TABLE IF EXISTS characters;
DROP TABLE IF EXISTS accounts;
