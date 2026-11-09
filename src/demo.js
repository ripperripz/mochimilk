import '@fontsource/fraunces/latin-700.css';
import '@fontsource/nunito/latin-500.css';
import './style.css';
let id = sessionStorage.getItem('bakery-demo');
let state;
let busy = false;
const $ = selector => document.querySelector(selector);
function controls() {
  document.querySelectorAll('button').forEach(button => {
    const action = button.dataset.action;
    button.disabled = busy || (action === 'create' ? Boolean(state) : !state) || (action === 'serve' && state?.slot >= 5);
  });
}
async function run(action) {
  busy = true;
  controls();
  $('#before').textContent = JSON.stringify(state ?? null, null, 2);
  try {
    let method = 'GET';
    let body;
    if (action === 'create') { id ||= crypto.randomUUID(); method = 'PUT'; sessionStorage.setItem('bakery-demo', id); }
    if (action === 'delete') method = 'DELETE';
    if (action === 'rename') { method = 'PATCH'; body = { name: $('#name').value }; }
    if (action === 'serve') {
      method = 'POST';
      body = { action: 'serve', perfect: true, day: state.day, slot: state.slot, revision: state.revision, requestId: crypto.randomUUID() };
    }
    const suffix = action === 'serve' ? '/actions' : action === 'sales' ? '/sales' : '';
    const response = await fetch('/api/players/' + id + suffix, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000),
    });
    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('json');
    if (response.status !== 204 && !isJson) {
      throw Error('The bakery API route did not return JSON. Check the deployment routing.');
    }
    const data = text ? JSON.parse(text) : { deleted: true };
    if (!response.ok) throw Error(data.detail || 'Request failed.');
    if (action === 'delete') { state = undefined; id = null; sessionStorage.removeItem('bakery-demo'); }
    else if (action !== 'sales') state = data;
    $('#after').textContent = JSON.stringify(data, null, 2);
    $('#status').textContent = action + ' succeeded' + (id ? ' · ' + id : '');
  } catch (error) {
    $('#status').textContent = error.message;
  } finally { busy = false; controls(); }
}
document.addEventListener('click', event => {
  if (event.target.matches('button') && !busy) run(event.target.dataset.action);
});
controls();
if (id) run('read');
