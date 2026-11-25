"""
Research Toolkit for ZYRQUEN Tool Center.
Binds SSRF URL validation, multi-source ResearchVerifier, and P5-gated web_search / doc_fetch.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from apps.core.intelligence.memory_layers import VerifiedKnowledgeStore
from apps.core.intelligence.research import ResearchSource, ResearchVerifier, validate_research_url
import tools_engine as te
import zyrquen_core as zc

from ..contracts import CapabilitySpec, ToolkitManifest


def _is_blocked_ai_host(host: str) -> bool:
    h = (host or "").strip().lower()
    return any(h == b or h.endswith(f".{b}") for b in te.BLOCKED_EXTERNAL_LLM_HOSTS)


def _handle_url_validate(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    url = str(payload.get("url") or "").strip()
    res = validate_research_url(url)
    host = str(res.get("host") or (urlparse(url).hostname or "")).strip().lower()
    ai_blocked = _is_blocked_ai_host(host)
    scheme_ok = str(res.get("scheme") or "").lower() == "https"
    policy_ok = bool(res.get("valid")) and scheme_ok and not ai_blocked
    err_reason = None
    if ai_blocked:
        err_reason = f"ถูกบล็อกตามนโยบาย ZYRQUEN: ไม่อนุญาตให้เชื่อมต่อโฮสต์โมเดล AI ภายนอก ({host})"
    elif not res.get("valid"):
        err_reason = str(res.get("reason"))
    elif not scheme_ok:
        err_reason = "อนุญาตเฉพาะโปรโตคอล https:// เท่านั้น"

    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "url": url,
            "safe": policy_ok,
            "research_validation": res,
            "network_policy_ok": policy_ok,
            "error": err_reason,
        },
        "summary": f"ตรวจสอบ URL {'ปลอดภัยพร้อมใช้งาน' if policy_ok else 'ไม่ผ่านนโยบายความปลอดภัย'}: {url}",
    }


def _handle_evidence_corroborate(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    topic = str(payload.get("topic") or "").strip()
    raw_sources = payload.get("sources") or []
    if not topic or not isinstance(raw_sources, list):
        return {
            "ok": False,
            "status": "FAILED",
            "error": "topic and sources list are required.",
            "output": {},
        }

    now_iso = datetime.now(timezone.utc).isoformat()
    sources: list[ResearchSource] = []
    for idx, item in enumerate(raw_sources, start=1):
        if not isinstance(item, dict):
            continue
        ts_raw = str(item.get("retrieved_at") or "").strip() or now_iso
        url_val = str(item.get("url") or item.get("source_url") or "")
        provider_val = str(item.get("provider") or item.get("source_authority") or "").strip() or None
        source_id = str(item.get("source_id") or provider_val or f"src-{idx}")
        claim_val = str(item.get("claim") or item.get("claim_text") or item.get("raw_text") or "")
        sources.append(
            ResearchSource(
                source_id=source_id,
                source_url=url_val,
                retrieved_at=ts_raw,
                claim_text=claim_val,
                polarity=str(item.get("polarity") or "affirms"),
                canonical_value=item.get("canonical_value"),
                credibility_score=float(item.get("credibility_score", 0.85)),
                source_authority=provider_val,
            )
        )

    verifier = ResearchVerifier()
    kg_store = VerifiedKnowledgeStore()
    verdict = verifier.verify_claim(topic=topic, sources=sources, knowledge_store=kg_store)
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "topic": topic,
            "verdict": verdict.status,
            "learnable": verdict.learnable,
            "verified_fact": verdict.verified_claim,
            "sources_used": list(verdict.sources_used),
            "rejected_reasons": [f"{k}: {v}" for k, v in verdict.rejected_sources.items()],
            "rejected_sources": dict(verdict.rejected_sources),
            "injection_detected": verdict.injection_detected,
            "written_to_verified_memory": verdict.learnable,
        },
        "summary": f"ผลตรวจสอบหลักฐานหัวข้อ '{topic}': {verdict.status} (แหล่งที่ผ่าน {len(verdict.sources_used)})",
    }


def _handle_web_search(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    res = te.invoke_tool_governed(
        ctx["conn"],
        ctx["data_dir"],
        "web_search",
        {"query": str(payload.get("query") or "").strip()},
        user_id=ctx["user_id"],
        conversation_id=ctx.get("conversation_id"),
        approved_by=ctx.get("approved_by"),
        tokenize_fn=zc.tokenize,
        extract_terms_fn=zc.extract_query_terms,
        query_kg_fn=zc.query_knowledge_graph,
        calc_fn=zc._calc_any_for_tool,
    )
    return {
        "ok": bool(res.get("ok")),
        "status": str(res.get("status") or "FAILED"),
        "output": {
            "tool_invocation": res.get("invocation"),
            "analysis": res.get("analysis"),
            "tool_output": res.get("output"),
        },
        "summary": str((res.get("analysis") or {}).get("summary") or f"web_search status: {res.get('status')}"),
        "error": res.get("error"),
    }


def _handle_doc_fetch(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    res = te.invoke_tool_governed(
        ctx["conn"],
        ctx["data_dir"],
        "doc_fetch",
        {"url": str(payload.get("url") or "").strip()},
        user_id=ctx["user_id"],
        conversation_id=ctx.get("conversation_id"),
        approved_by=ctx.get("approved_by"),
        tokenize_fn=zc.tokenize,
        extract_terms_fn=zc.extract_query_terms,
        query_kg_fn=zc.query_knowledge_graph,
        calc_fn=zc._calc_any_for_tool,
    )
    return {
        "ok": bool(res.get("ok")),
        "status": str(res.get("status") or "FAILED"),
        "output": {
            "tool_invocation": res.get("invocation"),
            "analysis": res.get("analysis"),
            "tool_output": res.get("output"),
        },
        "summary": str((res.get("analysis") or {}).get("summary") or f"doc_fetch status: {res.get('status')}"),
        "error": res.get("error"),
    }


def _handle_knowledge_retrieve(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or "").strip()
    target_entity = str(payload.get("target_entity") or "").strip()
    conn = ctx.get("conn")
    if conn is None:
        return {"ok": False, "status": "BLOCKED", "error": "Database connection unavailable.", "output": {}}
    if not query:
        return {"ok": False, "status": "FAILED", "error": "query is required.", "output": {}}

    hits = zc.query_knowledge_graph(conn, query)
    path_info = None
    if target_entity:
        path_info = zc.find_graph_path(conn, query, target_entity, max_depth=4)

    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "query": query,
            "matches": hits,
            "match_count": len(hits),
            "graph_path": path_info,
        },
        "summary": f"สืบค้นกราฟความรู้ '{query}': พบ {len(hits)} ความสัมพันธ์",
    }


def register_research_toolkit(registry: Any) -> None:
    manifest = ToolkitManifest(
        id="research",
        name="Research Toolkit",
        thai_name="ชุดเครื่องมือวิจัยและตรวจสอบหลักฐาน",
        version="1.1.0",
        description="ค้นคืนกราฟความรู้ภายใน ตรวจสอบความปลอดภัย URL, ยืนยันหลักฐานจากหลายแหล่ง และสืบค้นเว็บ/เอกสารภายใต้ P5 Approval Gate",
        category="research",
        dependencies=("apps.core.intelligence.research", "python_core.tools_engine", "python_core.zyrquen_core"),
        default_permission="auto",
        lifecycle_status="READY",
        bound_modules=(
            "apps/core/intelligence/research.py",
            "python_core/research_pipeline.py",
            "python_core/tools_engine.py",
            "python_core/zyrquen_core.py",
        ),
        documentation="แยกส่วนค้นความรู้และวิเคราะห์หลักฐานออฟไลน์ออกจากคำขอเครือข่ายภายนอกซึ่งต้องผ่าน P5 Approval Gate",
    )

    specs = [
        (
            CapabilitySpec(
                id="research.knowledge_retrieve",
                toolkit_id="research",
                name="ค้นคืนและเชื่อมโยงกราฟความรู้ภายใน (Knowledge Retrieval)",
                version="1.0.0",
                description="ค้นหาความสัมพันธ์ใน SQLite Knowledge Graph (รวมอนุมานหลายช่วง Multi-Hop BFS)",
                input_schema={
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": {"type": "string"},
                        "target_entity": {"type": "string"},
                    },
                },
                output_schema={"type": "object", "required": ["query", "matches", "match_count"]},
                dependencies=("python_core.zyrquen_core",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/zyrquen_core.py",),
                documentation="ค้นหาข้อเท็จจริงและเส้นทางเชื่อมโยงระหว่างโหนดในกราฟความรู้",
                example_input={"query": "ZYRQUEN"},
                keywords=("knowledge", "graph", "kg", "retrieve", "ความรู้", "ค้นคืน", "วิจัย"),
            ),
            _handle_knowledge_retrieve,
        ),
        (
            CapabilitySpec(
                id="research.url_validate",
                toolkit_id="research",
                name="ตรวจสอบความปลอดภัย URL (SSRF & AI-Host Guard)",
                version="1.0.0",
                description="ตรวจว่า URL เป็นสาธารณะที่ปลอดภัย ไม่ใช่เครือข่ายภายใน/localhost/placeholder หรือโฮสต์ LLM ภายนอก",
                input_schema={
                    "type": "object",
                    "required": ["url"],
                    "properties": {"url": {"type": "string"}},
                },
                output_schema={"type": "object", "required": ["safe", "url"]},
                dependencies=("apps.core.intelligence.research", "python_core.tools_engine"),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("apps/core/intelligence/research.py", "python_core/tools_engine.py"),
                documentation="ตรวจสอบ URL ก่อนดึงเอกสารเพื่อป้องกัน SSRF และโฮสต์ต้องห้าม",
                example_input={"url": "https://en.wikipedia.org/wiki/SQLite"},
                keywords=("url", "ssrf", "research", "link", "วิจัย", "ตรวจสอบลิงก์"),
            ),
            _handle_url_validate,
        ),
        (
            CapabilitySpec(
                id="research.evidence_corroborate",
                toolkit_id="research",
                name="ตรวจสอบและสอบทานหลักฐานหลายแหล่ง",
                version="1.0.0",
                description="ตรวจ Prompt Injection, ความขัดแย้งระหว่างแหล่ง, และความเก่าของข้อมูลโดยไม่ปลอมผล VERIFIED",
                input_schema={
                    "type": "object",
                    "required": ["topic", "sources"],
                    "properties": {
                        "topic": {"type": "string"},
                        "sources": {"type": "array"},
                    },
                },
                output_schema={"type": "object", "required": ["verdict", "sources_used", "rejected_reasons"]},
                dependencies=("apps.core.intelligence.research", "apps.core.intelligence.memory_layers"),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("apps/core/intelligence/research.py", "apps/core/intelligence/memory_layers.py"),
                documentation="ส่ง topic และรายการ sources [{url, provider, claim, raw_text}] เพื่อประเมินความน่าเชื่อถือ",
                example_input={
                    "topic": "SQLite WAL",
                    "sources": [
                        {
                            "url": "https://www.sqlite.org/wal.html",
                            "provider": "sqlite.org",
                            "claim": "WAL allows concurrent readers and one writer.",
                        },
                        {
                            "url": "https://en.wikipedia.org/wiki/SQLite",
                            "provider": "wikipedia",
                            "claim": "WAL allows concurrent readers and one writer.",
                        },
                    ],
                },
                keywords=("evidence", "corroborate", "research", "verify", "หลักฐาน", "วิจัย", "ความน่าเชื่อถือ"),
            ),
            _handle_evidence_corroborate,
        ),
        (
            CapabilitySpec(
                id="research.web_search",
                toolkit_id="research",
                name="สืบค้นเว็บหลายแหล่ง (P5 Gate)",
                version="1.0.0",
                description="สืบค้น Wikipedia และ DuckDuckGo Instant API ผ่าน HTTPS ภายใต้การอนุมัติ P5 Approval Gate",
                input_schema={
                    "type": "object",
                    "required": ["query"],
                    "properties": {"query": {"type": "string"}},
                },
                output_schema={"type": "object", "required": []},
                dependencies=("python_core.tools_engine",),
                permission_mode="approval_required",
                risk_tier="external_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tools_engine.py",),
                documentation="คำขอจากผู้ใช้ทั่วไปจะเข้าสู่สถานะ PENDING_APPROVAL จนกว่าผู้ดูแลจะอนุมัติ",
                example_input={"query": "SQLite WAL"},
                keywords=("search", "web", "research", "สืบค้น", "วิจัย"),
            ),
            _handle_web_search,
        ),
        (
            CapabilitySpec(
                id="research.doc_fetch",
                toolkit_id="research",
                name="อ่านเอกสารเว็บสาธารณะ (P5 Gate)",
                version="1.0.0",
                description="ดึงเนื้อหาและโครงสร้างหัวข้อจากเอกสาร HTTPS ที่ผ่าน Allowlist ภายใต้การอนุมัติ P5 Approval Gate",
                input_schema={
                    "type": "object",
                    "required": ["url"],
                    "properties": {"url": {"type": "string"}},
                },
                output_schema={"type": "object", "required": []},
                dependencies=("python_core.tools_engine",),
                permission_mode="approval_required",
                risk_tier="external_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tools_engine.py",),
                documentation="จำกัดเฉพาะโดเมนใน Allowlist และบล็อกเครือข่ายภายใน",
                example_input={"url": "https://en.wikipedia.org/wiki/SQLite"},
                keywords=("fetch", "document", "url", "วิจัย", "อ่านเว็บ"),
            ),
            _handle_doc_fetch,
        ),
    ]

    registry.register_toolkit(manifest, specs)
