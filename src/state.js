/**
 * Минимальный store с подписками.
 * Позволяет добавлять новые поля состояния, не меняя UI.
 */
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();

  return {
    getState: () => state,
    setState: (patch) => {
      const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
      state = next;
      listeners.forEach((fn) => fn(state));
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}