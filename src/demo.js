import '@fontsource/fraunces/latin-700.css';
import '@fontsource/nunito/latin-500.css';
import './style.css';

const profileTables = {
  players: ['id', 'name', 'coins', 'xp', 'day', 'slot'],
  inventory: ['player_id', 'ingredient_id', 'quantity'],
  orders: ['id', 'player_id', 'customer_id', 'day', 'slot', 'bonus'],
  order_items: ['order_id', 'product_id', 'quantity', 'unit_price'],
};
const catalogTables = {
  ingredients: ['id', 'name', 'refill_price', 'starting_stock'],
  products: ['id', 'name', 'price', 'unlock_level'],
  recipe_ingredients: ['product_id', 'ingredient_id', 'portions'],
  customers: ['id', 'name', 'species', 'rotation'],
};
const $ = selector => document.querySelector(selector);
const serverMode = new URLSearchParams(location.search).has('server');
const storageKey = serverMode ? 'bakery-demo' : 'bakery-demo-browser';
$('#database-mode').textContent = serverMode
  ? 'Connected through the Spring Boot API.'
  : 'PostgreSQL runs in this browser. Demo data stays on this device.';
let id = sessionStorage.getItem(storageKey);
let state;
let busy = false;

function controls() {
  document.querySelectorAll('[data-action]').forEach(button => {
    const action = button.dataset.action;
    button.disabled = busy || (action === 'create' ? Boolean(state) : !state)
      || (action === 'serve' && state.slot >= 5);
  });
}

async function request(path, method = 'GET', body) {
  const response = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 204) return;
  if (!response.headers.get('content-type')?.includes('json')) {
    throw Error('The bakery API did not return JSON. Check the deployment routing.');
  }
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.detail || 'Request failed.'), { status: response.status });
  return data;
}

const server = {
  create: id => request('/players/' + id, 'PUT'),
  read: id => request('/players/' + id),
  rename: (id, name) => request('/players/' + id, 'PATCH', { name }),
  remove: id => request('/players/' + id, 'DELETE'),
  serve: (id, state) => request('/players/' + id + '/actions', 'POST', {
    action: 'serve', perfect: true, day: state.day, slot: state.slot,
    revision: state.revision, requestId: crypto.randomUUID(),
  }),
  sales: id => request('/players/' + id + '/sales'),
  tables: id => request(id ? '/players/' + id + '/tables' : '/tables'),
};
const database = serverMode ? Promise.resolve(server) : import('./demo-db.js');

async function checkApi() {
  try {
    const catalog = await request('/catalog');
    if (!Array.isArray(catalog.products)) throw Error('Unexpected catalog response.');
    $('#api-status').textContent = 'Connected · GET /api/catalog returned catalog data.';
  } catch (error) {
    $('#api-status').textContent = 'Unavailable · ' + error.message
      + (serverMode ? '' : ' Browser database mode is available independently.');
  }
}

checkApi();

function renderTable(name, columns, rows) {
  const section = document.createElement('section');
  section.className = 'db-table';
  const heading = document.createElement('h3');
  heading.textContent = name;
  section.append(heading);
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No rows yet.';
    section.append(empty);
    return section;
  }
  const scroll = document.createElement('div');
  scroll.className = 'db-table-scroll';
  const table = document.createElement('table');
  table.setAttribute('aria-label', name);
  const header = table.createTHead().insertRow();
  for (const column of columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column;
    header.append(cell);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const cells = body.insertRow();
    for (const column of columns) {
      const cell = cells.insertCell();
      cell.textContent = row[column];
      if (/^[a-f0-9-]{36}$/i.test(cell.textContent)) {
        cell.title = cell.textContent;
        cell.className = 'db-uuid';
      }
    }
  }
  scroll.append(table);
  section.append(scroll);
  return section;
}

async function refreshTables() {
  const rows = await (await database).tables(id);
  for (const [selector, tables] of [['#profile-tables', profileTables], ['#catalog-tables', catalogTables]]) {
    $(selector).replaceChildren(...Object.entries(tables).map(([name, columns]) =>
      renderTable(name, columns, rows[name] || [])));
  }
  $('#player-description').textContent = state
    ? 'Only the demo profile is shown. Orders and line items cover the latest 20 sales.'
    : 'Create a demo profile to see its player, inventory, and order rows.';
}

const messages = {
  create: 'Profile and starting inventory created.',
  rename: 'Player name updated.',
  read: 'Records refreshed.',
  serve: 'Sale committed. Compare the player, inventory, order, and line-item rows.',
  sales: 'Daily totals loaded.',
  delete: 'Demo profile deleted. Its inventory and orders were removed too.',
};

async function run(action) {
  busy = true;
  controls();
  $('#status').textContent = 'Working…';
  try {
    const db = await database;
    const before = state;
    if (action === 'create') {
      id ||= crypto.randomUUID();
      sessionStorage.setItem(storageKey, id);
      state = await db.create(id);
    } else if (action === 'rename') {
      state = await db.rename(id, $('#name').value);
    } else if (action === 'serve') {
      state = await db.serve(id, state);
      const changes = Object.keys(state.stock).filter(key => before.stock[key] !== state.stock[key])
        .map(key => key + ' ' + before.stock[key] + ' → ' + state.stock[key]);
      $('#sale-summary').textContent = 'Coins ' + before.coins + ' → ' + state.coins + '. Stock: ' + changes.join(', ') + '.';
      $('#sale-summary').hidden = false;
      $('#daily-section').hidden = true;
    } else if (action === 'sales') {
      const totals = await db.sales(id);
      $('#daily-table').replaceChildren(renderTable('Sales by day', ['day', 'orders', 'revenue'], totals));
      $('#daily-section').hidden = false;
    } else if (action === 'delete') {
      await db.remove(id);
      state = undefined;
      id = null;
      sessionStorage.removeItem(storageKey);
      $('#daily-section').hidden = true;
      $('#sale-summary').hidden = true;
    } else if (id) {
      try {
        state = await db.read(id);
      } catch (error) {
        if (error.status !== 404) throw error;
        state = undefined;
        id = null;
        sessionStorage.removeItem(storageKey);
      }
    }
    if (action !== 'sales') await refreshTables();
    $('#status').textContent = action === 'read' && !id ? 'Start with Create profile.' : messages[action];
  } catch (error) {
    $('#status').textContent = error.message;
  } finally {
    busy = false;
    controls();
  }
}

document.querySelector('.demo-controls').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && !busy) run(button.dataset.action);
});
run('read');
