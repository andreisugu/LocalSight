# YOLO26n + YuNet în browser (onnxruntime-web) — ce să te aștepți

> **Material istoric — nu se mai rulează.** Notă de cercetare scrisă înainte de port; nu
> descrie starea livrată. Cifrele de browser erau ipoteze, iar concluzia „WASM rămâne
> single-thread pe Pages” a fost rezolvată prin `coi-serviceworker.js`. Starea actuală:
> [browser-engine.md](browser-engine.md) și [qa/perf-findings.md](qa/perf-findings.md).

Notă de cercetare. **Nu conține măsurători făcute de noi în browser** — tot ce e cifră „de rulare" aici e fie citat din `docs/performance.md` (măsurat nativ), fie marcat explicit ca **ipoteză**. Fiecare afirmație despre suportul din browsere are link.

Scopul: să nu descoperim pe scenă că WebGPU nu e pornit, că WASM-ul merge pe un fir sau că runtime-ul cântărește de trei ori cât modelele.

---

## 0. Ce rulăm

| Element | Valoare | Sursă |
|---|---|---|
| Detector persoane | YOLO26n, export ONNX fp32 | `AGENTS.md`, `docs/performance.md` |
| Detector fețe | YuNet 2023mar (ONNX) | `docs/performance.md` |
| Greutăți total | **≈9,5 MB** (dată de echipă, de confirmat cu `ls -l`; fișierele nu sunt în git) | temă, nu măsurătoare |
| Runtime | `onnxruntime-web` (azi **nu** e în `frontend/package.json`) | `frontend/package.json` |

Referința față de care comparăm e `docs/performance.md`, măsurat nativ pe Ryzen 7 7840HS (8 nuclee fizice / 16 fire), Radeon 780M:

- detect: **28 ms/cadru** (torch, `OMP_WAIT_POLICY=ACTIVE`) / **17,9 ms** (ncnn pe iGPU);
- YuNet: **26 ms** pe CPU;
- 3 camere, camera urmărită: **14,4–14,8 fps** (torch) / **20,0–20,1 fps** (ncnn);
- YOLO prin ONNX Runtime fp32 nativ: paritate cu torch la 8 fire, dar **7,5 fps** end-to-end la 3 camere;
- YOLO int8 (QDQ): **62,9 ms vs 26,7 ms** — de 2,4× mai lent. Deci int8 nu e pârghia, nici nativ.

Astea sunt numere **nativ, pe CPU cu 8 fire, fără browser**. Orice comparație cu browserul trebuie măsurată.

---

## 1. Execution providers: ce există și ce alegem

ORT Web expune patru EP-uri: `wasm` (implicit, CPU), `webgpu`, `webnn`, `webgl` — lista e în [documentația `executionProviders`](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#executionproviders).

| EP | Stare 2026 | Verdict pentru noi |
|---|---|---|
| `wasm` | Singurul care merge peste tot, inclusiv Node (doar single-thread acolo). | **Baseline obligatoriu.** Demo-ul trebuie să arate bine și pe el. |
| `webgpu` | Bun pe Chrome/Edge Windows, macOS, ChromeOS, Android; pe Linux depinde de GPU (vezi §3). | **Opțional, cu fallback explicit.** |
| `webgl` | „maintenance mode", iar un [document de design din ORT](https://github.com/microsoft/onnxruntime/blob/main/docs/design/onnxruntime_web_remove_webgl_backend.md) propune scoaterea lui; are mai puțini operatori decât WebGPU. | **Nu.** |
| `webnn` | Necesită flag de browser și, în matricea ORT, doar Chrome/Edge pe Windows. | **Nu.** |

### Suportul real, octombrie 2026

Sursa cea mai la zi e [wiki-ul gpuweb „Implementation Status"](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) (editat 2 oct. 2026), nu matricea ORT (care încă scrie Safari ❌ și Firefox ❌ — vezi mai jos).

**Chromium (Chrome/Edge)**

- Windows/macOS/ChromeOS: din **113**.
- Android: din **121** (ARM/Qualcomm/Intel), Imagination din 139.
- **Linux: „Intel Gen12+: 144"**, „NVIDIA (driver 535.183.01+) Wayland: 147", iar **„Others: Behind a flag"** — adică **AMD intră la „others"**. Flag-urile cerute: `--enable-unsafe-webgpu --ozone-platform=x11 --use-angle=vulkan --enable-features=Vulkan,VulkanFromANGLE`.
- Confirmarea din partea Chrome: [„What's New in WebGPU — Chrome 144"](https://developer.chrome.com/blog/new-in-webgpu-144) (7 ian. 2026): „carefully rolling out WebGPU for Linux, **starting with support for Intel Gen12+ GPUs** but with a tentative plan to expand it to more devices (AMD, NVIDIA)".

**Firefox**

- Windows: din **141** ([release notes](https://www.firefox.com/en-US/firefox/141.0/releasenotes/)).
- macOS 26+: 145; toate versiunile macOS: 147.
- **Linux: doar Nightly** (implicit), Stable/Beta nu. Mozilla „expects to ship on Linux in 2026" — deci *poate* s-a schimbat până la demo, dar azi nu e implicit.
- Android: în spatele unui flag.

**Safari**

- **26** pe macOS, iOS/iPadOS, visionOS — aici a ajuns din urmă. Matricea ORT încă zice ❌, deci **nu te baza pe matricea ORT**.

**Agregat** ([caniuse WebGPU](https://caniuse.com/webgpu), date sept. 2026): 85,8% + 2,02% = **87,82%** utilizare globală; Firefox 141–162 apare „disabled by default"; Safari 26 „partial". [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) îl clasează „Limited availability", non-Baseline, și cere **secure context** (HTTPS sau localhost).

### Fallback-ul de operatori, nu de EP

WebGPU nu implementează tot ONNX-ul. Tabelul oficial: [`js/web/docs/webgpu-operators.md`](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md). Două intrări contează direct pentru noi:

- `Reshape` — **„no GPU kernel"**;
- `Shape` — **„no GPU kernel; an ORT warning is generated"**.

Adică exact operațiile care fac un detector cu head-uri decodate din shape-uri dinamice vor face salt la CPU. Documentația EP-ului WebGPU o spune pe față: dacă un kernel „falls back to CPU" sau shape-ul de intrare se schimbă, graph capture „may fail or fall back to regular execution" ([WebGPU EP, secțiunea Graph capture](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html)).

Consecința practică, și cel mai ușor mod de a te minți singur: **poți crede că rulezi pe GPU când jumătate din graf rulează pe CPU**. Există o opțiune pentru „strict proof mode" (`extra.session.disable_cpu_ep_fallback = '1'`, folosită în [acest tutorial](https://github.com/DakeQQ/Tutorial-ONNX-Runtime-Execution-Providers/tree/main/WebGPU)) — folosește-o în măsurători, nu în demo. Comportamentul exact al ORT Web când ceri `['webgpu']` fără adaptor: **neconfirmat**; de aceea alegem EP-ul explicit în cod (§6).

---

## 2. Threading și constrângerea GitHub Pages

Lanțul cauzal, verificabil bucată cu bucată:

1. Multi-threading în ORT Web înseamnă WASM threads, deci memorie partajată.
2. `SharedArrayBuffer` cere **secure context + cross-origin isolated** ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)); fără ele constructorul e ascuns și `postMessage` aruncă.
3. Cross-origin isolation cere headerele `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` pe documentul principal ([web.dev, cross-origin isolation guide](https://web.dev/articles/cross-origin-isolation-guide)).
4. ORT Web face verificarea singur: „Only when the browser supports WebAssembly multi-threading and `crossOriginIsolated` mode is enabled, multi-threading will be enabled" ([`env.wasm.numThreads`](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#envwasmnumthreads)).
5. **GitHub Pages nu poate trimite headere custom.** Confirmat de două discuții oficiale rămase fără răspuns: [#54257](https://github.com/orgs/community/discussions/54257) („We don't support this feature today") și [#13309](https://github.com/orgs/community/discussions/13309) (răspuns GitHub: „This is a scenario we would support with custom headers. No ETA"). Confirmat și de [blogul lui Thomas Steiner](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages) (mart. 2025).

**Consecință: pe GitHub Pages, ORT Web rulează single-threaded.** Nu „mai lent" în abstract, ci pe **un singur fir** față de cele 8 fire fizice din `docs/performance.md`.

Nuanțe care contează la măsurare:

- Chiar și cu COI, **default-ul ORT e `min(hardwareConcurrency / 2, 4)`** — pe laptopul de 16 fire ai 4 fire, nu 8. Pentru comparație corectă cu `docs/performance.md`, setează explicit `ort.env.wasm.numThreads = 8`.
- WASM SIMD e pe **128 de biți** ([WebAssembly SIMD](https://github.com/WebAssembly/simd)), deci fără AVX2/AVX-512. Chiar cu 8 fire, WASM nu are cum să egaleze build-ul nativ; cât de departe e — de măsurat.
- `ort.env.wasm.proxy` **nu merge cu WebGPU** (bufferul GPU nu e transferabil), și nici cu buffere >2 GB. Dacă vrei WebGPU într-un worker, importă librăria în worker.
- Există o portiță pentru Pages: un service worker care rescrie headerele — [`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker), explicat în blogul de mai sus. Funcționează, dar adaugă un reload la prima vizită și un strat de magie în calea demo-ului. Pentru măsurători e acceptabil; pentru scenă, vezi §7.

---

## 3. WebGPU pe hardware-ul țintă (Radeon 780M, Chrome pe Linux)

Aici e riscul cel mai probabil să ne prindă pe picior:

- 780M e **AMD** → în wiki-ul gpuweb, AMD pe Linux e la **„Others: Behind a flag"**, nu la „supported".
- Chrome 144 spune explicit că rollout-ul pe Linux a început cu **Intel Gen12+**, cu AMD/NVIDIA doar „tentative plan".
- Pe Linux, WebGPU folosește **Vulkan**; dacă driverul/driverul Vulkan sau compozitorul (Wayland vs X11) nu se înțeleg, adaptorul lipsește sau pică la prezentare.

**Cum verifici în 30 de secunde**, înainte de orice măsurătoare: deschide `chrome://gpu` și uită-te la secțiunea *Graphics Feature Status*. Vrei „WebGPU: Hardware accelerated". Dacă scrie „disabled via blocklist or the command line", vezi [troubleshooting-ul Chrome](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips).

**Când adaptorul lipsește**, `navigator.gpu.requestAdapter()` întoarce `null` — codul din [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API#accessing_a_device) tratează exact cazul: `if (!adapter) throw Error("Couldn't request WebGPU adapter.")`. Deci: **verifică înainte de a crea sesiunea**, nu prinde eroarea după.

Ipoteză de lucru (de confirmat pe laptop): cu flag-urile din §1, 780M expune un adaptor Vulkan funcțional; fără ele, `navigator.gpu` există dar `requestAdapter()` poate reveni cu `null` sau cu un adaptor software. **Nu presupune că „merge, doar că încet".**

---

## 4. Constrângeri de model și de shape

**Shape-uri dinamice.** ORT Web le acceptă — are `freeDimensionOverrides` exact pentru cazul „modelul are `[batch, 3, height, width]`, dar eu folosesc mereu aceeași dimensiune" ([documentație](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#freedimensionoverrides)). Ce se strică pe WebGPU:

- graph capture cere shape-uri statice și toate kernelurile pe WebGPU; altfel „model initialization will fail" sau revine la execuție normală;
- fiecare shape nou poate însemna pipeline-uri noi de compilat (vezi §5). Cât de rău e pentru YuNet la 1920 — **neconfirmat, de măsurat**;
- `Shape`/`Reshape` nu au kernel GPU, deci decodarea head-urilor trece prin CPU chiar și pe WebGPU.

YuNet 2023mar, așa cum îl folosim pe edge (cadru întreg, 1920), are H/W variabile în practică dacă exportul e symbolic. **Verifică întâi ce shape are modelul real** (un `onnx.load(...).graph.input` e suficient) și abia apoi decide: dacă e dinamic, ori îl îngheți la o singură rezoluție și redimensionezi cadrele înainte (`freeDimensionOverrides`), ori accepți recompilări.

**Memorie.** Cifrele oficiale ([Working with large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html)):

- `ArrayBuffer` maxim în Chrome ≈ **2 GB** (`0x7fe00000`);
- protobuf ONNX maxim **2 GB** (peste → external data);
- memorie WASM maxim **4 GB** (adresare pe 32 de biți), și ORT poate depăși 2 GB folosind `new WebAssembly.Memory()`, dar bufferul respectiv nu e transferabil (deci fără `env.wasm.proxy`).

Cu 9,5 MB de greutăți, **niciuna din aceste limite nu ne atinge**. Limita practică nu e memoria, e **download-ul** — vezi §5. (Dacă cineva propune un model de 300 MB, discuția se schimbă: acolo intri în external data + Cache API.)

---

## 5. Cold start așteptat

Ce e **măsurat** aici sunt doar dimensiunile fișierelor (metadate npm via jsDelivr, `onnxruntime-web@1.31.1`). Ce **nu** e măsurat: timpii.

| Fișier | Bytes | Sursă |
|---|---|---|
| `ort.webgpu.min.mjs` | 70.742 | [jsDelivr](https://data.jsdelivr.com/v1/packages/npm/onnxruntime-web@1.31.1?structure=flat) |
| `ort-wasm-simd-threaded.jsep.wasm` (build `webgpu`) | **29.520.971** | idem |
| `ort-wasm-simd-threaded.asyncify.wasm` | 28.747.738 | idem |
| `ort-wasm-simd-threaded.jspi.wasm` | 17.920.659 | idem |
| `ort-wasm-simd-threaded.wasm` (build `wasm`) | 14.848.852 | idem |
| modele (YOLO26n + YuNet) | ≈9,5 MB | temă, de verificat |

Concluzia care schimbă planul: **runtime-ul e mai mare decât modelele.** Build-ul `webgpu` (`ort.webgpu.mjs`) referențiază `ort-wasm-simd-threaded.jsep.wasm`, ~29,5 MB necomprimat, adică de trei ori greutățile. Care variantă (`jsep` / `asyncify` / `jspi`) se descarcă efectiv depinde de detecția de feature-uri la runtime — **confirmă în Network**, nu presupune. Versiunea contează: în 1.23.0 aceleași fișiere erau 23,7 MB / 11,8 MB.

Cât se transferă efectiv depinde de compresia serverului — **neconfirmat** dacă GitHub Pages comprimă `.wasm`; măsoară „transferred" în DevTools Network, nu te uita la dimensiunea de pe disc.

Ce se întâmplă la pornire, în ordine (mecanism, nu timpi):

1. fetch JS + WASM (dominant, sute de ms pe rețea bună, secunde pe rețea proastă — ipoteză);
2. `WebAssembly.instantiate` + `InferenceSession.create()`: ORT aplică optimizări de graf, alocă buffere, partitionează graful între EP-uri;
3. la WebGPU, crearea pipeline-urilor = **compilare de shadere**, care în Dawn e asincronă și se plătește la prima utilizare a fiecărui kernel (Chrome are postări dedicate optimizării acestui cost: [Chrome 126](https://developer.chrome.com/blog/new-in-webgpu-126), [Chrome 136 pe D3D12](https://developer.chrome.com/blog/new-in-webgpu-136));
4. primul `run()` e semnificativ mai scump decât al doilea — de aici necesitatea unui warm-up.

Mitigări directe din documentație: `enableGraphCapture` pentru graf static integral pe GPU; **Cache API / OPFS** pentru model, ca refresh-ul să nu re-descarce ([Working with large models → Cache the model](https://onnxruntime.ai/docs/tutorials/web/large-models.html)); `optimizedModelFilePath` pentru un model pre-optimizat (necesită build special al ORT).

---

## 6. Plan de măsurare

### Hardware și browser

| | Configurație |
|---|---|
| Mașina A (țintă) | Ryzen 7 7840HS, Radeon 780M, Linux. Chrome **stable**, sesiune **X11** (flag-urile AMD cer `--ozone-platform=x11`) |
| Mașina B (control) | orice Intel Gen12+ pe Linux cu Chrome ≥144, unde WebGPU e **implicit** — separă „merge flag-ul" de „e lent ORT" |
| Browser secundar | Chrome stable fără flag-uri, ca să vedem exact ce vede publicul pe Pages |

Notează pentru fiecare rulare: `navigator.hardwareConcurrency`, `crossOriginIsolated`, `ort.env.wasm.numThreads` efectiv, `chrome://gpu` (WebGPU hardware/software/disabled), versiunea Chrome, `onnxruntime-web`.

### Ce se cronometrează

1. `fetch` modele (cold, apoi cu cache) — separat pe fișier.
2. `InferenceSession.create()` — separat YOLO și YuNet, separat per EP.
3. **primul** `session.run()` (include compilarea de shadere pe WebGPU).
4. `session.run()` în regim — **p50 și p95** pe ≥100 de rulări, nu media.
5. End-to-end pe un cadru 1080p: preprocess (resize/letterbox/normalize) + inferență + postprocess (NMS). Preprocess-ul în JS e adesea jumătate din buget și nu apare în `run()`.
6. Memorie: `performance.measureUserAgentSpecificMemory()` (cere COI) sau Task Manager-ul Chrome.

### Cu ce comparăm

Cu `docs/performance.md`, punct cu punct, pe **același cadru de intrare**:

| Măsurătoare browser | Referință nativă |
|---|---|
| detect YOLO26n, ms/cadru | **28 ms** torch ACTIVE / **17,9 ms** ncnn iGPU |
| pass YuNet, ms | **26 ms** CPU |
| fps end-to-end, 3 camere | **14,4–14,8** torch / **20,0–20,1** ncnn |
| YOLO ONNX fp32, 3 camere | **7,5 fps** (deja măsurat nativ, deci plafonul realist) |

Reguli de igienă, aceleași care au salvat măsurătorile native: A/B intercalat (wasm, webgpu, wasm, webgpu), nu serii; rulează pe rând, cu un singur tab; notează dacă laptopul e pe baterie; nu raporta o singură rulare.

### Verificări obligatorii înainte de a crede un număr

```js
// 1. Ce EP-uri putem chiar folosi
async function pickEP() {
  if (!navigator.gpu) return ['wasm'];
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return ['wasm'];
  const info = adapter.info ?? {};           // vendor/architecture, util în raport
  console.log('adapter', info);
  return ['webgpu', 'wasm'];
}

// 2. Fire reale, nu cele sperate
ort.env.wasm.numThreads = 8;                 // default e min(hc/2, 4)
console.log('coi', crossOriginIsolated, 'threads', ort.env.wasm.numThreads);

// 3. Timpi pe faze
const t0 = performance.now();
const session = await ort.InferenceSession.create(buf, {
  executionProviders: await pickEP(),
  // enableGraphCapture: true,             // doar dacă shape-urile sunt statice
});
console.log('session', performance.now() - t0);
```

Plus: `ort.env.logLevel = 'verbose'` ca să vezi ce noduri ajung pe CPU, și `disable_cpu_ep_fallback` pentru rularea „dovedește că e pe GPU".

### Criteriu de decizie (propus, nu măsurat)

Demo-ul de browser e acceptabil dacă, pe Mașina A, **1 cameră la 1080p** ține ≥5 fps end-to-end **și** detectarea nu depășește ~2× referința nativă pe CPU (28 ms). Sub asta, rămâne demo local/nativ și browserul e doar „uite ce se poate".

---

## 7. Riscuri, în ordinea în care ne pot strica ziua

| # | Risc | De ce e probabil | Mitigare |
|---|---|---|---|
| 1 | **WebGPU nu e pornit pe 780M** (AMD = „others", în spatele flag-urilor pe Linux) | Wiki gpuweb + blogul Chrome 144 spun explicit că rollout-ul Linux a început cu Intel | Rulează din start ambele căi; pune flag-urile în run sheet și într-un script de lansare; verifică `chrome://gpu` înainte de demo. Dacă nu iese, demo-ul e pe WASM și o spunem. |
| 2 | **WASM single-thread pe Pages** | Pages nu poate trimite COOP/COEP | Fie `coi-serviceworker` (acceptat, cu reload la prima vizită), fie găzduire cu headere (Netlify/Cloudflare Pages/Vercel) doar pentru build-ul de demo. Nu promite multi-threading pe Pages fără una din ele. |
| 3 | **Cold start dominat de runtime, nu de modele** (~29,5 MB WASM vs 9,5 MB greutăți) | dimensiuni npm 1.31.1 | Precache (Cache API/service worker), warm-up înainte de a intra pe scenă, spinner cu progres real. Dacă oricum nu avem WebGPU, build-ul `wasm` e 14,8 MB — jumătate. |
| 4 | **Fallback silențios pe CPU** (`Shape`/`Reshape` fără kernel GPU) | tabelul de operatori ORT | `logLevel='verbose'` + `disable_cpu_ep_fallback` în măsurători; raportează câte noduri rulează pe CPU. |
| 5 | **WebGPU mai lent decât WASM pe modele mici** | la noi, YuNet pe iGPU prin ncnn a fost **33 ms vs 26 ms** pe CPU — transferul domină | Nu presupune că GPU-ul câștigă; A/B per model; YuNet poate rămâne pe CPU chiar când YOLO e pe GPU. |
| 6 | **Shape-uri dinamice ⇒ recompilare/pierderea graph capture** | docs graph capture + `Shape` fără kernel | Îngheață rezoluția de intrare (`freeDimensionOverrides`), redimensionează înainte de sesiune, nu între rulări. |
| 7 | **Primul cadru îngheață UI-ul pe scenă** | compilare de shadere + primul `run()` | Warm-up la încărcare, nu la primul cadru real; rulează inferența în worker (import direct în worker, nu `env.wasm.proxy`). |
| 8 | **Presupunerea că „merge în Firefox/Safari"** | Firefox Linux = doar Nightly; Safari = doar 26+ | Demo pe Chrome, punct. Orice alt browser se anunță ca „neconfirmat". |

---

## 8. Ce e măsurat, ce e ipoteză, ce e neconfirmat

**Măsurat (de noi, nativ, în `docs/performance.md`):** 28 ms / 17,9 ms detect, 26 ms YuNet, 14,4–20,1 fps la 3 camere, 7,5 fps YOLO ONNX fp32, 62,9 vs 26,7 ms int8, 33 vs 26 ms YuNet pe iGPU.

**Măsurat (dimensiuni de fișier, metadate npm/jsDelivr 1.31.1):** 29,5 MB `jsep.wasm`, 14,8 MB `wasm`, 70,7 KB `ort.webgpu.min.mjs`.

**Ipoteză (de transformat în măsurătoare):** orice cifră de tip „cold start durează X", „single-thread înseamnă de N ori mai lent", „WebGPU pe 780M dă Y fps", „compresia reduce transferul la Z".

**Neconfirmat:** comportamentul exact al ORT Web când `webgpu` e cerut fără adaptor disponibil; dacă GitHub Pages comprimă `.wasm`; shape-ul exact al YuNet 2023mar în exportul nostru; dacă pipeline-urile se recompilează la schimbarea rezoluției la 1920.

---

## Surse

- ORT Web, `executionProviders` și `env.wasm`: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- ORT Web, WebGPU (IO binding, graph capture): https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- ORT Web, diagnoză de performanță: https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html
- ORT Web, modele mari și limite de memorie: https://onnxruntime.ai/docs/tutorials/web/large-models.html
- ORT, EP WebGPU (fallback pe CPU, graph capture): https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html
- ORT, tabelul de operatori WebGPU: https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md
- ORT, design: scoaterea backend-ului WebGL: https://github.com/microsoft/onnxruntime/blob/main/docs/design/onnxruntime_web_remove_webgl_backend.md
- Stare WebGPU pe browsere: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- Chrome 144, WebGPU pe Linux: https://developer.chrome.com/blog/new-in-webgpu-144
- Chrome, troubleshooting WebGPU: https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- caniuse WebGPU: https://caniuse.com/webgpu
- MDN, WebGPU API: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- MDN, SharedArrayBuffer (cerințe de securitate): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
- web.dev, cross-origin isolation: https://web.dev/articles/cross-origin-isolation-guide
- GitHub, headere custom pe Pages: https://github.com/orgs/community/discussions/54257 , https://github.com/orgs/community/discussions/13309
- COOP/COEP pe hosting static: https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages
- coi-serviceworker: https://github.com/gzuidhof/coi-serviceworker
- Dimensiuni pachet `onnxruntime-web@1.31.1`: https://data.jsdelivr.com/v1/packages/npm/onnxruntime-web@1.31.1?structure=flat
- WebAssembly SIMD (128 biți): https://github.com/WebAssembly/simd
