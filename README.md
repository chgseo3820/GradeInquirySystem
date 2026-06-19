# ScoreQuery — 성적 조회 시스템

교수자 성적 공시와 학생 본인 성적 조회를 지원하는 GitHub Pages 기반 웹 애플리케이션입니다.

## 🌐 웹 조회

GitHub Pages로 배포: **https://chgseo3820.github.io/ScoreQuery/**

- 학번 + 전화번호 뒷자리 4자리로 본인 성적 조회
- 과목 선택 후 공시 기간 내 성적 조회
- 평가항목별 점수 / 총점 카드 표시
- 분반 평균 및 최고점수 비교 Radar 차트
- 교수자 모드에서 과목, 평가기준, Excel 업로드, 공시 기간 관리

## 🔒 개인정보 보호

- 인증 키: `SHA-256(학번|전화번호뒷4자리)` — 원본 역추적 불가
- 전화번호, 이메일: JSON에 미포함
- 이름: 마스킹 처리 (첫 글자만 표시)
- 학번: 앞 4자리만 표시
- 성적/설정 파일: **AES-256-GCM + PBKDF2-HMAC-SHA256(600,000회)** 으로 암호화 저장
- Excel 원본, `config.json`, `data.json`, 암호화된 민감 파일은 GitHub에 올리지 않음 (`.gitignore`)
- Flask 로컬 서버 관리자 API는 `SCOREQUERY_ADMIN_TOKEN` 환경변수로 보호
- 정적 Pages 구조는 서버 비밀키를 숨길 수 없으므로 고위험 운영에서는 서버/API 검증 전환 권장

## 📁 프로젝트 구조

```
ScoreQuery/
├── docs/                    ← GitHub Pages 배포 폴더
│   ├── index.html
│   ├── data.enc.json        ← 암호화 성적 데이터(로컬 전용, Git 제외)
│   ├── admin-guide.md       ← 운영 가이드
│   ├── public-config.json   ← 공개 가능한 설정만
│   └── static/
│       ├── style.css
│       ├── app.js
│       └── admin.js
├── app.py                   ← 로컬 Flask 서버 (개발/관리용)
├── build_data.py            ← Excel → 암호화 JSON 변환 스크립트
├── scorequery_crypto.py     ← AES-256-GCM 암호화 모듈
├── secure_files.py          ← 민감 파일 암호화/복호화 CLI
├── generate_paper.py        ← 시험지 생성 보조 스크립트
├── config.example.json      ← 로컬 설정 예시
├── templates/index.html     ← Flask 템플릿
├── static/                  ← Flask 정적 파일 (개발 서버 전용)
├── requirements.txt
└── .gitignore               ← 민감 파일 제외
```

## ⚙ 환경 변수

| 변수 | 용도 | 필수 |
|---|---|---|
| `SCOREQUERY_DATA_PASSPHRASE` | `docs/data.enc.json` 암/복호화 패스프레이즈 | 빌드 시 필수 |
| `SCOREQUERY_ADMIN_TOKEN` | Flask `/api/save_*` 관리자 API 토큰 | 관리자 API 사용 시 필수 |
| `SCOREQUERY_HOST` | Flask 바인딩 호스트 (기본 `127.0.0.1`) | 선택 |
| `SCOREQUERY_PORT` | Flask 포트 (기본 `5000`) | 선택 |
| `SCOREQUERY_ALLOWED_ORIGINS` | CORS 화이트리스트 (콤마 구분) | 선택 |
| `SCOREQUERY_EXCEL` | 입력 Excel 파일 경로 | 선택 |

## 🛠 데이터 업데이트

Excel 파일 변경 시:

```powershell
$env:SCOREQUERY_DATA_PASSPHRASE = "긴-임의-비밀번호"
python build_data.py        # docs/data.enc.json 생성
python secure_files.py scan # 평문 민감 파일이 남아있는지 점검
```

`docs/data.enc.json`도 민감 파일이므로 공개 GitHub 저장소에는 커밋하지 않습니다.

교수자 모드에서 Excel 업로드를 사용하는 경우:

1. 과목과 평가기준을 설정합니다.
2. Excel 파일을 업로드하고 검증 보고서를 확인합니다.
3. 성적데이터를 확정합니다.
4. 공시 시작/종료 일시를 설정하고 최종 확인 후 공시합니다.

## 🚀 GitHub Pages 설정

1. GitHub에서 **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**, Folder: **/docs**
4. Save → 배포 완료

(대안) `deploy.bat`로 `gh-pages` 루트 배포를 사용하는 경우 Branch: `gh-pages`, Folder: `/ (root)`. **두 방식을 동시에 운영하지 마십시오.**

## 🖥 로컬 Flask 서버 실행

```powershell
$env:SCOREQUERY_DATA_PASSPHRASE = "긴-임의-비밀번호"
$env:SCOREQUERY_ADMIN_TOKEN     = "임의-관리자-토큰"
python app.py
```

- 기본 바인딩: `http://127.0.0.1:5000/` (로컬 전용)
- 관리자 API(`/api/save_data`, `/api/save_public_config`)는 `X-Admin-Token` 헤더 또는 본문의 `admin_token`이 일치할 때만 동작
- `/api/score`는 IP당 60초에 30회로 요청 빈도가 제한되어 학번 무차별 대입을 완화

## ⚠ 알려진 한계 & 보안 권고

- **정적 Pages 한계**: 클라이언트가 키 파생 정보를 처리하므로 패스프레이즈가 약하면 사전 공격에 노출됩니다. **12자 이상의 임의 패스프레이즈**를 사용하세요.
- **데이터 분리**: 학기/과목별 데이터는 별도 저장소 또는 별도 디렉토리로 분리하는 것이 좋습니다.
- **GAS 연동 URL**: `docs/public-config.json` 의 `gas_url`은 공개 정보이므로, GAS 측에서 적절한 인증/허용 도메인 제어를 적용해야 합니다.
- **로컬 서버**: Flask 개발 서버는 인터넷에 직접 노출하지 마십시오. 노출이 필요하면 별도의 리버스 프록시 + HTTPS + 인증 계층을 적용하십시오.

추가 운영 메모는 [docs/admin-guide.md](docs/admin-guide.md)를 참고하세요.
