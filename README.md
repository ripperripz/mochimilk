# Mochi & Milk

Run a little bakery on Sugarberry Lane. Mix a guest’s recipe, time the oven, and serve a warm treat. Every shift has five tickets. Earn coins for pantry refills and two shop upgrades, then unlock Garden Mochi and Cloud Cupcake as you level up.

The pixel art is drawn on canvas and animated with Phaser 3. Every save lives in PostgreSQL.

```
browser (Phaser game, /demo.html)  →  /api/*  →  api/bakery.js (Vercel function)  →  server/bakery.js (SQL)  →  PostgreSQL (Neon)
```

The browser keeps only a profile UUID and a copy of the last state the database confirmed. Coins, stock, tickets, upgrades, and sales come from the database on every load, so a reload or another device shows the same bakery. If the API can’t be reached, the game shows that saved copy as read-only and offers **Retry saving**.

## Run locally

Requires Node.js 20.19+ or 22.12+ and Docker (or any PostgreSQL with a `sugarberry` database).

```sh
docker compose up -d --wait db   # PostgreSQL on 127.0.0.1:5432
npm ci
npm run api                      # API on http://127.0.0.1:8080
npm run dev                      # game on http://127.0.0.1:5173
```

The API creates the tables and seeds the catalog on its first request. Open [the game](http://127.0.0.1:5173/) and [the database view](http://127.0.0.1:5173/demo.html).

## Playing a shift

1. Click **Bake order** and add the required portions.
2. Choose **Whisk the batter**, then drag around the bowl or press **Whisk** eight times. Stop the oven needle in the gold zone for a four-coin bonus.
3. Choose **Carry to the counter**, then tap the guest or click **Serve**. A guest leaves when the 95-second patience clock runs out or when you let them go.
4. **Pantry** buys six portions at a time. **Shop** sells a copper oven (wider gold zone) and berry bunting (+2 coins per sale). **Ledger** shows recent sales and today’s totals.

To continue on another device, open the link shown in the database view (`/?profile=<uuid>`).

## Database view

`/demo.html` reads the live tables through the API every few seconds. Open it next to the game: serving a guest adds an `orders` row and an `order_items` row, lowers `inventory`, and raises the player’s coins. Changed cells are highlighted. The view can also run the game’s actions (serve, skip, next day, refill, upgrade, rename, daily totals, reset) on the same profile, and it prints what each commit changed.

## DBMS viva

Eight tables. Four hold the catalog (`customers`, `products`, `ingredients`, `recipe_ingredients`) and four hold each player’s data (`players`, `inventory`, `orders`, `order_items`). The SQL lives in `db/schema.sql` and `db/data.sql`.

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

- **Keys and constraints.** `recipe_ingredients` and `inventory` are many-to-many link tables with composite primary keys. Foreign keys protect every relationship, and deleting a player cascades to its inventory, orders, and line items. Checks reject negative stock or coins. `orders_one_sale_per_ticket UNIQUE (player_id, day, slot)` stops two sales for one ticket. `order_items.unit_price` snapshots the price, so old totals survive menu changes.
- **Transactions.** A sale locks the player row (`SELECT … FOR UPDATE`), checks the revision, deducts each recipe portion with `UPDATE … WHERE quantity >= n`, inserts the order and line item, then credits coins and XP. Any shortage rolls back the whole sale. Refills and upgrades run the same way. `revision` gives optimistic concurrency between devices, and `last_request` makes a retried request return the saved result instead of applying it twice.
- **Joins and aggregation.** The catalog joins products to recipes. The ledger joins orders to customers, line items, and products. Daily totals use `GROUP BY day` with `COUNT` and `SUM`.
- **Indexes.** The ledger query uses the `orders_one_sale_per_ticket` index (an index scan backward for `ORDER BY day DESC, slot DESC`). Inventory and line-item lookups use their primary keys. `order_items_product_idx` indexes the foreign key to products.
- **Scope.** The oven score and the patience clock run in the browser. The server enforces stock, prices, ticket order, balances, and upgrades. Profiles are anonymous UUIDs; there are no accounts.

| Method | Endpoint | What it does |
| --- | --- | --- |
| GET | `/api/catalog` | Products with joined recipes, ingredients, customers |
| GET | `/api/tables` | Raw rows of the four catalog tables |
| PUT | `/api/players/{uuid}` | Create a profile and its starting inventory, or reopen it |
| GET | `/api/players/{uuid}` | Saved shift, stock, and the last 20 sales |
| PATCH | `/api/players/{uuid}` | Rename with `{"name":"My Bakery"}` |
| DELETE | `/api/players/{uuid}` | Delete a profile; rows cascade |
| POST | `/api/players/{uuid}/actions` | `serve`, `skip`, `next`, `restock`, or `upgrade` in one transaction |
| GET | `/api/players/{uuid}/sales` | Orders and revenue per day |
| GET | `/api/players/{uuid}/tables` | Raw rows of all eight tables for one profile |

`db/demo.sql` is a self-contained walkthrough: `INSERT`, `SELECT`, `UPDATE`, a recipe join, a sale, a ledger join, a daily total, an `EXPLAIN` that shows the index, three statements rejected by `CHECK`, `UNIQUE`, and `FOREIGN KEY`, and a `DELETE` undone with a savepoint. It runs inside one transaction and rolls back, so real saves are untouched.

```sh
docker compose exec -T db psql -U sugarberry -d sugarberry < db/demo.sql
```

On Neon, paste the file into the SQL editor, or run `psql "$DATABASE_URL" -f db/demo.sql`.

## Checks

```sh
npm test                  # model, Vercel handler, and (if PostgreSQL is up) a full shift through the API
npm run build
node scripts/smoke.mjs    # needs `npm run api`; creates and deletes its own profile
```

`npm test` calls `api/bakery.js` the way Vercel does. It checks the 503 when no database is configured, plays a full shift, refills, upgrades, then reopens the save with a fresh connection pool.

## Deploy on Vercel

Vite builds the game into `dist`, and `api/bakery.js` serves every `/api/*` route as one Node.js function. `vercel.json` rewrites the routes and ships `db/schema.sql` and `db/data.sql` with the function.

1. Import the repository into Vercel. The defaults are fine (framework Vite, build `npm run build`, output `dist`).
2. Open **Storage → Create Database → Neon**. Connect it to **Production** and **Preview**. This adds `DATABASE_URL`.
3. **Deployments → Redeploy** the latest deployment so the function picks up the variable.
4. Verify:
   - `https://mochimilk.vercel.app/api/catalog` returns JSON. A `503` that mentions `DATABASE_URL` means step 2 or 3 is missing.
   - `BAKERY_API=https://mochimilk.vercel.app node scripts/smoke.mjs` passes.
   - Serve a guest in the game, then open `/demo.html` and find the new `orders` row.

The first request on a new instance creates the tables and seeds the catalog. The script is idempotent and runs under an advisory lock.

| Variable | Needed | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Production and Preview | PostgreSQL connection string. Neon adds it; use its pooled URL. `POSTGRES_URL` also works. |
| `DATABASE_POOL_SIZE` | Optional | Connections per function instance (default 3). |
| `PORT` | Local only | Port for `npm run api` (default 8080). |
| `BAKERY_API` | Local only | API origin for the Vite proxy and the smoke script (default `http://127.0.0.1:8080`). |

Locally, without `DATABASE_URL`, the API uses the Compose database `postgresql://sugarberry:sugarberry@127.0.0.1:5432/sugarberry`. On Vercel it never falls back to localhost.

## Submission

- **Game**: https://mochimilk.vercel.app
- **Database view**: https://mochimilk.vercel.app/demo.html
- **API**: https://mochimilk.vercel.app/api/catalog
- **Source**: https://github.com/ripperripz/mochimilk
- **Direct SQL**: the Neon SQL editor (open the database from Vercel → Storage), or locally `docker compose exec db psql -U sugarberry -d sugarberry`, then `\dt`, `SELECT * FROM orders;`, or `db/demo.sql`.
