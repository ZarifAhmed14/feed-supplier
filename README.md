# JOGAN

Private supplier comparison for Bangladesh animal-feed procurement. Excel and CSV files are parsed locally in the browser and are never uploaded.

Project path: `D:\Projects\feed-procurement-agent`

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, choose an `.xlsx` or `.csv` file, review the analysis, then export the audit CSV or print the report.

Required columns: `supplier`, `ingredient`.

Useful columns: `price`, `currency`, `unit`, `tier`, `availability`, `country`, `country risk`, `reliability`.

Accepted tier values: `Global MNC`, `International Manufacturer`, `Regional`, `Local`, `Trading Company`.

Accepted availability values: `Readily available`, `In stock`, `Seasonal`, `On order`, `Limited`.

Country risk accepts `Low`, `Medium`, `High`, or a score from 0–100. Reliability accepts 0–100.

## Verify

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

The deterministic engine has no API or model dependency. Import scenarios are estimates and never alter official supplier scores.
