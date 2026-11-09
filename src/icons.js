const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10m3-8h-4a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3H9"/>',
  sound: '<path d="m11 5-5 4H3v6h3l5 4zM15 9c2 1 2 5 0 6m3-9c4 3 4 9 0 12"/>',
  mute: '<path d="m11 5-5 4H3v6h3l5 4zM16 10l5 5m0-5-5 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3h.01"/>',
  book: '<path d="M12 5v15m0-14c-3-2-6-2-9-1v13c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z"/>',
  ticket: '<path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4zM14 7v2m0 2v2m0 2v2"/>',
  basket: '<path d="M4 10h16l-2 9H6zm3 0 3-5m7 5-3-5m-4 8v3m4-3v3"/>',
  shop: '<path d="M5 11v8h14v-8M3 10l2-5h14l2 5c-1 3-4 3-6 1-2 2-4 2-6 0-2 2-5 2-6-1Zm7 9v-4h4v4"/>',
  lock: '<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M9 10V7a3 3 0 0 1 6 0v3m-3 4v2"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12m0-12L6 18"/>',
  heart: '<path d="M12 20 4 12a4 4 0 0 1 6-6l2 2 2-2a4 4 0 0 1 6 6z"/>',
  flame: '<path d="M12 21a7 7 0 0 0 7-7c0-3-2-5-3-6 0 3-2 4-3 3 1-4-1-7-3-8 0 5-5 8-5 12a7 7 0 0 0 7 6Z"/>',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
