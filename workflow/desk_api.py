"""HTTP glue for the Filing Desk (/desk). The pipeline lives in
Reputation-Matrix2/tools/local-agent/filing_desk.py; this file runs it as
background jobs, one writer at a time, with undo per job."""
from __future__ import annotations

import os
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "Reputation-Matrix2" / "tools" / "local-agent"))

import json  # noqa: E402
import re  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402

import desk_image  # noqa: E402
import desk_vram  # noqa: E402
from desk_store import Store, norm  # noqa: E402
from filing_desk import FilingDesk  # noqa: E402

PAGE = Path(__file__).resolve().parent / "desk.html"
JOBS: dict[str, dict[str, Any]] = {}
LOCK = threading.Lock()
WRITER = threading.Lock()   # two filings must never interleave shard writes
DESK_TEMPERATURE = float(os.environ.get("DESK_TEMPERATURE", "0.4"))
# The model the desk asks for. LM Studio loads it on demand if it is not loaded.
DESK_MODEL = os.environ.get("DESK_MODEL", "google/gemma-4-12b-qat")
DESK_TIMEOUT = float(os.environ.get("DESK_TIMEOUT_SECONDS", "420"))


ROLES = ("reader", "writer", "json")
MODELS_FILE = Path(__file__).resolve().parent / "desk-models.json"


def models_config() -> dict[str, Any]:
    """workflow/desk-models.json, read per job so edits apply without a restart."""
    try:
        cfg = json.loads(MODELS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cfg = {}
    out: dict[str, Any] = {"swap": bool(cfg.get("swap", True))}
    for role in ROLES:
        spec = cfg.get(role) if isinstance(cfg.get(role), dict) else {}
        out[role] = {"model": str(spec.get("model") or DESK_MODEL), "context": spec.get("context")}
    return out


def desk_completion(url: str, system: str, prompt: str, max_tokens: int, model: str = "") -> str:
    """One completion with thinking off; retried once. Errors carry LM Studio's own words."""
    body = json.dumps({
        "model": model or DESK_MODEL,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        "temperature": DESK_TEMPERATURE, "max_tokens": max_tokens, "stream": False,
        "reasoning_effort": "none", "chat_template_kwargs": {"enable_thinking": False},
    }).encode("utf-8")
    last = "the model did not answer"
    for attempt in (1, 2):
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=DESK_TIMEOUT * attempt) as resp:
                value = json.loads(resp.read())
            text = ((value.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            text = re.sub(r"<think>[\s\S]*?</think>", " ", text, flags=re.I).strip()
            if text:
                return text
            last = "the model returned an empty reply (context full? raise the context length in LM Studio)"
        except urllib.error.HTTPError as error:
            last = f"LM Studio answered {error.code}: {error.read()[:300].decode('utf-8', 'replace')}"
        except Exception as error:  # noqa: BLE001
            last = f"could not reach the model: {error}"
    raise ValueError(last)


def _job(kind: str) -> dict[str, Any]:
    job = {"id": os.urandom(8).hex(), "kind": kind, "status": "running", "events": [],
           "started": time.time()}
    with LOCK:
        JOBS[job["id"]] = job
    return job


def _emit(job: dict[str, Any]) -> Callable[[str, str], None]:
    def emit(kind: str, text: str) -> None:
        with LOCK:
            job["events"].append({"kind": kind, "text": text, "at": time.time()})
            job["events"] = job["events"][-120:]
    return emit


def start(kind: str, payload: dict[str, Any], lm_completion: Callable[..., str],
          resolve_endpoint: Callable[[Any], str]) -> dict[str, str]:
    """kind: file | edit | sheet | render | undo"""
    if kind == "file" and len(str(payload.get("text", "")).strip()) < 200:
        raise ValueError("paste the session transcript or account (at least a few paragraphs)")
    if kind in ("edit", "sheet", "render") and not str(payload.get("id", "")).strip():
        raise ValueError("an event id is required")
    if kind == "edit" and not str(payload.get("instruction", "")).strip():
        raise ValueError("say what to change")
    job = _job(kind)
    emit = _emit(job)
    endpoint = payload.get("endpoint")

    roles = models_config()
    if payload.get("model"):   # a one-off override from the page runs every role on that model
        roles = {**roles, **{r: {"model": str(payload["model"]), "context": None} for r in ROLES}}
    url = resolve_endpoint(endpoint)
    base = desk_vram.lm_base(url)
    state = {"current": ""}

    def llm(system: str, prompt: str, max_tokens: int, role: str = "json") -> str:
        spec = roles.get(role) or roles["json"]
        if roles.get("swap", True) and spec["model"] != state["current"]:
            for note in desk_vram.ensure(base, spec["model"], spec.get("context")):
                emit("step", f"[{role}] {note}")
            state["current"] = spec["model"]
        return desk_completion(url, system, prompt, max_tokens, spec["model"])

    def worker() -> None:
        store = Store()
        result: dict[str, Any] = {}
        try:
            if not WRITER.acquire(timeout=1):
                emit("step", "waiting for the filing already running to finish")
                WRITER.acquire()
            try:
                ctx = min(int(roles[r].get("context") or desk_vram.context_length(base, roles[r]["model"]))
                          for r in ("reader", "writer"))
                # ~3.6 chars per token; keep room for the instructions and the longest reply.
                desk = FilingDesk(store, llm, emit, digest_chars=int(max(ctx - 4200, 2500) * 3.6))
                if kind in ("file", "edit", "sheet"):
                    emit("step", "models · " + " · ".join(f"{r}: {roles[r]['model']}" for r in ROLES)
                         + f" · prompts sized for {ctx} ctx")
                if kind == "file":
                    result = desk.file_session(str(payload["text"]), str(payload.get("hints", "")))
                elif kind == "edit":
                    result = desk.edit_event(str(payload["id"]).strip(), str(payload["instruction"]))
                elif kind == "sheet":
                    result = desk_image.plan(store, desk, str(payload["id"]).strip(),
                                             str(payload.get("notes", "")), emit)
                elif kind == "render":
                    chosen = [int(n) for n in payload.get("slots") or [] if str(n).isdigit()]
                    prompts = {str(k): str(v) for k, v in (payload.get("prompts") or {}).items() if str(v).strip()}
                    emit("step", f"ComfyUI answering at {desk_image.comfy_ready(store)}")
                    # one GPU: the chat model leaves VRAM for the whole render, and comes back after
                    rows, notes = desk_vram.free_lm(base)
                    for n in notes:
                        emit("step", n)
                    try:
                        emit("step", "rendering in ComfyUI (one generation per slot; minutes each)")
                        result = desk_image.render(store, str(payload["id"]).strip(), chosen or None, prompts, emit)
                    finally:
                        comfy_url = os.environ.get("COMFY_URL", "") or desk_image.LAST_COMFY
                        if comfy_url:
                            for n in desk_vram.free_comfy(comfy_url):
                                emit("step", n)
                        for n in desk_vram.restore_lm(base, rows):
                            emit("step", n)
                    if os.environ.get("DESK_SKIP_CHECKS") != "1":
                        result["checks"] = [{"check": a, "ok": ok, "tail": t}
                                            for a, ok, t in store.build_and_check(checks=("check-references.py",))]
                elif kind == "undo":
                    result = {"restored": Store().undo(str(payload.get("job", "")))}
                    for line in result["restored"]:
                        emit("step", line)
                    store_rebuilt = Store().build_and_check(checks=())
                    result["checks"] = [{"check": a, "ok": ok, "tail": t} for a, ok, t in store_rebuilt]
            finally:
                WRITER.release()
            status = "done"
        except Exception as error:  # noqa: BLE001 - surfaced to the page
            status = "error"
            result = {"error": str(error), "trace": traceback.format_exc()[-1500:]}
            emit("error", str(error))
        finally:
            if store.touched:
                store.save_backup(job["id"])
                result["undo"] = job["id"]
                result["touched"] = sorted(store.touched)
        with LOCK:
            job.update({"status": status, "result": result, "finished": time.time()})

    threading.Thread(target=worker, name=f"desk-{kind}-{job['id']}", daemon=True).start()
    return {"job": job["id"]}


def status(job_id: str) -> dict[str, Any]:
    with LOCK:
        return dict(JOBS.get(job_id) or {"status": "unknown", "events": []})


def events(query: str = "", limit: int = 40) -> dict[str, Any]:
    """Event picker for edits: newest first, filtered by id/name/title."""
    rows = Store().bundle("events")
    q = norm(query)
    out = []
    for rec in reversed(rows):
        hay = norm(" ".join(str(rec.get(k) or "") for k in ("id", "name", "title")))
        if not q or q in hay:
            out.append({"id": rec.get("id"), "name": rec.get("name"), "date": rec.get("date"),
                        "image": rec.get("image") or ""})
        if len(out) >= limit:
            break
    return {"events": out}
