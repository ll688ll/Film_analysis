import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * `useState` mirrored to localStorage under `key`.
 *
 * The stored object is shallow-merged over `initial`, so adding a field later
 * just picks up its default; change the key (e.g. bump a version suffix)
 * when the shape changes incompatibly. Storage failures (private windows,
 * quota, disabled storage) degrade to plain in-memory state.
 */
export function usePersistedState<T extends object>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return { ...initial, ...parsed };
      }
    } catch {
      /* fall through to the default */
    }
    return initial;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage unavailable: keep the in-memory value */
    }
  }, [key, state]);

  return [state, setState];
}
