import '@fontsource/fraunces/latin-700.css';
import '@fontsource/fraunces/latin-700-italic.css';
import '@fontsource/nunito/latin-500.css';
import '@fontsource/nunito/latin-800.css';
import './style.css';
import { animal, pastry, animals } from './art.js';
import { startScene } from './scene.js';
import { icon } from './icons.js';
import { ingredients, products, customers, upgrades, shiftSize, levelOf, ticket, canBake } from './model.js';

const $ = (selector) => document.querySelector(selector);
const dialog = $('#dialog');
const portrait = Object.fromEntries(Object.keys(animals).map(species => [species, animal(species).toDataURL()]));
const treats = Object.fromEntries(products.map(product => [product.id, pastry(product.id).toDataURL()]));
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* The current session can still be played if storage is disabled. */ }
}

const profileKey = 'sugarberry-profile-v1';
const snapshotKey = 'sugarberry-db-v1';
const catalogKey = 'sugarberry-catalog-v1';
const soundKey = 'sugarberry-sound-v1';
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
// ?profile=<uuid> opens the same bakery on another device; the database holds the save.
const shared = new URLSearchParams(location.search).get('profile');
if (shared && uuid.test(shared)) {
  if (shared.toLowerCase() !== read(profileKey, null)) localStorage.removeItem(snapshotKey);
  save(profileKey, shared.toLowerCase());
  history.replaceState(null, '', location.pathname);
}
let profile = read(profileKey, null);
let sound = read(soundKey, true);
let audio;
let state;
let online = false;
let busy = false;
let pending = null;
let minigame = null;
let prepared = null;
let panel;
let sceneReady = false;
let toastTimer;
let seconds = 95;
let clockRunning = false;
const scene = startScene();
window.addEventListener('bakery-ready', () => {
  sceneReady = true;
  if (state) renderWorld();
});

$('#brand-mark').innerHTML = `<img src="${animal('bunny', false, true).toDataURL()}" alt="">`;
document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
$('#help').innerHTML = icon('help');

function play(notes) {
  if (!sound || !window.AudioContext) return;
  audio ||= new AudioContext();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  notes.forEach((frequency, i) => {
    const start = audio.currentTime + i * 0.085;
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    oscillator.connect(volume).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.21);
  });
}
function renderSound() {
  $('#sound').innerHTML = icon(sound ? 'sound' : 'mute');
  $('#sound').setAttribute('aria-pressed', sound);
  $('#sound').title = sound ? 'Mute sound' : 'Unmute sound';
}
$('#sound').onclick = () => { sound = !sound; save(soundKey, sound); renderSound(); play([660, 880]); };
renderSound();

function toast(text) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
}

async function request(path, options) {
  let response;
  try {
    response = await fetch('/api' + path, { signal: AbortSignal.timeout(import.meta.env.DEV ? 4000 : 12000), ...options });
  } catch {
    throw Object.assign(Error('Could not reach the bakery server. Try again.'), { uncertain: true });
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(Error(data.detail || 'The bakery server is unavailable.'), { uncertain: response.status >= 500 });
  }
  return response.json();
}

function applyCatalog(catalog) {
  for (const list of ['products', 'ingredients', 'customers']) {
    const local = { products, ingredients, customers }[list];
    const merged = catalog[list].map(item => {
      const artwork = local.find(entry => entry.id === item.id);
      return artwork ? { ...artwork, ...item } : null;
    });
    if (merged.length !== local.length || merged.some(item => !item)) {
      throw Error('The server catalog does not match this game version.');
    }
    local.splice(0, local.length, ...merged);
  }
}

async function boot() {
  try {
    const id = profile || crypto.randomUUID();
    const [player, catalog] = await Promise.all([
      request('/players/' + id, { method: 'PUT' }),
      request('/catalog'),
    ]);
    applyCatalog(catalog);
    save(catalogKey, catalog);
    state = player;
    profile = id;
    save(profileKey, id);
    save(snapshotKey, state);
    online = true;
  } catch (error) {
    // Show the last state the database confirmed. Changes wait behind Retry saving until it answers.
    const cached = profile && read(snapshotKey, null);
    const catalog = read(catalogKey, null);
    if (cached && catalog) {
      applyCatalog(catalog);
      state = cached;
      toast('Showing your last saved shift. Reconnect to make changes.');
    } else {
      $('#save-label').textContent = 'Database offline';
      $('#order').innerHTML = `<article class="order-ticket finished"><h3>The bakery is closed</h3>
        <p>${escape(error.message)}</p><button type="button" class="primary" data-do="reconnect">Try again</button></article>`;
      return;
    }
  }
  render();
}

// Pick up changes made in another tab, on another device, or in the database view.
async function refresh() {
  if (!state || busy || pending || dialog.open || prepared) return;
  try {
    const latest = await request('/players/' + profile);
    online = true;
    if (latest.revision !== state.revision || latest.name !== state.name) {
      if (latest.day !== state.day || latest.slot !== state.slot) { seconds = 95; clockRunning = false; }
      state = latest;
      save(snapshotKey, state);
      render();
    } else render(false);
  } catch { /* Keep the last confirmed state. */ }
}

function guestImage(customer) {
  return `<img src="${portrait[customer.species]}" alt="">`;
}
function treatImage(product) {
  return `<img src="${treats[product.id]}" alt="">`;
}
function renderWorld() {
  if (sceneReady) scene.show([0, 1, 2].map(offset => ticket(state, offset)), state.decor, state.oven);
}
function render(updateWorld = true) {
  const current = ticket(state);
  $('#save-label').textContent = online ? 'Saved in PostgreSQL' : 'Offline · last saved copy';
  $('#day').textContent = 'Day ' + state.day;
  $('#coins').textContent = state.coins;
  $('#shift-state').textContent = current ? 'Bakery open' : 'Shift complete';
  $('#progress').innerHTML = `<span>${state.slot} / ${shiftSize} tickets</span><span class="pips" aria-hidden="true">${Array.from({ length: shiftSize }, (_, i) => `<i class="${i < state.slot ? 'filled' : ''}"></i>`).join('')}</span>`;
  $('#level').textContent = 'Level ' + levelOf(state.xp);
  $('#world-caption').textContent = current ? 'Fresh bakes, happy paws' : 'See you tomorrow';
  $('#recipes').innerHTML = products.map(product => {
    const locked = levelOf(state.xp) < product.level;
    return `<button type="button" class="recipe ${locked ? 'locked' : ''}" data-recipe="${product.id}">
      ${treatImage(product)}<span><strong>${escape(product.name)}</strong><small>${locked ? icon('lock') + ' Level ' + product.level : product.price + ' coins'}</small></span></button>`;
  }).join('');
  $('#order').innerHTML = current ? `
    <article class="order-ticket">
      <div class="ticket-heading"><span>Ticket № ${String(state.slot + 1).padStart(2, '0')}</span><span class="ticket-price">${icon('coin')}${current.product.price + (state.decor ? 2 : 0)}</span></div>
      <div class="guest">${guestImage(current.customer)}<div><h3>${escape(current.customer.name)}</h3><p>“${escape(current.customer.line)}”</p></div></div>
      <div class="wanted">${treatImage(current.product)}<div><small>WOULD LOVE</small><strong>${escape(current.product.name)}</strong></div></div>
      <div class="patience"><span>Patience</span><div class="patience-track"><i id="patience-fill"></i></div><span id="patience-time"></span></div>
      <button type="button" class="primary" data-do="bake" ${busy || pending ? 'disabled' : ''}>${icon('flame')} ${prepared ? 'Serve ' + escape(current.product.name) : 'Bake order'} ${icon('arrow')}</button>
      <button type="button" class="text-button" data-do="skip" ${busy || pending ? 'disabled' : ''}>Let this guest go</button>
    </article>` : `
    <article class="order-ticket finished">
      <span class="finish-icon">${icon('heart')}</span><h3>That’s a wrap!</h3><p>You served ${state.served} of ${shiftSize} guests today.</p>
      <button type="button" class="primary" data-do="next" ${busy || pending ? 'disabled' : ''}>Open day ${state.day + 1} ${icon('arrow')}</button>
    </article>`;
  if (pending) $('#order').insertAdjacentHTML('beforeend', '<button class="primary" data-do="retry" type="button">Retry saving</button>');
  $('#queue').innerHTML = [1, 2].map(offset => {
    const entry = ticket(state, offset);
    return entry ? `<div class="queue-guest">${guestImage(entry.customer)}<div><strong>${escape(entry.customer.name)}</strong><small>${escape(entry.product.name)}</small></div>${treatImage(entry.product)}</div>` : '';
  }).join('') || '<p class="empty">No more guests waiting.</p>';
  paintClock();
  if (updateWorld) renderWorld();
}
function paintClock() {
  const fill = $('#patience-fill');
  if (!fill) return;
  fill.style.width = 100 * seconds / 95 + '%';
  fill.classList.toggle('low', seconds <= 20);
  $('#patience-time').textContent = seconds + 's';
}

function showPanel(name, title, content) {
  panel = name;
  $('#dialog-content').innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-do="close" type="button" aria-label="Close">${icon('close')}</button></div>${content}`;
  if (!dialog.open) dialog.showModal();
}
function pantry() {
  showPanel('pantry', 'The pantry', `<p>Refill a jar with six portions.</p><div class="shelf-list">${ingredients.map(item => `
    <div class="shelf-row"><span class="jar" style="--jar:${item.color}"></span><div><strong>${escape(item.name)}</strong><small>${state.stock[item.id]} in stock</small></div>
      <button type="button" data-restock="${item.id}" ${busy || pending || state.coins < item.price ? 'disabled' : ''}>+ 6 · ${item.price} coins</button></div>`).join('')}</div>`);
}
function shop() {
  showPanel('shop', 'The village shop', `<p>A little something for your bakery.</p><div class="shelf-list">${Object.entries(upgrades).map(([id, item]) => `
    <div class="shelf-row"><span class="shop-icon">${icon(id === 'oven' ? 'flame' : 'heart')}</span><div><strong>${escape(item.name)}</strong><small>${item.description}</small></div>
    <button type="button" data-upgrade="${id}" ${busy || pending || state[id] || state.coins < item.cost ? 'disabled' : ''}>${state[id] ? 'Owned' : item.cost + ' coins'}</button></div>`).join('')}</div>`);
}
async function ledger() {
  const history = state.history;
  showPanel('ledger', 'Sales ledger', `<p>${state.xp} treats served across your shifts.</p>
    <p id="daily-sales" class="daily-sales">Tallying today’s sales…</p>
    ${history.length ? `<div class="ledger-table"><table><caption>Recent sales · last 20</caption><thead><tr><th>Day</th><th>Guest</th><th>Treat</th><th>Coins</th></tr></thead><tbody>${history.slice(0, 20).map(row =>
      `<tr><td>${row.day}</td><td>${escape(row.customer)}</td><td>${escape(row.product)}</td><td>${row.total}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Your first sale goes here.</p>'}`);
  const summary = $('#daily-sales');
  try {
    const daily = (await request('/players/' + profile + '/sales')).find(row => row.day === state.day);
    summary.textContent = `Day ${state.day} · ${daily?.orders ?? 0} sold · ${daily?.revenue ?? 0} coins earned`;
  } catch {
    summary.textContent = 'Daily totals are available when connected.';
  }
}
function recipe(product) {
  const locked = levelOf(state.xp) < product.level;
  showPanel('recipe', escape(product.name), `<div class="recipe-detail">${treatImage(product)}<div><p>${locked ? 'Unlocks at level ' + product.level + '.' : 'Sells for ' + product.price + ' coins.'}</p><ul>${Object.entries(product.recipe).map(([id, amount]) =>
    `<li>${amount} × ${escape(ingredients.find(item => item.id === id).name)}</li>`).join('')}</ul></div></div>`);
}
function help() {
  showPanel('help', 'How to play', `<ol class="instructions">
    <li>Tap the counter or choose <strong>Bake order</strong>. Add the recipe portions, then drag around the bowl or press Whisk eight times.</li>
    <li>Stop the oven needle in the highlighted zone for a four-coin bonus. Every baked treat can be served.</li>
    <li>Carry the finished treat to the counter, then tap the guest or press Serve before their patience runs out. The clock starts when you begin playing and pauses in the pantry, shop, or ledger.</li>
    <li>Finish five tickets to open the next day. Every three sales earns a level. New recipes join the queue next shift.</li>
  </ol><p>Use the buttons with touch, mouse, or keyboard. The pantry sells refills and the shop sells upgrades.</p>`);
}

function bake() {
  if (prepared) { change({ action: 'serve', perfect: prepared.perfect }); return; }
  const current = ticket(state);
  if (!current) return;
  if (!canBake(state, current.product)) { toast('You’re short on ingredients. Refill your pantry.'); pantry(); return; }
  if (sceneReady) scene.walkTo(238);
  clockRunning = true;
  minigame = { product: current.product, mix: {}, phase: 'mix' };
  renderMix();
}
function renderMix(focus) {
  const { product, mix } = minigame;
  const amounts = Object.entries(product.recipe);
  const ready = amounts.every(([id, amount]) => (mix[id] || 0) === amount);
  showPanel('bake', 'Mix the batter', `
    <div class="bake-lead">${treatImage(product)}<p>Add the portions for <strong>${escape(product.name)}</strong>.</p></div>
    <div class="shelf-list">${amounts.map(([id, amount]) => {
      const item = ingredients.find(ingredient => ingredient.id === id);
      const count = mix[id] || 0;
      return `<div class="shelf-row"><span class="jar" style="--jar:${item.color}"></span><div><strong>${escape(item.name)}</strong><small>${count} / ${amount} portions</small></div>
        <button type="button" data-mix="${id}" ${count === amount ? 'disabled' : ''}>Add</button></div>`;
    }).join('')}</div>
    <button class="primary" type="button" data-do="stir-start" ${ready ? '' : 'disabled'}>${icon('flame')} Whisk the batter</button>`);
  if (focus) (Array.from(dialog.querySelectorAll('[data-mix]:enabled')).find(button => button.dataset.mix === focus)
    || dialog.querySelector('[data-mix]:enabled, [data-do="stir-start"]')).focus();
}
function stir() {
  minigame.phase = 'stir';
  minigame.strokes = 0;
  showPanel('bake', 'Whisk it fluffy', `<p>Drag around the bowl, or tap Whisk eight times.</p>
    <div class="mixing-bowl" id="mixing-bowl" aria-hidden="true"><span id="spoon">╱</span></div>
    <p id="mix-progress" role="status">0 / 8 strokes</p>
    <button class="primary" data-do="whisk" type="button">Whisk</button>`);
  const bowl = $('#mixing-bowl');
  let last = null;
  bowl.onpointerdown = event => { bowl.setPointerCapture(event.pointerId); last = { x: event.clientX, y: event.clientY }; };
  bowl.onpointerup = bowl.onpointercancel = () => { last = null; };
  bowl.onpointermove = event => {
    if (!last || minigame?.phase !== 'stir') return;
    if (Math.hypot(event.clientX - last.x, event.clientY - last.y) > 28) {
      last = { x: event.clientX, y: event.clientY };
      whisk();
    }
  };
  dialog.querySelector('[data-do="whisk"]').focus();
}
function whisk() {
  if (minigame?.phase !== 'stir') return;
  minigame.strokes++;
  play([350 + minigame.strokes * 35]);
  $('#spoon').style.transform = 'rotate(' + minigame.strokes * 80 + 'deg)';
  $('#mix-progress').textContent = minigame.strokes + ' / 8 strokes';
  if (minigame.strokes === 8) oven();
}
function oven() {
  if (sceneReady) scene.walkTo(68);
  minigame.phase = 'oven';
  minigame.start = performance.now();
  minigame.width = state.oven ? 0.36 : 0.22;
  showPanel('bake', 'Mind the oven', `<div class="bake-lead">${treatImage(minigame.product)}<p>Stop the needle inside the gold zone for a perfect bake.</p></div>
    <div class="oven-meter" aria-hidden="true"><div class="sweet-spot" style="width:${minigame.width * 100}%"></div><i id="needle"></i></div>
    <button class="primary" type="button" data-do="stop">${icon('flame')} Take it out</button>`);
  dialog.querySelector('[data-do="stop"]').focus();
  function tick() {
    if (!dialog.open || minigame?.phase !== 'oven') return;
    $('#needle').style.left = position() * 100 + '%';
    requestAnimationFrame(tick);
  }
  tick();
}
function position() {
  const cycle = ((performance.now() - minigame.start) / 1050) % 2;
  return 1 - Math.abs(cycle - 1);
}
function finishBake() {
  minigame.perfect = Math.abs(position() - 0.5) <= minigame.width / 2;
  minigame.phase = 'ready';
  if (sceneReady) scene.walkTo(238);
  play(minigame.perfect ? [659, 784, 1047] : [523, 659]);
  showPanel('bake', minigame.perfect ? 'Perfect bake!' : 'Fresh from the oven', `
    <div class="bake-lead">${treatImage(minigame.product)}<p>${minigame.perfect ? 'Golden and gorgeous. Earn four bonus coins.' : 'Warm and ready to serve.'}</p></div>
    <button class="primary" type="button" data-do="carry">Carry to the counter ${icon('arrow')}</button>`);
  dialog.querySelector('[data-do="carry"]').focus();
}

async function change(input) {
  if (busy || !state || (pending && input)) return;
  const command = pending || { ...input, day: state.day, slot: state.slot, revision: state.revision, requestId: crypto.randomUUID() };
  busy = true;
  const originalPanel = panel;
  const button = dialog.open && dialog.querySelector(':focus');
  if (button instanceof HTMLButtonElement) button.disabled = true;
  render(false);
  try {
    const oldLevel = levelOf(state.xp);
    state = await request('/players/' + profile + '/actions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
    });
    save(snapshotKey, state);
    online = true;
    pending = null;
    if (['serve', 'skip', 'next'].includes(command.action)) {
      prepared = null;
      seconds = 95;
      clockRunning = command.action !== 'next' && state.slot < shiftSize;
      if (dialog.open) dialog.close();
    }
    if (command.action === 'serve') {
      if (sceneReady) scene.celebrate();
      play([523, 659, 784, 1047]);
      toast(levelOf(state.xp) > oldLevel ? 'Level up! Check your recipe book.' : 'One happy guest. Coins in the till!');
    } else if (command.action === 'skip') {
      toast('Your guest went for a walk. The next ticket is ready.');
    } else if (command.action === 'restock' || command.action === 'upgrade') {
      play([587, 784]);
      toast(command.action === 'restock' ? 'Pantry topped up.' : 'Your bakery got an upgrade!');
    }
  } catch (error) {
    if (error.uncertain) {
      pending = command;
      online = false;
      if (dialog.open) dialog.close();
    } else {
      // The database rejected the change, so reload what it actually holds.
      try {
        state = await request('/players/' + profile);
        save(snapshotKey, state);
        if (originalPanel === 'bake') dialog.close();
      } catch { /* Keep the last confirmed state. */ }
      pending = null;
    }
    toast(error.message);
  } finally {
    busy = false;
    if (button?.isConnected) button.disabled = false;
    render();
    if (dialog.open && originalPanel === 'pantry') pantry();
    if (dialog.open && originalPanel === 'shop') shop();
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.do;
  if (button.id === 'help') help();
  if (action === 'close') dialog.close();
  if (action === 'reconnect') { $('#order').innerHTML = '<p>Setting out the pastries…</p>'; boot(); }
  if (!state || busy) return;
  const { dataset } = button;
  if (dataset.panel === 'pantry') pantry();
  if (dataset.panel === 'shop') shop();
  if (dataset.panel === 'ledger') ledger();
  if (dataset.recipe) recipe(products.find(product => product.id === dataset.recipe));
  if (dataset.restock) change({ action: 'restock', item: dataset.restock });
  if (dataset.upgrade) change({ action: 'upgrade', item: dataset.upgrade });
  if (action === 'bake') bake();
  if (action === 'skip' || action === 'next') change({ action });
  if (action === 'retry') change();
  if (dataset.mix) {
    minigame.mix[dataset.mix] = (minigame.mix[dataset.mix] || 0) + 1;
    play([440 + 55 * minigame.mix[dataset.mix]]);
    renderMix(dataset.mix);
  }
  if (action === 'stir-start') stir();
  if (action === 'whisk') whisk();
  if (action === 'stop') finishBake();
  if (action === 'carry') {
    prepared = { perfect: minigame.perfect };
    dialog.close();
    render(false);
    toast('Your treat is ready! Tap the guest at the counter to serve.');
  }
});
dialog.addEventListener('close', () => { if (!dialog.open) { minigame = null; panel = null; } });
setInterval(() => {
  if (!clockRunning || busy || pending || document.hidden || (dialog.open && panel !== 'bake')) return;
  seconds = Math.max(0, seconds - 1);
  paintClock();
  if (!seconds) { clockRunning = false; change({ action: 'skip' }); }
}, 1000);
window.addEventListener('bakery-station', event => {
  if (!state || busy || pending || dialog.open) return;
  if (event.detail === 'bake') bake();
  if (event.detail === 'serve') { if (prepared) bake(); else toast('Bake this guest’s treat at the counter or oven.'); }
  if (event.detail === 'pantry') pantry();
  if (event.detail === 'ledger') ledger();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('focus', refresh);
boot();
