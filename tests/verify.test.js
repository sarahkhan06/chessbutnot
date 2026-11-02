import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { verify } from '../src/rules/verify.js';

// Hot-seat games hold both identities, so their logs are ground truth; tamper to make liars.
const play = (moves, setup = () => {}) => { const g = new Game(); setup(g); g.readyUp('w'); g.readyUp('b'); for (const m of moves) (typeof m === 'string' ? g[m]() : g.move(...m)); return g; };
const BLUFF = [['e2','e4'],['a7','a6'],['e4','e6']];

describe('verify', () => {
  it('an honest game with a legal challenge, a capture, a bluff and two penalties verifies for both sides', () => {
    const g = play([['b1','c3'],['a7','a6'],['c3','d5'],'challenge']); g.pickPenalty('b0'); // legal knight hop; black loses a8
    g.move('e7','e5'); g.move('d5','c7'); g.move('h7','h6'); // knight takes the c7 pawn; black moves on, accepting it
    g.move('c7','c5'); g.challenge(); g.pickPenalty('w0'); // knight slides two squares: bluff caught; white loses a1
    expect(g.pub.log.map((e) => e.k)).toEqual(['move','move','move','legal','penalty','move','move','captured','move','move','bluff','penalty']);
    for (const c of ['w', 'b']) expect(verify(g.pub.log, g.startingSetup()[c], c)).toEqual({ ok: true });
  });
  it('a false "legal" verdict is caught at that ply', () => {
    const g = play(BLUFF); g.challenge(); // honest client resolves a bluff at log index 3
    const log = [...g.pub.log.slice(0, 3), { k: 'legal' }];
    expect(verify(log, g.startingSetup().w, 'w')).toEqual({ ok: false, why: 'verdict', ply: 3 });
    expect(verify(g.pub.log, g.startingSetup().w, 'w')).toEqual({ ok: true });
  });
  it('a bluff revealed with the wrong type is caught', () => {
    const g = play(BLUFF); g.challenge();
    const log = g.pub.log.map((e) => (e.k === 'bluff' ? { ...e, type: 'n' } : e));
    expect(verify(log, g.startingSetup().w, 'w')).toMatchObject({ ok: false, why: 'bluff' });
  });
  it('captured and penalty reveals must match the setup', () => {
    const g = play([['e2','e4'],['d7','d5'],['e4','d5'],['g8','f6']]);
    const lie = g.pub.log.map((e) => (e.k === 'captured' ? { ...e, type: 'q' } : e));
    expect(verify(lie, g.startingSetup().b, 'b')).toMatchObject({ ok: false, why: 'captured' });
    const p = play(BLUFF); p.challenge(); p.pickPenalty('w0');
    const lie2 = p.pub.log.map((e) => (e.k === 'penalty' ? { ...e, type: 'b' } : e));
    expect(verify(lie2, p.startingSetup().w, 'w')).toMatchObject({ ok: false, why: 'penalty' });
  });
  it('a dishonest first move is caught even though it was never challenged (Review Focus 4)', () => {
    const g = play([['e2','e4']]);
    const log = [{ ...g.pub.log[0], to: 'e5' }]; // a pawn's first move three squares: only a modified client sends this
    expect(verify(log, g.startingSetup().w, 'w')).toEqual({ ok: false, why: 'first-move', ply: 0 });
  });
  it('judges by the identity at the time of the move: promotion and transformation are tracked', () => {
    const g = play([['h2','h4'],['a7','a5'],['h4','h5'],['a5','a4'],['h5','h6'],['a4','a3'],['h6','g7'],['b7','b6'],['g7','h8'],['b6','b5'],['h8','g8'],'challenge']); // the new queen slides sideways: legal
    expect(verify(g.pub.log, g.startingSetup().w, 'w')).toEqual({ ok: true });
    const t = play([['e2','e4'],['g8','f6'],['e4','e5'],['h7','h6'],['e5','f6'],['h6','h5'],['f6','g4'],'challenge']); // pawn became a knight, then moved like one
    expect(verify(t.pub.log, t.startingSetup().w, 'w')).toEqual({ ok: true });
  });
});
