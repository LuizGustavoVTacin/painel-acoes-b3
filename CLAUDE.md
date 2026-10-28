# B3 Stock Dashboard

## Mandatory workflow
1. PLAN: before writing code, present a step-by-step plan and wait for approval.
2. BUILD: implement one step at a time, always with automated tests.
3. VERIFY: run tests, lint and build; then invoke the `reviewer` subagent.
4. REFACTOR: fix everything the reviewer reported; improve readability without changing behavior; tests must keep passing.
5. FINALIZE: only declare done when tests, lint and build pass. Commit at the end of each step.

## General rules
- Never claim something works without having run it and seen it work.
- Small commits with descriptive messages in Portuguese.

## About the app
Personal web dashboard to track B3 stock prices and the performance of my
purchases. Runs only on this computer (Windows), no hosting.

## Features
- Grid of equal-sized squares; each shows the company logo, the B3 ticker
  (e.g., BBAS3) and the current price.
- Responsive: smaller screens show fewer squares.
- Highlight the hovered square and its adjacent squares.
- Menu in the top-right corner:
  1. Select which stocks are displayed (list with checkboxes).
  2. Register purchases (see Transactions).

## Quotes
- When the app opens, fetch prices for all displayed stocks.
- While the app is open, refresh every 5 minutes.
- Market closed: show the last closing price.
- Display the time of the last update.
- API failure: keep the last known price and flag the error without breaking the dashboard.
- Respect the rate limits of the chosen API.

## Transactions
- Local database (localhost) storing: ticker, date, quantity, unit price
  paid, fees paid and platform (e.g., Itaú Íon, BTG).
- Allow editing and deleting transactions.
- Average price per stock = (sum of amounts paid + fees) / total quantity.
- Current price above average: green arrow with % gain.
  Below: red arrow with % loss.
- Stock with no registered purchase: show price only, no arrow.

## Business rules
- Monetary values stored in cents (integers), never floats.
- Display in BRL (R$ 1.234,56), dates as dd/mm/yyyy, user interface in Portuguese.
- Stock selection and transactions persist after closing the browser.

## Out of scope
Login, sales, historical charts, real-time quotes, hosting.

## Stack and commands
- Node.js + TypeScript everywhere. Frontend: React + Vite. Backend: Express
  (holds API keys in `.env`, caches quotes, serves the built frontend).
- Database: SQLite file `dados.db` via `better-sqlite3` (no server to install).
  Stores transactions, the stock selection and monthly API usage.
- Tests: Vitest + Testing Library; API tests with supertest. Lint: ESLint + Prettier.
- Commands (created in step 1): `npm run dev`, `npm test`, `npm run lint`,
  `npm run build`, `npm start` (serves on http://localhost:3000). `iniciar.bat`
  starts the app with a double-click.

## Quote sources (zero cost only)
- Primary: Yahoo Finance (unofficial, no key). Fetch all selected tickers
  (`BBAS3.SA`) in a single batch request every 5 minutes.
- Fallback: brapi.dev FREE plan only (15,000 req/month, 1 ticker/request,
  ~30 min delay). Used when Yahoo fails, within a monthly budget of ~12,000
  requests tracked in the database; refresh the stalest tickers first.
- Logos: brapi `logourl`, downloaded once per ticker and cached locally.
- Footer shows which API is currently in use. If Yahoo is broken, the footer
  warns that Yahoo data is unavailable (and whether brapi is covering).
- Maximum of 50 selected stocks; disable further checkboxes when the limit is hit.

## Grid behavior
- CSS Grid `auto-fill`, square cells; smaller screens = fewer columns, all
  stocks reachable by scrolling.
- Highlight the active square strongly and its 4 orthogonal neighbors softly.
  Column count read from the real layout (ResizeObserver); neighbor logic is a
  pure, tested function.
- Hover only under `@media (hover: hover)`; on touch, a tap toggles the
  highlight; keyboard focus and arrow keys also drive it.
