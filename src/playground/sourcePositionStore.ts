export type SourcePosition = { path: string; line: number; character: number };

export type SourcePositionStore = {
  getSnapshot: () => SourcePosition | undefined;
  set: (position: SourcePosition | undefined) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createSourcePositionStore(): SourcePositionStore {
  let position: SourcePosition | undefined;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => position,
    set(next) {
      if (
        position?.path === next?.path &&
        position?.line === next?.line &&
        position?.character === next?.character
      )
        return;
      position = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
