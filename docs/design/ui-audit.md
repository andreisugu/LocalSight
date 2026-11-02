# LocalSight — UI/UX design audit

**Date:** 2 November 2026
**Branch:** `prep/design-audit` (worktree `LocalSight-prep/design-audit`)
**Build:** `cd frontend && VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build`
**Served:** `dist/` at `http://127.0.0.1:4399/LocalSight/`, unknown paths return `index.html` with HTTP 404 (GitHub Pages behaviour)
**Browser:** Playwright 1.64.1, Chromium 1248 headless
**Routes:** `/`, `/incidents`, incident detail, `/zones`, `/reports`, `/settings`, `/lab`, `/bench`
**Viewports:** 1400×900, 1024×768, 375×812 — **themes:** dark (default) and light
**Scope:** visual/UX only. No code was changed; the only file added to the repo is this report.

---

## Method and caveats

- Every route was captured at all three viewports in both themes (48 base frames, plus scrolled and state frames). Screenshots live under `/tmp/opencode/design-audit/shots/` and are **not committed**.
- Contrast was not eyeballed: a DOM probe walked every text node, composited the effective background up the ancestor chain (alpha included), and computed the WCAG 2.1 ratio against the actual font size/weight. Non-text boundaries (inputs, cards) were measured against WCAG 1.4.11. Raw data: `/tmp/opencode/design-audit/probe/probe.json` and `probe/targeted.json`.
- Measurements quoted below (feed offsets, overlay coverage, line counts, control sizes) come from that probe on the built app.
- **Font caveat:** the headless audit container has no UI font installed, so the screenshots render every family (including the sans stack) with one substituted fallback face. Letterform and family judgements are therefore excluded; sizes, weights, spacing, hierarchy, colours and geometry come from computed styles and are unaffected. Line-length numbers are computed from rendered px width and character count, not from the fallback face.
- Contrast inside `<canvas>` and `<video>` is out of scope; only DOM chrome was measured.
- Previously reported QA issues (`docs/qa/ui-findings.md`, F1–F14) are not repeated. Sidebar auto-collapse, card keyboard access, disabled report selectors, the operator-name truncation and the zones parameter squeeze were re-checked and are fixed.

### Severity

| Level | Meaning |
|---|---|
| **High** | Breaks reading or the operator loop on a required viewport/theme, or makes an honesty claim false or self-contradictory. |
| **Medium** | Costs scanning speed, hierarchy or consistency; a first-time user notices something is off. |
| **Low** | Polish: alignment, labelling, affordance detail. |

---

## Summary

| Severity | Count |
|---|---|
| High | 8 |
| Medium | 14 |
| Low | 7 |
| **Total** | **29** |

---

## High

| ID | Screen / viewport / theme | What is wrong | Why it matters | Concrete fix (component / class) | Evidence |
|---|---|---|---|---|---|
| **H1** | `/lab` · all viewports · **light** | The empty-state copy inside the media box is `#1F1F1F` on pure black (**1.27:1**), and the status line „se așteaptă un clip" is `#FFEB33` on white (**1.22:1**). Both are effectively invisible. | The only instructions on the page cannot be read in the light theme. This is a hard failure, not a taste issue. | In `LabView`, the media box is a black surface: use fixed light text (`text-slate-300`, `text-slate-400`) instead of `themeStyles.textColor`; replace `badgeColour` literals with theme-aware classes (`text-amber-700 dark:text-[#FFEB33]`, `text-emerald-700 dark:text-emerald-400`). | `shots/evidence-light-lab-empty.png`, `shots/light-1400x900-lab.png` |
| **H2** | Header · all routes · **light** | Three of four header controls are built from white-alpha utilities (`bg-white/10`, `border-white/20`, search `bg-white/5 border-white/10`). On a white header they composite to **1.0:1** and disappear; only the theme button keeps a real surface. | The search field reads as static placeholder text and „Simulare"/operator look like labels. A whole theme loses its control vocabulary. Also violates 1.4.11 (3:1 for component boundaries). | In `Header.jsx`, swap the dark-only alpha utilities for theme pairs: `border-[#E5E7EB] bg-[#F1F5F9] hover:bg-[#E2E8F0] dark:border-white/15 dark:bg-white/10`; same for the search input and the operator button. Better: add `controlBg`/`controlBorder` to `THEME_CONFIG`. | `shots/evidence-light-header.png`, `shots/light-1400x900-live.png` |
| **H3** | Header, sidebar, feed, list · all viewports · **light** | `text-slate-400` (`#94A3B8`) is used for the brand subtitle, „DISPECER", „MODULE OPERAȚIONALE", the Live feed's event IDs and timestamps: **2.56:1** on white (needs 4.5). | These are operational metadata (IDs, times, role), not decoration. They are unreadable for low-vision users and washed out for everyone. | Replace `text-slate-400` with `text-slate-500 dark:text-slate-400` (`#64748B` = 4.76 on white, 5.37 on dark cards) wherever it sits on a light surface. | `shots/evidence-light-header.png`, `shots/light-1400x900-incidents.png` |
| **H4** | Incident detail · 1400 / 375 · both | The `<h2>` is the synthetic id: „Incident: evt_stand12_1700000000000_17", 18px/900 uppercase; at 375 it wraps to three lines. The incident type („Zonă restricționată") appears nowhere in the header, only inside the report body. | The most prominent element on the screen is machine data. An operator cannot identify the case from the title, and on mobile the header consumes ~200px before the first fact. | In `IncidentHeader.jsx`: `<h2>` = `TYPE_LABELS[event.type]` at `text-lg`, and move the id to the existing second line as `font-mono text-[11px] truncate` with a `title`; keep the chips on that row. | `shots/dark-1400x900-detail.png`, `shots/evidence-375-detail-header.png` |
| **H5** | Incident detail · all · both | The report panel is titled „Raport incident (**AI · demo**)", the report screen says „**sursă: șablon**" and „nu este generat de AI", and `README.md` states the incident report is a template, not an LLM. `reportSourceLabel()` returns `AI · demo` for the fixture reports. | The product's core honesty claim contradicts itself on two screens. A reviewer can reasonably conclude the report was model-written. | `utils/incidentDetail.js`: return `'șablon'` when `mock` is true (drop the `AI · demo` branch in the static build); keep the `SOURCE_TITLES` explanation. Align the heading with `/reports`. | `shots/evidence-light-report-heading.png`, `shots/dark-1400x900-reports.png` |
| **H6** | Live stage · all · both | A red dot with `animate-ping` and the label „**LIVE REC**" is drawn on a looped MP4, 30px above a badge that says „ÎNREGISTRARE · DEMO STATIC". | „LIVE REC" is a fabricated live indicator. It is the first thing a viewer reads on the video and it undercuts the otherwise careful demo labelling. | `StageOverlays.jsx` / `HudReadout`: render `LIVE REC` + ping only when `isWebcam`; for clips render „CLIP DEMO · 1080p 30FPS" with a static dot (`bg-slate-500`, no animation). | `shots/dark-375x812-live.png`, `shots/evidence-dark-engine-loading-600ms.png` |
| **H7** | Live · **1024×768** and 1024–1279 · both | The Live grid switches to two columns only at `xl` (1280). At 1024 the incident feed starts at y=**824** in a 704px-tall scroller (at 1279 it starts at 951 in 836); the whole alert surface, including every „Confirmă", is below the fold and the page grows to ~1450px. | The demo/operator loop is „person enters zone → event appears in Live". At the required 1024×768 viewport the event never appears on screen without scrolling; only the KPI number and sidebar count hint that it happened. | `LiveView.jsx`: change `flex-col xl:flex-row` to `lg:flex-row` and give the feed `lg:w-[19rem] xl:w-[24rem] shrink-0`; the stage keeps `flex-1 min-w-0`. Verify the 420px stage at 1024. | `shots/dark-1024x768-live.png`, probe (`feedTop 824 / mainH 704`) |
| **H8** | Live, webcam error · all · both | With `CAM-LOCAL` selected and `getUserMedia` failing, the stage keeps showing the previous CAM-01 clip as a dimmed, frozen backdrop under the error card, still prints „LIVE REC / 720p", and the footer says „SURSĂ: camera acestui dispozitiv" — while the card says no camera is available. | Three labels contradict the error at once, and the looped demo footage can be read as the visitor's own camera. This is the state a reviewer with no webcam (or a denied permission) sees. | `MediaStage`: when `isWebcam && webcam.state === 'error'`, render the error card on an opaque surface (`bg-black`, no video node) and hide `HudReadout`/`CameraFooter` or replace their copy with the error state. | `shots/evidence-dark-webcam-error.png` |

---

## Medium

| ID | Screen / viewport / theme | What is wrong | Why it matters | Concrete fix (component / class) | Evidence |
|---|---|---|---|---|---|
| **M1** | All screens · 1400 · both | Eight text sizes are in use (9, 10, 11, 12, 14, 18, 20, 24px) with 1px steps between 9–12. On Live, 54 elements are under 11px; on Settings, 77 are exactly 11px. Chips are 9px (`CRITICAL`, `Deschis`, `Escaladat`), uppercase labels 10px. | 1px steps do not read as hierarchy, only as noise; 9px status text is below comfortable reading and drives several contrast failures. | Collapse to five steps: 10px uppercase tracking labels, 12px body/meta, 14px card titles, 18px page title, 24px KPI. Merge 9→10 and 11→12 (`text-[10px]`, `text-xs`, `text-sm`, `text-lg`). | probe `scale` output; `shots/dark-1400x900-live.png` |
| **M2** | `/reports` · 1400 · both | The executive summary is one 453-character paragraph at 12px across **1070px**, i.e. ~110–150 characters per line over four lines. | The shift report is the deliverable an operator reads aloud or prints; 110+ characters per line is roughly double a comfortable measure and makes the summary hard to track. | `ReportsView.jsx` summary `<p>`: `max-w-[68ch] text-[13px] leading-relaxed`; keep the panel full width but the text column narrow, or split into 2–3 sentences as separate lines. | `shots/evidence-dark-report-summary.png` |
| **M3** | `/`, `/reports`, `/settings`, `/incidents` · all · **light** | `appBg`, `panelBg` and `cardBg` are all `#FFFFFF`; card boundaries are a 1px `#E5E7EB` border (**1.24:1**). Panels and page are the same surface. | In light mode the card system collapses: grouping depends on a border that is barely visible, and KPI/panel blocks float without elevation. Dark mode has a real 3-step surface ramp. | `theme/palette.js`: set light `app: '#F8FAFC'`, keep `panel/card: '#FFFFFF'`; or keep white panels and give them `shadow-sm` + `border-slate-200`. One token edit, no component change. | `shots/light-1400x900-live.png`, `shots/light-1400x900-reports.png` |
| **M4** | Incident detail + `/reports` · all · both | Detail: four 253×38 buttons with four different fills (green, navy, navy, pale red) and no primary. Reports: „Export CSV" (green) and „Export PDF" (red) are equal-weight filled buttons. In light mode „Fals Pozitiv"/„Redeschide" stay dark navy — dark-theme leftovers. | With four equal choices the operator has to read every label; the destructive-looking red PDF button attracts the eye more than the report itself. | `DecisionPanel.jsx`: keep `Confirmă` filled (emerald-700) as the only primary; make `Fals Pozitiv`/`Redeschide` outlined with theme tokens (`border-[#E5E7EB] text-[#1F1F1F] dark:border-white/15 dark:text-slate-200`); make `Export PDF` a quiet text/outline button. `ReportsView`: CSV outline, PDF filled. | `shots/evidence-light-decision-panel.png`, `shots/light-1400x900-detail.png` |
| **M5** | Live, detail, reports · both | Label contrast fails AA: KPI values „4" and „1.3s" = `amber-500` on white **2.15:1**; „Confirmă" = white on `emerald-600` **3.77:1**; „Export PDF" = scarlet on 20% scarlet **2.68:1** (dark) / **3.48** (light); „Cronologie eveniment" **2.95:1**; „Rezumat Executiv Tură" **3.16:1** (scarlet on panel). | These are the numbers and action labels an operator scans under time pressure; all miss AA for their size. | `text-amber-700 dark:text-[#FFEB33]` for KPI values (5.02 on white); `bg-emerald-700` for the ack (5.48); „Export PDF" = `bg-[#D73833] text-white` (4.66) or `text-[#B91C1C] dark:text-[#FF8A80]` on transparent; section headings `text-[#B91C1C] dark:text-[#FF8A80]` instead of `#D73833` on dark. | probe contrast; `shots/light-375x812-live.png`, `shots/evidence-light-decision-panel.png` |
| **M6** | Live feed vs incident list · both | Two chip implementations exist. The list uses `STATUS_TOKENS` (light CRITICAL = **7.60:1**); the Live feed hardcodes `bg-red-50 text-[#D73833]` (**4.26:1**) and escalated `bg-red-100 text-[#D73833]` (**3.82:1**). Detail adds a third style (`ProvenanceChip`, 10px). | The same state is rendered three ways at 9–10px; the feed — the screen that matters most — is the one that fails AA. | `IncidentFeedCard.jsx`: render `STATUS_TOKENS[...]` through the same `TokenBadge` used by `IncidentsListView`; one chip component at a 10px minimum. | `shots/evidence-dark-escalated-card.png`, `shots/light-1400x900-live.png` |
| **M7** | All screens · both | Demo provenance has at least eight vocabularies and placements: `date demo` (KPI, feed, detail), `sursă: șablon` (reports header), `șablon` (summary), `demo: un singur raport disponibil` (reports scope), `BUILD STATIC · DATE DEMO` (settings), `● DEMO` (camera table), `ÎNREGISTRARE · DEMO STATIC` (stage), `Ultimele 8 incidente: fixture-uri demo…` (list footer). On `/incidents` there is no chip at all — the only cue is an 11px footer below 8 rows (off-screen at 375). The KPI chip floats right-aligned above the 4th card and reads as belonging to „Escaladate". Most explanations exist only in `title` attributes, which touch users cannot open. | The honesty system is the product's differentiator; when each screen invents its own label, a viewer cannot learn the convention or trust that an unlabelled block is real. `date demo` light is also 4.47:1 (borderline). | One `DemoDataChip` (label `date demo`, `text-[11px]`) rendered in the same slot — the page-header meta line — on `/`, `/incidents`, `/reports`, `/settings`; keep `local` as the only other provenance chip; move the tooltip text into visible microcopy (one line), not only `title`. | `shots/evidence-light-kpi-chip.png`, `shots/light-1400x900-incidents.png`, `shots/light-1400x900-settings.png` |
| **M8** | Live, detail, zones · 375 · both | Tap targets are desktop-sized: feed „Confirmă" 89×**25**, feed filters 117×**25**, toolbar 85×25, zones chips 127×27, „Desenează din nou" 161×26. 13 controls on Live are under 32px. | A phone operator mis-taps the ack or the engine switch; 25px is just over half the 44px touch guidance. | Set a floor on interactive elements: `min-h-[32px]` for dense chrome, `h-11` (44px) for the ack and primary actions; on `max-sm`, raise `py` of the feed filters and toolbar to `py-2`. | probe `controls`; `shots/dark-375x812-live.png`, `shots/evidence-375-zones.png` |
| **M9** | Live, sidebar, KPI · all · both | **Nine elements animate continuously** on the default Live screen (2 escalated fixtures): both cards `animate-pulse`, both status chips `animate-bounce`, the „Escaladate" KPI icon pulses unconditionally (`KpiStrip.jsx:44`), the sidebar dot pulses, „LIVE REC" pings, the idle engine dot pulses, and `MOTOR: ON` pulses as a static state. No `prefers-reduced-motion` / `motion-reduce` anywhere. | Perpetual motion competes for attention, cannot signal „new" because everything is already pulsing, and is an accessibility problem. One escalated card gets three simultaneous emphases. | Keep one emphasis per escalated card (border/ring only), remove `animate-bounce` from the status chip, gate the KPI pulse on `kpis.escalated > 0`, make `MOTOR: ON` and the idle engine dot static, and add `motion-reduce:animate-none` globally. | `shots/evidence-dark-escalated-card.png`; DOM probe: 9 elements with `animation-name != none` |
| **M10** | Live · 1400 · both | Starting the browser engine replaces the stage with a full black rectangle showing one centered 10px `text-slate-400` line („se pregătește — fluxul brut rămâne ascuns…"); the „LIVE REC" dot keeps pinging. This lasts the 28 MB WASM + 10 MB model load, well over 2.5 s on first visit. | For the first seconds of the demo the primary pane looks broken, and the smallest text on screen is the only explanation. | `EngineOverlayBadges`: raise the copy to `text-xs`, add a small spinner/indeterminate bar, and state the expected duration („poate dura 5–10 s prima încărcare"); hide the REC dot while `engine.status !== 'running'`. | `shots/evidence-dark-engine-loading-600ms.png`, `shots/evidence-dark-engine-loading-2400ms.png` |
| **M11** | All screens · 1400 · both | Component and page rhythm drift: page padding `p-3/md:p-4` (Live) vs `p-4/md:p-6` (all others) vs `p-6` (Lab); max width `6xl` (Incidents/Detail/Reports/Bench) vs `5xl` (Settings) vs full-bleed (Live/Zones); page title 18px vs 20px, and Live has no title at all; panel radius 12px in the product but 4px (`rounded`) in Lab/Bench; shadow `sm` vs `lg` on sibling panels. Header left edges shift by up to 64px between routes. | Navigation feels like moving between different products; the eye re-learns the grid on every click. | Standardise: `<main>` wrapper `p-4 md:p-6`, `max-w-6xl mx-auto`, `h2` = `text-lg font-black uppercase`; panels `rounded-xl border shadow-sm p-4`; use `rounded-lg` in Lab/Bench instead of `rounded`. | `shots/dark-1400x900-settings.png`, `shots/dark-1400x900-lab.png`, `shots/dark-1400x900-live.png` |
| **M12** | `/reports` charts · 1400 / 375 · both | „Distribuție pe tipuri" draws two full-width bars (4/4 and 4/4) 12px tall with no axis or scale, so both look like 100% progress bars; „Incidente pe oră" is 4 bars in a ~540px panel with no y-axis, 10px tick/caption, and one 28px max bar width, leaving most of the panel empty. | The charts cannot be compared at a glance, and the by-type panel reads as decoration rather than data. | `ReportsView.jsx`: label each bar with `count` and `% of total`, set a fixed 6px track radius and a 0–max caption; give the hourly chart a baseline, a max tick and `min-w-[36px]` bars; raise ticks to 11px. | `shots/dark-1400x900-reports-bottom.png` |
| **M13** | `/zones` · 375 · both | On a 343×193 frame the instruction pill is 288×47 and the floating red „Desenează din nou" button is 161×26, so **27% of the frame is covered by chrome**; the pill also sits over the polygon's top edge and the button over its bottom-right. Zone handles are 8px. | The editor's whole job is seeing the polygon on the frame; on a phone the overlays hide it and the handles are too small to drag accurately. | Move the instruction into the toolbar/help line above the canvas; move „Desenează din nou" into the toolbar next to „Forme"; set handles to 12px on touch (`sm:` keeps 8). | `shots/evidence-375-zones.png`, `shots/dark-375x812-zones.png` |
| **M14** | `/reports` · 375 · both | The PPE/escalation strip collapses into a broken reading order: „Incidente fără PPE" + 4 on the left, „Escalate" + 2 pushed to the far right, then „Cu confirmare" on a second row with 4 under the left column. Values no longer sit under their labels. | On the smallest viewport the three counts are ambiguous — exactly the numbers a supervisor scans. | `StatusStrip`: replace `flex justify-between` with `grid grid-cols-3 gap-4` (labels above values, consistently aligned) and keep the explanatory note `col-span-3`. | `shots/dark-375x812-reports.png` |

---

## Low

| ID | Screen / viewport / theme | What is wrong | Why it matters | Concrete fix | Evidence |
|---|---|---|---|---|---|
| **L1** | Header · all · both | „Simulare", theme and operator are three equal-weight bordered/filled buttons; at 375 „Simulare" collapses to a lightning bolt + chevron with no text. | The three controls read as peers, and the icon-only trigger is not self-explanatory on a phone. | Keep „Simulare" as the only filled control; make the theme a quiet icon button; keep the operator avatar; at `<sm` show a short label or rely on `aria-label` + a one-time hint. | `shots/light-375x812-live.png` |
| **L2** | Live toolbar · all · both | The camera selector prints the code twice: „CAM-01 — CAM-01 · Stand 12 — apron", which truncates the useful part („Stand 12 — a…") at 375. | Duplicated content crowds the most-used control and hides the camera name. | `CameraToolbar`: build the option label as `{code} · {name}` once; keep the zone in the option only if it differs. | `shots/dark-375x812-live.png` |
| **L3** | Live feed header · all | The incident count is a solid yellow circle (`rounded-full bg-[#FFEB33]`) at the panel's top-right and looks like a button that would open a list. It is not interactive. | False affordance: users click it, nothing happens. | Render the count as a neutral text chip next to the title (`text-xs font-mono px-1.5 rounded bg-white/10`), or make it filter to all incidents. | `shots/light-1400x900-live.png` |
| **L4** | `/bench` · 1400 / 375 · both | The user-agent block is centered (`max-w-[360px] … text-center`), so it wraps mid-token („Safari/537.36" splits) and reads as a poem, not metadata. | This is a diagnostic page; the UA should be scannable. | `BenchView.jsx`: `text-left break-words` (or `truncate` with `title`), 10px, `text-slate-500`. | `shots/light-375x812-bench.png` |
| **L5** | `/incidents` · 1400 · both | The incident column is 615px wide and the „CAMERĂ" column starts at x≈990 while the row text ends around x≈650: ~340px of empty space in every row. „DETECTAT" is pushed to the far right. | The row reads as two disconnected blocks and the eye travels unnecessarily across the dead band. | `IncidentsListView`: narrow the incident column to `minmax(0,1fr)`, set camera to `8rem` and timestamp to `7rem`, or add a trailing meta column (zone / type) to use the space. | `shots/dark-1400x900-incidents.png` |
| **L6** | `/lab`, `/bench` · all · both | Both pages use a different visual language: `rounded` (4px) controls, `p-6` hard-coded, inline colours, no panel tokens. | They are still part of the product chrome; the jump is noticeable when a reviewer opens `/bench`. | Replace `rounded` with `rounded-lg`, `p-6` with `p-4 md:p-6`, and read surfaces from `style={{ backgroundColor: themeStyles.panelBg }}` like every other panel. | `shots/dark-1400x900-bench.png` |
| **L7** | Empty states · 1400 / 375 · both | Mixed quality: `/incidents` empty state leaves the table header and a 150px void; `/lab` renders an empty `<canvas>` at its default 300×150 ratio stretched to **1112×556** of pure black, with the CTA three lines above it; `/bench` history empty is a 10px 50%-opacity row. `/reports` empty cannot be reached in the mock build (already noted in QA). | Empty and loading states are what a first-time reviewer sees most often on a static demo. | `/incidents`: center the message and hide the table header when `rows.length === 0`; `/lab`: render a `aspect-video max-h-[420px]` placeholder instead of the default-ratio canvas; `/bench`: `text-xs opacity-60 py-6`. | `shots/evidence-light-incidents-empty.png`, `shots/evidence-light-lab-empty.png` |

---

## Honesty labels — evaluation

The task names three labels. What they do today:

| Label | Where | Size / treatment | Contrast | Verdict |
|---|---|---|---|---|
| `date demo` | KPI strip, Live feed title, detail header | 10px amber chip, 3 different positions | 4.47:1 light, 8.02 dark | Right idea, wrong placement: detached from what it labels, absent from `/incidents` header, and only explained via `title` (unusable on touch). |
| `local` | Feed, list, detail (detail says „detecție locală") | 10px cyan chip | 5.02:1 light, 7.42 dark | Contrast passes and the meaning is right, but the label text differs between screens for the same concept. |
| `sursă: șablon` / `șablon` | Reports header and summary | 10px gray tag | 6.92:1 light, 7.66 dark | Passes, but at 10px it is the smallest text on the page, and „șablon" is unexplained without hovering. It is also contradicted by „AI · demo" on the detail screen (H5). |

Two further problems cut across all three:

1. **Vocabulary sprawl (M7):** `date demo`, `șablon`, `DEMO`, `STATIC`, `BUILD STATIC · DATE DEMO`, `ÎNREGISTRARE · DEMO STATIC`, `fixture-uri demo`, `demo: un singur raport disponibil`. A viewer cannot learn the convention.
2. **Tooltips as the only explanation:** `DemoDataChip`, the `local` chip, `SourceTag` and the report source all put their explanation in a `title` attribute. On a 375px touch screen those are unreachable, so the honesty text is effectively desktop-only.

**Recommendation:** one chip component, one label vocabulary (`date demo`, `local`, `sursă: șablon`), always in the page header meta line, each with one visible sentence (not a tooltip) where it is first used. This closes M7 and reduces the surface that H5/H6 expose.

---

## What works

- **The real/demo boundary is taken seriously.** The sidebar card says exactly what runs („YOLO26n + tracker local… Blur YuNet în tab · fără backend sau edge"), the camera table says „Clip demo" per row, and the report footer says „Text compus din cifrele raportului; nu este generat de AI." The failure is consistency, not intent.
- **Empty and error states are written, not blank.** „Niciun incident pentru filtrul ales.", „niciuna pe camera asta — creează una", the engine-off overlay that explains why boxes do not follow the video, the webcam permission/error cards, the report empty state. No invented zeros.
- **Focus is visible where it matters.** The search field keeps a 2px yellow ring, feed cards have a focus-visible outline, and `main` receives focus on route change.
- **Mobile navigation is solved.** The rail starts collapsed below 640px, opens as an overlay with a backdrop, and closes after choosing (QA F3 fixed).
- **No horizontal overflow** on any route at 375 except the Bench history table, which is inside `overflow-x-auto` and scrolls deliberately.
- **Numbers are set in mono/tabular, timestamps right-aligned** in the list, KPI values 20–24px — the data layer is easy to scan once the type scale is fixed.
- **The incident detail timeline and evidence panel are well composed at 1400 and 1024**: evidence left, report right, decision panel below, caption „Momentul incidentului · fețe blurate" attached to the image.
- **The ack loop gives real feedback**: the toast names the event („Evenimentul 000_17 confirmat de Dispecer. Escaladare anulată."), the KPI drops, and the card leaves the „Deschise" filter.
- **Print styles exist** for the incident and the report, so „Export PDF" is not a dead button.

---

## Top 5 fixes by effort / impact

| # | Fix | Closes | Effort | Why it is worth it |
|---|---|---|---|---|
| **1** | **Theme-aware text and status colours** — replace `text-slate-400` with `text-slate-500 dark:text-slate-400`; remove `#FFEB33`/`#33E1FF` text on white in `/lab` and `/bench`; use emerald-700/amber-700 for status text in light. | **H1, H3** (plus the light-theme half of M5/M6) | **S** — ~15 class/inline colour edits, no markup change | Turns an unreadable light theme into a passing one across every route; immediately visible in side-by-side screenshots. |
| **2** | **Header control tokens** — swap the white-alpha utilities for theme pairs (borders `#E5E7EB`/`white/15`, fills `#F1F5F9`/`white/10`) on search, Simulare and operator. | **H2** | **S** — 3 class strings + 1 optional token pair | Restores the primary navigation affordances in light mode on every screen. |
| **3** | **Honesty and error-state copy pass** — `reportSourceLabel` returns `șablon` in mock; detail heading matches `/reports`; „LIVE REC" becomes „CLIP DEMO" on recorded sources; the webcam error hides the stale stage chrome. | **H5, H6, H8** | **XS** — two conditionals, one label and one `isWebcam`-gated block | Removes the three self-contradicting claims in a product whose selling point is honesty. |
| **4** | **Detail title hierarchy** — `TYPE_LABELS[event.type]` as the `<h2>`, event id demoted to a truncated mono line. | **H4** | **S** — one component, one row | Makes the incident identifiable at a glance and removes three lines of header on mobile. |
| **5** | **One chip system + action colours** — feed/list/detail all render `STATUS_TOKENS` at 10px; `Confirmă` on emerald-700; `Export PDF` solid scarlet or outline. | **M5, M6** (and M4 partially) | **S** — reuse the existing `TokenBadge`, two class swaps | Fixes the only AA failures on the alert feed and makes the primary action unambiguous. |

**Runners-up (each a one-line change):** cap the report summary at `max-w-[68ch]` (**M2**), and switch the Live grid to `lg:flex-row` so the feed is visible at 1024 (**H7**).

---

## Appendix — measured contrast pairs

Ratios computed from the composited DOM colours (WCAG 2.1, AA thresholds: 4.5 normal / 3.0 large).

| Pair | Ratio | Needs | Where |
|---|---|---|---|
| `#1F1F1F` on `#000000` | **1.27** | 4.5 | `/lab` empty media text (light) |
| `#FFEB33` on `#FFFFFF` | **1.22** | 4.5 | `/lab` status (light) |
| `#33E1FF` on `#FFFFFF` | **1.57** | 4.5 | `/bench` status value (light) |
| `rgba(255,255,255,0.2)` on `#FFFFFF` | **1.00** | 3.0 | header control borders (light) |
| `#F59E0B` on `#FFFFFF` | **2.15** | 3.0 | KPI „4" / „1.3s" (light) |
| `#94A3B8` on `#FFFFFF` | **2.56** | 4.5 | feed meta, header subtitle (light) |
| `#D73833` on `#D73833`/20 over `#282828` | **2.68** | 4.5 | „Export PDF" (dark) |
| `#D73833` on `#2D2D2D` | **2.95** | 4.5 | „Cronologie eveniment" (dark) |
| `#D73833` on `#282828` | **3.16** | 4.5 | „Rezumat Executiv Tură" (dark) |
| `#D97706` on `#FFFFFF` | **3.19** | 4.5 | „Detalii Incident", warning values (light) |
| `#FFFFFF` on `#059669` | **3.77** | 4.5 | „Confirmă" |
| `#D73833` on `#FEE2E2` | **3.82** | 4.5 | escalated chip, Live feed (light) |
| `#D73833` on `#FEF2F2` | **4.26** | 4.5 | CRITICAL chip, Live feed (light) |
| `#B45309` on `#FEF0DA` | **4.47** | 4.5 | `date demo` chip (light) |
| `#64748B` on `#FFFFFF` | 4.76 | 4.5 | muted body (light) — passes |
| `#E5E7EB` on `#FFFFFF` | **1.24** | 3.0 | card boundary (light) |
| `#FFFFFF` on `#D73833` | 4.66 | 4.5 | white on scarlet — passes |
| `#FF8A80` on `#282828` | 6.46 | 4.5 | critical text (dark) — passes |
| `#FFEB33` on `#282828` | 12.06 | 4.5 | lemon on panel (dark) — passes |

---

## Screenshot set

Not committed. Location: `/tmp/opencode/design-audit/shots/`.

- 48 base frames: `{dark|light}-{1400x900|1024x768|375x812}-{live|incidents|detail|zones|reports|settings|lab|bench}.png`, plus `-bottom` frames for the scrolled reports/settings/bench.
- State and evidence frames: `evidence-light-lab-empty.png`, `evidence-light-header.png`, `evidence-light-decision-panel.png`, `evidence-light-report-heading.png`, `evidence-light-kpi-chip.png`, `evidence-light-incidents-empty.png`, `evidence-dark-report-summary.png`, `evidence-dark-escalated-card.png`, `evidence-dark-engine-loading-600ms.png`, `evidence-dark-engine-loading-2400ms.png`, `evidence-dark-ack-toast.png`, `evidence-dark-webcam-error.png`, `evidence-375-detail-header.png`, `evidence-375-zones.png`.
- Raw probe data: `/tmp/opencode/design-audit/probe/probe.json`, `probe/targeted.json`.
