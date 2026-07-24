PRAGMA foreign_keys = ON;

-- 重置所有規則的 is_featured 標記與 featured_order 排序，徹底消除歷史手動勾選殘留
UPDATE rules SET is_featured = 0, featured_order = NULL;
