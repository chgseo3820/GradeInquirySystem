# -*- coding: utf-8 -*-
"""
build_data.py — Excel → 정적 JSON 변환 스크립트
GitHub Pages 배포용 데이터 파일을 생성합니다.

개인정보 보호:
  - 키: SHA-256(학번 + "|" + 전화번호뒷4자리) → 원본 역추적 불가
  - 전화번호, 이메일: JSON에 포함하지 않음
  - 이름: 마스킹 처리 (첫 글자만 표시)
  - 학번: 앞 4자리만 표시

사용법:
  python build_data.py
  → docs/data.json 생성
"""

import hashlib
import json
import math
import re
import openpyxl

EXCEL_FILE = "2026-1_MIS_Score.xlsx"
OUTPUT_FILE = "docs/data.json"

# 컬럼 인덱스 (0-based)
COL = {
    "department": 0,
    "class_num": 1,
    "student_id": 2,
    "name": 3,
    "phone": 4,
    "quiz_score": 63,
    "attendance": 64,
    "midterm": 65,
    "final": 66,
    "total": 67,
    "rank": 68,
    "grade": 69,
    "absences": 70,
    "remark": 71,
}


def safe_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    try:
        return round(float(v), 2)
    except (ValueError, TypeError):
        return None


def mask_name(name):
    if not name:
        return ""
    return name[0] + "*" * (len(name) - 1)


def mask_student_id(sid):
    s = str(sid)
    return s[:4] + "*" * (len(s) - 4) if len(s) > 4 else s


def extract_phone_last4(phone):
    if not phone:
        return ""
    digits = re.sub(r"[^0-9]", "", str(phone))
    return digits[-4:] if len(digits) >= 4 else digits


def make_hash_key(student_id, phone_last4):
    """SHA-256 해시 키 생성 — 원본 역추적 방지"""
    raw = f"{student_id}|{phone_last4}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build():
    wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)
    ws = wb.active

    students = {}
    class_scores = {}

    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, values_only=True):
        sid = row[COL["student_id"]]
        if sid is None:
            continue

        sid = int(sid)
        class_num = int(row[COL["class_num"]]) if row[COL["class_num"]] else 0
        phone_last4 = extract_phone_last4(row[COL["phone"]])

        # 해시 키 생성
        hash_key = make_hash_key(sid, phone_last4)

        quiz = safe_float(row[COL["quiz_score"]])
        attendance = safe_float(row[COL["attendance"]])
        midterm = safe_float(row[COL["midterm"]])
        final = safe_float(row[COL["final"]])
        total = safe_float(row[COL["total"]])
        rank_val = row[COL["rank"]]
        grade = row[COL["grade"]] or ""
        absences = int(row[COL["absences"]]) if row[COL["absences"]] is not None else 0
        remark = row[COL["remark"]] or ""

        students[hash_key] = {
            "department": row[COL["department"]] or "",
            "class_num": class_num,
            "student_id_masked": mask_student_id(sid),
            "name_masked": mask_name(row[COL["name"]]),
            "quiz_score": quiz,
            "attendance_score": attendance,
            "midterm_score": midterm,
            "final_score": final,
            "total_score": total,
            "rank": rank_val,
            "grade": grade,
            "absences": absences,
            "remark": remark,
        }

        # 분반별 집계
        if class_num not in class_scores:
            class_scores[class_num] = {
                "quiz_score": [],
                "attendance_score": [],
                "midterm_score": [],
                "final_score": [],
                "total_score": [],
                "count": 0,
            }
        class_scores[class_num]["count"] += 1
        for field in ["quiz_score", "attendance_score", "midterm_score", "final_score", "total_score"]:
            val = students[hash_key][field]
            if val is not None:
                class_scores[class_num][field].append(val)

    # 석차 → "석차 / 총원" 포맷으로 변환
    for hk, st in students.items():
        cn = st["class_num"]
        count = class_scores[cn]["count"]
        if st["rank"] is not None:
            st["rank"] = f"{st['rank']} / {count}"
        else:
            st["rank"] = "- / -"

    # 분반별 평균·최고 계산
    class_averages = {}
    class_maxes = {}
    class_counts = {}

    for cn, data in class_scores.items():
        avg = {}
        mx = {}
        for field in ["quiz_score", "attendance_score", "midterm_score", "final_score", "total_score"]:
            vals = data[field]
            if vals:
                avg[field] = round(sum(vals) / len(vals), 2)
                mx[field] = round(max(vals), 2)
            else:
                avg[field] = None
                mx[field] = None
        class_averages[str(cn)] = avg
        class_maxes[str(cn)] = mx
        class_counts[str(cn)] = data["count"]

    # JSON 출력
    output = {
        "students": students,
        "class_avg": class_averages,
        "class_max": class_maxes,
        "class_counts": class_counts,
    }

    import os
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    wb.close()
    print(f"✅ {len(students)}명 데이터 → {OUTPUT_FILE} 생성 완료")
    print(f"   분반: {len(class_averages)}개, 파일크기: {os.path.getsize(OUTPUT_FILE):,} bytes")
    print(f"   키 방식: SHA-256(학번|전화번호뒷4자리)")


if __name__ == "__main__":
    build()
