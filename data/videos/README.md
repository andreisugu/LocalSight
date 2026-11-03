# Video-uri demo

**Starea curentă (3 noiembrie 2026):** clipurile demo livrate sunt **generate de proiect**
din două still-uri cu licență clară, nu sunt footage de aeroport cu provenance necunoscută:

| Fișier livrat | Sursă | Licență | Note |
|---|---|---|---|
| `frontend/public/media/stand12.mp4` | `frontend/public/media/stills/apron-stand.jpg` (Unsplash) | Unsplash License | pan/zoom lent pe apron; lucrătorii sunt mici, motorul îi vede doar de aproape |
| `frontend/public/media/taxiway-b.mp4` | același still Unsplash, alt crop | Unsplash License | plan larg de apron; fără persoane în prim-plan |
| `frontend/public/media/baggage-area.mp4` | `frontend/public/media/stills/baggage-hall.jpg` (CC0, djedj/Pixabay) | CC0 | close-up pe persoana de la banda de bagaje; camera pe care rulează incidentul demo |
| `frontend/public/media/stills/zone-*.jpg` | primele cadre din clipurile generate | proiect | folosite ca referință pentru editorul de zone |

Clipurile sunt derivate ale still-urilor de mai sus; Unsplash License nu cere atribuire și
permite modificarea, CC0 nu are restricții. Nu există un al treilea footage cu provenance
necunoscută în arborele curent.

## Ce s-a scos

Clipurile 4K originale din Drive și web cut-urile derivate din ele **nu mai sunt în build**.
Tabelul lor rămâne aici doar ca istoric; nu le re-folosiți fără să completați sursa, licența,
operatorul și consimțământul. Ele pot exista în istoricul git al fork-ului; un repo nou
(curat) nu le mai are.

| Caz istoric | Fișier (Drive) | Sursă | Licență | Cine a filmat | Data |
|---|---|---|---|---|---|
| Persoană în zona motorului | `videos/2026-10-30_restricted-zone_cam01_persoana-langa-motor.mp4` | de completat | de completat | de completat | 2026-10-30 |
| Persoane lângă motor la pushback | `videos/2026-10-30_restricted-zone_cam02_lucratori-pushback-motor..mp4` | de completat | de completat | de completat | 2026-10-30 |
| B-roll marshaller cu conuri | `videos/2026-10-30_broll_cam01_marshaller-conuri-apron.mp4` | de completat | de completat | de completat | 2026-10-30 |
| B-roll avion la poarta de bagaje | `videos/2026-10-30_broll_cam02_avion-la-poarta-bagaje.mp4` | de completat | de completat | de completat | 2026-10-30 |
| B-roll lucrători cu veste pe apron | `videos/2026-10-30_broll_cam03_lucratori-cu-veste-apron.mp4` | de completat | de completat | de completat | 2026-10-30 |
| B-roll tractor de bagaje | `videos/2026-10-30_broll_cam04_tractor-bagaje-apron.mp4` | de completat | de completat | de completat | 2026-10-30 |

## Reguli

- Nu adăuga footage nou fără sursă, licență scrisă, operator și consimțământ pentru persoanele
  identificabile; blur-ul este mitigare, nu consimțământ.
- Pentru un clip nou generat din still-uri, documentează still-ul sursă și licența lui aici.
- Numele fișierului: `YYYY-MM-DD_<caz>_<camera>_<descriere>.mp4`.
- Fețele se blurează înainte de publicare; verifică exportul cu ochiul, nu doar cu motorul.

`reference_frames/` și `annotations/` rămân materiale de proiect; nu conțin imagini third-party
noi.
