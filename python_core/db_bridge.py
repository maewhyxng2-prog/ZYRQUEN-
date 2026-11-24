#!/usr/bin/env python3
"""
ZYRQUEN Parameterized SQLite Bridge
Handles structured CRUD operations for Express API routes using parameterized queries.
"""

import json
import sys
import uuid
from zyrquen_core import (
    DATA_DIR,
    WORKFLOW_GROUPS,
    _calc_any_for_tool,
    extract_query_terms,
    get_db,
    get_system_metrics,
    handle_run_workflow,
    init_db,
    now_iso,
    query_knowledge_graph,
    summarize_conversation,
    tokenize,
)
from tools_engine import (
    format_tool_markdown,
    invoke_tool_governed,
    list_workspace_files,
    save_workspace_file,
)


def row_to_dict(row):
    return dict(row) if row is not None else None


def handle_action(action: str, payload: dict) -> dict:
    conn = get_db()

    if action == "auth_status":
        admin_count = conn.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0]
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        conn.close()
        return {"ok": True, "initialized": admin_count > 0, "user_count": user_count}

    if action == "auth_create_user":
        uid = str(uuid.uuid4())
        email = str(payload["email"]).strip().lower()
        display_name = str(payload["display_name"]).strip()
        role = payload["role"]
        if role not in ("admin", "user"):
            conn.close()
            return {"ok": False, "error": "Invalid role"}
        password_hash = str(payload["password_hash"])
        try:
            with conn:
                conn.execute(
                    "INSERT INTO users (id, email, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (uid, email, display_name, role, password_hash, now_iso()),
                )
            user = row_to_dict(
                conn.execute(
                    "SELECT id, email, display_name, role, created_at FROM users WHERE id=?",
                    (uid,),
                ).fetchone()
            )
            conn.close()
            return {"ok": True, "user": user}
        except Exception as exc:
            conn.close()
            return {"ok": False, "error": str(exc)}

    if action == "auth_find_by_email":
        email = str(payload["email"]).strip().lower()
        user = row_to_dict(conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone())
        conn.close()
        return {"ok": True, "user": user}

    if action == "auth_find_by_id":
        uid = str(payload["user_id"])
        user = row_to_dict(
            conn.execute(
                "SELECT id, email, display_name, role, created_at FROM users WHERE id=?",
                (uid,),
            ).fetchone()
        )
        conn.close()
        return {"ok": True, "user": user}

    if action == "home_summary":
        uid = str(payload["user_id"])
        recent = [
            dict(r)
            for r in conn.execute(
                """
                SELECT c.id, c.title, c.mode, c.updated_at,
                       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
                FROM conversations c
                WHERE c.user_id = ?
                ORDER BY c.updated_at DESC
                LIMIT 6
                """,
                (uid,),
            ).fetchall()
        ]
        triples = conn.execute("SELECT COUNT(*) FROM knowledge_triples").fetchone()[0]
        ckpts = conn.execute("SELECT COUNT(*) FROM checkpoints").fetchone()[0]
        datasets = conn.execute("SELECT COUNT(*) FROM datasets").fetchone()[0]
        pending_approvals = conn.execute("SELECT COUNT(*) FROM workflow_runs WHERE status='PENDING_APPROVAL'").fetchone()[0]
        evaluations = conn.execute("SELECT COUNT(*) FROM evaluations").fetchone()[0]
        conn.close()
        return {
            "ok": True,
            "recent_conversations": recent,
            "counts": {
                "triples": triples,
                "checkpoints": ckpts,
                "datasets": datasets,
                "pending_approvals": pending_approvals,
                "evaluations": evaluations,
            },
            "system": get_system_metrics(),
        }

    if action == "conv_list":
        uid = str(payload["user_id"])
        rows = [
            dict(r)
            for r in conn.execute(
                """
                SELECT c.id, c.title, c.mode, c.created_at, c.updated_at,
                       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
                FROM conversations c
                WHERE c.user_id = ?
                ORDER BY c.updated_at DESC
                """,
                (uid,),
            ).fetchall()
        ]
        conn.close()
        return {"ok": True, "conversations": rows}

    if action == "conv_create":
        uid = str(payload["user_id"])
        title = str(payload.get("title", "New Native Session")).strip() or "New Native Session"
        mode = str(payload.get("mode", "auto"))
        cid = str(uuid.uuid4())
        ts = now_iso()
        with conn:
            conn.execute(
                "INSERT INTO conversations (id, user_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (cid, uid, title[:120], mode, ts, ts),
            )
        conv = row_to_dict(conn.execute("SELECT * FROM conversations WHERE id=?", (cid,)).fetchone())
        conn.close()
        return {"ok": True, "conversation": conv}

    if action == "conv_get":
        uid = str(payload["user_id"])
        cid = str(payload["conversation_id"])
        conv = row_to_dict(
            conn.execute("SELECT * FROM conversations WHERE id=? AND user_id=?", (cid, uid)).fetchone()
        )
        if not conv:
            conn.close()
            return {"ok": False, "error": "Conversation not found"}
        msgs = [
            dict(m)
            for m in conn.execute(
                "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC, rowid ASC",
                (cid,),
            ).fetchall()
        ]
        conn.close()
        return {"ok": True, "conversation": conv, "messages": msgs}

    if action == "conv_summary":
        uid = str(payload["user_id"])
        cid = str(payload["conversation_id"])
        conv = row_to_dict(
            conn.execute("SELECT * FROM conversations WHERE id=? AND user_id=?", (cid, uid)).fetchone()
        )
        if not conv:
            conn.close()
            return {"ok": False, "error": "Conversation not found"}
        msgs = [
            dict(m)
            for m in conn.execute(
                "SELECT id, role, content, mode, trace_json, status, created_at FROM messages WHERE conversation_id=? ORDER BY created_at ASC, rowid ASC",
                (cid,),
            ).fetchall()
        ]
        conn.close()
        return {"ok": True, "summary": summarize_conversation(msgs)}

    if action == "conv_delete":
        uid = str(payload["user_id"])
        cid = str(payload["conversation_id"])
        with conn:
            cur = conn.execute("DELETE FROM conversations WHERE id=? AND user_id=?", (cid, uid))
        conn.close()
        return {"ok": cur.rowcount > 0}

    if action == "conv_save_exchange":
        uid = str(payload["user_id"])
        cid = str(payload["conversation_id"])
        conv = conn.execute("SELECT * FROM conversations WHERE id=? AND user_id=?", (cid, uid)).fetchone()
        if not conv:
            conn.close()
            return {"ok": False, "error": "Conversation not found"}
        user_msg_id = str(uuid.uuid4())
        asst_msg_id = str(uuid.uuid4())
        ts = now_iso()
        user_content = str(payload["user_content"])
        mode = str(payload.get("mode", "auto"))
        asst_content = str(payload["assistant_content"])
        asst_status = str(payload.get("assistant_status", "VERIFIED"))
        trace_json = json.dumps(payload.get("trace", {}))
        new_title = conv["title"]
        if new_title == "New Native Session" and user_content:
            new_title = user_content[:48] + ("..." if len(user_content) > 48 else "")
        with conn:
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, mode, trace_json, status, created_at) VALUES (?, ?, 'user', ?, ?, NULL, 'USER', ?)",
                (user_msg_id, cid, user_content, mode, ts),
            )
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, mode, trace_json, status, created_at) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)",
                (asst_msg_id, cid, asst_content, mode, trace_json, asst_status, now_iso()),
            )
            conn.execute(
                "UPDATE conversations SET title=?, mode=?, updated_at=? WHERE id=?",
                (new_title, mode, now_iso(), cid),
            )
        user_msg = row_to_dict(conn.execute("SELECT * FROM messages WHERE id=?", (user_msg_id,)).fetchone())
        asst_msg = row_to_dict(conn.execute("SELECT * FROM messages WHERE id=?", (asst_msg_id,)).fetchone())
        conn.close()
        return {"ok": True, "title": new_title, "user_message": user_msg, "assistant_message": asst_msg}

    if action == "knowledge_list":
        q = str(payload.get("q", "")).strip().lower()
        if q:
            like = f"%{q}%"
            rows = [
                dict(r)
                for r in conn.execute(
                    """
                    SELECT * FROM knowledge_triples
                    WHERE lower(subject) LIKE ? OR lower(relation) LIKE ? OR lower(object) LIKE ?
                    ORDER BY created_at DESC LIMIT 100
                    """,
                    (like, like, like),
                ).fetchall()
            ]
        else:
            rows = [
                dict(r)
                for r in conn.execute("SELECT * FROM knowledge_triples ORDER BY created_at DESC LIMIT 100").fetchall()
            ]
        conn.close()
        return {"ok": True, "triples": rows}

    if action == "knowledge_create":
        subj = str(payload["subject"]).strip()
        rel = str(payload["relation"]).strip()
        obj = str(payload["object"]).strip()
        uid = str(payload["user_id"])
        source = str(payload.get("source", "manual_memory"))
        existing = conn.execute(
            "SELECT object FROM knowledge_triples WHERE lower(subject)=lower(?) AND lower(relation)=lower(?)",
            (subj, rel),
        ).fetchall()
        contradictions = [r["object"] for r in existing if r["object"].lower() != obj.lower()]
        tid = str(uuid.uuid4())
        with conn:
            conn.execute(
                "INSERT INTO knowledge_triples (id, subject, relation, object, source, confidence, created_by, created_at) VALUES (?, ?, ?, ?, ?, 1.0, ?, ?)",
                (tid, subj, rel, obj, source, uid, now_iso()),
            )
        triple = row_to_dict(conn.execute("SELECT * FROM knowledge_triples WHERE id=?", (tid,)).fetchone())
        conn.close()
        return {"ok": True, "triple": triple, "contradictions": contradictions}

    if action == "knowledge_delete":
        tid = str(payload["triple_id"])
        uid = str(payload["user_id"])
        is_admin = bool(payload.get("is_admin", False))
        with conn:
            if is_admin:
                cur = conn.execute("DELETE FROM knowledge_triples WHERE id=?", (tid,))
            else:
                cur = conn.execute("DELETE FROM knowledge_triples WHERE id=? AND created_by=?", (tid, uid))
        conn.close()
        return {"ok": cur.rowcount > 0}

    if action == "workflows_list":
        runs = [
            dict(r)
            for r in conn.execute("SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT 30").fetchall()
        ]
        conn.close()
        return {"ok": True, "groups": WORKFLOW_GROUPS, "runs": runs}

    if action == "workflow_decide":
        run_id = str(payload["run_id"])
        decision = str(payload["decision"])
        admin_email = str(payload["admin_email"])
        admin_id = str(payload["admin_id"])
        run = conn.execute("SELECT * FROM workflow_runs WHERE id=?", (run_id,)).fetchone()
        if not run:
            conn.close()
            return {"ok": False, "error": "Workflow run not found"}
        if run["status"] != "PENDING_APPROVAL":
            conn.close()
            return {"ok": False, "error": "Workflow run is not awaiting approval"}
        if decision == "reject":
            stages = json.loads(run["stages_json"])
            for s in stages:
                if s.get("stage") == "approval_gate":
                    s["status"] = "REJECTED"
                    s["detail"] = f"Rejected by {admin_email}"
            with conn:
                conn.execute(
                    "UPDATE workflow_runs SET status='REJECTED', approved_by=?, summary=?, stages_json=?, updated_at=? WHERE id=?",
                    (admin_email, f"Rejected at Approval Gate by {admin_email}.", json.dumps(stages), now_iso(), run_id),
                )
            updated = row_to_dict(conn.execute("SELECT * FROM workflow_runs WHERE id=?", (run_id,)).fetchone())
            conn.close()
            return {"ok": True, "run": updated}
        group_id = run["group_id"]
        conn.close()
        return handle_run_workflow(
            {
                "group_id": group_id,
                "user_id": admin_id,
                "approved_by": admin_email,
                "run_id": run_id,
                "dataset_id": payload.get("dataset_id"),
            }
        )

    if action == "dev_overview":
        uid = str(payload["user_id"])
        keys = [
            dict(r)
            for r in conn.execute(
                "SELECT id, name, key_prefix, scopes_json, quota_daily, requests_today, last_used_at, revoked, created_at FROM api_keys WHERE user_id=? ORDER BY created_at DESC",
                (uid,),
            ).fetchall()
        ]
        datasets = [
            dict(r)
            for r in conn.execute(
                "SELECT id, name, manifest_hash, total_records, train_count, val_count, test_count, leakage_detected, status, created_at FROM datasets ORDER BY created_at DESC LIMIT 20"
            ).fetchall()
        ]
        checkpoints = [
            dict(r)
            for r in conn.execute(
                "SELECT id, version, dataset_id, vocab_size, ngram_order, train_loss, val_loss, perplexity, eval_accuracy, eval_status, created_at FROM checkpoints ORDER BY version DESC LIMIT 20"
            ).fetchall()
        ]
        usage_total = conn.execute("SELECT COUNT(*) FROM api_usage_logs WHERE user_id=?", (uid,)).fetchone()[0]
        avg_lat = conn.execute("SELECT COALESCE(AVG(latency_ms), 0) FROM api_usage_logs WHERE user_id=?", (uid,)).fetchone()[0]
        recent_usage = [
            dict(r)
            for r in conn.execute(
                "SELECT endpoint, method, status_code, latency_ms, created_at FROM api_usage_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 15",
                (uid,),
            ).fetchall()
        ]
        evaluations = [
            dict(r)
            for r in conn.execute(
                "SELECT id, checkpoint_version, suite_name, overall_status, math_score, knowledge_score, planning_score, test_accuracy, perplexity, baseline_delta_json, created_at FROM evaluations ORDER BY created_at DESC LIMIT 10"
            ).fetchall()
        ]
        conn.close()
        return {
            "ok": True,
            "keys": keys,
            "datasets": datasets,
            "checkpoints": checkpoints,
            "evaluations": evaluations,
            "usage": {
                "total_requests": usage_total,
                "avg_latency_ms": round(float(avg_lat), 1),
                "daily_quota": 1000,
                "recent": recent_usage,
            },
        }

    if action == "dev_key_create":
        kid = str(uuid.uuid4())
        with conn:
            conn.execute(
                "INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes_json, quota_daily, requests_today, revoked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)",
                (
                    kid,
                    str(payload["user_id"]),
                    str(payload["name"]).strip(),
                    str(payload["key_prefix"]),
                    str(payload["key_hash"]),
                    json.dumps(payload.get("scopes", ["infer:read"])),
                    int(payload.get("quota_daily", 1000)),
                    now_iso(),
                ),
            )
        row = row_to_dict(
            conn.execute(
                "SELECT id, name, key_prefix, scopes_json, quota_daily, requests_today, revoked, created_at FROM api_keys WHERE id=?",
                (kid,),
            ).fetchone()
        )
        conn.close()
        return {"ok": True, "key": row}

    if action == "dev_key_revoke":
        kid = str(payload["key_id"])
        uid = str(payload["user_id"])
        with conn:
            cur = conn.execute("UPDATE api_keys SET revoked=1 WHERE id=? AND user_id=?", (kid, uid))
        conn.close()
        return {"ok": cur.rowcount > 0}

    if action == "admin_overview":
        users = [
            dict(r)
            for r in conn.execute(
                "SELECT id, email, display_name, role, created_at FROM users ORDER BY created_at ASC"
            ).fetchall()
        ]
        pending_runs = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM workflow_runs WHERE status='PENDING_APPROVAL' ORDER BY created_at DESC"
            ).fetchall()
        ]
        audit_logs = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 40"
            ).fetchall()
        ]
        pending_tool_invocations = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM tool_invocations WHERE status='PENDING_APPROVAL' ORDER BY created_at DESC"
            ).fetchall()
        ]
        tools = [
            dict(r)
            for r in conn.execute("SELECT * FROM external_tools ORDER BY id ASC").fetchall()
        ]
        conn.close()
        return {
            "ok": True,
            "users": users,
            "pending_runs": pending_runs,
            "pending_tool_invocations": pending_tool_invocations,
            "tools": tools,
            "audit_logs": audit_logs,
            "system": get_system_metrics(),
        }

    if action == "admin_user_role":
        target_id = str(payload["target_user_id"])
        new_role = str(payload["role"])
        if new_role not in ("admin", "user"):
            conn.close()
            return {"ok": False, "error": "Invalid role"}
        with conn:
            cur = conn.execute("UPDATE users SET role=? WHERE id=?", (new_role, target_id))
        conn.close()
        return {"ok": cur.rowcount > 0}

    if action == "log_api_usage":
        with conn:
            conn.execute(
                "INSERT INTO api_usage_logs (id, user_id, key_id, endpoint, method, status_code, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    payload.get("user_id"),
                    payload.get("key_id"),
                    str(payload["endpoint"]),
                    str(payload["method"]),
                    int(payload["status_code"]),
                    float(payload["latency_ms"]),
                    now_iso(),
                ),
            )
        conn.close()
        return {"ok": True}

    if action == "log_audit":
        with conn:
            conn.execute(
                "INSERT INTO audit_logs (id, actor_id, actor_email, action, target, outcome, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(uuid.uuid4()),
                    str(payload["actor_id"]),
                    str(payload["actor_email"]),
                    str(payload["action"]),
                    str(payload["target"]),
                    str(payload["outcome"]),
                    json.dumps(payload.get("details", {})),
                    now_iso(),
                ),
            )
        conn.close()
        return {"ok": True}

    if action == "tools_overview":
        uid = str(payload.get("user_id", ""))
        tools = [dict(r) for r in conn.execute("SELECT * FROM external_tools ORDER BY id ASC").fetchall()]
        invocations = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM tool_invocations WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
                (uid,),
            ).fetchall()
        ]
        ws_files = list_workspace_files(DATA_DIR)
        conn.close()
        return {"ok": True, "tools": tools, "invocations": invocations, "workspace_files": ws_files}

    if action == "tools_upload_file":
        filename = str(payload.get("filename", "")).strip()
        content = str(payload.get("content", ""))
        res = save_workspace_file(DATA_DIR, filename, content)
        conn.close()
        return res

    if action == "tools_invoke":
        tool_id = str(payload.get("tool_id", "")).strip()
        tool_input = payload.get("input", {})
        if not isinstance(tool_input, dict):
            tool_input = {}
        uid = str(payload.get("user_id", ""))
        res = invoke_tool_governed(
            conn,
            DATA_DIR,
            tool_id,
            tool_input,
            user_id=uid,
            conversation_id=payload.get("conversation_id"),
            approved_by=None,
            tokenize_fn=tokenize,
            extract_terms_fn=extract_query_terms,
            query_kg_fn=query_knowledge_graph,
            calc_fn=_calc_any_for_tool,
        )
        conn.close()
        return res

    if action == "admin_tools_update":
        tool_id = str(payload.get("tool_id", "")).strip()
        row = conn.execute("SELECT * FROM external_tools WHERE id=?", (tool_id,)).fetchone()
        if not row:
            conn.close()
            return {"ok": False, "error": "Tool not found"}
        perm = str(payload.get("permission_mode", row["permission_mode"]))
        if perm not in ("auto", "approval_required", "disabled"):
            conn.close()
            return {"ok": False, "error": "Invalid permission_mode"}
        enabled = 1 if payload.get("enabled", row["enabled"]) else 0
        quota = max(1, min(10000, int(payload.get("quota_daily", row["quota_daily"]))))
        allowlist = payload.get("endpoint_allowlist")
        if isinstance(allowlist, list):
            allow_json = json.dumps([str(x).strip().lower() for x in allowlist if str(x).strip()][:20])
        else:
            allow_json = row["endpoint_allowlist_json"]
        with conn:
            conn.execute(
                """
                UPDATE external_tools
                SET permission_mode=?, enabled=?, quota_daily=?, endpoint_allowlist_json=?, updated_at=?
                WHERE id=?
                """,
                (perm, enabled, quota, allow_json, now_iso(), tool_id),
            )
        updated = row_to_dict(conn.execute("SELECT * FROM external_tools WHERE id=?", (tool_id,)).fetchone())
        conn.close()
        return {"ok": True, "tool": updated}

    if action == "admin_tool_decide":
        inv_id = str(payload.get("invocation_id", "")).strip()
        decision = str(payload.get("decision", "approve"))
        admin_email = str(payload.get("admin_email", ""))
        inv = conn.execute("SELECT * FROM tool_invocations WHERE id=?", (inv_id,)).fetchone()
        if not inv:
            conn.close()
            return {"ok": False, "error": "Tool invocation not found"}
        if inv["status"] != "PENDING_APPROVAL":
            conn.close()
            return {"ok": False, "error": "Tool invocation is not pending approval"}
        if decision == "reject":
            with conn:
                conn.execute(
                    """
                    UPDATE tool_invocations
                    SET status='REJECTED', approved_by=?, analysis_summary=?, updated_at=?
                    WHERE id=?
                    """,
                    (admin_email, f"ปฏิเสธโดยผู้ดูแลระบบ ({admin_email})", now_iso(), inv_id),
                )
            updated = row_to_dict(conn.execute("SELECT * FROM tool_invocations WHERE id=?", (inv_id,)).fetchone())
            conn.close()
            return {"ok": True, "invocation": updated}

        try:
            tool_input = json.loads(inv["input_json"] or "{}")
        except Exception:
            tool_input = {}
        res = invoke_tool_governed(
            conn,
            DATA_DIR,
            inv["tool_id"],
            tool_input,
            user_id=inv["user_id"],
            conversation_id=inv["conversation_id"],
            approved_by=admin_email,
            existing_invocation_id=inv_id,
            tokenize_fn=tokenize,
            extract_terms_fn=extract_query_terms,
            query_kg_fn=query_knowledge_graph,
            calc_fn=_calc_any_for_tool,
        )
        if inv["conversation_id"] and res.get("ok"):
            md = format_tool_markdown(inv["tool_id"], res)
            analysis_obj = res.get("analysis") or {}
            t_grade = analysis_obj.get("trust_grade")
            if res.get("status") != "COMPLETED":
                msg_status = "BLOCKED" if res.get("status") == "BLOCKED" else "FAILED"
            elif t_grade in {"INSUFFICIENT_EVIDENCE", "CONFLICTING_SOURCES"}:
                msg_status = "NOT_LEARNED"
            elif t_grade == "BLOCKED":
                msg_status = "BLOCKED"
            else:
                msg_status = "VERIFIED"
            trace_obj = {
                "mode": "auto",
                "engine_path": [f"external_tool:{inv['tool_id']}", "native_tool_synthesizer"],
                "external_models_used": False,
                "approved_by": admin_email,
                "external_tool": {
                    "tool_id": inv["tool_id"],
                    "status": res.get("status"),
                    "invocation_id": inv_id,
                    "trust_grade": analysis_obj.get("trust_grade"),
                    "distinct_providers": analysis_obj.get("distinct_providers", []),
                    "kg_matches_count": len(analysis_obj.get("kg_matches") or []),
                    "limitations": analysis_obj.get("limitations", []),
                    "analysis_summary": analysis_obj.get("summary"),
                },
            }
            with conn:
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, mode, trace_json, status, created_at) VALUES (?, ?, 'assistant', ?, 'auto', ?, ?, ?)",
                    (str(uuid.uuid4()), inv["conversation_id"], md, json.dumps(trace_obj), msg_status, now_iso()),
                )
        conn.close()
        return res

    conn.close()
    return {"ok": False, "error": f"Unknown bridge action '{action}'"}


def main() -> None:
    init_db()
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"ok": False, "error": "Empty payload"}))
        return
    req = json.loads(raw)
    action = req.get("action", "")
    payload = req.get("payload", {})
    print(json.dumps(handle_action(action, payload)))


if __name__ == "__main__":
    main()
