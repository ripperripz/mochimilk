INSERT INTO customers (id, name, species, rotation) VALUES
    ('miso', 'Miso', 'cat', 0), ('pip', 'Pip', 'frog', 1), ('maple', 'Maple', 'bear', 2),
    ('taro', 'Taro', 'creamcat', 3), ('clover', 'Clover', 'bunny', 4)
ON CONFLICT DO NOTHING;

INSERT INTO products (id, name, price, unlock_level, menu_position) VALUES
    ('shortcake', 'Berry Shortcake', 16, 1, 0), ('cookie', 'Butter Cookie', 12, 1, 1),
    ('mochi', 'Garden Mochi', 22, 2, 2), ('cupcake', 'Cloud Cupcake', 26, 3, 3)
ON CONFLICT DO NOTHING;

INSERT INTO ingredients (id, name, refill_price, starting_stock) VALUES
    ('flour', 'Flour', 4, 20), ('milk', 'Milk', 5, 14), ('berry', 'Berries', 6, 12), ('sugar', 'Sugar', 4, 12)
ON CONFLICT DO NOTHING;

INSERT INTO recipe_ingredients VALUES
    ('shortcake', 'flour', 2), ('shortcake', 'milk', 1), ('shortcake', 'berry', 2),
    ('cookie', 'flour', 2), ('cookie', 'milk', 1), ('cookie', 'sugar', 1),
    ('mochi', 'flour', 1), ('mochi', 'berry', 2), ('mochi', 'sugar', 2),
    ('cupcake', 'flour', 2), ('cupcake', 'milk', 2), ('cupcake', 'sugar', 2)
ON CONFLICT DO NOTHING;
