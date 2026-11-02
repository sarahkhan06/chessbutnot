# Hidden Identity Chess — Polish and Fairness

Date: 2026-11-01
Repo: `chessbutnot` (Vite single-page app, deployed on Vercel)
Builds on: `2026-10-30-hidden-identity-chess-design.md` (the ruleset and
online protocol described there stay as they are unless this document says
otherwise).

## Intent

The game is feature-complete and the 119-test suite is green. The owner
wants it to be "the best it can be": close the information leaks that let
a hot-seat player peek, make online play trustworthy between people who
are not necessarily friends, make it friendly to someone who lands on an
invite link cold, and finish the small things a polished web game has.

Everything in this document was reviewed and accepted by the owner as a
list; the detailed choices below are the designer's calls unless marked
otherwise.

## Goals

1. No hot-seat peeking. The second player cannot learn the first player's
   identities from the screen during hand-over, and there is no reveal
   button in a shipped game.
2. A cheating online client is caught. At game over each side can verify
   that every claim the other side made (challenge verdicts, revealed
   captures, penalty reveals, first-move honesty) was true against a
   commitment made before move one.
3. A newcomer who opens an invite link understands the rules without
   leaving the page.
4. Games can end by resignation or by agreement, and mistakes (a stray
   "New game" tap) cannot destroy a game for both players.
5. Rematches alternate colours.
6. Polish: native share on phones, chat that survives a disconnect, an
   unread-chat marker on narrow screens, keyboard and screen-reader access
   to the board, an installable web-app manifest, and CI running the tests.

## Non-goals

- A chess clock. It needs synchronised time between two peers with no
  server and a timeout rule; the owner can ask for it separately.
- Spectators, accounts, ratings, a bot.
- Live cheat prevention. Verification happens at game over (and on
  resignation). A cheater can still win a game by lying; they are exposed
  when the game ends. Stopping play mid-game on a lie would require the
  mover to reveal identities during the game, which defeats the variant.
- Changing the "last two positions only" history shown to players. The
  full log introduced below is for verification and is never rendered.

## Anti-goals

- Leaking identities through the new features. The verification log, the
  commitment, and the draw/resign messages must carry no identity data
  before game over.
- Breaking a game in progress for people who refresh across a deploy.
  Snapshots saved by the current version must still restore.
- Adding a backend or a paid service.

## Part 1: Hot-seat leaks

### Remove the Mirror button

The `Mirror` button (hot-seat only) does not flip the board; it reveals
every opponent identity. Remove the button, the `ui.mirror` flag, the
`reveal`/`.card.rev` rendering path and the README line about it. The
board already flips to face whoever holds the screen.

### Blank the board during hand-over

While the hand-over overlay is up (`ui.passing`), render every card on the
board face-down (no glyph, no exposed marker, no selection or destination
highlights). Trays (captured pieces) are public and stay as they are. The
overlay itself becomes fully opaque (no blur needed). The same rendering
applies to the setup hand-over between White's and Black's arrangement.

## Part 2: Resign, draw, confirmations, rematch colours

### Resign

- Available in play (not setup, not game over), online and hot-seat.
- Two-tap confirm like the challenge button ("Resign — sure?", reverting
  after 4 s).
- Hot-seat: the current viewer resigns (the player holding the screen).
- Public state gains reason `resigned`; `winner` is the other colour.
  Over title: "White resigned" / "Black resigned".
- Online message: `{ t: 'resign' }`. Accepted when phase is `play`
  (regardless of whose turn or any pending state). Sender applies locally
  first. Pending challenge/penalty state is cleared by the game ending.
- A resignation during setup is not offered; use New game.

### Draw by agreement

- Online: an "Offer draw" button during play when no offer is outstanding
  and nothing is pending (`pub.pending === null`). Sends
  `{ t: 'draw', version }` with the sender's current `pub.version`. The
  receiver accepts it only when its phase is `play`, `pub.pending` is
  null, `pub.drawOffer` is null and `msg.version === pub.version`;
  otherwise it is ignored (an offer that crossed a move or a challenge on
  the wire dies). The receiver sees "Opponent offers a draw" with
  Accept / Decline.
- **While your own offer stands you cannot act**: `canAct()` is false
  when `pub.drawOffer === me`, so the only events that can clear an offer
  come from the opponent. This is what makes the protocol race-free:
  the opponent either responds or acts, never both for the same position.
  There is no withdraw.
- Accept sends `{ t: 'drawAccept', version }` and ends the game locally
  (`winner: null`, `reason: 'draw'`). The offerer accepts it only when
  `pub.drawOffer === me`, phase is `play` and `msg.version === pub.version`;
  these always hold because the offerer could not act. Decline sends
  `{ t: 'drawDecline' }` (accepted when `pub.drawOffer === opp`) and clears
  the offer on both sides.
- Crossing offers (both players offer at the same position; each then
  receives the other's `draw` with `version === pub.version - 1` while
  its own offer stands) resolve as a mutual draw on both sides. Added
  after review: without it both sides were stuck with no way to act.
- Offer state lives in `pub` (`drawOffer: 'w' | 'b' | null`) so it is
  carried by sync and survives refresh. The reducers for a move, a verdict
  (legal or bluff) and a penalty set it to null; on the offerer's side
  those are always the opponent's events, on the opponent's side they are
  its own action in place of a response. Both reach the same state.
- Hot-seat: a single "Agree draw" button with two-tap confirm ends the
  game as a draw. Both players are at the screen; no offer round-trip.
- Over title for a draw: "Draw by agreement".

### "New game" confirmation and semantics

- Hot-seat, mid-game: two-tap confirm ("New game — sure?"). At game over
  the "Play again" button acts immediately as today.
- Online, mid-game: the "New game" button is removed from the play phase.
  Ending a game online is Resign or a draw. "New game" remains during
  setup (before both are ready) and as "Play again" at game over, with no
  confirm. Receiving `{ t: 'new' }` is only accepted when our phase is
  `setup` or `over`; a `new` arriving mid-play is ignored. (Today it is
  accepted at any time, which is the stray-tap hazard.)

### Rematch swaps colours (online)

- Introduce a `seat` for each online client: `host` (created the room) or
  `guest` (opened the link). The seat never changes. Colour is derived from
  the generation: the host is White on even generations and Black on odd
  ones; the guest is the other colour.
- `Game` takes `seat` (and, for backward compatibility in tests, still
  accepts `me`; when only `me` is given, `seat` is `host` for `w` and
  `guest` for `b`, generation 0). `reset(gen)` recomputes `me` from the
  seat and the generation. All existing behaviour keyed on `me` (owning
  identities, validating the opponent's messages, saving) follows.
- The transport's `host` flag now comes from the seat, not the colour.
- Storage keys change from `hic:<room>:<colour>` to `hic:<room>:<seat>`.
  Boot still reads the legacy colour keys as a fallback, deriving the seat
  from the saved colour and generation, so games in progress across the
  deploy survive.
- Chat messages carry `from: 'host' | 'guest'` instead of a colour so the
  log keeps its sides across rematches. Legacy saved logs with colour
  values are shown but aligned by the current colour mapping (best effort,
  builder's choice). Incoming messages must carry a seat value that is not
  ours.
- The game-over panel's "Play again" sends `new` as today; the status
  line on the next game tells each player their new colour.
- Hot-seat is unaffected.

## Part 3: Fairness: commitment and end-of-game verification

### Commitment at ready-up (online only)

- When a client readies up it computes
  `commit = sha256(colour + '|' + ids + '|' + salt)` where `ids` is the
  sixteen types in piece-index order (e.g. `rnbqkbnrpppppppp`), `salt` is
  32 hex characters from `crypto.getRandomValues`, and the hash is hex.
  The salt is kept privately (in the snapshot) and never sent until game
  over.
- `ready` becomes `{ t: 'ready', commit }`. `hello` also carries `commit`
  so a reconnect during setup delivers it.
- **The opponent's commitment is private state, never taken from sync.**
  The receiver stores it in `game.oppCommit` (persisted in the snapshot
  with our own `salt`), write-once per generation: the first `ready` or
  `hello` for the current generation that carries a commit sets it; later
  values are ignored. `syncFrom` never touches it. A modified client that
  drops the connection and resyncs cannot replace the hash it committed
  to. (Our own commit and salt are likewise private.)
- A `ready` or `hello` without a commit is still accepted, so setup never
  stalls, but `oppCommit` stays null and verification later reports
  "Opponent sent no commitment, so their game could not be verified."
  The wording never vouches for the opponent.
- SHA-256 is a small synchronous pure-JS implementation in
  `src/rules/hash.js` (so `readyUp` stays synchronous and the existing
  tests keep their shape), with a test against the standard vector for
  `"abc"`.
- Hot-seat computes no commitment.

### Full event log

- `pub.log` is a full append-only list of public events, maintained by the
  state reducers alongside the two-entry `history`. It is never rendered.
  Entries carry only public data:
  - `{ k: 'move', from, to, pieceId, capturedId, moverMoved, capturedMoved }`
  - `{ k: 'legal' }` (a challenge answered "legal")
  - `{ k: 'bluff', pieceId, type }`
  - `{ k: 'captured', id, type, by }`
  - `{ k: 'penalty', id, type }`
  - `{ k: 'resign', color }`, `{ k: 'draw' }`
- Both clients build the same log independently because they apply the
  same public events. On sync, `syncFrom` adopts the incoming `log` only
  when our current log is a prefix of it (entry-by-entry deep equality);
  that covers the honest case where we missed events while disconnected.
  If it is not a prefix, the game still syncs (play must continue) but
  `game.logTainted` is set (private, persisted) and verification at game
  over reports "States diverged on reconnect, so the opponent's game could
  not be verified." A forged log therefore cannot make a lie pass; at
  worst it makes the game unverifiable, which the UI says out loud.
- A new generation (`gen` higher than ours) resets the log along with
  everything else, as today.
- The replay trusts only itself (added after review): each move entry's
  origin and capture must match where the replay has the pieces, "first
  move" is decided by the replay's own `moved` flag rather than the
  entry's, and at the end the replay's board must equal `pub.pieces`.
  Any mismatch is `{ ok: false, why: 'log', ply }`. Without this, a
  forged sync could append a move that claims `moverMoved: true` and
  dodge both the challenge and the first-move check.
- The commitment hash is checked before the taint flag, so forcing a
  taint cannot turn a mismatched reveal into a neutral line.

### Reveal and verification at game over

- The existing `setup` message becomes `{ t: 'setup', gen, ids, salt }`.
- On receipt the client checks `sha256(oppColour|ids|salt)` against
  `game.oppCommit`. If `oppCommit` is null, the result is
  `{ ok: null, why: 'no-commit' }`. If `logTainted`, the result is
  `{ ok: null, why: 'diverged' }`. If the hash differs, or the opponent
  sent a commit but the `setup` carries no salt, the result is
  `{ ok: false, why: 'commitment' }`.
- Then it replays `pub.log` from the standard start squares with the
  opponent's revealed identities (applying pawn promotion when their pawn
  reaches the far rank and transformation when their pawn's capture is
  revealed as a non-pawn) and checks every claim the opponent made:
  - a `legal` verdict on their move: the move was legal for the piece's
    identity at the time (pre-promotion, as the game already judges);
  - a `bluff` reveal on their piece: the revealed type equals the true
    identity;
  - a `captured` or `penalty` reveal of their piece: type matches;
  - every first move of one of their pieces (`moverMoved: false`) was
    legal for its true identity (the honesty rule is enforced only by the
    mover's own client today).
  The first failure wins: `{ ok: false, why, ply }` where `why` names the
  claim and `ply` the log index.
- Pure function `verify(log, setup, colour)` in `src/rules/verify.js`,
  fully unit-tested with honest and dishonest logs.
- The game-over panel shows one line: "Opponent's game verified" (green),
  "Opponent's reveal does not match their commitment" or "Opponent lied
  on move N: <claim>" (red), or a muted line for the two `ok: null`
  cases ("Opponent sent no commitment, so their game could not be
  verified." / "States diverged on reconnect, so the opponent's game
  could not be verified."). Our own setup is also sent with the salt so
  the opponent can verify us. The reveal happens on every game end
  including resignation and draw.

## Part 4: How to play

- A rules sheet in a modal, opened by a "How to play" button in the header
  (replacing nothing; sits next to the connection pill) and shown
  automatically the first time this browser opens the game (flag
  `hic:rulesSeen` in `localStorage`, set when the sheet is dismissed). A
  guest arriving via invite link sees it before the setup screen; the
  connection proceeds behind it.
- Content: a condensed version of the README's "How it plays" (setup,
  moving and bluffing, first move honest, pawn rules, capturing and the
  deferred reveal, challenging and both penalties, winning, resign/draw).
  About 150–200 words, scannable, with the glyphs used on the board.
- Dismiss by button, backdrop tap or Escape. Focus is trapped inside while
  open.

## Part 5: Polish

- **Share**: on devices with `navigator.share`, a "Share" button next to
  "Copy link" opens the native sheet with the invite URL. "Copied!" reverts
  to "Copy link" after 1.5 s.
- **Chat while disconnected**: messages typed while the transport is not
  open are shown immediately with a muted "sending…" style, queued, and
  flushed in order when the connection opens. Moves are already covered
  by sync and are out of scope here.
- **Unread chat**: on the narrow layout (chat below the board), when a
  message arrives while the chat log is not in the viewport, show a small
  "New message" pill above the controls that scrolls to the chat when
  tapped and disappears when the log scrolls into view. On the wide
  layout the chat is always visible; no pill.
- **Accessibility**: each square becomes a `<button>` with an
  `aria-label` such as "e4, your knight", "e4, opponent's piece",
  "e4, opponent's rook (exposed)" or "e4, empty"; selected square gets
  `aria-pressed`. The board has `role="grid"` with rows; the status line
  and the connection pill are `aria-live="polite"`. Buttons are
  focusable in reading order; arrow-key navigation inside the grid is
  left to the builder (nice to have).
- **Installable**: `public/manifest.webmanifest` (name, short name,
  standalone display, theme and background colours matching the dark
  table, SVG icon plus a 180 px and 512 px PNG rendered from it),
  `<link rel="manifest">`, `theme-color` meta, `apple-touch-icon`. No
  service worker (not required for install on current Chrome or iOS, and
  the game is useless offline anyway).
- **CI**: `.github/workflows/ci.yml` running `npm ci`, `npm test`,
  `npm run build` on push and pull request, Node 22.
- README updated for every user-visible change (Mirror removed, resign
  and draw, colour swap, verification, How to play, install).

## Protocol summary of changes

| Message | Change |
|---|---|
| `ready` | gains `commit` |
| `hello` | gains `commit` |
| `setup` | gains `salt` |
| `resign` | new |
| `draw { version }`, `drawAccept { version }`, `drawDecline` | new |
| `new` | only accepted in `setup` or `over` |
| `chat.from` | seat instead of colour |

Public state gains `log: []`, `drawOffer`, and the reasons `resigned` and
`draw` (`winner: null` for a draw). Private game state (in the snapshot,
never synced) gains `seat`, `salt`, `oppCommit` and `logTainted`.
`restore` and `syncFrom` default the new fields when absent so old
snapshots load.

## Decisions made after the builder check

- Commitment and log integrity under sync: protected (private write-once
  commitment, prefix-only log adoption, tainted flag otherwise).
- Draw offers: version-tagged, offerer cannot act while the offer stands,
  strict validation of accept. No withdraw.
- Missing commitment: accepted, reported with wording that does not vouch
  for the opponent.

## Left to the builder

- Exact copy of the rules sheet and over-panel lines.
- Visual treatment of the verification line, draw offer banner, unread
  pill and "sending…" chat style, within the existing dark-table look.
- Arrow-key navigation inside the board grid.
- How the legacy colour-keyed chat log is aligned.
- Test organisation; the existing suite style (vitest, small files per
  feature) is the model.
