# Performanță — ce s-a măsurat și ce e închis

> **Material istoric — nu se mai rulează.** Document istoric SafeSight (edge Python): toate
> cifrele de aici au fost măsurate pe pipeline-ul Python din `ml/`, care a fost **șters din
> acest fork**; comenzile și referințele din text nu mai rulează aici. Pentru motorul din
> browser, cifrele valabile sunt în [browser-engine.md](browser-engine.md) și
> [qa/perf-findings.md](qa/perf-findings.md).

Document de lucru pentru cine atinge pipeline-ul de edge. Toate cifrele sunt măsurate pe laptopul de dezvoltare (Ryzen 7 7840HS, 8 nuclee fizice / 16 fire, Radeon 780M, OpenCV 5.0, YOLO26n, YuNet 2023mar), pe clipurile din `data/videos`. Pe alt hardware cifrele absolute se schimbă; rapoartele și concluziile s-au ținut.

## Unde se duce timpul

O cameră, 1080p, prin `--metrics-json`:

```text
etapă        torch           ncnn (Vulkan)
read          2 ms             2 ms
detect       28 ms (ACTIVE)   17,9 ms (GPU)
            55 ms (PASSIVE)
blur         26 ms (4 fire)   la fel — rulează pe live și la evenimente, nu pe fiecare cadru
overlay      13–19 ms         la fel — doar pe cadrul scris, nu pe fiecare cadru
```

Trei camere, camera urmărită:

```text
                     torch        ncnn
cadre/s              14,4–14,8    20,0–20,1
CPU total edge       835%         497%
detect pe edge       92–94 ms     40 ms (GPU-ul se serializează între edge-uri)
```

Concluzia de start pentru orice optimizare: **detectarea e 85–90% din bucla de edge**. Blur-ul și overlay-ul par scumpe în tabel, dar rulează de câteva ori pe secundă, nu de 20 de ori.

## Cum se măsoară fără să te mintă

- `--metrics-json` scrie `stages` (calls, mean_ms, total_s) și `live` (passes, render_ms, face_pass_ms, motive de drop). Ăsta e începutul oricărei optimizări; `stages` fără el e ghicit.
- **Omoară edge-urile rămase înainte de fiecare rulare.** Un filtru de kill care se uită la PID în loc de executabil nu omoară nimic, iar rulările se acumulează: măsurătorile „după" devin cu 30–50% mai rele decât cele „înainte" și arată ca regresii inexistente.
- **Intercalează A/B** (torch, ncnn, torch, ncnn), nu rula serii. Laptopul derapează termic: aceeași configurație a dat 19,4 fps și, o oră mai târziu, 17,5.
- `live_fps` se măsoară doar cât timp un client e conectat la `/stream`; altfel cadrul nu se scrie și cifra e 0.
- Pentru CPU real, nu `ps %CPU` (medie de la pornire): citirea `/proc/<pid>/stat` în două momente.

## Ce e închis, cu dovezi

| Idee | Rezultat |
|---|---|
| Micșorarea cadrului la 720p | −87% fețe găsite (62 → 8 pe clipul principal). 1920 rămâne. |
| Model de fețe int8 (block-quant) | Fețe egale sau mai multe, dar viteză amestecată și **nu rulează în ONNX Runtime** (block quantization nesuportată). |
| `top_k` la NMS-ul YuNet | Zero efect: 450–520 ms la orice valoare. |
| BlazeFace (mediapipe) | 0 fețe din 191 — antrenat pe fețe de selfie. |
| EgoBlur Gen 2 | Funcționează, dar 2,6 s/cadru pe CPU. |
| Decupaje din jurul persoanelor | De 16–57× mai rapid, dar recall 79% / 54%: muncitorii depărtați nu intră în nicio cutie YOLO. |
| Detectare din N în N cadre | 3 camere: 19,8 → 12,0 fps. Writer-ul de live ține fiecare cadru până la o trecere YuNet, iar trimiterile duble îl sufocă. |
| Mai multe fire pentru pass-ul de fețe | 1/2/4 fire → 20,2 / 20,3 / 20,5 fps. Live-ul nu e limitat de pass. |
| Pinning pe nuclee + `OMP_WAIT_POLICY=ACTIVE` | 9–13 fps, sub `PASSIVE` (14,4). |
| Batching pe 2–3 cadre | 1,07–1,12×. Nu merită arhitectura. |
| YOLO prin ONNX Runtime (fp32) | Paritate cu torch la 8 fire; **7,5 fps** end-to-end la 3 camere (ultralytics dă toate firele sesiunii). |
| YOLO int8 (QDQ calibrat pe cadrele noastre) | 62,9 ms vs 26,7 — de 2,4× mai lent. |
| `imgsz` 512 / 448 | Recall pe persoane: 94% / 97% pe un clip, **15% / 0%** pe altul. 640 rămâne. |
| YuNet pe iGPU prin ncnn | 33 ms vs 26 ms pe CPU — modelul e prea mic, overhead-ul de transfer domină. |
| `--live-width` 960 (cadru live mai mic) | Fără câștig măsurabil; redimensionarea costă cât economisește. |

## Portabilitate (mașini diferite)

- **Firele se numără în nuclee fizice**, nu în fire hardware: 16 fire logice pe 8 nuclee înseamnă 8, nu 15. `--share-cpu N` (pus de `dev.py` după numărul de camere) împarte nucleele și lasă unul liber pentru API/JPEG/OS. `--threads N` forțează.
- **`OMP_WAIT_POLICY`**: implicit libgomp ține firele în așteptare activă. Cu trei edge-uri pe aceeași mașină asta înseamnă 0,6 fps în loc de 14,6. `run.py` îl setează pe `PASSIVE`; prețul e ~15% pe inferență (23,3 vs 20,3 ms) și merită doar când mașina e împărțită.
- **Blur-ul de fețe** folosește `CUDAExecutionProvider` / `ROCMExecutionProvider` când există; iGPU-urile rămân pe CPU intenționat.
- **Detectarea** merge pe iGPU prin ncnn + Vulkan (`--backend ncnn`, `uv sync --extra ncnn`). Dispozitivele software (llvmpipe, swiftshader) sunt sărite explicit: `get_gpu_count()` le numără și ar fi ales un renderer CPU drept „GPU".
- **YOLO pe torch folosește automat CUDA** dacă există; nu e nevoie de configurare.

## Ce rămâne deschis

1. **Arhitectura writer-ului de live.** Bucla de edge e limita (20 fps cu ncnn), iar writer-ul ține fiecare cadru până la o trecere YuNet. Un writer care rulează independent de buclă ar putea scoate mai mult, dar atinge garanția „niciun cadru neinspectat".
2. **Un proces pentru mai multe camere, cu batch pe GPU.** Măsurat și respins: un proces cu trei detectoare ncnn susține **47,9 detecții/s**, iar cele trei procese de azi dau ~58/s (20,4 + 20,5 + 17,7 cadre/s). Contextele Vulkan separate nu costă ce credeam; consolidarea ar fi muncă mare pentru mai puțin throughput.
3. **Detectarea de capete** în loc de fețe: capul e o țintă mai mare, iar blur-ul pe cutia capului acoperă fața prin construcție. Necesită adnotări proprii (CrowdHuman e non-comercial).
4. **Alt detector pentru fețe mici** (SCRFD-2.5G/10G): ~17 GFLOPs la 1920, deci doar pe GPU, unde iGPU-ul nostru are ~90 GB/s de bandwidth partajat — de măsurat, nu de presupus.
