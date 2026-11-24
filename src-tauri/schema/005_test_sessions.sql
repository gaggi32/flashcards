-- 5: Test keeps its paper in study_sessions too, so both windows share one
-- test and it survives a restart. SQLite can't change a CHECK in place, so the
-- table is built again with 'test' allowed and the rounds already in it moved
-- across as they are.
CREATE TABLE study_sessions_new (
  set_id     INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL CHECK (mode IN ('cards', 'write', 'learn', 'test')),
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (set_id, mode)
);
INSERT INTO study_sessions_new (set_id, mode, data, updated_at)
  SELECT set_id, mode, data, updated_at FROM study_sessions;
DROP TABLE study_sessions;
ALTER TABLE study_sessions_new RENAME TO study_sessions;
