#!/usr/bin/env python3
"""
ZYRQUEN Ω∞ — P1-1 Reproducible Capability Benchmark Suite (Read-Only Core Probe)

Measures actual Native AI Core behavior against isolated temporary SQLite state
without modifying zyrquen_core, tools_engine, model architecture, or API contracts.
"""

from __future__ import annotations

import collections
import contextlib
import json
import math
import platform
import sys
import tempfile
from pathlib import Path
from typing import Any

PYTHON_CORE_DIR = Path(__file__).resolve().parent.parent
if str(PYTHON_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_CORE_DIR))

import tools_engine as te  # noqa: E402
import zyrquen_core as zc  # noqa: E402
from tests.benchmark_fixtures import (  # noqa: E402
    HELD_OUT_NEGATIVE_PROMPTS,
    SEED_TRIPLES,
    TRAINING_CORPUS_LINES,
    verify_fixture_isolation,
)


@contextlib.contextmanager
def isolated_core_env():
    """Run all database/checkpoint state strictly inside a fresh temporary directory."""
    orig_data = zc.DATA_DIR
    orig_ckpt = zc.CHECKPOINT_DIR
    orig_db = zc.DB_PATH
    with tempfile.TemporaryDirectory(prefix="zyrquen_p1_bench_") as tmp:
        tmp_path = Path(tmp)
        zc.DATA_DIR = tmp_path
        zc.CHECKPOINT_DIR = tmp_path / "checkpoints"
        zc.DB_PATH = tmp_path / "zyrquen_benchmark.db"
        zc.init_db()
        try:
            yield tmp_path
        finally:
            zc.DATA_DIR = orig_data
            zc.CHECKPOINT_DIR = orig_ckpt
            zc.DB_PATH = orig_db


def _seed_isolated_state(user_id: str = "p1-bench-user") -> dict[str, Any]:
    """Populate isolated SQLite KG + Dataset + N-Gram Checkpoint v1."""
    for subj, rel, obj in SEED_TRIPLES:
        zc.handle_infer({
            "prompt": f"สอน: {subj} -> {rel} -> {obj}",
            "mode": "knowledge",
            "user_id": user_id,
        })

    ds_res = zc.handle_ingest_dataset({
        "name": "p1-benchmark-corpus",
        "content": "\n".join(TRAINING_CORPUS_LINES),
        "user_id": user_id,
    })
    conn = zc.get_db()
    ckpt_res = zc.train_checkpoint_from_dataset(conn, ds_res["dataset"]["id"], user_id)
    conn.close()
    return {
        "seeded_triples": len(SEED_TRIPLES),
        "dataset": ds_res["dataset"],
        "checkpoint": ckpt_res["checkpoint"],
    }


def _record(
    cases: list[dict],
    case_id: str,
    category: str,
    prompt_or_target: str,
    passed: bool,
    expected: str,
    actual: str,
    *,
    polarity: str = "positive",
    failure_type: str | None = None,
    engine_path: list[str] | None = None,
    detail: str = "",
) -> None:
    cases.append({
        "id": case_id,
        "category": category,
        "polarity": polarity,  # "positive" | "negative" | "invariant"
        "input": prompt_or_target,
        "passed": bool(passed),
        "expected": expected,
        "actual": actual,
        "failure_type": None if passed else (failure_type or "CAPABILITY_GAP"),
        "engine_path": engine_path or [],
        "detail": detail,
    })


def run_capability_benchmark(model_version: str = "zyrquen-omega-v1") -> dict[str, Any]:
    isolation = verify_fixture_isolation()
    if not isolation["isolated"]:
        raise RuntimeError(f"Benchmark fixture leakage detected: {isolation['overlaps']}")

    cases: list[dict] = []

    with isolated_core_env():
        seed_info = _seed_isolated_state()

        def infer(prompt: str, mode: str = "auto", mv: str = model_version) -> dict:
            return zc.handle_infer({
                "prompt": prompt,
                "mode": mode,
                "user_id": "p1-bench-user",
                "model_version": mv,
            })

        # ------------------------------------------------------------------
        # 1. REASONING (Positive AST/Linear/Stats + Logic/Math Gap Probes)
        # ------------------------------------------------------------------
        reasoning_specs = [
            ("RSN-01", "คำนวณ (2^12 - 96) / 16", 250, "math"),
            ("RSN-02", "sqrt(81) + factorial(4)", 33, "math"),
            ("RSN-03", "คำนวณ 2(3 + 4) + 5", 19, "math"),
            ("RSN-04", "แก้สมการ: 3x + 7 = 22", 5, "algebra"),
            ("RSN-05", "แก้สมการ: 2(x + 3) = 2x + 6", "identity", "algebra_type"),
            ("RSN-06", "แก้สมการ: x + 2 = x + 5", "no_solution", "algebra_type"),
            ("RSN-07", "สถิติ: 10, 20, 30, 40", 25, "stats_mean"),
            ("RSN-08", "คำนวณ 10 + 20 หน่อยครับ", 30, "math"),
            ("RSN-09", "แก้สมการ: x^2 - 5x + 6 = 0", "roots(2,3)", "quadratic"),
            ("RSN-10", "แก้สมการ: x + y = 10, x - y = 2", "system(x=6,y=4)", "system"),
            ("RSN-11", "ถ้า A > B และ B > C แล้ว A เทียบกับ C เป็นอย่างไร", "A > C", "logic"),
            ("RSN-12", "ถ้ามีแอปเปิ้ล 12 ผล แบ่งให้ 3 คนเท่าๆ กัน จะได้คนละกี่ผล", 4, "word_math"),
        ]
        for cid, prompt, expected_val, kind in reasoning_specs:
            res = infer(prompt)
            trace = res["trace"]
            actual_val: Any = None
            if kind == "math":
                actual_val = trace.get("math", {}).get("result")
            elif kind == "algebra":
                actual_val = trace.get("algebra", {}).get("result")
            elif kind == "algebra_type":
                actual_val = trace.get("algebra", {}).get("solution_type")
            elif kind in ("quadratic", "system"):
                actual_val = trace.get("algebra", {}).get("summary_tag")
            elif kind == "stats_mean":
                actual_val = trace.get("statistics", {}).get("mean")
            elif kind == "logic":
                actual_val = trace.get("logic", {}).get("derived_relation")
            elif kind == "word_math":
                actual_val = trace.get("word_math", {}).get("result")
            passed = res["status"] == "VERIFIED" and actual_val == expected_val
            _record(
                cases,
                cid,
                "reasoning",
                prompt,
                passed,
                f"VERIFIED ({expected_val})",
                f"{res['status']} ({actual_val})",
                polarity="positive",
                failure_type="REASONING_CAPABILITY_GAP",
                engine_path=trace.get("engine_path", []),
                detail=res["content"][:140].replace("\n", " "),
            )

        # ------------------------------------------------------------------
        # 2. MEMORY RETRIEVAL (Direct, 2-hop, No-Space Thai, Single-Char, Synonym)
        # ------------------------------------------------------------------
        mem_direct = infer("ZYRQUEN ใช้งานอะไร")
        mem_direct_ok = (
            mem_direct["status"] == "VERIFIED"
            and any(m.get("object") == "Python Native Core" for m in mem_direct["trace"].get("matched_triples", []))
        )
        _record(
            cases, "MEM-01", "memory_retrieval", "ZYRQUEN ใช้งานอะไร", mem_direct_ok,
            "VERIFIED containing Python Native Core",
            f"{mem_direct['status']} (hits={len(mem_direct['trace'].get('matched_triples', []))})",
            polarity="positive", failure_type="FALSE_NEGATIVE_RETRIEVAL_DROP",
            engine_path=mem_direct["trace"]["engine_path"],
            detail=mem_direct["content"][:140].replace("\n", " "),
        )

        mem_2hop_ok = (
            mem_direct["status"] == "VERIFIED"
            and any(
                m.get("provenance") == "inferred_2hop" and m.get("object") == "ทีมวิจัยอัลฟ่า"
                for m in mem_direct["trace"].get("matched_triples", [])
            )
        )
        _record(
            cases, "MEM-02", "memory_retrieval", "ZYRQUEN ใช้งานอะไร [2-hop transitive]", mem_2hop_ok,
            "2-hop inferred_2hop -> ทีมวิจัยอัลฟ่า",
            f"inferred_2hop_found={mem_2hop_ok}",
            polarity="positive", failure_type="FALSE_NEGATIVE_RETRIEVAL_DROP",
            engine_path=mem_direct["trace"]["engine_path"],
        )

        mem_nospace = infer("ใครพัฒนาPython Native Core")
        mem_nospace_ok = (
            mem_nospace["status"] == "VERIFIED"
            and any(m.get("object") == "ทีมวิจัยอัลฟ่า" for m in mem_nospace["trace"].get("matched_triples", []))
        )
        _record(
            cases, "MEM-03", "memory_retrieval", "ใครพัฒนาPython Native Core", mem_nospace_ok,
            "VERIFIED containing ทีมวิจัยอัลฟ่า",
            f"{mem_nospace['status']} (hits={len(mem_nospace['trace'].get('matched_triples', []))})",
            polarity="positive", failure_type="FALSE_NEGATIVE_RETRIEVAL_DROP",
            engine_path=mem_nospace["trace"]["engine_path"],
        )

        mem_fact = infer("คาร์บอน มีเลขอะตอมเท่าไร")
        mem_fact_ok = mem_fact["status"] == "VERIFIED" and "6" in mem_fact["content"]
        _record(
            cases, "MEM-04", "memory_retrieval", "คาร์บอน มีเลขอะตอมเท่าไร", mem_fact_ok,
            "VERIFIED containing '6'",
            f"{mem_fact['status']}",
            polarity="positive", failure_type="FALSE_NEGATIVE_RETRIEVAL_DROP",
            engine_path=mem_fact["trace"]["engine_path"],
        )

        # Single-character entity edge case ("A -> มากกว่า -> B")
        mem_single = infer("A เกี่ยวข้องกับ B อย่างไร")
        mem_single_ok = (
            mem_single["status"] == "VERIFIED"
            and any(m.get("subject") == "A" and m.get("object") == "B" for m in mem_single["trace"].get("matched_triples", []))
        )
        _record(
            cases, "MEM-05", "memory_retrieval", "A เกี่ยวข้องกับ B อย่างไร", mem_single_ok,
            "VERIFIED matching A -> มากกว่า -> B",
            f"{mem_single['status']} (terms={zc.extract_query_terms('A เกี่ยวข้องกับ B อย่างไร')})",
            polarity="positive", failure_type="FALSE_NEGATIVE_RETRIEVAL_DROP",
            engine_path=mem_single["trace"]["engine_path"],
            detail="extract_query_terms drops single-char tokens (len(t) > 1)",
        )

        # Synonym / Paraphrase retrieval without shared literal token ("อยู่ที่ไหน" vs "ตั้งอยู่ที่")
        mem_para = infer("ที่ตั้งของอัลฟ่าคือที่ไหน")
        mem_para_ok = (
            mem_para["status"] == "VERIFIED"
            and any("ศูนย์ปฏิบัติการโอเมก้า" in m.get("object", "") for m in mem_para["trace"].get("matched_triples", []))
        )
        _record(
            cases, "MEM-06", "memory_retrieval", "ที่ตั้งของอัลฟ่าคือที่ไหน", mem_para_ok,
            "VERIFIED containing ศูนย์ปฏิบัติการโอเมก้า",
            f"{mem_para['status']} (matched={[m.get('object') for m in mem_para['trace'].get('matched_triples', [])]})",
            polarity="positive", failure_type="FALSE_NEGATIVE_RETRIEVAL_DROP",
            engine_path=mem_para["trace"]["engine_path"],
            detail=mem_para["content"][:140].replace("\n", " "),
        )

        # ------------------------------------------------------------------
        # 3. NEGATIVE ABSTENTION (Must return NOT_LEARNED, measures False Positives!)
        # ------------------------------------------------------------------
        for item in HELD_OUT_NEGATIVE_PROMPTS:
            res = infer(item["prompt"], mode=item["mode"])
            passed = res["status"] == item["expected_status"]
            _record(
                cases,
                item["id"],
                "negative_abstention",
                f"[{item['mode']}] {item['prompt']}",
                passed,
                item["expected_status"],
                res["status"],
                polarity="negative",
                failure_type="FALSE_POSITIVE_ABSTENTION_BREACH",
                engine_path=res["trace"]["engine_path"],
                detail=res["content"][:160].replace("\n", " "),
            )

        # ------------------------------------------------------------------
        # 4. GRAPH MULTI-HOP & CONTRADICTION PRESERVATION
        # ------------------------------------------------------------------
        g2 = infer("เชื่อมโยง: ZYRQUEN -> ทีมวิจัยอัลฟ่า")
        g2_hops = ((g2["trace"].get("graph_path") or {}).get("path") or {}).get("hops")
        _record(
            cases, "GRP-01", "graph_multihop", "เชื่อมโยง: ZYRQUEN -> ทีมวิจัยอัลฟ่า",
            g2["status"] == "VERIFIED" and g2_hops == 2,
            "VERIFIED (hops=2)", f"{g2['status']} (hops={g2_hops})",
            polarity="positive", failure_type="FALSE_NEGATIVE_RETRIEVAL_DROP",
            engine_path=g2["trace"]["engine_path"],
        )

        g4 = infer("เชื่อมโยง: ZYRQUEN -> SQLite WAL")
        g4_hops = ((g4["trace"].get("graph_path") or {}).get("path") or {}).get("hops")
        _record(
            cases, "GRP-02", "graph_multihop", "เชื่อมโยง: ZYRQUEN -> SQLite WAL",
            g4["status"] == "VERIFIED" and g4_hops == 4,
            "VERIFIED (hops=4)", f"{g4['status']} (hops={g4_hops})",
            polarity="positive", failure_type="FALSE_NEGATIVE_RETRIEVAL_DROP",
            engine_path=g4["trace"]["engine_path"],
        )

        # 5-hop depth boundary probe (find_graph_path defaults to max_depth=4)
        g5 = infer("เชื่อมโยง: ZYRQUEN -> Parameterized Queries")
        g5_hops = ((g5["trace"].get("graph_path") or {}).get("path") or {}).get("hops")
        _record(
            cases, "GRP-03", "graph_multihop", "เชื่อมโยง: ZYRQUEN -> Parameterized Queries",
            g5["status"] == "VERIFIED" and g5_hops == 5,
            "VERIFIED (hops=5)", f"{g5['status']} (hops={g5_hops})",
            polarity="positive", failure_type="MULTIHOP_DEPTH_OR_BOUNDARY_GAP",
            engine_path=g5["trace"]["engine_path"],
            detail="Default max_depth=4 limits paths > 4 hops",
        )

        grev = infer("เชื่อมโยง: ทีมวิจัยอัลฟ่า -> ZYRQUEN")
        grev_bi = ((grev["trace"].get("graph_path") or {}).get("path") or {}).get("bidirectional")
        _record(
            cases, "GRP-04", "graph_multihop", "เชื่อมโยง: ทีมวิจัยอัลฟ่า -> ZYRQUEN",
            grev["status"] == "VERIFIED" and grev_bi is True,
            "VERIFIED (bidirectional=True)", f"{grev['status']} (bidirectional={grev_bi})",
            polarity="positive", failure_type="FALSE_NEGATIVE_RETRIEVAL_DROP",
            engine_path=grev["trace"]["engine_path"],
        )

        gdisc = infer("เชื่อมโยง: ZYRQUEN -> คาร์บอน")
        _record(
            cases, "GRP-05", "graph_multihop", "เชื่อมโยง: ZYRQUEN -> คาร์บอน",
            gdisc["status"] == "NOT_LEARNED",
            "NOT_LEARNED", gdisc["status"],
            polarity="negative", failure_type="FALSE_POSITIVE_ABSTENTION_BREACH",
            engine_path=gdisc["trace"]["engine_path"],
        )

        gcontra = infer("สอน: คาร์บอน -> มีเลขอะตอม -> 12", mode="knowledge")
        contras = (gcontra["trace"].get("teach") or {}).get("contradictions", [])
        _record(
            cases, "GRP-06", "graph_multihop", "สอน: คาร์บอน -> มีเลขอะตอม -> 12",
            gcontra["status"] == "VERIFIED" and "6" in contras,
            "VERIFIED detecting contradiction ['6']",
            f"{gcontra['status']} (contradictions={contras})",
            polarity="positive", failure_type="CONTRADICTION_DETECTION_FAIL",
            engine_path=gcontra["trace"]["engine_path"],
        )

        # ------------------------------------------------------------------
        # 5. TOKENIZER & SCORING INTERFACES
        # ------------------------------------------------------------------
        toks_en = zc.tokenize("SQLite WAL v3.1")
        _record(
            cases, "TOK-01", "tokenizer_scoring", "tokenize('SQLite WAL v3.1')",
            "sqlite" in toks_en and "wal" in toks_en and "v3" in toks_en,
            "Contains ['sqlite', 'wal', 'v3']", f"{toks_en}",
            polarity="invariant", failure_type="TOKENIZER_WORD_SPLIT_FAIL",
        )

        # Thai sub-syllable collision probe
        conn = zc.get_db()
        rel_terms = zc.extract_query_terms("ทฤษฎีสัมพัทธภาพทั่วไปคืออะไร")
        kg_collision = zc.query_knowledge_graph(conn, "ทฤษฎีสัมพัทธภาพทั่วไปคืออะไร")
        _record(
            cases, "TOK-02", "tokenizer_scoring", "extract_query_terms + query_knowledge_graph on unlearned Thai physics",
            len(kg_collision) == 0,
            "0 spurious KG matches",
            f"hits={len(kg_collision)}, terms={rel_terms[:6]}",
            polarity="negative", failure_type="TOKENIZER_OVER_SEGMENTATION",
            detail=f"Matched: {[m['subject'] + '->' + m['relation'] for m in kg_collision]}",
        )

        # Single-char entity query term preservation
        single_terms = zc.extract_query_terms("A และ B")
        _record(
            cases, "TOK-03", "tokenizer_scoring", "extract_query_terms('A และ B')",
            "a" in single_terms and "b" in single_terms,
            "Preserves entity symbols 'a' and 'b'",
            f"{single_terms}",
            polarity="positive", failure_type="TOKENIZER_ENTITY_DROP",
        )

        # Interpolated N-Gram scoring determinism
        weights_path = Path(seed_info["checkpoint"]["weights_path"])
        weights = json.loads(weights_path.read_text(encoding="utf-8"))
        l1, a1, n1 = zc._score_interpolated_ngram(
            ["ระบบ zyrquen ประมวลผล"],
            weights["bigrams"],
            weights["trigrams"],
            weights["unigrams"],
            max(1, len(weights["vocab"])),
        )
        l2, a2, n2 = zc._score_interpolated_ngram(
            ["ระบบ zyrquen ประมวลผล"],
            weights["bigrams"],
            weights["trigrams"],
            weights["unigrams"],
            max(1, len(weights["vocab"])),
        )
        ngram_ok = (l1 == l2 and a1 == a2 and n1 == n2 and math.isfinite(l1) and 0.0 <= a1 <= 1.0 and n1 > 0)
        _record(
            cases, "TOK-04", "tokenizer_scoring", "_score_interpolated_ngram determinism & bounds",
            ngram_ok,
            "Deterministic finite loss & 0<=acc<=1",
            f"loss={l1:.4f}, acc={a1:.4f}, preds={n1}",
            polarity="invariant", failure_type="NGRAM_SCORER_INSTABILITY",
        )

        # Check model_version behavioral routing vs metadata-only tracking
        mv_omega = infer("คำนวณ 2 + 2", mv="zyrquen-omega-v1")
        mv_ast = infer("คำนวณ 2 + 2", mv="zyrquen-ast-pro")
        mv_trace_ok = (
            mv_omega["trace"].get("model_version") == "zyrquen-omega-v1"
            and mv_ast["trace"].get("model_version") == "zyrquen-ast-pro"
            and mv_omega["trace"].get("external_models_used") is False
        )
        _record(
            cases, "TOK-05", "tokenizer_scoring", "model_version trace provenance (no external LLMs)",
            mv_trace_ok,
            "Trace records model_version & external_models_used=False",
            f"versions={[mv_omega['trace'].get('model_version'), mv_ast['trace'].get('model_version')]}, ext={mv_omega['trace'].get('external_models_used')}",
            polarity="invariant", failure_type="TRACE_METADATA_MISSING",
        )
        conn.close()

        # ------------------------------------------------------------------
        # 6. LEAKAGE DETECTION & DATASET INTEGRITY
        # ------------------------------------------------------------------
        _record(
            cases, "LEAK-01", "leakage_detection", "Fixture Train vs Held-out Isolation",
            isolation["isolated"],
            "0 overlaps", f"overlaps={len(isolation['overlaps'])}",
            polarity="invariant", failure_type="FIXTURE_CONTAMINATION",
        )

        clean_ds = seed_info["dataset"]
        _record(
            cases, "LEAK-02", "leakage_detection", "Clean 10-line Corpus Split",
            clean_ds["leakage_detected"] == 0 and clean_ds["train_count"] > 0 and clean_ds["val_count"] > 0 and clean_ds["test_count"] > 0,
            "leakage_detected=0 with non-empty Train/Val/Test",
            f"leak={clean_ds['leakage_detected']}, splits=({clean_ds['train_count']},{clean_ds['val_count']},{clean_ds['test_count']})",
            polarity="invariant", failure_type="DATASET_SPLIT_ERROR",
        )

        # Exact duplicate removal (case + whitespace differences)
        exact_dup_lines = list(TRAINING_CORPUS_LINES[:5]) + [
            "  " + TRAINING_CORPUS_LINES[0].upper() + "  "
        ]
        dup_res = zc.handle_ingest_dataset({
            "name": "exact-dup-test",
            "content": "\n".join(exact_dup_lines),
            "user_id": "p1-bench-user",
        })
        _record(
            cases, "LEAK-03", "leakage_detection", "Exact Duplicate Normalization Dedup",
            dup_res.get("ok") and dup_res.get("deduplicated_removed") == 1,
            "deduplicated_removed=1",
            f"removed={dup_res.get('deduplicated_removed')}",
            polarity="positive", failure_type="EXACT_DEDUP_MISS",
        )

        # Near-duplicate leakage probe (punctuation variation across splits)
        near_dup_lines = list(TRAINING_CORPUS_LINES) + [
            TRAINING_CORPUS_LINES[0] + "!!"
        ]
        near_res = zc.handle_ingest_dataset({
            "name": "near-dup-test",
            "content": "\n".join(near_dup_lines),
            "user_id": "p1-bench-user",
        })
        near_caught = (near_res.get("deduplicated_removed", 0) >= 1) or (near_res.get("dataset", {}).get("leakage_detected", 0) == 1)
        _record(
            cases, "LEAK-04", "leakage_detection", "Near-Duplicate Punctuation Leakage Probe ('!!')",
            near_caught,
            "Either deduplicated (>=1) or flagged leakage_detected=1",
            f"removed={near_res.get('deduplicated_removed')}, leakage_detected={near_res.get('dataset', {}).get('leakage_detected')}",
            polarity="positive", failure_type="NEAR_DUPLICATE_LEAKAGE_MISS",
        )

        # ------------------------------------------------------------------
        # 7. PLANNING & RESEARCH GUARDRAILS
        # ------------------------------------------------------------------
        plan_ml = infer("วางแผน: เตรียมข้อมูล ฝึกโมเดล และประเมินผล")
        steps_ml = (plan_ml["trace"].get("plan") or {}).get("steps", [])
        step_ids = {s["step_id"] for s in steps_ml}
        dag_valid = bool(steps_ml) and all(
            all(d in step_ids and d != s["step_id"] for d in s["depends_on"]) for s in steps_ml
        )
        _record(
            cases, "PLN-01", "planning_research", "ML Pipeline DAG Decomposition",
            plan_ml["status"] == "VERIFIED" and dag_valid,
            "VERIFIED acyclic DAG", f"{plan_ml['status']} (steps={len(steps_ml)}, valid={dag_valid})",
            polarity="positive", failure_type="DAG_PLANNER_ERROR",
            engine_path=plan_ml["trace"]["engine_path"],
        )

        # Non-ML goal domain adaptability probe
        plan_non_ml = infer("วางแผน: สร้างระบบแนะนำหนังสือภาษาไทย")
        non_ml_groups = {s["workflow_group"] for s in (plan_non_ml["trace"].get("plan") or {}).get("steps", [])}
        # Current planner falls back to fixed MLOps steps (system_ops + data_pipeline/native_training/evaluation)
        non_ml_domain_adapted = not non_ml_groups.issubset({"system_ops", "data_pipeline", "native_training", "evaluation", "knowledge_memory", "security_governance"})
        _record(
            cases, "PLN-02", "planning_research", "Non-ML Domain Planning Adaptability",
            non_ml_domain_adapted,
            "Domain-specific plan steps beyond fixed MLOps template",
            f"groups={sorted(non_ml_groups)}",
            polarity="positive", failure_type="PLANNER_DOMAIN_RIGIDITY",
            engine_path=plan_non_ml["trace"]["engine_path"],
        )

        # Natural research intent without prefix
        nat_intent = te.detect_tool_intent("ช่วยหาข้อมูลล่าสุดเกี่ยวกับเรื่อง SQLite ให้หน่อย")
        _record(
            cases, "RES-01", "planning_research", "Natural-Language Thai Research Intent Detection",
            nat_intent is not None and nat_intent[0] == "web_search",
            "web_search intent detected", f"{nat_intent}",
            polarity="positive", failure_type="RESEARCH_INTENT_PREFIX_ONLY",
        )

        # Security guardrail: block external LLM + SSRF private/loopback/metadata
        ok_llm, _ = te.validate_safe_public_url("https://api.openai.com/v1/chat", None)
        ok_ssrf, _ = te.validate_safe_public_url("http://127.0.0.1:3000/api/health", None)
        ok_meta, _ = te.validate_safe_public_url("https://169.254.169.254/latest/meta-data", None)
        _record(
            cases, "RES-02", "planning_research", "External LLM & SSRF URL Guardrail Policy",
            (not ok_llm) and (not ok_ssrf) and (not ok_meta),
            "All 3 unsafe URLs blocked (False, False, False)",
            f"({ok_llm}, {ok_ssrf}, {ok_meta})",
            polarity="invariant", failure_type="SECURITY_POLICY_BREACH",
        )

        # ------------------------------------------------------------------
        # 8. ANTI-FABRICATION & EVIDENCE-BASED OUTPUT POLICY (Mandatory Gates)
        # ------------------------------------------------------------------
        conn = zc.get_db()

        # AFB-01: Fabricated Source Detection (empty URL + blocked/unregistered provider)
        fab_analysis = te.analyze_tool_result(
            conn,
            "web_search",
            {
                "ok": True,
                "results": [
                    {"provider": "api.openai.com", "title": "Fake Source", "snippet": "Unverified synthetic claim", "url": ""},
                    {"provider": "fabricated.local", "title": "Fake Mirror", "snippet": "Unverified synthetic claim", "url": "http://not-https.local"},
                ],
            },
            zc.tokenize,
            zc.extract_query_terms,
            zc.query_knowledge_graph,
        )
        fab_rejected = (
            fab_analysis.get("trust_grade") in {"INSUFFICIENT_EVIDENCE", "BLOCKED", "UNVERIFIED"}
            and "api.openai.com" not in fab_analysis.get("distinct_providers", [])
        )
        _record(
            cases, "AFB-01", "anti_fabrication", "Fabricated Source Detection (missing/invalid URL & blocked provider)",
            fab_rejected,
            "Reject/quarantine fabricated sources (not CORROBORATED_MULTI_SOURCE)",
            f"trust_grade={fab_analysis.get('trust_grade')}, providers={fab_analysis.get('distinct_providers')}",
            polarity="negative", failure_type="FABRICATED_SOURCE_ACCEPTED",
        )

        # AFB-02: Invalid URL Rejection (scheme, allowlist, loopback, metadata, LLM hosts)
        u1, _ = te.validate_safe_public_url("ftp://en.wikipedia.org/wiki/SQLite", ["en.wikipedia.org"])
        u2, _ = te.validate_safe_public_url("https://evil.example.com/payload", ["en.wikipedia.org"])
        u3, _ = te.validate_safe_public_url("https://localhost/admin", None)
        u4, _ = te.validate_safe_public_url("https://generativelanguage.googleapis.com/v1beta/models", None)
        _record(
            cases, "AFB-02", "anti_fabrication", "Invalid URL & Non-Allowlisted Domain Rejection",
            not any([u1, u2, u3, u4]),
            "All invalid/disallowed URLs rejected (False x4)",
            f"({u1}, {u2}, {u3}, {u4})",
            polarity="invariant", failure_type="INVALID_URL_ACCEPTED",
        )

        # AFB-03: Unsupported Recommendation Rejection (0 evidence items -> INSUFFICIENT_EVIDENCE)
        empty_analysis = te.analyze_tool_result(
            conn, "web_search", {"ok": True, "results": []},
            zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
        )
        _record(
            cases, "AFB-03", "anti_fabrication", "Unsupported Recommendation Rejection (0 evidence items)",
            empty_analysis.get("trust_grade") == "INSUFFICIENT_EVIDENCE" and len(empty_analysis.get("limitations", [])) > 0,
            "trust_grade=INSUFFICIENT_EVIDENCE with explicit limitations",
            f"trust_grade={empty_analysis.get('trust_grade')}, limitations={len(empty_analysis.get('limitations', []))}",
            polarity="invariant", failure_type="UNSUPPORTED_RECOMMENDATION_EMITTED",
        )

        # AFB-04: Stale Evidence Handling (2020 timestamp must be flagged STALE)
        stale_analysis = te.analyze_tool_result(
            conn,
            "doc_fetch",
            {
                "ok": True,
                "url": "https://en.wikipedia.org/wiki/SQLite",
                "provider": "en.wikipedia.org",
                "title": "SQLite",
                "headings": ["History"],
                "excerpt": "SQLite release notes",
                "retrieved_at": "2020-01-01T00:00:00Z",
            },
            zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
        )
        stale_detected = (
            stale_analysis.get("trust_grade") == "STALE"
            or stale_analysis.get("freshness_status") == "STALE"
            or any("stale" in str(x).lower() or "เก่า" in str(x) or "ล้าสมัย" in str(x) for x in stale_analysis.get("limitations", []))
        )
        _record(
            cases, "AFB-04", "anti_fabrication", "Stale Evidence Handling (2020-01-01 retrieved_at)",
            stale_detected,
            "Evidence flagged STALE with freshness limitation",
            f"trust_grade={stale_analysis.get('trust_grade')}, keys={sorted(stale_analysis.keys())}",
            polarity="positive", failure_type="STALE_EVIDENCE_NOT_HANDLED",
        )

        # AFB-05: Missing Evidence Abstention (no checkpoint -> NOT_RUN, never VERIFIED/fake accuracy)
        with isolated_core_env():
            empty_eval = zc.handle_run_evaluation({"user_id": "p1-bench-user", "suite_name": "Empty DB Eval"})["evaluation"]
            empty_details = json.loads(empty_eval["details_json"])
            abstains_missing = (
                empty_eval["overall_status"] == "PARTIAL"
                and empty_details["heldout_test"]["status"] == "NOT_RUN"
                and empty_eval["test_accuracy"] is None
            )
            _record(
                cases, "AFB-05", "anti_fabrication", "Missing Evidence Abstention (eval with 0 checkpoints & 0 triples)",
                abstains_missing,
                "overall_status=PARTIAL, heldout_test=NOT_RUN, test_accuracy=None",
                f"overall={empty_eval['overall_status']}, heldout={empty_details['heldout_test']['status']}, acc={empty_eval['test_accuracy']}",
                polarity="invariant", failure_type="MISSING_EVIDENCE_FABRICATED",
            )

        # AFB-06: Mock Data Isolation (disjoint fixtures + isolated DB path + no external LLMs)
        _record(
            cases, "AFB-06", "anti_fabrication", "Mock Data Isolation & Zero External Model Leakage",
            isolation["isolated"] and str(zc.DB_PATH) != str(zc.BASE_DIR / "data" / "zyrquen.db"),
            "Fixtures isolated & benchmark DB separated from production data/",
            f"isolated={isolation['isolated']}, db={zc.DB_PATH.name}",
            polarity="invariant", failure_type="MOCK_DATA_LEAKAGE",
        )

        # AFB-07: False Success Prevention (disabled tool -> BLOCKED, unapproved -> PENDING_APPROVAL, bad AST -> FAILED)
        conn.execute("UPDATE external_tools SET enabled=0 WHERE id='calc_ast'")
        conn.commit()
        blk_res = te.invoke_tool_governed(
            conn, zc.DATA_DIR, "calc_ast", {"expression": "2 + 2"}, user_id="p1-bench-user",
            tokenize_fn=zc.tokenize, extract_terms_fn=zc.extract_query_terms,
            query_kg_fn=zc.query_knowledge_graph, calc_fn=zc._calc_any_for_tool,
        )
        conn.execute("UPDATE external_tools SET enabled=1 WHERE id='calc_ast'")
        conn.commit()
        bad_ast_res = te.invoke_tool_governed(
            conn, zc.DATA_DIR, "calc_ast", {"expression": "DROP TABLE users"}, user_id="p1-bench-user",
            tokenize_fn=zc.tokenize, extract_terms_fn=zc.extract_query_terms,
            query_kg_fn=zc.query_knowledge_graph, calc_fn=zc._calc_any_for_tool,
        )
        gate_res = te.invoke_tool_governed(
            conn, zc.DATA_DIR, "web_search", {"query": "SQLite"}, user_id="p1-bench-user",
            tokenize_fn=zc.tokenize, extract_terms_fn=zc.extract_query_terms,
            query_kg_fn=zc.query_knowledge_graph, calc_fn=zc._calc_any_for_tool,
        )
        false_success_prevented = (
            blk_res.get("status") == "BLOCKED"
            and bad_ast_res.get("status") == "FAILED"
            and gate_res.get("status") == "PENDING_APPROVAL"
        )
        _record(
            cases, "AFB-07", "anti_fabrication", "False Success Prevention (blocked/failed/gated tools)",
            false_success_prevented,
            "(BLOCKED, FAILED, PENDING_APPROVAL)",
            f"({blk_res.get('status')}, {bad_ast_res.get('status')}, {gate_res.get('status')})",
            polarity="invariant", failure_type="FALSE_SUCCESS_REPORTED",
        )
        conn.close()

        # Built-in core self-evaluation call (recorded for comparison)
        core_eval = zc.handle_run_evaluation({"user_id": "p1-bench-user", "suite_name": "P1-1 Builtin Eval"})["evaluation"]

    # ----------------------------------------------------------------------
    # Aggregate Metrics
    # ----------------------------------------------------------------------
    total = len(cases)
    passed = sum(1 for c in cases if c["passed"])
    failed = total - passed

    by_category: dict[str, dict[str, Any]] = {}
    for c in cases:
        cat = by_category.setdefault(c["category"], {"total": 0, "passed": 0, "failed": 0, "score": 0.0})
        cat["total"] += 1
        if c["passed"]:
            cat["passed"] += 1
        else:
            cat["failed"] += 1
    for cat in by_category.values():
        cat["score"] = round(cat["passed"] / cat["total"], 4) if cat["total"] else 0.0

    neg_cases = [c for c in cases if c["polarity"] == "negative"]
    pos_cases = [c for c in cases if c["polarity"] == "positive"]
    false_positives = [c for c in neg_cases if not c["passed"]]
    false_negatives = [c for c in pos_cases if not c["passed"]]
    failures = [c for c in cases if not c["passed"]]

    failure_types = dict(collections.Counter(c["failure_type"] for c in failures))

    return {
        "benchmark_version": "P1-1-baseline-v1",
        "environment": {
            "python_version": platform.python_version(),
            "platform": platform.system(),
            "model_version": model_version,
            "checkpoint_version": seed_info["checkpoint"]["version"],
            "checkpoint_vocab_size": seed_info["checkpoint"]["vocab_size"],
            "external_models_used": False,
        },
        "summary": {
            "total_cases": total,
            "passed": passed,
            "failed": failed,
            "overall_score": round(passed / total, 4) if total else 0.0,
            "false_positives": len(false_positives),
            "negative_cases_total": len(neg_cases),
            "false_positive_rate": round(len(false_positives) / len(neg_cases), 4) if neg_cases else 0.0,
            "false_negatives": len(false_negatives),
            "positive_cases_total": len(pos_cases),
            "false_negative_rate": round(len(false_negatives) / len(pos_cases), 4) if pos_cases else 0.0,
        },
        "category_scores": by_category,
        "leakage_detection": {
            "fixture_isolation": isolation,
            "clean_split_leakage_detected": seed_info["dataset"]["leakage_detected"],
            "exact_dedup_passed": next(c["passed"] for c in cases if c["id"] == "LEAK-03"),
            "near_dup_leakage_caught": next(c["passed"] for c in cases if c["id"] == "LEAK-04"),
        },
        "builtin_core_eval": {
            "overall_status": core_eval["overall_status"],
            "math_score": core_eval["math_score"],
            "knowledge_score": core_eval["knowledge_score"],
            "planning_score": core_eval["planning_score"],
            "test_accuracy": core_eval["test_accuracy"],
            "perplexity": core_eval["perplexity"],
        },
        "failure_types": failure_types,
        "failures": failures,
        "unmeasurable_limitations": [
            "Live external HTTPS web_search/doc_fetch response quality & multi-source contradiction not scored offline (network I/O isolated).",
            "Long-range language generation coherence & semantic reasoning beyond 10-line N-Gram corpus cannot be measured until corpus & native sequence model scale beyond trigram tables.",
            "UI-selected model_version (zyrquen-ast-pro, zyrquen-kg-v2) currently alters trace metadata only; distinct model-variant execution policies are not yet implemented in zyrquen_core.py.",
        ],
        "cases": cases,
    }


def format_report_text(report: dict[str, Any]) -> str:
    env = report["environment"]
    s = report["summary"]
    lines = [
        "=== ZYRQUEN Ω∞ P1-1 Capability Baseline Report ===",
        f"Environment: Python {env['python_version']} ({env['platform']}) | Model: {env['model_version']} | Checkpoint v{env['checkpoint_version']} (vocab={env['checkpoint_vocab_size']}) | External LLMs: {env['external_models_used']}",
        f"Total Cases: {s['total_cases']} | Passed: {s['passed']} | Failed: {s['failed']} | Overall Score: {s['overall_score']*100:.1f}%",
        f"False Positives (Abstention Breaches): {s['false_positives']}/{s['negative_cases_total']} ({s['false_positive_rate']*100:.1f}%)",
        f"False Negatives (Positive Failures): {s['false_negatives']}/{s['positive_cases_total']} ({s['false_negative_rate']*100:.1f}%)",
        "",
        "Category Breakdown:",
    ]
    for cat, stats in report["category_scores"].items():
        lines.append(f"  - {cat:20s}: {stats['passed']}/{stats['total']} ({stats['score']*100:.1f}%)")
    lines.append("")
    lines.append(f"Leakage Detection: fixture_isolated={report['leakage_detection']['fixture_isolation']['isolated']}, exact_dedup={report['leakage_detection']['exact_dedup_passed']}, near_dup_caught={report['leakage_detection']['near_dup_leakage_caught']}")
    lines.append(f"Failures Recorded ({len(report['failures'])}):")
    for f in report["failures"]:
        lines.append(f"  [{f['id']}] ({f['failure_type']}) {f['input']} -> expected={f['expected']}, actual={f['actual']}")
    return "\n".join(lines)


if __name__ == "__main__":
    rep = run_capability_benchmark()
    if "--json" in sys.argv:
        print(json.dumps(rep, ensure_ascii=False, indent=2))
    else:
        print(format_report_text(rep))
