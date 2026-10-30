# Hidden Identity Chess — Design

Date: 2026-10-30
Repo: `chessbutnot` (Vite single-page app, deployed on Vercel)

## Intent

Turn the existing "Blind Chess" build (standard chess with the opponent's
piece icons hidden) into Hidden Identity Chess: a chess variant where piece
identities are secret, the king is captured outright, and players may bluff
by moving a piece as if it were a different type, at the risk of being
challenged.

The owner wants to play this in a browser against a friend over the
internet. Online play is the primary target. Hot-seat (two players, one
screen) stays as a secondary mode because it is the fastest way to test the
rules on one machine.

## Goals

- Full ruleset below, working end to end in online play between two
  browsers on different networks.
- A friend can open an invite link and be in the game within a few seconds,
  with no account and no install.
- A dropped connection or a page refresh does not end the game.
- The opponent's browser never receives your hidden identities. Hiding is
  by data, not just by rendering.

## Non-goals

- Matchmaking, accounts, ratings, lobbies, chat.
- Playing against a computer.
- Anti-cheat beyond "the opponent's client is not sent your secrets."
  Two friends are trusted to run unmodified clients.
- Spectators.
- Castling and en passant. Both are dropped from the variant (builder's
  call, see below).

## Anti-goals

- A game that silently desyncs so the two players see different boards.
  Any divergence must be detected and resolved, or surfaced as an error.
- Leaking identities through side channels in the UI (e.g. highlighting
  only the truly legal squares on the opponent's view, animation
  differences, console logs of the opponent's pieces).
- Making the owner stand up and pay for a backend. Static hosting on
  Vercel plus the free PeerJS signaling service is the budget.

## The Ruleset

### Setup

- Each side has the standard sixteen pieces: king, queen, two rooks, two
  bishops, two knights, eight pawns.
- Before the game, each player arranges their sixteen pieces across their
  own two ranks in any order. Pawns may go on the back rank and major
  pieces on the front rank.
- Each player sees their own pieces face-up and the opponent's pieces as
  blank cards. Arrangement is private. Both players ready up, then play
  begins with White.

### Movement

- On your turn you pick one of your pieces and a destination square. The
  destination may be any square reachable by *some* chess piece type from
  that square (king, queen, rook, bishop, knight, or pawn pattern), with
  sliding pieces blocked by any intervening piece. You cannot land on your
  own piece.
- Moving in a pattern your piece's true identity allows is a **legal
  move**. Moving in a pattern it does not allow is a **bluff**. The game
  accepts both; nothing stops a bluff except your opponent.
- The mover's own screen distinguishes the two when choosing a destination
  so a player never bluffs by accident. The opponent's screen must not.
- Pawn rules: a pawn moves one square forward, or two squares forward from
  either of its owner's two starting ranks if it has not yet moved. It
  captures one square diagonally forward. No en passant. A pawn reaching
  the far rank becomes a queen; this is not announced, but the opponent
  can of course infer it.
- Pawn capture transformation: when a pawn captures a non-pawn piece, the
  pawn permanently takes on the captured piece's identity. Capturing a
  pawn leaves it a pawn.
- The king moves one square in any direction. There is no castling.
- There is no check. The king may move into or stay on attacked squares.

### Capture

- Moving onto an opponent's piece captures it. The captured piece leaves
  the board immediately on both screens, but its identity is **not yet
  revealed**. It appears in the captor's tray as a blank "pending" card.
- The capture is **provisional** until the opponent accepts it, either by
  making their own move or by challenging it and losing. At that moment
  the captured piece's identity is revealed to both players, the tray card
  flips face-up, and any pawn transformation is applied.
- If the capture was a bluff and the opponent challenges successfully,
  the captured piece returns to its square, still hidden. Its identity was
  never sent, so nothing leaked.
- The capturing piece's identity is **not** revealed by capturing.

### Winning

- You win when a capture of the opponent's king is **accepted**: the
  opponent either moves on (implicitly accepting) or challenges the
  capturing move and loses. The game ends at that moment, not at the
  instant of the capture. This means a bluff onto the king square can be
  challenged and punished like any other bluff.
- The opponent is not told that the pending capture was their king. From
  their side it looks like any other pending capture, and they know what
  was on that square anyway.
- A successful challenge penalty (below) that removes the king also wins.
- If a successful challenge removes a bluffing king itself, the challenger
  wins immediately with no penalty pick.
- There is no stalemate or draw by rule. (Players may simply agree to stop.)

### Challenge

- At the start of your turn, before moving, you may **challenge** the move
  your opponent just made. Taking your own move instead is implicitly
  accepting their move. There is no timer.
- If the challenged move was a bluff (illegal for the piece's true
  identity):
  - The moved piece is removed from the board and revealed in your tray.
  - If the move was a capture, the captured piece is **restored** to its
    square, still hidden. Its identity was never sent because the capture
    was still provisional. The pending tray card disappears.
  - You then pick any one remaining opponent piece on the board as the
    **penalty capture**. It is removed and revealed. If it is the king, you
    win.
  - It is then your normal turn: you move.
- If the challenged move was legal:
  - The challenged piece is turned face-up for the rest of the game. Both
    players see its identity on the board from now on. If it later moves,
    it stays face-up.
  - The move stands. If it was a capture, the capture is now accepted:
    you reveal the captured piece's identity, and if it was your king the
    game is over.
  - Otherwise it is then your normal turn: you move.
- Only the most recent move can be challenged. A move that is not
  challenged can never be challenged later.
- You cannot challenge the very first move of the game before any move
  exists (trivially), and you cannot challenge your own moves.

### Revealed pieces

A piece becomes permanently face-up to both players when:
- it is captured (shown in the tray), or
- it survives a failed challenge.

Face-up pieces on the board show their glyph on the opponent's screen too.
A face-up piece can still bluff; the opponent simply knows it is bluffing.

## Modes

### Online (primary)

- Host clicks "Play online", gets an invite link, and is White. The friend
  opens the link and is Black. Both arrange, both ready up, play starts.
- Transport: peer-to-peer WebRTC data channel via PeerJS using the public
  PeerJS cloud signaling server, as today. No owner-run backend.
- Known risk: WebRTC can fail to connect between two restrictive networks
  without a TURN relay. The UI must say clearly when a connection cannot be
  made, so the players know it is the network and not the game. If this
  bites in practice, the fix is a TURN server or a relay service; that is
  out of scope for this build.

### Hot-seat (secondary)

- Two players, one screen, hand-over screen between turns as today.
- Each hand-over shows the incoming player their own view. They get the
  challenge choice, then move, then hand over.
- The "Mirror (reveal all)" debug button stays, hot-seat only.
- "Undo" is removed. It is incompatible with hidden information and
  challenges.

## State and the network protocol

### What each client knows

Each client holds:
- **Public state**, identical on both sides: positions of all 32 pieces
  (by stable piece id and color), which pieces are face-up and what they
  are, captured pieces and their identities, whose turn it is, the last
  move (from, to, whether it was a capture), whether the last move is
  still challengeable, and the phase (setup / play / over).
- **Private state**: the true identity of each of *its own* pieces,
  including transformations from pawn captures and promotions. A pawn
  transformation from a provisional capture is applied only when the
  capture is accepted, since the identity is unknown until then.

The opponent's client never receives private state except through the
reveal events defined by the rules.

### Why identity lives with the owner's client

Hiding by data, not rendering, is a goal. The owner of a piece is the only
party who knows what it is, and the rules only ever need the owner to
answer two questions: "was that move legal for that piece?" and "what was
the piece that just got captured / removed?" Both are answered by the
owner's client sending a message. A cheating client could lie; that is an
accepted non-goal.

### Messages (over the PeerJS data channel)

All messages carry a monotonically increasing sequence number from the
sender and the sender's color. The receiver rejects anything out of order
or from the wrong color for the current turn.

- `hello` — exchanged on (re)connect. Carries the client's public state
  version so both sides can detect a mismatch.
- `ready { arrangementHash }` — the player has locked in their setup. Only a
  hash (or nothing beyond "ready") travels; the arrangement itself stays
  private. The hash lets the client later prove the arrangement wasn't
  changed if that is ever needed. Builder's call whether to include it.
- `move { from, to }` — the mover's move. Positions only, no identity.
- `captured { square, type }` — sent by the *defender* when it accepts a
  provisional capture (by moving, or by losing a challenge against it),
  naming the captured piece's identity. It is sent immediately before the
  defender's own `move`, or immediately after a `verdict { legal: true }`
  is received for the capturing move. The mover's client needs it to flip
  the tray card, apply pawn transformation, and detect a king capture.
  Never sent while the capture is still challengeable.
- `challenge` — the opponent challenges the last move.
- `verdict { legal: bool, type? }` — the mover's client answers a
  challenge. If `legal` is true, `type` is the challenged piece's identity
  (it is now face-up). If false, the piece is removed and the move
  reverted on both sides.
- `penalty { square }` — after a successful challenge, the challenger names
  the piece to remove.
- `removed { square, type }` — the owner reveals the penalised piece's
  identity. If it is the king, the game is over.
- `new` — propose a rematch; both sides reset to setup.
- `sync { publicState }` — full public state, sent after a reconnect by
  whichever side has the newer version; the other side adopts it. Private
  state is never in a sync.

The builder may collapse or rename messages as long as no message carries
an identity the receiver is not entitled to under the rules.

### Reconnect and refresh

- Both clients persist their full state (public and private) to
  `localStorage` after every change, keyed by room code and color. Per-tab
  storage is not enough: on a phone the friend re-taps the invite link and
  gets a fresh tab.
- The host's URL also carries the room code (pushed into the address bar
  when the room is created) so a host refresh can restore too.
- On page load with a room code and saved state for that room, the client
  restores and reconnects instead of starting fresh.
- The host keeps its PeerJS id stable (derived from the room code) so the
  joiner can always find it. The joiner reconnects to that id. The host
  accepts a new connection from the joiner's color.
- On (re)connect both sides exchange `hello` with their public state
  version. Whichever side is newer sends `sync`; the older side adopts it.
  A side that has an unanswered request outstanding (a `move` awaiting
  `captured`, a `challenge` awaiting `verdict`, a `penalty` awaiting
  `removed`) re-sends it after sync. A client must never silently drop
  its own last action; if adopting a sync would discard it, re-send it.
- The UI shows connection state at all times: connecting, connected,
  opponent disconnected (with "waiting for them to come back").

### Turn flow (online), for clarity

1. Mover selects a piece; their screen shows legal destinations in one
   style and bluff destinations in another. Mover picks a destination.
2. Mover's client applies the move locally and sends `move`. If the move
   captured, the captured piece leaves the board on both screens and a
   blank pending card appears in the mover's tray. No identity travels.
3. Opponent's client applies the move. Opponent now sees "Challenge" and
   may also simply move.
   - Move: the last move becomes unchallengeable. If it was a capture the
     opponent's client first sends `captured` with the identity; the
     mover's tray card flips, pawn transformation applies, and if it was
     the king the game is over instead of continuing. Otherwise the
     opponent's `move` follows and we go to step 1 with colors swapped.
   - Challenge: send `challenge`. Mover's client checks its private state,
     sends `verdict`.
     - Legal: both sides mark the piece face-up with its type. If the
       move was a capture the opponent's client now sends `captured` as
       above (possible game over on king). Otherwise the opponent moves
       (step 1, colors swapped). The verdict's move is no longer
       challengeable.
     - Bluff: both sides remove the bluffing piece (revealed in tray) and
       restore any captured piece to its square, still hidden. If the
       removed bluffer was the king, game over. Otherwise the opponent
       picks a penalty square, sends `penalty`; mover's client sends
       `removed`; both sides remove and reveal it. If king, game over.
       Otherwise the opponent moves (step 1, colors swapped).

## UI

Keep the existing look: the tilted wooden board, white face-up cards for
your pieces, black blank cards for theirs, captured trays top and bottom,
blue gradient background. Mobile-first, one column, max width ~560px.

Additions:
- Destination highlighting on the mover's screen: legal squares in the
  current green/dot style, bluff squares in a distinct warning style
  (builder's choice of color), with a one-line hint the first time a bluff
  square is highlighted.
- Face-up opponent pieces: a black card showing a white glyph, with a
  small marker so it reads as "exposed".
- A "Challenge last move" button that appears only at the start of your
  turn when a challengeable move exists. Pressing it asks for one
  confirmation.
- A penalty-pick mode: after a successful challenge, the status line says
  "Pick a piece to remove" and tapping an opponent piece removes it.
- Pending capture card: a blank card in the captor's tray with a subtle
  "?" that flips to the glyph when the capture is accepted.
- Game-over screen text: "White captured the king", "Black's king was
  taken as a penalty", "White's king was caught bluffing", etc.
- Connection status in the header for online play.
- Remove the Undo button. Keep Mirror for hot-seat only.

## Constraints

- Static hosting on Vercel, Vite build, no server code.
- Plain JavaScript ES modules as today. No framework. The builder may add
  small dependencies but should not pull in a framework or a state library
  for a game this size.
- `chess.js` is no longer a good fit (it enforces standard legality, check,
  and has no concept of hidden identity or free-form moves). Replace it
  with the project's own move-geometry code. Keep `peerjs`.
- Must work on a phone browser and a laptop browser in the same game.

## Left to the builder

- Exact module structure. A reasonable split: rules/geometry, game state
  and reducers, network, rendering.
- The warning color and marker styles.
- Whether to include an arrangement hash in `ready`.
- Exact wording of status lines and hints.
- How the hot-seat mode presents the challenge choice (a button on the
  board screen after the hand-over is fine).
- Test approach, except that the rules module (move geometry, legality for
  each piece type, pawn transformation, challenge resolution including
  capture restoration, king-capture win) must have automated tests.
  Network and rendering code may be tested manually.

## Calls I made (owner can overrule)

- Castling and en passant are dropped.
- A wrong challenge exposes the challenged piece face-up permanently, as
  the cost of a bad accusation.
- The penalty capture can target any piece, including the king, so a
  caught bluff can lose the game outright.
- Captures are provisional until accepted (owner's decision, 2026-10-30):
  the captured piece's identity is revealed and king-capture wins only
  once the opponent moves on or loses a challenge against the capture. A
  reverted bluff-capture restores the piece hidden with nothing leaked.
- Promotion is always to a queen and is silent.
- Hot-seat stays, Undo goes.
- Transport stays PeerJS with no TURN server.
- Saved state lives in `localStorage` keyed by room and color, and the
  host URL carries the room code, so either side can refresh or reopen the
  link and resume.
- Reconnect sync is bidirectional: newest public state wins, and any
  unanswered request is re-sent.
