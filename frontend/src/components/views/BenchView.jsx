import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Cpu, Download, Play, Square, Trash2, Upload, Video } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useEngine } from '../../engine/useEngine';

// Measurement page: same engine as `/lab`, but with knobs and a saved history. It answers
// one question honestly - how fast does this browser run the pipeline on this machine?
// Not linked from the sidebar on purpose; open it by URL.

const STORAGE_KEY = 'localsight.bench';
const STORAGE_LIMIT = 200;

const PROVIDERS = [
  { id: 'webgpu', label: 'WebGPU' },
  { id: 'wasm', label: 'WASM' },
];
const SIZES = [640, 960, 1280];
const DURATIONS = [10, 20, 30];
const CLIPS = ['stand12.mp4', 'baggage-area.mp4', 'taxiway-b.mp4'];

const BASE = import.meta.env.BASE_URL;

function round1(value) {
  return Math.round(value * 10) / 10;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

// fps is "frames the pipeline actually finished per second", not the camera's frame rate:
// the hook drops frames while the worker is busy, and that drop is the thing being measured.
function summarise(samples, startAt, endAt) {
  const values = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const windowMs = Math.max(1, endAt - startAt) + mean;
  const last = samples[samples.length - 1] || {};
  return {
    fps: samples.length ? (samples.length * 1000) / windowMs : 0,
    mean,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    frames: samples.length,
    persons: last.persons ?? 0,
    faces: last.faces ?? 0,
  };
}

function readRuns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRuns(runs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
    return true;
  } catch {
    return false;
  }
}

// `?seconds=5` is for scripted runs (Playwright, a quick sanity check); the picker keeps
// the three durations the page advertises.
function durationFromUrl() {
  try {
    const value = Number(new URLSearchParams(window.location.search).get('seconds'));
    if (!Number.isFinite(value) || value < 1 || value > 120) return null;
    return Math.round(value);
  } catch {
    return null;
  }
}

export default function BenchView() {
  const { themeStyles } = useTheme();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const urlDuration = useMemo(durationFromUrl, []);
  const durationOptions = useMemo(
    () => [...new Set([...DURATIONS, ...(urlDuration ? [urlDuration] : [])])].sort((a, b) => a - b),
    [urlDuration],
  );

  const [provider, setProvider] = useState('wasm');
  const [inputSize, setInputSize] = useState(640);
  const [durationSec, setDurationSec] = useState(urlDuration || 10);

  const [webgpu, setWebgpu] = useState({ status: 'checking', detail: '' });
  const webgpuAvailable = webgpu.status === 'available';
  const webgpuUnavailable = webgpu.status === 'unavailable';

  const [clipIndex, setClipIndex] = useState(0);
  const [clipUrl, setClipUrl] = useState(`${BASE}media/${CLIPS[0]}`);
  const [fileUrl, setFileUrl] = useState('');
  const [videoError, setVideoError] = useState('');
  const [videoReady, setVideoReady] = useState(false);

  // idle -> starting (worker warms up, models load) -> measuring -> done
  const [phase, setPhase] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [runError, setRunError] = useState('');
  const [storageError, setStorageError] = useState('');

  const [runs, setRuns] = useState(readRuns);

  const samplesRef = useRef([]);
  const startAtRef = useRef(0);
  const finishedRef = useRef(false);
  const lastLiveAtRef = useRef(0);
  const runsRef = useRef(runs);
  runsRef.current = runs;

  // Callbacks are stored in a ref inside the hook, so these are read on the next frame.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const durationRef = useRef(durationSec);
  durationRef.current = durationSec;
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const inputSizeRef = useRef(inputSize);
  inputSizeRef.current = inputSize;
  const actualProviderRef = useRef('');

  // WebGPU is a question, not an assumption: ask for an adapter once and say what happened.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (!navigator.gpu) {
        if (!cancelled) setWebgpu({ status: 'unavailable', detail: 'navigator.gpu nu există' });
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (cancelled) return;
        if (!adapter) {
          setWebgpu({ status: 'unavailable', detail: 'requestAdapter() a returnat null' });
          return;
        }
        const info = adapter.info || {};
        setWebgpu({
          status: 'available',
          detail: [info.vendor, info.architecture].filter(Boolean).join(' ') || 'adapter disponibil',
        });
      } catch (error) {
        if (!cancelled) {
          setWebgpu({ status: 'unavailable', detail: error?.message || 'requestAdapter() a eșuat' });
        }
      }
    };
    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  // If the probe says no, do not leave a stale WebGPU selection behind: the run goes wasm.
  useEffect(() => {
    if (webgpuUnavailable) setProvider((current) => (current === 'webgpu' ? 'wasm' : current));
  }, [webgpuUnavailable]);

  // A picked file owns a blob URL until it is replaced or the page is left.
  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  }, [fileUrl]);

  const finishRun = useCallback((endAt) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const samples = samplesRef.current;
    const startAt = startAtRef.current || endAt;
    const summary = summarise(samples, startAt, endAt);
    const actual = actualProviderRef.current || providerRef.current;
    const run = {
      date: new Date().toISOString(),
      provider: actual,
      requested_provider: providerRef.current,
      size: inputSizeRef.current,
      fps: round1(summary.fps),
      p50_ms: round1(summary.p50),
      p95_ms: round1(summary.p95),
      mean_ms: round1(summary.mean),
      frames: summary.frames,
      duration_s: round1((endAt - startAt) / 1000),
      persons: summary.persons,
      faces: summary.faces,
      ua: navigator.userAgent,
      cores: navigator.hardwareConcurrency || 0,
    };
    const next = [run, ...runsRef.current].slice(0, STORAGE_LIMIT);
    runsRef.current = next;
    setRuns(next);
    if (!writeRuns(next)) {
      setStorageError('Rularea a fost măsurată, dar localStorage a refuzat salvarea (mod privat sau spațiu plin).');
    } else {
      setStorageError('');
    }
    setLive(summary);
    setLastRun(run);
    setPhase('done');
  }, []);

  const handleSample = useCallback((sample) => {
    const current = phaseRef.current;
    if (current !== 'starting' && current !== 'measuring') return;
    if (sample.error) {
      setRunError(`Motorul a raportat o eroare: ${sample.error}`);
      finishedRef.current = true;
      setPhase('done');
      return;
    }
    // Frames mirrored during model loading carry ms 0; the measured window starts at the
    // first frame a detector actually touched, so loading never eats the duration.
    if (!(sample.ms > 0)) return;
    if (!startAtRef.current) {
      startAtRef.current = sample.at;
      setPhase('measuring');
    }
    samplesRef.current.push({
      ms: sample.ms,
      at: sample.at,
      persons: sample.persons,
      faces: sample.faces,
    });
    if (sample.at - lastLiveAtRef.current >= 250) {
      lastLiveAtRef.current = sample.at;
      setLive(summarise(samplesRef.current, startAtRef.current, sample.at));
    }
    if (sample.at - startAtRef.current >= durationRef.current * 1000) {
      finishRun(sample.at);
    }
  }, [finishRun]);

  const engineOn = phase === 'starting' || phase === 'measuring';
  const engine = useEngine({
    videoRef,
    canvasRef,
    enabled: engineOn,
    provider,
    inputSize,
    onSample: handleSample,
  });

  // The hook reports the real provider after the sessions are created.
  actualProviderRef.current = engine.actualProviders[0] || '';

  // A stopwatch for the screen only; the numbers come from frame timestamps.
  useEffect(() => {
    if (phase !== 'measuring') return undefined;
    const interval = setInterval(() => {
      if (!startAtRef.current) return;
      setElapsed((performance.now() - startAtRef.current) / 1000);
    }, 200);
    return () => clearInterval(interval);
  }, [phase]);

  const startRun = () => {
    setRunError('');
    setStorageError('');
    setLastRun(null);
    setLive(null);
    setElapsed(0);
    samplesRef.current = [];
    startAtRef.current = 0;
    finishedRef.current = false;
    lastLiveAtRef.current = 0;
    setPhase('starting');
  };

  const stopRun = () => {
    if (phaseRef.current !== 'starting' && phaseRef.current !== 'measuring') return;
    finishedRef.current = true;
    setRunError('Rularea a fost oprită înainte de final și nu a fost salvată.');
    setPhase('done');
  };

  const onVideoError = () => {
    setVideoReady(false);
    if (fileUrl) {
      setVideoError('Clipul ales nu poate fi redat de acest browser (codec lipsă sau fișier stricat).');
      return;
    }
    const next = clipIndex + 1;
    if (next < CLIPS.length) {
      setClipIndex(next);
      setClipUrl(`${BASE}media/${CLIPS[next]}`);
      return;
    }
    setVideoError('Niciun clip demonstrativ nu a putut fi încărcat. Alege un fișier local pentru a rula măsurătoarea.');
  };

  const onPickClip = (event) => {
    const raw = event.target.value;
    if (raw === 'file') return;
    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
      setFileUrl('');
    }
    // "" is the escape hatch back to the bundled clips after a local file was picked.
    const index = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(index) || !CLIPS[index]) return;
    setClipIndex(index);
    setClipUrl(`${BASE}media/${CLIPS[index]}`);
    setVideoReady(false);
    setVideoError('');
  };

  const onPickFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    setClipUrl(url);
    setVideoReady(false);
    setVideoError('');
  };

  const exportRuns = () => {
    if (!runs.length) return;
    const blob = new Blob([JSON.stringify(runs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `localsight-bench-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const clearRuns = () => {
    if (!runs.length) return;
    if (!window.confirm('Ștergi toate rulările salvate în acest browser?')) return;
    setRuns([]);
    runsRef.current = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      setStorageError('localStorage nu a putut fi golit.');
    }
  };

  const sortedHistory = useMemo(
    () => [...runs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [runs],
  );

  const statusLabel = {
    idle: 'inactiv',
    loading: 'se încarcă modelele',
    running: 'rulează',
    error: 'eroare motor',
    unsupported: 'browser neacceptat',
  }[engine.status] || engine.status;

  const actualProvider = lastRun?.provider || engine.actualProviders[0] || '';
  const usedFallback = provider === 'webgpu' && actualProvider === 'wasm';

  const buttonStyle = (active, disabled) => ({
    backgroundColor: active ? '#FFEB33' : themeStyles.inputBg,
    color: active ? '#1F1F1F' : themeStyles.textColor,
    border: `1px solid ${active ? '#FFEB33' : themeStyles.panelBorder}`,
    fontWeight: active ? 600 : 400,
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const optionButton = (onClick, label, active, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className="px-3 py-2 rounded text-sm"
      style={buttonStyle(active, disabled)}
    >
      {label}
    </button>
  );

  const metric = (label, value) => (
    <div className="rounded px-3 py-2" style={{ backgroundColor: themeStyles.cardBg }}>
      <div className="text-[10px] uppercase tracking-wide opacity-50">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2" style={{ color: themeStyles.textColor }}>
            <Activity size={20} style={{ color: '#FFEB33' }} />
            Bench - motor în browser
          </h2>
          <p className="text-xs font-mono" style={{ color: themeStyles.textMuted }}>
            Aceleași detectoare ca /lab, aceeași mașină, cifre salvate local. Pagina nu e în meniu: deschide /bench.
          </p>
        </div>
        <div className="text-right text-[11px] font-mono" style={{ color: themeStyles.textMuted }}>
          <div className="flex items-center gap-1 justify-end">
            <Cpu size={12} />
            nuclee: {navigator.hardwareConcurrency || '—'}
          </div>
          <div className="max-w-[360px] break-all opacity-70" title={navigator.userAgent}>
            {navigator.userAgent}
          </div>
        </div>
      </div>

      <div
        className="rounded border p-4 space-y-4"
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      >
        <div className="flex flex-wrap items-end gap-5">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide opacity-50">Provider</div>
            <div className="flex gap-2">
              {PROVIDERS.map((item) => optionButton(
                () => setProvider(item.id),
                item.label,
                provider === item.id,
                engineOn || (item.id === 'webgpu' && webgpuUnavailable),
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide opacity-50">Input size (latura lungă)</div>
            <div className="flex gap-2">
              {SIZES.map((size) => optionButton(
                () => setInputSize(size),
                `${size}px`,
                inputSize === size,
                engineOn,
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide opacity-50">Durată</div>
            <select
              value={durationSec}
              onChange={(event) => setDurationSec(Number(event.target.value))}
              disabled={engineOn}
              aria-label="Durata rulării"
              className="px-3 py-2 rounded text-sm"
              style={{
                backgroundColor: themeStyles.inputBg,
                color: themeStyles.textColor,
                border: `1px solid ${themeStyles.panelBorder}`,
              }}
            >
              {durationOptions.map((seconds) => (
                <option key={seconds} value={seconds}>{seconds} s</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide opacity-50">Clip</div>
            <div className="flex gap-2">
              <select
                value={fileUrl ? 'file' : String(clipIndex)}
                onChange={onPickClip}
                disabled={engineOn}
                aria-label="Clip demonstrativ"
                className="px-3 py-2 rounded text-sm"
                style={{
                  backgroundColor: themeStyles.inputBg,
                  color: themeStyles.textColor,
                  border: `1px solid ${themeStyles.panelBorder}`,
                }}
              >
                {fileUrl && <option value="">← clipuri demo</option>}
                {!fileUrl && CLIPS.map((clip, index) => (
                  <option key={clip} value={String(index)}>{clip}</option>
                ))}
                {fileUrl && <option value="file">fișier local</option>}
              </select>
              <label
                className="px-3 py-2 rounded text-sm cursor-pointer flex items-center gap-2"
                style={{
                  backgroundColor: themeStyles.inputBg,
                  color: themeStyles.textColor,
                  border: `1px solid ${themeStyles.panelBorder}`,
                  opacity: engineOn ? 0.45 : 1,
                }}
              >
                <Upload size={14} />
                Alege
                <input type="file" accept="video/*" className="hidden" disabled={engineOn} onChange={onPickFile} />
              </label>
            </div>
          </div>

          <div className="flex gap-2 pb-0.5">
            {engineOn ? (
              <button
                type="button"
                onClick={stopRun}
                data-testid="bench-stop"
                className="px-4 py-2 rounded text-sm font-semibold flex items-center gap-2"
                style={{ backgroundColor: '#D73833', color: '#FFFFFF' }}
              >
                <Square size={14} />
                Oprește
              </button>
            ) : (
              <button
                type="button"
                onClick={startRun}
                disabled={Boolean(videoError)}
                data-testid="bench-start"
                className="px-4 py-2 rounded text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: '#FFEB33', color: '#1F1F1F' }}
              >
                <Play size={14} />
                Pornește
              </button>
            )}
          </div>
        </div>

        <p className="text-[11px] font-mono opacity-60" style={{ color: themeStyles.textMuted }}>
          Graful YOLO e fix 640×640; „input size” limitează cadrul dat detectoarelor (YuNet e dinamic
          și rulează la această rezoluție), fără upscaling. Un rulaj se măsoară doar după ce modelele
          s-au încărcat: timpul de încărcare nu intră în durată.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs" style={{ color: themeStyles.textColor }}>
        <span className="flex items-center gap-1">
          <Cpu size={13} />
          stare: <strong>{statusLabel}</strong>
        </span>
        <span>
          provider cerut: <strong>{provider}</strong>
        </span>
        <span data-testid="bench-provider">
          provider folosit: <strong style={{ color: usedFallback ? '#D73833' : '#33E1FF' }}>
            {actualProvider || (engineOn ? 'se decide...' : '—')}
          </strong>
          {usedFallback && ' (WebGPU a refuzat sesiunea, fallback wasm)'}
        </span>
        <span className="opacity-60" title={webgpu.detail}>
          WebGPU: {webgpu.status === 'checking' ? 'se verifică' : webgpuAvailable ? 'disponibil' : 'indisponibil'}
        </span>
        {phase === 'measuring' && <span>timp: <strong>{elapsed.toFixed(1)} s</strong></span>}
      </div>

      {webgpuUnavailable && (
        <div
          className="rounded border px-4 py-3 text-sm"
          style={{ borderColor: '#FFEB33', color: themeStyles.textColor, backgroundColor: themeStyles.cardBg }}
        >
          <div className="font-semibold flex items-center gap-2">
            <AlertTriangle size={14} />
            WebGPU nu este disponibil aici
          </div>
          <div className="opacity-70">
            {webgpu.detail}. Pagina rulează pe WASM; cifrele de mai jos sunt cele de CPU.
          </div>
          <div className="mt-2 pt-2 border-t border-current/10 opacity-80 space-y-1">
            <p className="font-semibold">Cum activezi WebGPU</p>
            <p>
              <strong>Firefox:</strong> motorul alege <strong>WASM intenționat</strong>. WebGPU
              în workeri blochează ONNX Runtime la crearea sesiunii (testat pe Firefox
              157/159 pe Linux) — pagina nu primește nici cadru, nici eroare. Nu activa
              <code> dom.webgpu.*</code> pentru demo; folosește Chrome/Edge pentru GPU.
            </p>
            <p>
              <strong>Chrome / Edge pe Linux:</strong> pornește browserul cu{' '}
              <code>--enable-unsafe-webgpu --enable-features=Vulkan</code>. Pe Windows și macOS
              merge din instalare.
            </p>
            <p>
              WebGPU folosește GPU-ul pentru inferență. Pe WASM rulează 4 fire când service
              worker-ul COOP/COEP e activ (GitHub Pages nu poate trimite antetele, dar worker-ul
              le adaugă); fără el, un singur fir.
            </p>
          </div>
        </div>
      )}

      {(videoError || runError || engine.status === 'error' || engine.status === 'unsupported') && (
        <div
          className="rounded border px-4 py-3 text-sm"
          style={{ borderColor: '#D73833', color: themeStyles.textColor, backgroundColor: themeStyles.cardBg }}
        >
          <div className="font-semibold flex items-center gap-2">
            <AlertTriangle size={14} />
            {videoError ? 'Fără sursă video' : engine.status === 'unsupported' ? 'Browser neacceptat' : 'Rularea nu poate continua'}
          </div>
          <div className="opacity-70">
            {videoError || runError || engine.message || (engine.status === 'unsupported'
              ? 'Acest browser nu are module workers sau OffscreenCanvas.'
              : 'Eroare necunoscută.')}
          </div>
        </div>
      )}

      {storageError && (
        <div className="text-xs" style={{ color: '#D73833' }}>{storageError}</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-sm" style={{ color: themeStyles.textColor }}>
        {metric('fps', live ? live.fps.toFixed(1) : '—')}
        {metric('mean ms', live ? live.mean.toFixed(1) : '—')}
        {metric('p50 ms', live ? live.p50.toFixed(1) : '—')}
        {metric('p95 ms', live ? live.p95.toFixed(1) : '—')}
        {metric('persoane', live ? live.persons : '—')}
        {metric('fețe', live ? live.faces : '—')}
        {metric('cadre', live ? live.frames : '—')}
      </div>

      <div className="relative rounded overflow-hidden" style={{ backgroundColor: '#000' }}>
        <canvas ref={canvasRef} className="block w-full h-auto max-h-[50vh] object-contain" data-testid="bench-canvas" />
        {!engineOn && !live && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm"
            style={{ color: themeStyles.textColor }}
          >
            <Video size={26} />
            <span>{videoError ? 'Nu există un clip de procesat.' : 'Pornește o rulare pentru a vedea cadrele procesate.'}</span>
          </div>
        )}
        {phase === 'starting' && (
          <div
            className="absolute inset-x-0 bottom-0 px-4 py-2 text-xs font-mono"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)', color: themeStyles.textColor }}
          >
            {engine.message || 'Se încarcă modelele... măsurătoarea începe la primul cadru detectat.'}
          </div>
        )}
      </div>

      <video
        ref={videoRef}
        src={clipUrl || undefined}
        className="hidden"
        loop
        muted
        playsInline
        autoPlay
        preload="auto"
        onLoadedMetadata={() => setVideoReady(true)}
        onError={onVideoError}
      />

      {!videoReady && !videoError && (
        <p className="text-xs opacity-50" style={{ color: themeStyles.textColor }}>
          Se încarcă clipul {fileUrl ? 'local' : CLIPS[clipIndex]}...
        </p>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: themeStyles.textColor }}>
              Rulări anterioare ({sortedHistory.length})
            </h3>
            <p className="text-[11px] font-mono opacity-50" style={{ color: themeStyles.textMuted }}>
              localStorage: {STORAGE_KEY} · cele mai noi primele
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportRuns}
              disabled={!runs.length}
              data-testid="bench-export"
              className="px-3 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-40"
              style={{ backgroundColor: themeStyles.cardBg, color: themeStyles.textColor, border: `1px solid ${themeStyles.panelBorder}` }}
            >
              <Download size={14} />
              Export JSON
            </button>
            <button
              type="button"
              onClick={clearRuns}
              disabled={!runs.length}
              data-testid="bench-clear"
              className="px-3 py-2 rounded text-sm flex items-center gap-2 disabled:opacity-40"
              style={{ backgroundColor: themeStyles.cardBg, color: themeStyles.textColor, border: `1px solid ${themeStyles.panelBorder}` }}
            >
              <Trash2 size={14} />
              Clear
            </button>
          </div>
        </div>

        <div
          className="rounded border overflow-x-auto"
          style={{ borderColor: themeStyles.panelBorder, backgroundColor: themeStyles.panelBg }}
          data-testid="bench-history"
        >
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-left opacity-60" style={{ color: themeStyles.textColor }}>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">fps</th>
                <th className="px-3 py-2">p50 ms</th>
                <th className="px-3 py-2">p95 ms</th>
                <th className="px-3 py-2">mean ms</th>
                <th className="px-3 py-2">cadre</th>
                <th className="px-3 py-2">mașină</th>
              </tr>
            </thead>
            <tbody style={{ color: themeStyles.textColor }}>
              {sortedHistory.map((run, index) => (
                <tr
                  key={`${run.date}-${run.size}-${index}`}
                  className="border-t"
                  style={{ borderColor: themeStyles.panelBorder }}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(run.date).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'medium' })}
                  </td>
                  <td className="px-3 py-2">
                    {run.provider}
                    {run.requested_provider && run.requested_provider !== run.provider && (
                      <span className="opacity-50"> (cerut {run.requested_provider})</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{run.size}px</td>
                  <td className="px-3 py-2 font-bold">{run.fps}</td>
                  <td className="px-3 py-2">{run.p50_ms}</td>
                  <td className="px-3 py-2">{run.p95_ms}</td>
                  <td className="px-3 py-2">{run.mean_ms}</td>
                  <td className="px-3 py-2">{run.frames}</td>
                  <td className="px-3 py-2 max-w-[280px] truncate opacity-60" title={run.ua}>
                    {run.cores} nuclee · {run.ua}
                  </td>
                </tr>
              ))}
              {!sortedHistory.length && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center opacity-50">
                    Nicio rulare salvată încă.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
