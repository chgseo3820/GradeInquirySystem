@echo off
chcp 65001 >nul
echo ========================================================
echo  ScoreQuery GitHub Pages 배포 스크립트 (docs 경로 제거용)
echo ========================================================
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Git이 설치되어 있지 않거나 환경 변수 PATH에 등록되어 있지 않습니다.
    echo Git을 먼저 설치하고 다시 시도해 주세요.
    pause
    exit /b
)

echo [1/4] 임시 배포 디렉터리 생성 및 청소...
rmdir /s /q deploy_temp 2>nul
mkdir deploy_temp

echo [2/4] docs 폴더 내의 정적 파일들을 임시 폴더로 이동...
xcopy /s /e docs\* deploy_temp\ >nul

echo [3/4] 임시 디렉터리 내 Git 저장소 초기화 및 커밋...
cd deploy_temp
git init >nul
git checkout -b gh-pages >nul
git config user.name "armour-seo"
git config user.email "armour@tu.ac.kr"
git add . >nul
git commit -m "Deploy to GitHub Pages (root-level)" >nul

echo [4/4] GitHub 원격 저장소에 gh-pages 브랜치 강제 푸시...
echo 원격 origin 주소를 매핑하고 강제 업로드합니다.
git remote add origin https://github.com/armour-seo/ScoreQuery.git
git push -f origin gh-pages

cd ..
rmdir /s /q deploy_temp

echo.
echo ========================================================
echo  배포 완료! gh-pages 브랜치에 정적 리소스가 업로드되었습니다.
echo.
echo  ★ 마지막 필수 설정 단계 ★
echo  1. 본인의 GitHub 저장소 웹 사이트에 접속합니다.
echo  2. Settings -> Pages 메뉴로 이동합니다.
echo  3. Build and deployment -> Branch 설정을 다음과 같이 바꿉니다:
echo     • 기존: main (폴더: /docs)
echo     • 변경: gh-pages (폴더: / (root))
echo  4. Save 버튼을 클릭하여 저장합니다.
echo.
echo  설정이 완료되면 주소에서 /docs/가 완전히 사라진 아래 주소로 즉시 서비스됩니다:
echo  👉 https://armour-seo.github.io/ScoreQuery/
echo ========================================================
