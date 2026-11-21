#!/usr/bin/env python3
"""Turn face-only portraits into full-body sprites with Qwen Image 2.1 Edit
running in a local ComfyUI — one command, one prompt template for every image.

Queue order: the members of the session parties named with ``--party`` first
(their actor art), then every portrait in the source folder (the Foundry Data
``portraits/`` by default). Images that are already tall (height ≥ 1.6 × width)
are treated as full body and skipped, and so is anything that already has an
output. Outputs land in ``Reputation-Matrix2/portraits/fullbody/<stem>.png``;
the originals are never touched. ``tools/build-session-party.py`` and the
sheets suite's install-images step pick the sprites up from there.

  python3 tools/fullbody-portraits.py --party Reputation-Matrix2/data/session-parties/the-feywild-house.json --party-only
  python3 tools/fullbody-portraits.py --party Reputation-Matrix2/data/session-parties/the-feywild-house.json --limit 20
  python3 tools/fullbody-portraits.py --list            # show the queue, generate nothing
  python3 tools/fullbody-portraits.py --only wario,mr_t --force

Needs ComfyUI at --comfy (default http://127.0.0.1:8188) with
qwen_image_2.1_int8_convrot, qwen3vl_8b_int8_convrot and qwen_image_2.1_vae_bf16
— the files the "Image Edit (Qwen Image 2.1)" template installs. stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import struct
import sys
import time
import urllib.parse
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RM = os.path.join(ROOT, "Reputation-Matrix2")
OUT = os.path.join(RM, "portraits", "fullbody")
FOUNDRY_PORTRAITS = os.path.join(os.environ.get("LOCALAPPDATA", ""), "FoundryVTT", "Data", "portraits")
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")

PROMPT = (
    "Redraw this character as a full-body standing sprite for a tabletop game: the whole figure "
    "from head to feet, both feet visible, standing in a natural three-quarter pose, centred, with a "
    "little space above the head and below the feet. Keep the face, hair, colours, outfit, "
    "accessories and art style exactly as in the reference; invent only the parts of the body and "
    "outfit the reference does not show, matching its style. Plain flat light-grey background, no "
    "scenery, no text, no frame, no other characters."
)
NEGATIVE = "cropped, close-up, portrait crop, cut off feet, cut off head, multiple characters, text, watermark, frame, scenery"

MODELS = {
    "unet": "qwen_image_2.1_int8_convrot.safetensors",
    "clip": "qwen3vl_8b_int8_convrot.safetensors",
    "vae": "qwen_image_2.1_vae_bf16.safetensors",
}


# ------------------------------------------------------------------ images

def image_size(path):
    """(width, height) from the file header — PNG, JPEG, WEBP; None if unknown."""
    try:
        with open(path, "rb") as f:
            head = f.read(32)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                return struct.unpack(">II", head[16:24])
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                kind = head[12:16]
                if kind == b"VP8X":
                    w = int.from_bytes(head[24:27], "little") + 1
                    h = int.from_bytes(head[27:30], "little") + 1
                    return w, h
                f.seek(0)
                data = f.read(40)
                if kind == b"VP8 ":
                    w, h = struct.unpack("<HH", data[26:30])
                    return w & 0x3FFF, h & 0x3FFF
                if kind == b"VP8L":
                    b = data[21:25]
                    w = 1 + (((b[1] & 0x3F) << 8) | b[0])
                    h = 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
                    return w, h
                return None
            if head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    marker = f.read(2)
                    if len(marker) < 2 or marker[0] != 0xFF:
                        return None
                    if marker[1] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        f.read(3)
                        h, w = struct.unpack(">HH", f.read(4))
                        return w, h
                    seg = struct.unpack(">H", f.read(2))[0]
                    f.seek(seg - 2, 1)
    except (OSError, struct.error):
        return None
    return None


def is_full_body(path):
    size = image_size(path)
    return bool(size and size[1] >= 1.6 * size[0])


# ------------------------------------------------------------------ queue

def party_sources(party_path):
    """Actor art of every member of a session party, in roster order."""
    with open(party_path, encoding="utf-8") as f:
        party = json.load(f)
    out = []
    packet = os.path.join(RM, "actors", party["packet"])
    built = {}
    if os.path.isdir(packet):
        for fn in os.listdir(packet):
            if fn.endswith(".json"):
                with open(os.path.join(packet, fn), encoding="utf-8") as f:
                    doc = json.load(f)
                cid = ((doc.get("flags") or {}).get("waluipedia-sheets") or {}).get("characterId")
                if cid:
                    built[cid] = doc
    mirror = os.path.join(RM, "actors", "worlds", "midlands")
    for m in party["members"]:
        doc = built.get(m["character"])
        if doc is None and m.get("reuse"):
            for dp, _d, files in os.walk(mirror):
                hit = [x for x in files if x.endswith(f"-{m['reuse']}.json")]
                if hit:
                    with open(os.path.join(dp, hit[0]), encoding="utf-8") as f:
                        doc = json.load(f)
                    break
        if doc is None and m.get("base"):
            with open(os.path.join(ROOT, m["base"]), encoding="utf-8") as f:
                doc = json.load(f)
        img = (doc or {}).get("img") or ""
        if img.startswith("portraits/fullbody/"):
            img = f"portraits/{m['character']}.jpg"
        src = resolve_art(img)
        if src:
            out.append((m["character"], src))
        else:
            print(f"  ! {m['name']}: no source image for {img!r}")
    return out


def resolve_art(rel):
    """An actor img path → a file on disk: the repo first, then Foundry Data."""
    if not rel:
        return None
    stem, _ = os.path.splitext(rel)
    for base in (RM, os.path.dirname(FOUNDRY_PORTRAITS)):
        for cand in [rel] + [stem + e for e in IMAGE_EXT]:
            p = os.path.join(base, cand)
            if os.path.isfile(p):
                return p
    return None


def folder_sources(src_dir):
    if not os.path.isdir(src_dir):
        return []
    return [(os.path.splitext(fn)[0], os.path.join(src_dir, fn))
            for fn in sorted(os.listdir(src_dir)) if fn.lower().endswith(IMAGE_EXT)]


def build_queue(args):
    seen, queue = set(), []
    entries = []
    for p in args.party or []:
        entries += [(stem, src, "party") for stem, src in party_sources(p)]
    if not args.party_only:
        entries += [(stem, src, "folder") for stem, src in folder_sources(args.src)]
    only = {s.strip() for s in (args.only or "").split(",") if s.strip()}
    for stem, src, why in entries:
        if stem in seen or (only and stem not in only):
            continue
        seen.add(stem)
        out = os.path.join(OUT, stem + ".png")
        if os.path.isfile(out) and not args.force:
            status = "done"
        elif is_full_body(src) and not args.force and why != "party":
            status = "already full body"
        else:
            status = "queued"
        queue.append({"stem": stem, "src": src, "out": out, "why": why, "status": status})
    return queue


# ------------------------------------------------------------------ comfyui

def http(comfy, path, data=None, headers=None):
    req = urllib.request.Request(comfy + path, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def upload(comfy, path):
    name = f"fullbody_{uuid.uuid4().hex[:8]}_{os.path.basename(path)}"
    boundary = uuid.uuid4().hex
    with open(path, "rb") as f:
        payload = f.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + payload + \
           (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue"
            f"\r\n--{boundary}--\r\n").encode()
    res = json.loads(http(comfy, "/upload/image", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"}))
    return res["name"] if not res.get("subfolder") else f"{res['subfolder']}/{res['name']}"


def graph(image_name, prompt, seed, width, height, steps):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": MODELS["unet"], "weight_dtype": "default"}},
        "2": {"class_type": "QwenImage21Cache", "inputs": {"model": ["1", 0], "device": "auto", "dtype": "default"}},
        "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": MODELS["clip"], "type": "qwen_image", "device": "default"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": MODELS["vae"]}},
        "5": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "6": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["3", 0], "vae": ["4", 0], "prompt": prompt, "negative_prompt": NEGATIVE,
            "resolution": 1024, "images.image_1": ["5", 0]}},
        "7": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {
            "model": ["2", 0], "positive": ["6", 0], "negative": ["6", 1], "latent_image": ["7", 0],
            "seed": seed, "steps": steps, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["4", 0]}},
        "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": "waluipedia_fullbody"}},
    }


def run_one(comfy, item, prompt, args):
    name = upload(comfy, item["src"])
    seed = random.randint(1, 2**48)
    body = json.dumps({"prompt": graph(name, prompt, seed, args.width, args.height, args.steps),
                       "client_id": "waluipedia-fullbody"}).encode()
    pid = json.loads(http(comfy, "/prompt", body, {"Content-Type": "application/json"}))["prompt_id"]
    start = time.time()
    while True:
        time.sleep(3)
        hist = json.loads(http(comfy, f"/history/{pid}"))
        if pid in hist:
            h = hist[pid]
            status = (h.get("status") or {}).get("status_str")
            if status == "error":
                raise RuntimeError(json.dumps(h["status"].get("messages"))[:600])
            imgs = (h.get("outputs") or {}).get("10", {}).get("images") or []
            if imgs:
                im = imgs[0]
                q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
                data = http(comfy, f"/view?{q}")
                os.makedirs(OUT, exist_ok=True)
                with open(item["out"], "wb") as f:
                    f.write(data)
                return time.time() - start, seed
        if time.time() - start > args.timeout:
            raise RuntimeError(f"timed out after {args.timeout}s (prompt {pid} still in ComfyUI's queue)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--party", action="append", help="data/session-parties/<session>.json — its members go first")
    ap.add_argument("--party-only", action="store_true", help="only the party members")
    ap.add_argument("--src", default=FOUNDRY_PORTRAITS, help="portrait folder to convert (default: Foundry Data/portraits)")
    ap.add_argument("--only", help="comma-separated stems")
    ap.add_argument("--limit", type=int, default=0, help="stop after N generations")
    ap.add_argument("--force", action="store_true", help="regenerate even when an output exists")
    ap.add_argument("--list", action="store_true", help="print the queue, generate nothing")
    ap.add_argument("--prompt", default=PROMPT, help="override the edit prompt")
    ap.add_argument("--width", type=int, default=832)
    ap.add_argument("--height", type=int, default=1216)
    ap.add_argument("--steps", type=int, default=25)
    ap.add_argument("--timeout", type=int, default=1800, help="seconds per image")
    ap.add_argument("--comfy", default="http://127.0.0.1:8188")
    args = ap.parse_args(argv)

    queue = build_queue(args)
    todo = [q for q in queue if q["status"] == "queued"]
    if args.limit:
        todo = todo[:args.limit]
    counts = {}
    for q in queue:
        counts[q["status"]] = counts.get(q["status"], 0) + 1
    print(f"fullbody-portraits: {len(queue)} images — " + ", ".join(f"{v} {k}" for k, v in counts.items())
          + f"; generating {len(todo)}")
    if args.list:
        for q in queue:
            print(f"  {q['status']:<18} {q['why']:<6} {q['stem']:<32} {os.path.relpath(q['src'], ROOT) if q['src'].startswith(ROOT) else q['src']}")
        return 0
    failed = 0
    for i, item in enumerate(todo, 1):
        try:
            secs, seed = run_one(args.comfy, item, args.prompt, args)
            print(f"  [{i}/{len(todo)}] {item['stem']:<28} {secs:5.0f}s seed {seed} -> {os.path.relpath(item['out'], ROOT)}", flush=True)
        except Exception as e:  # keep the batch going; report at the end
            failed += 1
            print(f"  [{i}/{len(todo)}] {item['stem']:<28} FAILED: {e}", flush=True)
    print(f"fullbody-portraits: {len(todo) - failed} written, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
