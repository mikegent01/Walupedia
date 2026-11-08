"""Prompt text for the Filing Desk, condensed from docs/STORY_FORMAT_GUIDE.md.

A local model never reads the guide; it gets the few rules that apply to the one
step it is doing. When the guide changes, change these to match.
"""
from __future__ import annotations

from desk_store import BANNED_WORDS

VOICE = ("You write for Waluipedia, an in-world encyclopedia of a tabletop campaign. The narrator is "
         "Waluigi: wry, theatrical, and exact about what the account does NOT establish. Write in-world. "
         "Never name players, Discord handles or the GM; say 'the Narrator' for the GM if needed. "
         "Do not invent facts.")

# STORY_FORMAT_GUIDE §4: part 350–450 words (second look <250 / >700), 10–14 parts per standard event.
PART_MIN, PART_TARGET, PART_MAX = 250, (350, 450), 700
PARTS_MIN, PARTS_MAX = 3, 14
WORDS_PER_PART_OF_ACCOUNT = 220   # roughly how much transcript one part covers

ASIDE_RULE = ("Near the end of the part, one Waluigi aside: its own paragraph, wrapped in single asterisks, "
              "opening '*WAH!' and 40-70 words long — a joke that punctures the moment, a catch the party "
              "missed, a correction of a claim, or a tell pointing at a detail that pays off. He reacts; he "
              "never previews.")
NO_ASIDE_RULE = "This part runs clean: no Waluigi aside at all."

PART_RULES = (
    "Rules for this part (STORY_FORMAT_GUIDE):\n"
    "- {lo}-{hi} words. Paragraphs of 30-40 words (3-6 sentences).\n"
    "- Shape: one short scene-setter (the place plus one physical detail); 4-8 paragraphs of action and "
    "quoted speech with bodies, objects and sounds; the turn (the beat that costs someone something); "
    "{aside_slot}; 1-2 landing paragraphs on the consequence and the next hook.\n"
    "- Close third person. Make it physical: show the beat, do not report it. Use sensory words (cold, "
    "dust, echo, creak, smell, weight).\n"
    "- Texture (light, weather, sounds) may be added. Load-bearing facts may not: no new events, names, "
    "outcomes, owners or reasons that the account does not give.\n"
    "- The lines that carry a beat are quoted exactly as spoken.\n"
    "- Never use these words outside a quote: " + ", ".join(BANNED_WORDS) + ".\n"
    "- Markdown only: no HTML, no tables, no heading (the heading is added for you)."
)


def part_prompt(i: int, n: int, part: dict, prev_tail: str, account: str, aside: bool,
                later: str = "", hints: str = "") -> str:
    lines = "\n".join(f"- {l}" for l in part.get("lines") or []) or "- (none listed)"
    # Small models undershoot: ask for the top of the band so the result lands inside it.
    rules = PART_RULES.format(lo=380, hi=PART_TARGET[1],
                              aside_slot=ASIDE_RULE if aside else NO_ASIDE_RULE)
    return (f"Write Part {i} of {n} of the archive article, titled \"{part.get('heading')}\".\n"
            f"What happens in this part (and nothing else): {part.get('beats')}\n"
            f"Lines to keep verbatim:\n{lines}\n"
            + (f"The previous part ended: \"{prev_tail}\"\n" if prev_tail else "This is the opening part.\n")
            + (f"The filer's framing of the whole session (follow it): {hints}\n" if hints else "")
            + (f"LATER PARTS cover these beats — do NOT write them, stop before them: {later}\n" if later
               else "This is the final part: land the session's ending.\n")
            + f"\n{rules}\n- Under 350 words is too short: slow the scene down rather than skipping ahead.\n"
            f"\nTHE ACCOUNT (write only this part's beats from it):\n{account}")


def expand_prompt(text: str, words: int) -> str:
    return (f"This part of an archive article is only {words} words; the guide wants {PART_TARGET[0]}-"
            f"{PART_TARGET[1]}. Rewrite it at that length by slowing the scene down: bodies, objects, "
            "sounds and the quoted dialogue. Add no new facts, people or outcomes. Keep any '*WAH!' aside. "
            f"Return only the rewritten part.\n\n{text}")


def outline_prompt(parts: int, account: str, cast: str, hints: str) -> str:
    return ("Plan an archive article from this session account as exactly "
            f"{parts} chronological parts. JSON: {{\"parts\": [{{\"heading\": a short evocative heading, "
            "\"beats\": 2-4 sentences on what happens in this part, \"lines\": [the 1-3 spoken lines that "
            "define the part, copied verbatim with the speaker's character name]}]}. Split by scene or "
            "decision, never mid-scene. Every beat in the account belongs to exactly one part.\n"
            f"Cast: {cast}\n" + (f"Filer's hints: {hints}\n" if hints else "") + f"\nACCOUNT:\n{account}")


APPARATUS = (
    "From this article plan, write JSON with keys: \"title\" (a fuller headline), \"summary\" (40-80 "
    "words, no asides), \"outcome\" (1-2 sentences: where things stand, may be unresolved), \"status\" "
    "(one sentence: what is filed and what is unresolved), \"aftermath\" (one paragraph: standing, materiel, "
    "exposure), \"waluigiAssessment\" (Waluigi's verdict: 2-4 numbered findings then one recommendation, "
    "limited to what the account establishes), \"notableFeatures\" (5-8 one-line hooks), \"imageCaption\", "
    "\"image_alt\" (a literal description of a lead picture), \"tags\" (3-5 short strings)."
)
