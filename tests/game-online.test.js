import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';

function pair() {
  const queue = [];
  const w = new Game({ me: 'w', send: (m) => queue.push(['b', m]) });
  const b = new Game({ me: 'b', send: (m) => queue.push(['w', m]) });
  const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'w' ? w : b).receive(m); } };
  const start = () => { w.readyUp('w'); b.readyUp('b'); flush(); };
  return { w, b, flush, start, queue };
}
// White's e-pawn bluffs on its second move (e4 -> e6, a rook slide).
const bluffE6 = (w, b, flush) => { w.move('e2', 'e4'); flush(); b.move('a7', 'a6'); flush(); w.move('e4', 'e6'); flush(); };
const tap = (game, wire) => { const orig = game.send; game.send = (m) => { wire.push(m); orig(m); }; };

describe('Game online', () => {
  it('only the owner holds identities', () => { const { w, b } = pair(); expect(w.priv.b).toBeNull(); expect(b.priv.w).toBeNull(); expect(w.priv.w.w4).toBe('k'); });

  it('ready messages start play on both sides without sending arrangements', () => {
    const { w, b, start } = pair(); const wire = []; tap(w, wire); tap(b, wire);
    start();
    expect(w.pub.phase).toBe('play'); expect(b.pub.phase).toBe('play'); expect(JSON.stringify(wire)).not.toMatch(/type/);
  });

  it('a move is mirrored; a capture stays pending until defender moves; then captured reveals on both', () => {
    const { w, b, flush, start } = pair(); start();
    w.move('e2', 'e4'); flush(); expect(b.pub.pieces.w12.square).toBe('e4');
    b.move('d7', 'd5'); flush(); w.move('e4', 'd5'); flush();
    expect(b.pub.lost.b).toEqual([{ id: 'b11', type: null, by: 'w12' }]); expect(w.pub.lost.b).toEqual([{ id: 'b11', type: null, by: 'w12' }]);
    b.move('g8', 'f6'); flush();
    expect(w.pub.lost.b[0].type).toBe('p'); expect(b.pub.lost.b[0].type).toBe('p'); expect(w.pub.lastMove.from).toBe('g8'); expect(w.pub.version).toBe(b.pub.version);
  });

  it('pawn transformation applies on the owner after captured arrives', () => {
    const { w, b, flush, start } = pair(); start();
    w.move('e2', 'e4'); flush(); b.move('g8', 'f6'); flush(); w.move('e4', 'e5'); flush(); b.move('h7', 'h6'); flush(); w.move('e5', 'f6'); flush();
    expect(w.priv.w.w12).toBe('p'); b.move('h6', 'h5'); flush(); expect(w.priv.w.w12).toBe('n');
  });

  it('bluff challenge over the wire: verdict, penalty, removed; identities only in those messages', () => {
    const { w, b, flush, start } = pair(); const wire = []; tap(w, wire); tap(b, wire); start();
    bluffE6(w, b, flush); b.challenge(); expect(b.pub.pending).toBe('awaitVerdict'); flush();
    expect(b.pub.lost.w).toEqual([{ id: 'w12', type: 'p', by: null }]); expect(b.pub.pending).toBe('penaltyPick'); expect(w.pub.pending).toBe('penaltyPick');
    b.pickPenalty('w0'); expect(b.pub.pending).toBe('awaitRemoved'); flush();
    expect(b.pub.lost.w).toContainEqual({ id: 'w0', type: 'r', by: null }); expect(w.pub.pieces.w0.square).toBeNull(); expect(b.pub.pending).toBeNull(); expect(w.pub.pending).toBeNull();
    const withType = wire.filter((m) => 'type' in m).map((m) => m.t); expect(new Set(withType)).toEqual(new Set(['verdict', 'removed']));
    b.move('e7', 'e5'); flush(); expect(w.pub.turn).toBe('w');
  });

  it('a wrong (legal) challenge keeps the piece hidden on both sides and the verdict carries no identity', () => {
    const { w, b, flush, start } = pair(); const wire = []; tap(w, wire); tap(b, wire); start();
    w.move('b1', 'c3'); flush(); b.move('a7', 'a6'); flush(); w.move('c3', 'd5'); flush(); b.challenge(); flush();
    expect(b.pub.pieces.w1.faceUp).toBeNull(); expect(w.pub.pieces.w1.faceUp).toBeNull();
    const verdict = wire.find((m) => m.t === 'verdict'); expect(verdict).toEqual({ t: 'verdict', legal: true });
    expect(b.receive({ t: 'verdict', legal: true, type: 'n' })).toBe(false); // nothing pending any more
    expect(b.pub.pending).toBe('penaltyPick'); expect(b.pub.picker).toBe('w'); // wrong challenge: the mover picks a penalty
  });

  it('legal challenge of a king capture ends the game on both sides', () => {
    const { w, b, flush, start } = pair(); b.swap('b', 'e8', 'd7'); start();
    for (const [f, t] of [['e2','e4'],['a7','a6'],['e4','e5'],['a6','a5'],['e5','e6'],['a5','a4'],['e6','d7']]) { (w.pub.turn === 'w' ? w : b).move(f, t); flush(); }
    expect(w.pub.phase).toBe('play');
    b.challenge(); flush();
    expect(w.pub.phase).toBe('over'); expect(b.pub.phase).toBe('over'); expect(w.pub.winner).toBe('w'); expect(w.pub.lost.b[0]).toEqual({ id: 'b11', type: 'k', by: 'w12' });
  });

  it('bluff onto the king is reverted over the wire; penalty on the king wins for the challenger', () => {
    const { w, b, flush, start } = pair(); b.swap('b', 'e8', 'd7'); w.swap('w', 'e1', 'a1'); start();
    w.move('d2', 'd4'); flush(); b.move('a7', 'a6'); flush(); w.move('d4', 'd7'); flush(); b.challenge(); flush();
    expect(w.pub.pieces.b11.square).toBe('d7'); expect(b.pub.lost.b).toEqual([]);
    b.pickPenalty('w0'); flush();
    expect(w.pub.phase).toBe('over'); expect(b.pub.phase).toBe('over'); expect(b.pub.winner).toBe('b'); expect(b.pub.reason).toBe('king-penalty');
  });

  it('duplicate and out-of-turn messages are ignored (Review Focus 2)', () => {
    const { w, b, flush, start } = pair(); start();
    w.move('e2', 'e4'); flush(); const v = b.pub.version;
    expect(b.receive({ t: 'move', from: 'e2', to: 'e4' })).toBe(false);
    expect(b.receive({ t: 'move', from: 'd2', to: 'd4' })).toBe(false);
    expect(b.receive({ t: 'move', from: 'e7', to: 'e5' })).toBe(false);
    expect(b.receive({ t: 'captured', id: 'b11', type: 'q' })).toBe(false);
    expect(b.receive({ t: 'verdict', legal: true, type: 'q' })).toBe(false);
    expect(b.receive({ t: 'penalty', id: 'b4' })).toBe(false);
    expect(b.receive({ t: 'removed', id: 'w0', type: 'r' })).toBe(false);
    expect(b.pub.version).toBe(v); expect(w.pub.version).toBe(v);
  });

  it('a move onto an unreachable square from the opponent is rejected', () => {
    const { w, b, start } = pair(); start();
    expect(b.receive({ t: 'move', from: 'e2', to: 'f5' })).toBe(false);
    expect(b.receive({ t: 'move', from: 'e2', to: 'e5' })).toBe(true);
  });

  it('outstanding() names the unanswered request (Review Focus 5)', () => {
    const { w, b, flush, start } = pair(); start();
    expect(b.outstanding()).toBeNull();
    bluffE6(w, b, flush); b.challenge(); expect(b.outstanding()).toEqual({ t: 'challenge' }); flush();
    b.pickPenalty('w0'); expect(b.outstanding()).toEqual({ t: 'penalty', id: 'w0' }); flush(); expect(b.outstanding()).toBeNull();
  });

  it('re-sent challenge after a verdict is ignored', () => {
    const { w, b, flush, start } = pair(); start();
    bluffE6(w, b, flush); b.challenge(); flush();
    expect(w.pub.pending).toBe('penaltyPick');
    expect(w.receive({ t: 'challenge' })).toBe(false);
  });

  it('snapshot/restore round-trips and syncFrom adopts newer public state only', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    const r = Game.restore(JSON.parse(JSON.stringify(b.snapshot())), {});
    expect(r.me).toBe('b'); expect(r.pub).toEqual(b.pub); expect(r.priv.b).toEqual(b.priv.b); expect(r.priv.w).toBeNull();
    const stale = structuredClone(r.pub); b.move('e7', 'e5');
    r.syncFrom(stale); expect(r.pub.lastMove.from).toBe('e2');
    r.syncFrom(b.pub); expect(r.pub.lastMove.from).toBe('e7'); expect(r.pub.version).toBe(b.pub.version);
  });

  it('new message resets the other side to setup', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush(); w.newGame(); flush();
    expect(b.pub.phase).toBe('setup'); expect(b.pub.pieces.w12.square).toBe('e2'); expect(b.priv.b.b4).toBe('k');
  });

  it('syncFrom applies a pawn transformation whose captured message was lost', () => {
    const { w, b, flush, start, queue } = pair(); start();
    w.move('e2', 'e4'); flush(); b.move('g8', 'f6'); flush(); w.move('e4', 'e5'); flush(); b.move('h7', 'h6'); flush(); w.move('e5', 'f6'); flush();
    b.move('h6', 'h5');                     // b sends captured + move
    queue.length = 0;                        // both lost on the wire
    expect(w.priv.w.w12).toBe('p');
    expect(w.syncFrom(b.pub)).toBe(true);
    expect(w.priv.w.w12).toBe('n'); expect(w.pub.lost.b[0]).toMatchObject({ id: 'b6', type: 'n', by: 'w12' });
  });

  describe('reconnect handshake', () => {
    it('a lost verdict leaves the mover strictly newer so hello triggers a sync', () => {
      const { w, b, flush, start, queue } = pair(); start();
      bluffE6(w, b, flush); b.challenge(); flush();   // w resolves the bluff
      expect(w.pub.pending).toBe('penaltyPick');
      // Simulate: b never received the verdict.
      const bStale = Game.restore(JSON.parse(JSON.stringify(b.snapshot())), {});
      bStale.pub.pending = 'awaitVerdict'; bStale.pub.lost.w = []; bStale.pub.pieces.w12.square = 'e6'; bStale.pub.lastMove.challengeable = true;
      bStale.pub.version = w.pub.version - 1; // what b would have had without the verdict's bumps
      expect(w.onHello(bStale.helloMessage())).toMatchObject({ t: 'sync' });
      expect(bStale.onHello(w.helloMessage())).toBeNull();
      bStale.syncFrom(w.pub); expect(bStale.pub.pending).toBe('penaltyPick'); expect(bStale.outstanding()).toBeNull();
    });
    it('setting a pending request does not bump the version', () => {
      const { w, b, flush, start } = pair(); start();
      bluffE6(w, b, flush); const v = b.pub.version; b.challenge();
      expect(b.pub.pending).toBe('awaitVerdict'); expect(b.pub.version).toBe(v);
    });
    it('a lost ready is recovered from the hello message', () => {
      const { w, b } = pair(); w.readyUp('w'); b.readyUp('b'); // both sends dropped (no flush)
      expect(w.pub.phase).toBe('setup');
      expect(w.helloMessage()).toMatchObject({ t: 'hello', ready: true });
      w.onHello(b.helloMessage()); b.onHello(w.helloMessage());
      expect(w.pub.phase).toBe('play'); expect(b.pub.phase).toBe('play');
    });
    it('hello with an older version returns no sync; newer side offers one', () => {
      const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4');
      expect(b.onHello(w.helloMessage())).toBeNull();
      expect(w.onHello(b.helloMessage())).toEqual({ t: 'sync', pub: w.pub });
      flush();
    });
  });
});
