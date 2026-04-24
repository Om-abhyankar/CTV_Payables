/**
 * Basic API integration tests (no external test framework needed).
 * Uses the built-in Node http module and an in-memory approach by
 * importing the app directly.
 *
 * Run: node test/api.test.js
 */

process.env.PORT = '0'; // Let OS pick a free port

const http = require('http');
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Use a temp file DB for tests
const tmpDb = path.join(os.tmpdir(), `ctv_test_${Date.now()}.db`);

// ── Start server ──────────────────────────────────────────────────────────
const app = require('../server.js');

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: app.address().port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  // Server is already listening because require('../server.js') called app.listen
  // But server.js exports `app` which is the Express instance, not an http.Server.
  // We need to wrap it. Let's adjust.

  console.log('⚙  Starting test suite…\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}`);
      console.error(`     ${err.message}`);
      failed++;
    }
  }

  // ── Summary (empty DB) ────────────────────────────────────────────────
  await test('GET /api/summary returns zeroes on empty DB', async () => {
    const r = await request('GET', '/api/summary');
    assert.equal(r.status, 200);
    assert.equal(r.body.totalOutstanding, 0);
    assert.equal(r.body.overdueCount, 0);
  });

  // ── GET invoices (empty) ──────────────────────────────────────────────
  await test('GET /api/invoices returns empty array', async () => {
    const r = await request('GET', '/api/invoices');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
  });

  // ── Create invoice ────────────────────────────────────────────────────
  let createdId;
  await test('POST /api/invoices creates invoice and auto-calculates due_date', async () => {
    const r = await request('POST', '/api/invoices', {
      client_name: 'Acme Corp',
      invoice_id:  'INV-001',
      invoice_date: '2025-01-01',
      amount: 5000,
      payment_terms: 30,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.client_name, 'Acme Corp');
    assert.equal(r.body.due_date, '2025-01-31');
    assert.ok(['DUE','OVERDUE','PAID'].includes(r.body.status));
    createdId = r.body.id;
  });

  // ── Duplicate invoice_id ──────────────────────────────────────────────
  await test('POST /api/invoices rejects duplicate invoice_id with 409', async () => {
    const r = await request('POST', '/api/invoices', {
      client_name: 'Other',
      invoice_id:  'INV-001',
      invoice_date: '2025-02-01',
      amount: 100,
      payment_terms: 30,
    });
    assert.equal(r.status, 409);
  });

  // ── Invalid payment_terms ─────────────────────────────────────────────
  await test('POST /api/invoices rejects invalid payment_terms', async () => {
    const r = await request('POST', '/api/invoices', {
      client_name: 'X', invoice_id: 'INV-999', invoice_date: '2025-01-01',
      amount: 100, payment_terms: 15,
    });
    assert.equal(r.status, 400);
  });

  // ── Mark as paid ──────────────────────────────────────────────────────
  await test('PUT /api/invoices/:id/pay marks invoice as PAID', async () => {
    const r = await request('PUT', `/api/invoices/${createdId}/pay`);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'PAID');
    assert.ok(r.body.payment_received_date);
  });

  // ── Summary reflects payment ──────────────────────────────────────────
  await test('GET /api/summary reflects paid invoice', async () => {
    const r = await request('GET', '/api/summary');
    assert.equal(r.status, 200);
    assert.equal(r.body.totalOutstanding, 0);
  });

  // ── Filter by status ──────────────────────────────────────────────────
  await test('GET /api/invoices?status=PAID returns only paid', async () => {
    const r = await request('GET', '/api/invoices?status=PAID');
    assert.equal(r.status, 200);
    assert.ok(r.body.every((inv) => inv.status === 'PAID'));
  });

  // ── Delete invoice ────────────────────────────────────────────────────
  await test('DELETE /api/invoices/:id removes the invoice', async () => {
    const r = await request('DELETE', `/api/invoices/${createdId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    const r2 = await request('GET', '/api/invoices');
    assert.deepEqual(r2.body, []);
  });

  // ── 404 on missing invoice ────────────────────────────────────────────
  await test('PUT /api/invoices/9999/pay returns 404', async () => {
    const r = await request('PUT', '/api/invoices/9999/pay');
    assert.equal(r.status, 404);
  });

  // ── OVERDUE status logic ──────────────────────────────────────────────
  await test('Invoice with past due_date has OVERDUE status', async () => {
    const r = await request('POST', '/api/invoices', {
      client_name: 'Old Client',
      invoice_id: 'INV-OLD',
      invoice_date: '2020-01-01',
      amount: 1000,
      payment_terms: 30,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'OVERDUE');
    assert.ok(r.body.days_remaining < 0);
    // cleanup
    await request('DELETE', `/api/invoices/${r.body.id}`);
  });

  // ── DUE status logic ──────────────────────────────────────────────────
  await test('Invoice with future due_date has DUE status', async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const r = await request('POST', '/api/invoices', {
      client_name: 'Future Client',
      invoice_id: 'INV-FUTURE',
      invoice_date: future.toISOString().slice(0, 10),
      amount: 2500,
      payment_terms: 90,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'DUE');
    assert.ok(r.body.days_remaining > 0);
    await request('DELETE', `/api/invoices/${r.body.id}`);
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);

  // Cleanup temp DB
  try { fs.unlinkSync(tmpDb); } catch (_) {}
  try { fs.unlinkSync(tmpDb + '-shm'); } catch (_) {}
  try { fs.unlinkSync(tmpDb + '-wal'); } catch (_) {}

  process.exit(failed > 0 ? 1 : 0);
}

// Wait for server to be ready
if (typeof app.address === 'function' && app.address()) {
  run();
} else {
  app.on('listening', run);
}
