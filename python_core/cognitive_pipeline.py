#!/usr/bin/env python3
"""
ZYRQUEN Native Cognitive Pipeline (Pure Python 3.11 Standard Library)
---------------------------------------------------------------------
Implements the generalizable native cognitive cycle:
    Understand -> Reason -> Evaluate -> Respond -> Learn

Design guarantees:
- Zero external LLMs and zero pretrained external model weights.
- Zero hardcoded per-emoji or per-question canned lookup replies.
- Uses general Unicode character decomposition (unicodedata), lexical/structural
  plausibility analysis, conversational/episodic memory, and Knowledge Graph
  neighborhood probing.
- Explicitly separates epistemic states:
    UNKNOWN | UNCERTAIN | NOT_LEARNED | UNABLE_TO_INFER
- Never mutates neural model weights autonomously (model_weights_changed=False).
"""

from __future__ import annotations

import collections
import json
import re
import sqlite3
import time
import unicodedata
import uuid
from typing import Any


EPISTEMIC_STATES = (
    "VERIFIED",
    "UNCERTAIN",
    "NOT_LEARNED",
    "UNABLE_TO_INFER",
    "UNKNOWN",
    "BLOCKED",
    "PENDING_APPROVAL",
    "FAILED",
)

# General Unicode descriptor semantic axes (derived from official Unicode character names)
_AFFECT_AXIS_KEYWORDS: dict[str, set[str]] = {
    "joy_amusement": {
        "JOY", "LAUGH", "LAUGHING", "TEARS", "GRIN", "GRINNING", "SMILE",
        "SMILING", "CHUCKLE", "WINK", "WINKING", "ROFL", "ROLLING", "FLOOR",
        "SLIGHTLY", "BEAMING", "GLEE",
    },
    "sadness_concern": {
        "CRY", "CRYING", "SAD", "FROWNING", "PENSIVE", "DISAPPOINTED",
        "WORRIED", "WEARY", "TIRED", "SOB", "BROKEN", "PLEADING", "ANGUISHED",
        "DOWNCAST", "PERSEVERING", "CONFOUNDED",
    },
    "anger_frustration": {
        "ANGRY", "POUTING", "RAGE", "STEAM", "UNAMUSED", "SYMBOLS", "SWEARING",
        "EXPRESSIONLESS",
    },
    "curiosity_thinking": {
        "THINKING", "MONOCLE", "QUESTION", "CONFUSED", "RAISED", "EYEBROW",
        "MAGNIFYING", "SEARCH", "INSPECT",
    },
    "celebration_excitement": {
        "PARTY", "POPPER", "CONFETTI", "SPARKLES", "STAR", "FIRE", "CLAPPING",
        "TROPHY", "MEDAL", "FIREWORKS", "BALLOON", "CHEERS", "ROCKET",
    },
    "affection_support": {
        "HEART", "LOVE", "HUGGING", "KISS", "THUMBS", "CLAP", "FOLDED",
        "HANDS", "HUG", "SUPPORT", "WARM", "STAR-STRUCK",
    },
    "surprise_shock": {
        "EXPLODING", "ASTONISHED", "FLUSHED", "FEARFUL", "SCREAMING", "OPEN",
        "EXCLAMATION", "HUSHED", "DIZZY", "GASP",
    },
}

_THAI_INTERROGATIVE_CUES = (
    "คืออะไร", "ทำงานอย่างไร", "เกิดขึ้นได้อย่างไร", "ได้อย่างไร",
    "คือ", "อะไร", "อย่างไร", "ยังไง", "ทำไม", "ที่ไหน", "เมื่อไร",
    "เมื่อไหร่", "ใคร", "เท่าไร", "เท่าไหร่", "กี่", "หรือไม่", "หรือเปล่า",
    "หมายถึง", "อธิบาย", "ช่วยอธิบาย", "เล่าเรื่อง", "บอกเกี่ยวกับ",
)

_EN_INTERROGATIVE_CUES = (
    "what", "why", "how", "who", "whom", "where", "when", "which",
    "explain", "describe", "define", "tell me about",
)

_AMBIGUOUS_FRAGMENTS_TH = {
    "อืม", "อือ", "เอ่อ", "โอเค", "ok", "okay", "hmm", "hm", "uh", "um",
    "ช่วยหน่อย", "ช่วยด้วย", "ทำไงดี", "ทำยังไงดี", "ยังไงดี", "ยังไงนะ",
    "แล้วไงต่อ", "เรื่องนั้น", "อันนั้น", "สิ่งนั้น", "แบบนั้น", "ว่าไง",
    "งง", "งงเลย", "จริงหรอ", "จริงเหรอ", "สวัสดี", "สวัสดีครับ", "สวัสดีค่ะ",
    "หวัดดี", "ทักทาย", "hello", "hi", "hey", "yo", "sup", "help",
}

_VOWELS = set("aeiouy")


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _analyze_unicode_semantics(text: str) -> dict[str, Any]:
    """
    Analyze arbitrary Unicode symbols/characters via stdlib unicodedata decomposition.
    Zero per-emoji canned response lookup: composes affective axes directly from
    official Unicode character categories and name descriptors.
    """
    axis_scores: dict[str, int] = collections.Counter()
    symbol_descriptors: list[str] = []
    symbol_count = 0
    thai_chars = 0
    latin_chars = 0
    digit_chars = 0
    punct_chars = 0
    other_letters = 0

    for ch in text:
        if ch.isspace():
            continue
        cat = unicodedata.category(ch)
        code = ord(ch)

        if 0x0E00 <= code <= 0x0E7F:
            thai_chars += 1
            continue
        if ("a" <= ch <= "z") or ("A" <= ch <= "Z"):
            latin_chars += 1
            continue
        if cat.startswith("N"):
            digit_chars += 1
            continue
        if cat in ("Cf", "Mn", "Sk"):
            # Variation selectors / skin-tone modifiers / joiners are modifiers, not standalone noise
            continue

        uname = unicodedata.name(ch, "")
        is_expressive_symbol = (
            cat in ("So", "Sm")
            or 0x1F000 <= code <= 0x1FAFF
            or 0x2600 <= code <= 0x27BF
            or ("QUESTION" in uname and cat == "Po" and code > 0x00FF)
            or ("EXCLAMATION" in uname and cat == "Po" and code > 0x00FF)
        )
        if is_expressive_symbol:
            symbol_count += 1
            if uname:
                symbol_descriptors.append(uname)
                name_tokens = {tok for tok in re.split(r"[\s\-]+", uname.upper()) if tok}
                for axis, keywords in _AFFECT_AXIS_KEYWORDS.items():
                    hits = len(name_tokens & keywords)
                    if hits:
                        axis_scores[axis] += hits
            continue

        if cat.startswith("P"):
            punct_chars += 1
        elif cat.startswith("L"):
            other_letters += 1

    total_alpha = thai_chars + latin_chars + other_letters
    dominant_axis = None
    if axis_scores:
        dominant_axis = max(axis_scores.items(), key=lambda kv: kv[1])[0]

    # Secondary disambiguation for combined joy+tears vs sadness+tears:
    # "FACE WITH TEARS OF JOY" has JOY + TEARS -> joy_amusement ties or beats sadness.
    if axis_scores.get("joy_amusement", 0) > 0 and axis_scores.get("sadness_concern", 0) > 0:
        if any("JOY" in d or "LAUGH" in d or "ROFL" in d for d in symbol_descriptors):
            dominant_axis = "joy_amusement"

    return {
        "symbol_count": symbol_count,
        "symbol_descriptors": symbol_descriptors[:8],
        "axis_scores": dict(axis_scores),
        "dominant_axis": dominant_axis,
        "has_facial_cue": any("FACE" in d or "HEAD" in d or "EYES" in d for d in symbol_descriptors),
        "thai_chars": thai_chars,
        "latin_chars": latin_chars,
        "digit_chars": digit_chars,
        "punct_chars": punct_chars,
        "other_letters": other_letters,
        "total_alpha": total_alpha,
    }


def _is_plausible_latin_word(word: str) -> bool:
    w = word.lower()
    if len(w) <= 1:
        return True
    if len(w) <= 4:
        # Short acronyms (API, SQL, CPU, HTTP) or common short words
        return not bool(re.search(r"(.)\1{3,}", w))
    # Reject repeating char runs >= 4
    if re.search(r"(.)\1{3,}", w):
        return False
    # Reject 5+ consecutive consonants without vowels (classic keyboard smash / gibberish e.g. asdfqwerzxcv)
    if re.search(r"[^aeiouy]{5,}", w):
        return False
    vowel_count = sum(1 for c in w if c in _VOWELS)
    if vowel_count == 0:
        return False
    vowel_ratio = vowel_count / len(w)
    if len(w) >= 8 and vowel_ratio < 0.16:
        return False
    return True


def _is_plausible_thai_span(span: str) -> bool:
    if len(span) < 2:
        return False
    if re.search(r"(.)\1{3,}", span):
        return False
    has_consonant = any(0x0E01 <= ord(c) <= 0x0E2E for c in span)
    if not has_consonant:
        return False
    # Excessive non-consonant marks without enough consonants indicates corrupted noise
    consonants = sum(1 for c in span if 0x0E01 <= ord(c) <= 0x0E2E)
    if len(span) >= 6 and consonants < len(span) * 0.3:
        return False
    return True


def _detect_opaque_noise(
    text: str,
    unicode_sem: dict[str, Any],
    *,
    kg_matched_any: bool = False,
) -> tuple[bool, str | None]:
    stripped = text.strip()
    if not stripped:
        return True, "empty_input"

    # Expressive Unicode symbols carry interpretable affective/symbolic signal
    if unicode_sem["symbol_count"] > 0:
        return False, None

    if unicode_sem["total_alpha"] == 0 and unicode_sem["digit_chars"] == 0:
        return True, "punctuation_or_symbol_noise"

    if kg_matched_any:
        return False, None

    latin_words = re.findall(r"[A-Za-z]+", stripped)
    thai_spans = re.findall(r"[\u0E00-\u0E7F]+", stripped)

    if thai_spans:
        if not any(_is_plausible_thai_span(sp) for sp in thai_spans) and not latin_words:
            return True, "implausible_thai_noise"

    if latin_words and not thai_spans:
        plausible_count = sum(1 for w in latin_words if _is_plausible_latin_word(w))
        if plausible_count == 0:
            return True, "implausible_latin_noise"
        # Mixed gibberish tokens dominating a multi-word ASCII string
        if len(latin_words) >= 2 and plausible_count / len(latin_words) < 0.4:
            return True, "mostly_implausible_tokens"

    if (
        unicode_sem["thai_chars"] == 0
        and unicode_sem["latin_chars"] == 0
        and unicode_sem["other_letters"] == 0
        and unicode_sem["digit_chars"] > 0
        and unicode_sem["punct_chars"] > 0
    ):
        # e.g. "123???@@@" without operators or words
        if not re.search(r"[+\-*/^=]", stripped):
            return True, "unstructured_digits_and_punctuation"

    return False, None


def _extract_topic_focus(prompt: str, query_terms: list[str]) -> str:
    cleaned = prompt.strip()
    for pat in (
        r"^(?:explain|describe|define|tell me about|what is|who is|how does|where is)\s+",
        r"^(?:ช่วยอธิบาย|อธิบาย|เล่าเรื่อง|บอกเกี่ยวกับ)\s*",
    ):
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE).strip()
    for suf in (
        "คืออะไร", "ทำงานอย่างไร", "เกิดขึ้นได้อย่างไร", "ได้อย่างไร",
        "หมายถึงอะไร", "อยู่ที่ไหน", "อย่างไร", "ยังไง", "?", "ครับ", "ค่ะ",
    ):
        if cleaned.endswith(suf) and len(cleaned) > len(suf) + 1:
            cleaned = cleaned[: -len(suf)].strip()
    if 2 <= len(cleaned) <= 72:
        return cleaned
    if query_terms:
        return ", ".join(query_terms[:3])
    return prompt.strip()[:60]


def understand_input(
    conn: sqlite3.Connection,
    prompt: str,
    *,
    attachment: str = "",
    mode: str = "auto",
    conversation_id: str | None = None,
    tokenize_fn=None,
    extract_terms_fn=None,
    query_kg_fn=None,
) -> dict[str, Any]:
    """
    Stage 1 (Understand): Parse linguistic cues, speech act, Unicode semantics,
    conversational context, episodic memory, and Knowledge Graph neighborhood clues.
    """
    norm_prompt = prompt.strip()
    unicode_sem = _analyze_unicode_semantics(norm_prompt)
    tokens = tokenize_fn(norm_prompt) if tokenize_fn else re.findall(r"\w+", norm_prompt.lower())
    query_terms = extract_terms_fn(norm_prompt) if extract_terms_fn else list(dict.fromkeys(tokens))

    # Conversational context (prior user/assistant turns in same conversation)
    recent_turns: list[dict[str, str]] = []
    if conversation_id:
        try:
            rows = conn.execute(
                """
                SELECT role, content, status
                FROM messages
                WHERE conversation_id=?
                ORDER BY created_at DESC
                LIMIT 4
                """,
                (str(conversation_id),),
            ).fetchall()
            recent_turns = [
                {
                    "role": str(r["role"]),
                    "content": str(r["content"])[:140],
                    "status": str(r["status"]),
                }
                for r in reversed(rows)
            ]
        except sqlite3.Error:
            recent_turns = []

    # Episodic experience lookup
    episodic_hits: list[dict[str, Any]] = []
    if query_terms:
        try:
            ep_rows = conn.execute(
                """
                SELECT id, goal, outcome_status, gap_type, hypothesis_json, created_at
                FROM episodic_experiences
                ORDER BY created_at DESC
                LIMIT 40
                """
            ).fetchall()
            q_set = {t.lower() for t in query_terms}
            for er in ep_rows:
                g_l = str(er["goal"] or "").lower()
                overlap = [t for t in q_set if len(t) >= 2 and t in g_l]
                if overlap:
                    episodic_hits.append(
                        {
                            "id": er["id"],
                            "goal": str(er["goal"])[:100],
                            "outcome_status": er["outcome_status"],
                            "gap_type": er["gap_type"],
                            "overlap_terms": overlap[:4],
                        }
                    )
                if len(episodic_hits) >= 3:
                    break
        except sqlite3.Error:
            episodic_hits = []

    # Analogical KG neighborhood probe (weak partial signal when direct match misses)
    kg_related: list[dict[str, str]] = []
    if query_terms:
        try:
            all_triples = conn.execute(
                "SELECT subject, relation, object, source FROM knowledge_triples LIMIT 250"
            ).fetchall()
            for tr in all_triples:
                subj_l = str(tr["subject"]).lower()
                obj_l = str(tr["object"]).lower()
                for qt in query_terms:
                    if len(qt) >= 3 and (qt in subj_l or qt in obj_l or subj_l in qt):
                        kg_related.append(
                            {
                                "subject": str(tr["subject"]),
                                "relation": str(tr["relation"]),
                                "object": str(tr["object"]),
                                "matched_term": qt,
                            }
                        )
                        break
                if len(kg_related) >= 3:
                    break
        except sqlite3.Error:
            kg_related = []

    is_opaque, opaque_reason = _detect_opaque_noise(
        norm_prompt,
        unicode_sem,
        kg_matched_any=bool(kg_related),
    )

    lower_p = norm_prompt.lower()
    has_thai_q = any(cue in lower_p for cue in _THAI_INTERROGATIVE_CUES)
    has_en_q = any(
        re.search(rf"\b{re.escape(cue)}\b", lower_p) for cue in _EN_INTERROGATIVE_CUES
    )
    has_q_mark = "?" in norm_prompt

    is_conditional = bool(
        re.search(r"(?:^|\s)(?:ถ้า|หาก|ทุก|ไม่มี|if\b|all\b)", lower_p)
    )

    if is_opaque:
        speech_act = "opaque_noise"
    elif unicode_sem["symbol_count"] > 0 and unicode_sem["total_alpha"] == 0 and unicode_sem["digit_chars"] == 0:
        speech_act = "affective_expression"
    elif lower_p in _AMBIGUOUS_FRAGMENTS_TH or (
        unicode_sem["symbol_count"] > 0 and len(query_terms) <= 1 and not (has_thai_q or has_en_q)
    ):
        speech_act = "ambiguous_fragment"
    elif is_conditional and (has_thai_q or has_q_mark or "แล้ว" in lower_p or "ดังนั้น" in lower_p):
        speech_act = "conditional_or_logic"
    elif has_thai_q or has_en_q or has_q_mark:
        speech_act = "conceptual_question"
    elif len(query_terms) <= 1 and len(norm_prompt) <= 10 and not attachment:
        # Very short single-word/fragment without clear question or known entity
        # (unless model checkpoint explicitly requested in model_version policy tests)
        speech_act = "ambiguous_fragment" if mode == "auto" and not any(c.isdigit() for c in norm_prompt) and unicode_sem["symbol_count"] > 0 else "general_utterance"
    else:
        speech_act = "general_utterance"

    topic_focus = _extract_topic_focus(norm_prompt, query_terms)
    language = (
        "symbolic"
        if unicode_sem["symbol_count"] > 0 and unicode_sem["total_alpha"] == 0
        else ("thai" if unicode_sem["thai_chars"] >= unicode_sem["latin_chars"] and unicode_sem["thai_chars"] > 0 else ("english" if unicode_sem["latin_chars"] > 0 else "unknown"))
    )

    return {
        "prompt": norm_prompt,
        "mode": mode,
        "language": language,
        "speech_act": speech_act,
        "topic_focus": topic_focus,
        "tokens": tokens[:24],
        "query_terms": query_terms[:12],
        "unicode_semantics": unicode_sem,
        "opaque_reason": opaque_reason,
        "recent_turns": recent_turns,
        "episodic_hits": episodic_hits,
        "kg_related": kg_related,
        "has_attachment": bool(attachment),
    }


def _describe_affective_state(unicode_sem: dict[str, Any], language: str) -> tuple[str, str]:
    """Generate a grounded natural summary of Unicode affective cues from general axes."""
    axis = unicode_sem.get("dominant_axis")
    descriptors = unicode_sem.get("symbol_descriptors") or []
    is_en = language == "english"

    if axis == "joy_amusement":
        return (
            "อารมณ์ขัน ความสนุก หรือความรู้สึกดีใจ",
            "amusement, laughter, or a positive mood",
        ) if is_en else (
            "อารมณ์ขัน ความขบขัน หรือความรู้สึกยินดี",
            "amusement or positive joy",
        )
    if axis == "sadness_concern":
        return (
            "ความรู้สึกเศร้า กังวล หรือไม่สบายใจ",
            "sadness, concern, or distress",
        )
    if axis == "anger_frustration":
        return (
            "ความรู้สึกหงุดหงิด โกรธ หรือไม่พอใจ",
            "frustration or anger",
        )
    if axis == "curiosity_thinking":
        return (
            "ความสงสัย กำลังครุ่นคิด หรือมีคำถามในใจ",
            "thoughtfulness, curiosity, or a question",
        )
    if axis == "celebration_excitement":
        return (
            "ความตื่นเต้น การแสดงความยินดี หรือพลังงานเชิงบวก",
            "celebration or excitement",
        )
    if axis == "affection_support":
        return (
            "ความรู้สึกดี การสนับสนุน หรือความเห็นด้วย",
            "appreciation, warmth, or agreement",
        )
    if axis == "surprise_shock":
        return (
            "ความประหลาดใจ หรือตกใจกับบางเรื่อง",
            "surprise or astonishment",
        )
    if descriptors:
        cleaned_desc = descriptors[0].lower().replace("_", " ")
        return (
            f"สัญลักษณ์สื่อความหมายเชิงภาพ ({cleaned_desc})",
            f"a visual symbol ({cleaned_desc})",
        )
    return ("การแสดงออกเชิงสัญลักษณ์", "a symbolic expression")


def reason_with_evidence(
    understanding: dict[str, Any],
    *,
    attempted_engines: list[str] | None = None,
    failure_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Stage 2 (Reason): Synthesize pragmatic, contextual, analogical, or premise-gap
    reasoning without equating lookup misses to inability to think.
    """
    speech_act = understanding["speech_act"]
    unicode_sem = understanding["unicode_semantics"]
    failure_context = failure_context or {}
    engines = list(attempted_engines or [])

    if failure_context.get("unable_reason"):
        gap = str(failure_context["unable_reason"])
        return {
            "can_infer_conclusion": False,
            "inference_gap": gap,
            "hypothesis": failure_context.get("detail")
            or "ข้อตั้งหรือเงื่อนไขที่ให้มายังไม่เพียงพอสำหรับการสรุปผลอย่างถูกต้อง",
            "attempted_inferences": engines + ["premise_gap_analysis"],
            "clarification_needed": True,
        }

    if speech_act == "opaque_noise":
        return {
            "can_infer_conclusion": False,
            "inference_gap": "no_signal",
            "hypothesis": "ข้อความไม่มีโครงสร้างภาษา สัญลักษณ์สื่ออารมณ์ หรือความหมายที่ตีความได้",
            "attempted_inferences": engines + ["lexical_plausibility", "unicode_semantics"],
            "clarification_needed": True,
        }

    if speech_act == "affective_expression":
        th_desc, en_desc = _describe_affective_state(unicode_sem, understanding["language"])
        ctx_note = ""
        if understanding["recent_turns"]:
            last_user = next(
                (t["content"] for t in reversed(understanding["recent_turns"]) if t["role"] == "user"),
                "",
            )
            if last_user:
                ctx_note = f" (ต่อจากประเด็นก่อนหน้า: {last_user[:50]})"
        return {
            "can_infer_conclusion": False,
            "inference_gap": "affective_or_ambiguous_intent",
            "affective_summary_th": th_desc,
            "affective_summary_en": en_desc,
            "hypothesis": f"ผู้ใช้อาจกำลังสื่อถึง{th_desc}{ctx_note} แต่ยังไม่ระบุจุดประสงค์หรือคำสั่งที่ชัดเจน",
            "attempted_inferences": engines + ["unicode_affect_decomposition", "conversational_pragmatics"],
            "clarification_needed": True,
        }

    if speech_act == "ambiguous_fragment":
        prev_topic = ""
        if understanding["recent_turns"]:
            last_user = next(
                (t["content"] for t in reversed(understanding["recent_turns"]) if t["role"] == "user"),
                "",
            )
            if last_user:
                prev_topic = last_user[:60]
        return {
            "can_infer_conclusion": False,
            "inference_gap": "affective_or_ambiguous_intent",
            "previous_topic": prev_topic,
            "hypothesis": (
                f"ข้อความสั้นและยังมีบริบทไม่พอ (อาจเชื่อมโยงกับเรื่อง '{prev_topic}')"
                if prev_topic
                else "เข้าใจว่าเป็นคำทักทายหรือคำถามเกริ่นนำ แต่ยังไม่ทราบรายละเอียดเฉพาะที่ผู้ใช้ต้องการ"
            ),
            "attempted_inferences": engines + ["conversational_pragmatics", "episodic_context_lookup"],
            "clarification_needed": True,
        }

    # Conceptual question / general utterance where KG & native models had no verified facts
    kg_related = understanding.get("kg_related") or []
    episodic_hits = understanding.get("episodic_hits") or []
    topic = understanding["topic_focus"]
    analogy_hint = ""
    if kg_related:
        sample = kg_related[0]
        analogy_hint = f"พบแนวคิดใกล้เคียงเพียงบางส่วน ({sample['subject']} {sample['relation']} {sample['object']}) แต่ยังไม่ครอบคลุมคำถามนี้โดยตรง"

    return {
        "can_infer_conclusion": False,
        "inference_gap": "unlearned_knowledge",
        "topic_focus": topic,
        "analogy_hint": analogy_hint,
        "episodic_overlap_count": len(episodic_hits),
        "hypothesis": f"เข้าใจว่าผู้ใช้กำลังสอบถามเกี่ยวกับ '{topic}' แต่ระบบยังไม่ได้เรียนรู้ข้อมูลยืนยันในหัวข้อนี้",
        "attempted_inferences": engines + ["linguistic_intent_parse", "kg_analogical_probe", "episodic_context_lookup"],
        "clarification_needed": False,
    }


def evaluate_cognition(
    understanding: dict[str, Any],
    reasoning: dict[str, Any],
    *,
    explicit_status: str | None = None,
) -> dict[str, Any]:
    """
    Stage 3 (Evaluate): Calibrate epistemic confidence and strictly separate:
    - VERIFIED
    - UNCERTAIN
    - NOT_LEARNED
    - UNABLE_TO_INFER
    - UNKNOWN
    - BLOCKED
    """
    if explicit_status in {"VERIFIED", "BLOCKED", "PENDING_APPROVAL", "FAILED"}:
        return {
            "epistemic_state": explicit_status,
            "understood": True,
            "confidence": 1.0 if explicit_status == "VERIFIED" else 0.0,
            "evidence_grounded": explicit_status == "VERIFIED",
            "contradictions_detected": explicit_status == "BLOCKED",
            "uncertainty_reason": None,
        }

    gap = reasoning.get("inference_gap")
    if explicit_status == "UNABLE_TO_INFER" or gap in {
        "missing_premise_or_rule",
        "division_by_zero",
        "underdetermined",
        "incompatible_attributes",
        "fallacy",
    }:
        return {
            "epistemic_state": "UNABLE_TO_INFER",
            "understood": True,
            "confidence": 0.15,
            "evidence_grounded": False,
            "contradictions_detected": False,
            "uncertainty_reason": reasoning.get("hypothesis"),
        }

    if gap == "no_signal":
        return {
            "epistemic_state": "UNKNOWN",
            "understood": False,
            "confidence": 0.0,
            "evidence_grounded": False,
            "contradictions_detected": False,
            "uncertainty_reason": understanding.get("opaque_reason") or "unintelligible_input",
        }

    if gap == "affective_or_ambiguous_intent":
        # Partial affective / conversational understanding -> UNCERTAIN (never fake full certainty)
        has_affect = bool(understanding["unicode_semantics"].get("dominant_axis"))
        conf = 0.52 if has_affect else 0.38
        return {
            "epistemic_state": "UNCERTAIN",
            "understood": True,
            "confidence": conf,
            "evidence_grounded": False,
            "contradictions_detected": False,
            "uncertainty_reason": reasoning.get("hypothesis"),
        }

    # Clear query/topic understood, but factual/model knowledge is absent
    return {
        "epistemic_state": "NOT_LEARNED",
        "understood": True,
        "confidence": 0.0,
        "evidence_grounded": False,
        "contradictions_detected": False,
        "uncertainty_reason": f"No verified knowledge learned for '{understanding['topic_focus']}'",
    }


def compose_honest_response(
    understanding: dict[str, Any],
    reasoning: dict[str, Any],
    evaluation: dict[str, Any],
) -> str:
    """
    Stage 4 (Respond): Generate clean, natural, honest responses tailored to the
    epistemic state without leaking internal database/checkpoint/AST plumbing.
    """
    state = evaluation["epistemic_state"]
    lang = understanding.get("language", "thai")
    is_en = lang == "english"

    if state == "UNKNOWN":
        if is_en:
            return (
                "I couldn't recognize a clear meaning from this message yet, so I don't want to guess. "
                "Could you rephrase it or add a bit more context?"
            )
        return (
            "ผมยังไม่เข้าใจความหมายของข้อความนี้ครับ จึงไม่อยากเดาคำตอบไปเอง "
            "รบกวนพิมพ์ใหม่หรืออธิบายเพิ่มเติมอีกนิดนะครับ"
        )

    if state == "UNCERTAIN":
        speech_act = understanding.get("speech_act")
        if speech_act == "affective_expression":
            th_desc = reasoning.get("affective_summary_th") or "อารมณ์หรือสัญลักษณ์บางอย่าง"
            en_desc = reasoning.get("affective_summary_en") or "an emotional or symbolic reaction"
            if is_en:
                return (
                    f"It looks like you're expressing {en_desc}, though I'm not sure yet what you'd like us to do next. "
                    f"Did something happen, or would you like help with a specific topic?"
                )
            return (
                f"ดูเหมือนคุณกำลังสื่อถึง{th_desc} แต่ผมยังไม่แน่ใจว่าคุณอยากคุยหรือให้ช่วยเรื่องอะไรต่อครับ "
                f"มีเรื่องอะไรเล่าให้ฟังหรืออยากให้ช่วยเรื่องไหน บอกได้เลยนะครับ"
            )

        prev_topic = reasoning.get("previous_topic")
        if prev_topic:
            if is_en:
                return (
                    f"I'm not quite sure what you mean here—are you referring back to \"{prev_topic}\", "
                    f"or something else? Let me know what you need."
                )
            return (
                f"ผมยังไม่แน่ใจว่าหมายถึงส่วนไหนครับ ไม่ทราบว่ากำลังพูดต่อจากเรื่อง \"{prev_topic}\" "
                f"หรือต้องการให้ช่วยเรื่องใหม่ครับ"
            )
        if is_en:
            return (
                "I hear you, though I'm not yet sure what specific help or topic you have in mind. "
                "What would you like to explore or solve together?"
            )
        return (
            "รับทราบครับ แต่ผมยังไม่แน่ใจว่าคุณต้องการให้ช่วยหรือพูดคุยเรื่องอะไรเป็นพิเศษ "
            "อยากให้ช่วยเรื่องไหนลองบอกรายละเอียดเพิ่มได้เลยครับ"
        )

    if state == "UNABLE_TO_INFER":
        reason_detail = reasoning.get("hypothesis") or "ข้อมูลหรือเงื่อนไขที่ให้มายังไม่เพียงพอที่จะสรุปผลได้"
        if is_en:
            return (
                f"I understood the problem structure, but I cannot infer a valid conclusion from the given premises: {reason_detail}"
            )
        return (
            f"ไม่สามารถอนุมานคำตอบได้จากเงื่อนไขที่ให้มาครับ: {reason_detail} "
            f"หากมีข้อมูลหรือข้อตั้งเพิ่มเติมสามารถส่งมาให้ลองวิเคราะห์ใหม่ได้นะครับ"
        )

    # NOT_LEARNED (topic understood clearly, verified knowledge absent)
    topic = understanding.get("topic_focus") or understanding["prompt"][:60]
    analogy = reasoning.get("analogy_hint")
    if is_en:
        extra = f" ({analogy})" if analogy else ""
        return (
            f"I understand you're asking about \"{topic}\", but I haven't learned verified facts on this topic yet "
            f"and won't make up an answer{extra}. If you'd like, you can share context or teach me about it."
        )
    extra_th = f"\n\n({analogy})" if analogy else ""
    return (
        f"เข้าใจว่าคุณกำลังถามเกี่ยวกับ \"{topic}\" ครับ แต่ตอนนี้ระบบยังไม่ได้เรียนรู้ข้อมูลที่ยืนยันได้ในเรื่องนี้ "
        f"จึงยังไม่สามารถตอบได้โดยไม่เดาขึ้นเอง{extra_th}\n"
        f"หากต้องการ คุณสามารถให้บริบทเพิ่มเติมหรือสอนข้อมูลเรื่องนี้ให้ผมเรียนรู้ไว้ใช้ครั้งต่อไปได้ครับ"
    )


def learn_from_experience(
    conn: sqlite3.Connection,
    understanding: dict[str, Any],
    reasoning: dict[str, Any],
    evaluation: dict[str, Any],
) -> dict[str, Any]:
    """
    Stage 5 (Learn): Persist epistemic experience to `episodic_experiences`
    without mutating model weights autonomously (model_weights_changed=False).
    """
    prompt = understanding.get("prompt", "").strip()
    state = evaluation["epistemic_state"]
    if not prompt:
        return {"recorded": False, "model_weights_changed": False}

    gap_type = str(reasoning.get("inference_gap") or state.lower())
    hypothesis_payload = {
        "speech_act": understanding.get("speech_act"),
        "epistemic_state": state,
        "confidence": evaluation.get("confidence"),
        "understood": evaluation.get("understood"),
        "topic_focus": understanding.get("topic_focus"),
        "dominant_affect": understanding.get("unicode_semantics", {}).get("dominant_axis"),
        "model_weights_changed": False,
    }
    exp_id = str(uuid.uuid4())
    try:
        # Deduplicate identical recent goal + state within last 20 rows to keep table clean
        existing = conn.execute(
            """
            SELECT id FROM episodic_experiences
            WHERE goal=? AND outcome_status=?
            ORDER BY created_at DESC LIMIT 1
            """,
            (prompt[:240], state),
        ).fetchone()
        if not existing:
            with conn:
                conn.execute(
                    """
                    INSERT INTO episodic_experiences (
                        id, mission_id, goal, outcome_status, gap_type,
                        hypothesis_json, verified_delta, created_at
                    )
                    VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        exp_id,
                        prompt[:240],
                        state,
                        gap_type,
                        json.dumps(hypothesis_payload, ensure_ascii=False),
                        0.0,
                        _now_iso(),
                    ),
                )
            return {
                "recorded": True,
                "experience_id": exp_id,
                "model_weights_changed": False,
            }
        return {
            "recorded": False,
            "deduplicated": True,
            "model_weights_changed": False,
        }
    except sqlite3.Error:
        return {"recorded": False, "model_weights_changed": False}


def run_cognitive_fallback_pipeline(
    conn: sqlite3.Connection,
    *,
    prompt: str,
    attachment: str = "",
    mode: str = "auto",
    conversation_id: str | None = None,
    attempted_engines: list[str] | None = None,
    failure_context: dict[str, Any] | None = None,
    explicit_status: str | None = None,
    tokenize_fn=None,
    extract_terms_fn=None,
    query_kg_fn=None,
) -> dict[str, Any]:
    """Execute full Understand -> Reason -> Evaluate -> Respond -> Learn cycle."""
    understanding = understand_input(
        conn,
        prompt,
        attachment=attachment,
        mode=mode,
        conversation_id=conversation_id,
        tokenize_fn=tokenize_fn,
        extract_terms_fn=extract_terms_fn,
        query_kg_fn=query_kg_fn,
    )
    reasoning = reason_with_evidence(
        understanding,
        attempted_engines=attempted_engines,
        failure_context=failure_context,
    )
    evaluation = evaluate_cognition(
        understanding,
        reasoning,
        explicit_status=explicit_status,
    )
    response_text = compose_honest_response(understanding, reasoning, evaluation)
    learning = learn_from_experience(conn, understanding, reasoning, evaluation)

    return {
        "status": evaluation["epistemic_state"],
        "epistemic_state": evaluation["epistemic_state"],
        "response": response_text,
        "pipeline_trace": {
            "understand": {
                "language": understanding["language"],
                "speech_act": understanding["speech_act"],
                "topic_focus": understanding["topic_focus"],
                "symbol_count": understanding["unicode_semantics"]["symbol_count"],
                "dominant_affect": understanding["unicode_semantics"]["dominant_axis"],
                "symbol_descriptors": understanding["unicode_semantics"]["symbol_descriptors"],
                "episodic_hits": len(understanding["episodic_hits"]),
                "kg_related_hints": len(understanding["kg_related"]),
            },
            "reason": {
                "inference_gap": reasoning["inference_gap"],
                "hypothesis": reasoning["hypothesis"],
                "attempted_inferences": reasoning["attempted_inferences"],
                "clarification_needed": reasoning["clarification_needed"],
            },
            "evaluate": evaluation,
            "respond": {
                "strategy": evaluation["epistemic_state"].lower(),
                "internal_jargon_suppressed": True,
            },
            "learn": learning,
        },
    }
