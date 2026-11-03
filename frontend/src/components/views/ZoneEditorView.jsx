import { useEffect, useMemo, useReducer, useState } from 'react';
import { PenTool } from 'lucide-react';
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
  const cameraZones = useMemo(
    () => zones.filter((item) => item.camera_id === selectedCameraId),
    [zones, selectedCameraId]
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
  }, [selectedCameraId, draft.zoneId, draft.isNew, cameraZones.length]);
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
  return {
    actions: {
      addPointOnFrame,
      applyShapeToDraft,
      chooseZone,
      commitJsonPoints,
      deletePointAt,
      dropReference,
      grabLiveFrame,
      persistDraft,
      removeDraftZone,
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
    setJsonOpen,
    setJsonText,
    showToast,
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
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <DrawingColumn editor={editor} referenceUrl={referenceUrl}></DrawingColumn>
          <ParametersColumn editor={editor} referenceUrl={referenceUrl} usingDemoReference={usingDemoReference}></ParametersColumn>
        </section>
      </section>
    </main>;
};