import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { standardIdentity } from '../src/rules/identity.js';

function pair() {
  const queue = [];
  const w = new Game({ me: 'w', send: (m) => queue.push(['b', m]) });
  const b = new Game({ me: 'b', send: (m) => queue.push(['w', m]) });
  const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'w' ? w : b).receive(m); } };
  const start = () => { w.readyUp('w'); b.readyUp('b'); flush(); };
  return { w, b, flush, start, queue };
}
const tap = (game, wire) => { const orig = game.send; game.send = (m) => { wire.push(m); orig(m); }; };
const finish = (w, b, flush) => { w.move('e2', 'e4'); flush(); b.resign(); flush(); };

describe('setup commitment', () => {
  it('ready carries a commitment; the salt stays private until game over', () => {
    const { w, b, flush, start } = pair(); const wire = []; tap(w, wire); start();
    expect(wire[0]).toMatchObject({ t: 'ready' }); expect(wire[0].commit).toMatch(/^[0-9a-f]{64}$/);
    expect(b.oppCommit).toBe(wire[0].commit); expect(JSON.stringify(wire)).not.toMatch(w.salt);
    finish(w, b, flush);
    const setup = wire.find((m) => m.t === 'setup'); expect(setup.salt).toBe(w.salt); expect(w.salt).toMatch(/^[0-9a-f]{32}$/);
  });
  it('an honest game verifies on both sides after any ending', () => {
    const { w, b, flush, start } = pair(); w.swap('w', 'a1', 'b1'); start();
    expect(w.verification()).toBeNull(); finish(w, b, flush);
    expect(w.verification()).toEqual({ ok: true }); expect(b.verification()).toEqual({ ok: true });
  });
  it('a reveal that does not match the commitment, or omits the salt, fails as commitment (Review Focus 2)', () => {
    const { w, b, flush, start, queue } = pair(); start(); w.move('e2', 'e4'); flush(); b.resign(); queue.length = 0;
    b.receive({ t: 'setup', gen: 0, ids: { ...standardIdentity('w'), w0: 'n', w1: 'r' }, salt: w.salt });
    expect(b.verification()).toEqual({ ok: false, why: 'commitment' });
    b.setups.w = null; b.receive({ t: 'setup', gen: 0, ids: standardIdentity('w') });
    expect(b.verification()).toEqual({ ok: false, why: 'commitment' });
  });
  it('a lie during play is caught at game over', () => {
    const { w, b, flush, start, queue } = pair(); start();
    w.move('e2', 'e4'); flush(); b.move('a7', 'a6'); flush(); w.move('e4', 'e6'); flush(); b.challenge(); queue.length = 0;
    b.receive({ t: 'verdict', legal: true });      // a modified client claims the pawn's rook-slide was legal
    b.receive({ t: 'penalty', id: 'b0' });          // ...and takes its wrong-challenge penalty
    b.receive({ t: 'resign' }); queue.length = 0;
    b.receive({ t: 'setup', gen: 0, ids: standardIdentity('w'), salt: w.salt });
    expect(b.verification()).toEqual({ ok: false, why: 'verdict', ply: 3 });
  });
  it('the commitment is write-once and never taken from sync', () => {
    const { w, b, flush, start } = pair(); start(); const first = b.oppCommit;
    expect(b.receive({ t: 'ready', commit: 'f'.repeat(64) })).toBe(false); // already ready
    b.onHello({ t: 'hello', gen: 0, version: 0, ready: true, commit: 'f'.repeat(64) }); expect(b.oppCommit).toBe(first);
    const forged = structuredClone(w.pub); forged.version += 5; forged.oppCommit = 'f'.repeat(64); b.syncFrom(forged); expect(b.oppCommit).toBe(first);
  });
  it('a lost ready is recovered from hello together with its commitment', () => {
    const { w, b } = pair(); w.readyUp('w'); b.readyUp('b');
    w.onHello(b.helloMessage()); b.onHello(w.helloMessage());
    expect(w.oppCommit).toBe(b.commit); expect(b.oppCommit).toBe(w.commit); expect(w.pub.phase).toBe('play');
  });
  it('no commitment from the opponent is reported, not vouched for', () => {
    const { w, b, flush, start, queue } = pair(); w.readyUp('w'); queue.length = 0; b.receive({ t: 'ready' }); b.readyUp('b'); flush();
    expect(b.pub.phase).toBe('play'); finish(w, b, flush);
    expect(b.verification()).toEqual({ ok: null, why: 'no-commit' }); expect(w.verification()).toEqual({ ok: true });
  });
  it('a sync whose log is not an extension of ours taints verification (Review Focus 5)', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    const older = structuredClone(w.pub); delete older.log; older.version += 1; // a peer on the previous build
    expect(b.syncFrom(older)).toBe(true); expect(b.logTainted).toBe(true); expect(b.pub.log).toEqual([]);
    b.resign(); flush(); expect(b.verification()).toEqual({ ok: null, why: 'diverged' });
    const { w: w2, start: s2 } = pair(); s2(); w2.move('e2', 'e4');
    const forged = structuredClone(w2.pub); forged.log = [{ ...forged.log[0], to: 'e3' }]; forged.version += 1; // a rewritten past
    w2.syncFrom(forged); expect(w2.logTainted).toBe(true);
    const { w: w3, b: b3, start: s3, queue: q3 } = pair(); s3(); w3.move('e2', 'e4'); q3.length = 0; // honest: b3 missed one event
    b3.syncFrom(w3.pub); expect(b3.logTainted).toBe(false); expect(b3.pub.log.length).toBe(1);
  });
  it('private commitment state survives snapshot/restore and legacy snapshots default it (Review Focus 3)', () => {
    const { w, start } = pair(); start();
    const r = Game.restore(JSON.parse(JSON.stringify(w.snapshot())), {});
    expect(r.salt).toBe(w.salt); expect(r.commit).toBe(w.commit); expect(r.oppCommit).toBe(w.oppCommit); expect(r.logTainted).toBe(false);
    const legacy = JSON.parse(JSON.stringify(w.snapshot())); for (const k of ['salt', 'commit', 'oppCommit', 'oppSalt', 'logTainted', 'seat']) delete legacy[k]; delete legacy.pub.log; delete legacy.pub.drawOffer;
    const l = Game.restore(legacy, {}); expect(l.pub.log).toEqual([]); expect(l.pub.drawOffer).toBeNull(); expect(l.salt).toMatch(/^[0-9a-f]{32}$/); expect(l.oppCommit).toBeNull();
    l.move('e2', 'e4'); expect(l.pub.log.length).toBe(1);
  });
  it('a forged sync cannot smuggle an impossible, unchallengeable move past verification (review fix)', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    const forged = structuredClone(w.pub); forged.version += 1; forged.turn = 'w'; forged.pieces.b12.square = 'c5';
    forged.lastMove = { from: 'e7', to: 'c5', pieceId: 'b12', capturedId: null, challengeable: true, moverMoved: false, capturedMoved: null };
    forged.log = [...forged.log, { k: 'move', from: 'e7', to: 'c5', pieceId: 'b12', capturedId: null, moverMoved: true, capturedMoved: null }];
    expect(w.syncFrom(forged)).toBe(true); expect(w.canChallenge()).toBe(false);
    w.resign(); w.receive({ t: 'setup', gen: 0, ids: standardIdentity('b'), salt: b.salt });
    expect(w.verification()).toEqual({ ok: false, why: 'first-move', ply: 1 });
  });
  it('a board that does not match the move log is reported, not verified (review fix)', () => {
    const { w, b, start } = pair(); start(); w.move('e2', 'e4');
    const forged = structuredClone(w.pub); forged.version += 1; forged.pieces.b12.square = 'c5'; // teleport with no log entry
    expect(w.syncFrom(forged)).toBe(true); expect(w.logTainted).toBe(false);
    w.resign(); w.receive({ t: 'setup', gen: 0, ids: standardIdentity('b'), salt: b.salt });
    expect(w.verification()).toEqual({ ok: false, why: 'log', ply: 2 }); // reported at the end of the log (move, resign)
  });
  it('a commitment mismatch is reported even when the log was tainted (review fix)', () => {
    const { w, b, start } = pair(); start(); w.move('e2', 'e4');
    const older = structuredClone(w.pub); delete older.log; older.version += 1; w.syncFrom(older); expect(w.logTainted).toBe(true);
    w.resign(); w.receive({ t: 'setup', gen: 0, ids: { ...standardIdentity('b'), b0: 'n', b1: 'r' }, salt: b.salt });
    expect(w.verification()).toEqual({ ok: false, why: 'commitment' });
  });
});
