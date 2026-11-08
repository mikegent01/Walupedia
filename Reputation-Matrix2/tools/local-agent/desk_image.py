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
3. `render()` spends one ComfyUI generation per chosen slot, compresses to JPEG
   (≤1600 px, ~300 KB), saves to assets/images/events/<slug>/<prefix>-NN-<subject>.jpg
   and wires it: the lead to the record's image/imageCaption/image_alt, each
   section plate as a `![caption](path)` figure under its part heading.
4. Someone still has to look at every image (guide step 4) — the page shows them.
"""
from __future__ import annotations

import importlib.util
import io
import json
import random
import re
from pathlib import Path
from typing import Any, Callable

from desk_store import Store, slug

LAST_COMFY = ""   # the ComfyUI the last render used (the desk frees it afterwards)
REGISTER = "Moody painterly digital concept art, dark fantasy archive plate, wide cinematic 16:9."
FINISH = "Oil-painting texture, atmospheric depth, high detail."
SCENE_NEGATIVE = "text, letters, watermark, signature, border, frame, extra limbs, blurry"
# Guide "Backgrounds vary across the set": camera and distance differ per slot.
CAMERAS = ("wide establishing shot from a distance", "mid shot at eye level, subject off-centre",
           "close on hands and faces", "over-the-shoulder view", "low angle looking up",
           "high angle looking down across the scene", "tight detail shot of the key object")
IMG_LINE = re.compile(r"(?m)^!\[[^\]]*\]\((assets/images/events/[^)]+)\)\s*\n?")


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


def comfy_ready(store: Store) -> str:
    """Raise unless ComfyUI answers — checked BEFORE the chat model is unloaded."""
    comfy = _plates_module(store).Comfy.discover()
    if not comfy.alive():
        raise ValueError(f"ComfyUI is not answering at {comfy.url} — start it, then render again "
                         "(the chat model was left loaded)")
    return comfy.url


def _compress(src: Path, dst: Path) -> str:
    """Guide: JPEG, ≤1600 px, quality 82, under ~300 KB. Without Pillow the PNG is kept."""
    try:
        from PIL import Image
    except ImportError:
        dst = dst.with_suffix(".png")
        dst.write_bytes(src.read_bytes())
        return f"Pillow missing — kept PNG ({dst.stat().st_size // 1024} KB), compress by hand"
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
           emit: Callable[[str, str], None] = lambda k, t: None) -> dict[str, Any]:
    """Render the chosen slots (1-based; default: every slot marked render) and wire them."""
    sheet_file = sheet_path(store, event_id).with_suffix(".json")
    if not sheet_file.exists():
        raise ValueError("plan the images first — the prompt sheet comes before any generation")
    sheet = json.loads(sheet_file.read_text(encoding="utf-8"))
    slots = sheet["slots"]
    todo = [n for n in (chosen or [i for i, s in enumerate(slots, 1) if s.get("render", True)])
            if 1 <= n <= len(slots)]
    if not todo:
        raise ValueError("no slots chosen")
    plates = _plates_module(store)
    comfy = plates.Comfy.discover()
    global LAST_COMFY
    LAST_COMFY = comfy.url
    if not comfy.alive():
        raise ValueError(f"ComfyUI is not answering at {comfy.url} — start it, then render again")
    renderer = plates.Renderer(comfy)
    rel_dir = f"assets/images/events/{event_id.replace('_', '-')}"
    folder = store.root / "Reputation-Matrix2" / rel_dir
    raw_dir = store.backup_dir / "renders" / event_id
    folder.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)
    made = []
    for n in todo:
        s = slots[n - 1]
        prompt = (prompts or {}).get(str(n)) or s["prompt"]
        avoid = ", ".join(map(str, s.get("mustNotAppear") or []))
        negative = SCENE_NEGATIVE + (", " + avoid if avoid else "")
        seed = random.randint(1, 2**31 - 1)
        emit("step", f"rendering slot {n}/{len(slots)} — {s['slot']} {s['heading']}")
        if s.get("cast"):
            ref = store.root / s["cast"]["portrait"]
            name = comfy.upload(str(ref), f"desk_{s['cast']['id']}{ref.suffix}")
            wf = plates.workflow_fill(renderer.wf, prompt, name, f"desk/{event_id}-{n:02d}", seed, negative=negative)
        elif renderer.can_text_only():
            wf = plates.workflow_fill(renderer.text_only_workflow(), prompt, "", f"desk/{event_id}-{n:02d}",
                                      seed, negative=negative)
        else:
            emit("step", f"slot {n}: this ComfyUI graph needs a reference portrait — skipped")
            continue
        raw = raw_dir / f"{n:02d}.png"
        comfy.run(wf, str(raw))
        subject = slug(s["heading"] if s["slot"] != "lead" else "lead", 28).replace("_", "-")
        dst = folder / f"{_prefix(event_id)}-{n:02d}-{subject}.jpg"
        size = _compress(raw, dst)
        if not dst.exists():
            dst = dst.with_suffix(".png")
        made.append({"slot": n, "part": s["part"], "image": f"{rel_dir}/{dst.name}", "caption": s["caption"],
                     "alt": s["alt"], "seed": seed, "size": size})
        emit("step", f"slot {n} saved — {dst.name} ({size})")
    _wire(store, event_id, made)
    return {"id": event_id, "images": made,
            "note": "Look at every image before keeping it (guide step 4). Undo restores the record; "
                    "the image files stay on disk for you to delete or keep."}


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
