# Run sheet — SafeSight, 90 de secunde

> **Material istoric — demo-ul SafeSight pe implementarea de referință.** Descrie run-ul de
> hackathon (trei camere, Slack, ack, raport de tură) pe `ml/` + `backend/`; rămâne aici ca
> record al ce s-a construit, nu ca demo al produsului. **Nu rula comenzile de mai jos:**
> `./run.sh`, `run.cmd` și `scripts/dev.py` au fost șterse odată cu stack-ul Python. Demo-ul
> curent e showcase-ul static din [`README.md`](../README.md), cu pașii din
> [`run_sheet_browser.md`](run_sheet_browser.md), iar direcția e
> [`docs/browser-engine.md`](../docs/browser-engine.md).

Scop: mentorii înțeleg problema, văd incidente reale pe mai multe camere în UI și pleacă cu limitele clare.

## T-10 minute: preflight

```bash
./run.sh doctor
```

- închide alte procese pe `:8000` și `:5173` (sau folosește `--backend-port` / `--frontend-port`);
- închide orice antrenare sau proces greu pe GPU: demo-ul rulează 3 edge-uri în paralel;
- opțional, pentru demo curat (fără incidentele din repetiții):

```bash
rm -f backend/safesight.db
rm -rf backend/snapshots
```

- pornește stack-ul:

```bash
./run.sh demo
```

Pornește backend-ul, frontend-ul și câte un edge pe fiecare cameră, fiecare pe clipul lui, în buclă:

| Cameră | Clip | Ce arată |
|---|---|---|
| CAM-01 Stand 12 | persoană lângă motor | intrare în zona motorului (`RESTRICTED_ZONE`, CRITICAL) |
| CAM-02 Taxiway B | marshaller cu conuri | feed live; regula e `PPE_REQUIRED` — incident doar dacă cineva nu are vestă, iar în clip toți au |
| CAM-03 Baggage area | avion la poarta de bagaje (4K, citit la 1920 px) | feed live; regula e `PPE_REQUIRED` — incident doar dacă cineva nu are vestă, iar în clip toți au |

- deschide `http://localhost:5173`;
- lasă 60–90 s: CAM-01 dă primul incident în primul minut, apoi cel mult unul pe minut; CAM-02 și CAM-03 arată feed-ul adnotat, dar pe aceste clipuri nu au ce raporta;
- verifică în terminal liniile `Edge: <cameră> <- <clip>` pentru toate trei; un mesaj `edge <cameră> s-a oprit` înseamnă că acea cameră a rămas pe ultimul cadru;
- dacă nu apare niciun incident după 90 s:

```bash
python scripts/dev.py fallback
```

- dacă Slack nu e configurat (`SLACK_WEBHOOK_URL` în `.env`), spune din start: „notificarea Slack e simulată în acest mediu”.

## T-0: 90 de secunde

| Timp | Ce faci | Ce spui |
|---|---|---|
| 0–10 s | Live, CAM-01 | „Camerele existente devin un flux de siguranță, nu doar înregistrare.” |
| 10–25 s | Feed-ul adnotat: zonă roșie, persoane cu track, etichetă `vesta` | „Persoana intră în zona motorului; e urmărită de la un cadru la altul, iar zona rămâne pe asfalt chiar dacă camera se mișcă.” |
| 25–35 s | Meniul **Cameră** → CAM-03, apoi CAM-02 | „Aceeași procesare pe fiecare cameră, în paralel: detecție, tracking, blur. Aici regula e echipamentul de protecție și toți poartă vestă, deci camerele astea tac.” |
| 35–50 s | Click pe un card CRITICAL → **Incidente & XAI**; snapshot, cronologie, raport | „Alerta are dovadă blurată, severitate, timp și un raport de incident.” |
| 50–58 s | Click **Acknowledge (Confirmă)** | „Operatorul confirmă; escaladarea se oprește. Human-in-the-loop.” |
| 58–66 s | Arată mesajul Slack | „Slack primește text + link, fără imagini și fără butoane.” |
| 66–78 s | Click **Rapoarte Tură** | „KPI pe tură, distribuție pe tipuri, rezumat. Fals pozitivele nu intră în total — se numără separat. Acoperirea arată minutele în care o cameră a fost oarbă.” |
| 78–85 s | Click **Edge & Audit** | „Totul rulează la margine: detecție, tracking, blur și decizia. Backend-ul primește doar evenimentul, nu video.” |
| 85–90 s | Închide cu privacy | „Video-ul brut nu iese din aeroport; fețele sunt blurate la edge înainte de orice salvare.” |

### Opțional: `NO_PPE` live cu webcam-ul

În clipuri toți poartă vestă, deci alerta `NO_PPE` nu se declanșează pe ele. O arăți live cu camera laptopului, care rulează în locul celor 3 clipuri:

```bash
python scripts/dev.py demo --webcam    # repornește stack-ul doar cu webcam-ul (camera baggage-area)
```

- Stai la 2–3 m, cu tot corpul în cadru; o casetă tăiată de margine rămâne `vesta ?`.
- Cu vestă fluorescentă (portocalie sau galben-verde): eticheta `vesta`, fără incident.
- Fără vestă: `FARA VESTA` după ~1 s, apoi incident `NO_PPE` (WARNING) în Live.
- Fața ta e blurată la edge, la fel ca pe clipuri.
- Repetă pe laptopul și în lumina de la prezentare: încă n-a fost testat pe camera laptopului de demo.

Spune: „Alerta pentru vestă e activă și prudentă: pleacă doar când lipsa vestei e sigură.”

Plan B, dacă webcam-ul nu prinde: trimiți evenimentul manual, pe aceleași rute ca edge-ul.

```bash
python scripts/dev.py fallback --type NO_PPE
```

### Opțional: camera moartă devine incident (90 s)

Fiecare edge trimite heartbeat prin poll-ul de configurație (la 30 s). Oprește unul:

```bash
# în terminalul run.sh: Ctrl-C pe linia „edge <camera>” (sau închide laptopul de demo pe acea cameră)
```

- după `CAMERA_OFFLINE_AFTER_S` (implicit 90 s) apare un singur `CAMERA_OFFLINE` (WARNING), cu snapshot placeholder și fără escaladare
- repornește edge-ul: primul heartbeat rezolvă incidentul (`status: resolved`, acțiune „recovered”) și închide fereastra de orbire din raport
- în **Rapoarte Tură**, „Acoperire camere” scade cu minutele cât a fost oarbă

Spune: „camera care tace nu mai e o gaură în pază: devine incident, iar revenirea îl închide singură.”

## Dacă ceva pică

- **Nu apare incident:** `python scripts/dev.py fallback`; evenimentul apare în UI.
- **O cameră îngheață:** alege alta din meniul **Cameră**; terminalul arată ce edge s-a oprit.
- **Laptopul nu ține 3 camere:** repornește cu `python scripts/dev.py demo --cameras stand12`.
- **Feed-ul live nu merge:** sari la incident + raport + rapoarte; spune că feed-ul e plan B.
- **Slack nu răspunde:** arată log-ul „notification simulated”; nu pretinde că a plecat.
- **Raportul e template:** spune „source=template; LLM-ul e opțional”.

## Ce nu spui

- „`NO_PPE` apare pe clipuri” — nu apare: în clipuri toți poartă vestă. Live îl arăți doar cu webcam-ul sau prin fallback.
- „Model PPE antrenat” — dataset-ul există, antrenarea nu e terminată.
- „0% falsuri” — avem un eșantion mic, verificat vizual; rata de falsuri nu e măsurată.
- „Trei incidente, câte unul pe cameră” — doar CAM-01 produce. CAM-02 și CAM-03 arată feed-ul adnotat, iar regula lor (`PPE_REQUIRED`) nu găsește pe nimeni fără vestă în clipuri.
- „Camere live din aeroport” — clipurile sunt reale (stock), redate ca flux live.
- „Camera offline e prinsă instant” — pragul e 90 s (3 heartbeats ratate); sub asta ar fi zgomot la fiecare microîntrerupere.
- „Alertele ajung garantat în Slack” — coada garantează că nu se pierd la timeout sau restart; dacă Slack e jos mai mult de ~2 minute, rândul rămâne `failed` și se vede în `/health`.
- „Producție gata” — auth, audit, retenție și camere reale sunt roadmap.

## Întrebări probabile

**Ce e real?**
YOLO26 + ByteTrack, zonele care urmăresc camera, eticheta de vestă după culoare, blurul, backend-ul, UI-ul, ack-ul, escaladarea, raportul, watchdog-ul de cameră, coada de notificări cu retry, testele.

**Ce e stock sau simulat?**
Clipurile (stock, filmate din mână, redate în buclă ca 3 camere), operatorul, `NO_PPE` doar dacă e trimis prin fallback (cu webcam-ul e real), Slack dacă nu e webhook, raportul dacă nu e cheie Groq.

**De ce se mișcă zona în video?**
Clipurile sunt filmate cu telefonul. Zona e desenată pe primul cadru și urmărește solul (potrivire de puncte + omografie). Pe o cameră fixă de aeroport nu ar fi nevoie.

**Cum știți dacă are vestă?**
Azi, după culoarea fluorescentă pe trunchi, cu trei stări: `vesta`, `FARA VESTA`, `vesta ?`. „Fără vestă” se afirmă doar pe persoane mari în cadru și detectate sigur; pe cele 6 clipuri, 0 cadre marcate greșit. Următorul pas e modelul PPE antrenat pe ~25.000 de imagini.

**Cât de rapid?**
Cu 3 camere în paralel, pe un laptop cu RTX 3050: 19,5 / 29,7 / 14,6 FPS (CAM-01 / CAM-02 / CAM-03). Remăsoară pe laptopul de demo.

**Cât de stabil e?**
5 minute RTSP pe o cameră: 8.697 cadre, 28,99 FPS, 0 căderi.

**Ce urmează?**
O cameră reală pentru pilot, modelul PPE antrenat și alerta `NO_PPE`, auth.

## După demo

```bash
# Ctrl-C în terminalul run.sh
rm -f backend/safesight.db
rm -rf backend/snapshots
```
