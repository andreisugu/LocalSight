import { Columns, Cpu, LayoutDashboard, Maximize2, Power } from 'lucide-react';
import { cameraOptionLabel } from './liveMedia';

const FULLSCREEN_OPEN = 'Deschide în modul Full-Screen Imersiv';
const FULLSCREEN_BLOCKED =
  'Ecran complet este dezactivat cât timp detecția din browser este pornită: '
  + 'modul imersiv ar afișa clipul brut, fără blur. Oprește motorul în browser pentru '
  + 'ecran complet.';

function DisplayModeButton({ active, title, icon: Icon, label, onClick, isDarkMode }) {
  const tone = active
    ? isDarkMode
      ? 'bg-[#D73833] text-white font-bold shadow-sm'
      : 'bg-[#7EDEED] text-[#1F1F1F] font-bold shadow-sm'
    : isDarkMode
      ? 'text-slate-400 hover:text-white'
      : 'text-slate-600 hover:text-slate-900';

  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors ${tone}`}
      title={title}
    >
      <Icon size={12} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// Camera selection, layout mode and the two independent engine switches. The aircraft
// engine (`MOTOR`) is a property of the stand; the browser engine is a local choice made
// by this viewer, and stopping it is the primary action while it runs.
export default function CameraToolbar({
  cameras,
  activeCamera,
  demoCameraIds,
  isDarkMode,
  themeStyles,
  displayMode,
  onSelectCamera,
  onSelectMode,
  onToggleEngine,
  browserEngineOn,
  engineSource,
  onToggleBrowserEngine,
  isWebcam,
  onOpenFullscreen,
}) {
  return (
    <div
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
      className="p-2 rounded-xl border shadow-sm flex items-center justify-between gap-2 shrink-0 flex-wrap"
    >
      <label className="flex items-center gap-2 min-w-0">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            activeCamera?.status === 'offline' ? 'bg-[#D73833]' : 'bg-emerald-500'
          }`}
        />
        <span
          id="live-camera-label"
          style={{ color: themeStyles.textMuted }}
          className="text-[11px] font-semibold shrink-0"
        >
          Cameră
        </span>
        <select
          id="live-camera-select"
          value={activeCamera?.id || ''}
          onChange={(event) => onSelectCamera(event.target.value)}
          style={{
            backgroundColor: themeStyles.panelBg,
            borderColor: themeStyles.panelBorder,
            color: isDarkMode ? '#F5F5F5' : '#1F1F1F',
          }}
          className="min-w-0 max-w-[16rem] px-2 py-1.5 rounded-lg text-xs font-semibold border focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
          aria-labelledby="live-camera-label"
        >
          {(cameras || []).map((camera) => (
            <option key={camera.id} value={camera.id}>
              {cameraOptionLabel(camera, demoCameraIds)}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1.5">
        <div className="flex items-center bg-slate-500/10 rounded-lg p-0.5 border border-slate-500/20">
          <DisplayModeButton
            active={displayMode === 'standard'}
            isDarkMode={isDarkMode}
            onClick={() => onSelectMode('standard')}
            icon={LayoutDashboard}
            label="Standard"
            title="Mod Standard: Feed Video 16:9 + Incidente laterale"
          />
          <DisplayModeButton
            active={displayMode === 'split'}
            isDarkMode={isDarkMode}
            onClick={() => onSelectMode('split')}
            icon={Columns}
            label="Split"
            title="Mod Split: Feed Video Extins 16:9 sus, Grilă incidente dedesubt"
          />
        </div>

        <button
          onClick={() => onToggleEngine(activeCamera?.id)}
          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 shadow transition-all ${
            activeCamera?.engine_on
              ? 'bg-[#FFEB33] text-[#1F1F1F] font-bold animate-pulse font-black'
              : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
          }`}
          title="Comută starea motorului aeronavei pentru acest stand"
        >
          <Power size={13} />
          <span>MOTOR: {activeCamera?.engine_on ? 'ON' : 'OFF'}</span>
        </button>

        {/* The browser engine remembers its choice locally. While it runs, stopping it is
            the primary action in the overlay, not a tiny toolbar switch. */}
        {engineSource && browserEngineOn && (
          <button
            type="button"
            onClick={onToggleBrowserEngine}
            aria-pressed={browserEngineOn}
            className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 shadow transition-all bg-[#33E1FF] text-[#1F1F1F] hover:bg-[#7EEBFF]"
            title="Oprește detecția în browser și revino la fluxul brut"
          >
            <Cpu size={13} />
            <span>Oprește motorul în browser</span>
          </button>
        )}

        {/* The local camera has no fullscreen button: the immersive mode renders another
            React tree, where <video> would lose srcObject. With the browser engine on the
            button is disabled because that tree shows the raw clip without blur. */}
        {!isWebcam && (
          <span className="inline-flex" title={browserEngineOn ? FULLSCREEN_BLOCKED : FULLSCREEN_OPEN}>
            <button
              type="button"
              onClick={onOpenFullscreen}
              disabled={browserEngineOn}
              aria-label="Ecran complet"
              className="p-1.5 rounded-lg bg-slate-500/10 hover:bg-slate-500/20 text-slate-300 border border-slate-500/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-500/10"
              title={browserEngineOn ? FULLSCREEN_BLOCKED : FULLSCREEN_OPEN}
            >
              <Maximize2 size={14} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
