#!/usr/bin/env python3
"""
ZYRQUEN Native-First + Tool-Augmented Intelligence Engine
---------------------------------------------------------
P1: Tool Execution Adapter with explicit contracts, risk tiers, & input validation
P2: Real Multi-Source Public Web Search (MediaWiki + DuckDuckGo Instant API) & Document Reader
P3: Structured Evidence Verification (untrusted web tagging, multi-source corroboration,
    knowledge-graph cross-checking, and honest data-limitation reporting inside Native Core)
P4: Local Deterministic Compute (AST/Algebra/Stats) & Sandboxed Workspace File Manager
P5: Permission Enforcement, Approval Gate, & Unified Audit Trail
"""

from html.parser import HTMLParser
import collections
import ipaddress
import json
import re
import socket
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Callable


BLOCKED_EXTERNAL_LLM_HOSTS = {
    "api.openai.com",
    "openai.com",
    "api.anthropic.com",
    "anthropic.com",
    "generativelanguage.googleapis.com",
    "aiplatform.googleapis.com",
    "api.groq.com",
    "api.together.xyz",
    "openrouter.ai",
    "api.cohere.ai",
    "api-inference.huggingface.co",
    "api.mistral.ai",
    "api.perplexity.ai",
}

TOOL_CONTRACTS = {
    "web_search": {
        "risk_tier": "external_readonly",
        "untrusted_source": True,
        "required_fields": ["query"],
    },
    "doc_fetch": {
        "risk_tier": "external_readonly",
        "untrusted_source": True,
        "required_fields": ["url"],
    },
    "calc_ast": {
        "risk_tier": "local_readonly",
        "untrusted_source": False,
        "required_fields": ["expression"],
    },
    "workspace_file_read": {
        "risk_tier": "sandbox_io",
        "untrusted_source": False,
        "required_fields": [],
    },
}


class _VisibleTextHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self.title_parts: list[str] = []
        self.headings: list[str] = []
        self._in_title = False
        self._in_heading = False
        self._heading_buf: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        t = tag.lower()
        if t in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        elif t == "title":
            self._in_title = True
        elif t in {"h1", "h2", "h3"}:
            self._in_heading = True
            self._heading_buf = []

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in {"script", "style", "noscript", "svg"} and self._skip_depth > 0:
            self._skip_depth -= 1
        elif t == "title":
            self._in_title = False
        elif t in {"h1", "h2", "h3"} and self._in_heading:
            self._in_heading = False
            heading = re.sub(r"\s+", " ", "".join(self._heading_buf)).strip()
            if heading and len(self.headings) < 8:
                self.headings.append(heading[:120])

    def handle_data(self, data: str) -> None:
        cleaned = re.sub(r"\s+", " ", data).strip()
        if not cleaned or self._skip_depth > 0:
            return
        if self._in_title:
            self.title_parts.append(cleaned)
        else:
            if self._in_heading:
                self._heading_buf.append(cleaned)
            self.text_parts.append(cleaned)


def _today_utc() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _log_tool_audit(
    conn: sqlite3.Connection,
    user_id: str,
    action: str,
    target: str,
    outcome: str,
    details: dict | None = None,
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


def init_tools_schema(conn: sqlite3.Connection, data_dir: Path) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS external_tools (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL CHECK(category IN ('web', 'document', 'compute', 'file')),
            description TEXT NOT NULL,
            endpoint_allowlist_json TEXT NOT NULL DEFAULT '[]',
            permission_mode TEXT NOT NULL CHECK(permission_mode IN ('auto', 'approval_required', 'disabled')),
            enabled INTEGER NOT NULL DEFAULT 1,
            quota_daily INTEGER NOT NULL DEFAULT 50,
            calls_today INTEGER NOT NULL DEFAULT 0,
            last_reset_date TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL DEFAULT 'system',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tool_invocations (
            id TEXT PRIMARY KEY,
            tool_id TEXT NOT NULL,
            conversation_id TEXT,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('PENDING_APPROVAL', 'COMPLETED', 'REJECTED', 'FAILED', 'BLOCKED')),
            input_json TEXT NOT NULL,
            output_json TEXT,
            analysis_summary TEXT,
            approved_by TEXT,
            latency_ms REAL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )

    today = _today_utc()
    now = _now_iso()
    default_web_allowlist = json.dumps(["en.wikipedia.org", "th.wikipedia.org", "api.duckduckgo.com"])
    default_tools = [
        (
            "web_search",
            "ค้นหาเว็บหลายแหล่ง (Multi-Source Web Search)",
            "web",
            "สืบค้นและเปรียบเทียบหลักฐานจาก Wikipedia และ DuckDuckGo Instant API ผ่าน HTTPS (ไม่ใช่ LLM ภายนอก)",
            default_web_allowlist,
            "approval_required",
            1,
            50,
            0,
            today,
            "system",
            now,
        ),
        (
            "doc_fetch",
            "อ่านเอกสารเว็บ (Document Reader Tool)",
            "document",
            "ดึงเนื้อหาและโครงสร้างหัวข้อจาก URL สาธารณะที่อนุญาต (HTTPS + ป้องกันเครือข่ายภายใน)",
            json.dumps(["en.wikipedia.org", "th.wikipedia.org", "docs.python.org"]),
            "approval_required",
            1,
            30,
            0,
            today,
            "system",
            now,
        ),
        (
            "calc_ast",
            "คำนวณ AST / สมการ / สถิติ (Compute Tool)",
            "compute",
            "เรียกใช้เครื่องมือคำนวณ AST สมการเชิงเส้น และสถิติภายในเครื่องโดยไม่พึ่งพาภายนอก",
            json.dumps([]),
            "auto",
            1,
            200,
            0,
            today,
            "system",
            now,
        ),
        (
            "workspace_file_read",
            "จัดการและอ่านไฟล์เวิร์กสเปซ (File Sandbox Tool)",
            "file",
            "อ่าน/แสดงรายการไฟล์ข้อความใน workspace_files อย่างปลอดภัย (การเขียนไฟล์ต้องผ่าน Approval Gate)",
            json.dumps([]),
            "auto",
            1,
            100,
            0,
            today,
            "system",
            now,
        ),
    ]
    for row in default_tools:
        conn.execute(
            """
            INSERT OR IGNORE INTO external_tools (
                id, name, category, description, endpoint_allowlist_json,
                permission_mode, enabled, quota_daily, calls_today,
                last_reset_date, created_by, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row,
        )

    # Upgrade legacy web_search allowlist cleanly if unmodified from old default
    existing_web = conn.execute(
        "SELECT endpoint_allowlist_json FROM external_tools WHERE id='web_search'"
    ).fetchone()
    if existing_web and existing_web["endpoint_allowlist_json"] == json.dumps(["en.wikipedia.org", "th.wikipedia.org"]):
        conn.execute(
            "UPDATE external_tools SET endpoint_allowlist_json=?, description=?, updated_at=? WHERE id='web_search'",
            (
                default_web_allowlist,
                "สืบค้นและเปรียบเทียบหลักฐานจาก Wikipedia และ DuckDuckGo Instant API ผ่าน HTTPS (ไม่ใช่ LLM ภายนอก)",
                now,
            ),
        )

    ws_dir = data_dir / "workspace_files"
    ws_dir.mkdir(parents=True, exist_ok=True)


def _is_global_public_ip(ip_str: str) -> bool:
    try:
        ip_obj = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return bool(
        ip_obj.is_global
        and not ip_obj.is_private
        and not ip_obj.is_loopback
        and not ip_obj.is_link_local
        and not ip_obj.is_multicast
        and not ip_obj.is_reserved
        and not ip_obj.is_unspecified
    )


def validate_safe_public_url(url: str, allowlist: list[str] | None = None) -> tuple[bool, str]:
    try:
        parsed = urllib.parse.urlparse(url.strip())
    except Exception:
        return False, "รูปแบบ URL ไม่ถูกต้อง"

    if parsed.scheme.lower() != "https":
        return False, "อนุญาตเฉพาะโปรโตคอล https:// เท่านั้น"

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        return False, "ไม่พบชื่อโฮสต์ใน URL"

    if hostname in {"localhost", "127.0.0.1", "::1"} or hostname.endswith(".local"):
        return False, "ไม่อนุญาตให้เข้าถึงโฮสต์ภายในเครื่อง"

    for blocked in BLOCKED_EXTERNAL_LLM_HOSTS:
        if hostname == blocked or hostname.endswith(f".{blocked}"):
            return False, f"ถูกบล็อกตามนโยบาย ZYRQUEN: ไม่อนุญาตให้เชื่อมต่อโฮสต์โมเดล AI ภายนอก ({hostname})"

    if allowlist:
        allowed_match = False
        for dom in allowlist:
            d = str(dom).strip().lower()
            if not d:
                continue
            if hostname == d or hostname.endswith(f".{d}"):
                allowed_match = True
                break
        if not allowed_match:
            return False, f"โดเมน '{hostname}' ไม่อยู่ใน Endpoint Allowlist ของเครื่องมือนี้"

    try:
        ipaddress.ip_address(hostname)
        if not _is_global_public_ip(hostname):
            return False, "ไม่อนุญาต IP เครือข่ายส่วนตัวหรือ Metadata"
    except ValueError:
        pass

    try:
        addr_info = socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        return False, f"ไม่สามารถแปลงชื่อโดเมน '{hostname}': {exc}"

    if not addr_info:
        return False, f"ไม่พบที่อยู่ IP สำหรับ '{hostname}'"

    for entry in addr_info:
        resolved_ip = entry[4][0]
        if not _is_global_public_ip(resolved_ip):
            return False, f"ปฏิเสธการเชื่อมต่อ: โฮสต์ชี้ไปยัง IP ที่ไม่อนุญาต ({resolved_ip})"

    return True, hostname


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowlist: list[str] | None) -> None:
        super().__init__()
        self.allowlist = allowlist

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        ok, err = validate_safe_public_url(newurl, self.allowlist)
        if not ok:
            raise urllib.error.URLError(f"Redirect blocked: {err}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def safe_http_get(
    url: str,
    allowlist: list[str] | None = None,
    max_bytes: int = 120_000,
    timeout: float = 8.0,
) -> dict:
    ok, msg = validate_safe_public_url(url, allowlist)
    if not ok:
        return {"ok": False, "error": msg}

    opener = urllib.request.build_opener(_SafeRedirectHandler(allowlist))
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ZYRQUEN-ExternalTool/1.1 (+native-first-subordinate)",
            "Accept": "application/json, text/plain, text/html",
        },
        method="GET",
    )
    try:
        with opener.open(req, timeout=timeout) as resp:
            status_code = getattr(resp, "status", 200)
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read(max_bytes)
            text = raw.decode("utf-8", errors="replace")
            return {
                "ok": True,
                "url": resp.geturl(),
                "status_code": status_code,
                "content_type": content_type,
                "body": text,
            }
    except urllib.error.HTTPError as exc:
        return {"ok": False, "error": f"HTTP {exc.code}: {exc.reason}"}
    except Exception as exc:
        return {"ok": False, "error": f"Network request failed: {exc}"}


def _query_mediawiki_source(wiki_host: str, query: str, allowlist: list[str]) -> tuple[list[dict], str | None]:
    encoded_q = urllib.parse.quote(query)
    api_url = (
        f"https://{wiki_host}/w/api.php?action=query&list=search&srsearch={encoded_q}"
        f"&utf8=1&format=json&srlimit=3"
    )
    res = safe_http_get(api_url, allowlist)
    if not res["ok"]:
        return [], res["error"]
    try:
        data = json.loads(res["body"])
        hits = data.get("query", {}).get("search", [])
    except Exception as exc:
        return [], f"MediaWiki parse failed: {exc}"

    out = []
    for h in hits[:3]:
        title = str(h.get("title", "")).strip()
        snippet = re.sub(r"<[^>]+>", "", str(h.get("snippet", ""))).strip()
        article_url = f"https://{wiki_host}/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
        out.append(
            {
                "provider": wiki_host,
                "title": title,
                "snippet": snippet,
                "url": article_url,
                "trust_status": "UNTRUSTED_WEB_EVIDENCE",
            }
        )
    return out, None


def _query_duckduckgo_instant(query: str, allowlist: list[str]) -> tuple[list[dict], str | None]:
    encoded_q = urllib.parse.quote(query)
    api_url = f"https://api.duckduckgo.com/?q={encoded_q}&format=json&no_html=1&skip_disambig=1"
    res = safe_http_get(api_url, allowlist)
    if not res["ok"]:
        return [], res["error"]
    try:
        data = json.loads(res["body"])
    except Exception as exc:
        return [], f"DuckDuckGo parse failed: {exc}"

    items: list[dict] = []
    abstract = str(data.get("AbstractText", "")).strip()
    abstract_url = str(data.get("AbstractURL", "")).strip()
    heading = str(data.get("Heading", "")).strip() or query
    if abstract:
        items.append(
            {
                "provider": "api.duckduckgo.com",
                "title": heading,
                "snippet": abstract[:400],
                "url": abstract_url or f"https://duckduckgo.com/?q={encoded_q}",
                "trust_status": "UNTRUSTED_WEB_EVIDENCE",
            }
        )
    for topic in data.get("RelatedTopics", [])[:3]:
        if isinstance(topic, dict) and topic.get("Text") and topic.get("FirstURL"):
            items.append(
                {
                    "provider": "api.duckduckgo.com",
                    "title": str(topic.get("Text", ""))[:72],
                    "snippet": str(topic.get("Text", ""))[:320],
                    "url": str(topic.get("FirstURL", "")),
                    "trust_status": "UNTRUSTED_WEB_EVIDENCE",
                }
            )
    return items, None


def _run_web_search(query: str, allowlist: list[str]) -> dict:
    q = query.strip()
    if not q:
        return {"ok": False, "error": "กรุณาระบุคำค้นหา"}

    eff_allowlist = [str(d).strip().lower() for d in allowlist if str(d).strip()]
    has_thai = bool(re.search(r"[\u0E00-\u0E7F]", q))

    candidate_hosts: list[str] = []
    if has_thai and (not eff_allowlist or "th.wikipedia.org" in eff_allowlist):
        candidate_hosts.append("th.wikipedia.org")
    if not eff_allowlist or "en.wikipedia.org" in eff_allowlist:
        candidate_hosts.append("en.wikipedia.org")
    elif not candidate_hosts:
        for h in eff_allowlist:
            if "wikipedia.org" in h:
                candidate_hosts.append(h)

    all_items: list[dict] = []
    provider_errors: list[str] = []
    queried_providers: list[str] = []

    for host in candidate_hosts[:2]:
        queried_providers.append(host)
        items, err = _query_mediawiki_source(host, q, eff_allowlist or [host])
        all_items.extend(items)
        if err:
            provider_errors.append(f"{host}: {err}")

    if not eff_allowlist or "api.duckduckgo.com" in eff_allowlist:
        queried_providers.append("api.duckduckgo.com")
        ddg_items, ddg_err = _query_duckduckgo_instant(q, eff_allowlist or ["api.duckduckgo.com"])
        all_items.extend(ddg_items)
        if ddg_err:
            provider_errors.append(f"api.duckduckgo.com: {ddg_err}")

    if not all_items and provider_errors:
        return {"ok": False, "error": "; ".join(provider_errors[:2])}

    return {
        "ok": True,
        "providers_queried": queried_providers,
        "provider_errors": provider_errors,
        "query": q,
        "results": all_items[:6],
    }


def _run_doc_fetch(url: str, allowlist: list[str]) -> dict:
    res = safe_http_get(url, allowlist)
    if not res["ok"]:
        return res
    ctype = res.get("content_type", "").lower()
    body = res["body"]
    title = ""
    headings: list[str] = []
    extracted = body
    if "html" in ctype or "<html" in body[:300].lower():
        parser = _VisibleTextHTMLParser()
        try:
            parser.feed(body)
            parser.close()
            title = " ".join(parser.title_parts)[:160]
            headings = parser.headings
            extracted = "\n".join(parser.text_parts)
        except Exception:
            extracted = re.sub(r"<[^>]+>", " ", body)
    extracted = re.sub(r"\n{3,}", "\n\n", extracted).strip()[:3500]
    parsed_host = urllib.parse.urlparse(res["url"]).hostname or ""
    return {
        "ok": True,
        "url": res["url"],
        "provider": parsed_host,
        "title": title,
        "headings": headings,
        "content_type": ctype,
        "trust_status": "UNTRUSTED_WEB_EVIDENCE",
        "excerpt": extracted,
    }


def _sanitize_rel_filename(name: str) -> str | None:
    cleaned = name.strip().replace("\\", "/")
    if not cleaned or cleaned.startswith("/") or ".." in cleaned.split("/"):
        return None
    if not re.fullmatch(r"[a-zA-Z0-9\u0E00-\u0E7F._\- ]{1,96}", cleaned):
        return None
    return cleaned


def _run_workspace_file_tool(
    data_dir: Path,
    tool_input: dict,
    approved_by: str | None,
) -> dict:
    ws_dir = (data_dir / "workspace_files").resolve()
    ws_dir.mkdir(parents=True, exist_ok=True)
    action = str(tool_input.get("action", "read")).strip().lower()
    filename = str(tool_input.get("filename", "")).strip()

    if action == "list" or (action == "read" and (not filename or filename.lower() in {"list", "all", "ls", "รายการ"})):
        files = []
        for entry in sorted(ws_dir.iterdir()):
            if entry.is_file() and not entry.is_symlink():
                files.append(
                    {
                        "name": entry.name,
                        "size_bytes": entry.stat().st_size,
                        "modified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(entry.stat().st_mtime)),
                    }
                )
        return {"ok": True, "action": "list", "files": files[:40]}

    safe_name = _sanitize_rel_filename(filename)
    if not safe_name:
        return {"ok": False, "error": "ชื่อไฟล์ไม่ปลอดภัยหรือไม่อยู่ในรูปแบบที่อนุญาต"}

    target = (ws_dir / safe_name).resolve()
    if not target.is_relative_to(ws_dir):
        return {"ok": False, "error": "ปฏิเสธการเข้าถึงนอกโฟลเดอร์เวิร์กสเปซ"}
    if target.is_symlink():
        return {"ok": False, "error": "ไม่อนุญาตให้อ่านหรือเขียนไฟล์ symlink"}

    if action == "write":
        if not approved_by:
            return {"ok": False, "requires_approval": True, "error": "การเขียนไฟล์ต้องผ่าน Approval Gate"}
        allowed_ext = (".txt", ".md", ".json", ".csv")
        if not safe_name.lower().endswith(allowed_ext):
            return {"ok": False, "error": "รองรับเฉพาะไฟล์ .txt, .md, .json, .csv"}
        content = str(tool_input.get("content", ""))[:20000]
        target.write_text(content, encoding="utf-8")
        return {
            "ok": True,
            "action": "write",
            "filename": safe_name,
            "size_bytes": len(content.encode("utf-8")),
        }

    if not target.exists() or not target.is_file():
        return {"ok": False, "error": f"ไม่พบไฟล์ '{safe_name}' ในพื้นที่ไฟล์เวิร์กสเปซ"}

    content = target.read_text(encoding="utf-8", errors="replace")[:6000]
    return {
        "ok": True,
        "action": "read",
        "filename": safe_name,
        "size_bytes": target.stat().st_size,
        "content": content,
    }


def list_workspace_files(data_dir: Path) -> list[dict]:
    res = _run_workspace_file_tool(data_dir, {"action": "list"}, None)
    return res.get("files", []) if res.get("ok") else []


def save_workspace_file(data_dir: Path, filename: str, content: str) -> dict:
    safe_name = _sanitize_rel_filename(filename)
    if not safe_name:
        return {"ok": False, "error": "ชื่อไฟล์ไม่ถูกต้อง"}
    allowed_ext = (".txt", ".md", ".json", ".csv")
    if not safe_name.lower().endswith(allowed_ext):
        return {"ok": False, "error": "รองรับเฉพาะไฟล์ .txt, .md, .json, .csv"}
    ws_dir = (data_dir / "workspace_files").resolve()
    ws_dir.mkdir(parents=True, exist_ok=True)
    target = (ws_dir / safe_name).resolve()
    if not target.is_relative_to(ws_dir) or target.is_symlink():
        return {"ok": False, "error": "เส้นทางไฟล์ไม่ปลอดภัย"}
    trimmed = content[:50000]
    target.write_text(trimmed, encoding="utf-8")
    return {
        "ok": True,
        "file": {
            "name": safe_name,
            "size_bytes": len(trimmed.encode("utf-8")),
            "modified_at": _now_iso(),
        },
    }


def validate_tool_input(tool_id: str, tool_input: dict) -> tuple[bool, str | None]:
    contract = TOOL_CONTRACTS.get(tool_id)
    if not contract:
        return False, f"ไม่พบสัญญา Tool Contract สำหรับ '{tool_id}'"
    for field in contract["required_fields"]:
        val = str(tool_input.get(field, "")).strip()
        if not val:
            return False, f"เครื่องมือ '{tool_id}' ต้องระบุข้อมูลนำเข้า '{field}'"
    if tool_id == "workspace_file_read":
        act = str(tool_input.get("action", "read")).strip().lower()
        if act not in {"read", "list", "write"}:
            return False, "รองรับเฉพาะ action: read, list หรือ write"
        if act == "write" and not str(tool_input.get("filename", "")).strip():
            return False, "การเขียนไฟล์ต้องระบุชื่อไฟล์"
    return True, None


def analyze_tool_result(
    conn: sqlite3.Connection,
    tool_id: str,
    raw_output: dict,
    tokenize_fn: Callable[[str], list[str]],
    extract_terms_fn: Callable[[str], list[str]],
    query_kg_fn: Callable[[sqlite3.Connection, str], list[dict]],
) -> dict:
    """
    P3 Structured Evidence & Native Evaluation:
    - Marks external web payloads as untrusted until evaluated
    - Compares term agreement across distinct providers when multiple sources exist
    - Cross-checks against ZYRQUEN's internal Knowledge Graph
    - Reports explicit evidence trust grade & limitations honestly
    """
    if tool_id == "calc_ast":
        return {
            "trust_grade": "INTERNAL_DETERMINISTIC",
            "token_count": 0,
            "top_terms": [],
            "kg_matches": [],
            "distinct_providers": ["zyrquen_ast"],
            "cross_source_shared_terms": [],
            "numeric_values": [raw_output.get("result")] if "result" in raw_output else [],
            "limitations": [],
            "summary": "ZYRQUEN Native Compute ยืนยันผลคำนวณเชิงสัญลักษณ์ภายใน 100%",
        }

    if tool_id == "workspace_file_read":
        if raw_output.get("action") == "list":
            names = [f["name"] for f in raw_output.get("files", [])]
            return {
                "trust_grade": "SANDBOX_LOCAL_FILE",
                "token_count": len(names),
                "top_terms": names[:6],
                "kg_matches": [],
                "distinct_providers": ["workspace_files"],
                "cross_source_shared_terms": [],
                "numeric_values": [],
                "limitations": ["แสดงเฉพาะไฟล์ภายในโฟลเดอร์ Sandbox ของระบบ"],
                "summary": f"ZYRQUEN Native Core ตรวจพบไฟล์ในพื้นที่ปลอดภัย {len(names)} รายการ",
            }
        if raw_output.get("action") == "write":
            return {
                "trust_grade": "SANDBOX_LOCAL_FILE",
                "token_count": 0,
                "top_terms": [str(raw_output.get("filename", ""))],
                "kg_matches": [],
                "distinct_providers": ["workspace_files"],
                "cross_source_shared_terms": [],
                "numeric_values": [str(raw_output.get("size_bytes", 0))],
                "limitations": [],
                "summary": f"บันทึกไฟล์ `{raw_output.get('filename')}` สำเร็จหลังผ่าน Approval Gate",
            }

    text_chunks: list[str] = []
    source_terms: dict[str, set[str]] = collections.defaultdict(set)
    evidence_items: list[dict] = []

    if tool_id == "web_search":
        for item in raw_output.get("results", []):
            prov = str(item.get("provider", "external_web"))
            chunk = f"{item.get('title', '')} {item.get('snippet', '')}"
            text_chunks.append(chunk)
            item_terms = set(extract_terms_fn(chunk))
            source_terms[prov].update(item_terms)
            evidence_items.append(
                {
                    "provider": prov,
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "trust_status": item.get("trust_status", "UNTRUSTED_WEB_EVIDENCE"),
                }
            )
    elif tool_id == "doc_fetch":
        prov = str(raw_output.get("provider", "external_url"))
        chunk = f"{raw_output.get('title', '')}\n{' '.join(raw_output.get('headings', []))}\n{raw_output.get('excerpt', '')}"
        text_chunks.append(chunk)
        source_terms[prov].update(extract_terms_fn(chunk[:1500]))
        evidence_items.append(
            {
                "provider": prov,
                "title": raw_output.get("title", ""),
                "url": raw_output.get("url", ""),
                "trust_status": raw_output.get("trust_status", "UNTRUSTED_WEB_EVIDENCE"),
            }
        )
    elif tool_id == "workspace_file_read":
        content = str(raw_output.get("content", ""))
        text_chunks.append(content)
        source_terms["workspace_files"].update(extract_terms_fn(content[:1500]))

    combined = "\n".join(text_chunks).strip()
    tokens = [t for t in tokenize_fn(combined) if len(t) >= 2]
    terms = extract_terms_fn(combined[:1800])
    freq = collections.Counter(tokens)
    top_terms = [
        w
        for w, _ in freq.most_common(10)
        if w not in {"the", "and", "for", "with", "that", "from", "this", "are", "was", "ของ", "และ", "ที่", "ใน"}
    ][:6]

    distinct_providers = list(source_terms.keys())
    term_provider_counts: collections.Counter = collections.Counter()
    for prov, tset in source_terms.items():
        for t in tset:
            if len(t) >= 3:
                term_provider_counts[t] += 1
    shared_terms = [t for t, c in term_provider_counts.most_common(8) if c >= 2][:6]

    kg_matches = query_kg_fn(conn, " ".join(terms[:8])) if terms else []
    numbers = re.findall(r"\b\d+(?:\.\d+)?\b", combined[:1500])[:6]

    if tool_id == "workspace_file_read":
        trust_grade = "SANDBOX_LOCAL_FILE"
    elif not evidence_items:
        trust_grade = "INSUFFICIENT_EVIDENCE"
    elif len(distinct_providers) >= 2 and len(shared_terms) >= 1:
        trust_grade = "CORROBORATED_MULTI_SOURCE"
    else:
        trust_grade = "UNCORROBORATED_SINGLE_SOURCE"

    limitations: list[str] = []
    if tool_id in {"web_search", "doc_fetch"}:
        limitations.append("ข้อมูลจากเว็บไซต์ภายนอกถูกตีตราเป็นหลักฐานรอการตรวจสอบ ไม่ใช่ข้อเท็จจริงภายในที่พิสูจน์แล้ว")
    if trust_grade == "UNCORROBORATED_SINGLE_SOURCE":
        limitations.append("พบหลักฐานจากแหล่งเดียวหรือยังไม่มีคำสำคัญยืนยันข้ามหลายแหล่ง ควรตรวจสอบเอกสารต้นทางเพิ่มเติม")
    if trust_grade == "INSUFFICIENT_EVIDENCE":
        limitations.append("ไม่พบหลักฐานเพียงพอจากแหล่งสาธารณะที่อนุญาต")

    kg_note = (
        f"เชื่อมโยงกับกราฟความรู้ภายใน {len(kg_matches)} รายการ"
        if kg_matches
        else "ยังไม่พบข้อมูลชุดนี้ในกราฟความรู้เดิม"
    )
    summary = (
        f"[{trust_grade}] Native Core ประเมินหลักฐานจาก {len(distinct_providers)} แหล่ง ({len(tokens)} หน่วยคำ) · "
        f"คำสำคัญ: {', '.join(top_terms[:5]) or 'ไม่มี'} · {kg_note}"
    )

    return {
        "trust_grade": trust_grade,
        "token_count": len(tokens),
        "top_terms": top_terms,
        "distinct_providers": distinct_providers,
        "cross_source_shared_terms": shared_terms,
        "kg_matches": [
            {"subject": m["subject"], "relation": m["relation"], "object": m["object"]}
            for m in kg_matches[:4]
        ],
        "numeric_values": numbers,
        "evidence_items": evidence_items,
        "limitations": limitations,
        "summary": summary,
    }


def detect_tool_intent(prompt: str) -> tuple[str, dict] | None:
    cleaned = prompt.strip()

    m_research = re.match(
        r"^(?:ค้นคว้า|เปรียบเทียบ|research|investigate|compare)\s*:?\s*(.+)$",
        cleaned,
        re.IGNORECASE,
    )
    if m_research:
        return "web_search", {"query": m_research.group(1).strip(), "compare_sources": True}

    m_web = re.match(
        r"^(?:ค้นหาเว็บ|ค้นเว็บ|web_search|websearch|search_web)\s*:?\s*(.+)$",
        cleaned,
        re.IGNORECASE,
    )
    if m_web:
        return "web_search", {"query": m_web.group(1).strip()}

    m_doc = re.match(
        r"^(?:อ่านเอกสาร|ดึงเว็บ|doc_fetch|fetch_doc|fetch)\s*:?\s*(https?://\S+)$",
        cleaned,
        re.IGNORECASE,
    )
    if m_doc:
        return "doc_fetch", {"url": m_doc.group(1).strip()}

    m_write = re.match(
        r"^(?:เขียนไฟล์|บันทึกไฟล์|write_file)\s*:?\s*(.+?)\s*(?:\||::)\s*(.+)$",
        cleaned,
        re.IGNORECASE | re.DOTALL,
    )
    if m_write:
        return "workspace_file_read", {
            "action": "write",
            "filename": m_write.group(1).strip(),
            "content": m_write.group(2).strip(),
        }

    m_file = re.match(
        r"^(?:อ่านไฟล์|จัดการไฟล์|ไฟล์เวิร์กสเปซ|ไฟล์|file_read|read_file)\s*:?\s*(.*)$",
        cleaned,
        re.IGNORECASE,
    )
    if m_file:
        arg = m_file.group(1).strip()
        if not arg or arg.lower() in {"list", "ls", "all", "ทั้งหมด", "รายการ"}:
            return "workspace_file_read", {"action": "list"}
        return "workspace_file_read", {"action": "read", "filename": arg}

    return None


def invoke_tool_governed(
    conn: sqlite3.Connection,
    data_dir: Path,
    tool_id: str,
    tool_input: dict,
    user_id: str,
    conversation_id: str | None = None,
    approved_by: str | None = None,
    existing_invocation_id: str | None = None,
    tokenize_fn: Callable[[str], list[str]] | None = None,
    extract_terms_fn: Callable[[str], list[str]] | None = None,
    query_kg_fn: Callable[[sqlite3.Connection, str], list[dict]] | None = None,
    calc_fn: Callable[[str], dict | None] | None = None,
) -> dict:
    started = time.perf_counter()
    tool_row = conn.execute("SELECT * FROM external_tools WHERE id=?", (tool_id,)).fetchone()
    if not tool_row:
        return {"ok": False, "error": f"ไม่พบเครื่องมือ '{tool_id}' ใน Tool Registry"}

    valid_in, valid_err = validate_tool_input(tool_id, tool_input)
    if not valid_in:
        return {"ok": False, "error": valid_err}

    today = _today_utc()
    calls_today = int(tool_row["calls_today"]) if tool_row["last_reset_date"] == today else 0
    if tool_row["last_reset_date"] != today:
        with conn:
            conn.execute(
                "UPDATE external_tools SET calls_today=0, last_reset_date=? WHERE id=?",
                (today, tool_id),
            )

    if not tool_row["enabled"] or tool_row["permission_mode"] == "disabled":
        inv_id = existing_invocation_id or str(uuid.uuid4())
        now = _now_iso()
        with conn:
            if existing_invocation_id:
                conn.execute(
                    """
                    UPDATE tool_invocations
                    SET status='BLOCKED', output_json=?, analysis_summary=?, approved_by=?, latency_ms=0, updated_at=?
                    WHERE id=?
                    """,
                    (
                        json.dumps({"error": "เครื่องมือถูกปิดการใช้งานชั่วคราวโดยผู้ดูแลระบบ"}),
                        "ถูกบล็อกตามสิทธิ์ Permission Policy",
                        approved_by,
                        now,
                        inv_id,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO tool_invocations (id, tool_id, conversation_id, user_id, status, input_json, output_json, analysis_summary, approved_by, latency_ms, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'BLOCKED', ?, ?, ?, ?, 0, ?, ?)
                    """,
                    (
                        inv_id,
                        tool_id,
                        conversation_id,
                        user_id,
                        json.dumps(tool_input, ensure_ascii=False),
                        json.dumps({"error": "เครื่องมือถูกปิดการใช้งานชั่วคราวโดยผู้ดูแลระบบ"}),
                        "ถูกบล็อกตามสิทธิ์ Permission Policy",
                        approved_by,
                        now,
                        now,
                    ),
                )
            _log_tool_audit(conn, user_id, f"TOOL_{tool_id.upper()}_BLOCKED", inv_id, "BLOCKED")
        row = dict(conn.execute("SELECT * FROM tool_invocations WHERE id=?", (inv_id,)).fetchone())
        return {"ok": True, "status": "BLOCKED", "invocation": row, "tool": dict(tool_row)}

    if calls_today >= int(tool_row["quota_daily"]):
        with conn:
            _log_tool_audit(conn, user_id, f"TOOL_{tool_id.upper()}_QUOTA", tool_id, "QUOTA_EXCEEDED")
        return {
            "ok": False,
            "error": f"เครื่องมือ '{tool_row['name']}' ใช้ครบโควตารายวันแล้ว ({calls_today}/{tool_row['quota_daily']})",
        }

    needs_approval = tool_row["permission_mode"] == "approval_required" or (
        tool_id == "workspace_file_read" and str(tool_input.get("action", "")).lower() == "write"
    )
    if needs_approval and not approved_by:
        inv_id = str(uuid.uuid4())
        now = _now_iso()
        with conn:
            conn.execute(
                """
                INSERT INTO tool_invocations (id, tool_id, conversation_id, user_id, status, input_json, output_json, analysis_summary, approved_by, latency_ms, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'PENDING_APPROVAL', ?, NULL, ?, NULL, 0, ?, ?)
                """,
                (
                    inv_id,
                    tool_id,
                    conversation_id,
                    user_id,
                    json.dumps(tool_input, ensure_ascii=False),
                    f"รออนุมัติจากผู้ดูแลระบบก่อนเรียกใช้เครื่องมือ `{tool_id}`",
                    now,
                    now,
                ),
            )
            _log_tool_audit(conn, user_id, f"TOOL_GATE_REQUEST_{tool_id.upper()}", inv_id, "PENDING_APPROVAL")
        row = dict(conn.execute("SELECT * FROM tool_invocations WHERE id=?", (inv_id,)).fetchone())
        return {"ok": True, "status": "PENDING_APPROVAL", "invocation": row, "tool": dict(tool_row)}

    allowlist = json.loads(tool_row["endpoint_allowlist_json"] or "[]")
    if tool_id == "web_search":
        raw_out = _run_web_search(str(tool_input.get("query", "")), allowlist)
    elif tool_id == "doc_fetch":
        raw_out = _run_doc_fetch(str(tool_input.get("url", "")), allowlist)
    elif tool_id == "workspace_file_read":
        raw_out = _run_workspace_file_tool(data_dir, tool_input, approved_by)
    elif tool_id == "calc_ast":
        expr = str(tool_input.get("expression", "")).strip()
        calc_res = calc_fn(expr) if calc_fn else None
        raw_out = (
            {"ok": True, **calc_res}
            if calc_res
            else {"ok": False, "error": f"ไม่สามารถประมวลผลนิพจน์คำนวณ '{expr}' ผ่าน AST ได้"}
        )
    else:
        raw_out = {"ok": False, "error": f"ยังไม่มีตัวดำเนินการสำหรับ '{tool_id}'"}

    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    status = "COMPLETED" if raw_out.get("ok") else "FAILED"
    analysis_obj = (
        analyze_tool_result(conn, tool_id, raw_out, tokenize_fn, extract_terms_fn, query_kg_fn)
        if (raw_out.get("ok") and tokenize_fn and extract_terms_fn and query_kg_fn)
        else {"summary": str(raw_out.get("error", "")), "trust_grade": "FAILED", "limitations": []}
    )
    analysis_summary = analysis_obj.get("summary", "")

    now = _now_iso()
    inv_id = existing_invocation_id or str(uuid.uuid4())
    with conn:
        if raw_out.get("ok"):
            conn.execute(
                "UPDATE external_tools SET calls_today = calls_today + 1, last_reset_date=?, updated_at=? WHERE id=?",
                (today, now, tool_id),
            )
        if existing_invocation_id:
            conn.execute(
                """
                UPDATE tool_invocations
                SET status=?, output_json=?, analysis_summary=?, approved_by=?, latency_ms=?, updated_at=?
                WHERE id=?
                """,
                (
                    status,
                    json.dumps(raw_out, ensure_ascii=False),
                    analysis_summary,
                    approved_by,
                    latency_ms,
                    now,
                    inv_id,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO tool_invocations (id, tool_id, conversation_id, user_id, status, input_json, output_json, analysis_summary, approved_by, latency_ms, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    inv_id,
                    tool_id,
                    conversation_id,
                    user_id,
                    status,
                    json.dumps(tool_input, ensure_ascii=False),
                    json.dumps(raw_out, ensure_ascii=False),
                    analysis_summary,
                    approved_by,
                    latency_ms,
                    now,
                    now,
                ),
            )
        _log_tool_audit(
            conn,
            user_id,
            f"TOOL_EXEC_{tool_id.upper()}",
            inv_id,
            status,
            {"trust_grade": analysis_obj.get("trust_grade"), "approved_by": approved_by},
        )

    row = dict(conn.execute("SELECT * FROM tool_invocations WHERE id=?", (inv_id,)).fetchone())
    return {
        "ok": True,
        "status": status,
        "invocation": row,
        "raw_output": raw_out,
        "analysis": analysis_obj,
        "tool": dict(tool_row),
    }


def format_tool_markdown(tool_id: str, inv_result: dict) -> str:
    st = inv_result["status"]
    tool = inv_result["tool"]
    if st == "BLOCKED":
        return (
            f"**เครื่องมือ `{tool['name']}` ถูกปิดสิทธิ์การใช้งาน (BLOCKED)**\n\n"
            f"ผู้ดูแลระบบหรือนโยบายความปลอดภัยระงับการเรียกใช้เครื่องมือนี้ไว้ สามารถตรวจสอบสิทธิ์ได้ที่ **ตั้งค่า → นักพัฒนา**"
        )
    if st == "PENDING_APPROVAL":
        inv = inv_result["invocation"]
        return (
            f"**รอการอนุมัติก่อนเรียกใช้เครื่องมือภายนอก (Approval Gate: PENDING_APPROVAL)**\n\n"
            f"- เครื่องมือ: `{tool['name']}` (`{tool_id}`)\n"
            f"- ข้อมูลนำเข้า: `{inv['input_json']}`\n"
            f"- รหัสคำขอ: `{inv['id'][:8]}`\n\n"
            f"ZYRQUEN Native Core หยุดรอผู้ดูแลระบบอนุมัติใน **ตั้งค่า → ผู้ดูแลระบบ → Tool Approval Gate** เพื่อความปลอดภัยก่อนส่งคำขอหรือแก้ไขข้อมูล"
        )
    if st == "FAILED":
        err = inv_result.get("raw_output", {}).get("error", "ไม่ทราบสาเหตุ")
        return f"**เครื่องมือ `{tool['name']}` ดำเนินการไม่สำเร็จ:** {err}"

    raw = inv_result.get("raw_output", {})
    analysis = inv_result.get("analysis", {})
    trust_grade = analysis.get("trust_grade", "UNKNOWN")
    lines = [
        f"**ผลสังเคราะห์หลักฐานโดย ZYRQUEN Native Core** (`{tool['name']}` · ระดับความน่าเชื่อถือ: `{trust_grade}`)",
        "",
        f"> {analysis.get('summary', '')}",
        "",
    ]

    if analysis.get("cross_source_shared_terms"):
        lines.append(
            f"- คำสำคัญที่สอดคล้องข้ามแหล่งข้อมูล: `{', '.join(analysis['cross_source_shared_terms'])}`"
        )

    if tool_id == "web_search":
        results = raw.get("results", [])
        if not results:
            lines.append("- ไม่พบรายการค้นหาสาธารณะที่ตรงคำค้น")
        for r in results:
            lines.append(
                f"- **[{r.get('provider', 'web')}] {r['title']}**: {r['snippet']} (`{r['url']}`)"
            )
    elif tool_id == "doc_fetch":
        lines.append(f"- แหล่งที่มา: `{raw.get('url', '')}`")
        if raw.get("title"):
            lines.append(f"- ชื่อเอกสาร: **{raw['title']}**")
        if raw.get("headings"):
            lines.append(f"- หัวข้อหลักในเอกสาร: {', '.join(raw['headings'][:4])}")
        excerpt = str(raw.get("excerpt", ""))[:900]
        lines.append(f"\n{excerpt}")
    elif tool_id == "workspace_file_read":
        if raw.get("action") == "list":
            for f in raw.get("files", []):
                lines.append(f"- `{f['name']}` ({f['size_bytes']} bytes)")
        elif raw.get("action") == "write":
            lines.append(
                f"- บันทึกไฟล์ `{raw.get('filename')}` เรียบร้อยแล้ว ({raw.get('size_bytes')} bytes)"
            )
        else:
            lines.append(f"- ไฟล์: `{raw.get('filename')}` ({raw.get('size_bytes')} bytes)")
            lines.append(f"\n```\n{str(raw.get('content', ''))[:1200]}\n```")
    elif tool_id == "calc_ast":
        lines.append(f"- ผลลัพธ์คำนวณ: `{raw.get('result')}`")

    if analysis.get("kg_matches"):
        lines.append("\n**เชื่อมโยงกับกราฟความรู้ภายใน ZYRQUEN:**")
        for kg in analysis["kg_matches"]:
            lines.append(f"- `{kg['subject']}` — *{kg['relation']}* → `{kg['object']}`")

    limitations = analysis.get("limitations") or []
    if limitations:
        lines.append("\n**ข้อจำกัดและคำเตือนความน่าเชื่อถือของข้อมูล:**")
        for lim in limitations:
            lines.append(f"- {lim}")

    return "\n".join(lines)
