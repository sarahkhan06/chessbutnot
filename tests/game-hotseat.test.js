import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';

const g = (setup = () => {}) => { const game = new Game(); setup(game); game.readyUp('w'); game.readyUp('b'); return game; };
const kingOnD7 = (game) => game.swap('b', 'e8', 'd7'); // black king (b4) now sits on d7 slot => id b11 is the king
// e-pawn's second move slides two squares like a rook: a bluff that can be challenged.
const bluffE6 = (game) => { game.move('e2', 'e4'); game.move('a7', 'a6'); game.move('e4', 'e6'); };
const walkToD7 = (game) => { for (const [f, t] of [['e2','e4'],['a7','a6'],['e4','e5'],['a6','a5'],['e5','e6'],['a5','a4'],['e6','d7']]) game.move(f, t); };

describe('Game hot-seat', () => {
  it('setup: swap identities, readyUp both, play starts with white', () => {
    const game = new Game();
    game.swap('w', 'e1', 'e2'); expect(game.priv.w.w4).toBe('p'); expect(game.priv.w.w12).toBe('k');
    expect(game.viewer()).toBe('w'); game.readyUp('w'); expect(game.viewer()).toBe('b'); game.readyUp('b');
    expect(game.pub.phase).toBe('play'); expect(game.viewer()).toBe('w');
  });
  it('swap rejects mixed colors and swaps after lock-in', () => {
    const game = new Game();
    game.swap('w', 'e1', 'e7'); expect(game.priv.w.w4).toBe('k');
    game.lockIn('w'); game.swap('w', 'e1', 'e2'); expect(game.priv.w.w4).toBe('k');
  });
  it('legal move then opponent moves: previous move becomes unchallengeable', () => {
    const game = g(); game.move('e2', 'e4'); game.move('a7', 'a6'); game.move('e4', 'e5'); expect(game.canChallenge()).toBe(true);
    game.move('e7', 'e6'); expect(game.pub.lastMove.from).toBe('e7'); expect(game.pub.pieces.w12.square).toBe('e5');
  });
  it('challenging a legal move does NOT reveal the piece, and the challenger still moves', () => {
    const game = g(); game.move('b1', 'c3'); game.move('a7', 'a6'); game.move('c3', 'd5'); game.challenge();
    expect(game.pub.pieces.w1.faceUp).toBeNull(); expect(game.pub.history.at(-1)).toMatchObject({ kind: 'legal' }); expect('type' in game.pub.history.at(-1)).toBe(false); expect(game.pub.turn).toBe('b'); expect(game.pub.pending).toBe('penaltyPick'); expect(game.canChallenge()).toBe(false);
    game.pickPenalty('b0'); expect(game.pub.pending).toBeNull();
    game.move('e7', 'e5'); expect(game.pub.turn).toBe('w');
  });
  it('challenging a bluff removes it, enters penalty pick, penalty removes and reveals', () => {
    const game = g(); bluffE6(game); game.challenge();
    expect(game.pub.lost.w).toEqual([{ id: 'w12', type: 'p', by: null }]); expect(game.pub.pending).toBe('penaltyPick');
    expect(game.destinations('e7')).toEqual([]);
    game.move('e7', 'e5'); expect(game.pub.pieces.b12.square).toBe('e7');
    game.pickPenalty('w4'); expect(game.pub.phase).toBe('over'); expect(game.pub.winner).toBe('b'); expect(game.pub.reason).toBe('king-penalty');
  });
  it('penalty on a non-king piece lets the challenger move on', () => {
    const game = g(); bluffE6(game); game.challenge(); game.pickPenalty('w0');
    expect(game.pub.lost.w).toContainEqual({ id: 'w0', type: 'r', by: null }); expect(game.pub.pending).toBeNull(); expect(game.pub.turn).toBe('b');
    game.move('e7', 'e5'); expect(game.pub.turn).toBe('w');
  });
  it('pickPenalty ignores own pieces and already-removed pieces', () => {
    const game = g(); bluffE6(game); game.challenge();
    game.pickPenalty('b4'); expect(game.pub.pending).toBe('penaltyPick');
    game.pickPenalty('w12'); expect(game.pub.pending).toBe('penaltyPick');
  });
  it('capture is pending until the defender moves; then revealed and pawn transforms', () => {
    const game = g(); game.move('e2', 'e4'); game.move('d7', 'd5'); game.move('e4', 'd5');
    expect(game.pub.lost.b).toEqual([{ id: 'b11', type: null, by: 'w12' }]);
    game.move('g8', 'f6');
    expect(game.pub.lost.b[0].type).toBe('p'); expect(game.priv.w.w12).toBe('p');
  });
  it('pawn capturing a knight becomes a knight once accepted', () => {
    const game = g(); game.move('e2', 'e4'); game.move('g8', 'f6'); game.move('e4', 'e5'); game.move('h7', 'h6'); game.move('e5', 'f6');
    game.move('h6', 'h5'); expect(game.priv.w.w12).toBe('n'); expect(game.pub.lost.b[0]).toEqual({ id: 'b6', type: 'n', by: 'w12' });
  });
  it('pawn reaching the far rank promotes to queen privately', () => {
    const game = g(); game.move('h2', 'h4'); game.move('a7', 'a5'); game.move('h4', 'h5'); game.move('a5', 'a4'); game.move('h5', 'h6'); game.move('a4', 'a3'); game.move('h6', 'g7'); game.move('b7', 'b6'); game.move('g7', 'h8');
    game.move('b6', 'b5');
    expect(game.priv.w.w15).toBe('q');
  });
  it('king capture only wins when accepted; a bluff onto the king is punishable', () => {
    const game = g(kingOnD7); game.move('d2', 'd4'); game.move('a7', 'a6'); game.move('d4', 'd7'); /* pawn sliding like a rook onto the king */
    expect(game.pub.phase).toBe('play'); expect(game.pub.lost.b).toEqual([{ id: 'b11', type: null, by: 'w11' }]);
    game.challenge();
    expect(game.pub.pieces.b11.square).toBe('d7'); expect(game.pub.lost.b).toEqual([]); expect(game.pub.pending).toBe('penaltyPick');
  });
  it('king capture accepted by moving ends the game', () => {
    const game = g(kingOnD7); walkToD7(game);
    expect(game.pub.phase).toBe('play');
    game.move('a4', 'a3');
    expect(game.pub.phase).toBe('over'); expect(game.pub.winner).toBe('w'); expect(game.pub.reason).toBe('king-captured'); expect(game.pub.lost.b[0]).toEqual({ id: 'b11', type: 'k', by: 'w12' });
  });
  it('challenging a legal king capture reveals the king and ends the game', () => {
    const game = g(kingOnD7); walkToD7(game); game.challenge();
    expect(game.pub.phase).toBe('over'); expect(game.pub.winner).toBe('w'); expect(game.pub.pieces.w12.faceUp).toBeNull(); expect(game.pub.lost.b[0].type).toBe('k');
  });
  it('a bluffing king caught by challenge loses outright', () => {
    const game = g((x) => x.swap('w', 'e1', 'e2')); game.move('e2', 'e3'); game.move('a7', 'a6'); game.move('e3', 'e6'); game.challenge();
    expect(game.pub.phase).toBe('over'); expect(game.pub.winner).toBe('b'); expect(game.pub.reason).toBe('king-bluffed');
  });
  it('moves during setup or after game over are ignored', () => {
    const game = new Game(); game.move('e2', 'e4'); expect(game.pub.pieces.w12.square).toBe('e2');
    const over = g((x) => x.swap('w', 'e1', 'e2')); over.move('e2', 'e3'); over.move('a7', 'a6'); over.move('e3', 'e6'); over.challenge(); expect(over.pub.phase).toBe('over'); over.move('e7', 'e5'); expect(over.pub.pieces.b12.square).toBe('e7');
  });
  it('destinations is empty for the non-viewer piece and marks legal vs bluff', () => {
    const game = g(); expect(game.destinations('e7')).toEqual([]);
    const d = game.destinations('b1'); expect(d.find((x) => x.to === 'c3').legal).toBe(true); expect(d.find((x) => x.to === 'b3')).toBeUndefined();
  });
  it('newGame resets to setup', () => {
    const game = g(); game.move('e2', 'e4'); game.newGame();
    expect(game.pub.phase).toBe('setup'); expect(game.pub.pieces.w12.square).toBe('e2'); expect(game.viewer()).toBe('w');
  });
  it('onChange fires on every state change', () => {
    let n = 0; const game = new Game({ onChange: () => n++ }); game.swap('w', 'a1', 'a2'); game.readyUp('w'); expect(n).toBe(2);
  });
});
