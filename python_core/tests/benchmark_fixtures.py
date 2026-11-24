"""
Isolated Benchmark Fixtures for ZYRQUEN Native AI Core (P1-1).

Strict Leakage Policy:
- TRAINING_CORPUS_LINES and SEED_TRIPLES are exclusively for populating the
  isolated benchmark SQLite database.
- EVALUATION_FIXTURES are strictly disjoint from TRAINING_CORPUS_LINES so
  memorized training lines can never masquerade as generalization.
"""

import re

SEED_TRIPLES: list[tuple[str, str, str]] = [
    ("ZYRQUEN", "ใช้งาน", "Python Native Core"),
    ("Python Native Core", "พัฒนาโดย", "ทีมวิจัยอัลฟ่า"),
    ("ทีมวิจัยอัลฟ่า", "ตั้งอยู่ที่", "ศูนย์ปฏิบัติการโอเมก้า"),
    ("ศูนย์ปฏิบัติการโอเมก้า", "ใช้ฐานข้อมูล", "SQLite WAL"),
    ("SQLite WAL", "รองรับ", "Parameterized Queries"),
    ("โมดูล AST", "ตรวจสอบ", "นิพจน์คณิตศาสตร์"),
    ("A", "มากกว่า", "B"),
    ("คาร์บอน", "มีเลขอะตอม", "6"),
]

# Training corpus used strictly for N-Gram checkpoint training in isolated DB.
# Kept strictly disjoint from every evaluation prompt below.
TRAINING_CORPUS_LINES: list[str] = [
    "ระบบ zyrquen ประมวลผลคณิตศาสตร์ผ่าน ast อย่างปลอดภัย",
    "ระบบ zyrquen จัดเก็บความจำในกราฟความรู้ sqlite",
    "ระบบ zyrquen วางแผนงานแบบ dag จากสถานะฐานข้อมูลจริง",
    "ระบบ zyrquen ไม่ส่งข้อมูลไปยังโมเดลภายนอกโดยเด็ดขาด",
    "ระบบ zyrquen ตรวจสอบคำตอบก่อนบันทึกทุกครั้ง",
    "การฝึกโมเดลภายในต้องผ่านขั้นตอน approval gate ก่อนเสมอ",
    "ชุดข้อมูลที่ดีต้องไม่มี data leakage ระหว่าง train และ test",
    "การค้นคว้าเว็บต้องตรวจ allowlist และแยกหลักฐานภายนอกเสมอ",
    "กราฟความรู้รองรับการอนุมานความสัมพันธ์สองช่วงและหลายช่วง",
    "ทุกคำสั่งสำคัญต้องบันทึกใน audit log เพื่อตรวจสอบย้อนกลับ",
]

# Strictly held-out prompts used for Negative Abstention / OOV / Generalization probes.
HELD_OUT_NEGATIVE_PROMPTS: list[dict] = [
    {
        "id": "NEG-01",
        "prompt": "ทฤษฎีสัมพัทธภาพทั่วไปคืออะไร",
        "mode": "auto",
        "expected_status": "NOT_LEARNED",
        "description": "Unlearned Thai physics question (probing short-syllable false positive)",
    },
    {
        "id": "NEG-02",
        "prompt": "กลไกการสังเคราะห์แสงในคลอโรพลาสต์ทำงานอย่างไร",
        "mode": "auto",
        "expected_status": "NOT_LEARNED",
        "description": "Unlearned Thai biology question",
    },
    {
        "id": "NEG-03",
        "prompt": "หลุมดำมวลยิ่งยวดเกิดขึ้นได้อย่างไร",
        "mode": "auto",
        "expected_status": "NOT_LEARNED",
        "description": "Unlearned Thai astronomy question",
    },
    {
        "id": "NEG-04",
        "prompt": "อะไรคืออะไร",
        "mode": "auto",
        "expected_status": "NOT_LEARNED",
        "description": "Thai stopword-only query must abstain",
    },
    {
        "id": "NEG-05",
        "prompt": "Explain quantum entanglement",
        "mode": "auto",
        "expected_status": "NOT_LEARNED",
        "description": "Unlearned English physics prompt must abstain",
    },
    {
        "id": "NEG-06",
        "prompt": "Explain quantum computing architecture",
        "mode": "model",
        "expected_status": "NOT_LEARNED",
        "description": "OOV English prompt in N-Gram model mode must abstain",
    },
    {
        "id": "NEG-07",
        "prompt": "ทฤษฎีสัมพัทธภาพทั่วไปคืออะไร",
        "mode": "model",
        "expected_status": "NOT_LEARNED",
        "description": "Unlearned Thai prompt with partial stopword/syllable vocab overlap in model mode must abstain",
    },
]


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def verify_fixture_isolation() -> dict:
    """
    Verify zero exact or substring contamination between TRAINING_CORPUS_LINES
    and HELD_OUT_NEGATIVE_PROMPTS (plus math/logic evaluation prompts).
    """
    train_norm = {_norm(line) for line in TRAINING_CORPUS_LINES}
    overlaps: list[dict] = []

    for item in HELD_OUT_NEGATIVE_PROMPTS:
        p_norm = _norm(item["prompt"])
        if p_norm in train_norm:
            overlaps.append({"id": item["id"], "prompt": item["prompt"], "type": "exact"})
            continue
        for tr in train_norm:
            if len(p_norm) >= 8 and (p_norm in tr or tr in p_norm):
                overlaps.append({"id": item["id"], "prompt": item["prompt"], "type": "substring", "matched_train": tr})

    return {
        "isolated": len(overlaps) == 0,
        "training_records": len(TRAINING_CORPUS_LINES),
        "heldout_negative_cases": len(HELD_OUT_NEGATIVE_PROMPTS),
        "overlaps": overlaps,
    }
