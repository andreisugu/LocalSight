# Run sheet — LocalSight în browser (90 de secunde)

Demo-ul curent nu are backend: tot pipeline-ul rulează în tab, pe build-ul static de la
<https://andreisugu.github.io/LocalSight/>. Run sheet-ul vechi (`run_sheet.md`) descrie
demo-ul SafeSight pe `ml/` + `backend/` și rămâne material istoric.

## T-10 minute: preflight

1. Deschide linkul într-un tab nou și fă **Ctrl+Shift+R** (să nu prinzi un bundle vechi).
2. Verifică în Live, în cardul „Motor & senzori":
   - implicit vezi **doar detecții reale**; incidentele din fixtures sunt ascunse, iar KPI-urile care nu pot fi derivate arată „— / fără date demo”. Pentru demo-ul cu fixtures: **Sistem & Audit → Date demo → Arată incidentele demo**.
   - pe **Firefox**: `MODEL DETECȚIE: YOLO26n · wasm`, motorul e **oprit** implicit;
   - pe **Chrome/Edge**: dacă există adapter WebGPU, motorul pornește singur; altfel pornește-l tu.
3. Pornește motorul o dată și așteaptă primul cadru (2–3 s). Trebuie să vezi cutii `PERSON`,
   fețele blurate și ~5–6 fps pe WASM (4 fire, cadru 1280). Dacă nu apare nimic în 30 s, oprește-l și
   repornește; watchdog-ul îl mută singur pe WASM dacă providerul cerut se blochează.
4. Deschide `/zones` și verifică fundalul: primul cadru din clipul camerei, nu panou negru.
5. Deschide `/bench` doar dacă vrei cifre; nu face parte din demo.

Ce să nu promiți: nu există Slack, nu există backend, nu există persistență între reload-uri.

## T-0: 90 de secunde

| Timp | Ce faci | Ce spui |
|---|---|---|
| 0–10 s | Live, camera CAM-01 | „Camerele existente devin un flux de siguranță, nu doar înregistrare. Tot ce urmează rulează în acest tab." |
| 10–20 s | Arată feed-ul gol și KPI „—” | „Implicit nu vezi date inventate. Pornești motorul și apar doar detecțiile reale; fixture-urile demo se activează explicit din Setări." |
| 20–35 s | „Pornește motorul în browser" | „Se descarcă modelele o dată, apoi fiecare cadru e detectat local: persoane, fețe blurate înainte de desenare, veste hi-vis. Fără server." |
| 35–45 s | Urmărește o cutie `PERSON`, badge-ul PPE și poligonul zonei | „Tracker-ul ține aceeași persoană între cadre; PPE are nevoie de câteva cadre până să decidă, de aceea apare și `PPE ?`. Zona urmărește solul când camera se mișcă; dacă alinierea se pierde, scrie «aliniere pierdută» și regulile tac." |
| 45–60 s | Click pe un incident `local` din feed | „Incidentul are dovada procesată, severitate, cronologie și un raport șablon — nu AI, și scrie asta." |
| 60–70 s | „Confirmă" | „Operatorul confirmă; escaladarea se oprește. Human-in-the-loop." |
| 70–80 s | „Copiază link" din detaliu | „Linkul e stabil și se poate trimite mai departe; Slack nu e conectat în build-ul static." |
| 80–90 s | Rapoarte Tură | „Raportul se calculează din incidentele vizibile: total, critice, timp mediu de confirmare, deschise. Sursa e marcată `șablon`." |

## Rezerve, dacă ceva nu merge

- **Nu apare niciun incident în 60 s**: zona `engine-left` e mică; deschide `/zones`, mărește
  poligonul peste zona în care intră oamenii din clip, salvează, întoarce-te în Live. Motorul
  nu repornește; zona se aplică la revenire.
- **Fps prea mic pentru public**: spune cifra reală și arată `/bench`; nu ascunde WASM-ul.
  Alternativ, folosește meniul **Simulare** și spune explicit „eveniment simulat”.
- **Motorul intră în eroare**: interfața ascunde fluxul brut intenționat și afișează mesajul.
  Oprește și repornește; dacă persistă, demonstrează pe fixture-uri și explică fail-closed.
- **Camera locală**: CAM-LOCAL cere permisiune; dacă e refuzată, rămâi pe clipuri, nu insista.

## Ce e real, ce e demo

| Real, în tab | Demo / fixture |
|---|---|
| YOLO26n + YuNet + tracker + zone + reguli | KPI-urile din strip și incidentele fără chip `local` |
| Blur pe fețe înainte de desenare, fail-closed | Raportul de incident (șablon, nu LLM) |
| Detecția de vestă hi-vis și starea PPE | Escaladarea din fixture-uri |
| Incidentele engine, cu snapshot procesat | Camera din browser (flux local, doar cu permisiune) |

## Limite pe care le spui tu primul

- WASM cu 4 fire prin service worker COOP/COEP: ~5–6 fps cu cadru 1280; fără el, 1,5–1,8 fps.
- Firefox: WebGPU e ignorat intenționat (0,4–0,7 fps și instabil); Chrome/Edge pot folosi GPU-ul.
- Nimic nu pleacă în rețea; starea se pierde la reload; snapshot-urile trăiesc în memorie.
