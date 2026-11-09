export const ingredients = [
  { id: 'flour', name: 'Flour', price: 4, color: '#e2bf94' },
  { id: 'milk', name: 'Milk', price: 5, color: '#a8c9ca' },
  { id: 'berry', name: 'Berries', price: 6, color: '#e58b9c' },
  { id: 'sugar', name: 'Sugar', price: 4, color: '#cab6dd' },
];
export const products = [
  { id: 'shortcake', name: 'Berry Shortcake', price: 16, level: 1, recipe: { flour: 2, milk: 1, berry: 2 } },
  { id: 'cookie', name: 'Butter Cookie', price: 12, level: 1, recipe: { flour: 2, milk: 1, sugar: 1 } },
  { id: 'mochi', name: 'Garden Mochi', price: 22, level: 2, recipe: { flour: 1, berry: 2, sugar: 2 } },
  { id: 'cupcake', name: 'Cloud Cupcake', price: 26, level: 3, recipe: { flour: 2, milk: 2, sugar: 2 } },
];
export const customers = [
  { id: 'miso', name: 'Miso', species: 'cat', line: 'Could I have something berry sweet?' },
  { id: 'pip', name: 'Pip', species: 'frog', line: 'Ribbit! One treat, please.' },
  { id: 'maple', name: 'Maple', species: 'bear', line: 'I brought my biggest appetite.' },
  { id: 'taro', name: 'Taro', species: 'creamcat', line: 'Your bakery smells like a hug.' },
  { id: 'clover', name: 'Clover', species: 'bunny', line: 'A little treat for the walk home.' },
];
export const upgrades = {
  oven: { name: 'Copper oven', cost: 40, description: 'A wider sweet spot when you bake.' },
  decor: { name: 'Berry bunting', cost: 28, description: 'Dress up the shop and earn 2 extra coins per order.' },
};
export const shiftSize = 5;
export const levelOf = (xp) => 1 + Math.floor(xp / 3);
export const newGame = () => ({
  day: 1, slot: 0, served: 0, coins: 24, xp: 0, oven: false, decor: false,
  stock: { flour: 20, milk: 14, berry: 12, sugar: 12 }, history: [],
});
export function ticket(state, offset = 0) {
  const position = state.slot + offset;
  if (position >= shiftSize) return null;
  const index = (state.day - 1) * shiftSize + position;
  const menu = products.filter(product => product.level <= levelOf(state.xp - state.served));
  return { customer: customers[(position + state.day - 1) % customers.length], product: menu[index % menu.length] };
}
export const canBake = (state, product) => Object.entries(product.recipe)
  .every(([id, amount]) => state.stock[id] >= amount);

export function updateLocal(state, command) {
  const next = { ...state, stock: { ...state.stock }, history: [...state.history] };
  const current = ticket(state);
  switch (command.action) {
    case 'serve': {
      if (!current || !canBake(state, current.product)) throw Error('The order or pantry has changed.');
      const { customer, product } = current;
      const total = product.price + (command.perfect ? 4 : 0) + (state.decor ? 2 : 0);
      for (const [id, amount] of Object.entries(product.recipe)) next.stock[id] -= amount;
      next.history.unshift({ day: state.day, slot: state.slot, customer: customer.name, product: product.name, total });
      next.coins += total;
      next.served++;
      next.xp++;
      next.slot++;
      break;
    }
    case 'skip':
      if (!current) throw Error('The shift is already over.');
      next.slot++;
      break;
    case 'next':
      if (current) throw Error('Finish this shift first.');
      next.day++;
      next.slot = 0;
      next.served = 0;
      break;
    case 'restock': {
      const item = ingredients.find(ingredient => ingredient.id === command.item);
      if (!item || next.coins < item.price) throw Error('You need more coins.');
      next.coins -= item.price;
      next.stock[item.id] += 6;
      break;
    }
    case 'upgrade': {
      const item = upgrades[command.item];
      if (!item || next[command.item] || next.coins < item.cost) throw Error('This upgrade is unavailable.');
      next.coins -= item.cost;
      next[command.item] = true;
      break;
    }
    default: throw Error('Unknown bakery action.');
  }
  return next;
}
