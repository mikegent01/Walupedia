"""The Filing Desk: a local model files a session, or edits an event, step by step.

The orchestrator owns docs/SESSION_FILING_PROCESS.md's order; the model is asked
one small question per step and never sees the guides (desk_prompts.py carries
the few STORY_FORMAT_GUIDE rules each step needs). Code decides ids, shards,
time codes, participants, related articles, lengths, the home feed and the checks.

    desk = FilingDesk(Store(), llm, emit)
    desk.file_session(transcript, hints="")    # -> report dict
    desk.edit_event(event_id, instruction)    # -> report dict

`llm(system, prompt, max_tokens, role)` returns the model's text; `role` is
"reader" (digest, facts, outline), "writer" (story parts) or "json" (apparatus,
fixes), so each can run on its own model. Calls are grouped by role so a filing
swaps models at most twice. `emit(kind, text)` reports progress.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable

import desk_prompts as P
from desk_store import SPEAKER_RE
from desk_store import (MONTHS, Store, banned_word_hits, handle_hits, norm, scrub_handles,
                        slug, speaker_handles, time_code)

LLM = Callable[[str, str, int, str], str]
Emit = Callable[[str, str], None]

EVENT_KEYS = ["id", "name", "title", "date", "timeCode", "timeWindow", "laterDated", "era", "type",
              "location", "status", "summary", "description", "outcome", "image", "imageCaption",
              "image_alt", "notableFeatures", "participants", "keyBattles", "relatedArticles",
              "reputationChanges", "effects", "reputationNotes", "aftermath", "waluigiAssessment",
              "xpAwards", "gallery", "sections", "arcId"]
PROSE_KEYS = ("name", "title", "era", "type", "status", "summary", "description", "outcome",
              "imageCaption", "image_alt", "notableFeatures", "aftermath", "waluigiAssessment")
FILING_WORLDS = ("material", "feyward", "shadeward", "mirror")   # "unsorted" is never a model's pick
VOICE = P.VOICE
DIGEST_CHARS = 14_000


def ds_speaker_lines(text: str) -> list[str]:
    """Speaker-labelled lines ("Name: words") — a subtitle dump has none."""
    return SPEAKER_RE.findall(text or "")


def words(text: str) -> int:
    return len(re.findall(r"\b[\w'’-]+\b", str(text or "")))


def _repair_truncated(text: str) -> Any:
    """A reply cut off by max_tokens: back up to the last complete value and close what is
    open. Without this, a cut-off object made the parser grab its first complete inner list
    (the DK run's "expected a JSON object")."""
    stack: list[str] = []
    in_str = esc = False
    cuts: list[tuple[int, list[str]]] = []          # (end index, open brackets) after each complete value
    for i, c in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c in "{[":
            stack.append("}" if c == "{" else "]")
        elif c in "}]":
            if stack:
                stack.pop()
            if not stack:
                return json.loads(text[:i + 1])
            cuts.append((i + 1, list(stack)))
        elif c == ",":
            cuts.append((i, list(stack)))
    for end, open_ in reversed(cuts[-40:]):
        candidate = text[:end].rstrip().rstrip(",") + "".join(reversed(open_))
        try:
            return json.loads(candidate)
        except ValueError:
            continue
    raise ValueError("truncated JSON could not be repaired")


def parse_json(text: str) -> Any:
    """The reply's outer JSON object or array (fences and <think> stripped). A reply cut off
    mid-object is repaired, not mined for an inner fragment."""
    text = re.sub(r"<think>[\s\S]*?</think>", " ", str(text or ""), flags=re.I)
    text = re.sub(r"```(?:json)?", " ", text)
    first = min((i for i in (text.find("{"), text.find("[")) if i >= 0), default=-1)
    if first >= 0:
        try:
            return _repair_truncated(text[first:])
        except ValueError:
            pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        while start >= 0:
            depth, in_str, esc = 0, False, False
            for i in range(start, len(text)):
                c = text[i]
                if in_str:
                    if esc:
                        esc = False
                    elif c == "\\":
                        esc = True
                    elif c == '"':
                        in_str = False
                    continue
                if c == '"':
                    in_str = True
                elif c == opener:
                    depth += 1
                elif c == closer:
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(text[start:i + 1])
                        except ValueError:
                            break
            start = text.find(opener, start + 1)
    raise ValueError("no JSON object in the model reply")


class FilingDesk:
    def __init__(self, store: Store, llm: LLM, emit: Emit | None = None,
                 run_checks: bool = True, digest_chars: int = DIGEST_CHARS,
                 checkpoint: Callable[[dict[str, Any]], None] | None = None):
        self.store = store
        self.digest_chars = max(4000, digest_chars)
        self._llm = llm
        self.emit = emit or (lambda kind, text: None)
        self.run_checks = run_checks
        self.notes: list[str] = []
        self.manual: list[str] = []
        # Long runs are checkpointed after every step, so a failure late in the run can be
        # continued (desk_api "continue") instead of starting a 15-minute filing over.
        self.state: dict[str, Any] = {}
        self._checkpoint = checkpoint or (lambda st: None)

    def _save(self, **values: Any) -> None:
        self.state.update(values)
        self.state["notes"], self.state["manual"] = self.notes, self.manual
        self._checkpoint(self.state)

    # ---- model plumbing ----
    def ask(self, prompt: str, max_tokens: int = 1200, system: str = VOICE, role: str = "json") -> str:
        return self._llm(system, prompt, max_tokens, role)

    def ask_json(self, prompt: str, max_tokens: int = 1200, role: str = "json", shape: type = dict,
                 fallback_role: str | None = None) -> Any:
        """JSON of the expected shape. Models wrap objects in lists ([{...}]) and lists in
        objects ({"characters": [...]}); both are unwrapped. A bad reply is asked again from
        scratch with more room, then (if given) on the fallback model, before it fails."""
        what = "object" if shape is dict else "list"
        tries = [(role, max_tokens), (role, int(max_tokens * 1.6))]
        if fallback_role and fallback_role != role:
            tries.append((fallback_role, int(max_tokens * 1.6)))
        error: Exception = ValueError("no reply")
        for n, (who, budget) in enumerate(tries):
            if n:
                self.emit("step", f"model reply was not the JSON asked for ({error}) — asking again"
                          + (f" on the {who} model" if who != role else " with more room"))
            reply = self.ask(prompt + f"\n\nReply with ONLY one JSON {what}, no prose. Keep every value short "
                             "enough that the whole reply fits.", budget, role=who)
            try:
                value = self._coerce(parse_json(reply), shape)
                if value is not None:
                    return value
                error = ValueError(f"expected a JSON {what}")
            except ValueError as exc:
                error = exc
            snippet = re.sub(r"\s+", " ", str(reply))
            self.emit("step", f"unusable reply ({len(str(reply))} chars): {snippet[:160]} … {snippet[-120:]}")
        raise ValueError(f"the model's reply was not usable JSON: {error}")

    @staticmethod
    def _coerce(value: Any, shape: type) -> Any:
        if isinstance(value, shape):
            return value
        if shape is dict and isinstance(value, list):
            dicts = [v for v in value if isinstance(v, dict)]
            return dicts[0] if len(dicts) == 1 else ({"parts": dicts} if dicts else None)
        if shape is list and isinstance(value, dict):
            lists = [v for v in value.values() if isinstance(v, list)]
            return lists[0] if len(lists) == 1 else [value]
        return None

    # ---- indexes ----
    def _index(self, kind: str) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for rec in self.store.bundle(kind):
            rid = str(rec.get("id") or "")
            if not rid:
                continue
            for key in (rec.get("name"), rec.get("title"), rid.replace("_", " ")):
                if key and norm(key) and norm(key) not in out:
                    out[norm(key)] = rec
        return out

    @staticmethod
    def _resolve(name: str, index: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
        key = norm(name)
        if key in index:
            return index[key]
        hits = {id(r): r for k, r in index.items() if key and (k.startswith(key + " ") or k.endswith(" " + key))}
        if len(hits) == 1:
            return next(iter(hits.values()))
        # "Kongo Bongo, the dock" / "the Mines (east shaft)": try the place before the qualifier
        head = re.split(r"[,(;]| - | — ", str(name))[0].strip()
        return FilingDesk._resolve(head, index) if head and head != str(name).strip() else None

    def _world_of(self, kind: str, rid: str) -> str | None:
        rel = self.store.shard_of(kind, rid) or ""
        m = re.match(rf"{kind}/([a-z]+)", rel)
        return m.group(1) if m and m.group(1) in FILING_WORLDS else None

    # ---- step 0: digest a long transcript ----
    def digest(self, transcript: str, hints: str = "") -> str:
        """Beat notes that fit the window. Each chunk gets an equal share of the budget up
        front, so the notes never have to be cut — cutting the tail lost the DK ending."""
        size = self.digest_chars
        if len(transcript) <= size:
            return transcript
        chunks = [transcript[i:i + size] for i in range(0, len(transcript), size)]
        share = size // len(chunks)
        notes = []
        for n, chunk in enumerate(chunks, 1):
            self.emit("step", f"reading transcript part {n}/{len(chunks)}")
            notes.append(self._beats(chunk, n, len(chunks), share, hints))
        for attempt in range(2):           # a note over its share is redone tighter, not cut
            fat = [i for i, t in enumerate(notes) if len(t) > share * 1.15]
            if not fat:
                break
            for i in fat:
                self.emit("step", f"beat notes for part {i + 1} too long — condensing")
                notes[i] = self._beats(notes[i], i + 1, len(chunks), int(share * (0.8 - 0.2 * attempt)), hints)
        # last resort: trim the MIDDLE of an over-long note, never its end — each part's
        # closing beats (and the session's ending) survive like its opening
        half = max(1, share // 2 - 3)
        return "\n\n".join(t if len(t) <= share else t[:half] + " … " + t[-half:] for t in notes)

    def _beats(self, text: str, n: int, total: int, share: int, hints: str) -> str:
        return self.ask(
            "Summarise this part of a session transcript as an ordered list of story beats, in at most "
            f"{max(80, share // 6)} words. For each beat give who (character names, not player handles), "
            "where, what happened, and copy the one line of dialogue that defines it verbatim in quotes. "
            "Note any stated date or time of day. Keep the LAST beats as carefully as the first: how this "
            "part ends matters most.\n"
            + (f"The filer's framing (who is who, what is a flashback): {hints[:600]}\n" if hints else "")
            + f"\nPART {n} of {total}:\n{text}", max(400, int(share / 3.2)), role="reader")

    # ---- the session filing ----
    def file_session(self, transcript: str, hints: str = "", state: dict[str, Any] | None = None) -> dict[str, Any]:
        """File a session. With `state` from an earlier, failed run, every step it finished is
        reused: the digest, facts, character profiles, outline, the stubs already written to
        the stores and every story part already written."""
        st = self.state = dict(state or {})
        if st:
            self.notes, self.manual = list(st.get("notes") or []), list(st.get("manual") or [])
            done = [k for k in ("account", "facts", "stubs", "parts", "filed", "body", "meta") if k in st]
            self.emit("step", f"continuing an earlier run — reusing: {', '.join(done)}"
                      + (f" ({len(st.get('body') or [])} story parts already written)" if st.get("body") else ""))
        st.setdefault("transcript", transcript)
        st.setdefault("hints", hints)
        self._save()
        store = self.store
        chars, locs = self._index("characters"), self._index("locations")
        handles = speaker_handles(transcript, set(chars), store.root)
        now = store.current_date()
        labelled = len(ds_speaker_lines(transcript))
        if labelled < 3 and not hints.strip() and "account" not in st:
            msg = ("this transcript has no speaker labels and no filer's notes — the model has to guess who "
                   "says what. Undo and re-file with notes above a --- line (who is speaking, what is a "
                   "flashback, how it ends) if any attribution is wrong")
            self.emit("step", "warning: " + msg)
            self.notes.append(msg)
        if "account" in st:
            account = st["account"]
        else:
            account = self.digest(transcript, hints)
            self._save(account=account)

        # ---------- reader model: facts, cast, outline ----------
        self.emit("step", "1/8 extracting who, where and when" + (" (reused)" if "facts" in st else ""))
        facts = st.get("facts") or self.ask_json(
            "From this session account, extract the filing facts as JSON with keys:\n"
            '{"name": short article name, "world": one of ' + "/".join(FILING_WORLDS) + ' (material = the '
            'ordinary world), "location": main place name, "newLocations": [{"name","type","region","summary"}] '
            'for places that seem new, "participants": [{"name": character name, "role": one sentence}], '
            '"date": {"stated": true only if the account states an in-world date, "year", "month" (1-12), '
            '"day", "hour" (0-23 estimate from time-of-day cues), "minute", "clock": MAT|SHD|FEY|SUBJ|KIV|EBO, '
            '"basis": what the hour estimate rests on}, "type": short genre tags, "era": arc or era name}\n'
            f"Months: {', '.join(f'{i+1}={m}' for i, m in enumerate(MONTHS))}. "
            f"World clock today: {now[2]} {MONTHS[now[1]-1]} {now[0]} BF.\n"
            f"Speaker labels that are players/GM, never characters: {', '.join(sorted(handles))}.\n"
            + (f"Filer's hints: {hints}\n" if hints else "") + f"\nACCOUNT:\n{account}", 1500, role="reader")
        self._save(facts=facts)

        loc_name = str(facts.get("location") or "").strip()
        loc = self._resolve(loc_name, locs) if loc_name else None
        world = (self._world_of("locations", loc["id"]) if loc else None) or \
            (facts.get("world") if facts.get("world") in FILING_WORLDS else "material")
        tc, window, later, tnotes = time_code(facts.get("date") or {}, world, now)
        self.notes += tnotes
        y, m, d = (int(x) for x in re.match(r"TC:(\d+)-(\d+)-(\d+)", tc).groups())
        event_id = st.get("event_id") or store.unique_id("events", slug(facts.get("name") or "session"))
        self._save(event_id=event_id)

        participants, unknown = [], []
        for p in facts.get("participants") or []:
            nm = str(p.get("name") or "").strip()
            if not nm or handle_hits(nm, handles):
                continue
            rec = self._resolve(nm, chars)
            role = scrub_handles(str(p.get("role") or ""), handles)
            if rec:
                if rec["id"] not in [x["id"] for x in participants]:
                    participants.append({"id": rec["id"], "name": rec.get("name") or nm, "role": role})
            else:
                unknown.append((nm, role))
        stubs: dict[str, dict[str, Any]] = dict(st.get("stubs") or {})
        if unknown and "stubs" not in st and "filed" not in st:
            self.emit("step", "2/8 profiling new characters")
            got = self.ask_json(
                "Write short character records for these people from the account. JSON list of "
                '{"name","title","race","affiliation","summary": two sentences}. Only what the account says.\n'
                + "\n".join(f"- {nm}: {role}" for nm, role in unknown)
                + f"\n\nACCOUNT:\n{account[: self.digest_chars // 2]}", 1400, role="reader", shape=list)
            stubs = {norm(s.get("name")): s for s in got if isinstance(s, dict)} if isinstance(got, list) else {}
            self._save(stubs=stubs)

        n_parts = max(P.PARTS_MIN, min(P.PARTS_MAX, round(words(transcript) / P.WORDS_PER_PART_OF_ACCOUNT)))
        if st.get("parts"):
            parts = st["parts"]
            self.emit("step", f"3/8 outline reused ({len(parts)} parts)")
        else:
            self.emit("step", f"3/8 outlining {n_parts} parts")
            cast_names = ", ".join([p["name"] for p in participants] + [nm for nm, _ in unknown])
            plan = self.ask_json(P.outline_prompt(n_parts, account, cast_names, hints), 2200, role="reader")
            parts = [p for p in (plan.get("parts") if isinstance(plan, dict) else plan) or []
                     if isinstance(p, dict) and p.get("heading")]
            if not parts:
                raise ValueError("the model returned no outline parts")
            if len(parts) != n_parts:
                self.notes.append(f"outline came back with {len(parts)} parts (asked for {n_parts})")
            self._save(parts=parts)

        # ---------- deterministic: locations + characters on file ----------
        if "filed" in st:
            participants, loc = st["filed"]["participants"], st["filed"]["loc"]
            self.emit("step", "4/8 locations and characters already filed (reused)")
        else:
            participants, loc = self._file_stubs(st, facts, loc, loc_name, locs, unknown, stubs, participants,
                                                 handles, event_id, world)

        # ---------- writer model: the story, part by part ----------
        body: list[str] = list(st.get("body") or [])
        prev_tail, short = "", []
        if body:
            last = body[-1].split("\n", 1)[-1]
            paras = [p for p in last.split("\n\n") if p.strip() and not p.lstrip().startswith("*")]
            prev_tail = (paras[-1] if paras else last)[-400:]
        for i, part in enumerate(parts, 1):
            if i <= len(body):
                continue                 # written by the earlier run
            aside = (i % 6) != 4          # ~1 part in 6 runs clean (guide §5)
            self.emit("step", f"5/8 writing part {i}/{len(parts)} — {part['heading']}")
            ahead = " | ".join(str(p.get("beats") or p["heading"]) for p in parts[i:])
            text = self.ask(P.part_prompt(i, len(parts), part, prev_tail, account, aside, ahead, hints[:800]),
                            1100, role="writer")
            text = self._clean_part(text)
            if words(text) < P.PART_MIN:
                self.emit("step", f"part {i} is {words(text)} words — asking for the full length")
                longer = self._clean_part(self.ask(P.expand_prompt(text, words(text)), 1100, role="writer"))
                if words(longer) > words(text):
                    text = longer
            if words(text) < P.PART_MIN:
                short.append(f"{i} ({words(text)}w)")
            body.append(f"## {part['heading'].strip()}\n\n{text}")
            self._save(body=body)
            paras = [p for p in text.split("\n\n") if p.strip() and not p.lstrip().startswith("*")]
            prev_tail = (paras[-1] if paras else text)[-400:]
        return self._finish(st, facts, parts, body, short, participants, loc, loc_name, world, tc, window,
                            later, y, m, d, event_id, hints, handles)

    def _file_stubs(self, st, facts, loc, loc_name, locs, unknown, stubs, participants, handles, event_id, world):
        store = self.store
        self.emit("step", "4/8 filing locations and characters")
        new_locs = list(facts.get("newLocations") or [])
        place = re.split(r"[,(;]| - | — ", loc_name)[0].strip()   # the stub is the place, not "X, the dock"
        if place and not loc and not any(norm(s.get("name")) == norm(place) for s in new_locs):
            new_locs.insert(0, {"name": place, "type": "Location", "summary": ""})
        new_loc_ids = []
        for spec in new_locs:
            nm = str(spec.get("name") or "").strip()
            if not nm or self._resolve(nm, locs) or handle_hits(nm, handles):
                continue
            rid = store.unique_id("locations", slug(nm))
            rec = {"id": rid, "name": nm, "type": spec.get("type") or "Location",
                   "region": spec.get("region") or "", "controllingFaction": "", "population": "",
                   "climate": "", "status": "Filed from a single session account; details unverified.",
                   "summary": scrub_handles(str(spec.get("summary") or ""), handles),
                   "description": "", "notableFeatures": [], "relatedArticles": [event_id]}
            store.upsert("locations", rec, store.pick_shard("locations", world))
            new_loc_ids.append(rid)
            locs[norm(nm)] = rec
            if norm(nm) in (norm(loc_name), norm(place)):
                loc = rec
        if new_loc_ids:
            self.notes.append(f"new location stubs: {', '.join(new_loc_ids)} — flesh out by hand or ask the desk")
        for nm, role in unknown:
            s = stubs.get(norm(nm), {})
            rid = store.unique_id("characters", slug(nm))
            rec = {"id": rid, "name": nm, "title": s.get("title") or nm, "type": "Character",
                   "race": s.get("race") or "", "status": "First filed from one session account.",
                   "affiliation": s.get("affiliation") or "", "image": "", "imageCaption": "",
                   "summary": scrub_handles(str(s.get("summary") or role), handles), "description": "",
                   "relatedArticles": [event_id]}
            store.upsert("characters", rec, store.pick_shard("characters", world))
            participants.append({"id": rid, "name": nm, "role": role})
            self.notes.append(f"new character stub: {rid}")
        self.manual.append("XP awards: not filed by the desk — add rows to the ledger by hand (xpAwards is empty)")
        self._save(filed={"participants": participants, "loc": loc})
        return participants, loc

    def _finish(self, st, facts, parts, body, short, participants, loc, loc_name, world, tc, window,
                later, y, m, d, event_id, hints, handles) -> dict[str, Any]:
        store = self.store
        if short:
            self.notes.append(f"parts under {P.PART_MIN} words after one retry: {', '.join(short)}")
        opener = f"*Filed from a session account. {window}*"
        description = opener + "\n\n" + "\n\n".join(body)
        total = words(description)
        self.notes.append(f"story length: {total} words in {len(parts)} parts (guide: ~4,500-6,500 for a "
                          "standard event; a short session makes a short filing)")

        # ---------- json model: apparatus ----------
        self.emit("step", "6/8 summary, aftermath and Waluigi's verdict")
        plan_text = "\n".join(f"{i}. {p['heading']}: {p.get('beats')}" for i, p in enumerate(parts, 1))
        # The whole arc, not the opening: the DK run's summary only covered its first scene.
        ending = body[-1].split("\n", 1)[-1][-1600:] if body else ""
        meta = st.get("meta")
        if not meta:
            try:
                meta = self.ask_json(
                    P.APPARATUS + " The summary, outcome and verdict cover the WHOLE session from its first beat "
                    "to its last — above all how it ends.\n"
                    + (f"The filer's framing: {hints[:600]}\n" if hints else "")
                    + f"\nPLAN (every part, in order):\n{plan_text}\n\nHOW THE ARTICLE ENDS:\n{ending}",
                    2600, fallback_role="writer")
            except ValueError as error:
                # Never throw away a written story over its summary: file with placeholders.
                self.emit("step", f"apparatus failed on both models ({error}) — filing with placeholders")
                meta = self._placeholder_meta(facts, parts)
                self.manual.append("summary, outcome, status, aftermath and Waluigi's verdict are PLACEHOLDERS "
                                   "(the model's JSON failed) — use Edit this event to write them")
            self._save(meta=meta)
        related = []
        for rid in [p["id"] for p in participants] + ([loc["id"]] if loc else []):
            if rid not in related:
                related.append(rid)
        event = {
            "id": event_id, "name": facts.get("name") or "Untitled session",
            "title": meta.get("title") or facts.get("name") or "",
            "date": f"{d} {MONTHS[m-1]} {y} BF", "timeCode": tc, "timeWindow": window,
            "laterDated": True if later else None,
            # one line each: the DK run came back with "political drama\n\neconomic collapse\n…"
            "era": " / ".join(self._lines(facts.get("era"))),
            "type": " / ".join(self._lines(facts.get("type"))) or "Session Transcript",
            "location": (loc.get("name") if loc else loc_name), "status": meta.get("status") or "",
            "summary": meta.get("summary") or "", "description": description,
            "outcome": meta.get("outcome") or "", "image": "", "imageCaption": meta.get("imageCaption") or "",
            "image_alt": meta.get("image_alt") or "", "notableFeatures": meta.get("notableFeatures") or [],
            "participants": participants, "keyBattles": [], "relatedArticles": related,
            "reputationChanges": {}, "effects": {}, "reputationNotes": {},
            "aftermath": meta.get("aftermath") or "", "waluigiAssessment": meta.get("waluigiAssessment") or "",
            "xpAwards": [], "gallery": [], "sections": [], "arcId": "",
        }
        if isinstance(event["waluigiAssessment"], list):
            event["waluigiAssessment"] = "\n".join(str(x) for x in event["waluigiAssessment"])
        event = self._guard(event, handles)

        self.emit("step", "7/8 filing the event, news queue and home page")
        shard = store.upsert("events", self._ordered(event), store.pick_shard("events", world, y))
        store.append_pending_news(event_id, f"Filed by the local Filing Desk: {event['name']}",
                                  time.strftime("%Y-%m-%d"))
        store.set_home(event_id, f"Latest Session · {event['name']} · {event['date']}", event["summary"],
                       event["title"], [str(t) for t in (meta.get("tags") or [])][:5])
        self.manual.append("campaignCovers / featuredArticle in mainPage.json: not changed — set by hand if this is a new campaign cover")
        self.manual.append("investigation arc: not linked — add the event to its arc file if it belongs to one")
        self.manual.append("exhibits: none filed — if the story names a document, add it to props.json and wire [[prop:id|text]]")

        self.emit("step", "8/8 build and checks")
        checks = self._check_and_fix(event_id, handles)
        return self._report("filed", event_id, shard, checks)

    @staticmethod
    def _placeholder_meta(facts: dict[str, Any], parts: list[dict[str, Any]]) -> dict[str, Any]:
        beats = [str(p.get("beats") or p.get("heading")) for p in parts]
        summary = " ".join(beats[:1] + beats[-1:])
        return {"title": facts.get("name") or "", "summary": " ".join(summary.split()[:80]),
                "outcome": " ".join(beats[-1].split()[:50]) if beats else "",
                "status": "Filed by the local desk; summary fields are placeholders awaiting an edit.",
                "aftermath": "", "waluigiAssessment": "", "imageCaption": "", "image_alt": "",
                "notableFeatures": [str(p.get("heading")) for p in parts][:8], "tags": []}

    @staticmethod
    def _lines(value: Any) -> list[str]:
        items = value if isinstance(value, list) else re.split(r"\n+|\s*/\s*|;\s*", str(value or ""))
        return [s.strip(" -•,") for s in map(str, items) if s.strip(" -•,")]

    @staticmethod
    def _clean_part(text: str) -> str:
        text = re.sub(r"</?div[^>]*>", "", str(text or ""))
        text = re.sub(r"(?m)^#{1,6} .*\n+", "", text, count=1) if text.lstrip().startswith("#") else text
        # a model that repeats the heading as a bold line ("**The Voicemail Scam**")
        text = re.sub(r"^\s*\*\*[^*\n]{1,90}\*\*\s*\n+", "", text)
        return text.strip()

    # ---- editing an existing event ----
    def edit_event(self, event_id: str, instruction: str) -> dict[str, Any]:
        rec = self.store.get("events", event_id)
        if not rec:
            raise ValueError(f"no event with id {event_id!r}")
        handles = speaker_handles("", set(), self.store.root)
        # The story never travels whole (it can be 30k+ chars): the model sees the part
        # headings, picks the parts to rewrite, and each part is rewritten on its own.
        desc = str(rec.get("description") or "")
        pieces = re.split(r"(?m)^(?=## )", desc)
        opener, parts = (pieces[0], pieces[1:]) if pieces and not pieces[0].startswith("## ") else ("", pieces)
        view = {k: rec.get(k) for k in PROSE_KEYS if k in rec and k != "description"}
        view["storyParts"] = [f"{i}. {p.splitlines()[0][3:].strip()} — {words(p)} words"
                              for i, p in enumerate(parts, 1)]
        self.emit("step", "1/3 deciding what the change touches")
        patch = self.ask_json(
            "Here is an archive event: its short prose fields, and the numbered list of its story parts. "
            "Apply the editor's instruction. Return JSON {\"fields\": {only the short fields you changed, each "
            "with its full new value}, \"rewriteParts\": [numbers of story parts that must be rewritten], "
            "\"partNote\": what to change in those parts}. rewriteParts stays [] unless the instruction is "
            "about the story text itself — a change to the summary, outcome, title, aftermath or verdict "
            "touches only that field. Keep every fact you were not told to change.\n\n"
            "INSTRUCTION: " + instruction + "\n\nEVENT:\n" + json.dumps(view, ensure_ascii=False)[:9000], 2500)
        if not isinstance(patch, dict):
            raise ValueError("the model did not return a field patch")
        fields = patch.get("fields") if isinstance(patch.get("fields"), dict) else {}
        changed = [k for k in fields if k in PROSE_KEYS and k != "description" and fields[k] != rec.get(k)]
        refused = [k for k in fields if k not in PROSE_KEYS or k == "description"]
        if refused:
            self.notes.append(f"ignored fields the model may not set directly: {', '.join(refused)}")
        for k in changed:
            rec[k] = fields[k]
        todo = sorted({int(n) for n in patch.get("rewriteParts") or [] if str(n).isdigit() and 1 <= int(n) <= len(parts)})
        note = str(patch.get("partNote") or instruction)
        for n in todo:
            head, _, text = parts[n - 1].partition("\n")
            # plates wired into the part stay put: the model never sees (or drops) them
            plates = re.findall(r"(?m)^!\[[^\]]*\]\([^)]+\)\s*$", text)
            text = re.sub(r"(?m)^!\[[^\]]*\]\([^)]+\)\s*\n?", "", text).strip()
            self.emit("step", f"2/3 rewriting part {n} — {head[3:].strip()}")
            new = self._clean_part(self.ask(
                # Only this part's change: the whole instruction made other edits bleed in.
                f"Rewrite this part of an archive article. Change ONLY this: {note}\n"
                "Add nothing else — no new facts, people, legends or explanations.\n"
                f"Keep its length ({words(text)} words, never under {P.PART_MIN}), its quoted lines and every "
                f"fact you were not told to change. Return only the part, without its heading.\n\n{text}",
                1400, role="writer"))
            if words(new) < min(P.PART_MIN, words(text) * 0.6):
                self.notes.append(f"part {n}: rewrite came back too short ({words(new)}w) — kept the old text")
                continue
            if plates:
                first, sep, rest = new.partition("\n\n")
                new = first + "\n\n" + "\n\n".join(p.strip() for p in plates) + ("\n\n" + rest if sep else "")
            parts[n - 1] = f"{head}\n\n{new}\n\n"
            changed.append(f"description part {n}")
        if not changed:
            return self._report("unchanged", event_id, self.store.shard_of("events", event_id), [])
        if todo:
            rec["description"] = (opener + "".join(parts)).rstrip() + "\n" if desc.endswith("\n") else (opener + "".join(parts)).rstrip()
        rec = self._guard(rec, handles)
        self.emit("step", f"2/3 writing {', '.join(changed)}")
        shard = self.store.upsert("events", rec)
        self.notes.append(f"changed fields: {', '.join(changed)}")
        self.emit("step", "3/3 build and checks")
        checks = self._check_and_fix(event_id, handles)
        return self._report("edited", event_id, shard, checks)

    # ---- guards, checks, report ----
    def _guard(self, event: dict[str, Any], handles: set[str]) -> dict[str, Any]:
        """Rule zero and banned words: one model rewrite, then a hard scrub of handles."""
        # The story (description) never goes back through the model here: a short-context
        # model would hand it back truncated. Handles in it are scrubbed in code below.
        short_keys = [k for k in PROSE_KEYS if k != "description"]
        for k in short_keys:
            event[k] = self._text(event.get(k), keep_list=(k == "notableFeatures"))
        blob = json.dumps({k: event.get(k) for k in short_keys}, ensure_ascii=False)
        hits = handle_hits(blob, handles)
        if hits:
            self.emit("step", f"guard: rewriting to drop {', '.join(hits)}")
            try:
                fixed = self.ask_json(
                    "Rewrite these fields so they never mention " + ", ".join(hits) +
                    " (player or GM names: use in-world roles). Return JSON with the same keys.\n\n"
                    + blob[:9000], 3000)
                for k, v in (fixed.items() if isinstance(fixed, dict) else []):
                    if k in short_keys and v:
                        event[k] = v
            except ValueError:
                pass
        for k in PROSE_KEYS:
            if isinstance(event.get(k), str):
                event[k] = scrub_handles(event[k], handles)
            elif isinstance(event.get(k), list):
                event[k] = [scrub_handles(v, handles) if isinstance(v, str) else v for v in event[k]]
        # The banned-word rule is for story prose (STORY_FORMAT_GUIDE §2A): the description.
        left = banned_word_hits(str(event.get("description") or ""))
        if left:
            self.notes.append(f"banned words in the story (fine only inside quotes — check): {', '.join(left)}")
        return event

    @staticmethod
    def _text(value: Any, keep_list: bool = False) -> Any:
        """Models return objects where the site wants a string: flatten {findings, recommendation}
        and lists into readable text (notableFeatures stays a list of strings)."""
        if keep_list:
            if isinstance(value, str):
                return [s.strip("-• ").strip() for s in value.splitlines() if s.strip()]
            return [str(v) if not isinstance(v, str) else v for v in (value or [])]
        if isinstance(value, dict):
            out = []
            for k, v in value.items():
                if isinstance(v, list):
                    out += [str(x) for x in v]
                elif v:
                    out.append(f"{str(k).capitalize()}: {v}" if k.lower().startswith("recommend") else str(v))
            return "\n\n".join(out)
        if isinstance(value, list):
            return "\n\n".join(str(v) for v in value)
        return value if value is not None else ""

    @staticmethod
    def _ordered(event: dict[str, Any]) -> dict[str, Any]:
        out = {k: event[k] for k in EVENT_KEYS if k in event and event[k] is not None}
        out.update({k: v for k, v in event.items() if k not in out and v is not None})
        return out

    def _check_and_fix(self, event_id: str, handles: set[str]) -> list[tuple[str, bool, str]]:
        if not self.run_checks:
            return []
        report = lambda args, ok, tail: self.emit("check", f"{'PASS' if ok else 'FAIL'}  {args}")
        results = self.store.build_and_check(on_step=report)
        failed = [r for r in results if not r[1]]
        if failed and not failed[0][0].startswith("build-json-stores"):
            rec = self.store.get("events", event_id)
            self.emit("step", "a check failed — asking the model to repair the prose once")
            try:
                patch = self.ask_json(
                    "These archive checks failed after filing an event. If the failure is in the event's prose "
                    "fields, return JSON with only the corrected fields; if it is not a prose problem return {}.\n\n"
                    + "\n\n".join(f"{a}:\n{t}" for a, _, t in failed)[:5000] + "\n\nEVENT PROSE:\n"
                    + json.dumps({k: rec.get(k) for k in PROSE_KEYS if k != "description"},
                                 ensure_ascii=False)[:9000], 3000)
            except ValueError:
                patch = {}
            allowed = [k for k in PROSE_KEYS if k != "description"]
            if isinstance(patch, dict) and any(k in allowed for k in patch):
                rec.update({k: v for k, v in patch.items() if k in allowed})
                self.store.upsert("events", self._guard(rec, handles))
                results = self.store.build_and_check(on_step=report)
        return results

    def _report(self, action: str, event_id: str, shard: str | None,
                checks: list[tuple[str, bool, str]]) -> dict[str, Any]:
        failed = [c for c in checks if not c[1]]
        lines = [f"# Filing Desk run — {action} `{event_id}`", "",
                 f"**Purpose:** {action} an event with a local model.", "",
                 "**What changed:**"] + [f"- `{p}`" for p in sorted(self.store.touched)] + [
                 "", "**Verification:**"] + ([f"- {'PASS' if ok else 'FAIL'} `{a}`" for a, ok, _ in checks]
                                             or ["- checks not run"])
        for a, _, tail in failed:
            lines += ["", f"```\n{a}\n{tail}\n```"]
        lines += ["", "**Notes:**"] + [f"- {n}" for n in self.notes or ["none"]]
        lines += ["", "**Left for a person:**"] + [f"- {n}" for n in self.manual or ["nothing"]]
        return {"action": action, "id": event_id, "shard": shard, "ok": not failed,
                "touched": sorted(self.store.touched), "checks": [{"check": a, "ok": ok, "tail": t} for a, ok, t in checks],
                "notes": self.notes, "manual": self.manual, "report": "\n".join(lines)}
