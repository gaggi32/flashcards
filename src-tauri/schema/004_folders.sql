-- 4: folders as rows of their own, so one can exist before any set is in it
-- ("New folder" on the sets screen). A set still names its folder in
-- sets.folder; every name a set uses also has a row here, and a folder stays
-- until it is removed, even once its last set has moved out.
CREATE TABLE folders (
  name TEXT PRIMARY KEY
);
INSERT OR IGNORE INTO folders (name) SELECT DISTINCT folder FROM sets WHERE folder IS NOT NULL;
