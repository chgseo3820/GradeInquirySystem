# -*- coding: utf-8 -*-
"""
ScoreQuery — 성적 조회 시스템 백엔드
2026-1학기 MIS 과목 성적 마감 후 학생 개인 성적 조회 API
"""

import math
import re
from flask import Flask, render_template, request, jsonify
import openpyxl

app = Flask(__name__)

# ──────────────────────────────────────────────
# Excel 데이터 로드 및 전처리
# ──────────────────────────────────────────────
EXCEL_FILE = "2026-1_MIS_Score.xlsx"

# 컬럼 인덱스 (0-based)
COL = {
    "department": 0,
    "class_num": 1,
    "student_id": 2,
    "name": 3,
    "phone": 4,
    "email": 5,
    "quiz_score": 63,      # 퀴즈점수(30)
    "attendance": 64,       # 출석점수(30)
    "midterm": 65,          # 중간고사(20)
    "final": 66,            # 기말고사(20)
    "total": 67,            # 총점(100)
    "rank": 68,             # 석차(분반)
    "grade": 69,            # 평점
    "absences": 70,         # 결석수
    "remark": 71,           # 비고
}

students = {}           # {student_id: row_dict}
class_averages = {}     # {class_num: {quiz, attendance, midterm, final, total}}
class_maxes = {}        # {class_num: {quiz, attendance, midterm, final, total}}
class_counts = {}       # {class_num: int}


def safe_float(v):
    """셀 값을 float로 안전 변환 (None, 수식문자열 대응)"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    try:
        return round(float(v), 2)
    except (ValueError, TypeError):
        return None


def mask_name(name: str) -> str:
    """이름 마스킹: 첫 글자만 표시, 나머지 '*'"""
    if not name:
        return ""
    return name[0] + "*" * (len(name) - 1)


def mask_student_id(sid) -> str:
    """학번 마스킹: 앞 4자리 표시, 나머지 '****'"""
    s = str(sid)
    if len(s) <= 4:
        return s
    return s[:4] + "*" * (len(s) - 4)


def extract_phone_last4(phone: str) -> str:
    """전화번호에서 숫자만 추출 후 마지막 4자리 반환"""
    if not phone:
        return ""
    digits = re.sub(r"[^0-9]", "", str(phone))
    return digits[-4:] if len(digits) >= 4 else digits


def load_excel():
    """서버 시작 시 Excel 파일을 로드하여 메모리에 캐싱"""
    global students, class_averages, class_counts

    wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)
    ws = wb.active

    # 분반별 점수 집계용
    class_scores = {}  # {class_num: {field: [values]}}

    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, values_only=True):
        sid = row[COL["student_id"]]
        if sid is None:
            continue

        sid = int(sid)
        class_num = int(row[COL["class_num"]]) if row[COL["class_num"]] else 0

        student = {
            "department": row[COL["department"]] or "",
            "class_num": class_num,
            "student_id": sid,
            "name": row[COL["name"]] or "",
            "phone_last4": extract_phone_last4(row[COL["phone"]]),
            "quiz_score": safe_float(row[COL["quiz_score"]]),
            "attendance_score": safe_float(row[COL["attendance"]]),
            "midterm_score": safe_float(row[COL["midterm"]]),
            "final_score": safe_float(row[COL["final"]]),
            "total_score": safe_float(row[COL["total"]]),
            "rank": row[COL["rank"]],
            "grade": row[COL["grade"]] or "",
            "absences": int(row[COL["absences"]]) if row[COL["absences"]] is not None else 0,
            "remark": row[COL["remark"]] or "",
        }

        students[sid] = student

        # 분반별 점수 집계
        if class_num not in class_scores:
            class_scores[class_num] = {
                "quiz_score": [],
                "attendance_score": [],
                "midterm_score": [],
                "final_score": [],
                "total_score": [],
            }

        for field in class_scores[class_num]:
            val = student[field]
            if val is not None:
                class_scores[class_num][field].append(val)

    # 분반별 평균·최고 계산
    for cn, scores in class_scores.items():
        avg = {}
        mx = {}
        for field, vals in scores.items():
            if vals:
                avg[field] = round(sum(vals) / len(vals), 2)
                mx[field] = round(max(vals), 2)
            else:
                avg[field] = None
                mx[field] = None
        class_averages[cn] = avg
        class_maxes[cn] = mx
        class_counts[cn] = len([
            s for s in students.values() if s["class_num"] == cn
        ])

    wb.close()
    print(f"[ScoreQuery] {len(students)}명 학생 데이터 로드 완료 (분반 {len(class_averages)}개)")


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────
@app.route("/")
def index():
    """메인 페이지 서빙"""
    return render_template("index.html")


@app.route("/api/score", methods=["POST"])
def get_score():
    """
    학생 성적 조회 API
    요청: { "student_id": "20220034", "phone_last4": "5169" }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "요청 데이터가 올바르지 않습니다."}), 400

    raw_id = data.get("student_id", "").strip()
    phone_last4 = data.get("phone_last4", "").strip()

    # 입력값 검증
    if not raw_id or not phone_last4:
        return jsonify({"error": "학번과 전화번호 뒷자리를 모두 입력해 주세요."}), 400

    if not raw_id.isdigit():
        return jsonify({"error": "학번은 숫자만 입력 가능합니다."}), 400

    if not phone_last4.isdigit() or len(phone_last4) != 4:
        return jsonify({"error": "전화번호 뒷자리 4자리를 정확히 입력해 주세요."}), 400

    sid = int(raw_id)

    # 학번 존재 확인
    student = students.get(sid)
    if not student:
        return jsonify({"error": "일치하는 정보를 찾을 수 없습니다.\n학번과 전화번호를 다시 확인해 주세요."}), 404

    # 전화번호 뒷자리 확인
    if student["phone_last4"] != phone_last4:
        return jsonify({"error": "일치하는 정보를 찾을 수 없습니다.\n학번과 전화번호를 다시 확인해 주세요."}), 404

    # 분반 정보
    cn = student["class_num"]
    avg = class_averages.get(cn, {})
    mx = class_maxes.get(cn, {})
    count = class_counts.get(cn, 0)

    # 석차 포맷
    rank_val = student["rank"]
    if rank_val is not None:
        rank_str = f"{rank_val} / {count}"
    else:
        rank_str = "- / -"

    # 응답 구성 (개인정보 제외)
    response = {
        "student": {
            "department": student["department"],
            "class_num": cn,
            "student_id_masked": mask_student_id(sid),
            "name_masked": mask_name(student["name"]),
            "quiz_score": student["quiz_score"],
            "attendance_score": student["attendance_score"],
            "midterm_score": student["midterm_score"],
            "final_score": student["final_score"],
            "total_score": student["total_score"],
            "rank": rank_str,
            "grade": student["grade"],
            "absences": student["absences"],
            "remark": student["remark"],
        },
        "class_avg": {
            "quiz_score": avg.get("quiz_score"),
            "attendance_score": avg.get("attendance_score"),
            "midterm_score": avg.get("midterm_score"),
            "final_score": avg.get("final_score"),
            "total_score": avg.get("total_score"),
        },
        "class_max": {
            "quiz_score": mx.get("quiz_score"),
            "attendance_score": mx.get("attendance_score"),
            "midterm_score": mx.get("midterm_score"),
            "final_score": mx.get("final_score"),
            "total_score": mx.get("total_score"),
        },
        "class_count": count,
    }

    return jsonify(response)


# ──────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────
if __name__ == "__main__":
    load_excel()
    app.run(host="0.0.0.0", port=5000, debug=False)
