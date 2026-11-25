"""
Software Development Toolkit for ZYRQUEN Tool Center.
Binds real static validation, code contracts, language registry, and sandboxed workspace files.
"""

from __future__ import annotations

import ast
import json
import subprocess
from pathlib import Path
from typing import Any

from apps.core.intelligence.build_validation import BuildValidationInterface, BuildValidationUnavailable
from apps.core.intelligence.code_contract import analyze_code_output, analyze_code_task
from apps.core.intelligence.language_registry import ProgrammingLanguageRegistry
from apps.core.intelligence.static_validation import PythonSyntaxValidator, StaticValidationInterface
import tools_engine as te

from ..contracts import CapabilitySpec, ToolkitManifest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent


def _inspect_python_source(source: str) -> dict[str, Any]:
    validator = PythonSyntaxValidator()
    static_res = validator.validate(source)
    symbols: dict[str, list[str]] = {"functions": [], "classes": [], "imports": []}
    if static_res["status"] == "valid":
        tree = ast.parse(source, mode="exec")
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                symbols["functions"].append(node.name)
            elif isinstance(node, ast.ClassDef):
                symbols["classes"].append(node.name)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    symbols["imports"].append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                if mod:
                    symbols["imports"].append(mod)
    return {
        "static_validation": static_res,
        "symbols": {k: sorted(set(v))[:40] for k, v in symbols.items()},
        "line_count": len(source.splitlines()),
    }


def _inspect_repository_target(target_path: str) -> dict[str, Any]:
    clean = str(target_path or "").strip()
    if not clean or clean in {"current_project", ".", "./"}:
        target = REPO_ROOT
    else:
        target = (REPO_ROOT / clean).resolve()
        if target != REPO_ROOT and not target.is_relative_to(REPO_ROOT):
            return {
                "ok": False,
                "status": "BLOCKED",
                "error": "Path traversal outside repository root is forbidden.",
                "output": {},
            }
    if not target.exists():
        return {
            "ok": False,
            "status": "FAILED",
            "error": f"Target path '{clean}' does not exist in repository.",
            "output": {},
        }

    if target.is_file():
        text = target.read_text(encoding="utf-8", errors="replace")
        rel = str(target.relative_to(REPO_ROOT))
        info: dict[str, Any] = {
            "mode": "file_inspection",
            "path": rel,
            "size_bytes": target.stat().st_size,
            "line_count": len(text.splitlines()),
        }
        if target.suffix == ".py":
            info["python_analysis"] = _inspect_python_source(text)
        elif target.suffix == ".json":
            try:
                parsed = json.loads(text)
                info["json_valid"] = True
                info["top_keys"] = sorted(parsed.keys())[:20] if isinstance(parsed, dict) else []
            except Exception as exc:
                info["json_valid"] = False
                info["json_error"] = str(exc)
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": info,
            "summary": f"วิเคราะห์ไฟล์ {rel} ({info['line_count']} บรรทัด) เรียบร้อยแล้ว",
        }

    # Directory architecture inspection
    counts: dict[str, int] = {"python": 0, "typescript": 0, "tests": 0, "other": 0}
    top_dirs: list[str] = []
    for entry in sorted(target.iterdir()):
        if entry.name.startswith(".") or entry.name in {"node_modules", "dist", "__pycache__", ".venv"}:
            continue
        if entry.is_dir():
            top_dirs.append(entry.name)
    sample_modules: list[str] = []
    for p in sorted(target.rglob("*")):
        if not p.is_file():
            continue
        rel_parts = p.relative_to(REPO_ROOT).parts
        if any(part in {"node_modules", "dist", "__pycache__", ".git", ".venv"} for part in rel_parts):
            continue
        if p.suffix == ".py":
            counts["python"] += 1
            if "test" in p.name:
                counts["tests"] += 1
            if len(sample_modules) < 25:
                sample_modules.append("/".join(rel_parts))
        elif p.suffix in {".ts", ".tsx"}:
            counts["typescript"] += 1
            if ".test." in p.name:
                counts["tests"] += 1
        else:
            counts["other"] += 1

    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "mode": "repository_architecture",
            "target": str(target.relative_to(REPO_ROOT)) if target != REPO_ROOT else ".",
            "top_directories": top_dirs,
            "file_counts": counts,
            "sample_python_modules": sample_modules,
        },
        "summary": (
            f"สำรวจสถาปัตยกรรมสำเร็จ: โมดูล Python {counts['python']} ไฟล์, "
            f"TypeScript/React {counts['typescript']} ไฟล์, ไฟล์ทดสอบ {counts['tests']} ไฟล์"
        ),
    }


def _handle_code_analysis(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    source = payload.get("source")
    language = str(payload.get("language") or "python").strip().lower()
    if isinstance(source, str) and source.strip():
        lang_reg = ProgrammingLanguageRegistry()
        lang_reg.register("json", (".json",))
        lang_reg.register("typescript", (".ts", ".tsx"))
        if language == "python":
            iface = StaticValidationInterface(lang_reg)
            sv = iface.validate("python", source)
            details = _inspect_python_source(source)
            return {
                "ok": True,
                "status": "COMPLETED",
                "output": {
                    "mode": "source_static_analysis",
                    "language": "python",
                    "validation": sv,
                    **details,
                },
                "summary": (
                    f"วิเคราะห์โค้ด Python ({details['line_count']} บรรทัด): "
                    f"สถานะ {sv['status']} (ฟังก์ชัน {len(details['symbols']['functions'])}, คลาส {len(details['symbols']['classes'])})"
                ),
            }
        if language == "json":
            try:
                parsed = json.loads(source)
                return {
                    "ok": True,
                    "status": "COMPLETED",
                    "output": {
                        "mode": "source_static_analysis",
                        "language": "json",
                        "validation": {"status": "valid", "problems": [], "code_executed": False},
                        "type": type(parsed).__name__,
                    },
                    "summary": "ตรวจสอบโครงสร้าง JSON ถูกต้อง",
                }
            except Exception as exc:
                return {
                    "ok": True,
                    "status": "COMPLETED",
                    "output": {
                        "mode": "source_static_analysis",
                        "language": "json",
                        "validation": {
                            "status": "invalid",
                            "problems": [{"message": str(exc), "line": None, "column": None}],
                            "code_executed": False,
                        },
                    },
                    "summary": f"JSON ไม่ถูกต้อง: {exc}",
                }
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {
                "mode": "source_lexical_analysis",
                "language": language,
                "line_count": len(source.splitlines()),
                "char_count": len(source),
                "code_executed": False,
            },
            "summary": f"วิเคราะห์โครงสร้างข้อความ {language} ({len(source.splitlines())} บรรทัด)",
        }

    repo_target = str(payload.get("target_path") or payload.get("repository") or "current_project")
    return _inspect_repository_target(repo_target)


def _handle_contract_validate(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    lang_reg = ProgrammingLanguageRegistry()
    lang_reg.register("typescript", (".ts", ".tsx"))
    lang_reg.register("json", (".json",))
    lang_reg.register("markdown", (".md",))

    kind = str(payload.get("kind") or "task").strip().lower()
    target = payload.get("payload")
    if not isinstance(target, dict):
        return {
            "ok": False,
            "status": "FAILED",
            "error": "payload must be a JSON object representing a code task or code output.",
            "output": {},
        }
    if kind == "output":
        res = analyze_code_output(target, lang_reg, expected_task_id=payload.get("expected_task_id"))
        valid = res["status"] == "valid_output"
    else:
        res = analyze_code_task(target, lang_reg)
        valid = res["status"] == "valid_task"

    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "kind": kind,
            "valid": valid,
            **res,
        },
        "summary": f"ตรวจสอบ Code Contract ({kind}): {res['status']} ({len(res['problems'])} ปัญหา)",
    }


def _handle_workspace_file(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    action = str(payload.get("action") or "list").strip().lower()
    data_dir: Path = ctx["data_dir"]
    if action == "list":
        files = te.list_workspace_files(data_dir)
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {"action": "list", "files": files, "count": len(files)},
            "summary": f"พบไฟล์ใน workspace จำนวน {len(files)} ไฟล์",
        }
    filename = str(payload.get("filename") or "").strip()
    if action == "read":
        if not filename:
            return {"ok": False, "status": "FAILED", "error": "filename is required for read.", "output": {}}
        target = te.safe_workspace_path(data_dir, filename)
        if not target or not target.exists():
            return {"ok": False, "status": "FAILED", "error": f"Workspace file '{filename}' not found.", "output": {}}
        content = target.read_text(encoding="utf-8", errors="replace")[:20000]
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {"action": "read", "filename": target.name, "content": content, "size_bytes": target.stat().st_size},
            "summary": f"อ่านไฟล์ {target.name} ({target.stat().st_size} B) สำเร็จ",
        }
    if action == "write":
        content = str(payload.get("content") or "")
        saved = te.save_workspace_file(data_dir, filename, content)
        if not saved.get("ok"):
            return {"ok": False, "status": "FAILED", "error": saved.get("error"), "output": {}}
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {"action": "write", "file": saved.get("file")},
            "summary": f"บันทึกไฟล์ {filename} เข้าสู่ workspace เรียบร้อยแล้ว",
        }
    return {"ok": False, "status": "FAILED", "error": "Unsupported action (expected list, read, or write).", "output": {}}


def _handle_build_validate(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    iface = BuildValidationInterface()
    try:
        iface.validate(payload.get("specification") or {}, payload.get("manifest") or {})
        return {"ok": True, "status": "COMPLETED", "output": {}}
    except BuildValidationUnavailable as exc:
        return {
            "ok": False,
            "status": "BLOCKED",
            "error": str(exc),
            "output": {"implemented": False, "fail_closed": True},
            "summary": "Build validation ยังเป็น fail-closed placeholder (IN_DEVELOPMENT)",
        }


def _handle_git_inspect(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    git_dir = REPO_ROOT / ".git"
    if not git_dir.exists():
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {
                "git_available": False,
                "branch": None,
                "dirty_files": [],
                "recent_commits": [],
                "reason": "Repository metadata directory (.git) is not present in this runtime.",
            },
            "summary": "ไม่พบข้อมูล .git ใน runtime นี้ (git_available=false)",
        }

    max_commits = max(1, min(15, int(payload.get("limit") or 5)))
    try:
        branch_p = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=5,
        )
        status_p = subprocess.run(
            ["git", "status", "--short"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=5,
        )
        log_p = subprocess.run(
            ["git", "log", f"-n{max_commits}", "--oneline"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if branch_p.returncode != 0:
            return {
                "ok": True,
                "status": "COMPLETED",
                "output": {
                    "git_available": False,
                    "branch": None,
                    "dirty_files": [],
                    "recent_commits": [],
                    "reason": (branch_p.stderr or "git command returned non-zero").strip(),
                },
                "summary": "ไม่สามารถอ่านสถานะ Git ได้ในสภาพแวดล้อมนี้",
            }
        dirty = [ln for ln in (status_p.stdout or "").splitlines() if ln.strip()][:50]
        commits = [ln for ln in (log_p.stdout or "").splitlines() if ln.strip()][:max_commits]
        branch = (branch_p.stdout or "").strip()
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {
                "git_available": True,
                "branch": branch,
                "dirty_files": dirty,
                "dirty_count": len(dirty),
                "recent_commits": commits,
            },
            "summary": f"ตรวจสอบ Git (branch '{branch}', ไฟล์เปลี่ยนแปลง {len(dirty)}, คอมมิตล่าสุด {len(commits)})",
        }
    except Exception as exc:
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {
                "git_available": False,
                "branch": None,
                "dirty_files": [],
                "recent_commits": [],
                "reason": str(exc),
            },
            "summary": f"ไม่สามารถเรียก git read-only: {exc}",
        }


def _safe_repo_path(value: str | None) -> Path | None:
    raw = str(value or ".").strip() or "."
    target = (REPO_ROOT / raw).resolve()
    if target != REPO_ROOT and not target.is_relative_to(REPO_ROOT):
        return None
    return target


def _handle_dependency_inventory(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    """Read dependency declarations without installing or executing packages."""
    target = _safe_repo_path(payload.get("target_path"))
    if target is None:
        return {"ok": False, "status": "BLOCKED", "error": "Path traversal outside repository root is forbidden.", "output": {}}
    if not target.exists():
        return {"ok": False, "status": "FAILED", "error": "Target path does not exist.", "output": {}}
    manifests = ("pyproject.toml", "requirements.txt", "requirements-dev.txt", "package.json", "Pipfile", "poetry.lock", "package-lock.json")
    found: dict[str, Any] = {}
    for name in manifests:
        path = target / name
        if not path.is_file() or path.stat().st_size > 2_000_000:
            continue
        try:
            if name == "package.json":
                doc = json.loads(path.read_text(encoding="utf-8"))
                found[name] = {
                    "dependencies": sorted((doc.get("dependencies") or {}).keys()),
                    "devDependencies": sorted((doc.get("devDependencies") or {}).keys()),
                }
            elif name.endswith(".txt"):
                entries = []
                for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                    line = line.strip()
                    if line and not line.startswith(("#", "-")):
                        entries.append(line)
                found[name] = entries[:500]
            elif name == "pyproject.toml":
                try:
                    import tomllib
                    doc = tomllib.loads(path.read_text(encoding="utf-8"))
                    project = doc.get("project", {})
                    found[name] = {"dependencies": project.get("dependencies", []), "optional_dependencies": project.get("optional-dependencies", {})}
                except (ImportError, ValueError) as exc:
                    found[name] = {"parse_error": str(exc)}
            else:
                found[name] = {"present": True, "size_bytes": path.stat().st_size}
        except (OSError, json.JSONDecodeError) as exc:
            found[name] = {"parse_error": str(exc)}
    rel_target = str(target.relative_to(REPO_ROOT)) if target != REPO_ROOT else "."
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {"target": rel_target, "manifests": found, "manifest_count": len(found), "install_performed": False},
        "summary": f"ตรวจพบไฟล์กำหนด Dependencies {len(found)} รายการ โดยไม่ติดตั้งแพ็กเกจ",
    }


def _handle_test_discovery(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    target = _safe_repo_path(payload.get("target_path"))
    if target is None:
        return {"ok": False, "status": "BLOCKED", "error": "Path traversal outside repository root is forbidden.", "output": {}}
    if not target.exists():
        return {"ok": False, "status": "FAILED", "error": "Target path does not exist.", "output": {}}
    ignored = {".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__", ".pytest_cache"}
    matches: list[str] = []
    for path in target.rglob("*"):
        if not path.is_file() or any(part in ignored for part in path.relative_to(target).parts):
            continue
        name = path.name.lower()
        if name.startswith("test_") or name.endswith(("_test.py", ".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".spec.js", ".spec.jsx")):
            matches.append(str(path.relative_to(REPO_ROOT)))
            if len(matches) >= 500:
                break
    matches.sort()
    rel_target = str(target.relative_to(REPO_ROOT)) if target != REPO_ROOT else "."
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {"target": rel_target, "test_files": matches, "count": len(matches), "tests_executed": False},
        "summary": f"ค้นพบไฟล์ทดสอบ {len(matches)} ไฟล์ (ยังไม่ได้รันทดสอบ)",
    }


def _handle_config_audit(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    target = _safe_repo_path(payload.get("target_path"))
    if target is None:
        return {"ok": False, "status": "BLOCKED", "error": "Path traversal outside repository root is forbidden.", "output": {}}
    if not target.exists():
        return {"ok": False, "status": "FAILED", "error": "Target path does not exist.", "output": {}}
    config_names = ("pyproject.toml", "pytest.ini", "tox.ini", "mypy.ini", "ruff.toml", ".ruff.toml", "tsconfig.json", "vite.config.ts", "vitest.config.ts", "eslint.config.js", ".eslintrc.json", "Dockerfile", "docker-compose.yml", "compose.yaml", ".github/workflows")
    present = [name for name in config_names if (target / name).exists()]
    rel_target = str(target.relative_to(REPO_ROOT)) if target != REPO_ROOT else "."
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {"target": rel_target, "present_configs": present, "count": len(present), "files_modified": False},
        "summary": f"ตรวจพบไฟล์ตั้งค่า Build/Test/Quality {len(present)} รายการ",
    }


def _handle_symbol_search(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    """Search source files without importing or executing them."""
    target = _safe_repo_path(payload.get("target_path"))
    if target is None:
        return {"ok": False, "status": "BLOCKED", "error": "Path traversal outside repository root is forbidden.", "output": {}}
    if not target.exists():
        return {"ok": False, "status": "FAILED", "error": "Target path does not exist.", "output": {}}
    query = str(payload.get("query") or "").strip()
    if not query or len(query) > 160:
        return {"ok": False, "status": "FAILED", "error": "A search query of 1–160 characters is required.", "output": {}}
    extensions = {".py", ".ts", ".tsx", ".js", ".jsx"}
    ignored = {".git", "node_modules", ".venv", "venv", "dist", "build", "__pycache__", ".pytest_cache"}
    files = (
        [target]
        if target.is_file()
        else (
            path
            for path in sorted(target.rglob("*"))
            if path.is_file()
            and path.suffix.lower() in extensions
            and not any(part in ignored for part in path.relative_to(target).parts)
        )
    )
    results: list[dict[str, Any]] = []
    needle = query.casefold()
    scanned = 0
    for path in files:
        resolved = path.resolve()
        if resolved != REPO_ROOT and not resolved.is_relative_to(REPO_ROOT):
            continue
        if path.suffix.lower() not in extensions or path.stat().st_size > 1_000_000:
            continue
        scanned += 1
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line_no, line in enumerate(lines, 1):
            if needle not in line.casefold():
                continue
            results.append({"path": str(path.relative_to(REPO_ROOT)), "line": line_no, "text": line.strip()[:300]})
            if len(results) >= 100:
                break
        if len(results) >= 100:
            break
    return {
        "ok": True,
        "status": "COMPLETED",
        "output": {
            "query": query,
            "matches": results,
            "count": len(results),
            "files_scanned": scanned,
            "code_executed": False,
        },
        "summary": f"ค้นหา '{query}' พบ {len(results)} จุด จากการอ่าน {scanned} ไฟล์",
    }


def _handle_diff_inspect(payload: dict[str, Any], _ctx: dict[str, Any]) -> dict[str, Any]:
    """Inspect Git diff without modifying the repository."""
    raw_path = str(payload.get("target_path") or "").strip()
    if raw_path:
        target = _safe_repo_path(raw_path)
        if target is None:
            return {"ok": False, "status": "BLOCKED", "error": "Path traversal outside repository root is forbidden.", "output": {}}
        if not target.exists():
            return {"ok": False, "status": "FAILED", "error": "Target path does not exist.", "output": {}}
        rel = "." if target == REPO_ROOT else str(target.relative_to(REPO_ROOT))
    else:
        rel = "."
    if not (REPO_ROOT / ".git").exists():
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {
                "diff": "",
                "truncated": False,
                "changed_line_count": 0,
                "target": rel,
                "repository_modified": False,
                "git_available": False,
                "reason": "Repository metadata directory (.git) is not present in this runtime.",
            },
            "summary": "Runtime นี้ไม่มี Git metadata จึงไม่มี diff ให้ตรวจสอบ",
        }
    try:
        command = ["git", "--no-pager", "diff", "--no-color", "--no-ext-diff", "--unified=3", "--"]
        if rel != ".":
            command.append(rel)
        completed = subprocess.run(command, cwd=REPO_ROOT, capture_output=True, text=True, timeout=8, check=False)
        if completed.returncode not in (0, 1):
            reason = completed.stderr.strip()[:500] or "git diff failed"
            if "not a git repository" in reason.lower():
                return {
                    "ok": True,
                    "status": "COMPLETED",
                    "output": {
                        "diff": "",
                        "truncated": False,
                        "changed_line_count": 0,
                        "target": rel,
                        "repository_modified": False,
                        "git_available": False,
                        "reason": reason,
                    },
                    "summary": "Runtime นี้ไม่มี Git metadata จึงไม่มี diff ให้ตรวจสอบ",
                }
            return {"ok": False, "status": "FAILED", "error": reason, "output": {}}
        full_diff = completed.stdout
        return {
            "ok": True,
            "status": "COMPLETED",
            "output": {
                "diff": full_diff[:40000],
                "truncated": len(full_diff) > 40000,
                "changed_line_count": sum(
                    1 for line in full_diff.splitlines() if line.startswith(("+", "-")) and not line.startswith(("+++", "---"))
                ),
                "target": rel,
                "repository_modified": False,
                "git_available": True,
            },
            "summary": "อ่าน Git diff เรียบร้อยแล้ว" if full_diff else "ไม่พบความแตกต่างใน Git diff",
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "status": "FAILED", "error": f"Unable to inspect Git diff: {exc}", "output": {}}


def register_development_toolkit(registry: Any) -> None:
    manifest = ToolkitManifest(
        id="development",
        name="Software Development Toolkit",
        thai_name="ชุดเครื่องมือพัฒนาซอฟต์แวร์",
        version="1.1.0",
        description="วิเคราะห์โค้ด ตรวจสอบ Contracts จัดการ Workspace สำรวจ Dependencies ค้นหา Tests และตรวจสอบ Build/Quality Configurations",
        category="engineering",
        dependencies=("apps.core.intelligence.static_validation", "apps.core.intelligence.code_contract", "python_core.tools_engine"),
        default_permission="auto",
        lifecycle_status="READY",
        bound_modules=(
            "apps/core/intelligence/static_validation.py",
            "apps/core/intelligence/code_contract.py",
            "apps/core/intelligence/language_registry.py",
            "apps/core/intelligence/build_validation.py",
            "python_core/tools_engine.py",
        ),
        documentation="ใช้สำหรับวิเคราะห์โครงสร้างโค้ด Python/JSON, ตรวจสอบสัญญา Code Task/Output และอ่านเขียนไฟล์ในพื้นที่ทำงาน",
    )

    specs = [
        (
            CapabilitySpec(
                id="development.code_analysis",
                toolkit_id="development",
                name="วิเคราะห์โค้ดและสถาปัตยกรรม (Static Code & Repo Analysis)",
                version="1.0.0",
                description="วิเคราะห์ไวยากรณ์ Python ด้วย AST (ไม่รันโค้ด) หรือสำรวจโครงสร้างโมดูลใน Repository จริง",
                input_schema={
                    "type": "object",
                    "required": [],
                    "properties": {
                        "repository": {"type": "string"},
                        "target_path": {"type": "string"},
                        "task": {"type": "string"},
                        "language": {"type": "string", "enum": ["python", "json", "typescript"]},
                        "source": {"type": "string"},
                    },
                },
                output_schema={"type": "object", "required": ["mode"]},
                dependencies=("apps.core.intelligence.static_validation",),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("apps/core/intelligence/static_validation.py",),
                documentation="ส่ง source+language เพื่อตรวจโค้ดโดยตรง หรือส่ง repository='current_project' เพื่อตรวจโครงสร้างโปรเจกต์",
                example_input={"repository": "current_project", "task": "inspect_architecture"},
                keywords=("code", "architecture", "project", "ast", "python", "พัฒนา", "ระบบ", "โค้ด", "โครงสร้าง"),
            ),
            _handle_code_analysis,
        ),
        (
            CapabilitySpec(
                id="development.contract_validate",
                toolkit_id="development",
                name="ตรวจสอบ Code Task & Output Contract",
                version="1.0.0",
                description="ตรวจสอบความครบถ้วนและความปลอดภัยของโครงสร้างงานเขียนโค้ดและไฟล์ผลลัพธ์ (ป้องกัน Path Traversal)",
                input_schema={
                    "type": "object",
                    "required": ["payload"],
                    "properties": {
                        "kind": {"type": "string", "enum": ["task", "output"]},
                        "payload": {"type": "object"},
                        "expected_task_id": {"type": "string"},
                    },
                },
                output_schema={"type": "object", "required": ["valid", "status", "problems"]},
                dependencies=("apps.core.intelligence.code_contract", "apps.core.intelligence.language_registry"),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("apps/core/intelligence/code_contract.py", "apps/core/intelligence/language_registry.py"),
                documentation="ตรวจสอบ task (task_id, objective, language, requirements) หรือ output (task_id, language, files)",
                example_input={
                    "kind": "task",
                    "payload": {
                        "task_id": "task-1",
                        "objective": "Create validator",
                        "language": "python",
                        "requirements": ["Validate input strictly"],
                    },
                },
                keywords=("contract", "validate", "schema", "พัฒนา", "สัญญา"),
            ),
            _handle_contract_validate,
        ),
        (
            CapabilitySpec(
                id="development.workspace_file",
                toolkit_id="development",
                name="จัดการไฟล์เวิร์กสเปซ Sandbox",
                version="1.0.0",
                description="แสดงรายการ อ่าน หรือเขียนไฟล์ข้อความ/โค้ดภายใน DATA_DIR/workspace_files อย่างปลอดภัย",
                input_schema={
                    "type": "object",
                    "required": [],
                    "properties": {
                        "action": {"type": "string", "enum": ["list", "read", "write"]},
                        "filename": {"type": "string"},
                        "content": {"type": "string"},
                    },
                },
                output_schema={"type": "object", "required": ["action"]},
                dependencies=("python_core.tools_engine",),
                permission_mode="auto",
                risk_tier="sandbox_io",
                lifecycle_status="READY",
                bound_modules=("python_core/tools_engine.py",),
                documentation="ระบุ action='list', 'read' (พร้อม filename), หรือ 'write' (พร้อม filename และ content)",
                example_input={"action": "list"},
                keywords=("file", "workspace", "save", "ไฟล์", "คลัง"),
            ),
            _handle_workspace_file,
        ),
        (
            CapabilitySpec(
                id="development.build_validate",
                toolkit_id="development",
                name="Build Validation Interface (อยู่ระหว่างพัฒนา)",
                version="0.1.0",
                description="อินเทอร์เฟซ Build Validation แบบ Fail-Closed จาก apps/core (ยังไม่มี Build Runner จริงเชื่อมต่อ)",
                input_schema={"type": "object", "required": [], "properties": {"specification": {"type": "object"}, "manifest": {"type": "object"}}},
                output_schema={"type": "object", "required": ["implemented"]},
                dependencies=("apps.core.intelligence.build_validation",),
                permission_mode="admin_only",
                risk_tier="governance",
                lifecycle_status="IN_DEVELOPMENT",
                bound_modules=("apps/core/intelligence/build_validation.py",),
                documentation="โมดูลนี้ยังอยู่ในสถานะ IN_DEVELOPMENT และจะตอบ BLOCKED แบบซื่อสัตย์จนกว่าจะมี Build Runner จริง",
                example_input={"specification": {}, "manifest": {}},
                keywords=("build", "compile"),
            ),
            _handle_build_validate,
        ),
        (
            CapabilitySpec(
                id="development.git_inspect",
                toolkit_id="development",
                name="ตรวจสอบสถานะ Git แบบอ่านอย่างเดียว (Read-Only Git Inspect)",
                version="1.0.0",
                description="ตรวจ branch, ไฟล์ที่เปลี่ยนแปลง และประวัติ commit ล่าสุดแบบอ่านอย่างเดียว (ไม่แก้ไข repo)",
                input_schema={"type": "object", "required": [], "properties": {"limit": {"type": "integer"}}},
                output_schema={"type": "object", "required": ["git_available", "dirty_files", "recent_commits"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/toolkits/development.py",),
                documentation="เรียก git status/log แบบ read-only และแจ้งผลตามจริงหาก runtime ไม่มี .git",
                example_input={"limit": 5},
                keywords=("git", "commit", "branch", "diff", "repo", "สถานะโค้ด"),
            ),
            _handle_git_inspect,
        ),
        (
            CapabilitySpec(
                id="development.dependency_inventory",
                toolkit_id="development",
                name="สำรวจ Dependencies ของโปรเจกต์",
                version="1.0.0",
                description="อ่าน package.json, pyproject.toml และ requirements แบบ read-only โดยไม่ติดตั้งแพ็กเกจ",
                input_schema={"type": "object", "properties": {"target_path": {"type": "string"}}},
                output_schema={"type": "object", "required": ["manifests", "manifest_count"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/toolkits/development.py",),
                documentation="สำรวจรายการ dependency และไฟล์ lock/config โดยไม่เรียก package manager.",
                example_input={"target_path": "."},
                keywords=("dependency", "package", "npm", "pip", "requirements", "แพ็กเกจ"),
            ),
            _handle_dependency_inventory,
        ),
        (
            CapabilitySpec(
                id="development.test_discovery",
                toolkit_id="development",
                name="ค้นหาไฟล์ทดสอบใน Repository",
                version="1.0.0",
                description="ค้นหาไฟล์ pytest, Vitest, Jest และ Playwright ตามรูปแบบชื่อไฟล์ โดยไม่รันการทดสอบ",
                input_schema={"type": "object", "properties": {"target_path": {"type": "string"}}},
                output_schema={"type": "object", "required": ["test_files", "count", "tests_executed"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/toolkits/development.py",),
                documentation="คืนรายการไฟล์ทดสอบที่ค้นพบ แยกจากการรันทดสอบจริง.",
                example_input={"target_path": "."},
                keywords=("test", "pytest", "vitest", "jest", "playwright", "ค้นหาเทสต์"),
            ),
            _handle_test_discovery,
        ),
        (
            CapabilitySpec(
                id="development.config_audit",
                toolkit_id="development",
                name="ตรวจสอบ Build และ Quality Configuration",
                version="1.0.0",
                description="ตรวจหาไฟล์ตั้งค่าของ TypeScript, Vite, pytest, lint, Docker และ CI แบบ read-only",
                input_schema={"type": "object", "properties": {"target_path": {"type": "string"}}},
                output_schema={"type": "object", "required": ["present_configs", "count"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/toolkits/development.py",),
                documentation="รายงานเฉพาะไฟล์ตั้งค่าที่มีอยู่ ไม่แก้ไขไฟล์และไม่อ้างว่าระบบผ่าน CI.",
                example_input={"target_path": "."},
                keywords=("config", "build", "lint", "ci", "quality", "ตั้งค่า"),
            ),
            _handle_config_audit,
        ),
        (
            CapabilitySpec(
                id="development.symbol_search",
                toolkit_id="development",
                name="ค้นหาสัญลักษณ์และจุดใช้งานในโค้ด",
                version="1.0.0",
                description="ค้นหาชื่อฟังก์ชัน คลาส หรือข้อความในไฟล์ Python/TypeScript/JavaScript แบบอ่านอย่างเดียว",
                input_schema={
                    "type": "object",
                    "required": ["query"],
                    "properties": {"query": {"type": "string"}, "target_path": {"type": "string"}},
                },
                output_schema={"type": "object", "required": ["matches", "count", "code_executed"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/toolkits/development.py",),
                documentation="ค้นหาตำแหน่งข้อความในซอร์สโค้ดโดยไม่ import หรือ execute ไฟล์",
                example_input={"query": "register_development_toolkit", "target_path": "."},
                keywords=(
                    "symbol",
                    "search",
                    "function",
                    "class",
                    "reference",
                    "สัญลักษณ์",
                    "จุดใช้งาน",
                    "ค้นหาฟังก์ชัน",
                    "ค้นหาคลาส",
                    "ค้นหาโค้ด",
                ),
            ),
            _handle_symbol_search,
        ),
        (
            CapabilitySpec(
                id="development.diff_inspect",
                toolkit_id="development",
                name="ตรวจสอบความแตกต่างของโค้ด (Git Diff)",
                version="1.0.0",
                description="อ่าน Git diff แบบ read-only พร้อมจำกัดเวลาและขนาดผลลัพธ์",
                input_schema={"type": "object", "properties": {"target_path": {"type": "string"}}},
                output_schema={"type": "object", "required": ["diff", "truncated", "repository_modified"]},
                dependencies=(),
                permission_mode="auto",
                risk_tier="local_readonly",
                lifecycle_status="READY",
                bound_modules=("python_core/tool_center/toolkits/development.py",),
                documentation="อ่าน diff ที่ Git ติดตามอยู่ ไม่แก้ไขไฟล์หรือ stage การเปลี่ยนแปลง",
                example_input={"target_path": "."},
                keywords=("git", "diff", "changes", "patch", "review", "ความแตกต่าง", "ตรวจ diff", "git diff"),
            ),
            _handle_diff_inspect,
        ),
    ]

    registry.register_toolkit(manifest, specs)
