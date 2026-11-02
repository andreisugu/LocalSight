#!/usr/bin/env python3
"""Line-level provenance for LocalSight: whose code is still in the tree?

The repository keeps the whole SafeSight history, and several people (plus agents
committing under the same identity) touched the same files. Commit counts per file are a
poor answer; this script asks git who last touched each line (`git blame -w`), buckets the
authors into "you", "teammates" and "unknown", and prints a per-file table.

Usage:
    python3 scripts/provenance.py                  # console table
    python3 scripts/provenance.py --write          # also docs/provenance.md
    python3 scripts/provenance.py --json out.json  # machine-readable
    python3 scripts/provenance.py --min-lines 30   # ignore tiny files
    python3 scripts/provenance.py --audit frontend/src/App.jsx

`-w` ignores whitespace-only commits, so a reformat does not steal authorship. It still
attributes a rewritten line to whoever rewrote it: this is "whose code is here now", not
"who had the original idea". `--audit` prints the actual remaining lines, because a
percentage alone cannot tell a genuine rewrite from a cosmetic one.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

# Identity mapping. Add an address here when a contributor changes it; the script reports
# unknown authors instead of guessing.
USER_EMAILS = {
    "andreisugu@gmail.com",
    "35407471+andreisugu@users.noreply.github.com",
}
TEAMMATE_EMAILS = {
    "maximilianandrei2101@gmail.com",
    "51191210+muxxq@users.noreply.github.com",
    "voju.elena.w4b@student.ucv.ro",
    "cascota.dalina.s6m@student.ucv.ro",
}

CODE_EXTENSIONS = {
    ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
    ".py", ".css", ".html", ".sh", ".yml", ".yaml",
}
EXCLUDED_PREFIXES = (
    "frontend/public/models/",
    "frontend/public/media/",
    "docs/assets/",
    "data/",
)
EXCLUDED_SUFFIXES = ("package-lock.json", "uv.lock")


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def tracked_code_files() -> list[str]:
    files = []
    for path in git("ls-files").splitlines():
        if not path or path.startswith(EXCLUDED_PREFIXES):
            continue
        if path.endswith(EXCLUDED_SUFFIXES):
            continue
        if Path(path).suffix not in CODE_EXTENSIONS:
            continue
        files.append(path)
    return files


def bucket(email: str) -> str:
    address = email.strip().strip("<>").lower()
    if address in USER_EMAILS:
        return "user"
    if address in TEAMMATE_EMAILS:
        return "teammate"
    return "unknown"


def blame_file(path: str) -> Counter:
    """Count lines per bucket for one file using porcelain blame."""
    try:
        output = git("blame", "--line-porcelain", "-w", "--", path)
    except RuntimeError:
        return Counter()
    counts: Counter = Counter()
    for line in output.splitlines():
        if line.startswith("author-mail "):
            counts[bucket(line[len("author-mail "):])] += 1
    return counts


def audit_file(path: str) -> list[dict]:
    """Every line still attributed to a teammate, with its current line number."""
    output = git("blame", "--line-porcelain", "-w", "--", path)
    rows = []
    current = {}
    for line in output.splitlines():
        if line.startswith("author "):
            current["author"] = line[len("author "):]
        elif line.startswith("author-mail "):
            current["email"] = line[len("author-mail "):]
            current["bucket"] = bucket(line[len("author-mail "):])
        elif line.startswith("author-time "):
            current["time"] = line[len("author-time "):]
        elif line and line[0] != "\t" and " " in line and len(line.split()) >= 3 and line.split()[0].isalnum():
            parts = line.split()
            if len(parts) >= 3 and parts[1].isdigit() and parts[2].isdigit():
                current["sha"] = parts[0][:7]
                current["line"] = int(parts[2])
        elif line.startswith("\t"):
            if current.get("bucket") == "teammate":
                rows.append({
                    "line": current.get("line"),
                    "sha": current.get("sha"),
                    "author": current.get("author"),
                    "content": line[1:].strip(),
                })
            current = {}
    return rows


def print_audit(path: str) -> None:
    rows = audit_file(path)
    print(f"{path}: {len(rows)} linii rămase de la colegi\n")
    for row in rows:
        print(f"{row['line']:5}  {row['sha']}  {row['author']:20}  {row['content'][:110]}")
    if not rows:
        print("Nicio linie atribuită colegilor.")


def build_report(min_lines: int) -> dict:
    rows = []
    for path in tracked_code_files():
        counts = blame_file(path)
        total = sum(counts.values())
        if total < min_lines:
            continue
        rows.append({
            "path": path,
            "lines": total,
            "user": counts["user"],
            "teammate": counts["teammate"],
            "unknown": counts["unknown"],
            "teammate_pct": round(100 * counts["teammate"] / total, 1),
        })
    rows.sort(key=lambda row: (-row["teammate_pct"], -row["lines"]))
    totals = {
        key: sum(row[key] for row in rows)
        for key in ("lines", "user", "teammate", "unknown")
    }
    return {"rows": rows, "totals": totals, "head": git("rev-parse", "--short", "HEAD").strip()}


def print_table(report: dict) -> None:
    totals = report["totals"]
    print(f"HEAD {report['head']} — {totals['lines']} linii de cod urmărite\n")
    print(f"{'fișier':58} {'linii':>6} {'tu':>6} {'colegi':>7} {'?':>5} {'colegi %':>9}")
    print("-" * 96)
    for row in report["rows"]:
        print(
            f"{row['path'][:58]:58} {row['lines']:6} {row['user']:6} "
            f"{row['teammate']:7} {row['unknown']:5} {row['teammate_pct']:8.1f}%"
        )
    print("-" * 96)
    def pct(value: int) -> str:
        return f"{100 * value / totals['lines']:.1f}%" if totals["lines"] else "0%"
    print(
        f"TOTAL {totals['lines']:>5} linii: tu {totals['user']} ({pct(totals['user'])}), "
        f"colegi {totals['teammate']} ({pct(totals['teammate'])}), "
        f"necunoscut {totals['unknown']} ({pct(totals['unknown'])})"
    )
    # Only product code is a rewrite candidate. data/ is reference material and the Python
    # stack (backend/, ml/) was removed from this fork, so neither is scored for rewriting.
    candidates = [
        row for row in report["rows"]
        if row["path"].startswith("frontend/") and row["teammate_pct"] >= 60 and row["lines"] >= 30
    ]
    if candidates:
        print("\nCandidați de rescriere (≥60% linii de la colegi, ≥30 linii):")
        for row in candidates:
            print(f"  {row['path']} — {row['teammate_pct']}% din {row['lines']} linii")


def write_markdown(report: dict, path: Path) -> None:
    totals = report["totals"]
    lines = [
        "# Proveniență — cine a scris codul rămas",
        "",
        f"Generat cu `python3 scripts/provenance.py --write` la commit `{report['head']}`.",
        "Măsoară **ultima atingere a fiecărei linii** (`git blame -w`), nu commit-urile.",
        "Un rând rescris de tine apare ca al tău chiar dacă ideea era a altcuiva; un rând",
        "copiat dintr-un fișier al colegilor rămâne al lor până îl atingi. `-w` ignoră",
        "schimbările doar de whitespace. Fișierele binare, lockfile-urile și asset-urile sunt",
        "excluse. Codul scris de agenți în această sesiune e comis sub identitatea ta, deci",
        "intră la „tu”.",
        "",
        f"**Total: {totals['lines']} linii** — tu {totals['user']}, colegi {totals['teammate']}, "
        f"necunoscut {totals['unknown']}.",
        "",
        "| Fișier | Linii | Tu | Colegi | ? | Colegi % |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for row in report["rows"]:
        lines.append(
            f"| `{row['path']}` | {row['lines']} | {row['user']} | {row['teammate']} | "
            f"{row['unknown']} | {row['teammate_pct']}% |"
        )
    candidates = [
        row for row in report["rows"]
        if row["path"].startswith("frontend/") and row["teammate_pct"] >= 60 and row["lines"] >= 30
    ]
    lines += [
        "",
        "## Candidați de rescriere",
        "",
        "Doar cod de produs din `frontend/`: ≥60% linii de la colegi și ≥30 de linii, în",
        "ordinea proporției. `data/` e referință și nu intră în listă; `backend/` și `ml/`",
        "au fost șterse din acest fork. Tokenurile de design (`theme.js`, `index.css`,",
        "`tailwind.config.js`) apar aici din cauza liniei, nu pentru că ar conține logică de rescris.",
        "",
    ]
    if candidates:
        for row in candidates:
            lines.append(f"- `{row['path']}` — {row['teammate_pct']}% din {row['lines']} linii")
    else:
        lines.append("Niciunul peste prag.")
    lines += [
        "",
        "Inventarul deciziilor (ce rescriem oportunist) rămâne în `docs/rewrite-backlog.md`.",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Line-level code provenance")
    parser.add_argument("--write", action="store_true", help="write docs/provenance.md")
    parser.add_argument("--json", metavar="PATH", help="write the raw report as JSON")
    parser.add_argument("--min-lines", type=int, default=10, help="ignore files below this size")
    parser.add_argument("--audit", metavar="PATH", help="print the teammate-attributed lines of one file")
    args = parser.parse_args()

    if args.audit:
        print_audit(args.audit)
        return 0

    report = build_report(args.min_lines)
    print_table(report)
    if args.write:
        target = Path("docs/provenance.md")
        write_markdown(report, target)
        print(f"\nScris {target}")
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Scris {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
