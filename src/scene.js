import Phaser from 'phaser';
import { bakery, counter, animal, animals, pastry } from './art.js';

export class ShopScene extends Phaser.Scene {
  constructor() { super('shop'); }

  create() {
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.textures.addCanvas('room', bakery());
    this.textures.addCanvas('counter', counter());
    for (const species of Object.keys(animals)) {
      this.textures.addCanvas(species, animal(species));
      this.textures.addCanvas(species + '-blink', animal(species, true));
    }
    this.textures.addCanvas('baker', animal('bunny', false, true));
    this.textures.addCanvas('baker-blink', animal('bunny', true, true));
    for (const id of ['shortcake', 'cookie', 'mochi', 'cupcake']) this.textures.addCanvas(id, pastry(id));
    this.add.image(0, 0, 'room').setOrigin(0);
    this.bunting = this.add.graphics();
    this.copper = this.add.graphics().setVisible(false);
    this.copper.fillStyle(0xb77e51).fillRect(30, 147, 75, 9).fillRect(30, 156, 7, 37)
      .fillRect(98, 156, 7, 37).fillRect(37, 186, 61, 8);
    this.copper.fillStyle(0xf3bf79).fillRect(33, 147, 69, 2).fillRect(56, 154, 22, 3);
    this.steam = this.add.graphics();
    this.baker = this.add.image(238, 156, 'baker').setScale(1.35).setOrigin(0.5, 1);
    this.add.image(240, 176, 'counter');
    this.guests = [233, 315, 388].map((x, i) =>
      this.add.image(x, 241 - i * 7, 'cat').setOrigin(0.5, 1).setScale(1.28 - i * 0.12).setVisible(false));
    this.thought = this.add.container(230, 151).setVisible(false);
    const paper = this.add.graphics();
    paper.fillStyle(0x82565b).fillRoundedRect(-17, -16, 34, 28, 5).fillTriangle(-4, 10, 5, 10, 0, 17);
    paper.fillStyle(0xffeed4).fillRoundedRect(-16, -15, 32, 26, 4).fillTriangle(-4, 10, 4, 10, 0, 15);
    this.treat = this.add.image(0, -4, 'shortcake').setScale(0.9);
    this.thought.add([paper, this.treat]);
    this.fx = this.add.graphics();
    for (const [x, y, width, height, action, label] of [
      [233, 216, 63, 57, 'serve', 'Serve guest'],
      [67, 169, 82, 56, 'bake', 'Bake'],
      [237, 173, 95, 43, 'bake', 'Mix'],
      [368, 83, 123, 76, 'pantry', 'Pantry'],
      [348, 156, 32, 30, 'ledger', 'Sales'],
    ]) {
      const hint = this.add.text(x, y - height / 2 - 12, label, {
        fontFamily: 'Nunito', fontSize: '10px', color: '#fff3d9',
        backgroundColor: '#673f49', padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setVisible(false);
      this.add.zone(x, y, width, height).setInteractive({ useHandCursor: true })
        .on('pointerover', () => hint.setVisible(true))
        .on('pointerout', () => hint.setVisible(false))
        .on('pointerdown', () => window.dispatchEvent(new CustomEvent('bakery-station', { detail: action })));
    }
    if (!this.reduced) {
      this.tweens.add({ targets: this.baker, y: 154, duration: 950, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.time.addEvent({ delay: 2300, loop: true, callback: () => {
        const target = [this.baker, ...this.guests.filter(guest => guest.visible)][Math.floor(Math.random() * (1 + this.guests.filter(guest => guest.visible).length))];
        const key = target.texture.key;
        target.setTexture(key + '-blink');
        this.time.delayedCall(125, () => {
          if (target.texture.key === key + '-blink') target.setTexture(key);
        });
      } });
    }
    window.dispatchEvent(new Event('bakery-ready'));
  }

  walkTo(x) {
    this.tweens.killTweensOf(this.baker);
    this.tweens.add({
      targets: this.baker, x, duration: this.reduced ? 0 : Math.abs(this.baker.x - x) * 4,
      ease: 'Sine.inOut',
    });
  }

  update(time) {
    if (this.reduced) return;
    this.steam.clear();
    for (let index = 0; index < 3; index++) {
      const rise = (time / 1300 + index / 3) % 1;
      const x = 72 + Math.round(Math.sin(rise * 6 + index) * 5) + index * 3;
      const y = 143 - Math.floor(rise * 15);
      this.steam.fillStyle(0xffebcf, (1 - rise) * 0.75)
        .fillRect(x, y, 4, 2).fillRect(x + 2, y - 2, 3, 2);
    }
  }

  show(tickets, decorated, copper) {
    this.copper.setVisible(copper);
    this.bunting.clear();
    if (decorated) {
      this.bunting.lineStyle(1, 0x9b6264).beginPath().moveTo(150, 31).lineTo(239, 47).lineTo(309, 31).strokePath();
      for (let i = 0; i < 9; i++) {
        const x = 154 + 17 * i;
        const y = 32 + (8 - Math.abs(i - 5) * 1.7) * 2;
        this.bunting.fillStyle([0xd57583, 0xfce1b3, 0x9ab388][i % 3]).fillTriangle(x, y, x + 13, y, x + 6, y + 12);
      }
    }
    this.guests.forEach((guest, index) => {
      const current = tickets[index];
      this.tweens.killTweensOf(guest);
      guest.setVisible(Boolean(current));
      if (!current) return;
      const changed = guest.texture.key.replace('-blink', '') !== current.customer.species;
      guest.setTexture(current.customer.species).setX([233,315,388][index]);
      if (changed && !this.reduced) {
        guest.x += 27;
        this.tweens.add({ targets: guest, x: guest.x - 27, duration: 430, ease: 'Sine.out' });
      }
    });
    this.thought.setVisible(Boolean(tickets[0]));
    if (tickets[0]) this.treat.setTexture(tickets[0].product.id);
  }

  celebrate() {
    if (this.reduced) return;
    const stars = Array.from({ length: 15 }, (_, index) => ({
      x: 232 + (index % 5 - 2) * 12, y: 155 + Math.floor(index / 5) * 9,
    }));
    this.tweens.addCounter({
      from: 0, to: 1, duration: 850,
      onUpdate: tween => {
        const t = tween.getValue();
        this.fx.clear();
        stars.forEach(({ x, y }, i) => {
          const sx = Math.round(x + (i % 5 - 2) * t * 17);
          const sy = Math.round(y - t * (40 + i % 3 * 14));
          this.fx.fillStyle(i % 2 ? 0xffd47e : 0xfff0cb, 1 - t);
          this.fx.fillRect(sx - 1, sy - 3, 2, 6).fillRect(sx - 3, sy - 1, 6, 2);
        });
      },
      onComplete: () => this.fx.clear(),
    });
  }
}

export function startScene() {
  const scene = new ShopScene();
  new Phaser.Game({
    type: Phaser.CANVAS, parent: 'stage', width: 480, height: 272,
    pixelArt: true, backgroundColor: '#f3c9a8', scene,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    banner: false, audio: { noAudio: true },
  });
  return scene;
}
