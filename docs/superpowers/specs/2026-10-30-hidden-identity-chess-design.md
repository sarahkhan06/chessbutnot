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

- Moving onto an opponent's piece captures it. The captured piece's
  identity is revealed to both players and shown in the captor's tray.
- The capturing piece's identity is **not** revealed by capturing.

### Winning

- You win the moment you capture the opponent's king. The game ends
  immediately.
- A successful challenge penalty (below) that removes the king also wins.
- There is no stalemate or draw by rule. (Players may simply agree to stop.)

### Challenge

- At the start of your turn, before moving, you may **challenge** the move
  your opponent just made. Taking your own move instead is implicitly
  accepting their move. There is no timer.
- If the challenged move was a bluff (illegal for the piece's true
  identity):
  - The moved piece is removed from the board and revealed in your tray.
  - If the move was a capture, the captured piece is **restored** to its
    square, still hidden (its identity was never revealed since the bluff
    is undone). If the bluffing piece was a pawn that had transformed on
    that capture, the transformation is undone with it, which is moot
    since it is removed anyway.
  - You then pick any one remaining opponent piece on the board as the
    **penalty capture**. It is removed and revealed. If it is the king, you
    win.
  - It is then your normal turn: you move.
- If the challenged move was legal:
  - The challenged piece is turned face-up for the rest of the game. Both
    players see its identity on the board from now on. If it later moves,
    it stays face-up.
  - The move stands. It is then your normal turn: you move.
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
  including transformations from pawn captures and promotions.

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
- `captured { square, type }` — sent by the *defender* in response to a
  move that landed on their piece, naming the captured piece's identity.
  The mover's client needs this both to show it in the tray and to apply
  pawn transformation.
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
- `sync { publicState }` — full public state, sent by the host after a
  reconnect; the joiner adopts it if its version is older. Private state
  is never in a sync.

The builder may collapse or rename messages as long as no message carries
an identity the receiver is not entitled to under the rules.

### Reconnect and refresh

- Both clients persist their full state (public and private) to
  `sessionStorage` after every change, keyed by room code and color.
- On page load with a room code and saved state for that room, the client
  restores and reconnects instead of starting fresh.
- The host keeps its PeerJS id stable (derived from the room code) so the
  joiner can always find it. The joiner reconnects to that id. The host
  accepts a new connection from the joiner's color and sends `sync`.
- The UI shows connection state at all times: connecting, connected,
  opponent disconnected (with "waiting for them to come back").

### Turn flow (online), for clarity

1. Mover selects a piece; their screen shows legal destinations in one
   style and bluff destinations in another. Mover picks a destination.
2. Mover's client applies the move locally and sends `move`.
3. Opponent's client applies the move. If it captured one of the
   opponent's pieces, the opponent's client sends `captured` and both
   sides reveal it in the tray; the mover's client applies pawn
   transformation if relevant. If the captured piece is the king, game
   over.
4. Opponent now sees "Challenge" and may also simply move.
   - Move: the last move becomes unchallengeable; go to step 1 with
     colors swapped.
   - Challenge: send `challenge`. Mover's client checks its private state,
     sends `verdict`.
     - Legal: both sides mark the piece face-up with its type. Opponent
       moves (step 1, colors swapped). The verdict's move is no longer
       challengeable.
     - Bluff: both sides remove the bluffing piece (revealed in tray) and
       restore any captured piece to its square. Opponent picks a penalty
       square, sends `penalty`; mover's client sends `removed`; both sides
       remove and reveal it. If king, game over. Otherwise the opponent
       moves (step 1, colors swapped).

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
- Game-over screen text: "White captured the king", "Black's king was
  taken as a penalty", etc.
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
- When a bluffing capture is reverted, the captured piece is restored
  hidden and its identity stays secret.
- Promotion is always to a queen and is silent.
- Hot-seat stays, Undo goes.
- Transport stays PeerJS with no TURN server.
