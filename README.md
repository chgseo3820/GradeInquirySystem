# ScoreQuery — 성적 조회 시스템

2026-1학기 경영정보시스템(MIS) 성적 조회 웹 애플리케이션

## 🌐 웹 조회

GitHub Pages로 배포: **https://[your-username].github.io/ScoreQuery/**

- 학번 + 전화번호 뒷자리 4자리로 본인 성적 조회
- 퀴즈 / 출석 / 중간고사 / 기말고사 / 총점 카드 표시
- 분반 평균 및 최고점수 비교 Radar 차트
- 다크모드 글래스모피즘 UI

## 🔒 개인정보 보호

- 인증 키: `SHA-256(학번|전화번호뒷4자리)` — 원본 역추적 불가
- 전화번호, 이메일: JSON에 미포함
- 이름: 마스킹 처리 (첫 글자만 표시)
- 학번: 앞 4자리만 표시

## 📁 프로젝트 구조

```
ScoreQuery/
├── docs/                    ← GitHub Pages 배포 폴더
│   ├── index.html
│   ├── data.json            ← 해시 기반 성적 데이터
│   └── static/
│       ├── style.css
│       └── app.js
├── app.py                   ← 로컬 Flask 서버 (개발용)
├── build_data.py            ← Excel → JSON 변환 스크립트
├── templates/index.html     ← Flask 템플릿
├── static/                  ← Flask 정적 파일
├── requirements.txt
└── .gitignore               ← Excel 원본 제외
```

## 🛠 데이터 업데이트

Excel 파일 변경 시:

```bash
python build_data.py    # docs/data.json 재생성
git add -A && git commit -m "update grades" && git push
```

## ⚙ GitHub Pages 설정

1. GitHub에서 Settings → Pages
2. Source: **Deploy from a branch**
3. Branch: **main**, Folder: **/docs**
4. Save → 배포 완료
