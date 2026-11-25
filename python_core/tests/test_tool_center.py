"""Comprehensive real runtime tests for ZYRQUEN Tool Center (8 Toolkits),
10 Background Support Systems, and Autonomous Software Engineering Benchmark.
Pure Python 3.11 stdlib, zero mocks for core execution, zero external LLMs.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
PYTHON_CORE_DIR = TESTS_DIR.parent
REPO_ROOT = PYTHON_CORE_DIR.parent
for _p in (str(REPO_ROOT), str(PYTHON_CORE_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import zyrquen_core as zc  # noqa: E402
from tool_center import (  # noqa: E402
    ContextManager,
    ResourceBudget,
    ResourceManager,
    ToolDependencyManager,
    WorkspaceTransaction,
    classify_error,
    decide_improvement_proposal,
    execute_orchestrated_plan,
    get_tool_center_registry,
    init_tool_center_schema,
    run_autonomous_repair_loop,
    run_engineering_benchmark,
    run_python_sandbox,
    run_self_improvement_evaluation,
    run_workspace_unittest,
    select_tools_for_goal,
    verify_capability_delivery,
)
from tool_center.contracts import CapabilitySpec  # noqa: E402
from tool_center.dependency_manager import satisfies_semver  # noqa: E402


class ToolCenterAndSupportSystemsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="zyrquen_tc_test_")
        self.data_dir = Path(self._tmp.name)
        self.db_path = self.data_dir / "test_zyrquen.db"
        self._prev_data_dir = os.environ.get("ZYRQUEN_DATA_DIR")
        os.environ["ZYRQUEN_DATA_DIR"] = str(self.data_dir)
        zc.DATA_DIR = self.data_dir
        zc.CHECKPOINT_DIR = self.data_dir / "checkpoints"
        zc.DB_PATH = self.db_path
        zc.init_db()
        self.conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        self.conn.row_factory = sqlite3.Row
        init_tool_center_schema(self.conn)
        self.registry = get_tool_center_registry()

    def tearDown(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass
        if self._prev_data_dir is None:
            os.environ.pop("ZYRQUEN_DATA_DIR", None)
        else:
            os.environ["ZYRQUEN_DATA_DIR"] = self._prev_data_dir
        self._tmp.cleanup()

    def test_all_8_toolkits_registered_and_verified(self) -> None:
        toolkits = self.registry.list_toolkits(user_role="admin")
        ids = {t["id"] for t in toolkits}
        self.assertEqual(
            ids,
            {
                "development",
                "data",
                "research",
                "testing",
                "automation",
                "document",
                "api_integration",
                "security",
            },
        )
        rep = self.registry.verify_toolkit(conn=self.conn, data_dir=self.data_dir)
        self.assertTrue(rep["ok"])
        self.assertEqual(rep["status"], "VERIFIED")
        self.assertFalse(rep["external_models_used"])
        self.assertEqual(rep["passed"], rep["total"])

    def test_in_development_fail_closed_and_git_inspect_honest(self) -> None:
        build_res = self.registry.execute(
            "development.build_validate",
            {"specification": {}, "manifest": {}},
            user_role="user",
            conn=self.conn,
            data_dir=self.data_dir,
        )
        self.assertFalse(build_res["ok"])
        self.assertEqual(build_res["status"], "BLOCKED")
        self.assertEqual(build_res["qa"]["verdict"], "UNVERIFIED")

        bin_doc = self.registry.execute(
            "document.binary_office_parser",
            {"format": "pdf", "filename": "test.pdf"},
            user_role="admin",
            conn=self.conn,
            data_dir=self.data_dir,
        )
        self.assertFalse(bin_doc["ok"])
        self.assertEqual(bin_doc["status"], "BLOCKED")
        self.assertEqual(bin_doc["qa"]["verdict"], "UNVERIFIED")

        git_res = self.registry.execute(
            "development.git_inspect",
            {"limit": 3},
            user_role="user",
            conn=self.conn,
            data_dir=self.data_dir,
        )
        self.assertTrue(git_res["ok"])
        self.assertIn("git_available", git_res["output"])

    def test_p5_approval_gate_and_admin_decide_invocation(self) -> None:
        pending = self.registry.execute(
            "api_integration.webhook_dispatch",
            {"url": "https://en.wikipedia.org/wiki/Webhook", "body": {"event": "ci_check"}, "dry_run": True},
            user_id="user-1",
            user_role="user",
            conn=self.conn,
            data_dir=self.data_dir,
        )
        self.assertTrue(pending["ok"])
        self.assertEqual(pending["status"], "PENDING_APPROVAL")
        inv_id = pending["invocation_id"]

        approved = self.registry.decide_invocation(
            self.conn,
            invocation_id=inv_id,
            decision="approve",
            admin_email="admin@zyrquen.local",
            data_dir=self.data_dir,
        )
        self.assertTrue(approved["ok"])
        self.assertEqual(approved["status"], "COMPLETED")
        self.assertTrue(approved["output"]["dry_run"])

        audits = self.conn.execute(
            "SELECT action, target, outcome FROM audit_logs WHERE target LIKE '%api_integration.webhook_dispatch%'"
        ).fetchall()
        self.assertGreaterEqual(len(audits), 2)

    def test_dependency_manager_semver_waves_and_cycles(self) -> None:
        self.assertTrue(satisfies_semver("1.2.0", ">=", "1.0.0"))
        self.assertFalse(satisfies_semver("0.9.0", ">=", "1.0.0"))
        self.assertTrue(satisfies_semver("1.4.2", "^", "1.0.0"))
        self.assertFalse(satisfies_semver("2.0.0", "^", "1.0.0"))

        dep_mgr = ToolDependencyManager()
        env_rep = dep_mgr.check_environment(self.registry)
        # Note: build_validation / binary_office_parser are IN_DEVELOPMENT (not missing deps on ready caps)
        self.assertGreater(env_rep["capabilities_checked"], 15)

        waves_ok = dep_mgr.plan_execution_waves(
            [
                {"step_id": "s1", "capability_id": "data.calc_ast", "depends_on": []},
                {"step_id": "s2", "capability_id": "development.code_analysis", "depends_on": []},
                {"step_id": "s3", "capability_id": "testing.contract_assertion", "depends_on": ["s1", "s2"]},
            ],
            registry=self.registry,
        )
        self.assertTrue(waves_ok["ok"])
        self.assertEqual(waves_ok["wave_count"], 2)
        self.assertEqual(len(waves_ok["waves"][0]), 2)

        waves_cycle = dep_mgr.plan_execution_waves(
            [
                {"step_id": "a", "capability_id": "data.calc_ast", "depends_on": ["b"]},
                {"step_id": "b", "capability_id": "data.calc_ast", "depends_on": ["a"]},
            ],
            registry=self.registry,
        )
        self.assertFalse(waves_cycle["ok"])
        self.assertIn("Cycle", waves_cycle["error"])

    def test_context_manager_scoping_and_secret_redaction(self) -> None:
        spec = self.registry.get_spec("data.calc_ast")
        assert spec is not None
        ctx_mgr = ContextManager()
        built = ctx_mgr.build_scoped_input(
            spec,
            {"expression": "6 * 7", "unused_dump": "A" * 500, "token": "sk-1234567890abcdefghij"},
            shared_context={"password": "secret", "goal": "ignored"},
        )
        self.assertEqual(built["scoped_input"], {"expression": "6 * 7"})
        self.assertIn("unused_dump", built["footprint"]["pruned_keys"])
        self.assertIn("token", built["footprint"]["pruned_keys"])

        # Redact inline secrets inside declared string fields
        spec_code = self.registry.get_spec("development.code_analysis")
        assert spec_code is not None
        built_red = ctx_mgr.build_scoped_input(
            spec_code,
            {"language": "python", "source": "KEY = 'sk-1234567890abcdefghij'\n"},
        )
        self.assertNotIn("sk-1234567890", built_red["scoped_input"]["source"])
        self.assertGreaterEqual(built_red["footprint"]["redacted_count"], 1)

    def test_isolated_sandbox_policy_blocks_and_runs_clean(self) -> None:
        # Blocks prohibited external AI & OS shell imports
        blocked_llm = run_python_sandbox("import openai\nprint('x')")
        self.assertFalse(blocked_llm["ok"])
        self.assertEqual(blocked_llm["status"], "BLOCKED")

        blocked_os = run_python_sandbox("import os\nprint(os.environ)")
        self.assertFalse(blocked_os["ok"])
        self.assertEqual(blocked_os["status"], "BLOCKED")

        # Runs clean pure-Python code isolated
        ok_res = run_python_sandbox("data = [10, 20, 30]\nprint(sum(data))")
        self.assertTrue(ok_res["ok"])
        self.assertEqual(ok_res["stdout"], "60")
        self.assertTrue(ok_res["sandbox_isolated"])
        self.assertFalse(ok_res["external_models_used"])

        # Timeout guard
        timeout_res = run_python_sandbox("while True:\n    pass\n", timeout_s=0.3)
        self.assertFalse(timeout_res["ok"])
        self.assertTrue(timeout_res["timed_out"])
        self.assertEqual(timeout_res.get("error_code"), "TIMEOUT")

    def test_resource_manager_thresholds_and_qa_engine(self) -> None:
        low_ram_mgr = ResourceManager(ResourceBudget(min_free_ram_mb=999_999_999.0))
        admit_fail = low_ram_mgr.evaluate_admission(requested_workers=1)
        self.assertFalse(admit_fail["allowed"])
        self.assertEqual(admit_fail["error_code"], "RESOURCE_LIMIT")

        # QA blocks output containing raw secret
        spec = self.registry.get_spec("data.calc_ast")
        qa_secret = verify_capability_delivery(
            spec,
            {
                "ok": True,
                "status": "COMPLETED",
                "output": {"result": 42, "expression": "sk-1234567890abcdefghij"},
                "external_models_used": False,
            },
        )
        self.assertEqual(qa_secret["verdict"], "FAILED")
        self.assertFalse(qa_secret["passed"])

    def test_parallel_orchestrator_idempotency_recovery_and_task_memory(self) -> None:
        # Step 1 & Step 2 in wave 1 (parallel), Step 3 in wave 2 depending on both
        res = execute_orchestrated_plan(
            self.registry,
            "คำนวณ AST และวิเคราะห์โครงสร้างโค้ดพร้อมตรวจ Assertion",
            [
                {
                    "step_id": "calc",
                    "capability_id": "data.calc_ast",
                    "input": {"expression": "(5 + 7) * 3"},
                    "depends_on": [],
                },
                {
                    "step_id": "code",
                    "capability_id": "development.code_analysis",
                    "input": {"language": "python", "source": "def f(x):\n    return x * 2\n"},
                    "depends_on": [],
                },
                {
                    "step_id": "qa_check",
                    "capability_id": "testing.contract_assertion",
                    "input": {"cases": [{"name": "math_ok", "op": "gt", "actual": 36, "expected": 0}]},
                    "depends_on": ["calc", "code"],
                },
            ],
            conn=self.conn,
            data_dir=self.data_dir,
            user_id="tester",
            user_role="admin",
            idempotency_scope="scope-parallel-001",
            enable_parallel=True,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["delivery_verdict"], "SUCCESS")
        self.assertEqual(res["waves"][0]["mode"], "parallel")
        self.assertEqual(res["qa_summary"]["steps_verified"], 3)
        self.assertFalse(res["external_models_used"])

        # Re-running with same idempotency_scope replays cached verified run without duplicate execution
        replay = execute_orchestrated_plan(
            self.registry,
            "คำนวณ AST และวิเคราะห์โครงสร้างโค้ดพร้อมตรวจ Assertion",
            [{"step_id": "calc", "capability_id": "data.calc_ast", "input": {"expression": "(5 + 7) * 3"}}],
            conn=self.conn,
            data_dir=self.data_dir,
            idempotency_scope="scope-parallel-001",
        )
        self.assertTrue(replay.get("idempotent_replay"))
        self.assertEqual(replay["run_id"], res["run_id"])

        # Verify Task Memory was persisted & improves Tool Selection hints
        sel = select_tools_for_goal(self.registry, "คำนวณ AST และวิเคราะห์โครงสร้างโค้ด", conn=self.conn, user_role="admin")
        self.assertGreaterEqual(sel["task_memory_hints"]["success_examples_count"], 1)

        # Verify Recovery classifies errors & switches cleanly when fallback_capabilities supplied
        err_code, _ = classify_error({"status": "FAILED", "error": "Missing required input field 'expression'"})
        self.assertEqual(err_code, "INVALID_INPUT")

        fail_res = execute_orchestrated_plan(
            self.registry,
            "ทดสอบ Recovery เมื่อขั้นตอนล้มเหลว",
            [
                {
                    "step_id": "fail_step",
                    "capability_id": "data.calc_ast",
                    "input": {"expression": "not_valid_math_$$$"},
                    "depends_on": [],
                }
            ],
            conn=self.conn,
            data_dir=self.data_dir,
            user_role="admin",
        )
        self.assertFalse(fail_res["ok"])
        self.assertEqual(fail_res["delivery_verdict"], "FAILED")

    def test_self_improvement_governance_and_approval_gate(self) -> None:
        ev = run_self_improvement_evaluation(
            self.conn,
            self.registry,
            data_dir=self.data_dir,
            user_id="admin-1",
        )
        self.assertTrue(ev["ok"])
        self.assertTrue(ev["approval_required"])
        self.assertFalse(ev["model_weights_mutated"])
        self.assertFalse(ev["regression_detected"])
        self.assertTrue(ev["improved"])
        prop_id = ev["proposal"]["id"]
        self.assertEqual(ev["proposal"]["approval_status"], "PENDING_APPROVAL")

        dec = decide_improvement_proposal(
            self.conn,
            proposal_id=prop_id,
            decision="approve",
            admin_email="admin@zyrquen.local",
            admin_id="admin-1",
            reason="Sandbox trial passed with zero regression",
        )
        self.assertTrue(dec["ok"])
        self.assertEqual(dec["status"], "APPROVED")
        self.assertFalse(dec["model_weights_mutated"])

    def test_autonomous_software_engineering_repair_loop_and_benchmark(self) -> None:
        # Direct syntax-bug repair test
        ws = self.data_dir / "eng_syntax_ws"
        ws.mkdir(parents=True, exist_ok=True)
        (ws / "broken_mod.py").write_text("def double(n)\n    return n * 2\n", encoding="utf-8")
        (ws / "test_broken.py").write_text(
            "import unittest\nfrom broken_mod import double\n\n"
            "class T(unittest.TestCase):\n"
            "    def test_double(self):\n"
            "        self.assertEqual(double(9), 18)\n",
            encoding="utf-8",
        )
        loop_res = run_autonomous_repair_loop(ws, goal="Repair syntax error in broken_mod.py", max_repair_rounds=2)
        self.assertTrue(loop_res["ok"])
        self.assertEqual(loop_res["status"], "VERIFIED")
        self.assertEqual(loop_res["test_evidence"]["returncode"], 0)
        self.assertIn("def double(n):", (ws / "broken_mod.py").read_text(encoding="utf-8"))

        # Run full 6-task real Software Engineering Benchmark
        bench = run_engineering_benchmark(self.registry, conn=self.conn, data_dir=self.data_dir)
        self.assertTrue(bench["ok"])
        self.assertEqual(bench["status"], "VERIFIED")
        self.assertEqual(bench["passed"], bench["total"])
        self.assertEqual(bench["metrics"]["success_rate"], 1.0)
        self.assertEqual(bench["metrics"]["regression_rate"], 0.0)
        self.assertFalse(bench["external_models_used"])


if __name__ == "__main__":
    unittest.main()
