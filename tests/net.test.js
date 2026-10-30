import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connect, iceConfig } from '../src/net.js';

// Minimal fake of the PeerJS surface net.js uses.
class Emitter { constructor() { this.h = {}; } on(e, f) { (this.h[e] ||= []).push(f); return this; } emit(e, ...a) { (this.h[e] || []).forEach((f) => f(...a)); } }
class FakeConn extends Emitter { constructor(peerId) { super(); this.peer = peerId; this.open = false; this.sent = []; } send(m) { this.sent.push(m); } close() { this.open = false; this.emit('close'); } }
let peers = [];
class FakePeer extends Emitter {
  constructor(id, opts) { super(); this.id = id ?? 'anon-' + peers.length; this.opts = opts ?? (typeof id === 'object' ? id : undefined); if (typeof id === 'object') this.id = 'anon-' + peers.length; this.destroyed = false; this.dialed = []; peers.push(this); }
  connect(id, opts) { const c = new FakeConn(id); this.dialed.push({ id, opts, conn: c }); return c; }
  reconnect() { this.reconnected = true; }
  destroy() { this.destroyed = true; }
}
const openConn = (c) => { c.open = true; c.emit('open'); };

describe('net transport', () => {
  beforeEach(() => { peers = []; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('host registers the room id and joiner dials it with a reliable channel', () => {
    const h = connect({ room: 'abc', host: true, onMessage() {}, PeerImpl: FakePeer });
    const j = connect({ room: 'abc', host: false, onMessage() {}, PeerImpl: FakePeer });
    expect(peers[0].id).toBe('hic-abc');
    peers[1].emit('open');
    expect(peers[1].dialed[0]).toMatchObject({ id: 'hic-abc', opts: { reliable: true } });
    h.close(); j.close();
  });

  it('reports connecting, waiting (host), connected and disconnected statuses', () => {
    const statuses = [];
    const h = connect({ room: 'abc', host: true, onMessage() {}, onStatus: (s, d) => statuses.push(d ? `${s}:${d}` : s), PeerImpl: FakePeer });
    peers[0].emit('open');
    const c = new FakeConn('joiner'); peers[0].emit('connection', c); openConn(c);
    c.close();
    expect(statuses).toEqual(['connecting', 'connecting:waiting', 'connected', 'disconnected']);
    h.close();
  });

  it('wraps outgoing messages in an increasing seq, except hello and sync', () => {
    const h = connect({ room: 'abc', host: true, onMessage() {}, PeerImpl: FakePeer });
    const c = new FakeConn('j'); peers[0].emit('connection', c);
    expect(h.send({ t: 'move' })).toBe(false);           // not open yet: dropped
    openConn(c);
    h.send({ t: 'move', from: 'e2', to: 'e4' }); h.send({ t: 'hello', version: 1 }); h.send({ t: 'ready' });
    expect(c.sent).toEqual([{ seq: 1, t: 'move', from: 'e2', to: 'e4' }, { t: 'hello', version: 1 }, { seq: 2, t: 'ready' }]);
    h.close();
  });

  it('drops duplicate and out-of-order incoming messages but always passes hello/sync (Review Focus 2)', () => {
    const got = [];
    const h = connect({ room: 'abc', host: true, onMessage: (m) => got.push(m), PeerImpl: FakePeer });
    const c = new FakeConn('j'); peers[0].emit('connection', c); openConn(c);
    c.emit('data', { seq: 1, t: 'move' }); c.emit('data', { seq: 1, t: 'move' }); c.emit('data', { seq: 3, t: 'ready' });
    c.emit('data', { seq: 2, t: 'late' }); c.emit('data', { t: 'hello', version: 4 }); c.emit('data', { t: 'nope' }); c.emit('data', 'garbage');
    expect(got).toEqual([{ t: 'move' }, { t: 'ready' }, { t: 'hello', version: 4 }]);
    h.close();
  });

  it('calls onOpen on every (re)connection and resets sequence numbers', () => {
    let opens = 0; const got = [];
    const h = connect({ room: 'abc', host: true, onMessage: (m) => got.push(m), onOpen: () => opens++, PeerImpl: FakePeer });
    const c1 = new FakeConn('j'); peers[0].emit('connection', c1); openConn(c1);
    c1.emit('data', { seq: 5, t: 'a' }); h.send({ t: 'x' }); c1.close();
    const c2 = new FakeConn('j'); peers[0].emit('connection', c2); openConn(c2);
    c2.emit('data', { seq: 1, t: 'b' }); h.send({ t: 'y' });
    expect(opens).toBe(2); expect(got).toEqual([{ t: 'a' }, { t: 'b' }]); expect(c2.sent).toEqual([{ seq: 1, t: 'y' }]);
    h.close();
  });

  it('joiner retries every 3s after a drop or a peer-unavailable error, and stops after close', () => {
    const statuses = [];
    const j = connect({ room: 'abc', host: false, onMessage() {}, onStatus: (s, d) => statuses.push(d ? `${s}:${d}` : s), PeerImpl: FakePeer });
    const p = peers[0]; p.emit('open');
    expect(p.dialed.length).toBe(1);
    p.emit('error', { type: 'peer-unavailable' });
    expect(statuses).toContain('disconnected:host offline');
    vi.advanceTimersByTime(3000); expect(p.dialed.length).toBe(2);
    openConn(p.dialed[1].conn); p.dialed[1].conn.close();
    vi.advanceTimersByTime(3000); expect(p.dialed.length).toBe(3);
    j.close(); vi.advanceTimersByTime(10000); expect(p.dialed.length).toBe(3); expect(p.destroyed).toBe(true);
  });

  it('host reports a taken room as an error and reconnects to signaling when dropped', () => {
    const statuses = [];
    const h = connect({ room: 'abc', host: true, onMessage() {}, onStatus: (s, d) => statuses.push(d ? `${s}:${d}` : s), PeerImpl: FakePeer });
    peers[0].emit('error', { type: 'unavailable-id' }); expect(statuses).toContain('error:room taken');
    peers[0].emit('disconnected'); expect(peers[0].reconnected).toBe(true);
    h.close();
  });

  it('iceConfig has Google STUN and adds TURN only when env provides it', () => {
    expect(iceConfig({}).iceServers).toEqual([{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]);
    const withTurn = iceConfig({ VITE_TURN_URLS: 'turn:a.example:443,turns:a.example:443?transport=tcp', VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'p' });
    expect(withTurn.iceServers[1]).toEqual({ urls: ['turn:a.example:443', 'turns:a.example:443?transport=tcp'], username: 'u', credential: 'p' });
    expect(peers.length).toBe(0);
  });

  it('passes the ICE config to PeerJS', () => {
    const h = connect({ room: 'abc', host: true, onMessage() {}, PeerImpl: FakePeer });
    expect(peers[0].opts.config.iceServers[0].urls[0]).toMatch(/^stun:/);
    h.close();
  });
});
