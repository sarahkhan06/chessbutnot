import { describe, it, expect } from 'vitest';
import { Game, colorFor } from '../src/game.js';

function pair() {
  const queue = [];
  const h = new Game({ seat: 'host', send: (m) => queue.push(['g', m]) });
  const g = new Game({ seat: 'guest', send: (m) => queue.push(['h', m]) });
  const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'h' ? h : g).receive(m); } };
  const start = () => { h.readyUp(h.me); g.readyUp(g.me); flush(); };
  return { h, g, flush, start, queue };
}

describe('seats and colour swap', () => {
  it('colorFor alternates with the generation', () => {
    expect(colorFor('host', 0)).toBe('w'); expect(colorFor('host', 1)).toBe('b'); expect(colorFor('guest', 0)).toBe('b'); expect(colorFor('guest', 3)).toBe('w');
  });
  it('a Game built from a seat starts with the right colour; me-only keeps working', () => {
    const { h, g } = pair(); expect(h.me).toBe('w'); expect(g.me).toBe('b'); expect(h.seat).toBe('host');
    const w = new Game({ me: 'w' }); expect(w.seat).toBe('host'); expect(new Game({ me: 'b' }).seat).toBe('guest'); expect(new Game().seat).toBeNull();
  });
  it('play again swaps colours and identities on both sides', () => {
    const { h, g, flush, start } = pair(); start(); h.move('e2', 'e4'); flush(); h.resign(); flush();
    h.newGame(); flush();
    expect(h.pub.gen).toBe(1); expect(h.me).toBe('b'); expect(g.me).toBe('w');
    expect(h.priv.b.b4).toBe('k'); expect(h.priv.w).toBeNull(); expect(g.priv.w.w4).toBe('k');
    g.readyUp('w'); h.readyUp('b'); flush(); expect(h.pub.phase).toBe('play');
    g.move('e2', 'e4'); flush(); expect(h.pub.pieces.w12.square).toBe('e4');
  });
  it('a sync onto a newer generation recomputes the colour', () => {
    const { h, g, flush, start, queue } = pair(); start(); h.resign(); flush(); g.newGame(); queue.length = 0;
    h.syncFrom(g.pub); expect(h.pub.gen).toBe(1); expect(h.me).toBe('b');
  });
  it('snapshots carry the seat; legacy snapshots derive it from colour and generation', () => {
    const { h } = pair(); const snap = JSON.parse(JSON.stringify(h.snapshot())); expect(snap.seat).toBe('host');
    expect(Game.restore(snap, {}).seat).toBe('host');
    delete snap.seat; expect(Game.restore(snap, {}).seat).toBe('host');
    snap.pub.gen = 1; snap.me = 'b'; expect(Game.restore(snap, {}).seat).toBe('host');
    snap.pub.gen = 1; snap.me = 'w'; expect(Game.restore(snap, {}).seat).toBe('guest');
  });
});
