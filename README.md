# Spend Analyser

Cashflow and payee analytics for Indian bank statements. A Python (FastAPI) backend reads the statements and stores them in a local SQLite database. A Next.js frontend shows the dashboard. Nothing leaves your machine.

## Run

```bash
./dev.sh
```

Then open http://localhost:3000 and upload a statement on the Statements page (or the welcome screen).

Requirements: [uv](https://docs.astral.sh/uv/) and Node 20+. The script installs dependencies on its first run.

To run the two halves separately:

```bash
cd backend  && uv run uvicorn app.main:app --port 8000 --reload
cd frontend && npm run dev
```

## What it handles

- **Formats:** CSV, XLS, XLSX, and the HTML-in-.xls files many Indian banks export. A preamble above the header, page-repeated headers, footer totals and narrations wrapped onto a second line are all handled.
- **Columns:** detected by name, e.g. `Sl. No., Tran Date, Particulars, Value Date, Tran Type, Cheque Details, Withdrawal, Deposit, Balance Amount`. Debit/Credit, Narration, and a single Amount column with a Dr/Cr flag also work.
- **Correctness:** newest-first statements are reordered. The running balance is checked row by row and gaps are reported. Overlapping or re-uploaded statements are de-duplicated. Amounts are stored as exact paise.
- **Payees:** the counterparty is pulled out of UPI, IMPS, NEFT, RTGS, ACH/NACH, card, cheque and ATM narrations, along with UPI IDs. Common Indian merchants and billers get clean names and categories.
- **Multiple accounts:** upload statements from all your accounts together. Each file is matched to its account by the account number in it, or by its running balance continuing an existing account. **All accounts** analyses everything as one: the same person paid from different banks is a single payee, and money moved between your own accounts is left out of income and spending. Use the account switcher to look at one account on its own.
- **Rules:** rename, merge or recategorise payees. Rules are reapplied to all past and future uploads, and can be exported and imported.

## Project layout

```
backend/   FastAPI app: app/parsing (readers, columns, extraction), app/services (ingest, rules, analytics), tests/
frontend/  Next.js app: src/app (routes), src/components (views, charts, UI), src/lib (API client, state)
legacy/    The earlier single-file browser version
```

## Tests

```bash
cd backend && uv run pytest
```

Statement files (CSV, XLS/XLSX, PDF, …) and the database are deliberately kept out of this repository by `.gitignore`. Tests that need a sample statement are skipped unless you place one at `backend/tests/sample_statement.csv`.

Data is stored in `backend/data/spend.db`. To change the location, set `SPEND_DATA_DIR`.
