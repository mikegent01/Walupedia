#!/usr/bin/env python3
"""Derive the home page's "Current fronts" strip from the filed events.

The strip answers one question: **where is each campaign right now?** It was
previously hand-curated in `mainPage.campaignCovers`, and hand-curation is why
it went stale twice - the Mario front still pointed at The Garden Above the
Fire after The Tape and the Wario Files was filed, and the Feyward front still
pointed at the Library Reclamation after the Doorway session. Every future
session would have had the same failure mode.

So the covers are now *derived*. A session's campaign normally comes from its
`timeCode` suffix, which the date guide already requires and
`tools/check-timecodes.py` already validates. An explicit registered `arcId`
can override that clock bucket when a session belongs to a named follow-on arc:

    SHD -> Shadeward      FEY -> Feyward
    MAT -> Mario          SUBJ -> Subjective
    KIV -> Kivotos        EBO -> Mount Ebott
    toadalnaec_saga -> TOADALNAEC Saga

The newest filed event per resulting campaign wins, "newest" being position
in `events.json` (last = newest), which is the same ordering the Recent
Adventures feed uses. One cover per campaign: a campaign holding two cards
pushes another campaign off the strip entirely.

Only events carrying BOTH a timeCode and an image can front a campaign - a
cover with no art is not a cover. An event that is newer but has no image is
skipped with a note rather than silently ignored, because that is usually a
missing-art bug rather than an intentional omission.

Usage:
    python3 tools/build-campaign-fronts.py           # report
    python3 tools/build-campaign-fronts.py --write
    python3 tools/build-campaign-fronts.py --check
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "Reputation-Matrix2" / "data"

# Timecode suffix -> the campaign label shown on the card.
CAMPAIGNS = {
    "SHD": "Shadeward",
    "FEY": "Feyward",
    "MAT": "Mario",
    "SUBJ": "Subjective",
    "KIV": "Kivotos",
    "EBO": "Mount Ebott",
}

# Explicit event arcs take precedence over the default clock bucket. Keep this
# registry narrow: only an arc with a real front of its own belongs here.
ARC_CAMPAIGNS = {
    "toadalnaec_saga": "TOADALNAEC Saga",
}


def load(name):
    with (DATA / name).open(encoding="utf-8") as fh:
        return json.load(fh)


def dump(name, doc):
    (DATA / name).write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")


def slug(event_id):
    return event_id.replace("_", "-")


def suffix_of(event):
    tc = event.get("timeCode") or ""
    return tc.rsplit("/", 1)[-1] if "/" in tc else ""


def campaign_of(event):
    """Return an explicit arc front when registered, else the clock front."""
    arc_campaign = ARC_CAMPAIGNS.get(event.get("arcId"))
    return arc_campaign or CAMPAIGNS.get(suffix_of(event))


def blurb(text, limit=210):
    """A card-sized blurb: whole sentences up to `limit` chars.

    One sentence is often too terse for a cover ("The moment before
    judgement."), so keep adding sentences while they fit rather than
    stopping at the first full stop.
    """
    s = " ".join(str(text or "").split())
    if len(s) <= limit:
        return s
    out = ""
    for piece in re.split(r"(?<=[.!?])\s+", s):
        if not out:
            out = piece
        elif len(out) + 1 + len(piece) <= limit:
            out += " " + piece
        else:
            break
    # A card whose first sentence is three words ("The doorway, resolved.")
    # reads as a caption fragment, not a front. In that case ignore sentence
    # boundaries and take a clean word-boundary cut of the whole blurb.
    if len(out) < 70 or len(out) > limit:
        out = s[:limit].rsplit(" ", 1)[0].rstrip(" ,;:") + "…"
    return out


def build_covers(events):
    """Newest filed, imaged event per campaign -> a cover row. Plus notes."""
    newest, notes = {}, []
    for idx, ev in enumerate(events):
        camp = campaign_of(ev)
        if not camp:
            continue
        # Recovered/backfilled events belong in the archive, not in a current
        # campaign front. Their historical art remains available on the event.
        if ev.get("historical"):
            continue
        if not ev.get("image"):
            notes.append(f"{camp}: {ev['id']} is newer but has no image - not fronted")
            continue
        cur = newest.get(camp)
        if cur is None or idx > cur[0]:
            newest[camp] = (idx, ev)

    rows = []
    for camp, (idx, ev) in sorted(newest.items(), key=lambda kv: -kv[1][0]):
        rows.append({
            "id": f"{slug(ev['id'])}-cover",
            "campaign": camp,
            "title": f"{camp.upper()} — {ev.get('name') or ev['id']}",
            "caption": blurb(ev.get("imageCaption") or ev.get("summary")),
            "image": ev["image"],
            "articleId": ev["id"],
        })
    return rows, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    ev_doc = load("events.json")
    events = ev_doc["events"] if isinstance(ev_doc, dict) else ev_doc
    page = load("mainPage.json")

    rows, notes = build_covers(events)
    current = page.get("campaignCovers") or []

    for n in notes:
        print("  note:", n)

    if args.check:
        if current != rows:
            print("campaign fronts: the strip does not match the filed events.")
            cur_map = {c.get("campaign"): c.get("articleId") for c in current}
            new_map = {c["campaign"]: c["articleId"] for c in rows}
            for camp in sorted(set(cur_map) | set(new_map)):
                a, b = cur_map.get(camp), new_map.get(camp)
                if a != b:
                    print(f"  {camp}: {a} -> {b}")
            print("  run: python3 tools/build-campaign-fronts.py --write")
            return 1
        print(f"campaign fronts: {len(rows)} fronts, one per campaign, all current.")
        return 0

    for c in rows:
        print(f"  {c['campaign']:<12} {c['articleId']}")

    if not args.write:
        print(f"\n{len(rows)} front(s). Re-run with --write to apply.")
        return 0

    page["campaignCovers"] = rows
    dump("mainPage.json", page)
    print(f"\nwrote {len(rows)} front(s) to mainPage.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
