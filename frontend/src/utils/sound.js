// Short two-tone alert for CRITICAL incidents (Web Audio, no asset files).
//
// Rewritten from the inherited version, which created a new AudioContext on every call
// and never closed it. Browsers cap the number of live contexts, so after a handful of
// incidents the alert went silent. One lazily-created context is reused; if autoplay
// policy left it suspended, `resume()` is attempted on the user gesture that caused the
// alert and the failure is ignored (the toast still appears).

let sharedContext = null;

function getContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedContext) sharedContext = new AudioContextClass();
  if (sharedContext.state === 'suspended' && typeof sharedContext.resume === 'function') {
    // Must not reject the alert path: a blocked resume is not an incident failure.
    Promise.resolve(sharedContext.resume()).catch(() => {});
  }
  return sharedContext;
}

function tone(context, { frequency, startAt, duration, peak }) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(peak, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}

export function playCriticalAlertSound() {
  try {
    const context = getContext();
    if (!context) return;
    const now = context.currentTime;
    tone(context, { frequency: 880, startAt: now, duration: 0.12, peak: 0.15 });
    tone(context, { frequency: 1320, startAt: now + 0.14, duration: 0.14, peak: 0.2 });
  } catch (error) {
    console.warn('Alerta sonoră nu poate fi redată în acest browser.', error);
  }
}
