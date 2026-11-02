# Polish and Fairness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the hot-seat peeking leaks, add resign/draw/confirmations and colour-swapping rematches, make online games verifiable against a setup commitment, add an in-app rules sheet, and finish the small polish items (share, chat queue, unread pill, accessibility, manifest, CI, README).

**Architecture:** Pure rules stay in `src/rules/` (new `hash.js`, `verify.js`; `state.js` grows a full event log, draw offer and two new endings). `src/game.js` gains seat-derived colours, the commitment handshake, resign/draw actions and prefix-checked log sync. UI changes stay in `index.html`, `src/main.js`, `src/render.js`, `src/style.css`; render gets a jsdom test for the leak fix and labels.

**Tech Stack:** Vite 5, vitest 2 (node env; `jsdom` added for two render tests), PeerJS, vanilla DOM. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-polish-and-fairness-design.md`

## Global Constraints

- No identity data (types, salts, arrangements) leaves a client before the game is over. The only messages that carry a `type` remain `verdict` (bluff), `captured`, `removed`; `setup` carries `ids` and `salt` only after `phase === 'over'`.
- Snapshots saved by the current version must restore: every new field defaults in `Game.restore` and `syncFrom`.
- Commitment string is exactly `` `${colour}|${ids}|${salt}` `` where `ids` is the 16 types in piece-index order (e.g. `rnbqkbnrpppppppp`), salt is 32 lowercase hex chars, hash is lowercase hex SHA-256.
- Host is White on even generations, Black on odd; guest the opposite. Seats never change.
- Storage keys: `hic:<room>:host`, `hic:<room>:guest`, `hic:<room>:chat`; legacy `hic:<room>:w` / `:b` are read as a fallback.
- New message shapes: `ready { commit }`, `hello { commit }`, `setup { gen, ids, salt }`, `resign`, `draw { version }`, `drawAccept { version }`, `drawDecline`. `new` accepted only when our phase is `setup` or `over`.
- Node 22 in CI; existing test style (vitest, one small file per feature, dense `it` blocks).
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A `drawAccept` that arrives after the offerer's position changed (stale `version`) must be ignored and play continues — test in Task 4.
2. A `setup` whose salt does not hash to the commitment, or that omits the salt after a commitment was sent, must be reported as a commitment failure, never as "unverified" — test in Task 7.
3. A snapshot saved by the previous version (no `seat`, `salt`, `log`, `drawOffer`) must restore and keep playing — tests in Task 5 and Task 7.
4. An opponent whose first move with a piece is dishonest (only their own client enforces honesty) must be caught by verification — test in Task 6.
5. A sync from a peer whose `pub` has no `log` (older build) must mark the game diverged rather than silently verifying — test in Task 7.

---

### Task 1: Remove the Mirror button and blank the board during hand-over

**Files:**
- Modify: `index.html` (remove `#mirror`), `src/main.js` (remove `ui.mirror` and its handler), `src/render.js`, `src/style.css` (`.pass` opaque, remove `.card.rev`), `README.md` (remove the Mirror line)
- Modify: `package.json` (add `jsdom` devDependency)
- Test: `tests/render.test.js` (new)

**Interfaces:**
- Produces: `tests/render.test.js` exports nothing but defines `mountPage()` (loads `index.html` minus `<script>` tags into `document`) and `hotseat()` (a started hot-seat `Game`) that Task 11 reuses. `render(game, ui, onClick)` honours `ui.passing`: when true, every card is rendered as a blank `.card.foe` with no text and no `exposed` class, and no square carries `sel`, `mv`, `bluff`, `edit` or `pickable`.

- [ ] **Step 1: Add jsdom and write the failing test**

Run: `npm i -D jsdom@25`

```js
// tests/render.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';
import { render } from '../src/render.js';

export function mountPage() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  document.documentElement.innerHTML = html;
}
export const hotseat = () => { const g = new Game(); g.readyUp('w'); g.readyUp('b'); return g; };
const ui = () => ({ selected: null, dests: [], connection: null, confirm: null, showBluffHint: false, passing: false, viewPly: null, showStart: false, overSeen: false });

describe('render', () => {
  beforeEach(mountPage);
  it('shows the viewer’s glyphs normally', () => {
    const g = hotseat(); render(g, ui(), () => {});
    expect(document.querySelector('[data-sq="e1"] .card').textContent).toBe('♚');
    expect(document.querySelector('[data-sq="e8"] .card').textContent).toBe('');
  });
  it('hides every glyph and highlight while the hand-over screen is up', () => {
    const g = hotseat(); g.move('e2', 'e4'); // viewer is now black; black's cards would be face-up
    const u = ui(); u.passing = true; u.selected = 'e7'; u.dests = [{ to: 'e5', legal: true }];
    render(g, u, () => {});
    for (const c of document.querySelectorAll('.card')) { expect(c.textContent).toBe(''); expect(c.classList.contains('foe')).toBe(true); }
    expect(document.querySelectorAll('.sq.sel, .sq.mv, .sq.bluff, .sq.edit, .sq.pickable').length).toBe(0);
  });
  it('has no Mirror button', () => { expect(document.getElementById('mirror')).toBeNull(); });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/render.test.js`
Expected: FAIL (`#mirror` exists; glyphs visible while passing).

- [ ] **Step 3: Implement**

- `render.js`: `const blind = !!ui.passing;` — when blind, skip `sel`/`mv`/`bluff`/`edit`/`pickable` classes and render every card as `card foe` with empty text. Delete the `reveal` constant and the `rev` branch. Delete the `$('mirror').style.display` line.
- `main.js`: delete `mirror` from `ui`, the `$('mirror')` handler and `ui.mirror = false` in `restart`. Rename `confirmChallenge` to `confirm` (`null | 'challenge'`) now, since Task 8 adds more confirmable buttons; `render.js` reads `ui.confirm === 'challenge'`.
- `index.html`: remove the Mirror button.
- `style.css`: `.pass{background:var(--bg)}` with no `backdrop-filter`; remove `.card.rev`. Keep `#over` overrides.
- `README.md`: delete the "Mirror the board" feature line.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: all pass (119 + 3).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix: remove the hot-seat reveal button and blank the board during hand-over"
```

---

### Task 2: State reducers: event log, draw offer, resign and draw endings

**Files:**
- Modify: `src/rules/state.js`
- Test: `tests/log.test.js` (new), `tests/state.test.js` (extend)

**Interfaces:**
- Produces, in `src/rules/state.js`:
  - `createState()` gains `log: []`, `drawOffer: null`.
  - `applyMove` appends `{ k: 'move', from, to, pieceId, capturedId, moverMoved, capturedMoved }`; `resolveLegal` appends `{ k: 'legal' }`; `resolveBluff(state, type)` appends `{ k: 'bluff', pieceId, type }`; `revealLost(state, id, type)` appends `{ k: 'captured', id, type, by }` (`by` from the lost entry); `applyPenalty` appends `{ k: 'penalty', id, type }`.
  - `resignGame(state, color)` → `phase 'over'`, `winner other(color)`, `reason 'resigned'`, appends `{ k: 'resign', color }`, bumps version.
  - `agreeDraw(state)` → `phase 'over'`, `winner null`, `reason 'draw'`, appends `{ k: 'draw' }`, bumps.
  - `offerDraw(state, color)` → `drawOffer = color`, bumps. `declineDraw(state)` → `drawOffer = null`, bumps.
  - `applyMove`, `resolveLegal`, `resolveBluff`, `applyPenalty` and `endGame` set `drawOffer = null`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/log.test.js
import { describe, it, expect } from 'vitest';
import { createState, startPlay, applyMove, resolveLegal, resolveBluff, revealLost, applyPenalty, resignGame, agreeDraw, offerDraw, declineDraw } from '../src/rules/state.js';
const S = () => startPlay(createState());

describe('full event log', () => {
  it('starts empty and records every public event with public data only', () => {
    expect(createState().log).toEqual([]);
    let s = applyMove(S(), 'e2', 'e4'); s = applyMove(s, 'd7', 'd5'); s = applyMove(s, 'e4', 'd5');
    expect(s.log).toEqual([
      { k: 'move', from: 'e2', to: 'e4', pieceId: 'w12', capturedId: null, moverMoved: false, capturedMoved: null },
      { k: 'move', from: 'd7', to: 'd5', pieceId: 'b11', capturedId: null, moverMoved: false, capturedMoved: null },
      { k: 'move', from: 'e4', to: 'd5', pieceId: 'w12', capturedId: 'b11', moverMoved: true, capturedMoved: true },
    ]);
    expect(revealLost(s, 'b11', 'p').log.at(-1)).toEqual({ k: 'captured', id: 'b11', type: 'p', by: 'w12' });
    expect(resolveLegal(s).log.at(-1)).toEqual({ k: 'legal' });
    const bluff = resolveBluff(s, 'p'); expect(bluff.log.at(-1)).toEqual({ k: 'bluff', pieceId: 'w12', type: 'p' });
    expect(applyPenalty(bluff, 'w0', 'r').log.at(-1)).toEqual({ k: 'penalty', id: 'w0', type: 'r' });
  });
  it('is never truncated like history', () => {
    let s = S(); for (const [f, t] of [['e2','e4'],['a7','a6'],['e4','e5'],['a6','a5']]) s = applyMove(s, f, t);
    expect(s.history.length).toBe(2); expect(s.log.length).toBe(4);
  });
});

describe('resign and draw', () => {
  it('resignGame ends the game for the other side and logs it', () => {
    const s = resignGame(S(), 'w');
    expect(s).toMatchObject({ phase: 'over', winner: 'b', reason: 'resigned', pending: null, drawOffer: null });
    expect(s.log.at(-1)).toEqual({ k: 'resign', color: 'w' }); expect(s.version).toBe(2);
  });
  it('agreeDraw ends with no winner', () => {
    const s = agreeDraw(offerDraw(S(), 'w'));
    expect(s).toMatchObject({ phase: 'over', winner: null, reason: 'draw', drawOffer: null }); expect(s.log.at(-1)).toEqual({ k: 'draw' });
  });
  it('offer, decline and any play event clear the offer', () => {
    const o = offerDraw(S(), 'b'); expect(o.drawOffer).toBe('b'); expect(o.version).toBe(2);
    expect(declineDraw(o).drawOffer).toBeNull();
    expect(applyMove(o, 'e2', 'e4').drawOffer).toBeNull();
    const m = applyMove(applyMove(applyMove(S(), 'e2', 'e4'), 'a7', 'a6'), 'e4', 'e6');
    expect(resolveLegal(offerDraw(m, 'w')).drawOffer).toBeNull();
    expect(resolveBluff(offerDraw(m, 'w'), 'p').drawOffer).toBeNull();
    expect(applyPenalty(offerDraw(m, 'w'), 'w0', 'r').drawOffer).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/log.test.js`
Expected: FAIL (`log` undefined, functions not exported).

- [ ] **Step 3: Implement in `src/rules/state.js`**

Add `const logEvent = (s, e) => { s.log = [...(s.log || []), e]; return s; };` and call it in the five existing reducers (in `revealLost`, read `by` from the lost entry). Add the four new reducers with the signatures above; `endGame` also sets `drawOffer = null`.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: all pass. (`tests/state.test.js` may compare whole states with `toEqual`; if so add `log: []`/`drawOffer: null` expectations there.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(rules): full event log, draw offer, resign and draw endings"
```

---

### Task 3: SHA-256 and the commitment string

**Files:**
- Create: `src/rules/hash.js`, `src/rules/verify.js` (commitment only; `verify()` comes in Task 6)
- Test: `tests/hash.test.js` (new)

**Interfaces:**
- Produces: `sha256(text: string): string` (lowercase hex, synchronous, UTF-8 input) in `hash.js`; `idsString(ids, color): string` (16 types in index order `${color}0`..`${color}15`) and `commitment(color, ids, salt): string` = `sha256(`${color}|${idsString(ids, color)}|${salt}`)` in `verify.js`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/hash.test.js
import { describe, it, expect } from 'vitest';
import { sha256 } from '../src/rules/hash.js';
import { commitment, idsString } from '../src/rules/verify.js';
import { standardIdentity } from '../src/rules/identity.js';

describe('sha256', () => {
  it('matches the standard vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});
describe('commitment', () => {
  it('serialises ids in index order and hashes colour|ids|salt', () => {
    expect(idsString(standardIdentity('w'), 'w')).toBe('rnbqkbnrpppppppp');
    const salt = '00112233445566778899aabbccddeeff';
    expect(commitment('w', standardIdentity('w'), salt)).toBe(sha256(`w|rnbqkbnrpppppppp|${salt}`));
    expect(commitment('w', standardIdentity('w'), salt)).not.toBe(commitment('w', standardIdentity('w'), 'ff' + salt.slice(2)));
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/hash.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`hash.js`: a standard synchronous SHA-256 (FIPS 180-4) over `new TextEncoder().encode(text)`: pad to 512-bit blocks, 64-round compression with the K constants, `>>> 0` arithmetic, output eight 32-bit words as 64 hex chars. `verify.js`: `idsString` and `commitment` as above.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run tests/hash.test.js` → PASS.

```bash
git add -A && git commit -m "feat(rules): synchronous sha256 and setup commitment"
```

---

### Task 4: Resign and draw in `Game` (hot-seat and online protocol)

**Files:**
- Modify: `src/game.js`, `src/render.js` (`overTitle` only)
- Test: `tests/resign-draw.test.js` (new)

**Interfaces:**
- Consumes: Task 2 reducers.
- Produces, on `Game`:
  - `resign()` — hot-seat: `viewer()` resigns; online: `me` resigns; sends `{ t: 'resign' }`. Only in `phase 'play'`.
  - `canOfferDraw()` → `!!me && phase === 'play' && pending === null && drawOffer === null`.
  - `offerDraw()` → sends `{ t: 'draw', version }` (version before applying), applies `offerDraw(pub, me)`.
  - `acceptDraw()` (when `drawOffer === other(me)`) → sends `{ t: 'drawAccept', version }` (version before applying), applies `agreeDraw`.
  - `declineDraw()` → sends `{ t: 'drawDecline' }`, applies `declineDraw`.
  - `agreeDraw()` — hot-seat only, applies `agreeDraw` directly.
  - `canAct()` additionally requires `pub.drawOffer !== this.me` (online).
  - `handle`: `resign` (phase play → `resignGame(pub, opp)`); `draw` (play, pending null, drawOffer null, `msg.version === pub.version` → `offerDraw(pub, opp)`); `drawAccept` (play, `drawOffer === me`, `msg.version === pub.version` → `agreeDraw`); `drawDecline` (`drawOffer === me` → `declineDraw`); `new` only when phase is `setup` or `over`.
  - `overTitle(pub)` in `render.js`: `'White resigned'` / `'Black resigned'` (the loser), `'Draw by agreement'`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/resign-draw.test.js
import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { overTitle } from '../src/render.js';

function pair() {
  const queue = [];
  const w = new Game({ me: 'w', send: (m) => queue.push(['b', m]) });
  const b = new Game({ me: 'b', send: (m) => queue.push(['w', m]) });
  const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'w' ? w : b).receive(m); } };
  const start = () => { w.readyUp('w'); b.readyUp('b'); flush(); };
  return { w, b, flush, start, queue };
}
const hotseat = () => { const g = new Game(); g.readyUp('w'); g.readyUp('b'); return g; };

describe('resign', () => {
  it('hot-seat: the player holding the screen resigns', () => {
    const g = hotseat(); g.move('e2', 'e4'); g.resign();
    expect(g.pub).toMatchObject({ phase: 'over', winner: 'w', reason: 'resigned' }); expect(overTitle(g.pub)).toBe('Black resigned');
  });
  it('online: resign ends the game on both sides even while a challenge is pending', () => {
    const { w, b, flush, start } = pair(); start();
    w.move('e2', 'e4'); flush(); b.move('a7', 'a6'); flush(); w.move('e4', 'e6'); flush(); b.challenge(); // pending on b, verdict not yet flushed
    b.resign(); flush();
    expect(b.pub).toMatchObject({ phase: 'over', winner: 'w', reason: 'resigned', pending: null }); expect(w.pub.phase).toBe('over'); expect(b.outstanding()).toBeNull();
  });
  it('resign is ignored outside play', () => {
    const g = new Game(); g.resign(); expect(g.pub.phase).toBe('setup');
    const { w, b, start } = pair(); start(); expect(b.receive({ t: 'resign' })).toBe(true); expect(b.receive({ t: 'resign' })).toBe(false);
  });
});

describe('draw by agreement', () => {
  it('offer, accept: over with no winner on both sides', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    expect(w.canOfferDraw()).toBe(true); w.offerDraw(); expect(w.canAct()).toBe(false); expect(w.canOfferDraw()).toBe(false); flush();
    expect(b.pub.drawOffer).toBe('w'); b.acceptDraw(); flush();
    for (const g of [w, b]) expect(g.pub).toMatchObject({ phase: 'over', winner: null, reason: 'draw' });
    expect(overTitle(w.pub)).toBe('Draw by agreement');
  });
  it('decline clears the offer and the offerer can act again', () => {
    const { w, b, flush, start } = pair(); start(); w.offerDraw(); flush(); b.declineDraw(); flush();
    expect(w.pub.drawOffer).toBeNull(); expect(w.canAct()).toBe(true); expect(b.pub.version).toBe(w.pub.version);
  });
  it('moving instead of answering clears the offer on both sides', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush(); w.offerDraw(); flush();
    b.move('e7', 'e5'); flush(); expect(w.pub.drawOffer).toBeNull(); expect(b.pub.drawOffer).toBeNull(); expect(w.canAct()).toBe(true);
  });
  it('the offerer cannot move, and an offer that crossed a move on the wire is ignored (stale version)', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    b.offerDraw(); b.move('e7', 'e5'); expect(b.pub.pieces.b12.square).toBe('e7');
    const { w: w2, start: s2 } = pair(); s2();
    expect(w2.receive({ t: 'draw', version: w2.pub.version - 1 })).toBe(false); expect(w2.pub.drawOffer).toBeNull();
    expect(w2.receive({ t: 'draw', version: w2.pub.version })).toBe(true); expect(w2.pub.drawOffer).toBe('b');
  });
  it('drawAccept with a stale version or without an offer is ignored (Review Focus 1)', () => {
    const { w, b, flush, start } = pair(); start();
    expect(w.receive({ t: 'drawAccept', version: w.pub.version })).toBe(false); // no offer
    w.offerDraw(); flush();
    expect(w.receive({ t: 'drawAccept', version: w.pub.version - 1 })).toBe(false); expect(w.pub.phase).toBe('play');
    expect(w.receive({ t: 'drawAccept', version: w.pub.version })).toBe(true); expect(w.pub.phase).toBe('over');
  });
  it('cannot offer while something is pending; hot-seat agrees directly', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush(); b.move('a7', 'a6'); flush(); w.move('e4', 'e6'); flush(); b.challenge();
    expect(b.canOfferDraw()).toBe(false); expect(b.receive({ t: 'draw', version: b.pub.version })).toBe(false);
    const g = hotseat(); g.agreeDraw(); expect(g.pub).toMatchObject({ phase: 'over', winner: null, reason: 'draw' });
  });
});

describe('new game is only accepted outside play', () => {
  it('a stray new mid-game is ignored; new at game over resets', () => {
    const { w, b, flush, start } = pair(); start(); w.move('e2', 'e4'); flush();
    expect(b.receive({ t: 'new' })).toBe(false); expect(b.pub.phase).toBe('play');
    w.resign(); flush(); expect(b.receive({ t: 'new' })).toBe(true); expect(b.pub.phase).toBe('setup');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/resign-draw.test.js`
Expected: FAIL (`resign is not a function`).

- [ ] **Step 3: Implement in `src/game.js` and `overTitle` in `src/render.js`**

Follow the Interfaces block. `shareSetup()` already runs from `changed()` whenever phase is `over`, so resignation and draws reveal setups with no extra work.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: all pass except "new message resets the other side to setup" in `tests/game-online.test.js`, which sends `new` mid-play; change it to resign first (`w.resign(); flush();`) before `w.newGame()`. (The review-fixes "New game pressed while disconnected" test goes through `syncFrom`, not `new`, and still passes.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: resign and draw by agreement; new game only outside play"
```

---

### Task 5: Seats, colour-swapping rematches, seat-keyed storage and chat

**Files:**
- Modify: `src/game.js`, `src/chat.js`, `src/main.js`
- Test: `tests/seat.test.js` (new), `tests/chat.test.js`, `tests/game-online.test.js`, `tests/review-fixes.test.js`

**Interfaces:**
- Produces:
  - `colorFor(seat, gen)` exported from `game.js`: `'host'` → `gen % 2 === 0 ? 'w' : 'b'`; `'guest'` → the other.
  - `new Game({ seat, me, send, onChange })`: if `seat` given, `me = colorFor(seat, 0)`; if only `me` given, `seat = me === 'w' ? 'host' : 'guest'`; neither → hot-seat (`seat` and `me` null). `reset(gen)` sets `this.me = colorFor(this.seat, gen)` when `seat` is set.
  - `snapshot()` includes `seat`. `Game.restore(data)` uses `data.seat ?? ((data.me === 'w') === (data.pub.gen % 2 === 0) ? 'host' : 'guest')`.
  - `chat.js`: `isChatMessage(msg, mySeat)` accepts `from ∈ {'host','guest'}` and `from !== mySeat`. `chatMessage(text, from)` unchanged.
  - `main.js`: `me` variable becomes `seat`; `game.me` is read wherever a colour is needed; `connect({ host: seat === 'host' })`; `saveGame(room, seat, …)`; boot loads `host`, `guest`, then legacy `w`, `b` keys, picks the newest by `(gen, version)`, and clears legacy keys after restoring from one. Chat alignment: `m.from === seat || (m.from === 'w' && seat === 'host') || (m.from === 'b' && seat === 'guest')` counts as "me".

- [ ] **Step 1: Write the failing tests**

```js
// tests/seat.test.js
import { describe, it, expect } from 'vitest';
import { Game, colorFor } from '../src/game.js';

function pair() {
  const queue = [];
  const h = new Game({ seat: 'host', send: (m) => queue.push(['g', m]) });
  const g = new Game({ seat: 'guest', send: (m) => queue.push(['h', m]) });
  const flush = () => { while (queue.length) { const [to, m] = queue.shift(); (to === 'h' ? h : g).receive(m); } };
  const start = () => { h.readyUp(h.me); g.readyUp(g.me); flush(); };
  return { h, g, flush, start, queue };
}

describe('seats and colour swap', () => {
  it('colorFor alternates with the generation', () => {
    expect(colorFor('host', 0)).toBe('w'); expect(colorFor('host', 1)).toBe('b'); expect(colorFor('guest', 0)).toBe('b'); expect(colorFor('guest', 3)).toBe('w');
  });
  it('a Game built from a seat starts with the right colour; me-only keeps working', () => {
    const { h, g } = pair(); expect(h.me).toBe('w'); expect(g.me).toBe('b'); expect(h.seat).toBe('host');
    const w = new Game({ me: 'w' }); expect(w.seat).toBe('host'); expect(new Game({ me: 'b' }).seat).toBe('guest'); expect(new Game().seat).toBeNull();
  });
  it('play again swaps colours and identities on both sides', () => {
    const { h, g, flush, start } = pair(); start(); h.move('e2', 'e4'); flush(); h.resign(); flush();
    h.newGame(); flush();
    expect(h.pub.gen).toBe(1); expect(h.me).toBe('b'); expect(g.me).toBe('w');
    expect(h.priv.b.b4).toBe('k'); expect(h.priv.w).toBeNull(); expect(g.priv.w.w4).toBe('k');
    g.readyUp('w'); h.readyUp('b'); flush(); expect(h.pub.phase).toBe('play');
    g.move('e2', 'e4'); flush(); expect(h.pub.pieces.w12.square).toBe('e4');
  });
  it('a sync onto a newer generation recomputes the colour', () => {
    const { h, g, flush, start, queue } = pair(); start(); h.resign(); flush(); g.newGame(); queue.length = 0;
    h.syncFrom(g.pub); expect(h.pub.gen).toBe(1); expect(h.me).toBe('b');
  });
  it('snapshots carry the seat; legacy snapshots derive it from colour and generation', () => {
    const { h } = pair(); const snap = JSON.parse(JSON.stringify(h.snapshot())); expect(snap.seat).toBe('host');
    expect(Game.restore(snap, {}).seat).toBe('host');
    delete snap.seat; expect(Game.restore(snap, {}).seat).toBe('host');
    snap.pub.gen = 1; snap.me = 'b'; expect(Game.restore(snap, {}).seat).toBe('host');
    snap.pub.gen = 1; snap.me = 'w'; expect(Game.restore(snap, {}).seat).toBe('guest');
  });
});
```

Update `tests/chat.test.js`: use `'host'`/`'guest'` for `from` and the second argument of `isChatMessage`; add `expect(isChatMessage({ t: 'chat', text: 'yo', from: 'w', ts: 1 }, 'guest')).toBe(false)`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/seat.test.js tests/chat.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `game.js`, `chat.js`, `main.js` per the Interfaces block**

- [ ] **Step 4: Run the whole suite and fix colour assertions**

Run: `npx vitest run`
Expected: the two tests that assert colours after `newGame()` (`tests/game-online.test.js` "new message resets the other side to setup" and `tests/review-fixes.test.js` "a New game pressed while disconnected…") now fail on `priv.b.b4` / `priv.w.w4`; update them to assert the swapped colour (`b.me === 'w'`, `b.priv.w.w4 === 'k'`; `w.me === 'b'`, `w.priv.b.b4 === 'k'`). Everything else passes.

- [ ] **Step 5: Smoke the boot path in the browser**

Run: `npm run dev`, open the URL, click Play online, open the invite link in a private window, play two moves, refresh both tabs, resign, Play again, confirm the status line shows the host as Black. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: seats with colour-swapping rematches; seat-keyed storage and chat"
```

---

### Task 6: `verify()`: replay the log against a revealed setup

**Files:**
- Modify: `src/rules/verify.js`
- Test: `tests/verify.test.js` (new)

**Interfaces:**
- Consumes: `patternMoves`, `rankOf` from `geometry.js`; `startSquare` from `state.js`; log entry shapes from Task 2.
- Produces: `verify(log, setup, color)` → `{ ok: true }` or `{ ok: false, why, ply }` with `why ∈ 'verdict' | 'bluff' | 'captured' | 'penalty' | 'first-move'` and `ply` the index into `log` of the offending entry. `setup` is the opponent's revealed identities (`{ [`${color}${i}`]: type }`), `color` the opponent's colour.

Algorithm (the tests do not determine it):
- `pos`: every id → `{ square: startSquare(id), moved: false }`. `ids`: copy of `setup`. `last`: the most recent `move` entry plus `movedAs` and an occupancy-before function.
- `move`: build `occ` from `pos` for the mover's colour (`'own'` / `'enemy'` / `null`) **before** mutating. If `pieceId` is `color`'s: `movedAs = ids[pieceId]`; if `moverMoved === false` and `!patternMoves(movedAs, color, from, occ, false).includes(to)` → fail `'first-move'`; then promote (`movedAs === 'p'` and `rankOf(to)` is the far rank → `ids[pieceId] = 'q'`). Mutate: captured piece's square → null, mover → `to`, `moved = true`.
- `legal`: if `last.pieceId` is `color`'s and `!patternMoves(last.movedAs, color, last.from, last.occ, last.moverMoved).includes(last.to)` → fail `'verdict'`.
- `bluff`: if `pieceId` is `color`'s and `type !== last.movedAs` → fail `'bluff'`. Undo: mover's square → null; if `last.capturedId`, restore it to `last.to` with `moved = last.capturedMoved`.
- `captured`: if `id` is `color`'s and `ids[id] !== type` → fail `'captured'`. If `by` is `color`'s and `ids[by] === 'p'` and `type !== 'p'` → `ids[by] = type`.
- `penalty`: if `id` is `color`'s and `ids[id] !== type` → fail `'penalty'`. Square → null.
- `resign`, `draw`: nothing.

- [ ] **Step 1: Write the failing tests**

```js
// tests/verify.test.js
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
    expect(g.pub.log.map((e) => e.k)).toEqual(['move','move','move','legal','penalty','move','move','move','captured','move','bluff','penalty']);
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
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/verify.test.js`
Expected: FAIL (`verify` not exported).

- [ ] **Step 3: Implement `verify` per the algorithm above**

- [ ] **Step 4: Run and commit**

Run: `npx vitest run tests/verify.test.js` → PASS.

```bash
git add -A && git commit -m "feat(rules): verify an opponent's log against their revealed setup"
```

---

### Task 7: Commitment handshake, private commitment state, prefix-checked log sync

**Files:**
- Modify: `src/game.js`
- Test: `tests/commit.test.js` (new), `tests/setup-reveal.test.js` (one assertion on `setup` shape)

**Interfaces:**
- Consumes: `commitment`, `verify` (Tasks 3, 6).
- Produces, on `Game` (all private, never in `pub`): `salt` (32 hex, online only, new per `reset`), `commit` (own hash once ready, else null), `oppCommit` (write-once per generation), `oppSalt`, `logTainted` (bool). All in `snapshot()`, defaulted in `restore` (`salt` regenerated if missing and online; others null/false).
  - `readyUp(color)` online: `this.commit = commitment(me, priv[me], salt)`; sends `{ t: 'ready', commit }`.
  - `helloMessage()` gains `commit: this.commit` (null until ready).
  - `handle('ready')` and `onHello` (same generation): if `typeof msg.commit === 'string' && !this.oppCommit` → store. A `ready` without a commit is still accepted.
  - `shareSetup` sends `{ t: 'setup', gen, ids, salt }`.
  - `handle('setup')`: also stores `oppSalt = typeof msg.salt === 'string' ? msg.salt : null`.
  - `syncFrom(pub)`: after the generation check, `tainted` if our current `log` is not an entry-wise prefix (`JSON.stringify` equality) of `pub.log ?? []`; adopt the incoming `pub` either way with `log` defaulted to `[]` and `drawOffer` to `null`.
  - `verification()` → `null` while `setups[opp]` is null; else `{ ok: null, why: 'diverged' }` if `logTainted`; else `{ ok: null, why: 'no-commit' }` if `!oppCommit`; else `{ ok: false, why: 'commitment' }` if `!oppSalt` or `commitment(opp, setups[opp], oppSalt) !== oppCommit`; else `verify(pub.log, setups[opp], opp)`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/commit.test.js
import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { commitment } from '../src/rules/verify.js';
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
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/commit.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement per the Interfaces block**

`randomSalt()` uses `globalThis.crypto.getRandomValues(new Uint8Array(16))` → hex. In `handle('ready')` the existing early return for `stage[opp] === 'ready'` stays (so the write-once test's first assertion holds).

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: all pass. In `tests/setup-reveal.test.js` the "reconnect re-sends the arrangement" test feeds `setup` messages without `salt`; they must still return `true`/`false` as before (salt is optional on receipt).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: setup commitment, private verification state, prefix-checked log sync"
```

---

### Task 8: UI for resign, draw, confirmations, verification line

**Files:**
- Modify: `index.html`, `src/main.js`, `src/render.js`, `src/style.css`
- Test: `tests/render.test.js` (extend)

**Interfaces:**
- Consumes: Task 4 and Task 7 `Game` methods.
- Produces: buttons `#resign`, `#draw` (label `Offer draw` online, `Agree draw` hot-seat), banner `#draw-banner` with `#draw-accept` / `#draw-decline`, `#over-verify` line in the over panel. `ui.confirm ∈ null | 'challenge' | 'resign' | 'draw' | 'new'` with one shared 4 s timer; the confirming button's label becomes `<Label> — sure?` and gets `data-confirm`.

- [ ] **Step 1: Write the failing render tests**

```js
// append to tests/render.test.js
describe('resign, draw and verification UI', () => {
  beforeEach(mountPage);
  it('hot-seat shows Resign and Agree draw during play only', () => {
    const g = new Game(); render(g, ui(), () => {});
    expect(document.getElementById('resign').style.display).toBe('none');
    const h = hotseat(); render(h, ui(), () => {});
    expect(document.getElementById('resign').style.display).toBe(''); expect(document.getElementById('draw').textContent).toBe('Agree draw');
  });
  it('online: the draw banner appears for the receiver and the offerer is told to wait', () => {
    const w = new Game({ me: 'w' }); const b = new Game({ me: 'b', send: (m) => w.receive(m) }); w.send = (m) => b.receive(m);
    w.readyUp('w'); b.readyUp('b'); w.offerDraw();
    render(b, ui(), () => {}); expect(document.getElementById('draw-banner').classList.contains('hidden')).toBe(false);
    render(w, ui(), () => {}); expect(document.getElementById('draw-banner').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('status').textContent).toMatch(/draw/i);
  });
  it('the over panel shows the verification result', () => {
    const w = new Game({ me: 'w' }); const b = new Game({ me: 'b', send: (m) => w.receive(m) }); w.send = (m) => b.receive(m);
    w.readyUp('w'); b.readyUp('b'); w.resign();
    render(b, ui(), () => {}); expect(document.getElementById('over-verify').textContent).toBe('Opponent’s game verified');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/render.test.js` → FAIL.

- [ ] **Step 3: Implement**

- `index.html`: in `.controls`, replace the button row with `#challenge`, `#resign`, `#draw`, `#online`, `#new`. Add `<div id="draw-banner" class="banner hidden"><span>Opponent offers a draw</span><button id="draw-accept" class="primary">Accept</button><button id="draw-decline">Decline</button></div>` above the controls. Add `<p id="over-verify" class="verify"></p>` inside the over panel under `#over-note`.
- `main.js`: `function confirmTap(kind, then)` — first tap sets `ui.confirm = kind`, redraws and arms the 4 s reset; second tap clears and calls `then()`. Wire `#challenge` (existing behaviour), `#resign` → `game.resign()`, `#draw` → hot-seat `game.agreeDraw()` / online `game.offerDraw()` (no confirm online), `#new` → confirm only when `phase === 'play'`. `#draw-accept` → `game.acceptDraw()`, `#draw-decline` → `game.declineDraw()`. Hot-seat: after `resign`/`agreeDraw` no hand-over is needed (game over).
- `render.js`: show `#resign` only in play; `#draw` label by mode, hidden online when `!game.canOfferDraw()` and `pub.drawOffer` is not ours; banner visible when `pub.drawOffer === other(me)`; status `Draw offered — waiting for their answer` when `pub.drawOffer === me`; `#new` hidden online during play. Over panel: `const v = game.verification()`; copy: `ok: true` → `Opponent’s game verified`; `why 'commitment'` → `Opponent’s reveal does not match their commitment`; other `ok: false` → `Opponent lied on move N: <claim>` where N counts `move` entries up to `ply` and claim is `false verdict` / `false bluff reveal` / `false capture reveal` / `false penalty reveal` / `dishonest first move`; `why 'no-commit'` → `Opponent sent no commitment, so their game could not be verified.`; `why 'diverged'` → `States diverged on reconnect, so the opponent’s game could not be verified.`; `null` → `Waiting for the opponent’s reveal…` online, empty hot-seat. Classes `verify good` / `verify bad` / `verify muted`.
- `style.css`: `.banner` (panel look, row, gap 8px), `.verify.good{color:var(--good)}`, `.verify.bad{color:var(--bad)}`, `.verify.muted{color:var(--muted)}`.

- [ ] **Step 4: Run the suite and smoke in the browser**

Run: `npx vitest run` → all pass. Then `npm run dev`: play a hot-seat game, resign with two taps, agree a draw, confirm New game needs two taps mid-game; online in two windows: offer, decline, offer, accept; resign; check the verification line reads "Opponent’s game verified" on both.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): resign, draw offers, two-tap confirmations, verification line"
```

---

### Task 9: How to play sheet

**Files:**
- Modify: `index.html`, `src/main.js`, `src/style.css`

**Interfaces:**
- Produces: `<dialog id="help">` with `#help-close`; `#help-btn` in `.titlebar`; `localStorage` flag `hic:rulesSeen` set on close; `openHelp()` in `main.js` called on boot when the flag is absent.

- [ ] **Step 1: Implement**

- `index.html`: `<button id="help-btn" class="ghost" aria-label="How to play">How to play</button>` in the titlebar (before `#conn`). The dialog body, in this order with the glyphs `♚♛♜♝♞♟` where a piece is named: **Setup** (arrange your 16 pieces on your two ranks in any order; the opponent sees blank cards), **Moving** (move a piece anywhere *some* chess piece could go; matching its true identity is honest, anything else is a bluff; a piece's first move must be honest), **Pawns** (one forward, two from the pawn rank on their first move, capture diagonally; a pawn that captures a non-pawn becomes that piece; reaching the far rank makes it a queen), **Capturing** (captured cards stay hidden until the capture is accepted by the opponent moving on or losing a challenge), **Challenging** (before your move you may challenge the last move; a caught bluff loses that piece plus one more of your choosing; a wrong challenge costs you a piece of their choosing), **Winning** (capture the king and have it accepted, or take it as a penalty; resign or agree a draw any time; both setups are revealed at the end and online games are verified against a commitment). About 180 words.
- `main.js`: `openHelp()` → `dialog.showModal()`; close on `#help-close`, Escape (native), backdrop click (`dialog.onclick = (e) => { if (e.target === dialog) dialog.close(); }`); on `close` set the flag. On boot: if the flag is absent, `openHelp()` after the first draw.
- `style.css`: `dialog#help{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:18px;padding:22px 24px;max-width:480px;width:calc(100% - 32px)}`, `dialog::backdrop{background:#0a0b0eb8}`, `button.ghost{background:transparent;padding:6px 10px;font-size:.78rem}`, headings `h3{margin:12px 0 4px;font-size:.85rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}`, body text `.85rem`.

- [ ] **Step 2: Verify in the browser**

`npm run dev`, clear site data, load: the sheet opens; Escape closes it; reload: it stays closed; the button reopens it; on a phone-width window the sheet fits with 16 px gutters.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(ui): how-to-play sheet, shown once to newcomers"
```

---

### Task 10: Share, copy reset, offline chat queue, unread pill

**Files:**
- Modify: `index.html`, `src/main.js`, `src/chat.js`, `src/style.css`
- Test: `tests/chat.test.js` (extend)

**Interfaces:**
- Produces in `chat.js`: `flushOutbox(outbox, send)` → sends each queued message in order with `send(m)` and returns the messages that were **not** accepted (`send` returning false stops the flush and the rest are returned). `main.js` keeps `let outbox = []` and a `Set` of pending `ts` values rendered with class `msg pending`.
- `#share` button (hidden unless `navigator.share`), `#copy` label reverts after 1500 ms, `#chat-new` pill.

- [ ] **Step 1: Write the failing test**

```js
// add to tests/chat.test.js
it('flushOutbox sends in order and returns what could not be sent', () => {
  const sent = []; const msgs = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
  expect(flushOutbox(msgs, (m) => { sent.push(m.text); return true; })).toEqual([]); expect(sent).toEqual(['a', 'b', 'c']);
  let n = 0; expect(flushOutbox(msgs, () => ++n < 2)).toEqual([{ text: 'b' }, { text: 'c' }]);
});
```

- [ ] **Step 2: Run to see it fail, then implement**

Run: `npx vitest run tests/chat.test.js` → FAIL. Implement `flushOutbox` in `chat.js`.

- `main.js`: on submit, `addChat(m)`; if `!send(m)` push to `outbox` and mark `pending`. In `onOpen`, `outbox = flushOutbox(outbox, send)` after the hello, un-mark what was sent, redraw. `#share`: shown when `typeof navigator.share === 'function'`; click → `navigator.share({ title: 'Hidden Identity Chess', url }).catch(() => {})`. `#copy`: `setTimeout` 1500 ms to restore `Copy link`. Unread pill: an `IntersectionObserver` on `#chat-log` keeps `chatVisible`; on an incoming chat message when `!chatVisible` show `#chat-new` (`New message ↓`); click scrolls `#chat` into view; the observer hides it when the log becomes visible.
- `index.html`: `<button id="share" class="hidden">Share</button>` next to `#copy`; `<button id="chat-new" class="pill-btn hidden">New message ↓</button>` just above `.controls`.
- `style.css`: `.msg.pending{opacity:.55}`, `.pill-btn{align-self:center;padding:6px 12px;font-size:.78rem}`.

- [ ] **Step 3: Run the suite, smoke, commit**

Run: `npx vitest run` → PASS. Browser: on a phone-width window with a connected opponent, send a chat from the other window and see the pill; tap it; disconnect one side (close the other tab), type two messages, reopen the tab, confirm both arrive in order.

```bash
git add -A && git commit -m "feat(ui): native share, copy reset, chat outbox while disconnected, unread pill"
```

---

### Task 11: Keyboard and screen-reader access to the board

**Files:**
- Modify: `src/render.js`, `src/style.css`, `index.html`
- Test: `tests/render.test.js` (extend)

**Interfaces:**
- Produces: each square is `<button type="button" class="sq …" data-sq aria-label>`; label format `"<square>, <what>"` with what ∈ `your <piece name>` (king/queen/rook/bishop/knight/pawn), `opponent's piece`, `opponent's <piece name> (exposed)`, `hidden piece` (while passing, for every card), `empty`; selected square has `aria-pressed="true"`. `#board` has `role="group" aria-label="Chess board"`; `#status` and `#conn` have `aria-live="polite"`.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/render.test.js
describe('accessibility', () => {
  beforeEach(mountPage);
  it('squares are labelled buttons and the selection is announced', () => {
    const g = hotseat(); const u = ui(); u.selected = 'b1'; render(g, u, () => {});
    const b1 = document.querySelector('[data-sq="b1"]');
    expect(b1.tagName).toBe('BUTTON'); expect(b1.getAttribute('aria-label')).toBe('b1, your knight'); expect(b1.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-sq="e8"]').getAttribute('aria-label')).toBe("e8, opponent's piece");
    expect(document.querySelector('[data-sq="e4"]').getAttribute('aria-label')).toBe('e4, empty');
    expect(document.getElementById('status').getAttribute('aria-live')).toBe('polite');
  });
});
```

- [ ] **Step 2: Run to see it fail, then implement**

`render.js`: create squares with `document.createElement('button')`, `type="button"`, set the label and `aria-pressed`. `index.html`: the `role`/`aria-live` attributes. `style.css`: `.sq,.sq:hover,.sq:active{appearance:none;border:0;padding:0;margin:0;border-radius:0;font:inherit;transform:none;transition:none}` placed after the generic `button` rules, `.sq.dk,.sq.dk:hover{background:var(--dark)}`, `.sq{background:var(--light)}` kept, `.sq:focus-visible{outline:3px solid var(--sel);outline-offset:-3px;z-index:3}`.

- [ ] **Step 3: Run the suite, check the board still looks right in the browser, commit**

```bash
git add -A && git commit -m "feat(ui): board squares are labelled buttons; live status"
```

---

### Task 12: Installable: manifest, icons, meta

**Files:**
- Create: `public/manifest.webmanifest`, `public/icon.svg`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Modify: `index.html`

- [ ] **Step 1: Create the icon and render the PNGs**

`public/icon.svg`: the favicon's SVG with the knight at `font-size="76"` and `y="78"`. Then:

```bash
qlmanage -t -s 512 -o public public/icon.svg && mv public/icon.svg.png public/icon-512.png
sips -z 180 180 public/icon-512.png --out public/apple-touch-icon.png
```

- [ ] **Step 2: Manifest and head tags**

`manifest.webmanifest`: `name "Hidden Identity Chess"`, `short_name "HIC"`, `start_url "/"`, `display "standalone"`, `background_color "#111318"`, `theme_color "#111318"`, icons: `icon.svg` (`image/svg+xml`, `any`), `icon-512.png` (`512x512`, `any maskable`). `index.html` head: `<link rel="manifest" href="/manifest.webmanifest">`, `<meta name="theme-color" content="#111318">`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`, `<meta name="mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-capable" content="yes">`.

- [ ] **Step 3: Verify the build ships them**

Run: `npm run build && ls dist/manifest.webmanifest dist/icon-512.png dist/apple-touch-icon.png dist/icon.svg`
Expected: all four listed.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: web app manifest and icons"
```

---

### Task 13: CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

`on: [push, pull_request]`; one job on `ubuntu-latest`; `actions/checkout@v4`; `actions/setup-node@v4` with `node-version: 22` and `cache: npm`; `npm ci`; `npm test`; `npm run build`.

- [ ] **Step 2: Commit and confirm it runs**

```bash
git add -A && git commit -m "ci: run tests and build on push"
```

After the push (the owner pushes), `gh run list --limit 1` shows the run; expected `completed success`.

---

### Task 14: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update**

- "How it plays": pawn double-step is only from the pawn rank (second rank from the player), matching `geometry.js`, not "either starting rank". Add resign and draw by agreement under Winning. Mention the first-move honesty rule as the game enforces it.
- Features: remove Mirror (done in Task 1), add: resign and draw offers; colours swap each rematch; setup commitment and end-of-game verification with the three outcomes (verified, lie found, could not verify); How to play sheet; installable on phones; chat queued while disconnected.
- A short "Fairness" section: what the commitment proves, what it cannot (a lie is found at game over, not stopped live).
- Project layout: add `src/rules/hash.js`, `src/rules/verify.js`, `public/`, `.github/workflows/ci.yml`.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "docs: README for resign, draw, verification, rules sheet, install"
```
