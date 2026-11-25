"""
Data Toolkit for ZYRQUEN Tool Center.
Binds DatasetLeakageDetector, deterministic CSV/JSON profiling, and AST Math/Stats engine.
"""

from __future__ import annotations

import csv
import io
import json
import math
import statistics
import xml.etree.ElementTree as ET
from typing import Any

from apps.core.dataset_leakage_detector import DatasetLeakageDetector
import tools_engine as te
import zyrquen_core as zc

from ..contracts import CapabilitySpec, ToolkitManifest


def _parse_xml_records(raw_xml: str) -> list[dict[str, Any]]:
    root = ET.fromstring(raw_xml)
    children = list(root)
    if not children:
        rec = dict(root.attrib)
        if root.text and root.text.strip():
            rec["text"] = root.text.strip()
        return [rec] if rec else []
    rows: list[dict[str, Any]] = []
    for child in children:
        row: dict[str, Any] = dict(child.attrib)
        sub_children = list(child)
        if sub_children:
            for sc in sub_children:
                row[sc.tag] = (sc.text or "").strip()
        elif child.text and child.text.strip():
            row[child.tag] = child.text.strip()
        rows.append(row)
    return rows


def _handle_leakage_check(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    train = payload.get("train") or []
    validation = payload.get("validation") or []
    test = payload.get("test") or []
    if not isinstance(train, list) or not isinstance(validation, list) or not isinstance(test, list):
        return {
            "ok": False,
            "status": "FAILED",
            "error": "train, validation, and test must be arrays of text/records.",
            "output": {},
        }
    if not train and not validation and not test:
        return {
            "ok": False,
            "status": "FAILED",
            "error": "At least one split must be non-empty.",
            "output": {},
        }

    detector = DatasetLeakageDetector()
    split_payload: dict[str, list[Any]] = {}
    if test:
        split_payload["test"] = test
    report = detector.check_entries(
        split_payload,
        reference_splits={"train": train, "validation": validation},
        check_internal_splits=True,
    )
    seen_norm: set[str] = set()
    train_dups = 0
    for item in train:
        norm = " ".join(str(item).lower().split())
        if norm in seen_norm:
            train_dups += 1
        seen_norm.add(norm)

    cross_matches = [m.to_dict() for m in report.matches]
    leakage_found = not report.passed

    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "leakage_detected": leakage_found,
            "cross_split_matches": cross_matches[:25],
            "cross_split_match_count": len(cross_matches),
            "exact_matches": report.exact_matches,
            "near_duplicate_matches": report.near_duplicate_matches,
            "structural_matches": report.structural_matches,
            "violations": report.violations,
            "train_internal_duplicates": train_dups,
            "counts": {"train": len(train), "validation": len(validation), "test": len(test)},
            "test_report": {
                "leakage_detected": leakage_found,
                "match_count": len(cross_matches),
            },
        },
        "summary": (
            f"ตรวจพบ Data Leakage ข้ามชุดข้อมูล {len(cross_matches)} รายการ"
            if leakage_found
            else f"ผ่านการตรวจ Data Leakage (Train {len(train)}, Val {len(validation)}, Test {len(test)}, ซ้ำใน Train {train_dups})"
        ),
    }


def _parse_structured_rows(raw_content: str, fmt: str) -> tuple[str, list[dict[str, Any]]]:
    detected_fmt = fmt
    rows: list[dict[str, Any]] = []
    if fmt == "auto":
        if raw_content.startswith("<"):
            detected_fmt = "xml"
        elif raw_content.startswith("[") or raw_content.startswith("{"):
            detected_fmt = "json"
        elif "," in raw_content.splitlines()[0]:
            detected_fmt = "csv"
        else:
            detected_fmt = "jsonl"

    if detected_fmt == "xml":
        rows = _parse_xml_records(raw_content)
    elif detected_fmt == "json":
        parsed = json.loads(raw_content)
        if isinstance(parsed, list):
            rows = [r if isinstance(r, dict) else {"value": r} for r in parsed]
        elif isinstance(parsed, dict):
            rows = [parsed]
        else:
            rows = [{"value": parsed}]
    elif detected_fmt == "jsonl":
        for line in raw_content.splitlines():
            s = line.strip()
            if s:
                obj = json.loads(s)
                rows.append(obj if isinstance(obj, dict) else {"value": obj})
    else:
        reader = csv.DictReader(io.StringIO(raw_content))
        rows = [dict(r) for r in reader]
    return detected_fmt, rows


def _handle_profile_structured(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    raw_content = str(payload.get("content") or "").strip()
    fmt = str(payload.get("format") or "auto").strip().lower()
    if not raw_content:
        return {"ok": False, "status": "FAILED", "error": "content is required.", "output": {}}

    try:
        detected_fmt, rows = _parse_structured_rows(raw_content, fmt)
    except Exception as exc:
        return {"ok": False, "status": "FAILED", "error": f"Failed to parse {fmt}: {exc}", "output": {}}

    columns: list[str] = []
    seen_cols: set[str] = set()
    for row in rows:
        for k in row.keys():
            if k not in seen_cols:
                seen_cols.add(k)
                columns.append(str(k))

    missing_by_col: dict[str, int] = {c: 0 for c in columns}
    numeric_by_col: dict[str, list[float]] = {c: [] for c in columns}
    seen_rows: set[str] = set()
    duplicate_rows = 0

    for row in rows:
        canonical = json.dumps(row, sort_keys=True, ensure_ascii=False)
        if canonical in seen_rows:
            duplicate_rows += 1
        seen_rows.add(canonical)
        for col in columns:
            val = row.get(col)
            if val is None or (isinstance(val, str) and not val.strip()):
                missing_by_col[col] += 1
                continue
            try:
                num = float(val)
                if math.isfinite(num):
                    numeric_by_col[col].append(num)
            except (TypeError, ValueError):
                pass

    numeric_stats: dict[str, dict[str, float | int]] = {}
    for col, nums in numeric_by_col.items():
        if len(nums) >= 1:
            numeric_stats[col] = {
                "count": len(nums),
                "min": min(nums),
                "max": max(nums),
                "mean": round(statistics.mean(nums), 4),
                "stdev": round(statistics.stdev(nums), 4) if len(nums) > 1 else 0.0,
            }

    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "format": detected_fmt,
            "row_count": len(rows),
            "columns": columns,
            "duplicate_rows": duplicate_rows,
            "missing_counts": missing_by_col,
            "numeric_stats": numeric_stats,
        },
        "summary": (
            f"วิเคราะห์ข้อมูล {detected_fmt.upper()}: {len(rows)} แถว, {len(columns)} คอลัมน์, "
            f"ซ้ำ {duplicate_rows} แถว"
        ),
    }


def _handle_transform(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    raw_content = str(payload.get("content") or "").strip()
    source_format = str(payload.get("source_format") or "auto").strip().lower()
    target_format = str(payload.get("target_format") or "json").strip().lower()
    deduplicate = bool(payload.get("deduplicate", False))
    if not raw_content:
        return {"ok": False, "status": "FAILED", "error": "content is required.", "output": {}}

    try:
        detected_fmt, rows = _parse_structured_rows(raw_content, source_format)
    except Exception as exc:
        return {"ok": False, "status": "FAILED", "error": f"Transform parse failed: {exc}", "output": {}}

    if deduplicate:
        seen: set[str] = set()
        unique_rows: list[dict[str, Any]] = []
        for r in rows:
            canon = json.dumps(r, sort_keys=True, ensure_ascii=False)
            if canon not in seen:
                seen.add(canon)
                unique_rows.append(r)
        rows = unique_rows

    if target_format == "jsonl":
        transformed = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    elif target_format == "csv":
        cols: list[str] = []
        for r in rows:
            for k in r.keys():
                if k not in cols:
                    cols.append(str(k))
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=cols)
        writer.writeheader()
        for r in rows:
            writer.writerow({c: r.get(c, "") for c in cols})
        transformed = buf.getvalue().strip()
    else:
        target_format = "json"
        transformed = json.dumps(rows, ensure_ascii=False, indent=2)

    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "source_format": detected_fmt,
            "target_format": target_format,
            "record_count": len(rows),
            "transformed_content": transformed,
        },
        "summary": f"แปลงข้อมูล {detected_fmt.upper()} → {target_format.upper()} จำนวน {len(rows)} รายการสำเร็จ",
    }


def _handle_db_inspect(_payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    conn = ctx.get("conn")
    if conn is None:
        return {"ok": False, "status": "BLOCKED", "error": "Database connection unavailable.", "output": {}}

    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
        ).fetchall()
    ]
    counts: dict[str, int] = {}
    for tbl in tables:
        if tbl.replace("_", "").isalnum():
            counts[tbl] = int(conn.execute(f'SELECT COUNT(*) FROM "{tbl}"').fetchone()[0])

    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "table_count": len(tables),
            "tables": tables,
            "row_counts": counts,
        },
        "summary": f"ตรวจสอบฐานข้อมูล SQLite: พบ {len(tables)} ตาราง",
    }


def _handle_calc_ast(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    expr = str(payload.get("expression") or "").strip()
    if not expr:
        return {"ok": False, "status": "FAILED", "error": "expression is required.", "output": {}}
    calc_res = zc._calc_any_for_tool(expr)
    if not isinstance(calc_res, dict) or (calc_res.get("ok") is False):
        return {
            "ok": False,
            "status": "FAILED",
            "error": str((calc_res or {}).get("error") or "Unable to evaluate expression deterministically"),
            "output": calc_res if isinstance(calc_res, dict) else {},
        }
    out_obj = {**calc_res, "ok": True}
    val_repr = out_obj.get("result", out_obj.get("mean", out_obj.get("solutions", "")))
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": out_obj,
        "summary": str(out_obj.get("summary") or f"คำนวณ AST สำเร็จ: {val_repr}"),
    }


def register_data_toolkit(registry: Any) -> None:
    manifest = ToolkitManifest(
        id="data",
        name="Data Toolkit",
        thai_name="ชุดเครื่องมือข้อมูลและการคำนวณ",
        version="1.1.0",
        description="ประมวลผล CSV/JSON/XML, แปลงข้อมูล, ตรวจสอบ Data Leakage, ตรวจ SQLite Metadata และคำนวณ AST/สถิติเชิงกำหนด",
        category="data",
        dependencies=("apps.core.dataset_leakage_detector", "python_core.zyrquen_core"),
        default_permission="auto",
        lifecycle_status="READY",
        bound_modules=(
            "apps/core/dataset_leakage_detector.py",
            "python_core/dataset_ingestion.py",
            "python_core/zyrquen_core.py",
        ),
        documentation="ประมวลผลและแปลงข้อมูลเชิงโครงสร้าง ตรวจจับ Data Leakage และตรวจสอบตารางฐานข้อมูลแบบอ่านอย่างเดียว",
    )

    specs = [
        (
            CapabilitySpec(
                id="data.leakage_check",
                toolkit_id="data",
                name="ตรวจจับ Data Leakage ข้ามชุดข้อมูล",
                version="1.0.0",
                description="ใช้ Semantic Hashing + Exact Digest + Slot-Masked Hash ตรวจสอบการปนเปื้อนระหว่าง Train, Validation และ Test",
                input_schema={
                    "type": "object",
                    "required": ["train"],
                    "properties": {
                        "train": {"type": "array"},
                        "validation": {"type": "array"},
                        "test": {"type": "array"},
                    },
                },
                output_schema={"type": "object", "required": ["leakage_detected", "cross_split_match_count", "counts"]},
                dependencies=("apps.core.dataset_leakage_detector",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("apps/core/dataset_leakage_detector.py",),
                documentation="ส่งอาร์เรย์ train, validation, test เพื่อตรวจหา Exact Duplicate และ Near-Duplicate ข้าม Split",
                example_input={
                    "train": ["alpha sample record one", "beta sample record two"],
                    "validation": ["gamma validation record"],
                    "test": ["delta unseen test record"],
                },
                keywords=("data", "leakage", "dataset", "split", "train", "ข้อมูล", "ชุดข้อมูล"),
            ),
            _handle_leakage_check,
        ),
        (
            CapabilitySpec(
                id="data.profile_structured",
                toolkit_id="data",
                name="วิเคราะห์และทำโปรไฟล์ CSV / JSON / JSONL / XML",
                version="1.1.0",
                description="แยกคอลัมน์ นับค่าว่าง ตรวจแถวซ้ำ และสรุปสถิติเชิงตัวเลข (min/max/mean/stdev) จากข้อมูลจริง",
                input_schema={
                    "type": "object",
                    "required": ["content"],
                    "properties": {
                        "content": {"type": "string"},
                        "format": {"type": "string", "enum": ["auto", "csv", "json", "jsonl", "xml"]},
                    },
                },
                output_schema={"type": "object", "required": ["format", "row_count", "columns", "duplicate_rows"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/dataset_ingestion.py",),
                documentation="ส่งเนื้อหา CSV, JSON, JSONL หรือ XML เพื่อวิเคราะห์โครงสร้างและคุณภาพข้อมูล",
                example_input={"format": "csv", "content": "name,score\nalice,92\nbob,85\nbob,85"},
                keywords=("csv", "json", "xml", "profile", "data", "stats", "ข้อมูล", "ตาราง", "สถิติ"),
            ),
            _handle_profile_structured,
        ),
        (
            CapabilitySpec(
                id="data.transform",
                toolkit_id="data",
                name="แปลงและทำความสะอาดข้อมูล (Data Transformation)",
                version="1.0.0",
                description="แปลงรูปแบบระหว่าง CSV, JSON, JSONL และ XML พร้อมตัวเลือกลบแถวซ้ำเชิงกำหนด",
                input_schema={
                    "type": "object",
                    "required": ["content"],
                    "properties": {
                        "content": {"type": "string"},
                        "source_format": {"type": "string", "enum": ["auto", "csv", "json", "jsonl", "xml"]},
                        "target_format": {"type": "string", "enum": ["json", "jsonl", "csv"]},
                        "deduplicate": {"type": "boolean"},
                    },
                },
                output_schema={"type": "object", "required": ["source_format", "target_format", "record_count", "transformed_content"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/toolkits/data.py",),
                documentation="แปลงโครงสร้างข้อมูลระหว่าง CSV/JSON/JSONL/XML และคัดกรองข้อมูลซ้ำ",
                example_input={"content": "name,score\nalice,90\nalice,90", "target_format": "json", "deduplicate": True},
                keywords=("transform", "convert", "csv", "json", "xml", "แปลงข้อมูล"),
            ),
            _handle_transform,
        ),
        (
            CapabilitySpec(
                id="data.db_inspect",
                toolkit_id="data",
                name="ตรวจสอบโครงสร้างฐานข้อมูล SQLite (Read-Only)",
                version="1.0.0",
                description="อ่านรายชื่อตารางและจำนวนแถวจริงจาก SQLite ภายในระบบโดยไม่อนุญาต SQL ที่แก้ไขข้อมูล",
                input_schema={"type": "object", "required": [], "properties": {}},
                output_schema={"type": "object", "required": ["table_count", "tables", "row_counts"]},
                dependencies=("python_core.zyrquen_core",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/zyrquen_core.py",),
                documentation="แสดงรายการตารางและจำนวนระเบียนปัจจุบันในฐานข้อมูลหลัก",
                example_input={},
                keywords=("database", "sqlite", "tables", "ฐานข้อมูล"),
            ),
            _handle_db_inspect,
        ),
        (
            CapabilitySpec(
                id="data.calc_ast",
                toolkit_id="data",
                name="คำนวณ AST / แก้สมการ / สถิติเชิงกำหนด",
                version="1.0.0",
                description="ประมวลผลนิพจน์คณิตศาสตร์ สมการเชิงเส้น/กำลังสอง และสถิติผ่านตัวคำนวณ AST ภายในเครื่อง",
                input_schema={
                    "type": "object",
                    "required": ["expression"],
                    "properties": {"expression": {"type": "string"}},
                },
                output_schema={"type": "object", "required": ["ok"]},
                dependencies=("python_core.zyrquen_core",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/zyrquen_core.py", "python_core/tools_engine.py"),
                documentation="ตัวอย่าง: '(2^12 - 96) / 16', 'แก้สมการ: 3x + 7 = 22', 'สถิติ: 10, 20, 30'",
                example_input={"expression": "(2^12 - 96) / 16"},
                keywords=("math", "calc", "ast", "equation", "statistics", "คำนวณ", "สมการ", "สถิติ"),
            ),
            _handle_calc_ast,
        ),
    ]

    registry.register_toolkit(manifest, specs)
