// Short two-tone alert for CRITICAL incidents (Web Audio, no asset files).
//
// The inherited version created a new AudioContext on every call and never closed it, and
// browsers cap live contexts: after a handful of incidents the alert went silent. One
// lazily-created context is reused instead. If autoplay policy left that context suspended,
// `resume()` is attempted on the user gesture that caused the alert, and a blocked resume is
// ignored — the toast still appears.
const ALERT_TONES = [
  { frequency: 880, delay: 0, duration: 0.12, peak: 0.15 },
  { frequency: 1320, delay: 0.14, duration: 0.14, peak: 0.2 },
];
const DECAY_FLOOR = 0.001;
let sharedContext = null;
const audioContextClass = () => {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
};
const getAudioContext = () => {
  const AudioContextClass = audioContextClass();
  if (!AudioContextClass) return null;
  if (!sharedContext) sharedContext = new AudioContextClass();
  const suspended = sharedContext.state === 'suspended';
  if (suspended && typeof sharedContext.resume === 'function') {
    // Must not reject the alert path: a blocked resume is not an incident failure.
    Promise.resolve(sharedContext.resume()).catch(() => {});
  }
  return sharedContext;
};
const scheduleTone = (context, { frequency, startAt, duration, peak }) => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(peak, startAt);
  gain.gain.exponentialRampToValueAtTime(DECAY_FLOOR, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
};
const playAlertSequence = () => {
  const context = getAudioContext();
  if (!context) return;
  const now = context.currentTime;
  ALERT_TONES.forEach((tone) => scheduleTone(context, { ...tone, startAt: now + tone.delay }));
};
const reportAudioFailure = (error) =>
  console.warn('Alerta sonoră nu poate fi redată în acest browser.', error);
export const playCriticalAlertSound = () => {
  try {
    playAlertSequence();
  } catch (error) { reportAudioFailure(error); }
};
