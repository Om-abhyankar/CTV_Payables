/* ── State ────────────────────────────────────────────────────────────────── */
let invoices = [];
let sortKey = 'due_date';
let sortDir = 'asc';

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
  document.getElementById('statusFilter').addEventListener('change', loadInvoices);
  document.getElementById('clientFilter').addEventListener('change', loadInvoices);

  // Toggle buttons
  document.getElementById('dueThisWeekBtn').addEventListener('click', () => {
    toggleBtn('dueThisWeekBtn');
    if (getActive('dueThisWeekBtn')) setActive('overdueOnlyBtn', false);
    loadInvoices();
  });
  document.getElementById('overdueOnlyBtn').addEventListener('click', () => {
    toggleBtn('overdueOnlyBtn');
    if (getActive('overdueOnlyBtn')) setActive('dueThisWeekBtn', false);
    loadInvoices();
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
    document.getElementById('totalOutstanding').textContent = formatCurrency(s.totalOutstanding);
    document.getElementById('totalOverdue').textContent      = formatCurrency(s.totalOverdue);
    document.getElementById('receivedThisMonth').textContent = formatCurrency(s.receivedThisMonth);
    document.getElementById('overdueCount').textContent      = s.overdueCount;
  } catch (err) {
    console.error('Summary load failed:', err);
  }
}

async function loadInvoices() {
  const params = buildParams();
  try {
    invoices = await api('GET', `/api/invoices?${params}`);
    renderTable(invoices);
  } catch (err) {
    document.getElementById('invoiceBody').innerHTML =
      `<tr><td colspan="8" class="empty-state">Error loading invoices: ${esc(err.message)}</td></tr>`;
  }
}

async function loadClients() {
  try {
    const clients = await api('GET', '/api/clients');
    const sel = document.getElementById('clientFilter');
    // Remove old dynamic options
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
  const search    = document.getElementById('searchInput').value.trim();
  const status    = document.getElementById('statusFilter').value;
  const client    = document.getElementById('clientFilter').value;
  const dtw       = getActive('dueThisWeekBtn');
  const overOnly  = getActive('overdueOnlyBtn');

  if (search)   p.set('search', search);
  if (status)   p.set('status', status);
  if (client)   p.set('client', client);
  if (dtw)      p.set('dueThisWeek', 'true');
  if (overOnly) p.set('overdueOnly', 'true');
  return p.toString();
}

function renderTable(data) {
  const sorted = sortData([...data]);
  const tbody = document.getElementById('invoiceBody');

  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No invoices found.</td></tr>';
    return;
  }

  tbody.innerHTML = sorted.map((inv) => {
    const rowClass = getRowClass(inv);
    const daysLabel = daysRemainingLabel(inv);
    const paidDisabled = inv.status === 'PAID' ? 'disabled title="Already paid"' : '';

    return `<tr class="${rowClass}" data-id="${inv.id}">
      <td>${esc(inv.client_name)}</td>
      <td><code>${esc(inv.invoice_id)}</code></td>
      <td class="text-right">${formatCurrency(inv.amount)}</td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td>${formatDate(inv.due_date)}</td>
      <td><span class="badge badge-${inv.status}">${inv.status}</span></td>
      <td class="text-right">${daysLabel}</td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-sm btn-pay" onclick="handlePay(${inv.id})" ${paidDisabled}>
            ✓ Mark Paid
          </button>
          <button class="btn btn-sm btn-delete" onclick="handleDelete(${inv.id})" title="Delete invoice">
            ✕
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function getRowClass(inv) {
  if (inv.status === 'OVERDUE') return 'row-overdue';
  if (inv.status === 'DUE' && inv.days_remaining >= 0 && inv.days_remaining <= 3) return 'row-warn';
  return '';
}

function daysRemainingLabel(inv) {
  if (inv.status === 'PAID') return '<span style="color:var(--color-muted)">—</span>';
  if (inv.days_remaining < 0) return `<span style="color:var(--color-overdue)">${Math.abs(inv.days_remaining)}d overdue</span>`;
  if (inv.days_remaining === 0) return '<span style="color:var(--color-warn)">Due today</span>';
  return `${inv.days_remaining}d`;
}

/* ── Sort ─────────────────────────────────────────────────────────────────── */
function sortData(data) {
  return data.sort((a, b) => {
    let va = a[sortKey];
    let vb = b[sortKey];
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
    showToast('Invoice marked as paid.', 'success');
    loadSummary();
    loadInvoices();
    loadClients();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleDelete(id) {
  if (!confirm('Delete this invoice? This action cannot be undone.')) return;
  try {
    await api('DELETE', `/api/invoices/${id}`);
    showToast('Invoice deleted.', 'success');
    loadSummary();
    loadInvoices();
    loadClients();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ── Add Invoice Modal ────────────────────────────────────────────────────── */
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

async function handleAddInvoice(e) {
  e.preventDefault();
  clearFormErrors();

  const form = e.target;
  const data = {
    client_name:    form.client_name.value.trim(),
    invoice_id:     form.invoice_id.value.trim(),
    invoice_date:   form.invoice_date.value,
    amount:         form.amount.value,
    payment_terms:  form.payment_terms.value,
  };

  let valid = true;
  if (!data.client_name)   { setFieldError('client_name', 'Required'); valid = false; }
  if (!data.invoice_id)    { setFieldError('invoice_id',  'Required'); valid = false; }
  if (!data.invoice_date)  { setFieldError('invoice_date','Required'); valid = false; }
  if (!data.amount || isNaN(Number(data.amount)) || Number(data.amount) <= 0) {
    setFieldError('amount', 'Enter a positive amount'); valid = false;
  }
  if (!data.payment_terms) { setFieldError('payment_terms','Required'); valid = false; }
  if (!valid) return;

  const btn = document.getElementById('submitInvoiceBtn');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  try {
    await api('POST', '/api/invoices', data);
    showToast('Invoice added successfully.', 'success');
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
    btn.textContent = 'Add Invoice';
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

  const headers = ['ID','Client Name','Invoice ID','Amount','Invoice Date','Payment Terms','Due Date','Payment Received Date','Status','Days Remaining'];
  const rows = invoices.map((inv) => [
    inv.id,
    csvEsc(inv.client_name),
    csvEsc(inv.invoice_id),
    inv.amount,
    inv.invoice_date,
    inv.payment_terms,
    inv.due_date,
    inv.payment_received_date || '',
    inv.status,
    inv.days_remaining,
  ]);

  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `invoices_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Toggle helpers ───────────────────────────────────────────────────────── */
function toggleBtn(id) {
  const btn = document.getElementById(id);
  const current = btn.dataset.active === 'true';
  btn.dataset.active = String(!current);
}
function getActive(id) {
  return document.getElementById(id).dataset.active === 'true';
}
function setActive(id, val) {
  document.getElementById(id).dataset.active = String(val);
}

function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('statusFilter').value = '';
  document.getElementById('clientFilter').value = '';
  setActive('dueThisWeekBtn', false);
  setActive('overdueOnlyBtn', false);
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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
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
