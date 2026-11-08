"""The Filing Desk's image step, following docs/IMAGE_GENERATION_GUIDE.md.

1. `plan()` writes the prompt sheet and spends nothing. How many slots follows
   the guide's table (short event 1-2, normal session 2-4, long filing 4-7):
   the lead plus the clearest section beats, never filler — the model picks the
   visually distinct parts and may pick fewer. Each slot gets: source lines,
   must appear, cast (the one portrait passed as reference, or an explicit
   place/object plate), must NOT appear, text, and a prompt built in the guide's
   six-part anatomy. Camera and distance rotate per slot so no two plates could
   swap captions; the setting is carried in words, never a scene reference.
2. The person reviews the sheet (and can edit each prompt or skip a slot).
3. `render()` spends one image-model request per chosen slot (direct OpenAI-compatible API or ComfyUI), compresses to JPEG
   (≤1600 px, ~300 KB), saves to assets/images/events/<slug>/<prefix>-NN-<subject>.jpg
   and wires it: the lead to the record's image/imageCaption/image_alt, each
   section plate as a `![caption](path)` figure under its part heading.
4. Someone still has to look at every image (guide step 4) — the page shows them.
"""
from __future__ import annotations

import base64
import importlib.util
import io
import json
import mimetypes
import os
import random
import re
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable

from desk_store import Store, slug

LAST_COMFY = ""   # set only when this render used ComfyUI
REGISTER = "Moody painterly digital concept art, dark fantasy archive plate, wide cinematic 16:9."
FINISH = "Oil-painting texture, atmospheric depth, high detail."
SCENE_NEGATIVE = "text, letters, watermark, signature, border, frame, extra limbs, blurry"
# Guide "Backgrounds vary across the set": camera and distance differ per slot.
CAMERAS = ("wide establishing shot from a distance", "mid shot at eye level, subject off-centre",
           "close on hands and faces", "over-the-shoulder view", "low angle looking up",
           "high angle looking down across the scene", "tight detail shot of the key object")
IMG_LINE = re.compile(r"(?m)^!\[[^\]]*\]\((assets/images/events/[^)]+)\)\s*\n?")
ARTICLE_IMAGE = re.compile(r"!\[([^\]]*)\]\((assets/images/events/[^)]+)\)")


def slot_budget(parts: int, words: int) -> int:
    """Total images (lead included) from the guide's table."""
    if words < 1500 or parts <= 3:
        return 2            # short event / single scene: 1-2
    if words < 4500 or parts <= 8:
        return 4            # normal session: 2-4
    return 7 if parts >= 12 else 5   # long narrative filing: 4-7


def portrait_for(store: Store, cid: str) -> Path | None:
    folder = store.root / "Reputation-Matrix2" / "portraits"
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        path = folder / f"{cid}{ext}"
        if path.exists():
            return path
    return None


def sheet_path(store: Store, event_id: str) -> Path:
    return store.backup_dir / "prompts" / f"{event_id}-prompts.md"


def story_parts(description: str) -> list[tuple[str, str]]:
    """[(heading, text)] for each ## part; desk image lines are left out of the text."""
    out = []
    for block in re.split(r"(?m)^## ", description or "")[1:]:
        head, _, body = block.partition("\n")
        out.append((head.strip(), IMG_LINE.sub("", body).strip()))
    return out


def _prefix(event_id: str) -> str:
    letters = "".join(w[0] for w in event_id.split("_") if w and w not in ("the", "of", "and", "a"))
    return (letters or event_id)[:4]


def _words(text: str) -> int:
    return len(re.findall(r"\b[\w'’-]+\b", text or ""))


# "none", "colours: none", "named sources: none specified in prose", "n/a" …
JUNK = re.compile(r"^(?:[\w '’-]{0,40}:\s*)?(?:none|n/?a|unspecified|not (?:specified|stated|given))\b.*$", re.I)


def _flat(value: Any) -> str:
    """Models hand back lists/objects where a phrase belongs; never paste a Python repr into a prompt."""
    if isinstance(value, dict):
        value = [v for v in value.values() if v]
    if isinstance(value, list):
        value = ", ".join(_flat(v) for v in value if v)
    text = re.sub(r"\s+", " ", str(value or "")).strip(" .,;")
    text = ", ".join(p.strip() for p in text.split(",") if p.strip() and not JUNK.fullmatch(p.strip()))
    return text


TITLES = {"the", "a", "an", "lord", "lady", "sir", "king", "queen", "mr", "mrs", "miss", "dame", "dr",
          "captain", "master", "old", "young", "big", "little", "toad", "unnamed", "general", "prince", "princess"}


def _names(c: dict[str, Any]) -> list[str]:
    """Full name, id, and the first name when it is a real name (not "The", "Lord", "Toad"…)."""
    name = str(c.get("name") or c.get("id") or "")
    words = name.split()
    first = words[0] if len(words) > 1 and words[0].lower().strip(".") not in TITLES and len(words[0]) > 3 else ""
    return [n for n in {name, first, str(c.get("id") or "").replace("_", " ")} if len(n) > 3]


def _mentions(text: str, c: dict[str, Any]) -> int:
    return sum(len(re.findall(rf"\b{re.escape(n)}\b", text, re.I)) for n in _names(c))


def plan(store: Store, desk: Any, event_id: str, notes: str = "",
         emit: Callable[[str, str], None] = lambda k, t: None) -> dict[str, Any]:
    rec = store.get("events", event_id)
    if not rec:
        raise ValueError(f"no event {event_id!r}")
    parts = story_parts(rec.get("description") or "")
    budget = slot_budget(len(parts), _words(rec.get("description") or ""))
    cast = []
    for p in rec.get("participants") or []:
        # {id, name, role} in new filings; a bare id string in old ones
        p = p if isinstance(p, dict) else {"id": str(p), "name": str(p).replace("_", " ").title()}
        ref = portrait_for(store, str(p.get("id")))
        cast.append({"id": p.get("id"), "name": p.get("name") or p.get("id"),
                     "portrait": ref.relative_to(store.root).as_posix() if ref else None})
    with_art = [c for c in cast if c["portrait"]]
    no_art = [c["name"] for c in cast if not c["portrait"]]

    # 1. which parts deserve a plate (the model may choose fewer than the budget)
    picks: list[int] = []
    if parts and budget > 1:
        emit("step", f"choosing up to {budget - 1} section beats to illustrate ({len(parts)} parts)")
        menu = "\n".join(f"{i}. {h}: {t[:260]}" for i, (h, t) in enumerate(parts, 1))
        got = desk.ask_json(
            f"An archive article has these story parts. Choose at most {budget - 1} parts whose picture would "
            "change how a reader sees the story: a distinct place, object, piece of evidence or a turning point "
            "a character does. Never pick two parts that would look alike, never decorative filler — fewer is "
            'fine. JSON: {"parts": [part numbers in story order], "why": {"<number>": "one line"}}\n\n' + menu,
            900)
        picks = sorted({int(n) for n in got.get("parts") or [] if str(n).isdigit() and 1 <= int(n) <= len(parts)})
        picks = picks[: budget - 1]

    # 2. one sheet block per slot, each from its own text
    slots = [{"slot": "lead", "part": 0, "heading": rec.get("name"),
              "text": f"{rec.get('summary')}\n\n{parts[0][1][:1800] if parts else ''}"}]
    slots += [{"slot": f"§{n}", "part": n, "heading": parts[n - 1][0], "text": parts[n - 1][1][:2600]} for n in picks]
    cast_menu = ", ".join(f"{c['id']} ({c['name']})" for c in with_art) or "none"
    for i, s in enumerate(slots):
        camera = CAMERAS[i % len(CAMERAS)]
        emit("step", f"prompt sheet {i + 1}/{len(slots)} — {s['slot']} {s['heading']}")
        block = desk.ask_json(
            "Write one block of an image prompt sheet for this passage of an archive article. The prose is the "
            "art direction: transcribe, do not invent. JSON keys: \"sourceLines\" (1-3 sentences quoted exactly "
            "from the passage that the picture shows), \"subject\" (what we look at), \"objects\" (the specific "
            "objects with materials, damage, measurements — straight from the prose), \"light\" (named sources "
            "and colours from the prose), \"palette\" (a few colour words), \"mustAppear\" (checklist list), "
            "\"mustNotAppear\" (list; usually the wrong century of technology), \"text\" (\"NONE\" or exact "
            "words that must be legible), \"castId\" (the ONE character in frame whose portrait is passed, from: "
            f"{cast_menu}; or null for a place/object plate), \"caption\" (a filing caption: what is shown and what "
            "it proves or cost, one or two sentences), \"alt\" (a literal description).\n"
            "Characters without a portrait cannot be drawn: " + (", ".join(no_art) or "none") + " — leave them out "
            "of frame. If the passage is about what a person did, put that person in the picture.\n"
            + (f"Filer's notes for the pictures: {notes}\n" if notes else "")
            + f"Camera for this slot: {camera}.\n\nPASSAGE ({s['slot']}, {s['heading']}):\n{s['text']}",
            1300, role="writer")
        subject, objects = _flat(block.get("subject")) or s["heading"], _flat(block.get("objects"))
        light, palette = _flat(block.get("light")), _flat(block.get("palette"))
        must = [_flat(m) for m in (block.get("mustAppear") or []) if _flat(m)] if isinstance(
            block.get("mustAppear"), list) else [m for m in _flat(block.get("mustAppear")).split(", ") if m]
        lines = block.get("sourceLines")
        lines = " ".join(map(str, lines)) if isinstance(lines, list) else str(lines or "")
        # Code, not the model, picks the reference: the portrait-holder the slot is actually about.
        frame = f"{subject} {' '.join(must)} {lines}"
        scored = sorted(((_mentions(frame, c), c) for c in with_art), key=lambda x: -x[0])
        ref = scored[0][1] if scored and scored[0][0] > 0 else None
        if ref is None and block.get("castId"):
            pick = next((c for c in with_art if c["id"] == block.get("castId")), None)
            ref = pick if pick and _mentions(s["text"], pick) else None
        # People with no portrait cannot be drawn (guide: commission the portrait first).
        missing = [c["name"] for c in cast if not c["portrait"] and _mentions(frame, c)]
        # the slot is ABOUT someone who cannot be drawn: never paint them with another's face
        blocked = [c["name"] for c in cast if not c["portrait"] and _mentions(subject, c)]
        if blocked:
            ref = None
        if missing:
            must = [m for m in must if not any(_mentions(m, c) for c in cast if c["name"] in missing)]
        people = "No text." if ref else "No people, no text."
        text_in = _flat(block.get("text")) or "NONE"
        if text_in.upper() != "NONE":
            people = f"The only legible text reads exactly \"{text_in}\"."
        prompt = " ".join(x for x in (
            REGISTER, f"{subject}, {camera}.", f"{objects}." if objects else "", f"{light}." if light else "",
            f"Palette: {palette}." if palette else "", people, FINISH) if x)
        s.update({"camera": camera, "cast": ref, "sourceLines": lines, "mustAppear": must,
                  "mustNotAppear": [_flat(m) for m in (block.get("mustNotAppear") or []) if _flat(m)]
                  if isinstance(block.get("mustNotAppear"), list) else [],
                  "needsPortrait": missing, "textInImage": text_in, "caption": _flat(block.get("caption")),
                  "alt": _flat(block.get("alt")), "prompt": prompt,
                  "blockedBy": blocked, "render": not blocked and not (missing and not ref)})
        s.pop("text", None)

    md = [f"# Prompt sheet — {rec.get('name')}", "",
          f"{len(slots)} slot(s) for {len(parts)} parts / {_words(rec.get('description') or '')} words "
          f"(guide budget {budget}).", ""]
    if no_art:
        md += [f"No portrait on file (cannot be drawn until one is commissioned): {', '.join(no_art)}", ""]
    if rec.get("image"):
        md += [f"Existing lead image: `{rec['image']}` — skip the lead slot to keep it (guide Rule 0).", ""]
    for n, s in enumerate(slots, 1):
        lines = s.get("sourceLines")
        lines = " ".join(lines) if isinstance(lines, list) else (lines or "")
        md += [f"## Slot {n} — {s['slot']} — {s['heading']}", "",
               f"- **Source lines:** {lines}",
               f"- **Must appear:** {', '.join(map(str, s['mustAppear']))}",
               f"- **Cast:** " + (f"{s['cast']['name']} (`{s['cast']['portrait']}`)" if s["cast"]
                                  else "NONE — place/object plate"),
               f"- **Must NOT appear:** {', '.join(map(str, s['mustNotAppear']))}",
               *([f"- **Needs a portrait first:** {', '.join(s['needsPortrait'])} (left out of frame; "
                  "slot unticked when nobody drawable remains)"] if s.get("needsPortrait") else []),
               f"- **Text in image:** {s['textInImage']}",
               f"- **Camera:** {s['camera']}",
               f"- **Caption:** {s['caption']}",
               f"- **Prompt:** {s['prompt']}", ""]
    sheet = {"event": event_id, "budget": budget, "slots": slots, "noPortrait": no_art}
    path = sheet_path(store, event_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(md), encoding="utf-8")
    path.with_suffix(".json").write_text(json.dumps(sheet, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"id": event_id, "sheet": "\n".join(md), "path": str(path), "slots": slots}


# kept for callers of the first version
def prompt_sheet(store: Store, desk: Any, event_id: str, notes: str = "") -> dict[str, Any]:
    return plan(store, desk, event_id, notes)


def _plates_module(store: Store):
    path = store.root / "tools" / "make-token-plates.py"
    spec = importlib.util.spec_from_file_location("make_token_plates", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def comfy_models(store: Store, plates: Any, comfy: Any, emit: Callable[[str, str], None]) -> dict[str, str]:
    """The model files THIS ComfyUI has, picked the way the Token Plate Studio picks them: a file
    pinned in workflow/desk-models.json ("comfy": {"unet", "clip", "vae"}) if the server has it,
    else the graph's default if present, else the first file the loader offers. Without this the
    desk sent the Qwen-Image 2.1 defaults to a server that only has other files and got a 400."""
    pinned: dict[str, str] = {}
    try:
        cfg = json.loads((store.root / "workflow" / "desk-models.json").read_text(encoding="utf-8"))
        pinned = {k: str(v) for k, v in (cfg.get("comfy") or {}).items() if v}
    except (OSError, ValueError, AttributeError):
        pass
    engine = comfy.engine()
    if engine == "qwen21":
        defaults = dict(plates.QWEN21_MODELS)
    elif engine in plates.ENGINES:
        graph = plates.ENGINES[engine][1]
        defaults = {k: graph[n]["inputs"][f] for k, n, f in (("unet", "37", "unet_name"), ("clip", "38", "clip_name"),
                                                               ("vae", "39", "vae_name")) if n in graph}
    else:
        return {}
    loaders = {"unet": ("UNETLoader", "unet_name"), "clip": ("CLIPLoader", "clip_name"), "vae": ("VAELoader", "vae_name")}
    out: dict[str, str] = {}
    for key, (node, field) in loaders.items():
        have = comfy.choices(node, field)
        for want in (pinned.get(key), defaults.get(key)):
            if want and (want in have or not have):
                out[key] = want
                break
        else:
            if have:
                out[key] = have[0]
                emit("step", f"ComfyUI has no {defaults.get(key)} — using {have[0]} "
                             f"(pin another in desk-models.json \"comfy\".{key})")
    return out


MOSS_NEGATIVE = "nsfw, worst quality, bad anatomy, watermark, jpeg artifact"   # MOSS-Image template's recommendation


def moss_files(comfy: Any) -> dict[str, str] | None:
    """MOSS-Image model files on this ComfyUI (text-to-image only, no reference input), or None."""
    if not comfy.has_node("MOSSImageLayoutPrompt"):
        return None
    unets = [u for u in comfy.choices("UNETLoader", "unet_name") if "moss" in u.lower()]
    clips = comfy.choices("CLIPLoader", "clip_name")
    vaes = comfy.choices("VAELoader", "vae_name")
    if not unets or not clips or not vaes:
        return None
    return {"unet": next((u for u in unets if "sft" in u.lower()), unets[0]),
            "clip": next((c for c in clips if "qwen3.5" in c.lower()), clips[0]),
            "vae": next((v for v in vaes if "flux2" in v.lower()), vaes[0])}


def qwen_files_present(plates: Any, comfy: Any) -> bool:
    have = {k: comfy.choices(n, f) for k, n, f in (("unet", "UNETLoader", "unet_name"),
                                                  ("clip", "CLIPLoader", "clip_name"), ("vae", "VAELoader", "vae_name"))}
    return all(plates.QWEN21_MODELS[k] in have[k] for k in have)


def moss_graph(prompt: str, negative: str, seed: int, prefix: str, files: dict[str, str],
               width: int = 1344, height: int = 768, steps: int = 25, cfg: float = 2.5) -> dict[str, Any]:
    """The MOSS-Image text-to-image template (ComfyUI's image_moss_image_t2i) in API form, without
    its optional LLM caption rewrite: the desk's prompts are already captions. 1344x768 is the
    guide's wide 16:9 plate at ~1M pixels in multiples of 16; skip-layer 22 is the official setting."""
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": files["unet"], "weight_dtype": "default"}},
        "15": {"class_type": "SkipLayerGuidanceDiTSimple",
               "inputs": {"model": ["1", 0], "double_layers": "", "single_layers": "22",
                          "start_percent": 0.0, "end_percent": 0.5}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": files["clip"], "type": "moss_image", "device": "default"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": negative}},
        "6": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "7": {"class_type": "KSampler", "inputs": {"model": ["15", 0], "positive": ["4", 0], "negative": ["5", 0],
                                                   "latent_image": ["6", 0], "seed": seed, "steps": steps, "cfg": cfg,
                                                   "sampler_name": "er_sde", "scheduler": "simple", "denoise": 1.0}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": files["vae"]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def character_line(store: Store, plates: Any, cast: dict[str, Any]) -> str:
    """'Donkey Kong, Donkey Kong the 3rd (Kong): <established look>.' from the character record."""
    rec = store.get("characters", str(cast.get("id"))) or {}
    name = rec.get("name") or cast.get("name") or cast.get("id")
    title = str(rec.get("title") or "").strip()
    race = str(rec.get("race") or "").split(";")[0].strip()
    who = name + (f", {title}" if title and title.lower() not in str(name).lower() else "") + (f" ({race})" if race else "")
    look = plates.look_of(rec) if rec else ""
    return f"The figure is {who}" + (f": {look}." if look else ".")


def comfy_ready(store: Store) -> str:
    """Raise unless ComfyUI answers — checked BEFORE the chat model is unloaded."""
    comfy = _plates_module(store).Comfy.discover()
    if not comfy.alive():
        raise ValueError(f"ComfyUI is not answering at {comfy.url} — start it, then render again "
                         "(the chat model was left loaded)")
    return comfy.url


def image_settings(store: Store) -> dict[str, Any]:
    """Resolve the image backend from workflow/desk-models.json and environment overrides.

    The direct backend speaks the OpenAI Images API: generations for place/object plates,
    edits with a portrait multipart reference for character plates. ComfyUI remains the
    backwards-compatible backend unless explicitly configured otherwise.
    """
    try:
        cfg = json.loads((store.root / "workflow" / "desk-models.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cfg = {}
    raw = cfg.get("image") if isinstance(cfg.get("image"), dict) else {}
    base_url = str(os.environ.get("DESK_IMAGE_BASE_URL") or raw.get("baseUrl") or "").rstrip("/")
    backend = os.environ.get("DESK_IMAGE_BACKEND") or raw.get("backend") or ("direct" if base_url else "comfy")
    return {
        "backend": str(backend).strip().lower(),
        "baseUrl": base_url,
        "model": str(os.environ.get("DESK_IMAGE_MODEL") or raw.get("model") or ""),
        "apiKey": os.environ.get(str(raw.get("apiKeyEnv") or "DESK_IMAGE_API_KEY"), ""),
        "apiKeyEnv": str(raw.get("apiKeyEnv") or "DESK_IMAGE_API_KEY"),
        "size": str(raw.get("size") or "1344x768"),
        "timeout": max(1, int(raw.get("timeout") or 600)),
        "generationPath": str(raw.get("generationPath") or "/images/generations"),
        "editPath": str(raw.get("editPath") or "/images/edits"),
        "imageField": str(raw.get("imageField") or "image[]"),
        "releaseLMStudio": bool(raw.get("releaseLMStudio", True)),
    }


def render_preflight(store: Store, event_id: str, chosen: list[int] | None = None) -> dict[str, Any]:
    """Validate the chosen slots/backend before the API unloads any chat models."""
    prompt_file = sheet_path(store, event_id).with_suffix(".json")
    if not prompt_file.exists():
        raise ValueError("plan the images first — the prompt sheet comes before any generation")
    sheet = json.loads(prompt_file.read_text(encoding="utf-8"))
    slots = sheet.get("slots") or []
    todo = [n for n in (chosen if chosen is not None else
                        [i for i, slot in enumerate(slots, 1) if slot.get("render", True)])
            if isinstance(n, int) and 1 <= n <= len(slots)]
    if not todo:
        raise ValueError("no slots chosen")
    settings = image_settings(store)
    if settings["backend"] in ("openai", "openai-compatible", "direct"):
        settings["backend"] = "direct"
        if not settings["baseUrl"] or not settings["model"]:
            raise ValueError("direct image backend needs image.baseUrl and image.model in workflow/desk-models.json "
                             "(or DESK_IMAGE_BASE_URL and DESK_IMAGE_MODEL)")
        for n in todo:
            cast = slots[n - 1].get("cast")
            if cast:
                portrait = store.root / str(cast.get("portrait") or "")
                if not cast.get("portrait") or not portrait.is_file():
                    raise ValueError(f"slot {n} needs the portrait reference for {cast.get('name') or cast.get('id')}; "
                                     "restore it before rendering")
        return settings
    if settings["backend"] != "comfy":
        raise ValueError(f"unknown image backend {settings['backend']!r}; use 'direct' or 'comfy'")

    url = comfy_ready(store)
    # Fail before unloading the chat model instead of silently returning an empty render
    # when a text-only MOSS graph is configured to skip every portrait-dependent slot.
    plates = _plates_module(store)
    comfy = plates.Comfy.discover()
    try:
        cfg = json.loads((store.root / "workflow" / "desk-models.json").read_text(encoding="utf-8"))
        ccfg = cfg.get("comfy") or {}
    except (OSError, ValueError, AttributeError):
        ccfg = {}
    if bool(ccfg.get("portraitRule")) and moss_files(comfy):
        selected_cast = [n for n in todo if slots[n - 1].get("cast")]
        if selected_cast:
            raise ValueError("ComfyUI's selected MOSS-Image model is text-to-image and cannot use character portraits; "
                             "these slots would all be skipped by portraitRule. Configure the direct image backend "
                             "with an image-edit-capable model, or use the reference-capable Qwen graph.")
    settings["comfyUrl"] = url
    return settings


def _image_ext(data: bytes, mime: str = "") -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return mimetypes.guess_extension(mime.split(";", 1)[0]) or ".png"


def direct_image(settings: dict[str, Any], prompt: str, reference: Path | None = None) -> tuple[bytes, str]:
    """Call an OpenAI-compatible image endpoint; use /images/edits when a portrait is supplied."""
    edit = reference is not None
    endpoint = settings["baseUrl"] + settings["editPath" if edit else "generationPath"]
    token = settings.get("apiKey") or ""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    fields = {"model": settings["model"], "prompt": prompt, "size": settings["size"], "n": "1"}
    if reference:
        boundary = "----FilingDesk" + uuid.uuid4().hex
        chunks: list[bytes] = []
        for key, value in fields.items():
            chunks.extend((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode(),))
        mime = mimetypes.guess_type(reference.name)[0] or "application/octet-stream"
        chunks.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{settings['imageField']}\"; "
                       f"filename=\"{reference.name}\"\r\nContent-Type: {mime}\r\n\r\n").encode())
        chunks.extend((reference.read_bytes(), b"\r\n", f"--{boundary}--\r\n".encode()))
        body = b"".join(chunks)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    else:
        body = json.dumps(fields).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=settings["timeout"]) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read()[:600].decode("utf-8", "replace")
        raise ValueError(f"image model answered {error.code}: {detail}") from error
    except Exception as error:  # noqa: BLE001
        raise ValueError(f"could not reach direct image model at {endpoint}: {error}") from error
    rows = payload.get("data") or []
    if not rows:
        raise ValueError("direct image model returned no images (expected OpenAI Images API data[0])")
    image = rows[0]
    if image.get("b64_json"):
        data = base64.b64decode(image["b64_json"], validate=True)
        return data, _image_ext(data, image.get("mime_type", "image/png"))
    if image.get("url"):
        try:
            with urllib.request.urlopen(image["url"], timeout=settings["timeout"]) as response:
                data = response.read()
                mime = response.headers.get("Content-Type", "")
        except Exception as error:  # noqa: BLE001
            raise ValueError(f"could not download the generated image: {error}") from error
        return data, _image_ext(data, mime)
    raise ValueError("direct image model response has neither data[0].b64_json nor data[0].url")


def _normal_image_ref(value: Any) -> str:
    ref = str(value or "").strip().replace("\\", "/").lstrip("/")
    if ref.startswith("rm/"):
        ref = ref[3:]
    if ref.startswith("Reputation-Matrix2/"):
        ref = ref[len("Reputation-Matrix2/"):]
    return ref


def _event_image_file(store: Store, reference: str) -> Path:
    """Resolve a record image only within the site's event-art tree."""
    relative = _normal_image_ref(reference)
    if not relative.startswith("assets/images/events/"):
        raise ValueError("only images stored in assets/images/events can be edited")
    root = (store.root / "Reputation-Matrix2" / "assets" / "images" / "events").resolve()
    path = (store.root / "Reputation-Matrix2" / relative).resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise ValueError("image path is outside the event-art directory") from error
    if not path.is_file():
        raise ValueError(f"image file is missing: {relative}")
    return path


def event_images(store: Store, event_id: str) -> dict[str, Any]:
    """List the event's lead, gallery, and inline section images for the Desk editor."""
    rec = store.get("events", event_id)
    if not rec:
        raise ValueError(f"no event {event_id!r}")
    found: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(value: Any, caption: str, kind: str) -> None:
        ref = _normal_image_ref(value)
        if not ref or ref in seen:
            return
        try:
            _event_image_file(store, ref)
        except ValueError:
            return
        seen.add(ref)
        found.append({"image": ref, "caption": str(caption or "").strip(), "kind": kind})

    add(rec.get("image"), rec.get("imageCaption") or rec.get("name") or "Lead image", "lead")
    for item in rec.get("gallery") or []:
        if isinstance(item, dict):
            add(item.get("image"), item.get("caption") or item.get("alt") or "Gallery image", "gallery")
        elif isinstance(item, str):
            add(item, "Gallery image", "gallery")
    for caption, ref in ARTICLE_IMAGE.findall(rec.get("description") or ""):
        add(ref, caption or "Section image", "section")
    return {"id": event_id, "images": found}


def image_edit_preflight(store: Store, event_id: str, source: str) -> tuple[dict[str, Any], Path]:
    """Check that an image belongs to this event and an image-edit capable API is configured."""
    available = event_images(store, event_id)["images"]
    canonical = _normal_image_ref(source)
    if canonical not in {row["image"] for row in available}:
        raise ValueError("choose an image currently attached to this event")
    settings = image_settings(store)
    if settings["backend"] not in ("direct", "openai", "openai-compatible"):
        raise ValueError("editing an article image requires the direct image API; ComfyUI/MOSS text-to-image "
                         "cannot edit the selected image")
    settings["backend"] = "direct"
    if not settings["baseUrl"] or not settings["model"]:
        raise ValueError("direct image backend needs image.baseUrl and image.model in workflow/desk-models.json "
                         "(or DESK_IMAGE_BASE_URL and DESK_IMAGE_MODEL)")
    return settings, _event_image_file(store, canonical)


def edit_image(store: Store, event_id: str, source: str, instruction: str,
               emit: Callable[[str, str], None] = lambda k, t: None,
               settings: dict[str, Any] | None = None) -> dict[str, Any]:
    """Generate a new image from an attached article image plus an edit instruction.

    The source file and record stay untouched; the caller can show the preview and then
    explicitly apply it to the article (which is separately undoable).
    """
    if not instruction.strip():
        raise ValueError("describe the image change")
    settings, source_file = image_edit_preflight(store, event_id, source) if settings is None else (
        settings, _event_image_file(store, source))
    rec = store.get("events", event_id)
    if rec is None:
        raise ValueError(f"no event {event_id!r}")
    emit("step", f"editing {Path(source).name} with {settings['model']}")
    payload, ext = direct_image(settings, instruction.strip(), source_file)
    rel_dir = f"assets/images/events/{event_id.replace('_', '-')}"
    folder = store.root / "Reputation-Matrix2" / rel_dir
    folder.mkdir(parents=True, exist_ok=True)
    raw_dir = store.backup_dir / "renders" / event_id
    raw_dir.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex[:10]
    raw = raw_dir / f"edit-{token}{ext}"
    raw.write_bytes(payload)
    target = folder / f"edit-{Path(source_file).stem}-{token}.jpg"
    size = _compress(raw, target)
    if not target.exists():
        target = target.with_suffix(raw.suffix or ".png")
    edited_ref = f"{rel_dir}/{target.name}"
    emit("step", f"image edit ready — {target.name} ({size}); preview it before applying")
    return {"id": event_id, "source": _normal_image_ref(source), "image": edited_ref,
            "prompt": instruction.strip(), "size": size, "preview": True}


def apply_image_edit(store: Store, event_id: str, source: str, replacement: str) -> dict[str, Any]:
    """Replace the exact source reference in the event lead/gallery/markdown with a generated edit."""
    rec = store.get("events", event_id)
    if rec is None:
        raise ValueError(f"no event {event_id!r}")
    images = event_images(store, event_id)["images"]
    old = _normal_image_ref(source)
    if old not in {row["image"] for row in images}:
        raise ValueError("the source image is no longer attached to this event")
    new = _normal_image_ref(replacement)
    new_file = _event_image_file(store, new)
    event_folder = (store.root / "Reputation-Matrix2" / "assets" / "images" /
                    "events" / event_id.replace("_", "-")).resolve()
    try:
        new_file.relative_to(event_folder)
    except ValueError as error:
        raise ValueError("the edited image must be in this event's image folder") from error
    changed = False
    if _normal_image_ref(rec.get("image")) == old:
        rec["image"] = new
        changed = True
    gallery = rec.get("gallery") or []
    for index, item in enumerate(gallery):
        if isinstance(item, dict) and _normal_image_ref(item.get("image")) == old:
            item["image"] = new
            changed = True
        elif isinstance(item, str) and _normal_image_ref(item) == old:
            gallery[index] = new
            changed = True
    desc = rec.get("description") or ""
    pattern = re.compile(r"(!\[[^\]]*\]\()" + re.escape(old) + r"(\))")
    desc, count = pattern.subn(lambda match: match.group(1) + new + match.group(2), desc)
    if count:
        rec["description"] = desc
        changed = True
    if not changed:
        raise ValueError("could not find the source image reference in the event record")
    store.upsert("events", rec)
    return {"id": event_id, "source": old, "image": new, "applied": True}


def _compress(src: Path, dst: Path) -> str:
    """Guide: JPEG, ≤1600 px, quality 82, under ~300 KB. Without Pillow keep the source image."""
    try:
        from PIL import Image
    except ImportError:
        dst = dst.with_suffix(src.suffix or ".png")
        dst.write_bytes(src.read_bytes())
        return f"Pillow missing — kept {dst.suffix[1:].upper()} ({dst.stat().st_size // 1024} KB), compress by hand"
    img = Image.open(src).convert("RGB")
    img.thumbnail((1600, 1600))
    for q in (82, 74, 66, 58):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() <= 300_000 or q == 58:
            dst.write_bytes(buf.getvalue())
            return f"{buf.tell() // 1024} KB at q{q}"
    return ""


def render(store: Store, event_id: str, chosen: list[int] | None = None,
           prompts: dict[str, str] | None = None,
           emit: Callable[[str, str], None] = lambda k, t: None,
           settings: dict[str, Any] | None = None) -> dict[str, Any]:
    """Render chosen slots (1-based; default: every slot marked render) and wire them."""
    sheet_file = sheet_path(store, event_id).with_suffix(".json")
    if not sheet_file.exists():
        raise ValueError("plan the images first — the prompt sheet comes before any generation")
    sheet = json.loads(sheet_file.read_text(encoding="utf-8"))
    slots = sheet["slots"]
    todo = [n for n in (chosen if chosen is not None else
                        [i for i, s in enumerate(slots, 1) if s.get("render", True)])
            if isinstance(n, int) and 1 <= n <= len(slots)]
    if not todo:
        raise ValueError("no slots chosen")
    settings = settings or render_preflight(store, event_id, todo)
    backend = settings.get("backend", "comfy")
    plates = comfy = renderer = None
    global LAST_COMFY
    LAST_COMFY = ""
    if backend == "comfy":
        plates = _plates_module(store)
        comfy = plates.Comfy.discover()
        LAST_COMFY = comfy.url
        if not comfy.alive():
            raise ValueError(f"ComfyUI is not answering at {comfy.url} — start it, then render again")
    # Which Comfy graph: reference-capable Qwen when its files are present, else MOSS text-only.
    moss = moss_files(comfy) if comfy else None
    try:
        comfy_cfg = json.loads((store.root / "workflow" / "desk-models.json").read_text(encoding="utf-8")).get("comfy") or {}
    except (OSError, ValueError, AttributeError):
        comfy_cfg = {}
    pin = comfy_cfg.get("engine", "")
    # The user's choice (2026-11-08): with a text-only model, draw characters from their archive
    # record rather than skip them. "portraitRule": true restores the skip.
    portrait_rule = bool(comfy_cfg.get("portraitRule", False))
    use_moss = backend == "comfy" and bool(moss) and (pin == "moss" or (pin != "qwen" and not qwen_files_present(plates, comfy)))
    if backend == "comfy" and use_moss:
        emit("step", f"ComfyUI has MOSS-Image ({moss['unet']}), not the Qwen-Image files — rendering text-to-image; "
                     + ("slots with a character in frame are skipped (portraitRule is on)" if portrait_rule else
                        "characters are drawn from their archive description, not their portrait"))
    elif backend == "comfy":
        renderer = plates.Renderer(comfy, models=comfy_models(store, plates, comfy, emit))
    else:
        emit("step", f"direct image model · {settings['model']} at {settings['baseUrl']}")
    rel_dir = f"assets/images/events/{event_id.replace('_', '-')}"
    folder = store.root / "Reputation-Matrix2" / rel_dir
    raw_dir = store.backup_dir / "renders" / event_id
    folder.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)
    made, skipped, from_text = [], [], []
    for n in todo:
        s = slots[n - 1]
        prompt = (prompts or {}).get(str(n)) or s["prompt"]
        avoid = ", ".join(map(str, s.get("mustNotAppear") or []))
        negative = SCENE_NEGATIVE + (", " + avoid if avoid else "")
        seed = random.randint(1, 2**31 - 1)
        if use_moss and s.get("cast") and portrait_rule:
            skipped.append(f"slot {n} ({s['cast']['name']})")
            emit("step", f"slot {n} skipped — {s['cast']['name']} must come from their portrait (portraitRule)")
            continue
        if use_moss and s.get("cast"):
            # Backwards-compatible text-only MOSS path. A direct image edit receives the portrait itself.
            who = character_line(store, plates, s["cast"])
            prompt = prompt.replace(REGISTER, REGISTER + " " + who, 1) if REGISTER in prompt else who + " " + prompt
            from_text.append(f"slot {n} ({s['cast']['name']})")
        emit("step", f"rendering slot {n}/{len(slots)} — {s['slot']} {s['heading']}")
        if backend == "direct":
            reference = store.root / s["cast"]["portrait"] if s.get("cast") else None
            data, ext = direct_image(settings, prompt, reference)
            raw = raw_dir / f"{n:02d}{ext}"
            raw.write_bytes(data)
        elif use_moss:
            wf = moss_graph(prompt, MOSS_NEGATIVE + (", " + avoid if avoid else ""), seed,
                            f"desk/{event_id}-{n:02d}", moss)
        elif s.get("cast"):
            ref = store.root / s["cast"]["portrait"]
            name = comfy.upload(str(ref), f"desk_{s['cast']['id']}{ref.suffix}")
            wf = plates.workflow_fill(renderer.wf, prompt, name, f"desk/{event_id}-{n:02d}", seed, negative=negative)
        elif renderer.can_text_only():
            wf = plates.workflow_fill(renderer.text_only_workflow(), prompt, "", f"desk/{event_id}-{n:02d}",
                                      seed, negative=negative)
        else:
            emit("step", f"slot {n}: this ComfyUI graph needs a reference portrait — skipped")
            continue
        if backend == "comfy":
            raw = raw_dir / f"{n:02d}.png"
            comfy.run(wf, str(raw))
        subject = slug(s["heading"] if s["slot"] != "lead" else "lead", 28).replace("_", "-")
        dst = folder / f"{_prefix(event_id)}-{n:02d}-{subject}.jpg"
        size = _compress(raw, dst)
        if not dst.exists():
            dst = dst.with_suffix(raw.suffix or ".png")
        made.append({"slot": n, "part": s["part"], "image": f"{rel_dir}/{dst.name}", "caption": s["caption"],
                     "alt": s["alt"], "seed": seed, "size": size})
        emit("step", f"slot {n} saved — {dst.name} ({size})")
    _wire(store, event_id, made)
    note = ("Look at every image before keeping it (guide step 4). Undo restores the record; "
            "the image files stay on disk for you to delete or keep.")
    if from_text:
        note += (" Drawn from the archive description, not the portrait (MOSS-Image takes no reference): "
                 + ", ".join(from_text) + " — check each face against portraits/ before keeping it.")
    if skipped:
        note += (" Skipped (portraitRule): " + ", ".join(skipped) + ".")
    return {"id": event_id, "images": made, "skipped": skipped, "fromText": from_text,
            "engine": "direct" if backend == "direct" else ("moss" if use_moss else "qwen"), "note": note}


def _wire(store: Store, event_id: str, made: list[dict[str, Any]]) -> None:
    rec = store.get("events", event_id)
    if rec is None or not made:
        return
    desc = rec.get("description") or ""
    for m in made:
        if m["part"] == 0:
            rec["image"], rec["imageCaption"] = m["image"], m["caption"] or rec.get("imageCaption", "")
            rec["image_alt"] = m["alt"] or rec.get("image_alt", "")
            continue
        heads = [x for x in re.finditer(r"(?m)^## .*$", desc)]
        if m["part"] > len(heads):
            continue
        # drop an earlier plate for this part, then place the new one after the part's first paragraph
        start = heads[m["part"] - 1].end()
        end = heads[m["part"]].start() if m["part"] < len(heads) else len(desc)
        body = IMG_LINE.sub("", desc[start:end])
        first = re.search(r"\n\n(?=\S)", body.lstrip("\n"))
        stripped = body.lstrip("\n")
        cap = (m["caption"] or m["alt"] or "").replace("]", ")").replace("\n", " ")
        line = f"![{cap}]({m['image']})\n\n"
        if first:
            cut = first.end()
            stripped = stripped[:cut] + line + stripped[cut:]
        else:
            stripped = stripped.rstrip() + "\n\n" + line
        desc = desc[:start] + "\n\n" + stripped + desc[end:]
    rec["description"] = desc
    store.upsert("events", rec)
