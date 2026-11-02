# Zone alignment (`align.js`)

Port of the removed Python edge's `ml/safesight_ml/align.py`: zones are drawn once on a
**reference frame**, and every few frames the current frame is matched to that reference so
the polygons follow a pan, tilt or zoom. When the match fails, the zones are **unknown** for
that frame and no zone rule fires. A wrong polygon is worse than none.

`align.js` and `features.js` are pure: no DOM, no WASM, no dependency, no model. They are not
wired into the worker yet; this document is the contract for the change that does it.

## API

```js
import { ZoneAligner } from './align.js';

const aligner = new ZoneAligner({
  reference: { data, width, height }, // RGBA pixels the zones were drawn on
  everyN: 5,                          // attempt a match every 5th update (default)
  minInliers: 40,                     // RANSAC inlier floor (default)
});

aligner.referenceFeatureCount; // 0 => the reference has no usable texture
aligner.update(frame);         // true while the view is aligned; false when lost
aligner.alignZones(zones);     // aligned zone copies, or null when lost
aligner.lostUpdates;           // how many match attempts failed
aligner.reset();               // forget transform + cadence (camera/reference change)
```

- `frame` and `reference` are `{ data, width, height }` with RGBA bytes — an `ImageData` is
  already this shape. The aligner downsizes to 640 px wide itself, so a 1080p frame works.
- `update()` validates the frame on every call but only *extracts and matches* every
  `everyN` calls: the calls in between return the last result and keep the last homography,
  exactly like the reference's `(calls - 1) % every_n` check.
- `alignZones()` takes the configured zones (normalized polygons, as `GET /zones` serves
  them), shallow-copies each one and maps only `polygon` through the inverse homography. The
  input is never mutated.
- If `update()` returns `false`, `alignZones()` returns `null`. Do not fall back to the
  configured polygon for that frame: that is the guess the aligner exists to prevent.

## Reference frame

The reference must be the **exact frame the polygons were drawn on**, per camera.

1. Preferred: the zone's `reference_frame_url`. Fetch it, decode with
   `createImageBitmap(await response.blob())`, draw it into an `OffscreenCanvas` at most
   640 px wide and read `getImageData(...)`. The zone editor already shows this image as the
   drawing background, so polygons and reference agree by construction.
2. Fallback for a clip with no uploaded reference: the **first frame** of the clip. Only use
   this when the zones were drawn on that same first frame (the lab/editor demo reference);
   a polygon drawn on a later frame would be mapped from the wrong geometry.
3. No reference at all (webcam, live stream without a stored frame): **do not align**. Keep
   the configured image-space polygons exactly as today. There is no fixed geometry to map
   from, and inventing one would move zones on camera motion the operator never calibrated.

All zones of one camera should share one reference frame. If two zones carry different
`reference_frame_url` values, take the first and log it: two references cannot both define
the same camera geometry.

Reference and stream are normalized independently on x and y, so their resolutions may
differ (e.g. a 1920×1080 snapshot and a 1280×720 stream). Their **aspect ratio must match**,
because the normalized homography assumes the same frame geometry; a cropped or letterboxed
stream invalidates the mapping.

## Worker integration

Reference features are the expensive part (~15 ms at 640×360), so build the aligner once and
cache it, not per frame:

```js
// Module state next to `pipeline` and `overlayZones`.
let aligner = null;
let baseZones = [];

// On `init` / `config` (new camera): rebuild, because the pipeline is rebuilt too.
async function buildAligner(cameraId, zones) {
  baseZones = Array.isArray(zones) ? zones.filter((zone) => zone.camera_id === cameraId) : [];
  const url = baseZones.find((zone) => zone.reference_frame_url)?.reference_frame_url;
  if (!url) {
    aligner = null; // webcam / no stored frame: leave zones as configured
    return;
  }
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const reference = readWorkingImage(bitmap); // 640-wide OffscreenCanvas + getImageData
  aligner = new ZoneAligner({ reference });
  if (aligner.referenceFeatureCount === 0) {
    aligner = null; // untextured reference: alignment would be lost on every frame
  }
}
```

Per frame, right before `pipeline.step`:

```js
const alignedZones = aligner ? (aligner.update(workingImage) ? aligner.alignZones(baseZones) : null) : baseZones;

const result = pipeline.step(detections, nowS, {
  frameWidth: width,
  frameHeight: height,
  vestStates,
  snapshotUrl: SNAPSHOT_PENDING,
  // Per-frame zone list: `null`/`[]` means "tracking only, no zone rule this frame".
  zones: alignedZones ?? [],
});
```

Notes for the worker owner:

- `pipeline.step` does not accept a per-frame `zones` override today. It needs one for this
  wiring; `setZones([])` inside the frame loop is not a substitute, because it mutates the
  configured list and the rule cooldowns on every lost frame. Until that option exists,
  leave alignment off and keep the current behaviour.
- The aligned list is also what the overlay must draw (`drawZones`). When the view is lost,
  draw no zone outline (or the same "unknown" treatment the UI uses for an inactive zone):
  an outline implies the rule is armed.
- One readback is enough: draw the incoming bitmap once into a 640-wide scratch
  `OffscreenCanvas` and `getImageData` from it. That is ~0.9 MB every `everyN` frames, and it
  lets the aligner skip its own downscale of the full-resolution frame.
- `update()` throttles itself. Do not add a second frame counter in the worker.
- Rebuild the aligner (new reference features) when the camera changes or the reference URL
  changes. `reset()` only clears the transform and cadence for the *same* reference.
- Tracking, blur and event building keep running when the view is lost: only the zone rules
  are skipped. A lost alignment must not stop the pipeline.

### Webcam caveat

A webcam has no fixed reference: the operator may move the camera, the room changes, and the
zones were drawn on a frame that no longer exists. Do not enable alignment there. Keep the
image-space polygons (current behaviour) or disable zone rules if the camera is known to
move; do not synthesize a reference from the first webcam frame and silently remap zones on
every motion.

## Algorithm

1. **Grey working image** — box-average RGBA down to at most 640 px wide (`cv2.INTER_AREA`
   equivalent), integer `0.299R + 0.587G + 0.114B` weights.
2. **Scale pyramid** — level 0 at 640 px plus one level shrunk by 1.25 (ORB uses eight levels;
   two are enough for the few percent of motion between attempts, and a larger jump ends as
   "lost").
3. **FAST-9 corners** per level, with a 3×3 non-maximum suppression and at most two features
   per 32 px cell, ~300 descriptors per frame instead of OpenCV's 1500.
4. **Oriented 256-bit BRIEF** — intensity-centroid orientation, a fixed seeded sampling
   pattern, described on a `[1,2,1]`-blurred image, keypoints normalized to 0..1.
5. **Matching** — brute-force Hamming with the reference's Lowe ratio (0.75), a Hamming
   ceiling, and a mutual-best filter (each side must be the other's nearest neighbour).
6. **RANSAC homography** — 4-point normalized DLT, threshold 4/640, minimum 40 inliers,
   fixed seed, adaptive iteration cap. A sample is only scored if it passes the reference's
   `_plausible` checks: finite, `h33` not ~0, 2×2 determinant in 1/16..16, perspective terms
   below 2. The winner is refit by least squares on all inliers.
7. **Chaining** — if the direct reference match fails, the aligner matches the previous
   matched frame and composes the two homographies, as the reference does; the composed matrix
   is plausibility-checked again.
8. **Zone mapping** — the inverse homography maps reference-normalized polygons into the
   current view. Corners may leave the frame after a pan, which is expected; a corner that
   maps to infinity makes the whole frame unaligned.

Lost, i.e. `update() === false` and `alignZones() === null`, whenever:

- the reference or the frame has almost no features (blank wall, lens cap, heavy fog);
- an unrelated frame is matched (cuts, scene change, a different camera);
- fewer than `minInliers` matches survive the ratio/distance/mutual filters;
- the best homography fails a plausibility check (degenerate scale, strong perspective);
- a polygon corner cannot be projected (point at infinity).

No partially guessed polygon is ever returned.

## Measured behaviour

Synthetic 640×360 RGBA scenes, deterministic texture, bilinear warps, Node 26 on the
development machine (`npm run test:unit` includes the same cases):

| Case                          | Max zone-corner error |
| ----------------------------- | --------------------- |
| identity                      | 0.00 px               |
| translation 17/-9 px          | 0.08 px               |
| zoom 1.15×                    | 0.26 px               |
| zoom 1.30×                    | 1.20 px               |
| perspective (corner shifts)   | 0.68 px               |
| combined pan/zoom/roll/tilt   | 0.37 px               |

Cost per update at 640×360, `everyN = 1` (worst case):

| Stage                                   | Median |
| --------------------------------------- | ------ |
| grey + pyramid + FAST + descriptors     | ~9–12 ms |
| Hamming matching + ratio/mutual filter  | ~1.6–2.5 ms |
| RANSAC + refit                          | ~0.4–0.6 ms |
| **total `update()`**                    | **~10–15 ms** (test average ~10 ms, worst observed ~20 ms) |

Reference features are computed **once** in the constructor: ~10–15 ms. With the default
`everyN = 5` the steady-state cost in the worker is therefore ~2–3 ms per processed frame plus
the 640-wide `getImageData` readback. Target was < 30 ms per update.
