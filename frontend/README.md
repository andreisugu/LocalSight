# LocalSight command center — frontend

Responsabilă: **Ariana**

Brief intern: `safesight-docs/03_C_frontend.typ` (repo privat). Contractul canonic:
`docs/contract.md` (istoric pentru endpointuri; plicul evenimentului rămâne valabil).

Produsul e **aplicația statică din acest folder**: UI React + motorul de inferență în tab.
Nu există backend de pornit; stack-ul Python de referință a fost șters din fork.

## Pornire, teste și build

Comenzile canonice sunt în [`../RUNNING.md`](../RUNNING.md#pornire-rapidă), iar testele în
[`../RUNNING.md`](../RUNNING.md#teste). Nu le copia aici. `.env` este opțional:
`VITE_USE_MOCK=true` înlocuiește apelurile de API cu fixturile, iar `VITE_API_URL` are sens
doar dacă rulezi un API propriu în paralel (nu există unul în acest repo). Șablonul e
`frontend/.env.example`.

## Ce e conectat

- `src/services/api.js` → clientul HTTP folosit doar cu `VITE_USE_MOCK=false`; în build-ul
  publicat nu e pe traseu.
- `src/engine/` → motorul real: YOLO26n + YuNet + tracker + zone + reguli + blur + vestă,
  în Web Worker prin ONNX Runtime Web. Vezi `docs/browser-engine.md`.
- Live poate rula motorul pe clipul demo sau pe camera locală; `/lab` și `/bench` expun
  aceleași primitive.
- `snapshot_url` din evenimentele motorului e un `blob:` deținut de pagină; nimic nu urcă
  pe rețea.

`VITE_USE_MOCK=true` rămâne calea pentru demo și pentru testele E2E; datele mock sunt
fixture-uri, nu trafic real.

## Fișiere legacy

Entry point-ul este `src/main.jsx`. Comentariile care citează `ml/` sau `backend/` arată din
ce fișier s-a portat logica; acele fișiere sunt doar în istoricul git.
