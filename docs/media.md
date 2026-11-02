# Media pentru demo-ul static

Demo-ul din browser rulează clipuri în buclă. Clipurile originale sunt 4K și
cântăresc 4–42 MB fiecare, așa că **nu pot fi urcate în repo ca atare**. Aici e
rețeta care le face mici, unde ajung fișierele și cum le publicăm.

## De ce nu urcăm sursele

| Problemă | Efect |
|---|---|
| 6 clipuri × 4–42 MB = ~115 MB, iar git păstrează fiecare versiune | repo-ul crește la fiecare re-encode și nu se mai micșorează niciodată |
| GitHub respinge fișiere > 100 MB | un singur clip 4K poate bloca `git push` pentru tot branch-ul |
| GitHub Pages publică maximum ~1 GB per site | 4K-urile ar consuma o zecime din buget pentru câteva secunde de film |
| 4K pe un laptop de demo | decodare grea, primul cadru apare târziu, bucla se înțeapă |
| `.gitignore` are deja `*.mp4` | oricum nu intră în git fără o excepție explicită |

Sursa rămâne în Drive, sub `SafeSight/data/videos/` (vezi
`data/videos/README.md`). În repo intră doar versiunea web, dacă alegem varianta A.

## Ce produce scriptul

`scripts/prepare-demo-media.sh` ia fiecare `.mp4` din directorul sursă și scrie
în `frontend/public/media/`:

- **H.264** (`libx264`), `-crf 26`, `-preset slow` — ochiul nu vede diferența pe
  un clip de 20 s, dar fișierul scade de 3–10×;
- **lățime maximă 1920 px**, înălțime pară (`-2`), scalare Lanczos;
- **fără audio** (`-an`) — demo-ul nu are sunet, iar pista audio e greutate moartă;
- **`yuv420p`** — singurul format pe care îl decodează toate browserele;
- **`-movflags +faststart`** — metadatele ajung la început, deci clipul pornește
  înainte să se descarce integral;
- **maximum 20 s** (`-t 20`) — suficient pentru o buclă, mic pentru un demo.

Numele de ieșire e identic cu al sursei, deci `frontend/public/media/<același nume>.mp4`.

### Comenzi

```bash
# doar listează ce s-ar produce (nu scrie nimic)
bash scripts/prepare-demo-media.sh --check

# encodează toate clipurile
bash scripts/prepare-demo-media.sh

# doar cele mai mici 2 clipuri (util când vrei un build rapid)
bash scripts/prepare-demo-media.sh --max 2

# directoare custom: sursă și ieșire
bash scripts/prepare-demo-media.sh /cale/catre/videos frontend/public/media
```

Echivalentul ffmpeg, dacă vrei să rulezi manual un singur clip:

```bash
ffmpeg -i sursa.mp4 -t 20 \
  -vf "scale='min(1920,iw)':-2:flags=lanczos" \
  -c:v libx264 -preset slow -crf 26 \
  -pix_fmt yuv420p -an -movflags +faststart \
  frontend/public/media/sursa.mp4
```

### Rezultate măsurate (2 nov 2026, ffmpeg 8.1.3)

| Clip | Sursă | Dimensiuni | Web | Reducere |
|---|---|---|---|---|
| `2026-10-30_broll_cam01_marshaller-conuri-apron.mp4` | 4.1 MB | 1280x720 | 1.2 MB | 71% |
| `2026-10-30_restricted-zone_cam01_persoana-langa-motor.mp4` | 5.0 MB | 1920x1080 | 3.4 MB | 33% |

Total: 9.1 MB → 4.6 MB. Restul clipurilor sunt 4K (3840x2160 sau 2160x3840) și
ies mai mici proporțional, dar se encodează mai lent.

> `2026-10-30_broll_cam03_lucratori-cu-veste-apron.mp4` e filmat **vertical**
> (2160x3840). Cu regula „lățime max 1920” ajunge la 1920x3414 — corect ca
> orientare, dar înalt. Pentru el rulează `--max-width 1280`.

### Verificare

```bash
# codec, pix_fmt, dimensiuni, durată, absența audio
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,pix_fmt \
  -show_entries format=duration,size -of default=noprint_wrappers=1 \
  frontend/public/media/<clip>.mp4

# faststart: 'moov' trebuie să apară aproape de începutul fișierului
python3 -c "import sys;d=open(sys.argv[1],'rb').read(2_000_000);print(d.find(b'moov')!=-1)" \
  frontend/public/media/<clip>.mp4
```

## Unde stau fișierele

`frontend/public/media/` este servit de Vite la `/media/<clip>.mp4` și copiat
în `dist/` la build. Directorul **nu** e în git: regula `*.mp4` din `.gitignore`
(linia 41) prinde și fișierele de aici.

```bash
git check-ignore -v frontend/public/media/<clip>.mp4
# .gitignore:41:*.mp4	frontend/public/media/<clip>.mp4
```

Deci un `npm run build` curat, pe o clonă nouă, **nu** are clipuri până nu rulează
scriptul. Asta e intenționat: binarul nu se plimbă prin istoricul git.

## Limitările GitHub Pages

- **100 MB per fișier** — GitHub respinge orice blob mai mare, deci un 4K de 42 MB
  trece doar dacă nu crește peste limită la o versiune viitoare; nu e o strategie.
- **~1 GB per site publicat** — limita recomandată pentru un site Pages. Peste ea
  GitHub avertizează și poate bloca build-ul.
- **100 GB trafic/lună** (soft) — un clip de 3 MB în buclă pe 10 ecrane de demo
  consumă repede, dar pentru hackathon e irelevant.

Ambele variante de mai jos stau confortabil sub aceste limite.

## Varianta A — commit la fișierele re-encodate

Potrivită când clipurile web rămân sub ~10 MB fiecare și vrei un `git clone` care
merge direct, fără pași manuali.

Se adaugă o excepție **după** regula `*.mp4` din `.gitignore`:

```gitignore
# Media demo: doar versiunile web re-encodate, mici (vezi docs/media.md)
!frontend/public/media/
!frontend/public/media/*.mp4
```

Apoi:

```bash
bash scripts/prepare-demo-media.sh
git add .gitignore frontend/public/media/*.mp4
git status --short          # verifică: doar fișierele mici, nu 4K-urile
git commit -m "chore(demo): add web-ready demo clips"
```

Reguli:

- **niciodată** sursele 4K, doar ieșirea scriptului (sub 10 MB per fișier);
- dacă un clip depășește ~10 MB, scade `--max-width` sau urcă `-crf`, nu îl urca așa;
- excepția e îngustă intenționat — nu adăuga `!data/videos/*.mp4`.

## Varianta B — asset-uri de Release + variabilă de mediu

Potrivită când vrei repo-ul gol și clipurile versionate separat. GitHub Releases
acceptă fișiere de până la 2 GB, mult peste nevoia noastră.

```bash
# o singură dată, după ce ai rulat scriptul
gh release create demo-media-v1 frontend/public/media/*.mp4 \
  --title "Demo media v1" \
  --notes "Clipurile web pentru demo-ul static (H.264, max 1920px, 20s, fără audio)."

# lista asset-urilor și URL-urile
gh release view demo-media-v1 --json assets --jq '.assets[].url'
```

URL-urile arată așa:

```text
https://github.com/<owner>/<repo>/releases/download/demo-media-v1/<clip>.mp4
```

Aplicația le primește printr-o variabilă de mediu, cu `/media` ca implicit:

```bash
VITE_MEDIA_BASE_URL="https://github.com/<owner>/<repo>/releases/download/demo-media-v1" \
  npm run build
```

```dotenv
# frontend/.env.example (variantă de documentat, nu hardcoda URL-ul)
VITE_MEDIA_BASE_URL=
```

> **Stare:** frontend-ul citește acum doar `/media/<clip>.mp4`. `VITE_MEDIA_BASE_URL`
> trebuie încă wire-uită în sursa frontend-ului (schimbare separată, în afara
> acestui branch). Până atunci varianta B e doar pregătită, nu activă.

Note pentru varianta B:

- `<video src>` nu are nevoie de CORS; redirecționarea către
  `objects.githubusercontent.com` funcționează direct în browser;
- asset-urile sunt imutabile — pentru o versiune nouă de clip, fă `demo-media-v2`
  și schimbă `VITE_MEDIA_BASE_URL`, nu suprascrie tag-ul;
- build-ul rămâne fără binare, deci `dist/` nu mai crește cu clipuri.

## Regula pentru agenți

- Sursele 4K nu se commit niciodată; `*.mp4` rămâne ignorat în afara variantei A.
- Nu modifica `--crf`/`--max-width` ca să „încapă” un fișier fără să notezi aici.
- Dacă schimbi lista de clipuri, actualizează și tabelul din
  `data/videos/README.md`.
