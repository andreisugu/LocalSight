# LocalSight — accessibility audit (evidence report)

**Scope:** the shipped static build in `frontend/`, Romanian UI, dark (default) and light themes, all routes.
**Branch:** `prep/a11y-audit` · **Audited commit:** `ad05128a5ee2f7285ab970be3cc486a6edddb5b4` (merge of `prep/geometry-config` into `main`)
**Date:** 2 November 2026 · **Auditor:** QA agent (read-only; no app code changed)

## Build, serve, tooling

```bash
cd frontend
VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build   # exact pages.yml build
# served at http://127.0.0.1:4343/LocalSight/ by a throwaway static server in /tmp
```

The test server mirrored GitHub Pages: `dist/` mounted at `/LocalSight/`, unknown paths return
`index.html` with HTTP 404, and COOP/COEP headers were sent so the engine ran with 4 WASM threads.
`coi-serviceworker.js` was not needed in this setup (the document was already cross-origin isolated).
The first-visit service-worker reload was therefore not exercised; it is a one-time reload and has no
accessibility surface of its own.

| Tool | Version | Use |
|---|---|---|
| Playwright (repo devDependency, Chromium) | 1.64.1 / Chromium 1248 | keyboard, focus, layout, screenshots |
| axe-core (installed in `/tmp`, **not** added to the repo) | 4.10.2 | WCAG 2.0/2.1/2.2 A+AA + best-practice rules |
| pngjs (`/tmp` only) | 7.0.0 | pixel-diff for focus indicators |
| CDP `Accessibility.getFullAXTree` | Chromium 1248 | accessible names |

Viewports: **1440×900** (desktop), **640×450** (1280×900 at 200 % zoom), **375×812** (phone),
**320×800** (reflow). Themes were switched with the app's own toggle
(`localStorage['localsight.theme'] = 'light' | 'dark'`, default dark).

Raw evidence (axe JSON, tab logs, screenshots) was written to `/tmp/opencode/a11y/` and is **not**
committed: the deliverable is this file. Each finding below quotes the decisive number so the report
stands alone; the Appendix lists how to reproduce it.

---

## Summary

| Severity | Count | IDs |
|---|---:|---|
| Critical | 1 | A1 |
| High | 6 | A2–A7 |
| Medium | 10 | A8–A17 |
| Low | 5 | A18–A22 |
| **Total** | **22** | |

The single blocking defect is the false-positive dialog: it is declared `aria-modal="true"` but focus
never enters it, Tab walks the page behind it, Escape does nothing, and closing it drops focus on
`<body>`. Everything else degrades or excludes a group of users but does not make a flow impossible.

**Route-level axe result** (violations / nodes):

| Screen | Dark | Light |
|---|---|---|
| Live `/` | contrast 9 · `definition-list` 1 · `dlitem` 8 · `nested-interactive` 4 | contrast 29 + the same 3 structural |
| Incidents `/incidents` | contrast 1 | contrast 3 |
| Incident detail | contrast 6 · `heading-order` 1 | contrast 14 · `heading-order` 1 |
| Zones `/zones` | contrast 2 | contrast 6 (+ `label` **critical** when the JSON panel is open) |
| Reports `/reports` | contrast 2 | contrast 3 |
| Settings `/settings` | contrast 1 | contrast 11 |
| Lab `/lab` | 0 | contrast 7 |
| Bench `/bench` | contrast 9 | contrast 17 |

---

## Findings

Severity is impact on a real operator task, not axe's label. "Live" means `/`.

| ID | Sev. | WCAG | Screen | Steps | Expected / observed | Evidence |
|---|---|---|---|---|---|---|
| **A1** | **Critical** | 2.4.3 Focus Order · 2.1.2 No Keyboard Trap (converse) · 2.4.7 Focus Visible · 4.1.2 | Incident detail → **Fals Pozitiv** | Open an incident → click/tap **Fals Pozitiv** → press Tab 8×, then Escape, then **Anulează** | **Expected:** focus moves into the dialog, Tab cycles inside it, Escape closes it, focus returns to the trigger.<br>**Observed:** focus stays on the trigger *behind* the overlay; the first Tab lands on **Export PDF** behind the modal, then on the rest of the page; Escape leaves the dialog open (`[role=dialog]` count = 1); after **Anulează**, `document.activeElement` is `<body>`. The background is not `inert`/`aria-hidden`, so `aria-modal` is a false promise. | `keyboard.json` → `dialogOpen.active = {tag:button,label:"Fals Pozitiv"}`, `dialogFocusInside=false`; `dialogTabs` = Export PDF (outside), textarea, Anulează, Trimite, **BODY**, header…; `dialogEscape.stillOpen=true`; `dialogAfterCancel.active.tag="BODY"`. Screenshot `dialog.png` shows focus left on the dimmed trigger. |
| **A2** | High | 1.4.3 Contrast (Minimum) | All routes, **light theme** | Toggle theme to light → inspect header subtitle, section labels, KPI strip, incident metadata, sidebar subtitles | **Expected:** ≥ 4.5:1 normal text, ≥ 3:1 large text.<br>**Observed:** 29 contrast nodes on Live, 14 on detail, 17 on Bench, 11 on Settings (axe). Repeated offenders: `text-slate-400` `#94A3B8` on `#FFFFFF` = **2.56:1** (header subtitle, "Module Operaționale", sidebar subtitles, detail labels); KPI amber `#F59E0B` on white = **2.14:1** at 24 px (still below the 3:1 large-text floor); incident metadata = 2.02–3.12; "Detalii Incident" amber = 3.18; Bench labels at `opacity-50` = 3.23. | axe `color-contrast` (light): Live 29 nodes incl. `.sm:block.font-medium.tracking-wide` 2.56, `.text-xl…text-amber-500` 2.14, `dd[title="FPS necunoscut"]` 2.53; detail 14; bench 17. Computed: `#94A3B8/#FFFFFF = 2.56`. |
| **A3** | High | 2.4.7 Focus Visible · 1.4.11 Non-text Contrast | Inputs, camera select, feed cards (both themes) | Keyboard-Tab to the header search, camera `<select>`, a feed card, the dialog textarea | **Expected:** a focus indicator with ≥ 3:1 against its adjacent colour.<br>**Observed:** light theme draws the brand yellow `#FFEB33` ring on white = **1.22:1** (search, camera select, zone inputs, dialog textarea); the feed card uses `outline-[#33E1FF]` on white = **1.56:1**; the Standard/Split mode control measures ≈2.78:1. The same rings pass in dark (`#FFEB33` on `#282828` = **12.06:1**; cyan = **9.38:1**). | `focus-keyboard.json`: light `search-input` ring `rgb(255,235,53)` vs `rgb(255,255,255)` = 1.22; `feed-card` 1.56; dark equivalents 12.06 / 9.38; `mode-standard` 2.78. Pixel crops `shots/focus/light-select-on.png`, `light-card-on.png`. |
| **A4** | High | 2.4.7 · 2.4.3 · 2.4.11 Focus Not Obscured (Minimum) | ≤ 639 px, collapsed sidebar | 375×812 → press Tab until you pass the header (stops 22–27) | **Expected:** controls hidden by the collapsed rail leave the tab order, or the rail is a real drawer with focus inside it.<br>**Observed:** `aside` has `width: 0`, yet six controls stay focusable at negative coordinates: Live (`x=-4`), Incidente, Configurare Zone, Rapoarte Tură, Sistem & Audit, Restrânge Meniul (`x=-2, 16×34`). Focus is invisible for six consecutive Tab presses. | 375 px tab log in `state`/`reflow.json`: stops 22–27 `@-4,y` and `@-2,768`, `asideW=0`; visible focus resumes only after the document wraps. |
| **A5** | High | 4.1.2 Name, Role, Value · 1.3.1 Info and Relationships · 2.4.6 | Live incident feed | Tab through the "Incidente Detectate" list | **Expected:** the card and its **Confirmă** button are two separate controls; the card's name includes severity/description.<br>**Observed:** `<div role="button" tabindex="0" aria-label="Deschide incidentul evt_…">` **contains** `<button>Confirmă</button>` (axe `nested-interactive`, 4 nodes). Because of `aria-label`, the accessible name is only the raw id: a screen-reader user tabbing the feed does not hear "CRITICAL", the description or the camera, and the four acknowledge buttons are all named exactly "Confirmă". | axe Live: `nested-interactive` ×4 (`div[role=button]` with focusable descendant). AX tree: `name:"Deschide incidentul evt_stand12_1700000000000_17"`; four `{role:"button",name:"Confirmă"}`. |
| **A6** | High | 2.2.2 Pause, Stop, Hide · 2.3.3 Animation from Interactions · 1.4.3 | Live + detail, `prefers-reduced-motion: reduce` | Emulate reduced motion, load Live, count running animations | **Expected:** pulse/bounce/ping/spin reduced or removed.<br>**Observed:** **9** elements keep infinite animations: 6× `pulse` 2 s (both escalated cards, the MOTOR button, the pipeline dot, the sidebar escalation badge and a KPI icon), 2× `bounce` 1 s on the "Escaladat (Urgență)" chips, 1× `ping` 1 s; the built CSS contains **0** `prefers-reduced-motion` rules. Worse, `pulse` is `@keyframes pulse{50%{opacity:.5}}` applied to the whole escalated card, so its text drops below AA for half of every cycle — axe measured 4.04 / 3.76 (dark) and 3.18 / 2.90 (light) on elements that pass when static. | `reflow.json → reducedMotion`: `reduceMatches=true`, 9 animated nodes, `mqRules=0`; built CSS `@keyframes pulse{50%{opacity:.5}}`; axe dark Live nodes with `#d5776f/#462c2b = 4.04`. |
| **A7** | High | 3.3.2 Labels or Instructions · 4.1.2 · 1.3.1 | Zones → **JSON** panel | `/zones` → click **JSON** → inspect the textarea | **Expected:** a visible or programmatic label.<br>**Observed:** the `<textarea>` has no `<label>`, no `aria-label`, no `aria-labelledby`; the caption "Coordonate normalizate (JSON)" sits in a sibling `<span>`. axe reports `label` (impact **critical**) the moment the panel opens. This is the keyboard/screen-reader path for polygon geometry, so the one non-pointer editor is unnamed. | axe `zones-json-open`: `label` critical ×1 on `textarea`; `shots/zones-json-open.png`. |
| **A8** | Medium | 1.4.3 | Dark theme (default): Live, detail, reports, header | Inspect primary buttons and section headings | **Expected:** ≥ 4.5:1 at 11–12 px.<br>**Observed:** **Confirmă** white on `emerald-600 #059669` = **3.76:1** (feed and detail); **Export PDF** `#D73833` on `#4B2B2A` = **2.68:1**; "Decizia operatorului" h4 `#D73833` on `#2D2D2D` = **2.95:1**; Reports h3 = **3.16:1**; active-nav subtitle `#F7D7D6` on `#D73833` = **3.47:1**; timeline "SEVERITATE & RISC" red = **3.91:1**; dialog **Trimite Feedback** white on amber-600 = **3.18:1**. | axe dark: Live 9 nodes, detail 6, reports 2; `dialog-open` run: Submit 3.18. Computed confirm 3.77, Export 2.68, h4 2.95, h3 3.16. |
| **A9** | Medium | 1.4.11 Non-text Contrast | Form controls, both themes | Inspect search, camera select, zone inputs, dialog textarea | **Expected:** component boundary ≥ 3:1 against adjacent colour.<br>**Observed:** light-theme inputs are white on white with `#E5E7EB` border = **1.24:1**; zone inputs use `#CBD5E1` = **1.48:1**; dark inputs use `rgba(255,255,255,.10)` ≈ **1.36:1**. The field is only identifiable by its placeholder text. | `contrast.json`: `light/search-input.borderRatio=1.24`, `light/incidents-search=1.24`, `dark/search-input=1.36`, zone `#CBD5E1=1.48`. |
| **A10** | Medium | 4.1.2 · 1.3.1 | Incidents → status filters | Focus "Toate", press ArrowRight; inspect attributes | **Expected:** either toggle buttons, or a complete tabs pattern (roving `tabindex`, `aria-controls`, `role=tabpanel`, arrow keys).<br>**Observed:** `role="tablist"` + four `role="tab"`, but **no** `tabpanel`, **no** `aria-controls`, all tabs are in the tab order, ArrowRight does nothing. AT announces "tab 1 of 4, selected" for what are filters. | `interactions2.json`: `tabpanel=0`, `aria-controls=null`, `tabindex=null`, focus unchanged after ArrowRight. |
| **A11** | Medium | 1.3.1 | Live → "Motor & senzori" card | Inspect the metrics grid | **Expected:** a valid description list.<br>**Observed:** `<dl>` → `<div>` (MetricCell) → `<div>` → `<dt>/<dd>`. HTML allows one grouping `<div>` directly containing term/description, not a nested one, so axe reports `definition-list` ×1 and `dlitem` ×8; the term/definition pairing is lost in the accessibility tree. | axe Live: `definition-list` and `dlitem`; DOM `dl > div > div > dt`. |
| **A12** | Medium | 2.4.1 Bypass Blocks · 2.4.3 | Every route, first Tab | Load Live, read `document.activeElement`, press Tab once and Shift+Tab once | **Expected:** a visible skip link as the first focusable, or the natural header → nav → main order.<br>**Observed:** there is **no** skip link (0 `a[href^="#"]`). React focuses `<main tabindex="-1">` on load and on every route change, so focus starts in content and the first Tab goes to the camera select; the header and all navigation are only reachable with Shift+Tab or after tabbing through the whole page. The bypass works but is silent and undiscoverable. | `interactions2.json`: `skipLinks=[]`, `activeOnLoad={tag:MAIN}`, `firstTab={tag:SELECT}`, `shiftTabFromFirst={name:"Restrânge meniu"}`. |
| **A13** | Medium | 2.5.8 Target Size (Minimum) | 375×812 | Measure every visible control | **Expected:** ≥ 24×24 CSS px (44×44 is the stricter iOS/AAA target).<br>**Observed:** 3 of 27 controls are under 24 px: **Standard** 28×20, **Split** 28×20, collapsed **Restrânge Meniul** 16×34. 23 of 27 are under 44×44 (nav rail 24×39/40, theme 34×34, feed filters 25 px high, **Confirmă** 25 px high). | `reflow.json → touch`: `under24` = 3, `under44` = 23 (names/sizes listed). |
| **A14** | Medium | 4.1.3 Status Messages | Live, engine lifecycle | Start the browser engine, watch `[role=status]` | **Expected:** "se încarcă" / "rulează" / "oprit" announced.<br>**Observed:** the idle line is a `role=status` `<p>` ("motorul în browser este oprit…"), but it is removed when the engine starts; while running the page has **no** status text (`[""]`) and the "rulează / 0.9 fps" chip is not a live region. Start/stop and errors are silent. New incidents *are* announced: the toast region received "Eveniment nou detectat prin WebSocket: …" in the test. The feed count badge itself is not live, but the toast covers the event. | `reflow.json → canvas.statusText = [""]` after engine start; `state.json → liveRegionWatch` shows the toast text after a simulated event; `toastWatch` shows "Evenimentul 000_17 confirmat…". |
| **A15** | Medium | 4.1.2 | Sidebar navigation + Incidents rows | Inspect DOM; try middle-click / "open in new tab" on a row | **Expected:** navigation is links (`<a href>`) so URL, new tab, copy link and the browser's link list work.<br>**Observed:** both the nav entries and every incident row are `<button>` elements that call `pushState`. URLs change, but links cannot be opened in a new tab, copied from the context menu or enumerated as links by AT. | DOM: `nav button[title="Live"]`, `li > button[aria-label^="Deschide incidentul"]`; no `<a>` in either list. |
| **A16** | Medium | 1.3.1 · 2.4.6 | Incident detail | Read the heading outline | **Expected:** h1 → h2 → h3 → h4 without skips.<br>**Observed:** h2 "Incident: …" → **h4** "Cronologie eveniment" → h3 "Raport incident" → h4 "Decizia operatorului"; axe `heading-order` (moderate). | axe detail (both themes): `heading-order` on `.p-3 > h4`; heading list from `state.json`. |
| **A17** | Medium | 2.4.6 Headings and Labels · 4.1.2 | Header operator menu; sidebar; feed | Open the operator menu; read the AX names | **Expected:** names that identify role and purpose; unique action names.<br>**Observed:** operator trigger = **"D Dispecer DISPECER"** (initial + name + role badge, no "operator"); menu items = **"Dispecer Dispecer siguranță airside"** (role name repeated); nav entries include changing badge text ("Incidente Istoric, dovadă & raport **2 incidente escaladate, cel mai vechi acum 2h**"); the feed has four buttons all named **"Confirmă"**. Icon-only buttons are otherwise correctly named ("Comută tema interfeței", "Ecran complet", "Șterge zona"). | CDP AX tree: `button "D Dispecer DISPECER"`, `menuitemradio "Dispecer Dispecer siguranță airside"`, `button "Incidente Istoric, dovadă & raport 2 incidente…"`, 4× `button "Confirmă"`. |
| **A18** | Low | 1.3.1 | Bench → history table | Inspect the table markup | **Expected:** caption + column headers associated with cells.<br>**Observed:** the 9-column table has no `<caption>` and no `scope` on any `<th>` (Reports and Settings tables do have both). | `state.json → bench.tables = [{caption:null, headers:9, scope:false}]`. |
| **A19** | Low | 1.4.12 Text Spacing | Any route, enlarged spacing | Apply 1.5 line-height, 0.12 em letter-spacing, 0.16 em word-spacing | **Expected:** no loss of content.<br>**Observed:** sidebar subtitles are hard-truncated: "Istoric, dovadă & raport" `scrollWidth 178` vs `clientWidth 102`; three more labels clip. The `title` on the button repeats only the main label ("Incidente"), not the clipped subtitle, so a pointer cannot recover it either. | `reflow.json → textSpacing`: 4 clipped spans; page itself has no horizontal scroll (1280/1280). |
| **A20** | Low | 1.1.1 Non-text Content (context) | Live stage vs. incident cards | Start the engine; compare canvas with the text on the page | **Expected:** the processed picture is either decorative or has an equivalent text description.<br>**Observed:** the canvas is correctly `aria-hidden="true"` (1280×720, visible, no role/label/`aria-describedby`). The equivalent is **partial**: the engine card exposes zone, pipeline state, model, latency, persons, faces and incident count, and the feed lists each incident with text. But those metrics are not a live region and only exist while running, so a screen-reader user gets no running commentary on "what the engine sees"; only rule-violating incidents surface, via the toast. Acceptable as a text alternative for incidents, incomplete for raw detections. | `reflow.json → canvas`: `{ariaHidden:"true", role:null, label:null, describedby:null}`; `engineText` contains the metric labels; `statusText=[""]`. |
| **A21** | Low | 4.1.2 | Header theme button | Read the accessible name in both themes | **Expected:** state exposed (`aria-pressed`) and a name that says the current theme.<br>**Observed:** static `aria-label="Comută tema interfeței"`; only the `title` (description) says "Comută pe tema luminoasă/întunecată", and it states the *target*, not the current state. | AX: `button "Comută tema interfeței"`, description "Comută pe tema luminoasă". |
| **A22** | Low | APG menu pattern (2.1.1 / 4.1.2) | Header "Simulare" and operator menus | Open a menu, press ArrowDown / ArrowUp, then Escape | **Expected:** `role=menu` implies arrow-key navigation and focus on the first item.<br>**Observed:** `role=menu`/`menuitem` are set, but focus stays on the trigger and ArrowDown does nothing; Tab works. Escape closes and **does** restore focus to the trigger (that part is correct). | `interactions2.json`: `operatorAfterArrow = "D Dispecer DISPECER"` (unchanged); `menuClosedFocusIsTrigger=true`. |

---

## Contrast measurements (rendered colours)

Computed with the WCAG relative-luminance formula on the colours actually painted (alpha blended).

| Element | Dark | Light | Verdict |
|---|---|---|---|
| Body text (`#F5F5F5`/`#1F1F1F`, `#1F1F1F`/`#FFFFFF`) | 15.12 | 16.48 | pass |
| Muted token (`#9E9E9E`/`#282828`, `#64748B`/`#FFFFFF`) | 5.50 | 4.76 | pass |
| Hard-coded `text-slate-400` on white | — | **2.56** | **fail** |
| KPI amber `#F59E0B` on white (24 px) | — | **2.14** | **fail** (large-text floor 3:1) |
| **Confirmă** `#FFFFFF` on `#059669` | **3.76** | **3.76** | **fail** |
| **Export PDF** `#D73833` on `#4B2B2A` | **2.68** | 3.47 | **fail** / fail |
| Detail h4 `#D73833` on card | **2.95** | 4.66 | **fail** / pass |
| Reports h3 `#D73833` on panel | **3.16** | 4.66 | **fail** / pass |
| Active nav subtitle `#F7D7D6` on `#D73833` | **3.47** | 6.50 | **fail** / pass |
| CRITICAL chip `#FF8A80` on blended dark (static) | 5.56 | 7.60 | pass |
| CRITICAL/Escalated chip **during pulse** | **4.04 / 3.76** | **3.18 / 2.90** | **fail** (A6) |
| Focus ring `#FFEB33` | 12.06 | **1.22** | pass / **fail** |
| Focus ring `#33E1FF` | 9.38 | **1.57** | pass / **fail** |
| Input border | **1.36** | **1.24** | **fail** both |

Static chip colours pass; the failures on escalated cards are produced by the opacity pulse, which is
why A6 is rated High rather than a cosmetic preference.

---

## What is solid (verified, not assumed)

- **Landmarks and language:** `<header>`, `<nav aria-label="Module">`, `<aside aria-label="Navigare">`,
  `<main aria-label="Conținutul paginii">`; `html lang="ro"`; Romanian page title. Landmarks are unique
  and correctly labelled.
- **Keyboard activation:** feed cards open with **Enter** *and* **Space** (`keyboard.json`:
  `cardEnterOpens=true`); the ack button is reachable; no keyboard trap was found on any route (Tab
  wraps through Zones 20, Reports 15, Settings 12, Lab 15, Bench 8 stops without getting stuck).
- **Menus:** Escape closes both header menus and returns focus to the trigger; outside-click closes.
- **Toast:** `role="status" aria-live="polite" aria-atomic="true"`, mounted empty and filled later, so
  insertions are announced once. Verified with a real acknowledgement ("Evenimentul 000_17 confirmat
  de Dispecer. Escaladare anulată.").
- **Error boundary:** `role="alert" aria-live="assertive"` with a recovery action.
- **Form labels** (except A7): every zone field has a `<label for>`; the incident search, the report
  shift select (disabled in the demo), the bench duration input, the lab device select and the
  operator name are labelled; the date input is labelled in the non-mock branch.
- **Images:** the logo and the blurred incident frame have meaningful `alt`; broken images fall back to
  `role="img"` + label.
- **Tables:** Reports and Settings have `<caption class="sr-only">` and `scope="col"`; the bar charts
  expose values as text.
- **Reflow / zoom:** at 320 px and at 200 % (640×450) `documentElement.scrollWidth == clientWidth` on
  every route — no page-level horizontal scrolling. Tables scroll inside their own
  `overflow-x-auto` container (allowed).
- **Icon-only buttons** all have accessible names; `aria-expanded` is used on the rail toggle and
  `aria-pressed` on the browser-engine toggle.
- **Privacy copy and content:** the processed canvas is `aria-hidden` (correct) and no unblurred frame
  is exposed as an image.

---

## Appendix — method and reproduction

Routes exercised: `/`, `/incidents`, an incident detail, `/zones` (incl. JSON panel), `/reports`,
`/settings`, `/lab`, `/bench`; dark and light; desktop, 640×450, 375×812, 320×800.

- **axe:** injected `axe.min.js`; tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa,
  best-practice`; results for every route/theme in `/tmp/opencode/a11y/axe-*.json` and
  `state.json`.
- **Keyboard:** real `Tab`/`Shift+Tab` presses (not synthetic focus) for tab order; `Enter`/`Space`
  on cards; `Escape` on menus and the dialog; focus location read from `document.activeElement` and
  the CDP AX tree.
- **Focus indicators:** screenshots of each control with and without `:focus-visible` (keyboard
  modality), 28 px padding, animations disabled; pixel diff with pngjs; ring contrast from the
  changed pixels outside the element box (`focus-keyboard.json`, crops in `shots/focus/`).
- **Contrast:** axe `color-contrast` plus direct computation from `getComputedStyle` with alpha
  compositing over the nearest opaque ancestor (`contrast.json`).
- **Motion:** `reducedMotion: 'reduce'` context, then `getComputedStyle().animation*` over every node
  and a walk of all stylesheet rules (`mqRules`).
- **Reflow:** `documentElement.scrollWidth` vs `clientWidth`, `main` scroll sizes, elements with
  `right > innerWidth`, plus the WCAG text-spacing override.

**Limitations.** No real screen reader (NVDA/JAWS/VoiceOver) was driven; announcements were inferred
from live-region markup and CDP accessibility properties, not from speech output. Chromium only (no
Firefox/Safari). 200 % zoom was simulated by halving the CSS viewport (the standard reflow proxy), not
by changing the browser zoom level. Only the mock static build was audited; the engine ran on WASM
with 4 threads, which is representative of the shipped Pages build. Contrast on the video area itself
is exempt (pre-recorded footage); all UI overlays were checked.

---

## Top 5 fixes by impact

1. **Make the false-positive dialog a real modal (A1).** On open, focus the heading or the textarea;
   trap Tab/Shift+Tab inside; close on Escape; on close, restore focus to **Fals Pozitiv**. Add
   `inert`/`aria-hidden` to the app shell while open (or use `<dialog>` with `showModal()`). Today a
   keyboard or screen-reader operator cannot reliably leave the dialog or know where they are.
2. **Fix light-theme text contrast (A2).** Replace unconditional `text-slate-400` / `text-amber-500`
   with the theme tokens (`themeStyles.textMuted`, a darker amber) and re-check chips, KPI values and
   sidebar subtitles. This is the largest single source of failures (29 nodes on Live alone) and it
   affects every screen in the non-default theme.
3. **Fix dark-theme contrast on primary actions and headings (A8).** Darken the emerald button to
   ≥ 4.5:1 with white, lift `#D73833` headings/`Export PDF` on dark surfaces, and lighten the active
   nav subtitle. These are the default-theme controls of the demo path.
4. **Give light-theme focus a visible indicator (A3).** A yellow `#FFEB33` or cyan `#33E1FF` ring on
   white is 1.2–1.6:1. Use a two-tone ring (dark outline + brand colour offset) or a theme-aware
   focus token that reaches 3:1 in both themes — one change covers header search, selects, inputs,
   the dialog textarea and feed cards.
5. **Honour `prefers-reduced-motion` and stop pulsing text (A6).** Add a global reduced-motion block
   that disables `pulse`/`bounce`/`ping`/`spin`, and move the escalation cue from whole-card opacity
   to a border/icon so contrast no longer oscillates below AA.

Close runner-ups, in order: **A4** (invisible focus in the collapsed mobile rail — make it `inert`
when closed), **A5** (split the feed card into a link/button plus a separate acknowledge button and
keep the incident summary in the name), **A7** (label the JSON textarea, the keyboard path to
geometry).
