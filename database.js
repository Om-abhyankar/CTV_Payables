const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'invoices.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create table
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name           TEXT    NOT NULL,
    invoice_id            TEXT    NOT NULL UNIQUE,
    invoice_date          TEXT    NOT NULL,
    amount                REAL    NOT NULL,
    payment_terms         INTEGER NOT NULL CHECK(payment_terms IN (30, 45, 60, 90)),
    due_date              TEXT    NOT NULL,
    payment_received_date TEXT,
    created_at            TEXT    NOT NULL DEFAULT (date('now'))
  )
`);

/**
 * Calculate status and days_remaining from stored fields + today's date.
 * These are always computed at query time, never stored.
 */
function enrichInvoice(inv) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(inv.due_date);
  due.setHours(0, 0, 0, 0);

  const msPerDay = 86400000;
  const daysRemaining = Math.round((due - today) / msPerDay);

  let status;
  if (inv.payment_received_date) {
    status = 'PAID';
  } else if (today > due) {
    status = 'OVERDUE';
  } else {
    status = 'DUE';
  }

  return { ...inv, status, days_remaining: daysRemaining };
}

// ── Queries ──────────────────────────────────────────────────────────────────

function getAllInvoices() {
  const rows = db.prepare('SELECT * FROM invoices ORDER BY due_date ASC').all();
  return rows.map(enrichInvoice);
}

function getInvoiceById(id) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  return row ? enrichInvoice(row) : null;
}

function createInvoice({ client_name, invoice_id, invoice_date, amount, payment_terms }) {
  // Calculate due_date = invoice_date + payment_terms days
  const invDate = new Date(invoice_date);
  invDate.setDate(invDate.getDate() + Number(payment_terms));
  const due_date = invDate.toISOString().slice(0, 10);

  const stmt = db.prepare(`
    INSERT INTO invoices (client_name, invoice_id, invoice_date, amount, payment_terms, due_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(client_name, invoice_id, invoice_date, amount, payment_terms, due_date);
  return getInvoiceById(result.lastInsertRowid);
}

function markAsPaid(id) {
  const today = new Date().toISOString().slice(0, 10);
  const stmt = db.prepare(
    'UPDATE invoices SET payment_received_date = ? WHERE id = ?'
  );
  const result = stmt.run(today, id);
  if (result.changes === 0) return null;
  return getInvoiceById(id);
}

function deleteInvoice(id) {
  const result = db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  return result.changes > 0;
}

function getSummary() {
  const invoices = getAllInvoices();

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  let totalOutstanding = 0;
  let totalOverdue = 0;
  let receivedThisMonth = 0;
  let overdueCount = 0;

  for (const inv of invoices) {
    if (inv.status !== 'PAID') {
      totalOutstanding += inv.amount;
    }
    if (inv.status === 'OVERDUE') {
      totalOverdue += inv.amount;
      overdueCount += 1;
    }
    if (
      inv.status === 'PAID' &&
      inv.payment_received_date >= firstOfMonth &&
      inv.payment_received_date <= lastOfMonth
    ) {
      receivedThisMonth += inv.amount;
    }
  }

  return { totalOutstanding, totalOverdue, receivedThisMonth, overdueCount };
}

module.exports = { getAllInvoices, getInvoiceById, createInvoice, markAsPaid, deleteInvoice, getSummary };
