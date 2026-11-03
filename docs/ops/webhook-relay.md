# Webhook relay — Slack / Discord / Telegram / ntfy

Aplicația statică nu poate ține secretele providerilor și nu poate ocoli CORS-ul lor. Ea
trimite un JSON mic către un **relay self-hosted**; relay-ul ține cheile în environment și
formatează mesajul pentru provider. Pipeline-ul rămâne în tab; relay-ul e opțional.

## Pornire

```bash
# Slack
SLACK_WEBHOOK_URL='https://hooks.slack.com/services/…' \
  node scripts/webhook-relay.mjs

# Discord
DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/…' \
  node scripts/webhook-relay.mjs

# Telegram
TELEGRAM_BOT_TOKEN='…' TELEGRAM_CHAT_ID='…' \
  node scripts/webhook-relay.mjs

# ntfy (implicit https://ntfy.sh)
NTFY_TOPIC='localsight-…' node scripts/webhook-relay.mjs
```

Implicit ascultă pe `127.0.0.1:8787`. Pentru un host public:

```bash
HOST=0.0.0.0 PORT=8787 ALLOW_ORIGIN='https://andreisugu.github.io' \
RELAY_TOKEN='un-token-lung' NTFY_URL='https://ntfy.sh' NTFY_TOPIC='…' \
  node scripts/webhook-relay.mjs
```

`GET /health` întoarce canalele configurate, fără valori. `POST /notify` primește
`{channel,text,incident}`; `202` înseamnă că providerul a acceptat, `502` că a refuzat.
Body maxim 64 KiB, timeout 10 s per provider, fără logarea secretelor.

## Configurare în aplicație

**Sistem & Audit → Notificări webhook**:

- pornește toggle-ul;
- alege canalul (Slack / Discord / Telegram / ntfy);
- pune URL-ul releului (ex. `http://localhost:8787` sau un URL HTTPS public);
- opțional, token-ul releului (`X-Relay-Token`);
- „Trimite test” verifică lanțul.

Configurația stă în `localStorage`, în acest browser. Se trimit **doar** evenimente
`event.local === true` (motorul real), nu fixture-uri; mesajul e text, fără snapshot, fără
blob, fără link către un incident care există doar în IndexedDB-ul acelui browser.

## CSP și originile

CSP-ul build-ului permite `connect-src 'self'`, `http://localhost:*`,
`http://127.0.0.1:*` și, opțional, **`VITE_WEBHOOK_ORIGIN`**:

```bash
VITE_WEBHOOK_ORIGIN='https://relay.example.com' npm run build
```

Pe Pages, setează variabila de repository `VITE_WEBHOOK_ORIGIN`; workflow-ul o injectează.
Fără ea, un relay pe alt origin este blocat de browser înainte să plece. Un relay pe același
origin (reverse proxy) merge direct.

## Limite

- **Best-effort**: coada și retry-ul trăiesc cât timp tab-ul e deschis; la închidere nu mai
  pleacă nimic. Nu e alertare 24/7 și nu înlocuiește un backend cu outbox.
- **Text-only**: fără imagini, fețe, snapshot-uri sau butoane.
- **Secrete**: providerii stau doar în env-ul relay-ului; token-ul releului e în browser.
- **Producție**: TLS, `ALLOW_ORIGIN` restrâns, firewall, rate limit și un reverse proxy;
  verifică termenii providerului și politica de privacy înainte de un pilot.
- **Fără garanție de livrare**: `202` înseamnă că providerul a acceptat cererea, nu că
  mesajul a fost citit.
