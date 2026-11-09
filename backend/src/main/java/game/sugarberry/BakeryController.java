package game.sugarberry;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class BakeryController {
    private final BakeryService bakery;

    public BakeryController(BakeryService bakery) {
        this.bakery = bakery;
    }

    public record Rename(String name) {}

    @GetMapping("/catalog")
    public BakeryService.Catalog catalog() {
        return bakery.catalog();
    }

    @PutMapping("/players/{id}")
    public BakeryService.State create(@PathVariable UUID id) {
        return bakery.create(id);
    }

    @GetMapping("/players/{id}")
    public BakeryService.State read(@PathVariable UUID id) {
        return bakery.read(id);
    }

    @PatchMapping("/players/{id}")
    public BakeryService.State rename(@PathVariable UUID id, @RequestBody Rename update) {
        return bakery.rename(id, update.name());
    }

    @DeleteMapping("/players/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        bakery.delete(id);
    }

    @PostMapping("/players/{id}/actions")
    public BakeryService.State act(@PathVariable UUID id, @RequestBody BakeryService.Action action) {
        return bakery.act(id, action);
    }

    @GetMapping("/players/{id}/sales")
    public List<Map<String, Object>> sales(@PathVariable UUID id) {
        return bakery.sales(id);
    }
}
