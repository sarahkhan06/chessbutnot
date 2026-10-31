import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { standardIdentity } from '../src/rules/identity.js';

function pair() {
  const queue = [];
  const w = new Game({ me: 'w', send: (m) => queue.push(['b', m]) });
  const b = new Game({ me: 'b', send: (m) => queue.push(['w', m]) });
  const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'w' ? w : b).receive(m); } };
  const start = () => { w.readyUp('w'); b.readyUp('b'); flush(); };
  return { w, b, flush, start };
}
const WALK = [['e2','e4'],['a7','a6'],['e4','e5'],['a6','a5'],['e5','e6'],['a5','a4'],['e6','d7']];

describe('end-of-game reveal of the starting arrangements', () => {
  it('hot-seat: both arrangements survive promotion/transform changes to the live identities', () => {
    const g = new Game(); g.swap('w', 'a1', 'b1'); g.readyUp('w'); g.swap('b', 'e8', 'd7'); g.readyUp('b');
    expect(g.startingSetup().w.w0).toBe('n'); expect(g.startingSetup().b.b11).toBe('k');
    for (const [f, t] of WALK) g.move(f, t);
    g.move('a4', 'a3'); // black accepts the capture of its king
    expect(g.pub.phase).toBe('over');
    expect(g.priv.w.w12).toBe('k'); // the capturing pawn became a king during play...
    const s = g.startingSetup();
    expect(s.w.w12).toBe('p'); expect(s.w.w0).toBe('n'); expect(s.w.w1).toBe('r'); // ...but the reveal shows the original arrangement
    expect(s.b.b4).toBe('p'); expect(s.b.b11).toBe('k');
  });

  it('online: when the game ends each side sends its arrangement and sees the other\'s', () => {
    const { w, b, flush, start } = pair();
    w.swap('w', 'a1', 'b1'); b.swap('b', 'e8', 'd7'); start();
    expect(w.startingSetup().b).toBeNull(); // hidden during play
    for (const [i, [f, t]] of WALK.entries()) { (i % 2 === 0 ? w : b).move(f, t); flush(); }
    expect(w.pub.phase).toBe('play'); expect(w.startingSetup().b).toBeNull();
    b.move('a4', 'a3'); flush();
    expect(w.pub.phase).toBe('over'); expect(b.pub.phase).toBe('over');
    for (const g of [w, b]) {
      const s = g.startingSetup();
      expect(s.w).toEqual({ ...standardIdentity('w'), w0: 'n', w1: 'r' });
      expect(s.b).toEqual({ ...standardIdentity('b'), b4: 'p', b11: 'k' });
    }
  });

  it('a reconnect re-sends the arrangement, and bad or foreign-generation setups are ignored', () => {
    const { w, b, flush, start } = pair(); start();
    expect(b.receive({ t: 'setup', gen: w.pub.gen, ids: standardIdentity('w') })).toBe(true); // well-formed
    expect(b.receive({ t: 'setup', gen: w.pub.gen, ids: standardIdentity('b') })).toBe(false);  // wrong colour's ids
    expect(b.receive({ t: 'setup', gen: w.pub.gen + 1, ids: standardIdentity('w') })).toBe(false);
    expect(b.receive({ t: 'setup', gen: w.pub.gen, ids: { ...standardIdentity('w'), w0: 'q' } })).toBe(false); // two queens
    expect(b.receive({ t: 'setup', gen: w.pub.gen, ids: null })).toBe(false);
  });

  it('survives snapshot/restore and is cleared by a new game', () => {
    const { w, start } = pair(); w.swap('w', 'a1', 'b1'); start();
    const snap = JSON.parse(JSON.stringify(w.snapshot()));
    const r = Game.restore(snap, {});
    expect(r.initial.w.w0).toBe('n');
    w.newGame(); expect(w.initial.w.w0).toBe('r'); expect(w.setups).toEqual({ w: null, b: null });
  });
});

describe('older versions cannot leak identities through sync or saved games', () => {
  const dirty = (g) => {
    const pub = structuredClone(g.pub); pub.version += 5; pub.pieces.w1.faceUp = 'n';
    pub.history = [...pub.history, { kind: 'legal', type: 'n', from: 'b1', to: 'c3', board: {}, faceUp: { w1: 'n' } }];
    return pub;
  };
  it('a sync carrying face-up marks is applied without them', () => {
    const { b, start } = pair(); start();
    expect(b.syncFrom(dirty(b))).toBe(true);
    expect(b.pub.pieces.w1.faceUp).toBeNull();
    const last = b.pub.history.at(-1); expect(last.kind).toBe('legal'); expect('type' in last).toBe(false); expect(last.faceUp).toEqual({});
  });
  it('a saved game from an older version is restored without them', () => {
    const { w, start } = pair(); start();
    const snap = JSON.parse(JSON.stringify(w.snapshot())); snap.pub.pieces.b1.faceUp = 'n';
    expect(Game.restore(snap, {}).pub.pieces.b1.faceUp).toBeNull();
  });
});
