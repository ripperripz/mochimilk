// Database view: reads the live tables through the API and runs the same actions as the game.
import '@fontsource/fraunces/latin-700.css';
import '@fontsource/nunito/latin-500.css';
import './style.css';

const playerTables = {
  players: { columns: ['id', 'name', 'coins', 'xp', 'day', 'slot', 'served', 'oven', 'decor', 'revision'], key: ['id'] },
  inventory: { columns: ['player_id', 'ingredient_id', 'quantity'], key: ['ingredient_id'] },
  orders: { columns: ['id', 'customer_id', 'day', 'slot', 'bonus', 'served_at'], key: ['id'] },
  order_items: { columns: ['order_id', 'product_id', 'quantity', 'unit_price'], key: ['order_id', 'product_id'] },
};
const catalogTables = {
  ingredients: { columns: ['id', 'name', 'refill_price', 'starting_stock'], key: ['id'] },
  products: { columns: ['id', 'name', 'price', 'unlock_level'], key: ['id'] },
  recipe_ingredients: { columns: ['product_id', 'ingredient_id', 'portions'], key: ['product_id', 'ingredient_id'] },
  customers: { columns: ['id', 'name', 'species', 'rotation'], key: ['id'] },
};
const profileKey = 'sugarberry-profile-v1'; // Shared with the game, so both pages show one save.
const $ = selector => document.querySelector(selector);

let id = readProfile();
let rows = null;     // Latest /tables response.
let previous = null; // Response before the latest change, for highlighting.
let busy = false;

function readProfile() {
  try { return JSON.parse(localStorage.getItem(profileKey)); } catch { return null; }
}

async function request(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch('/api' + path, {
      method, cache: 'no-store', signal: AbortSignal.timeout(12000),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw Error('Could not reach the bakery API.');
  }
  if (response.status === 204) return null;
  if (!response.headers.get('content-type')?.includes('json')) {
    throw Error('The API did not return JSON (HTTP ' + response.status + '). Check the deployment routing.');
  }
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.detail || 'Request failed.'), { status: response.status });
  return data;
}

const player = () => rows?.players?.[0];
const keyOf = (spec, row) => spec.key.map(column => row[column]).join('|');

function renderTable(name, spec, list, before) {
  const section = document.createElement('section');
  section.className = 'db-table';
  const heading = document.createElement('h3');
  heading.textContent = `${name} (${list.length})`;
  section.append(heading);
  if (!list.length) {
    section.append(Object.assign(document.createElement('p'), { textContent: 'No rows yet.' }));
    return section;
  }
  const old = before && new Map(before.map(row => [keyOf(spec, row), row]));
  const table = document.createElement('table');
  table.setAttribute('aria-label', name);
  const header = table.createTHead().insertRow();
  for (const column of spec.columns) {
    header.append(Object.assign(document.createElement('th'), { scope: 'col', textContent: column }));
  }
  const body = table.createTBody();
  for (const row of list) {
    const tr = body.insertRow();
    const was = old?.get(keyOf(spec, row));
    if (old && !was) tr.className = 'db-new';
    for (const column of spec.columns) {
      const cell = tr.insertCell();
      let value = row[column];
      if (column === 'served_at' && value) value = new Date(value).toLocaleTimeString();
      cell.textContent = value;
      if (/^[a-f0-9-]{36}$/i.test(String(value))) { cell.title = value; cell.className = 'db-uuid'; }
      if (was && was[column] !== row[column]) {
        cell.classList.add('db-changed');
        cell.title = 'was ' + was[column];
      }
    }
  }
  const scroll = document.createElement('div');
  scroll.className = 'db-table-scroll';
  scroll.append(table);
  section.append(scroll);
  return section;
}

function render() {
  const p = player();
  for (const [selector, tables] of [['#profile-tables', playerTables], ['#catalog-tables', catalogTables]]) {
    $(selector).replaceChildren(...Object.entries(tables).map(([name, spec]) =>
      renderTable(name, spec, rows?.[name] || [], previous?.[name])));
  }
  if (p) {
    const link = new URL('./?profile=' + p.id, location.href).href;
    $('#profile').innerHTML = '';
    $('#profile').append(`${p.name} · day ${p.day}, ticket ${Math.min(p.slot + 1, 5)} of 5 · ${p.coins} coins. Open it on another device: `,
      Object.assign(document.createElement('a'), { href: link, textContent: link }));
    if (document.activeElement !== $('#name')) $('#name').value = p.name;
  } else {
    $('#profile').textContent = 'This browser has no bakery yet. Create one here or open the game.';
  }
  $('#restock-item').replaceChildren(...(rows?.ingredients || []).map(item =>
    new Option(`${item.name} (${item.refill_price})`, item.id)));
  for (const button of document.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    const open = p && p.slot < 5;
    button.disabled = busy || (action === 'create' ? Boolean(p) : !p)
      || (['serve', 'skip'].includes(action) && !open) || (action === 'next' && p?.slot !== 5);
  }
}

// Summarise what one action changed, in database terms.
function describe(before, after) {
  const a = before.players[0], b = after.players?.[0];
  if (!b) return 'Deleted the players row; ON DELETE CASCADE removed its inventory, orders, and order_items.';
  if (!a) return `Inserted 1 players row and ${after.inventory.length} inventory rows (starting stock from ingredients).`;
  const parts = [];
  for (const column of ['coins', 'xp', 'day', 'slot', 'oven', 'decor', 'name']) {
    if (a?.[column] !== b[column]) parts.push(`${column} ${a?.[column]} → ${b[column]}`);
  }
  const stock = Object.fromEntries((before.inventory || []).map(row => [row.ingredient_id, row.quantity]));
  for (const row of after.inventory || []) {
    if (stock[row.ingredient_id] !== row.quantity) parts.push(`${row.ingredient_id} ${stock[row.ingredient_id] ?? 0} → ${row.quantity}`);
  }
  const known = new Set((before.orders || []).map(row => row.id));
  const added = (after.orders || []).filter(row => !known.has(row.id));
  if (added.length) parts.push('new orders row ' + added.map(row => '#' + row.id).join(', ') + ' with its order_items line');
  return parts.length ? 'Committed: ' + parts.join('; ') + '.' : 'Committed. No visible row changed.';
}

async function load() {
  const latest = await request(id ? '/players/' + id + '/tables' : '/tables');
  if (id && !latest.players?.length) {
    // The profile ID is not in the database (reset elsewhere); show the catalog only.
    id = null;
  }
  if (rows && JSON.stringify(latest) !== JSON.stringify(rows)) previous = rows;
  rows = latest;
  $('#api-status').textContent = 'Connected to PostgreSQL · last read ' + new Date().toLocaleTimeString();
  render();
}

function command(action, extra = {}) {
  const p = player();
  return request('/players/' + id + '/actions', 'POST', {
    action, day: p.day, slot: p.slot, revision: p.revision, requestId: crypto.randomUUID(), ...extra,
  });
}

const actions = {
  create: async () => {
    id = crypto.randomUUID();
    await request('/players/' + id, 'PUT');
    localStorage.setItem(profileKey, JSON.stringify(id));
    localStorage.removeItem('sugarberry-db-v1');
  },
  serve: () => command('serve', { perfect: true }),
  skip: () => command('skip'),
  next: () => command('next'),
  restock: () => command('restock', { item: $('#restock-item').value }),
  upgrade: () => command('upgrade', { item: $('#upgrade-item').value }),
  rename: () => request('/players/' + id, 'PATCH', { name: $('#name').value }),
  delete: async () => {
    if (!confirm('Delete this bakery from the database? The game starts a fresh one with the same ID.')) return false;
    await request('/players/' + id, 'DELETE');
  },
  sales: async () => {
    const totals = await request('/players/' + id + '/sales');
    $('#daily-table').replaceChildren(renderTable('sales by day', { columns: ['day', 'orders', 'revenue'], key: ['day'] }, totals));
    $('#daily-section').hidden = false;
    return false;
  },
};

async function run(action) {
  busy = true;
  render();
  $('#status').textContent = 'Working…';
  try {
    const before = rows;
    const result = await actions[action]();
    if (result !== false) {
      await load();
      previous = before;
      render();
      $('#changes').textContent = describe(before, rows);
      $('#changes').hidden = false;
      if (action !== 'sales') $('#daily-section').hidden = true;
    }
    $('#status').textContent = '';
  } catch (error) {
    $('#status').textContent = error.message;
    await load().catch(() => {});
  } finally {
    busy = false;
    render();
  }
}

$('#controls').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && !busy) run(button.dataset.action);
});

// Poll while the page is visible so sales made in the game tab appear here.
async function poll() {
  if (!busy && !document.hidden) {
    try { await load(); } catch (error) {
      $('#api-status').textContent = 'Unavailable · ' + error.message;
    }
  }
}
window.addEventListener('storage', event => { if (event.key === profileKey) { id = readProfile(); previous = null; poll(); } });
document.addEventListener('visibilitychange', poll);
setInterval(poll, 4000);
poll();
