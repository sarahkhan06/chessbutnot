import { describe, it, expect } from 'vitest';
import { createState, startPlay, applyMove, resolveLegal, resolveBluff, applyPenalty } from '../src/rules/state.js';
import { Game } from '../src/game.js';

const S = () => startPlay(createState());

describe('move history', () => {
  it('startPlay records the starting position as entry 0', () => {
    const s = S();
    expect(s.history.length).toBe(1);
    expect(s.history[0]).toMatchObject({ kind: 'start', board: { w12: 'e2', b4: 'e8' } });
    expect(createState().history).toEqual([]);
  });
  it('applyMove records the move with a board snapshot after it', () => {
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
    expect(s.history.length).toBe(4);
    expect(s.history[1]).toMatchObject({ kind: 'move', from: 'e2', to: 'e4', capture: false, board: { w12: 'e4' } });
    expect(s.history[3]).toMatchObject({ kind: 'move', from: 'e4', to: 'd5', capture: true });
    expect(s.history[3].board.w12).toBe('d5'); expect('b11' in s.history[3].board).toBe(false);
    expect(s.history[1].board.w12).toBe('e4'); // earlier snapshots are untouched
  });
  it('bluff, legal verdict and penalty each add an entry', () => {
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
    const bluff = resolveBluff(s, 'p');
    expect(bluff.history.at(-1)).toMatchObject({ kind: 'bluff', type: 'p', from: 'e4', to: 'd5' });
    expect(bluff.history.at(-1).board).toMatchObject({ b11: 'd5' }); expect('w12' in bluff.history.at(-1).board).toBe(false);
    const pen = applyPenalty(bluff, 'w0', 'r');
    expect(pen.history.at(-1)).toMatchObject({ kind: 'penalty', type: 'r' }); expect('w0' in pen.history.at(-1).board).toBe(false);
    const legal = resolveLegal(s, 'p');
    expect(legal.history.at(-1)).toMatchObject({ kind: 'legal', type: 'p', to: 'd5', faceUp: { w12: 'p' } });
  });
  it('restore defaults history for saves made before it existed', () => {
    const g = new Game({ me: 'w' }); const snap = JSON.parse(JSON.stringify(g.snapshot())); delete snap.pub.history;
    expect(Game.restore(snap, {}).pub.history).toEqual([]);
  });
});
