-- One row per UTC day: D1 rows written by requests from visitors and members
-- other than editors and admins. When the shared budget is spent, their
-- writes stop for the rest of the day while reading stays available.
CREATE TABLE daily_write_budget (
  day TEXT PRIMARY KEY,
  rows_written INTEGER NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  exhausted_at INTEGER
);
