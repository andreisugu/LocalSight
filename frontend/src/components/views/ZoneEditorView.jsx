import React, { useEffect, useMemo, useReducer, useState } from 'react';
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

/**
 * Zone configuration screen. The polygon and the parameters live in one draft state
 * machine (`utils/zoneDraft.js`); this file wires that machine to the store, the
 * keyboard and the four panels, and owns nothing that could be tested without a DOM.
 */
export default function ZoneEditorView() {
  const { themeStyles } = useTheme();
  const {
    cameras,
    selectedCameraId,
    setSelectedCameraId,
    activeCamera,
    zones,
    saveZone,
    deleteZone,
    captureReferenceFrame,
    captureReferenceFromLive,
    clearReferenceFrame,
    showToast,
  } = useSecurity();

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

  // The textarea mirrors the geometry; typing in it does not change the draft until
  // "Aplică pe cadru", so a half-typed line cannot corrupt the points.
  useEffect(() => {
    setJsonText(formatPoints(draft.points));
  }, [draft.points]);

  // Reload only when the selection changes, never on every store update: a save or a
  // live event must not throw away the edit in progress. A new zone is not in the
  // store yet, so it is left alone.
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

  // Keyboard: Ctrl+Z / Ctrl+Shift+Z, Delete removes the selected point, arrows nudge
  // it (Shift = 5x) and Esc deselects. Inputs keep their own keys.
  useEffect(() => {
    const handleKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (TEXT_ENTRY_TAGS.has(tag) || event.target?.isContentEditable) return;
      const intent = shortcutFor(event, draft.selectedIndex);
      if (!intent) return;
      if (intent.preventDefault) event.preventDefault();
      if (intent.type === 'delete-selection' && !canDeletePoint(draft, draft.selectedIndex)) {
        return showToast(MIN_POINTS_MESSAGE);
      }
      dispatch(intent);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draft, showToast]);

  const handleCameraChange = (event) => {
    dispatch({ type: 'camera-changed' });
    setSelectedCameraId(event.target.value);
  };

  const handleSelectZone = (zoneId) => dispatch({ type: 'select-zone', zoneId });

  const handleNewZone = () => {
    const id = uniqueZoneId(`${selectedCameraId}-zona`, zones);
    dispatch({ type: 'create', zoneId: id });
    showToast('Zonă nouă: desenează poligonul, apoi salvează.');
  };

  const handleAddPoint = (point) => {
    if (draft.zoneId) dispatch({ type: 'add-point', point });
    else showToast(NO_ZONE_MESSAGE);
  };

  const handleApplyShape = (shape) => {
    if (draft.zoneId) dispatch({ type: 'apply-shape', shape });
    else showToast(NO_ZONE_MESSAGE);
  };

  const handleDeletePoint = (index) => {
    if (canDeletePoint(draft, index)) dispatch({ type: 'delete-point', index });
    else showToast(MIN_POINTS_MESSAGE);
  };

  const reorderPoints = () => {
    dispatch({ type: 'reorder' });
    showToast(REORDER_NOTICE);
  };

  const applyJsonPoints = () => {
    const { points, error } = parsePointList(jsonText);
    if (error) {
      showToast(error);
    } else {
      dispatch({ type: 'apply-points', points });
      showToast('Coordonate aplicate pe cadru.');
    }
  };

  const handleSave = async () => {
    const failure = check.errors[0];
    if (failure) return showToast(failure.message);
    setSaving(true);
    try {
      await saveZone(draft.zoneId, buildZonePayload(draft, { cameraId: selectedCameraId, zone }));
      dispatch({ type: 'saved' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteZone = async () => {
    if (!draft.zoneId || !zone) return;
    const confirmed = window.confirm(
      `Ștergi zona „${draft.zoneId}”? Acțiunea nu poate fi anulată.`
    );
    if (!confirmed) return;
    const remaining = cameraZones.filter((item) => item.zone_id !== draft.zoneId);
    await deleteZone(draft.zoneId);
    dispatch({ type: 'delete-result', remainingZones: remaining });
  };

  const handleReferenceUpload = async (file) => {
    if (!draft.zoneId) return;
    setUploading(true);
    try {
      await captureReferenceFrame(draft.zoneId, file);
      setCapturedAt(new Date().toLocaleTimeString('ro-RO'));
    } finally {
      setUploading(false);
    }
  };

  const handleCaptureFromLive = async () => {
    if (!draft.zoneId) return;
    setCapturing(true);
    try {
      await captureReferenceFromLive(draft.zoneId);
      setCapturedAt(new Date().toLocaleTimeString('ro-RO'));
    } finally {
      setCapturing(false);
    }
  };

  const handleClearReference = () => {
    if (!draft.zoneId) return;
    clearReferenceFrame(draft.zoneId);
    setCapturedAt(null);
  };

  if (!activeCamera) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div
          style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
          className="max-w-md rounded-xl border p-5 text-center space-y-2"
        >
          <h2 className="font-bold text-sm uppercase">Nu există camere</h2>
          <p style={{ color: themeStyles.textMuted }} className="text-xs">
            Backend-ul nu a returnat camere. Pornește stack-ul cu ./run.sh demo.
          </p>
        </div>
      </div>
    );
  }

  // The static build has no edge to upload a reference frame, so the first frame of the
  // camera's demo clip is the background. An uploaded frame still wins.
  const demoReferenceUrl = DEMO_REFERENCE_FRAMES[selectedCameraId] || null;
  const referenceUrl = zone?.reference_frame_url || demoReferenceUrl || null;
  const usingDemoReference = !zone?.reference_frame_url && Boolean(demoReferenceUrl);

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto h-full">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-black/10 dark:border-white/10 pb-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-black text-lg uppercase tracking-tight flex items-center gap-2">
              <PenTool size={20} className="text-[#D73833] dark:text-[#FFEB33]" />
              Configurare zone
            </h2>
            <p style={{ color: themeStyles.textMuted }} className="text-xs font-mono">
              Trage un punct ca să-l muți · „+” de pe latură adaugă un punct · click dreapta /
              Delete șterge · Ctrl+Z anulează
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs flex-wrap">
            <label htmlFor="zone-camera" className="font-bold opacity-75">
              Camera:
            </label>
            <select
              id="zone-camera"
              data-testid="zone-camera"
              value={selectedCameraId}
              onChange={handleCameraChange}
              style={{
                backgroundColor: themeStyles.cardBg,
                borderColor: themeStyles.panelBorder,
                color: themeStyles.text,
              }}
              className="min-w-[15rem] max-w-full px-2.5 py-1.5 rounded-lg border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
            >
              {cameraChoices.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 min-w-0 space-y-3">
            <ZoneToolbar
              zones={cameraZones}
              zoneId={draft.zoneId}
              onSelectZone={handleSelectZone}
              onNewZone={handleNewZone}
              onApplyShape={handleApplyShape}
              canUndo={draft.past.length > 0}
              canRedo={draft.future.length > 0}
              onUndo={() => dispatch({ type: 'undo' })}
              onRedo={() => dispatch({ type: 'redo' })}
              jsonOpen={jsonOpen}
              onToggleJson={() => setJsonOpen((open) => !open)}
              jsonText={jsonText}
              onJsonTextChange={setJsonText}
              onApplyJson={applyJsonPoints}
            />

            <ZoneCanvas
              points={draft.points}
              closed={draft.closed}
              selectedIndex={draft.selectedIndex}
              crossing={check.crossing}
              hasCrossing={check.hasCrossing}
              referenceUrl={referenceUrl}
              onAddPoint={handleAddPoint}
              onClose={() => dispatch({ type: 'close' })}
              onSelect={(index) => dispatch({ type: 'select', index })}
              onBeginGesture={() => dispatch({ type: 'begin-gesture' })}
              onEndGesture={() => dispatch({ type: 'end-gesture' })}
              onMovePoint={(index, point) => dispatch({ type: 'move-point', index, point })}
              onInsertPoint={(index, point) => dispatch({ type: 'insert-point', index, point })}
              onDeletePoint={handleDeletePoint}
              onReorder={reorderPoints}
              onRedraw={() => dispatch({ type: 'redraw' })}
            />
          </div>

          <div className="min-w-0 space-y-3">
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
              onSave={handleSave}
              onDelete={handleDeleteZone}
            />

            <ZoneReferencePanel
              referenceUrl={referenceUrl}
              usingDemoReference={usingDemoReference}
              hasZone={Boolean(zone)}
              uploading={uploading}
              capturing={capturing}
              capturedAt={capturedAt}
              onUpload={handleReferenceUpload}
              onCaptureFromLive={handleCaptureFromLive}
              onClear={handleClearReference}
              onError={showToast}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
