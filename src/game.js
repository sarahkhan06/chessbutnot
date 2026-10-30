// Game orchestrator: one public state plus the private identities this client owns.
// Local UI actions and incoming messages both flow through here; outgoing messages leave via `send`.
import {
  createState, pieceAt, occupancy, setStage, startPlay, setPending, applyMove, acceptLastMove,
  revealLost, resolveLegal, resolveBluff, applyPenalty,
} from './rules/state.js';
import { TYPES, destinations } from './rules/geometry.js';
import { standardIdentity, swapIdentity, promote, transform, isLastMoveLegal, legalDestinations } from './rules/identity.js';

const other = (c) => (c === 'w' ? 'b' : 'w');

export class Game {
  constructor({ me = null, send = () => {}, onChange = () => {} } = {}) {
    this.me = me;
    this.send = send;
    this.onChange = onChange;
    this.reset();
  }

  reset() {
    this.pub = createState();
    this.priv = { w: this.owns('w') ? standardIdentity('w') : null, b: this.owns('b') ? standardIdentity('b') : null };
    this.setupColor = 'w';
  }

  owns(color) { return this.me === null || this.me === color; }
  viewer() { return this.me ?? (this.pub.phase === 'setup' ? this.setupColor : this.pub.turn); }
  isGameOver() { return this.pub.phase === 'over'; }
  changed() { this.onChange(); }

  // ---- setup ----
  swap(color, sqA, sqB) {
    if (this.pub.phase !== 'setup' || !this.owns(color) || this.pub.stage[color] !== 'arranging') return;
    const a = pieceAt(this.pub, sqA), b = pieceAt(this.pub, sqB);
    if (!a || !b || this.pub.pieces[a].color !== color || this.pub.pieces[b].color !== color) return;
    this.priv[color] = swapIdentity(this.priv[color], a, b);
    this.changed();
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
  canAct() { return this.pub.phase === 'play' && this.pub.pending === null && this.pub.turn === this.viewer() && this.owns(this.pub.turn); }

  destinations(from) {
    if (!this.canAct()) return [];
    const id = pieceAt(this.pub, from);
    if (!id || this.pub.pieces[id].color !== this.viewer()) return [];
    return legalDestinations(this.pub, this.priv[this.viewer()], from);
  }

  canChallenge() { return this.canAct() && !!this.pub.lastMove?.challengeable; }

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
    if (this.owns(color)) this.priv[color] = promote(this.priv[color], id, to, color);
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
    this.send({ t: 'challenge' });
    const mover = this.pub.pieces[this.pub.lastMove.pieceId].color;
    if (this.owns(mover)) this.answerChallenge();
    else this.pub = setPending(this.pub, 'awaitVerdict');
    this.changed();
  }

  // The mover's side answers a challenge from its private identities.
  answerChallenge() {
    const { pieceId, capturedId } = this.pub.lastMove;
    const mover = this.pub.pieces[pieceId].color;
    const type = this.priv[mover][pieceId];
    if (isLastMoveLegal(this.pub, this.priv[mover])) {
      this.pub = resolveLegal(this.pub, type);
      this.send({ t: 'verdict', legal: true, type });
      if (capturedId) this.acceptCapture();
    } else {
      this.pub = resolveBluff(this.pub, type);
      this.send({ t: 'verdict', legal: false, type });
    }
  }

  pickPenalty(id) {
    if (this.pub.phase !== 'play' || this.pub.pending !== 'penaltyPick' || this.pub.turn !== this.viewer()) return;
    const p = this.pub.pieces[id];
    if (!p || p.color === this.viewer() || p.square === null) return;
    this.send({ t: 'penalty', id });
    if (this.owns(p.color)) {
      const type = this.priv[p.color][id];
      this.pub = applyPenalty(this.pub, id, type);
      this.send({ t: 'removed', id, type });
    } else {
      this.pub = setPending(this.pub, 'awaitRemoved', id);
    }
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
        if (pub.phase !== 'play' || pub.pending !== null || !lm?.challengeable || pub.turn !== opp) return false;
        if (pub.pieces[lm.pieceId].color !== this.me) return false;
        this.answerChallenge();
        return true;
      }
      case 'verdict': {
        if (pub.phase !== 'play' || pub.pending !== 'awaitVerdict' || !TYPES.includes(msg.type)) return false;
        if (msg.legal) {
          this.pub = setPending(resolveLegal(pub, msg.type), null);
          if (this.pub.lastMove.capturedId) this.acceptCapture();
        } else {
          this.pub = resolveBluff(pub, msg.type);
        }
        return true;
      }
      case 'penalty': {
        if (pub.phase !== 'play' || pub.pending !== 'penaltyPick' || pub.turn !== opp) return false;
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
      case 'new': {
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

  // ---- persistence and sync ----
  snapshot() { return { pub: this.pub, priv: this.priv, me: this.me, setupColor: this.setupColor }; }

  static restore(data, { send, onChange } = {}) {
    const g = new Game({ me: data.me, send, onChange });
    g.pub = data.pub; g.priv = data.priv; g.setupColor = data.setupColor ?? 'w';
    return g;
  }

  syncFrom(pub) {
    if (!pub || pub.version <= this.pub.version) return false;
    this.pub = structuredClone(pub);
    this.changed();
    return true;
  }
}
