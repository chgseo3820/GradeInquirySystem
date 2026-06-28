# ScoreQuery 운영 가이드

## 설정 파일

- `config.json`은 로컬 전용 파일입니다. 실제 GAS Web App URL처럼 배포 환경마다 달라지는 값은 이 파일에 둡니다.
- GitHub에는 `config.json`을 올리지 않습니다. 대신 `config.example.json`을 참고해 로컬에서만 생성합니다.
- `config.json`을 보관해야 하면 `python secure_files.py encrypt config.json --delete-plain`으로 `config.enc.json`을 만들고 평문을 제거합니다.

## 환경 변수

| 변수 | 용도 | 필수 |
|---|---|---|
| `SCOREQUERY_ACCESS_CODE` | 학생 조회용 6자리 접속 비밀번호 | `/api/score` 운영 시 필수 |
| `SCOREQUERY_DATA_PASSPHRASE` | `docs/data.enc.json` 암호화/복호화 패스프레이즈 | 빌드/저장 시 필수 |
| `SCOREQUERY_ADMIN_TOKEN` | Flask 관리자 API 토큰 | 관리자 API 사용 시 필수 |
| `SCOREQUERY_SECRET_KEY` | 서버 세션 서명 키 | 운영 시 필수 |
| `SCOREQUERY_REQUIRE_HTTPS` | HTTPS가 아닌 요청 차단 (`1`/`true`) | 운영 시 권장 |
| `SCOREQUERY_TRUST_PROXY` | 리버스 프록시의 `X-Forwarded-*` 헤더 신뢰 | 프록시 운영 시 필수 |
| `SCOREQUERY_SESSION_COOKIE_SECURE` | 세션 쿠키 Secure 속성 (`SCOREQUERY_REQUIRE_HTTPS` 기본값 연동) | 선택 |
| `SCOREQUERY_SESSION_COOKIE_SAMESITE` | 세션 쿠키 SameSite (`None`/`Lax`) | 교차 출처 운영 시 `None` 권장 |
| `SCOREQUERY_PASSWORD_HASH` | `argon2`, `bcrypt`, `werkzeug` 중 선택 | 선택 |
| `SCOREQUERY_AUTH_DB` | 서버 교수 인증 DB 경로 | 선택 |
| `SCOREQUERY_VIEW_LOG_FILE` | 학생 조회 로그 JSONL 경로 | 선택 |
| `SCOREQUERY_LOG_SALT` | 조회 로그 해시용 별도 salt | 운영 시 권장 |
| `SCOREQUERY_HOST` | Flask 바인딩 호스트 (기본 `127.0.0.1`) | 선택 |
| `SCOREQUERY_PORT` | Flask 포트 (기본 `5000`) | 선택 |
| `SCOREQUERY_ALLOWED_ORIGINS` | CORS 화이트리스트 (콤마 구분) | 선택 |
| `SCOREQUERY_EXCEL` | 입력 Excel 파일 경로 | 선택 |

## 배포 데이터

- GitHub Pages 배포본은 `docs/` 폴더입니다.
- 현재 기본 배포 흐름은 `main` 브랜치의 `/docs` 폴더를 Pages source로 사용하는 방식입니다.
- `deploy.bat`는 `gh-pages` 브랜치 루트 배포가 필요할 때만 사용합니다. **두 방식을 동시에 사용하지 말고 하나만 운영 기준으로 정해 사용하세요.**
- 교수/학생 정보가 들어 있는 성적 데이터는 평문 `data.json`으로 배포하지 않습니다.
- 로컬 저장이 필요한 경우 `SCOREQUERY_DATA_PASSPHRASE` 환경변수를 설정한 뒤 암호화된 `docs/data.enc.json`만 생성합니다.
- 공개 학생 조회는 `docs/public-config.json`의 `api_url`을 통해 서버 API로 처리합니다.
- `api_url`은 운영 배포에서는 HTTPS 주소여야 하며, 로컬 개발 주소는 `http://127.0.0.1` 또는 `http://localhost`만 허용됩니다.

## GitHub Pages 설정

1. GitHub 저장소 페이지로 이동합니다.
2. **Settings → Pages** 메뉴로 이동합니다.
3. **Build and deployment**에서 source를 다음과 같이 지정합니다.
   - 권장: `Deploy from a branch`, Branch: `main`, Folder: `/docs`
   - (대안) `deploy.bat`를 사용해 `gh-pages` 브랜치 루트 배포로 운영하는 경우: Branch `gh-pages`, Folder: `/ (root)`
4. **Save**를 눌러 저장하면 자동으로 배포가 시작됩니다.

## 성적 공시 전 확인

1. 교수자 모드에서 과목을 선택합니다.
2. 평가 기준 합계가 100%인지 확인합니다.
3. Excel 업로드 후 파일 검증 보고서를 확인합니다.
4. 총점 불일치, 점수 결측, 인증정보 누락 항목을 확인합니다.
5. 공시 기간을 설정하고 최종 확인 창에서 학생 수와 검증 경고를 확인한 뒤 공시합니다.

## 상대평가 제외 처리

상대평가 제외 사유는 아래 항목을 모두 합쳐 반영합니다.

- `상대평가제외사유` 컬럼
- `가산메모` 컬럼
- `비고` 컬럼에 포함된 `상대평가제외` 문구

따라서 `가산메모`에 내용이 있는 학생은 상대평가 배분 대상에서 제외되고, 최종 조정 표에는 통합 사유가 표시됩니다.

## 개인정보 주의

- Excel 원본은 학번, 전화번호 등 개인정보를 포함하므로 GitHub에 올리지 않습니다.
- 성적 데이터 파일은 AES-256-GCM + PBKDF2-HMAC-SHA256 방식으로 암호화합니다.
- 암호화 파일도 공개 GitHub 저장소에는 올리지 않습니다. 암호화는 로컬 PC, 백업, 이동식 저장장치 유출에 대비한 추가 보호장치입니다.
- 정적 GitHub Pages 구조에서는 클라이언트 검증 한계가 있으므로, 고위험 운영에서는 서버/API 기반 조회 검증으로 전환하는 것을 권장합니다.

## 암호화 절차

PowerShell 예시:

```powershell
$env:SCOREQUERY_DATA_PASSPHRASE = "긴-임의-비밀번호를-여기에-입력"
$env:SCOREQUERY_ADMIN_TOKEN     = "관리자-API-호출용-임의-토큰"
python build_data.py
python secure_files.py scan
```

민감 파일을 직접 암호화할 때:

```powershell
python secure_files.py encrypt config.json docs/data.json "*.xlsx" --delete-plain
```

복호화가 필요한 경우:

```powershell
python secure_files.py decrypt docs/data.enc.json --output-dir restored
```

## Flask 로컬 서버 보안

- 기본 바인딩은 `127.0.0.1`로 외부 네트워크에서 접근할 수 없습니다.
- `/api/save_data`, `/api/save_public_config`는 `SCOREQUERY_ADMIN_TOKEN` 헤더(`X-Admin-Token`) 또는 요청 본문의 `admin_token` 필드가 일치할 때만 동작합니다.
- `/api/score`는 `SCOREQUERY_ACCESS_CODE` 또는 `config.json`의 `access_code`가 없으면 조회를 거부합니다.
- `/api/score`는 IP당 60초에 30회로 요청 빈도가 제한되어 학번 무차별 대입을 완화합니다.
- 다른 PC에서 접근이 필요하면 `SCOREQUERY_HOST`, `SCOREQUERY_ALLOWED_ORIGINS` 환경변수를 명시적으로 설정하고, 방화벽/HTTPS를 별도로 적용하세요.

## 운영 WSGI/HTTPS 배포

운영 환경에서는 `python app.py` 개발 서버를 인터넷에 직접 공개하지 않습니다. `wsgi:application`을 WSGI 서버로 실행하고 HTTPS 리버스 프록시 뒤에 둡니다.

```powershell
$env:SCOREQUERY_SECRET_KEY = "긴-임의-세션-키"
$env:SCOREQUERY_REQUIRE_HTTPS = "1"
$env:SCOREQUERY_TRUST_PROXY = "1"
$env:SCOREQUERY_SESSION_COOKIE_SAMESITE = "None"
$env:SCOREQUERY_ALLOWED_ORIGINS = "https://your-pages.example.com"
gunicorn wsgi:application
```

Windows 서버에서는 동일한 WSGI 객체를 Waitress 등으로 실행할 수 있습니다. 프록시가 TLS를 종료한다면 `X-Forwarded-Proto`가 전달되도록 설정해야 합니다. GitHub Pages와 API 도메인이 다르면 `SCOREQUERY_SESSION_COOKIE_SAMESITE=None`과 `SCOREQUERY_ALLOWED_ORIGINS`를 함께 설정해야 서버 세션 쿠키가 교차 출처 요청에 포함됩니다.

초기 서버 마스터 계정은 관리자 토큰으로 한 번 생성합니다.

```powershell
curl -X POST http://127.0.0.1:5000/api/auth/bootstrap `
  -H "Content-Type: application/json" `
  -H "X-Admin-Token: $env:SCOREQUERY_ADMIN_TOKEN" `
  -d "{\"email\":\"master@example.edu\",\"password\":\"StrongPass!234\",\"name\":\"Master\"}"
```

## 서버 세션 인증 API

- `/api/auth/bootstrap`은 `SCOREQUERY_ADMIN_TOKEN`으로 첫 마스터 계정을 생성합니다.
- `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/auth/change_password`, `/api/auth/withdraw`는 교수 계정 신청, 로그인, 세션 확인, 로그아웃, 비밀번호 변경, 본인 탈퇴에 사용합니다.
- `/api/auth/users`, `/api/auth/set_status`는 마스터 세션 또는 관리자 토큰이 있을 때만 교수 계정 목록과 승인 상태를 관리합니다.
- `/api/auth/reset_password`는 마스터 세션 또는 관리자 토큰으로 임시 비밀번호를 서버 해시로 재설정합니다.
- 비밀번호는 기본적으로 Argon2 해시로 저장되며, 설치 환경에 따라 bcrypt 또는 Werkzeug 해시로 안전하게 대체됩니다.
- 서버 인증 DB 기본 경로는 `instance/professors.json`이며, `instance/`는 Git 추적에서 제외됩니다.

## 서버 조회 로그

- `/api/score` 조회가 성공하면 학생 식별자, IP, User-Agent를 원문으로 저장하지 않고 해시 처리해 JSONL 로그에 남깁니다.
- 로그 기본 경로는 `instance/view_logs.jsonl`이며, 운영 환경에서는 `SCOREQUERY_LOG_SALT`를 별도로 설정하는 것을 권장합니다.
- `/api/view_stats?course_id=...`는 `SCOREQUERY_ADMIN_TOKEN`이 있을 때 전체 수강생 대비 열람/미열람 집계를 반환합니다.
- 교수자 화면의 열람률 위젯은 서버 로그가 연결되면 서버 기준 값을 우선 표시하고, 연결되지 않은 경우에만 브라우저 로컬 기록을 참고값으로 표시합니다.

## 셀프 비밀번호 재설정 (Forgot Password)

회원이 비밀번호를 잊은 경우, 마스터에게 따로 요청하지 않아도 본인 이메일로 인증 코드를 받아 직접 재설정할 수 있습니다.

흐름:

1. 로그인 카드의 **🔑 비밀번호를 잊으셨나요?** 링크 클릭
2. 가입 이메일 입력 → **인증 코드 받기** 클릭
3. 메일로 받은 **6자리 코드(10분 유효)** + 새 비밀번호 입력
4. **새 비밀번호로 재설정** → 로그인 화면으로 자동 복귀, 새 비밀번호로 로그인

보안 설계:

- 인증 코드는 시트에 **SHA-256 해시로만** 저장되며 평문 보관되지 않습니다.
- 코드는 **10분** 동안만 유효하며, 1회 사용 즉시 폐기됩니다.
- 동일 이메일에 대한 재발급 요청은 **60초** 동안 throttle 됩니다.
- **계정 존재 여부에 관계없이 동일한 응답**을 반환해 계정 열거(account enumeration)를 방지합니다.
- `approved` 상태의 회원에게만 실제 메일이 발송됩니다 (pending/rejected/deleted는 위장 응답).
- 비밀번호 변경이 완료되면 **변경 알림 메일**이 별도로 발송됩니다.

⚠️ **GAS 배포 필수**: 이 기능은 메일 발송과 토큰 저장을 모두 GAS(Google Apps Script) 측에서 수행하므로, 마스터가 [구글 시트 + GAS 웹앱](#GAS-재배포-안내)을 운영하고 있어야 동작합니다. GAS URL이 설정되지 않은 환경에서는 사용자에게 "마스터에게 문의" 안내가 표시됩니다.

## GAS 재배포 안내

이 코드는 `docs/static/gas_db_script.js`의 GAS 백엔드에 **새로운 액션 2개**(`request_pw_reset`, `confirm_pw_reset`)와 **Users 시트 컬럼 2개**(`resetTokenHash`, `resetTokenExp`)를 추가합니다. 또한 기본 마스터 계정을 더 이상 자동 생성하지 않습니다.

최초 배포 전 Apps Script의 Script Properties에 아래 값을 먼저 설정하세요.

- `SCOREQUERY_MASTER_EMAIL`
- `SCOREQUERY_MASTER_PW_HASH`
- 선택: `SCOREQUERY_MASTER_NAME`, `SCOREQUERY_MASTER_UNIV`, `SCOREQUERY_MASTER_DEPT`, `SCOREQUERY_MASTER_PHONE`

마스터 비밀번호 해시 생성 예시:

```powershell
python -c "import hashlib,getpass; print(hashlib.sha256(getpass.getpass('master password: ').encode('utf-8')).hexdigest())"
```

기존에 GAS 웹앱을 배포해 두신 경우 아래 절차로 갱신해 주세요.

1. 구글 스프레드시트 → **확장 프로그램 → Apps Script** 열기
2. `docs/static/gas_db_script.js`의 **전체 내용을 복사**해 기존 스크립트를 교체
3. 우측 상단 **배포 → 배포 관리** → 기존 배포의 ✏️ 편집 아이콘 클릭
4. **버전: 새 버전** 선택 → **배포** 클릭
5. 웹앱 URL은 그대로 유지되므로 마스터 대시보드의 GAS URL 재설정은 불필요
6. 첫 호출 시 `Users` 시트에 `resetTokenHash`, `resetTokenExp` 두 컬럼이 자동으로 추가됩니다

## 알려진 한계

- GitHub Pages 정적 구조에서는 클라이언트가 키 파생 정보를 다루게 되므로, 패스프레이즈가 약하면 사전 공격에 노출될 수 있습니다. 12자 이상의 임의 패스프레이즈 사용을 권장합니다.
- 동일 학번/전화번호 뒷자리 조합은 항상 같은 해시 키를 생성하므로, 학기 간 데이터를 다른 저장소/디렉토리로 분리하는 것이 좋습니다.
- GAS 호환 계정 흐름은 마이그레이션을 위해 SHA-256 해시를 유지합니다. 운영 서버 인증 API는 Argon2/bcrypt 계열 해시와 HttpOnly 세션 쿠키를 지원합니다.
- API 조회는 서버 JSONL 로그에 기록되며 `/api/view_stats`로 집계됩니다. 정적 로컬 미리보기 조회는 브라우저 로컬 기록 기준 참고값입니다.
