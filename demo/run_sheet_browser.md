# Run sheet — LocalSight în browser (90 de secunde)

Demo-ul curent nu are backend: tot pipeline-ul rulează în tab, pe build-ul static de la
<https://andreisugu.github.io/LocalSight/>. Run sheet-ul vechi (`run_sheet.md`) descrie
demo-ul SafeSight pe `ml/` + `backend/` și rămâne material istoric.

## T-10 minute: preflight

1. Deschide linkul într-un tab nou și fă **Ctrl+Shift+R** (să nu prinzi un bundle vechi).
2. Verifică în Live, în cardul „Motor & senzori":
   - implicit vezi **doar detecții reale**; incidentele din fixtures sunt ascunse, iar KPI-urile care nu pot fi derivate arată „— / fără date demo”. Pentru demo-ul cu fixtures: **Sistem & Audit → Date demo → Arată incidentele demo**.
   - pe **Firefox**: `MODEL DETECȚIE: EfficientDet-Lite0 · wasm`, motorul e **oprit** implicit;
   - pe **Chrome/Edge**: motorul pornește la cerere pe WASM; WebGPU nu e folosit pentru EfficientDet.
3. Pornește motorul o dată și așteaptă primul cadru (2–3 s). Trebuie să vezi cutii `PERSON`,
   fețele blurate și ~8–9 fps cu Lite0 pe WASM (cadru 1280; ~4–5 fps cu Lite2 la 448 px).
   Dacă nu apare nimic în 30 s, oprește-l și repornește; watchdog-ul îl mută singur pe WASM
   dacă providerul cerut se blochează.
4. Opțional, dar recomandat pentru demo: în cardul „Motor & senzori”, **Calibrare sol** pe CAM-03 (camera cu persoana detectabilă) — 4 clicuri pe colțurile unui dreptunghi de sol și 10 × 10 m. Calibrarea se salvează per cameră și trece reload-ul; fără ea, lista de viteze scrie „necalibrat”, nu inventează cifre.
5. Deschide `/zones` și verifică fundalul: primul cadru din clipul camerei, nu panou negru.
6. Opțional, doar dacă vrei să arăți procesarea tuturor camerelor: **Sistem & Audit → Camere în fundal** (OFF implicit). Pornește câte un worker per cameră la ~0,5 fps; consumă aproximativ 3× memoria/CPU. Nu-l lăsa pornit pe un laptop mic în timpul demo-ului.
7. Deschide `/bench` doar dacă vrei cifre; nu face parte din demo.

Ce să nu promiți: nu există Slack, nu există backend. Incidentele, acțiunile și acoperirea trăiesc în memorie; calibrarea solului și preferințele din Setări trec reload-ul.

## T-0: 90 de secunde

| Timp | Ce faci | Ce spui |
|---|---|---|
| 0–10 s | Live, camera CAM-01 | „Camerele existente devin un flux de siguranță, nu doar înregistrare. Tot ce urmează rulează în acest tab." |
| 10–20 s | Arată feed-ul gol și KPI „—” | „Implicit nu vezi date inventate. Pornești motorul și apar doar detecțiile reale; fixture-urile demo se activează explicit din Setări." |
| 20–30 s | Selectează **CAM-03 • Bagaje** și „Pornește motorul în browser" | „Clipurile demo sunt generate din still-uri licențiate, fără footage cu provenance necunoscut. Se descarcă modelele o dată, apoi fiecare cadru e detectat local: persoane, fețe blurate înainte de desenare. Fără server." |
| 30–40 s | Urmărește cutia `PERSON` pe CAM-03 și zona „Zona bagaje — banda 2" | „Tracker-ul ține aceeași persoană între cadre; zona e restricționată, deci intrarea declanșează incidentul. Zona urmărește solul când camera se mișcă; dacă alinierea se pierde, scrie «aliniere pierdută» și regulile tac." |
| 40–50 s | Coada de triaj, implicită când există un incident deschis | „Nu e o listă cronologică: escaladat, apoi severitate, termen și vechime. Fiecare rând spune de ce stă acolo și cât mai are până la escaladare. `H` pe un critic răspunde «Criticele nu pot fi amânate»." |
| 50–62 s | `Enter` pe rândul `local` | „Incidentul are dovada procesată, severitate, cronologie și un raport șablon — nu AI, și scrie asta." |
| 62–72 s | `A` sau „Confirmă" | „Operatorul confirmă; escaladarea se oprește. Human-in-the-loop." |
| 72–80 s | Înapoi în Live, „Calibrare sol" și lista de viteze | „Calibrarea e per cameră și se salvează local. Viteza e orientativă, din punctul de sprijin al fiecărui track; fără calibrare scrie «necalibrat»." |
| 80–86 s | „Copiază link" din detaliu | „Linkul e stabil și se poate trimite mai departe; Slack nu e conectat în build-ul static." |
| 86–90 s | Rapoarte Tură, panoul „Acoperire cameră" | „Raportul se calculează din incidentele vizibile; acoperirea arată doar cât a rulat motorul în acest tab — live, tab ascuns și pauze, fără cifre inventate." |

## Rezerve, dacă ceva nu merge

- **Nu apare niciun incident în 60 s**: verifică să fii pe **CAM-03 • Bagaje** (CAM-01 are doar
  lucrători mici, la distanță) și că zona „Zona bagaje — banda 2" e activă. Nu mări zona peste
  tot cadrul doar ca să forțezi un incident; schimbă camera.
- **Fps prea mic pentru public**: spune cifra reală și arată `/bench`; nu ascunde WASM-ul.
  Alternativ, folosește meniul **Simulare** și spune explicit „eveniment simulat”.
- **Motorul intră în eroare**: interfața ascunde fluxul brut intenționat și afișează mesajul.
  Oprește și repornește; dacă persistă, demonstrează pe fixture-uri și explică fail-closed.
- **Camera locală**: CAM-LOCAL cere permisiune; dacă e refuzată, rămâi pe clipuri, nu insista.

## Ce e real, ce e demo

| Real, în tab | Demo / fixture |
|---|---|
| EfficientDet-Lite0/Lite2 + YuNet + tracker + zone + reguli | KPI-urile din strip și incidentele fără chip `local` |
| Blur pe fețe înainte de desenare, fail-closed | Raportul de incident (șablon, nu LLM) |
| Detecția de vestă hi-vis și starea PPE | Escaladarea din fixture-uri |
| Coada de triaj, deadline-urile și hold-ul pe WARNING | Pragurile și starea vin din evenimentele reale; acțiunile sunt în memorie |
| Calibrarea solului și viteza per track | Viteza e indicatorie, pe cadrul de referință; fără calibrare scrie „necalibrat" |
| Acoperirea camerei din eșantioanele sesiunii | Doar cât a rulat motorul în tab; nu se salvează |
| Incidentele engine, cu snapshot procesat | Camera din browser (flux local, doar cu permisiune) |

## Limite pe care le spui tu primul

- Modelul: **greutăți Apache-2.0 (Google), fără AGPL; conversia ONNX e CC BY 3.0** — de aici
  și detectorul, nu din YOLO. Atribuirea e în „Licențe" (`dist/NOTICE`).
- WASM cu 4 fire prin service worker COOP/COEP: ~8–9 fps cu Lite0 la cadru 1280 (~4–5 fps cu
  Lite2); fără el, 1,5–1,8 fps.
- EfficientDet rulează pe WASM în toate browserele; WebGPU rămâne experiment în `/bench` (0,1 fps pe adapter software, nefolosit în Live).
- Nimic nu pleacă în rețea; starea se pierde la reload; snapshot-urile trăiesc în memorie.
