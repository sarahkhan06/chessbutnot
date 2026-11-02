# Hidden Identity Chess

Chess where nobody knows what your pieces really are. Bluff, challenge, and capture the king.

Two players, either online over a peer-to-peer connection or hot-seat on one screen. No accounts, no server state, no install: open the page, send a link, play.

## How it plays

**Setup.** Each side has the standard sixteen pieces, but you arrange them across your own two ranks in any order you like. Pawns can sit on the back rank, the king on the front. Your pieces face you; your opponent's are blank cards.

**Moving.** On your turn, pick a piece and move it to any square that *some* chess piece could reach from there. If the move matches your piece's true identity, it is a legal move. If it doesn't, it is a bluff. The game accepts both. Only your opponent can stop a bluff.

- A piece's first move must be honest. Bluffing opens up from its second move on.
- Pawns move one forward, or two from the pawn rank (the second rank from your side) on their first move, and capture diagonally. No en passant.
- A pawn that captures a non-pawn piece takes on that piece's identity. A pawn reaching the far rank quietly becomes a queen.
- There is no check, no castling, no stalemate. The king is captured outright.

**Capturing.** A captured piece leaves the board but its identity stays hidden until the capture is accepted, which happens when the opponent moves on or challenges and loses. Only then does it flip face-up in the captor's tray.

**Challenging.** Before making your own move, you may challenge the move your opponent just made.

- If it was a bluff, the bluffing piece is removed and revealed, any capture it made is undone, and you remove one more opponent piece of your choosing.
- If it was legal, the move stands, and you lose a piece of your opponent's choosing.

**Winning.** Capture the king and have that capture accepted, or remove the king through a challenge penalty. You can also resign, or agree a draw: online, one player offers and the other accepts or declines (an offer dies if either side moves instead). When the game ends, both starting arrangements are revealed.

## Features

- Online play between two browsers via WebRTC ([PeerJS](https://peerjs.com/)). Your hidden identities are never sent to the other client, so hiding is by data, not just by rendering.
- Hot-seat mode with a hand-over screen between turns.
- Reconnect and refresh safety: games are saved per room in `localStorage` and resynced with the peer.
- In-game chat over the same peer connection. Messages typed while disconnected are queued and sent when the link is back, and a pill flags new messages when the chat is off screen on a phone.
- Move history with a previous-position toggle.
- Resign and draw offers. Mid-game "New game" needs a second tap, and online it is replaced by Resign so a stray tap cannot wipe the board for both players.
- Rematches swap colours: the player who created the room is White in the first game, Black in the next, and so on.
- Fairness check at game over: every online game is verified against a commitment each player made before move one (see below).
- A "How to play" sheet, shown once to newcomers and always a tap away.
- Installable on phones (add to home screen) with its own icon.
- Accessible board: every square is a labelled button, and status changes are announced to screen readers.

## Fairness

Two unmodified clients cannot see each other's identities. A modified client could still lie when asked about its own pieces, so the game makes lying detectable afterwards:

1. When you ready up, your client publishes a SHA-256 commitment to your arrangement (colour, the sixteen types in order, and a secret salt). The arrangement itself stays private.
2. Both clients keep a full log of public events (moves, verdicts, reveals, penalties).
3. At game over, each side reveals its arrangement and salt. The other side checks the hash against the commitment, then replays the log with the revealed identities and confirms every claim: each "legal" verdict really was legal, each revealed piece really was that piece, and each piece's first move was honest.

The over panel shows one of: verified, a specific lie ("Opponent lied on move 7: false verdict"), a reveal that does not match the commitment, or that the game could not be verified (the opponent sent no commitment, or states diverged on a reconnect). The opponent's commitment is stored privately and never overwritten by a resync, and a synced log is only accepted if it extends the one already held. Lies are caught at game over, not stopped live.

## Running locally

```sh
npm install
npm run dev
```

Open the printed URL. Click **Play online** to create a room and copy the invite link, or just start moving pieces for a hot-seat game.

```sh
npm test          # run the test suite once
npm run test:watch
npm run build     # production build into dist/
```

## Deploying

The app is a static [Vite](https://vitejs.dev/) build and deploys to [Vercel](https://vercel.com/) as-is (see `vercel.json`). Signaling uses the public PeerJS cloud.

Direct connections use public STUN servers. If both players are behind restrictive NATs, add a TURN relay through environment variables. Copy `.env.example` and set:

```
VITE_TURN_URLS=turn:your.turn.host:443,turns:your.turn.host:443?transport=tcp
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

## Project layout

```
index.html        page shell
src/main.js       UI wiring, online/hot-seat flow, persistence
src/game.js       game orchestrator: moves, challenges, penalties, sync
src/net.js        PeerJS transport with sequenced envelopes and reconnect
src/chat.js       chat messages over the peer connection
src/render.js     board and tray rendering
src/storage.js    localStorage snapshots keyed by room and color
src/rules/        pure rules: move geometry, public state reducers, private identities,
                  sha256 (hash.js) and the commitment/verifier (verify.js)
public/           web app manifest and icons
tests/            vitest suite covering rules, game flow, networking, storage and the rendered page
.github/workflows CI: tests and build on every push
docs/superpowers/ design specs and implementation plans
```

## License

No license has been chosen yet. All rights reserved by the authors.
