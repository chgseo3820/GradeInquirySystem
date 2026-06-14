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

    const modeAdminBtn   = document.getElementById('mode-admin-btn');
    const modeStudentBtn = document.getElementById('mode-student-btn');
    const loginBackBtn   = document.getElementById('login-back-btn');

    // ── Initialize ──
    try {
        initYearOptions();
        initEvalCriteria();
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
        goToStep(1);
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

        // Step 4 = complete
        if (step === 4) {
            renderCourseSelector();
            renderCompleteSummary();
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
            localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
        }

        updatePublishStatusDisplay(info);
        alert('📢 성적이 공시되었습니다!');
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
        const baseHeaders = ['학번', '이름', '학년', '학과', '분반', '전화번호', '상대평가제외'];
        const evalHeaders = evaluation.map(e => `${e.label}(${e.ratio}%)`);
        const headers = [...baseHeaders, ...evalHeaders, '특별점수', '총점', '석차', '학점', '결석', '비고'];

        // 상대평가제외 유효값 안내 (데이터 유효성 검사용)
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

        // 상대평가제외 열에 셀 코멘트 추가 (마우스 올릴 때만 표시)
        const exclColIdx = baseHeaders.indexOf('상대평가제외');
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
            const dataJson = await buildDataJson(rows, headers, mapping, evalPairs);
            pendingUploadData = dataJson;

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
        const hasTail = ['총점', '석차', '학점'].some(t => headers.some(h => h.includes(t)));

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
                renderPreviewTable(rawRows, rawHeaders);
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
        const find = (keywords) => {
            for (const kw of keywords) {
                const found = headers.find(h => h.includes(kw));
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
            exclude:   find(['상대평가제외', '제외']),
            special:   find(['특별점수', '특별']),
            total:     find(['총점', '합계']),
            rank:      find(['석차', '순위', '등수']),
            grade:     find(['학점', '등급']),
            absences:  find(['결석', '결석횟수']),
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

        // 총점, 석차, 학점
        ['total', 'rank', 'grade', 'absences', 'remark'].forEach(key => {
            const labels = { total: '총점', rank: '석차', grade: '학점', absences: '결석', remark: '비고' };
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
    function renderValidationReport(validation, fileName, colCount, rowCount) {
        const el = document.getElementById('upload-validation');

        const checksHtml = validation.checks.map(c => {
            const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : '⚠️';
            return `<div class="validation-item ${c.status}">
                <span class="v-icon">${icon}</span>
                <span class="v-text">${c.label}</span>
                <span class="v-value">${c.detail}</span>
            </div>`;
        }).join('');

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
        const baseHeaders = ['학번', '이름', '학년', '학과', '분반', '전화번호', '상대평가제외'];
        const evalHeaders = effectiveEval.map(e => {
            const r = e.ratio > 0 ? `(${e.ratio}%)` : '';
            return `${e.label}${r}`;
        });
        const tailHeaders = ['특별점수', '총점', '석차', '학점', '결석', '비고'];
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
            out['상대평가제외'] = mapping.exclude ? (row[mapping.exclude] ?? '') : '';

            // 평가 항목
            effectiveEval.forEach((e, idx) => {
                const headerName = evalHeaders[idx];
                const col = mapping.eval[e.id];
                out[headerName] = col ? (row[col] ?? '') : '';
            });

            out['특별점수'] = mapping.special ? (row[mapping.special] ?? '') : '';
            out['총점'] = mapping.total ? (row[mapping.total] ?? '') : '';
            out['석차'] = mapping.rank ? (row[mapping.rank] ?? '') : '';
            out['학점'] = mapping.grade ? (row[mapping.grade] ?? '') : '';
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

        // 헤더
        const thHtml = headers.map(h => `<th>${h}</th>`).join('');

        // 행 (최대 200행)
        const displayRows = rows.slice(0, 200);
        const trHtml = displayRows.map(row => {
            const tds = headers.map(h => {
                let v = row[h];
                // 개인정보 마스킹
                if (h === nameCol) return `<td class="cell-masked">${maskName(v)}</td>`;
                if (h === idCol) return `<td class="cell-masked">${maskId(v)}</td>`;
                if (h === phoneCol) return `<td class="cell-masked">${maskPhone(v)}</td>`;
                // 숫자
                if (typeof v === 'number') {
                    return `<td class="cell-num">${v % 1 === 0 ? v : v.toFixed(2)}</td>`;
                }
                return `<td>${v ?? ''}</td>`;
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
                courseList.push({ year: course.year, semester: course.semester, name: course.name });
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
    }

    async function buildDataJson(rows, headers, mapping, evalPairs) {
        const students = {};
        const classStudents = {};

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

            const hashKey = await sha256(`${studentId}:${phoneLast4}`);

            const nameMasked = name.length <= 1 ? name : name[0] + '*'.repeat(name.length - 1);
            const idMasked = studentId.length > 4
                ? studentId.slice(0, 4) + '****'
                : studentId;

            // 평가 점수 수집 (쌍 기반 — 인덱스 어긋남 없음)
            const scores = {};
            evalPairs.forEach(({ evalItem, colName }) => {
                if (colName) {
                    const val = row[colName];
                    scores[`${evalItem.id}_score`] = val === '' || val === null || val === undefined
                        ? null
                        : parseFloat(val);
                } else {
                    scores[`${evalItem.id}_score`] = null;
                }
            });

            // 총점 자동 계산 (없으면 평가항목 합산 + 특별점수)
            let calcTotal = totalScore;
            if (!mapping.total || totalScore === 0) {
                calcTotal = Object.values(scores).reduce((sum, v) => sum + (v || 0), 0) + specialScore;
            }

            const entry = {
                department: dept,
                class_num: classNum,
                student_id_masked: idMasked,
                name_masked: nameMasked,
                ...scores,
                special_score: specialScore || null,
                total_score: calcTotal,
                rank: rank || `- / -`,
                grade: grade || '',
                absences: absences,
                remark: remark,
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
            students,
            class_avg: classAvg,
            class_max: classMax,
            class_counts: classCounts,
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

        // Upload (파이프라인 버튼은 renderPipeline에서 동적 바인딩)
        setupUpload();
    }

    // Expose mode functions for app.js
    window.ScoreQueryAdmin = {
        showModeSelection,
        enterStudentMode,
    };
})();
