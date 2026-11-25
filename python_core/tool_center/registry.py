"""
ZYRQUEN Tool Center & Central Capability Library Registry
-------------------------------------------------------
Architecture Principle: Build Once -> Register Once -> Reuse Everywhere.
Connects modular Toolkits to Studio, Projects, and Agents with contract validation,
dependency verification, version traceability, RBAC/Approval Gate, and real probes.
"""

from __future__ import annotations

import importlib
import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from .context_manager import ContextManager
from .contracts import (
    ALLOWED_LIFECYCLE_STATUSES,
    ALLOWED_PERMISSION_MODES,
    ALLOWED_RISK_TIERS,
    CapabilityExecutionResult,
    CapabilityHandle,
    CapabilitySpec,
    ToolContractError,
    ToolkitManifest,
    evaluate_capability_permission,
    validate_capability_input,
    validate_capability_output,
)
from .dependency_manager import ToolDependencyManager
from .quality_assurance import verify_capability_delivery
from .recovery import init_orchestration_schema
from .self_improvement import init_self_improvement_schema
from .task_memory import init_task_memory_schema
from .toolkits import (
    register_api_integration_toolkit,
    register_automation_toolkit,
    register_data_toolkit,
    register_development_toolkit,
    register_document_toolkit,
    register_research_toolkit,
    register_security_toolkit,
    register_testing_toolkit,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PYTHON_CORE_DIR = Path(__file__).resolve().parent.parent


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def init_tool_center_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS tool_center_invocations (
            id TEXT PRIMARY KEY,
            toolkit_id TEXT NOT NULL,
            capability_id TEXT NOT NULL,
            capability_version TEXT NOT NULL,
            user_id TEXT NOT NULL,
            project_id TEXT,
            conversation_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('PENDING_APPROVAL', 'COMPLETED', 'REJECTED', 'FAILED', 'BLOCKED')),
            input_json TEXT NOT NULL,
            output_json TEXT,
            summary TEXT,
            approved_by TEXT,
            latency_ms REAL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tool_center_inv_user
            ON tool_center_invocations (user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tool_center_inv_cap
            ON tool_center_invocations (capability_id, created_at DESC);
        """
    )
    init_task_memory_schema(conn)
    init_orchestration_schema(conn)
    init_self_improvement_schema(conn)


def _log_center_audit(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    action: str,
    target: str,
    outcome: str,
    details: dict[str, Any] | None = None,
) -> None:
    actor_email = "system"
    if user_id:
        row = conn.execute("SELECT email FROM users WHERE id=?", (user_id,)).fetchone()
        if row:
            actor_email = row["email"]
    conn.execute(
        """
        INSERT INTO audit_logs (id, actor_id, actor_email, action, target, outcome, details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()),
            user_id or "system",
            actor_email,
            action,
            target,
            outcome,
            json.dumps(details or {}, ensure_ascii=False),
            _now_iso(),
        ),
    )


class ToolCenterRegistry:
    """Central registry holding all ZYRQUEN Toolkits & Capabilities."""

    def __init__(self) -> None:
        self._toolkits: dict[str, ToolkitManifest] = {}
        self._capabilities: dict[str, CapabilitySpec] = {}
        self._handlers: dict[str, Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]] = {}
        self._toolkit_caps: dict[str, list[str]] = {}

    def register_toolkit(
        self,
        manifest: ToolkitManifest,
        capabilities: list[tuple[CapabilitySpec, Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]]],
    ) -> None:
        if manifest.id in self._toolkits:
            raise ToolContractError(f"Duplicate toolkit registration: {manifest.id}")
        if manifest.lifecycle_status not in ALLOWED_LIFECYCLE_STATUSES:
            raise ToolContractError(f"Invalid toolkit lifecycle_status: {manifest.lifecycle_status}")
        self._toolkits[manifest.id] = manifest
        self._toolkit_caps[manifest.id] = []

        for spec, handler in capabilities:
            if spec.toolkit_id != manifest.id:
                raise ToolContractError(
                    f"Capability '{spec.id}' toolkit_id '{spec.toolkit_id}' != '{manifest.id}'"
                )
            if spec.id in self._capabilities:
                raise ToolContractError(f"Duplicate capability registration: {spec.id}")
            if spec.permission_mode not in ALLOWED_PERMISSION_MODES:
                raise ToolContractError(f"Invalid permission_mode on '{spec.id}': {spec.permission_mode}")
            if spec.risk_tier not in ALLOWED_RISK_TIERS:
                raise ToolContractError(f"Invalid risk_tier on '{spec.id}': {spec.risk_tier}")
            if spec.lifecycle_status not in ALLOWED_LIFECYCLE_STATUSES:
                raise ToolContractError(f"Invalid lifecycle_status on '{spec.id}': {spec.lifecycle_status}")
            if not callable(handler):
                raise ToolContractError(f"Handler for '{spec.id}' must be callable")
            self._capabilities[spec.id] = spec
            self._handlers[spec.id] = handler
            self._toolkit_caps[manifest.id].append(spec.id)

    def resolve(self, capability_id: str) -> CapabilityHandle:
        if capability_id not in self._capabilities:
            raise KeyError(f"Capability '{capability_id}' is not registered in Tool Center")
        spec = self._capabilities[capability_id]
        manifest = self._toolkits[spec.toolkit_id]
        return CapabilityHandle(
            spec=spec,
            manifest=manifest,
            handler=self._handlers[capability_id],
            registry=self,
        )

    def get_spec(self, capability_id: str) -> CapabilitySpec | None:
        return self._capabilities.get(capability_id)

    def list_capability_ids(self) -> list[str]:
        return list(self._capabilities.keys())

    def check_dependencies(self, capability_id: str) -> dict[str, Any]:
        return ToolDependencyManager().check_capability(self, capability_id)

    def list_toolkits(self, *, user_role: str = "user") -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for tid, manifest in self._toolkits.items():
            cap_ids = self._toolkit_caps.get(tid, [])
            caps = []
            ready_count = 0
            dev_count = 0
            for cid in cap_ids:
                spec = self._capabilities[cid]
                if spec.lifecycle_status == "READY":
                    ready_count += 1
                elif spec.lifecycle_status == "IN_DEVELOPMENT":
                    dev_count += 1
                perm = evaluate_capability_permission(spec, user_role)
                caps.append({
                    **spec.to_dict(),
                    "role_policy": perm,
                    "dependency_check": self.check_dependencies(cid),
                })
            out.append({
                **manifest.to_dict(),
                "capability_count": len(caps),
                "ready_count": ready_count,
                "in_development_count": dev_count,
                "capabilities": caps,
            })
        return out

    def get_toolkit(self, toolkit_id: str, *, user_role: str = "user") -> dict[str, Any] | None:
        for tk in self.list_toolkits(user_role=user_role):
            if tk["id"] == toolkit_id:
                return tk
        return None

    def audit_repository_inventory(self) -> list[dict[str, Any]]:
        """Honest inventory of existing repository modules bound into Tool Center vs placeholders."""
        candidates = [
            (
                "apps/core/intelligence/static_validation.py",
                "development",
                "development.code_analysis",
                "BOUND_READY",
                "Python AST static syntax validator (no execution).",
            ),
            (
                "apps/core/intelligence/code_contract.py",
                "development",
                "development.contract_validate",
                "BOUND_READY",
                "Strict CodeTask & CodeOutput validation + path safety.",
            ),
            (
                "apps/core/intelligence/build_validation.py",
                "development",
                "development.build_validate",
                "IN_DEVELOPMENT",
                "Fail-closed placeholder: build backend not yet implemented.",
            ),
            (
                "apps/core/dataset_leakage_detector.py",
                "data",
                "data.leakage_check",
                "BOUND_READY",
                "Semantic Hashing + Exact + Slot-Masked Leakage Detector.",
            ),
            (
                "python_core/dataset_ingestion.py",
                "data",
                "data.profile_structured",
                "BOUND_READY",
                "Dataset pipeline + SHA-256 verification.",
            ),
            (
                "apps/core/intelligence/research.py",
                "research",
                "research.evidence_corroborate",
                "BOUND_READY",
                "SSRF URL guard + multi-source corroboration + injection defense.",
            ),
            (
                "python_core/tools_engine.py",
                "research",
                "research.web_search",
                "BOUND_READY",
                "P5 Approval-gated public web_search, doc_fetch, and workspace sandbox.",
            ),
            (
                "python_core/capability_verifier.py",
                "testing",
                "testing.toolkit_self_test",
                "BOUND_READY",
                "7-state real capability verifier (anti-self-assessment).",
            ),
            (
                "python_core/zyrquen_core.py",
                "document",
                "document.conversation_summary",
                "BOUND_READY",
                "Deterministic summarizer + AST math/algebra/stats engine.",
            ),
            (
                "apps/core/intelligence/cognitive_core.py",
                "security",
                "security.native_policy_audit",
                "BOUND_READY",
                "Prohibited external LLM module/package scanner.",
            ),
            (
                "apps/core/intelligence/tool_registry.py",
                "registry",
                None,
                "SUPERSEDED_METADATA_ONLY",
                "In-memory metadata-only stub in apps/core; bridged by ToolCenterRegistry.",
            ),
            (
                "python_core/dag_executor.py",
                "automation",
                "automation.workflow_execute",
                "BOUND_READY",
                "Resumable 11-state DAG mission executor & recovery loop.",
            ),
            (
                "server.ts",
                "api_integration",
                "api_integration.internal_health",
                "BOUND_READY",
                "Express API gateway & Python NDJSON worker bridge.",
            ),
            (
                "python_core/tool_center/orchestrator.py",
                "automation",
                "automation.task_compose",
                "BOUND_READY",
                "Background Tool Selection, Dependency, Context, Parallel, Recovery & QA orchestrator.",
            ),
            (
                "python_core/tool_center/sandbox.py",
                "testing",
                "testing.sandbox_run",
                "BOUND_READY",
                "Isolated subprocess Python sandbox with AST guard, clean env, and rlimits.",
            ),
        ]
        inventory: list[dict[str, Any]] = []
        for rel_path, toolkit_id, cap_id, status, note in candidates:
            exists = (REPO_ROOT / rel_path).exists()
            inventory.append({
                "module_path": rel_path,
                "exists_on_disk": exists,
                "toolkit_id": toolkit_id,
                "bound_capability_id": cap_id,
                "status": status if exists else "MISSING_ON_DISK",
                "note": note,
            })
        return inventory

    def compose_for_goal(
        self,
        goal: str,
        *,
        user_role: str = "user",
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        """
        Studio Capability Composer powered by Tool Intelligence & Selection:
        1. Searches registered READY capabilities matching the goal (+ Task Memory + Dependencies + Resource headroom).
        2. Reuses existing capabilities instead of duplicating modules.
        3. Separates IN_DEVELOPMENT capabilities from READY ones.
        4. Discloses unmatched gaps honestly if no existing capability covers a part of the goal.
        """
        from .orchestrator import select_tools_for_goal

        clean_goal = str(goal or "").strip()
        lowered = clean_goal.lower()
        sel = select_tools_for_goal(self, clean_goal, conn=conn, user_role=user_role, max_candidates=10)
        matched_ready = sel["selected_capabilities"]

        proposed_gaps: list[dict[str, str]] = []
        if any(w in lowered for w in ("deploy", "docker", "kubernetes", "ci/cd", "ปรับใช้", "build_validate")):
            proposed_gaps.append({
                "gap": "automated_build_or_deploy",
                "reason": "BuildValidationInterface is still IN_DEVELOPMENT (fail-closed) and no deployment runner is enabled without approval.",
            })
        if not matched_ready and clean_goal:
            proposed_gaps.append({
                "gap": "no_exact_ready_capability_match",
                "reason": f"ไม่พบความสามารถ READY ที่ตรงกับ '{clean_goal[:80]}' โดยตรง — สามารถเสนอสร้าง Capability ใหม่และทดสอบก่อนอนุมัติ",
            })

        return {
            "ok": True,
            "goal": clean_goal,
            "principle": "Build Once -> Register Once -> Reuse Everywhere",
            "reuse_existing_count": sel["reuse_existing_count"],
            "selected_toolkits": sel["selected_toolkits"],
            "selected_capabilities": matched_ready,
            "in_development_candidates": sel["in_development_candidates"],
            "blocked_candidates": sel["blocked_candidates"],
            "task_memory_hints": sel["task_memory_hints"],
            "resource_admission": sel["resource_admission"],
            "proposed_gaps": proposed_gaps,
            "duplicate_creation_blocked": len(matched_ready) > 0,
        }

    def execute(
        self,
        capability_id: str,
        payload: dict[str, Any] | None = None,
        *,
        user_id: str = "system",
        user_role: str = "user",
        conn: sqlite3.Connection | None = None,
        data_dir: Path | None = None,
        approved_by: str | None = None,
        project_id: str | None = None,
        conversation_id: str | None = None,
        existing_invocation_id: str | None = None,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        if capability_id not in self._capabilities:
            return CapabilityExecutionResult(
                ok=False,
                capability_id=capability_id,
                capability_version="0.0.0",
                toolkit_id="unknown",
                status="FAILED",
                error=f"Unknown capability '{capability_id}'.",
            ).to_dict()

        spec = self._capabilities[capability_id]
        handler = self._handlers[capability_id]

        resolved_data_dir = Path(data_dir) if data_dir is not None else (PYTHON_CORE_DIR / "data")
        resolved_data_dir.mkdir(parents=True, exist_ok=True)

        # 1. Input Contract Validation
        valid_in, err_in, norm_input = validate_capability_input(spec, payload)
        if not valid_in:
            res_err = CapabilityExecutionResult(
                ok=False,
                capability_id=spec.id,
                capability_version=spec.version,
                toolkit_id=spec.toolkit_id,
                status="FAILED",
                error=err_in,
            ).to_dict()
            res_err["qa"] = verify_capability_delivery(spec, res_err, data_dir=resolved_data_dir)
            return res_err

        # 2. Dependency Check
        dep_status = self.check_dependencies(spec.id)
        if not dep_status["ok"]:
            res_dep = CapabilityExecutionResult(
                ok=False,
                capability_id=spec.id,
                capability_version=spec.version,
                toolkit_id=spec.toolkit_id,
                status="BLOCKED",
                error=f"Missing dependencies for '{spec.id}': {', '.join(dep_status['missing'])}",
                evidence={"dependency_check": dep_status},
            ).to_dict()
            res_dep["qa"] = verify_capability_delivery(spec, res_dep, data_dir=resolved_data_dir)
            return res_dep

        # 3. Permission & Lifecycle Check
        perm = evaluate_capability_permission(spec, user_role, approved_by=approved_by)
        if not perm["allowed"]:
            if conn is not None:
                init_tool_center_schema(conn)
                with conn:
                    _log_center_audit(
                        conn,
                        user_id=user_id,
                        action="TOOL_CENTER_BLOCKED",
                        target=f"{spec.id}@{spec.version}",
                        outcome="BLOCKED",
                        details={"reason": perm["reason"]},
                    )
            res_blocked = CapabilityExecutionResult(
                ok=False,
                capability_id=spec.id,
                capability_version=spec.version,
                toolkit_id=spec.toolkit_id,
                status="BLOCKED",
                error=perm["reason"],
            ).to_dict()
            res_blocked["qa"] = verify_capability_delivery(spec, res_blocked, data_dir=resolved_data_dir)
            return res_blocked
        inv_id = existing_invocation_id or str(uuid.uuid4())
        now = _now_iso()

        # Note: research.web_search / research.doc_fetch delegate P5 gate to tools_engine OR Tool Center P5 gate
        if perm["requires_approval"] and spec.id not in {"research.web_search", "research.doc_fetch"}:
            if conn is not None:
                init_tool_center_schema(conn)
                with conn:
                    conn.execute(
                        """
                        INSERT INTO tool_center_invocations (
                            id, toolkit_id, capability_id, capability_version, user_id,
                            project_id, conversation_id, status, input_json, output_json,
                            summary, approved_by, latency_ms, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, NULL, ?, NULL, 0, ?, ?)
                        """,
                        (
                            inv_id,
                            spec.toolkit_id,
                            spec.id,
                            spec.version,
                            user_id,
                            project_id,
                            conversation_id,
                            json.dumps(norm_input, ensure_ascii=False),
                            perm["reason"],
                            now,
                            now,
                        ),
                    )
                    _log_center_audit(
                        conn,
                        user_id=user_id,
                        action="TOOL_CENTER_PENDING_APPROVAL",
                        target=f"{spec.id}@{spec.version}",
                        outcome="PENDING_APPROVAL",
                        details={"invocation_id": inv_id},
                    )
            return {
                **CapabilityExecutionResult(
                    ok=True,
                    capability_id=spec.id,
                    capability_version=spec.version,
                    toolkit_id=spec.toolkit_id,
                    status="PENDING_APPROVAL",
                    summary=perm["reason"],
                    evidence={"invocation_id": inv_id, "requires_approval": True},
                ).to_dict(),
                "invocation_id": inv_id,
            }

        # 4. Execute Real Capability Handler
        ctx = {
            "user_id": user_id,
            "user_role": user_role,
            "conn": conn,
            "data_dir": resolved_data_dir,
            "approved_by": approved_by,
            "project_id": project_id,
            "conversation_id": conversation_id,
            "registry": self,
        }
        try:
            raw_res = handler(norm_input, ctx)
        except Exception as exc:
            raw_res = {"ok": False, "status": "FAILED", "error": str(exc), "output": {}}

        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        status = str(raw_res.get("status") or ("COMPLETED" if raw_res.get("ok") else "FAILED"))
        output = raw_res.get("output") if isinstance(raw_res.get("output"), dict) else {}
        summary = str(raw_res.get("summary") or "")
        err_msg = raw_res.get("error")

        # 5. Output Contract Validation on COMPLETED responses
        if raw_res.get("ok") and status == "COMPLETED":
            valid_out, err_out = validate_capability_output(spec, output)
            if not valid_out:
                raw_res["ok"] = False
                status = "FAILED"
                err_msg = err_out

        # 6. Persist Invocation + Version Traceability + Audit Log
        if conn is not None:
            init_tool_center_schema(conn)
            with conn:
                if existing_invocation_id:
                    conn.execute(
                        """
                        UPDATE tool_center_invocations
                        SET status=?, output_json=?, summary=?, approved_by=?, latency_ms=?, updated_at=?
                        WHERE id=?
                        """,
                        (
                            status,
                            json.dumps(output, ensure_ascii=False),
                            summary or (str(err_msg) if err_msg else status),
                            approved_by,
                            latency_ms,
                            _now_iso(),
                            inv_id,
                        ),
                    )
                else:
                    conn.execute(
                        """
                        INSERT INTO tool_center_invocations (
                            id, toolkit_id, capability_id, capability_version, user_id,
                            project_id, conversation_id, status, input_json, output_json,
                            summary, approved_by, latency_ms, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            inv_id,
                            spec.toolkit_id,
                            spec.id,
                            spec.version,
                            user_id,
                            project_id,
                            conversation_id,
                            status,
                            json.dumps(norm_input, ensure_ascii=False),
                            json.dumps(output, ensure_ascii=False),
                            summary or (str(err_msg) if err_msg else status),
                            approved_by,
                            latency_ms,
                            now,
                            _now_iso(),
                        ),
                    )
                _log_center_audit(
                    conn,
                    user_id=user_id,
                    action="TOOL_CENTER_EXECUTE",
                    target=f"{spec.id}@{spec.version}",
                    outcome=status,
                    details={"invocation_id": inv_id, "toolkit_id": spec.toolkit_id, "latency_ms": latency_ms},
                )

        out_payload = {
            **CapabilityExecutionResult(
                ok=bool(raw_res.get("ok")),
                capability_id=spec.id,
                capability_version=spec.version,
                toolkit_id=spec.toolkit_id,
                status=status,
                output=output,
                summary=summary,
                error=str(err_msg) if err_msg else None,
                evidence={
                    "invocation_id": inv_id,
                    "capability_version": spec.version,
                    "latency_ms": latency_ms,
                    "dependency_check": dep_status,
                },
            ).to_dict(),
            "invocation_id": inv_id,
            "latency_ms": latency_ms,
        }
        out_payload["qa"] = verify_capability_delivery(spec, out_payload, data_dir=resolved_data_dir)
        return out_payload

    def decide_invocation(
        self,
        conn: sqlite3.Connection,
        *,
        invocation_id: str,
        decision: str,
        admin_email: str,
        data_dir: Path | None = None,
    ) -> dict[str, Any]:
        """Admin P5 Approval Gate decision handler for pending tool_center_invocations."""
        init_tool_center_schema(conn)
        row = conn.execute(
            "SELECT * FROM tool_center_invocations WHERE id=?",
            (invocation_id,),
        ).fetchone()
        if not row:
            return {"ok": False, "error": "Tool Center invocation not found"}
        if row["status"] != "PENDING_APPROVAL":
            return {"ok": False, "error": "Tool Center invocation is not pending approval"}

        if decision == "reject":
            with conn:
                conn.execute(
                    """
                    UPDATE tool_center_invocations
                    SET status='REJECTED', approved_by=?, summary=?, updated_at=?
                    WHERE id=?
                    """,
                    (admin_email, f"Rejected by admin ({admin_email})", _now_iso(), invocation_id),
                )
                _log_center_audit(
                    conn,
                    user_id=row["user_id"],
                    action="TOOL_CENTER_GATE_REJECT",
                    target=f"{row['capability_id']}@{row['capability_version']}",
                    outcome="REJECTED",
                    details={"invocation_id": invocation_id, "admin_email": admin_email},
                )
            updated = dict(conn.execute("SELECT * FROM tool_center_invocations WHERE id=?", (invocation_id,)).fetchone())
            return {"ok": True, "status": "REJECTED", "invocation": updated}

        try:
            payload = json.loads(row["input_json"] or "{}")
        except Exception:
            payload = {}
        exec_res = self.execute(
            row["capability_id"],
            payload,
            user_id=row["user_id"],
            user_role="admin",
            conn=conn,
            data_dir=data_dir,
            approved_by=admin_email,
            project_id=row["project_id"],
            conversation_id=row["conversation_id"],
            existing_invocation_id=invocation_id,
        )
        updated = dict(conn.execute("SELECT * FROM tool_center_invocations WHERE id=?", (invocation_id,)).fetchone())
        return {**exec_res, "invocation": updated}

    def verify_toolkit(
        self,
        toolkit_id: str | None = None,
        *,
        conn: sqlite3.Connection | None = None,
        data_dir: Path | None = None,
    ) -> dict[str, Any]:
        """Run real verification probes (positive & negative cases) for one or all Toolkits."""
        target_ids = [toolkit_id] if toolkit_id else list(self._toolkits.keys())
        for tid in target_ids:
            if tid not in self._toolkits:
                return {"ok": False, "error": f"Unknown toolkit '{tid}'"}

        probe_reports: dict[str, Any] = {}
        total_passed = 0
        total_cases = 0

        for tid in target_ids:
            cases = self._run_toolkit_probes(tid, conn=conn, data_dir=data_dir)
            passed = sum(1 for c in cases if c["passed"])
            total = len(cases)
            total_passed += passed
            total_cases += total
            status = "VERIFIED" if total > 0 and passed == total else ("PARTIAL" if passed > 0 else "FAILED")
            probe_reports[tid] = {
                "toolkit_id": tid,
                "version": self._toolkits[tid].version,
                "status": status,
                "passed": passed,
                "total": total,
                "cases": cases,
            }

        overall_status = "VERIFIED" if total_cases > 0 and total_passed == total_cases else "PARTIAL"
        return {
            "ok": True,
            "status": overall_status,
            "passed": total_passed,
            "total": total_cases,
            "toolkits": probe_reports,
            "summary": f"ผลทดสอบ Tool Center ({len(target_ids)} ชุด): {overall_status} ({total_passed}/{total_cases} กรณีผ่าน)",
            "external_models_used": False,
        }

    def _run_toolkit_probes(
        self,
        tid: str,
        *,
        conn: sqlite3.Connection | None = None,
        data_dir: Path | None = None,
    ) -> list[dict[str, Any]]:
        cases: list[dict[str, Any]] = []

        def record(cid: str, ok_cond: bool, detail: str) -> None:
            cases.append({"case_id": cid, "passed": bool(ok_cond), "detail": detail})

        if tid == "development":
            r1 = self.execute(
                "development.code_analysis",
                {"language": "python", "source": "def add(a, b):\n    return a + b\n"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "dev_valid_python_ast",
                r1["ok"] and r1["output"].get("validation", {}).get("status") == "valid" and "add" in r1["output"].get("symbols", {}).get("functions", []),
                "Valid Python AST parses functions without executing code",
            )
            r2 = self.execute(
                "development.code_analysis",
                {"language": "python", "source": "def broken(:\n    pass\n"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "dev_invalid_python_rejected",
                r2["ok"] and r2["output"].get("validation", {}).get("status") == "invalid",
                "SyntaxError in Python source is accurately flagged invalid",
            )
            r3 = self.execute(
                "development.contract_validate",
                {
                    "kind": "output",
                    "payload": {
                        "task_id": "t1",
                        "language": "python",
                        "files": [{"path": "../escape.py", "content": "x = 1"}],
                    },
                },
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "dev_contract_blocks_traversal",
                r3["ok"] and r3["output"].get("valid") is False,
                "Code contract rejects path traversal ../escape.py",
            )
            r4 = self.execute(
                "development.workspace_file",
                {"action": "write", "filename": "_probe_ws.txt", "content": "probe-ok"},
                user_role="admin",
                data_dir=data_dir,
            )
            r5 = self.execute(
                "development.workspace_file",
                {"action": "read", "filename": "_probe_ws.txt"},
                user_role="admin",
                data_dir=data_dir,
            )
            r6 = self.execute(
                "development.workspace_file",
                {"action": "read", "filename": "../outside.txt"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "dev_workspace_file_roundtrip_and_guard",
                bool(r4["ok"] and r5["ok"] and r5["output"].get("content") == "probe-ok" and not r6["ok"]),
                "Workspace sandbox file write/read succeeds and path traversal fails closed",
            )
            if data_dir is not None:
                probe_path = Path(data_dir) / "workspace_files" / "_probe_ws.txt"
                if probe_path.exists():
                    probe_path.unlink(missing_ok=True)

        elif tid == "data":
            r1 = self.execute(
                "data.leakage_check",
                {
                    "train": ["zyrquen enforces native models only"],
                    "validation": ["knowledge graph stores verified triples"],
                    "test": ["zyrquen enforces native models only"],
                },
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "data_leakage_catches_overlap",
                r1["ok"] and r1["output"].get("leakage_detected") is True,
                "Detects exact overlap between train and test splits",
            )
            r2 = self.execute(
                "data.profile_structured",
                {"format": "csv", "content": "item,val\na,10\nb,20\nb,20\n"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "data_csv_profiler_counts",
                r2["ok"] and r2["output"].get("row_count") == 3 and r2["output"].get("duplicate_rows") == 1,
                "CSV profiler counts rows, duplicates, and numeric stats",
            )
            r3 = self.execute(
                "data.calc_ast",
                {"expression": "(12 + 8) * 5"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "data_calc_ast_exact",
                r3["ok"] and r3["output"].get("result") == 100,
                "Deterministic AST calculator returns exact result 100",
            )

        elif tid == "research":
            r1 = self.execute(
                "research.url_validate",
                {"url": "http://127.0.0.1:3000/secret"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "research_blocks_ssrf_loopback",
                r1["ok"] and r1["output"].get("safe") is False,
                "SSRF guard blocks loopback URL",
            )
            r2 = self.execute(
                "research.url_validate",
                {"url": "https://api.openai.com/v1/chat/completions"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "research_blocks_external_llm_host",
                r2["ok"] and r2["output"].get("safe") is False,
                "Policy guard blocks prohibited external AI host",
            )
            r3 = self.execute(
                "research.evidence_corroborate",
                {
                    "topic": "SQLite WAL",
                    "sources": [
                        {
                            "url": "https://www.sqlite.org/wal.html",
                            "provider": "sqlite.org",
                            "claim": "WAL allows concurrent readers.",
                            "raw_text": "WAL allows concurrent readers.",
                        },
                        {
                            "url": "https://en.wikipedia.org/wiki/SQLite",
                            "provider": "wikipedia",
                            "claim": "WAL allows concurrent readers.",
                            "raw_text": "WAL allows concurrent readers.",
                        },
                    ],
                },
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "research_corroborates_two_sources",
                r3["ok"] and r3["output"].get("verdict") == "VERIFIED",
                "Multi-source corroboration passes with 2 agreeing sources",
            )

        elif tid == "testing":
            r1 = self.execute(
                "testing.contract_assertion",
                {
                    "cases": [
                        {"name": "eq_pass", "op": "eq", "actual": 42, "expected": 42},
                        {"name": "gt_pass", "op": "gt", "actual": 10, "expected": 5},
                    ]
                },
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "testing_assertion_pass",
                r1["ok"] and r1["output"].get("verdict") == "PASS" and r1["output"].get("passed") == 2,
                "Contract assertion passes valid expectations",
            )
            r2 = self.execute(
                "testing.contract_assertion",
                {"cases": [{"name": "eq_fail", "op": "eq", "actual": 1, "expected": 2}]},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "testing_assertion_reports_failure",
                r2["ok"] and r2["output"].get("verdict") == "FAILED" and r2["output"].get("failed") == 1,
                "Contract assertion never fakes PASS on mismatch",
            )
            r3 = self.execute(
                "testing.sandbox_run",
                {"source": "vals = [2, 4, 6]\nprint(sum(vals))"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "testing_sandbox_isolated_exec",
                r3["ok"] and r3["output"].get("sandbox_isolated") is True and r3["output"].get("stdout") == "12",
                "Isolated sandbox executes pure Python safely without exposing env secrets",
            )

        elif tid == "automation":
            r1 = self.execute(
                "automation.task_compose",
                {"goal": "วิเคราะห์ข้อมูล CSV และตรวจสอบความปลอดภัย"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "automation_compose_reuses_toolkits",
                r1["ok"] and r1["output"].get("reuse_existing_count", 0) >= 1 and r1["output"].get("duplicate_creation_blocked") is True,
                "Composer matches existing READY capabilities and blocks duplicate creation",
            )
            r2 = self.execute(
                "automation.workflow_execute",
                {"group_id": "system_ops"},
                user_role="admin",
                conn=conn,
                data_dir=data_dir,
            )
            record(
                "automation_workflow_system_ops",
                r2["ok"] and (r2["output"].get("run") or {}).get("status") == "COMPLETED",
                "Central workflow engine completes system_ops cleanly",
            )

        elif tid == "api_integration":
            r1 = self.execute(
                "api_integration.contract_validate",
                {"method": "POST", "endpoint": "/api/conversations", "required_fields": ["title"], "sample_body": {"title": "OK"}},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "api_contract_valid_pass",
                r1["ok"] and r1["output"].get("valid") is True,
                "API contract validator approves complete REST payload",
            )
            r2 = self.execute(
                "api_integration.contract_validate",
                {"method": "POST", "endpoint": "/bad-path", "required_fields": ["title"], "sample_body": {}},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "api_contract_invalid_flagged",
                r2["ok"] and r2["output"].get("valid") is False and len(r2["output"].get("problems", [])) >= 2,
                "API contract validator rejects non-/api path and missing body fields",
            )
            r3 = self.execute(
                "api_integration.webhook_dispatch",
                {"url": "https://en.wikipedia.org/wiki/Webhook", "body": {"event": "probe"}},
                user_role="user",
                data_dir=data_dir,
            )
            record(
                "api_webhook_p5_approval_gated",
                r3["status"] == "PENDING_APPROVAL",
                "External webhook dispatch enforces P5 Approval Gate for non-approved calls",
            )

        elif tid == "document":
            r1 = self.execute(
                "document.markdown_outline",
                {"content": "# Title\n\n## Section A\nText\n\n```py\nx=1\n```\n"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "doc_markdown_outline",
                r1["ok"] and r1["output"].get("heading_count") == 2 and r1["output"].get("code_block_count") == 1,
                "Markdown outline extracts headings and code fences accurately",
            )
            r2 = self.execute(
                "document.spec_generate",
                {
                    "title": "Probe Spec",
                    "objective": "Verify spec SHA-256 generation",
                    "constraints": ["No fake outputs"],
                    "save_to_workspace": False,
                },
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "doc_spec_sha256",
                r2["ok"] and len(str(r2["output"].get("content_sha256") or "")) == 64,
                "Spec generator outputs deterministic SHA-256 digest",
            )

        elif tid == "security":
            r1 = self.execute(
                "security.native_policy_audit",
                {"source": "import openai\nclient = openai.OpenAI()\n"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "sec_catches_external_llm_import",
                r1["ok"] and r1["output"].get("policy_compliant") is False,
                "AST policy audit catches prohibited external LLM import",
            )
            r2 = self.execute(
                "security.secret_and_path_scan",
                {"path": "../../etc/passwd", "content": "token=sk-1234567890abcdef1234"},
                user_role="admin",
                data_dir=data_dir,
            )
            record(
                "sec_catches_secret_and_traversal",
                r2["ok"] and r2["output"].get("clean") is False and r2["output"].get("finding_count", 0) >= 2,
                "Secret & path scanner catches leaked key and traversal",
            )
            r3 = self.execute(
                "security.governance_audit",
                {"limit": 5},
                user_role="user",
                conn=conn,
                data_dir=data_dir,
            )
            record(
                "sec_enforces_admin_only_rbac",
                not r3["ok"] and r3["status"] == "BLOCKED",
                "Admin-only capability rejects regular user with BLOCKED",
            )

        return cases


_SINGLETON_REGISTRY: ToolCenterRegistry | None = None


def get_tool_center_registry() -> ToolCenterRegistry:
    global _SINGLETON_REGISTRY
    if _SINGLETON_REGISTRY is None:
        reg = ToolCenterRegistry()
        register_development_toolkit(reg)
        register_data_toolkit(reg)
        register_research_toolkit(reg)
        register_testing_toolkit(reg)
        register_automation_toolkit(reg)
        register_document_toolkit(reg)
        register_api_integration_toolkit(reg)
        register_security_toolkit(reg)
        _SINGLETON_REGISTRY = reg
    return _SINGLETON_REGISTRY
