/**
 * ScoreQuery — 교수 모드 (Admin Wizard)
 * 3단계 위자드: 교수정보 → 과목정보 → 평가기준 → 샘플 Excel 다운로드
 */

(() => {
    'use strict';

    // ── 평가 항목 정의 ──
    const EVAL_ITEMS = [
        { id: 'quiz',        label: '퀴즈',     icon: '🎯' },
        { id: 'attendance',  label: '출석',     icon: '📋' },
        { id: 'assignment',  label: '과제',     icon: '📝' },
        { id: 'midterm',     label: '중간고사', icon: '📖' },
        { id: 'final',       label: '기말고사', icon: '📕' },
        { id: 'presentation',label: '발표',     icon: '🎤' },
        { id: 'participation',label: '참여도',  icon: '🙋' },
    ];

    // ── State ──
    let currentStep = 1;
    let currentUser = null; // 로그인 세션 변수 추가
    let adminConfig = {
        professor: { name: '', email: '', phone: '' },
        course: { year: '', semester: '', name: '' },
        evaluation: [], // [{ id, label, icon, ratio }]
        courses: [],    // [{ year, semester, name, evaluation: [...] }]
    };

    // ── DOM References ──
    const modeSection    = document.getElementById('mode-section');
    const adminSection   = document.getElementById('admin-section');
    const loginSection   = document.getElementById('login-section');
    const topBar         = document.getElementById('top-bar');
    const topBarTitle    = document.getElementById('top-bar-title');
    const topBarProf     = document.getElementById('top-bar-prof');
    const mainContainer  = document.querySelector('.container');

    const modeAdminBtn   = document.getElementById('mode-admin-btn');
    const modeStudentBtn = document.getElementById('mode-student-btn');
    const loginBackBtn   = document.getElementById('login-back-btn');

    // ── Initialize ──
    try {
        initYearOptions();
        initEvalCriteria();
        initAuth();
        bindEvents();
        console.log('[ScoreQuery Admin] Initialized successfully');
    } catch (err) {
        console.error('[ScoreQuery Admin] Init error:', err);
        document.body.insertAdjacentHTML('afterbegin',
            `<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc2626;color:#fff;padding:12px;font-size:14px;">
                ⚠️ Admin Init Error: ${err.message}
            </div>`);
    }

    // ──────────────────────────────────────────────
    // Mode Selection
    // ──────────────────────────────────────────────
    function showModeSelection() {
        modeSection.style.display = '';
        adminSection.classList.remove('visible');
        loginSection.style.display = 'none';
        document.getElementById('result-section').classList.remove('visible');
        topBarTitle.textContent = '📊 성적 관리 시스템';
        topBarProf.textContent = '';
        currentStep = 1;
        resetWizard();
    }

    function enterStudentMode() {
        modeSection.style.display = 'none';
        loginSection.style.display = '';

        // localStorage에서 저장된 설정 로드
        const saved = loadConfig();
        if (saved && saved.professor) {
            topBarTitle.textContent = '📊 성적조회시스템';
            topBarProf.innerHTML = `담당교수: ${saved.professor.name} (<a href="mailto:${saved.professor.email}">${saved.professor.email}</a>)`;
        }

        // 과목 선택 목록 채우기
        if (typeof populateStudentCourses === 'function') {
            populateStudentCourses();
        }
    }

    function enterAdminMode() {
        modeSection.style.display = 'none';
        adminSection.classList.add('visible');
        topBarTitle.textContent = '⚙️ 교수 모드 — 과목 설정';
        topBarProf.textContent = '';
        // 세션 로드 체크 후 분기
        const sess = sessionStorage.getItem('scorequery_session');
        if (sess) {
            const user = JSON.parse(sess);
            currentUser = user;
            if (user.isMaster) {
                showMasterDashboard();
            } else if (user.status === 'approved') {
                enterAdminWizard();
            } else if (user.status === 'pending') {
                showPendingView(user);
            } else {
                handleLogoutAction();
            }
        } else {
            // 로그인 화면 노출
            document.getElementById('admin-auth-panel').style.display = '';
            document.getElementById('admin-login-card').style.display = '';
            document.getElementById('admin-register-card').style.display = 'none';
            document.getElementById('admin-pending-panel').style.display = 'none';
            document.getElementById('admin-master-panel').style.display = 'none';
            document.getElementById('admin-wizard-container').style.display = 'none';
        }
    }

    // ──────────────────────────────────────────────
    // Wizard Navigation
    // ──────────────────────────────────────────────
    function goToStep(step) {
        currentStep = step;

        // Hide all panels
        document.querySelectorAll('.wizard-panel').forEach(p => p.style.display = 'none');

        // Show target panel
        const panelId = step === 4 ? 'wizard-step-complete' : `wizard-step-${step}`;
        document.getElementById(panelId).style.display = '';

        // Update step indicators
        document.querySelectorAll('.wizard-step').forEach(el => {
            const s = parseInt(el.dataset.step);
            el.classList.remove('active', 'completed');
            if (s === step) el.classList.add('active');
            else if (s < step) el.classList.add('completed');
        });

        document.querySelectorAll('.step-connector').forEach((c, i) => {
            c.classList.toggle('completed', i + 1 < step);
        });

        // Step 4 = complete (레이아웃 확장 추가)
        if (step === 4) {
            adminSection.classList.add('wide-layout');
            if (mainContainer) {
                mainContainer.classList.add('wide-layout');
            }
            renderCourseSelector();
            renderCompleteSummary();
            renderViewStats();
        } else {
            // 다른 단계로 복귀 시 마스터 패널이 활성화되어 있지 않다면 wide-layout 제거
            const masterPanel = document.getElementById('admin-master-panel');
            const isMasterActive = masterPanel && masterPanel.style.display !== 'none';
            if (!isMasterActive) {
                adminSection.classList.remove('wide-layout');
                if (mainContainer) {
                    mainContainer.classList.remove('wide-layout');
                }
            }
        }

        // Step 2 = 과목명 자동완성 목록 채우기
        if (step === 2) {
            populateCourseNameList();
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function populateCourseNameList() {
        const datalist = document.getElementById('course-name-list');
        if (!datalist) return;
        datalist.innerHTML = '';

        // 기존 courses에서 고유한 과목명 추출
        const names = new Set();
        if (adminConfig.courses) {
            adminConfig.courses.forEach(c => { if (c.name) names.add(c.name); });
        }

        // 전체 공개된 과목도 후보에 추가
        if (typeof window.getAvailableCourses === 'function') {
            const allCourses = window.getAvailableCourses();
            allCourses.forEach(c => {
                if (c.name) names.add(c.name);
            });
        }

        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            datalist.appendChild(opt);
        });
    }

    function validateStep1() {
        const name = document.getElementById('prof-name').value.trim();
        const email = document.getElementById('prof-email').value.trim();
        const phone = document.getElementById('prof-phone').value.trim();

        if (!name) { alert('이름을 입력해 주세요.'); return false; }
        if (!email) { alert('이메일을 입력해 주세요.'); return false; }

        adminConfig.professor = { name, email, phone };
        return true;
    }

    function validateStep2() {
        const year = document.getElementById('course-year').value;
        const semSelect = document.getElementById('course-semester').value;
        const semCustom = document.getElementById('course-semester-custom').value.trim();
        const courseName = document.getElementById('course-name').value.trim();

        if (!year) { alert('년도를 선택해 주세요.'); return false; }
        if (!semSelect) { alert('학기를 선택해 주세요.'); return false; }
        if (semSelect === '__custom__' && !semCustom) { alert('학기명을 입력해 주세요.'); return false; }
        if (!courseName) { alert('과목명을 입력해 주세요.'); return false; }

        const semester = semSelect === '__custom__' ? semCustom : semSelect;
        adminConfig.course = { year, semester, name: courseName };
        return true;
    }

    function validateStep3() {
        const total = getEvalTotal();
        if (total !== 100) {
            alert('평가 비율의 합이 100%가 되어야 합니다.');
            return false;
        }

        // 선택된 항목 수집
        adminConfig.evaluation = [];
        EVAL_ITEMS.forEach(item => {
            const cb = document.getElementById(`eval-cb-${item.id}`);
            const input = document.getElementById(`eval-ratio-${item.id}`);
            if (cb.checked) {
                adminConfig.evaluation.push({
                    id: item.id,
                    label: item.label,
                    icon: item.icon,
                    ratio: parseInt(input.value) || 0,
                });
            }
        });

        // 현재 과목+평가를 courses 배열에 저장
        const existing = adminConfig.courses.findIndex(c =>
            c.name === adminConfig.course.name &&
            c.year === adminConfig.course.year &&
            c.semester === adminConfig.course.semester
        );
        const courseEntry = {
            ...adminConfig.course,
            evaluation: [...adminConfig.evaluation],
        };
        if (existing >= 0) {
            const c = adminConfig.courses[existing];
            if (!confirm(
                `⚠️ 동일 과목이 이미 등록되어 있습니다.\n\n` +
                `「${c.year} ${c.semester} — ${c.name}」\n\n` +
                `기존 설정을 덮어쓰시겠습니까?`
            )) {
                return false;
            }
            adminConfig.courses[existing] = courseEntry;
        } else {
            adminConfig.courses.push(courseEntry);
        }

        // localStorage에 저장
        saveConfig(adminConfig);
        return true;
    }

    // ── 과목 선택기 ──
    function renderCourseSelector() {
        const sel = document.getElementById('select-course');
        if (!sel) return;
        sel.innerHTML = '';

        if (adminConfig.courses.length === 0) {
            sel.innerHTML = '<option value="">등록된 과목 없음</option>';
            return;
        }

        adminConfig.courses.forEach((c, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${c.year} ${c.semester} — ${c.name}`;
            sel.appendChild(opt);
        });

        // 현재 과목과 일치하는 항목 선택
        const curIdx = adminConfig.courses.findIndex(c =>
            c.name === adminConfig.course.name &&
            c.year === adminConfig.course.year &&
            c.semester === adminConfig.course.semester
        );
        sel.value = curIdx >= 0 ? curIdx : 0;
        selectCourse(parseInt(sel.value));
    }

    function selectCourse(index) {
        const c = adminConfig.courses[index];
        if (!c) return;
        adminConfig.course = { year: c.year, semester: c.semester, name: c.name };
        adminConfig.evaluation = c.evaluation ? [...c.evaluation] : [];
        renderCompleteSummary();
        renderViewStats();
    }

    function addAnotherCourse() {
        // adminConfig 초기화
        adminConfig.course = { year: '', semester: '', name: '' };
        adminConfig.evaluation = [];

        // 과목 폼 초기화
        document.getElementById('course-year').value = '';
        document.getElementById('course-year').classList.add('select-unselected');
        document.getElementById('course-semester').value = '';
        document.getElementById('course-semester').classList.add('select-unselected');
        document.getElementById('course-semester-custom').value = '';
        document.getElementById('course-name').value = '';

        // 평가 기준 초기화
        EVAL_ITEMS.forEach(item => {
            const cb = document.getElementById(`eval-cb-${item.id}`);
            const input = document.getElementById(`eval-ratio-${item.id}`);
            if (cb) cb.checked = false;
            if (input) input.value = '';
        });
        updateEvalTotal();

        // Step 2로 이동
        goToStep(2);
    }

    // ──────────────────────────────────────────────
    // Year Dropdown
    // ──────────────────────────────────────────────
    function initYearOptions() {
        const select = document.getElementById('course-year');
        const currentYear = new Date().getFullYear();
        for (let y = currentYear + 2; y >= currentYear - 4; y--) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = `${y}년`;
            if (y === currentYear) opt.selected = true;
            select.appendChild(opt);
        }
        // 기본 선택 시 노란 배경 제거
        if (select.value) select.classList.remove('select-unselected');

        // 변경 시 토글
        select.addEventListener('change', () => {
            select.classList.toggle('select-unselected', !select.value);
        });

        const semSel = document.getElementById('course-semester');
        semSel.addEventListener('change', () => {
            semSel.classList.toggle('select-unselected', !semSel.value);
        });
    }

    // ──────────────────────────────────────────────
    // Semester Custom Toggle
    // ──────────────────────────────────────────────
    function toggleSemesterCustom() {
        const select = document.getElementById('course-semester');
        const customInput = document.getElementById('course-semester-custom');
        if (select.value === '__custom__') {
            customInput.classList.add('visible');
            customInput.focus();
        } else {
            customInput.classList.remove('visible');
            customInput.value = '';
        }
    }

    // ──────────────────────────────────────────────
    // Evaluation Criteria
    // ──────────────────────────────────────────────
    function initEvalCriteria() {
        const container = document.getElementById('eval-criteria-list');
        container.innerHTML = '';

        EVAL_ITEMS.forEach(item => {
            const div = document.createElement('div');
            div.className = 'eval-item';
            div.id = `eval-item-${item.id}`;
            div.innerHTML = `
                <input type="checkbox" id="eval-cb-${item.id}">
                <span class="eval-item-icon">${item.icon}</span>
                <label class="eval-item-label" for="eval-cb-${item.id}">${item.label}</label>
                <div class="eval-item-ratio">
                    <input type="number" id="eval-ratio-${item.id}" min="0" max="100" value="" placeholder="0" disabled>
                    <span>%</span>
                </div>
            `;
            container.appendChild(div);

            // Checkbox toggle
            const cb = div.querySelector(`#eval-cb-${item.id}`);
            const ratioInput = div.querySelector(`#eval-ratio-${item.id}`);

            cb.addEventListener('change', () => {
                ratioInput.disabled = !cb.checked;
                div.classList.toggle('selected', cb.checked);
                if (!cb.checked) {
                    ratioInput.value = '';
                }
                updateEvalTotal();
            });

            ratioInput.addEventListener('input', () => {
                updateEvalTotal();
            });
        });
    }

    function getEvalTotal() {
        let total = 0;
        EVAL_ITEMS.forEach(item => {
            const cb = document.getElementById(`eval-cb-${item.id}`);
            const input = document.getElementById(`eval-ratio-${item.id}`);
            if (cb.checked) {
                total += parseInt(input.value) || 0;
            }
        });
        return total;
    }

    function updateEvalTotal() {
        const total = getEvalTotal();
        const valueEl = document.getElementById('eval-total-value');
        const fillEl = document.getElementById('eval-total-fill');
        const warningEl = document.getElementById('eval-warning');
        const nextBtn = document.getElementById('wizard-next-3');

        valueEl.textContent = `${total}%`;
        fillEl.style.width = `${Math.min(total, 100)}%`;

        // 색상 분기
        valueEl.classList.remove('valid', 'invalid');
        fillEl.classList.remove('over', 'perfect');

        if (total === 100) {
            valueEl.classList.add('valid');
            fillEl.classList.add('perfect');
            warningEl.classList.remove('visible');
            nextBtn.disabled = false;
            const addBtn = document.getElementById('wizard-add-course');
            if (addBtn) addBtn.disabled = false;
        } else {
            valueEl.classList.add('invalid');
            if (total > 100) fillEl.classList.add('over');
            warningEl.classList.add('visible');
            nextBtn.disabled = true;
            const addBtn = document.getElementById('wizard-add-course');
            if (addBtn) addBtn.disabled = true;
        }
    }

    // ──────────────────────────────────────────────
    // Complete Summary
    // ──────────────────────────────────────────────
    function renderCompleteSummary() {
        const container = document.getElementById('complete-summary');
        const { professor, course, evaluation } = adminConfig;

        let evalHtml = evaluation.map(e =>
            `<div class="complete-summary-item"><span class="label">${e.icon} ${e.label}</span><span class="value">${e.ratio}%</span></div>`
        ).join('');

        container.innerHTML = `
            <div class="complete-summary-group">
                <div class="complete-summary-title">교수 정보</div>
                <div class="complete-summary-items">
                    <div class="complete-summary-item"><span class="label">이름</span><span class="value">${professor.name}</span></div>
                    <div class="complete-summary-item"><span class="label">이메일</span><span class="value">${professor.email}</span></div>
                    <div class="complete-summary-item"><span class="label">전화번호</span><span class="value">${professor.phone || '-'}</span></div>
                </div>
            </div>
            <div class="complete-summary-group">
                <div class="complete-summary-title">과목 정보</div>
                <div class="complete-summary-items">
                    <div class="complete-summary-item"><span class="label">년도/학기</span><span class="value">${course.year} ${course.semester}</span></div>
                    <div class="complete-summary-item"><span class="label">과목명</span><span class="value">${course.name}</span></div>
                </div>
            </div>
            <div class="complete-summary-group">
                <div class="complete-summary-title">평가 기준</div>
                <div class="complete-summary-items">
                    ${evalHtml}
                </div>
            </div>
            <div class="complete-summary-group">
                <div class="complete-summary-title">추가 필드</div>
                <div class="complete-summary-items">
                    <div class="complete-summary-item"><span class="label">📋 상대평가제외</span><span class="value">외국인 / 만학도 / 장애인</span></div>
                    <div class="complete-summary-item"><span class="label">⭐ 특별점수</span><span class="value">100점 초과 가능 · 총점 포함</span></div>
                </div>
            </div>
        `;

        // 기존 공시 상태 로드
        loadExistingPublishStatus();
    }

    // ──────────────────────────────────────────────
    // 공시 (Publication) 관리
    // ──────────────────────────────────────────────
    function getPublishKey() {
        const { course } = adminConfig;
        return `scorequery_publish_${course.year}_${course.semester}_${course.name}`;
    }

    function getPublishInfo() {
        try {
            const raw = localStorage.getItem(getPublishKey());
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    function showPublishArea() {
        const area = document.getElementById('publish-area');
        if (!area) return;
        area.style.display = '';

        const info = getPublishInfo();
        const dtInput = document.getElementById('publish-datetime');

        if (info && info.published) {
            dtInput.value = info.publishDate || '';
            updatePublishStatusDisplay(info);
        } else {
            // 기본값: 현재 시각 + 1시간 (반올림)
            const now = new Date();
            now.setHours(now.getHours() + 1, 0, 0, 0);
            dtInput.value = toLocalISOString(now);
            updatePublishStatusDisplay(null);
        }
    }

    function toLocalISOString(d) {
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function updatePublishStatusDisplay(info) {
        const statusEl = document.getElementById('publish-status');
        if (!statusEl) return;

        if (info && info.published) {
            const dt = new Date(info.publishDate);
            const now = new Date();
            const dateStr = dt.toLocaleString('ko-KR', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });

            if (now >= dt) {
                statusEl.className = 'publish-status published';
                statusEl.textContent = `✅ 공시 중 — ${dateStr}부터 학생 조회 가능`;
            } else {
                statusEl.className = 'publish-status';
                statusEl.textContent = `⏳ 공시 예약 — ${dateStr}에 공개 예정`;
            }
            document.getElementById('btn-unpublish').style.opacity = '1';
        } else {
            statusEl.className = 'publish-status';
            statusEl.textContent = '🔒 미공시 — 학생 조회가 차단되어 있습니다';
            document.getElementById('btn-unpublish').style.opacity = '0.4';
        }
    }

    function publishGrades() {
        const dtInput = document.getElementById('publish-datetime');
        const publishDate = dtInput.value;

        if (!publishDate) {
            alert('공시 일시를 선택해 주세요.');
            return;
        }

        const info = {
            published: true,
            publishDate: publishDate,
            publishedAt: new Date().toISOString(),
            courseName: adminConfig.course.name,
        };

        localStorage.setItem(getPublishKey(), JSON.stringify(info));

        // 과목 목록에도 공시 상태 반영
        const courseListRaw = localStorage.getItem('scorequery_courses') || '[]';
        const courseList = JSON.parse(courseListRaw);
        const idx = courseList.findIndex(c =>
            c.year === adminConfig.course.year &&
            c.semester === adminConfig.course.semester &&
            c.name === adminConfig.course.name
        );
        if (idx >= 0) {
            courseList[idx].publishDate = publishDate;
            courseList[idx].published = true;
            if (currentUser) {
                courseList[idx].professor = { name: currentUser.name, email: currentUser.email };
            }
            localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
        } else {
            courseList.push({
                year: adminConfig.course.year,
                semester: adminConfig.course.semester,
                name: adminConfig.course.name,
                publishDate: publishDate,
                published: true,
                professor: currentUser ? { name: currentUser.name, email: currentUser.email } : null
            });
            localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
        }

        updatePublishStatusDisplay(info);

        autoSaveDataJsonToServer().then(res => {
            if (res && res.success) {
                alert('📢 성적이 공시되었으며, 서버의 docs/data.json 파일로 자동 저장되었습니다!');
            } else {
                alert('📢 성적이 공시되었습니다!\n(로컬 백엔드 서버가 종료 상태이거나 연결할 수 없어 data.json 자동 저장에 실패했습니다. 필요한 경우 아래의 다운로드 버튼을 눌러 수동 저장해 주세요.)');
            }
        });
    }

    function unpublishGrades() {
        const info = getPublishInfo();
        if (!info || !info.published) {
            alert('현재 공시된 상태가 아닙니다.');
            return;
        }

        if (!confirm('공시를 취소하시겠습니까?\n학생들의 성적 조회가 차단됩니다.')) return;

        localStorage.removeItem(getPublishKey());

        // 과목 목록에서도 제거
        const courseListRaw = localStorage.getItem('scorequery_courses') || '[]';
        const courseList = JSON.parse(courseListRaw);
        const idx = courseList.findIndex(c =>
            c.year === adminConfig.course.year &&
            c.semester === adminConfig.course.semester &&
            c.name === adminConfig.course.name
        );
        if (idx >= 0) {
            delete courseList[idx].publishDate;
            delete courseList[idx].published;
            localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
        }

        updatePublishStatusDisplay(null);
        alert('🚫 공시가 취소되었습니다.');
    }

    function loadExistingPublishStatus() {
        const info = getPublishInfo();
        if (info && info.published) {
            showPublishArea();
        }
    }

    // ──────────────────────────────────────────────
    // Excel Download (SheetJS)
    // ──────────────────────────────────────────────
    function downloadSampleExcel() {
        const { professor, course, evaluation } = adminConfig;

        // 헤더 행
        const baseHeaders = ['학번', '이름', '학년', '학과', '분반', '전화번호', '상대평가제외사유'];
        const evalHeaders = evaluation.map(e => `${e.label}(${e.ratio}%)`);
        const headers = [...baseHeaders, ...evalHeaders, '특별점수', '성적', '석차', '평점', '결석', '비고'];

        // 상대평가제외사유 유효값 안내 (데이터 유효성 검사용)
        // 외국인, 만학도, 장애인 중 선택 또는 비워둠

        // 샘플 데이터 행 (3개 예시)
        const sampleRows = [
            ['20240001', '홍길동', 3, '경영학과', 1, '010-1234-5678', '', ...evaluation.map(() => ''), '', '', '', '', 0, ''],
            ['20240002', '김영희', 2, '경영학과', 1, '010-2345-6789', '외국인', ...evaluation.map(() => ''), '', '', '', '', 0, ''],
            ['20240003', '이철수', 4, '경영학과', 2, '010-3456-7890', '', ...evaluation.map(() => ''), '', '', '', '', 0, ''],
        ];

        // 워크시트 생성
        const wsData = [headers, ...sampleRows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // 열 너비 설정
        const colWidths = headers.map(h => ({ wch: Math.max(h.length * 2, 12) }));
        ws['!cols'] = colWidths;

        // 상대평가제외사유 열에 셀 코멘트 추가 (마우스 올릴 때만 표시)
        const exclColIdx = baseHeaders.indexOf('상대평가제외사유');
        const exclCellRef = XLSX.utils.encode_cell({ r: 0, c: exclColIdx });
        if (!ws[exclCellRef].c) ws[exclCellRef].c = [];
        ws[exclCellRef].c.push({ a: 'ScoreQuery', t: '외국인, 만학도, 장애인 중 선택\n해당 없으면 비워두세요', s: { sz: 10 } });
        ws[exclCellRef].c.hidden = true;

        // 특별점수 열에 셀 코멘트 추가 (마우스 올릴 때만 표시)
        const specColIdx = headers.indexOf('특별점수');
        const specCellRef = XLSX.utils.encode_cell({ r: 0, c: specColIdx });
        if (!ws[specCellRef].c) ws[specCellRef].c = [];
        ws[specCellRef].c.push({ a: 'ScoreQuery', t: '100점 초과 가능\n총점 산출에 포함됩니다', s: { sz: 10 } });
        ws[specCellRef].c.hidden = true;

        // 워크북 생성
        const wb = XLSX.utils.book_new();
        const sheetName = `${course.year}-${course.semester}`;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);

        // 파일 다운로드 (강제 파일명: 년도-학기-과목명-교수명.xlsx)
        const fileName = `${course.year}-${course.semester}-${course.name}-${professor.name}.xlsx`;
        XLSX.writeFile(wb, fileName);
    }

    function getCompiledDataJson() {
        const { course } = adminConfig;
        if (!course || !course.name) return null;

        const dataKey = `scorequery_data_${course.year}_${course.semester}_${course.name}`;
        const rawData = localStorage.getItem(dataKey);
        if (!rawData) return null;

        try {
            const dataObj = JSON.parse(rawData);
            // 최신 GAS URL과 교수 정보 반영
            dataObj.gas_url = localStorage.getItem('scorequery_gas_url') || '';
            if (currentUser) {
                dataObj.professor = {
                    name: currentUser.name,
                    email: currentUser.email
                };
            }
            return dataObj;
        } catch (e) {
            console.error('Failed to compile data.json object:', e);
            return null;
        }
    }

    function downloadDataJson() {
        const dataObj = getCompiledDataJson();
        if (!dataObj) {
            alert('성적 데이터가 없습니다. 먼저 2단계에서 성적 파일을 업로드하고 확정해 주세요.');
            return;
        }

        try {
            // data.json 형식으로 다운로드
            const jsonString = JSON.stringify(dataObj, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = 'data.json';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Failed to download data.json:', e);
            alert('파일 다운로드 중 오류가 발생했습니다: ' + e.message);
        }
    }

    async function autoSaveDataJsonToServer() {
        const dataObj = getCompiledDataJson();
        if (!dataObj) return { success: false, error: 'No data' };

        try {
            const response = await fetch('http://127.0.0.1:5000/api/save_data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(dataObj)
            });
            if (response.ok) {
                const result = await response.json();
                console.log('[ScoreQuery] Auto-save success:', result.message);
                return { success: true, message: result.message };
            } else {
                const errData = await response.json().catch(() => ({}));
                console.warn('[ScoreQuery] Auto-save failed on server:', errData.error);
                return { success: false, error: errData.error || 'Server error' };
            }
        } catch (e) {
            console.warn('[ScoreQuery] Auto-save connection failed (Flask server might be offline):', e);
            return { success: false, error: 'Connection failed' };
        }
    }

    // ──────────────────────────────────────────────
    // LocalStorage
    // ──────────────────────────────────────────────
    function saveConfig(config) {
        try {
            localStorage.setItem('scorequery_config', JSON.stringify(config));
        } catch (e) { /* ignore */ }
    }

    function loadConfig() {
        try {
            const raw = localStorage.getItem('scorequery_config');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function resetWizard() {
        goToStep(1);
        document.getElementById('prof-name').value = '';
        document.getElementById('prof-email').value = '';
        document.getElementById('prof-phone').value = '';
        document.getElementById('course-year').selectedIndex = 0;
        document.getElementById('course-semester').selectedIndex = 0;
        document.getElementById('course-semester-custom').classList.remove('visible');
        document.getElementById('course-semester-custom').value = '';
        document.getElementById('course-name').value = '';
        initEvalCriteria();
        updateEvalTotal();
    }

    // ──────────────────────────────────────────────
    // Load Config (Auth)
    // ──────────────────────────────────────────────
    function loadConfigWithAuth() {
        const saved = loadConfig();
        if (!saved || !saved.professor) {
            showLoadError('저장된 설정이 없습니다.');
            return;
        }

        const inputName = document.getElementById('load-name').value.trim();
        const inputPhone4 = document.getElementById('load-phone4').value.trim();

        if (!inputName || !inputPhone4) {
            showLoadError('이름과 전화번호 뒷자리를 입력해 주세요.');
            return;
        }

        // 인증: 이름 일치 + 전화번호 뒷 4자리 일치
        const savedPhone = saved.professor.phone || '';
        const savedLast4 = savedPhone.replace(/[^0-9]/g, '').slice(-4);

        if (saved.professor.name !== inputName) {
            showLoadError('이름이 일치하지 않습니다.');
            return;
        }

        if (savedLast4 !== inputPhone4) {
            showLoadError('전화번호 뒷자리가 일치하지 않습니다.');
            return;
        }

        // 인증 성공 — 필드 채우기
        populateFromConfig(saved);
        showLoadSuccess();
    }

    function populateFromConfig(config) {
        const { professor, course, evaluation } = config;

        // Step 1: 교수 정보
        document.getElementById('prof-name').value = professor.name || '';
        document.getElementById('prof-email').value = professor.email || '';
        document.getElementById('prof-phone').value = professor.phone || '';

        // Step 2: 과목 정보
        if (course) {
            const yearSelect = document.getElementById('course-year');
            for (let i = 0; i < yearSelect.options.length; i++) {
                if (yearSelect.options[i].value == course.year) {
                    yearSelect.selectedIndex = i;
                    break;
                }
            }

            const semSelect = document.getElementById('course-semester');
            let found = false;
            for (let i = 0; i < semSelect.options.length; i++) {
                if (semSelect.options[i].value === course.semester) {
                    semSelect.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found && course.semester) {
                // 기타 학기
                semSelect.value = '__custom__';
                const customInput = document.getElementById('course-semester-custom');
                customInput.value = course.semester;
                customInput.classList.add('visible');
            }

            document.getElementById('course-name').value = course.name || '';
        }

        // Step 3: 평가 기준
        if (evaluation && evaluation.length > 0) {
            initEvalCriteria(); // 초기화 후 다시 설정
            evaluation.forEach(e => {
                const cb = document.getElementById(`eval-cb-${e.id}`);
                const ratio = document.getElementById(`eval-ratio-${e.id}`);
                const item = document.getElementById(`eval-item-${e.id}`);
                if (cb && ratio && item) {
                    cb.checked = true;
                    ratio.disabled = false;
                    ratio.value = e.ratio;
                    item.classList.add('selected');
                }
            });
            updateEvalTotal();
        }

        // adminConfig 업데이트
        adminConfig.professor = { ...professor };
        if (course) adminConfig.course = { ...course };
        if (evaluation) adminConfig.evaluation = [...evaluation];

        // courses 배열 호환성
        if (config.courses && config.courses.length > 0) {
            adminConfig.courses = config.courses.map(c => ({ ...c }));
        } else if (course && evaluation && evaluation.length > 0) {
            // 이전 형식 → courses 배열로 변환
            adminConfig.courses = [{
                ...course,
                evaluation: [...evaluation],
            }];
        }
    }

    function showLoadError(msg) {
        const el = document.getElementById('load-error');
        el.textContent = msg;
        el.style.display = 'block';
        el.classList.remove('load-success');
    }

    function showLoadSuccess() {
        const el = document.getElementById('load-error');
        el.innerHTML = '✅ 설정을 불러왔습니다!';
        el.style.display = 'block';
        el.classList.add('load-success');
        // 불러오기 폼 숨김
        setTimeout(() => {
            document.getElementById('load-config-form').style.display = 'none';
        }, 1500);
    }

    // ──────────────────────────────────────────────
    // Save Early (Step 2에서 저장)
    // ──────────────────────────────────────────────
    function saveEarlyConfig() {
        if (!validateStep1()) return;
        if (!validateStep2()) return;
        saveConfig(adminConfig);
        alert('✅ 교수정보와 과목정보가 저장되었습니다.\n다음 접속 시 "불러오기"로 복원할 수 있습니다.');
    }

    // ──────────────────────────────────────────────
    // Excel Upload → data.json 생성
    // ──────────────────────────────────────────────
    function setupUpload() {
        const uploadBox = document.getElementById('upload-box');
        const uploadInput = document.getElementById('upload-input');
        const uploadArea = document.getElementById('upload-area');

        if (!uploadBox || !uploadInput) return;

        // 클릭으로 파일 선택
        uploadBox.addEventListener('click', (e) => {
            e.stopPropagation();
            uploadInput.click();
        });

        // upload-area 전체에서 dragover 기본동작 방지 (필수)
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => e.preventDefault());
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) processUploadedFile(file);
            });
        }

        // 드래그 앤 드롭 (upload-box 전용 시각 효과)
        uploadBox.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadBox.classList.add('dragover');
        });
        uploadBox.addEventListener('dragleave', () => {
            uploadBox.classList.remove('dragover');
        });
        uploadBox.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadBox.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) processUploadedFile(file);
        });

        uploadInput.addEventListener('change', () => {
            const file = uploadInput.files[0];
            if (file) processUploadedFile(file);
            uploadInput.value = ''; // 같은 파일 재선택 가능
        });
    }

    // 업로드된 데이터를 임시 보관 (확정 전)
    let pendingUploadData = null;
    let pendingConvertedRows = null;
    let pendingConvertedHeaders = null;
    // 파이프라인 상태
    let pipelineIsStandard = false;
    let pipelineConvertedData = null; // { rows, headers }

    async function processUploadedFile(file) {
        // 초기화
        document.getElementById('upload-validation').style.display = 'none';
        document.getElementById('pipeline-area').style.display = 'none';
        document.getElementById('upload-preview-table').style.display = 'none';
        pendingUploadData = null;
        pendingConvertedRows = null;
        pendingConvertedHeaders = null;
        pipelineConvertedData = null;

        if (!file.name.match(/\.xlsx?$/i)) {
            showUploadStatus('error', '⚠️ .xlsx 파일만 업로드 가능합니다.');
            return;
        }

        showUploadStatus('processing', '⏳ 파일을 분석하고 있습니다...');

        try {
            const arrayBuffer = await file.arrayBuffer();
            const wb = XLSX.read(arrayBuffer, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (rows.length === 0) {
                showUploadStatus('error', '⚠️ 데이터가 없는 파일입니다.');
                return;
            }

            // ── 컬럼 매핑 ──
            const headers = Object.keys(rows[0]);
            const mapping = mapColumns(headers);
            const validation = validateMapping(mapping, rows);

            // ── 검증 보고서 ──
            renderValidationReport(validation, file.name, headers.length, rows.length);

            if (validation.critical > 0) {
                showUploadStatus('error', `⚠️ 필수 항목 ${validation.critical}개 누락 — 파일을 확인해 주세요.`);
                return;
            }

            // ── 표준 포맷 판별 ──
            pipelineIsStandard = isStandardFormat(headers, mapping);

            // ── data.json 미리 생성 ──
            const effectiveEval = adminConfig.evaluation.length > 0
                ? adminConfig.evaluation
                : mapping.evalDetected;
            const evalPairs = effectiveEval.map(e => ({
                evalItem: e,
                colName: mapping.eval[e.id] || null
            }));

            // 변환 데이터 준비 (비표준일 때 사용)
            const converted = convertToSampleFormat(rows, mapping);
            pipelineConvertedData = converted;
            pendingConvertedRows = converted.rows;
            pendingConvertedHeaders = converted.headers;

            // data.json 생성
            const dataJson = await buildDataJson(rows, headers, mapping, evalPairs, converted);
            pendingUploadData = dataJson;

            // ── 검증 보고서 업데이트 (정밀 검증 결과 포함) ──
            renderValidationReport(validation, file.name, headers.length, rows.length, dataJson);

            // ── 파이프라인 렌더링 ──
            renderPipeline(pipelineIsStandard, rows, headers, converted);

            showUploadStatus('success',
                pipelineIsStandard
                    ? '✅ 표준 포맷 파일이 확인되었습니다. 아래 단계를 진행하세요.'
                    : '⚠️ 비표준 포맷입니다. 표준 포맷으로 변환 후 진행하세요.');

        } catch (err) {
            console.error('[Upload Error]', err);
            showUploadStatus('error', `⚠️ 파일 처리 오류: ${err.message}\n${err.stack || ''}`);
        }
    }

    // ── 표준 포맷 판별 ──
    function isStandardFormat(headers, mapping) {
        // 기본 필수 헤더 존재 여부
        const required = ['학번', '이름', '전화번호'];
        const hasBase = required.every(r => headers.some(h => h.includes(r)));
        if (!hasBase) return false;

        // 평가 항목 컬럼이 "라벨(비율%)" 형태인지 확인
        const evalSource = adminConfig.evaluation.length > 0
            ? adminConfig.evaluation
            : mapping.evalDetected;
        if (evalSource.length === 0) return false;

        const allEvalMatch = evalSource.every(e => {
            const found = headers.find(h => h.startsWith(e.label));
            return !!found;
        });

        // 뒷부분 헤더도 확인
        const hasTail = ['총점', '성적', '석차', '학점', '평점'].some(t => headers.some(h => h.includes(t)));

        return allEvalMatch && hasTail;
    }

    // ── 파이프라인 렌더링 ──
    function renderPipeline(isStandard, rawRows, rawHeaders, converted) {
        const container = document.getElementById('pipeline-steps');
        const filenameEl = document.getElementById('converted-filename');

        if (isStandard) {
            // 표준: [미리보기] → [성적데이터 확정]
            container.innerHTML = `
                <div class="pipe-step">
                    <button class="pipe-btn active" id="pipe-preview">👁 미리보기</button>
                    <span class="pipe-arrow">→</span>
                </div>
                <div class="pipe-step">
                    <button class="pipe-btn" id="pipe-confirm">✅ 성적데이터 확정</button>
                </div>
            `;
            filenameEl.textContent = '';

            // 미리보기 클릭
            document.getElementById('pipe-preview').addEventListener('click', function() {
                renderPreviewTable(converted.rows, converted.headers);
                document.getElementById('upload-preview-table').style.display = '';
                document.getElementById('preview-toolbar').style.display = '';
                this.classList.remove('active');
                this.classList.add('done');
                this.textContent = '✅ 미리보기';
                container.querySelector('.pipe-arrow').classList.add('reached');
                document.getElementById('pipe-confirm').classList.add('active');
            });

            // 확정 클릭
            document.getElementById('pipe-confirm').addEventListener('click', function() {
                if (!this.classList.contains('active')) return;
                confirmUpload();
                this.classList.remove('active');
                this.classList.add('done');
                this.textContent = '✅ 확정 완료';
            });
        } else {
            // 비표준: [표준포맷 변환] → [미리보기] → [변환파일 다운로드] → [성적데이터 확정]
            const forcedName = getConvertedFilename();
            filenameEl.textContent = `📄 변환 파일명: ${forcedName}`;

            container.innerHTML = `
                <div class="pipe-step">
                    <button class="pipe-btn active" id="pipe-convert">🔄 표준포맷으로 변환</button>
                    <span class="pipe-arrow" id="arrow-1">→</span>
                </div>
                <div class="pipe-step">
                    <button class="pipe-btn" id="pipe-preview">👁 변환 파일 미리보기</button>
                    <span class="pipe-arrow" id="arrow-2">→</span>
                </div>
                <div class="pipe-step">
                    <button class="pipe-btn" id="pipe-download">📥 변환 파일 다운로드</button>
                    <span class="pipe-arrow" id="arrow-3">→</span>
                </div>
                <div class="pipe-step">
                    <button class="pipe-btn" id="pipe-confirm">✅ 성적데이터 확정</button>
                </div>
            `;

            // Step 1: 변환
            document.getElementById('pipe-convert').addEventListener('click', function() {
                this.classList.remove('active');
                this.classList.add('done');
                this.textContent = '✅ 변환 완료';
                document.getElementById('arrow-1').classList.add('reached');
                document.getElementById('pipe-preview').classList.add('active');
            });

            // Step 2: 미리보기
            document.getElementById('pipe-preview').addEventListener('click', function() {
                if (!this.classList.contains('active')) return;
                renderPreviewTable(converted.rows, converted.headers);
                document.getElementById('upload-preview-table').style.display = '';
                document.getElementById('preview-toolbar').style.display = '';
                this.classList.remove('active');
                this.classList.add('done');
                this.textContent = '✅ 미리보기';
                document.getElementById('arrow-2').classList.add('reached');
                document.getElementById('pipe-download').classList.add('active');
            });

            // Step 3: 다운로드
            document.getElementById('pipe-download').addEventListener('click', function() {
                if (!this.classList.contains('active')) return;
                downloadConvertedExcel();
                this.classList.remove('active');
                this.classList.add('done');
                this.textContent = '✅ 다운로드 완료';
                document.getElementById('arrow-3').classList.add('reached');
                document.getElementById('pipe-confirm').classList.add('active');
            });

            // Step 4: 확정
            document.getElementById('pipe-confirm').addEventListener('click', function() {
                if (!this.classList.contains('active')) return;
                confirmUpload();
                this.classList.remove('active');
                this.classList.add('done');
                this.textContent = '✅ 확정 완료';
            });
        }

        // 토글 버튼 바인딩
        document.getElementById('btn-preview-toggle').onclick = () => {
            const table = document.getElementById('upload-preview-table');
            const btn = document.getElementById('btn-preview-toggle');
            const isVisible = table.style.display !== 'none';
            table.style.display = isVisible ? 'none' : '';
            btn.textContent = isVisible ? '👁 미리보기 열기 ▾' : '👁 미리보기 접기 ▴';
        };

        document.getElementById('pipeline-area').style.display = '';
    }

    // ── 유연한 컬럼 매핑 ──
    function mapColumns(headers) {
        const find = (keywords, excludeKeywords = []) => {
            for (const kw of keywords) {
                const found = headers.find(h => h.includes(kw) && !excludeKeywords.some(ex => h.includes(ex)));
                if (found) return found;
            }
            return null;
        };

        const mapping = {
            studentId: find(['학번']),
            name:      find(['이름', '성명']),
            year:      find(['학년']),
            dept:      find(['학과', '학부', '전공']),
            classNum:  find(['분반', '반']),
            phone:     find(['전화', '핸드폰', '연락처', '휴대폰']),
            exclude:   find(['상대평가제외사유', '상대평가제외', '제외']),
            special:   find(['특별점수', '특별']),
            total:     find(['총점', '성적', '합계']),
            rank:      find(['석차', '순위', '등수'], ['결석']),
            grade:     find(['학점', '평점', '등급']),
            absences:  find(['결석', '결석횟수', '결석차시']),
            remark:    find(['비고', '메모', '참고']),
            eval: {},  // 평가항목별 매핑
            evalDetected: [], // 자동 감지된 평가 항목
        };

        // 평가 항목 매핑 (adminConfig.evaluation 우선, 없으면 EVAL_ITEMS 전체 탐색)
        const evalSource = adminConfig.evaluation.length > 0
            ? adminConfig.evaluation
            : EVAL_ITEMS.map(e => ({ ...e, ratio: 0 }));

        evalSource.forEach(e => {
            // 1순위: "라벨점수" 또는 "라벨(숫자)" 형태 (예: "퀴즈점수(30)", "출석점수(30)")
            let found = headers.find(h =>
                (h.includes(e.label + '점수') || h.includes(e.label + '(') || h.match(new RegExp(e.label + '\\s*\\(')))
            );
            // 2순위: "라벨"로 시작하는 헤더 중 "점수" 또는 괄호 포함
            if (!found) {
                found = headers.find(h =>
                    h.startsWith(e.label) && (h.includes('점수') || h.includes('('))
                );
            }
            // 3순위: 정확히 "라벨"만 있는 헤더
            if (!found) {
                found = headers.find(h => h === e.label);
            }
            // 4순위: "라벨"을 포함하되, 이미 다른 필드에 사용된 것은 제외
            if (!found) {
                const usedCols = new Set(Object.values(mapping.eval));
                found = headers.find(h =>
                    h.includes(e.label) && !usedCols.has(h)
                );
            }

            if (found) {
                mapping.eval[e.id] = found;
                let ratio = e.ratio || 0;
                if (ratio === 0) {
                    const m = found.match(/\((\d+)%?\)/);
                    if (m) ratio = parseInt(m[1]);
                }
                mapping.evalDetected.push({
                    id: e.id,
                    label: e.label,
                    icon: e.icon || EVAL_ITEMS.find(ei => ei.id === e.id)?.icon || '📊',
                    ratio: ratio,
                });
            }
        });

        return mapping;
    }

    // ── 검증 ──
    function validateMapping(mapping, rows) {
        const checks = [];
        let critical = 0;
        let warnings = 0;

        // 필수: 학번
        if (mapping.studentId) {
            const filled = rows.filter(r => String(r[mapping.studentId] || '').trim()).length;
            checks.push({ status: 'pass', label: '학번', detail: `${filled}건 확인` });
        } else {
            checks.push({ status: 'fail', label: '학번', detail: '열을 찾을 수 없음' });
            critical++;
        }

        // 필수: 이름
        if (mapping.name) {
            checks.push({ status: 'pass', label: '이름', detail: '확인됨' });
        } else {
            checks.push({ status: 'fail', label: '이름', detail: '열을 찾을 수 없음' });
            critical++;
        }

        // 필수: 전화번호 (인증용)
        if (mapping.phone) {
            const filled = rows.filter(r => {
                const p = String(r[mapping.phone] || '').replace(/[^0-9]/g, '');
                return p.length >= 4;
            }).length;
            checks.push({ status: 'pass', label: '전화번호', detail: `${filled}건 유효` });
        } else {
            checks.push({ status: 'fail', label: '전화번호', detail: '열을 찾을 수 없음 (인증 불가)' });
            critical++;
        }

        // 선택: 학과, 분반, 학년
        ['dept', 'classNum', 'year'].forEach(key => {
            const labels = { dept: '학과', classNum: '분반', year: '학년' };
            if (mapping[key]) {
                checks.push({ status: 'pass', label: labels[key], detail: '확인됨' });
            } else {
                checks.push({ status: 'warn', label: labels[key], detail: '없음 (기본값 사용)' });
                warnings++;
            }
        });

        // 평가 항목
        adminConfig.evaluation.forEach(e => {
            if (mapping.eval[e.id]) {
                const vals = rows.map(r => parseFloat(r[mapping.eval[e.id]])).filter(v => !isNaN(v));
                checks.push({ status: 'pass', label: `${e.icon} ${e.label}`, detail: `${vals.length}건, 평균 ${vals.length ? (vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(1) : 0}` });
            } else {
                checks.push({ status: 'warn', label: `${e.icon} ${e.label}`, detail: '열 없음 (0점 처리)' });
                warnings++;
            }
        });

        // 성적, 석차, 평점
        ['total', 'rank', 'grade', 'absences', 'remark'].forEach(key => {
            const labels = { total: '성적', rank: '석차', grade: '평점', absences: '결석', remark: '비고' };
            if (mapping[key]) {
                checks.push({ status: 'pass', label: labels[key], detail: '확인됨' });
            } else {
                checks.push({ status: 'warn', label: labels[key], detail: '없음' });
                warnings++;
            }
        });

        // 분반 수 계산
        let classNums = new Set();
        if (mapping.classNum) {
            rows.forEach(r => classNums.add(String(r[mapping.classNum] || '1')));
        }

        return { checks, critical, warnings, classCount: classNums.size || 1, rowCount: rows.length };
    }

    // ── 검증 보고서 렌더링 ──
    function renderValidationReport(validation, fileName, colCount, rowCount, dataJson = null) {
        const el = document.getElementById('upload-validation');

        const checksHtml = validation.checks.map(c => {
            const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : '⚠️';
            return `<div class="validation-item ${c.status}">
                <span class="v-icon">${icon}</span>
                <span class="v-text">${c.label}</span>
                <span class="v-value">${c.detail}</span>
            </div>`;
        }).join('');

        let strictVerificationHtml = '';
        if (dataJson && dataJson.verificationReport) {
            const report = dataJson.verificationReport;
            const modelText = '✅ <strong>비율 반영 완료</strong> (엑셀에 입력된 값에 추가 비율 가중치 변환 없이 그대로 수집 처리했습니다)';
                
            let mismatchAlert = '';
            if (report.totalMismatches > 0) {
                mismatchAlert = `
                    <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 12px; margin-top: 12px; font-size: 12px; color: #fde047; line-height: 1.5; text-align: left;">
                        ⚠️ <strong>합계 불일치 감지 (${report.totalMismatches}건):</strong> 엑셀의 총점 필드값과 항목별 가중합산(평가항목합산+특별점수) 결과가 다릅니다. 시스템 수식 무결성을 위해 <strong>실제 합산 값으로 자동 보정</strong>되었습니다.
                    </div>
                `;
            } else {
                mismatchAlert = `
                    <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px; padding: 12px; margin-top: 12px; font-size: 12px; color: #86efac; line-height: 1.5; text-align: left;">
                        ✅ 모든 학생의 항목별 가중합산과 엑셀 내 기재된 총점이 일치합니다.
                    </div>
                `;
            }

            strictVerificationHtml = `
                <div class="validation-section" style="margin-top: 20px; border-top: 1px solid var(--border-glass); padding-top: 16px;">
                    <div class="validation-section-title" style="color: #38bdf8; font-weight: 700; margin-bottom: 8px;">🔬 성적 산출 정밀 검증</div>
                    <div class="validation-item pass" style="text-align: left; font-size: 12px; line-height: 1.6; padding: 10px 12px;">
                        ${modelText}
                    </div>
                    ${mismatchAlert}
                </div>
            `;
        }

        el.innerHTML = `
            <div class="validation-report">
                <div class="validation-title">📋 파일 검증 보고서</div>
                <div class="validation-section">
                    <div class="validation-section-title">파일 정보</div>
                    <div class="validation-item pass">
                        <span class="v-icon">📄</span>
                        <span class="v-text">${fileName}</span>
                        <span class="v-value">${colCount}열 × ${rowCount}행</span>
                    </div>
                </div>
                <div class="validation-section">
                    <div class="validation-section-title">컬럼 검증 결과</div>
                    ${checksHtml}
                </div>
                ${strictVerificationHtml}
                <div class="validation-stats">
                    <div class="validation-stat">
                        <div class="validation-stat-value">${rowCount}</div>
                        <div class="validation-stat-label">학생 수</div>
                    </div>
                    <div class="validation-stat">
                        <div class="validation-stat-value">${validation.classCount}</div>
                        <div class="validation-stat-label">분반 수</div>
                    </div>
                    <div class="validation-stat">
                        <div class="validation-stat-value" style="color:${validation.critical > 0 ? '#fca5a5' : '#6ee7b7'}">${validation.critical > 0 ? validation.critical + ' 오류' : '통과'}</div>
                        <div class="validation-stat-label">검증 상태</div>
                    </div>
                </div>
            </div>
        `;
        el.style.display = '';
    }

    // ── 업로드 데이터를 샘플 규격으로 변환 ──
    function convertToSampleFormat(rows, mapping) {
        // 유효한 평가 항목 결정: adminConfig → 자동감지 순
        const effectiveEval = adminConfig.evaluation.length > 0
            ? adminConfig.evaluation
            : mapping.evalDetected;

        // 샘플 규격 헤더
        const baseHeaders = ['학번', '이름', '학년', '학과', '분반', '전화번호', '상대평가제외사유'];
        const evalHeaders = effectiveEval.map(e => {
            const r = e.ratio > 0 ? `(${e.ratio}%)` : '';
            return `${e.label}${r}`;
        });
        const tailHeaders = ['특별점수', '성적', '석차', '평점', '결석', '비고'];
        const sampleHeaders = [...baseHeaders, ...evalHeaders, ...tailHeaders];

        // 각 행을 샘플 규격으로 변환
        const convertedRows = rows.map(row => {
            const out = {};
            out['학번'] = row[mapping.studentId] ?? '';
            out['이름'] = row[mapping.name] ?? '';
            out['학년'] = mapping.year ? (row[mapping.year] ?? '') : '';
            out['학과'] = mapping.dept ? (row[mapping.dept] ?? '') : '';
            out['분반'] = mapping.classNum ? (row[mapping.classNum] ?? 1) : 1;
            out['전화번호'] = mapping.phone ? (row[mapping.phone] ?? '') : '';
            out['상대평가제외사유'] = mapping.exclude ? (row[mapping.exclude] ?? '') : '';

            // 평가 항목
            effectiveEval.forEach((e, idx) => {
                const headerName = evalHeaders[idx];
                const col = mapping.eval[e.id];
                out[headerName] = col ? (row[col] ?? '') : '';
            });

            out['특별점수'] = mapping.special ? (row[mapping.special] ?? '') : '';
            out['성적'] = mapping.total ? (row[mapping.total] ?? '') : '';
            out['석차'] = mapping.rank ? (row[mapping.rank] ?? '') : '';
            out['평점'] = mapping.grade ? (row[mapping.grade] ?? '') : '';
            out['결석'] = mapping.absences ? (row[mapping.absences] ?? 0) : 0;
            out['비고'] = mapping.remark ? (row[mapping.remark] ?? '') : '';

            return out;
        });

        return { headers: sampleHeaders, rows: convertedRows };
    }

    // ── 강제 파일명 생성 ──
    function getConvertedFilename() {
        const { course, professor } = adminConfig;
        const year = course.year || new Date().getFullYear();
        const semester = course.semester || '1학기';
        const subject = course.name || '과목명';
        const profName = professor.name || '교수';
        return `${year}-${semester}_${subject}_${profName}.xlsx`;
    }

    // ── 변환된 Excel 다운로드 ──
    function downloadConvertedExcel() {
        if (!pendingConvertedRows || !pendingConvertedHeaders) return;

        const aoa = [pendingConvertedHeaders];
        pendingConvertedRows.forEach(row => {
            aoa.push(pendingConvertedHeaders.map(h => row[h] ?? ''));
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);

        // 열 너비 설정
        ws['!cols'] = pendingConvertedHeaders.map(h => {
            if (h === '학번' || h === '전화번호') return { wch: 16 };
            if (h === '이름' || h === '학과') return { wch: 12 };
            return { wch: 10 };
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '성적');

        const filename = getConvertedFilename();
        XLSX.writeFile(wb, filename);
    }

    // ── 미리보기 테이블 렌더링 (변환된 데이터 표시) ──
    function renderPreviewTable(rows, headers) {
        if (!rows || rows.length === 0) return;

        // 개인정보 마스킹 처리 (미리보기에서만)
        const maskName = (name) => {
            if (!name || name.length <= 1) return name || '';
            return name[0] + '*'.repeat(name.length - 1);
        };
        const maskId = (id) => {
            const s = String(id || '');
            return s.length > 4 ? s.slice(0, 4) + '****' : s;
        };
        const maskPhone = (phone) => {
            const s = String(phone || '');
            if (s.length <= 4) return '****';
            return s.slice(0, s.length - 4).replace(/./g, '*') + s.slice(-4);
        };

        // 마스킹 대상 컬럼 식별
        const nameCol = headers.find(h => h.includes('이름') || h.includes('성명'));
        const idCol = headers.find(h => h.includes('학번'));
        const phoneCol = headers.find(h => h.includes('전화') || h.includes('핸드폰') || h.includes('연락처'));

        // 컬럼별 정렬 클래스 판단 함수
        const getAlignClass = (h) => {
            const centerKeywords = ['학년', '순번', '석차', '학점', '순위', '학년도', '학기'];
            const numKeywords = ['점수', '총점', '%', '퀴즈', '출석', '과제', '고사', '비율', '비고'];
            if (centerKeywords.some(kw => h.includes(kw))) return 'cell-center';
            if (numKeywords.some(kw => h.includes(kw))) return 'cell-num';
            return ''; // 기본 (left)
        };

        // 헤더 (헤더도 동일한 정렬 적용)
        const thHtml = headers.map(h => {
            const alignCls = getAlignClass(h);
            const clsAttr = alignCls ? ` class="${alignCls}"` : '';
            return `<th${clsAttr}>${h}</th>`;
        }).join('');

        // 행 (최대 200행)
        const displayRows = rows.slice(0, 200);
        const trHtml = displayRows.map(row => {
            const tds = headers.map(h => {
                let v = row[h];
                const alignCls = getAlignClass(h);
                let clsList = [];
                if (alignCls) clsList.push(alignCls);

                // 개인정보 마스킹
                if (h === nameCol) {
                    clsList.push('cell-masked');
                    return `<td class="${clsList.join(' ')}">${maskName(v)}</td>`;
                }
                if (h === idCol) {
                    clsList.push('cell-masked');
                    return `<td class="${clsList.join(' ')}">${maskId(v)}</td>`;
                }
                if (h === phoneCol) {
                    clsList.push('cell-masked');
                    return `<td class="${clsList.join(' ')}">${maskPhone(v)}</td>`;
                }

                // 숫자
                if (typeof v === 'number') {
                    const formatted = v % 1 === 0 ? v : v.toFixed(2);
                    return `<td class="${clsList.join(' ')}">${formatted}</td>`;
                }
                
                const clsAttr = clsList.length > 0 ? ` class="${clsList.join(' ')}"` : '';
                return `<td${clsAttr}>${v ?? ''}</td>`;
            }).join('');
            return `<tr>${tds}</tr>`;
        }).join('');

        const tableEl = document.getElementById('upload-preview-table');
        tableEl.innerHTML = `
            <table class="preview-table">
                <thead><tr>${thHtml}</tr></thead>
                <tbody>${trHtml}</tbody>
            </table>
        `;

        const extra = rows.length > 200 ? ` (200행만 표시, 전체 ${rows.length}명)` : '';
        document.getElementById('preview-count').textContent = `학생 ${rows.length}명${extra}`;
    }

    // ── 확정 처리 ──
    function confirmUpload() {
        if (!pendingUploadData) return;

        const { course } = adminConfig;
        const dataKey = `scorequery_data_${course.year}_${course.semester}_${course.name}`;

        try {
            localStorage.setItem(dataKey, JSON.stringify(pendingUploadData));

            // 과목 목록도 저장 (학생모드 선택용)
            const courseListRaw = localStorage.getItem('scorequery_courses') || '[]';
            const courseList = JSON.parse(courseListRaw);
            const exists = courseList.find(c =>
                c.year === course.year && c.semester === course.semester && c.name === course.name
            );
            if (!exists) {
                courseList.push({
                    year: course.year,
                    semester: course.semester,
                    name: course.name,
                    professor: currentUser ? { name: currentUser.name, email: currentUser.email } : null
                });
                localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
            } else if (currentUser) {
                exists.professor = { name: currentUser.name, email: currentUser.email };
                localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
            }

            // 하위호환: 기존 단일키에도 저장
            localStorage.setItem('scorequery_data', JSON.stringify(pendingUploadData));
        } catch (e) {
            showUploadStatus('error', '⚠️ 데이터 저장 실패 (용량 초과 가능)');
            return;
        }

        const studentCount = Object.keys(pendingUploadData.students).length;
        const classCount = Object.keys(pendingUploadData.class_counts).length;

        document.getElementById('pipeline-area').style.display = 'none';
        showUploadStatus('success',
            `🎉 성적 데이터가 확정되었습니다!\n` +
            `학생 ${studentCount}명 · ${classCount}개 분반\n` +
            `학생 모드에서 공시 후 조회 가능합니다.`);

        pendingUploadData = null;

        // 공시 영역 표시
        showPublishArea();
        renderViewStats();
    }

    async function buildDataJson(rows, headers, mapping, evalPairs, converted = null) {
        const students = {};
        const classStudents = {};

        // 1. 성적 자동 가중치 환산 기능 제거 (입력값 그대로 반영)
        const useWeightedScaling = false;

        let totalMismatches = 0;
        let mismatchDetails = [];

        // 2. 학생별 성적 변환 및 검증 루프
        let rowIndex = 0;
        for (const row of rows) {
            const studentId = String(row[mapping.studentId] || '').trim();
            const name = String(row[mapping.name] || '').trim();
            const phone = mapping.phone ? String(row[mapping.phone] || '').replace(/[^0-9]/g, '') : '';
            const phoneLast4 = phone.slice(-4);
            const dept = mapping.dept ? String(row[mapping.dept] || '').trim() : '';
            const classNum = mapping.classNum ? (parseInt(row[mapping.classNum]) || 1) : 1;
            const absences = mapping.absences ? (parseInt(row[mapping.absences]) || 0) : 0;
            const remark = mapping.remark ? String(row[mapping.remark] || '').trim() : '';
            const grade = mapping.grade ? String(row[mapping.grade] || '').trim() : '';
            const rank = mapping.rank ? String(row[mapping.rank] || '').trim() : '';
            const totalScore = mapping.total ? (parseFloat(row[mapping.total]) || 0) : 0;
            const specialScore = mapping.special ? (parseFloat(row[mapping.special]) || 0) : 0;

            if (!studentId || !phoneLast4) continue;

            const hashKey = await sha256(`${studentId}|${phoneLast4}`);
            const studentIdHash = await sha256(studentId);

            const nameMasked = name.length <= 1 ? name : name[0] + '*'.repeat(name.length - 1);
            const idMasked = studentId.length > 4
                ? studentId.slice(0, 4) + '****'
                : studentId;

            // 평가 점수 수집 및 스케일링 적용
            const scores = {};
            evalPairs.forEach(({ evalItem, colName }) => {
                if (colName) {
                    const rawVal = parseFloat(row[colName]);
                    if (rawVal === '' || rawVal === null || rawVal === undefined || isNaN(rawVal)) {
                        scores[`${evalItem.id}_score`] = null;
                    } else {
                        // 스케일링 적용(비율에 맞춤) 혹은 원본값 그대로 저장
                        scores[`${evalItem.id}_score`] = useWeightedScaling
                            ? parseFloat((rawVal * (evalItem.ratio / 100)).toFixed(2))
                            : rawVal;
                    }
                } else {
                    scores[`${evalItem.id}_score`] = null;
                }
            });

            // 계산 총점 = 평가항목 가중합산 + 특별점수
            const calculatedSum = Object.values(scores).reduce((sum, v) => sum + (v || 0), 0) + specialScore;
            const finalCalculatedTotal = parseFloat(calculatedSum.toFixed(2));

            // 엑셀 총점 우선 사용
            const excelTotal = (mapping.total && row[mapping.total] !== undefined && row[mapping.total] !== '') ? parseFloat(row[mapping.total]) : null;
            const finalTotal = (excelTotal !== null && !isNaN(excelTotal)) ? parseFloat(excelTotal.toFixed(2)) : finalCalculatedTotal;

            // 총점 불일치 검증
            if (mapping.total && totalScore !== 0) {
                if (Math.abs(finalCalculatedTotal - totalScore) > 0.5) {
                    totalMismatches++;
                    mismatchDetails.push({
                        studentId: idMasked,
                        name: nameMasked,
                        excelTotal: totalScore,
                        calcTotal: finalCalculatedTotal
                    });
                }
            }

            // 변환된 행(미리보기 및 다운로드용) 데이터 동기화
            let cRowRef = null;
            if (converted && converted.headers && converted.rows) {
                cRowRef = converted.rows[rowIndex];
                if (cRowRef) {
                    evalPairs.forEach(({ evalItem }) => {
                        const r = evalItem.ratio > 0 ? `(${evalItem.ratio}%)` : '';
                        const headerName = `${evalItem.label}${r}`;
                        const sVal = scores[`${evalItem.id}_score`];
                        cRowRef[headerName] = sVal !== null ? sVal : '';
                    });
                    cRowRef['성적'] = finalTotal;
                }
            }
            rowIndex++;

            const entry = {
                student_id_hash: studentIdHash,
                department: dept,
                class_num: classNum,
                student_id_masked: idMasked,
                name_masked: nameMasked,
                ...scores,
                special_score: specialScore || null,
                total_score: finalTotal,
                rank: rank || `-`,
                grade: grade || '-',
                absences: absences,
                remark: remark,
                _cRow: cRowRef // 임시 참조 저장
            };

            students[hashKey] = entry;

            if (!classStudents[classNum]) classStudents[classNum] = [];
            classStudents[classNum].push(entry);
        }

        // 분반별 평균/최고/인원수
        const classAvg = {};
        const classMax = {};
        const classCounts = {};

        const scoreKeys = adminConfig.evaluation.map(e => `${e.id}_score`);
        scoreKeys.push('total_score');

        for (const [cn, entries] of Object.entries(classStudents)) {
            classCounts[cn] = entries.length;
            classAvg[cn] = {};
            classMax[cn] = {};

            // 자동 석차 및 학점 부여 로직 제거 -> 엑셀 원본 값 그대로 연동
            entries.forEach((e) => {
                if (e.rank === undefined || e.rank === null || e.rank === '') {
                    e.rank = '-';
                } else {
                    e.rank = String(e.rank).trim();
                }

                if (e.grade === undefined || e.grade === null || e.grade === '') {
                    e.grade = '-';
                } else {
                    e.grade = String(e.grade).trim();
                }

                delete e._cRow; // 임시 참조 제거
            });

            scoreKeys.forEach(key => {
                const vals = entries.map(e => e[key]).filter(v => v !== null && v !== undefined);
                if (vals.length > 0) {
                    classAvg[cn][key] = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
                    classMax[cn][key] = Math.max(...vals);
                } else {
                    classAvg[cn][key] = null;
                    classMax[cn][key] = null;
                }
            });
        }

        return {
            course: {
                year: adminConfig.course.year,
                semester: adminConfig.course.semester,
                name: adminConfig.course.name
            },
            professor: {
                name: adminConfig.professor.name,
                email: adminConfig.professor.email
            },
            gas_url: localStorage.getItem('scorequery_gas_url') || '',
            evaluation: adminConfig.evaluation,
            students,
            class_avg: classAvg,
            class_max: classMax,
            class_counts: classCounts,
            verificationReport: {
                useWeightedScaling,
                totalMismatches,
                mismatchDetails
            }
        };
    }

    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function showUploadStatus(type, message) {
        const el = document.getElementById('upload-status');
        el.style.display = 'block';
        el.className = `upload-status ${type}`;
        el.textContent = message;
    }

    // ──────────────────────────────────────────────
    // Event Bindings
    // ──────────────────────────────────────────────
    function bindEvents() {
        // Mode selection
        modeStudentBtn.addEventListener('click', enterStudentMode);
        modeAdminBtn.addEventListener('click', enterAdminMode);
        loginBackBtn.addEventListener('click', showModeSelection);

        // Load config toggle & auth
        document.getElementById('btn-load-toggle').addEventListener('click', () => {
            const form = document.getElementById('load-config-form');
            const isHidden = form.style.display === 'none';
            form.style.display = isHidden ? '' : 'none';
            document.getElementById('load-error').style.display = 'none';
        });
        document.getElementById('btn-load-config').addEventListener('click', loadConfigWithAuth);
        document.getElementById('load-phone4').addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
        });

        // Semester custom toggle
        document.getElementById('course-semester').addEventListener('change', toggleSemesterCustom);

        // Wizard navigation
        document.getElementById('wizard-back-home').addEventListener('click', showModeSelection);

        document.getElementById('wizard-next-1').addEventListener('click', () => {
            if (validateStep1()) goToStep(2);
        });

        document.getElementById('wizard-back-2').addEventListener('click', () => goToStep(1));
        document.getElementById('wizard-save-2').addEventListener('click', saveEarlyConfig);
        document.getElementById('wizard-next-2').addEventListener('click', () => {
            if (validateStep2()) goToStep(3);
        });

        document.getElementById('wizard-back-3').addEventListener('click', () => goToStep(2));
        document.getElementById('wizard-next-3').addEventListener('click', () => {
            if (validateStep3()) goToStep(4);
        });
        document.getElementById('wizard-add-course').addEventListener('click', () => {
            // 현재 평가 저장 (이미 등록된 과목이므로 중복확인 불필요)
            const total = getEvalTotal();
            if (total !== 100) {
                alert(`평가 비율의 합이 100%가 되어야 합니다.\n현재: ${total}%`);
                return;
            }
            // 현재 과목 평가 업데이트
            adminConfig.evaluation = [];
            EVAL_ITEMS.forEach(item => {
                const cb = document.getElementById(`eval-cb-${item.id}`);
                const input = document.getElementById(`eval-ratio-${item.id}`);
                if (cb && cb.checked) {
                    adminConfig.evaluation.push({
                        id: item.id, label: item.label, icon: item.icon,
                        ratio: parseInt(input.value) || 0,
                    });
                }
            });
            const courseEntry = { ...adminConfig.course, evaluation: [...adminConfig.evaluation] };
            const existing = adminConfig.courses.findIndex(c =>
                c.name === adminConfig.course.name &&
                c.year === adminConfig.course.year &&
                c.semester === adminConfig.course.semester
            );
            if (existing >= 0) {
                adminConfig.courses[existing] = courseEntry;
            } else {
                adminConfig.courses.push(courseEntry);
            }
            saveConfig(adminConfig);

            // 새 과목 입력으로 이동
            addAnotherCourse();
        });

        // Complete actions
        document.getElementById('btn-download-excel').addEventListener('click', downloadSampleExcel);
        document.getElementById('btn-go-home').addEventListener('click', showModeSelection);

        // 과목 선택 변경
        document.getElementById('select-course').addEventListener('change', (e) => {
            selectCourse(parseInt(e.target.value));
        });

        // 공시 버튼
        document.getElementById('btn-publish').addEventListener('click', publishGrades);
        document.getElementById('btn-unpublish').addEventListener('click', unpublishGrades);

        // data.json 다운로드 버튼
        const btnDownloadJson = document.getElementById('btn-download-json');
        if (btnDownloadJson) {
            btnDownloadJson.addEventListener('click', downloadDataJson);
        }

        // Upload (파이프라인 버튼은 renderPipeline에서 동적 바인딩)
        setupUpload();
    }

    // ── 마스터/교수 회원 DB 초기화 ──
    async function initUsersDB() {
        // 기존 가입 정보를 1회만 강제 초기화하여 마스터 계정만 남김
        const resetKey = 'scorequery_reset_20260617_v2';
        if (!localStorage.getItem(resetKey)) {
            localStorage.removeItem('scorequery_users');
            sessionStorage.removeItem('scorequery_session');
            localStorage.setItem(resetKey, 'true');
        }

        let users = localStorage.getItem('scorequery_users');
        if (!users) {
            // 마스터 계정 기본 탑재 (armour@tu.ac.kr / armour1234)
            const masterPwHashed = await sha256('armour1234');
            const defaultUsers = [
                {
                    name: '아모르',
                    univ: '동명대학교',
                    dept: '경영학과',
                    email: 'armour@tu.ac.kr',
                    pw: masterPwHashed,
                    phone: '010-9756-5400',
                    status: 'approved',
                    isMaster: true,
                    regDate: new Date().toISOString()
                }
            ];
            localStorage.setItem('scorequery_users', JSON.stringify(defaultUsers));
        }
    }

    async function syncGasUrlFromServer() {
        try {
            const res = await fetch('data.json?_t=' + Date.now());
            if (res.ok) {
                const data = await res.json();
                if (data && data.gas_url) {
                    localStorage.setItem('scorequery_gas_url', data.gas_url);
                    const gasInput = document.getElementById('gas-url-input');
                    if (gasInput) {
                        gasInput.value = data.gas_url;
                    }
                    return data.gas_url;
                }
            }
        } catch (e) {
            console.warn('[ScoreQuery] Failed to sync GAS URL from server:', e);
        }
        return null;
    }

    // ── 인증 세션 처리 초기화 ──
    async function initAuth() {
        await initUsersDB();
        await syncGasUrlFromServer();

        const loginForm = document.getElementById('admin-login-form');
        if (loginForm) loginForm.addEventListener('submit', handleProfLogin);

        const registerForm = document.getElementById('admin-register-form');
        if (registerForm) registerForm.addEventListener('submit', handleProfRegister);

        const regPw = document.getElementById('reg-pw');
        if (regPw) regPw.addEventListener('input', handlePasswordStrength);

        const regLink = document.getElementById('go-to-register');
        if (regLink) regLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('admin-login-card').style.display = 'none';
            document.getElementById('admin-register-card').style.display = '';
        });

        const loginLink = document.getElementById('go-to-login');
        if (loginLink) loginLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('admin-login-card').style.display = '';
            document.getElementById('admin-register-card').style.display = 'none';
        });

        const authBack = document.getElementById('auth-back-home');
        if (authBack) authBack.addEventListener('click', showModeSelection);

        const pendingBack = document.getElementById('pending-back-login');
        if (pendingBack) pendingBack.addEventListener('click', () => {
            currentUser = null;
            document.getElementById('admin-login-form').reset();
            document.getElementById('admin-auth-panel').style.display = '';
            document.getElementById('admin-pending-panel').style.display = 'none';
        });

        const masterLogout = document.getElementById('master-logout-btn');
        if (masterLogout) masterLogout.addEventListener('click', handleLogoutAction);

        const masterChangePw = document.getElementById('master-change-pw-btn');
        if (masterChangePw) masterChangePw.addEventListener('click', showChangePasswordModal);

        const masterBack = document.getElementById('master-back-home');
        if (masterBack) masterBack.addEventListener('click', showModeSelection);

        const adminLogout = document.getElementById('admin-logout-btn');
        if (adminLogout) adminLogout.addEventListener('click', handleLogoutAction);

        const adminChangePw = document.getElementById('admin-change-pw-btn');
        if (adminChangePw) adminChangePw.addEventListener('click', showChangePasswordModal);

        const adminDeleteAccount = document.getElementById('admin-delete-account-btn');
        if (adminDeleteAccount) adminDeleteAccount.addEventListener('click', handleSelfDelete);

        const infoMgmtBtn = document.getElementById('admin-info-mgmt-btn');
        if (infoMgmtBtn) {
            infoMgmtBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                infoMgmtBtn.parentElement.classList.toggle('active');
            });
        }
        document.addEventListener('click', () => {
            if (infoMgmtBtn) {
                infoMgmtBtn.parentElement.classList.remove('active');
            }
        });

        try {
            const sess = sessionStorage.getItem('scorequery_session');
            if (sess) {
                const user = JSON.parse(sess);
                currentUser = user;
                if (user.isMaster) {
                    showMasterDashboard();
                } else if (user.status === 'approved') {
                    document.getElementById('prof-name').value = user.name;
                    document.getElementById('prof-email').value = user.email;
                    document.getElementById('prof-phone').value = user.phone;
                    adminConfig.professor = { name: user.name, email: user.email, phone: user.phone };
                    enterAdminWizard();
                } else if (user.status === 'pending') {
                    showPendingView(user);
                }
            }
        } catch (e) {
            console.error('Session load error:', e);
        }
    }

    async function handleProfLogin(e) {
        e.preventDefault();
        const email = document.getElementById('admin-login-email').value.trim();
        const pw = document.getElementById('admin-login-pw').value.trim();
        const errorEl = document.getElementById('admin-login-error');
        errorEl.style.display = 'none';

        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        
        // 입력 패스워드 SHA-256 해시화 대조
        const pwHashed = await sha256(pw);
        const user = users.find(u => u.email === email && u.pw === pwHashed);

        if (!user) {
            errorEl.textContent = '❌ 이메일 또는 비밀번호가 올바르지 않습니다.';
            errorEl.style.display = 'block';
            return;
        }

        if (user.isMaster) {
            currentUser = user;
            sessionStorage.setItem('scorequery_session', JSON.stringify(user));
            showMasterDashboard();
            return;
        }

        if (user.status === 'pending') {
            currentUser = user;
            showPendingView(user);
            return;
        }

        if (user.status === 'rejected') {
            errorEl.textContent = '❌ 가입 신청이 반려되었습니다. 마스터 교수님께 문의 바랍니다.';
            errorEl.style.display = 'block';
            return;
        }

        if (user.status === 'deleted') {
            errorEl.textContent = '❌ 탈퇴 또는 삭제 처리된 계정입니다. 마스터 교수님께 문의 바랍니다.';
            errorEl.style.display = 'block';
            return;
        }

        currentUser = user;
        sessionStorage.setItem('scorequery_session', JSON.stringify(user));

        document.getElementById('prof-name').value = user.name;
        document.getElementById('prof-email').value = user.email;
        document.getElementById('prof-phone').value = user.phone;
        adminConfig.professor = { name: user.name, email: user.email, phone: user.phone };

        enterAdminWizard();
    }

    async function handleProfRegister(e) {
        e.preventDefault();
        const name = document.getElementById('reg-name').value.trim();
        const univ = document.getElementById('reg-univ').value.trim();
        const dept = document.getElementById('reg-dept').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const pw = document.getElementById('reg-pw').value.trim();
        const pwConfirm = document.getElementById('reg-pw-confirm').value.trim();
        const phone = document.getElementById('reg-phone').value.trim();
        const errorEl = document.getElementById('admin-register-error');
        errorEl.style.display = 'none';

        // 비밀번호 강도 조건 체크: 대소문자, 숫자, 특수문자를 각각 최소 1개 포함하여 8자 이상
        const pwRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
        if (!pwRegex.test(pw)) {
            errorEl.textContent = '❌ 비밀번호는 영문 대소문자, 숫자, 특수문자를 각각 최소 1개 이상 필수 포함하여 8자 이상으로 설정해 주세요.';
            errorEl.style.display = 'block';
            return;
        }

        // 비밀번호 재확인 검증
        if (pw !== pwConfirm) {
            errorEl.textContent = '❌ 비밀번호와 비밀번호 재확인이 일치하지 않습니다.';
            errorEl.style.display = 'block';
            return;
        }

        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const existingUserByEmail = users.find(u => u.email === email);
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        const existingUserByPhone = users.find(u => (u.phone || '').replace(/[^0-9]/g, '') === cleanPhone);

        // 1. 이메일 중복 체크 (사용 중인 계정)
        if (existingUserByEmail && existingUserByEmail.status !== 'deleted') {
            errorEl.textContent = '❌ 이미 등록되었거나 가입 대기 중인 이메일입니다.';
            errorEl.style.display = 'block';
            return;
        }

        // 2. 휴대전화 중복 체크 (사용 중인 계정)
        if (existingUserByPhone && existingUserByPhone.status !== 'deleted') {
            errorEl.textContent = '❌ 이미 등록되었거나 가입 대기 중인 휴대전화 번호입니다.';
            errorEl.style.display = 'block';
            return;
        }

        // 비밀번호 해시화 암호화 보관
        const pwHashed = await sha256(pw);

        // 3. 기존에 탈퇴/삭제된 계정(deleted)이 있을 때 갱신 (재가입 처리)
        if (existingUserByEmail && existingUserByEmail.status === 'deleted') {
            existingUserByEmail.name = name;
            existingUserByEmail.univ = univ;
            existingUserByEmail.dept = dept;
            existingUserByEmail.pw = pwHashed;
            existingUserByEmail.phone = phone;
            existingUserByEmail.status = 'pending';
            existingUserByEmail.regDate = new Date().toISOString();
            if (existingUserByEmail.deletedDate) {
                delete existingUserByEmail.deletedDate;
            }
            
            localStorage.setItem('scorequery_users', JSON.stringify(users));
            currentUser = existingUserByEmail;
            showPendingView(existingUserByEmail);
            return;
        }

        // 4. 신규 회원가입 등록
        const newUser = {
            name, univ, dept, email,
            pw: pwHashed,
            phone,
            status: 'pending',
            isMaster: false,
            regDate: new Date().toISOString()
        };

        users.push(newUser);
        localStorage.setItem('scorequery_users', JSON.stringify(users));

        currentUser = newUser;
        showPendingView(newUser);
    }

    function showPendingView(user) {
        document.getElementById('admin-auth-panel').style.display = 'none';
        document.getElementById('admin-pending-panel').style.display = '';
        document.getElementById('admin-master-panel').style.display = 'none';
        document.getElementById('admin-wizard-container').style.display = 'none';

        const infoEl = document.getElementById('pending-details-info');
        infoEl.innerHTML = `
            <div class="pending-details-row"><span class="pending-details-label">이름:</span> <span class="pending-details-value">${user.name}</span></div>
            <div class="pending-details-row"><span class="pending-details-label">소속 대학:</span> <span class="pending-details-value">${user.univ || '-'}</span></div>
            <div class="pending-details-row"><span class="pending-details-label">소속 학과:</span> <span class="pending-details-value">${user.dept}</span></div>
            <div class="pending-details-row"><span class="pending-details-label">이메일:</span> <span class="pending-details-value">${user.email}</span></div>
            <div class="pending-details-row"><span class="pending-details-label">전화번호:</span> <span class="pending-details-value">${user.phone}</span></div>
            <div class="pending-details-row"><span class="pending-details-label">신청일자:</span> <span class="pending-details-value">${new Date(user.regDate).toLocaleDateString()}</span></div>
        `;

        const mailBtn = document.getElementById('btn-request-approval');
        mailBtn.onclick = () => sendApprovalRequestMail(user);
    }

    function sendApprovalRequestMail(user) {
        const to = 'armour@tu.ac.kr';
        const subjectText = `[ScoreQuery] 교수자 회원가입 승인 요청 - ${user.name} 교수`;
        const bodyText = 
            `아모르 마스터(서창갑 교수님) 귀하,\n\n` +
            `아래 교수님의 ScoreQuery 성적조회시스템 회원가입 승인을 정중히 요청드립니다.\n\n` +
            `[가입 신청 정보]\n` +
            `- 신청자 성명: ${user.name}\n` +
            `- 소속 대학교: ${user.univ || '-'}\n` +
            `- 소속 학과: ${user.dept}\n` +
            `- 이메일 주소: ${user.email}\n` +
            `- 휴대전화 번호: ${user.phone}\n` +
            `- 신청 일시: ${new Date(user.regDate).toLocaleString()}\n\n` +
            `내용을 검토하신 후 아래 마스터 대시보드에 접속하여 가입 승인을 처리해 주시면 대단히 감사하겠습니다.\n\n` +
            `- 마스터 대시보드 주소: https://armour-seo.github.io/ScoreQuery/`;

        sendMail(to, subjectText, bodyText);
    }

    function showMasterDashboard() {
        document.getElementById('admin-auth-panel').style.display = 'none';
        document.getElementById('admin-pending-panel').style.display = 'none';
        document.getElementById('admin-master-panel').style.display = '';
        document.getElementById('admin-wizard-container').style.display = 'none';

        // 마스터 대시보드 진입 시 레이아웃 확장
        adminSection.classList.add('wide-layout');
        if (mainContainer) {
            mainContainer.classList.add('wide-layout');
        }

        // GAS URL 로드 및 바인딩
        const gasInput = document.getElementById('gas-url-input');
        const saveBtn = document.getElementById('save-gas-url-btn');
        const loadGasBtn = document.getElementById('load-gas-url-btn');
        if (gasInput) {
            gasInput.value = localStorage.getItem('scorequery_gas_url') || '';
            if (saveBtn) {
                saveBtn.onclick = () => {
                    const url = gasInput.value.trim();
                    localStorage.setItem('scorequery_gas_url', url);
                    alert(url ? '✅ 자동 메일 발송 URL이 저장되었습니다.' : 'ℹ️ 자동 메일 발송 URL이 삭제되었습니다. 이제 메일은 수동 발송됩니다.');
                };
            }
            if (loadGasBtn) {
                loadGasBtn.onclick = async () => {
                    const loadedUrl = await syncGasUrlFromServer();
                    if (loadedUrl) {
                        gasInput.value = loadedUrl;
                        alert('✅ 서버(data.json)로부터 자동 메일 발송 URL을 성공적으로 가져왔습니다.');
                    } else {
                        alert('ℹ️ 서버의 data.json 파일에 설정된 자동 메일 발송 URL이 없습니다.');
                    }
                };
            }
        }

        const gasHelpBtn = document.getElementById('gas-help-btn');
        if (gasHelpBtn) {
            gasHelpBtn.onclick = showGasGuideModal;
        }

        // 성적 조회 일정 로드 및 바인딩
        const startInput = document.getElementById('schedule-start');
        const endInput = document.getElementById('schedule-end');
        const noticeInput = document.getElementById('schedule-notice');
        const saveSchedBtn = document.getElementById('save-schedule-btn');

        if (startInput && endInput && noticeInput && saveSchedBtn) {
            const schedRaw = localStorage.getItem('scorequery_schedule');
            if (schedRaw) {
                try {
                    const sched = JSON.parse(schedRaw);
                    startInput.value = sched.start || '';
                    endInput.value = sched.end || '';
                    noticeInput.value = sched.notice || '';
                } catch (e) {
                    console.error(e);
                }
            } else {
                startInput.value = '';
                endInput.value = '';
                noticeInput.value = '';
            }

            saveSchedBtn.onclick = () => {
                const startVal = startInput.value;
                const endVal = endInput.value;
                const noticeVal = noticeInput.value.trim();

                if (startVal && endVal && new Date(startVal) >= new Date(endVal)) {
                    alert('❌ 시작 일시가 마감 일시보다 늦거나 같을 수 없습니다.');
                    return;
                }

                if (!startVal && !endVal && !noticeVal) {
                    localStorage.removeItem('scorequery_schedule');
                    alert('ℹ️ 성적 조회 일정이 해제되었습니다. (상시 조회)');
                } else {
                    const sched = { start: startVal, end: endVal, notice: noticeVal };
                    localStorage.setItem('scorequery_schedule', JSON.stringify(sched));
                    alert('✅ 성적 조회 일정이 성공적으로 저장되었습니다.');
                }
            };
        }

        renderMasterPendingList();
    }

    function renderMasterPendingList() {
        const pendingListEl = document.getElementById('master-pending-list');
        const approvedListEl = document.getElementById('master-approved-list');
        const deletedListEl = document.getElementById('master-deleted-list');

        const pendingCountEl = document.getElementById('pending-count-badge');
        const approvedCountEl = document.getElementById('approved-count-badge');
        const deletedCountEl = document.getElementById('deleted-count-badge');

        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const applicants = users.filter(u => !u.isMaster);

        // 1. 가입신청 목록 (status === 'pending' || status === 'rejected')
        const pendingUsers = applicants.filter(u => u.status === 'pending' || u.status === 'rejected');
        // 2. 등록회원 목록 (status === 'approved')
        const approvedUsers = applicants.filter(u => u.status === 'approved');
        // 3. 탈퇴 및 삭제회원 목록 (status === 'deleted')
        const deletedUsers = applicants.filter(u => u.status === 'deleted');

        // 배지 카운트 업데이트
        if (pendingCountEl) pendingCountEl.textContent = pendingUsers.length;
        if (approvedCountEl) approvedCountEl.textContent = approvedUsers.length;
        if (deletedCountEl) deletedCountEl.textContent = deletedUsers.length;

        // ─── 1. 가입 신청 현황 렌더링 ───
        if (pendingListEl) {
            pendingListEl.innerHTML = '';
            if (pendingUsers.length === 0) {
                pendingListEl.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--text-secondary);">회원가입 신청 건이 존재하지 않습니다.</td></tr>';
            } else {
                pendingUsers.forEach((user, idx) => {
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
                    
                    let statusBadge = `<span class="status-badge pending">대기</span>`;
                    if (user.status === 'rejected') statusBadge = `<span class="status-badge rejected">반려됨</span>`;

                    const actionHtml = `
                        <div class="master-actions">
                            <button class="btn-approve" data-email="${user.email}">승인</button>
                            ${user.status === 'pending' ? `<button class="btn-reject" data-email="${user.email}">반려</button>` : ''}
                            <button class="btn-delete-user" data-email="${user.email}">삭제</button>
                        </div>
                    `;

                    tr.innerHTML = `
                        <td style="padding:12px; text-align:center; color:var(--text-secondary);">${idx + 1}</td>
                        <td style="padding:12px;">${user.name}</td>
                        <td style="padding:12px;">${user.univ || '-'}</td>
                        <td style="padding:12px;">${user.dept}</td>
                        <td style="padding:12px;">${user.email}</td>
                        <td style="padding:12px;">${user.phone}</td>
                        <td style="padding:12px;">${new Date(user.regDate).toLocaleDateString()}</td>
                        <td style="padding:12px; text-align:center;">${statusBadge}</td>
                        <td style="padding:12px; text-align:center;">${actionHtml}</td>
                    `;
                    pendingListEl.appendChild(tr);
                });
            }
        }

        // ─── 2. 등록 회원 관리 렌더링 ───
        if (approvedListEl) {
            approvedListEl.innerHTML = '';
            if (approvedUsers.length === 0) {
                approvedListEl.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--text-secondary);">등록된 회원이 존재하지 않습니다.</td></tr>';
            } else {
                approvedUsers.forEach((user, idx) => {
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';

                    const statusBadge = `<span class="status-badge approved">승인됨</span>`;
                    const actionHtml = `
                        <div class="master-actions">
                            <button class="btn-reset-pw" data-email="${user.email}">비밀번호 리셋</button>
                            <button class="btn-reject-approved" data-email="${user.email}" style="background:linear-gradient(135deg, #f59e0b, #d97706); border:none; color:white; padding:6px 12px; border-radius:var(--radius-sm); font-size:12px; cursor:pointer;">반려</button>
                            <button class="btn-delete-user" data-email="${user.email}">삭제</button>
                        </div>
                    `;

                    tr.innerHTML = `
                        <td style="padding:12px; text-align:center; color:var(--text-secondary);">${idx + 1}</td>
                        <td style="padding:12px;">${user.name}</td>
                        <td style="padding:12px;">${user.univ || '-'}</td>
                        <td style="padding:12px;">${user.dept}</td>
                        <td style="padding:12px;">${user.email}</td>
                        <td style="padding:12px;">${user.phone}</td>
                        <td style="padding:12px;">${new Date(user.regDate).toLocaleDateString()}</td>
                        <td style="padding:12px; text-align:center;">${statusBadge}</td>
                        <td style="padding:12px; text-align:center;">${actionHtml}</td>
                    `;
                    approvedListEl.appendChild(tr);
                });
            }
        }

        // ─── 3. 탈퇴 및 삭제 회원 이력 렌더링 ───
        if (deletedListEl) {
            deletedListEl.innerHTML = '';
            if (deletedUsers.length === 0) {
                deletedListEl.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:var(--text-secondary);">탈퇴 및 삭제 회원 이력이 존재하지 않습니다.</td></tr>';
            } else {
                deletedUsers.forEach((user, idx) => {
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';

                    const statusBadge = `<span class="status-badge deleted">삭제됨</span>`;
                    const actionHtml = `
                        <div class="master-actions">
                            <button class="btn-restore" data-email="${user.email}" style="background:linear-gradient(135deg, #6366f1, #4f46e5); border:none; color:white; padding:6px 12px; border-radius:var(--radius-sm); font-size:12px; cursor:pointer;">복구</button>
                        </div>
                    `;

                    const deletedDateStr = user.deletedDate ? new Date(user.deletedDate).toLocaleDateString() : '-';

                    tr.innerHTML = `
                        <td style="padding:12px; text-align:center; color:var(--text-secondary);">${idx + 1}</td>
                        <td style="padding:12px;">${user.name}</td>
                        <td style="padding:12px;">${user.univ || '-'}</td>
                        <td style="padding:12px;">${user.dept}</td>
                        <td style="padding:12px;">${user.email}</td>
                        <td style="padding:12px;">${user.phone}</td>
                        <td style="padding:12px;">${deletedDateStr}</td>
                        <td style="padding:12px; text-align:center;">${statusBadge}</td>
                        <td style="padding:12px; text-align:center;">${actionHtml}</td>
                    `;
                    deletedListEl.appendChild(tr);
                });
            }
        }

        // ─── 이벤트 바인딩 ───
        document.querySelectorAll('.btn-approve').forEach(btn => {
            btn.onclick = () => handleApprove(btn.dataset.email);
        });
        document.querySelectorAll('.btn-reject').forEach(btn => {
            btn.onclick = () => handleReject(btn.dataset.email);
        });
        document.querySelectorAll('.btn-reject-approved').forEach(btn => {
            btn.onclick = () => handleRejectApproved(btn.dataset.email);
        });
        document.querySelectorAll('.btn-reset-pw').forEach(btn => {
            btn.onclick = () => handleResetPassword(btn.dataset.email);
        });
        document.querySelectorAll('.btn-delete-user').forEach(btn => {
            btn.onclick = () => handleDeleteUserByMaster(btn.dataset.email);
        });
        document.querySelectorAll('.btn-restore').forEach(btn => {
            btn.onclick = () => handleRestoreUserByMaster(btn.dataset.email);
        });
    }

    function handleApprove(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        users[idx].status = 'approved';
        localStorage.setItem('scorequery_users', JSON.stringify(users));

        const targetUser = users[idx];
        renderMasterPendingList();

        const to = targetUser.email;
        const subjectText = '[ScoreQuery] 교수 회원가입 승인 완료 안내';
        const bodyText = 
            `${targetUser.name} 교수님 안녕하십니까,\n\n` +
            `성적 조회 및 관리 시스템(ScoreQuery)의 교수 회원가입 신청이 성공적으로 승인 완료되었음을 알려드립니다.\n\n` +
            `이제 아래의 시스템 주소로 접속하신 뒤, 등록하신 교수 이메일(${targetUser.email})과 설정하신 비밀번호로 로그인하여 시스템에 진입하실 수 있습니다.\n\n` +
            `- 시스템 접속 주소: https://armour-seo.github.io/ScoreQuery/\n\n` +
            `감사합니다.\n` +
            `마스터 서창갑(아모르) 드림\n`;

        sendMail(to, subjectText, bodyText);
    }

    async function handleResetPassword(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        const targetUser = users[idx];
        if (!confirm(`⚠️ ${targetUser.name} 교수님의 비밀번호를 초기화하시겠습니까?`)) return;

        // 임시 비밀번호 생성: 이메일 ID + 랜덤 숫자 6자리
        const emailId = email.split('@')[0];
        const randNum = Math.floor(100000 + Math.random() * 900000);
        const tempPw = emailId + randNum;

        // 비밀번호 해시화 저장
        const pwHashed = await sha256(tempPw);
        users[idx].pw = pwHashed;
        localStorage.setItem('scorequery_users', JSON.stringify(users));

        // 메일 클라이언트 및 모달 발송 연동
        const to = targetUser.email;
        const subjectText = '[ScoreQuery] 교수자 계정 비밀번호 초기화 안내';
        const bodyText = 
            `${targetUser.name} 교수님 안녕하십니까,\n\n` +
            `요청하신 ScoreQuery 교수자 계정의 비밀번호가 임시 비밀번호로 초기화되었습니다.\n\n` +
            `- 이메일 ID: ${targetUser.email}\n` +
            `- 임시 비밀번호: ${tempPw}\n\n` +
            `아래의 시스템 주소로 접속하신 후, 임시 비밀번호로 로그인하여 안전한 비밀번호로 변경하여 사용해 주시기 바랍니다.\n\n` +
            `- 시스템 접속 주소: https://armour-seo.github.io/ScoreQuery/\n\n` +
            `감사합니다.\n` +
            `마스터 아모르 드림\n`;

        sendMail(to, subjectText, bodyText);
    }

    function handleReject(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        if (!confirm('정말 본 신청을 반려 처리하시겠습니까?')) return;

        users[idx].status = 'rejected';
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
    }

    function handleRejectApproved(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        if (!confirm('⚠️ 정말 본 회원의 가입 승인을 취소하고 반려 상태로 전환하시겠습니까?\n이 회원은 로그인 권한을 즉시 상실하게 됩니다.')) return;

        users[idx].status = 'rejected';
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
    }

    function handleDeleteUserByMaster(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        const targetUser = users[idx];
        if (!confirm(`⚠️ 정말로 ${targetUser.name} 교수님의 계정을 삭제하시겠습니까?\n계정 정보는 삭제 이력 로그(Soft Delete)에 영구 보존됩니다.`)) return;

        users[idx].status = 'deleted';
        users[idx].deletedDate = new Date().toISOString();
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
        alert(`🗑️ ${targetUser.name} 교수님의 계정이 성공적으로 삭제 처리되어 이력 로그에 기록되었습니다.`);
    }

    function handleRestoreUserByMaster(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        const targetUser = users[idx];
        if (!confirm(`ℹ️ ${targetUser.name} 교수님의 삭제된 계정을 가입 신청(대기) 상태로 복구하시겠습니까?`)) return;

        users[idx].status = 'pending';
        if (users[idx].deletedDate) {
            delete users[idx].deletedDate;
        }
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
        alert(`✨ ${targetUser.name} 교수님의 계정이 가입 대기 상태로 복구되었습니다.`);
    }

    function handleSelfDelete() {
        if (!currentUser) return;
        if (currentUser.isMaster) {
            alert('⚠️ 마스터 계정은 탈퇴할 수 없습니다.');
            return;
        }

        if (!confirm('⚠️ 정말로 회원 탈퇴를 진행하시겠습니까?\n회원 정보는 삭제 이력 로그(Soft Delete)로 보존되며, 마스터 복구 전까지 로그인이 불가능합니다.')) {
            return;
        }

        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === currentUser.email);
        if (idx >= 0) {
            users[idx].status = 'deleted';
            users[idx].deletedDate = new Date().toISOString();
            localStorage.setItem('scorequery_users', JSON.stringify(users));
        }

        alert('🗑️ 회원 탈퇴 처리가 완료되었습니다. 처음 화면으로 돌아갑니다.');
        handleLogoutAction();
    }

    function handleLogoutAction() {
        currentUser = null;
        sessionStorage.removeItem('scorequery_session');
        
        const loginForm = document.getElementById('admin-login-form');
        if (loginForm) loginForm.reset();
        
        const regForm = document.getElementById('admin-register-form');
        if (regForm) regForm.reset();
        
        document.getElementById('admin-auth-panel').style.display = '';
        document.getElementById('admin-login-card').style.display = '';
        document.getElementById('admin-register-card').style.display = 'none';
        
        document.getElementById('admin-pending-panel').style.display = 'none';
        document.getElementById('admin-master-panel').style.display = 'none';
        document.getElementById('admin-wizard-container').style.display = 'none';

        // 로그아웃 시 레이아웃 복원
        adminSection.classList.remove('wide-layout');
        if (mainContainer) {
            mainContainer.classList.remove('wide-layout');
        }

        currentStep = 1;
        topBarTitle.textContent = '📊 성적 관리 시스템';
    }

    function enterAdminWizard() {
        document.getElementById('admin-auth-panel').style.display = 'none';
        document.getElementById('admin-pending-panel').style.display = 'none';
        document.getElementById('admin-master-panel').style.display = 'none';
        document.getElementById('admin-wizard-container').style.display = '';

        // 교수 마법사 진입 시 레이아웃 복원
        adminSection.classList.remove('wide-layout');
        if (mainContainer) {
            mainContainer.classList.remove('wide-layout');
        }

        const deleteBtn = document.getElementById('admin-delete-account-btn');
        if (deleteBtn) {
            deleteBtn.style.display = currentUser && currentUser.isMaster ? 'none' : '';
        }

        goToStep(1);
    }

    // ── 메일 클라이언트 미작동 시 폴백용 모달 ──
    function showMailModal(to, subjectDecoded, bodyDecoded) {
        const existing = document.getElementById('mail-fallback-modal');
        if (existing) existing.remove();

        const modalHtml = `
            <div id="mail-fallback-modal" style="
                position: fixed;
                top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                display: flex; align-items: center; justify-content: center;
                z-index: 99999;
                font-family: inherit;
            ">
                <div style="
                    background: rgba(30, 41, 59, 0.95);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    width: 90%;
                    max-width: 500px;
                    padding: 24px;
                    box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5);
                    color: #f8fafc;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px;">
                        <h3 style="margin: 0; font-size: 1.125rem; font-weight: 600; color: #38bdf8;">📬 메일 발송 안내 (Mail Sandbox)</h3>
                        <button id="close-mail-modal-btn" style="background: none; border: none; color: #94a3b8; font-size: 1.5rem; cursor: pointer; padding: 0 4px; line-height: 1;">&times;</button>
                    </div>
                    
                    <!-- 수동 발송 경고 배너 -->
                    <div style="
                        background: rgba(249, 115, 22, 0.1);
                        border: 1px solid rgba(249, 115, 22, 0.3);
                        border-radius: 8px;
                        padding: 10px 12px;
                        margin-bottom: 16px;
                        font-size: 0.75rem;
                        color: #fdba74;
                        line-height: 1.4;
                        text-align: left;
                    ">
                        ⚠️ <strong>수동 메일(mailto) 경고:</strong> 수동 발송 방식은 아웃룩 등 사용자 로컬 이메일 프로그램 환경에 따라 발송이 누락될 수 있으므로, 안정적인 '자동 메일 발송' 연결을 강력히 권장합니다.
                    </div>

                    <p style="font-size: 0.875rem; color: #cbd5e1; margin-bottom: 16px; line-height: 1.5; margin-top: 0;">
                        기본 메일 프로그램(Outlook, Windows Mail 등)이 자동으로 실행되지 않는 경우, 아래 내용을 복사하여 사용하시는 포털/학교 웹메일에서 직접 발송해 주세요.
                    </p>

                    <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; font-weight: 600;">수신인 (To)</label>
                        <div style="background: rgba(15, 23, 42, 0.6); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); font-size: 0.9rem; word-break: break-all;">${to}</div>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; font-weight: 600;">메일 제목 (Subject)</label>
                        <div style="background: rgba(15, 23, 42, 0.6); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); font-size: 0.9rem; font-weight: 500;">${subjectDecoded}</div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; font-weight: 600;">메일 본문 (Body)</label>
                        <pre style="
                            background: rgba(15, 23, 42, 0.6);
                            padding: 12px;
                            border-radius: 6px;
                            border: 1px solid rgba(255,255,255,0.05);
                            font-size: 0.85rem;
                            font-family: inherit;
                            white-space: pre-wrap;
                            word-break: break-all;
                            max-height: 150px;
                            overflow-y: auto;
                            margin: 0;
                            line-height: 1.5;
                        ">${bodyDecoded}</pre>
                    </div>

                    <div style="display: flex; gap: 8px;">
                        <button id="copy-mail-info-btn" style="
                            flex: 1;
                            background: #0ea5e9;
                            color: white;
                            border: none;
                            padding: 10px;
                            border-radius: 6px;
                            font-size: 0.875rem;
                            font-weight: 500;
                            cursor: pointer;
                            transition: background 0.2s;
                        ">📋 메일 정보 복사하기</button>
                        <button id="open-mail-client-btn" style="
                            flex: 1;
                            background: rgba(255, 255, 255, 0.1);
                            color: white;
                            border: 1px solid rgba(255,255,255,0.2);
                            padding: 10px;
                            border-radius: 6px;
                            font-size: 0.875rem;
                            font-weight: 500;
                            cursor: pointer;
                            transition: background 0.2s;
                        ">✉️ 메일 앱 열기</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById('mail-fallback-modal');
        const closeBtn = document.getElementById('close-mail-modal-btn');
        const copyBtn = document.getElementById('copy-mail-info-btn');
        const openBtn = document.getElementById('open-mail-client-btn');

        closeBtn.onclick = () => modal.remove();
        
        openBtn.onclick = () => {
            const subject = encodeURIComponent(subjectDecoded);
            const body = encodeURIComponent(bodyDecoded);
            window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
        };

        copyBtn.onclick = () => {
            const fullText = `To: ${to}\nSubject: ${subjectDecoded}\n\n${bodyDecoded}`;
            navigator.clipboard.writeText(fullText).then(() => {
                copyBtn.textContent = '✅ 복사 완료!';
                copyBtn.style.background = '#10b981';
                setTimeout(() => {
                    copyBtn.textContent = '📋 메일 정보 복사하기';
                    copyBtn.style.background = '#0ea5e9';
                }, 2000);
            }).catch(err => {
                alert('복사에 실패했습니다. 내용을 직접 드래그하여 복사해 주세요.');
            });
        };
    }

    // ── 구글 앱스 스크립트 기반 메일 발송 처리 ──
    function sendMail(to, subjectText, bodyText) {
        const gasUrl = localStorage.getItem('scorequery_gas_url');
        if (gasUrl) {
            showMailLoading(true);
            
            fetch(gasUrl, {
                method: 'POST',
                mode: 'no-cors', // CORS 우회용 no-cors 모드 (GAS 웹앱 트리거에 최적)
                headers: {
                    'Content-Type': 'text/plain'
                },
                body: JSON.stringify({ to, subject: subjectText, body: bodyText })
            }).then(() => {
                showMailLoading(false);
                alert(`✉️ 자동 메일 발송 요청을 전송했습니다.\n(수신인: ${to})`);
            }).catch(err => {
                showMailLoading(false);
                console.error('[ScoreQuery] GAS Send Mail Error:', err);
                alert('⚠️ 자동 메일 발송 중 오류가 발생했습니다. 수동 발송 창을 띄웁니다.');
                showMailModal(to, subjectText, bodyText);
            });
        } else {
            // 구글 앱스 스크립트 설정이 없으면 기존 메일 클라이언트 및 모달 폴백
            window.location.href = `mailto:${to}?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(bodyText)}`;
            showMailModal(to, subjectText, bodyText);
        }
    }

    // ── 자동 메일 발송 중 오버레이 ──
    function showMailLoading(show) {
        const id = 'mail-loading-overlay';
        let overlay = document.getElementById(id);
        if (show) {
            if (!overlay) {
                const html = `
                    <div id="${id}" style="
                        position: fixed;
                        top: 0; left: 0; width: 100%; height: 100%;
                        background: rgba(15, 23, 42, 0.8);
                        backdrop-filter: blur(4px);
                        display: flex; flex-direction: column; align-items: center; justify-content: center;
                        z-index: 100000;
                        color: #f8fafc;
                        font-family: inherit;
                    ">
                        <div style="
                            border: 4px solid rgba(255,255,255,0.1);
                            border-left-color: #38bdf8;
                            border-radius: 50%;
                            width: 40px; height: 40px;
                            animation: spin 1s linear infinite;
                            margin-bottom: 16px;
                        "></div>
                        <div style="font-size: 13px; font-weight: 500;">✉️ 구글 앱스 스크립트로 자동 메일 발송 중...</div>
                        <style>
                            @keyframes spin {
                                0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); }
                            }
                        </style>
                    </div>
                `;
                document.body.insertAdjacentHTML('beforeend', html);
            }
        } else {
            if (overlay) overlay.remove();
        }
    }

    // ── 비밀번호 변경 모달 대화상자 ──
    function showChangePasswordModal() {
        const modalId = 'change-password-modal';
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        const modalHtml = `
            <div id="${modalId}" style="
                position: fixed;
                top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(15, 23, 42, 0.75);
                backdrop-filter: blur(8px);
                display: flex; align-items: center; justify-content: center;
                z-index: 99999;
                font-family: inherit;
            ">
                <div style="
                    background: rgba(30, 41, 59, 0.95);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    width: 90%;
                    max-width: 400px;
                    padding: 24px;
                    box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5);
                    color: #f8fafc;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px;">
                        <h3 style="margin: 0; font-size: 1.125rem; font-weight: 600; color: #f59e0b;">🔒 비밀번호 변경</h3>
                        <button id="close-pw-modal-btn" style="background: none; border: none; color: #94a3b8; font-size: 1.5rem; cursor: pointer; padding: 0 4px; line-height: 1;">&times;</button>
                    </div>

                    <div style="margin-bottom: 14px;">
                        <label style="display: block; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; margin-bottom: 6px; font-weight: 600;">현재 비밀번호</label>
                        <input type="password" id="change-pw-current" placeholder="현재 비밀번호 입력" style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--border-glass); background: rgba(15,23,42,0.6); color: white; font-size: 13px; outline: none;">
                    </div>

                    <div style="margin-bottom: 14px;">
                        <label style="display: block; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; margin-bottom: 6px; font-weight: 600;">새 비밀번호</label>
                        <input type="password" id="change-pw-new" placeholder="대소문자/숫자/특수문자 포함 8자 이상" style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--border-glass); background: rgba(15,23,42,0.6); color: white; font-size: 13px; outline: none;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; margin-bottom: 6px; font-weight: 600;">새 비밀번호 확인</label>
                        <input type="password" id="change-pw-confirm" placeholder="새 비밀번호 재확인 입력" style="width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid var(--border-glass); background: rgba(15,23,42,0.6); color: white; font-size: 13px; outline: none;">
                    </div>

                    <div id="change-pw-error" style="display: none; color: #f87171; font-size: 12px; margin-bottom: 16px; line-height: 1.4;"></div>

                    <button id="save-pw-change-btn" style="
                        width: 100%;
                        background: linear-gradient(135deg, #f59e0b, #d97706);
                        color: white;
                        border: none;
                        padding: 10px;
                        border-radius: 6px;
                        font-size: 0.875rem;
                        font-weight: 600;
                        cursor: pointer;
                        transition: opacity 0.2s;
                    ">변경사항 저장</button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById(modalId);
        const closeBtn = document.getElementById('close-pw-modal-btn');
        const saveBtn = document.getElementById('save-pw-change-btn');
        const errEl = document.getElementById('change-pw-error');

        closeBtn.onclick = () => modal.remove();

        saveBtn.onclick = async () => {
            errEl.style.display = 'none';

            const currentVal = document.getElementById('change-pw-current').value;
            const newVal = document.getElementById('change-pw-new').value;
            const confirmVal = document.getElementById('change-pw-confirm').value;

            if (!currentVal || !newVal || !confirmVal) {
                errEl.textContent = '❌ 모든 항목을 입력해 주세요.';
                errEl.style.display = 'block';
                return;
            }

            if (!currentUser) {
                errEl.textContent = '❌ 현재 로그인 세션 정보가 없습니다. 다시 로그인해 주세요.';
                errEl.style.display = 'block';
                return;
            }

            // 현재 비밀번호 검증
            const currentHashed = await sha256(currentVal);
            if (currentUser.pw !== currentHashed) {
                errEl.textContent = '❌ 현재 비밀번호가 일치하지 않습니다.';
                errEl.style.display = 'block';
                return;
            }

            // 새 비밀번호 조건 검증 (대소문자, 숫자, 특수문자 8자 이상)
            const pwRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
            if (!pwRegex.test(newVal)) {
                errEl.textContent = '❌ 새 비밀번호는 영문 대소문자, 숫자, 특수문자를 각각 최소 1개 이상 포함하여 8자 이상이어야 합니다.';
                errEl.style.display = 'block';
                return;
            }

            // 비밀번호 일치 검증
            if (newVal !== confirmVal) {
                errEl.textContent = '❌ 새 비밀번호와 새 비밀번호 확인이 일치하지 않습니다.';
                errEl.style.display = 'block';
                return;
            }

            // 새 비밀번호 해시화 및 DB 업데이트
            const newHashed = await sha256(newVal);
            const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
            const idx = users.findIndex(u => u.email === currentUser.email);
            if (idx >= 0) {
                users[idx].pw = newHashed;
                localStorage.setItem('scorequery_users', JSON.stringify(users));
                
                // 세션 정보 갱신
                currentUser.pw = newHashed;
                sessionStorage.setItem('scorequery_session', JSON.stringify(currentUser));
                
                alert('🔑 비밀번호가 성공적으로 변경되었습니다.');
                modal.remove();
            } else {
                alert('⚠️ 비밀번호 변경 중 오류가 발생했습니다. 다시 로그인해 주세요.');
                handleLogoutAction();
            }
        };
    }

    // ── Google Apps Script 자동 메일 발송 설정 가이드 팝업 모달 ──
    function showGasGuideModal() {
        const modalId = 'gas-guide-modal';
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        const gasCode = `function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var to = params.to;
    var subject = params.subject;
    var body = params.body;
    
    // GmailApp을 활용하여 마스터 계정의 Gmail 권한으로 메일을 자동 발송합니다.
    GmailApp.sendEmail(to, subject, body);
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

        const modalHtml = `
            <div id="${modalId}" style="
                position: fixed;
                top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(15, 23, 42, 0.85);
                backdrop-filter: blur(10px);
                display: flex; align-items: center; justify-content: center;
                z-index: 99999;
                font-family: inherit;
            ">
                <div style="
                    background: rgba(30, 41, 59, 0.98);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 20px;
                    width: 90%;
                    max-width: 680px;
                    padding: 28px;
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
                    color: white;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    max-height: 90vh;
                ">
                    <!-- 헤더 -->
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 14px;">
                        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
                            <span>⚙️ Google Apps Script 자동 메일 발송 설정 가이드</span>
                        </h3>
                        <span id="close-guide-btn" style="cursor: pointer; font-size: 20px; color: var(--text-secondary); transition: color 0.2s;">&times;</span>
                    </div>

                    <!-- 바디 (스크롤 지원) -->
                    <div style="overflow-y: auto; flex: 1; padding-right: 8px; font-size: 13px; line-height: 1.6; display: flex; flex-direction: column; gap: 16px;">
                        <p style="margin: 0; color: var(--text-secondary); font-size: 12.5px;">
                            이 가이드는 마스터 승인/반려/비밀번호 초기화 처리 시, 이메일 프로그램(Outlook 등)을 수동으로 켜지 않고 브라우저 백그라운드에서 <strong>메일을 자동으로 즉시 발송</strong>되게 만드는 구글 스크립트 웹 앱 세팅 절차입니다. 
                        </p>

                        <!-- Step 1 -->
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 16px;">
                            <div style="font-weight: 700; font-size: 13.5px; color: #f59e0b; margin-bottom: 8px;">1. 구글 앱스 스크립트 콘솔 접속</div>
                            <div style="color: var(--text-primary);">
                                • <a href="https://script.google.com/" target="_blank" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">Google Apps Script 콘솔 (https://script.google.com/)</a>에 접속하여 로그인합니다.<br>
                                • 왼쪽 상단의 <strong>[새 프로젝트]</strong> (New Project) 버튼을 클릭하여 스크립트 에디터 창을 엽니다.
                            </div>
                        </div>

                        <!-- Step 2 -->
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 16px;">
                            <div style="font-weight: 700; font-size: 13.5px; color: #f59e0b; margin-bottom: 8px;">2. 스크립트 코드 작성 및 저장</div>
                            <div style="color: var(--text-primary); margin-bottom: 10px;">
                                • 기존 에디터에 자동으로 적혀 있는 기본 코드(function myFunction... )를 **전부 삭제**합니다.<br>
                                • 아래의 통합 API 코드를 복사하여 에디터에 붙여넣습니다:
                            </div>
                            
                            <!-- 코드 박스 -->
                            <div style="position: relative;">
                                <button id="btn-copy-gas" style="
                                    position: absolute; right: 8px; top: 8px;
                                    background: rgba(56, 189, 248, 0.15);
                                    border: 1px solid rgba(56, 189, 248, 0.4);
                                    color: #38bdf8; padding: 4px 10px; border-radius: 4px;
                                    font-size: 11px; font-weight: 600; cursor: pointer;
                                    transition: all 0.2s;
                                ">코드 복사</button>
                                <pre style="
                                    margin: 0;
                                    background: rgba(15, 23, 42, 0.8);
                                    border: 1px solid rgba(255, 255, 255, 0.08);
                                    padding: 14px; border-radius: 8px;
                                    font-family: monospace; font-size: 11px; color: #a5b4fc;
                                    overflow-x: auto; line-height: 1.5; max-height: 160px;
                                ">${gasCode}</pre>
                            </div>
                            
                            <div style="color: var(--text-primary); margin-top: 10px;">
                                • 에디터 상단의 <strong>[저장]</strong> 아이콘(디스켓 모양)을 클릭하거나 \`Ctrl + S\`를 눌러 저장합니다. (프로젝트명은 예: <i>ScoreQueryMailer</i> 로 자유롭게 작성)
                            </div>
                        </div>

                        <!-- Step 3 -->
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 16px;">
                            <div style="font-weight: 700; font-size: 13.5px; color: #f59e0b; margin-bottom: 8px;">3. 웹 앱(Web App)으로 배포 (★핵심 설정)</div>
                            <div style="color: var(--text-primary);">
                                • 우측 상단의 파란색 <strong>[배포] -> [새 배포]</strong> (Deploy -> New Deployment)를 클릭합니다.<br>
                                • 유형 선택(톱니바퀴 아이콘)을 누르고 <strong>[웹 앱]</strong> (Web App)을 선택합니다.<br>
                                • 옵션 설정 값을 아래 내용과 **정확하게 동일하게 지정**해야 합니다 (틀릴 시 작동 불가):
                                <div style="background: rgba(15, 23, 42, 0.4); border-left: 3px solid #0ea5e9; padding: 10px 14px; margin: 10px 0; border-radius: 4px; font-size: 12px; line-height: 1.7;">
                                    1. <strong>설명</strong>: <span style="color: var(--text-secondary);">ScoreQuery Mail Service (자유 입력)</span><br>
                                    2. <strong>웹 앱을 실행할 사용자</strong>: <strong style="color: #38bdf8;">나 (본인 이메일 계정)</strong><br>
                                    3. <strong>액세스 권한이 있는 사용자</strong>: <strong style="color: #ef4444;">모든 사용자 (Anyone)</strong>
                                </div>
                                <span style="font-size: 11px; color: #fbbf24; display: block; margin-bottom: 8px;">⚠️ \'액세스 권한이 있는 사용자\'를 \'모든 사용자(Anyone)\'로 개방하지 않으면, ScoreQuery 대시보드 브라우저 환경에서 API 호출 시 권한 차단(CORS 정책 위반) 에러가 발생합니다.</span>
                                • 하단의 <strong>[배포]</strong> (Deploy) 버튼을 클릭합니다.
                            </div>
                        </div>

                        <!-- Step 4 -->
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 16px;">
                            <div style="font-weight: 700; font-size: 13.5px; color: #f59e0b; margin-bottom: 8px;">4. 구글 보안 액세스 승인 (경고 대처법)</div>
                            <div style="color: var(--text-primary);">
                                • 배포 진행 중에 <strong>[액세스 권한 승인]</strong> (Authorize Access) 버튼 팝업이 나타나면 클릭 후 본인 구글 계정을 선택합니다.<br>
                                • <i>\'Google에서 이 앱을 확인하지 않았습니다\'</i> (Google hasn\'t verified this app)라는 위협적인 경고가 표시되면:<br>
                                &nbsp;&nbsp;&nbsp;&nbsp;1. 당황하지 마시고 좌측 하단의 회색 글씨 <strong>[고급]</strong> (Advanced) 링크를 클릭합니다.<br>
                                &nbsp;&nbsp;&nbsp;&nbsp;2. 아래쪽에 새롭게 나타나는 <strong>[프로젝트명(으)로 이동(안전하지 않음)]</strong> (Go to ProjectName (unsafe)) 링크를 누릅니다.<br>
                                &nbsp;&nbsp;&nbsp;&nbsp;3. 권한 요약 확인 창에서 우측 하단의 <strong>[허용]</strong> (Allow) 버튼을 최종 클릭합니다.
                            </div>
                        </div>

                        <!-- Step 5 -->
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 16px;">
                            <div style="font-weight: 700; font-size: 13.5px; color: #f59e0b; margin-bottom: 8px;">5. 웹 앱 URL 등록 및 완성</div>
                            <div style="color: var(--text-primary);">
                                • 배포가 완료되면 화면에 생성되는 **[웹 앱 URL]** 주소를 복사합니다.<br>
                                <span style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 8px;">(예시 포맷: https://script.google.com/macros/s/AKfycb.../exec)</span>
                                • 이 가이드 모달을 닫고, 마스터 대시보드의 **[자동 메일 발송 설정]** 주소창에 붙여넣은 뒤 <strong>[저장]</strong>을 클릭하면 모든 준비가 완료됩니다.
                            </div>
                        </div>

                        <!-- 💡 팁 -->
                        <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; padding: 16px;">
                            <div style="font-weight: 700; font-size: 13px; color: #10b981; margin-bottom: 6px;">💡 꼭 기억하세요!</div>
                            <div style="color: var(--text-secondary); font-size: 12px; line-height: 1.5;">
                                • 메일은 이 스크립트를 배포한 구글 계정의 Gmail 권한으로 발송되며, 본인의 **보낸편지함**에서 실시간 발송 내역을 조회할 수 있습니다.<br>
                                • 주소를 지우거나 비워둔 채 저장하면 메일 Sandbox 팝업(mailto 수동 승인 창)으로 자동 폴백 처리됩니다.
                            </div>
                        </div>
                    </div>

                    <!-- 푸터 -->
                    <div style="display: flex; justify-content: flex-end; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 14px;">
                        <button id="close-guide-confirm-btn" style="
                            background: linear-gradient(135deg, #0ea5e9, #2563eb);
                            color: white; border: none; padding: 8px 24px; border-radius: 8px;
                            font-size: 12.5px; font-weight: 600; cursor: pointer;
                            transition: opacity 0.2s;
                        ">이해했습니다</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = document.getElementById(modalId);
        const closeBtn = document.getElementById('close-guide-btn');
        const confirmBtn = document.getElementById('close-guide-confirm-btn');
        const copyBtn = document.getElementById('btn-copy-gas');

        const closeModal = () => modal.remove();
        closeBtn.onclick = closeModal;
        confirmBtn.onclick = closeModal;

        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        copyBtn.onclick = () => {
            navigator.clipboard.writeText(gasCode).then(() => {
                copyBtn.textContent = '복사 완료!';
                copyBtn.style.background = 'rgba(16, 185, 129, 0.2)';
                copyBtn.style.color = '#10b981';
                copyBtn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                setTimeout(() => {
                    copyBtn.textContent = '코드 복사';
                    copyBtn.style.background = 'rgba(56, 189, 248, 0.15)';
                    copyBtn.style.color = '#38bdf8';
                    copyBtn.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                }, 2000);
            }).catch(err => {
                alert('코드 복사에 실패했습니다. 직접 선택하여 복사해 주세요.');
            });
        };
    }

    function renderViewStats() {
        const widget = document.getElementById('course-view-stats-widget');
        const textEl = document.getElementById('course-view-stats-text');
        const fillEl = document.getElementById('course-view-stats-fill');
        if (!widget || !textEl || !fillEl) return;

        const { course } = adminConfig;
        if (!course || !course.name) {
            widget.style.display = 'none';
            return;
        }

        const dataKey = `scorequery_data_${course.year}_${course.semester}_${course.name}`;
        const rawData = localStorage.getItem(dataKey);
        if (!rawData) {
            widget.style.display = 'block';
            textEl.innerHTML = `📚 <strong>${course.year} ${course.semester} — ${course.name}</strong><br>성적 데이터가 업로드되지 않았습니다. Excel 파일을 업로드해 주세요.`;
            fillEl.style.width = '0%';
            return;
        }

        try {
            const parsed = JSON.parse(rawData);
            const studentEntries = Object.values(parsed.students || {});
            const totalCount = studentEntries.length;
            if (totalCount === 0) {
                widget.style.display = 'block';
                textEl.innerHTML = `📚 <strong>${course.year} ${course.semester} — ${course.name}</strong><br>등록된 수강생이 없습니다.`;
                fillEl.style.width = '0%';
                return;
            }

            // check if we have hashes
            const hasHashes = studentEntries.some(s => s.student_id_hash);
            if (!hasHashes) {
                widget.style.display = 'block';
                textEl.innerHTML = `📚 <strong>${course.year} ${course.semester} — ${course.name}</strong><br>⚠️ 기존 데이터 형식을 사용 중입니다. 성적 Excel 파일을 다시 업로드하면 실시간 열람 통계가 제공됩니다.`;
                fillEl.style.width = '0%';
                return;
            }

            const viewLogs = JSON.parse(localStorage.getItem('scorequery_view_logs') || '[]');
            const subjectId = `${course.year}_${course.semester}_${course.name}`;
            const subjectLogs = viewLogs.filter(log => log.subjectId === subjectId);
            const viewedHashes = new Set(subjectLogs.map(log => log.sidHash));

            let viewedCount = 0;
            studentEntries.forEach(s => {
                if (s.student_id_hash && viewedHashes.has(s.student_id_hash)) {
                    viewedCount++;
                }
            });

            const percent = ((viewedCount / totalCount) * 100).toFixed(1);
            widget.style.display = 'block';
            textEl.innerHTML = `📚 <strong>${course.year} ${course.semester} — ${course.name}</strong><br>현재 수강생 총 <strong>${totalCount}</strong>명 중 <strong>${viewedCount}</strong>명(열람율 <strong>${percent}%</strong>)이 성적을 확인했습니다.`;
            fillEl.style.width = `${percent}%`;

        } catch (e) {
            console.error('Error rendering view stats:', e);
            widget.style.display = 'none';
        }
    }

    function handlePasswordStrength(e) {
        const val = e.target.value;
        let score = 0;
        if (val.length >= 8) score++;
        if (val.length >= 12) score++;
        if (/[a-z]/.test(val)) score++;
        if (/[A-Z]/.test(val)) score++;
        if (/\d/.test(val)) score++;
        if (/[!@#$%^&*(),.?":{}|<>_+\-=\[\]{};':"\\|,.<>\/?]/.test(val)) score++;

        const textEl = document.getElementById('pw-strength-text');
        const bar1 = document.getElementById('pw-strength-bar-1');
        const bar2 = document.getElementById('pw-strength-bar-2');
        const bar3 = document.getElementById('pw-strength-bar-3');
        const bar4 = document.getElementById('pw-strength-bar-4');

        if (!textEl || !bar1 || !bar2 || !bar3 || !bar4) return;

        // Reset colors
        bar1.style.backgroundColor = 'transparent';
        bar2.style.backgroundColor = 'transparent';
        bar3.style.backgroundColor = 'transparent';
        bar4.style.backgroundColor = 'transparent';

        if (!val) {
            textEl.textContent = '매우 위험';
            textEl.style.color = '#ef4444';
            return;
        }

        if (score <= 2) {
            textEl.textContent = '매우 위험';
            textEl.style.color = '#ef4444';
            bar1.style.backgroundColor = '#ef4444';
        } else if (score === 3 || score === 4) {
            textEl.textContent = '약함';
            textEl.style.color = '#f97316';
            bar1.style.backgroundColor = '#f97316';
            bar2.style.backgroundColor = '#f97316';
        } else if (score === 5) {
            textEl.textContent = '보통';
            textEl.style.color = '#eab308';
            bar1.style.backgroundColor = '#eab308';
            bar2.style.backgroundColor = '#eab308';
            bar3.style.backgroundColor = '#eab308';
        } else {
            textEl.textContent = '안전';
            textEl.style.color = '#22c55e';
            bar1.style.backgroundColor = '#22c55e';
            bar2.style.backgroundColor = '#22c55e';
            bar3.style.backgroundColor = '#22c55e';
            bar4.style.backgroundColor = '#22c55e';
        }
    }

    // Expose mode functions for app.js
    window.ScoreQueryAdmin = {
        showModeSelection,
        enterStudentMode,
    };
    
    // (이하 소스코드의 종료 브래킷)
})();
