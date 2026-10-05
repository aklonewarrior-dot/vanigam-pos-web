-- Add factor column to unit (grams per display unit)
ALTER TABLE unit ADD COLUMN IF NOT EXISTS factor INTEGER NOT NULL DEFAULT 1;
