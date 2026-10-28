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
- Database: SQLite file `dados.db` via the built-in `node:sqlite` (Node 24; no
  native dependency, nothing to install). Path configurable with `DB_ARQUIVO`.
  Stores transactions, the stock selection and monthly API usage.
- Tests: Vitest + Testing Library; API tests with supertest. Lint: ESLint + Prettier.
- Commands (created in step 1): `npm run dev`, `npm test`, `npm run lint`,
  `npm run build`, `npm start` (serves on http://localhost:3000). `iniciar.bat`
  starts the app with a double-click.

## Quote sources (zero cost only)

- HARD RULE: never use an API that needs a key, account, plan or payment. No
  tokens in code, `.env` or requests. All external calls go through
  `requisitarExterno` (host allowlist; auth headers and key params rejected).
- Primary: Yahoo Finance (unofficial, no key). Fetch all selected tickers
  (`BBAS3.SA`) in a single batch request every 5 minutes.
- Fallback, catalog and logos: brapi public list `/api/quote/list` (no key),
  one call returns every stock with name, logo URL and last price. Called at
  most once every 15 minutes; each call is counted in `uso_api`.
- Logos: image stored in the `logos` table, downloaded on first use and
  re-checked at most once a day (ETag). Served by `/api/logos/:ticker` with a
  one-day browser cache; quote responses never carry the image.
- API health in `estado_api`: ok / instavel / bloqueada (asks for key or
  payment) / formato_alterado. Blocked or changed APIs are not called again
  for 24 h; the app keeps the last saved data and must never break.
- Footer shows which API is currently in use and warns when one is unavailable,
  blocked (payment required) or changed format.
- Maximum of 50 selected stocks; disable further checkboxes when the limit is hit.

## Grid behavior

- CSS Grid `auto-fill`, square cells; smaller screens = fewer columns, all
  stocks reachable by scrolling.
- Highlight the active square strongly and its 4 orthogonal neighbors softly.
  Column count read from the real layout (ResizeObserver); neighbor logic is a
  pure, tested function.
- Hover only under `@media (hover: hover)`; on touch, a tap toggles the
  highlight; keyboard focus and arrow keys also drive it.
