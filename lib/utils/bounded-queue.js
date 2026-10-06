export function createBoundedQueue({ concurrency = 2, maxQueued = 4 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('concurrency must be a positive integer');
  if (!Number.isInteger(maxQueued) || maxQueued < 0) throw new TypeError('maxQueued must be a non-negative integer');

  const pending = [];
  const idleWaiters = new Set();
  let active = 0;

  function notifyIdle() {
    if (active !== 0 || pending.length !== 0) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  function pump() {
    while (active < concurrency && pending.length > 0) {
      const task = pending.shift();
      active += 1;
      Promise.resolve()
        .then(task)
        .catch(() => {})
        .finally(() => {
          active -= 1;
          pump();
          notifyIdle();
        });
    }
  }

  return {
    add(task) {
      if (typeof task !== 'function') throw new TypeError('task must be a function');
      if (active + pending.length >= concurrency + maxQueued) return false;
      pending.push(task);
      pump();
      return true;
    },
    whenIdle() {
      if (active === 0 && pending.length === 0) return Promise.resolve();
      return new Promise(resolve => idleWaiters.add(resolve));
    },
    get active() {
      return active;
    },
    get pending() {
      return pending.length;
    },
  };
}

export default createBoundedQueue;
