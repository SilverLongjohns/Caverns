-- Up Migration

CREATE TABLE character_shop_state (
  character_id   uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  shop_id        text NOT NULL,
  rotating_items jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, shop_id)
);

-- Down Migration

DROP TABLE IF EXISTS character_shop_state;
