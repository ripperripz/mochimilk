\set ON_ERROR_STOP on

-- Create one throwaway sale so every query has a result, even on a fresh install.
BEGIN;
SELECT gen_random_uuid() AS demo_player \gset

-- CREATE: add a player.
INSERT INTO players (id, name)
VALUES (:'demo_player', 'Viva Demo');

-- READ: find that player by primary key.
SELECT id, name, coins
FROM players
WHERE id = :'demo_player';

-- UPDATE: rename the player.
UPDATE players
SET name = 'Sugarberry Student'
WHERE id = :'demo_player';

INSERT INTO inventory (player_id, ingredient_id, quantity)
SELECT :'demo_player', id, starting_stock FROM ingredients;

-- JOIN: show the portions needed for each menu item.
SELECT p.name AS product, i.name AS ingredient, r.portions
FROM products p
JOIN recipe_ingredients r ON r.product_id = p.id
JOIN ingredients i ON i.id = r.ingredient_id
ORDER BY p.menu_position, i.name;

-- Show the same three changes made together by the application's sale.
SELECT id FROM players WHERE id = :'demo_player' FOR UPDATE;
UPDATE inventory inv
SET quantity = inv.quantity - r.portions
FROM recipe_ingredients r
WHERE inv.player_id = :'demo_player' AND inv.ingredient_id = r.ingredient_id
  AND r.product_id = 'shortcake';

INSERT INTO orders (player_id, customer_id, day, slot, bonus)
VALUES (:'demo_player', 'miso', 1, 0, 4)
RETURNING id AS demo_order \gset

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT :demo_order, id, 1, price FROM products WHERE id = 'shortcake';

UPDATE players
SET coins = coins + (SELECT price FROM products WHERE id = 'shortcake') + 4,
    xp = xp + 1, slot = slot + 1, served = served + 1
WHERE id = :'demo_player';

-- JOIN: show the named customer and pastry instead of their keys.
SELECT pl.name AS baker, c.name AS customer, p.name AS pastry, o.day,
       oi.quantity * oi.unit_price AS subtotal, o.bonus
FROM orders o
JOIN players pl ON pl.id = o.player_id
JOIN customers c ON c.id = o.customer_id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
WHERE o.player_id = :'demo_player';

-- Aggregate sale values once per order so the bonus is counted once.
WITH subtotals AS (
    SELECT order_id, SUM(quantity * unit_price) AS subtotal
    FROM order_items
    WHERE order_id = :demo_order
    GROUP BY order_id
)
SELECT o.day, COUNT(*) AS orders, SUM(s.subtotal + o.bonus) AS revenue
FROM orders o JOIN subtotals s ON s.order_id = o.id
WHERE o.player_id = :'demo_player'
GROUP BY o.day;

SAVEPOINT before_delete;

-- DELETE: remove the demo player. Foreign keys cascade to its stock and orders.
DELETE FROM players
WHERE id = :'demo_player';

-- Undo the deletion, then show that the player is back.
ROLLBACK TO SAVEPOINT before_delete;
SELECT name, coins FROM players WHERE id = :'demo_player';

ROLLBACK;
SELECT COUNT(*) AS demo_players_left FROM players WHERE id = :'demo_player';
