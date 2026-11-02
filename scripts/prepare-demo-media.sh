#!/usr/bin/env bash
set -euo pipefail

# Preparează clipurile sursă pentru demo-ul static din browser.
#
# Sursă:   data/videos (4K, 4-42 MB, nu intră în git)
# Ieșire:  frontend/public/media (H.264 mic, 1920 px lățime max, fără audio)
#
# Ieșirea e ignorată de git (`.gitignore`: `*.mp4`). Vezi docs/media.md pentru
# cele două variante de publicare (fișiere în repo sau asset-uri de Release).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SRC_DEFAULT="/var/home/restlessstone/Coding/craiova-hack-2026/data/videos"
OUT_DEFAULT="$ROOT/frontend/public/media"

MAX_WIDTH=1920
CRF=26
PRESET=slow
DURATION=20
MAX_CLIPS=0 # 0 = toate

usage() {
  cat <<'EOF'
Utilizare: scripts/prepare-demo-media.sh [opțiuni] [SURSĂ] [IEȘIRE]

Argumente poziționale (opționale):
  SURSĂ    directorul cu clipurile .mp4
           (implicit: /var/home/restlessstone/Coding/craiova-hack-2026/data/videos)
  IEȘIRE   directorul pentru fișierele web
           (implicit: frontend/public/media)

Opțiuni:
  -c, --check        nu encodează; doar listează ce s-ar produce
  -n, --max N        procesează doar cele mai mici N clipuri (după mărime)
  -w, --max-width W  lățimea maximă în pixeli (implicit: 1920)
  -h, --help         afișează acest mesaj

Exemplu:
  scripts/prepare-demo-media.sh --check
  scripts/prepare-demo-media.sh --max 2
EOF
}

die() {
  echo "✗ $*" >&2
  exit 1
}

CHECK=0
SRC=""
OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -c | --check) CHECK=1 ;;
    -n | --max)
      [[ $# -ge 2 ]] || die "--max cere o valoare"
      MAX_CLIPS="$2"
      shift
      ;;
    --max=*) MAX_CLIPS="${1#*=}" ;;
    -w | --max-width)
      [[ $# -ge 2 ]] || die "--max-width cere o valoare"
      MAX_WIDTH="$2"
      shift
      ;;
    --max-width=*) MAX_WIDTH="${1#*=}" ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*) die "opțiune necunoscută: $1 (vezi --help)" ;;
    *)
      if [[ -z "$SRC" ]]; then
        SRC="$1"
      elif [[ -z "$OUT" ]]; then
        OUT="$1"
      else
        die "prea multe argumente: $1"
      fi
      ;;
  esac
  shift
done

[[ -n "$SRC" ]] || SRC="$SRC_DEFAULT"
[[ -n "$OUT" ]] || OUT="$OUT_DEFAULT"

[[ "$MAX_CLIPS" =~ ^[0-9]+$ ]] || die "--max vrea un număr întreg, nu '$MAX_CLIPS'"
[[ "$MAX_WIDTH" =~ ^[0-9]+$ ]] || die "--max-width vrea un număr întreg, nu '$MAX_WIDTH'"
((MAX_WIDTH >= 320)) || die "--max-width prea mic: $MAX_WIDTH"

# --- dependențe ---------------------------------------------------------------------

if ! command -v ffmpeg >/dev/null 2>&1; then
  if [[ "$CHECK" -eq 1 ]]; then
    echo "! ffmpeg lipsește: pot lista, dar encode-ul ar eșua." >&2
  else
    die "ffmpeg lipsește. Instalează-l (Fedora: sudo dnf install ffmpeg / Debian: sudo apt install ffmpeg) și rulează din nou."
  fi
fi

if command -v ffmpeg >/dev/null 2>&1; then
  # Citim tot înainte de grep: `grep -q` ar închide pipe-ul devreme și, cu
  # `pipefail`, ffmpeg ar raporta SIGPIPE (141) ca eșec.
  ENCODERS="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
  if [[ "$ENCODERS" != *libx264* ]]; then
    die "ffmpeg-ul instalat nu are encoderul libx264; nu pot produce H.264."
  fi
fi

HAS_FFPROBE=0
if command -v ffprobe >/dev/null 2>&1; then
  HAS_FFPROBE=1
fi

# --- utilitare ----------------------------------------------------------------------

human_size() {
  local bytes="$1"
  if ((bytes >= 1073741824)); then
    awk -v b="$bytes" 'BEGIN { printf "%.2f GB", b / 1073741824 }'
  elif ((bytes >= 1048576)); then
    awk -v b="$bytes" 'BEGIN { printf "%.1f MB", b / 1048576 }'
  elif ((bytes >= 1024)); then
    awk -v b="$bytes" 'BEGIN { printf "%.0f kB", b / 1024 }'
  else
    printf '%d B' "$bytes"
  fi
}

file_size() {
  stat -c %s "$1" 2>/dev/null || wc -c <"$1" | tr -d ' '
}

probe_dims() {
  local dims="?"
  if [[ "$HAS_FFPROBE" -eq 1 ]]; then
    # `awk NR==1` instead of `head -n1`: head exits early and pipefail turns the
    # resulting SIGPIPE into a failure.
    dims="$(ffprobe -v error -select_streams v:0 \
      -show_entries stream=width,height -of csv=p=0:s=x "$1" 2>/dev/null | awk 'NR == 1')"
    [[ -n "$dims" ]] || dims="?"
  fi
  printf '%s' "$dims"
}

probe_duration() {
  local dur="?"
  if [[ "$HAS_FFPROBE" -eq 1 ]]; then
    dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | awk 'NR == 1')"
    [[ -n "$dur" ]] || dur="?"
  fi
  printf '%s' "$dur"
}

# --- validare sursă -----------------------------------------------------------------

[[ -d "$SRC" ]] || die "directorul sursă nu există: $SRC
Pune clipurile în $SRC_DEFAULT sau dă calea ca prim argument."

# Listă „mărime<TAB>cale”, sortată alfabetic sau după mărime când cerem --max.
listing="$(find "$SRC" -maxdepth 1 -type f -iname '*.mp4' -printf '%s\t%p\n' | sort -t "$(printf '\t')" -k2)"
[[ -n "$listing" ]] || die "nu am găsit niciun .mp4 în $SRC"

if ((MAX_CLIPS > 0)); then
  listing="$(printf '%s\n' "$listing" | sort -t "$(printf '\t')" -k1,1n | awk -v n="$MAX_CLIPS" 'NR <= n')"
fi

mapfile -t ROWS <<<"$listing"
(( ${#ROWS[@]} > 0 )) || die "lista de clipuri e goală după filtrare"

# --- plan ---------------------------------------------------------------------------

echo "Sursă:  $SRC"
echo "Ieșire: $OUT"
if [[ "$CHECK" -eq 1 ]]; then
  echo "Mod:    --check (nu se scrie nimic)"
else
  echo "Mod:    encode (H.264 crf $CRF, preset $PRESET, max ${MAX_WIDTH}px lățime, fără audio, max ${DURATION}s)"
  mkdir -p "$OUT"
fi
echo ""

if [[ "$CHECK" -eq 1 ]]; then
  printf '%-64.64s %10s %10s  %s\n' "CLIP" "SURSĂ" "DIMENSIUNI" "-> IEȘIRE"
  printf '%-64.64s %10s %10s  %s\n' "----------------------------------------------------------------" "----------" "----------" "----------"
else
  printf '%-64.64s %10s %10s %8s  %s\n' "CLIP" "SURSĂ" "WEB" "REDUCERE" "DIMENSIUNI"
  printf '%-64.64s %10s %10s %8s  %s\n' "----------------------------------------------------------------" "----------" "----------" "--------" "----------"
fi

total_in=0
total_out=0
count=0
failures=0

for row in "${ROWS[@]}"; do
  in_path="${row#*$'\t'}"
  [[ -f "$in_path" ]] || continue

  name="$(basename "$in_path")"
  out_path="$OUT/$name"
  in_bytes="$(file_size "$in_path")"
  dims="$(probe_dims "$in_path")"
  total_in=$((total_in + in_bytes))
  count=$((count + 1))

  if [[ "$CHECK" -eq 1 ]]; then
    printf '%-64.64s %10s %10s  %s\n' "$name" "$(human_size "$in_bytes")" "$dims" "$out_path"
    continue
  fi

  if ! ffmpeg -hide_banner -loglevel error -nostdin -y \
    -i "$in_path" \
    -t "$DURATION" \
    -vf "scale='min(${MAX_WIDTH},iw)':-2:flags=lanczos" \
    -c:v libx264 -preset "$PRESET" -crf "$CRF" \
    -pix_fmt yuv420p -an -movflags +faststart \
    "$out_path"; then
    echo "✗ encode eșuat: $name" >&2
    failures=$((failures + 1))
    continue
  fi

  out_bytes="$(file_size "$out_path")"
  if ((out_bytes == 0)); then
    echo "✗ ieșire goală: $out_path" >&2
    failures=$((failures + 1))
    continue
  fi

  total_out=$((total_out + out_bytes))
  pct=$((100 - (out_bytes * 100 / in_bytes)))
  printf '%-64.64s %10s %10s %7d%%  %s\n' \
    "$name" "$(human_size "$in_bytes")" "$(human_size "$out_bytes")" "$pct" "$dims"
done

echo ""

if [[ "$CHECK" -eq 1 ]]; then
  echo "• $count clip(uri) ar fi produse în $OUT (total sursă: $(human_size "$total_in"))."
  echo "• rulează fără --check ca să encodezi."
  exit 0
fi

if ((failures > 0)); then
  echo "✗ $failures clip(uri) au eșuat; vezi mesajele de mai sus." >&2
  exit 1
fi

echo "✓ $count clip(uri): $(human_size "$total_in") -> $(human_size "$total_out") în $OUT"

# Reamintim că ieșirea nu intră în git, ca să nu fie adăugată din greșeală.
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$ROOT" check-ignore -q "$OUT/$(basename "${ROWS[0]#*$'\t'}")"; then
    echo "• fișierele .mp4 sunt ignorate de git (.gitignore: *.mp4) — vezi docs/media.md pentru publicare."
  else
    echo "! atenție: .mp4 din $OUT nu pare ignorat de git; verifică .gitignore înainte de commit."
  fi
fi
