# Scenariu demo — SafeSight (3 minute)

> **Material istoric — nu se mai rulează.** Scenariul demo-ului SafeSight: planul de
> prezentare pentru implementarea de referință (backend Python, Slack, ack, raport), păstrat
> ca record. Nu e scenariul produsului: demo-ul curent e showcase-ul static din
> [`README.md`](../README.md), iar direcția e
> [`docs/browser-engine.md`](../docs/browser-engine.md).

Responsabile: Ariana (prezentare + înregistrare OBS), Dalina (clipuri de test + recuzită).

## Caz principal: persoană în zona motorului
Clip folosit: `2026-10-30_restricted-zone_cam02_lucratori-pushback-motor.mp4` (Drive → data/videos).
Demo-ul livrat a rulat însă pe CAM-01, `2026-10-30_restricted-zone_cam01_persoana-langa-motor.mp4`
(clipul implicit din `scripts/dev.py`); vezi `run_sheet.md`.

## Cazuri opționale (doar dacă avem clipuri verificate până la demo)
- PPE lipsă.
- Fumul rămâne stretch — nu intră în demo.

## Cei 10 pași (3 minute)
1. (15 s) Intro: problema — riscuri pe platforma aeroportuară, reacție târzie.
2. (15 s) Arătăm dashboard-ul cu camera live / clipul de test pornit.
3. (30 s) Persoana intră în zona motorului → detectorul o marchează (bounding box).
4. (20 s) Alerta apare în interfață: tip, cameră, oră, severitate.
5. (20 s) Se generează raportul AI (automation/report.py) — ce, unde, când, acțiune recomandată.
6. (15 s) Arătăm fallback-ul: dacă LLM-ul pică, apare șablonul românesc (source="template").
7. (15 s) Notificarea Slack cu textul formatat (fără imagini, fără butoane).
8. (15 s) Escaladarea: alerta trece la supervisor dacă nu e confirmată.
9. (20 s) Privacy: video-ul nu iese din aeroport, fețele se blur-ează.
10. (15 s) Încheiere: ce urmează (PPE, fum) + întrebări.

## Versiunea scurtă (dacă rămânem fără timp)
Sărim direct la pașii 2, 3, 4 și 9.

## Rezervă
Înregistrare OBS a demo-ului (Ariana), în caz că pică ceva live.

