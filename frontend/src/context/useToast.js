// Toast: one message and one timer.
//
// The inherited provider started a new timeout for every toast and never cancelled the old
// one, so a toast shown 2 s after another vanished 1.8 s early. One timer at a time is the
// whole rule: a new message replaces the current one and restarts the clock.

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a toast stays on screen. */
const TOAST_DURATION_MS = 3800;

export function useToast() {
  const [toastMessage, setToastMessage] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((message) => {
    setToastMessage(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setToastMessage(null);
    }, TOAST_DURATION_MS);
  }, []);

  // A timer that fires after unmount would only warn; cancelling it keeps a StrictMode
  // double mount from leaving two clocks running.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { toastMessage, showToast };
}
