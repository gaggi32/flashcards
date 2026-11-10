-- 1: sets, cards, one SM-2 schedule per card, and a log of every answer.
-- Shipped steps are never edited; add 002_*.sql and list it in db.rs.
CREATE TABLE sets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  folder      TEXT,
  title       TEXT NOT NULL,
  description TEXT,
  in_overlay  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX sets_created ON sets(created_at);

CREATE TABLE cards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id     INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  term       TEXT NOT NULL,
  definition TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX cards_set ON cards(set_id, position, id);

CREATE TABLE progress (
  card_id           INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  repetition_number INTEGER NOT NULL,
  ease_factor       REAL NOT NULL,
  interval_days     INTEGER NOT NULL,
  next_review_date  TEXT NOT NULL,
  last_reviewed_at  TEXT
);
CREATE INDEX progress_due ON progress(next_review_date);

CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  quality     INTEGER NOT NULL,
  day         TEXT NOT NULL,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX reviews_day ON reviews(day);
