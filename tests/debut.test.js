import { describe, it, expect } from 'vitest';
import { patternMoves } from '../src/rules/geometry.js';
import { createState, startPlay, applyMove } from '../src/rules/state.js';
import { standardIdentity, legalDestinations } from '../src/rules/identity.js';
import { Game } from '../src/game.js';

const S = () => startPlay(createState());
const empty = () => null;

function pair() {
  const queue = [];
  const w = new Game({ me: 'w', send: (m) => queue.push(['b', m]) });
  const b = new Game({ me: 'b', send: (m) => queue.push(['w', m]) });
  const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'w' ? w : b).receive(m); } };
  const start = () => { w.readyUp('w'); b.readyUp('b'); flush(); };
  return { w, b, flush, start };
}

describe('pawn double-step only from the pawn rank', () => {
  it('white pawn on rank 1 moves one square only', () => {
    expect(patternMoves('p', 'w', 'e1', empty, false)).toEqual(['e2']);
  });
  it('black pawn on rank 8 moves one square only', () => {
    expect(patternMoves('p', 'b', 'e8', empty, false)).toEqual(['e7']);
  });
  it('white pawn on rank 2 and black pawn on rank 7 still double-step', () => {
    expect(patternMoves('p', 'w', 'e2', empty, false)).toEqual(['e3', 'e4']);
    expect(patternMoves('p', 'b', 'e7', empty, false)).toEqual(['e6', 'e5']);
  });
});

describe('honest first move', () => {
  it('an unmoved piece is offered only its legal squares', () => {
    const d = legalDestinations(S(), standardIdentity('w'), 'e2');
    expect(d.map((x) => x.to).sort()).toEqual(['e3', 'e4']);
    expect(d.every((x) => x.legal)).toBe(true);
  });
  it('a moved piece is offered bluff squares too', () => {
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'a7', 'a6');
    const d = legalDestinations(s, standardIdentity('w'), 'e4');
    expect(d.some((x) => !x.legal)).toBe(true);
    expect(d.find((x) => x.to === 'e5').legal).toBe(true);
  });
  it('a debut move cannot be challenged; the next move by that piece can', () => {
    const game = new Game(); game.readyUp('w'); game.readyUp('b');
    game.move('e2', 'e4'); expect(game.canChallenge()).toBe(false);
    game.move('a7', 'a6'); game.move('e4', 'e5'); expect(game.canChallenge()).toBe(true);
  });
  it('a challenge message against a debut move is rejected', () => {
    const { w, b, flush, start } = pair(); start();
    w.move('e2', 'e4'); flush();
    expect(b.canChallenge()).toBe(false);
    expect(w.receive({ t: 'challenge' })).toBe(false);
    expect(w.pub.pieces.w12.faceUp).toBeNull();
  });
  it('a debut capture is still revealed when the defender moves on', () => {
    const { w, b, flush, start } = pair(); start();
    for (const [f, t] of [['e2','e4'],['d7','d5'],['a2','a3'],['d5','d4'],['a3','a4'],['d4','d3']]) { (w.pub.turn === 'w' ? w : b).move(f, t); flush(); }
    w.move('c2', 'd3'); flush(); // unmoved pawn captures on its first move
    expect(w.pub.lastMove).toMatchObject({ capturedId: 'b11', moverMoved: false });
    expect(b.canChallenge()).toBe(false);
    expect(w.pub.lost.b.find((e) => e.id === 'b11').type).toBeNull();
    b.move('h7', 'h6'); flush();
    expect(w.pub.lost.b.find((e) => e.id === 'b11').type).toBe('p');
    expect(b.pub.lost.b.find((e) => e.id === 'b11').type).toBe('p');
  });
});
