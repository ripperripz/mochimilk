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
const storageKey = 'bakery-demo';
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
  const rows = await request(id ? '/players/' + id + '/tables' : '/tables');
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
    const before = state;
    if (action === 'create') {
      id ||= crypto.randomUUID();
      sessionStorage.setItem(storageKey, id);
      state = await request('/players/' + id, 'PUT');
    } else if (action === 'rename') {
      state = await request('/players/' + id, 'PATCH', { name: $('#name').value });
    } else if (action === 'serve') {
      state = await request('/players/' + id + '/actions', 'POST', {
        action: 'serve', perfect: true, day: state.day, slot: state.slot,
        revision: state.revision, requestId: crypto.randomUUID(),
      });
      const changes = Object.keys(state.stock).filter(key => before.stock[key] !== state.stock[key])
        .map(key => key + ' ' + before.stock[key] + ' → ' + state.stock[key]);
      $('#sale-summary').textContent = 'Coins ' + before.coins + ' → ' + state.coins + '. Stock: ' + changes.join(', ') + '.';
      $('#sale-summary').hidden = false;
      $('#daily-section').hidden = true;
    } else if (action === 'sales') {
      const totals = await request('/players/' + id + '/sales');
      $('#daily-table').replaceChildren(renderTable('Sales by day', ['day', 'orders', 'revenue'], totals));
      $('#daily-section').hidden = false;
    } else if (action === 'delete') {
      await request('/players/' + id, 'DELETE');
      state = undefined;
      id = null;
      sessionStorage.removeItem(storageKey);
      $('#daily-section').hidden = true;
      $('#sale-summary').hidden = true;
    } else if (id) {
      try {
        state = await request('/players/' + id);
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
