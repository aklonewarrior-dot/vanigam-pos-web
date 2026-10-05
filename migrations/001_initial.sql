-- =====================================================
-- Vanigam POS - Initial Schema
-- Multi-company, Indian FY, paise/grams integers
-- =====================================================

BEGIN;

-- ---------- USERS & COMPANIES ----------

CREATE TABLE IF NOT EXISTS app_user (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address_line1 TEXT,
  address_line2 TEXT,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  financial_year_start TEXT NOT NULL DEFAULT '04-01',
  printer_name TEXT,
  printer_name_a4 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_company (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_user_company_user ON user_company(user_id);

-- ---------- MASTER DATA (company-scoped) ----------

CREATE TABLE IF NOT EXISTS item_category (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_category_company ON item_category(company_id);

CREATE TABLE IF NOT EXISTS unit (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_unit_company ON unit(company_id);

CREATE TABLE IF NOT EXISTS item (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  unit_id INTEGER REFERENCES unit(id),
  category_id INTEGER REFERENCES item_category(id),
  brand TEXT,
  cost_price BIGINT NOT NULL DEFAULT 0,
  selling_price BIGINT NOT NULL DEFAULT 0,
  mrp BIGINT NOT NULL DEFAULT 0,
  stock_quantity BIGINT NOT NULL DEFAULT 0,
  reorder_level BIGINT NOT NULL DEFAULT 0,
  reorder_quantity BIGINT NOT NULL DEFAULT 0,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_item_company ON item(company_id);
CREATE INDEX IF NOT EXISTS idx_item_name ON item(company_id, name);

CREATE TABLE IF NOT EXISTS customer (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  opening_balance BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_company ON customer(company_id);

CREATE TABLE IF NOT EXISTS supplier (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  opening_balance BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_company ON supplier(company_id);

-- ---------- SEQUENCES ----------

CREATE TABLE IF NOT EXISTS sequence (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  UNIQUE(company_id, key)
);

-- ---------- SALES ----------

CREATE TABLE IF NOT EXISTS sales_invoice (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  customer_id INTEGER REFERENCES customer(id),
  customer_name TEXT NOT NULL,
  subtotal BIGINT NOT NULL DEFAULT 0,
  round_off BIGINT NOT NULL DEFAULT 0,
  total_amount BIGINT NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_mode IN ('CASH','CREDIT')),
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_sale_company_date ON sales_invoice(company_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_sale_customer ON sales_invoice(company_id, customer_id);

CREATE TABLE IF NOT EXISTS sales_invoice_line (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES sales_invoice(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  unit_id INTEGER,
  unit_name TEXT,
  entered_qty BIGINT NOT NULL DEFAULT 0,
  base_qty_milli BIGINT NOT NULL DEFAULT 0,
  quantity BIGINT NOT NULL DEFAULT 0,
  rate BIGINT NOT NULL DEFAULT 0,
  amount BIGINT NOT NULL DEFAULT 0,
  cost_price_at_sale BIGINT
);
CREATE INDEX IF NOT EXISTS idx_sale_line_invoice ON sales_invoice_line(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sale_line_item ON sales_invoice_line(item_id);

-- ---------- PURCHASES ----------

CREATE TABLE IF NOT EXISTS purchase_invoice (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  purchase_number TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES supplier(id),
  supplier_name TEXT NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'CREDIT' CHECK (payment_mode IN ('CASH','CREDIT')),
  subtotal BIGINT NOT NULL DEFAULT 0,
  total_amount BIGINT NOT NULL DEFAULT 0,
  supplier_invoice_no TEXT,
  supplier_invoice_date DATE,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, purchase_number)
);
CREATE INDEX IF NOT EXISTS idx_purchase_company_date ON purchase_invoice(company_id, purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchase_supplier ON purchase_invoice(company_id, supplier_id);

CREATE TABLE IF NOT EXISTS purchase_invoice_line (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchase_invoice(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  unit_id INTEGER,
  unit_name TEXT,
  entered_qty BIGINT NOT NULL DEFAULT 0,
  base_qty_milli BIGINT NOT NULL DEFAULT 0,
  quantity BIGINT NOT NULL DEFAULT 0,
  rate BIGINT NOT NULL DEFAULT 0,
  amount BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchase_line_purchase ON purchase_invoice_line(purchase_id);

-- ---------- EXPENSES ----------

CREATE TABLE IF NOT EXISTS expense (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  expense_number TEXT NOT NULL,
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  paid_to TEXT,
  amount BIGINT NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'CASH',
  reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, expense_number)
);
CREATE INDEX IF NOT EXISTS idx_expense_company_date ON expense(company_id, expense_date);

-- ---------- RECEIPTS & PAYMENTS ----------

CREATE TABLE IF NOT EXISTS receipt (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  receipt_date DATE NOT NULL,
  customer_id INTEGER REFERENCES customer(id),
  customer_name TEXT NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, receipt_number)
);
CREATE INDEX IF NOT EXISTS idx_receipt_company_date ON receipt(company_id, receipt_date);
CREATE INDEX IF NOT EXISTS idx_receipt_customer ON receipt(company_id, customer_id);

CREATE TABLE IF NOT EXISTS payment (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  payment_number TEXT NOT NULL,
  payment_date DATE NOT NULL,
  supplier_id INTEGER REFERENCES supplier(id),
  supplier_name TEXT NOT NULL,
  amount BIGINT NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, payment_number)
);
CREATE INDEX IF NOT EXISTS idx_payment_company_date ON payment(company_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_supplier ON payment(company_id, supplier_id);

-- ---------- JOURNAL (double-entry) ----------

CREATE TABLE IF NOT EXISTS journal (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  journal_number TEXT NOT NULL,
  journal_date DATE NOT NULL,
  narration TEXT,
  total_debit BIGINT NOT NULL DEFAULT 0,
  total_credit BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, journal_number)
);
CREATE INDEX IF NOT EXISTS idx_journal_company_date ON journal(company_id, journal_date);

CREATE TABLE IF NOT EXISTS journal_entry (
  id SERIAL PRIMARY KEY,
  journal_id INTEGER NOT NULL REFERENCES journal(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  account TEXT NOT NULL,
  debit BIGINT NOT NULL DEFAULT 0,
  credit BIGINT NOT NULL DEFAULT 0,
  narration TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_entry_journal ON journal_entry(journal_id);

COMMIT;

-- Sanity: list all tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
