// A tiny synchronous event bus so plugins can observe the agent's lifecycle
// without the core knowing about them. Listeners are awaited in registration
// order; a throwing listener is isolated (logged via the "error" channel is the
// caller's job) so one bad plugin can't abort a turn.

export const EVENTS = ["toolStart", "toolEnd", "modelResponse", "error", "sessionStart", "sessionEnd"];

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  return listeners.get(event)?.delete(fn) ?? false;
}

export async function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      await fn(payload);
    } catch {
      // a listener must never break the agent loop
    }
  }
}

// Test/utility: drop every listener.
export function clear() {
  listeners.clear();
}
