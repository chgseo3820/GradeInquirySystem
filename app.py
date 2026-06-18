# -*- coding: utf-8 -*-
"""
ScoreQuery — 성적 조회 시스템 백엔드
2026-1학기 MIS 과목 성적 마감 후 학생 개인 성적 조회 API
"""

import math
import re
import os
import json
from flask import Flask, render_template, request, jsonify
import openpyxl

from scorequery_crypto import (
    PASSPHRASE_ENV,
    EncryptionConfigError,
    get_env_passphrase,
    write_encrypted_json,
)

app = Flask(__name__)
ENCRYPTED_DATA_FILE = os.path.join("docs", "data.enc.json")
PLAINTEXT_DATA_FILE = os.path.join("docs", "data.json")

# ──────────────────────────────────────────────
# Excel 데이터 로드 및 전처리
# ──────────────────────────────────────────────
EXCEL_FILE = "2026-1학기_경영정보론_서창갑.xlsx"

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
    global students, class_averages, class_maxes, class_counts

    wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)
    
    # 1. 사용할 시트 결정 (최종성적 -> 총괄 -> 첫 번째 시트 순)
    sheet_name = None
    for name in ["최종성적", "총괄"]:
        if name in wb.sheetnames:
            sheet_name = name
            break
    ws = wb[sheet_name] if sheet_name else wb.active
    print(f"[ScoreQuery] 시트 '{ws.title}'에서 데이터를 로드합니다.")

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

    # 분반별 점수 집계용
    class_scores = {}  # {class_num: {field: [values]}}

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

        student = {
            "department": dept,
            "class_num": class_num,
            "student_id": sid,
            "name": student_name,
            "phone_last4": phone_last4,
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
            student_field = field if "score" in field else f"{field}_score"
            val = student[student_field]
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
# CORS & Auto-save APIs
# ──────────────────────────────────────────────
@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    return response

@app.route("/api/save_data", methods=["POST", "OPTIONS"])
def save_data():
    if request.method == "OPTIONS":
        return "", 204
        
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "올바르지 않은 데이터 형식입니다."}), 400

        passphrase = get_env_passphrase()
        if not passphrase:
            raise EncryptionConfigError(
                f"{PASSPHRASE_ENV} 환경변수를 설정해야 암호화 저장을 할 수 있습니다."
            )

        write_encrypted_json(ENCRYPTED_DATA_FILE, data, passphrase)
        if os.path.exists(PLAINTEXT_DATA_FILE):
            os.remove(PLAINTEXT_DATA_FILE)

        print(f"[ScoreQuery] encrypted data saved ({os.path.getsize(ENCRYPTED_DATA_FILE)} bytes)")
        return jsonify({
            "success": True,
            "message": "성적 데이터가 AES-256-GCM으로 암호화되어 저장되었습니다.",
            "path": ENCRYPTED_DATA_FILE,
        })
    except EncryptionConfigError as e:
        print(f"[ScoreQuery] encryption configuration error: {e}")
        return jsonify({
            "error": str(e),
            "encryption_required": True,
            "env": PASSPHRASE_ENV,
        }), 500
    except Exception as e:
        print(f"❌ 데이터 저장 중 오류 발생: {e}")
        return jsonify({"error": f"데이터 저장 실패: {str(e)}"}), 500


@app.route("/api/save_public_config", methods=["POST", "OPTIONS"])
def save_public_config():
    if request.method == "OPTIONS":
        return "", 204
    try:
        data = request.get_json(silent=True) or {}
        gas_url = data.get("gas_url", "").strip()
        
        config_path = os.path.join("docs", "public-config.json")
        config_data = {"gas_url": gas_url}
        
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, ensure_ascii=False, indent=2)
            
        print(f"[ScoreQuery] public-config.json saved with gas_url: {gas_url}")
        return jsonify({
            "success": True,
            "message": "자동 메일 발송 설정(public-config.json)이 저장되었습니다.",
            "path": config_path
        })
    except Exception as e:
        print(f"❌ 설정 저장 중 오류 발생: {e}")
        return jsonify({"error": f"설정 저장 실패: {str(e)}"}), 500


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
