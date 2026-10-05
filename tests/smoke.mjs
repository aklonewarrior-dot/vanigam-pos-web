// tests/smoke.mjs
import { api, signup, login, createCompany, rand, base } from './helpers.mjs';

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    console.log('  PASS  ' + name);
    passed++;
  } else {
    console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : ''));
    failed++;
  }
}

async function main() {
  console.log('Vanigam POS smoke test\nAPI: ' + base + '\n');

  const email = rand('smoke') + '@vanigam.local';
  const password = 'test-' + Date.now();

  // 1. Health
  console.log('[1] Health');
  const health = await api('GET', '/api/health');
  ok('health returns ok', health.ok && health.json.ok, JSON.stringify(health.json));

  // 2. Signup
  console.log('\n[2] Auth');
  const token = await signup(email, password, 'Smoke Tester');
  ok('signup returns token', !!token);
  const me = await api('GET', '/api/auth/me', null, token);
  ok('me returns email', me.ok && me.json.user.email === email, JSON.stringify(me.json));

  // 3. Company
  console.log('\n[3] Company');
  const company = await createCompany(token, 'Smoke Test Co ' + Date.now());
  ok('company created', !!company.id, JSON.stringify(company));
  const cBase = '/api/companies/' + company.id;

  // 4. Category
  console.log('\n[4] Category');
  const catName = 'Cat ' + rand('x');
  const catR = await api('POST', cBase + '/categories', { name: catName }, token);
  ok('category created', catR.ok && catR.json.category.id > 0, JSON.stringify(catR.json));
  const catId = catR.json.category.id;

  const dupCat = await api('POST', cBase + '/categories', { name: catName }, token);
  ok('duplicate category rejected', dupCat.status === 409, 'status=' + dupCat.status);

  // 5. Units
  console.log('\n[5] Units');
  const pcR = await api('POST', cBase + '/units', { name: 'Piece', symbol: 'pc', factor: 1 }, token);
  ok('piece unit created', pcR.ok, JSON.stringify(pcR.json));
  const pcId = pcR.json.unit.id;

  const kgR = await api('POST', cBase + '/units', { name: 'Kilogram', symbol: 'kg', factor: 1000 }, token);
  ok('kg unit created factor=1000', kgR.ok && kgR.json.unit.factor === 1000, JSON.stringify(kgR.json));
  const kgId = kgR.json.unit.id;

  // 6. Items
  console.log('\n[6] Items');
  const itemName = rand('Item');
  const itR = await api('POST', cBase + '/items', {
    name: itemName, unit_id: pcId, category_id: catId,
    brand: 'TestBrand', cost_price: 1000, selling_price: 1500, mrp: 1500,
    stock_quantity: 50, reorder_level: 10,
  }, token);
  ok('item created', itR.ok && itR.json.item.id > 0, JSON.stringify(itR.json));
  ok('item auto-code generated', itR.json.item.code && itR.json.item.code.startsWith('ITEM-'), itR.json.item.code);
  const itemId = itR.json.item.id;

  const listR = await api('GET', cBase + '/items', null, token);
  ok('items list includes new item', listR.ok && listR.json.items.some((i) => i.id === itemId));

  const searchR = await api('GET', cBase + '/items/search?q=' + encodeURIComponent(itemName), null, token);
  ok('search finds item', searchR.ok && searchR.json.items.length > 0);

  // 7. Item update
  console.log('\n[7] Item update');
  const updR = await api('PATCH', cBase + '/items/' + itemId, { selling_price: 1600 }, token);
  ok('item selling_price updated', updR.ok && updR.json.item.selling_price === 1600, JSON.stringify(updR.json));

  // 8. Delete guards
  console.log('\n[8] Delete guards');
  const delCat = await api('DELETE', cBase + '/categories/' + catId, null, token);
  ok('category with items cannot be deleted', delCat.status === 409, 'status=' + delCat.status);

  const delUnit = await api('DELETE', cBase + '/units/' + pcId, null, token);
  ok('unit with items cannot be deleted', delUnit.status === 409, 'status=' + delUnit.status);

  // 9. Unused category can be deleted (soft)
  console.log('\n[9] Soft delete');
  const orphanCat = await api('POST', cBase + '/categories', { name: rand('Orphan') }, token);
  const orphanId = orphanCat.json.category.id;
  const delOrphan = await api('DELETE', cBase + '/categories/' + orphanId, null, token);
  ok('unused category can be deleted', delOrphan.ok, JSON.stringify(delOrphan.json));

  // 10. Cross-company isolation
  console.log('\n[10] Isolation');
  const secondCompany = await createCompany(token, 'Second Co ' + Date.now());
  const secondItems = await api('GET', '/api/companies/' + secondCompany.id + '/items', null, token);
  ok('second company has no items', secondItems.ok && secondItems.json.items.length === 0, 'len=' + secondItems.json.items.length);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Passed: ' + passed);
  console.log('Failed: ' + failed);
  console.log('='.repeat(50));

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
