import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Crosshair, RotateCcw, X } from 'lucide-react';
import {
  DEFAULT_GROUND_RECT_M,
  buildGroundHomography,
  clearStoredGroundCalibration,
  groundCalibrationStatus,
  groundCalibrationStorage,
  readStoredGroundCalibration,
  storeGroundCalibration,
} from '../../utils/groundCalibration';

// The `/lab` ground-calibration panel, extracted for Live.
//
// Four clicks on the camera's reference still, in rectangle order (top-left, top-right,
// bottom-right, bottom-left), plus the real rectangle the operator measured. It is the
// same math as `/lab` (`engine/groundPlane.js`), but the calibration is stored per camera
// and reused by the Live engine card, which turns tracked foot points into metres.
//
// Deliberately not a full-screen takeover: the panel is a block inside the engine card, so
// the operator still sees the engine status and the incident list while calibrating. The
// image is the reference still, not the processed canvas: the footprint was drawn on that
// frame, and calibrating on a moving frame would tie metres to a geometry that no longer
// exists by the next frame.
//
// The stored value is the four normalized points and the two sides; the homography is
// rebuilt on read and can be `null` (four collinear clicks, a zero side), in which case the
// panel refuses to save instead of printing metres from a degenerate map.

/**
 * Per-camera calibration, read from and written to localStorage.
 *
 * Re-reads only when the camera changes or a save/reset bumps `revision`, so a render does
 * not touch storage. `save` returns `false` when storage is blocked; the caller must show
 * that instead of pretending the calibration persists.
 *
 * @param {string} cameraId
 * @returns {{
 *   calibration: {points: Array<{x: number, y: number}>, widthM: number, heightM: number}|null,
 *   calibrated: boolean,
 *   degenerate: boolean,
 *   homography: number[]|null,
 *   label: string,
 *   save: (calibration: unknown) => boolean,
 *   reset: () => boolean,
 * }}
 */
export function useGroundCalibration(cameraId) {
  const [revision, setRevision] = useState(0);

  const calibration = useMemo(
    () => readStoredGroundCalibration(groundCalibrationStorage(), cameraId),
    // `revision` is the only manual invalidation: a save/reset re-reads the same key.
    [cameraId, revision]
  );

  const save = useCallback(
    (next) => {
      const saved = storeGroundCalibration(groundCalibrationStorage(), cameraId, next);
      if (saved) setRevision((value) => value + 1);
      return saved;
    },
    [cameraId]
  );

  const reset = useCallback(() => {
    clearStoredGroundCalibration(groundCalibrationStorage(), cameraId);
    setRevision((value) => value + 1);
    return true;
  }, [cameraId]);

  const status = useMemo(() => groundCalibrationStatus(calibration), [calibration]);

  return {
    calibration,
    calibrated: status.calibrated,
    degenerate: status.degenerate,
    homography: status.homography,
    label: status.label,
    save,
    reset,
  };
}

/** Romanian decimal input: an emptied field becomes NaN, which validation rejects. */
function sideValue(value) {
  return Number.isFinite(value) ? value : '';
}

function MetricInput({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300">
      {label}
      <input
        type="number"
        min="0.01"
        step="0.5"
        inputMode="decimal"
        aria-label={`${label}, în metri`}
        value={sideValue(value)}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="w-16 rounded border border-slate-300 bg-white px-1.5 py-1 font-mono text-[11px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#7EDEED] dark:border-white/20 dark:bg-black/30 dark:text-slate-100"
      />
      m
    </label>
  );
}

/**
 * @param {object} props
 * @param {string} props.cameraId
 * @param {string} [props.cameraLabel]
 * @param {string} props.referenceUrl the still the zones were drawn on
 * @param {{points: Array<{x: number, y: number}>, widthM: number, heightM: number}|null} props.savedCalibration
 * @param {(calibration: {points: Array<{x: number, y: number}>, widthM: number, heightM: number}) => boolean} props.onSave
 * @param {() => void} props.onReset
 * @param {() => void} props.onClose
 */
export default function GroundCalibration({
  cameraId,
  cameraLabel,
  referenceUrl,
  savedCalibration,
  onSave,
  onReset,
  onClose,
}) {
  const [points, setPoints] = useState(() => savedCalibration?.points ?? []);
  const [widthM, setWidthM] = useState(savedCalibration?.widthM ?? DEFAULT_GROUND_RECT_M.widthM);
  const [heightM, setHeightM] = useState(savedCalibration?.heightM ?? DEFAULT_GROUND_RECT_M.heightM);
  // An uncalibrated camera starts picking at once: the first click is the first corner.
  const [picking, setPicking] = useState(() => !savedCalibration);
  const [imageFailed, setImageFailed] = useState(false);
  const [message, setMessage] = useState('');
  const imageRef = useRef(null);

  const draft = useMemo(
    () => (points.length === 4 ? { points, widthM, heightM } : null),
    [points, widthM, heightM]
  );
  const draftStatus = useMemo(() => groundCalibrationStatus(draft), [draft]);
  const savedStatus = useMemo(
    () => groundCalibrationStatus(savedCalibration),
    [savedCalibration]
  );
  const homography = useMemo(() => buildGroundHomography(draft), [draft]);

  useEffect(() => {
    if (points.length >= 4) setPicking(false);
  }, [points.length]);

  const startAgain = () => {
    setPoints([]);
    setPicking(true);
    setMessage('');
  };

  const onPointerDown = (event) => {
    if (!picking || imageFailed) return;
    const box = imageRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    setPoints((previous) => [...previous, { x, y }].slice(0, 4));
  };

  const commit = () => {
    if (!draft || !draftStatus.calibrated) return;
    if (!onSave(draft)) {
      setMessage('calibrarea nu a putut fi salvată (stocarea locală este blocată); nu a fost aplicată.');
      return;
    }
    setMessage('');
    onClose();
  };

  const clear = () => {
    onReset();
    setPoints([]);
    setWidthM(DEFAULT_GROUND_RECT_M.widthM);
    setHeightM(DEFAULT_GROUND_RECT_M.heightM);
    setPicking(true);
    setMessage('');
  };

  const statusText =
    points.length < 4
      ? `necalibrat · ${points.length}/4 puncte`
      : draftStatus.calibrated
        ? draftStatus.label
        : 'necalibrat — puncte degenere (coliniare, duplicate) sau dimensiuni invalide';
  const statusTone = draftStatus.calibrated
    ? 'text-cyan-700 dark:text-[#33E1FF]'
    : draftStatus.degenerate
      ? 'text-[#B91C1C] dark:text-[#FF8A80]'
      : 'text-slate-500 dark:text-slate-400';

  return (
    <div
      data-testid="ground-calibration"
      data-camera={cameraId}
      data-calibrated={savedStatus.calibrated ? 'true' : 'false'}
      className="rounded-lg border border-slate-300/80 bg-slate-50/70 p-2.5 dark:border-white/15 dark:bg-black/20"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
            <Crosshair size={12} className="shrink-0 text-cyan-700 dark:text-[#33E1FF]" />
            Calibrare sol {cameraLabel ? <span className="truncate font-mono normal-case">· {cameraLabel}</span> : null}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
            4 clicuri pe cadrul de referință, în ordinea colțurilor: sus-stânga,
            sus-dreapta, jos-dreapta, jos-stânga. Dimensiunile sunt cele măsurate pe sol.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Închide calibrarea"
          className="rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <MetricInput label="Lățime" value={widthM} onChange={setWidthM} />
        <MetricInput label="Lungime" value={heightM} onChange={setHeightM} />
        <p className={`text-[11px] ${statusTone}`} data-testid="ground-calibration-status">
          {statusText}
        </p>
        {picking && points.length < 4 && (
          <span className="rounded bg-[#FFEB33]/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800 dark:text-[#FFEB33]">
            apasă colțul {points.length + 1} din 4
          </span>
        )}
      </div>

      <div className="mt-2 max-w-[480px]">
        <div className="relative overflow-hidden rounded border border-slate-300 bg-black dark:border-white/15">
          {imageFailed ? (
            <div className="flex aspect-video items-center justify-center px-3 text-center text-[11px] text-slate-300">
              Cadrul de referință nu s-a putut încărca. Fără el nu se pot plasa colțurile;
              calibrarea salvată rămâne neatinsă.
            </div>
          ) : (
            <>
              <img
                ref={imageRef}
                src={referenceUrl}
                alt={`Cadru de referință ${cameraLabel || cameraId} pentru calibrarea solului`}
                className="block h-auto w-full select-none"
                draggable={false}
                onError={() => setImageFailed(true)}
              />
              <div
                onPointerDown={onPointerDown}
                data-testid="ground-calibration-stage"
                title={picking ? `Alege colțul ${points.length + 1} din 4 pe sol` : undefined}
                className="absolute inset-0"
                style={{
                  pointerEvents: picking ? 'auto' : 'none',
                  cursor: picking ? 'crosshair' : 'default',
                }}
              >
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="h-full w-full"
                  aria-hidden="true"
                >
                  {points.length >= 2 && (
                    <polyline
                      points={points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')}
                      fill={points.length === 4 ? 'rgba(51, 225, 255, 0.12)' : 'none'}
                      stroke="#33E1FF"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
                {points.map((point, index) => (
                  <span
                    key={`${point.x}-${point.y}-${index}`}
                    aria-hidden="true"
                    className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#33E1FF] bg-[#0B0B0B] font-mono text-[10px] font-bold text-[#33E1FF] shadow"
                    style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                  >
                    {index + 1}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <p className="mt-1.5 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
        Calibrarea e desenată pe cadrul de referință. Pe o cameră care se mișcă, viteza
        rămâne orientativă; nu este o măsurătoare de teren.
      </p>

      {message && (
        <p role="alert" className="mt-1.5 text-[10px] font-semibold text-[#B91C1C] dark:text-[#FF8A80]">
          {message}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={commit}
          disabled={!homography}
          title={
            homography
              ? 'Salvează calibrarea pentru această cameră'
              : 'Calibrarea nu este validă: patru colțuri distincte și două dimensiuni pozitive'
          }
          className="inline-flex items-center gap-1 rounded border border-cyan-600/50 bg-cyan-600/10 px-2 py-1 text-[11px] font-bold text-cyan-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#33E1FF]/40 dark:bg-[#33E1FF]/10 dark:text-[#33E1FF]"
        >
          <Check size={12} aria-hidden="true" /> Salvează
        </button>
        <button
          type="button"
          onClick={startAgain}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/20 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
        >
          <Crosshair size={12} aria-hidden="true" />
          {picking ? 'Anulează punctele' : 'Calibrează din nou'}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={!savedStatus.calibrated && points.length === 0}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
        >
          <RotateCcw size={12} aria-hidden="true" /> Resetează
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-200/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100"
        >
          Renunță
        </button>
      </div>
    </div>
  );
}
