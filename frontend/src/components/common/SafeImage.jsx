import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

// `blob:pending` is what the in-browser engine puts in `snapshot_url` until the frame is
// written. It is not a loadable URL, so asking the browser for it logs
// "Not allowed to load local resource"; the honest state is "capture unavailable".
const PENDING_SOURCES = new Set(['blob:pending']);

/**
 * An <img> that keeps its box when the capture is missing, still loading or failed.
 * The placeholder says what happened; it never fakes a snapshot.
 */
export default function SafeImage({
  src,
  alt = '',
  className = '',
  label = 'captură indisponibilă',
  pendingLabel = 'captură indisponibilă (motor local)',
  iconSize = 18,
}) {
  const [failed, setFailed] = useState(false);

  // A new source deserves a new attempt (the list reuses cards between events).
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const pending = !src || PENDING_SOURCES.has(src);
  if (pending || failed) {
    const text = pending ? pendingLabel : label;
    return (
      <div
        role="img"
        aria-label={text}
        title={text}
        className={`flex flex-col items-center justify-center gap-0.5 overflow-hidden text-center font-mono leading-tight text-slate-400 ${className}`}
      >
        <ImageOff size={iconSize} className="text-slate-500 shrink-0" />
        <span className="px-1">{text}</span>
      </div>
    );
  }

  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={className} />;
}
