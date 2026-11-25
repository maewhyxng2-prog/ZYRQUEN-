"""
Security Toolkit for ZYRQUEN Tool Center.
Provides Native-Only AST/dependency policy auditing, secret & path-traversal scanning,
and RBAC/governance audit trail inspection.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any

from apps.core.intelligence.cognitive_core import (
    PROHIBITED_PYTHON_DOTTED_PREFIXES,
    PROHIBITED_PYTHON_LLM_MODULES,
    PROHIBITED_WEB_LLM_PACKAGES,
)
import tools_engine as te

from ..contracts import CapabilitySpec, ToolkitManifest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("openai_like_key", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b")),
    ("github_pat", re.compile(r"\bghp_[0-9A-Za-z]{20,}\b")),
    ("private_key_block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
)

_FROM_PRETRAINED_RE = re.compile(r"\bfrom_pretrained\s*\(")


def _scan_python_text(source: str, label: str) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    try:
        tree = ast.parse(source, mode="exec")
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root_mod = alias.name.split(".", 1)[0]
                    if root_mod in PROHIBITED_PYTHON_LLM_MODULES or any(
                        alias.name.startswith(pref) for pref in PROHIBITED_PYTHON_DOTTED_PREFIXES
                    ):
                        findings.append({
                            "target": label,
                            "rule": "prohibited_external_llm_import",
                            "detail": f"Prohibited import '{alias.name}' at line {node.lineno}",
                        })
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                root_mod = mod.split(".", 1)[0]
                if root_mod in PROHIBITED_PYTHON_LLM_MODULES or any(
                    mod.startswith(pref) for pref in PROHIBITED_PYTHON_DOTTED_PREFIXES
                ):
                    findings.append({
                        "target": label,
                        "rule": "prohibited_external_llm_import",
                        "detail": f"Prohibited from-import '{mod}' at line {node.lineno}",
                    })
    except SyntaxError as exc:
        findings.append({"target": label, "rule": "syntax_error", "detail": str(exc)})

    if _FROM_PRETRAINED_RE.search(source):
        findings.append({
            "target": label,
            "rule": "from_pretrained_call",
            "detail": "Detected from_pretrained() call (external pretrained weights prohibited).",
        })
    for host in te.BLOCKED_EXTERNAL_LLM_HOSTS:
        if host in source:
            findings.append({
                "target": label,
                "rule": "blocked_external_ai_host",
                "detail": f"Detected blocked external AI host '{host}'.",
            })
    return findings


def _handle_native_policy_audit(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    source = payload.get("source")
    if isinstance(source, str) and source.strip():
        findings = _scan_python_text(source, "<inline_source>")
        for pkg in PROHIBITED_WEB_LLM_PACKAGES:
            if pkg in source:
                findings.append({
                    "target": "<inline_source>",
                    "rule": "prohibited_web_llm_package",
                    "detail": f"Detected prohibited package reference '{pkg}'.",
                })
        compliant = len(findings) == 0
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {
                "scope": "inline_source",
                "policy_compliant": compliant,
                "scanned_files": 1,
                "findings": findings,
            },
            "summary": (
                "ผ่านการตรวจสอบนโยบาย Native-Only (ไม่พบการฝังโมเดลภายนอก)"
                if compliant
                else f"พบการละเมิดนโยบาย Native-Only จำนวน {len(findings)} รายการ"
            ),
        }

    # Repository audit (confined to python_core/ and src/)
    target_rel = str(payload.get("target_path") or "python_core").strip()
    target = (REPO_ROOT / target_rel).resolve()
    if target != REPO_ROOT and not target.is_relative_to(REPO_ROOT):
        return {"ok": False, "status": "BLOCKED", "error": "Path traversal forbidden.", "output": {}}
    if not target.exists():
        return {"ok": False, "status": "FAILED", "error": f"Path '{target_rel}' not found.", "output": {}}

    findings: list[dict[str, str]] = []
    scanned = 0
    files = [target] if target.is_file() else sorted(target.rglob("*.py"))
    for fpath in files:
        parts = fpath.relative_to(REPO_ROOT).parts
        if any(p in {"node_modules", "dist", "__pycache__", ".venv", "tool_center"} for p in parts):
            continue
        if fpath.suffix != ".py":
            continue
        scanned += 1
        text = fpath.read_text(encoding="utf-8", errors="replace")
        rel = "/".join(parts)
        # Skip tool_center/security.py and tools_engine.py's blocklist definitions
        file_findings = _scan_python_text(text, rel)
        if rel in {"python_core/tools_engine.py", "apps/core/intelligence/cognitive_core.py", "apps/core/intelligence/research.py"}:
            file_findings = [f for f in file_findings if f["rule"] != "blocked_external_ai_host"]
        findings.extend(file_findings)

    compliant = len(findings) == 0
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "scope": target_rel,
            "policy_compliant": compliant,
            "scanned_files": scanned,
            "findings": findings[:50],
        },
        "summary": (
            f"ตรวจสอบนโยบาย Native-Only ครบ {scanned} ไฟล์: ปลอดภัย (0 การฝังโมเดลภายนอก)"
            if compliant
            else f"ตรวจพบข้อสังเกต {len(findings)} รายการจากการสแกน {scanned} ไฟล์"
        ),
    }


def _handle_secret_and_path_scan(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    text = str(payload.get("content") or "")
    candidate_path = str(payload.get("path") or "").strip()
    findings: list[dict[str, str]] = []

    if candidate_path:
        norm = candidate_path.replace("\\", "/")
        if norm.startswith("/") or ".." in norm.split("/") or "\x00" in norm:
            findings.append({
                "type": "path_traversal",
                "detail": f"Unsafe path detected: '{candidate_path}'",
            })

    for rule_name, regex in _SECRET_PATTERNS:
        if regex.search(text):
            findings.append({
                "type": "secret_pattern",
                "rule": rule_name,
                "detail": f"Matched potential secret pattern ({rule_name}).",
            })

    clean = len(findings) == 0
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "clean": clean,
            "finding_count": len(findings),
            "findings": findings,
        },
        "summary": (
            "ไม่พบรูปแบบ Secret รั่วไหลหรือ Path Traversal"
            if clean
            else f"ตรวจพบความเสี่ยงด้านความปลอดภัย {len(findings)} รายการ"
        ),
    }


def _handle_governance_audit(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    conn = ctx.get("conn")
    if conn is None:
        return {"ok": False, "status": "BLOCKED", "error": "Database connection unavailable.", "output": {}}

    raw_limit = int(payload.get("limit") or 20)
    limit = max(1, min(50, raw_limit))
    tools_rows = [
        dict(r)
        for r in conn.execute(
            "SELECT id, permission_mode, enabled, quota_daily, calls_today FROM external_tools ORDER BY id ASC"
        ).fetchall()
    ]
    pending_tool_gates = int(
        conn.execute("SELECT COUNT(*) FROM tool_invocations WHERE status='PENDING_APPROVAL'").fetchone()[0]
    )
    pending_wf_gates = int(
        conn.execute("SELECT COUNT(*) FROM workflow_runs WHERE status='PENDING_APPROVAL'").fetchone()[0]
    )
    recent_audits = [
        dict(r)
        for r in conn.execute(
            "SELECT id, actor_email, action, target, outcome, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    ]
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "tool_policies": tools_rows,
            "pending_approvals": {
                "tool_invocations": pending_tool_gates,
                "workflow_runs": pending_wf_gates,
            },
            "recent_audit_logs": recent_audits,
        },
        "summary": (
            f"ตรวจสอบ Governance: เครื่องมือ {len(tools_rows)} รายการ, "
            f"รออนุมัติ {pending_tool_gates + pending_wf_gates} รายการ, Audit Logs ล่าสุด {len(recent_audits)} รายการ"
        ),
    }


def _handle_dependency_audit(_payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    import json as _json

    prohibited_hits: list[dict[str, str]] = []
    pkg_json = REPO_ROOT / "package.json"
    checked_files: list[str] = []
    if pkg_json.exists():
        checked_files.append("package.json")
        try:
            data = _json.loads(pkg_json.read_text(encoding="utf-8"))
            for section in ("dependencies", "devDependencies"):
                deps = data.get(section) or {}
                if isinstance(deps, dict):
                    for dep_name in deps.keys():
                        low = str(dep_name).lower()
                        if any(p in low for p in PROHIBITED_WEB_LLM_PACKAGES):
                            prohibited_hits.append({"file": "package.json", "package": str(dep_name), "section": section})
        except Exception as exc:
            prohibited_hits.append({"file": "package.json", "error": str(exc)})

    req_txt = REPO_ROOT / "apps" / "api" / "requirements.txt"
    if req_txt.exists():
        checked_files.append("apps/api/requirements.txt")
        for line in req_txt.read_text(encoding="utf-8", errors="replace").splitlines():
            clean = line.strip().split("==")[0].split(">=")[0].strip().lower()
            if not clean or clean.startswith("#"):
                continue
            if clean in PROHIBITED_PYTHON_LLM_MODULES or any(clean.startswith(p) for p in PROHIBITED_PYTHON_DOTTED_PREFIXES):
                prohibited_hits.append({"file": "apps/api/requirements.txt", "package": clean})

    clean = len(prohibited_hits) == 0
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "clean": clean,
            "checked_files": checked_files,
            "prohibited_dependencies": prohibited_hits,
        },
        "summary": (
            f"ตรวจ Dependencies ({', '.join(checked_files)}): ปลอดภัย ไม่พบแพ็กเกจ AI ภายนอก"
            if clean
            else f"พบ Dependency ต้องห้าม {len(prohibited_hits)} รายการ"
        ),
    }


def register_security_toolkit(registry: Any) -> None:
    manifest = ToolkitManifest(
        id="security",
        name="Security Toolkit",
        thai_name="ชุดเครื่องมือความปลอดภัยและธรรมาภิบาล",
        version="1.1.0",
        description="ตรวจสอบการฝังโมเดล AI ภายนอก, ตรวจ Dependencies, สแกน Secret/Path Traversal และตรวจ Audit Logs (RBAC)",
        category="security",
        dependencies=("apps.core.intelligence.cognitive_core", "python_core.tools_engine"),
        default_permission="auto",
        lifecycle_status="READY",
        bound_modules=(
            "apps/core/intelligence/cognitive_core.py",
            "python_core/tools_engine.py",
            "apps/core/workflow/governance.py",
        ),
        documentation="ใช้สแกนความปลอดภัยเชิงสถิต ตรวจสอบ Dependency และตรวจ Audit Logs สำหรับผู้ดูแลระบบ",
    )

    specs = [
        (
            CapabilitySpec(
                id="security.native_policy_audit",
                toolkit_id="security",
                name="ตรวจสอบนโยบาย Native-Only (AST Import & Host Audit)",
                version="1.0.0",
                description="สแกนโค้ดหรือโมดูลใน Repository ด้วย AST เพื่อยืนยันว่าไม่มีการนำเข้า SDK/โฮสต์ LLM ภายนอก",
                input_schema={
                    "type": "object",
                    "required": [],
                    "properties": {
                        "source": {"type": "string"},
                        "target_path": {"type": "string"},
                    },
                },
                output_schema={"type": "object", "required": ["policy_compliant", "scanned_files", "findings"]},
                dependencies=("apps.core.intelligence.cognitive_core",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("apps/core/intelligence/cognitive_core.py",),
                documentation="ส่ง source เพื่อตรวจโค้ดโดยตรง หรือระบุ target_path (เช่น 'python_core') เพื่อสแกนทั้งโฟลเดอร์",
                example_input={"target_path": "python_core"},
                keywords=("security", "policy", "native", "audit", "llm", "ความปลอดภัย", "ตรวจสอบสิทธิ์"),
            ),
            _handle_native_policy_audit,
        ),
        (
            CapabilitySpec(
                id="security.dependency_audit",
                toolkit_id="security",
                name="ตรวจสอบ Dependencies (Dependency Auditing)",
                version="1.0.0",
                description="ตรวจสอบ package.json และ requirements.txt เพื่อหาแพ็กเกจโมเดล AI ภายนอกต้องห้าม",
                input_schema={"type": "object", "required": [], "properties": {}},
                output_schema={"type": "object", "required": ["clean", "checked_files", "prohibited_dependencies"]},
                dependencies=("apps.core.intelligence.cognitive_core",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("apps/core/intelligence/cognitive_core.py",),
                documentation="ตรวจสอบรายการแพ็กเกจของโปรเจกต์เพื่อรักษาข้อกำหนด No External Models",
                example_input={},
                keywords=("dependency", "audit", "package", "security", "ความปลอดภัย"),
            ),
            _handle_dependency_audit,
        ),
        (
            CapabilitySpec(
                id="security.secret_and_path_scan",
                toolkit_id="security",
                name="สแกน Secret รั่วไหลและ Path Traversal",
                version="1.0.0",
                description="ตรวจจับรูปแบบคีย์/โทเค็นต้องห้าม (sk-, AIza, ghp_, Private Key) และเส้นทางไฟล์นอกขอบเขต",
                input_schema={
                    "type": "object",
                    "required": [],
                    "properties": {
                        "content": {"type": "string"},
                        "path": {"type": "string"},
                    },
                },
                output_schema={"type": "object", "required": ["clean", "finding_count", "findings"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tools_engine.py",),
                documentation="ส่ง content และ/หรือ path เพื่อตรวจจับความเสี่ยงก่อนบันทึกหรือประมวลผล",
                example_input={"path": "workspace/report.md", "content": "Safe project summary content."},
                keywords=("secret", "scan", "traversal", "security", "ความปลอดภัย", "คีย์"),
            ),
            _handle_secret_and_path_scan,
        ),
        (
            CapabilitySpec(
                id="security.governance_audit",
                toolkit_id="security",
                name="ตรวจนโยบาย P5 Gate และ Audit Logs (Admin Only)",
                version="1.0.0",
                description="ดึงสถานะสิทธิ์เครื่องมือ รายการรออนุมัติ และบันทึก Audit Trail ล่าสุดจาก SQLite (เฉพาะผู้ดูแลระบบ)",
                input_schema={
                    "type": "object",
                    "required": [],
                    "properties": {"limit": {"type": "integer"}},
                },
                output_schema={"type": "object", "required": ["tool_policies", "pending_approvals", "recent_audit_logs"]},
                dependencies=("python_core.tools_engine",),
                permission_mode="admin_only",
                risk_tier="governance",
                lifecycle_status="READY",
                bound_modules=("python_core/tools_engine.py", "apps/core/workflow/governance.py"),
                documentation="สงวนสิทธิ์เฉพาะ role='admin' เท่านั้น ผู้ใช้ทั่วไปจะถูกปฏิเสธ (BLOCKED)",
                example_input={"limit": 10},
                keywords=("governance", "rbac", "audit", "admin", "สิทธิ์", "ความปลอดภัย"),
            ),
            _handle_governance_audit,
        ),
    ]

    registry.register_toolkit(manifest, specs)
