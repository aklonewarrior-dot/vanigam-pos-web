-- Remove role column from user_company
ALTER TABLE user_company DROP COLUMN IF EXISTS role;
