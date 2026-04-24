const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const {
  getAllInvoices,
  createInvoice,
  markAsPaid,
  deleteInvoice,
  getSummary,
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter: max 200 requests per minute per IP for API and SPA routes
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ── Helper ───────────────────────────────────────────────────────────────────

function applyFilters(invoices, query) {
  let result = invoices;

  // Search by client name or invoice_id
  if (query.search) {
    const q = query.search.toLowerCase();
    result = result.filter(
      (inv) =>
        inv.client_name.toLowerCase().includes(q) ||
        inv.invoice_id.toLowerCase().includes(q)
    );
  }

  // Filter by status
  if (query.status) {
    const statuses = query.status.toUpperCase().split(',');
    result = result.filter((inv) => statuses.includes(inv.status));
  }

  // Filter by client name (exact, case-insensitive)
  if (query.client) {
    const c = query.client.toLowerCase();
    result = result.filter((inv) => inv.client_name.toLowerCase() === c);
  }

  // Show only invoices due in next 7 days (DUE status + days_remaining <= 7)
  if (query.dueThisWeek === 'true') {
    result = result.filter(
      (inv) => inv.status === 'DUE' && inv.days_remaining >= 0 && inv.days_remaining <= 7
    );
  }

  // Show overdue only
  if (query.overdueOnly === 'true') {
    result = result.filter((inv) => inv.status === 'OVERDUE');
  }

  return result;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/summary
app.get('/api/summary', (_req, res) => {
  try {
    res.json(getSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices
app.get('/api/invoices', (req, res) => {
  try {
    const all = getAllInvoices();
    const filtered = applyFilters(all, req.query);
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invoices
app.post('/api/invoices', (req, res) => {
  try {
    const { client_name, invoice_id, invoice_date, amount, payment_terms } = req.body;

    // Basic validation
    if (!client_name || !invoice_id || !invoice_date || amount == null || !payment_terms) {
      return res.status(400).json({ error: 'All fields are required.' });
    }
    if (![30, 45, 60, 90].includes(Number(payment_terms))) {
      return res.status(400).json({ error: 'payment_terms must be 30, 45, 60, or 90.' });
    }
    if (isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number.' });
    }

    const invoice = createInvoice({ client_name, invoice_id, invoice_date, amount: Number(amount), payment_terms: Number(payment_terms) });
    res.status(201).json(invoice);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Invoice ID already exists.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/invoices/:id/pay
app.put('/api/invoices/:id/pay', (req, res) => {
  try {
    const invoice = markAsPaid(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/invoices/:id
app.delete('/api/invoices/:id', (req, res) => {
  try {
    const deleted = deleteInvoice(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Invoice not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients  – unique client names for filter dropdown
app.get('/api/clients', (_req, res) => {
  try {
    const all = getAllInvoices();
    const clients = [...new Set(all.map((inv) => inv.client_name))].sort();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all → serve SPA
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`CTV Payables running on http://localhost:${PORT}`);
});

module.exports = server;
