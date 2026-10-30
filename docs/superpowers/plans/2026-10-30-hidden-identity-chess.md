# Hidden Identity Chess Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chess.js-based "Blind Chess" with the full Hidden Identity Chess ruleset (free-form moves, challenges, penalties, deferred capture reveal, king-capture win) playable online between two browsers and in hot-seat.

**Architecture:** Pure rules modules (`src/rules/*`) hold geometry, public-state reducers and private identity logic, all unit-tested. A `Game` orchestrator (`src/game.js`) owns one public state plus whichever private identity maps this client is entitled to, and turns local UI actions and incoming network messages into state changes and outgoing messages. Thin `net.js` (PeerJS), `storage.js` (localStorage) and `render.js` (DOM) modules sit around it; `main.js` wires them.

**Tech Stack:** Vite 5, plain ES modules, PeerJS 1.5, Vitest for tests. chess.js is removed.

**Spec:** `docs/superpowers/specs/2026-10-30-hidden-identity-chess-design.md`

## Global Constraints

- Static hosting on Vercel via `vite build`; no server code.
- Plain JavaScript ES modules, no framework, no state library.
- Keep `peerjs`; remove `chess.js`.
- No message on the wire may carry a piece identity the receiver is not entitled to under the rules (only `captured`, `verdict{legal:true}`, `removed` carry a type).
- Hidden identities must not leak through rendering on the opponent's view (no legal/bluff distinction, no glyphs, no console logs of the opponent's identities).
- Must work on a phone browser and a laptop browser in the same game; keep the existing look (tilted board, card pieces, blue gradient, max-width 560px).
- Castling and en passant do not exist. Promotion is always to queen and silent.
- Piece ids are `w0..w15` and `b0..b15`: index 0–7 is the back rank a–h, 8–15 the front rank a–h. Rearranging swaps *identities* between slots; positions never change during setup.

## Review Focus

1. Tapping the board while a request is outstanding (awaiting `captured`, `verdict` or `removed`) must do nothing. Test in Task 5.
2. A duplicate or out-of-order network message (e.g. a `move` re-sent after reconnect) must not be applied twice. Test in Task 6.
3. A back-rank pawn's double step must be blocked by any piece on either of the two squares in front. Test in Task 2.
4. A pawn that captures onto the far rank promotes to queen; when the capture is later accepted, no transformation overrides the queen. Test in Task 4.
5. A client that reconnects while its own `challenge` or `penalty` is unanswered must re-send it after sync. Test in Task 6.

---

### Task 1: Test tooling and dependency swap

**Files:**
- Modify: `package.json`
- Create: `tests/smoke.test.js`

**Interfaces:**
- Produces: `npm test` runs Vitest once; `npm run test:watch` watches.

- [ ] **Step 1: Write the failing smoke test**

```js
// tests/smoke.test.js
import { describe, it, expect } from 'vitest';
describe('tooling', () => { it('runs', () => { expect(1 + 1).toBe(2); }); });
```

- [ ] **Step 2: Run it to verify it fails** — `npm test` → fails: vitest not found.

- [ ] **Step 3: Install and configure** — `npm uninstall chess.js && npm i -D vitest@^2`. Add scripts `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 4: Run `npm test`** → 1 passed.

- [ ] **Step 5: Commit** — `git add package.json package-lock.json tests && git commit -m "chore: add vitest, drop chess.js"`

---

### Task 2: Move geometry

**Files:**
- Create: `src/rules/geometry.js`
- Test: `tests/geometry.test.js`

**Interfaces:**
- Produces:
  - `TYPES = ['k','q','r','b','n','p']`
  - `FILES = 'abcdefgh'`; `sq(file, rank)` → `'e4'` or `null` if off board (file 0–7, rank 1–8); `fileOf(sq)` → 0–7; `rankOf(sq)` → 1–8.
  - `startRanks(color)` → `[1,2]` for `'w'`, `[8,7]` for `'b'`.
  - `patternMoves(type, color, from, occ, hasMoved)` → `string[]` of destination squares reachable by a piece of `type` and `color` from `from`. `occ(sq)` returns `'own' | 'enemy' | null`. Sliders stop at the first occupied square and include it only if `'enemy'`. Pawn: forward 1 if empty; forward 2 if `!hasMoved`, `rankOf(from)` is in `startRanks(color)`, and both squares are empty; diagonal forward 1 only if `'enemy'`. King: 1 step any direction. Knight: 8 jumps. Never includes `'own'` squares.
  - `destinations(color, from, occ, hasMoved)` → `Array<{ to: string, types: string[] }>`: the union over `TYPES` of `patternMoves`, grouped by destination, `types` sorted in `TYPES` order.

- [ ] **Step 1: Write failing tests** in `tests/geometry.test.js`. Helper `occFrom(map)` builds `occ` from `{ e4: 'own', d5: 'enemy' }`.

```js
it('rook slides and stops at first blocker, including enemy', () => {
  const occ = occFrom({ a4: 'enemy', e1: 'own' });
  expect(patternMoves('r','w','a1',occ,true).sort()).toEqual(['a2','a3','a4','b1','c1','d1'].sort());
});
it('bishop, queen, knight, king patterns from d4 on empty board', () => {
  const occ = () => null;
  expect(patternMoves('n','w','d4',occ,true).length).toBe(8);
  expect(patternMoves('k','w','d4',occ,true).length).toBe(8);
  expect(patternMoves('b','w','d4',occ,true).length).toBe(13);
  expect(patternMoves('q','w','d4',occ,true).length).toBe(27);
});
it('white pawn on rank 1 double-steps if unmoved', () => {
  expect(patternMoves('p','w','e1',() => null,false).sort()).toEqual(['e2','e3']);
});
it('black pawn on rank 7 double-steps toward rank 5', () => {
  expect(patternMoves('p','b','e7',() => null,false).sort()).toEqual(['e5','e6']);
});
it('pawn double step blocked by a piece on either square (Review Focus 3)', () => {
  expect(patternMoves('p','w','e1',occFrom({ e2: 'own' }),false)).toEqual([]);
  expect(patternMoves('p','w','e1',occFrom({ e3: 'enemy' }),false)).toEqual(['e2']);
});
it('pawn captures diagonally only onto enemy, never forward onto a piece', () => {
  const occ = occFrom({ d5: 'enemy', f5: 'own', e5: 'enemy' });
  expect(patternMoves('p','w','e4',occ,true)).toEqual(['d5']);
});
it('moved pawn or pawn off start ranks has no double step', () => {
  expect(patternMoves('p','w','e3',() => null,false)).toEqual(['e4']);
  expect(patternMoves('p','w','e2',() => null,true)).toEqual(['e3']);
});
it('destinations unions all types and labels each square', () => {
  const d = destinations('w','e1',() => null,false);
  const at = (s) => d.find((x) => x.to === s)?.types;
  expect(at('e2')).toEqual(['k','q','r','p']);
  expect(at('e3')).toEqual(['q','r','p']);
  expect(at('f3')).toEqual(['n']);
  expect(at('h4')).toEqual(['q','b']);
});
it('never includes own-occupied squares', () => {
  const occ = occFrom({ e2: 'own', d2: 'own', f2: 'own', d1: 'own', f1: 'own' });
  expect(destinations('w','e1',occ,false).map((x) => x.to).sort()).toEqual(['d3','f3'].sort());
});
```

- [ ] **Step 2: Run** `npm test -- tests/geometry.test.js` → fails: module not found.
- [ ] **Step 3: Implement `src/rules/geometry.js`** per the Interfaces block.
- [ ] **Step 4: Run** → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(rules): move geometry for all piece patterns"`

---

### Task 3: Public state reducers

**Files:**
- Create: `src/rules/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: `sq`, `FILES` from geometry.
- Produces (all pure; return a new state object, never mutate):
  - `createState()` → 
    ```
    { phase: 'setup', turn: 'w', version: 0,
      stage: { w: 'arranging', b: 'arranging' },      // 'arranging'|'done'|'ready'
      pieces: { [id]: { color, square, faceUp: null, moved: false } },  // 32 entries, squares per Global Constraints
      lost: { w: [], b: [] },                          // pieces OF that color removed: { id, type|null } (null = pending reveal)
      lastMove: null,                                  // { from, to, pieceId, capturedId|null, challengeable, capturedMoved }
      pending: null,                                   // null | 'awaitCaptured' | 'awaitVerdict' | 'penaltyPick' | 'awaitRemoved'
      winner: null, reason: null }
    ```
  - `pieceAt(state, square)` → id or null.
  - `occupancy(state, color)` → `occ` function for geometry.
  - `setStage(state, color, stage)`; `startPlay(state)` → phase `'play'`, turn `'w'`.
  - `applyMove(state, from, to)` → moves piece, sets `moved: true`; if an enemy piece is at `to`, pushes `{ id, type: null }` onto `lost[enemyColor]` and sets its `square: null`; `lastMove = { from, to, pieceId, capturedId, challengeable: true, capturedMoved }`; `turn` flips; `pending` becomes `'awaitCaptured'`... **no**: pending stays `null` (the defender decides when to reveal). Throws if `from` is empty or not `turn`'s piece or `to` holds own piece. (A move onto an empty square can never be a capture.)
  - `acceptLastMove(state)` → `lastMove.challengeable = false`.
  - `revealLost(state, id, type)` → sets `type` on the matching `lost` entry; if `type === 'k'`, `phase: 'over'`, `winner` = the other color, `reason: 'king-captured'`.
  - `resolveLegal(state, type)` → `pieces[lastMove.pieceId].faceUp = type`, `challengeable = false`.
  - `resolveBluff(state, type)` → bluffing piece: `square: null`, pushed to `lost[its color]` with `type`; captured piece (if any) restored to `lastMove.to` with `moved: lastMove.capturedMoved`, its pending `lost` entry removed; `challengeable = false`. If `type === 'k'` → `phase 'over'`, `winner` = challenger (`state.turn`), `reason: 'king-bluffed'`; else `pending: 'penaltyPick'`.
  - `applyPenalty(state, id, type)` → removes piece `id` (`square: null`) to `lost` with `type`; `pending: null`; if `type === 'k'` → over, `winner = state.turn`, `reason: 'king-penalty'`.
  - `setPending(state, pending)`.
  - Every reducer increments `version`.

- [ ] **Step 1: Write failing tests** in `tests/state.test.js`:

```js
it('createState places 32 pieces with ids on correct squares', () => {
  const s = createState();
  expect(s.pieces.w0.square).toBe('a1'); expect(s.pieces.w8.square).toBe('a2');
  expect(s.pieces.b7.square).toBe('h8'); expect(s.pieces.b15.square).toBe('h7');
  expect(Object.keys(s.pieces).length).toBe(32);
});
it('applyMove moves, flags moved, flips turn, records challengeable lastMove', () => {
  const s = applyMove(createState(), 'e2', 'e4');
  expect(pieceAt(s, 'e4')).toBe('w12'); expect(pieceAt(s, 'e2')).toBeNull();
  expect(s.pieces.w12.moved).toBe(true); expect(s.turn).toBe('b');
  expect(s.lastMove).toMatchObject({ from: 'e2', to: 'e4', pieceId: 'w12', capturedId: null, challengeable: true });
});
it('applyMove onto enemy records a pending capture', () => {
  let s = applyMove(createState(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
  expect(s.lost.b).toEqual([{ id: 'b11', type: null }]); expect(s.pieces.b11.square).toBeNull();
  expect(s.lastMove.capturedId).toBe('b11');
});
it('applyMove rejects moving the wrong color or onto own piece', () => {
  expect(() => applyMove(createState(), 'e7', 'e5')).toThrow();
  expect(() => applyMove(createState(), 'a1', 'a2')).toThrow();
});
it('revealLost sets the type; king ends the game for the captor', () => {
  let s = applyMove(createState(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
  s = revealLost(s, 'b11', 'k');
  expect(s.lost.b[0].type).toBe('k'); expect(s.phase).toBe('over'); expect(s.winner).toBe('w'); expect(s.reason).toBe('king-captured');
});
it('resolveLegal turns the piece face-up and ends challengeability', () => {
  const s = resolveLegal(applyMove(createState(), 'b1', 'c3'), 'n');
  expect(s.pieces.w1.faceUp).toBe('n'); expect(s.lastMove.challengeable).toBe(false);
});
it('resolveBluff removes the bluffer, restores a captured piece hidden, enters penaltyPick', () => {
  let s = applyMove(createState(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
  s = resolveBluff(s, 'n');
  expect(s.pieces.w12.square).toBeNull(); expect(s.lost.w).toEqual([{ id: 'w12', type: 'n' }]);
  expect(s.pieces.b11.square).toBe('d5'); expect(s.pieces.b11.moved).toBe(true); expect(s.lost.b).toEqual([]);
  expect(s.pending).toBe('penaltyPick'); expect(s.turn).toBe('b');
});
it('resolveBluff on a king wins immediately with no penalty pick', () => {
  const s = resolveBluff(applyMove(createState(), 'e1', 'e3'), 'k');
  expect(s.phase).toBe('over'); expect(s.winner).toBe('b'); expect(s.reason).toBe('king-bluffed'); expect(s.pending).toBeNull();
});
it('applyPenalty removes and reveals; king ends the game', () => {
  let s = resolveBluff(applyMove(createState(), 'e2', 'e5'), 'p');
  const s2 = applyPenalty(s, 'w0', 'r');
  expect(s2.pieces.w0.square).toBeNull(); expect(s2.lost.w).toContainEqual({ id: 'w0', type: 'r' }); expect(s2.pending).toBeNull();
  expect(applyPenalty(s, 'w4', 'k').winner).toBe('b');
});
it('reducers never mutate and bump version', () => {
  const a = createState(); const b = applyMove(a, 'e2', 'e4');
  expect(a.pieces.w12.square).toBe('e2'); expect(b.version).toBe(a.version + 1);
});
```

- [ ] **Step 2: Run** → fails. **Step 3: Implement** with structured clone or spread copies. **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(rules): public state reducers"`

---

### Task 4: Private identity and legality

**Files:**
- Create: `src/rules/identity.js`
- Test: `tests/identity.test.js`

**Interfaces:**
- Consumes: `patternMoves`, `rankOf`, `startRanks` from geometry; `pieceAt`, `occupancy` from state.
- Produces:
  - `STANDARD = ['r','n','b','q','k','b','n','r','p','p','p','p','p','p','p','p']`
  - `standardIdentity(color)` → `{ [`${color}${i}`]: STANDARD[i] }`.
  - `swapIdentity(identity, idA, idB)` → new map with the two values swapped.
  - `promote(identity, id, toSquare, color)` → if `identity[id] === 'p'` and `rankOf(toSquare)` is 8 for white / 1 for black, returns map with `id: 'q'`; else unchanged.
  - `transform(identity, id, capturedType)` → if `identity[id] === 'p'` and `capturedType !== 'p'`, returns map with `id: capturedType`; else unchanged.
  - `occupancyBefore(state)` → `occ` function for the position *before* `state.lastMove` from the mover's perspective: `from` counts as empty, `to` counts as `'enemy'` if `capturedId` else empty, all other squares as in `state`.
  - `isLastMoveLegal(state, identity)` → boolean: `patternMoves(identity[lastMove.pieceId], moverColor, from, occupancyBefore(state), movedBefore)` includes `to`, where `movedBefore` is `state.lastMove.moverMoved`. **Add `moverMoved`** (the piece's `moved` flag before the move) to `lastMove` in `applyMove` (Task 3) — update that reducer and its test.
  - `legalDestinations(state, identity, from)` → `Array<{ to, legal }>`: `destinations()` from geometry with `legal = types.includes(identity[pieceAt(from)])`.

- [ ] **Step 1: Write failing tests**:

```js
it('standardIdentity and swapIdentity', () => {
  const w = standardIdentity('w'); expect(w.w4).toBe('k'); expect(w.w8).toBe('p');
  const s = swapIdentity(w, 'w4', 'w8'); expect(s.w4).toBe('p'); expect(s.w8).toBe('k'); expect(w.w4).toBe('k');
});
it('promote only pawns on the far rank', () => {
  const w = standardIdentity('w');
  expect(promote(w, 'w8', 'a8', 'w').w8).toBe('q'); expect(promote(w, 'w8', 'a7', 'w').w8).toBe('p'); expect(promote(w, 'w0', 'a8', 'w').w0).toBe('r');
  expect(promote(standardIdentity('b'), 'b8', 'a1', 'b').b8).toBe('q');
});
it('transform: pawn takes captured non-pawn identity; queen stays queen (Review Focus 4)', () => {
  const w = standardIdentity('w');
  expect(transform(w, 'w8', 'r').w8).toBe('r'); expect(transform(w, 'w8', 'p').w8).toBe('p');
  expect(transform(promote(w, 'w8', 'a8', 'w'), 'w8', 'r').w8).toBe('q');
});
it('isLastMoveLegal uses the true identity and pre-move occupancy', () => {
  const w = standardIdentity('w');
  expect(isLastMoveLegal(applyMove(createState(), 'b1', 'c3'), w)).toBe(true);   // knight jump
  expect(isLastMoveLegal(applyMove(createState(), 'a1', 'a3'), w)).toBe(false);  // rook through own pawn: a2 blocks
  expect(isLastMoveLegal(applyMove(createState(), 'e2', 'e4'), w)).toBe(true);   // pawn double step
  expect(isLastMoveLegal(applyMove(createState(), 'e2', 'e4'), swapIdentity(w, 'w12', 'w1'))).toBe(false); // it was a knight
});
it('isLastMoveLegal treats a captured square as enemy for pawn diagonals', () => {
  let s = applyMove(createState(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
  expect(isLastMoveLegal(s, standardIdentity('w'))).toBe(true);
});
it('legalDestinations marks bluff squares', () => {
  const d = legalDestinations(createState(), standardIdentity('w'), 'b1');
  expect(d.find((x) => x.to === 'c3').legal).toBe(true);
  expect(d.find((x) => x.to === 'b3')).toBeUndefined();  // blocked by b2 for every type
  const d2 = legalDestinations(createState(), standardIdentity('w'), 'e2');
  expect(d2.find((x) => x.to === 'e4').legal).toBe(true); expect(d2.find((x) => x.to === 'f3').legal).toBe(false);
});
```

- [ ] **Step 2: Run** → fails. **Step 3: Implement**, including the `moverMoved` addition to `applyMove`. **Step 4: Run all** → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(rules): private identities, legality check, promotion and transform"`

---

### Task 5: Game orchestrator (hot-seat)

**Files:**
- Create: `src/game.js`
- Test: `tests/game-hotseat.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces `class Game`:
  - `constructor({ me = null, send = () => {}, onChange = () => {} })`. `me` is `'w' | 'b' | null` (null = hot-seat, this client owns both identities). `priv = { w: standardIdentity('w') | null, b: ... | null }` — populated for colors this client owns (`owns(c) = me === null || me === c`).
  - `pub` — the current public state. `priv` — identity maps.
  - `viewer()` → in setup: `me ?? this.setupColor` (hot-seat: `'w'` until White readies, then `'b'`); in play/over: `me ?? pub.turn`.
  - `owns(color)`.
  - Setup: `swap(color, sqA, sqB)` (both squares must hold `color`'s pieces, stage `'arranging'`), `lockIn(color)` → stage `'done'`, `readyUp(color)` → stage `'ready'`, `send({t:'ready'})` if `me`, starts play when both ready. In hot-seat, `readyUp('w')` sets `setupColor = 'b'`.
  - Play, called by the UI for the viewer:
    - `destinations(from)` → `legalDestinations(pub, priv[viewer()], from)`; returns `[]` if not viewer's piece, not viewer's turn, `pub.pending` is set, or phase isn't play.
    - `move(from, to)`: if `pub.pending` is non-null → no-op. If `pub.lastMove?.challengeable && pub.lastMove.capturedId` → first `acceptCapture()` (below); if that ended the game, stop. Else `acceptLastMove`. Then `applyMove`; `priv[color] = promote(...)` if owned; `send({t:'move', from, to})`.
    - `acceptCapture()`: the captured piece belongs to the viewer (defender). If `owns(defender)`: `type = priv[defender][capturedId]`, `pub = revealLost(...)`, `send({t:'captured', id, type})`, and if `owns(moverColor)`, `priv[mover] = transform(priv[mover], lastMove.pieceId, type)`. If not owned (cannot happen for a local action), no-op.
    - `challenge()`: requires `pub.lastMove?.challengeable` and `pub.pending === null` and `pub.turn === viewer()`. `send({t:'challenge'})`. If `owns(moverColor)`, resolve locally via `answerChallenge()`; else `pub = setPending(pub, 'awaitVerdict')`.
    - `answerChallenge()` (mover's side): `legal = isLastMoveLegal(pub, priv[mover])`; `type = priv[mover][pieceId]`; if legal: `pub = resolveLegal(pub, type)`, `send({t:'verdict', legal: true, type})`, then if the move was a capture → `acceptCapture()` path happens on the **defender's** side: so if `owns(defender)` call `acceptCapture()` now. If bluff: `pub = resolveBluff(pub, type)`, `send({t:'verdict', legal: false, type})`.
    - `pickPenalty(id)`: requires `pub.pending === 'penaltyPick'`, piece `id` belongs to the opponent of `viewer()` and is on the board. `send({t:'penalty', id})`. If `owns(owner)`: `pub = applyPenalty(pub, id, priv[owner][id])`, `send({t:'removed', id, type})`; else `pub = setPending(pub, 'awaitRemoved')`.
    - `newGame()` → reset `pub`, `priv`, `setupColor`; `send({t:'new'})`.
  - After every state change, call `onChange()`.
  - `canChallenge()` → boolean per the `challenge()` preconditions. `isGameOver()`.

- [ ] **Step 1: Write failing tests** (hot-seat, `me: null`):

```js
const g = () => { const game = new Game(); game.readyUp('w'); game.readyUp('b'); return game; };  // lockIn optional
it('setup: swap identities, readyUp both, play starts with white', () => {
  const game = new Game();
  game.swap('w', 'e1', 'e2'); expect(game.priv.w.w4).toBe('p'); expect(game.priv.w.w12).toBe('k');
  expect(game.viewer()).toBe('w'); game.readyUp('w'); expect(game.viewer()).toBe('b'); game.readyUp('b');
  expect(game.pub.phase).toBe('play'); expect(game.viewer()).toBe('w');
});
it('legal move then opponent moves: previous move becomes unchallengeable', () => {
  const game = g(); game.move('e2', 'e4'); expect(game.canChallenge()).toBe(true);
  game.move('e7', 'e5'); expect(game.pub.lastMove.from).toBe('e7'); expect(game.pub.pieces.w12.square).toBe('e4');
});
it('challenging a legal move exposes it face-up and the challenger still moves', () => {
  const game = g(); game.move('b1', 'c3'); game.challenge();
  expect(game.pub.pieces.w1.faceUp).toBe('n'); expect(game.pub.turn).toBe('b'); expect(game.pub.pending).toBeNull();
  game.move('e7', 'e5'); expect(game.pub.turn).toBe('w');
});
it('challenging a bluff removes it, enters penalty pick, penalty removes and reveals', () => {
  const game = g(); game.move('b1', 'b3'); /* knight moving like a rook */ game.challenge();
  expect(game.pub.lost.w).toEqual([{ id: 'w1', type: 'n' }]); expect(game.pub.pending).toBe('penaltyPick');
  expect(game.destinations('e7')).toEqual([]);                        // Review Focus 1: no moves while pending
  game.pickPenalty('w4'); expect(game.pub.phase).toBe('over'); expect(game.pub.winner).toBe('b'); expect(game.pub.reason).toBe('king-penalty');
});
it('capture is pending until the defender moves; then revealed and pawn transforms', () => {
  const game = g(); game.move('e2', 'e4'); game.move('d7', 'd5'); game.move('e4', 'd5');
  expect(game.pub.lost.b).toEqual([{ id: 'b11', type: null }]);
  game.move('g8', 'f6');
  expect(game.pub.lost.b[0].type).toBe('p'); expect(game.priv.w.w12).toBe('p');
});
it('pawn capturing a knight becomes a knight once accepted', () => {
  const game = g(); game.move('e2', 'e4'); game.move('g8', 'f6'); game.move('e4', 'e5'); game.move('h7', 'h6'); game.move('e5', 'f6');
  game.move('h6', 'h5'); expect(game.priv.w.w12).toBe('n'); expect(game.pub.lost.b[0]).toEqual({ id: 'b6', type: 'n' });
});
it('king capture only wins when accepted; a bluff onto the king is punishable', () => {
  const game = g(); game.swap('b', 'e8', 'd7');                  // black king now on d7 as b11
  game.readyUp; game.move('b1', 'd7');                           // white "knight" bluffs a long jump onto the king
  expect(game.pub.phase).toBe('play'); expect(game.pub.lost.b).toEqual([{ id: 'b11', type: null }]);
  game.challenge();                                               // illegal for a knight
  expect(game.pub.pieces.b11.square).toBe('d7'); expect(game.pub.lost.b).toEqual([]); expect(game.pub.pending).toBe('penaltyPick');
});
it('king capture accepted by moving ends the game', () => {
  const game = g(); game.swap('b', 'e8', 'd7'); game.move('e2', 'e4'); game.move('a7', 'a6'); game.move('e4', 'e5'); game.move('a6', 'a5'); game.move('e5', 'e6'); game.move('a5', 'a4'); game.move('e6', 'd7');
  game.move('a4', 'a3');  // black accepts by moving
  expect(game.pub.phase).toBe('over'); expect(game.pub.winner).toBe('w'); expect(game.pub.reason).toBe('king-captured');
});
it('challenging a legal king capture reveals the king and ends the game', () => {
  const game = g(); game.swap('b', 'e8', 'd7'); game.move('e2', 'e4'); game.move('a7', 'a6'); game.move('e4', 'e5'); game.move('a6', 'a5'); game.move('e5', 'e6'); game.move('a5', 'a4'); game.move('e6', 'd7');
  game.challenge(); expect(game.pub.phase).toBe('over'); expect(game.pub.winner).toBe('w'); expect(game.pub.pieces.w12.faceUp).toBe('p');
});
it('a bluffing king caught by challenge loses outright', () => {
  const game = g(); game.move('e1', 'e3'); game.challenge();
  expect(game.pub.phase).toBe('over'); expect(game.pub.winner).toBe('b'); expect(game.pub.reason).toBe('king-bluffed');
});
it('moves during setup or after game over are ignored', () => {
  const game = new Game(); game.move('e2', 'e4'); expect(game.pub.pieces.w12.square).toBe('e2');
});
```
Fix the stray `game.readyUp;` line in the king-bluff test to nothing (the helper already readied) when writing.

- [ ] **Step 2: Run** → fails. **Step 3: Implement `src/game.js`**. **Step 4: Run all** → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: Game orchestrator with challenges, penalties, deferred captures"`

---

### Task 6: Game orchestrator (networked) and persistence format

**Files:**
- Modify: `src/game.js`
- Test: `tests/game-online.test.js`

**Interfaces:**
- Produces on `Game`:
  - `receive(msg)` — applies an incoming message from the opponent. Each message is validated for sender and phase before applying; invalid messages are ignored and returned as `false`:
    - `ready` → opponent stage `'ready'`; start if both.
    - `move {from,to}` → only if `pub.phase==='play'`, `pub.turn !== me`, `pub.pending === null`, and the piece at `from` is the opponent's. If `pub.lastMove?.challengeable` (our move being implicitly accepted) → `acceptLastMove`. Then `applyMove`.
    - `captured {id,type}` → only if `pub.lastMove.capturedId === id` and `lost` entry type is null → `revealLost`, `transform` our mover if we own it.
    - `challenge` → only if `pub.lastMove?.challengeable` and we own the mover → `answerChallenge()`.
    - `verdict {legal,type}` → only if `pub.pending==='awaitVerdict'` → `resolveLegal`/`resolveBluff`, clear pending (resolveBluff sets `penaltyPick`); if legal and the challenged move captured our piece, `acceptCapture()` (we are the defender and we own it).
    - `penalty {id}` → only if `pub.pending==='penaltyPick'` and `pub.turn !== me` and `id` is ours and on board → `applyPenalty(pub, id, priv[me][id])`, `send({t:'removed', id, type})`.
    - `removed {id,type}` → only if `pub.pending==='awaitRemoved'` → `applyPenalty`.
    - `new` → reset.
  - `outstanding()` → the message this client is still waiting on a reply for, to re-send after reconnect: `{t:'challenge'}` if `pending==='awaitVerdict'`, `{t:'penalty', id}` if `pending==='awaitRemoved'` (store the id as `pub.penaltyId` when sending), else `null`.
  - `snapshot()` → `{ pub, priv, me, setupColor }` (JSON-safe). `static restore(data, { send, onChange })`.
  - `syncFrom(pub)` → adopt a newer public state (`pub.version > this.pub.version`), keep `priv`.
- Message envelope (`seq`) is the network layer's job (Task 7), not `Game`'s.

- [ ] **Step 1: Write failing tests** using two linked games:

```js
function pair() {
  const w = new Game({ me: 'w', send: (m) => queue.push(['b', m]) });
  const b = new Game({ me: 'b', send: (m) => queue.push(['w', m]) });
  const queue = []; const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'w' ? w : b).receive(m); } };
  return { w, b, flush };
}
it('only the owner holds identities', () => { const { w, b } = pair(); expect(w.priv.b).toBeNull(); expect(b.priv.w).toBeNull(); });
it('ready messages start play on both sides without sending arrangements', () => {
  const { w, b, flush } = pair(); const sent = []; w.send = (m) => { sent.push(m); b.receive(m); };
  w.readyUp('w'); b.readyUp('b'); flush();
  expect(w.pub.phase).toBe('play'); expect(b.pub.phase).toBe('play'); expect(JSON.stringify(sent)).not.toMatch(/"type"/);
});
it('a move is mirrored; a capture stays pending until defender moves; then captured reveals on both', () => {
  const { w, b, flush } = pair(); w.readyUp('w'); b.readyUp('b'); flush();
  w.move('e2', 'e4'); flush(); b.move('d7', 'd5'); flush(); w.move('e4', 'd5'); flush();
  expect(b.pub.lost.b).toEqual([{ id: 'b11', type: null }]); expect(w.pub.lost.b).toEqual([{ id: 'b11', type: null }]);
  b.move('g8', 'f6'); flush();
  expect(w.pub.lost.b[0].type).toBe('p'); expect(b.pub.lost.b[0].type).toBe('p'); expect(w.pub.lastMove.from).toBe('g8');
});
it('bluff challenge over the wire: verdict, penalty, removed; identities only in those messages', () => {
  const { w, b, flush } = pair(); const wire = []; const origB = b.send; b.send = (m) => { wire.push(m); origB(m); }; const origW = w.send; w.send = (m) => { wire.push(m); origW(m); };
  w.readyUp('w'); b.readyUp('b'); flush();
  w.move('b1', 'b3'); flush(); b.challenge(); expect(b.pub.pending).toBe('awaitVerdict'); flush();
  expect(b.pub.lost.w).toEqual([{ id: 'w1', type: 'n' }]); expect(b.pub.pending).toBe('penaltyPick'); expect(w.pub.pending).toBe('penaltyPick');
  b.pickPenalty('w0'); expect(b.pub.pending).toBe('awaitRemoved'); flush();
  expect(b.pub.lost.w).toContainEqual({ id: 'w0', type: 'r' }); expect(w.pub.pieces.w0.square).toBeNull(); expect(b.pub.pending).toBeNull();
  const withType = wire.filter((m) => 'type' in m).map((m) => m.t); expect(new Set(withType)).toEqual(new Set(['verdict', 'removed']));
});
it('legal challenge of a king capture ends the game on both sides', () => {
  const { w, b, flush } = pair(); b.swap('b', 'e8', 'd7'); w.readyUp('w'); b.readyUp('b'); flush();
  for (const [f, t] of [['e2','e4'],['a7','a6'],['e4','e5'],['a6','a5'],['e5','e6'],['a5','a4'],['e6','d7']]) { (w.pub.turn === 'w' ? w : b).move(f, t); flush(); }
  b.challenge(); flush();
  expect(w.pub.phase).toBe('over'); expect(b.pub.phase).toBe('over'); expect(w.pub.winner).toBe('w');
});
it('duplicate and out-of-turn messages are ignored (Review Focus 2)', () => {
  const { w, b, flush } = pair(); w.readyUp('w'); b.readyUp('b'); flush();
  w.move('e2', 'e4'); flush();
  expect(b.receive({ t: 'move', from: 'e2', to: 'e4' })).toBe(false);           // duplicate: e2 is empty now
  expect(b.receive({ t: 'move', from: 'd2', to: 'd4' })).toBe(false);           // not white's turn
  expect(b.receive({ t: 'captured', id: 'b11', type: 'q' })).toBe(false);       // nothing captured
  expect(b.pub.version).toBe(w.pub.version);
});
it('outstanding() names the unanswered request (Review Focus 5)', () => {
  const { w, b, flush } = pair(); w.readyUp('w'); b.readyUp('b'); flush();
  w.move('b1', 'b3'); flush(); b.challenge(); expect(b.outstanding()).toEqual({ t: 'challenge' }); flush();
  b.pickPenalty('w0'); expect(b.outstanding()).toEqual({ t: 'penalty', id: 'w0' }); flush(); expect(b.outstanding()).toBeNull();
});
it('snapshot/restore round-trips and syncFrom adopts newer public state only', () => {
  const { w, b, flush } = pair(); w.readyUp('w'); b.readyUp('b'); flush(); w.move('e2', 'e4'); flush();
  const r = Game.restore(JSON.parse(JSON.stringify(b.snapshot())), {});
  expect(r.me).toBe('b'); expect(r.pub).toEqual(b.pub); expect(r.priv.b).toEqual(b.priv.b); expect(r.priv.w).toBeNull();
  const stale = r.pub; b.move('e7', 'e5'); r.syncFrom(stale); expect(r.pub.lastMove.from).toBe('e2'); r.syncFrom(b.pub); expect(r.pub.lastMove.from).toBe('e7');
});
```

- [ ] **Step 2: Run** → fails. **Step 3: Implement** `receive`, `outstanding`, `snapshot`, `restore`, `syncFrom`. **Step 4: Run all** → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: networked Game protocol, validation, snapshot and sync"`

---

### Task 7: Network and storage modules

**Files:**
- Create: `src/net.js`, `src/storage.js`
- Test: `tests/storage.test.js` (net is manually tested in Task 9)

**Interfaces:**
- `storage.js`: `saveGame(room, color, snapshot)`, `loadGame(room, color)` → snapshot or null, `clearGame(room, color)`. Key `hic:${room}:${color}`. All wrapped in try/catch; failures return null / no-op. Accepts an injectable `store` (defaults to `globalThis.localStorage`) for tests.
- `net.js`: `connect({ room, host, onMessage, onStatus, onOpen })` → `{ send(msg), close() }`.
  - Host creates `new Peer('hic-' + room)`; joiner creates `new Peer()` and connects to `'hic-' + room` with `{ reliable: true }`.
  - Envelope: `send` wraps as `{ seq, ...msg }` with an incrementing counter; `onMessage` is called only for `seq` strictly greater than the last seen from the peer (`hello` and `sync` are exempt from the seq check and reset the counter expectation).
  - Status values passed to `onStatus`: `'connecting' | 'connected' | 'disconnected' | 'error'` plus an optional detail string (PeerJS error type).
  - Reconnect: joiner retries connecting every 3 s while `disconnected` (cap 5 min). Host stays listening and replaces `conn` on a new connection. On every open, call `onOpen()` so `main.js` can run the hello/sync exchange and re-send `outstanding()`.
  - PeerJS error `unavailable-id` on host → status `'error'` with detail `'room taken'`; `peer-unavailable` on joiner → keep retrying (host may not be up yet).

- [ ] **Step 1: Write failing storage tests** (fake store object):

```js
it('save/load/clear round-trip and survive a broken store', () => {
  const store = new Map(); const s = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  saveGame('abc', 'w', { x: 1 }, s); expect(loadGame('abc', 'w', s)).toEqual({ x: 1 }); expect(loadGame('abc', 'b', s)).toBeNull();
  clearGame('abc', 'w', s); expect(loadGame('abc', 'w', s)).toBeNull();
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  expect(() => saveGame('a', 'w', {}, broken)).not.toThrow(); expect(loadGame('a', 'w', broken)).toBeNull();
});
```
- [ ] **Step 2: Run** → fails. **Step 3: Implement both modules.** **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat: PeerJS transport with seq envelope and reconnect; localStorage persistence"`

---

### Task 8: Rendering, markup and styles

**Files:**
- Create: `src/render.js`
- Modify: `index.html`, `src/style.css`

**Interfaces:**
- `render(game, ui)` where `ui = { selected, dests, connection, hotseat }`; `dests` is `game.destinations(selected)`.
  - Board oriented for `game.viewer()`. Own pieces: white card with glyph. Opponent pieces: black blank card; if `faceUp`, black card with white glyph and class `exposed` (add a small corner marker via `::before`). Own face-up pieces also get `exposed`.
  - Destination squares: class `mv` for `legal: true`, class `bluff` for `legal: false` (CSS: amber ring `#ffb000`), never rendered on the opponent's view (they only exist when `selected` is the viewer's piece anyway).
  - Trays: top = opponent's `lost`, bottom = viewer's `lost`. Pending entries (`type === null`) render as a dark card with `?`.
  - In `pending === 'penaltyPick'` with `turn === viewer()`, all opponent on-board pieces get class `pickable`.
  - Status line text:
    - setup: existing pill/hint behaviour, driven by `game.pub.stage[viewer]`.
    - play: `You are White — your move` / `waiting for Black` (online) or `White to move` (hot-seat); `Pick a piece to remove` when penaltyPick; `Waiting for verdict…` when awaitVerdict; `Opponent is deciding…` when it is the opponent's turn and our last move is challengeable (online). Prepend connection text when not `'connected'` (online).
    - over: title via `reason`: `'king-captured'` → `${winner} captured the king`; `'king-penalty'` → `${loser}'s king was taken as a penalty`; `'king-bluffed'` → `${loser}'s king was caught bluffing`.
  - Buttons: `#challenge` visible iff `game.canChallenge()`; first press sets `data-confirm` and label `Challenge — sure?`, second press within 4 s calls `game.challenge()`. `#mirror` visible only in hot-seat during play. `#undo` removed from markup. `#online` hidden once online.
  - A one-time hint `Amber squares are bluffs: moving there breaks your piece's real rules.` shown the first time `dests` contains a bluff (flag in `localStorage` key `hic:hintBluff`, guarded by try/catch).
- `index.html`: remove Undo button, add `<button id="challenge" class="hidden">`, keep everything else; change title/description to "Hidden Identity Chess".
- `style.css`: add `.sq.bluff::before` (amber ring), `.card.exposed::before` (small red dot top-right), `.card.pending` (`?` glyph, dark), `.sq.pickable` (pulsing outline), `.conn` status chip.

- [ ] **Step 1: Implement `render.js`, markup and CSS.** No automated tests; verification is Task 9's manual checklist.
- [ ] **Step 2: Run `npm run build`** → succeeds (main.js still imports chess.js at this point, so wire `render.js` only after Task 9; this step just checks CSS/HTML are valid by building).
- [ ] **Step 3: Commit** — `git commit -m "feat(ui): render module, challenge button, bluff and exposed styles"`

---

### Task 9: Wire main.js, hot-seat and online flows

**Files:**
- Rewrite: `src/main.js`

**Interfaces:**
- Consumes: `Game` (Tasks 5–6), `connect` (Task 7), `saveGame/loadGame/clearGame` (Task 7), `render` (Task 8).
- Behaviour:
  - Boot: read `room` from URL. If present and `loadGame(room, color)` exists for either color → restore and reconnect as that color (host if `'w'`). Else if present → join as `'b'`. Else → hot-seat `new Game()`.
  - Host button: generate 5-char room code, `history.replaceState` to add `?room=` to the URL, create `Game({ me: 'w' })`, `connect({ host: true })`, show invite link.
  - `onOpen`: send `{t:'hello', version: game.pub.version}`. On receiving `hello`: if ours is newer send `{t:'sync', pub: game.pub}`; on receiving `sync` → `game.syncFrom(pub)`. After either side's hello exchange, if `game.outstanding()` → `send` it.
  - Every `onChange`: `saveGame(room, me, game.snapshot())` when online; `render`.
  - Click handling: setup → `swap` on two taps of own squares; play → if `penaltyPick` and tapped opponent piece → `pickPenalty`; else selection/move using `game.destinations`. Ignored while `pending` is `awaitVerdict`/`awaitRemoved`.
  - Hot-seat: after each local `move` (and after a challenge resolution finishes with the same player still to move, no hand-over), show the pass screen titled `${name(turn)} to move`. On pass dismiss, render for the new viewer. The challenge button is shown after the hand-over.
  - New game: `game.newGame()`; online also `clearGame` then re-save.
  - Remove all `chess.js` usage.

- [ ] **Step 1: Rewrite `main.js`.** Run `npm run build` → succeeds; `npm test` → all pass.
- [ ] **Step 2: Manual hot-seat check** (`npm run dev`, one tab): swap two pieces for each side, ready both; move a knight like a rook, hand over, challenge → piece removed, pick penalty, game continues; make a legal move, challenge → piece exposed on both views; bluff-capture onto the king square, challenge → king restored; accept a real king capture by moving → game over screen. Mirror shows all pieces.
- [ ] **Step 3: Manual online check** (two tabs, one in a private window so localStorage differs): host, copy link, open in second tab; arrange and ready both; play the same sequence as Step 2 across tabs; confirm the opponent's view never shows amber squares or glyphs; refresh the joiner tab mid-game → it reconnects and the board is intact; refresh the host tab → same; close one tab → other shows `Opponent disconnected`; reopen the invite link → resumes.
- [ ] **Step 4: Check the wire**: in dev tools on the joiner, log incoming messages for one game; confirm `type` appears only in `captured`, `verdict`, `removed`.
- [ ] **Step 5: Commit** — `git commit -m "feat: wire hot-seat and online Hidden Identity Chess"`

---

### Task 10: Finish

- [ ] **Step 1:** `npm test && npm run build` → green.
- [ ] **Step 2:** Update `index.html` meta description and the on-page hint to describe the variant (one sentence each).
- [ ] **Step 3:** `git push origin main`; confirm Vercel deploy succeeds (or note the URL for the owner to check).
