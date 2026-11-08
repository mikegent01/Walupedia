"""One GPU, two model servers: hand VRAM from LM Studio to ComfyUI and back.

Before a render the LM Studio models are unloaded (REST API v1); after it
ComfyUI is asked to drop its models (/free) and the chat model is loaded again.
Every call is best-effort: a failure here is reported, never fatal to the render.
"""
from __future__ import annotations

import json
import urllib.request
from typing import Any

TIMEOUT = 180


def _call(url: str, body: dict[str, Any] | None = None, timeout: float = TIMEOUT) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw) if raw.strip() else {}


def lm_base(endpoint: str) -> str:
    value = str(endpoint or "http://127.0.0.1:1234").rstrip("/")
    for suffix in ("/chat/completions", "/v1"):
        if value.endswith(suffix):
            value = value[: -len(suffix)]
    return value.rstrip("/")


def loaded_llms(base: str) -> list[dict[str, str]]:
    out = []
    for model in _call(f"{base}/api/v1/models", timeout=10).get("models", []):
        if model.get("type") != "llm":
            continue
        for inst in model.get("loaded_instances") or []:
            ctx = (inst.get("config") or {}).get("context_length")
            out.append({"model": model.get("key"), "instance": inst.get("id") or model.get("key"), "context": ctx})
    return out


def free_lm(base: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Unload every loaded LLM. Returns (the rows that were loaded, notes)."""
    notes, keys = [], []
    try:
        for row in loaded_llms(base):
            _call(f"{base}/api/v1/models/unload", {"instance_id": row["instance"]})
            keys.append(row)
            notes.append(f"unloaded {row['model']} from LM Studio")
    except Exception as error:  # noqa: BLE001
        notes.append(f"could not unload LM Studio models: {error}")
    return keys, notes


def restore_lm(base: str, rows: list[dict[str, Any]]) -> list[str]:
    """Load the models again with the context length they had."""
    notes, seen = [], set()
    for row in rows:
        if row["model"] in seen:
            continue
        seen.add(row["model"])
        body: dict[str, Any] = {"model": row["model"]}
        if row.get("context"):
            body["context_length"] = row["context"]
        try:
            _call(f"{base}/api/v1/models/load", body)
            notes.append(f"reloaded {row['model']} in LM Studio")
        except Exception as error:  # noqa: BLE001
            notes.append(f"could not reload {row['model']}: {error}")
    return notes


def context_length(base: str, model: str = "") -> int:
    """The loaded model's context window (what the desk sizes its prompts to)."""
    try:
        rows = loaded_llms(base)
    except Exception:  # noqa: BLE001
        return 8192
    for row in rows:
        if not model or row["model"] == model:
            return int(row.get("context") or 8192)
    return 8192


def ensure(base: str, model: str, context: int | None = None) -> list[str]:
    """Make `model` the one loaded LLM (one GPU: unload the others first). No-op when it
    is already loaded. Returns notes for the progress log."""
    try:
        rows = loaded_llms(base)
    except Exception as error:  # noqa: BLE001
        return [f"could not read LM Studio's loaded models: {error}"]
    if any(r["model"] == model for r in rows) and len(rows) == 1:
        return []
    notes = []
    for row in rows:
        if row["model"] != model:
            try:
                _call(f"{base}/api/v1/models/unload", {"instance_id": row["instance"]})
                notes.append(f"unloaded {row['model']}")
            except Exception as error:  # noqa: BLE001
                notes.append(f"could not unload {row['model']}: {error}")
    if not any(r["model"] == model for r in rows):
        body: dict[str, Any] = {"model": model}
        if context:
            body["context_length"] = int(context)
        try:
            _call(f"{base}/api/v1/models/load", body, timeout=600)
            notes.append(f"loaded {model}" + (f" ({context} ctx)" if context else ""))
        except Exception as error:  # noqa: BLE001
            notes.append(f"could not load {model}: {error} — LM Studio may load it on demand")
    return notes


def free_comfy(comfy_url: str) -> list[str]:
    try:
        _call(f"{comfy_url.rstrip('/')}/free", {"unload_models": True, "free_memory": True}, timeout=30)
        return ["ComfyUI released its models"]
    except Exception as error:  # noqa: BLE001
        return [f"could not ask ComfyUI to free memory: {error}"]
