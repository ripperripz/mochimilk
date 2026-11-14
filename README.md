# Mochi & Milk

Run a little bakery on Sugarberry Lane. Mix a guest’s recipe, time the oven, and serve a warm treat. Every shift has five tickets. Earn coins for pantry refills and two shop upgrades, then unlock Garden Mochi and Cloud Cupcake as you level up.

The bakery, animals, pastries, and effects are original pixel art drawn on canvas and animated with Phaser 3. Baking controls work with a mouse, keyboard, or touch. The sound button mutes the synthesized effects.

## Run locally

Requires Node.js 20.19+ or 22.12+. Use Docker Compose for PostgreSQL, or create a database called `sugarberry` in an existing PostgreSQL instance.

From this folder, run:

```sh
docker compose up -d --wait db
npm ci
```

Start the API in one terminal and the game in another:

```sh
npm run api
npm run dev
```

Open [the game](http://127.0.0.1:5173/). The API creates the schema and seed catalog on first use. Defaults are PostgreSQL on port 5432, API on port 8080, and Vite on port 5173. Override the database with `DATABASE_URL` (for example `postgresql://user:pass@host:5432/db`). If you change the API port with `PORT`, set `BAKERY_API` to that API origin when starting Vite.

For a quick playtest, just start Vite and open [browser-only mode](http://127.0.0.1:5173/?local=1). This mode saves in the browser. The database mode keeps a separate profile identified by a UUID saved in the browser. Keep the same browser and URL origin to reopen that profile. If an existing database save is temporarily unreachable, the game shows its last confirmed snapshot and retries writes against the API. Browser-only progress stays separate from database progress.

### Playing a shift

1. Click **Bake order** and add the required portions.
2. Choose **Whisk the batter**, then drag around the bowl or press **Whisk** eight times. Stop the oven needle in the gold zone for a four-coin bonus. You can serve any finished bake.
3. Choose **Carry to the counter**, then tap the guest in the shop or click **Serve** to complete the sale. A guest can leave when the 95-second clock expires or when you pass on their order. The clock starts on the first bake of a shift, pauses in non-baking panels, and resets on reload.
4. Use **Pantry** to buy six portions at a time. **Shop** sells a copper oven that makes timing easier and berry bunting that changes the room and adds two coins to each sale. **Ledger** shows recent sales and the current day’s totals.

## DBMS viva

Eight tables keep the catalog, stock, and sales separate. `recipe_ingredients` links products to ingredients and `inventory` gives every player their own stock. An order records the customer and shift position. Its line item snapshots the sale price so past totals survive later menu price changes.

```mermaid
erDiagram
    PLAYERS ||--o{ INVENTORY : holds
    INGREDIENTS ||--o{ INVENTORY : stocked_as
    PRODUCTS ||--o{ RECIPE_INGREDIENTS : requires
    INGREDIENTS ||--o{ RECIPE_INGREDIENTS : used_in
    PLAYERS ||--o{ ORDERS : serves
    CUSTOMERS ||--o{ ORDERS : places
    ORDERS ||--|{ ORDER_ITEMS : contains
    PRODUCTS ||--o{ ORDER_ITEMS : sold_as
```

- **Keys and constraints**. Composite keys prevent duplicate recipe and stock entries. Foreign keys preserve relationships. Checks reject negative stock and coins. A unique player/day/slot key prevents two sales for the same ticket.
- **Transactions**. The sale locks the player row, checks the save revision, deducts recipe portions, writes the order and line item, and credits coins and XP. Any shortage rolls back the entire sale. Restocks and upgrades also run in transactions. An immediate request retry returns the confirmed state, and older revisions cannot apply the same purchase twice.
- **Joins and aggregation**. The catalog joins recipes to products. The ledger joins sales to customer and product names. The daily summary counts orders and sums line totals plus one bonus per order.
- **Scope**. The API is local by default and uses a browser-held profile ID. The oven score and patience timer run in the client. The server enforces stock, prices, ticket order, and balances.

| Method | Endpoint | What it does |
| --- | --- | --- |
| PUT | `/api/players/{uuid}` | Create a profile and its pantry, or reopen it |
| GET | `/api/players/{uuid}` | Read the saved shift and recent sales |
| PATCH | `/api/players/{uuid}` | Rename a profile with `{"name":"My Bakery"}` |
| DELETE | `/api/players/{uuid}` | Delete a profile and its dependent rows |
| GET | `/api/catalog` | Read the seed catalog and joined recipes |
| POST | `/api/players/{uuid}/actions` | Serve, skip, advance, restock, or upgrade |
| GET | `/api/players/{uuid}/sales` | Get order counts and revenue by day |

For the viva, start with the four plain SQL statements in `db/demo.sql`: `INSERT`, `SELECT`, `UPDATE`, and `DELETE`. The Node.js API (`server/bakery.js`) runs those same SQL operations with parameterized queries. Then serve a guest with the API running, then open the ledger. Run the SQL demo for an isolated example of joins, aggregation, and rollback. The demo leaves your real save untouched.

```sh
docker compose exec -T db psql -U sugarberry -d sugarberry < db/demo.sql
```

## Checks

```sh
npm test
npm run build
node scripts/smoke.mjs  # API and PostgreSQL must already be running
```

The API smoke script creates and removes its own profile. It checks player CRUD, a recipe join, duplicate concurrent sale submission, daily revenue, an oven purchase, a refill, and a rejected refill. For the built frontend, use `npm run preview` to serve `dist` with the same API proxy.

Open /demo.html for the interactive database demonstration. It runs PostgreSQL in the browser with PGlite and stores demo records on this device. Use /demo.html?server=1 to use the hosted API and PostgreSQL database instead. It displays eight separate tables read from PostgreSQL. The four catalog tables load before you create a profile. Create a disposable profile, serve a sale, and match the order ID in Orders to its line item. Compare the coin and stock changes shown above the tables. The demo profile is separate from your game save.

Click the oven or counter to bake, the shelves for the pantry, or the register for sales. After adding ingredients, drag around the bowl or press Whisk eight times before timing the oven.

## Deploy on Vercel

Everything runs on one Vercel project. Vite builds the game, and `api/bakery.js` serves every `/api/*` route as a Node.js function backed by PostgreSQL.

1. In the Vercel project, open **Storage**, create a **Neon** Postgres database, and connect it to Production and Preview. This adds `DATABASE_URL`.
2. Redeploy. The first API request creates the tables and seeds the catalog.
3. Check `https://YOUR-SITE/api/catalog` returns JSON, then open `/demo.html?server=1`, create a demo profile, serve an order, and check daily totals. From a terminal: `BAKERY_API=https://YOUR-SITE node scripts/smoke.mjs`.

The default `/demo.html` still runs PostgreSQL in the browser with PGlite and works without a hosted database.

## Submission access

- **GitHub** — https://github.com/ripperripz/mochimilk
- **Hosted database demo** — https://mochimilk.vercel.app/demo.html. It opens the eight PostgreSQL tables in the browser. Its records are stored on that device.
- **Direct PostgreSQL access** — Use the Neon SQL editor in Vercel → Storage, or start the database locally with the setup above. Open PostgreSQL with the command below, then run `\dt`, `SELECT * FROM ingredients;`, or `SELECT * FROM orders;`. The Compose connection uses host `127.0.0.1`, port `5432`, database `sugarberry`, and the local demo username/password in `compose.yaml`.
- **Hosted API** — https://mochimilk.vercel.app/demo.html?server=1 and https://mochimilk.vercel.app/api/catalog. Locally, start the API and open `http://127.0.0.1:5173/demo.html?server=1`. The API status at the top checks `GET /api/catalog`. Open `http://127.0.0.1:8080/api/catalog` locally to see the JSON response, or run `node scripts/smoke.mjs` to check reads and writes.

```sh
docker compose exec db psql -U sugarberry -d sugarberry
```
