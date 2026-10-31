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
const hotseat = (setup = () => {}) => { const g = new Game(); setup(g); g.readyUp('w'); g.readyUp('b'); return g; };

describe('promotion vs challenge (review fix 1)', () => {
  it('a pawn sliding onto the far rank is judged as a pawn, not as the queen it would become', () => {
    const g = hotseat();
    g.move('a2', 'a4'); g.move('b7', 'b5'); g.move('a4', 'b5'); g.move('h7', 'h6'); g.move('h2', 'h3'); // accept capture
    expect(g.priv.w.w8).toBe('p');
    g.move('h6', 'h5');
    expect(g.destinations('b5').find((d) => d.to === 'b8').legal).toBe(false);
    g.move('b5', 'b8');                      // pawn slides like a rook onto the knight
    g.challenge();
    expect(g.pub.lost.w).toContainEqual({ id: 'w8', type: 'p', by: null });
    expect(g.pub.pieces.b1.square).toBe('b8'); expect(g.pub.pending).toBe('penaltyPick');
  });
  it('a legal promotion that is challenged is judged as a queen but stays hidden', () => {
    const g = hotseat();
    for (const [f, t] of [['h2','h4'],['a7','a5'],['h4','h5'],['a5','a4'],['h5','h6'],['a4','a3'],['h6','g7'],['b7','b6'],['g7','h8']]) g.move(f, t);
    g.challenge();
    expect(g.pub.pieces.w15.faceUp).toBeNull(); expect(g.pub.pending).toBe('penaltyPick'); expect(g.pub.picker).toBe('w'); expect(g.priv.w.w15).toBe('q');
  });
  it('the pre-move type survives snapshot/restore for the pending challenge', () => {
    const { w, b, flush, start } = pair(); start();
    w.move('a2', 'a4'); flush(); b.move('b7', 'b5'); flush(); w.move('a4', 'b5'); flush(); b.move('h7', 'h6'); flush(); w.move('h2', 'h3'); flush(); b.move('h6', 'h5'); flush();
    w.move('b5', 'b8'); flush();
    const w2 = Game.restore(JSON.parse(JSON.stringify(w.snapshot())), { send: (m) => b.receive(m) });
    b.send = (m) => w2.receive(m);
    b.challenge();
    expect(b.pub.lost.w).toContainEqual({ id: 'w8', type: 'p', by: null }); expect(w2.pub.pending).toBe('penaltyPick');
  });
});

describe('game generation (review fix 2)', () => {
  it('new game bumps gen on both sides and gens stay aligned', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    expect(w.pub.gen).toBe(0); w.newGame(); flush();
    expect(w.pub.gen).toBe(1); expect(b.pub.gen).toBe(1); expect(b.pub.phase).toBe('setup');
  });
  it('a New game pressed while disconnected wins on reconnect and resets the other side including its identities', () => {
    const { w, b, flush, start, queue } = pair(); b.swap('b', 'e8', 'a8'); start(); w.move('e2', 'e4'); flush();
    expect(b.priv.b.b0).toBe('k');
    b.newGame(); queue.length = 0;              // 'new' lost on the wire
    expect(b.priv.b.b0).toBe('r');
    const hw = w.helloMessage(), hb = b.helloMessage();
    expect(w.onHello(hb)).toBeNull();           // w is gen 0, b is gen 1: b is newer
    const sync = b.onHello(hw); expect(sync).toMatchObject({ t: 'sync' });
    expect(w.pub.phase).toBe('play');
    w.syncFrom(sync.pub);
    expect(w.pub.gen).toBe(1); expect(w.pub.phase).toBe('setup'); expect(w.priv.w.w4).toBe('k'); expect(w.lastMoverType).toBeNull();
    expect(w.pub.pieces.w12.square).toBe('e2'); expect(w.pub.stage).toEqual({ w: 'arranging', b: 'arranging' });
  });
  it('a stale sync from an older generation is ignored', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    const old = structuredClone(w.pub);
    w.newGame(); flush();
    expect(b.syncFrom(old)).toBe(false); expect(b.pub.phase).toBe('setup');
  });
  it('ready in a hello from an older generation is ignored', () => {
    const { w, b, flush, start } = pair(); start(); w.newGame(); flush();
    const staleHello = { t: 'hello', version: 5, gen: 0, ready: true };
    w.onHello(staleHello); expect(w.pub.stage.b).toBe('arranging');
  });
});

describe('lost saved state (review fix 3)', () => {
  it('a fresh client synced into a game it supposedly readied for is flagged', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    const fresh = new Game({ me: 'b' });
    expect(fresh.lostState).toBe(false);
    fresh.syncFrom(w.pub);
    expect(fresh.lostState).toBe(true);
  });
  it('a normal sync does not flag', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4');
    expect(b.syncFrom(w.pub)).toBe(true); expect(b.lostState).toBe(false);
  });
  it('a new-generation sync clears the flag', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    const fresh = new Game({ me: 'b' }); fresh.syncFrom(w.pub); expect(fresh.lostState).toBe(true);
    w.newGame(); fresh.syncFrom(w.pub); expect(fresh.lostState).toBe(false); expect(fresh.pub.phase).toBe('setup');
  });
});

describe('snapshot validation (review fix 4)', () => {
  it('isSnapshot rejects garbage and accepts a real snapshot', () => {
    expect(Game.isSnapshot(null)).toBe(false); expect(Game.isSnapshot({})).toBe(false);
    expect(Game.isSnapshot({ me: 'w', pub: {}, priv: {} })).toBe(false);
    expect(Game.isSnapshot({ me: 'x', pub: new Game().pub, priv: { w: {}, b: null } })).toBe(false);
    const g = new Game({ me: 'w' }); expect(Game.isSnapshot(JSON.parse(JSON.stringify(g.snapshot())))).toBe(true);
  });
  it('restore fills defaults for fields older snapshots lack', () => {
    const g = new Game({ me: 'w' }); const snap = JSON.parse(JSON.stringify(g.snapshot()));
    delete snap.pub.gen; delete snap.pub.penaltyId; delete snap.setupColor;
    const r = Game.restore(snap, {}); expect(r.pub.gen).toBe(0); expect(r.pub.penaltyId).toBeNull(); expect(r.setupColor).toBe('w'); expect(r.lostState).toBe(false);
  });
});
