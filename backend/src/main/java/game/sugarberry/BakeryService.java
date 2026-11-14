package game.sugarberry;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class BakeryService {
    private static final int SHIFT_SIZE = 5;
    private static final int REFILL_PORTIONS = 6;
    private final JdbcTemplate db;

    public BakeryService(JdbcTemplate db) {
        this.db = db;
    }

    public record Product(String id, String name, int price, int level, Map<String, Integer> recipe) {}
    public record Ingredient(String id, String name, int price) {}
    public record Customer(String id, String name, String species) {}
    public record Catalog(List<Product> products, List<Ingredient> ingredients, List<Customer> customers) {}
    public record Sale(int day, int slot, String customer, String product, long total) {}
    public record State(String name, int day, int slot, int served, int coins, int xp, boolean oven,
                        boolean decor, long revision, Map<String, Integer> stock, List<Sale> history) {}
    public record Action(String action, String item, boolean perfect, Integer day, Integer slot,
                         Long revision, UUID requestId) {}

    private record Player(String name, int day, int slot, int served, int coins, int xp, boolean oven,
                          boolean decor, long revision, UUID lastRequest) {}

    @Transactional
    public State create(UUID id) {
        int created = db.update("INSERT INTO players (id) VALUES (?) ON CONFLICT DO NOTHING", id);
        if (created == 1) {
            db.update("""
                INSERT INTO inventory (player_id, ingredient_id, quantity)
                SELECT ?, id, starting_stock FROM ingredients
                """, id);
        }
        return snapshot(id);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public State read(UUID id) {
        return snapshot(id);
    }

    @Transactional
    public State rename(UUID id, String name) {
        if (name == null || name.isBlank() || name.strip().length() > 40) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Use a name of 1 to 40 characters.");
        }
        int changed = db.update("UPDATE players SET name = ?, revision = revision + 1 WHERE id = ?", name.strip(), id);
        if (changed == 0) throw missing();
        return snapshot(id);
    }

    @Transactional
    public void delete(UUID id) {
        if (db.update("DELETE FROM players WHERE id = ?", id) == 0) throw missing();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Map<String, List<Map<String, Object>>> tables(UUID id) {
        var tables = new LinkedHashMap<String, List<Map<String, Object>>>();
        tables.put("ingredients", db.queryForList("""
            SELECT id, name, refill_price, starting_stock FROM ingredients ORDER BY id
            """));
        tables.put("products", db.queryForList("""
            SELECT id, name, price, unlock_level FROM products ORDER BY menu_position
            """));
        tables.put("recipe_ingredients", db.queryForList("""
            SELECT product_id, ingredient_id, portions
            FROM recipe_ingredients ORDER BY product_id, ingredient_id
            """));
        tables.put("customers", db.queryForList("""
            SELECT id, name, species, rotation FROM customers ORDER BY rotation
            """));
        if (id == null) return tables;

        tables.put("players", db.queryForList("""
            SELECT id, name, coins, xp, day, slot FROM players WHERE id = ?
            """, id));
        tables.put("inventory", db.queryForList("""
            SELECT player_id, ingredient_id, quantity FROM inventory
            WHERE player_id = ? ORDER BY ingredient_id
            """, id));
        tables.put("orders", db.queryForList("""
            SELECT id, player_id, customer_id, day, slot, bonus FROM orders
            WHERE player_id = ? ORDER BY day DESC, slot DESC LIMIT 20
            """, id));
        tables.put("order_items", db.queryForList("""
            SELECT i.order_id, i.product_id, i.quantity, i.unit_price
            FROM order_items i
            JOIN (SELECT id FROM orders WHERE player_id = ?
                  ORDER BY day DESC, slot DESC LIMIT 20) o ON o.id = i.order_id
            ORDER BY i.order_id DESC, i.product_id
            """, id));
        return tables;
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Catalog catalog() {
        var ingredients = db.query("""
            SELECT id, name, refill_price FROM ingredients ORDER BY id
            """, (row, index) -> new Ingredient(row.getString(1), row.getString(2), row.getInt(3)));
        return new Catalog(menu(Integer.MAX_VALUE), ingredients, customers());
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<Map<String, Object>> sales(UUID id) {
        player(id, false);
        return db.queryForList("""
            SELECT o.day, COUNT(*) AS orders, SUM(t.items_total + o.bonus) AS revenue
            FROM orders o
            JOIN (
                SELECT oi.order_id, SUM(oi.quantity::bigint * oi.unit_price) AS items_total
                FROM order_items oi JOIN orders own ON own.id = oi.order_id
                WHERE own.player_id = ?
                GROUP BY oi.order_id
            ) t ON t.order_id = o.id
            WHERE o.player_id = ?
            GROUP BY o.day ORDER BY o.day
            """, id, id);
    }

    @Transactional
    public State act(UUID id, Action action) {
        if (action.action() == null || action.requestId() == null || action.revision() == null
                || action.day() == null || action.slot() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Action, request ID, revision, day, and slot are required.");
        }
        Player player = player(id, true);
        if (action.requestId().equals(player.lastRequest())) return snapshot(id);
        if (action.revision() != player.revision() || action.day() != player.day() || action.slot() != player.slot()) {
            throw conflict("Your shift changed. Please use the latest ticket.");
        }

        switch (action.action()) {
            case "serve" -> serve(id, player, action.perfect());
            case "skip" -> {
                requireOpen(player);
                db.update("UPDATE players SET slot = slot + 1 WHERE id = ?", id);
            }
            case "next" -> {
                if (player.slot() != SHIFT_SIZE) throw conflict("Finish the current shift first.");
                db.update("UPDATE players SET day = day + 1, slot = 0, served = 0 WHERE id = ?", id);
            }
            case "restock" -> restock(id, player, action.item());
            case "upgrade" -> upgrade(id, player, action.item());
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown bakery action.");
        }

        db.update("UPDATE players SET revision = revision + 1, last_request = ? WHERE id = ?", action.requestId(), id);
        return snapshot(id);
    }

    private void serve(UUID id, Player player, boolean perfect) {
        requireOpen(player);
        List<Product> menu = menu(1 + (player.xp() - player.served()) / 3);
        List<Customer> customers = customers();
        int position = (int) (((player.day() - 1L) * SHIFT_SIZE + player.slot()) % menu.size());
        int rotation = (int) ((player.slot() + player.day() - 1L) % customers.size());
        Product product = menu.get(position);
        Customer customer = customers.get(rotation);

        for (var entry : product.recipe().entrySet()) {
            int changed = db.update("""
                UPDATE inventory SET quantity = quantity - ?
                WHERE player_id = ? AND ingredient_id = ? AND quantity >= ?
                """, entry.getValue(), id, entry.getKey(), entry.getValue());
            if (changed != 1) throw conflict("You’re short on ingredients. Refill your pantry.");
        }

        int bonus = (perfect ? 4 : 0) + (player.decor() ? 2 : 0);
        Long orderId = db.queryForObject("""
            INSERT INTO orders (player_id, customer_id, day, slot, bonus)
            VALUES (?, ?, ?, ?, ?) RETURNING id
            """, Long.class, id, customer.id(), player.day(), player.slot(), bonus);
        db.update("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, 1, ?)",
            orderId, product.id(), product.price());
        db.update("""
            UPDATE players SET coins = coins + ?, xp = xp + 1, slot = slot + 1, served = served + 1
            WHERE id = ?
            """, product.price() + bonus, id);
    }

    private void restock(UUID id, Player player, String item) {
        var prices = db.queryForList("SELECT refill_price FROM ingredients WHERE id = ?", Integer.class, item);
        if (prices.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown ingredient.");
        int price = prices.get(0);
        if (player.coins() < price) throw conflict("You need more coins.");
        db.update("UPDATE players SET coins = coins - ? WHERE id = ?", price, id);
        db.update("""
            INSERT INTO inventory (player_id, ingredient_id, quantity) VALUES (?, ?, ?)
            ON CONFLICT (player_id, ingredient_id)
            DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity
            """, id, item, REFILL_PORTIONS);
    }

    private void upgrade(UUID id, Player player, String item) {
        if ("oven".equals(item) && !player.oven() && player.coins() >= 40) {
            db.update("UPDATE players SET coins = coins - 40, oven = TRUE WHERE id = ?", id);
        } else if ("decor".equals(item) && !player.decor() && player.coins() >= 28) {
            db.update("UPDATE players SET coins = coins - 28, decor = TRUE WHERE id = ?", id);
        } else {
            throw conflict("This upgrade is unavailable.");
        }
    }

    private State snapshot(UUID id) {
        Player player = player(id, false);
        Map<String, Integer> stock = db.query("""
            SELECT ingredient_id, quantity FROM inventory WHERE player_id = ? ORDER BY ingredient_id
            """, rows -> {
                var amounts = new LinkedHashMap<String, Integer>();
                while (rows.next()) amounts.put(rows.getString(1), rows.getInt(2));
                return amounts;
            }, id);
        List<Sale> history = db.query("""
            SELECT o.day, o.slot, c.name AS customer, p.name AS product,
                   oi.quantity::bigint * oi.unit_price + o.bonus AS total
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
            JOIN order_items oi ON oi.order_id = o.id
            JOIN products p ON p.id = oi.product_id
            WHERE o.player_id = ?
            ORDER BY o.day DESC, o.slot DESC, p.menu_position LIMIT 20
            """, (row, index) -> new Sale(row.getInt(1), row.getInt(2), row.getString(3), row.getString(4), row.getLong(5)), id);
        return new State(player.name(), player.day(), player.slot(), player.served(), player.coins(), player.xp(),
            player.oven(), player.decor(), player.revision(), stock, history);
    }

    private List<Product> menu(int level) {
        return db.query("""
            SELECT p.id, p.name, p.price, p.unlock_level, r.ingredient_id, r.portions
            FROM products p
            JOIN recipe_ingredients r ON r.product_id = p.id
            WHERE p.unlock_level <= ?
            ORDER BY p.menu_position, r.ingredient_id
            """, rows -> {
                var menu = new LinkedHashMap<String, Product>();
                while (rows.next()) {
                    String id = rows.getString(1);
                    Product product = menu.get(id);
                    if (product == null) {
                        product = new Product(id, rows.getString(2), rows.getInt(3), rows.getInt(4), new LinkedHashMap<>());
                        menu.put(id, product);
                    }
                    product.recipe().put(rows.getString(5), rows.getInt(6));
                }
                return List.copyOf(menu.values());
            }, level);
    }

    private List<Customer> customers() {
        return db.query("SELECT id, name, species FROM customers ORDER BY rotation",
            (row, index) -> new Customer(row.getString(1), row.getString(2), row.getString(3)));
    }

    private Player player(UUID id, boolean lock) {
        var players = db.query("""
            SELECT name, day, slot, served, coins, xp, oven, decor, revision, last_request
            FROM players WHERE id = ?
            """ + (lock ? " FOR UPDATE" : ""),
            (row, index) -> new Player(row.getString(1), row.getInt(2), row.getInt(3), row.getInt(4), row.getInt(5),
                row.getInt(6), row.getBoolean(7), row.getBoolean(8), row.getLong(9), row.getObject(10, UUID.class)), id);
        if (players.isEmpty()) throw missing();
        return players.get(0);
    }

    private void requireOpen(Player player) {
        if (player.slot() >= SHIFT_SIZE) throw conflict("The shift is already over.");
    }

    private static ResponseStatusException missing() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Bakery profile not found.");
    }

    private static ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
}
