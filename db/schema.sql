CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY,
    name VARCHAR(40) NOT NULL DEFAULT 'Mochi' CHECK (length(trim(name)) > 0),
    coins INTEGER NOT NULL DEFAULT 24 CHECK (coins >= 0),
    xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
    day INTEGER NOT NULL DEFAULT 1 CHECK (day >= 1),
    slot INTEGER NOT NULL DEFAULT 0 CHECK (slot BETWEEN 0 AND 5),
    served INTEGER NOT NULL DEFAULT 0 CHECK (served BETWEEN 0 AND slot AND served <= xp),
    oven BOOLEAN NOT NULL DEFAULT FALSE,
    decor BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    last_request UUID
);

CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(40) NOT NULL UNIQUE,
    species VARCHAR(20) NOT NULL,
    rotation INTEGER NOT NULL UNIQUE CHECK (rotation >= 0)
);

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    price INTEGER NOT NULL CHECK (price > 0),
    unlock_level INTEGER NOT NULL CHECK (unlock_level >= 1),
    menu_position INTEGER NOT NULL UNIQUE CHECK (menu_position >= 0)
);

CREATE TABLE IF NOT EXISTS ingredients (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(30) NOT NULL UNIQUE,
    refill_price INTEGER NOT NULL CHECK (refill_price > 0),
    starting_stock INTEGER NOT NULL CHECK (starting_stock >= 0)
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    product_id VARCHAR(20) REFERENCES products(id) ON DELETE CASCADE,
    ingredient_id VARCHAR(20) REFERENCES ingredients(id),
    portions INTEGER NOT NULL CHECK (portions > 0),
    PRIMARY KEY (product_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS inventory (
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    ingredient_id VARCHAR(20) REFERENCES ingredients(id),
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (player_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    customer_id VARCHAR(20) NOT NULL REFERENCES customers(id),
    day INTEGER NOT NULL CHECK (day >= 1),
    slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 4),
    bonus INTEGER NOT NULL CHECK (bonus IN (0, 2, 4, 6)),
    served_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (player_id, day, slot)
);

CREATE TABLE IF NOT EXISTS order_items (
    order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
    product_id VARCHAR(20) REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price > 0),
    PRIMARY KEY (order_id, product_id)
);
