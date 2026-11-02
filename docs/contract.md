# Contractul dintre module

> **Document istoric — SafeSight (backend + edge).** Descrie contractul dintre procesul Python
> de edge și API-ul FastAPI, nu motorul din browser; doar forma plicului de eveniment se
> păstrează în port. Direcția actuală: [browser-engine.md](browser-engine.md).

Versiunea 2.2 · 1 noiembrie 2026. FOD scos din scope. Produs de referință: **SafeSight**, implementarea pe care LocalSight o portează în browser; plicul de eveniment și formatul `event_id` rămân valabile, transportul HTTP (`POST /edge/events`) nu. Aliniat la briefingurile Ultra A–D. Responsabil: Max (backend). Orice schimbare se face prin pull request aprobat de cel afectat.

Față de 2.1, aditiv: `POST /edge/heartbeat`, `GET /events?from&to`, câmpurile `coverage` / `total_events` / `false_positives` din raportul de tură și semantica lui `notified_at` (livrare cu retry). Nimic nu s-a șters sau redenumit.

Contractul are două fețe: ce trimite edge-ul (A) și ce întoarce backend-ul (B). C consume doar forma returnată de B. Un câmp care nu apare aici nu se inventează în alt modul.

## Evenimentul trimis de edge (A → B)

```json
{
  "event_id": "evt_stand12_1793356933120_17",
  "type": "RESTRICTED_ZONE",
  "severity": "CRITICAL",
  "camera_id": "stand12",
  "zone_id": "engine-left",
  "track_id": 17,
  "confidence": { "detector": 0.91, "temporal": { "seen": 14, "window": 15 } },
  "duration_s": 1.4,
  "context": { "engine_on": true },
  "snapshot_url": "/snapshots/evt_stand12_1793356933120_17.jpg",
  "model": "person-ppe-v1",
  "detected_at": "2026-10-30T10:42:13.120Z"
}
```

Edge **nu** trimite `status`, `report`, `received_at`, `notified_at`, `escalated_at`, `acked_at` sau `acked_by`. Acestea sunt câmpuri de backend; un payload care le conține se respinge cu `422`.

| Câmp | Tip | Regulă |
|---|---|---|
| `event_id` | string | `evt_<camera_id>_<unix_ms>_<track_id>`; unic, cheia de idempotență. |
| `type` | enum | `RESTRICTED_ZONE`, `NO_PPE`, `SMOKING`, `CAMERA_OFFLINE`. `CROWD` e rezervat. |
| `severity` | enum | Doar `CRITICAL` sau `WARNING`. `RESOLVED` este status, nu severitate. |
| `camera_id` | string | ID-ul din seed: `stand12`, `taxiway-b`, `baggage-area`. |
| `zone_id` | string | ID-ul zonei din seed sau din editorul lui C. |
| `track_id` | int | ID ByteTrack. `0` pentru evenimente fără track de persoană (cameră offline). |
| `confidence` | object | `{ detector: 0–1, temporal: { seen, window } }`. Nu șir, nu float simplu. |
| `duration_s` | float | Timpul în zonă. |
| `context` | object | `{ engine_on: bool }` la momentul detecției. |
| `snapshot_url` | string | URL HTTP relativ, servit de `GET /snapshots/{file}`. Niciodată `minio://`. |
| `model` | string | Nume și versiune, ex. `person-ppe-v1`. |
| `detected_at` | string | ISO 8601 UTC, cu milisecunde. |

## Evenimentul returnat de backend (B → C)

```json
{
  "event_id": "evt_stand12_1793356933120_17",
  "type": "RESTRICTED_ZONE",
  "severity": "CRITICAL",
  "status": "open",
  "camera_id": "stand12",
  "zone_id": "engine-left",
  "track_id": 17,
  "confidence": { "detector": 0.91, "temporal": { "seen": 14, "window": 15 } },
  "duration_s": 1.4,
  "context": { "engine_on": true },
  "snapshot_url": "/snapshots/evt_stand12_1793356933120_17.jpg",
  "model": "person-ppe-v1",
  "detected_at": "2026-10-30T10:42:13.120Z",
  "received_at": "2026-10-30T10:42:13.310Z",
  "notified_at": "2026-10-30T10:42:14.920Z",
  "escalated_at": null,
  "acked_at": null,
  "acked_by": null,
  "report": {
    "what": "Persoană în zona motorului stâng, cu motorul pornit.",
    "where": "Stand 12, zona engine-left.",
    "when": "10:42:13, timp în zonă 1,4 s.",
    "severity_reason": "Motorul e pornit; risc de ingestie sau jet blast.",
    "recommended_action": "Oprește activitatea la Stand 12. Contactează persoana prin radio.",
    "source": "llm"
  }
}
```

| Câmp | Sursă | Regulă |
|---|---|---|
| `status` | B | `open` la ingestie; apoi `acknowledged`, `false_positive`, `escalated` sau `resolved`. |
| `received_at` | B | Momentul validării. `received_at − detected_at` = latența de ingestie. |
| `notified_at` | B | Momentul primei livrări reale către Slack. `null` cât timp alerta nu a plecat: încercările eșuate nu îl umplu. |
| `escalated_at` | B | Momentul escaladării; `null` dacă operatorul a confirmat la timp. |
| `acked_at`, `acked_by` | B | Operatorul și momentul confirmării; se copiază și în `event_actions`. |
| `report` | B + D | Cele cinci câmpuri + `source` (`llm` sau `template`); `null` până la generare. |

Nu există status intermediar `verifying`. Fumul este stretch și se emite doar după răspunsul VLM; dacă VLM-ul nu confirmă, nu există eveniment.

## Endpoint-uri

### Edge → backend

| Metodă | Endpoint | Rol | Auth |
|---|---|---|---|
| POST | `/edge/events` | ingestie eveniment; idempotentă după `event_id` | `X-Edge-Token` |
| POST | `/edge/snapshots` | upload JPEG; întoarce `snapshot_url` HTTP | `X-Edge-Token` |
| GET | `/edge/zones?camera_id=stand12` | zone active, `engine_on`, `config_version`; poll la 30 s | `X-Edge-Token` |
| POST | `/edge/heartbeat` | dovada că edge-ul camerei e viu; body `{ "camera_id": "stand12" }` | `X-Edge-Token` |

`GET /edge/zones` **contează și ea ca heartbeat**: un edge care face deja poll la 30 s nu are nevoie de cod nou. Fără heartbeat, o cameră sănătoasă care nu vede nicio violare ar fi indistinguibilă de una moartă.

### Frontend → backend

| Metodă | Endpoint | Rol |
|---|---|---|
| GET | `/cameras` | camere, `rtsp_url`, `online`, `engine_on` |
| PUT | `/cameras/{camera_id}/engine` | setează `engine_on`; body `{ "on": true }`; doar demo |
| GET | `/zones?camera_id=stand12` | zonele pentru editor |
| PUT | `/zones/{zone_id}` | salvează zona; A o reîncarcă fără restart |
| POST | `/zones/reference-frame` | salvează cadrul de referință al zonei (fundalul din editor) |
| GET | `/events?status=open&severity=CRITICAL` | lista de evenimente, filtre combinabile |
| GET | `/events?from=2026-10-30T06:00:00Z&to=2026-10-30T14:00:00Z` | filtre de timp, combinabile cu celelalte; `to` exclusiv |
| GET | `/events/{event_id}` | detaliu: dovadă, cronologie, raport |
| POST | `/events/{event_id}/ack` | confirmare; body `{ "operator": "Ana" }` |
| POST | `/events/{event_id}/false-positive` | fals pozitiv; body `{ "operator": "Ana", "note": "..." }` |
| POST | `/events/{event_id}/reopen` | redeschide; repornește timerul |
| POST | `/events/{event_id}/regenerate-report` | regenerează raportul (LLM sau șablon) |
| GET | `/reports?shift=morning&date=2026-10-30` | raportul de tură, inclusiv rezumatul |
| GET | `/kpi?date=2026-10-30&shift=morning` | PPE, incidente deschise, latență, escaladări |
| GET | `/snapshots/{file}` | imaginea, deja blurată; HTTP, niciodată `minio://` |
| GET | `/stream/{camera_id}.mjpg` | video adnotat MJPEG; plan B: snapshot la 500 ms |
| WS | `/ws/events` | doar `event.created` și `event.updated` |
| GET | `/health` | stare API, DB, edge și coada de notificări (`notifications`: `pending`, `failed_24h`, `oldest_pending_s`) |

Mesajele WebSocket: `{"type": "event.created" | "event.updated", "data": { ...eveniment complet... }}`. Nu există `context.updated`; starea motorului se citește din `GET /cameras`, iar KPI din `GET /kpi` la 5 s.

## Camera offline

B o generează singur, pe baza heartbeat-ului; edge-ul nu trimite niciodată `CAMERA_OFFLINE`.

- sistemul ține ultimul heartbeat per cameră; după `CAMERA_OFFLINE_AFTER_S` (implicit `90` s = 3 heartbeats ratate la 20 s) deschide **un singur** eveniment per cădere
- `type`: `CAMERA_OFFLINE`, `severity`: `WARNING`, `track_id`: `0`
- `zone_id`: **`camera_id`** — o cameră moartă nu ține de o zonă; raportul de tură exclude tipul din `by_zone` și îl numără la acoperire
- `snapshot_url`: `/snapshots/placeholder.jpg` — când camera e moartă nu există cadru, iar un cadru vechi ar fi o minciună
- `model`: `watchdog-v1`; `confidence.detector`: `1.0` (evenimentul e cert, nu detectat)
- nu se escaladează: nu are sens să ceri unui operator să confirme ceva ce nu poate vedea
- la primul heartbeat după cădere: camera revine `online`, incidentul trece în `resolved`, se scrie `EventAction(action="recovered", operator="system")` și pleacă o notificare de revenire

## Zona

```json
{
  "id": "engine-left",
  "camera_id": "stand12",
  "name": "Motor stâng",
  "rule_type": "RESTRICTED",
  "active_when": "engine_on",
  "required_ppe": [],
  "severity": "CRITICAL",
  "debounce_s": 1.0,
  "escalate_after_s": 30,
  "notify_channel": "slack",
  "polygon": [[0.46, 0.16], [0.76, 0.16], [0.76, 0.68], [0.46, 0.68]],
  "reference_frame": null
}
```

- `rule_type`: `RESTRICTED`, `PPE_REQUIRED`, `NO_SMOKING`; `CROWD_WATCH` rezervat.
- `active_when`: `always`, `engine_on`; `schedule` rămâne roadmap.
- `polygon`: coordonate normalizate 0–1 față de cadru, nu pixeli, în ordine pe contur. Laturile nu se pot intersecta (fără „clepsidre”); `PUT /zones/{id}` răspunde `422` altfel.
- `debounce_s`: durata minimă în zonă.
- `escalate_after_s`: per zonă; `null` = fără escaladare. Seed demo `30`, producție `120`.
- `notify_channel`: `slack` în demo; Teams/SMS/radio rămân roadmap.

## A → B: snapshot și eveniment

1. A decodează cadrul, rulează detecția și tracking-ul, aplică regula pe zonă.
2. A blurează fețele **înainte** de orice salvare sau upload.
3. A face `POST /edge/snapshots` și primește `snapshot_url`.
4. A face `POST /edge/events` cu payload-ul de mai sus.
5. B validează, salvează, emite `event.created`, trimite Slack și pornește raportul.

`FrameResult` este un tip intern al lui A; nu traversează granița dintre module. Pentru demo, A și B pot rula în același container, dar contractul rămâne HTTP.

## B → D: raportul

B apelează `automation.report.generate(event)` în proces, nu printr-un endpoint. Modulul D primește evenimentul, alege acțiunea din tabelul fix pe tip și cere LLM-ului doar reformularea. Rezultatul se scrie în `report_texts`, iar B emite `event.updated`.

- Model: Groq configurabil prin `GROQ_MODEL`; default `openai/gpt-oss-20b` (producție, JSON mode). `qwen/qwen3.8-27b` rămâne candidat de test (preview). Temperatură 0,2.
- Fallback: șablonul completează aceleași câmpuri din JSON, cu `source=template`.
- `POST /events/{event_id}/regenerate-report` există doar pentru C; nu înlocuiește apelul în proces al lui B.
- Notificarea Slack pleacă imediat, cu text + link, fără să aștepte raportul.

## Raportul de tură (B → C)

`GET /reports?shift=morning&date=2026-10-30` întoarce cifrele turei plus un sumar de 2–3 propoziții.

- **false pozitivele nu sunt incidente.** `by_type`, `by_zone`, `total_events`, severitățile și `avg_ack_s` se calculează doar pe evenimente cu `status != false_positive`; fals pozitivele apar separat, în `false_positives` și în câmpul `false_positive` al fiecărui rând.
- `total_events` = incidente, `false_positives` = numărul lor, ambele explicite (C nu le mai deduce din `by_type`).
- `by_hour` are **exact cele 8 ore ale turei**, în ordinea turei (noaptea `22, 23, 00…05`), cu `count: 0` unde nu s-a întâmplat nimic. Un grafic fără orele goale minte prin comprimare.
- `by_zone` nu conține `CAMERA_OFFLINE`; tipul intră în `coverage`.
- `coverage`: per cameră și total, minutele de orbire din tură și procentul acoperit. `null` dacă nu există camere cunoscute în fereastră.
- `resolution_rate` = incidente confirmate / incidente (`null` când nu există incidente). `alerted_incidents` = incidente cu `notified_at` setat.
- sumarul se generează o dată la 3 s buget, apoi se refolosește cât timp cifrele nu se schimbă (`?refresh=true` forțează). Două reîncărcări ale aceleiași ture nu dau două texte diferite.

## Decizii canonicate

- `event_id`, nu `id`; `snapshot_url`, nu `snapshot` sau `minio://`.
- `confidence` este obiect, nu șir „14/15 cadre”.
- Severitate doar `CRITICAL` / `WARNING`; `RESOLVED` este status.
- Statusuri: `open`, `acknowledged`, `false_positive`, `escalated`, `resolved`.
- SQLite prin SQLModel; Postgres doar plan B.
- Slack incoming webhook, text + link, fără imagini și fără butoane.
- Escaladare per zonă.
- O alertă nu se pierde: B scrie evenimentul și notificarea în aceeași tranzacție, apoi reîncearcă. `notified_at` se setează doar la primul succes real; un rând eșuat definitiv rămâne în evidență.
- `CAMERA_OFFLINE` e generat de B din heartbeat, nu trimis de edge; un singur incident per cădere, `resolved` la revenire.
- Demo fără login: câmp `operator`; JWT/SSO și audit sunt roadmap.
- Numele produsului: SafeSight.
- Groq pentru raport (default `openai/gpt-oss-20b`), Claude Haiku pentru VLM (stretch).
- B apelează modulul D în proces; nu există `PATCH /events/{id}` din automatizare.

## Decizii tehnice

- **Model de detecție: YOLO26.** Nu YOLO11 și nu generații mai vechi. `YOLO26s` pentru acuratețe, `YOLO26n` dacă FPS-ul scade sub 10. `YOLO11s` rămâne doar fallback dacă YOLO26 nu converge pe PPE sau nu exportă pe edge; orice schimbare se anunță înainte de demo.
- Licența YOLO se verifică înainte de orice demo comercial.
