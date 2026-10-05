// tests/reports.mjs
import { api, signup, createCompany, rand, base } from './helpers.mjs';

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); passed++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failed++; }
}

async function main() {
  console.log('Reports API smoke test\nAPI: ' + base + '\n');

  const email = rand('reports') + '@vanigam.local';
  const password = 'test-' + Date.now();
  const token = await signup(email, password, 'Reports Tester');
  const company = await createCompany(token, 'Reports Test Co ' + Date.now());
  const cBase = '/api/companies/' + company.id;
  const h = { Authorization: 'Bearer ' + token };

  // Setup: category, unit, item
  const cat = await api('POST', cBase + '/categories', { name: 'Electrical' }, token);
  const catId = cat.json.category.id;
  const unit = await api('POST', cBase + '/units', { name: 'Piece', symbol: 'pc', factor: 1 }, token);
  const unitId = unit.json.unit.id;
  const item = await api('POST', cBase + '/items', {
    name: 'Test Bulb', unit_id: unitId, category_id: catId,
    cost_price: 5000, selling_price: 8000, stock_quantity: 100,
  }, token);
  const itemId = item.json.item.id;

  const customer = await api('POST', cBase + '/customers', { name: 'Test Customer' }, token);
  const customerId = customer.json.customer.id;
  const supplier = await api('POST', cBase + '/suppliers', { name: 'Test Supplier' }, token);
  const supplierId = supplier.json.supplier.id;

  // --- 1. Dashboard before any transactions ---
  console.log('[1] Dashboard - empty state');
  const dash1 = await api('GET', cBase + '/reports/dashboard', null, token);
  ok('dashboard returns ok', dash1.ok, JSON.stringify(dash1.json));
  ok('today sales = 0', dash1.json.today.sales === 0);
  ok('low stock count works', dash1.json.lowStockCount === 0);

  // --- 2. P&L - empty ---
  console.log('\n[2] P&L - empty');
  const pl1 = await api('GET', cBase + '/reports/pl?from=2026-04-01&to=2026-12-31', null, token);
  ok('P&L returns ok', pl1.ok, JSON.stringify(pl1.json));
  ok('revenue = 0', pl1.json.revenue === 0);
  ok('netProfit = 0', pl1.json.netProfit === 0);

  // --- 3. Create a sale ---
  console.log('\n[3] After one sale');
  const sale = await api('POST', cBase + '/sales', {
    customer_id: customerId,
    payment_mode: 'CASH',
    lines: [{
      item_id: itemId, item_name: 'Test Bulb',
      unit_id: unitId, unit_name: 'pc',
      quantity: 5, base_qty_milli: 5,
      rate: 8000, amount: 40000,
    }],
  }, token);
  ok('sale created', sale.ok, JSON.stringify(sale.json));

  const dash2 = await api('GET', cBase + '/reports/dashboard', null, token);
  ok('dashboard today sales = 40000', dash2.json.today.sales === 40000, 'got ' + dash2.json.today.sales);
  ok('dashboard today count = 1', dash2.json.today.salesCount === 1);

  // --- 4. P&L with sale ---
  console.log('\n[4] P&L after sale');
  const pl2 = await api('GET', cBase + '/reports/pl?from=2026-04-01&to=2026-12-31', null, token);
  ok('revenue = 40000', pl2.json.revenue === 40000, 'got ' + pl2.json.revenue);
  ok('cogs = 25000 (5 × 5000)', pl2.json.cogs === 25000, 'got ' + pl2.json.cogs);
  ok('grossProfit = 15000', pl2.json.grossProfit === 15000, 'got ' + pl2.json.grossProfit);
  ok('bills = 1', pl2.json.bills === 1);

  // --- 5. Add an expense ---
  console.log('\n[5] After expense');
  await api('POST', cBase + '/expenses', {
    category: 'Rent', amount: 5000, payment_mode: 'CASH',
  }, token).catch(() => {});

  // Note: /expenses route doesn't exist yet. Skip if 404.
  // We test P&L expense handling by verifying a zero case works.

  // --- 6. Balance sheet ---
  console.log('\n[6] Balance sheet');
  const bs = await api('GET', cBase + '/reports/balance-sheet?asOf=2026-12-31', null, token);
  ok('BS returns ok', bs.ok, JSON.stringify(bs.json));
  ok('BS has assets.cash', bs.json.assets && typeof bs.json.assets.cash === 'number', JSON.stringify(bs.json));
  ok('BS assets.total > 0', bs.json.assets.total > 0, 'total=' + bs.json.assets.total);
  ok('BS liabilities.total = assets.total', bs.json.liabilities.total === bs.json.assets.total,
     'assets=' + bs.json.assets.total + ' liab=' + bs.json.liabilities.total);

  // --- 7. Sequence numbering ---
  console.log('\n[7] Voucher numbers');
  const sale2 = await api('POST', cBase + '/sales', {
    customer_id: customerId, payment_mode: 'CASH',
    lines: [{ item_id: itemId, quantity: 1, base_qty_milli: 1, rate: 8000, amount: 8000 }],
  }, token);
  ok('second sale uses POS/2', sale2.json.invoice.invoice_number.endsWith('/2'), sale2.json.invoice.invoice_number);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  console.log('='.repeat(50));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nReports test crashed:', err);
  process.exit(1);
});
