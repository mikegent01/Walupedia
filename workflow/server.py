#!/usr/bin/env python3
"""Small chat-first local server.

The browser talks to one job API. Normal chat goes straight to the local model;
the runtime only touches repository helpers after an explicit archive request.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
INDEX = Path(__file__).resolve().parent / "index.html"
ROLEPLAY = Path(__file__).resolve().parent / "roleplay.html"
RM_ROOT = ROOT / "Reputation-Matrix2"
AGENT_PATH = ROOT / "Reputation-Matrix2/tools/local-agent/agent_runtime.py"
DEFAULT_LM = os.environ.get("LM_STUDIO_URL", "")
MAX_BODY = 2 * 1024 * 1024

# Static types for the archive files the roleplay page borrows (portraits,
# event plates). Everything else is served as a download-safe octet stream.
STATIC_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}

# LM Studio binds its local server to one of a few common addresses. The env
# variable always wins; otherwise the first reachable candidate is used.
CANDIDATE_BASES = (
    "http://127.0.0.1:1234",
    "http://localhost:1234",
    "http://127.0.0.1:1235",
    "http://localhost:1235",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
)
PROBE_TTL = 15.0
_probe_state: dict[str, Any] = {"at": 0.0, "value": None}


def completions_url(base: str) -> str:
    """Normalize any base/model/completions URL to the full completions URL."""
    value = str(base or "").strip().rstrip("/")
    if value.endswith("/chat/completions"):
        return value
    if value.endswith("/v1"):
        return value + "/chat/completions"
    return value + "/v1/chat/completions"


def _base_url(value: str) -> str:
    value = str(value or "").strip().rstrip("/")
    for suffix in ("/chat/completions", "/v1"):
        if value.endswith(suffix):
            value = value[: -len(suffix)]
    return value.rstrip("/")


def _probe_base(base: str) -> dict[str, Any] | None:
    try:
        with urllib.request.urlopen(base + "/v1/models", timeout=1.2) as response:
            value = json.loads(response.read())
        models = [str(item.get("id", "")) for item in value.get("data", []) if isinstance(item, dict)] \
            if isinstance(value, dict) else []
        return {"base": base, "models": models[:20]}
    except Exception:
        return None


def probe_lm(force: bool = False) -> dict[str, Any]:
    """Find a reachable local model server; cached briefly to stay cheap."""
    now = time.time()
    cached = _probe_state["value"]
    if not force and cached and now - _probe_state["at"] < PROBE_TTL:
        return cached
    bases = ([_base_url(DEFAULT_LM)] if DEFAULT_LM else []) + list(CANDIDATE_BASES)
    online: list[dict[str, Any]] = []
    seen: set[str] = set()
    for base in bases:
        if not base or base in seen:
            continue
        seen.add(base)
        found = _probe_base(base)
        if found:
            online.append(found)
    value = {
        "online": bool(online),
        "endpoints": online,
        "default": completions_url(online[0]["base"]) if online else completions_url(CANDIDATE_BASES[0]),
        "env_override": bool(DEFAULT_LM),
    }
    _probe_state["at"] = time.time()
    _probe_state["value"] = value
    return value


def resolve_endpoint(payload_endpoint: Any) -> str:
    """Explicit request override > environment > first reachable candidate."""
    explicit = str(payload_endpoint or "").strip()
    if explicit:
        return completions_url(explicit)
    if DEFAULT_LM:
        return completions_url(DEFAULT_LM)
    return probe_lm()["default"]


ROLEPLAY_TIMEOUT = float(os.environ.get("ROLEPLAY_TIMEOUT_SECONDS", "120"))


def lm_completion(endpoint: str, system: str, messages: list[dict[str, Any]],
                  temperature: float, max_tokens: int) -> str:
    """One plain chat completion for the roleplay page — no agent loop, no
    repository tools. One retry with a doubled budget covers a slow local
    model, mirroring the patience the chat-first runtime already shows."""
    body = json.dumps({
        "messages": ([{"role": "system", "content": system}] if system else []) + messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        # Replies here are plain text tasks: thinking is off per-request.
        # Servers that do not know the parameter ignore it; Qwen3-family
        # templates honour it and stop burning the budget on reasoning.
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode("utf-8")
    last_error = "model did not answer"
    for attempt in (1, 2):
        try:
            request = urllib.request.Request(
                endpoint,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=ROLEPLAY_TIMEOUT * attempt) as response:
                value = json.loads(response.read())
            choices = value.get("choices", []) if isinstance(value, dict) else []
            text = choices[0].get("message", {}).get("content", "") if choices else ""
            # A thinking model that leaks its deliberation into the reply
            # would otherwise file it into history and re-send it forever.
            text = re.sub(r"<think>[\s\S]*?</think>", " ", str(text), flags=re.IGNORECASE).strip()
            if str(text).strip():
                return str(text)
            last_error = "the model returned an empty reply"
        except urllib.error.HTTPError as error:
            last_error = f"LM Studio answered {error.code}: {error.read()[:180].decode('utf-8', 'replace')}"
        except Exception as error:  # noqa: BLE001 - surfaced to the page verbatim
            last_error = f"could not reach the model: {error}"
    raise ValueError(last_error)


def roleplay_reply(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and run one roleplay turn. Straight to the model, nothing else."""
    system = str(payload.get("system", "")).strip()
    # The page budgets its own prompt (RP.PROMPT_BUDGET, settable up to 30k);
    # this cap is the hard wall behind it, not the working limit.
    if len(system) > 32000:
        raise ValueError("system prompt is too long")
    raw = payload.get("messages", [])
    if not isinstance(raw, list) or not raw:
        raise ValueError("messages are required")
    messages: list[dict[str, Any]] = []
    for item in raw[-240:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", ""))
        content = str(item.get("content", ""))
        if role not in ("user", "assistant") or not content.strip():
            continue
        if len(content) > 16000:
            # One runaway turn, not a reason to fail the whole call: the
            # page clips history turns itself (RP.TURN_CLIP); anything this
            # size is an import artefact, and the head of it still serves.
            content = content[:16000]
        messages.append({"role": role, "content": content})
    if not messages:
        raise ValueError("no usable messages")
    try:
        temperature = float(payload.get("temperature", 0.85))
    except (TypeError, ValueError):
        temperature = 0.85
    temperature = max(0.0, min(1.5, temperature))
    try:
        max_tokens = int(payload.get("max_tokens", 700))
    except (TypeError, ValueError):
        max_tokens = 700
    max_tokens = max(64, min(2048, max_tokens))
    text = lm_completion(resolve_endpoint(payload.get("endpoint")), system, messages,
                         temperature, max_tokens)
    return {"text": text}


def _clip(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _faiths(value: Any, limit: int = 160) -> str:
    """`faiths` is a string on old records and a list of {id, role, note}
    objects on new ones; the prompt wants one short line either way."""
    if not value:
        return ""
    if isinstance(value, str):
        return _clip(value, limit)
    parts: list[str] = []
    for item in value if isinstance(value, list) else [value]:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            name = str(item.get("name") or item.get("id") or "").replace("_", " ")
            role = str(item.get("role") or "")
            parts.append(f"{name} ({role})" if role else name)
    return _clip("; ".join(p for p in parts if p), limit)


def archive_cast() -> dict[str, Any]:
    """The wiki's own characters, served as the roleplay starter cast."""
    path = RM_ROOT / "data" / "characters.json"
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - the page works without the cast
        return {"characters": [], "error": f"could not read characters.json: {error}"}
    if isinstance(records, dict):
        records = records.get("characters", [])
    out = []
    for record in records:
        if not isinstance(record, dict) or not record.get("name"):
            continue
        image = str(record.get("image") or "")
        out.append({
            "id": str(record.get("id") or record["name"]),
            "name": _clip(record.get("name"), 60),
            "title": _clip(record.get("title"), 90),
            "race": _clip(record.get("race"), 40),
            "affiliation": _clip(record.get("affiliation"), 120),
            # The filed description is what makes a character behave like
            # themselves in a prompt, so it is served rather than summarised
            # away; the rest are what the cast browser sorts and filters on.
            "description": _clip(record.get("description"), 900),
            "faction": _clip(record.get("faction") or record.get("membership"), 80),
            "faiths": _faiths(record.get("faiths")),
            "level": record.get("level"),
            "powerLevel": record.get("powerLevel"),
            "fameScore": record.get("fameScore"),
            "fameTier": _clip(record.get("fameTier"), 40),
            "relatedArticles": [str(a) for a in (record.get("relatedArticles") or [])][:14],
            # The backfill scan reads these to find events everyone points at
            # and nobody ever wrote.
            "keyEvents": [str(k) for k in (record.get("keyEvents") or [])][:12],
            "status": _clip(record.get("status"), 90),
            "summary": _clip(record.get("summary"), 200),
            "image": "/rm/" + image if image else "",
        })
    out.sort(key=lambda c: c["name"].lower())
    return {"characters": out}


def _cast_index() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_id: dict[str, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    try:
        records = json.loads((RM_ROOT / "data" / "characters.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - an unreadable cast just yields no index
        return by_id, by_name
    if isinstance(records, dict):
        records = records.get("characters", [])
    for record in records:
        if not isinstance(record, dict) or not record.get("id"):
            continue
        entry = {
            "id": str(record["id"]),
            "name": _clip(record.get("name"), 60),
            "image": "/rm/" + str(record.get("image") or "") if record.get("image") else "",
        }
        by_id[entry["id"]] = entry
        by_name[entry["name"].lower()] = entry
    return by_id, by_name


def _suggest_cast(record: dict[str, Any], by_id: dict[str, dict[str, Any]],
                  by_name: dict[str, dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    """The filed event's own participants, resolved to playable characters."""
    out: list[dict[str, Any]] = []
    for part in record.get("participants") or []:
        if not isinstance(part, dict):
            continue
        hit = by_id.get(str(part.get("id") or "")) or by_name.get(str(part.get("name") or "").lower())
        if hit and hit not in out:
            out.append(hit)
    return out[:limit]


def _beats_for(record: dict[str, Any], limit: int = 12) -> list[dict[str, str]]:
    """The event's own timeline becomes the script: beats that fire on their
    own schedule while the user plays everyone else. Events without a filed
    timeline fall back to their summary sentences."""
    timeline = record.get("timeline")
    entries = timeline.get("entries") if isinstance(timeline, dict) else None
    out: list[dict[str, str]] = []
    if isinstance(entries, list) and entries:
        step = max(1, len(entries) // limit)
        for entry in entries[::step][:limit]:
            if not isinstance(entry, dict):
                continue
            beat = _clip(entry.get("beat"), 140) or _clip(entry.get("detail"), 140)
            if not beat:
                continue
            out.append({
                "time": _clip(entry.get("time"), 60),
                "beat": beat,
                "detail": _clip(entry.get("detail"), 260),
            })
    if not out:
        summary = _clip(record.get("summary"), 500)
        parts = [part.strip() for part in summary.split(".") if len(part.strip()) > 24]
        for i, part in enumerate(parts[:5]):
            out.append({"time": f"beat {i + 1}", "beat": _clip(part, 140), "detail": ""})
    return out


def archive_scenes(limit: int = 12) -> dict[str, Any]:
    """Newest filed sessions become scene starters — played from a DIFFERENT
    perspective: the filed event runs on its own scripted beats while the
    user plays other characters around it."""
    path = RM_ROOT / "data" / "events.json"
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001
        return {"scenes": [], "error": f"could not read events.json: {error}"}
    if isinstance(records, dict):
        records = records.get("events", [])
    picks = [r for r in records if isinstance(r, dict) and r.get("name") and r.get("image")][-limit:]
    picks.reverse()  # newest filings first
    by_id, by_name = _cast_index()
    out = []
    for record in picks:
        image = str(record.get("image") or "")
        beats = _beats_for(record)
        out.append({
            "id": str(record.get("id") or record.get("name")),
            "name": _clip(record.get("name"), 70),
            "summary": _clip(record.get("summary"), 220),
            "era": _clip(record.get("era"), 60),
            "date": _clip(record.get("date"), 40),
            "location": _clip(record.get("location"), 60),
            "image": "/rm/" + image if image else "",
            "suggestedCast": _suggest_cast(record, by_id, by_name),
            "beats": beats,
        })
    return {"scenes": out}


def archive_wire(limit: int = 400) -> dict[str, Any]:
    """The WAHwire, served whole: every filed post is a playable scenario.

    The page decides the sort and the used/unused view; the server just hands
    over the posts and the author profiles (for avatars) in one response.
    """
    posts_path = RM_ROOT / "data" / "wahwire" / "posts.json"
    profiles_path = RM_ROOT / "data" / "wahwire" / "profiles.json"
    try:
        posts = json.loads(posts_path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - the page works without the wire
        return {"posts": [], "profiles": {}, "error": f"could not read the wire: {error}"}
    if isinstance(posts, dict):
        posts = posts.get("posts", [])
    try:
        profiles = json.loads(profiles_path.read_text(encoding="utf-8"))
        profiles = profiles.get("profiles", profiles) if isinstance(profiles, dict) else {}
    except Exception:  # noqa: BLE001 - avatars are decoration, not content
        profiles = {}
    return {"posts": posts[:limit], "profiles": profiles}


def archive_collections() -> dict[str, Any]:
    """The archive's own character collections — a cast in one click."""
    path = RM_ROOT / "data" / "collections.json"
    try:
        records = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001
        return {"collections": [], "error": f"could not read collections.json: {error}"}
    if isinstance(records, dict):
        records = records.get("collections", [])
    out = []
    for record in records:
        if not isinstance(record, dict) or not record.get("members"):
            continue
        out.append({
            "id": str(record.get("id") or record.get("name")),
            "name": _clip(record.get("name"), 90),
            "title": _clip(record.get("title"), 120),
            "scope": _clip(record.get("scope"), 120),
            "summary": _clip(record.get("summary"), 300),
            "members": [
                {"id": str(m.get("id") or ""), "name": _clip(m.get("name"), 60), "role": _clip(m.get("role"), 90)}
                for m in record["members"] if isinstance(m, dict)
            ],
        })
    return {"collections": out}


def _read(*parts: str) -> Any:
    try:
        return json.loads((RM_ROOT.joinpath(*parts)).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - a missing source just yields no scenarios
        return None


def archive_bundle() -> dict[str, Any]:
    """The records the What-If board is composed from, trimmed for the wire.

    The page builds every scenario itself from this bundle — filed What-Ifs,
    the events (with their timelines, which become the beats), the factions
    (chambers, and the leadership rosters the wanted-pages scan reads), and
    the Congress. No model is involved in deciding what a scenario is.
    """
    whatifs = _read("data", "whatifs.json") or []
    if isinstance(whatifs, dict):
        whatifs = whatifs.get("whatifs", [])
    out_whatifs = []
    for record in whatifs:
        if not isinstance(record, dict):
            continue
        out_whatifs.append({
            "id": str(record.get("id") or ""),
            "title": _clip(record.get("title"), 140),
            "premise": _clip(record.get("premise"), 700),
            "summary": _clip(record.get("summary"), 900),
            "divergence": _clip(record.get("divergence"), 500),
            "epigraph": _clip(record.get("epigraph"), 300),
            "outcome": _clip(record.get("outcome"), 600),
            "subject": _clip(record.get("subject"), 60),
            "subjectImage": "/rm/" + str(record["subjectImage"]) if record.get("subjectImage") else "",
            "tags": [str(t) for t in (record.get("tags") or [])][:10],
            "filed": _clip(record.get("filed"), 60),
            "wordCount": record.get("wordCount"),
            "resetsTotal": record.get("resetsTotal"),
            "verdict": {"body": _clip((record.get("verdict") or {}).get("body"), 800)} if record.get("verdict") else None,
            "findings": [{"t": _clip(f.get("t"), 160)} for f in (record.get("findings") or [])[:4] if isinstance(f, dict)],
            "chapters": [{
                "heading": _clip(c.get("heading"), 140),
                "phase": _clip(c.get("phase"), 40),
                "body": _clip(c.get("body"), 700),
            } for c in (record.get("chapters") or [])[:10] if isinstance(c, dict)],
        })

    events = _read("data", "events.json") or []
    if isinstance(events, dict):
        events = events.get("events", [])
    out_events = []
    for record in events[-60:]:
        if not isinstance(record, dict) or not record.get("name"):
            continue
        entries = ((record.get("timeline") or {}).get("entries") or [])[:12]
        out_events.append({
            "id": str(record.get("id") or ""),
            "name": _clip(record.get("name"), 90),
            "summary": _clip(record.get("summary"), 700),
            "outcome": _clip(record.get("outcome"), 600),
            "description": str(record.get("description") or "")[:2400],
            # Continuations pick a saga up where it stops, so they need how it
            # ended and what it left behind.
            "aftermath": str(record.get("aftermath") or "")[:1600],
            "notableFeatures": str(record.get("notableFeatures") or "")[:800],
            "era": _clip(record.get("era"), 60),
            "type": _clip(record.get("type"), 60),
            "date": _clip(record.get("date"), 90),
            "location": _clip(record.get("location"), 120),
            "image": "/rm/" + str(record["image"]) if record.get("image") else "",
            "participants": [{
                "id": str(p.get("id") or ""), "name": _clip(p.get("name"), 60), "role": _clip(p.get("role"), 160),
            } for p in (record.get("participants") or [])[:8] if isinstance(p, dict)],
            "relatedArticles": [str(a) for a in (record.get("relatedArticles") or [])][:16],
            "keyEvents": [str(k) for k in (record.get("keyEvents") or [])][:12],
            "timeline": {"entries": [{
                "time": _clip(e.get("time"), 60), "beat": _clip(e.get("beat"), 160), "detail": _clip(e.get("detail"), 420),
            } for e in entries if isinstance(e, dict)]},
        })

    factions = _read("data", "factions.json") or []
    if isinstance(factions, dict):
        factions = factions.get("factions", [])
    out_factions = []
    for record in factions:
        if not isinstance(record, dict) or not record.get("name"):
            continue
        out_factions.append({
            "id": str(record.get("id") or ""),
            "name": _clip(record.get("name"), 90),
            "type": _clip(record.get("type"), 60),
            "region": _clip(record.get("region"), 60),
            "summary": _clip(record.get("summary"), 600),
            "description": str(record.get("description") or "")[:2600],
            "leadership": [{
                "id": str(m.get("id") or ""), "name": _clip(m.get("name"), 60), "role": _clip(m.get("role"), 160),
            } for m in (record.get("leadership") or [])[:6] if isinstance(m, dict)],
            "keyEvents": [str(k) for k in (record.get("keyEvents") or [])][:12],
        })

    congress = _read("data", "congress.json") or {}
    out_congress = {
        "sessions": [{
            "name": _clip(s.get("name"), 90), "date": _clip(s.get("date"), 60),
            "year": s.get("year"), "summary": _clip(s.get("summary"), 500),
        } for s in (congress.get("sessions") or [])[:6] if isinstance(s, dict)],
        "crises": [{
            "name": _clip(c.get("name"), 90), "year": c.get("year"),
            "severity": _clip(c.get("severity"), 40), "summary": _clip(c.get("summary"), 500),
        } for c in (congress.get("crises") or [])[:6] if isinstance(c, dict)],
    } if isinstance(congress, dict) else {}

    # Every filed id, so the page's backfill scan does not mistake an event
    # outside this window for an unwritten one.
    known = [str(r.get("id") or "") for r in events if isinstance(r, dict)]
    known += [str(r.get("name") or "") for r in events if isinstance(r, dict)]
    return {
        "whatifs": out_whatifs, "events": out_events, "factions": out_factions,
        "congress": out_congress, "knownIds": [k for k in known if k],
        # The world clock, so the page knows what "now" is in-world.
        "clock": _read("data", "currentDate.json") or {},
    }


SAVE_DIR = Path(__file__).resolve().parent / "saves"
SAVE_MAX_BYTES = 64_000_000        # the disk is the overflow once the browser's ~5 MB is full
SAVE_KEEP = 10                     # timestamped backups kept beside the live file


def _save_path(name: str = "chatroom") -> Path:
    """A save name is a filename, not a path: no traversal, no surprises."""
    clean = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(name or "chatroom")).strip("-")[:48] or "chatroom"
    return SAVE_DIR / f"{clean}.json"


def chatroom_save(payload: dict[str, Any]) -> dict[str, Any]:
    """Write the reader's chatroom state to disk, beside the server.

    localStorage is one cleared cache away from gone. This keeps the same
    bundle the page exports as a real file on the machine the server runs on,
    with a handful of timestamped backups behind it.
    """
    bundle = payload.get("state")
    if not isinstance(bundle, dict):
        raise ValueError("no state to save")
    body = json.dumps(bundle, ensure_ascii=False, indent=1)
    if len(body.encode("utf-8")) > SAVE_MAX_BYTES:
        raise ValueError("that save is too large")
    SAVE_DIR.mkdir(parents=True, exist_ok=True)
    path = _save_path(payload.get("name"))
    # A fresh browser (empty storage) must not autosave over a save full of chats.
    if path.exists() and not bundle.get("rooms") and not payload.get("force"):
        try:
            had = len(json.loads(path.read_text(encoding="utf-8")).get("rooms") or [])
        except Exception:  # noqa: BLE001 - unreadable file: let the new save through
            had = 0
        if had:
            raise ValueError(f"refusing to replace a save with {had} chats by one with none")
    if path.exists():
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = path.with_name(f"{path.stem}.{stamp}.bak.json")
        try:
            backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        except Exception:  # noqa: BLE001 - a failed backup must not lose the save
            pass
        olds = sorted(SAVE_DIR.glob(f"{path.stem}.*.bak.json"))
        for stale in olds[:-SAVE_KEEP]:
            try:
                stale.unlink()
            except Exception:  # noqa: BLE001
                pass
    path.write_text(body, encoding="utf-8")
    return {
        "saved": path.name,
        "bytes": len(body.encode("utf-8")),
        "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "rooms": len(bundle.get("rooms") or []),
        "where": str(path),
    }


def chatroom_saves() -> dict[str, Any]:
    """What is on disk, newest first — the live saves, not the backups."""
    if not SAVE_DIR.is_dir():
        return {"saves": []}
    out = []
    for path in sorted(SAVE_DIR.glob("*.json")):
        if path.name.endswith(".bak.json"):
            continue
        try:
            stat = path.stat()
            head = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 - a broken file is still worth listing
            head, stat = {}, path.stat()
        out.append({
            "name": path.stem,
            "bytes": stat.st_size,
            "at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)),
            "rooms": len(head.get("rooms") or []),
            "book": len(head.get("book") or []),
        })
    out.sort(key=lambda row: row["at"], reverse=True)
    return {"saves": out}


def chatroom_load(name: str) -> dict[str, Any]:
    path = _save_path(name)
    if not path.is_file():
        raise ValueError("no save by that name")
    return {"name": path.stem, "state": json.loads(path.read_text(encoding="utf-8"))}


def suggest_cast(payload: dict[str, Any]) -> dict[str, Any]:
    """Ask the model for an interesting cast for a scene. The candidate list
    comes from the page (optionally filtered by the picker's search box); the
    model may only pick names from it. Returns resolved character ids."""
    scene = _clip(payload.get("scene"), 500)
    if not scene:
        raise ValueError("scene is required")
    raw = payload.get("candidates")
    if not isinstance(raw, list) or not raw:
        raise ValueError("candidates are required")
    candidates: list[dict[str, str]] = []
    for item in raw[:500]:
        if isinstance(item, dict) and str(item.get("name") or "").strip():
            candidates.append({"id": str(item.get("id") or ""), "name": _clip(item.get("name"), 60)})
    if not candidates:
        raise ValueError("no usable candidates")
    try:
        count = int(payload.get("count", 4))
    except (TypeError, ValueError):
        count = 4
    count = max(2, min(8, count))
    prompt = (
        "You are casting a group roleplay scene. The scene: " + scene + "\n\n"
        "From ONLY the characters listed below, pick the " + str(count) + " that would create the most "
        "interesting scene played from a DIFFERENT perspective than the original filing — "
        "witnesses, bystanders, rivals, or people with their own business in the same place.\n"
        + "\n".join("- " + c["name"] for c in candidates) +
        "\n\nReply with ONLY a JSON array of names, for example [\"Name One\", \"Name Two\"]. No other text."
    )
    text = lm_completion(resolve_endpoint(payload.get("endpoint")), "",
                         [{"role": "user", "content": prompt}], 0.7, 300)
    import re as _re
    match = _re.search(r"\[[^\]]*\]", str(text), _re.S)
    names: list[str] = []
    if match:
        try:
            value = json.loads(match.group(0))
            if isinstance(value, list):
                names = [str(x) for x in value if x]
        except Exception:  # noqa: BLE001 - fall through to quoted-string scan
            names = []
    if not names:
        names = _re.findall(r'"([^"\n]{1,60})"', str(text))
    by_lower = {c["name"].lower(): c for c in candidates}
    resolved: list[dict[str, str]] = []
    for name in names[:count]:
        hit = by_lower.get(name.strip().lower())
        if not hit:
            short = [c for c in candidates if name.strip().lower() in c["name"].lower()
                     or c["name"].lower() in name.strip().lower()]
            hit = short[0] if short else None
        if hit and hit not in resolved:
            resolved.append(hit)
    return {"ids": [c["id"] for c in resolved], "names": [c["name"] for c in resolved]}


def serve_static(relative: str) -> tuple[bytes, str] | None:
    """Serve one file from the Reputation-Matrix2 tree; None means 404."""
    cleaned = "/".join(part for part in relative.split("/") if part not in ("", ".", ".."))
    if not cleaned:
        return None
    candidate = (RM_ROOT / cleaned).resolve()
    try:
        candidate.relative_to(RM_ROOT.resolve())
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    suffix = candidate.suffix.lower()
    kind = STATIC_TYPES.get(suffix, "application/octet-stream")
    return candidate.read_bytes(), kind


def load_runtime():
    spec = importlib.util.spec_from_file_location("waluipedia_chat_first_runtime", AGENT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {AGENT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


runtime = load_runtime()
import sys  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
import desk_api  # noqa: E402  (the Filing Desk at /desk)
JOBS: dict[str, dict[str, Any]] = {}
LOCK = threading.Lock()


def json_response(handler: BaseHTTPRequestHandler, value: Any, status: int = 200) -> None:
    data = json.dumps(value, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    # The static chatroom page (chatroom.html, served by start.py on :8765)
    # calls this server from another origin. Nothing here is authenticated and
    # nothing is written, so the read/roleplay API is open to the local pages.
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)





def read_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    try:
        size = int(handler.headers.get("Content-Length", "0"))
    except ValueError as error:
        raise ValueError("invalid request length") from error
    # A chatroom save is the whole state — far past 2 MB once the browser is full.
    limit = SAVE_MAX_BYTES if handler.path == "/api/chatroom-save" else MAX_BODY
    if size <= 0 or size > limit:
        raise ValueError(f"request body must be between 1 byte and {limit // (1024 * 1024)} MB")
    value = json.loads(handler.rfile.read(size))
    if not isinstance(value, dict):
        raise ValueError("request body must be a JSON object")
    return value


def start_job(payload: dict[str, Any]) -> dict[str, str]:
    text = str(payload.get("text", "")).strip()
    if not text and not payload.get("run"):
        raise ValueError("message text is required")
    if len(text) > 120000:
        raise ValueError("message is too long")
    messages = payload.get("messages", [])
    if not isinstance(messages, list):
        messages = []
    messages = [item for item in messages[-12:] if isinstance(item, dict)]
    job_id = os.urandom(8).hex()
    job: dict[str, Any] = {"id": job_id, "status": "running", "events": [], "started": time.time(), "cancel": False}
    with LOCK:
        JOBS[job_id] = job

    def emit(event: dict[str, Any]) -> None:
        with LOCK:
            job["events"].append(event)
            job["events"] = job["events"][-80:]

    def worker() -> None:
        try:
            result = runtime.run_agent(
                text,
                run_id=str(payload.get("run", "")),
                endpoint=resolve_endpoint(payload.get("endpoint")),
                model=str(payload.get("model", "")),
                allow_writes=False,
                max_steps=8,
                conversation=messages,
                cancel_check=lambda: bool(job.get("cancel")),
                on_event=emit,
            )
            with LOCK:
                job.update(result)
                job["status"] = "cancelled" if job.get("cancel") else str(result.get("status", "done"))
                job["finished"] = time.time()
        except Exception as error:
            with LOCK:
                job.update({"status": "error", "message": str(error), "finished": time.time()})
            emit({"kind": "error", "result": str(error)})

    threading.Thread(target=worker, name=f"chat-first-{job_id}", daemon=True).start()
    return {"job": job_id}


class Handler(BaseHTTPRequestHandler):
    server_version = "WaluipediaChatFirst/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[chat] {format % args}", flush=True)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/":
            data = INDEX.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/roleplay":
            data = ROLEPLAY.read_bytes()
            main_site = os.environ.get("WALUIPEDIA_URL", "http://127.0.0.1:8765/")
            data = data.replace(b"{{MAIN_SITE}}", main_site.encode("utf-8"))
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/api/health":
            json_response(self, {"lm_studio": probe_lm(), "runtime": "chat-first"})
            return
        if parsed.path == "/api/characters":
            json_response(self, archive_cast())
            return
        if parsed.path == "/api/scenes":
            json_response(self, archive_scenes())
            return
        if parsed.path == "/api/wahwire":
            json_response(self, archive_wire())
            return
        if parsed.path == "/api/collections":
            json_response(self, archive_collections())
            return
        if parsed.path == "/api/archive":
            json_response(self, archive_bundle())
            return
        if parsed.path == "/api/chatroom-saves":
            json_response(self, chatroom_saves())
            return
        if parsed.path == "/api/chatroom-save":
            name = (parse_qs(parsed.query).get("name") or ["chatroom"])[0]
            try:
                json_response(self, chatroom_load(name))
            except Exception as error:  # noqa: BLE001
                json_response(self, {"error": str(error)}, status=404)
            return
        if parsed.path.startswith("/rm/"):
            found = serve_static(parsed.path[len("/rm/"):])
            if found:
                data, kind = found
                self.send_response(200)
                self.send_header("Content-Type", kind)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(data)
                return
            self.send_error(404)
            return
        if parsed.path == "/desk":
            data = desk_api.PAGE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if parsed.path == "/api/desk/status":
            json_response(self, desk_api.status(parse_qs(parsed.query).get("job", [""])[0]))
            return
        if parsed.path == "/api/desk/events":
            json_response(self, desk_api.events(parse_qs(parsed.query).get("q", [""])[0]))
            return
        if parsed.path == "/api/desk/images":
            event_id = parse_qs(parsed.query).get("id", [""])[0]
            if not event_id:
                json_response(self, {"error": "an event id is required"}, status=400)
            else:
                try:
                    json_response(self, desk_api.image_options(event_id))
                except Exception as error:  # noqa: BLE001
                    json_response(self, {"error": str(error)}, status=404)
            return
        if parsed.path == "/api/agent/status":
            job_id = parse_qs(parsed.query).get("job", [""])[0]
            with LOCK:
                value = dict(JOBS.get(job_id, {"status": "unknown", "message": "job not found"}))
            json_response(self, value)
            return
        self.send_error(404)

    def do_OPTIONS(self) -> None:  # noqa: N802
        """CORS preflight for the cross-origin static chatroom page."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        try:
            payload = read_body(self)
            if self.path == "/api/chat":
                json_response(self, start_job(payload))
                return
            if self.path == "/api/roleplay":
                json_response(self, roleplay_reply(payload))
                return
            if self.path == "/api/suggest-cast":
                json_response(self, suggest_cast(payload))
                return
            if self.path == "/api/chatroom-save":
                json_response(self, chatroom_save(payload))
                return
            if self.path.startswith("/api/desk/"):
                kind = self.path[len("/api/desk/"):]
                if kind not in ("file", "continue", "edit", "sheet", "render", "image_edit", "image_apply",
                                "commentary", "analysis", "undo"):
                    raise ValueError("unknown desk action")
                json_response(self, desk_api.start(kind, payload, lm_completion, resolve_endpoint))
                return
            if self.path == "/api/agent/cancel":
                job_id = str(payload.get("job", ""))
                with LOCK:
                    if job_id not in JOBS:
                        raise ValueError("job not found")
                    JOBS[job_id]["cancel"] = True
                json_response(self, {"job": job_id, "status": "cancelled"})
                return
            raise ValueError("unknown endpoint")
        except Exception as error:
            json_response(self, {"error": str(error)}, 400)


def main() -> int:
    host = os.environ.get("WORKFLOW_HOST", "0.0.0.0")
    port = int(os.environ.get("WORKFLOW_PORT", "8787"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Waluipedia chat: http://127.0.0.1:{port}/", flush=True)
    print(f"Bound on {host}:{port} for the live preview proxy.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
