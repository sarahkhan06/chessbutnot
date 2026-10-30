// PeerJS transport: one data channel per game, sequence-numbered envelope, joiner auto-reconnect.
import Peer from 'peerjs';

const RETRY_MS = 3000;
const MAX_RETRIES = 100; // ~5 minutes

export function connect({ room, host, onMessage, onStatus = () => {}, onOpen = () => {} }) {
  const id = 'hic-' + room;
  let peer = null, conn = null, seqOut = 0, seqIn = 0, retries = 0, retryTimer = null, closed = false;

  function wire(c) {
    if (conn && conn !== c) { try { conn.close(); } catch { /* ignore */ } }
    conn = c;
    c.on('open', () => {
      if (closed) return;
      seqOut = 0; seqIn = 0; retries = 0;
      onStatus('connected');
      onOpen();
    });
    c.on('data', (d) => {
      if (closed || !d || typeof d !== 'object') return;
      if (d.t === 'hello' || d.t === 'sync') { onMessage(d); return; }
      if (typeof d.seq !== 'number' || d.seq <= seqIn) return; // duplicate or out of order
      seqIn = d.seq;
      const { seq, ...msg } = d;
      onMessage(msg);
    });
    const lost = () => {
      if (closed || conn !== c) return;
      conn = null;
      onStatus('disconnected');
      if (!host) scheduleRetry();
    };
    c.on('close', lost);
    c.on('error', lost);
  }

  function dial() {
    if (closed || !peer || peer.destroyed) return;
    onStatus('connecting');
    wire(peer.connect(id, { reliable: true }));
  }

  function scheduleRetry() {
    if (closed || retryTimer || retries >= MAX_RETRIES) return;
    retries += 1;
    retryTimer = setTimeout(() => { retryTimer = null; dial(); }, RETRY_MS);
  }

  onStatus('connecting');
  peer = host ? new Peer(id) : new Peer();
  peer.on('open', () => { if (host) onStatus('connecting', 'waiting'); else dial(); });
  if (host) peer.on('connection', wire);
  peer.on('disconnected', () => { if (!closed && !peer.destroyed) peer.reconnect(); });
  peer.on('error', (e) => {
    if (closed) return;
    if (host && e.type === 'unavailable-id') onStatus('error', 'room taken');
    else if (!host && e.type === 'peer-unavailable') { onStatus('disconnected', 'host offline'); scheduleRetry(); }
    else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed') { onStatus('disconnected', e.type); if (!host) scheduleRetry(); }
    else onStatus('error', e.type);
  });

  return {
    send(msg) {
      if (!conn || !conn.open) return false;
      conn.send(msg.t === 'hello' || msg.t === 'sync' ? msg : { seq: ++seqOut, ...msg });
      return true;
    },
    close() {
      closed = true;
      clearTimeout(retryTimer);
      try { conn?.close(); } catch { /* ignore */ }
      try { peer?.destroy(); } catch { /* ignore */ }
    },
    get connected() { return !!(conn && conn.open); },
  };
}
