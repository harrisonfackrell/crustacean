import { useEffect, useRef } from 'react';
import { useDebounce } from './useDebounce';

const UNLOADED = Symbol('useDebouncedPersist:unloaded');

/**
 * Persist a value to a server-side setting after `delay` ms of inactivity.
 *
 * Replaces the per-setting debounce effect pairs. The first debounced tick
 * after mount is treated as "loading finished" and skipped, so a fresh page
 * load (which replaces all values at once) does not fire spurious saves —
 * only values the user actually typed get persisted.
 *
 * @param {string} key - Settings key to persist
 * @param {string} value - Current value
 * @param {Function} persist - async (key, value) => void
 * @param {number} [delay=800]
 */
export function useDebouncedPersist(key, value, persist, delay = 800) {
  const debounced = useDebounce(value, delay);
  const lastSent = useRef(UNLOADED);

  useEffect(() => {
    if (lastSent.current === UNLOADED) {
      // First tick: just record the loaded value, don't save it
      lastSent.current = debounced;
      return;
    }
    if (debounced === lastSent.current) return;
    lastSent.current = debounced;
    persist(key, debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
}
