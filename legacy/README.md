# Spend Analyser

A cashflow dashboard for bank statement CSVs. It runs entirely in the browser, so statement data is never uploaded anywhere.

## Run

Open `index.html` in a browser, then drop in your statement CSV.
To use the "Load sample statement" button, serve the folder instead: `python3 -m http.server` and open http://localhost:8000.

Expected columns: `Sl. No., Tran Date, Particulars, Value Date, Tran Type, Cheque Details, Withdrawal, Deposit, Balance Amount`.
Header detection is fuzzy, so Debit/Credit/Narration variants also work. Preamble rows, footer rows and wrapped narration lines are handled. Several statements can be loaded together and are de-duplicated.

## Files

- `js/parser.js`: CSV parsing, date and amount handling, payment channel detection, payee extraction and categorisation (pure JS, also runs in Node)
- `js/app.js`: the dashboard (Chart.js)
- `sample/sample_statement.csv`: synthetic six-month statement for trying it out

Payee renames, merges and category overrides are saved as rules in browser localStorage. Use the Rules tab to export or import them.
