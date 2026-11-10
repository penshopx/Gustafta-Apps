CREATE TABLE IF NOT EXISTS bedah_dokumen_monthly_usage (
  id serial PRIMARY KEY,
  user_id varchar(255) NOT NULL,
  month varchar(7) NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT bedah_dokumen_monthly_usage_count_nonnegative CHECK (count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS bedah_dokumen_monthly_usage_user_month_idx
  ON bedah_dokumen_monthly_usage (user_id, month);