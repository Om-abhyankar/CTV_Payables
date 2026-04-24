# CTV Payables — Invoice Payment Tracker

A web-based invoice payment tracking system for internal operations.

## Features

- **Auto-calculated fields**: `due_date` = `invoice_date + payment_terms`, `status` and `days_remaining` recalculated from the current date on every request
- **Status logic**: `PAID` (payment received) → `OVERDUE` (past due, unpaid) → `DUE` (upcoming)
- **Dashboard summary**: Total Outstanding, Total Overdue, Received This Month, Overdue Count
- **Invoice table** with sorting on all columns
- **Filters**: by status, by client, "Due This Week", "Overdue Only"
- **Search**: by client name or invoice ID
- **Add Invoice** modal with live due-date preview
- **Mark as Paid** button per row
- **Delete** invoice
- **Export CSV** of current filtered view
- **Row highlights**: red for overdue, amber for due within 3 days
- **Auto-refresh** every 5 minutes so statuses stay current

## Tech Stack

| Layer    | Technology               |
|----------|--------------------------|
| Backend  | Node.js + Express        |
| Database | SQLite (better-sqlite3)  |
| Frontend | Vanilla HTML / CSS / JS  |

## Getting Started

```bash
npm install
npm start
```

Then open <http://localhost:3000> in your browser.

## Running Tests

```bash
npm test
```

## Project Structure

```
├── server.js       # Express REST API
├── database.js     # SQLite schema + queries
├── public/
│   ├── index.html  # Dashboard UI
│   ├── style.css   # Styles
│   └── app.js      # Frontend logic
└── test/
    └── api.test.js # Integration tests
```

## API Endpoints

| Method | Path                        | Description                |
|--------|-----------------------------|----------------------------|
| GET    | /api/invoices               | List invoices (filterable) |
| POST   | /api/invoices               | Create invoice             |
| PUT    | /api/invoices/:id/pay       | Mark as paid               |
| DELETE | /api/invoices/:id           | Delete invoice             |
| GET    | /api/summary                | Dashboard summary stats    |
| GET    | /api/clients                | Unique client names        |

### Query parameters for `GET /api/invoices`

| Param        | Description                                    |
|--------------|------------------------------------------------|
| `search`     | Search client name or invoice ID               |
| `status`     | Filter by status: `DUE`, `OVERDUE`, `PAID`     |
| `client`     | Filter by exact client name                    |
| `dueThisWeek`| `true` → invoices due in the next 7 days       |
| `overdueOnly`| `true` → overdue invoices only                 |
