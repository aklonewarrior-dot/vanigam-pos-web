export function currentFinancialYear(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return m >= 4 ? `${y}-${String(y + 1).slice(-2)}` : `${y - 1}-${String(y).slice(-2)}`;
}

export async function nextSequence(client, companyId, kind) {
  const fy = currentFinancialYear();
  const key = `${kind}_${fy}`;
  const result = await client.query(
    `INSERT INTO sequence (company_id, key, value) VALUES ($1, $2, 1)
     ON CONFLICT (company_id, key) DO UPDATE SET value = sequence.value + 1
     RETURNING value`,
    [companyId, key]
  );
  const n = result.rows[0].value;
  const prefix = { sales: 'POS/', purchase: 'PUR/', expense: 'EXP/', receipt: 'RCT/', payment: 'PAY/', journal: 'JV/' }[kind] || 'SEQ/';
  return prefix + n;
}
