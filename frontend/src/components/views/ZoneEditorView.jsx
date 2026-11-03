import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Download, LayoutTemplate, PenTool, Save, Trash2, Upload } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { DEMO_REFERENCE_FRAMES } from '../../constants/mockData';
import {
  buildZonePayload,
  cameraOptions,
  canDeletePoint,
  draftReducer,
  emptyDraft,
  formatPoints,
  parsePointList,
  preferredZone,
  shortcutFor,
  uniqueZoneId,
  validateDraft,
} from '../../utils/zoneDraft.js';
import {
  MAX_TEMPLATE_CHARS,
  MAX_TEMPLATE_NAME_CHARS,
  assignZoneIds,
  deleteTemplate,
  exportZones,
  parseZoneTemplate,
  readTemplates,
  saveTemplate,
  templateForCamera,
  templateStorage,
  toZonePayload,
  zoneExportFileName,
} from '../../utils/zoneTemplates.js';
import ZoneCanvas from '../zones/ZoneCanvas';
import ZoneToolbar from '../zones/ZoneToolbar';
import ZoneParameters from '../zones/ZoneParameters';
import ZoneReferencePanel from '../zones/ZoneReferencePanel';
const NO_ZONE_MESSAGE = 'Alege o zonă salvată sau apasă „Zonă nouă”.';
const MIN_POINTS_MESSAGE = 'O zonă are nevoie de cel puțin 3 puncte.';
const REORDER_NOTICE = 'Punctele au fost reordonate în jurul centrului zonei.';
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const HINT_EMPTY =
  'Click pe cadru ca să pui punctele zonei, în ordine · trage un punct ca să-l muți · Ctrl+Z anulează';
const HINT_DRAWING =
  'Click pe primul punct (verde) închide zona · trage punctele · „+” de pe latură adaugă un punct · Ctrl+Z anulează';
const HINT_CLOSED =
  'Zonă închisă · trage punctele ca să le muți · „+” de pe latură adaugă un punct · click dreapta / Delete șterge · Ctrl+Z anulează';
const TEMPLATE_SCOPE_CAMERA = 'camera';
const TEMPLATE_SCOPE_GLOBAL = 'global';
const TEMPLATE_SCOPE_LABEL = {
  [TEMPLATE_SCOPE_CAMERA]: 'camera curentă',
  [TEMPLATE_SCOPE_GLOBAL]: 'toate camerele',
};
const TEMPLATE_STATUS_IDLE =
  'Exportă zonele camerei, importă un fișier JSON sau salvează-le ca șablon ca să le refolosești pe altă cameră.';

/** Trigger a browser download for a JSON string. The object URL is released next tick. */
function downloadJson(fileName, json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The first few validation messages, so the status line stays one line on a phone. */
function summarizeErrors(errors = [], limit = 3) {
  const messages = (Array.isArray(errors) ? errors : [])
    .map((error) => error?.message)
    .filter((message) => typeof message === 'string' && message);
  if (messages.length === 0) return 'motiv necunoscut';
  const head = messages.slice(0, limit).join(' ');
  return messages.length > limit ? `${head} (+${messages.length - limit})` : head;
}

/**
 * The instructions for the drawing surface. They live on the help line above the frame, as
 * the state changes, instead of on a pill that covered the polygon (M13).
 */
function editorHint(points, closed) {
  if (closed) return HINT_CLOSED;
  return points >= 3 ? HINT_DRAWING : HINT_EMPTY;
}
/** Page title plus the camera picker: which camera's zones the editor is showing. */
function EditorHeader({ cameraChoices, selectedCameraId, onCameraChange, hint }) {
  const { themeStyles } = useTheme();
  return (
    <header
      className="flex flex-wrap items-start justify-between gap-3 border-b pb-3"
      style={{ borderColor: themeStyles.panelBorder }}
    >
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight">
          <PenTool size={20} className="shrink-0 text-[#D73833] dark:text-[#FFEB33]" aria-hidden="true" />
          Configurare zone
        </h2>
        <p className="mt-1 text-xs font-mono" style={{ color: themeStyles.textMuted }}>
          {hint}
        </p>
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 text-xs sm:w-auto">
        <label htmlFor="zone-camera" className="font-bold opacity-75">
          Camera:
        </label>
        <select
          id="zone-camera"
          data-testid="zone-camera"
          value={selectedCameraId}
          onChange={onCameraChange}
          style={{
            backgroundColor: themeStyles.cardBg,
            borderColor: themeStyles.panelBorder,
            color: themeStyles.text,
          }}
          className="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#FFEB33] sm:min-w-[15rem] sm:flex-none"
        >
          {cameraChoices.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
/** Nothing to edit: the camera list came back empty. */
function NoCamerasNotice() {
  const { themeStyles } = useTheme();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
        className="max-w-md space-y-2 rounded-xl border p-5 text-center"
      >
        <h2 className="text-sm font-bold uppercase">Nu există camere</h2>
        <p className="text-xs" style={{ color: themeStyles.textMuted }}>
          Build-ul static nu are camere încărcate. Reîncarcă pagina; camerele demo vin din fixture-uri.
        </p>
      </div>
    </div>
  );
}
/** The drawing surface and its toolbar: the polygon itself, left column on wide screens. */
function DrawingColumn({ editor, referenceUrl }) {
  const { cameraZones, draft, check, jsonOpen, jsonText, setJsonText, setJsonOpen, dispatch, actions } = editor;
  return (
    <section className="min-w-0 space-y-3 xl:col-span-2">
      <ZoneToolbar
        zones={cameraZones}
        zoneId={draft.zoneId}
        onSelectZone={actions.chooseZone}
        onNewZone={actions.startNewZone}
        onApplyShape={actions.applyShapeToDraft}
        canUndo={draft.past.length > 0}
        canRedo={draft.future.length > 0}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        jsonOpen={jsonOpen}
        onToggleJson={() => setJsonOpen((open) => !open)}
        jsonText={jsonText}
        onJsonTextChange={setJsonText}
        onApplyJson={actions.commitJsonPoints}
      />
      <ZoneCanvas
        points={draft.points}
        closed={draft.closed}
        selectedIndex={draft.selectedIndex}
        crossing={check.crossing}
        hasCrossing={check.hasCrossing}
        referenceUrl={referenceUrl}
        onAddPoint={actions.addPointOnFrame}
        onClose={() => dispatch({ type: 'close' })}
        onSelect={(index) => dispatch({ type: 'select', index })}
        onBeginGesture={() => dispatch({ type: 'begin-gesture' })}
        onEndGesture={() => dispatch({ type: 'end-gesture' })}
        onMovePoint={(index, point) => dispatch({ type: 'move-point', index, point })}
        onInsertPoint={(index, point) => dispatch({ type: 'insert-point', index, point })}
        onDeletePoint={actions.deletePointAt}
        onReorder={actions.sortPointsAroundCentre}
        onRedraw={() => dispatch({ type: 'redraw' })}
      />
    </section>
  );
}
/** The parameters form and the reference-frame panel, stacked in the right column. */
function ParametersColumn({ editor, referenceUrl, usingDemoReference }) {
  const { draft, zone, saving, canSave, uploading, capturing, capturedAt, dispatch, actions } = editor;
  return (
    <aside className="min-w-0 space-y-3" aria-label="Parametrii și cadrul zonei">
      <ZoneParameters
        zoneId={draft.zoneId}
        idLocked={Boolean(zone) && !draft.isNew}
        fields={draft.fields}
        zoneExists={Boolean(zone)}
        saving={saving}
        canSave={canSave}
        pointCount={draft.points.length}
        onIdChange={(value) => dispatch({ type: 'set-id', zoneId: value })}
        onFieldChange={(field, value) => dispatch({ type: 'set-field', field, value })}
        onSave={actions.persistDraft}
        onDelete={actions.removeDraftZone}
      />
      <ZoneReferencePanel
        referenceUrl={referenceUrl}
        usingDemoReference={usingDemoReference}
        hasZone={Boolean(zone)}
        uploading={uploading}
        capturing={capturing}
        capturedAt={capturedAt}
        onUpload={actions.uploadFrame}
        onCaptureFromLive={actions.grabLiveFrame}
        onClear={actions.dropReference}
        onError={editor.showToast}
      />
    </aside>
  );
}
/**
 * Export, import and named templates for the selected camera.
 *
 * Everything here writes only through the store (`saveZone` / `deleteZone`), so the
 * optimistic update and its rollback stay in one place. Replacing a camera's zones is
 * always confirmed first and never merges silently: zones the template does not carry
 * are deleted. A camera-scoped template is only offered on its own camera; reusing it
 * elsewhere is what the export/import pair or a "Global" template is for. Zone ids are
 * global in the store, so an id owned by another camera is re-issued here rather than
 * moved (`assignZoneIds`).
 */
function ZoneTemplatesPanel({ editor }) {
  const { themeStyles } = useTheme();
  const fileRef = useRef(null);
  const {
    actions,
    cameraZones,
    selectedCameraId,
    selectedTemplate,
    selectedTemplateId,
    setSelectedTemplateId,
    setTemplateName,
    setTemplateScope,
    setTemplateStatus,
    templateBusy,
    templateName,
    templateScope,
    templateStatus,
    templates,
    templatesForCamera,
  } = editor;

  const fieldClass =
    'min-w-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#FFEB33]';
  const buttonClass =
    'px-2.5 py-1.5 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#FFEB33]';
  const fieldStyle = {
    backgroundColor: themeStyles.cardBg,
    borderColor: themeStyles.panelBorder,
    color: themeStyles.text,
  };
  const idleStatus =
    templatesForCamera.length > 0
      ? `${templatesForCamera.length} șabloane disponibile pentru ${selectedCameraId}.`
      : templates.length > 0
        ? 'Niciun șablon pentru camera asta. Salvează unul cu domeniul „Global” ca să-l aplici pe orice cameră.'
        : TEMPLATE_STATUS_IDLE;

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_TEMPLATE_CHARS) {
      setTemplateStatus(`Import respins: fișierul depășește ${Math.round(MAX_TEMPLATE_CHARS / 1024)} KB.`);
      return;
    }
    let text = '';
    try {
      text = await file.text();
    } catch (error) {
      setTemplateStatus(`Import respins: fișierul nu poate fi citit (${error.message}).`);
      return;
    }
    await actions.importZonesFromText(text);
  }

  return (
    <section
      data-testid="zone-template-panel"
      aria-labelledby="zone-template-heading"
      aria-describedby="zone-template-status"
      className="space-y-2 rounded-xl border p-3 text-xs shadow-sm"
      style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3
          id="zone-template-heading"
          className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider"
        >
          <LayoutTemplate size={15} className="shrink-0 text-[#D73833] dark:text-[#FFEB33]" aria-hidden="true" />
          Șabloane zone
        </h3>
        <p className="text-[11px] leading-snug" style={{ color: themeStyles.textMuted }}>
          Desenează o dată, aplică pe orice cameră.
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="zone-export"
            onClick={actions.exportCameraZones}
            disabled={cameraZones.length === 0 || templateBusy}
            title={
              cameraZones.length === 0
                ? 'Camera asta nu are zone de exportat'
                : `Descarcă ${cameraZones.length} zone din ${selectedCameraId} ca JSON`
            }
            className={`${buttonClass} border-slate-300 bg-white text-[#1F1F1F] hover:bg-slate-100 dark:border-white/20 dark:bg-black/20 dark:text-slate-200 dark:hover:bg-white/10`}
          >
            <Download size={13} aria-hidden="true" /> Export JSON
          </button>
          <button
            type="button"
            data-testid="zone-import"
            onClick={() => fileRef.current?.click()}
            disabled={templateBusy}
            title="Încarcă un fișier JSON exportat din altă cameră"
            className={`${buttonClass} border-slate-300 bg-white text-[#1F1F1F] hover:bg-slate-100 dark:border-white/20 dark:bg-black/20 dark:text-slate-200 dark:hover:bg-white/10`}
          >
            <Upload size={13} aria-hidden="true" /> Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            data-testid="zone-import-file"
            aria-label="Fișier JSON cu zone"
            onChange={handleFile}
            className="sr-only"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 sm:flex-none">
          <label
            htmlFor="zone-template-name"
            className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide opacity-70"
          >
            Nume șablon
          </label>
          <input
            id="zone-template-name"
            data-testid="zone-template-name"
            type="text"
            value={templateName}
            maxLength={MAX_TEMPLATE_NAME_CHARS}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="ex. Stand 12 — iarnă"
            className={`w-full sm:w-56 ${fieldClass}`}
            style={fieldStyle}
          />
        </div>
        <div className="min-w-0">
          <label
            htmlFor="zone-template-scope"
            className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide opacity-70"
          >
            Se aplică pe
          </label>
          <select
            id="zone-template-scope"
            data-testid="zone-template-scope"
            value={templateScope}
            onChange={(event) => setTemplateScope(event.target.value)}
            className={`${fieldClass} w-full sm:w-auto`}
            style={fieldStyle}
          >
            <option value={TEMPLATE_SCOPE_CAMERA}>Camera curentă ({selectedCameraId})</option>
            <option value={TEMPLATE_SCOPE_GLOBAL}>Global (toate camerele)</option>
          </select>
        </div>
        <button
          type="button"
          data-testid="zone-template-save"
          onClick={actions.saveCurrentTemplate}
          disabled={templateBusy || templateName.trim() === '' || cameraZones.length === 0}
          title={
            cameraZones.length === 0
              ? 'Camera asta nu are zone de salvat'
              : 'Salvează zonele camerei curente ca șablon'
          }
          className={`${buttonClass} bg-[#7EDEED] text-[#1F1F1F] hover:bg-[#68c8d8]`}
        >
          <Save size={13} aria-hidden="true" /> Salvează șablon
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="zone-template-select"
            className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide opacity-70"
          >
            Șablon salvat ({templatesForCamera.length})
          </label>
          <select
            id="zone-template-select"
            data-testid="zone-template-select"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            className={`${fieldClass} w-full`}
            style={fieldStyle}
          >
            <option value="">— alege un șablon —</option>
            {templatesForCamera.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} · {template.camera_id || 'global'} · {template.zones.length} zone
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          data-testid="zone-template-apply"
          onClick={actions.applySelectedTemplate}
          disabled={!selectedTemplate || templateBusy}
          title="Înlocuiește zonele camerei curente cu șablonul ales"
          className={`${buttonClass} bg-[#D73833] text-white hover:bg-[#b82e2a]`}
        >
          Aplică
        </button>
        <button
          type="button"
          data-testid="zone-template-delete"
          onClick={actions.removeSelectedTemplate}
          disabled={!selectedTemplate || templateBusy}
          title="Șterge șablonul; zonele camerelor rămân neschimbate"
          className={`${buttonClass} border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-300`}
        >
          <Trash2 size={13} aria-hidden="true" /> Șterge
        </button>
      </div>

      <p
        id="zone-template-status"
        data-testid="zone-template-status"
        role="status"
        aria-live="polite"
        className="text-[11px] font-mono leading-snug"
        style={{ color: themeStyles.textMuted }}
      >
        {templateStatus || idleStatus}
      </p>
    </section>
  );
}

/**
 * Zone configuration editor.
 *
 * The polygon and the parameters are one draft document (`utils/zoneDraft.js`). This hook
 * owns everything stateful about that document — the store wiring, the guards, the keyboard
 * and the reference frame — so the component below is only layout and cannot silently drop
 * a guard while it is being re-arranged.
 */
const useZoneEditor = () => {
  const security = useSecurity();
  const { cameras, activeCamera, zones, selectedCameraId, setSelectedCameraId,
    saveZone, deleteZone, clearReferenceFrame,
    captureReferenceFrame, captureReferenceFromLive, showToast,
  } = security;
  const [draft, dispatch] = useReducer(draftReducer, undefined, emptyDraft);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState('[]');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capturedAt, setCapturedAt] = useState(null);
  // Named templates live in localStorage and survive a reload. Reading is capped and
  // validated by the utility, so a planted blob means "no templates".
  const [templates, setTemplates] = useState(() => readTemplates());
  const [templateName, setTemplateName] = useState('');
  const [templateScope, setTemplateScope] = useState(TEMPLATE_SCOPE_CAMERA);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateStatus, setTemplateStatus] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  // Bumped after a template/import replaces the camera's zones. The draft reloads from the
  // store on this counter, so an import that keeps the same zone id still shows the new
  // name and rule instead of the pre-import draft.
  const [zoneReload, setZoneReload] = useState(0);
  const cameraZones = useMemo(
    () => zones.filter((item) => item.camera_id === selectedCameraId),
    [zones, selectedCameraId]
  );
  const templatesForCamera = useMemo(
    () => templateForCamera(templates, selectedCameraId),
    [templates, selectedCameraId]
  );
  const selectedTemplate = useMemo(
    () => templatesForCamera.find((template) => template.id === selectedTemplateId) || null,
    [templatesForCamera, selectedTemplateId]
  );
  const zone = useMemo(
    () => cameraZones.find((item) => item.zone_id === draft.zoneId) || null,
    [cameraZones, draft.zoneId]
  );
  const check = useMemo(() => validateDraft(draft), [draft]);
  const cameraChoices = useMemo(() => cameraOptions(cameras, zones), [cameras, zones]);
  const canSave = check.canSave && !saving;
  // The JSON textarea mirrors the geometry; typing does not touch the draft until
  // "Aplică pe cadru", so a half-typed line cannot corrupt the polygon.
  useEffect(() => {
    setJsonText(formatPoints(draft.points));
  }, [draft.points]);
  // Reload only when the selection changes, never on every store update: a save or a
  // live event must not throw away the edit in progress. A zone that is not saved yet
  // has nothing to reload and stays as it is.
  useEffect(() => {
    if (draft.isNew) return;
    const current = cameraZones.find((item) => item.zone_id === draft.zoneId);
    if (current) {
      dispatch({ type: 'load', zone: current });
      return;
    }
    const fallback = preferredZone(cameraZones);
    if (fallback) {
      dispatch({ type: 'select-zone', zoneId: fallback.zone_id });
      return;
    }
    dispatch({ type: 'reset' });
  }, [selectedCameraId, draft.zoneId, draft.isNew, cameraZones.length, zoneReload]);
  // Keyboard: Ctrl+Z / Ctrl+Shift+Z, Delete removes the selected point, arrows nudge it
  // (Shift = 5x) and Esc deselects. Text fields keep their own keys.
  useEffect(() => {
    function onKeyDown(event) {
      if (TEXT_ENTRY_TAGS.has(event.target?.tagName) || event.target?.isContentEditable) return;
      const intent = shortcutFor(event, draft.selectedIndex);
      if (!intent) return;
      if (intent.preventDefault) event.preventDefault();
      const blocked =
        intent.type === 'delete-selection' && !canDeletePoint(draft, draft.selectedIndex);
      if (blocked) return showToast(MIN_POINTS_MESSAGE);
      dispatch(intent);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft, showToast]);
  function switchCamera(event) {
    dispatch({ type: 'camera-changed' });
    setSelectedCameraId(event.target.value);
    // A template may belong to the previous camera; do not keep it selected silently.
    setSelectedTemplateId('');
  }
  function chooseZone(zoneId) {
    dispatch({ type: 'select-zone', zoneId });
  }
  function startNewZone() {
    const id = uniqueZoneId(`${selectedCameraId}-zona`, zones);
    dispatch({ type: 'create', zoneId: id });
    showToast('Zonă nouă: desenează poligonul, apoi salvează.');
  }
  function addPointOnFrame(point) {
    if (draft.zoneId) {
      dispatch({ type: 'add-point', point });
      return;
    }
    showToast(NO_ZONE_MESSAGE);
  }
  function applyShapeToDraft(shape) {
    if (draft.zoneId) {
      dispatch({ type: 'apply-shape', shape });
      return;
    }
    showToast(NO_ZONE_MESSAGE);
  }
  function deletePointAt(index) {
    if (!canDeletePoint(draft, index)) {
      showToast(MIN_POINTS_MESSAGE);
      return;
    }
    dispatch({ type: 'delete-point', index });
  }
  function sortPointsAroundCentre() {
    dispatch({ type: 'reorder' });
    showToast(REORDER_NOTICE);
  }
  function commitJsonPoints() {
    const { points, error } = parsePointList(jsonText);
    if (error) {
      showToast(error);
      return;
    }
    dispatch({ type: 'apply-points', points });
    showToast('Coordonate aplicate pe cadru.');
  }
  async function persistDraft() {
    const [failure] = check.errors;
    if (failure) {
      showToast(failure.message);
      return;
    }
    setSaving(true);
    try {
      await saveZone(draft.zoneId, buildZonePayload(draft, { cameraId: selectedCameraId, zone }));
      dispatch({ type: 'saved' });
    } finally {
      setSaving(false);
    }
  }
  async function removeDraftZone() {
    if (!draft.zoneId || !zone) return;
    const confirmed = window.confirm(
      `Ștergi zona „${draft.zoneId}”? Acțiunea nu poate fi anulată.`
    );
    if (!confirmed) return;
    const remaining = cameraZones.filter((item) => item.zone_id !== draft.zoneId);
    await deleteZone(draft.zoneId);
    dispatch({ type: 'delete-result', remainingZones: remaining });
  }
  async function uploadFrame(file) {
    if (!draft.zoneId) return;
    setUploading(true);
    try {
      await captureReferenceFrame(draft.zoneId, file);
      setCapturedAt(new Date().toLocaleTimeString('ro-RO'));
    } finally {
      setUploading(false);
    }
  }
  async function grabLiveFrame() {
    if (!draft.zoneId) return;
    setCapturing(true);
    try {
      await captureReferenceFromLive(draft.zoneId);
      setCapturedAt(new Date().toLocaleTimeString('ro-RO'));
    } finally {
      setCapturing(false);
    }
  }
  const dropReference = () => {
    if (!draft.zoneId) return;
    clearReferenceFrame(draft.zoneId);
    setCapturedAt(null);
  };
  function exportCameraZones() {
    if (cameraZones.length === 0) {
      setTemplateStatus('Camera asta nu are zone de exportat.');
      return;
    }
    const payload = exportZones(cameraZones, { cameraId: selectedCameraId });
    const json = JSON.stringify(payload, null, 2);
    downloadJson(zoneExportFileName(selectedCameraId), json);
    const size = Math.round((json.length / 1024) * 10) / 10;
    setTemplateStatus(`Export: ${payload.zones.length} zone din ${selectedCameraId} (${size} KB).`);
  }
  /**
   * Replace this camera's zones with `incoming`: upsert every imported zone, then delete
   * the ones the template does not carry. The caller has already confirmed.
   */
  async function replaceCameraZones(incoming, successMessage) {
    setTemplateBusy(true);
    try {
      const foreignIds = zones
        .filter((item) => item.camera_id !== selectedCameraId)
        .map((item) => item.zone_id);
      const prepared = assignZoneIds(incoming, foreignIds);
      for (const item of prepared) {
        await saveZone(item.zone_id, toZonePayload(item, selectedCameraId));
      }
      const keep = new Set(prepared.map((item) => item.zone_id));
      for (const existing of cameraZones) {
        if (!keep.has(existing.zone_id)) await deleteZone(existing.zone_id);
      }
      setZoneReload((value) => value + 1);
      dispatch(prepared.length > 0 ? { type: 'select-zone', zoneId: prepared[0].zone_id } : { type: 'reset' });
      setTemplateStatus(successMessage);
    } catch (error) {
      setTemplateStatus(`Aplicarea a eșuat: ${error.message}`);
    } finally {
      setTemplateBusy(false);
    }
  }
  async function importZonesFromText(text) {
    const result = parseZoneTemplate(text);
    if (!result.ok) {
      setTemplateStatus(`Import respins: ${summarizeErrors(result.errors)}.`);
      return;
    }
    const source = result.cameraId ? ` (export din ${result.cameraId})` : '';
    const confirmed = window.confirm(
      `Importi ${result.zones.length} zone${source} în camera „${selectedCameraId}”? ` +
        `Zonele actuale ale camerei (${cameraZones.length}) vor fi înlocuite.`
    );
    if (!confirmed) {
      setTemplateStatus('Import anulat: zonele camerei nu s-au schimbat.');
      return;
    }
    await replaceCameraZones(
      result.zones,
      `Import reușit: ${result.zones.length} zone aplicate pe ${selectedCameraId}.`
    );
  }
  function saveCurrentTemplate() {
    const result = saveTemplate(templateStorage(), {
      name: templateName,
      cameraId: templateScope === TEMPLATE_SCOPE_CAMERA ? selectedCameraId : null,
      zones: cameraZones,
    });
    if (!result.ok) {
      setTemplateStatus(result.errors[0]?.message || 'Șablonul nu a putut fi salvat.');
      return;
    }
    setTemplates(result.templates);
    setSelectedTemplateId(result.template.id);
    setTemplateName('');
    setTemplateStatus(
      `Șablonul „${result.template.name}” salvat: ${result.template.zones.length} zone, ${TEMPLATE_SCOPE_LABEL[templateScope]}.`
    );
  }
  async function applySelectedTemplate() {
    if (!selectedTemplate) {
      setTemplateStatus('Alege un șablon din listă.');
      return;
    }
    const confirmed = window.confirm(
      `Aplici șablonul „${selectedTemplate.name}” pe camera „${selectedCameraId}”? ` +
        `Zonele actuale ale camerei (${cameraZones.length}) vor fi înlocuite.`
    );
    if (!confirmed) {
      setTemplateStatus('Aplicare anulată: zonele camerei nu s-au schimbat.');
      return;
    }
    await replaceCameraZones(
      selectedTemplate.zones,
      `Șablonul „${selectedTemplate.name}” aplicat: ${selectedTemplate.zones.length} zone pe ${selectedCameraId}.`
    );
  }
  function removeSelectedTemplate() {
    if (!selectedTemplate) {
      setTemplateStatus('Alege un șablon din listă.');
      return;
    }
    const confirmed = window.confirm(
      `Ștergi șablonul „${selectedTemplate.name}”? Zonele camerelor nu sunt afectate.`
    );
    if (!confirmed) {
      setTemplateStatus('Ștergere anulată.');
      return;
    }
    const result = deleteTemplate(templateStorage(), selectedTemplate.id);
    if (!result.ok) {
      setTemplateStatus(result.errors[0]?.message || 'Ștergerea a eșuat.');
      return;
    }
    setTemplates(result.templates);
    setSelectedTemplateId('');
    setTemplateStatus(`Șablonul „${selectedTemplate.name}” a fost șters.`);
  }
  return {
    actions: {
      addPointOnFrame,
      applySelectedTemplate,
      applyShapeToDraft,
      chooseZone,
      commitJsonPoints,
      deletePointAt,
      dropReference,
      exportCameraZones,
      grabLiveFrame,
      importZonesFromText,
      persistDraft,
      removeDraftZone,
      removeSelectedTemplate,
      saveCurrentTemplate,
      sortPointsAroundCentre,
      startNewZone,
      switchCamera,
      uploadFrame,
    },
    activeCamera,
    cameraChoices,
    cameraZones,
    canSave,
    capturedAt,
    capturing,
    check,
    dispatch,
    draft,
    jsonOpen,
    jsonText,
    saving,
    selectedCameraId,
    selectedTemplate,
    selectedTemplateId,
    setJsonOpen,
    setJsonText,
    setSelectedTemplateId,
    setTemplateName,
    setTemplateScope,
    setTemplateStatus,
    showToast,
    templateBusy,
    templateName,
    templateScope,
    templateStatus,
    templates,
    templatesForCamera,
    uploading,
    zone,
  };
}
export default function ZoneEditorView() {
  const editor = useZoneEditor();
  if (!editor.activeCamera) return <NoCamerasNotice />;
  // The static build has no edge to upload a reference frame, so the first frame of the
  // camera's demo clip is the background. An uploaded frame still wins.
  const demoReferenceUrl = DEMO_REFERENCE_FRAMES[editor.selectedCameraId] || null;
  const referenceUrl = editor.zone?.reference_frame_url || demoReferenceUrl || null;
  const usingDemoReference = !editor.zone?.reference_frame_url && Boolean(demoReferenceUrl);
  return <main className="flex-1 h-full overflow-y-auto">
      <section className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
        <EditorHeader
          cameraChoices={editor.cameraChoices}
          selectedCameraId={editor.selectedCameraId}
          onCameraChange={editor.actions.switchCamera}
          hint={editorHint(editor.draft.points.length, editor.draft.closed)}
        />
        <ZoneTemplatesPanel editor={editor} />
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <DrawingColumn editor={editor} referenceUrl={referenceUrl}></DrawingColumn>
          <ParametersColumn editor={editor} referenceUrl={referenceUrl} usingDemoReference={usingDemoReference}></ParametersColumn>
        </section>
      </section>
    </main>;
};