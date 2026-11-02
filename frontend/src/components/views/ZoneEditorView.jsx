import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Code,
  ImageOff,
  Layers,
  PenTool,
  Plus,
  Radio,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Wand2,
  AlertTriangle,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { DEMO_REFERENCE_FRAMES } from '../../constants/mockData';
import { crossingEdges, orderAroundCentroid } from '../../utils/polygon';

// Un punct e ținut în coordonate normalizate 0-1, ca poligonul să urmeze orice rezoluție.
const EMPTY_DRAFT = {
  name: '',
  rule_type: 'RESTRICTED',
  active_when: 'always',
  severity: 'CRITICAL',
  debounce_s: 1,
  notify_channel: 'slack',
  escalate_after_s: null,
};

const HISTORY_LIMIT = 60;

function rounded(point) {
  return { x: Number(point.x.toFixed(4)), y: Number(point.y.toFixed(4)) };
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function uniqueZoneId(base, zones) {
  const root = slugify(base) || 'zona-noua';
  if (!zones.some((zone) => zone.zone_id === root)) return root;
  let suffix = 2;
  while (zones.some((zone) => zone.zone_id === `${root}-${suffix}`)) suffix += 1;
  return `${root}-${suffix}`;
}

export default function ZoneEditorView() {
  const { isDarkMode, themeStyles } = useTheme();
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

  const [zoneId, setZoneId] = useState('');
  const cameraZones = useMemo(
    () => zones.filter((item) => item.camera_id === selectedCameraId),
    [zones, selectedCameraId]
  );
  const zone = useMemo(
    () => cameraZones.find((item) => item.zone_id === zoneId) || null,
    [cameraZones, zoneId]
  );

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [points, setPoints] = useState([]);
  const [closed, setClosed] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  // Undo/redo snapshots: { points, closed }.
  const [history, setHistory] = useState({ past: [], future: [] });
  const [saving, setSaving] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [jsonInput, setJsonInput] = useState('[]');
  const [referenceAspect, setReferenceAspect] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capturedAt, setCapturedAt] = useState(null);

  // Edges that cross another edge: the zone would be an hourglass, not a perimeter.
  const crossing = crossingEdges(points, closed);
  const hasCrossing = crossing.size > 0;

  const canvasRef = useRef(null);
  const referenceInputRef = useRef(null);
  // With pointer capture, the click that ends a drag lands on the canvas: ignore that one.
  const suppressClickRef = useRef(false);
  // The drag in progress: { index, before, moved }.
  const dragRef = useRef(null);
  // The points as last rendered, read at the end of a drag.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const hydrate = useCallback((nextZone) => {
    setPoints((nextZone?.polygon || []).map(rounded));
    setClosed((nextZone?.polygon || []).length >= 3);
    setDraft({
      name: nextZone?.name || nextZone?.zone_id || '',
      rule_type: nextZone?.rule_type || 'RESTRICTED',
      active_when: nextZone?.active_when || 'always',
      severity: nextZone?.severity || 'CRITICAL',
      debounce_s: nextZone?.debounce_s ?? 1,
      notify_channel: nextZone?.notify_channel || 'slack',
      escalate_after_s: nextZone?.escalate_after_s ?? null,
    });
    setHistory({ past: [], future: [] });
    setSelectedIndex(null);
    setReferenceAspect(null);
  }, []);

  // „Zonă nouă" curată: panoul nu păstrează ID-ul și numele unei zone care nu mai
  // există (F12 — după ștergerea ultimei zone a camerei).
  const resetDraft = useCallback(() => {
    setZoneId('');
    setPoints([]);
    setClosed(false);
    setHistory({ past: [], future: [] });
    setSelectedIndex(null);
    setDraft({ ...EMPTY_DRAFT });
  }, []);

  // Se reîncarcă doar când se schimbă selecția, nu la fiecare actualizare a store-ului:
  // altfel o salvare (sau un eveniment) ar arunca editarea în curs.
  useEffect(() => {
    if (isNew) return; // o zonă nouă nu e încă în store: nu o înlocui
    const current = cameraZones.find((item) => item.zone_id === zoneId);
    if (current) {
      hydrate(current);
      return;
    }
    if (cameraZones.length > 0) {
      const preferred = cameraZones.find((item) => item.zone_id === 'engine-left') || cameraZones[0];
      setZoneId(preferred.zone_id);
      return;
    }
    resetDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCameraId, zoneId, isNew, cameraZones.length]);

  const snapshot = () => ({ points, closed });

  // Every edit goes through here, so it can be undone.
  const pushPoints = useCallback(
    (next, { before = points, closedBefore = closed } = {}) => {
      setHistory((current) => ({
        past: [...current.past, { points: before, closed: closedBefore }].slice(-HISTORY_LIMIT),
        future: [],
      }));
      setPoints(next);
      setJsonInput(JSON.stringify(next, null, 2));
    },
    [points, closed]
  );

  const replacePoints = useCallback((next) => {
    setPoints(next);
    setJsonInput(JSON.stringify(next, null, 2));
  }, []);

  const restore = (state) => {
    setPoints(state.points);
    setClosed(state.closed);
    setJsonInput(JSON.stringify(state.points, null, 2));
    setSelectedIndex(null);
  };

  const undo = useCallback(() => {
    if (history.past.length === 0) return;
    const previous = history.past[history.past.length - 1];
    setHistory({
      past: history.past.slice(0, -1),
      future: [snapshot(), ...history.future].slice(0, HISTORY_LIMIT),
    });
    restore(previous);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, points, closed]);

  const redo = useCallback(() => {
    if (history.future.length === 0) return;
    const next = history.future[0];
    setHistory({
      past: [...history.past, snapshot()].slice(-HISTORY_LIMIT),
      future: history.future.slice(1),
    });
    restore(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, points, closed]);

  const toNormalized = useCallback((event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return rounded({
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    });
  }, []);

  const closePolygon = () => {
    setHistory((current) => ({
      past: [...current.past, { points, closed: false }].slice(-HISTORY_LIMIT),
      future: [],
    }));
    setClosed(true);
  };

  // Close by clicking the first point (no double-click: it added two extra points first).
  const CLOSE_RADIUS_PX = 12;
  const nearFirstPoint = (event) => {
    if (points.length < 3) return false;
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = event.clientX - (rect.left + points[0].x * rect.width);
    const dy = event.clientY - (rect.top + points[0].y * rect.height);
    return Math.hypot(dx, dy) <= CLOSE_RADIUS_PX;
  };

  // Drawing: each click adds the next point of the outline, in order.
  const handleCanvasClick = (event) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (closed) {
      setSelectedIndex(null);
      return;
    }
    if (!zoneId) {
      showToast('Alege o zonă salvată sau apasă „Zonă nouă”.');
      return;
    }
    if (nearFirstPoint(event)) {
      closePolygon();
      return;
    }
    pushPoints([...points, toNormalized(event)]);
  };

  // Drag a point; a drag from an edge's "+" first inserts a point there.
  const beginDrag = (event, index, before = points) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedIndex(index);
    canvasRef.current.setPointerCapture?.(event.pointerId);
    dragRef.current = { index, before, moved: false };
    setIsDragging(true);
  };

  const handleVertexPointerDown = (event, index) => {
    if (event.button !== 0) return;
    if (!closed && index === 0 && points.length >= 3) {
      // While drawing, the first point closes the zone instead of moving.
      event.stopPropagation();
      closePolygon();
      return;
    }
    beginDrag(event, index);
  };

  const handleEdgeHandlePointerDown = (event, edgeIndex) => {
    if (event.button !== 0) return;
    const a = points[edgeIndex];
    const b = points[(edgeIndex + 1) % points.length];
    const middle = rounded({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    setPoints([...points.slice(0, edgeIndex + 1), middle, ...points.slice(edgeIndex + 1)]);
    beginDrag(event, edgeIndex + 1, points);
    dragRef.current.moved = true; // the insert is an edit even without moving
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    const point = toNormalized(event);
    setPoints((current) => current.map((item, index) => (index === drag.index ? point : item)));
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setIsDragging(false);
    suppressClickRef.current = true;
    // No click follows a cancelled or outside release; do not eat the next real click.
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (drag.moved) {
      // One undo step for the whole drag: the points from before the pointerdown.
      setHistory((current) => ({
        past: [...current.past, { points: drag.before, closed }].slice(-HISTORY_LIMIT),
        future: [],
      }));
      setJsonInput(JSON.stringify(pointsRef.current, null, 2));
    }
  };

  const removePoint = useCallback(
    (index) => {
      // A closed zone keeps at least 3 points; while drawing, any point can go.
      if (closed && points.length <= 3) {
        showToast('O zonă are nevoie de cel puțin 3 puncte.');
        return;
      }
      pushPoints(points.filter((_, position) => position !== index));
      setSelectedIndex(null);
    },
    [closed, points, pushPoints, showToast]
  );

  const handleReorder = () => {
    pushPoints(orderAroundCentroid(points));
    setSelectedIndex(null);
    showToast('Punctele au fost reordonate în jurul centrului zonei.');
  };

  const handleRedraw = () => {
    pushPoints([]);
    setClosed(false);
    setSelectedIndex(null);
  };

  // Keyboard: Ctrl+Z / Ctrl+Shift+Z undo/redo, Delete removes the selected point,
  // arrows nudge it (Shift = 5x), Esc deselects.
  const handleKeyDown = useCallback(
    (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === 'Escape') {
        setSelectedIndex(null);
        return;
      }
      if (selectedIndex === null) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removePoint(selectedIndex);
        return;
      }
      const step = event.shiftKey ? 0.01 : 0.002;
      const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      const point = points[selectedIndex];
      replacePoints(
        points.map((item, index) =>
          index === selectedIndex
            ? rounded({
                x: Math.max(0, Math.min(1, point.x + delta[0])),
                y: Math.max(0, Math.min(1, point.y + delta[1])),
              })
            : item
        )
      );
    },
    [points, redo, removePoint, replacePoints, selectedIndex, undo]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      const valid =
        Array.isArray(parsed) &&
        parsed.length >= 3 &&
        parsed.every((point) => typeof point?.x === 'number' && typeof point?.y === 'number');
      if (!valid) {
        showToast('JSON invalid: ai nevoie de minimum 3 puncte {x, y}.');
        return;
      }
      pushPoints(parsed.map(rounded));
      setClosed(true);
      showToast('Coordonate aplicate pe cadru.');
    } catch {
      showToast('JSON invalid: nu am putut parsa coordonatele.');
    }
  };

  const handleNewZone = () => {
    const id = uniqueZoneId(`${selectedCameraId}-zona`, zones);
    setIsNew(true);
    setZoneId(id);
    setPoints([]);
    setClosed(false);
    setHistory({ past: [], future: [] });
    setSelectedIndex(null);
    setDraft({ ...EMPTY_DRAFT, name: id });
    showToast('Zonă nouă: desenează poligonul, apoi salvează.');
  };

  const handleDeleteZone = async () => {
    if (!zoneId) return;
    if (!window.confirm(`Ștergi zona „${zoneId}"? Acțiunea nu poate fi anulată.`)) return;
    // După ștergere nu mai există ce edita: fie trecem pe următoarea zonă, fie golim
    // complet formularul — nu păstrăm ID-ul și numele zonei șterse (F12).
    const remaining = cameraZones.filter((item) => item.zone_id !== zoneId);
    await deleteZone(zoneId);
    setIsNew(false);
    if (remaining.length > 0) {
      setZoneId(remaining[0].zone_id);
      return;
    }
    resetDraft();
  };

  const handleSave = async () => {
    if (!zoneId) {
      showToast('Completează un ID de zonă.');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(zoneId)) {
      showToast('ID-ul poate conține doar litere mici, cifre și cratime.');
      return;
    }
    if (points.length < 3) {
      showToast('Poligonul are nevoie de minimum 3 puncte.');
      return;
    }
    if (!closed) {
      showToast('Închide zona: dă click pe primul punct.');
      return;
    }
    if (hasCrossing) {
      showToast('Laturile zonei se intersectează. Mută punctele sau folosește „Reordonează punctele”.');
      return;
    }
    const payload = {
      zone_id: zoneId,
      camera_id: selectedCameraId,
      name: draft.name?.trim() || zoneId,
      rule_type: draft.rule_type,
      active_when: draft.active_when,
      required_ppe: zone?.required_ppe || [],
      severity: draft.severity,
      debounce_s: Number(draft.debounce_s) || 0,
      notify_channel: 'slack',
      escalate_after_s:
        draft.escalate_after_s === null || draft.escalate_after_s === ''
          ? null
          : Number(draft.escalate_after_s),
      polygon: points.map(({ x, y }) => ({ x, y })),
      reference_frame: zone?.reference_frame || null,
    };
    setSaving(true);
    try {
      await saveZone(zoneId, payload);
      setIsNew(false);
    } finally {
      setSaving(false);
    }
  };

  const handleReferenceUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !zoneId) return;
    setUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('conversia în JPEG a eșuat');
      await captureReferenceFrame(zoneId, new File([blob], 'referinta.jpg', { type: 'image/jpeg' }));
    } catch (error) {
      showToast(`Încărcarea referinței a eșuat: ${error.message}`);
      setCapturedAt(new Date().toLocaleTimeString('ro-RO'));
    } finally {
      setUploading(false);
    }
  };

  const handleCaptureFromLive = async () => {
    if (!zoneId) return;
    setCapturing(true);
    try {
      await captureReferenceFromLive(zoneId);
      setCapturedAt(new Date().toLocaleTimeString('ro-RO'));
    } finally {
      setCapturing(false);
    }
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

  const canSave = Boolean(zoneId) && points.length >= 3 && closed && !hasCrossing && !saving;
  // The static build has no edge to upload a reference frame, so the first frame of the
  // camera's demo clip is the background. Same aspect as the clip, so the polygon keeps
  // its coordinates; a real uploaded frame still wins.
  const demoReferenceUrl = DEMO_REFERENCE_FRAMES[selectedCameraId] || null;
  const referenceUrl = zone?.reference_frame_url || demoReferenceUrl || null;
  const hasReference = Boolean(referenceUrl);
  const usingDemoReference = !zone?.reference_frame_url && Boolean(demoReferenceUrl);

  return (
    <div className="flex-1 p-4 md:p-6 overflow-y-auto space-y-4 h-full max-w-7xl mx-auto">
      <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3 flex-wrap gap-2">
        <div>
          <h2 className="font-black text-lg uppercase tracking-tight flex items-center gap-2">
            <PenTool size={20} className={isDarkMode ? 'text-[#FFEB33]' : 'text-[#D73833]'} />
            Configurare zone
          </h2>
          <p style={{ color: themeStyles.textMuted }} className="text-xs font-mono">
            Trage un punct ca să-l muți · „+” de pe latură adaugă un punct · click dreapta / Delete șterge · Ctrl+Z anulează
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowJson(!showJson)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center gap-1.5 transition-colors ${
              isDarkMode
                ? 'border-white/20 hover:bg-white/10 text-white'
                : 'border-slate-300 hover:bg-slate-100 text-[#1F1F1F]'
            }`}
          >
            <Code size={14} /> JSON
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-3">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <label htmlFor="zone-camera" className="font-bold opacity-75">
              Camera:
            </label>
            <select
              id="zone-camera"
              data-testid="zone-camera"
              value={selectedCameraId}
              onChange={(event) => setSelectedCameraId(event.target.value)}
              style={{ backgroundColor: themeStyles.cardBg, borderColor: themeStyles.panelBorder, color: themeStyles.text }}
              className="min-w-[16rem] max-w-full px-2.5 py-1.5 rounded-lg border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#FFEB33]"
            >
              {cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {`${camera.name || camera.code || camera.id} (${camera.id})${
                    camera.status === 'offline' ? ' · offline' : ''
                  } · ${zones.filter((item) => item.camera_id === camera.id).length} zone`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold opacity-75 mr-1">Zone salvate:</span>
            {cameraZones.length === 0 && (
              <span className="text-[11px] font-mono text-amber-500 dark:text-amber-300">
                niciuna pe camera asta — creează una
              </span>
            )}
            {cameraZones.map((item) => {
              const isSelected = item.zone_id === zoneId;
              return (
                <button
                  key={item.zone_id}
                  data-testid={`zone-chip-${item.zone_id}`}
                  onClick={() => {
                    setIsNew(false);
                    setZoneId(item.zone_id);
                  }}
                  className={`px-2.5 py-1 rounded border text-[11px] font-mono flex items-center gap-1.5 transition-colors ${
                    isSelected
                      ? isDarkMode
                        ? 'bg-[#D73833] border-[#FFEB33] text-white shadow-md'
                        : 'bg-[#7EDEED] border-[#7EDEED] text-[#1F1F1F] font-bold shadow-md'
                      : isDarkMode
                      ? 'bg-black/30 border-white/10 text-slate-300 hover:bg-white/10'
                      : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
                  }`}
                  title={`${item.rule_type} · ${(item.polygon || []).length} puncte`}
                >
                  {item.zone_id}
                  <span className="opacity-70 font-semibold">
                    {item.rule_type === 'PPE_REQUIRED' ? 'PPE' : item.rule_type === 'RESTRICTED' ? 'ZONĂ' : item.rule_type}
                  </span>
                </button>
              );
            })}
            <button
              data-testid="zone-new"
              onClick={handleNewZone}
              className={`px-2.5 py-1 rounded border text-[11px] font-bold flex items-center gap-1 transition-colors ${
                isDarkMode
                  ? 'border-[#FFEB33]/40 bg-[#FFEB33]/10 text-[#FFEB33] hover:bg-[#FFEB33]/20'
                  : 'border-[#D73833]/40 bg-[#D73833]/10 text-[#D73833] hover:bg-[#D73833]/20'
              }`}
            >
              <Plus size={12} /> Zonă nouă
            </button>
          </div>

          <div
            data-testid="zone-canvas"
            ref={canvasRef}
            onClick={handleCanvasClick}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ ...(hasReference && referenceAspect ? { aspectRatio: referenceAspect } : {}), touchAction: 'none' }}
            className={`relative rounded-xl overflow-hidden bg-black border-2 ${
              isDarkMode ? 'border-[#D73833]/40' : 'border-slate-300'
            } shadow-2xl select-none ${
              hasReference && referenceAspect ? 'w-full max-h-[68vh] mx-auto' : 'min-h-[380px]'
            } ${isDragging ? 'cursor-grabbing' : closed ? 'cursor-default' : 'cursor-crosshair'}`}
          >
            {hasReference ? (
              <img
                key={referenceUrl}
                src={referenceUrl}
                alt="Cadru de referință"
                className="absolute inset-0 w-full h-full object-fill pointer-events-none"
                draggable={false}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth && naturalHeight) setReferenceAspect(naturalWidth / naturalHeight);
                }}
                onError={() => setReferenceAspect(null)}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-black flex items-center justify-center">
                <p className="text-[11px] text-slate-400 font-mono text-center px-6">
                  Fără cadru de referință. Încarcă unul din panoul din dreapta,
                  <br />
                  sau pornește edge-ul ca să apară imaginea camerei.
                </p>
              </div>
            )}

            {usingDemoReference && (
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/75 text-[10px] font-mono text-slate-200 border border-white/20 pointer-events-none">
                cadru demo • primul frame din clip
              </div>
            )}

            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
              {points.length > 1 && closed && (
                <polygon
                  points={points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')}
                  fill={hasCrossing ? 'rgba(255, 235, 51, 0.25)' : 'rgba(215, 56, 51, 0.20)'}
                  stroke="#D73833"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {points.length > 1 && !closed && (
                <polyline
                  points={points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ')}
                  fill="none"
                  stroke="#D73833"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="6,4"
                />
              )}
              {/* Edges that cross another edge, drawn over in yellow */}
              {[...crossing].map((index) => {
                const a = points[index];
                const b = points[(index + 1) % points.length];
                return (
                  <line
                    key={`x-${index}`}
                    x1={a.x * 1000}
                    y1={a.y * 1000}
                    x2={b.x * 1000}
                    y2={b.y * 1000}
                    stroke="#FFEB33"
                    strokeWidth="5"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>

            {/* "+" in the middle of each edge: drag it to add a point exactly there */}
            {closed &&
              points.length >= 3 &&
              points.map((a, index) => {
                const b = points[(index + 1) % points.length];
                return (
                  <div
                    key={`m-${index}`}
                    data-testid={`zone-edge-${index}`}
                    onPointerDown={(event) => handleEdgeHandlePointerDown(event, index)}
                    onClick={(event) => event.stopPropagation()}
                    style={{ left: `${((a.x + b.x) / 2) * 100}%`, top: `${((a.y + b.y) / 2) * 100}%` }}
                    className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 border border-white/80 text-white text-[10px] leading-[10px] flex items-center justify-center cursor-copy opacity-60 hover:opacity-100"
                    title="Trage ca să adaugi un punct pe această latură"
                  >
                    +
                  </div>
                );
              })}

            {/* Points: drag to move, right-click (or select + Delete) to remove */}
            {points.map((point, index) => {
              const closesZone = !closed && index === 0 && points.length >= 3;
              const isSelected = selectedIndex === index;
              return (
                <div
                  data-testid={`zone-point-${index}`}
                  key={index}
                  onPointerDown={(event) => handleVertexPointerDown(event, index)}
                  onClick={(event) => event.stopPropagation()}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    removePoint(index);
                  }}
                  style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg ${
                    closesZone
                      ? 'w-5 h-5 bg-emerald-400 border-white ring-4 ring-emerald-400/40 cursor-pointer'
                      : isSelected
                      ? 'w-4 h-4 bg-[#FFEB33] border-white ring-4 ring-[#FFEB33]/50 cursor-grab'
                      : 'w-3.5 h-3.5 bg-white border-[#D73833] ring-2 ring-[#D73833]/50 cursor-grab'
                  }`}
                  title={
                    closesZone
                      ? 'Click aici ca să închizi zona'
                      : `Punct ${index + 1} (${point.x.toFixed(3)}, ${point.y.toFixed(3)}): trage ca să-l muți, click dreapta ca să-l ștergi`
                  }
                >
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-mono text-white/80 pointer-events-none">
                    {index + 1}
                  </span>
                </div>
              );
            })}

            <div className="absolute top-3 left-3 bg-black/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-white/10 text-white text-[11px] font-mono shadow pointer-events-none max-w-[85%]">
              {closed
                ? '✓ zonă închisă · trage punctele · „+” adaugă · click dreapta șterge'
                : points.length >= 3
                ? 'click = punct nou · click pe primul punct (verde) închide zona'
                : 'click pe imagine ca să pui punctele zonei, în ordine, pe contur'}
            </div>

            {hasCrossing && (
              <div className="absolute top-12 left-3 right-3 bg-[#FFEB33] text-[#1F1F1F] px-3 py-1.5 rounded-lg text-[11px] font-bold shadow flex items-center gap-2 pointer-events-none">
                <AlertTriangle size={14} className="shrink-0 text-[#D73833]" />
                Laturile marcate cu galben se intersectează: zona nu e un perimetru. Mută punctele sau reordonează-le.
              </div>
            )}

            <div
              className="absolute bottom-3 right-3 flex items-center gap-1.5"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                onClick={undo}
                disabled={history.past.length === 0}
                className="p-1.5 rounded bg-black/70 border border-white/20 text-white disabled:opacity-30"
                title="Anulează (Ctrl+Z)"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={redo}
                disabled={history.future.length === 0}
                className="p-1.5 rounded bg-black/70 border border-white/20 text-white disabled:opacity-30"
                title="Refă (Ctrl+Shift+Z)"
              >
                <Redo2 size={14} />
              </button>
              {hasCrossing && (
                <button
                  onClick={handleReorder}
                  className="px-2.5 py-1 rounded bg-[#FFEB33] hover:bg-yellow-400 text-[#1F1F1F] text-xs font-bold flex items-center gap-1 shadow"
                  title="Ordonează punctele în jurul centrului zonei"
                >
                  <Wand2 size={13} /> Reordonează punctele
                </button>
              )}
              <button
                onClick={handleRedraw}
                className="px-2.5 py-1 rounded bg-[#D73833] hover:bg-[#b82e2a] text-white text-xs font-bold flex items-center gap-1 border border-[#D73833]"
                title="Șterge toate punctele și desenează zona din nou"
              >
                <Trash2 size={13} /> Desenează din nou
              </button>
            </div>
          </div>

          {showJson && (
            <div
              style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
              className="p-3 rounded-xl border space-y-2 text-xs"
            >
              <div className="flex items-center justify-between font-bold font-mono text-[11px]">
                <span>Coordonate normalizate (JSON)</span>
                <button
                  onClick={handleApplyJson}
                  className="px-2 py-0.5 bg-[#D73833] hover:bg-[#b82e2a] text-white rounded text-[10px] font-bold"
                >
                  Aplică pe cadru
                </button>
              </div>
              <textarea
                value={jsonInput}
                onChange={(event) => setJsonInput(event.target.value)}
                rows={4}
                className="w-full p-2 rounded bg-white dark:bg-black/40 border border-slate-300 dark:border-white/10 font-mono text-[10px] text-[#1F1F1F] dark:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
              />
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="rounded-xl border p-4 shadow-lg space-y-3 text-xs"
          >
            <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
              <Layers size={16} className={isDarkMode ? 'text-[#FFEB33]' : 'text-[#D73833]'} /> Parametri
            </h3>

            <div>
              <label className="font-bold block mb-1">ID zonă</label>
              <input
                type="text"
                value={zoneId}
                disabled={Boolean(zone) && !isNew}
                onChange={(event) => setZoneId(slugify(event.target.value))}
                className="w-full p-2 rounded bg-white dark:bg-black/30 border border-slate-300 dark:border-white/20 font-mono text-xs text-[#1F1F1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#FFEB33] disabled:opacity-60"
                placeholder="engine-left"
              />
              {Boolean(zone) && !isNew && (
                <p className="text-[10px] font-mono opacity-60 mt-1">
                  ID-ul e cheia zonei; pentru alt nume folosește câmpul „Nume".
                </p>
              )}
            </div>

            <div>
              <label className="font-bold block mb-1">Nume</label>
              <input
                type="text"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="w-full p-2 rounded bg-white dark:bg-black/30 border border-slate-300 dark:border-white/20 text-xs text-[#1F1F1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
                placeholder="Motor stâng"
              />
            </div>

            <div>
              <label className="font-bold block mb-1">Tip regulă</label>
              <select
                value={draft.rule_type}
                onChange={(event) => setDraft({ ...draft, rule_type: event.target.value })}
                className="w-full p-2 rounded bg-white dark:bg-black/30 border border-slate-300 dark:border-white/20 text-xs text-[#1F1F1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
              >
                <option value="RESTRICTED">RESTRICTED (zonă interzisă)</option>
                <option value="PPE_REQUIRED">PPE_REQUIRED (echipament obligatoriu)</option>
              </select>
            </div>

            <div>
              <label className="font-bold block mb-1">Activă când</label>
              <select
                value={draft.active_when}
                onChange={(event) => setDraft({ ...draft, active_when: event.target.value })}
                className="w-full p-2 rounded bg-white dark:bg-black/30 border border-slate-300 dark:border-white/20 text-xs text-[#1F1F1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
              >
                <option value="always">always — permanent</option>
                <option value="engine_on">engine_on — doar cu motorul pornit</option>
              </select>
            </div>

            {/* Două coloane doar când panoul are loc; altfel „Severitate" nu încape în
                coloana ei și select-ul arată „CRIT" (F4). */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="font-bold block mb-1 whitespace-nowrap">Severitate</label>
                <select
                  value={draft.severity}
                  onChange={(event) => setDraft({ ...draft, severity: event.target.value })}
                  className="w-full p-2 rounded bg-white dark:bg-black/30 border border-slate-300 dark:border-white/20 text-xs text-[#1F1F1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
                >
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="WARNING">WARNING</option>
                </select>
              </div>
              <div>
                <label className="font-bold block mb-1 whitespace-nowrap">Debounce (s)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={draft.debounce_s}
                  onChange={(event) => setDraft({ ...draft, debounce_s: event.target.value })}
                  className="w-full p-2 rounded bg-white dark:bg-black/30 border border-slate-300 dark:border-white/20 text-xs font-mono text-[#1F1F1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
                />
              </div>
            </div>

            <div>
              <label className="font-bold block mb-1">Escaladează după</label>
              <select
                value={draft.escalate_after_s ?? 'null'}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    escalate_after_s: event.target.value === 'null' ? null : Number(event.target.value),
                  })
                }
                className="w-full p-2 rounded bg-white dark:bg-black/30 border border-slate-300 dark:border-white/20 text-xs font-mono text-[#1F1F1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#FFEB33]"
              >
                <option value="30">30 s</option>
                <option value="60">60 s</option>
                <option value="120">120 s</option>
                <option value="null">niciodată</option>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                data-testid="zone-save"
                onClick={handleSave}
                disabled={!canSave}
                className="flex-1 py-2.5 rounded-lg bg-[#D73833] hover:bg-[#b82e2a] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-colors"
              >
                <Save size={15} /> {saving ? 'Se salvează…' : `Salvează (${points.length} puncte)`}
              </button>
              <button
                onClick={handleDeleteZone}
                disabled={!zone}
                className="p-2.5 rounded-lg border border-red-500/40 text-red-500 dark:text-red-300 hover:bg-red-500/10 disabled:opacity-30 transition-colors"
                title="Șterge zona"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <div
            style={{ backgroundColor: themeStyles.panelBg, borderColor: themeStyles.panelBorder }}
            className="rounded-xl border p-4 shadow-lg space-y-2 text-xs"
          >
            <h3 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
              <Camera size={16} className={isDarkMode ? 'text-[#FFEB33]' : 'text-[#D73833]'} /> Cadru de referință
            </h3>
            <p style={{ color: themeStyles.textMuted }} className="text-[11px] leading-snug">
              Cadrul pe care desenezi zonele. Folosește doar un cadru <b>deja blurat</b> — nicio față nu trebuie să ajungă aici.
            </p>

            <input
              ref={referenceInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleReferenceUpload}
            />

            {hasReference ? (
              <div className="space-y-2">
                <img
                  key={referenceUrl}
                  src={referenceUrl}
                  alt="Referință"
                  className="w-full rounded-lg border border-white/10"
                />
                {capturedAt && (
                  <p className="text-[10px] font-mono opacity-60">actualizat la {capturedAt}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => referenceInputRef.current?.click()}
                    disabled={uploading || capturing || !zone}
                    className="py-1.5 rounded bg-[#D73833] hover:bg-[#b82e2a] disabled:opacity-50 text-white text-[11px] font-bold transition-colors"
                  >
                    {uploading ? 'Se încarcă…' : 'Înlocuiește'}
                  </button>
                  <button
                    data-testid="reference-from-live"
                    onClick={handleCaptureFromLive}
                    disabled={uploading || capturing || !zone}
                    className={`py-1.5 rounded disabled:opacity-50 text-[11px] font-bold flex items-center justify-center gap-1 transition-colors ${
                      isDarkMode
                        ? 'bg-[#7EDEED] hover:bg-[#68c8d8] text-[#1F1F1F]'
                        : 'bg-[#7EDEED] hover:bg-[#68c8d8] text-[#1F1F1F]'
                    }`}
                  >
                    <Radio size={12} /> {capturing ? 'se preia…' : 'Din live'}
                  </button>
                  <button
                    onClick={() => clearReferenceFrame(zoneId)}
                    disabled={!zone || capturing}
                    className="col-span-2 py-1.5 rounded border border-red-500/40 text-red-500 dark:text-red-300 hover:bg-red-500/10 text-[11px] font-bold flex items-center justify-center gap-1 transition-colors"
                  >
                    <ImageOff size={12} /> Șterge
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={() => referenceInputRef.current?.click()}
                  disabled={!zone || uploading || capturing}
                  className={`w-full py-5 rounded-lg border-2 border-dashed ${
                    isDarkMode ? 'border-white/20 text-slate-300 hover:border-[#FFEB33]/60' : 'border-slate-300 text-slate-600 hover:border-[#D73833]/60'
                  } text-[11px] font-mono flex flex-col items-center gap-1 disabled:opacity-40 transition-colors`}
                >
                  <Camera size={18} />
                  {uploading ? 'se încarcă…' : zone ? 'încarcă imagine (JPG/PNG)' : 'salvează zona întâi'}
                </button>
                <button
                  data-testid="reference-from-live"
                  onClick={handleCaptureFromLive}
                  disabled={!zone || uploading || capturing}
                  className={`w-full py-2 rounded-lg disabled:opacity-40 text-[11px] font-bold flex items-center justify-center gap-1.5 shadow transition-colors ${
                    isDarkMode
                      ? 'bg-[#7EDEED] hover:bg-[#68c8d8] text-[#1F1F1F]'
                      : 'bg-[#7EDEED] hover:bg-[#68c8d8] text-[#1F1F1F]'
                  }`}
                  title="Ia ultimul cadru din live; fețele sunt deja blurate la edge"
                >
                  <Radio size={13} /> {capturing ? 'se preia din live…' : 'Captură din live'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
