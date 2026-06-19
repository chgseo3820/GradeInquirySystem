# -*- coding: utf-8 -*-
"""
ScoreQuery — 성적 조회 시스템 백엔드 (Flask 개발/로컬 운영용)

학생 본인 성적 조회 API와, 운영자가 GitHub Pages 배포 데이터를
암호화 저장(`docs/data.enc.json`)할 수 있도록 도와주는 관리자 API를 제공합니다.

⚠️ 보안 주의
  - 본 서버는 **로컬 운영자 PC에서만 동작**시키는 것을 전제로 합니다.
    외부 네트워크에 노출하지 마십시오. 기본 바인딩은 `127.0.0.1` 입니다.
  - `/api/save_*` 관리자 엔드포인트는 `SCOREQUERY_ADMIN_TOKEN` 환경변수에
    설정된 토큰을 `X-Admin-Token` 헤더 또는 요청 본문에 함께 보낼 때만
    동작합니다. (관리자 PC에서 자기 자신만 호출하므로 정적 토큰으로 충분)
  - `/api/score`는 단순 IP 기반 in-memory rate limiting을 적용해
    학번 무차별 대입을 완화합니다.
"""

import os
import re
import json
import time
import hmac
from collections import defaultdict, deque

from flask import Flask, render_template, request, jsonify, send_from_directory, redirect
import openpyxl

from scorequery_crypto import (
    PASSPHRASE_ENV,
    EncryptionConfigError,
    get_env_passphrase,
    write_encrypted_json,
)


# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
ADMIN_TOKEN_ENV = "SCOREQUERY_ADMIN_TOKEN"

# Flask 기본 바인딩 (로컬 운영자 PC 전용). 외부 노출이 필요하면 환경변수로 override.
DEFAULT_HOST = os.environ.get("SCOREQUERY_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.environ.get("SCOREQUERY_PORT", "5000"))

# CORS 허용 출처 (콤마 구분). 빈 값/미설정 시 동일 출처(=헤더 미부착)만 허용.
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("SCOREQUERY_ALLOWED_ORIGINS", "").split(",") if o.strip()
]

# 학번 입력 길이 상한 (Excel 학번이 8~10자리이므로 보수적으로 12까지만 허용)
MAX_STUDENT_ID_LEN = 12

# 단순 in-memory rate limit: 60초 윈도우에 IP당 최대 N회 시도
RATE_WINDOW_SEC = 60
RATE_MAX_PER_WINDOW = 30
_rate_buckets: dict[str, deque] = defaultdict(deque)


app = Flask(__name__)
ENCRYPTED_DATA_FILE = os.path.join("docs", "data.enc.json")
PLAINTEXT_DATA_FILE = os.path.join("docs", "data.json")
PUBLIC_CONFIG_FILE = os.path.join("docs", "public-config.json")


# ──────────────────────────────────────────────
# Excel 데이터 로드 및 전처리
# ──────────────────────────────────────────────
EXCEL_FILE = os.environ.get("SCOREQUERY_EXCEL", "2026-1학기_경영정보론_서창갑.xlsx")

students: dict[int, dict] = {}      # {student_id: row_dict}
class_averages: dict[int, dict] = {}
class_maxes: dict[int, dict] = {}
class_counts: dict[int, int] = {}


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


def find_header_idx(headers, keywords, exclude_keywords=None):
    """헤더 행에서 키워드 기반 컬럼 인덱스 탐색"""
    for idx, h in enumerate(headers):
        if any(kw in h for kw in keywords):
            if exclude_keywords and any(ex in h for ex in exclude_keywords):
                continue
            return idx
    return None


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

    col = {
        "department": find_header_idx(headers, ["학과", "학부", "전공"]),
        "class_num":  find_header_idx(headers, ["분반", "반"]),
        "student_id": find_header_idx(headers, ["학번"]),
        "name":       find_header_idx(headers, ["이름", "성명"]),
        "phone":      find_header_idx(headers, ["전화", "핸드폰", "연락처", "휴대폰"]),
        "quiz_score": find_header_idx(headers, ["퀴즈"]),
        "attendance": find_header_idx(headers, ["출석"]),
        "midterm":    find_header_idx(headers, ["중간"]),
        "final":      find_header_idx(headers, ["기말"]),
        "total":      find_header_idx(headers, ["총점", "성적"]),
        "rank":       find_header_idx(headers, ["석차", "순위", "등수"], exclude_keywords=["결석"]),
        "grade":      find_header_idx(headers, ["학점", "평점", "등급"]),
        "absences":   find_header_idx(headers, ["결석", "결석횟수", "결석차시"]),
        "remark":     find_header_idx(headers, ["비고"]),
    }

    # 필수 컬럼(학번, 이름)이 감지되지 않으면 에러
    if col["student_id"] is None or col["name"] is None:
        raise ValueError("❌ Excel 파일에서 필수 컬럼('학번', '이름')을 찾을 수 없습니다.")

    # 분반별 점수 집계용
    class_scores = {}  # {class_num: {field: [values]}}

    new_students: dict[int, dict] = {}

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

        new_students[sid] = student

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
    new_class_averages, new_class_maxes, new_class_counts = {}, {}, {}
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
        new_class_averages[cn] = avg
        new_class_maxes[cn] = mx
        new_class_counts[cn] = sum(1 for s in new_students.values() if s["class_num"] == cn)

    # 전체를 한 번에 교체 (부분 로드 상태 방지)
    students = new_students
    class_averages = new_class_averages
    class_maxes = new_class_maxes
    class_counts = new_class_counts

    wb.close()
    print(f"[ScoreQuery] {len(students)}명 학생 데이터 로드 완료 (분반 {len(class_averages)}개)")


# ──────────────────────────────────────────────
# CORS (제한적 화이트리스트)
# ──────────────────────────────────────────────
@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    if origin and origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Admin-Token"
        response.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    return response


# ──────────────────────────────────────────────
# 관리자 인증 & rate limit 유틸
# ──────────────────────────────────────────────
def _get_admin_token() -> str | None:
    return os.environ.get(ADMIN_TOKEN_ENV) or None


def _require_admin() -> tuple[bool, str | None]:
    """관리자 토큰 검증. (ok, error_message)"""
    expected = _get_admin_token()
    if not expected:
        return False, (
            f"{ADMIN_TOKEN_ENV} 환경변수가 설정되어 있지 않아 관리자 API가 비활성화되었습니다."
        )

    provided = request.headers.get("X-Admin-Token", "")
    if not provided:
        body = request.get_json(silent=True) or {}
        provided = body.get("admin_token", "")

    if not provided or not hmac.compare_digest(str(provided), str(expected)):
        return False, "관리자 토큰이 올바르지 않습니다."

    return True, None


def _client_ip() -> str:
    # Flask dev server 환경에서 단순히 remote_addr 사용 (역방향 프록시 사용 안 함 전제)
    return request.remote_addr or "unknown"


def _rate_limited(key: str) -> bool:
    now = time.monotonic()
    bucket = _rate_buckets[key]
    while bucket and now - bucket[0] > RATE_WINDOW_SEC:
        bucket.popleft()
    if len(bucket) >= RATE_MAX_PER_WINDOW:
        return True
    bucket.append(now)
    return False


# ──────────────────────────────────────────────
# 관리자 API: 암호화 저장
# ──────────────────────────────────────────────
@app.route("/api/save_data", methods=["POST", "OPTIONS"])
def save_data():
    if request.method == "OPTIONS":
        return "", 204

    ok, err = _require_admin()
    if not ok:
        return jsonify({"error": err}), 401

    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "올바르지 않은 데이터 형식입니다."}), 400

        # admin_token 은 페이로드에서 제거하여 저장
        if isinstance(data, dict) and "admin_token" in data:
            data = {k: v for k, v in data.items() if k != "admin_token"}

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

    ok, err = _require_admin()
    if not ok:
        return jsonify({"error": err}), 401

    try:
        data = request.get_json(silent=True) or {}
        gas_url = str(data.get("gas_url", "")).strip()

        # 매우 가벼운 검증: https URL만 허용
        if gas_url and not gas_url.startswith("https://"):
            return jsonify({"error": "gas_url은 https:// 로 시작해야 합니다."}), 400

        config_data = {"gas_url": gas_url}
        os.makedirs(os.path.dirname(PUBLIC_CONFIG_FILE), exist_ok=True)
        with open(PUBLIC_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config_data, f, ensure_ascii=False, indent=2)

        print(f"[ScoreQuery] public-config.json saved with gas_url: {gas_url}")
        return jsonify({
            "success": True,
            "message": "자동 메일 발송 설정(public-config.json)이 저장되었습니다.",
            "path": PUBLIC_CONFIG_FILE,
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


@app.route("/docs/<path:filename>")
def serve_docs(filename):
    return send_from_directory("docs", filename)


@app.route("/docs/")
@app.route("/docs")
def serve_docs_index():
    return send_from_directory("docs", "index.html")


@app.route("/admin")
def admin_redirect():
    return redirect("/docs/")


@app.route("/api/score", methods=["POST"])
def get_score():
    """
    학생 성적 조회 API
    요청: { "student_id": "20220034", "phone_last4": "5169" }
    """
    # 1) Rate limit (IP 기준)
    if _rate_limited(_client_ip()):
        return jsonify({
            "error": "잠시 후 다시 시도해 주세요. (요청 횟수 제한)",
        }), 429

    # 2) 입력 검증
    data = request.get_json(silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({"error": "요청 데이터가 올바르지 않습니다."}), 400

    raw_id = str(data.get("student_id", "")).strip()
    phone_last4 = str(data.get("phone_last4", "")).strip()

    if not raw_id or not phone_last4:
        return jsonify({"error": "학번과 전화번호 뒷자리를 모두 입력해 주세요."}), 400

    if len(raw_id) > MAX_STUDENT_ID_LEN or not raw_id.isdigit():
        return jsonify({"error": "학번은 숫자만 입력 가능합니다."}), 400

    if not phone_last4.isdigit() or len(phone_last4) != 4:
        return jsonify({"error": "전화번호 뒷자리 4자리를 정확히 입력해 주세요."}), 400

    sid = int(raw_id)
    student = students.get(sid)

    # 3) 학번/전화번호 검증을 한 묶음으로 처리 (계정 열거 방지)
    if not student or not hmac.compare_digest(student["phone_last4"], phone_last4):
        return jsonify({
            "error": "일치하는 정보를 찾을 수 없습니다.\n학번과 전화번호를 다시 확인해 주세요."
        }), 404

    # 분반 정보
    cn = student["class_num"]
    avg = class_averages.get(cn, {})
    mx = class_maxes.get(cn, {})
    count = class_counts.get(cn, 0)

    # 석차 포맷
    rank_val = student["rank"]
    rank_str = f"{rank_val} / {count}" if rank_val is not None else "- / -"

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
        "class_avg": {k: avg.get(k) for k in
                      ("quiz_score", "attendance_score", "midterm_score", "final_score", "total_score")},
        "class_max": {k: mx.get(k) for k in
                      ("quiz_score", "attendance_score", "midterm_score", "final_score", "total_score")},
        "class_count": count,
    }

    return jsonify(response)


# ──────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────
if __name__ == "__main__":
    try:
        load_excel()
    except Exception as e:
        print(f"[Warning] Excel file load failed: {e}")
        print("Starting server without pre-loaded Excel data.")

    if not _get_admin_token():
        print(
            f"[ScoreQuery] ⚠️  {ADMIN_TOKEN_ENV} 환경변수가 설정되지 않아 "
            "관리자 API(/api/save_data, /api/save_public_config)는 비활성화됩니다."
        )

    if DEFAULT_HOST not in ("127.0.0.1", "localhost"):
        print(
            f"[ScoreQuery] ⚠️  외부 접근 가능한 호스트({DEFAULT_HOST})로 바인딩합니다. "
            f"방화벽/HTTPS/관리자 토큰 보호를 반드시 적용하세요."
        )

    app.run(host=DEFAULT_HOST, port=DEFAULT_PORT, debug=False)
