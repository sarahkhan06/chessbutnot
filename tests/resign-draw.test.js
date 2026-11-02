import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { overTitle } from '../src/render.js';

function pair() {
  const queue = [];
  const w = new Game({ me: 'w', send: (m) => queue.push(['b', m]) });
  const b = new Game({ me: 'b', send: (m) => queue.push(['w', m]) });
  const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'w' ? w : b).receive(m); } };
  const start = () => { w.readyUp('w'); b.readyUp('b'); flush(); };
  return { w, b, flush, start, queue };
}
const hotseat = () => { const g = new Game(); g.readyUp('w'); g.readyUp('b'); return g; };

describe('resign', () => {
  it('hot-seat: the player holding the screen resigns', () => {
    const g = hotseat(); g.move('e2', 'e4'); g.resign();
    expect(g.pub).toMatchObject({ phase: 'over', winner: 'w', reason: 'resigned' }); expect(overTitle(g.pub)).toBe('Black resigned');
  });
  it('online: resign ends the game on both sides even while a challenge is pending', () => {
    const { w, b, flush, start } = pair(); start();
    w.move('e2', 'e4'); flush(); b.move('a7', 'a6'); flush(); w.move('e4', 'e6'); flush(); b.challenge(); // pending on b, verdict not yet flushed
    b.resign(); flush();
    expect(b.pub).toMatchObject({ phase: 'over', winner: 'w', reason: 'resigned', pending: null }); expect(w.pub.phase).toBe('over'); expect(b.outstanding()).toBeNull();
  });
  it('resign is ignored outside play', () => {
    const g = new Game(); g.resign(); expect(g.pub.phase).toBe('setup');
    const { w, b, start } = pair(); start(); expect(b.receive({ t: 'resign' })).toBe(true); expect(b.receive({ t: 'resign' })).toBe(false);
  });
});

describe('draw by agreement', () => {
  it('offer, accept: over with no winner on both sides', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    expect(w.canOfferDraw()).toBe(true); w.offerDraw(); expect(w.canAct()).toBe(false); expect(w.canOfferDraw()).toBe(false); flush();
    expect(b.pub.drawOffer).toBe('w'); b.acceptDraw(); flush();
    for (const g of [w, b]) expect(g.pub).toMatchObject({ phase: 'over', winner: null, reason: 'draw' });
    expect(overTitle(w.pub)).toBe('Draw by agreement');
  });
  it('decline clears the offer and the offerer can act again', () => {
    const { w, b, flush, start } = pair(); start(); w.offerDraw(); flush(); b.declineDraw(); flush();
    expect(w.pub.drawOffer).toBeNull(); expect(w.canAct()).toBe(true); expect(b.pub.version).toBe(w.pub.version);
  });
  it('moving instead of answering clears the offer on both sides', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush(); w.offerDraw(); flush();
    b.move('e7', 'e5'); flush(); expect(w.pub.drawOffer).toBeNull(); expect(b.pub.drawOffer).toBeNull(); expect(w.canAct()).toBe(true);
  });
  it('the offerer cannot move, and an offer that crossed a move on the wire is ignored (stale version)', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    b.offerDraw(); b.move('e7', 'e5'); expect(b.pub.pieces.b12.square).toBe('e7');
    const { w: w2, start: s2 } = pair(); s2();
    expect(w2.receive({ t: 'draw', version: w2.pub.version - 1 })).toBe(false); expect(w2.pub.drawOffer).toBeNull();
    expect(w2.receive({ t: 'draw', version: w2.pub.version })).toBe(true); expect(w2.pub.drawOffer).toBe('b');
  });
  it('drawAccept with a stale version or without an offer is ignored (Review Focus 1)', () => {
    const { w, b, flush, start } = pair(); start();
    expect(w.receive({ t: 'drawAccept', version: w.pub.version })).toBe(false); // no offer
    w.offerDraw(); flush();
    expect(w.receive({ t: 'drawAccept', version: w.pub.version - 1 })).toBe(false); expect(w.pub.phase).toBe('play');
    expect(w.receive({ t: 'drawAccept', version: w.pub.version })).toBe(true); expect(w.pub.phase).toBe('over');
  });
  it('cannot offer while something is pending; hot-seat agrees directly', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush(); b.move('a7', 'a6'); flush(); w.move('e4', 'e6'); flush(); b.challenge();
    expect(b.canOfferDraw()).toBe(false); expect(b.receive({ t: 'draw', version: b.pub.version })).toBe(false);
    const g = hotseat(); g.agreeDraw(); expect(g.pub).toMatchObject({ phase: 'over', winner: null, reason: 'draw' });
  });
});

describe('new game is only accepted outside play', () => {
  it('a stray new mid-game is ignored; new at game over resets', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    expect(b.receive({ t: 'new' })).toBe(false); expect(b.pub.phase).toBe('play');
    w.resign(); flush(); expect(b.receive({ t: 'new' })).toBe(true); expect(b.pub.phase).toBe('setup');
  });
});
