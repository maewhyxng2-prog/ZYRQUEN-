"""
Unit & Interface Verification Tests for ZYRQUEN Ω∞ P1-1 Benchmark Suite.

Verifies:
1. Strict separation between Training Fixtures and Evaluation Fixtures (zero leakage).
2. Real Python Native Core interfaces (Tokenizer, AST/Linear/Stats Reasoning, KG Retrieval,
   Multi-hop BFS, Dataset Ingestion/Leakage Detection, N-Gram Scorer, URL Guardrails).
3. Reproducible determinism of the P1-1 Baseline Report without fake scores or external LLMs.
"""

import sys
import unittest
from pathlib import Path

PYTHON_CORE_DIR = Path(__file__).resolve().parent.parent
if str(PYTHON_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_CORE_DIR))

import tools_engine as te  # noqa: E402
import zyrquen_core as zc  # noqa: E402
from tests.benchmark_fixtures import verify_fixture_isolation  # noqa: E402
from tests.benchmark_suite import (  # noqa: E402
    isolated_core_env,
    run_capability_benchmark,
)


class P1BenchmarkInfrastructureTests(unittest.TestCase):
    def test_fixture_isolation_prevents_train_test_leakage(self) -> None:
        iso = verify_fixture_isolation()
        self.assertTrue(iso["isolated"], f"Unexpected train/eval overlap: {iso['overlaps']}")
        self.assertGreaterEqual(iso["training_records"], 5)
        self.assertGreaterEqual(iso["heldout_negative_cases"], 5)

    def test_tokenizer_and_ngram_scorer_real_interfaces(self) -> None:
        tokens = zc.tokenize("ZYRQUEN AST 3.14!")
        self.assertIn("zyrquen", tokens)
        self.assertIn("ast", tokens)

        terms = zc.extract_query_terms("อะไรคือระบบ zyrquen ครับ")
        self.assertIn("zyrquen", terms)
        self.assertNotIn("อะไร", terms)

        # Direct _score_interpolated_ngram contract
        bigrams = {"zyrquen": {"core": 2}}
        trigrams = {"ระบบ zyrquen": {"core": 2}}
        unigrams = {"ระบบ": 2, "zyrquen": 2, "core": 2, "<END>": 2}
        sample = "ระบบ zyrquen core"
        expected_preds = len(zc.tokenize(sample))  # len(tokens + ['<END>']) - 1
        loss, acc, total_preds = zc._score_interpolated_ngram(
            [sample], bigrams, trigrams, unigrams, vocab_size=4
        )
        self.assertEqual(total_preds, expected_preds)
        self.assertGreater(loss, 0.0)
        self.assertGreaterEqual(acc, 0.0)
        self.assertLessEqual(acc, 1.0)

    def test_memory_retrieval_and_multihop_bfs_isolated(self) -> None:
        with isolated_core_env():
            zc.handle_infer({"prompt": "สอน: AlphaNode -> เชื่อม -> BetaNode", "mode": "knowledge", "user_id": "u"})
            zc.handle_infer({"prompt": "สอน: BetaNode -> ชี้ไป -> GammaNode", "mode": "knowledge", "user_id": "u"})

            conn = zc.get_db()
            hits = zc.query_knowledge_graph(conn, "AlphaNode")
            self.assertTrue(any(h["object"] == "BetaNode" and h.get("provenance") == "direct" for h in hits))
            self.assertTrue(any(h.get("provenance") == "inferred_2hop" and h["object"] == "GammaNode" for h in hits))

            path = zc.find_graph_path(conn, "AlphaNode", "GammaNode", max_depth=4)
            self.assertIsNotNone(path)
            self.assertEqual(path["hops"], 2)
            conn.close()

    def test_leakage_detection_and_url_security_policy(self) -> None:
        with isolated_core_env():
            lines = [
                "sample record one for native test",
                "sample record two for native test",
                "SAMPLE RECORD ONE FOR NATIVE TEST",  # exact duplicate after norm
                "sample record three for native test",
                "sample record four for native test",
                "sample record five for native test",
            ]
            res = zc.handle_ingest_dataset({"name": "iso-test", "content": "\n".join(lines), "user_id": "u"})
            self.assertTrue(res["ok"])
            self.assertEqual(res["deduplicated_removed"], 1)
            self.assertEqual(res["dataset"]["leakage_detected"], 0)

        ok_llm, _ = te.validate_safe_public_url("https://api.openai.com/v1/responses", None)
        ok_local, _ = te.validate_safe_public_url("http://localhost:3000/api/health", None)
        self.assertFalse(ok_llm)
        self.assertFalse(ok_local)

    def test_benchmark_report_is_deterministic_and_honest(self) -> None:
        r1 = run_capability_benchmark(model_version="zyrquen-omega-v1")
        r2 = run_capability_benchmark(model_version="zyrquen-omega-v1")

        self.assertEqual(r1["summary"], r2["summary"])
        self.assertEqual(r1["category_scores"], r2["category_scores"])
        self.assertFalse(r1["environment"]["external_models_used"])
        self.assertGreater(r1["summary"]["total_cases"], 30)
        # Verify failures list strictly matches summary count and abstention remains 0/10 FP
        self.assertEqual(r1["summary"]["false_positives"], 0)
        self.assertGreaterEqual(r1["summary"]["passed"], 50)
        self.assertEqual(len(r1["failures"]), r1["summary"]["failed"])

    def test_anti_fabrication_mandatory_checks(self) -> None:
        # Invalid URL Rejection (scheme, private IP, non-allowlisted domain, LLM hosts)
        for bad_url, allowlist in [
            ("http://en.wikipedia.org/wiki/SQLite", ["en.wikipedia.org"]),
            ("https://untrusted.example.com/data", ["en.wikipedia.org"]),
            ("https://169.254.169.254/latest/meta-data", None),
            ("https://api.openai.com/v1/chat/completions", None),
        ]:
            ok, _ = te.validate_safe_public_url(bad_url, allowlist)
            self.assertFalse(ok, f"Expected URL rejection for {bad_url}")

        # Missing Evidence Abstention, Unsupported Recommendation Rejection & False Success Prevention
        with isolated_core_env():
            conn = zc.get_db()
            empty_res = te.analyze_tool_result(
                conn, "web_search", {"ok": True, "results": []},
                zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
            )
            self.assertEqual(empty_res["trust_grade"], "INSUFFICIENT_EVIDENCE")
            self.assertTrue(len(empty_res["limitations"]) > 0)

            bad_calc = te.invoke_tool_governed(
                conn, zc.DATA_DIR, "calc_ast", {"expression": "import os"}, user_id="u",
                tokenize_fn=zc.tokenize, extract_terms_fn=zc.extract_query_terms,
                query_kg_fn=zc.query_knowledge_graph, calc_fn=zc._calc_any_for_tool,
            )
            self.assertEqual(bad_calc["status"], "FAILED")

            gated_web = te.invoke_tool_governed(
                conn, zc.DATA_DIR, "web_search", {"query": "SQLite"}, user_id="u",
                tokenize_fn=zc.tokenize, extract_terms_fn=zc.extract_query_terms,
                query_kg_fn=zc.query_knowledge_graph, calc_fn=zc._calc_any_for_tool,
            )
            self.assertEqual(gated_web["status"], "PENDING_APPROVAL")
            conn.close()

    def test_p1_2_remediation_regressions(self) -> None:
        with isolated_core_env():
            conn = zc.get_db()
            # 1a. Missing URL rejected as UNVERIFIED
            fab_missing_url = te.analyze_tool_result(
                conn,
                "web_search",
                {
                    "ok": True,
                    "results": [
                        {"provider": "example.org", "title": "Fake", "snippet": "fake claim", "url": ""},
                    ],
                },
                zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
            )
            self.assertEqual(fab_missing_url["trust_grade"], "UNVERIFIED")
            self.assertEqual(fab_missing_url["distinct_providers"], [])

            # 1b. Blocked external LLM host rejected as BLOCKED
            fab_llm = te.analyze_tool_result(
                conn,
                "web_search",
                {
                    "ok": True,
                    "results": [
                        {"provider": "api.openai.com", "title": "Fake", "snippet": "fake claim", "url": "https://api.openai.com/v1/chat"},
                    ],
                },
                zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
            )
            self.assertEqual(fab_llm["trust_grade"], "BLOCKED")
            self.assertEqual(fab_llm["distinct_providers"], [])

            # 2. Stale evidence flagged STALE
            stale = te.analyze_tool_result(
                conn,
                "doc_fetch",
                {
                    "ok": True,
                    "url": "https://en.wikipedia.org/wiki/SQLite",
                    "provider": "en.wikipedia.org",
                    "title": "SQLite",
                    "headings": [],
                    "excerpt": "SQLite notes",
                    "retrieved_at": "2020-01-01T00:00:00Z",
                },
                zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
            )
            self.assertEqual(stale["trust_grade"], "STALE")
            self.assertEqual(stale["freshness_status"], "STALE")
            conn.close()

            # 3. Near-duplicate punctuation variation deduplicated
            near_lines = [
                "ระบบ zyrquen ประมวลผลคณิตศาสตร์ผ่าน ast อย่างปลอดภัย",
                "ระบบ zyrquen จัดเก็บความจำในกราฟความรู้ sqlite",
                "ระบบ zyrquen วางแผนงานแบบ dag จากสถานะฐานข้อมูลจริง",
                "ระบบ zyrquen ไม่ส่งข้อมูลไปยังโมเดลภายนอกโดยเด็ดขาด",
                "ระบบ zyrquen ตรวจสอบคำตอบก่อนบันทึกทุกครั้ง",
                "ระบบ zyrquen ประมวลผลคณิตศาสตร์ผ่าน ast อย่างปลอดภัย!!",
            ]
            ds_res = zc.handle_ingest_dataset({"name": "near-dup", "content": "\n".join(near_lines), "user_id": "u"})
            self.assertTrue(ds_res["ok"])
            self.assertEqual(ds_res["deduplicated_removed"], 1)
            self.assertEqual(ds_res["dataset"]["leakage_detected"], 0)

            # 4. Single-char entity retrieval preserved while short-syllable false positives prevented
            zc.handle_infer({"prompt": "สอน: A -> มากกว่า -> B", "mode": "knowledge", "user_id": "u"})
            zc.handle_infer({"prompt": "สอน: Python Native Core -> พัฒนาโดย -> ทีมวิจัยอัลฟ่า", "mode": "knowledge", "user_id": "u"})
            single_hit = zc.handle_infer({"prompt": "A เกี่ยวข้องกับ B อย่างไร", "mode": "auto", "user_id": "u"})
            self.assertEqual(single_hit["status"], "VERIFIED")
            fp_miss = zc.handle_infer({"prompt": "ทฤษฎีสัมพัทธภาพทั่วไปคืออะไร", "mode": "auto", "user_id": "u"})
            self.assertEqual(fp_miss["status"], "NOT_LEARNED")


class P2ReasoningAndPlanningTests(unittest.TestCase):
    def test_p2_math_quadratic_and_multivariate_systems(self) -> None:
        with isolated_core_env():
            # Unseen polite math expression (RSN-08 generalization)
            r_math = zc.handle_infer({"prompt": "ช่วยคำนวณ (15 * 4) + 12 ให้หน่อยค่ะ?", "mode": "auto", "user_id": "u"})
            self.assertEqual(r_math["status"], "VERIFIED")
            self.assertEqual(r_math["trace"]["math"]["result"], 72)

            # Unseen quadratic + repeated root + complex no_real_solution (RSN-09 generalization)
            q_two = zc.handle_infer({"prompt": "แก้สมการ: 2x^2 + 4x - 6 = 0", "mode": "auto", "user_id": "u"})
            self.assertEqual(q_two["status"], "VERIFIED")
            self.assertEqual(q_two["trace"]["algebra"]["summary_tag"], "roots(-3,1)")

            q_rep = zc.handle_infer({"prompt": "แก้สมการ: (x - 4)^2 = 0", "mode": "auto", "user_id": "u"})
            self.assertEqual(q_rep["trace"]["algebra"]["summary_tag"], "root(4)")

            q_none = zc.handle_infer({"prompt": "แก้สมการ: x^2 + 4 = 0", "mode": "auto", "user_id": "u"})
            self.assertEqual(q_none["trace"]["algebra"]["solution_type"], "no_real_solution")

            # Unseen 3-variable system + inconsistent/underdetermined abstention (RSN-10 generalization)
            sys_3 = zc.handle_infer(
                {"prompt": "แก้สมการ: x + y + z = 6, 2x - y + z = 3, x + 2y - z = 2", "mode": "auto", "user_id": "u"}
            )
            self.assertEqual(sys_3["status"], "VERIFIED")
            self.assertEqual(sys_3["trace"]["algebra"]["summary_tag"], "system(x=1,y=2,z=3)")

            sys_bad = zc.handle_infer({"prompt": "แก้สมการ: x + y = 5, x + y = 9", "mode": "auto", "user_id": "u"})
            self.assertEqual(sys_bad["trace"]["algebra"]["solution_type"], "no_solution")

    def test_p2_transitive_logic_word_math_and_abstention(self) -> None:
        with isolated_core_env():
            # Multi-hop strict/non-strict chain + converse (RSN-11 generalization)
            l_chain = zc.handle_infer(
                {"prompt": "ถ้า X > Y และ Y >= Z และ Z > W แล้ว W เทียบกับ X เป็นอย่างไร", "mode": "auto", "user_id": "u"}
            )
            self.assertEqual(l_chain["status"], "VERIFIED")
            self.assertEqual(l_chain["trace"]["logic"]["derived_relation"], "W < X")

            # Contradiction & undetermined logic must NOT fabricate a relation
            l_contra = zc.handle_infer(
                {"prompt": "ถ้า A > B และ B > A แล้ว A เทียบกับ B เป็นอย่างไร", "mode": "auto", "user_id": "u"}
            )
            self.assertEqual(l_contra["status"], "BLOCKED")
            self.assertTrue(l_contra["trace"]["logic"]["contradiction"])

            l_undet = zc.handle_infer(
                {"prompt": "ถ้า A > B และ C > D แล้ว A เทียบกับ D เป็นอย่างไร", "mode": "auto", "user_id": "u"}
            )
            self.assertEqual(l_undet["status"], "NOT_LEARNED")
            self.assertFalse(l_undet["trace"]["logic"]["determined"])

            # Mixed attribute comparatives must abstain rather than conflate height & weight
            l_mixed = zc.handle_infer(
                {"prompt": "ถ้า A สูงกว่า B และ B หนักกว่า C แล้ว A เทียบกับ C เป็นอย่างไร", "mode": "auto", "user_id": "u"}
            )
            self.assertEqual(l_mixed["status"], "NOT_LEARNED")

            # Unseen Thai word-math problems + division-by-zero / non-math abstention (RSN-12)
            w_mul = zc.handle_infer(
                {"prompt": "ซื้อดินสอ 5 กล่อง กล่องละ 12 แท่ง จะมีดินสอทั้งหมดกี่แท่ง", "mode": "auto", "user_id": "u"}
            )
            self.assertEqual(w_mul["status"], "VERIFIED")
            self.assertEqual(w_mul["trace"]["word_math"]["result"], 60)

            w_sub = zc.handle_infer(
                {"prompt": "มีเงิน 250 บาท ซื้อของไป 85 บาท จะเหลือเงินกี่บาท", "mode": "auto", "user_id": "u"}
            )
            self.assertEqual(w_sub["status"], "VERIFIED")
            self.assertEqual(w_sub["trace"]["word_math"]["result"], 165)

            w_zero = zc.handle_infer(
                {"prompt": "มีแอปเปิ้ล 12 ผล แบ่งให้ 0 คนเท่าๆ กัน จะได้คนละกี่ผล", "mode": "auto", "user_id": "u"}
            )
            self.assertEqual(w_zero["status"], "NOT_LEARNED")

    def test_p2_multihop_6_domain_planner_and_research_intent(self) -> None:
        with isolated_core_env():
            for src, dst in [("N1", "N2"), ("N2", "N3"), ("N3", "N4"), ("N4", "N5"), ("N5", "N6"), ("N6", "N7")]:
                zc.handle_infer({"prompt": f"สอน: {src} -> เชื่อม -> {dst}", "mode": "knowledge", "user_id": "u"})
            hop6 = zc.handle_infer({"prompt": "เชื่อมโยง: N1 -> N7", "mode": "auto", "user_id": "u"})
            self.assertEqual(hop6["status"], "VERIFIED")
            self.assertEqual(hop6["trace"]["graph_path"]["path"]["hops"], 6)

            # Domain-adaptive non-ML planner produces acyclic non-MLOps DAG (PLN-02)
            plan = zc.handle_infer({"prompt": "วางแผน: พัฒนาแอปพลิเคชันจัดการคลังสินค้าออนไลน์", "mode": "auto", "user_id": "u"})
            self.assertEqual(plan["status"], "VERIFIED")
            steps = plan["trace"]["plan"]["steps"]
            groups = {s["workflow_group"] for s in steps}
            self.assertIn("domain_requirements", groups)
            self.assertIn("verification_testing", groups)
            ids = {s["step_id"] for s in steps}
            self.assertTrue(all(all(d in ids and d != s["step_id"] for d in s["depends_on"]) for s in steps))

        # Natural search intent matches explicit research queries without hijacking conceptual questions (RES-01)
        self.assertEqual(te.detect_tool_intent("รบกวนค้นหาข้อมูลเรื่อง PostgreSQL หน่อยครับ"), ("web_search", {"query": "PostgreSQL"}))
        self.assertEqual(te.detect_tool_intent("please search for Rust async runtime"), ("web_search", {"query": "Rust async runtime"}))
        self.assertIsNone(te.detect_tool_intent("ทฤษฎีสัมพัทธภาพทั่วไปคืออะไร"))

    def test_cross_module_integration_and_honest_evidence(self) -> None:
        import db_bridge  # noqa: E402
        from unittest.mock import patch  # noqa: E402

        with isolated_core_env():
            db_bridge.DB_PATH = zc.DB_PATH
            db_bridge.DATA_DIR = zc.DATA_DIR

            # 1. Dynamic entity multi-hop exact-match priority (Node1 must NOT start from Node10)
            for s, r, o in [
                ("Node1", "ต่อกับ", "Node2"),
                ("Node2", "ต่อกับ", "Node3"),
                ("Node10", "ต่อกับ", "DeadEnd"),
            ]:
                zc.handle_infer({"prompt": f"สอน: {s} -> {r} -> {o}", "mode": "knowledge", "user_id": "u"})
            p_exact = zc.handle_infer({"prompt": "เชื่อมโยง: Node1 -> Node3 หน่อยครับ", "mode": "auto", "user_id": "u"})
            self.assertEqual(p_exact["status"], "VERIFIED")
            self.assertEqual(p_exact["trace"]["graph_path"]["path"]["edges"][0]["from"], "Node1")

            # 2. Explicit mode="plan" with non-ML goal uses domain-adaptive planner (not MLOps fallback)
            p_mode = zc.handle_infer({"prompt": "สร้างระบบจองห้องประชุมออนไลน์", "mode": "plan", "user_id": "u"})
            self.assertEqual(p_mode["status"], "VERIFIED")
            self.assertEqual(p_mode["trace"]["plan"]["domain_mode"], "general_engineering")

            # 3. calc_ast tool integrates P2 quadratic & multivariate solvers
            conn = zc.get_db()
            calc_q = te.invoke_tool_governed(
                conn, zc.DATA_DIR, "calc_ast", {"expression": "x^2 - 7x + 12 = 0"}, user_id="u",
                tokenize_fn=zc.tokenize, extract_terms_fn=zc.extract_query_terms,
                query_kg_fn=zc.query_knowledge_graph, calc_fn=zc._calc_any_for_tool,
            )
            self.assertEqual(calc_q["status"], "COMPLETED")
            self.assertEqual(calc_q["raw_output"]["summary_tag"], "roots(3,4)")
            conn.close()

            # 4. Research approval flow persists conversation message with honest NOT_LEARNED on empty evidence
            user_res = db_bridge.handle_action(
                "auth_create_user",
                {"email": "admin@test.local", "display_name": "Admin", "role": "admin", "password_hash": "h"},
            )
            uid = user_res["user"]["id"]
            conv_res = db_bridge.handle_action("conv_create", {"user_id": uid, "title": "Research", "mode": "auto"})
            cid = conv_res["conversation"]["id"]

            infer_res = zc.handle_infer({
                "prompt": "ช่วยหาข้อมูลล่าสุดเกี่ยวกับเรื่อง NonExistentZyrquenToken999 ให้หน่อย",
                "mode": "auto",
                "user_id": uid,
                "conversation_id": cid,
            })
            self.assertEqual(infer_res["status"], "PENDING_APPROVAL")
            inv_id = infer_res["trace"]["external_tool"]["invocation_id"]

            with patch.object(te, "_run_web_search", return_value={"ok": True, "query": "NonExistent", "results": []}):
                decide_res = db_bridge.handle_action(
                    "admin_tool_decide",
                    {"invocation_id": inv_id, "decision": "approve", "admin_email": "admin@test.local"},
                )
            self.assertTrue(decide_res["ok"])
            conv_data = db_bridge.handle_action("conv_get", {"user_id": uid, "conversation_id": cid})
            last_msg = conv_data["messages"][-1]
            self.assertEqual(last_msg["status"], "NOT_LEARNED")
            self.assertIn("INSUFFICIENT_EVIDENCE", last_msg["content"])

    def test_conflicting_evidence_and_continuous_chain_resilience(self) -> None:
        import db_bridge  # noqa: E402
        from datetime import datetime, timezone  # noqa: E402

        with isolated_core_env():
            db_bridge.DB_PATH = zc.DB_PATH
            db_bridge.DATA_DIR = zc.DATA_DIR
            conn = zc.get_db()
            fresh_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            # 1a. Conflicting release year across two providers -> CONFLICTING_SOURCES (never VERIFIED)
            conflict_num = te.analyze_tool_result(
                conn,
                "web_search",
                {
                    "ok": True,
                    "results": [
                        {
                            "provider": "en.wikipedia.org",
                            "title": "ProtoDB",
                            "snippet": "ProtoDB engine released in 2001 for embedded analytics.",
                            "url": "https://en.wikipedia.org/wiki/ProtoDB",
                            "retrieved_at": fresh_ts,
                        },
                        {
                            "provider": "api.duckduckgo.com",
                            "title": "ProtoDB",
                            "snippet": "ProtoDB engine released in 2008 for embedded analytics.",
                            "url": "https://api.duckduckgo.com/?q=ProtoDB",
                            "retrieved_at": fresh_ts,
                        },
                    ],
                },
                zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
            )
            self.assertEqual(conflict_num["trust_grade"], "CONFLICTING_SOURCES")
            self.assertEqual(conflict_num["verification_status"], "CONFLICTING")
            self.assertGreaterEqual(len(conflict_num["conflicts"]), 1)

            # 1b. Conflicting polarity across providers -> CONFLICTING_SOURCES
            conflict_pol = te.analyze_tool_result(
                conn,
                "web_search",
                {
                    "ok": True,
                    "results": [
                        {
                            "provider": "en.wikipedia.org",
                            "title": "RuntimeX",
                            "snippet": "RuntimeX supports transactions by default.",
                            "url": "https://en.wikipedia.org/wiki/RuntimeX",
                            "retrieved_at": fresh_ts,
                        },
                        {
                            "provider": "api.duckduckgo.com",
                            "title": "RuntimeX",
                            "snippet": "RuntimeX does not support transactions cleanly.",
                            "url": "https://api.duckduckgo.com/?q=RuntimeX",
                            "retrieved_at": fresh_ts,
                        },
                    ],
                },
                zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
            )
            self.assertEqual(conflict_pol["trust_grade"], "CONFLICTING_SOURCES")

            # 1c. External claim contradicting internal KG numeric fact -> CONFLICTING_SOURCES
            zc.handle_infer({"prompt": "สอน: คาร์บอน -> มีเลขอะตอม -> 6", "mode": "knowledge", "user_id": "u"})
            conflict_kg = te.analyze_tool_result(
                conn,
                "web_search",
                {
                    "ok": True,
                    "results": [
                        {
                            "provider": "en.wikipedia.org",
                            "title": "คาร์บอน",
                            "snippet": "คาร์บอน มีเลขอะตอม 12 ในตารางธาตุ",
                            "url": "https://th.wikipedia.org/wiki/Carbon",
                            "retrieved_at": fresh_ts,
                        }
                    ],
                },
                zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
            )
            self.assertEqual(conflict_kg["trust_grade"], "CONFLICTING_SOURCES")

            # 1d. Non-overlapping attributes across providers (year vs version) -> CORROBORATED_MULTI_SOURCE
            agree_res = te.analyze_tool_result(
                conn,
                "web_search",
                {
                    "ok": True,
                    "results": [
                        {
                            "provider": "en.wikipedia.org",
                            "title": "SQLite",
                            "snippet": "SQLite database engine released in 2000.",
                            "url": "https://en.wikipedia.org/wiki/SQLite",
                            "retrieved_at": fresh_ts,
                        },
                        {
                            "provider": "api.duckduckgo.com",
                            "title": "SQLite",
                            "snippet": "SQLite database engine version 3.46.",
                            "url": "https://api.duckduckgo.com/?q=SQLite",
                            "retrieved_at": fresh_ts,
                        },
                    ],
                },
                zc.tokenize, zc.extract_query_terms, zc.query_knowledge_graph,
            )
            self.assertEqual(agree_res["trust_grade"], "CORROBORATED_MULTI_SOURCE")
            self.assertEqual(agree_res["conflicts"], [])
            conn.close()

            # 2. Continuous multi-module session chain on unseen domain data
            for edge in [("A1", "A2"), ("A2", "A3"), ("A3", "A4"), ("A4", "A5"), ("A5", "A6")]:
                self.assertEqual(
                    zc.handle_infer({"prompt": f"สอน: {edge[0]} -> ส่งต่อ -> {edge[1]}", "mode": "knowledge", "user_id": "u"})["status"],
                    "VERIFIED",
                )
            self.assertEqual(zc.handle_infer({"prompt": "เชื่อมโยง: A1 -> A6", "mode": "auto", "user_id": "u"})["trace"]["graph_path"]["path"]["hops"], 5)
            self.assertEqual(zc.handle_infer({"prompt": "ถ้า A1 > A3 และ A3 > A6 แล้ว A1 เทียบกับ A6 เป็นอย่างไร", "mode": "auto", "user_id": "u"})["trace"]["logic"]["derived_relation"], "A1 > A6")
            self.assertEqual(zc.handle_infer({"prompt": "แก้สมการ: x^2 - 9 = 0", "mode": "auto", "user_id": "u"})["trace"]["algebra"]["summary_tag"], "roots(-3,3)")
            self.assertEqual(zc.handle_infer({"prompt": "มีเอกสาร 36 หน้า แบ่งอ่าน 6 วันเท่าๆ กัน จะได้วันละกี่หน้า", "mode": "auto", "user_id": "u"})["trace"]["word_math"]["result"], 6)
            self.assertEqual(zc.handle_infer({"prompt": "สร้างระบบติดตามคำสั่งซื้อร้านค้า", "mode": "plan", "user_id": "u"})["trace"]["plan"]["domain_mode"], "general_engineering")


if __name__ == "__main__":
    unittest.main()
