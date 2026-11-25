"""
Automation Toolkit for ZYRQUEN Tool Center.
Connects central workflow execution, task orchestration, and process status coordination.
"""

from __future__ import annotations

from typing import Any

import zyrquen_core as zc

from ..contracts import CapabilitySpec, ToolkitManifest


def _handle_workflow_execute(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    group_id = str(payload.get("group_id") or "").strip()
    if not group_id:
        return {"ok": False, "status": "FAILED", "error": "group_id is required.", "output": {}}

    res = zc.handle_run_workflow({
        "group_id": group_id,
        "user_id": ctx.get("user_id") or "system",
        "approved_by": ctx.get("approved_by"),
        "dataset_id": payload.get("dataset_id"),
    })
    if not res.get("ok"):
        return {
            "ok": False,
            "status": "FAILED",
            "error": str(res.get("error") or "Workflow execution failed"),
            "output": res,
        }
    run_obj = res.get("run") or {}
    run_status = str(run_obj.get("status") or "COMPLETED")
    return {
        "ok": True,
        "status": run_status if run_status in {"COMPLETED", "PENDING_APPROVAL", "BLOCKED", "FAILED"} else "COMPLETED",
        "output": {"run": run_obj},
        "summary": f"เวิร์กโฟลว์ '{group_id}' สถานะ {run_status}: {run_obj.get('summary', '')}",
    }


def _handle_task_compose(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    goal = str(payload.get("goal") or "").strip()
    if not goal:
        return {"ok": False, "status": "FAILED", "error": "goal is required.", "output": {}}
    registry = ctx["registry"]
    plan = registry.compose_for_goal(goal, user_role=ctx.get("user_role") or "user")
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": plan,
        "summary": (
            f"ประกอบแผนงานจากคลังเครื่องมือ: เลือกใช้ {plan['reuse_existing_count']} ความสามารถพร้อมใช้ "
            f"จาก {len(plan['selected_toolkits'])} Toolkits"
        ),
    }


def _handle_workflow_status(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    conn = ctx.get("conn")
    if conn is None:
        return {"ok": False, "status": "BLOCKED", "error": "Database connection unavailable.", "output": {}}
    uid = ctx.get("user_id")
    is_admin = str(ctx.get("user_role") or "").lower() == "admin"
    limit = max(1, min(30, int(payload.get("limit") or 10)))

    if is_admin:
        runs = [
            dict(r)
            for r in conn.execute(
                "SELECT id, group_id, status, summary, created_at, updated_at FROM workflow_runs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        ]
        missions = [
            dict(r)
            for r in conn.execute(
                "SELECT id, goal, status, created_at, updated_at FROM autonomous_missions ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        ]
    else:
        runs = [
            dict(r)
            for r in conn.execute(
                "SELECT id, group_id, status, summary, created_at, updated_at FROM workflow_runs WHERE triggered_by=? ORDER BY created_at DESC LIMIT ?",
                (uid, limit),
            ).fetchall()
        ]
        missions = [
            dict(r)
            for r in conn.execute(
                "SELECT id, goal, status, created_at, updated_at FROM autonomous_missions WHERE created_by=? ORDER BY created_at DESC LIMIT ?",
                (uid, limit),
            ).fetchall()
        ]

    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "workflow_runs": runs,
            "autonomous_missions": missions,
            "run_count": len(runs),
            "mission_count": len(missions),
        },
        "summary": f"สถานะการประสานงาน: Workflow {len(runs)} รอบ, ภารกิจอัตโนมัติ {len(missions)} รายการ",
    }


def register_automation_toolkit(registry: Any) -> None:
    manifest = ToolkitManifest(
        id="automation",
        name="Automation Toolkit",
        thai_name="ชุดเครื่องมืออัตโนมัติและการประสานงาน",
        version="1.0.0",
        description="รัน Workflow กลางของระบบ ประกอบแผนงานจาก Capability Library และติดตามสถานะภารกิจ/กระบวนการ",
        category="automation",
        dependencies=("python_core.zyrquen_core", "apps.core.workflow.governance"),
        default_permission="auto",
        lifecycle_status="READY",
        bound_modules=("python_core/zyrquen_core.py", "python_core/dag_executor.py", "apps/core/workflow/governance.py"),
        documentation="ประสานงานผ่าน Workflow Engine กลางเพียงตัวเดียวโดยไม่สร้าง Scheduler ซ้ำซ้อน",
    )

    specs = [
        (
            CapabilitySpec(
                id="automation.workflow_execute",
                toolkit_id="automation",
                name="สั่งรัน Workflow Engine กลาง",
                version="1.0.0",
                description="สั่งดำเนินงานกลุ่ม Workflow ที่ลงทะเบียนใน ZYRQUEN (เช่น system_ops, data_quality, native_training ผ่าน Approval Gate)",
                input_schema={
                    "type": "object",
                    "required": ["group_id"],
                    "properties": {
                        "group_id": {"type": "string"},
                        "dataset_id": {"type": "string"},
                    },
                },
                output_schema={"type": "object", "required": ["run"]},
                dependencies=("python_core.zyrquen_core",),
                permission_mode="auto",
                risk_tier="governance",
                lifecycle_status="READY",
                bound_modules=("python_core/zyrquen_core.py",),
                documentation="ระบุ group_id เช่น 'system_ops', 'data_quality', 'knowledge_memory', 'security_governance', 'native_training'",
                example_input={"group_id": "system_ops"},
                keywords=("workflow", "automation", "schedule", "run", "อัตโนมัติ", "เวิร์กโฟลว์", "ประสานงาน"),
            ),
            _handle_workflow_execute,
        ),
        (
            CapabilitySpec(
                id="automation.task_compose",
                toolkit_id="automation",
                name="ประกอบงานอัตโนมัติจาก Tool Center (Orchestration Composer)",
                version="1.0.0",
                description="วิเคราะห์เป้าหมายเพื่อจับคู่และเลือกใช้เครื่องมือที่มีอยู่แล้วใน Tool Center โดยไม่สร้างซ้ำ",
                input_schema={
                    "type": "object",
                    "required": ["goal"],
                    "properties": {"goal": {"type": "string"}},
                },
                output_schema={"type": "object", "required": ["selected_capabilities", "selected_toolkits", "reuse_existing_count"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/registry.py",),
                documentation="ส่ง goal เพื่อค้นหา Toolkit และความสามารถที่พร้อมใช้งานจริง",
                example_input={"goal": "วิเคราะห์ข้อมูล CSV ตรวจความปลอดภัยและสร้างเอกสารสรุป"},
                keywords=("orchestrate", "compose", "plan", "task", "วางแผน", "จัดลำดับ", "ประกอบงาน"),
            ),
            _handle_task_compose,
        ),
        (
            CapabilitySpec(
                id="automation.workflow_status",
                toolkit_id="automation",
                name="ติดตามสถานะ Workflow และภารกิจ (Process Coordination)",
                version="1.0.0",
                description="ดึงสถานะล่าสุดของ Workflow Runs และ Autonomous Missions ตามสิทธิ์ผู้ใช้งาน",
                input_schema={
                    "type": "object",
                    "required": [],
                    "properties": {"limit": {"type": "integer"}},
                },
                output_schema={"type": "object", "required": ["workflow_runs", "autonomous_missions"]},
                dependencies=("python_core.zyrquen_core",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/zyrquen_core.py",),
                documentation="แสดงรายการ Workflow และ Mission ล่าสุดที่ผู้ใช้มีสิทธิ์เข้าถึง",
                example_input={"limit": 10},
                keywords=("status", "monitor", "coordination", "workflow", "สถานะ", "ติดตาม"),
            ),
            _handle_workflow_status,
        ),
    ]

    registry.register_toolkit(manifest, specs)
