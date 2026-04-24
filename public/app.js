/* ── State ────────────────────────────────────────────────────────────────── */
let invoices = [];
let sortKey  = 'due_date';
let sortDir  = 'asc';
let activeTab = '';   // '' | 'DUE' | 'DUE_SOON' | 'OVERDUE' | 'PAID'

const toastContainer = createToastContainer();

/* ── Bootstrap ────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadSummary();
  loadInvoices();
  loadClients();

  // Auto-refresh every 5 minutes so status stays current
  setInterval(() => { loadSummary(); loadInvoices(); }, 5 * 60 * 1000);

  // Search
  document.getElementById('searchInput').addEventListener('input', debounce(loadInvoices, 300));

  // Filters
  document.getElementById('partnerTypeFilter').addEventListener('change', loadInvoices);
  document.getElementById('clientFilter').addEventListener('change', loadInvoices);

  // Status tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      loadInvoices();
    });
  });

  // Clear filters
  document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);

  // Export
  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);

  // Modal
  document.getElementById('addInvoiceBtn').addEventListener('click', openModal);
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('addModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Due date preview
  document.getElementById('f_invoice_date').addEventListener('change', updateDueDatePreview);
  document.getElementById('f_payment_terms').addEventListener('change', updateDueDatePreview);

  // Payout auto-calculation
  document.getElementById('f_revenue').addEventListener('input', updatePayoutPreview);
  document.getElementById('f_rev_share_pct').addEventListener('input', updatePayoutPreview);

  // Form submit
  document.getElementById('addInvoiceForm').addEventListener('submit', handleAddInvoice);

  // Table sort
  document.querySelectorAll('.invoice-table thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = 'asc';
      }
      updateSortHeaders();
      renderTable(invoices);
    });
  });
});

/* ── API helpers ──────────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── Load & Render ────────────────────────────────────────────────────────── */
async function loadSummary() {
  try {
    const s = await api('GET', '/api/summary');
    document.getElementById('totalOutstanding').textContent  = formatCurrency(s.totalOutstanding);
    document.getElementById('totalOverdue').textContent      = formatCurrency(s.totalOverdue);
    document.getElementById('receivedThisMonth').textContent = formatCurrency(s.receivedThisMonth);
    document.getElementById('overdueCount').textContent      = s.overdueCount;
    document.getElementById('totalRevenue').textContent      = formatCurrency(s.totalRevenue || 0);
    document.getElementById('totalImpressions').textContent  = formatImpressions(s.totalImpressions || 0);
    document.getElementById('totalSpends').textContent       = formatCurrency(s.totalSpends || 0);
  } catch (err) {
    console.error('Summary load failed:', err);
  }
}

async function loadInvoices() {
  const params = buildParams();
  try {
    const all = await api('GET', `/api/invoices?${params}`);
    // Client-side filter for DUE_SOON (≤7 days remaining)
    if (activeTab === 'DUE_SOON') {
      invoices = all.filter(
        (inv) => inv.status === 'DUE' && inv.days_remaining >= 0 && inv.days_remaining <= 7
      );
    } else {
      invoices = all;
    }
    renderTable(invoices);
  } catch (err) {
    document.getElementById('invoiceBody').innerHTML =
      `<tr><td colspan="13" class="empty-state">Error loading records: ${esc(err.message)}</td></tr>`;
  }
}

async function loadClients() {
  try {
    const clients = await api('GET', '/api/clients');
    const sel = document.getElementById('clientFilter');
    [...sel.options].slice(1).forEach((o) => o.remove());
    clients.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
  } catch (_) { /* ignore */ }
}

function buildParams() {
  const p = new URLSearchParams();
  const search      = document.getElementById('searchInput').value.trim();
  const partnerType = document.getElementById('partnerTypeFilter').value;
  const client      = document.getElementById('clientFilter').value;

  if (search)      p.set('search', search);
  if (partnerType) p.set('partnerType', partnerType);
  if (client)      p.set('client', client);

  // Map tab to backend status filter (DUE_SOON is filtered client-side)
  if (activeTab === 'DUE')     p.set('status', 'DUE');
  if (activeTab === 'OVERDUE') p.set('overdueOnly', 'true');
  if (activeTab === 'PAID')    p.set('status', 'PAID');

  return p.toString();
}

function renderTable(data) {
  const sorted = sortData([...data]);
  const tbody  = document.getElementById('invoiceBody');

  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-state">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = sorted.map((inv) => {
    const rowClass     = getRowClass(inv);
    const daysLabel    = daysRemainingLabel(inv);
    const paidDisabled = inv.status === 'PAID' ? 'disabled' : '';
    const period       = inv.period_month || '—';

    return `<tr class="${rowClass}" data-id="${inv.id}">
      <td class="font-mono">${esc(period)}</td>
      <td><strong>${esc(inv.client_name)}</strong><br><span class="cell-id">${esc(inv.invoice_id)}</span></td>
      <td><span class="badge badge-${esc(inv.partner_type)}">${esc(inv.partner_type)}</span></td>
      <td class="text-right">${formatImpressions(inv.impressions || 0)}</td>
      <td class="text-right">${inv.spends > 0 ? formatCurrency(inv.spends) : '<span class="cell-empty">—</span>'}</td>
      <td class="text-right">${inv.revenue > 0 ? formatCurrency(inv.revenue) : '<span class="cell-empty">—</span>'}</td>
      <td class="text-right">${inv.rev_share_pct > 0 ? `${inv.rev_share_pct}%` : '<span class="cell-empty">—</span>'}</td>
      <td class="text-right"><strong>${formatCurrency(inv.amount)}</strong></td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td>${formatDate(inv.due_date)}</td>
      <td><span class="badge badge-${inv.status}">${inv.status}</span></td>
      <td class="text-right">${daysLabel}</td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-sm btn-pay" onclick="handlePay(${inv.id})" ${paidDisabled} title="${inv.status === 'PAID' ? 'Already paid' : 'Mark as paid'}">
            ✓ Paid
          </button>
          <button class="btn btn-sm btn-delete" onclick="handleDelete(${inv.id})" title="Delete record">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function getRowClass(inv) {
  if (inv.status === 'OVERDUE') return 'row-overdue';
  if (inv.status === 'DUE' && inv.days_remaining >= 0 && inv.days_remaining <= 7) return 'row-warn';
  if (inv.status === 'PAID') return 'row-paid';
  return '';
}

function daysRemainingLabel(inv) {
  if (inv.status === 'PAID') return '<span class="days-paid">Paid</span>';
  if (inv.days_remaining < 0)  return `<span class="days-overdue">${Math.abs(inv.days_remaining)}d overdue</span>`;
  if (inv.days_remaining === 0) return '<span class="days-today">Due today</span>';
  if (inv.days_remaining <= 7)  return `<span class="days-warning">${inv.days_remaining}d</span>`;
  return `${inv.days_remaining}d`;
}

/* ── Sort ─────────────────────────────────────────────────────────────────── */
function sortData(data) {
  return data.sort((a, b) => {
    let va = a[sortKey];
    let vb = b[sortKey];
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('.invoice-table thead th[data-sort]').forEach((th) => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === sortKey) {
      th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

/* ── Actions ──────────────────────────────────────────────────────────────── */
async function handlePay(id) {
  try {
    await api('PUT', `/api/invoices/${id}/pay`);
    showToast('Record marked as paid.', 'success');
    loadSummary();
    loadInvoices();
    loadClients();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleDelete(id) {
  if (!confirm('Delete this record? This action cannot be undone.')) return;
  try {
    await api('DELETE', `/api/invoices/${id}`);
    showToast('Record deleted.', 'success');
    loadSummary();
    loadInvoices();
    loadClients();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ── Add Record Modal ─────────────────────────────────────────────────────── */
function openModal() {
  document.getElementById('addModal').removeAttribute('hidden');
  document.getElementById('addInvoiceForm').reset();
  document.getElementById('f_due_date_preview').value = '';
  clearFormErrors();
  document.getElementById('f_client_name').focus();
}

function closeModal() {
  document.getElementById('addModal').setAttribute('hidden', '');
}

function updateDueDatePreview() {
  const dateVal  = document.getElementById('f_invoice_date').value;
  const termsVal = document.getElementById('f_payment_terms').value;
  if (!dateVal || !termsVal) {
    document.getElementById('f_due_date_preview').value = '';
    return;
  }
  const d = new Date(dateVal);
  d.setDate(d.getDate() + Number(termsVal));
  document.getElementById('f_due_date_preview').value = formatDate(d.toISOString().slice(0, 10));
}

function updatePayoutPreview() {
  const revenue     = parseFloat(document.getElementById('f_revenue').value) || 0;
  const revSharePct = parseFloat(document.getElementById('f_rev_share_pct').value) || 0;
  const amountInput = document.getElementById('f_amount');
  if (revenue > 0 && revSharePct >= 0) {
    amountInput.value = (revenue * (revSharePct / 100)).toFixed(2);
  }
}

async function handleAddInvoice(e) {
  e.preventDefault();
  clearFormErrors();

  const form = e.target;
  const revenue     = parseFloat(form.revenue.value) || 0;
  const revSharePct = parseFloat(form.rev_share_pct.value) || 0;
  const amountRaw   = parseFloat(form.amount.value) || 0;

  const data = {
    client_name:   form.client_name.value.trim(),
    invoice_id:    form.invoice_id.value.trim(),
    period_month:  form.period_month.value || null,
    partner_type:  form.partner_type.value,
    invoice_date:  form.invoice_date.value,
    payment_terms: form.payment_terms.value,
    impressions:   parseInt(form.impressions.value) || 0,
    spends:        parseFloat(form.spends.value) || 0,
    revenue,
    rev_share_pct: revSharePct,
    amount:        amountRaw,
  };

  let valid = true;
  if (!data.client_name)   { setFieldError('client_name',   'Required'); valid = false; }
  if (!data.invoice_id)    { setFieldError('invoice_id',    'Required'); valid = false; }
  if (!data.invoice_date)  { setFieldError('invoice_date',  'Required'); valid = false; }
  if (!data.payment_terms) { setFieldError('payment_terms', 'Required'); valid = false; }

  const calculatedPayout = revenue > 0 && revSharePct > 0 ? revenue * (revSharePct / 100) : 0;
  if (data.amount <= 0 && calculatedPayout <= 0) {
    setFieldError('amount', 'Enter a payout, or fill Revenue + Rev Share to auto-calculate');
    valid = false;
  } else if (data.amount <= 0 && calculatedPayout > 0 && calculatedPayout < 0.01) {
    setFieldError('amount', 'Calculated payout is below the minimum ($0.01)');
    valid = false;
  }
  if (!valid) return;

  const btn = document.getElementById('submitInvoiceBtn');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  try {
    await api('POST', '/api/invoices', data);
    showToast('Record added successfully.', 'success');
    closeModal();
    loadSummary();
    loadInvoices();
    loadClients();
  } catch (err) {
    if (err.message.toLowerCase().includes('invoice id')) {
      setFieldError('invoice_id', err.message);
    } else {
      showToast(err.message, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Record';
  }
}

function setFieldError(field, msg) {
  const input = document.querySelector(`[name="${field}"]`);
  if (input) input.classList.add('invalid');
  const errEl = document.getElementById(`err_${field}`);
  if (errEl) errEl.textContent = msg;
}

function clearFormErrors() {
  document.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
  document.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
}

/* ── Export CSV ───────────────────────────────────────────────────────────── */
function exportCsv() {
  if (!invoices.length) { showToast('No data to export.', 'error'); return; }

  const headers = [
    'ID','Period','Partner Name','Invoice ID','Partner Type',
    'Impressions','Spend','Revenue','Rev Share %','Publisher Payout',
    'Invoice Date','Payment Terms','Due Date','Payment Received Date',
    'Status','Days Remaining',
  ];
  const rows = invoices.map((inv) => [
    inv.id,
    inv.period_month || '',
    csvEsc(inv.client_name),
    csvEsc(inv.invoice_id),
    inv.partner_type,
    inv.impressions || 0,
    inv.spends || 0,
    inv.revenue || 0,
    inv.rev_share_pct || 0,
    inv.amount,
    inv.invoice_date,
    inv.payment_terms,
    inv.due_date,
    inv.payment_received_date || '',
    inv.status,
    inv.days_remaining,
  ]);

  const csv  = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `ctv_payables_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Clear filters ────────────────────────────────────────────────────────── */
function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('partnerTypeFilter').value = '';
  document.getElementById('clientFilter').value = '';
  activeTab = '';
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab=""]').classList.add('active');
  loadInvoices();
}

/* ── Toast ────────────────────────────────────────────────────────────────── */
function createToastContainer() {
  const el = document.createElement('div');
  el.className = 'toast-container';
  document.body.appendChild(el);
  return el;
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/* ── Formatting ───────────────────────────────────────────────────────────── */
function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
}

function formatImpressions(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000)     return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvEsc(str) {
  if (String(str).includes(',') || String(str).includes('"')) {
    return `"${String(str).replace(/"/g, '""')}"`;
  }
  return str;
}

/* ── Debounce ─────────────────────────────────────────────────────────────── */
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
