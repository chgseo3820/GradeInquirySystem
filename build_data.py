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

EXCEL_FILE = "2026-1학기_경영정보론_서창갑.xlsx"
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
    
    # 1. 사용할 시트 결정 (최종성적 -> 총괄 -> 첫 번째 시트 순)
    sheet_name = None
    for name in ["최종성적", "총괄"]:
        if name in wb.sheetnames:
            sheet_name = name
            break
    ws = wb[sheet_name] if sheet_name else wb.active
    print(f"[build_data] 시트 '{ws.title}'에서 데이터를 읽어옵니다.")

    # 2. 헤더 행 읽기 및 키워드 기반 동적 매핑
    first_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    headers = [str(cell).strip() if cell is not None else "" for cell in first_row]
    
    def find_idx(keywords, exclude_keywords=None):
        for idx, h in enumerate(headers):
            if any(kw in h for kw in keywords):
                if exclude_keywords and any(ex in h for ex in exclude_keywords):
                    continue
                return idx
        return None

    col = {
        "department": find_idx(["학과", "학부", "전공"]),
        "class_num": find_idx(["분반", "반"]),
        "student_id": find_idx(["학번"]),
        "name": find_idx(["이름", "성명"]),
        "phone": find_idx(["전화", "핸드폰", "연락처", "휴대폰"]),
        "quiz_score": find_idx(["퀴즈"]),
        "attendance": find_idx(["출석"]),
        "midterm": find_idx(["중간"]),
        "final": find_idx(["기말"]),
        "total": find_idx(["총점", "성적"]),
        "rank": find_idx(["석차", "순위", "등수"], exclude_keywords=["결석"]),
        "grade": find_idx(["학점", "평점", "등급"]),
        "absences": find_idx(["결석", "결석횟수", "결석차시"]),
        "remark": find_idx(["비고"]),
    }

    # 필수 컬럼(학번, 이름)이 감지되지 않으면 에러
    if col["student_id"] is None or col["name"] is None:
        raise ValueError("❌ Excel 파일에서 필수 컬럼('학번', '이름')을 찾을 수 없습니다.")

    students = {}
    class_scores = {}

    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, values_only=True):
        if len(row) <= col["student_id"]:
            continue
            
        sid = row[col["student_id"]]
        if sid is None:
            continue

        try:
            # 학번이 숫자가 아닌 경우 건너뛰기
            sid = int(float(str(sid).strip()))
        except (ValueError, TypeError):
            continue

        class_num = 1
        if col["class_num"] is not None and col["class_num"] < len(row) and row[col["class_num"]] is not None:
            try:
                class_num = int(float(str(row[col["class_num"]]).strip()))
            except ValueError:
                class_num = 1

        phone_val = row[col["phone"]] if col["phone"] is not None and col["phone"] < len(row) else ""
        phone_last4 = extract_phone_last4(phone_val)

        # 해시 키 생성
        hash_key = make_hash_key(sid, phone_last4)

        def get_val(key, default=None):
            idx = col[key]
            if idx is not None and idx < len(row):
                return row[idx]
            return default

        quiz = safe_float(get_val("quiz_score"))
        attendance = safe_float(get_val("attendance"))
        midterm = safe_float(get_val("midterm"))
        final = safe_float(get_val("final"))
        total = safe_float(get_val("total"))
        rank_val = get_val("rank")
        grade = get_val("grade") or ""
        
        absences_val = get_val("absences", 0)
        try:
            absences = int(float(str(absences_val).strip())) if absences_val is not None else 0
        except ValueError:
            absences = 0
            
        remark = get_val("remark") or ""
        dept = get_val("department") or ""
        student_name = get_val("name") or ""

        students[hash_key] = {
            "department": dept,
            "class_num": class_num,
            "student_id_masked": mask_student_id(sid),
            "name_masked": mask_name(student_name),
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
        if st["rank"] is not None and str(st["rank"]).strip() not in ["", "-"]:
            r_str = str(st["rank"]).split("/")[0].strip()
            st["rank"] = f"{r_str} / {count}"
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
    # 기존 data.json에서 gas_url을 읽어오거나 config.json에서 불러오기
    import os
    gas_url = ""
    try:
        if os.path.exists(OUTPUT_FILE):
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                gas_url = old_data.get("gas_url", "")
    except Exception:
        pass

    try:
        if os.path.exists("config.json"):
            with open("config.json", "r", encoding="utf-8") as f:
                cfg = json.load(f)
                if cfg.get("gas_url"):
                    gas_url = cfg.get("gas_url")
    except Exception:
        pass

    # JSON 출력
    output = {
        "course": {
            "year": "2026",
            "semester": "1학기",
            "name": "경영정보시스템"
        },
        "professor": {
            "name": "서창갑",
            "email": "armour@tu.ac.kr"
        },
        "gas_url": gas_url,
        "students": students,
        "class_avg": class_averages,
        "class_max": class_maxes,
        "class_counts": class_counts,
    }
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    wb.close()
    print(f"[build_data] {len(students)}명 데이터 -> {OUTPUT_FILE} 생성 완료")
    print(f"   분반: {len(class_averages)}개, 파일크기: {os.path.getsize(OUTPUT_FILE):,} bytes")
    print(f"   키 방식: SHA-256(학번|전화번호뒷4자리)")


if __name__ == "__main__":
    build()
