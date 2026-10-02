const knownUnderlyingSockets = new WeakMap();

function rememberUnderlyingSocket(socket, rawSocket) {
  const existing = knownUnderlyingSockets.get(socket);
  if (existing?.rawSocket === rawSocket) return;

  const entry = { rawSocket };
  knownUnderlyingSockets.set(socket, entry);
  rawSocket.once('close', () => {
    if (knownUnderlyingSockets.get(socket) === entry) knownUnderlyingSockets.delete(socket);
  });
}

export function trackWhatsAppSocket(socket) {
  const rawSocket = socket?.ws?.socket;
  if (!rawSocket || typeof rawSocket.once !== 'function') return false;
  rememberUnderlyingSocket(socket, rawSocket);
  return true;
}

export async function closeWhatsAppSocket(socket, {
  timeoutMs = 2_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!socket) return true;

  const wrapper = socket.ws;
  const rawSocket = wrapper?.socket || knownUnderlyingSockets.get(socket)?.rawSocket;
  if (!rawSocket) {
    if (!wrapper || wrapper.isClosed === true || wrapper.readyState === 3) return true;
    try { socket.end?.(); } catch {}
    return false;
  }
  if (rawSocket.readyState === 3) {
    knownUnderlyingSockets.delete(socket);
    return true;
  }
  if (typeof rawSocket.once !== 'function' || typeof rawSocket.off !== 'function') {
    try { socket.end?.(); } catch {}
    return rawSocket.readyState === 3;
  }

  rememberUnderlyingSocket(socket, rawSocket);
  let settled = false;
  let timer;
  let finish;
  const completion = new Promise((resolve) => {
    finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      rawSocket.off('close', onClose);
      if (closed || rawSocket.readyState === 3) {
        knownUnderlyingSockets.delete(socket);
        resolve(true);
      } else {
        resolve(false);
      }
    };
    const onClose = () => finish(true);
    rawSocket.once('close', onClose);
    timer = setTimer(() => finish(rawSocket.readyState === 3), Math.max(1, timeoutMs));
  });

  try { socket.end?.(); } catch {}
  if (rawSocket.readyState === 3) finish(true);
  return completion;
}
