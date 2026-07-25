-- 為 daily_views 建立 (view_date DESC, created_at DESC) 複合索引
-- 徹底消除 ORDER BY view_date DESC, created_at DESC 時的全表排序與 D1 rows_read 暴增問題

CREATE INDEX IF NOT EXISTS idx_daily_views_date_created ON daily_views(view_date DESC, created_at DESC);
