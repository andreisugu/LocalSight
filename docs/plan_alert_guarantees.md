# Plan — Alertă garantată și Raport de tură corect

> **Document istoric — SafeSight (backend).** Planul livrat pentru outbox/retry, watchdog de
> cameră și raport de tură într-un backend cu Slack; nu se aplică motorului din browser.
> Direcția actuală: [browser-engine.md](browser-engine.md).

Status: **aprobat** (2026-11-01). Livrate: PR 1 (outbox, #94), PR 4.1–4.4 (numărare corectă, ore complete, sumar persistat, acoperire) și PR 2 (watchdog de cameră) în PR-ul curent.
Rămân: scara de escaladare cu mai multe trepte (C) și drill-down-ul din raport în listă.
Branch: `feat/alert-guarantees`, worktree separat, bazat pe `origin/main` (30e4692).
Autor: agent paralel (nu atinge `ml/safesight_ml/suggest.py`, care e în lucru pe `feat/auto-zones`).

---

## 0. De ce

Fluxul „detecție → alertă" funcționează pe drumul fericit, dar nu are nicio garanție de livrare, iar raportul de tură numără greșit. Ambele sunt exact lucrurile pe care un juriu le testează cu o întrebare simplă: „și dacă Slack pică?" / „cifra asta include false pozitive?".

Dovezi din cod (nu impresii):

| Constatare | Dovadă |
|---|---|
| Alerta se trimite o singură dată, fără retry | `backend/app/services/notify.py:15-31` |
| Eșecul nu lasă nicio urmă | `notified_at` rămâne `null`, niciun rând de „încercare" |
| `CAMERA_OFFLINE` nu e produs de nimeni | grep: apare doar în enum-uri, `models.py:52`, `schemas.py:15` |
| `resolved` e stare inaccesibilă | `services/events.py:170-174` — doar `reopen` o acceptă ca sursă |
| Raportul numără false pozitivele | `services/kpi.py:79-84` — `by_type` pe toate evenimentele |
| Sumarul se regenerează la fiecare GET | `services/kpi.py:141-158`, fără cache |
| Se vede doar ziua curentă | `frontend/src/services/api.js` — `shiftDate()` ignoră tura |
| Raportul nu se împrospătează | `SecurityContext.jsx` — effect cu dependență `[selectedShift]` |
| Orele goale lipsesc din grafic | `services/kpi.py:120-125` |

---

## 1. Constrângeri care decid designul

1. **Fără migrații.** `init_db()` face doar `SQLModel.metadata.create_all` (`backend/app/db.py:53`). O coloană nouă pe un tabel existent **nu** apare într-un `safesight.db` deja creat. Deci: numai **tabele noi**; zero coloane noi pe `events`, `cameras`, `zones`, `report_texts`.
2. **`docs/contract.md` se schimbă doar prin PR separat, aprobat de toți consumatorii** (`AGENTS.md:31`). Orice endpoint sau câmp nou în contract = PR 0, înaintea codului.
3. **Fără dependențe noi.** Outbox-ul, watchdog-ul și cache-ul se fac cu `asyncio` + SQLite. Fără Redis, fără Celery, fără APScheduler.
4. **`main` rămâne rulabil.** Fiecare pas e independent funcțional și are teste proprii.
5. **Demo-ul nu se schimbă implicit.** Comportamentul nou e activat prin `Settings`, cu valori care nu strică scenariul din `demo/run_sheet.md`.

---

## 2. Scop și non-scop

**În scop (acest plan):**
- A. livrare garantată a alertei (outbox + retry + urmă de livrare)
- B. watchdog de cameră: `CAMERA_OFFLINE` real + revenire
- C. scară de escaladare (mai multe trepte)
- D. raport de tură corect (fără false pozitive, ore complete, sumar stabil, selector de dată, auto-refresh, acoperire camere, CSV, drill-down)

**Nu în scop (se loghează în `POSTPONED.md` al masterplanului):**
- detector FOD real (`FOD_WATCH` în pipeline) — cere model antrenat
- `SMOKING` prin VLM — stretch, cum zice contractul
- agregare incidente cu contor (`occurrences`) — cere câmp nou în contract
- MTTR (necesită semantică de `resolved_at`)
- canale multiple (Teams/SMS/radio) — roadmap în contract
- autentificare operator

---

## 3. PR 0 — delta de contract (separat, aprobat înainte de cod)

Fișier: `docs/contract.md`. Trei modificări, toate **aditive**:

### 3.1 Endpoint nou: `POST /edge/heartbeat`

```
POST /edge/heartbeat          auth: X-Edge-Token
body: { "camera_id": "stand12" }
200:  { "ok": true, "online": true }
```

Rol: dovada că edge-ul camerei e viu. Fără el, o cameră sănătoasă care nu vede nicio violare e indistinguibilă de una moartă (evenimentele sunt singurul semnal, iar absența lor e normală).

`GET /edge/zones?camera_id=` **contează și ea ca heartbeat** — edge-urile care fac deja poll la 30 s nu au nevoie de cod nou.

### 3.2 `GET /events` — filtre de timp

```
GET /events?from=2026-10-30T06:00:00Z&to=2026-10-30T14:00:00Z
```
Ambele opționale, combinabile cu `status`, `severity`, `camera_id`, `limit`. Necesare pentru drill-down din raportul de tură.

### 3.3 `ShiftReport` — câmpuri aditive

`Kpi` primește `resolution_rate: float | none` și `alerted_incidents: int`.
`ShiftReport` primește `total_events: int`, `false_positives: int`, `coverage: dict`.
Rândurile din `by_type` / `by_zone` primesc `false_positive: int` (sunt `list[dict]`, deci nu e breaking).
Consumatorul C le poate ignora; nu se șterge și nu se redenumește nimic.

### 3.4 Decizie cerută: `zone_id` pentru `CAMERA_OFFLINE`

Contractul cere `zone_id` ne-gol, dar o cameră moartă nu ține de o zonă. Opțiuni:

| | Variantă | Cost |
|---|---|---|
| O1-a | `zone_id = camera_id` | zero schimbare de contract; raportul exclude `CAMERA_OFFLINE` din `by_zone`, deci nu poluează |
| O1-b | sentinel `"__camera__"` | zero schimbare; arată urât în UI |
| O1-c | `zone_id` devine `null` pentru acest tip | schimbare de contract, mai corect semantic |

**Recomandare: O1-a acum, O1-c ca propunere separată.** Planul de mai jos presupune O1-a.

---

## 4. Model de date (doar tabele noi)

```python
class NotificationOutbox(SQLModel, table=True):
    __tablename__ = "notification_outbox"
    id: int | None = Field(default=None, primary_key=True)
    event_id: str = Field(index=True)
    kind: str                      # "new" | "escalation:1" | "escalation:2" | "recovery"
    channel: str = "slack"
    text: str                      # randat la enqueue, ca retry-ul să trimită identic
    status: str = Field(default="pending", index=True)   # pending | sent | failed | cancelled
    attempts: int = 0
    next_attempt_at: datetime = Field(index=True)
    last_error: str | None = None
    created_at: datetime
    sent_at: datetime | None = None
    # UNIQUE(event_id, kind)


class EdgeHeartbeat(SQLModel, table=True):
    __tablename__ = "edge_heartbeat"
    camera_id: str = Field(primary_key=True)
    last_seen_at: datetime
    source: str = "edge"           # "edge" | "assumed" (grație la pornire)
    outage_event_id: str | None = None   # un singur incident per cădere


class CameraOutage(SQLModel, table=True):
    __tablename__ = "camera_outages"
    id: int | None = Field(default=None, primary_key=True)
    camera_id: str = Field(index=True)
    event_id: str
    started_at: datetime = Field(index=True)
    ended_at: datetime | None = None


class ShiftSummary(SQLModel, table=True):
    __tablename__ = "shift_summaries"
    id: str = Field(primary_key=True)      # f"{shift}:{date}"
    numbers_hash: str
    summary: str
    source: str                            # llm | template
    generated_at: datetime
```

De ce așa:
- `text` randat la enqueue → retry-ul nu poate trimite alt text decât primul (altfel un retry după 30 s ar spune altă oră).
- `UNIQUE(event_id, kind)` → enqueue idempotent; un restart nu dublează alertele.
- `outage_event_id` → un singur `CAMERA_OFFLINE` per cădere, nu unul la fiecare tick de watchdog.
- `CameraOutage` separat de heartbeat → istoricul de acoperire nu se pierde când camera revine.
- `ShiftSummary` ține doar textul + hash-ul cifrelor → cifrele rămân live, textul rămâne stabil.

---

## 5. A. Livrare garantată

### 5.1 Flux nou la ingestie

`ingest()` nu mai cheamă direct `notify_new_event`. În schimb:

```
ingest → tx(insert event) → enqueue_outbox(event_id, "new", render_slack_text(...))
       → worker outbox (task asyncio, la 1 s)
            scoate rândurile due, în ordinea next_attempt_at
            send_slack(text)
              succes → status=sent, sent_at=now
                       dacă kind=="new" și event.notified_at is None:
                           notified_at=now, broadcast event.updated
              eșec   → attempts+=1, last_error=..., next_attempt_at=now+backoff
```

Backoff: `1, 2, 4, 8, 15, 30, 60` s, apoi `failed` după 8 încercări (~2 min). Un rând `failed` **rămâne** în tabel: dovada că alerta nu a plecat, vizibilă în `/health`.

### 5.2 Ce garantează și ce nu (formulare onestă pentru demo)

- **Garantează:** alerta nu se pierde la o cădere de rețea, la un 429 sau la un restart al backend-ului. Fiecare încercare e consemnată.
- **Nu garantează:** că Slack acceptă mesajul. Dacă Slack e jos 2 minute, alerta pleacă la revenire, cu textul original și ora originală, nu cu ora retrimiterii.

### 5.3 `/health` extins

`notifications: {pending, failed_24h, oldest_pending_s}`. Deja e câmp liber în contract.

### 5.4 Fără webhook configurat

`send_slack` întoarce `False` când `SLACK_WEBHOOK_URL` e gol — comportamentul rămâne „simulat". Outbox-ul marchează rândul `failed` cu `last_error="no webhook configured"` **o singură dată** (nu-l retryează la infinit). `notified_at` rămâne `null`, corect: nu s-a trimis nimic. Pentru demo se setează webhook-ul; altfel KPI-ul de latență rămâne „—" și spunem de ce.

---

## 6. B. Watchdog de cameră

### 6.1 Pornire (grație)

La `lifespan`:
```
pentru fiecare cameră fără rând în edge_heartbeat:
    insert(EdgeHeartbeat(camera_id, last_seen_at=now, source="assumed"))
```
Fără grație, un demo pornit înainte de edge-uri ar deschide 3 incidente false în prima secundă.

### 6.2 Buclă

Task asyncio la 10 s, activ doar dacă `camera_offline_after_s > 0` (default **90** = 3 heartbeats ratate la 20 s):

```
pentru fiecare cameră cu online=True și last_seen_at < now - prag:
    event_id = f"evt_{camera_id}_{ms}_0"        # track_id 0, ca în contract
    ingest_camera_offline(camera, event_id)     # refolosește ingest(): Slack, raport, WS
    edge_heartbeat.outage_event_id = event_id
    insert(CameraOutage(camera_id, event_id, started_at=last_seen_at))
```

- un singur incident per cădere (`outage_event_id` nenul → skip)
- `severity=WARNING` (potrivit cu `automation/report.py`, care mapează `CAMERA_OFFLINE` pe WARNING) — **decizie O2**, vezi §12
- `snapshot_url="/snapshots/placeholder.jpg"` (există, generat de seed) — onest: când camera e moartă nu există cadru
- `zone_id = camera_id` (O1-a)
- escaladarea e deja exclusă pentru acest tip (`services/escalation.py:27`)
- raportul de incident: șablonul există deja (`services/report.py:47`)

### 6.3 Revenire

`POST /edge/heartbeat` (sau `GET /edge/zones`) cu camera în `offline`:
```
camera.online = True
event.status = "resolved"                     # prima tranziție reală către resolved
EventAction(action="recovered", operator="system")
CameraOutage.ended_at = now
enqueue_outbox(event_id, "recovery", "Camera X a revenit după M min")
broadcast event.updated
```

Asta rezolvă și constatarea 6 din §0: `resolved` devine o stare atinsă real, fără endpoint nou public.

### 6.4 Edge

`ml/safesight_ml/run.py`: `--heartbeat-s 20` (0 = oprit). Într-un thread daemon, la interval, `POST /edge/heartbeat` cu timeout 2 s, erorile doar se loghează. Nu blochează bucla de detecție.
Dacă `--remote-config` e pornit, poll-ul existent e suficient — nu se schimbă nimic pe edge.

---

## 7. C. Scară de escaladare

Păstrează contractul: `zone.escalate_after_s` = **prima** treaptă. Restul vin din `Settings`:

```
escalation_steps_s: str = "120,300"   # absolute, de la detected_at; "" = doar prima treaptă
```

- fiecare treaptă = un rând în outbox (`kind="escalation:{n}"`), deci livrare garantată separat
- `status="escalated"` se setează doar la prima treaptă (contractul nu are „escalated de 2 ori")
- `escalated_at` rămâne primul moment
- ack / false-positive anulează toate treptele viitoare (`cancelled`), inclusiv cele deja în outbox dar netrimise
- `recover_timers()` recalculează la ce treaptă suntem după restart, nu repornește de la 0

---

## 8. D. Raport de tură corect

### 8.1 Reguli de numărare (fix de corectitudine)

```
incident(e)      = e.status != "false_positive"
FP(e)            = e.status == "false_positive"
```

- `by_type`, `by_zone`, `total_events`, severități → **doar incidente**
- `false_positives` → numărat separat, pe tip și pe zonă
- `avg_ack_s` → doar incidente confirmate
- `open_incidents` → neschimbat ca semantică (open + escalated), dar calculat pe incidente
- `resolution_rate = confirmed / incidents`
- `alerted_incidents` = incidente cu `notified_at != null` → arată câte alerte au plecat real
- `CAMERA_OFFLINE` **nu** intră în `by_zone` (nu e zonă) și **nu** intră în `by_type` (nu e incident de operator); intră în `coverage`

### 8.2 Ore complete

`by_hour` acoperă toate cele 8 ore ale turei, în ordinea turei (noaptea: 22, 23, 00…05), cu `count=0` unde nu s-a întâmplat nimic. Graficul nu mai minte prin comprimare.

### 8.3 Sumar stabil (cache pe hash)

```
numbers = compute(...)                      # ieftin, SQLite
h = sha256(canonical_json(numbers))
row = get(ShiftSummary, f"{shift}:{date}")
dacă row și row.numbers_hash == h și age < summary_ttl_s (900) și not refresh:
    folosește row.summary
altfel:
    summary, source = await generate(numbers)   # LLM, 3 s buget, lock per (shift,date)
    upsert(row)
```

Rezultat: `GET /reports` nu mai cheamă LLM-ul la fiecare load; două reload-uri dau același text; `?refresh=true` forțează regenerarea (buton în UI).

### 8.4 Acoperire camere

Din `camera_outages`, intersectat cu fereastra turei:
```
coverage = 1 - (minute_cameră_offline / (8h * camere_văzute_în_tură))
```
`camere_văzute` = camere cu cel puțin un heartbeat în fereastră (altfel numitorul se umflă cu camere care nu există în demo).

### 8.5 Frontend (`ReportsView.jsx`)

- selector de dată (`<input type="date">`), implicit ziua operațională calculată deja de `shiftDate()`
- badge „în curs" pe tura curentă
- auto-refresh: refetch la `event.updated` cu debounce 5 s + la 30 s cât timp view-ul e montat
- card nou „Acoperire camere" + minute offline
- buton „Regenerează sumarul" → `?refresh=true`
- export CSV lângă Export PDF (construit în frontend, fără backend)
- drill-down: click pe rândul din `by_zone`/`by_type` → setează filtrul în `SecurityContext` și navighează la Incidente (fără rutare pe URL, care nu există încă)

---

## 9. Fișiere atinse

| Fișier | Schimbare | Risc conflict |
|---|---|---|
| `docs/contract.md` | PR 0, aditiv | mare (aprobare), dar izolat |
| `backend/app/models.py` | 4 tabele noi | mic |
| `backend/app/services/outbox.py` | nou | zero |
| `backend/app/services/notify.py` | enqueue în loc de send direct | mic |
| `backend/app/services/watchdog.py` | nou | zero |
| `backend/app/services/escalation.py` | trepte + anulare | mic |
| `backend/app/services/events.py` | hook enqueue, recovery | **mediu** (îl atinge și agentul live? nu, el e pe `suggest.py`/`dev.py`) |
| `backend/app/services/kpi.py` | reguli de numărare, ore, cache | mic |
| `backend/app/routers/edge.py` | `/heartbeat`, heartbeat din `/zones` | mic |
| `backend/app/routers/events.py` | `from`/`to` | mic |
| `backend/app/routers/reports.py` | `refresh` | mic |
| `backend/app/routers/health.py` | stare outbox | mic |
| `backend/app/main.py` | pornire/oprire worker + watchdog | mic |
| `backend/app/config.py` | 4 setări noi | mic |
| `ml/safesight_ml/run.py` | `--heartbeat-s` | mic (alt fișier decât al agentului live) |
| `frontend/src/components/views/ReportsView.jsx` | dată, refresh, acoperire, CSV, drill-down | mic |
| `frontend/src/context/SecurityContext.jsx` | refresh raport, filtru drill-down | **mediu** — agentul live are modificări necomise aici |

`SecurityContext.jsx` e singurul punct care se poate ciocni. Regulă: la merge, se rebazează pe `main` după ce agentul live își comite munca; conflictele se rezolvă manual, nu prin „ours/theirs".

---

## 10. Teste (se scriu înainte de cod)

`backend/tests/`:

- `test_outbox.py`
  - ingest → exact un rând `pending`
  - eșec de rețea → `attempts` crește, `next_attempt_at` crește, rândul rămâne `pending`
  - succes după 2 eșecuri → `sent`, `notified_at` setat **o singură dată**
  - enqueue dublu (restart) → `UNIQUE(event_id, kind)`, un singur rând
  - fără webhook → `failed` imediat, fără retry infinit
  - 8 eșecuri → `failed`, apare în `/health`
- `test_watchdog.py`
  - cameră fără heartbeat, înainte de prag → niciun eveniment
  - după prag → exact un `CAMERA_OFFLINE`, `camera.online=False`
  - încă un tick → **nu** al doilea eveniment
  - heartbeat → `online=True`, incident `resolved`, `EventAction(action="recovered")`, `CameraOutage.ended_at` setat
  - a doua cădere → incident nou (nu refolosește `outage_event_id`)
  - `camera_offline_after_s=0` → watchdog complet oprit
- `test_escalation_ladder.py`
  - 3 trepte → 3 rânduri outbox, fiecare o singură dată
  - ack la treapta 2 → treapta 3 `cancelled`, zero trimiteri
  - restart → `recover_timers` re-armează treapta corectă, nu de la 0
- `test_kpi.py` (extins)
  - FP exclus din `by_type`, `by_zone`, total; numărat separat
  - `by_hour` are exact 8 intrări, în ordinea turei, inclusiv zerouri
  - tura de noapte trece peste miezul nopții corect
  - `resolution_rate`, `alerted_incidents`, `coverage`
  - `CAMERA_OFFLINE` nu apare în `by_zone`
- `test_shift_summary.py`
  - cifre neschimbate → **zero** apeluri LLM (monkeypatch pe `automation.report.summarize`)
  - cifre schimbate → un apel
  - `?refresh=true` → un apel
  - două request-uri concurente → un singur apel (lock)
- `test_events_filters.py` — `from`/`to` combinabile, granițe inclusive/ exclusive documentate
- `test_health.py` (extins) — câmpul `notifications`

`ml/tests/test_heartbeat.py` — heartbeat trimis la interval, eroarea nu oprește bucla.

Toate testele existente (115) trebuie să rămână verzi. Comanda: `cd backend && uv run pytest -q`.

---

## 11. Ordine de livrare

| # | PR | Conținut | Blocat de |
|---|---|---|---|
| 0 | `docs: contract delta` | §3 | aprobare Max + Ariana + Andrei |
| 1 | `api: outbox cu retry și urmă de livrare` | §5 | PR 0 (doar `/health`) |
| 2 | `api: watchdog cameră și revenire` | §6 (backend) | PR 0 (`/heartbeat`) |
| 3 | `ml: heartbeat edge` | §6.4 | PR 0 |
| 4 | `api: raport de tură corect + cache sumar` | §8.1–8.4 | PR 0 (câmpuri aditive) |
| 5 | `ui: dată, refresh, acoperire, CSV, drill-down` | §8.5 | PR 1, 2, 4 |

1 și 2 nu depind unul de altul, pot merge în paralel pe două worktree-uri dacă e nevoie.

---

## 12. Întrebări deschise (răspuns înainte de cod)

| # | Întrebare | Recomandare |
|---|---|---|
| O1 | `zone_id` la `CAMERA_OFFLINE` | `camera_id` (zero schimbare de contract) |
| O2 | severitate `CAMERA_OFFLINE` | `WARNING` (consistent cu `automation/report.py`); o cameră pe o pistă activă ar merita `CRITICAL` ca regulă separată, mai târziu |
| O3 | heartbeat explicit vs. refolosirea `GET /edge/zones` | ambele: `/zones` numără ca heartbeat, `/heartbeat` explicit pentru edge-urile fără remote-config |
| O4 | deduplicare notificări (fereastră) | default **0 (oprit)** în v1, ca demo-ul să nu se schimbe; activabil din `Settings` |
| O5 | `by_hour` pe `detected_at` sau `received_at` | `detected_at` (contractul îl dă ca timp al evenimentului); evenimentele întârziate rămân în tura în care s-au produs |
| O6 | TTL sumar | 900 s; sub asta, cifrele se schimbă fără să se schimbe textul |

---

## 13. Verificare înainte de „gata"

```bash
# backend
cd backend && uv run pytest -q                     # 115 + teste noi, toate verzi
# contract neschimbat în mod accidental
git diff --stat docs/contract.md                   # doar în PR 0
# demo path neatins
curl localhost:8000/health | jq '.status'
curl 'localhost:8000/kpi?shift=morning&date=<azi>' | jq
# raport rapid și determinist
for i in 1 2 3; do time curl -s 'localhost:8000/reports?shift=morning&date=<azi>' | jq -r .summary; done
# watchdog real
kill -STOP <pid-edge>   # fără heartbeat
sleep 100 && curl -s localhost:8000/events?status=open | jq '.[] | select(.type=="CAMERA_OFFLINE")'
# outbox
curl -s localhost:8000/health | jq '.notifications'
```

---

## 14. Estimare

| PR | Efort |
|---|---|
| 0 contract | 0,5 h |
| 1 outbox | 1 zi |
| 2 watchdog | 1 zi |
| 3 ml heartbeat | 0,5 zi |
| 4 raport corect | 1,5 zile |
| 5 UI | 1 zi |
| **total** | **~5 zile** |

Cu tăiere la demo: PR 1 + 4.1 (regulile de numărare) + 4.2 (orele) dau 70% din efect în ~1,5 zile.
