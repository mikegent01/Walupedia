"""Deterministic half of the Filing Desk: everything a local model must not decide.

Shard writes and the manifest, undo backups, the checker runs, in-world time
codes and the rule-zero name guard live here. The model only ever hands this
module plain field values; ids, paths, ordering and validation are code.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[3]

SHARD_LIMIT = 250_000
WORLDS = ("material", "feyward", "shadeward", "mirror", "unsorted")
CLOCKS = ("MAT", "SHD", "FEY", "SUBJ", "KIV", "EBO")
WORLD_CLOCK = {"material": "MAT", "shadeward": "SHD", "feyward": "FEY", "mirror": "SUBJ", "unsorted": "MAT"}
MONTHS = ["Firstlight", "Chillwind", "Veridia", "Bloom", "Floria", "Efferd",
          "Highsun", "Harvestide", "Aethel", "Emberfall", "Frostwane", "Deepwinter"]
DAYS = [30] * 11 + [35]
CODE_RE = re.compile(r"^TC:(\d{3,4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/(MAT|SHD|FEY|SUBJ|KIV|EBO)$")

# Story prose words the filing playbook bans (a verbatim quote is the only excuse).
BANNED_WORDS = ("implies", "implication", "assessment", "structural", "mechanism",
                "classification", "procedural", "institutional", "doctrine", "category",
                "finding", "capability", "jurisdiction")

# The checks that cover a filing (CLAUDE.md "Verify with the few checks").
FILING_CHECKS = ("check-references.py", "check-exhibits.py", "check-timecodes.py --strict",
                 "check-home-feed.py")


def slug(value: str, limit: int = 64) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return text[:limit].strip("_") or "untitled"


def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", str(value or "")).lower()).strip()


class Store:
    """One checkout's filing stores. `root` is swappable so tests use a temp tree."""

    def __init__(self, root: Path = ROOT, backup_dir: Path | None = None):
        self.root = Path(root)
        self.data = self.root / "Reputation-Matrix2" / "data"
        self.stores = self.data / "stores"
        self.manifest_path = self.stores / "manifest.json"
        self.backup_dir = backup_dir or (self.root / "workflow" / "saves" / "desk")
        self.touched: dict[str, str | None] = {}   # rel path -> original text (None = new file)

    # ---- raw file io (round-trip safe, backed up before the first write) ----
    def _rel(self, path: Path) -> str:
        return path.resolve().relative_to(self.root.resolve()).as_posix()

    def read_text(self, path: Path) -> str:
        """Byte-exact text (CRLF files stay CRLF; Path.read_text() would translate them)."""
        return path.read_bytes().decode("utf-8")

    def write_text(self, path: Path, text: str) -> None:
        rel = self._rel(path)
        if rel not in self.touched:
            self.touched[rel] = self.read_text(path) if path.exists() else None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))

    def load_json(self, path: Path) -> Any:
        return json.loads(self.read_text(path))

    @staticmethod
    def dumps(value: Any) -> str:
        return json.dumps(value, indent=2, ensure_ascii=False) + "\n"

    def write_json(self, path: Path, value: Any) -> None:
        """2-space JSON in the file's own line endings."""
        text = self.dumps(value)
        if path.exists() and b"\r\n" in path.read_bytes()[:4000]:
            text = text.replace("\n", "\r\n")
        self.write_text(path, text)

    # ---- manifest + shards ----
    def manifest(self) -> dict[str, Any]:
        return self.load_json(self.manifest_path)

    def bundle(self, kind: str) -> list[dict[str, Any]]:
        """Read a generated bundle (data/<kind>.json) as a list of records."""
        path = self.data / f"{kind}.json"
        if not path.exists():
            return []
        value = self.load_json(path)
        if isinstance(value, dict):
            for key in (kind, "events", "characters", "locations", "records"):
                if isinstance(value.get(key), list):
                    return value[key]
            return []
        return value if isinstance(value, list) else []

    def shard_of(self, kind: str, rid: str) -> str | None:
        return (self.manifest().get(kind, {}).get("shards") or {}).get(rid)

    def get(self, kind: str, rid: str) -> dict[str, Any] | None:
        rel = self.shard_of(kind, rid)
        if not rel:
            return None
        for rec in self._rows(self.stores / rel):
            if str(rec.get("id")) == rid:
                return rec
        return None

    def _rows(self, path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        value = self.load_json(path)
        if isinstance(value, list):
            return value
        raise ValueError(f"{self._rel(path)} is not a JSON list shard")

    def pick_shard(self, kind: str, world: str, year: int | None = None) -> str:
        """Where a new record goes: the last non-full shard for its world (and year)."""
        world = world if world in WORLDS else "material"
        if kind in ("events", "battles"):
            folder = self.stores / kind / world
            stem = str(year) if year else "undated"
            names = sorted(p.name for p in folder.glob("*.json")
                           if p.stem == stem or p.stem.startswith(stem + "-")) if folder.exists() else []
            # Month-split years (1040-aethel.json) are left to a person: use only plain year files.
            plain = [n for n in names if re.fullmatch(rf"{re.escape(stem)}(?:-[a-z])?\.json", n)]
            for name in reversed(plain):
                if (folder / name).stat().st_size < SHARD_LIMIT:
                    return f"{kind}/{world}/{name}"
            if not plain:
                if not folder.exists() and world != "material":
                    return self.pick_shard(kind, "material", year)
                return f"{kind}/{world}/{stem}.json"
            last = plain[-1]
            letter = re.search(r"-([a-z])\.json$", last)
            nxt = chr(ord(letter.group(1)) + 1) if letter else "b"
            return f"{kind}/{world}/{stem}-{nxt}.json"
        folder = self.stores / kind
        names = sorted(p.name for p in folder.glob(f"{world}*.json")) if folder.exists() else []
        if not names and world != "material":   # never start a new world file for a stub
            return self.pick_shard(kind, "material", year)
        for name in reversed(names):
            if (folder / name).stat().st_size < SHARD_LIMIT:
                return f"{kind}/{name}"
        if not names:
            return f"{kind}/{world}.json"
        letter = re.search(r"-([a-z])\.json$", names[-1])
        nxt = chr(ord(letter.group(1)) + 1) if letter else "b"
        return f"{kind}/{world}-{nxt}.json"

    def unique_id(self, kind: str, base: str) -> str:
        shards = self.manifest().get(kind, {}).get("shards") or {}
        rid, n = base, 2
        while rid in shards:
            rid, n = f"{base}_{n}", n + 1
        return rid

    def upsert(self, kind: str, record: dict[str, Any], shard: str | None = None) -> str:
        """Add (appended last, so it is the newest filing) or replace by id. Returns the shard."""
        rid = str(record.get("id") or "")
        if not rid:
            raise ValueError("record has no id")
        manifest = self.manifest()
        spec = manifest.setdefault(kind, {"bundle": f"{kind}.json", "n": 0, "order": [], "shards": {}})
        existing = (spec.get("shards") or {}).get(rid)
        rel = existing or shard
        if not rel:
            raise ValueError(f"{kind}/{rid}: no shard chosen")
        path = self.stores / rel
        rows = self._rows(path)
        if existing:
            for i, rec in enumerate(rows):
                if str(rec.get("id")) == rid:
                    rows[i] = record
                    break
            else:
                raise ValueError(f"{kind}/{rid}: manifest says {rel} but the record is not there")
        else:
            rows.append(record)
            spec.setdefault("order", []).append(rid)
            spec.setdefault("shards", {})[rid] = rel
            spec["n"] = len(spec["order"])
            self.write_json(self.manifest_path, manifest)
        self.write_json(path, rows)
        return rel

    # ---- other files the desk touches ----
    def append_pending_news(self, rid: str, note: str, filed: str) -> None:
        path = self.root / "tools" / "rnn-scripts" / "pending-news-articles.json"
        if not path.exists():
            return
        value = self.load_json(path)
        pending = value.setdefault("pending", [])
        if any(isinstance(p, dict) and p.get("id") == rid for p in pending):
            return
        pending.append({"id": rid, "filed": filed, "note": note})
        self.write_json(path, value)

    def set_home(self, rid: str, label: str, excerpt: str, title: str, tags: list[str]) -> None:
        path = self.data / "mainPage.json"
        if path.exists():
            text = self.read_text(path)
            value = json.loads(text)
            value["latestUpdate"] = {"id": rid, "label": label, "excerpt": excerpt}
            # the file's own indent (CRLF-safe: the old startswith check read 4 on a CRLF copy)
            found = re.search(r"\n( +)\"", text)
            indent = len(found.group(1)) if found else 2
            out = json.dumps(value, indent=indent, ensure_ascii=False) + "\n"
            if "\r\n" in text:
                out = out.replace("\n", "\r\n")
            self.write_text(path, out)
        index = self.root / "index.html"
        if index.exists():
            html = self.read_text(index)
            marker = "let SITE_UPDATES=["
            at = html.find(marker)
            if at >= 0 and f'"id":"{rid}","kind"' not in html[at:at + 4000]:
                entry = json.dumps({"id": rid, "kind": "event", "label": label, "title": title,
                                    "summary": excerpt, "tags": tags}, ensure_ascii=False, separators=(",", ":"))
                cut = at + len(marker)
                self.write_text(index, html[:cut] + entry + "," + html[cut:])

    # ---- undo ----
    def save_backup(self, job: str) -> Path:
        folder = self.backup_dir / job
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "backup.json").write_bytes(json.dumps({"saved": time.time(), "files": self.touched},
                                                        ensure_ascii=False).encode("utf-8"))
        return folder

    def adopt(self, job: str) -> None:
        """Take over an earlier job's backup (a continued run): its originals become this
        store's originals, so one Undo of the continuation reverses both runs."""
        path = self.backup_dir / job / "backup.json"
        if path.exists():
            for rel, original in json.loads(path.read_bytes().decode("utf-8"))["files"].items():
                self.touched.setdefault(rel, original)

    def save_state(self, job: str, state: dict[str, Any]) -> None:
        folder = self.backup_dir / job
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / "state.json.tmp"
        tmp.write_bytes(json.dumps(state, ensure_ascii=False).encode("utf-8"))
        tmp.replace(folder / "state.json")

    def load_state(self, job: str) -> dict[str, Any] | None:
        path = self.backup_dir / job / "state.json"
        return json.loads(path.read_bytes().decode("utf-8")) if path.exists() else None

    def undo(self, job: str) -> list[str]:
        """Restore every file this job touched. New files are emptied, never deleted:
        the person deletes leftovers by hand."""
        backup = json.loads((self.backup_dir / job / "backup.json").read_bytes().decode("utf-8"))
        notes = []
        for rel, original in backup["files"].items():
            path = self.root / rel
            if original is None:
                path.write_bytes(b"[]\n")
                notes.append(f"{rel} was new — emptied; delete it by hand")
            else:
                path.write_bytes(original.encode("utf-8"))
                notes.append(f"restored {rel}")
        return notes

    # ---- build + checks ----
    def run_tool(self, args: str, timeout: int = 300) -> tuple[bool, str]:
        parts = args.split()
        cmd = [sys.executable, str(self.root / "tools" / parts[0]), *parts[1:]]
        try:
            proc = subprocess.run(cmd, cwd=self.root, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=timeout,
                                  env={**__import__("os").environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
        except subprocess.TimeoutExpired:
            return False, f"{parts[0]} timed out"
        out = (proc.stdout + proc.stderr).strip().splitlines()
        return proc.returncode == 0, "\n".join(out[-25:])

    def build_and_check(self, checks: tuple[str, ...] = FILING_CHECKS,
                        on_step: Callable[[str, bool, str], None] | None = None) -> list[tuple[str, bool, str]]:
        results = []
        for args in ("build-json-stores.py --build --check", *checks):
            ok, tail = self.run_tool(args)
            results.append((args, ok, tail))
            if on_step:
                on_step(args, ok, tail)
            if not ok and args.startswith("build-json-stores"):
                break
        return results

    # ---- time ----
    def current_date(self) -> tuple[int, int, int]:
        path = self.data / "currentDate.json"
        cd = self.load_json(path) if path.exists() else {"year": 1040, "monthIndex": 0, "day": 1}
        return int(cd["year"]), int(cd["monthIndex"]) + 1, int(cd["day"])


def abs_day(y: int, m: int, d: int) -> int:
    return y * 365 + sum(DAYS[:m - 1]) + d


def time_code(guess: dict[str, Any], world: str, now: tuple[int, int, int]) -> tuple[str, str, bool, list[str]]:
    """Validate the model's date guess. Returns (timeCode, timeWindow, laterDated, notes).
    No date in the account means the world clock's day; the hour is always an estimate."""
    notes: list[str] = []
    clock = str(guess.get("clock") or WORLD_CLOCK.get(world, "MAT")).upper()
    if clock not in CLOCKS:
        clock = WORLD_CLOCK.get(world, "MAT")
    stated = bool(guess.get("stated"))

    def num(key: str, default: int) -> int:
        try:
            return int(guess.get(key))
        except (TypeError, ValueError):
            return default
    y, m, d = now
    if stated:
        y, m, d = num("year", y), num("month", m), num("day", d)
    if not 1 <= m <= 12:
        notes.append(f"month {m} out of range — used the world clock month")
        m = now[1]
    if not 1 <= d <= DAYS[m - 1]:
        notes.append(f"{MONTHS[m - 1]} has {DAYS[m - 1]} days — clamped day {d}")
        d = max(1, min(d, DAYS[m - 1]))
    hh, mm = num("hour", 20), num("minute", 0)
    if not (0 <= hh <= 23 and 0 <= mm <= 59):
        hh, mm = 20, 0
    later = False
    if clock == "MAT" and abs_day(y, m, d) > abs_day(*now):
        if stated:
            later = True
            notes.append("the account states a date after the world clock — flagged laterDated; advance currentDate.json if that is right")
        else:
            y, m, d = now
    code = f"TC:{y}-{m:02d}-{d:02d}T{hh:02d}:{mm:02d}/{clock}"
    basis = str(guess.get("basis") or "").strip()
    window = (f"{d} {MONTHS[m - 1]} {y}; " + ("date stated in the account" if stated else "no date in the account — placed on the world clock's day")
              + f"; the hour ({hh:02d}:{mm:02d}) is an estimate" + (f" from {basis}" if basis else "") + ".")
    assert CODE_RE.match(code), code
    return code, window, later, notes


# ---- rule zero ----
SPEAKER_RE = re.compile(r"^\s*(?:\[[^\]]{0,24}\]\s*)?([A-Za-z0-9_.' -]{2,32}?)\s*(?:\(.*?\))?\s*[:：]\s+\S", re.M)


def configured_handles(root: Path = ROOT) -> set[str]:
    """Player / GM handles the person lists in workflow/desk-handles.json (a JSON list)."""
    path = root / "workflow" / "desk-handles.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return {str(v).strip() for v in value if str(v).strip()}
    except (OSError, ValueError, TypeError):
        return set()


def speaker_handles(transcript: str, known_names: set[str], root: Path = ROOT) -> set[str]:
    """Speaker labels that look like Discord handles (digits, _ or . in them, or an
    all-lowercase single word) and are not a character name, plus `mike` and the
    configured list. NPC labels such as "Guard:" are left alone."""
    handles = {"mike"} | configured_handles(root)
    for match in SPEAKER_RE.finditer(transcript):
        label = match.group(1).strip()
        if not norm(label) or norm(label) in known_names:
            continue
        handle_like = bool(re.search(r"[0-9_.]", label)) or (label.islower() and " " not in label)
        if handle_like:
            handles.add(label)
    return handles


def handle_hits(text: str, handles: set[str]) -> list[str]:
    return sorted({h for h in handles if re.search(rf"(?<![\w]){re.escape(h)}(?![\w])", text, re.I)})


def scrub_handles(text: str, handles: set[str]) -> str:
    for h in sorted(handles, key=len, reverse=True):
        text = re.sub(rf"(?<![\w]){re.escape(h)}(?![\w])", "the Narrator" if h.lower() == "mike" else "a traveller",
                      text, flags=re.I)
    return text


def banned_word_hits(text: str) -> list[str]:
    plain = re.sub(r"\"[^\"]*\"|“[^”]*”", " ", text)   # quotes are allowed to keep their words
    # stems, so plurals and forms count too: capability → capabilities, category → categories
    return sorted({w for w in BANNED_WORDS
                   if re.search(rf"\b{w[:-1] if w.endswith('y') else w}\w*", plain, re.I)})
