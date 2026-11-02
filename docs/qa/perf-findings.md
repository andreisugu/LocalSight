# QA de performanță — deriva de fps în sesiuni lungi

**Reclamația testată:** „în sesiuni de 10+ minute fps-ul scade treptat”. Până acum nereprodusă.
**Rulat:** 2 noiembrie 2026, pe `restlessdesk` (16 fire, 27 GB RAM), build static `VITE_USE_MOCK=true`,
`VITE_BASE=/LocalSight/`, motorul din browser pornit în vizualizarea Live.
**Verdict scurt:** deriva nu se reproduce; în 13 minute fps-ul a rămas plat (ultimele patru
eșantioane: 1,43–1,73 fps, fără tendință). Singurul leak măsurat este memorie nativă pierdută la
fiecare pornire/oprire a motorului (~81 MB/ciclu), nu în sesiunea continuă.

| Întrebare | Verdict |
|---|---|
| fps scade în 12 minute? | **Nu.** pantă −0,002 fps/min (t = −0,18, R² = 0,001); −0,02 fps în 12 min, de același ordin cu diferența dintre două rulări identice (0,01 fps) și de ~8× mai mică decât deviația standard a unui eșantion (0,17 fps) |
| memorie crește monotonic în sesiune? | **Nu.** JS heap +0,05 MB/min (+0,6 MB în 13 min), RSS plat; după oprirea motorului RSS scade cu ~300 MB |
| workeri/canvasuri se acumulează la 10 comutări? | **Nu.** 11 workeri creați, 10 terminați, 1 viu; 0–1 canvas, mereu 1 când rulează |
| leak la 20 de schimbări de cameră? | **Nu** în JS/heap/workeri/canvas; RSS urcă până la un platou (~1,55 GB) în primele 10–20 de schimbări, apoi se oprește |
| memorie nativă la comutarea motorului? | **Da.** +50 MB/ciclu în renderer și +31 MB/ciclu în procesul GPU, monoton pe 10 cicluri, cu JS heap plat |

## Metodă

- Build: `cd frontend && VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build`; `dist/` servit
  local pe `127.0.0.1:4213/LocalSight/` de un server Node scris pentru test, cu fallback
  `index.html` pentru căi necunoscute. **Fără COOP/COEP**, exact ca GitHub Pages, deci WASM
  rămâne single-thread.
- Clip: `frontend/public/media/stand12.mp4` (1920×1080), livrat din `dist/media/`; nu s-a modificat
  nimic în aplicație și nu s-a adăugat media în git.
- Browser: Chromium 1248 din Playwright 1.64.1, headless, viewport 1440×900, cu
  `--enable-precise-memory-info --js-flags=--expose-gc`. Fără `--enable-unsafe-webgpu`: în headless
  adapterul WebGPU e un llvmpipe fals și prima sesiune ORT nu se termină niciodată; fără el motorul
  rulează pe WASM single-thread, calea unui vizitator fără WebGPU.
- Motorul a fost pornit prin `localStorage['localsight.liveEngine'] = '1'`, adică exact comutatorul
  butonului „Pornește motorul în browser”; opririle și pornirile din testul de comutare s-au făcut
  prin click pe butoanele reale. Camerele s-au schimbat prin `select#live-camera-select`.
- Instrumentare doar în page context (`addInitScript`), fără modificări de cod:
  `window.Worker` a fost împachetat ca să numere construcțiile și `terminate()`, plus un listener
  pe fiecare worker care înregistrează fiecare mesaj `result` (`ms`, `fps`, momentul sosirii).
  `console.error`/`console.warn` au fost numărate, iar `page.on('console')` și `page.on('pageerror')`
  au fost numărate separat.
- Eșantion la fiecare 30 s: fps din panou (DOM), fps pe fereastră (cadre procesate / timp),
  `ms`/cadru din mesajele workerului, `performance.memory.usedJSHeapSize`, RSS-ul întregului arbore
  Chromium (browser + renderer + GPU + utility, citit din `ps`), workeri vii, număr și arie de
  canvasuri, erori/avertismente, `load average`. `usedJSHeapSize` nu vede memoria WASM, de aceea RSS
  e raportat separat.
- Rulări: **o sesiune de 13,0 minute** (782 s, 26 eșantioane, 1182 cadre procesate), **două rulări
  de 2 minute** pentru zgomotul dintre rulări, **una de control de 2 minute cu motorul oprit**, apoi
  teste separate pentru oprire, 10 comutări on/off, 20 de schimbări de cameră (plus o confirmare de
  40) și o confirmare de 10 comutări cu defalcare pe procese.

## Sesiunea de 13 minute (motor pornit)

Medii pe treimi de eșantioane (primele 8 / mijlocul 8 / ultimele 9, după primul eșantion de
încălzire), plus panta prin regresie liniară:

| Metrică | start | mijloc | final | pantă |
|---|---|---|---|---|
| fps panou (EMA-ul motorului) | 1,55 | 1,56 | 1,51 | +0,001 fps/min |
| fps pe fereastră (cadre/s) | 1,52 | 1,57 | 1,48 | **−0,002 fps/min** |
| ms/cadru (worker) | 627 | 603 | 645 | +0,5 ms/min |
| JS heap (`usedJSHeapSize`) | 4,9 MB | 5,3 MB | 5,4 MB | +0,05 MB/min |
| RSS arbore Chromium | 1503 MB | 1509 MB | 1495 MB | −0,4 MB/min |
| workeri vii | 1 | 1 | 1 | 0 |
| canvasuri / arie | 1 / 2 073 600 px | 1 / 2 073 600 px | 1 / 2 073 600 px | 0 |
| erori / avertismente console | 0 | 0 | 0 | 0 |

Panta fps: **−0,0017 fps/min** (SE 0,0097, t = −0,18, R² = 0,001) → **−0,02 fps în 12 minute**,
adică −1,4% din media de 1,52 fps. Panta lui `ms`/cadru: +0,50 ms/min (SE 4,13) — practic zero.
Seria nu arată o cădere: primele eșantioane 1,27–1,46, la mijloc 1,70–1,73, la final 1,43–1,73.

**Zgomotul dintre rulări** (două rulări identice de 2 minute, după primul eșantion de încălzire):
1,45 ± 0,18 fps vs 1,46 ± 0,20 fps, diferență între medii **0,01 fps**. Deviația standard din
interiorul unei rulări (0,17–0,20 fps) este de ~12% din medie, de 10× mai mare decât deriva de
12 minute. O rulare de 2 minute, privită singură, poate produce o pantă de **−0,2…−0,3 fps/min**
(−0,21 fps/min pe toate cele 4 eșantioane, −0,30 pe cele 3 de după încălzire, R² 0,68) — dacă ai
crede-o, ar însemna −2,5…−3,6 fps în 12 minute. Asta e exact capcana în care cade o observație de
2 minute: zgomotul produce „derivă” mai mare decât orice efect real măsurat aici.

**De ce variază totuși fps-ul:** load average-ul gazdei a fost 9,32 ± 2,74 (minim 5,53, maxim 14,32,
pe 16 fire — alte procese ale utilizatorului rulau). Corelația fps cu load average este **−0,73**
(R² = 0,54), iar fps cu `ms`/cadru este **−0,99**: la load < 8 media e 1,64 fps, la load ≥ 11 e
1,38 fps (−16%). Fps-ul măsurat e limitat de mașină, nu de o degradare a aplicației.

## Memorie: sesiune lungă vs. oprire

- JS heap: 4,7 MB la primul eșantion, 5,5 MB la ultimul; +0,05 MB/min, doar 12 din 24 de creșteri
  consecutive (nu e monoton), iar după `gc()` forțat rămâne 5,1–5,4 MB. Nu e leak de heap JS.
- RSS: 1305 → 1509 MB cu vârf 1548, pantă −0,4 MB/min; fluctuează cu load-ul, nu crește.
- Oprirea motorului (rulare separată de 90 s, ca să nu stric sesiunea lungă): RSS **1486 → 1184 MB
  (−302 MB)**, workeri 1 → 0, canvasuri 1 → 0, heap după GC 4,6–4,9 MB. Memoria e returnată la
  oprire, deci comportament de allocator, nu de leak.
- Control cu motorul oprit 2 minute: 0 workeri, 0 canvasuri, 0 cadre, heap 4,6–4,9 MB, RSS 584 MB.
  Diferența față de ~1,5 GB cu motorul pornit este memoria WASM/ORT a motorului, invizibilă în
  `usedJSHeapSize`.

## Comutarea motorului on/off (10 cicluri)

Workeri: 11 creați, 10 terminați, **1 viu** la final. Canvasuri: 1 când rulează, 0 când e oprit,
niciodată mai mult de 1. JS heap după `gc()` forțat: 5,2 MB. Deci **nu se acumulează workeri sau
canvasuri**.

Ce se acumulează este memoria nativă, măsurată pe tipuri de proces Chromium (confirmare pe 10 cicluri):

| Ciclu | renderer (MB) | GPU (MB) | JS heap (MB) | workeri vii | canvasuri |
|---|---|---|---|---|---|
| pornit, inițial | 855 | 138 | 6,5 | 1 | 1 |
| oprit 1 | 676 | 160 | 5,0 | 0 | 0 |
| pornit 5 | 1332 | 293 | 5,5 | 1 | 1 |
| oprit 10 | 1260 | 437 | 5,8 | 0 | 0 |
| pornit 10 | 1496 | 460 | 5,8 | 1 | 1 |

Pante pe ciclu: **+50,5 MB renderer**, **+31,4 MB GPU** (~81 MB per pornire/oprire), monotone, fără
platou după 10 cicluri; RSS total 1263 → 2052 MB în testul separat de 10 comutări (≈79 MB/ciclu).
Heap-ul JS și numărul de workeri/canvasuri rămân plate, deci nu e un leak JS: e memorie nativă
(video + WASM/ORT) care nu se întoarce la OS. Testul de camere, care reîncarcă `<video>` fără să-l
recreeze, nu arată aceeași creștere — indică elementul `<video>` recreat la fiecare comutare
(`key={browserEngineOn ? 'live-engine' : demoVideoSrc}`) ca suspect principal, dar nu pot izola
cauza fără să modific codul aplicației.

## Schimbarea camerei de 20 de ori

Workeri: 1 creat în total, 1 viu; canvasuri: exact 1, aria alternând 2 073 600 px (1920×1080) și
921 600 px (1280×720) după cameră. JS heap 4,7–7,2 MB, după `gc()` forțat 5,1 MB. RSS total
1266 → 1569 MB, dar pe tipuri de proces se vede un platou: rendererul urcă de la 862 MB (încălzire)
la ~1150–1200 MB în primele ~10 schimbări, apoi rămâne acolo. Confirmarea cu 40 de schimbări dă
panta 8,5 MB/schimbare în primele 20 și **3,8 MB/schimbare în ultimele 20**, cu același total final
(~1,56 GB). Concluzie: umplerea bufferelor decodorului, nu leak nelimitat.

## Ce nu acoperă testul

- Doar calea **WASM single-thread** (~1,5 fps). Pe WebGPU, la 15–30 fps, aceleași 12 minute înseamnă
  de 10–20× mai multe cadre; un leak care crește per cadru ar fi de 10–20× mai vizibil. Deriva
  raportată de utilizator nu poate fi exclusă pe această cale.
- 1182 cadre procesate în 13 minute. Un test echivalent la 15 fps ar fi ~11 700.
- Gazda era încărcată (load 5,5–14,3), iar fps-ul urmărește load-ul (r = −0,73). Pe o mașină liniștită
  cifrele absolute ar fi mai mari; concluzia „fără derivă” se sprijină pe pantă, nu pe valoarea absolută.
- Headless Chromium nu are GPU real; memoria GPU măsurată aici e a procesului de rasterizare software.

## Cele trei numere care contează pentru utilizator

1. **1,52 fps mediu și o pantă de −0,002 fps/min** — −0,02 fps în 12 minute (−1,4%), sub o
   zecime dintr-o deviație standard de eșantion (0,17 fps). Sesiunea lungă nu încetinește.
2. **+0,6 MB JS heap în 13 minute** (4,9 → 5,5 MB), RSS plat și −302 MB după oprirea motorului —
   nu rămâne memorie agățată după o sesiune lungă.
3. **~81 MB memorie nativă pierdută la fiecare pornire/oprire a motorului** (+50 MB renderer,
   +31 MB GPU), deși workerii și canvasurile rămân la 1 — singurul leak real găsit, și apare doar
   dacă operatorul comută motorul, nu în rularea continuă.

## CSV brut (sesiunea de 13 minute, 27 linii)

Coloane: `phase,elapsed_s,fps_panel,fps_window,ms_mean,frames_window,frames_total,heap_mb,heap_total_mb,rss_mb,workers_live,workers_created,workers_terminated,canvases,canvas_area,console_errors,console_warns,incidents,load1,host_rss_free_mb`.
Ultima coloană e RAM liberă pe gazdă (MB); numele i-a rămas din script. `console_errors`/`console_warns`
sunt cumulative. Virgula e separator, zecimalele sunt cu punct (format de mașină).

```csv
phase,elapsed_s,fps_panel,fps_window,ms_mean,frames_window,frames_total,heap_mb,heap_total_mb,rss_mb,workers_live,workers_created,workers_terminated,canvases,canvas_area,console_errors,console_warns,incidents,load1,host_rss_free_mb
long,30,1.4,1.27,722,38,38,4.7,5.9,1305,1,1,0,1,2073600,0,0,1,12.32,12422
long,60,1.3,1.3,717,39,77,4.7,7,1467,1,1,0,1,2073600,0,0,1,13.17,10991
long,90,1.2,1.23,765,37,114,4.8,7.2,1496,1,1,0,1,2073600,0,0,2,14.32,11071
long,120,1.5,1.46,647,44,158,5.3,6.6,1509,1,1,0,1,2073600,0,0,2,11.44,12809
long,150,1.6,1.56,610,47,205,4.6,6.6,1513,1,1,0,1,2073600,0,0,2,9.99,13131
long,180,1.7,1.5,623,45,250,5.5,7.4,1509,1,1,0,1,2073600,0,0,3,8.27,13231
long,210,1.7,1.7,551,51,301,4.9,6.5,1546,1,1,0,1,2073600,0,0,3,7.18,12779
long,240,1.7,1.7,557,51,352,4.7,6.7,1503,1,1,0,1,2073600,0,0,3,6.37,12914
long,270,1.7,1.73,546,52,404,4.8,6.7,1478,1,1,0,1,2073600,0,0,3,6.24,13074
long,300,1.7,1.73,545,52,456,4.8,7,1478,1,1,0,1,2073600,0,0,4,6.15,13623
long,331,1.7,1.73,535,52,508,5.6,7.8,1514,1,1,0,1,2073600,0,0,4,5.61,13481
long,361,1.6,1.7,560,51,559,5.6,8.2,1512,1,1,0,1,2073600,0,0,4,5.78,13381
long,391,1.7,1.7,548,51,610,4.9,7,1507,1,1,0,1,2073600,0,0,4,5.53,13611
long,421,1.5,1.56,608,47,657,5.7,7.6,1517,1,1,0,1,2073600,0,0,4,5.85,12694
long,451,1.5,1.4,676,42,699,4.9,7.5,1515,1,1,0,1,2073600,0,0,4,6.77,12560
long,481,1.5,1.46,650,44,743,5,7.5,1518,1,1,0,1,2073600,0,0,5,7.72,12184
long,511,1.3,1.3,705,39,782,5.6,7.2,1509,1,1,0,1,2073600,0,0,5,10.87,11086
long,541,1.6,1.52,640,46,828,5.3,7.3,1471,1,1,0,1,2073600,0,0,5,9.31,12873
long,571,1.4,1.46,630,44,872,5.2,7,1507,1,1,0,1,2073600,0,0,6,8.99,11686
long,601,1.1,1.33,718,40,912,5.3,7.3,1478,1,1,0,1,2073600,0,0,6,11.25,11873
long,631,1.3,1.23,759,37,949,5.5,8.3,1548,1,1,0,1,2073600,0,0,6,12.72,10737
long,661,1.6,1.43,655,43,992,5.3,7.1,1512,1,1,0,1,2073600,0,0,7,11.31,10958
long,691,1.5,1.33,718,40,1032,5.4,7.2,1470,1,1,0,1,2073600,0,0,7,11.79,12299
long,721,1.7,1.63,563,49,1081,5.3,7.4,1455,1,1,0,1,2073600,0,0,7,11.44,12486
long,752,1.6,1.63,582,49,1130,5.5,6.8,1509,1,1,0,1,2073600,0,0,7,11.67,12766
long,782,1.8,1.73,543,52,1182,5.5,7.8,1509,1,1,0,1,2073600,0,0,8,10.31,13531
```

## Cum se reia testul

```bash
cd frontend && VITE_USE_MOCK=true VITE_BASE=/LocalSight/ npm run build
node /tmp/opencode/perf-server.mjs          # servește dist/ pe 127.0.0.1:4213/LocalSight/
node /tmp/opencode/runner.mjs long          # 13 min, CSV în /tmp/opencode/perf-long.csv
node /tmp/opencode/runner.mjs noise         # 2×2 min + 2 min control, motor oprit
node /tmp/opencode/runner.mjs toggle-confirm
node /tmp/opencode/runner.mjs cameras-confirm
node /tmp/opencode/analyze.mjs              # pante, treimi, verdict
```

Scripturile de măsurare au trăit în `/tmp/opencode` (harness Playwright, server static, analiză) și
nu fac parte din livrare; nu s-a modificat niciun fișier al aplicației.
