// Game orchestrator: one public state plus the private identities this client owns.
// Local UI actions and incoming messages both flow through here; outgoing messages leave via `send`.
import {
  createState, pieceAt, occupancy, setStage, startPlay, setPending, applyMove, acceptLastMove,
  revealLost, resolveLegal, resolveBluff, applyPenalty, resignGame, agreeDraw, offerDraw, declineDraw,
} from './rules/state.js';
import { TYPES, destinations } from './rules/geometry.js';
import { standardIdentity, swapIdentity, promote, transform, isLastMoveLegal, legalDestinations, isValidIdentity } from './rules/identity.js';

const other = (c) => (c === 'w' ? 'b' : 'w');

// Identities are never public mid-game, so drop any face-up marks (and the type on a 'legal'
// history entry) that an older version of the game, a saved game or a peer might still carry.
function scrub(pub) {
  for (const id in pub.pieces) pub.pieces[id].faceUp = null;
  pub.history = (pub.history || []).map((e) => {
    const { type, faceUp, ...rest } = e;
    return e.kind === 'legal' ? { ...rest, faceUp: {} } : { ...e, faceUp: {} };
  });
  return pub;
}

export class Game {
  constructor({ me = null, send = () => {}, onChange = () => {} } = {}) {
    this.me = me;
    this.send = send;
    this.onChange = onChange;
    this.reset();
  }

  reset(gen = (this.pub?.gen ?? -1) + 1) {
    this.pub = createState();
    this.pub.gen = gen;
    this.priv = { w: this.owns('w') ? standardIdentity('w') : null, b: this.owns('b') ? standardIdentity('b') : null };
    this.setupColor = 'w';
    this.lastMoverType = null; // identity of the last moved piece *before* promotion, if we own it
    this.lostState = false;    // set when a sync shows the other side thinks we are in a game we never arranged
    this.initial = structuredClone(this.priv); // identities as arranged in setup, kept for the end-of-game reveal
    this.setups = { w: null, b: null };        // the other player's arrangement, received once the game is over
    this.setupShared = false;
  }

  owns(color) { return this.me === null || this.me === color; }
  // Hot-seat: whoever is picking a penalty holds the screen; otherwise the side to move.
  viewer() { return this.me ?? (this.pub.phase === 'setup' ? this.setupColor : (this.pub.pending === 'penaltyPick' && this.pub.picker) || this.pub.turn); }
  isGameOver() { return this.pub.phase === 'over'; }
  changed() {
    if (this.pub.phase === 'setup') this.initial = structuredClone(this.priv);
    else if (this.pub.phase === 'over') this.shareSetup();
    this.onChange();
  }

  // ---- end-of-game reveal: both starting arrangements ----
  // Send our own arrangement once the game is over (re-sent on reconnect with force).
  shareSetup(force = false) {
    if (!this.me || this.pub.phase !== 'over' || (this.setupShared && !force)) return;
    const ids = this.initial?.[this.me];
    if (!ids) return;
    this.setupShared = true;
    this.send({ t: 'setup', gen: this.pub.gen, ids });
  }

  // Each side's arrangement from before move one, or null if not known (yet).
  startingSetup() {
    const out = {};
    for (const c of ['w', 'b']) out[c] = (this.owns(c) ? this.initial?.[c] : this.setups[c]) ?? null;
    return out;
  }

  // ---- setup ----
  swap(color, sqA, sqB) {
    if (this.pub.phase !== 'setup' || !this.owns(color) || this.pub.stage[color] !== 'arranging') return;
    const a = pieceAt(this.pub, sqA), b = pieceAt(this.pub, sqB);
    if (!a || !b || this.pub.pieces[a].color !== color || this.pub.pieces[b].color !== color) return;
    this.priv[color] = swapIdentity(this.priv[color], a, b);
    this.changed();
  }

  // One tap: discard any swaps, keep the normal layout, lock in and ready up.
  useStandard(color) {
    if (this.pub.phase !== 'setup' || !this.owns(color) || this.pub.stage[color] !== 'arranging') return;
    this.priv[color] = standardIdentity(color);
    this.lockIn(color);
    this.readyUp(color);
  }

  lockIn(color) {
    if (this.pub.phase !== 'setup' || this.pub.stage[color] !== 'arranging') return;
    this.pub = setStage(this.pub, color, 'done');
    this.changed();
  }

  readyUp(color) {
    if (this.pub.phase !== 'setup' || this.pub.stage[color] === 'ready') return;
    this.pub = setStage(this.pub, color, 'ready');
    if (this.me) this.send({ t: 'ready' });
    else if (color === 'w') this.setupColor = 'b';
    this.tryStart();
    this.changed();
  }

  tryStart() {
    if (this.pub.phase === 'setup' && this.pub.stage.w === 'ready' && this.pub.stage.b === 'ready') this.pub = startPlay(this.pub);
  }

  // ---- play: queries ----
  canAct() {
    const p = this.pub;
    // Online, your own outstanding draw offer blocks you until the opponent answers or acts.
    return p.phase === 'play' && p.pending === null && p.turn === this.viewer() && this.owns(p.turn) && (!this.me || p.drawOffer !== this.me);
  }

  destinations(from) {
    if (!this.canAct()) return [];
    const id = pieceAt(this.pub, from);
    if (!id || this.pub.pieces[id].color !== this.viewer()) return [];
    return legalDestinations(this.pub, this.priv[this.viewer()], from);
  }

  // A piece's first move is always honest, so it cannot be challenged.
  canChallenge() { return this.canAct() && !!this.pub.lastMove?.challengeable && this.pub.lastMove.moverMoved; }

  // ---- play: local actions ----
  move(from, to) {
    if (!this.destinations(from).some((d) => d.to === to)) return;
    if (this.pub.lastMove?.challengeable) {
      if (this.pub.lastMove.capturedId) this.acceptCapture();
      else this.pub = acceptLastMove(this.pub);
      if (this.isGameOver()) return this.changed();
    }
    this.applyLocalMove(from, to);
    this.send({ t: 'move', from, to });
    this.changed();
  }

  applyLocalMove(from, to) {
    const id = pieceAt(this.pub, from);
    const color = this.pub.pieces[id].color;
    this.pub = applyMove(this.pub, from, to);
    if (this.owns(color)) {
      this.lastMoverType = this.priv[color][id];
      this.priv[color] = promote(this.priv[color], id, to, color);
    } else this.lastMoverType = null;
  }

  // The defender accepts a provisional capture: reveal the captured piece's identity.
  acceptCapture() {
    const { capturedId, pieceId } = this.pub.lastMove;
    const defender = this.pub.pieces[capturedId].color;
    if (!this.owns(defender)) return;
    const type = this.priv[defender][capturedId];
    this.pub = acceptLastMove(revealLost(this.pub, capturedId, type));
    this.send({ t: 'captured', id: capturedId, type });
    this.applyTransform(pieceId, type);
  }

  applyTransform(pieceId, capturedType) {
    const mover = this.pub.pieces[pieceId].color;
    if (this.owns(mover)) this.priv[mover] = transform(this.priv[mover], pieceId, capturedType);
  }

  challenge() {
    if (!this.canChallenge()) return;
    const mover = this.pub.pieces[this.pub.lastMove.pieceId].color;
    if (this.owns(mover)) { this.send({ t: 'challenge' }); this.answerChallenge(); }
    else { this.pub = setPending(this.pub, 'awaitVerdict'); this.send({ t: 'challenge' }); }
    this.changed();
  }

  // The mover's side answers a challenge from its private identities.
  answerChallenge() {
    const { pieceId, capturedId } = this.pub.lastMove;
    const mover = this.pub.pieces[pieceId].color;
    // Judge the move by what the piece was when it moved (a pawn reaching the far rank has
    // already been promoted privately); reveal its current identity if legal.
    const movedAs = this.lastMoverType ?? this.priv[mover][pieceId];
    if (isLastMoveLegal(this.pub, { ...this.priv[mover], [pieceId]: movedAs })) {
      // Legal: say so, but keep the piece's identity to ourselves.
      this.pub = resolveLegal(this.pub);
      this.send({ t: 'verdict', legal: true });
      if (capturedId) this.acceptCapture();
    } else {
      this.pub = resolveBluff(this.pub, movedAs);
      this.send({ t: 'verdict', legal: false, type: movedAs });
    }
  }

  pickPenalty(id) {
    if (this.pub.phase !== 'play' || this.pub.pending !== 'penaltyPick' || this.pub.picker !== this.viewer()) return;
    const p = this.pub.pieces[id];
    if (!p || p.color === this.viewer() || p.square === null) return;
    if (this.owns(p.color)) {
      this.send({ t: 'penalty', id });
      const type = this.priv[p.color][id];
      this.pub = applyPenalty(this.pub, id, type);
      this.send({ t: 'removed', id, type });
    } else {
      this.pub = setPending(this.pub, 'awaitRemoved', id);
      this.send({ t: 'penalty', id });
    }
    this.changed();
  }

  // ---- resign and draw ----
  resign() {
    if (this.pub.phase !== 'play') return;
    this.pub = resignGame(this.pub, this.me ?? this.viewer());
    this.send({ t: 'resign' });
    this.changed();
  }

  canOfferDraw() { return !!this.me && this.pub.phase === 'play' && this.pub.pending === null && this.pub.drawOffer === null; }

  offerDraw() {
    if (!this.canOfferDraw()) return;
    this.send({ t: 'draw', version: this.pub.version });
    this.pub = offerDraw(this.pub, this.me);
    this.changed();
  }

  acceptDraw() {
    if (!this.me || this.pub.phase !== 'play' || this.pub.drawOffer !== other(this.me)) return;
    this.send({ t: 'drawAccept', version: this.pub.version });
    this.pub = agreeDraw(this.pub);
    this.changed();
  }

  declineDraw() {
    if (!this.me || this.pub.phase !== 'play' || this.pub.drawOffer !== other(this.me)) return;
    this.send({ t: 'drawDecline' });
    this.pub = declineDraw(this.pub);
    this.changed();
  }

  // Hot-seat: both players are at the screen, so a draw is agreed in one step.
  agreeDraw() {
    if (this.me || this.pub.phase !== 'play') return;
    this.pub = agreeDraw(this.pub);
    this.changed();
  }

  newGame() {
    this.reset();
    this.send({ t: 'new' });
    this.changed();
  }

  // ---- network: incoming ----
  // Returns true if the message was valid and applied, false if ignored.
  receive(msg) {
    const ok = this.handle(msg);
    if (ok) this.changed();
    return ok;
  }

  handle(msg) {
    if (!this.me || !msg || typeof msg !== 'object') return false;
    const opp = other(this.me);
    const pub = this.pub;
    switch (msg.t) {
      case 'ready': {
        if (pub.phase !== 'setup' || pub.stage[opp] === 'ready') return false;
        this.pub = setStage(pub, opp, 'ready');
        this.tryStart();
        return true;
      }
      case 'move': {
        if (pub.phase !== 'play' || pub.pending !== null || pub.turn !== opp) return false;
        const id = pieceAt(pub, msg.from);
        if (!id || pub.pieces[id].color !== opp) return false;
        if (!destinations(opp, msg.from, occupancy(pub, opp), pub.pieces[id].moved).some((d) => d.to === msg.to)) return false;
        const lm = pub.lastMove;
        if (lm?.challengeable) {
          // Our capture must have been revealed (via `captured`) before the opponent moves on.
          if (lm.capturedId && pub.lost[opp].find((e) => e.id === lm.capturedId)?.type === null) return false;
          this.pub = acceptLastMove(pub);
        }
        this.applyLocalMove(msg.from, msg.to);
        return true;
      }
      case 'captured': {
        const lm = pub.lastMove;
        if (pub.phase !== 'play' || !lm || lm.capturedId !== msg.id || !TYPES.includes(msg.type)) return false;
        if (pub.pieces[msg.id].color !== opp || pub.lost[opp].find((e) => e.id === msg.id)?.type !== null) return false;
        this.pub = acceptLastMove(revealLost(pub, msg.id, msg.type));
        this.applyTransform(lm.pieceId, msg.type);
        return true;
      }
      case 'challenge': {
        const lm = pub.lastMove;
        if (pub.phase !== 'play' || pub.pending !== null || !lm?.challengeable || !lm.moverMoved || pub.turn !== opp) return false;
        if (pub.pieces[lm.pieceId].color !== this.me) return false;
        this.answerChallenge();
        return true;
      }
      case 'verdict': {
        if (pub.phase !== 'play' || pub.pending !== 'awaitVerdict') return false;
        if (!msg.legal && !TYPES.includes(msg.type)) return false;
        if (msg.legal) {
          this.pub = resolveLegal(pub); // leaves pending = 'penaltyPick' for the mover's pick
          if (this.pub.lastMove.capturedId) this.acceptCapture();
        } else {
          this.pub = resolveBluff(pub, msg.type);
        }
        return true;
      }
      case 'penalty': {
        if (pub.phase !== 'play' || pub.pending !== 'penaltyPick' || pub.picker !== opp) return false;
        const p = pub.pieces[msg.id];
        if (!p || p.color !== this.me || p.square === null) return false;
        const type = this.priv[this.me][msg.id];
        this.pub = applyPenalty(pub, msg.id, type);
        this.send({ t: 'removed', id: msg.id, type });
        return true;
      }
      case 'removed': {
        if (pub.phase !== 'play' || pub.pending !== 'awaitRemoved' || pub.penaltyId !== msg.id || !TYPES.includes(msg.type)) return false;
        this.pub = applyPenalty(pub, msg.id, msg.type);
        return true;
      }
      case 'setup': {
        if (msg.gen !== undefined && msg.gen !== pub.gen) return false;
        if (!isValidIdentity(msg.ids, opp)) return false;
        this.setups[opp] = { ...msg.ids };
        return true;
      }
      case 'resign': {
        if (pub.phase !== 'play') return false;
        this.pub = resignGame(pub, opp);
        return true;
      }
      case 'draw': {
        if (pub.phase !== 'play' || pub.pending !== null || pub.drawOffer !== null || msg.version !== pub.version) return false;
        this.pub = offerDraw(pub, opp);
        return true;
      }
      case 'drawAccept': {
        if (pub.phase !== 'play' || pub.drawOffer !== this.me || msg.version !== pub.version) return false;
        this.pub = agreeDraw(pub);
        return true;
      }
      case 'drawDecline': {
        if (pub.phase !== 'play' || pub.drawOffer !== this.me) return false;
        this.pub = declineDraw(pub);
        return true;
      }
      case 'new': {
        // Only outside play: a stray tap mid-game must not wipe the board for both players.
        if (pub.phase === 'play') return false;
        this.reset();
        return true;
      }
      default:
        return false;
    }
  }

  // The request this client is still waiting on a reply for (re-sent after a reconnect).
  outstanding() {
    if (this.pub.pending === 'awaitVerdict') return { t: 'challenge' };
    if (this.pub.pending === 'awaitRemoved') return { t: 'penalty', id: this.pub.penaltyId };
    return null;
  }

  // ---- reconnect handshake ----
  helloMessage() {
    return { t: 'hello', gen: this.pub.gen, version: this.pub.version, ready: this.pub.stage[this.me] === 'ready' };
  }

  // Newer = higher generation, or same generation and higher version.
  isNewerThan(gen, version) {
    return this.pub.gen > gen || (this.pub.gen === gen && this.pub.version > version);
  }

  // Returns a sync message to send if we are strictly newer, else null.
  onHello(msg) {
    if (!msg || typeof msg.version !== 'number') return null;
    const gen = msg.gen ?? 0;
    if (gen === this.pub.gen && this.pub.phase === 'setup' && msg.ready) this.receive({ t: 'ready' });
    return this.isNewerThan(gen, msg.version) ? { t: 'sync', pub: this.pub } : null;
  }

  // ---- persistence and sync ----
  snapshot() { return { pub: this.pub, priv: this.priv, me: this.me, setupColor: this.setupColor, lastMoverType: this.lastMoverType, initial: this.initial, setups: this.setups }; }

  static isSnapshot(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.me !== 'w' && data.me !== 'b') return false;
    const { pub, priv } = data;
    if (!pub || typeof pub !== 'object' || !pub.pieces || typeof pub.version !== 'number' || !pub.lost || !pub.stage) return false;
    if (!priv || typeof priv !== 'object' || !priv[data.me] || typeof priv[data.me] !== 'object') return false;
    return Object.keys(pub.pieces).length === 32;
  }

  static restore(data, { send, onChange } = {}) {
    const g = new Game({ me: data.me, send, onChange });
    g.pub = scrub({ ...data.pub, gen: data.pub.gen ?? 0, penaltyId: data.pub.penaltyId ?? null, pending: data.pub.pending ?? null, picker: data.pub.picker ?? null, history: Array.isArray(data.pub.history) ? data.pub.history : [] });
    g.priv = data.priv; g.setupColor = data.setupColor ?? 'w'; g.lastMoverType = data.lastMoverType ?? null;
    g.initial = data.initial ?? (g.pub.phase === 'setup' ? structuredClone(g.priv) : null);
    g.setups = data.setups ?? { w: null, b: null };
    return g;
  }

  syncFrom(pub) {
    if (!pub || typeof pub !== 'object') return false;
    const gen = pub.gen ?? 0;
    if (gen < this.pub.gen || (gen === this.pub.gen && pub.version <= this.pub.version)) return false;
    if (gen > this.pub.gen) this.reset(gen); // a new game we never heard about: fresh identities
    else if (this.me && pub.stage?.[this.me] === 'ready' && this.pub.stage[this.me] !== 'ready') this.lostState = true;
    const before = this.pub;
    this.pub = scrub(structuredClone(pub));
    // Apply any pawn transformations whose `captured` message we never saw.
    if (this.me) {
      const opp = other(this.me);
      for (const e of this.pub.lost[opp]) {
        if (!e.type || !e.by || this.pub.pieces[e.by].color !== this.me) continue;
        const prev = before.lost[opp].find((x) => x.id === e.id);
        if (!prev || prev.type === null) this.applyTransform(e.by, e.type);
      }
    }
    this.changed();
    return true;
  }
}
