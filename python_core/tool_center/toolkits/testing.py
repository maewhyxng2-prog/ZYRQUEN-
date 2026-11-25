"""
Testing Toolkit for ZYRQUEN Tool Center.
Executes real deterministic contract probes, dataset SHA-256 integrity checks, and 7-state verification.
"""

from __future__ import annotations

from typing import Any

import dataset_ingestion as di

from ..contracts import CapabilitySpec, ToolkitManifest
from ..sandbox import run_python_sandbox
from ..software_engineering import run_engineering_benchmark


def _handle_toolkit_self_test(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    toolkit_id = str(payload.get("toolkit_id") or "").strip().lower()
    registry = ctx["registry"]
    report = registry.verify_toolkit(toolkit_id or None, conn=ctx.get("conn"), data_dir=ctx.get("data_dir"))
    if not report.get("ok"):
        return {
            "ok": False,
            "status": "FAILED",
            "error": report.get("error") or "Toolkit verification failed",
            "output": report,
        }
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": report,
        "summary": report.get("summary") or "ทดสอบชุดเครื่องมือสำเร็จ",
    }


def _handle_dataset_verify(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    dataset_id = str(payload.get("dataset_id") or "").strip()
    if not dataset_id:
        return {"ok": False, "status": "FAILED", "error": "dataset_id is required.", "output": {}}
    conn = ctx.get("conn")
    if conn is None:
        return {"ok": False, "status": "BLOCKED", "error": "Database connection unavailable.", "output": {}}
    res = di.verify_dataset_integrity(conn, dataset_id)
    if not res.get("ok") and res.get("error") == "Dataset not found":
        return {"ok": False, "status": "FAILED", "error": "Dataset not found", "output": res}
    verified = bool(res.get("verified"))
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": res,
        "summary": (
            f"ชุดข้อมูล {res.get('name', dataset_id)}: "
            f"{'ผ่านการตรวจ SHA-256 และความสมบูรณ์' if verified else 'พบความผิดปกติ: ' + ', '.join(res.get('errors') or [])}"
        ),
    }


def _handle_contract_assertion(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    cases = payload.get("cases") or []
    if not isinstance(cases, list) or not cases:
        return {"ok": False, "status": "FAILED", "error": "cases array must be non-empty.", "output": {}}

    results: list[dict[str, Any]] = []
    passed = 0
    for idx, case in enumerate(cases[:50]):
        if not isinstance(case, dict):
            results.append({"index": idx, "passed": False, "error": "Case must be an object"})
            continue
        name = str(case.get("name") or f"case-{idx + 1}")
        op = str(case.get("op") or "eq")
        actual = case.get("actual")
        expected = case.get("expected")
        ok = False
        if op == "eq":
            ok = actual == expected
        elif op == "ne":
            ok = actual != expected
        elif op == "contains":
            ok = str(expected) in str(actual) if not isinstance(actual, list) else expected in actual
        elif op == "truthy":
            ok = bool(actual)
        elif op == "gt":
            try:
                ok = float(actual) > float(expected)
            except (TypeError, ValueError):
                ok = False
        elif op == "lt":
            try:
                ok = float(actual) < float(expected)
            except (TypeError, ValueError):
                ok = False
        if ok:
            passed += 1
        results.append({
            "index": idx,
            "name": name,
            "op": op,
            "passed": ok,
            "actual": actual,
            "expected": expected,
        })

    total = len(results)
    failed = total - passed
    verdict = "PASS" if failed == 0 else "FAILED"
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "verdict": verdict,
            "passed": passed,
            "failed": failed,
            "total": total,
            "results": results,
        },
        "summary": f"ผลการตรวจ Assertions: {verdict} ({passed}/{total} ผ่าน)",
    }


def _handle_sandbox_run(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    source = str(payload.get("source") or "")
    if not source.strip():
        return {"ok": False, "status": "FAILED", "error": "source is required.", "output": {}}
    timeout_s = float(payload.get("timeout_s") or 3.0)
    input_data = payload.get("input_data") if isinstance(payload.get("input_data"), dict) else {}
    res = run_python_sandbox(source, input_data=input_data, timeout_s=timeout_s)
    if not res.get("ok") and res.get("status") == "BLOCKED":
        return {
            "ok": False,
            "status": "BLOCKED",
            "error": res.get("stderr") or "Sandbox policy blocked snippet.",
            "output": res,
        }
    return {
        "ok": bool(res.get("ok")),
        "status": str(res.get("status") or "FAILED"),
        "error": None if res.get("ok") else (res.get("stderr") or "Sandbox execution failed"),
        "output": res,
        "summary": (
            f"รันใน Sandbox แยกสำเร็จ ({res.get('duration_ms')} ms)"
            if res.get("ok")
            else f"การรันใน Sandbox ไม่ผ่าน: {res.get('stderr')}"
        ),
    }


def _handle_engineering_benchmark(_payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    rep = run_engineering_benchmark(
        ctx["registry"],
        conn=ctx.get("conn"),
        data_dir=ctx.get("data_dir"),
    )
    m = rep.get("metrics") or {}
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": rep,
        "summary": (
            f"Engineering Benchmark ({rep.get('status')}): "
            f"{rep.get('passed')}/{rep.get('total')} ผ่าน "
            f"(success_rate={m.get('success_rate')}, {m.get('execution_time_ms')} ms)"
        ),
    }


def register_testing_toolkit(registry: Any) -> None:
    manifest = ToolkitManifest(
        id="testing",
        name="Testing Toolkit",
        thai_name="ชุดเครื่องมือทดสอบและทวนสอบ",
        version="1.0.0",
        description="รันการทดสอบสัญญาและพฤติกรรมจริงของ Toolkit (ทั้งกรณีผ่านและกรณีปฏิเสธ), ตรวจความสมบูรณ์ SHA-256 ของชุดข้อมูล และตรวจ Assertions",
        category="testing",
        dependencies=("python_core.capability_verifier", "python_core.dataset_ingestion"),
        default_permission="auto",
        lifecycle_status="READY",
        bound_modules=(
            "python_core/capability_verifier.py",
            "python_core/dataset_ingestion.py",
            "python_core/tests/benchmark_suite.py",
        ),
        documentation="ใช้ทดสอบและยืนยันการทำงานจริงของแต่ละ Toolkit โดยไม่ปลอมสถานะ PASS",
    )

    specs = [
        (
            CapabilitySpec(
                id="testing.toolkit_self_test",
                toolkit_id="testing",
                name="ทดสอบชุดเครื่องมือจริง (Toolkit Verification Probes)",
                version="1.0.0",
                description="รันชุดทดสอบจริงทั้ง Positive และ Negative Cases ของแต่ละ Toolkit และวัดผลตามเกณฑ์ Capability Verifier",
                input_schema={
                    "type": "object",
                    "required": [],
                    "properties": {"toolkit_id": {"type": "string"}},
                },
                output_schema={"type": "object", "required": ["status", "passed", "total"]},
                dependencies=("python_core.capability_verifier",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/capability_verifier.py",),
                documentation="ระบุ toolkit_id (เช่น 'data') หรือเว้นว่างเพื่อทดสอบทุก Toolkit ใน Tool Center",
                example_input={"toolkit_id": "data"},
                keywords=("test", "verify", "qa", "benchmark", "ทดสอบ", "ทวนสอบ"),
            ),
            _handle_toolkit_self_test,
        ),
        (
            CapabilitySpec(
                id="testing.dataset_verify",
                toolkit_id="testing",
                name="ทวนสอบ SHA-256 และความสมบูรณ์ Dataset",
                version="1.0.0",
                description="คำนวณ SHA-256 ใหม่เทียบกับฐานข้อมูลและไฟล์ Manifest บนดิสก์จริง",
                input_schema={
                    "type": "object",
                    "required": ["dataset_id"],
                    "properties": {"dataset_id": {"type": "string"}},
                },
                output_schema={"type": "object", "required": ["verified"]},
                dependencies=("python_core.dataset_ingestion",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/dataset_ingestion.py",),
                documentation="ระบุ dataset_id ที่ต้องการตรวจสอบ checksum และ split leakage",
                example_input={"dataset_id": "ds-id"},
                keywords=("dataset", "checksum", "sha256", "verify", "ทดสอบ", "ชุดข้อมูล"),
            ),
            _handle_dataset_verify,
        ),
        (
            CapabilitySpec(
                id="testing.contract_assertion",
                toolkit_id="testing",
                name="ตรวจ Assertion เชิงสัญญาข้อมูล",
                version="1.0.0",
                description="ตรวจสอบค่าจริงเทียบกับค่าคาดหวังด้วยตัวดำเนินการ eq, ne, contains, truthy, gt, lt",
                input_schema={
                    "type": "object",
                    "required": ["cases"],
                    "properties": {"cases": {"type": "array"}},
                },
                output_schema={"type": "object", "required": ["verdict", "passed", "failed", "total"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/capability_verifier.py",),
                documentation="ส่งรายการ cases [{name, op, actual, expected}] เพื่อตรวจผลจริง",
                example_input={
                    "cases": [
                        {"name": "status_check", "op": "eq", "actual": "VERIFIED", "expected": "VERIFIED"},
                        {"name": "score_gt_zero", "op": "gt", "actual": 1, "expected": 0},
                    ]
                },
                keywords=("assert", "test", "check", "ทดสอบ"),
            ),
            _handle_contract_assertion,
        ),
        (
            CapabilitySpec(
                id="testing.sandbox_run",
                toolkit_id="testing",
                name="รันทดสอบโค้ดใน Isolated Sandbox",
                version="1.0.0",
                description="ทดสอบโค้ด Python ในไดเรกทอรีแยกพร้อมตรวจ AST Policy, ตัดตัวแปรลับ, จำกัดเวลาและทรัพยากร",
                input_schema={
                    "type": "object",
                    "required": ["source"],
                    "properties": {
                        "source": {"type": "string"},
                        "input_data": {"type": "object"},
                        "timeout_s": {"type": "number"},
                    },
                },
                output_schema={"type": "object", "required": ["sandbox_isolated", "stdout", "duration_ms"]},
                dependencies=("python_core.tool_center.sandbox",),
                permission_mode="auto",
                risk_tier="sandbox_io",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/sandbox.py",),
                documentation="ส่ง source Python เพื่อรันทดสอบอย่างปลอดภัยในสภาพแวดล้อมแยก",
                example_input={"source": "x = sum([1, 2, 3])\nprint(x)"},
                keywords=("sandbox", "execute", "test", "isolated", "ทดสอบโค้ด", "สภาพแวดล้อมแยก"),
            ),
            _handle_sandbox_run,
        ),
        (
            CapabilitySpec(
                id="testing.engineering_benchmark",
                toolkit_id="testing",
                name="รัน Real Software Engineering Benchmark",
                version="1.0.0",
                description="ทดสอบความสามารถวิศวกรรมซอฟต์แวร์จริง 6 ด้าน (Repo Understanding, Diff/Rollback, Autonomous Repair Loop, API Contract/RBAC, Security, Regression Prevention)",
                input_schema={"type": "object", "required": [], "properties": {}},
                output_schema={"type": "object", "required": ["status", "passed", "total", "metrics", "tasks"]},
                dependencies=("python_core.tool_center.software_engineering",),
                permission_mode="auto",
                risk_tier="sandbox_io",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/software_engineering.py",),
                documentation="รันทดสอบจริงใน Sandbox แยกพร้อมวัด Success Rate, Regression Rate และเวลาจริง",
                example_input={},
                keywords=("benchmark", "engineering", "repair", "regression", "ทดสอบวิศวกรรม"),
            ),
            _handle_engineering_benchmark,
        ),
    ]

    registry.register_toolkit(manifest, specs)
