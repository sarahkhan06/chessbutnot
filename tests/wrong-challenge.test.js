import { describe, it, expect } from 'vitest';
import { createState, startPlay, applyMove, resolveLegal, resolveBluff, applyPenalty } from '../src/rules/state.js';
import { Game } from '../src/game.js';

const S = () => startPlay(createState());
function pair() {
  const queue = [];
  const w = new Game({ me: 'w', send: (m) => queue.push(['b', m]) });
  const b = new Game({ me: 'b', send: (m) => queue.push(['w', m]) });
  const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'w' ? w : b).receive(m); } };
  const start = () => { w.readyUp('w'); b.readyUp('b'); flush(); };
  return { w, b, flush, start };
}
const legalKnight = (g) => { g.move('b1', 'c3'); g.move('a7', 'a6'); g.move('c3', 'd5'); };

describe('wrong challenge penalty', () => {
  it('resolveLegal hands a penalty pick to the mover; resolveBluff to the challenger', () => {
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'a7', 'a6'); s = applyMove(s, 'e4', 'e5');
    const legal = resolveLegal(s, 'p');
    expect(legal.pending).toBe('penaltyPick'); expect(legal.picker).toBe('w'); expect(legal.turn).toBe('b');
    const bluff = resolveBluff(s, 'p');
    expect(bluff.pending).toBe('penaltyPick'); expect(bluff.picker).toBe('b');
    const done = applyPenalty(legal, 'b0', 'r');
    expect(done.pending).toBeNull(); expect(done.picker).toBeNull(); expect(done.turn).toBe('b');
  });
  it('hot-seat: a wrong challenge lets the mover remove one of the challenger\'s pieces, then the challenger moves', () => {
    const g = new Game(); g.readyUp('w'); g.readyUp('b'); legalKnight(g);
    g.challenge();
    expect(g.pub.pieces.w1.faceUp).toBe('n'); expect(g.pub.pending).toBe('penaltyPick'); expect(g.viewer()).toBe('w');
    g.move('e7', 'e5'); expect(g.pub.pieces.b12.square).toBe('e7'); // nobody moves during the pick
    g.pickPenalty('w0'); expect(g.pub.pending).toBe('penaltyPick');  // cannot pick own piece
    g.pickPenalty('b0');
    expect(g.pub.lost.b).toContainEqual({ id: 'b0', type: 'r', by: null }); expect(g.pub.pending).toBeNull(); expect(g.viewer()).toBe('b');
    g.move('e7', 'e5'); expect(g.pub.turn).toBe('w');
  });
  it('hot-seat: picking the challenger\'s king after a wrong challenge wins', () => {
    const g = new Game(); g.readyUp('w'); g.readyUp('b'); legalKnight(g); g.challenge();
    g.pickPenalty('b4');
    expect(g.pub.phase).toBe('over'); expect(g.pub.winner).toBe('w'); expect(g.pub.reason).toBe('king-penalty');
  });
  it('online: the mover picks, the challenger reveals and removes, both agree', () => {
    const { w, b, flush, start } = pair(); start();
    w.move('b1', 'c3'); flush(); b.move('a7', 'a6'); flush(); w.move('c3', 'd5'); flush();
    b.challenge(); flush();
    expect(w.pub.pending).toBe('penaltyPick'); expect(w.pub.picker).toBe('w'); expect(b.pub.pending).toBe('penaltyPick'); expect(b.pub.picker).toBe('w');
    expect(b.receive({ t: 'penalty', id: 'w0' })).toBe(false); // challenger may not pick
    b.pickPenalty('w0'); expect(b.pub.pending).toBe('penaltyPick');
    w.pickPenalty('b0'); expect(w.pub.pending).toBe('awaitRemoved'); flush();
    expect(w.pub.lost.b).toContainEqual({ id: 'b0', type: 'r', by: null }); expect(b.pub.pieces.b0.square).toBeNull();
    expect(w.pub.pending).toBeNull(); expect(b.pub.pending).toBeNull(); expect(b.pub.turn).toBe('b');
    b.move('e7', 'e5'); flush(); expect(w.pub.turn).toBe('w');
  });
  it('a legal challenge of a king capture still ends the game with no pick', () => {
    const g = new Game(); g.swap('b', 'e8', 'd7'); g.readyUp('w'); g.readyUp('b');
    for (const [f, t] of [['e2','e4'],['a7','a6'],['e4','e5'],['a6','a5'],['e5','e6'],['a5','a4'],['e6','d7']]) g.move(f, t);
    g.challenge();
    expect(g.pub.phase).toBe('over'); expect(g.pub.pending).toBeNull();
  });
});
