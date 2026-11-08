"""Commentary tracks and article analyses for a filed event — same desk, different prompts.

Commentary ("Waluigi's Cut", docs/COMMENTARY_MODE_GUIDE.md): DURING stance. The whole
story retold in source order through a framing conceit (a screening, minutes read
aloud…), third-person Waluigi with CAPS and WAH heckling every few sentences, verbatim
quotes, one honest concession beat in the back half, no ledger words, no thesis.
Floors from tools/check-commentaries.py are measured here and a failing section gets
one rewrite before filing: 240-950 words a section, 6-14 sections, ≥0.8x the source,
Waluigi ≥12/1k, CAPS ≥20/1k, at least one WAH, quotes that exist in the source.

Analysis (docs/ARTICLE_ANALYSES.md): AFTER stance. Claim-ordered, first-person "I" at
a desk under a lamp, a physical beat before every argument, a sourceAnchor per
section, two readings, a cross-file consequence naming another filing, a personal
admission, a recommendation; thesis 180-350, 5-9 sections of 250-550, verdict 180-350.

Plans come from the json model, prose from the writer model; code owns ids, shards,
headings/anchors validation, relatedArticles, the floors and the checks.
"""
from __future__ import annotations

import re
from typing import Any

from desk_image import story_parts
from desk_store import Store, norm

ICONS = ("📽️", "🎬", "📼", "🔊", "🎞️", "📺", "🍿", "📣", "🎙️", "⏯️", "🔁", "⏸️", "🎚️", "📡")
DESK_ICONS = ("🗂️", "🔍", "📎", "🕯️", "📑", "🖋️", "⚖️", "🧾", "📚")
LEDGER = ("filed", "ruled", "entered", "custody", "exhibit", "verdict", "thesis", "finding", "findings",
          "chain of possession", "audit register")
CAPS_RE = re.compile(r"\b[A-Z]{2,}\b")
WALU_RE = re.compile(r"\bWaluigi\b")
QUOTE_RE = re.compile(r"[\"“]([^\"”]{3,})[\"”]")


def words(text: str) -> int:
    return len(str(text or "").split())


def _clean(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9\s]", " ", str(text or "").lower()).split())


def source_text(rec: dict[str, Any]) -> str:
    return " ".join(str(rec.get(k) or "") for k in ("description", "summary", "outcome", "aftermath",
                                                      "waluigiAssessment")) + " " + " ".join(
        f"{s.get('overview') or ''} {s.get('waluigi_note') or ''}" for s in rec.get("sections") or []
        if isinstance(s, dict))


def bad_quotes(body: str, src_clean: str, src_words: set[str]) -> list[str]:
    """Quoted lines of 4+ words that are not in the source (the checker's fuzzy rule)."""
    out = []
    for q in QUOTE_RE.findall(body):
        qc = _clean(q)
        if len(qc.split()) < 4 or qc in src_clean:
            continue
        ws = qc.split()
        if sum(w in src_words for w in ws) / len(ws) < 0.8:
            out.append(q.strip()[:90])
    return out


def units(rec: dict[str, Any]) -> list[tuple[str, str]]:
    """The source event's story beats: its ## parts, else its sections[], else paragraph runs."""
    parts = story_parts(rec.get("description") or "")
    if parts:
        return parts
    secs = [(str(s.get("name") or s.get("heading") or f"Part {i}"), str(s.get("overview") or s.get("body") or ""))
            for i, s in enumerate(rec.get("sections") or [], 1) if isinstance(s, dict)]
    if any(t for _, t in secs):
        return secs
    paras = [p for p in str(rec.get("description") or "").split("\n\n") if p.strip()]
    out, cur = [], []
    for p in paras:
        cur.append(p)
        if words("\n\n".join(cur)) >= 400:
            out.append((f"Part {len(out) + 1}", "\n\n".join(cur)))
            cur = []
    if cur:
        out.append((f"Part {len(out) + 1}", "\n\n".join(cur)))
    return out


def merge_to(beats: list[tuple[str, str]], most: int) -> list[tuple[str, str]]:
    """Adjacent beats merged until there are at most `most` (guide: 6-14 sections)."""
    beats = list(beats)
    while len(beats) > most:
        i = min(range(len(beats) - 1), key=lambda k: words(beats[k][1]) + words(beats[k + 1][1]))
        beats[i:i + 2] = [(f"{beats[i][0]} / {beats[i + 1][0]}", beats[i][1] + "\n\n" + beats[i + 1][1])]
    return beats


def pid(p: Any) -> str:
    """A participant entry is {id, name, role} in new filings and a bare id string in old ones."""
    return str(p.get("id") or "") if isinstance(p, dict) else str(p or "")


def related_events(store: Store, rec: dict[str, Any], limit: int = 8) -> list[dict[str, str]]:
    """Other filings that share cast or place — what an analysis may cross-reference."""
    ids = {pid(p) for p in rec.get("participants") or []} | set(map(str, rec.get("relatedArticles") or []))
    scored = []
    for ev in store.bundle("events"):
        if ev.get("id") == rec.get("id"):
            continue
        shared = ids & ({pid(p) for p in ev.get("participants") or []} | set(map(str, ev.get("relatedArticles") or [])))
        if shared:
            scored.append((len(shared), ev))
    scored.sort(key=lambda x: -x[0])
    return [{"id": e["id"], "title": e.get("title") or e.get("name") or e["id"],
             # the part before the subtitle dash; "Survey: Part III" keeps its part number
             "short": re.split(r"\s[—–]\s", str(e.get("name") or e.get("title") or e["id"]))[0][:70],
             "date": str(e.get("date") or "")[:40], "summary": str(e.get("summary") or "")[:220]}
            for _, e in scored[:limit]]


class Tracks:
    def __init__(self, store: Store, desk: Any, emit=None):
        self.store, self.desk = store, desk
        self.emit = emit or (lambda k, t: None)
        self.notes: list[str] = []

    def _source(self, event_id: str) -> dict[str, Any]:
        rec = self.store.get("events", event_id)
        if not rec:
            raise ValueError(f"no event {event_id!r}")
        return rec

    def _file(self, kind: str, record: dict[str, Any]) -> str:
        shard = self.store.shard_of(kind, record["id"]) or f"{kind}/{record['id']}.json"
        return self.store.upsert(kind, record, shard)

    # ================= commentary =================
    def commentary(self, event_id: str, notes: str = "") -> dict[str, Any]:
        rec = self._source(event_id)
        beats = merge_to(units(rec), 14)
        if not beats:
            raise ValueError("the event has no story text to talk over")
        src = source_text(rec)
        src_clean, src_words = _clean(src), set(_clean(src).split())
        src_story = words(src)
        if len(beats) < 6:
            self.notes.append(f"{len(beats)} sections — the source has only {len(beats)} beats (guide: 6-14)")
        self.emit("step", f"1/3 planning the cut: conceit and {len(beats)} headings")
        plan = self.desk.ask_json(
            "Plan Waluigi's Cut, a comedy commentary track over this archive event. JSON keys: \"conceit\" "
            "(the in-world medium he performs through: screening the footage at a projector, reading the "
            "minutes aloud, reviewing black-box audio, or a live blog — pick what fits), \"subtitle\" (\"In "
            "Which Waluigi …\"), \"standfirst\" (2-4 sentences: what he is watching and why he is yelling at "
            "it), \"headings\" (one per section below, in order: loud ALL-CAPS or a direct quote of a line "
            "from that section).\n" + (f"Filer's notes: {notes}\n" if notes else "")
            + f"\nEVENT: {rec.get('title') or rec.get('name')}\nSECTIONS:\n"
            + "\n".join(f"{i}. {h}: {t[:200]}" for i, (h, t) in enumerate(beats, 1)), 1600)
        heads = [str(h) for h in plan.get("headings") or []]
        conceit = str(plan.get("conceit") or "screening the footage at a projector")
        concede_at = max(1, round(len(beats) * 0.66))
        sections, prev = [], ""
        for i, (head, text) in enumerate(beats, 1):
            target = max(300, min(900, round(words(text) * 1.05)))
            self.emit("step", f"2/3 writing section {i}/{len(beats)} — {head}")
            body = self._cut_section(i, len(beats), text, prev, conceit, target, i == concede_at, notes)
            body = self._cut_floor(body, text, target, src_clean, src_words, i)
            sections.append({"id": re.sub(r"[^a-z0-9]+", "-", norm(head))[:40].strip("-") or f"beat-{i}",
                             "icon": ICONS[(i - 1) % len(ICONS)],
                             "heading": heads[i - 1] if i <= len(heads) and heads[i - 1].strip() else head.upper(),
                             "body": body})
            prev = body[-400:]
        seen: set[str] = set()
        for s in sections:            # unique section ids
            base, n = s["id"], 2
            while s["id"] in seen:
                s["id"], n = f"{base}-{n}", n + 1
            seen.add(s["id"])
        blob = " ".join(s["body"] for s in sections)
        total = words(blob)
        if total < 0.8 * src_story:
            self.notes.append(f"cut is {total} words against a {src_story}-word source ({total / max(1, src_story):.2f}x, guide ≥0.8x)")
        if "WAH" not in blob:
            sections[0]["body"] += "\n\n*WAH! Waluigi has SEEN things on this tape, and he is only getting started.*"
        pull = max(re.findall(r"[^.!?\n]{20,160}[.!?]", blob) or [blob[:140]],
                   key=lambda s: len(CAPS_RE.findall(s)) + 3 * ("WAH" in s) - abs(len(s) - 90) / 40)
        tc = re.match(r"TC:(\d+-\d+-\d+)", str(rec.get("timeCode") or ""))
        record = {
            "id": f"{event_id}_commentary", "sourceArticle": event_id,
            "title": rec.get("title") or rec.get("name"),
            "subtitle": str(plan.get("subtitle") or "In Which Waluigi Watches the Tape"),
            "filed": f"{rec.get('date') or 'Undated'} — recorded at the screening desk ({conceit})",
            "timeCode": f"TC:{tc.group(1)}/COM" if tc else "",
            "kicker": "Waluigi's Cut · Commentary Track", "pullQuote": pull.strip(),
            "standfirst": str(plan.get("standfirst") or ""), "sections": sections,
            "relatedArticles": self._related(rec, blob),
        }
        self.emit("step", "3/3 filing the cut and running the checks")
        shard = self._file("commentaries", record)
        self.notes.append(f"{len(sections)} sections, {total} words; Waluigi/1k {len(WALU_RE.findall(blob)) / max(1, total) * 1000:.1f}, "
                          f"CAPS/1k {len(CAPS_RE.findall(blob)) / max(1, total) * 1000:.1f}")
        return {"kind": "commentary", "id": record["id"], "source": event_id, "shard": shard,
                "route": f"#/commentary/{record['id']}", "checks_for": ("check-commentaries.py", "check-references.py")}

    def _cut_section(self, i, n, text, prev, conceit, target, concede, notes) -> str:
        return self.desk.ask(
            f"Write section {i} of {n} of Waluigi's Cut: Waluigi is {conceit}, reacting to this stretch of the "
            "story AS IT PLAYS. He does not know what happens next — no foreshadowing.\n"
            f"Rules:\n- About {target} words (never under 240). Retell the whole stretch in order so a reader who "
            "never saw the event knows exactly what happened; compress the narration and cut in a heckle every "
            "second or third sentence.\n- Third person: say \"Waluigi\" often (at least once every 80 words), "
            "use ALL-CAPS emphasis on words he yells, and at least one WAH.\n- Quote the characters' lines EXACTLY "
            "as they appear in the passage below, then tear into them. Never invent or reword a quote.\n"
            "- No invented facts: where the record is silent, say so in voice (\"the tape does not show…\").\n"
            "- Comedy register only: never use the words " + ", ".join(LEDGER[:8]) + ".\n"
            + ("- This is the concession beat: for three or four sentences Waluigi drops the act and admits one "
               "inconvenient physical truth from the passage, then snaps straight back.\n" if concede else "")
            + "- Markdown paragraphs only, no heading, no HTML.\n"
            + (f"Filer's notes: {notes}\n" if notes else "")
            + (f"The previous section ended: \"{prev}\"\n" if prev else "This is the opening: establish the conceit.\n")
            + f"\nPASSAGE:\n{text[:5200]}", 1500, role="writer").strip()

    def _cut_floor(self, body, text, target, src_clean, src_words, i) -> str:
        """Measure the checker floors; one rewrite for a section that misses them."""
        body = re.sub(r"^\s*#{1,6} .*\n+", "", re.sub(r"</?div[^>]*>", "", body)).strip()
        w = max(1, words(body))
        problems = []
        if w < 240:
            problems.append(f"it is {w} words; write about {target}")
        if len(WALU_RE.findall(body)) / w * 1000 < 12:
            problems.append("say \"Waluigi\" (third person) far more often")
        if len(CAPS_RE.findall(body)) / w * 1000 < 20:
            problems.append("use more ALL-CAPS emphasis on the words he yells")
        ledger = sorted({m.lower() for m in re.findall(r"\b(" + "|".join(LEDGER) + r")\b", body, re.I)})
        if ledger:
            problems.append("drop the audit words " + ", ".join(ledger))
        bad = bad_quotes(body, src_clean, src_words)
        if bad:
            problems.append("these quotes are not in the passage — quote it exactly or drop the quote marks: "
                            + " | ".join(bad[:4]))
        if not problems:
            return body
        self.emit("step", f"section {i}: rewriting ({'; '.join(p.split(' —')[0][:40] for p in problems)})")
        redo = self.desk.ask(
            "Rewrite this section of Waluigi's commentary track. Keep every event in order and every correct "
            "quote; fix: " + "; ".join(problems) + ". Return only the section.\n\nSECTION:\n" + body
            + f"\n\nTHE PASSAGE IT RETELLS (quotes must match it):\n{text[:4000]}", 1500, role="writer")
        redo = re.sub(r"^\s*#{1,6} .*\n+", "", re.sub(r"</?div[^>]*>", "", redo)).strip()
        if words(redo) >= min(240, w):
            body = redo
        left = bad_quotes(body, src_clean, src_words)
        if left:
            self.notes.append(f"section {i}: {len(left)} quote(s) not found verbatim in the source — check: {left[0]}")
        return body

    # ================= analysis =================
    def analysis(self, event_id: str, notes: str = "") -> dict[str, Any]:
        rec = self._source(event_id)
        beats = units(rec)
        src = source_text(rec)
        src_clean, src_words = _clean(src), set(_clean(src).split())
        others = related_events(self.store, rec)
        files = "\n".join(f"- {o['id']} — {o['title']} ({o['date']}): {o['summary']}" for o in others) or "- none"
        self.emit("step", f"1/4 planning the claims ({len(others)} related filings to cross-reference)")
        plan = self.desk.ask_json(
            "Plan Waluigi's Article Analysis of this archive event: written the morning AFTER, knowing the "
            "ending, ordered by CLAIMS not by chronology. JSON keys: \"subtitle\" (the angle, not a new event "
            "title), \"summary\" (35-80 words: the thesis, not a plot recap), \"claims\" (5-9 items: "
            "{\"heading\": a claim Waluigi will argue, \"sourceAnchor\": ONE short exact quotation or fact copied "
            "from the event, \"parts\": [numbers of the story parts it draws on], \"crossRef\": the id of one "
            "related filing below it bears on, or null}).\n" + (f"Filer's notes: {notes}\n" if notes else "")
            + f"\nEVENT: {rec.get('title') or rec.get('name')} — {rec.get('summary')}\nOutcome: {rec.get('outcome')}\n"
            f"Waluigi's assessment on the event: {str(rec.get('waluigiAssessment'))[:600]}\n\nSTORY PARTS:\n"
            + "\n".join(f"{i}. {h}: {t[:220]}" for i, (h, t) in enumerate(beats, 1))
            + f"\n\nRELATED FILINGS:\n{files}", 2200)
        claims = [c for c in plan.get("claims") or [] if isinstance(c, dict) and c.get("heading")][:9]
        if len(claims) < 5:
            self.notes.append(f"only {len(claims)} claims planned (guide: 5-9)")
        if not claims:
            raise ValueError("the model planned no claims")
        known = {o["id"]: o for o in others}
        rules = (
            "Voice rules (ARTICLE_ANALYSES): Waluigi writes as \"I\", quietly, at a desk under a lamp, the morning "
            "after; no ALL-CAPS shouting; at most one *WAH!* aside, inside a paragraph. Audit register is fine "
            "(filed, ruled, entered, open question) where it carries the argument. Opinion is signed (\"I think\", "
            "\"my reading is\"); facts, quotes, chronology and outcomes stay exactly as the event has them. "
            "Make it physical: he holds the page, pulls the old file off the shelf, the tea goes cold. "
            "Use sensory words. Keep sentences under 30 words. Vary the physical detail — a different object "
            "or sense each time, not the cold tea again. No stock connectors (\"this realization necessitates\"). "
            "Markdown paragraphs only, no heading, no HTML.")
        self.emit("step", "2/4 writing the thesis")
        thesis = self._prose(
            "Write the THESIS of the analysis: 180-350 words. Open with one physical beat at the desk (the hour, "
            f"the file, the lamp), then the opening argument: {plan.get('summary')}\nClaims to come: "
            + "; ".join(c["heading"] for c in claims) + f"\n{rules}\n\nEVENT SUMMARY: {rec.get('summary')}", 180, 900)
        sections, dialogue_done = [], False
        for i, c in enumerate(claims, 1):
            nums = [int(n) for n in c.get("parts") or [] if str(n).isdigit() and 1 <= int(n) <= len(beats)]
            passage = "\n\n".join(beats[n - 1][1] for n in nums)[:3600] or src[:3600]
            anchor = str(c.get("sourceAnchor") or "").strip().strip("\"“”")
            if anchor and bad_quotes(f"\"{anchor}\"", src_clean, src_words):
                self.notes.append(f"claim {i}: anchor not found in the event, replaced by the passage's first line")
                anchor = ""
            if not anchor:
                anchor = re.split(r"(?<=[.!?])\s", passage.strip())[0][:200]
            ref = known.get(str(c.get("crossRef") or ""))
            self.emit("step", f"3/4 writing claim {i}/{len(claims)} — {c['heading']}")
            body = self._prose(
                f"Write section {i} of {len(claims)} of the analysis, arguing the claim: \"{c['heading']}\".\n"
                f"Source anchor (already shown above the section): {anchor}\n"
                "Shape, in order: one or two sentences of Waluigi physically handling the thing (not a scene from "
                "the event); his immediate reaction; a close reading with at least TWO interpretations and which "
                "he prefers and why; the consequence for another filing"
                + (f" — call it \"{ref['short']}\" (its short name, once) and say in a sentence or two what this "
                   "changes there" if ref else "") +
                "; a personal admission of why he is not neutral; a recommendation or open question. "
                "Do not retell the action.\n"
                + ("Promote the single most important spoken line in the passage to its own line as dialogue, "
                   "exactly as spoken.\n" if not dialogue_done else "")
                + f"250-550 words (aim ~400).\n{rules}\n\nTHE PASSAGE IT DRAWS ON:\n{passage}", 250, 1300)
            dialogue_done = dialogue_done or bool(re.search(r"(?m)^\s*[\"“][^\"”]{6,}[\"”]\s*$", body))
            bad = [q for q in bad_quotes(body, src_clean, src_words)
                   if not any(_clean(q)[:40] in _clean(o["title"]) or _clean(q) in _clean(o["short"]) for o in others)]
            if bad:
                self.notes.append(f"claim {i}: {len(bad)} quote(s) not verbatim in the event — check: {bad[0]}")
            sections.append({"id": re.sub(r"[^a-z0-9]+", "-", norm(c["heading"]))[:40].strip("-") or f"claim-{i}",
                             "icon": DESK_ICONS[(i - 1) % len(DESK_ICONS)], "heading": str(c["heading"]),
                             "sourceAnchor": anchor, "body": body})
        self.emit("step", "4/4 the verdict, then filing")
        verdict = self._prose(
            "Write the VERDICT: 180-350 words. What Waluigi concludes from the claims and what he recommends doing "
            "next; close on a physical residual — what is left on the desk when he stops.\nClaims argued: "
            + "; ".join(c["heading"] for c in claims) + f"\n{rules}", 180, 900)
        seen: set[str] = set()
        for s in sections:
            base, n = s["id"], 2
            while s["id"] in seen:
                s["id"], n = f"{base}-{n}", n + 1
            seen.add(s["id"])
        blob = thesis + " " + " ".join(s["body"] for s in sections) + " " + verdict
        record = {
            "id": f"{event_id}_waluigi_analysis", "sourceArticle": event_id,
            "title": rec.get("title") or rec.get("name"), "kicker": "Waluigi's Article Analysis",
            "subtitle": str(plan.get("subtitle") or "The archivist argues with the event after it was filed"),
            "archivist": "Waluigi, Auditor-General",
            "filed": f"{rec.get('date') or 'Undated'} — the morning after the session filing",
            "summary": str(plan.get("summary") or ""), "thesis": thesis, "sections": sections,
            "verdict": verdict, "relatedArticles": self._related(rec, blob, [o["id"] for o in others]),
        }
        shard = self._file("articleAnalyses", record)
        total = words(blob)
        self.notes.append(f"{len(sections)} claims, {total} words (guide 2,000-4,000); "
                          f"cross-references: {', '.join(i for i in record['relatedArticles'] if i in known) or 'none'}")
        return {"kind": "analysis", "id": record["id"], "source": event_id, "shard": shard,
                "route": f"#/article-analysis/{record['id']}",
                "checks_for": ("check-references.py", f"check-readability.py --analysis {record['id']}")}

    def _prose(self, prompt: str, floor: int, tokens: int) -> str:
        text = self.desk.ask(prompt, tokens, role="writer")
        text = re.sub(r"^\s*#{1,6} .*\n+", "", re.sub(r"</?div[^>]*>", "", text)).strip()
        if words(text) < floor:
            longer = self.desk.ask(f"This is {words(text)} words; it must be at least {floor}. Rewrite it longer by "
                                   "slowing down the physical beats and the reasoning — no new facts. Return only the "
                                   f"text.\n\n{text}", tokens, role="writer").strip()
            if words(longer) > words(text):
                text = re.sub(r"^\s*#{1,6} .*\n+", "", longer).strip()
        return text

    def _known_ids(self) -> set[str]:
        """Every id the archive can resolve: the filing stores plus the other data/*.json lists."""
        if getattr(self, "_ids", None) is None:
            ids: set[str] = set()
            for spec in self.store.manifest().values():
                ids |= set((spec.get("shards") or {}).keys())
            for path in self.store.data.glob("*.json"):
                try:
                    value = self.store.load_json(path)
                except (OSError, ValueError):
                    continue
                rows = value if isinstance(value, list) else next(
                    (v for v in value.values() if isinstance(v, list)), []) if isinstance(value, dict) else []
                ids |= {str(r["id"]) for r in rows if isinstance(r, dict) and r.get("id")}
            self._ids = ids
        return self._ids

    def _related(self, rec: dict[str, Any], blob: str, extra: list[str] | None = None) -> list[str]:
        """The source, plus records the text actually names (by title or name) — ids that
        resolve only: the source's own relatedArticles can carry a broken one (lanky_and_bulky)."""
        known = self._known_ids()
        out = [rec["id"]]
        cands = [(pid(p), p.get("name") if isinstance(p, dict) else None) for p in rec.get("participants") or []]
        cands += [(i, None) for i in rec.get("relatedArticles") or []]
        titles = {e["id"]: e.get("title") or e.get("name") for e in self.store.bundle("events")}
        cands += [(i, titles.get(i)) for i in extra or []]
        low = blob.lower()
        for cid, name in cands:
            if not cid or cid in out or cid not in known:
                continue
            label = str(name or cid.replace("_", " ")).lower()
            if label and label in low:
                out.append(cid)
        return out
