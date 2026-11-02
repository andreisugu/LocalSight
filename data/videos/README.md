# Video-uri de test

Câte un clip pentru fiecare caz din demo. Clipurile `.mp4` nu intră în git; le păstrăm în folderul comun din Drive, sub `SafeSight/data/videos/`.

> ## Statut legal — NECESITĂ ACȚIUNE
>
> **Proveniența clipurilor e nerezolvată.** Coloanele *Sursă*, *Licență* și *Cine a filmat*
> scriu `de completat` pentru toate cele șase clipuri: nu există nici sursă documentată, nici
> licență, nici operator de cameră, nici acord scris de la persoanele din cadru.
>
> **Ce înseamnă concret:**
>
> - clipurile **nu sunt curățate** pentru redistribuire comercială și nu sunt acoperite de
>   licența BSL a codului; nu se inventează o licență pe care nu o avem;
> - cele trei taieri web din `frontend/public/media/*.mp4` **sunt** comise în git și servite
>   de build-ul static, deci se distribuie chiar dacă sursele 4K nu sunt în repo; la fel
>   `zone-*.jpg` (cadre re-encodate din ele) și capturile din `docs/assets/`;
> - pentru orice demo public, pilot plătit sau instanță găzduită: **completează drepturile
>   sau înlocuiește clipurile** cu material pe care îl deținem.
>
> **Checklist per clip** (dovada se păstrează într-un loc durabil, nu într-un chat):
>
> - [ ] sursă: cine deține înregistrarea și camera (aeroport / operator), numit;
> - [ ] licență sau permisiune **scrisă**, cu scopul: demo intern / demo public / redistribuire comercială;
> - [ ] operator de cameră, numit;
> - [ ] dată și loc (apron / terminal);
> - [ ] acord scris de la voluntarii identificabili — blur-ul e mitigare, nu substitut de consens;
> - [ ] conținut terț în cadru (livery, logo-uri, plăcuțe, ecrane);
> - [ ] fișiere derivate trecute în listă: cele trei taieri web, cele trei `zone-*.jpg`, capturile din `docs/assets/`;
> - [ ] verificare manuală a exportului: nicio față neblurată în ce se publică.
>
> Context complet: [`docs/legal/model-provenance.md`](../../docs/legal/model-provenance.md) §4 și
> [`THIRD_PARTY.md`](../../THIRD_PARTY.md). Licențele modelelor sunt rezolvate; filmările, nu.

| Caz | Fișier (în Drive) | Sursă | Licență | Cine a filmat | Data |
|---|---|---|---|---|---|
| Persoană în zona motorului | `videos/2026-10-30_restricted-zone_cam01_persoana-langa-motor.mp4` | de completat | de completat | de completat | 2026-10-30 |
| Persoane lângă motor la pushback | `videos/2026-10-30_restricted-zone_cam02_lucratori-pushback-motor..mp4` | de completat | de completat | de completat | 2026-10-30 |
| B-roll marshaller cu conuri | `videos/2026-10-30_broll_cam01_marshaller-conuri-apron.mp4` | de completat | de completat | de completat | 2026-10-30 |
| B-roll avion la poarta de bagaje | `videos/2026-10-30_broll_cam02_avion-la-poarta-bagaje.mp4` | de completat | de completat | de completat | 2026-10-30 |
| B-roll lucrători cu veste pe apron | `videos/2026-10-30_broll_cam03_lucratori-cu-veste-apron.mp4` | de completat | de completat | de completat | 2026-10-30 |
| B-roll tractor de bagaje | `videos/2026-10-30_broll_cam04_tractor-bagaje-apron.mp4` | de completat | de completat | de completat | 2026-10-30 |

## Reguli

- Un clip cu avionul în față, **fără persoană, PPE sau fum**, este B-roll pentru pitch. Nu se folosește ca test de detecție.
- Numele fișierului: `YYYY-MM-DD_<caz>_<camera>_<descriere>.mp4`.
- După upload, completează rândul din tabel cu sursa, licența, cine a filmat și data.
- Acord scris pentru voluntari; fețele se blurează înainte de publicare.

## Setul curent

Sunt 4 clipuri B-roll și 2 clipuri `restricted-zone`. Lipsește încă:

- clip video pentru PPE lipsă.

`reference_frames/` are 2 cadre PPE, iar `annotations/` are 2 etichete YOLO validate vizual de Andrei pe 31 octombrie 2026. Setul rămâne mic, pentru demo/experiment, nu pentru antrenare de producție.

Numele `...pushback-motor..mp4` are două puncte; de corectat la următorul upload.
