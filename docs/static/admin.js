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
    const PROFESSOR_SESSION_KEY = 'scorequery_session';
    const PROFESSOR_SESSION_LAST_ACTIVITY_KEY = 'scorequery_session_last_activity';
    const PROFESSOR_SESSION_TIMEOUT_MS = 10 * 60 * 1000;
    let professorSessionTimeoutId = null;
    let professorSessionLastTouch = 0;
    let professorSessionTimedOut = false;
    let adminConfig = {
        professor: { name: '', email: '', phone: '' },
        course: { year: '', semester: '', name: '' },
        evaluation: [], // [{ id, label, icon, ratio }]
        courses: [],    // [{ year, semester, name, evaluation: [...] }]
    };
    const gradingTableState = {
        step5a: { sortKey: 'total_score', direction: 'desc', classFilter: 'all' },
        step5c: { sortKey: 'total_score', direction: 'desc', classFilter: 'all' },
    };

    function getCourseId(course) {
        if (!course) return '';
        if (course.id) return String(course.id);
        return [course.year || '', course.semester || '', course.name || '']
            .join('_')
            .replace(/\s+/g, '_')
            .replace(/[^\w가-힣.-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    function withCourseId(course) {
        return { ...course, id: getCourseId(course) };
    }

    function getCourseDataKeys(course) {
        const idKey = `scorequery_data_${getCourseId(course)}`;
        const legacyKey = `scorequery_data_${course.year}_${course.semester}_${course.name}`;
        return Array.from(new Set([idKey, legacyKey]));
    }

    function getCourseDataKey(course) {
        return getCourseDataKeys(course)[0];
    }

    function getCoursePublishKeys(course) {
        const idKey = `scorequery_publish_${getCourseId(course)}`;
        const legacyKey = `scorequery_publish_${course.year}_${course.semester}_${course.name}`;
        return Array.from(new Set([idKey, legacyKey]));
    }

    function getCoursePublishKey(course) {
        return getCoursePublishKeys(course)[0];
    }

    function hasCourseAuthority(course) {
        if (!currentUser) return false;
        if (currentUser.isMaster === true || currentUser.isMaster === 'true') return true;
        if (course && course.professor && course.professor.email === currentUser.email) return true;
        return false;
    }

    function uniqueNonEmpty(values) {
        const seen = new Set();
        const result = [];
        values.forEach(value => {
            const text = String(value || '').trim();
            if (text && !seen.has(text)) {
                seen.add(text);
                result.push(text);
            }
        });
        return result;
    }

    function hasRelativeExclusionMarker(text) {
        const normalized = String(text || '').replace(/\s+/g, '');
        return normalized.includes('상대평가제외');
    }

    function getRelativeExclusionReason(st) {
        const remark = String(st.remark || '').trim();
        const reasonParts = [
            st.relative_exclusion_reason,
            st.exclude_reason,
            st.extra_memo
        ];
        if (hasRelativeExclusionMarker(remark)) {
            reasonParts.push(remark);
        }
        return uniqueNonEmpty(reasonParts).join(' / ');
    }

    function applyRelativeExclusionMemo(st) {
        const reason = getRelativeExclusionReason(st);
        if (reason) {
            st.relative_exclusion_reason = reason;
            st.is_relative_excluded = true;
        } else if (st.is_relative_excluded === undefined) {
            st.is_relative_excluded = false;
        }
    }

    const LOCAL_ADMIN_TOKEN_KEY = 'scorequery_admin_token_session';

    function getLocalBackendOrigin() {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return window.location.origin;
        }
        const configuredApiUrl = (localStorage.getItem('scorequery_api_url') || '').trim().replace(/\/+$/, '');
        if (configuredApiUrl) return configuredApiUrl;
        return 'http://127.0.0.1:5000';
    }

    function getSessionAdminToken(forcePrompt = false) {
        if (!forcePrompt) {
            const existing = sessionStorage.getItem(LOCAL_ADMIN_TOKEN_KEY);
            if (existing) return existing;
        }
        const token = prompt('로컬 Flask 관리자 API 토큰(SCOREQUERY_ADMIN_TOKEN)을 입력하세요:');
        if (!token) return '';
        const trimmed = token.trim();
        if (trimmed) {
            sessionStorage.setItem(LOCAL_ADMIN_TOKEN_KEY, trimmed);
        }
        return trimmed;
    }

    async function postLocalAdminJson(path, payload) {
        let token = getSessionAdminToken(false);
        if (!token) {
            return { success: false, error: '관리자 API 토큰이 입력되지 않았습니다.' };
        }

        const send = async (adminToken) => {
            const response = await fetch(`${getLocalBackendOrigin()}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': adminToken
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            return { response, result };
        };

        let { response, result } = await send(token);
        if (response.status === 401) {
            sessionStorage.removeItem(LOCAL_ADMIN_TOKEN_KEY);
            token = getSessionAdminToken(true);
            if (!token) {
                return { success: false, error: '관리자 API 토큰이 입력되지 않았습니다.' };
            }
            ({ response, result } = await send(token));
        }

        if (!response.ok) {
            return { success: false, error: result.error || `HTTP ${response.status}` };
        }
        return result;
    }

    async function getLocalAdminJson(path) {
        const token = sessionStorage.getItem(LOCAL_ADMIN_TOKEN_KEY);
        if (!token) return null;
        try {
            const response = await fetch(`${getLocalBackendOrigin()}${path}`, {
                method: 'GET',
                headers: { 'X-Admin-Token': token }
            });
            if (response.status === 401) {
                sessionStorage.removeItem(LOCAL_ADMIN_TOKEN_KEY);
                return null;
            }
            const result = await response.json().catch(() => ({}));
            return response.ok ? result : null;
        } catch (e) {
            return null;
        }
    }

    function hasConfiguredServerApi() {
        const configuredApiUrl = (localStorage.getItem('scorequery_api_url') || '').trim();
        return !!configuredApiUrl || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    }

    function markServerAuthUser(user) {
        if (!user) return null;
        return { ...user, _authProvider: 'server' };
    }

    async function callServerJson(path, { method = 'GET', payload = null } = {}) {
        if (!hasConfiguredServerApi()) {
            throw new Error('성적 조회 API URL이 설정되지 않았습니다.');
        }
        const options = {
            method,
            credentials: 'include',
            headers: {}
        };
        if (payload !== null) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(payload);
        }
        const response = await fetch(`${getLocalBackendOrigin()}${path}`, options);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const err = new Error(result.error || `HTTP ${response.status}`);
            err.status = response.status;
            throw err;
        }
        return result;
    }

    async function getServerSessionUser() {
        if (!hasConfiguredServerApi()) return null;
        try {
            const result = await callServerJson('/api/auth/me');
            return result && result.authenticated ? markServerAuthUser(result.user) : null;
        } catch (e) {
            return null;
        }
    }

    function clearProfessorSession() {
        localStorage.removeItem(PROFESSOR_SESSION_KEY);
        localStorage.removeItem(PROFESSOR_SESSION_LAST_ACTIVITY_KEY);
        professorSessionLastTouch = 0;
        if (professorSessionTimeoutId) {
            clearTimeout(professorSessionTimeoutId);
            professorSessionTimeoutId = null;
        }
    }

    function getProfessorSessionLastActivity() {
        const raw = localStorage.getItem(PROFESSOR_SESSION_LAST_ACTIVITY_KEY);
        const value = raw ? Number(raw) : 0;
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function isProfessorSessionExpired() {
        if (!localStorage.getItem(PROFESSOR_SESSION_KEY)) return false;
        const lastActivity = getProfessorSessionLastActivity();
        if (!lastActivity) return false;
        return Date.now() - lastActivity > PROFESSOR_SESSION_TIMEOUT_MS;
    }

    function hydrateSessionUser(user) {
        if (!user || !user.email) return user;
        if (user.pw || user._authProvider === 'server') return user;
        try {
            const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
            const matched = users.find(u => u.email === user.email);
            return matched ? { ...matched, ...user, pw: matched.pw || user.pw } : user;
        } catch (e) {
            return user;
        }
    }

    function touchProfessorSessionActivity(force = false) {
        if (!currentUser && !localStorage.getItem(PROFESSOR_SESSION_KEY)) return;
        if (isProfessorSessionExpired()) {
            handleLogoutAction({ reason: 'timeout' });
            return;
        }
        const now = Date.now();
        if (!force && now - professorSessionLastTouch < 30000) return;
        professorSessionLastTouch = now;
        localStorage.setItem(PROFESSOR_SESSION_LAST_ACTIVITY_KEY, String(now));
        scheduleProfessorSessionTimeout();
    }

    function scheduleProfessorSessionTimeout() {
        if (professorSessionTimeoutId) {
            clearTimeout(professorSessionTimeoutId);
            professorSessionTimeoutId = null;
        }
        if (!localStorage.getItem(PROFESSOR_SESSION_KEY)) return;

        const lastActivity = getProfessorSessionLastActivity() || Date.now();
        const remaining = Math.max(PROFESSOR_SESSION_TIMEOUT_MS - (Date.now() - lastActivity), 0);
        professorSessionTimeoutId = setTimeout(() => {
            if (isProfessorSessionExpired()) {
                handleLogoutAction({ reason: 'timeout' });
            } else {
                scheduleProfessorSessionTimeout();
            }
        }, remaining + 250);
    }

    function getStoredProfessorSessionUser() {
        const sess = localStorage.getItem(PROFESSOR_SESSION_KEY);
        if (!sess) return null;
        if (isProfessorSessionExpired()) {
            clearProfessorSession();
            return null;
        }
        try {
            const user = hydrateSessionUser(JSON.parse(sess));
            if (!getProfessorSessionLastActivity()) {
                touchProfessorSessionActivity(true);
            }
            scheduleProfessorSessionTimeout();
            return user;
        } catch (e) {
            clearProfessorSession();
            return null;
        }
    }

    function bindProfessorSessionActivityTracking() {
        ['click', 'keydown', 'input', 'scroll', 'touchstart', 'pointerdown', 'mousemove'].forEach(eventName => {
            document.addEventListener(eventName, handleProfessorSessionActivityEvent, { capture: true });
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                if (isProfessorSessionExpired()) {
                    handleLogoutAction({ reason: 'timeout' });
                } else {
                    touchProfessorSessionActivity(true);
                }
            }
        });
    }

    function handleProfessorSessionActivityEvent(event) {
        if (!currentUser && !localStorage.getItem(PROFESSOR_SESSION_KEY)) return;
        if (isProfessorSessionExpired()) {
            if (event.cancelable) event.preventDefault();
            event.stopImmediatePropagation();
            handleLogoutAction({ reason: 'timeout' });
            return;
        }
        touchProfessorSessionActivity();
    }

    function routeAuthenticatedUser(user) {
        user = hydrateSessionUser(user);
        if (!user || (!user.pw && user._authProvider !== 'server')) {
            clearProfessorSession();
            currentUser = null;
            handleLogoutAction();
            return;
        }
        currentUser = user;
        storeCurrentSession(user);
        if (user.isMaster === true || user.isMaster === 'true') {
            showMasterDashboard();
            return;
        }
        if (user.status === 'approved') {
            document.getElementById('prof-name').value = user.name || '';
            document.getElementById('prof-email').value = user.email || '';
            document.getElementById('prof-phone').value = user.phone || '';
            adminConfig.professor = { name: user.name || '', email: user.email || '', phone: user.phone || '' };
            enterAdminWizard();
            return;
        }
        if (user.status === 'pending') {
            showPendingView(user);
            return;
        }
        handleLogoutAction();
    }

    function storeCurrentSession(user) {
        const sessionUser = { ...(user || {}) };
        professorSessionTimedOut = false;
        localStorage.setItem(PROFESSOR_SESSION_KEY, JSON.stringify(sessionUser));
        touchProfessorSessionActivity(true);
    }

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

    document.addEventListener('click', handleStatsModalActionClick, true);
    document.addEventListener('keydown', handleStatsModalKeydown);
    bindProfessorSessionActivityTracking();

    // ── Initialize ──
    try {
        initYearOptions();
        initEvalCriteria();
        initEvalAddSection();
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
        if (topBar) topBar.style.display = 'none';
        topBarTitle.textContent = '📊 성적 관리 시스템';
        topBarProf.textContent = '';
        currentStep = 1;
        resetWizard();
    }

    function enterStudentMode() {
        modeSection.style.display = 'none';
        loginSection.style.display = '';
        if (topBar) topBar.style.display = 'flex';

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

    async function enterAdminMode() {
        modeSection.style.display = 'none';
        adminSection.classList.add('visible');
        if (topBar) topBar.style.display = 'flex';
        topBarTitle.textContent = '⚙️ 교수 모드 — 과목 설정';
        topBarProf.textContent = '';

        if (isProfessorSessionExpired()) {
            await handleLogoutAction({ reason: 'timeout' });
            return;
        }

        const storedUser = getStoredProfessorSessionUser();
        if (storedUser) {
            routeAuthenticatedUser(storedUser);
            return;
        }

        if (!professorSessionTimedOut) {
            const serverUser = await getServerSessionUser();
            if (serverUser) {
                storeCurrentSession(serverUser);
                routeAuthenticatedUser(serverUser);
                return;
            }
        }

        // 로그인 화면 노출
        document.getElementById('admin-auth-panel').style.display = '';
        document.getElementById('admin-login-card').style.display = '';
        document.getElementById('admin-register-card').style.display = 'none';
        const forgotCard0 = document.getElementById('admin-forgot-pw-card');
        if (forgotCard0) forgotCard0.style.display = 'none';
        document.getElementById('admin-pending-panel').style.display = 'none';
        document.getElementById('admin-master-panel').style.display = 'none';
        document.getElementById('admin-wizard-container').style.display = 'none';
    }

    // ──────────────────────────────────────────────
    // Wizard Navigation
    // ──────────────────────────────────────────────
    function goToStep(step) {
        currentStep = step;

        // Hide all panels
        document.querySelectorAll('.wizard-panel').forEach(p => p.style.display = 'none');

        // Show target panel
        const panelId = `wizard-step-${step}`;
        const targetPanel = document.getElementById(panelId);
        if (targetPanel) targetPanel.style.display = '';

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

        // Step >= 4 = 레이아웃 확장 추가
        if (step >= 4) {
            adminSection.classList.add('wide-layout');
            if (mainContainer) {
                mainContainer.classList.add('wide-layout');
            }
            if (step === 4) {
                renderCourseSelector();
                renderCompleteSummary();
                renderViewStats();
                checkExistingDataForStep4();
            } else if (step === 5) {
                showGradingSubPanel('a');
            } else if (step === 6) {
                renderViewStats();
                showPublishArea();
            }
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

        // Step 2 = 과목명 자동완성 목록 채우기 및 배경/저장버튼 관리
        if (step === 2) {
            populateCourseNameList();
            const ySelect = document.getElementById('course-year');
            const sSelect = document.getElementById('course-semester');
            if (ySelect) ySelect.classList.toggle('select-unselected', !ySelect.value);
            if (sSelect) sSelect.classList.toggle('select-unselected', !sSelect.value);
            checkStep2SaveButtonVisibility();
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

    function checkStep2SaveButtonVisibility() {
        const courseName = document.getElementById('course-name').value.trim();
        const saveContainer = document.getElementById('wizard-save-2-container');
        if (saveContainer) {
            saveContainer.style.display = courseName ? 'block' : 'none';
        }
    }

    // ── 교수 개인정보 및 설정 드로어 ──
    function showProfessorInfoMgmtDrawer(initialTab = 'info') {
        const backdropId = 'professor-info-mgmt-drawer-backdrop';
        const drawerId = 'professor-info-mgmt-drawer';
        const existingBackdrop = document.getElementById(backdropId);
        const existingDrawer = document.getElementById(drawerId);
        if (existingBackdrop) existingBackdrop.remove();
        if (existingDrawer) existingDrawer.remove();

        if (!currentUser) {
            alert('⚠️ 현재 로그인 세션 정보가 없습니다. 다시 로그인해 주세요.');
            handleLogoutAction();
            return;
        }

        const isMaster = currentUser.isMaster === true || currentUser.isMaster === 'true';

        // 1. 백드롭 & 드로어 HTML 구조 정의
        const backdropHtml = `<div id="${backdropId}" class="slide-drawer-backdrop"></div>`;
        
        // 마스터인 경우 회원관리 탭 포함, 아닌 경우 비노출
        const masterTabHeader = isMaster ? `
            <button id="drawer-tab-btn-master" class="drawer-tab-btn" data-tab="master">
                <span class="tab-icon">🛡️</span>
                <span class="tab-text">회원 관리</span>
            </button>
        ` : '';

        const drawerHtml = `
            <div id="${drawerId}" class="slide-drawer">
                <div class="drawer-header">
                    <h3>👤 개인정보 및 설정</h3>
                    <button id="btn-close-drawer" class="btn-close-drawer">&times;</button>
                </div>
                <div class="drawer-body">
                    <!-- 좌측 사이드바 내비게이션 -->
                    <div class="drawer-sidebar">
                        ${!isMaster ? `
                        <button id="drawer-tab-btn-info" class="drawer-tab-btn" data-tab="info">
                            <span class="tab-icon">👤</span>
                            <span class="tab-text">프로필 설정</span>
                        </button>
                        ` : ''}
                        <button id="drawer-tab-btn-pw" class="drawer-tab-btn" data-tab="pw">
                            <span class="tab-icon">🔑</span>
                            <span class="tab-text">계정 및 보안</span>
                        </button>
                        <button id="drawer-tab-btn-config" class="drawer-tab-btn" data-tab="config">
                            <span class="tab-icon">⚙️</span>
                            <span class="tab-text">데이터베이스</span>
                        </button>
                        ${masterTabHeader}
                        ${!isMaster ? `
                        <button id="drawer-tab-btn-delete" class="drawer-tab-btn" data-tab="delete">
                            <span class="tab-icon">🗑️</span>
                            <span class="tab-text">회원 탈퇴</span>
                        </button>
                        ` : ''}
                    </div>

                    <!-- 우측 메인 콘텐츠 영역 -->
                    <div class="drawer-content-area">
                        <!-- 1. 프로필 설정 패널 -->
                        ${!isMaster ? `
                        <div id="drawer-pane-info" class="drawer-tab-pane">
                            <div class="drawer-form-group">
                                <label>이름</label>
                                <input type="text" id="drawer-prof-name" class="drawer-input" placeholder="홍길동">
                            </div>
                            <div class="drawer-form-group">
                                <label>이메일 (아이디)</label>
                                <input type="email" id="drawer-prof-email" class="drawer-input" readonly>
                            </div>
                            <div class="drawer-form-group">
                                <label>전화번호</label>
                                <input type="tel" id="drawer-prof-phone" class="drawer-input" placeholder="010-1234-5678">
                            </div>
                            <div id="drawer-info-error" class="drawer-error-msg" style="display: none;"></div>
                            <button id="drawer-save-info-btn" class="drawer-btn-primary">프로필 정보 저장</button>
                        </div>
                        ` : ''}

                        <!-- 2. 계정 및 보안 패널 -->
                        <div id="drawer-pane-pw" class="drawer-tab-pane">
                            <div class="drawer-form-group">
                                <label>현재 비밀번호</label>
                                <input type="password" id="drawer-pw-current" class="drawer-input" placeholder="현재 비밀번호 입력">
                            </div>
                            <div class="drawer-form-group">
                                <label>새 비밀번호</label>
                                <input type="password" id="drawer-pw-new" class="drawer-input" placeholder="10자 이상, 문자/숫자/특수문자 중 3종 이상">
                            </div>
                            <div class="drawer-form-group">
                                <label>새 비밀번호 확인</label>
                                <input type="password" id="drawer-pw-confirm" class="drawer-input" placeholder="새 비밀번호 재확인 입력">
                            </div>
                            <div id="drawer-pw-error" class="drawer-error-msg" style="display: none;"></div>
                            <button id="drawer-save-pw-btn" class="drawer-btn-primary" style="margin-bottom: 24px;">비밀번호 변경</button>
                            
                            <!-- 세션 정보 제공 -->
                            <div style="padding: 14px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-glass); border-radius: 8px;">
                                <div style="font-size: 11px; font-weight: 700; color: #38bdf8; margin-bottom: 8px; text-transform: uppercase;">ℹ️ 현재 세션 보안 정보</div>
                                <div style="font-size: 11px; color: #94a3b8; line-height: 1.5;">
                                    • 접속 계정: ${currentUser.email}<br>
                                    • 권한 등급: ${isMaster ? '마스터 관리자 (Master)' : '교수자 (Professor)'}<br>
                                    • 접속 환경: ${navigator.userAgent.indexOf('Chrome') >= 0 ? 'Chrome / Webkit 기반' : '웹 브라우저'}<br>
                                    • 자동 로그아웃: 세션 종료 시까지 유지
                                </div>
                            </div>
                        </div>

                        <!-- 3. 데이터베이스 연동 설정 패널 -->
                        <div id="drawer-pane-config" class="drawer-tab-pane">
                            <div class="drawer-form-group">
                                <label>구글 앱스 스크립트(GAS) Web App URL</label>
                                <input type="text" id="drawer-gas-url" class="drawer-input" placeholder="https://script.google.com/macros/s/.../exec">
                            </div>
                            <div class="drawer-form-group">
                                <label>성적 조회 API URL</label>
                                <input type="text" id="drawer-api-url" class="drawer-input" placeholder="https://your-scorequery-api.example.com">
                            </div>
                            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 20px;">
                                <button id="drawer-test-gas-btn" class="drawer-btn-secondary" style="flex: 1;">⚡ 연동 테스트</button>
                                <span id="drawer-gas-test-badge" style="display: none;"></span>
                            </div>
                            <button id="drawer-save-gas-btn" class="drawer-btn-primary">데이터베이스 설정 저장</button>
                            
                            <!-- 💡 데이터베이스 연동 설명 안내 영역 -->
                            <div style="margin-top: 16px; padding: 12px 14px; background: rgba(56, 189, 248, 0.03); border: 1px solid rgba(56, 189, 248, 0.1); border-radius: 8px; font-size: 11px; line-height: 1.6; color: #cbd5e1; text-align: left;">
                                <div style="font-weight: 700; color: #38bdf8; margin-bottom: 6px; font-size: 11px; display: flex; align-items: center; gap: 4px;">
                                    <span>💡</span> 데이터베이스 연동 안내
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <div><strong>• GAS (구글 앱스 스크립트)</strong><br>구글 스프레드시트를 클라우드 DB처럼 호출하기 위한 전용 중계 API URL입니다.</div>
                                    <div><strong>• 성적 조회 API</strong><br>공개 학생 화면이 성적 데이터를 직접 들고 있지 않고 서버에 조회하도록 연결하는 HTTPS API URL입니다.</div>
                                    <div><strong>• 연동 테스트</strong><br>입력한 GAS URL이 정상 작동하고 데이터 읽기/쓰기가 올바르게 연결되는지 사전에 검증합니다.</div>
                                    <div><strong>• 데이터베이스 설정 저장</strong><br>검증 완료된 GAS/API 주소를 public-config.json에 반영하여 승인 및 학생 조회에 활용합니다.</div>
                                </div>
                            </div>
                        </div>

                        <!-- 4. 마스터 회원 관리 패널 (마스터 권한 시에만 렌더링) -->
                        ${isMaster ? `
                        <div id="drawer-pane-master" class="drawer-tab-pane">
                            <div class="drawer-user-section-title" style="color: #fbbf24;">
                                <span>📋 가입 신청 대기</span>
                                <span id="drawer-badge-pending" class="ping-status-badge loading" style="margin-left: 4px; padding: 1px 6px;">0</span>
                            </div>
                            <div id="drawer-pending-users-list" class="drawer-user-list"></div>

                            <div class="drawer-user-section-title" style="color: #34d399;">
                                <span>👥 승인 완료 회원</span>
                                <span id="drawer-badge-approved" class="ping-status-badge success" style="margin-left: 4px; padding: 1px 6px;">0</span>
                            </div>
                            <div id="drawer-approved-users-list" class="drawer-user-list"></div>

                            <div class="drawer-user-section-title" style="color: #94a3b8;">
                                <span>🗑️ 비활성/탈퇴 회원</span>
                            </div>
                            <div id="drawer-deleted-users-list" class="drawer-user-list"></div>
                        </div>
                        ` : ''}

                        <!-- 5. 회원 탈퇴 패널 -->
                        ${!isMaster ? `
                        <div id="drawer-pane-delete" class="drawer-tab-pane">
                            <div class="drawer-warn-box">
                                <strong>⚠️ 회원 탈퇴 주의사항</strong><br>
                                • 탈퇴 완료 시 즉시 로그아웃되며 계정이 비활성화 상태가 됩니다.<br>
                                • 탈퇴 정보는 복구를 대비하여 안전하게 보존(Soft Delete)됩니다.<br>
                                • 마스터 계정 관리자가 재승인/복구 처리하기 전까지 동일 이메일로 재가입 및 로그인이 불가합니다.<br>
                                • <strong>탈퇴 확정 시 본 계정이 생성한 모든 성적 파일은 더 이상 조회할 수 없게 되니 각별히 유의바랍니다.</strong>
                            </div>
                            <div style="display: flex; gap: 8px; align-items: flex-start; margin-bottom: 20px;">
                                <input type="checkbox" id="drawer-agree-delete" style="margin-top: 3px; cursor: pointer;">
                                <label for="drawer-agree-delete" style="font-size: 12px; color: #cbd5e1; cursor: pointer; user-select: none; line-height: 1.4;">
                                    위 주의사항을 완전히 이해했으며, 이에 동의합니다.
                                </label>
                            </div>
                            <button id="drawer-execute-delete-btn" disabled class="drawer-btn-primary" style="background: #ef4444; cursor: not-allowed; opacity: 0.5; box-shadow: none;">
                                🗑️ 회원 탈퇴 실행
                            </button>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', backdropHtml + drawerHtml);

        const backdrop = document.getElementById(backdropId);
        const drawer = document.getElementById(drawerId);
        const closeBtn = document.getElementById('btn-close-drawer');

        // 슬라이드 모션 활성화
        setTimeout(() => {
            backdrop.classList.add('active');
            drawer.classList.add('active');
        }, 10);

        // 드로어 닫기 함수
        function closeDrawer() {
            backdrop.classList.remove('active');
            drawer.classList.remove('active');
            setTimeout(() => {
                const b = document.getElementById(backdropId);
                const d = document.getElementById(drawerId);
                if (b) b.remove();
                if (d) d.remove();
            }, 300);
        }

        closeBtn.onclick = closeDrawer;
        backdrop.onclick = closeDrawer;

        // 탭 버튼 및 패널 요소 수집
        const tabBtns = drawer.querySelectorAll('.drawer-tab-btn');
        const tabPanes = drawer.querySelectorAll('.drawer-tab-pane');

        function switchTab(tabName) {
            tabBtns.forEach(btn => {
                if (btn.getAttribute('data-tab') === tabName) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            tabPanes.forEach(pane => {
                if (pane.id === `drawer-pane-${tabName}`) {
                    pane.classList.add('active');
                } else {
                    pane.classList.remove('active');
                }
            });

            // 마스터 탭 선택 시 세로형 카드 목록 렌더링 호출
            if (tabName === 'master' && isMaster) {
                renderDrawerMasterUsers();
            }
        }

        // 초기 기본 탭 설정
        let defaultTab = initialTab;
        if (isMaster && (initialTab === 'info' || initialTab === 'delete')) {
            defaultTab = 'pw'; // 마스터는 프로필/탈퇴 메뉴가 없으므로 비밀번호 탭을 기본으로
        }
        switchTab(defaultTab);

        // 탭 버튼 이벤트 연결
        tabBtns.forEach(btn => {
            btn.onclick = () => {
                const tab = btn.getAttribute('data-tab');
                switchTab(tab);
            };
        });

        // ── 1. 프로필 수정 기능 바인딩 ──
        if (!isMaster) {
            const profNameInput = document.getElementById('drawer-prof-name');
            const profEmailInput = document.getElementById('drawer-prof-email');
            const profPhoneInput = document.getElementById('drawer-prof-phone');
            const saveInfoBtn = document.getElementById('drawer-save-info-btn');
            const infoError = document.getElementById('drawer-info-error');

            profNameInput.value = currentUser.name || '';
            profEmailInput.value = currentUser.email || '';
            profPhoneInput.value = currentUser.phone || '';

            saveInfoBtn.onclick = async () => {
                infoError.style.display = 'none';
                const nameVal = profNameInput.value.trim();
                const phoneVal = profPhoneInput.value.trim();

                if (!nameVal || !phoneVal) {
                    infoError.textContent = '❌ 모든 항목을 입력해 주세요.';
                    infoError.style.display = 'block';
                    return;
                }

                const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
                const idx = users.findIndex(u => u.email === currentUser.email);
                if (idx >= 0) {
                    users[idx].name = nameVal;
                    users[idx].phone = phoneVal;
                    localStorage.setItem('scorequery_users', JSON.stringify(users));

                    currentUser.name = nameVal;
                    currentUser.phone = phoneVal;
                    storeCurrentSession(currentUser);

                    const mainProfName = document.getElementById('prof-name');
                    const mainProfPhone = document.getElementById('prof-phone');
                    if (mainProfName) mainProfName.value = nameVal;
                    if (mainProfPhone) mainProfPhone.value = phoneVal;
                    adminConfig.professor = { name: nameVal, email: currentUser.email, phone: phoneVal };

                    alert('👤 교수자 프로필 정보가 수정되었습니다.');
                    closeDrawer();
                } else {
                    alert('⚠️ 사용자 조회 오류가 발생했습니다. 다시 로그인해 주세요.');
                    handleLogoutAction();
                }
            };
        }

        // ── 2. 비밀번호 변경 기능 바인딩 ──
        const pwCurrent = document.getElementById('drawer-pw-current');
        const pwNew = document.getElementById('drawer-pw-new');
        const pwConfirm = document.getElementById('drawer-pw-confirm');
        const savePwBtn = document.getElementById('drawer-save-pw-btn');
        const pwError = document.getElementById('drawer-pw-error');

        savePwBtn.onclick = async () => {
            pwError.style.display = 'none';
            const currentVal = pwCurrent.value;
            const newVal = pwNew.value;
            const confirmVal = pwConfirm.value;

            if (!currentVal || !newVal || !confirmVal) {
                pwError.textContent = '❌ 모든 항목을 입력해 주세요.';
                pwError.style.display = 'block';
                return;
            }

            if (!_isStrongPassword(newVal)) {
                pwError.textContent = '❌ 새 비밀번호는 10자 이상이며 영문 대/소문자, 숫자, 특수문자 중 3종 이상을 포함해야 합니다.';
                pwError.style.display = 'block';
                return;
            }

            if (newVal !== confirmVal) {
                pwError.textContent = '❌ 새 비밀번호와 새 비밀번호 확인이 일치하지 않습니다.';
                pwError.style.display = 'block';
                return;
            }

            if (currentUser._authProvider === 'server' || hasConfiguredServerApi()) {
                try {
                    await callServerJson('/api/auth/change_password', {
                        method: 'POST',
                        payload: { old_password: currentVal, new_password: newVal }
                    });
                    alert('🔑 비밀번호가 성공적으로 변경되었습니다.');
                    closeDrawer();
                    return;
                } catch (err) {
                    if (currentUser._authProvider === 'server') {
                        pwError.textContent = '❌ 서버 비밀번호 변경에 실패했습니다: ' + (err.message || '네트워크 오류');
                        pwError.style.display = 'block';
                        return;
                    }
                    console.warn('[ScoreQuery] Server password change failed, using GAS/local fallback if available.', err);
                }
            }

            const currentHashed = await sha256(currentVal);
            if (currentUser.pw && currentUser.pw !== currentHashed) {
                pwError.textContent = '❌ 현재 비밀번호가 일치하지 않습니다.';
                pwError.style.display = 'block';
                return;
            }

            const newHashed = await sha256(newVal);
            const gasUrl = localStorage.getItem('scorequery_gas_url');
            if (gasUrl) {
                try {
                    showMailLoading(true);
                    await callGasApi('change_pw', { newPwHash: newHashed }, {
                        email: currentUser.email,
                        pwHash: currentUser.pw || currentHashed
                    });
                    showMailLoading(false);
                } catch (err) {
                    showMailLoading(false);
                    pwError.textContent = '❌ 원격 비밀번호 변경에 실패했습니다: ' + (err.message || '네트워크 오류');
                    pwError.style.display = 'block';
                    return;
                }
            }

            const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
            const idx = users.findIndex(u => u.email === currentUser.email);
            if (idx >= 0) {
                users[idx].pw = newHashed;
                localStorage.setItem('scorequery_users', JSON.stringify(users));

                currentUser.pw = newHashed;
                storeCurrentSession(currentUser);

                alert('🔑 비밀번호가 성공적으로 변경되었습니다.');
                closeDrawer();
            } else {
                alert('⚠️ 비밀번호 변경 중 오류가 발생했습니다. 다시 로그인해 주세요.');
                handleLogoutAction();
            }
        };

        // ── 3. 데이터베이스 연동 설정 바인딩 ──
        const gasUrlInput = document.getElementById('drawer-gas-url');
        const apiUrlInput = document.getElementById('drawer-api-url');
        const testGasBtn = document.getElementById('drawer-test-gas-btn');
        const gasTestBadge = document.getElementById('drawer-gas-test-badge');
        const saveGasBtn = document.getElementById('drawer-save-gas-btn');

        gasUrlInput.value = localStorage.getItem('scorequery_gas_url') || '';
        if (apiUrlInput) apiUrlInput.value = localStorage.getItem('scorequery_api_url') || '';

        // 연동 테스트 기능
        testGasBtn.onclick = async () => {
            const testUrl = gasUrlInput.value.trim();
            if (!testUrl) {
                alert('⚠️ 테스트할 웹앱 URL을 입력해 주세요.');
                return;
            }

            const oldUrl = localStorage.getItem('scorequery_gas_url');
            localStorage.setItem('scorequery_gas_url', testUrl);

            gasTestBadge.className = 'ping-status-badge loading';
            gasTestBadge.textContent = '⏳ 통신 중...';
            gasTestBadge.style.display = 'inline-flex';
            testGasBtn.disabled = true;

            try {
                // 로그인 정보를 활용해 GAS가 올바르게 반응하는지 테스트
                const testRes = await callGasApi('login', { email: currentUser.email, pwHash: currentUser.pw });
                if (testRes) {
                    gasTestBadge.className = 'ping-status-badge success';
                    gasTestBadge.textContent = '🟢 연결 성공';
                } else {
                    throw new Error('올바르지 않은 응답');
                }
            } catch (err) {
                console.error(err);
                gasTestBadge.className = 'ping-status-badge fail';
                gasTestBadge.textContent = '🔴 연결 실패';
            } finally {
                testGasBtn.disabled = false;
                if (oldUrl) localStorage.setItem('scorequery_gas_url', oldUrl);
                else localStorage.removeItem('scorequery_gas_url');
            }
        };

        // 설정 저장 기능
        saveGasBtn.onclick = async () => {
            const saveUrl = gasUrlInput.value.trim();
            const saveApiUrl = apiUrlInput ? apiUrlInput.value.trim().replace(/\/+$/, '') : '';
            localStorage.setItem('scorequery_gas_url', saveUrl);
            localStorage.setItem('scorequery_api_url', saveApiUrl);
            await autoSavePublicConfigToServer(saveUrl);
            
            // 마스터 대시보드 뷰 주소 영역도 동기화
            const mainGasInput = document.getElementById('gas-url-input');
            if (mainGasInput) mainGasInput.value = saveUrl;
            const mainApiInput = document.getElementById('api-url-input');
            if (mainApiInput) mainApiInput.value = saveApiUrl;

            alert('⚙️ 공개 연동 URL 설정이 저장되었습니다.');
            closeDrawer();
        };

        // ── 4. 회원 탈퇴 바인딩 ──
        if (!isMaster) {
            const agreeChk = document.getElementById('drawer-agree-delete');
            const execDeleteBtn = document.getElementById('drawer-execute-delete-btn');

            agreeChk.onchange = (e) => {
                const isChecked = e.target.checked;
                execDeleteBtn.disabled = !isChecked;
                if (isChecked) {
                    execDeleteBtn.style.cursor = 'pointer';
                    execDeleteBtn.style.opacity = '1';
                    execDeleteBtn.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.2)';
                } else {
                    execDeleteBtn.style.cursor = 'not-allowed';
                    execDeleteBtn.style.opacity = '0.5';
                    execDeleteBtn.style.boxShadow = 'none';
                }
            };

            execDeleteBtn.onclick = async () => {
                const checkPw = prompt('🗑️ 회원 탈퇴 검증을 위해 비밀번호를 다시 한 번 입력해 주세요:');
                if (!checkPw) return;

                const checkHashed = await sha256(checkPw);
                if (currentUser.pw && currentUser.pw !== checkHashed) {
                    alert('❌ 비밀번호가 일치하지 않습니다. 탈퇴 처리가 취소되었습니다.');
                    return;
                }

                if (!confirm('⚠️ [최종 확인] 정말로 회원 탈퇴 신청을 전송하시겠습니까? 신청 즉시 로그아웃됩니다.')) {
                    return;
                }

                try {
                    let withdrawalHandled = false;
                    if (currentUser._authProvider === 'server' || hasConfiguredServerApi()) {
                        try {
                            await callServerJson('/api/auth/withdraw', {
                                method: 'POST',
                                payload: { current_password: checkPw }
                            });
                            withdrawalHandled = true;
                        } catch (err) {
                            if (currentUser._authProvider === 'server') {
                                throw err;
                            }
                            console.warn('[ScoreQuery] Server withdrawal failed, using GAS/local fallback if available.', err);
                        }
                    }
                    if (!withdrawalHandled && localStorage.getItem('scorequery_gas_url')) {
                        await callGasApi('withdraw_request', null, {
                            email: currentUser.email,
                            pwHash: currentUser.pw || checkHashed
                        });
                        withdrawalHandled = true;
                    }
                    if (!withdrawalHandled) {
                        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
                        const idx = users.findIndex(u => u.email === currentUser.email);
                        if (idx >= 0) {
                            users[idx].status = 'deleted';
                            users[idx].withdrawReqDate = new Date().toISOString();
                            users[idx].withdrawApproveDate = new Date().toISOString();
                            localStorage.setItem('scorequery_users', JSON.stringify(users));
                        }
                    }

                    alert('🗑️ 자진 회원 탈퇴가 즉시 처리되었습니다.\n로그인 화면으로 이동합니다.');
                    closeDrawer();
                    handleLogoutAction();
                } catch (err) {
                    alert('❌ 탈퇴 신청 중 오류가 발생했습니다: ' + err.message);
                }
            };
        }

        // ── 5. 마스터 전용 회원 목록 렌더링 및 제어 로직 ──
        function renderDrawerMasterUsers() {
            const pendingContainer = document.getElementById('drawer-pending-users-list');
            const approvedContainer = document.getElementById('drawer-approved-users-list');
            const deletedContainer = document.getElementById('drawer-deleted-users-list');

            if (!pendingContainer || !approvedContainer || !deletedContainer) return;

            const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');

            pendingContainer.innerHTML = '';
            approvedContainer.innerHTML = '';
            deletedContainer.innerHTML = '';

            let pendingHtml = '';
            let approvedHtml = '';
            let deletedHtml = '';

            let pendingCount = 0;
            let approvedCount = 0;

            users.forEach(u => {
                const dateStr = u.regDate ? new Date(u.regDate).toLocaleDateString() : '-';
                const roleBadge = u.isMaster ? '<span class="drawer-user-role-badge">Master</span>' : '';
                
                const cardHtml = `
                    <div class="drawer-user-card" data-email="${u.email}">
                        <div class="drawer-user-card-header">
                            <span class="drawer-user-name">${u.name} ${roleBadge}</span>
                            <span style="font-size:10px; opacity:0.6;">${dateStr}</span>
                        </div>
                        <div class="drawer-user-info-row">
                            📧 ${u.email}<br>
                            📞 ${u.phone || '미입력'}<br>
                            🏫 ${u.univ || '미입력'} · ${u.dept || '미입력'}
                        </div>
                        <div class="drawer-user-actions">
                            ${getDrawerUserActionButtons(u)}
                        </div>
                    </div>
                `;

                if (u.status === 'pending') {
                    pendingHtml += cardHtml;
                    pendingCount++;
                } else if (u.status === 'approved') {
                    approvedHtml += cardHtml;
                    approvedCount++;
                } else if (u.status === 'deleted' || u.status === 'rejected') {
                    deletedHtml += cardHtml;
                }
            });

            pendingContainer.innerHTML = pendingHtml || '<div style="font-size:11px; color:#64748b; padding:10px; text-align:center;">대기 중인 신청이 없습니다.</div>';
            approvedContainer.innerHTML = approvedHtml || '<div style="font-size:11px; color:#64748b; padding:10px; text-align:center;">등록된 회원이 없습니다.</div>';
            deletedContainer.innerHTML = deletedHtml || '<div style="font-size:11px; color:#64748b; padding:10px; text-align:center;">비활성 회원이 없습니다.</div>';

            document.getElementById('drawer-badge-pending').textContent = pendingCount;
            document.getElementById('drawer-badge-approved').textContent = approvedCount;

            bindDrawerUserActionEvents();
        }

        function getDrawerUserActionButtons(u) {
            if (u.isMaster) return ''; // 마스터 제어 불가

            if (u.status === 'pending') {
                return `
                    <button class="btn-drawer-user-action btn-drawer-user-approve" data-action="approve">승인</button>
                    <button class="btn-drawer-user-action btn-drawer-user-reject" data-action="reject">반려</button>
                `;
            } else if (u.status === 'approved') {
                return `
                    <button class="btn-drawer-user-action btn-drawer-user-reset" data-action="reset">비번초기화</button>
                    <button class="btn-drawer-user-action btn-drawer-user-reject" data-action="delete">탈퇴/삭제</button>
                `;
            } else if (u.status === 'deleted' || u.status === 'rejected') {
                return `
                    <button class="btn-drawer-user-action btn-drawer-user-approve" data-action="restore">복구</button>
                `;
            }
            return '';
        }

        function bindDrawerUserActionEvents() {
            drawer.querySelectorAll('.btn-drawer-user-action').forEach(btn => {
                btn.onclick = async (e) => {
                    const card = e.target.closest('.drawer-user-card');
                    const email = card.getAttribute('data-email');
                    const action = e.target.getAttribute('data-action');

                    if (action === 'approve') {
                        await handleApprove(email);
                    } else if (action === 'reject') {
                        await handleReject(email);
                    } else if (action === 'delete') {
                        await handleDeleteUserByMaster(email);
                    } else if (action === 'restore') {
                        await handleRestoreUserByMaster(email);
                    } else if (action === 'reset') {
                        await handleResetPassword(email);
                    }

                    // 실행 후 즉시 렌더링 갱신
                    renderDrawerMasterUsers();
                };
            });
        }
    }

    function validateStep3() {
        const total = getEvalTotal();
        if (total !== 100) {
            alert('평가 비율의 합이 100%가 되어야 합니다.');
            return false;
        }

        // 현재 과목+평가를 courses 배열에 저장
        const existing = adminConfig.courses.findIndex(c =>
            c.name === adminConfig.course.name &&
            c.year === adminConfig.course.year &&
            c.semester === adminConfig.course.semester
        );
        const courseEntry = withCourseId({
            ...adminConfig.course,
            evaluation: [...adminConfig.evaluation],
            professor: currentUser ? { name: currentUser.name, email: currentUser.email } : null
        });
        if (existing >= 0) {
            const c = adminConfig.courses[existing];
            
            // 기존 평가 기준과 현재 평가 기준의 변경 여부 비교
            const isChanged = (() => {
                const cEval = c.evaluation || [];
                const curEval = adminConfig.evaluation || [];
                if (cEval.length !== curEval.length) return true;
                for (let i = 0; i < cEval.length; i++) {
                    if (cEval[i].id !== curEval[i].id) return true;
                    if (cEval[i].label !== curEval[i].label) return true;
                    if (parseFloat(cEval[i].ratio) !== parseFloat(curEval[i].ratio)) return true;
                }
                return false;
            })();

            // 변경사항이 존재할 때만 컨펌 경고 노출
            if (isChanged) {
                if (!confirm(
                    `⚠️ 동일 과목이 이미 등록되어 있습니다.\n\n` +
                    `「${c.year} ${c.semester} — ${c.name}」\n\n` +
                    `기존 설정을 덮어쓰시겠습니까?`
                )) {
                    return false;
                }
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
        adminConfig.course = withCourseId({ year: c.year, semester: c.semester, name: c.name, id: c.id });
        adminConfig.evaluation = c.evaluation ? [...c.evaluation] : [];
        renderCompleteSummary();
        renderViewStats();
        checkExistingDataForStep4();
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
        initEvalCriteria();
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
        if (!container) return;
        container.innerHTML = '';

        // 신규 진입 시 디폴트 항목 복제 가이드 제공
        if (!adminConfig.evaluation || adminConfig.evaluation.length === 0) {
            adminConfig.evaluation = EVAL_ITEMS.map(item => ({
                id: item.id,
                label: item.label,
                icon: item.icon,
                ratio: 0
            }));
        }

        adminConfig.evaluation.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'eval-item selected';
            div.innerHTML = `
                <span class="eval-item-icon">${item.icon || '📊'}</span>
                <span class="eval-item-label" style="flex: 1; text-align: left; font-weight: 600; margin-left: 8px;">${item.label}</span>
                <div class="eval-item-ratio" style="display: flex; align-items: center; gap: 4px;">
                    <input type="number" id="eval-ratio-${index}" min="0" max="100" value="${item.ratio || ''}" placeholder="0" style="width: 70px; padding: 8px; border: 1px solid var(--border-glass); border-radius: 6px; background: rgba(15,23,42,0.4); color: white; text-align: center; font-size: 14px; outline: none;">
                    <span style="font-size: 14px; font-weight: 500;">%</span>
                </div>
                <button type="button" class="btn-delete-eval" data-index="${index}" style="background: transparent; border: none; color: #f87171; cursor: pointer; margin-left: 16px; font-size: 16px; display: flex; align-items: center; justify-content: center; padding: 4px;" title="항목 삭제">❌</button>
            `;
            container.appendChild(div);

            const ratioInput = div.querySelector(`#eval-ratio-${index}`);
            ratioInput.addEventListener('input', () => {
                item.ratio = parseInt(ratioInput.value) || 0;
                updateEvalTotal();
            });

            const delBtn = div.querySelector('.btn-delete-eval');
            delBtn.addEventListener('click', () => {
                adminConfig.evaluation.splice(index, 1);
                initEvalCriteria();
                updateEvalTotal();
            });
        });
    }

    function getEvalTotal() {
        if (!adminConfig.evaluation) return 0;
        return adminConfig.evaluation.reduce((sum, item) => sum + (item.ratio || 0), 0);
    }

    function initEvalAddSection() {
        const presetContainer = document.getElementById('eval-preset-chips');
        const iconInput = document.getElementById('new-eval-icon');
        const labelInput = document.getElementById('new-eval-label');
        const btnAdd = document.getElementById('btn-add-eval-item');

        if (presetContainer) {
            presetContainer.innerHTML = '';
            EVAL_ITEMS.forEach(item => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'preset-chip';
                chip.style.cssText = 'background: rgba(255,255,255,0.04); border: 1px solid var(--border-glass); border-radius: 20px; padding: 6px 14px; font-size: 12px; color: var(--text-secondary); cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 4px;';
                chip.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
                
                chip.addEventListener('mouseenter', () => {
                    chip.style.background = 'rgba(255,255,255,0.08)';
                    chip.style.borderColor = 'rgba(255,255,255,0.2)';
                });
                chip.addEventListener('mouseleave', () => {
                    chip.style.background = 'rgba(255,255,255,0.04)';
                    chip.style.borderColor = 'var(--border-glass)';
                });

                chip.addEventListener('click', () => {
                    if (iconInput) iconInput.value = item.icon;
                    if (labelInput) {
                        labelInput.value = item.label;
                        labelInput.focus();
                    }
                });
                presetContainer.appendChild(chip);
            });
        }

        if (btnAdd) {
            // 중복 바인딩 방지를 위해 복제 후 교체
            const newBtn = btnAdd.cloneNode(true);
            btnAdd.parentNode.replaceChild(newBtn, btnAdd);
            newBtn.addEventListener('click', () => {
                const icon = iconInput ? iconInput.value.trim() : '📊';
                const label = labelInput ? labelInput.value.trim() : '';

                if (!label) {
                    alert('평가 항목명을 입력해 주세요.');
                    return;
                }

                // 중복 체크
                const exists = adminConfig.evaluation.find(e => e.label === label);
                if (exists) {
                    alert('이미 존재하는 평가 항목입니다.');
                    return;
                }

                const newId = 'custom_' + Date.now();
                adminConfig.evaluation.push({
                    id: newId,
                    label: label,
                    icon: icon,
                    ratio: 0
                });

                // 입력 필드 초기화
                if (iconInput) iconInput.value = '📊';
                if (labelInput) labelInput.value = '';

                initEvalCriteria();
                updateEvalTotal();
            });
        }
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
                    <div class="complete-summary-item"><span class="label">📋 상대평가제외</span><span class="value">제외사유 / 가산메모 자동 반영</span></div>
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
        return getCoursePublishKey(adminConfig.course);
    }

    function getPublishInfo() {
        try {
            for (const key of getCoursePublishKeys(adminConfig.course)) {
                const raw = localStorage.getItem(key);
                if (raw) return JSON.parse(raw);
            }
            return null;
        } catch { return null; }
    }

    function showPublishArea() {
        const area = document.getElementById('publish-area');
        if (!area) return;
        area.style.display = '';

        const info = getPublishInfo();
        const startInput = document.getElementById('publish-start-datetime');
        const endInput = document.getElementById('publish-end-datetime');

        if (info && info.published) {
            startInput.value = info.publishStartDate || info.publishDate || '';
            endInput.value = info.publishEndDate || '';
            updatePublishStatusDisplay(info);
        } else {
            // 기본값: 시작일시는 현재 시각 + 1시간 (반올림), 종료일시는 시작일시 + 7일
            const now = new Date();
            now.setHours(now.getHours() + 1, 0, 0, 0);
            startInput.value = toLocalISOString(now);

            const end = new Date(now);
            end.setDate(end.getDate() + 7);
            endInput.value = toLocalISOString(end);

            updatePublishStatusDisplay(null);
        }

        // 🔑 성적조회 접속 비밀번호 마스킹 표시 처리
        const displayRow = document.getElementById('publish-access-code-display-row');
        const maskedEl = document.getElementById('publish-access-code-masked');
        
        let accessCode = '';
        try {
            const dataKey = getCourseDataKey(adminConfig.course);
            const rawData = localStorage.getItem(dataKey);
            if (rawData) {
                const parsed = JSON.parse(rawData);
                accessCode = parsed.access_code || '';
            }
        } catch (e) { /* ignore */ }

        if (accessCode && displayRow && maskedEl) {
            displayRow.style.display = 'flex';
            maskedEl.textContent = accessCode[0] + ' * * * * *';
            maskedEl.dataset.original = accessCode;
            
            // 기존 입력 필드가 있다면 해당 값 채워줌
            const codeInput = document.getElementById('publish-access-code');
            if (codeInput) codeInput.value = accessCode;
        } else {
            if (displayRow) displayRow.style.display = 'none';
            const codeInput = document.getElementById('publish-access-code');
            if (codeInput) codeInput.value = '';
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
            const startDt = new Date(info.publishStartDate || info.publishDate);
            const endDt = info.publishEndDate ? new Date(info.publishEndDate) : null;
            const now = new Date();

            const startStr = startDt.toLocaleString('ko-KR', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
            const endStr = endDt ? endDt.toLocaleString('ko-KR', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '종료일 미지정';

            if (now >= startDt && (!endDt || now <= endDt)) {
                statusEl.className = 'publish-status published';
                statusEl.textContent = `✅ 공시 중 — ${startStr} ~ ${endStr} 동안 학생 조회 가능`;
            } else if (now < startDt) {
                statusEl.className = 'publish-status';
                statusEl.textContent = `⏳ 공시 예약 — ${startStr}부터 조회 시작 예정 (종료: ${endStr})`;
            } else {
                statusEl.className = 'publish-status expired';
                statusEl.textContent = `🔒 공시 종료 — 조회 기간이 만료되었습니다 (${endStr} 종료됨)`;
            }
            document.getElementById('btn-unpublish').style.opacity = '1';
        } else {
            statusEl.className = 'publish-status';
            statusEl.textContent = '🔒 미공시 — 학생 조회가 차단되어 있습니다';
            document.getElementById('btn-unpublish').style.opacity = '0.4';
        }
    }

    function getPublishReadiness(dataObj) {
        if (!dataObj || !dataObj.students || Object.keys(dataObj.students).length === 0) {
            return {
                ok: false,
                message: '공시할 성적 데이터가 없습니다. 먼저 Excel 파일을 업로드하고 성적데이터를 확정해 주세요.'
            };
        }

        const report = dataObj.verificationReport || {};
        const studentCount = Object.keys(dataObj.students || {}).length;
        const classCount = Object.keys(dataObj.class_counts || {}).length;
        const skippedRows = report.skippedRows || 0;
        const missingScoreCells = report.missingScoreCells || 0;
        const mismatches = report.totalMismatches || 0;

        if (skippedRows > 0) {
            return {
                ok: false,
                message: `인증정보(학번 또는 전화번호 뒷자리)가 누락된 행 ${skippedRows}건이 있어 공시할 수 없습니다.\nExcel 원본을 확인한 뒤 다시 업로드해 주세요.`
            };
        }

        const lines = [
            '공시 전 최종 확인',
            '',
            `- 수강생: ${studentCount}명`,
            `- 분반: ${classCount}개`,
            `- 총점 불일치: ${mismatches}건`,
            `- 점수 결측: ${missingScoreCells}건`
        ];

        if (mismatches > 0 || missingScoreCells > 0) {
            lines.push('', '검증 경고가 있습니다. 그래도 공시하시겠습니까?');
        } else {
            lines.push('', '검증 결과가 정상입니다. 공시하시겠습니까?');
        }

        return { ok: true, message: lines.join('\n') };
    }

    function publishGrades() {
        const startInput = document.getElementById('publish-start-datetime');
        const endInput = document.getElementById('publish-end-datetime');
        const publishStartDate = startInput.value;
        const publishEndDate = endInput.value;
        const dataObj = getCompiledDataJson();
        const readiness = getPublishReadiness(dataObj);

        if (!readiness.ok) {
            alert(readiness.message);
            return;
        }

        if (!publishStartDate) {
            alert('공시 시작 일시를 선택해 주세요.');
            return;
        }
        if (!publishEndDate) {
            alert('공시 종료 일시를 선택해 주세요.');
            return;
        }

        if (new Date(publishStartDate) >= new Date(publishEndDate)) {
            alert('공시 종료 일시는 시작 일시보다 늦어야 합니다.');
            return;
        }

        if (!confirm(readiness.message)) {
            return;
        }

        const info = {
            published: true,
            publishStartDate: publishStartDate,
            publishEndDate: publishEndDate,
            publishDate: publishStartDate, // 하위 호환용
            publishedAt: new Date().toISOString(),
            courseId: getCourseId(adminConfig.course),
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
            courseList[idx].id = getCourseId(adminConfig.course);
            courseList[idx].publishStartDate = publishStartDate;
            courseList[idx].publishEndDate = publishEndDate;
            courseList[idx].publishDate = publishStartDate;
            courseList[idx].published = true;
            if (currentUser) {
                courseList[idx].professor = { name: currentUser.name, email: currentUser.email };
            }
            localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
        } else {
            courseList.push(withCourseId({
                year: adminConfig.course.year,
                semester: adminConfig.course.semester,
                name: adminConfig.course.name,
                publishStartDate: publishStartDate,
                publishEndDate: publishEndDate,
                publishDate: publishStartDate,
                published: true,
                professor: currentUser ? { name: currentUser.name, email: currentUser.email } : null
            }));
            localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
        }

        updatePublishStatusDisplay(info);

        const isLocalEnv = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        if (isLocalEnv) {
            autoSaveDataJsonToServer().then(res => {
                if (res && res.success) {
                    showCustomAlert('📢 성적 공시 완료', '성적이 성공적으로 공시되었으며, 로컬 서버의 docs/data.enc.json 파일로 암호화 저장되었습니다!', 'success');
                } else {
                    showCustomAlert('📢 성적 공시 완료', '성적이 공시되었습니다!\n\n(참고: 로컬 백엔드 서버가 종료 상태이거나 암호화 비밀번호 환경변수가 없어 data.enc.json 자동 저장에 실패했습니다. 수동으로 백업 파일을 생성하려면 하단의 "암호화 파일 다운로드" 버튼을 눌러주세요.)', 'warning');
                }
            });
        } else {
            showCustomAlert('📢 성적 공시 완료', '성적이 안전하게 브라우저 데이터베이스(LocalStorage)에 공시되었습니다!\n\n필요한 경우 하단의 "암호화 파일 다운로드" 버튼을 눌러 데이터 백업 파일을 생성하여 로컬에 보관하실 수 있습니다.', 'success');
        }
    }

    function unpublishGrades() {
        const info = getPublishInfo();
        if (!info || !info.published) {
            showCustomAlert('⚠️ 경고', '현재 공시된 상태가 아닙니다.', 'warning');
            return;
        }

        if (!confirm('공시를 취소하시겠습니까?\n학생들의 성적 조회가 차단됩니다.')) return;

        getCoursePublishKeys(adminConfig.course).forEach(key => localStorage.removeItem(key));

        // 입력 폼 필드 초기화
        const startInput = document.getElementById('publish-start-datetime');
        const endInput = document.getElementById('publish-end-datetime');
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';

        // 과목 목록에서도 제거
        const courseListRaw = localStorage.getItem('scorequery_courses') || '[]';
        const courseList = JSON.parse(courseListRaw);
        const idx = courseList.findIndex(c =>
            c.year === adminConfig.course.year &&
            c.semester === adminConfig.course.semester &&
            c.name === adminConfig.course.name
        );
        if (idx >= 0) {
            delete courseList[idx].publishStartDate;
            delete courseList[idx].publishEndDate;
            delete courseList[idx].publishDate;
            delete courseList[idx].published;
            localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
        }

        updatePublishStatusDisplay(null);
        
        const isLocalEnv = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        if (isLocalEnv) {
            autoSaveDataJsonToServer().then(res => {
                if (res && res.success) {
                    showCustomAlert('🚫 공시 취소 완료', '공시가 취소되었으며, 로컬 서버의 docs/data.enc.json 파일로 암호화 저장되었습니다.', 'success');
                } else {
                    showCustomAlert('🚫 공시 취소 완료', '공시가 취소되었습니다.\n\n(참고: 로컬 백엔드 서버가 종료 상태이거나 암호화 비밀번호 환경변수가 없어 data.enc.json 자동 저장에 실패했습니다. 수동으로 백업 파일을 생성하려면 하단의 "암호화 파일 다운로드" 버튼을 눌러주세요.)', 'warning');
                }
            });
        } else {
            showCustomAlert('🚫 공시 취소 완료', '공시가 안전하게 취소되었습니다.\n\n학생들이 더 이상 성적을 조회할 수 없도록 설정이 변경되었습니다.', 'success');
        }
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
    function safeFileNamePart(value, fallback) {
        const text = String(value || fallback || '')
            .trim()
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        return text || fallback || 'ScoreQuery';
    }

    function downloadSampleExcel() {
        const { professor, course, evaluation } = adminConfig;

        // 헤더 행
        const baseHeaders = ['분반', '소속', '학년', '학번', '성명', '전화번호'];
        const evalHeaders = evaluation.map(e => `${e.label}(${e.ratio}%)`);
        const headers = [...baseHeaders, ...evalHeaders, '가산점', '가산메모', '상대평가제외사유', '특별점수', '특별점수메모'];

        // 샘플 데이터 행 (3개 예시)
        const sampleRowsRaw = [
            { classNum: 1, dept: '경영학과', year: 3, studentId: '20240001', name: '홍길동', phone: '010-1234-5678', scoreFactor: 0.95, extra: 5, extraMemo: '경진대회 수상', excludeReason: '', special: 3, specialMemo: '우수 참여자' },
            { classNum: 1, dept: '경영학과', year: 2, studentId: '20240002', name: '김영희', phone: '010-2345-6789', scoreFactor: 0.8, extra: 0, extraMemo: '', excludeReason: '외국인', special: 0, specialMemo: '' },
            { classNum: 2, dept: '경영학과', year: 4, studentId: '20240003', name: '이철수', phone: '010-3456-7890', scoreFactor: 0.9, extra: 2, extraMemo: '질문왕', excludeReason: '', special: 0, specialMemo: '' },
        ];

        const evalScoresList = sampleRowsRaw.map(row => {
            return evaluation.map(e => {
                const maxScore = e.ratio > 0 ? e.ratio : 100;
                return Math.round(maxScore * row.scoreFactor * 10) / 10;
            });
        });

        const sampleRows = sampleRowsRaw.map((row, idx) => {
            const scores = evalScoresList[idx];
            return [
                row.classNum,
                row.dept,
                row.year,
                row.studentId,
                row.name,
                row.phone,
                ...scores,
                row.extra || '',
                row.extraMemo,
                row.excludeReason,
                row.special || '',
                row.specialMemo
            ];
        });

        // 워크시트 생성
        const wsData = [headers, ...sampleRows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // 열 너비 설정
        const colWidths = headers.map(h => {
            if (h === '학번' || h === '전화번호') return { wch: 16 };
            if (h === '상대평가제외사유') return { wch: 18 };
            if (h === '성명' || h === '이름' || h === '소속' || h === '학과' || h === '특별점수메모' || h === '가산메모') return { wch: 12 };
            return { wch: 10 };
        });
        ws['!cols'] = colWidths;

        // 가산점 열 셀 코멘트 추가
        const extraColIdx = headers.indexOf('가산점');
        if (extraColIdx >= 0) {
            const extraCellRef = XLSX.utils.encode_cell({ r: 0, c: extraColIdx });
            if (!ws[extraCellRef].c) ws[extraCellRef].c = [];
            ws[extraCellRef].c.push({ a: 'ScoreQuery', t: '가산 항목이 있을 때 부여\n총합에 포함됩니다', s: { sz: 10 } });
            ws[extraCellRef].c.hidden = true;
        }

        const extraMemoColIdx = headers.indexOf('가산메모');
        if (extraMemoColIdx >= 0) {
            const extraMemoCellRef = XLSX.utils.encode_cell({ r: 0, c: extraMemoColIdx });
            if (!ws[extraMemoCellRef].c) ws[extraMemoCellRef].c = [];
            ws[extraMemoCellRef].c.push({ a: 'ScoreQuery', t: '입력된 내용은 상대평가 제외 사유에 자동 반영됩니다', s: { sz: 10 } });
            ws[extraMemoCellRef].c.hidden = true;
        }

        // 특별점수 열 셀 코멘트 추가
        const specColIdx = headers.indexOf('특별점수');
        if (specColIdx >= 0) {
            const specCellRef = XLSX.utils.encode_cell({ r: 0, c: specColIdx });
            if (!ws[specCellRef].c) ws[specCellRef].c = [];
            ws[specCellRef].c.push({ a: 'ScoreQuery', t: '특별 사유가 있을 때 부여\n총합에 포함됩니다 (100점 초과 가능)', s: { sz: 10 } });
            ws[specCellRef].c.hidden = true;
        }

        // 워크북 생성
        const wb = XLSX.utils.book_new();
        const sheetName = `${course.year}-${course.semester}`;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);

        // 파일 다운로드 (강제 파일명: 년도_학기_과목명_성적산출_교수명.xlsx)
        const fileName = [
            safeFileNamePart(course.year, '년도'),
            safeFileNamePart(course.semester, '학기'),
            safeFileNamePart(course.name, '과목명'),
            '성적산출',
            safeFileNamePart(professor.name, '교수명')
        ].join('_') + '.xlsx';
        XLSX.writeFile(wb, fileName);
    }

    function getCompiledDataJson() {
        const { course } = adminConfig;
        if (!course || !course.name) return null;

        let rawData = null;
        for (const key of getCourseDataKeys(course)) {
            rawData = localStorage.getItem(key);
            if (rawData) break;
        }
        if (!rawData) return null;

        try {
            const dataObj = JSON.parse(rawData);
            // 최신 공개 연동 URL과 교수 정보 반영
            dataObj.gas_url = localStorage.getItem('scorequery_gas_url') || '';
            dataObj.api_url = localStorage.getItem('scorequery_api_url') || '';
            if (currentUser) {
                dataObj.professor = {
                    name: currentUser.name,
                    email: currentUser.email
                };
            }
            // 공시 정보도 data.json에 반영
            dataObj.course.id = getCourseId(course);
            const pubInfo = getPublishInfo();
            if (pubInfo && pubInfo.published) {
                dataObj.course.published = true;
                dataObj.course.publishStartDate = pubInfo.publishStartDate || pubInfo.publishDate;
                dataObj.course.publishEndDate = pubInfo.publishEndDate || '';
                dataObj.course.publishDate = pubInfo.publishDate; // 하위 호환
            } else {
                dataObj.course.published = false;
            }
            return getPublicDataPayload(dataObj);
        } catch (e) {
            console.error('Failed to compile data.json object:', e);
            return null;
        }
    }

    function getStoredCourseData(showAlert = false) {
        const { course } = adminConfig;
        if (!course || !course.name) {
            if (showAlert) alert('과목 정보가 없어 다운로드할 수 없습니다.');
            return null;
        }

        let rawData = null;
        for (const key of getCourseDataKeys(course)) {
            rawData = localStorage.getItem(key);
            if (rawData) break;
        }
        if (!rawData) {
            if (pendingUploadData && pendingUploadData.students && Object.keys(pendingUploadData.students).length > 0) {
                return pendingUploadData;
            }
            if (showAlert) alert('성적 데이터가 없습니다. 먼저 성적 파일을 업로드하고 최종 확정해 주세요.');
            return null;
        }

        try {
            return JSON.parse(rawData);
        } catch (e) {
            console.error('Failed to parse stored course data:', e);
            if (showAlert) alert('저장된 성적 데이터를 읽을 수 없습니다.');
            return null;
        }
    }

    function formatExcelDateTime(value) {
        if (!value) return '-';
        try {
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return '-';
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        } catch (e) {
            return '-';
        }
    }

    function getProfessorStudentId(st) {
        if (!st) return '';
        return st.student_id || st.studentId || st.student_id_raw || st.student_id_full || st.student_id_masked || '';
    }

    function getProfessorStudentName(st) {
        if (!st) return '';
        return st.student_name || st.name || st.name_raw || st.name_full || st.name_masked || '';
    }

    function stripProfessorOnlyStudentFields(student) {
        const safe = { ...(student || {}) };
        [
            'student_id',
            'studentId',
            'student_id_raw',
            'student_id_full',
            'student_name',
            'name',
            'name_raw',
            'name_full',
            'phone',
            'phone_number',
            'phone_full',
            '_cRow'
        ].forEach(field => delete safe[field]);
        return safe;
    }

    function getPublicDataPayload(dataObj) {
        const payload = JSON.parse(JSON.stringify(dataObj || {}));
        if (payload.students) {
            Object.keys(payload.students).forEach(key => {
                payload.students[key] = stripProfessorOnlyStudentFields(payload.students[key]);
            });
        }
        return payload;
    }

    function downloadFinalGradesExcel() {
        if (typeof XLSX === 'undefined') {
            alert('Excel 라이브러리가 아직 로드되지 않았습니다. 네트워크 연결을 확인한 뒤 새로고침해 주세요.');
            return;
        }

        const parsed = getStoredCourseData(true);
        if (!parsed) return;

        const course = parsed.course || adminConfig.course || {};
        const professor = parsed.professor || adminConfig.professor || {};
        const evaluation = parsed.evaluation || adminConfig.evaluation || [];
        const students = Object.entries(parsed.students || {}).map(([key, st]) => ({ key, ...st }));
        if (students.length === 0) {
            alert('다운로드할 수강생 성적 데이터가 없습니다.');
            return;
        }

        students.sort((a, b) => {
            const classDiff = compareStudentValues(a.class_num || 0, b.class_num || 0);
            if (classDiff !== 0) return classDiff;
            const rankDiff = compareStudentValues(
                parseFloat(String(a.rank || '').replace(/[^0-9.]/g, '')) || Number.MAX_SAFE_INTEGER,
                parseFloat(String(b.rank || '').replace(/[^0-9.]/g, '')) || Number.MAX_SAFE_INTEGER
            );
            if (rankDiff !== 0) return rankDiff;
            return compareStudentValues(getProfessorStudentId(a) || a.key, getProfessorStudentId(b) || b.key);
        });

        const evalHeaders = evaluation.map(item => item.ratio !== undefined && item.ratio !== null
            ? `${item.label}(${item.ratio}%)`
            : item.label);
        const headers = [
            '분반', '소속', '학번', '성명',
            ...evalHeaders,
            '가산점', '가산점 메모', '특별점수', '특별점수 메모',
            '최종 총점', '석차', '최종 학점',
            '상대평가 제외', '상대평가 제외 사유', 'F 사유', '비고'
        ];
        const aoa = [headers];

        students.forEach(st => {
            const evalScores = evaluation.map(item => {
                const val = st[`${item.id}_score`];
                return val === null || val === undefined ? '' : val;
            });
            aoa.push([
                st.class_num || '',
                st.department || '',
                getProfessorStudentId(st),
                getProfessorStudentName(st),
                ...evalScores,
                st.extra_score || '',
                st.extra_memo || '',
                st.special_score || '',
                st.special_memo || '',
                st.total_score ?? '',
                st.rank || '',
                st.grade || '',
                st.is_relative_excluded ? 'Y' : 'N',
                getRelativeExclusionReason(st) || '',
                st.f_reason || '',
                st.remark || ''
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = headers.map(h => {
            if (h.includes('학번')) return { wch: 16 };
            if (h.includes('사유') || h.includes('메모') || h === '비고') return { wch: 20 };
            if (h.includes('성명') || h === '소속') return { wch: 14 };
            return { wch: 11 };
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '최종성적');

        const filename = [
            safeFileNamePart(course.year, '년도'),
            safeFileNamePart(course.semester, '학기'),
            safeFileNamePart(course.name, '과목명'),
            '최종성적처리',
            safeFileNamePart(professor.name, '교수명')
        ].join('_') + '.xlsx';
        try {
            XLSX.writeFile(wb, filename);
        } catch (err) {
            console.error('Error writing final grades Excel file:', err);
            alert('최종 성적 처리 파일 다운로드 중 오류가 발생했습니다. 브라우저 다운로드 권한과 팝업/다운로드 차단 설정을 확인해 주세요.');
        }
    }

    function bytesToBase64(bytes) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    async function encryptJsonEnvelope(dataObj, passphrase) {
        if (!window.crypto || !crypto.subtle) {
            throw new Error('이 브라우저는 Web Crypto 암호화를 지원하지 않습니다.');
        }

        const encoder = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(passphrase),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );
        const encrypted = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: nonce,
                additionalData: encoder.encode('scorequery-encrypted-json/v1')
            },
            key,
            encoder.encode(JSON.stringify(dataObj))
        );

        return {
            scorequery_encrypted: true,
            format: 'scorequery-encrypted-json',
            version: 1,
            algorithm: 'AES-256-GCM',
            kdf: {
                name: 'PBKDF2-HMAC-SHA256',
                iterations: 600000,
                salt: bytesToBase64(salt)
            },
            nonce: bytesToBase64(nonce),
            ciphertext: bytesToBase64(new Uint8Array(encrypted))
        };
    }

    function requestEncryptionPassphrase() {
        return new Promise(resolve => {
            const modalId = 'scorequery-encryption-modal';
            const old = document.getElementById(modalId);
            if (old) old.remove();

            const modal = document.createElement('div');
            modal.id = modalId;
            modal.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.78);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;';
            modal.innerHTML = `
                <div style="width:min(420px,100%);background:#111827;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:22px;color:#f8fafc;box-shadow:0 20px 40px rgba(0,0,0,.4);">
                    <h3 style="margin:0 0 10px;font-size:18px;">암호화 비밀번호</h3>
                    <p style="margin:0 0 16px;color:#cbd5e1;font-size:13px;line-height:1.5;">성적 데이터는 AES-256-GCM으로 암호화되어 저장됩니다. 비밀번호를 잊으면 복구할 수 없습니다.</p>
                    <label style="display:block;margin-bottom:6px;color:#cbd5e1;font-size:12px;font-weight:700;">비밀번호</label>
                    <input id="enc-pass-1" type="password" autocomplete="new-password" style="width:100%;box-sizing:border-box;margin-bottom:12px;padding:10px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:#0f172a;color:#fff;">
                    <label style="display:block;margin-bottom:6px;color:#cbd5e1;font-size:12px;font-weight:700;">비밀번호 확인</label>
                    <input id="enc-pass-2" type="password" autocomplete="new-password" style="width:100%;box-sizing:border-box;margin-bottom:12px;padding:10px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:#0f172a;color:#fff;">
                    <div id="enc-pass-error" style="display:none;margin-bottom:12px;color:#fca5a5;font-size:12px;"></div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button id="enc-cancel" type="button" style="padding:9px 13px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:#1f2937;color:#e5e7eb;cursor:pointer;">취소</button>
                        <button id="enc-ok" type="button" style="padding:9px 13px;border-radius:6px;border:0;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">암호화</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            const pass1 = modal.querySelector('#enc-pass-1');
            const pass2 = modal.querySelector('#enc-pass-2');
            const error = modal.querySelector('#enc-pass-error');
            const finish = value => {
                modal.remove();
                resolve(value);
            };
            const showModalError = message => {
                error.textContent = message;
                error.style.display = 'block';
            };
            modal.querySelector('#enc-cancel').addEventListener('click', () => finish(null));
            modal.querySelector('#enc-ok').addEventListener('click', () => {
                if (!pass1.value || pass1.value.length < 12) {
                    showModalError('비밀번호는 12자 이상으로 설정하세요.');
                    return;
                }
                if (pass1.value !== pass2.value) {
                    showModalError('비밀번호 확인이 일치하지 않습니다.');
                    return;
                }
                finish(pass1.value);
            });
            pass1.focus();
        });
    }

    async function downloadDataJson() {
        const dataObj = getCompiledDataJson();
        if (!dataObj) {
            alert('성적 데이터가 없습니다. 먼저 2단계에서 성적 파일을 업로드하고 확정해 주세요.');
            return;
        }

        try {
            const passphrase = await requestEncryptionPassphrase();
            if (!passphrase) return;

            const encrypted = await encryptJsonEnvelope(dataObj, passphrase);
            const jsonString = JSON.stringify(encrypted, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = 'data.enc.json';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Failed to download encrypted data:', e);
            alert('암호화 파일 다운로드 중 오류가 발생했습니다: ' + e.message);
        }
    }

    async function autoSaveDataJsonToServer() {
        const dataObj = getCompiledDataJson();
        if (!dataObj) return { success: false, error: 'No data' };

        try {
            const result = await postLocalAdminJson('/api/save_data', dataObj);
            if (result.success) {
                console.log('[ScoreQuery] Auto-save success:', result.message);
            } else {
                console.warn('[ScoreQuery] Auto-save failed on server:', result.error);
            }
            return result;
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

        // adminConfig 업데이트
        adminConfig.professor = { ...professor };
        if (course) adminConfig.course = withCourseId(course);
        if (evaluation) adminConfig.evaluation = [...evaluation];

        // Step 3: 평가 기준
        initEvalCriteria();
        updateEvalTotal();

        // courses 배열 호환성
        if (config.courses && config.courses.length > 0) {
            adminConfig.courses = config.courses.map(c => withCourseId(c));
        } else if (course && evaluation && evaluation.length > 0) {
            // 이전 형식 → courses 배열로 변환
            adminConfig.courses = [withCourseId({
                ...course,
                evaluation: [...evaluation],
            })];
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
    // 학점 산출 및 수동 조정 파이프라인 (Step 5)
    // ──────────────────────────────────────────────
    function showGradingSubPanel(panelChar) {
        document.querySelectorAll('.grading-sub-panel').forEach(p => p.style.display = 'none');
        const target = document.getElementById(`grading-panel-${panelChar}`);
        if (target) target.style.display = '';

        if (panelChar === 'a') {
            renderStep5A();
        } else if (panelChar === 'b') {
            renderTieBreakerOptions();
            renderCustomFRules();
            setupGradingRulesLimits();
        } else if (panelChar === 'c') {
            renderStep5C();
        }
    }

    function getActiveEvalItems() {
        if (pendingUploadData && pendingUploadData.evaluation) {
            return pendingUploadData.evaluation;
        }
        return adminConfig.evaluation;
    }

    function getPendingStudentList() {
        if (!pendingUploadData || !pendingUploadData.students) return [];
        return Object.entries(pendingUploadData.students).map(([key, st]) => {
            st._studentKey = key;
            return st;
        });
    }

    function getClassNumsFromStudents(studentList) {
        return Array.from(new Set(studentList.map(st => st.class_num).filter(v => v !== undefined && v !== null && v !== '')))
            .sort((a, b) => {
                const na = Number(a);
                const nb = Number(b);
                if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
                return String(a).localeCompare(String(b), 'ko');
            });
    }

    function getGradeSortValue(grade) {
        const order = { 'A+': 90, 'A0': 80, 'B+': 70, 'B0': 60, 'C+': 50, 'C0': 40, 'D+': 30, 'D0': 20, F: 10 };
        return order[String(grade || '').toUpperCase()] || 0;
    }

    function getStudentSortValue(st, sortKey) {
        if (sortKey && sortKey.startsWith('eval:')) {
            return st[`${sortKey.slice(5)}_score`];
        }
        switch (sortKey) {
            case 'student_id':
                return getProfessorStudentId(st) || st._studentKey || '';
            case 'name':
                return getProfessorStudentName(st);
            case 'class_num':
                return st.class_num || 0;
            case 'extra_score':
                return st.extra_score || 0;
            case 'special_score':
                return st.special_score || 0;
            case 'total_score':
                return st.total_score || 0;
            case 'rank':
                return parseFloat(String(st.rank || '').replace(/[^0-9.]/g, '')) || Number.MAX_SAFE_INTEGER;
            case 'grade':
                return getGradeSortValue(st.grade);
            case 'relative_excluded':
                return st.is_relative_excluded ? 1 : 0;
            case 'remark':
                return getRelativeExclusionReason(st) || st.f_reason || st.remark || '';
            default:
                return st[sortKey];
        }
    }

    function compareStudentValues(a, b) {
        const aNum = typeof a === 'number' ? a : parseFloat(a);
        const bNum = typeof b === 'number' ? b : parseFloat(b);
        const aNumeric = !Number.isNaN(aNum) && String(a).trim() !== '';
        const bNumeric = !Number.isNaN(bNum) && String(b).trim() !== '';
        if (aNumeric && bNumeric) return aNum - bNum;
        return String(a ?? '').localeCompare(String(b ?? ''), 'ko', { numeric: true, sensitivity: 'base' });
    }

    function getVisibleSortedStudents(tableKey, studentList) {
        const state = gradingTableState[tableKey];
        const classNumSet = new Set(getClassNumsFromStudents(studentList).map(c => String(c)));
        if (state.classFilter !== 'all' && !classNumSet.has(String(state.classFilter))) {
            state.classFilter = 'all';
        }
        const filtered = state.classFilter === 'all'
            ? [...studentList]
            : studentList.filter(st => String(st.class_num || 1) === String(state.classFilter));

        filtered.sort((a, b) => {
            const result = compareStudentValues(getStudentSortValue(a, state.sortKey), getStudentSortValue(b, state.sortKey));
            if (result !== 0) return state.direction === 'asc' ? result : -result;
            return compareStudentValues(getStudentSortValue(a, 'student_id'), getStudentSortValue(b, 'student_id'));
        });
        return filtered;
    }

    function sortIndicator(tableKey, sortKey) {
        const state = gradingTableState[tableKey];
        if (state.sortKey !== sortKey) return '↕';
        return state.direction === 'asc' ? '▲' : '▼';
    }

    function sortableTh(tableKey, label, sortKey, width = '') {
        return `<th data-grading-sort-key="${sortKey}" style="padding:10px; border-bottom:1px solid var(--border-glass); cursor:pointer; user-select:none; ${width}" title="클릭하여 정렬">${label} <span style="font-size:10px; color:var(--text-muted);">${sortIndicator(tableKey, sortKey)}</span></th>`;
    }

    function classFilterTh(tableKey, studentList) {
        return `<th style="padding:10px; border-bottom:1px solid var(--border-glass);">분반</th>`;
    }

    function classFilterDropdownHTML(tableKey, studentList) {
        const classNums = getClassNumsFromStudents(studentList);
        if (classNums.length <= 1) return '';

        const selected = gradingTableState[tableKey].classFilter;
        const options = [
            `<option value="all" ${selected === 'all' ? 'selected' : ''}>분반 전체</option>`,
            ...classNums.map(c => `<option value="${c}" ${String(selected) === String(c) ? 'selected' : ''}>${c}분반</option>`)
        ].join('');
        return `
            <select data-grading-class-filter="${tableKey}" style="padding:4px 8px; border-radius:4px; background:rgba(15,23,42,0.9); color:white; border:1px solid var(--border-glass); outline:none; font-size:12px; cursor:pointer;">
                ${options}
            </select>
        `;
    }

    function bindGradingTableControls(wrap, tableKey, renderFn) {
        wrap.querySelectorAll('th[data-grading-sort-key]').forEach(th => {
            th.addEventListener('click', () => {
                const sortKey = th.dataset.gradingSortKey;
                const state = gradingTableState[tableKey];
                if (state.sortKey === sortKey) {
                    state.direction = state.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sortKey = sortKey;
                    state.direction = sortKey === 'rank' || sortKey === 'student_id' || sortKey === 'name' ? 'asc' : 'desc';
                }
                renderFn();
            });
        });

        wrap.querySelectorAll('select[data-grading-class-filter]').forEach(select => {
            select.addEventListener('change', () => {
                gradingTableState[tableKey].classFilter = select.value;
                renderFn();
            });
        });
    }

    function renderCustomFRules() {
        const container = document.getElementById('f-rule-custom-items-container');
        if (!container) return;

        const activeEvalItems = getActiveEvalItems();
        
        // Exclude Attendance, Midterm, Final
        const excludeLabels = ['출석', '중간', '기말'];
        const eligibleItems = activeEvalItems.filter(item => 
            !excludeLabels.some(l => item.label.includes(l)) && 
            item.id !== 'attendance' && 
            item.id !== 'midterm' && 
            item.id !== 'final'
        );

        // Virtual Total Score item is removed
        const allItems = [
            ...eligibleItems.map(item => ({ id: item.id, label: item.label, defaultVal: 0 }))
        ];

        let html = '';
        allItems.forEach(item => {
            html += `
                <div style="display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-secondary); margin-bottom: 4px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
                        <input type="checkbox" class="f-rule-custom-checkbox" data-item-id="${item.id}" style="cursor:pointer;"> ${item.label} 미만 F :
                    </label>
                    <input type="number" class="f-rule-custom-val-input" data-item-id="${item.id}" value="${item.defaultVal}" disabled style="width:60px; padding:4px; border-radius:4px; background:rgba(15,23,42,0.6); color:white; border:1px solid var(--border-glass); text-align:center; outline:none; font-size: 12px;"> 점 미만
                </div>
            `;
        });

        container.innerHTML = html;

        // Add event listeners
        container.querySelectorAll('.f-rule-custom-checkbox').forEach(cb => {
            cb.addEventListener('change', function() {
                const itemId = this.dataset.itemId;
                const valInput = container.querySelector(`.f-rule-custom-val-input[data-item-id="${itemId}"]`);
                if (valInput) valInput.disabled = !this.checked;
            });
        });
    }

    function checkExistingDataForStep4() {
        const noticeEl = document.getElementById('edit-mode-notice');
        const nextBtn = document.getElementById('btn-upload-next');
        const accessCodeInput = document.getElementById('publish-access-code');

        if (!adminConfig.course || !adminConfig.course.name) {
            if (noticeEl) noticeEl.style.display = 'none';
            return;
        }

        const dataKey = getCourseDataKey(adminConfig.course);
        const rawData = localStorage.getItem(dataKey);

        if (rawData) {
            try {
                const parsed = JSON.parse(rawData);
                // 기존 데이터 임시 보관
                pendingUploadData = parsed;

                // 접속 비밀번호 채우기
                if (accessCodeInput && parsed.access_code) {
                    accessCodeInput.value = parsed.access_code;
                }

                // 안내 박스 노출
                if (noticeEl) {
                    noticeEl.style.display = 'block';
                    noticeEl.style.borderColor = 'rgba(56, 189, 248, 0.25)';
                    noticeEl.style.background = 'rgba(56, 189, 248, 0.08)';
                    noticeEl.innerHTML = `
                        ℹ️ <strong>기존 데이터 유지 중</strong>: 본 과목은 성적 데이터와 접속 비밀번호가 이미 등록되어 있습니다. 변경사항이 없는 경우 바로 다음 단계로 이동하실 수 있습니다.<br>
                        <span style="color:#38bdf8; font-weight:600;">⚠️ 수정(변경)을 원하실 경우에만 새로운 엑셀 파일 업로드 또는 비밀번호 설정을 새로 진행해 주십시오.</span>
                    `;
                }

                // 다음 단계 버튼 노출
                if (nextBtn) {
                    nextBtn.style.display = '';
                    nextBtn.removeAttribute('disabled');
                }
            } catch (e) {
                console.error(e);
            }
        } else {
            // 기존 데이터 없음
            pendingUploadData = null;
            if (accessCodeInput) accessCodeInput.value = '';
            if (noticeEl) noticeEl.style.display = 'none';
            if (nextBtn) {
                nextBtn.style.display = 'none';
                nextBtn.setAttribute('disabled', 'true');
            }
        }
    }

    function renderStep5A() {
        const wrap = document.getElementById('raw-scores-table-wrap');
        if (!wrap || !pendingUploadData) return;

        const allStudents = getPendingStudentList();
        const studentList = getVisibleSortedStudents('step5a', allStudents);

        const activeEvalItems = getActiveEvalItems();

        let ths = `
            ${classFilterTh('step5a', allStudents)}
            ${sortableTh('step5a', '학번', 'student_id')}
            ${sortableTh('step5a', '성명', 'name')}
        `;

        activeEvalItems.forEach(item => {
            ths += sortableTh('step5a', item.label, `eval:${item.id}`);
        });

        ths += `
            ${sortableTh('step5a', '<span style="color:#34d399;">가산점</span>', 'extra_score')}
            ${sortableTh('step5a', '<span style="color:#fbbf24;">특별점수</span>', 'special_score')}
            ${sortableTh('step5a', '<span style="font-weight:700;">합계</span>', 'total_score')}
            ${sortableTh('step5a', '석차', 'rank')}
        `;

        let trs = '';
        studentList.forEach(st => {
            const displayStudentId = escapeHtml(getProfessorStudentId(st));
            const displayStudentName = escapeHtml(getProfessorStudentName(st));
            let itemTds = '';
            activeEvalItems.forEach(item => {
                const val = st[`${item.id}_score`];
                const formattedVal = val !== null && val !== undefined && !isNaN(val) ? Number(val).toFixed(1) : '-';
                itemTds += `<td style="padding:10px; text-align:center;">${formattedVal}</td>`;
            });

            const extra = st.extra_score !== null && st.extra_score !== undefined && !isNaN(st.extra_score) ? Number(st.extra_score).toFixed(1) : '0.0';
            const special = st.special_score !== null && st.special_score !== undefined && !isNaN(st.special_score) ? Number(st.special_score).toFixed(1) : '0.0';
            const total = st.total_score !== null && st.total_score !== undefined && !isNaN(st.total_score) ? Number(st.total_score).toFixed(1) : '-';

            trs += `
                <tr style="border-bottom:1px solid var(--border-glass);">
                    <td style="padding:10px; text-align:center;">${st.class_num}반</td>
                    <td style="padding:10px; text-align:center; color:white;">${displayStudentId}</td>
                    <td style="padding:10px; text-align:center;">${displayStudentName}</td>
                    ${itemTds}
                    <td style="padding:10px; text-align:center; color:#34d399;">${extra}</td>
                    <td style="padding:10px; text-align:center; color:#fbbf24;">${special}</td>
                    <td style="padding:10px; text-align:center; font-weight:700; color:white;">${total}</td>
                    <td style="padding:10px; text-align:center;">${st.rank || '-'}등</td>
                </tr>
            `;
        });

        const filterHTML = classFilterDropdownHTML('step5a', allStudents);
        wrap.innerHTML = `
            ${filterHTML ? `<div style="display:flex; justify-content:flex-end; margin-bottom:8px;">${filterHTML}</div>` : ''}
            <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center;">
                <thead>
                    <tr style="background:rgba(255,255,255,0.05); color:var(--text-main); font-weight:600;">
                        ${ths}
                    </tr>
                </thead>
                <tbody>
                    ${trs}
                </tbody>
            </table>
        `;
        bindGradingTableControls(wrap, 'step5a', renderStep5A);
    }

    function renderTieBreakerOptions() {
        const container = document.getElementById('tie-breaker-order');
        if (!container) return;

        const activeEvalItems = getActiveEvalItems();
        container.innerHTML = '';

        const N = activeEvalItems.length;

        // 우선순위 초기값 없이 '선택' 상태로 시작하도록 변경
        activeEvalItems.forEach((item, idx) => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'space-between';
            div.style.padding = '8px 12px';
            div.style.background = 'rgba(255,255,255,0.01)';
            div.style.border = '1px solid var(--border-glass)';
            div.style.borderRadius = '6px';

            let optionsHtml = '<option value="">선택</option>';
            for (let p = 1; p <= N; p++) {
                optionsHtml += `<option value="${p}">${p}순위</option>`;
            }

            div.innerHTML = `
                <span style="font-size:13px; color:var(--text-primary); font-weight:600;">${item.icon} ${item.label}</span>
                <select class="tie-breaker-select" data-eval-id="${item.id}" style="padding:6px; border-radius:4px; background:rgba(15,23,42,0.8); color:white; border:1px solid var(--border-glass); outline:none;">
                    ${optionsHtml}
                </select>
            `;
            container.appendChild(div);
        });

        // 배타적(서로 중복되지 않는) 순위 선택을 위한 비활성화(disable) 기능
        const selects = container.querySelectorAll('.tie-breaker-select');
        
        function updateTieBreakerOptions() {
            const usedValues = new Set();
            selects.forEach(sel => {
                if (sel.value) usedValues.add(sel.value);
            });
            
            selects.forEach(sel => {
                Array.from(sel.options).forEach(opt => {
                    if (opt.value === "") {
                        opt.disabled = false;
                    } else if (opt.value !== sel.value && usedValues.has(opt.value)) {
                        opt.disabled = true;
                    } else {
                        opt.disabled = false;
                    }
                });
            });
        }

        selects.forEach(select => {
            select.addEventListener('change', updateTieBreakerOptions);
        });
        
        updateTieBreakerOptions(); // 초기 상태 반영
    }

    function setupGradingRulesLimits() {
        const evalTypeSelect = document.getElementById('grading-eval-type');
        const distTypeSelect = document.getElementById('grading-dist-type');
        const rulesTitle = document.getElementById('grading-rules-title');
        const rulesWarning = document.getElementById('grading-rules-sum-warning');
        
        const inputs = [
            document.getElementById('grading-val-a'),
            document.getElementById('grading-val-b'),
            document.getElementById('grading-val-c'),
            document.getElementById('grading-val-d')
        ];

        // minscore listeners removed as they are handled dynamically

        function updateLabels() {
            const distType = distTypeSelect.value;
            const valLabels = document.querySelectorAll('.grading-val-label');

            if (distType === 'ratio') {
                rulesTitle.textContent = '구간별 비율 설정 (총합 100%)';
                inputs.forEach(input => {
                    if (input) {
                        input.max = 100;
                        input.placeholder = '%';
                    }
                });
                valLabels.forEach(lbl => lbl.textContent = '비율');
                checkRatioSum();
            } else {
                const totalStudents = getPendingStudentList().length;
                rulesTitle.textContent = `구간별 인원 설정 (총합: ${totalStudents}명)`;
                inputs.forEach(input => {
                    if (input) {
                        input.removeAttribute('max');
                        input.placeholder = '명';
                    }
                });
                valLabels.forEach(lbl => lbl.textContent = '인원');
                if (rulesWarning) rulesWarning.style.display = 'none';
                const btnRun = document.getElementById('btn-grading-b-run');
                if (btnRun) btnRun.removeAttribute('disabled');
            }
        }

        function checkRatioSum() {
            if (distTypeSelect.value !== 'ratio') return;
            const sum = inputs.reduce((acc, input) => acc + (parseFloat(input.value) || 0), 0);
            const sumSpan = document.getElementById('grading-rules-sum-current');
            if (sumSpan) sumSpan.textContent = sum;

            const btnRun = document.getElementById('btn-grading-b-run');
            if (Math.abs(sum - 100) > 0.01) {
                if (rulesWarning) rulesWarning.style.display = 'block';
                if (btnRun) btnRun.setAttribute('disabled', 'true');
            } else {
                if (rulesWarning) rulesWarning.style.display = 'none';
                if (btnRun) btnRun.removeAttribute('disabled');
            }
            
            // Visual bar update
            const barA = document.getElementById('bar-a');
            const barB = document.getElementById('bar-b');
            const barC = document.getElementById('bar-c');
            const barD = document.getElementById('bar-d');
            if (barA && barB && barC && barD) {
                const valA = parseFloat(inputs[0].value) || 0;
                const valB = parseFloat(inputs[1].value) || 0;
                const valC = parseFloat(inputs[2].value) || 0;
                const valD = parseFloat(inputs[3].value) || 0;
                const total = valA + valB + valC + valD;
                const divTotal = total > 0 ? total : 100;
                barA.style.width = `%`;
                barA.textContent = `A (%)`;
                barB.style.width = `%`;
                barB.textContent = `B (%)`;
                barC.style.width = `%`;
                barC.textContent = `C (%)`;
                barD.style.width = `%`;
                barD.textContent = `D (%)`;
            }
        }

        if (evalTypeSelect && distTypeSelect) {
            // Clone to avoid multiple event registration on going back and forth
            const newEvalType = evalTypeSelect.cloneNode(true);
            evalTypeSelect.parentNode.replaceChild(newEvalType, evalTypeSelect);
            const newDistType = distTypeSelect.cloneNode(true);
            distTypeSelect.parentNode.replaceChild(newDistType, distTypeSelect);

            newEvalType.addEventListener('change', updateLabels);
            newDistType.addEventListener('change', updateLabels);

            inputs.forEach(input => {
                if (input) {
                    const newInput = input.cloneNode(true);
                    input.parentNode.replaceChild(newInput, input);
                    newInput.addEventListener('input', checkRatioSum);
                }
            });

            // Re-fetch inputs since they were replaced
            const reInputs = [
                document.getElementById('grading-val-a'),
                document.getElementById('grading-val-b'),
                document.getElementById('grading-val-c'),
                document.getElementById('grading-val-d')
            ];
            
            // Re-fetch select elements
            const reEvalSelect = document.getElementById('grading-eval-type');
            const reDistSelect = document.getElementById('grading-dist-type');

            reEvalSelect.addEventListener('change', updateLabels);
            reDistSelect.addEventListener('change', updateLabels);
            reInputs.forEach(input => {
                if (input) input.addEventListener('input', checkRatioSum);
            });

            updateLabels();
        }
    }

    function runGradingPipeline() {
        const evalType = document.getElementById('grading-eval-type').value;
        const distType = document.getElementById('grading-dist-type').value;
        
        const valA = parseFloat(document.getElementById('grading-val-a').value) || 0;
        const valB = parseFloat(document.getElementById('grading-val-b').value) || 0;
        const valC = parseFloat(document.getElementById('grading-val-c').value) || 0;
        const valD = parseFloat(document.getElementById('grading-val-d').value) || 0;

        const plusRatioA = parseFloat(document.getElementById('grading-plus-a').value) ?? 60;
        const plusRatioB = parseFloat(document.getElementById('grading-plus-b').value) ?? 60;
        const plusRatioC = parseFloat(document.getElementById('grading-plus-c').value) ?? 60;
        const plusRatioD = parseFloat(document.getElementById('grading-plus-d').value) ?? 60;

        if (distType === 'ratio') {
            const sum = valA + valB + valC + valD;
            if (Math.abs(sum - 100) > 0.01) {
                alert(`⚠️ 비율의 총합이 100%여야 합니다.\n현재 입력값 합계: ${sum}%`);
                return;
            }
        }

        const fMidterm = document.getElementById('f-rule-midterm').checked;
        const fFinal = document.getElementById('f-rule-final').checked;

        const customFRules = [];
        const customContainer = document.getElementById('f-rule-custom-items-container');
        if (customContainer) {
            customContainer.querySelectorAll('.f-rule-custom-checkbox').forEach(cb => {
                if (cb.checked) {
                    const itemId = cb.dataset.itemId;
                    const valInput = customContainer.querySelector(`.f-rule-custom-val-input[data-item-id="${itemId}"]`);
                    if (valInput) {
                        customFRules.push({
                            itemId: itemId,
                            threshold: parseFloat(valInput.value) || 0
                        });
                    }
                }
            });
        }

        const tieBreakerSelects = document.querySelectorAll('.tie-breaker-select');
        const tieBreakers = Array.from(tieBreakerSelects).map(select => ({
            id: select.dataset.evalId,
            priority: select.value ? parseInt(select.value) : 999
        })).sort((a, b) => a.priority - b.priority).map(item => item.id);

        const studentList = Object.values(pendingUploadData.students);
        const activeEvalItems = getActiveEvalItems();

        studentList.forEach(st => {
            st.f_reason = null;
            st.is_f = false;
            
            // 결석시수초과 (전체 수업의 1/4 초과 결석자)는 항상 F이며 0점 처리 (필수)
            if (st.absences >= 4) {
                st.is_f = true;
                st.f_reason = '출석미달';
                st.total_score = 0;
                st.grade = 'F';
            }
            
            if (!st.is_f) {
                const midtermCol = activeEvalItems.find(e => e.id === 'midterm');
                if (midtermCol && fMidterm) {
                    const scoreVal = st[`${midtermCol.id}_score`];
                    if (scoreVal === null || scoreVal === undefined || scoreVal === '') {
                        st.is_f = true;
                        st.f_reason = '중간결시';
                    }
                }
            }
            if (!st.is_f) {
                const finalCol = activeEvalItems.find(e => e.id === 'final');
                if (finalCol && fFinal) {
                    const scoreVal = st[`${finalCol.id}_score`];
                    if (scoreVal === null || scoreVal === undefined || scoreVal === '') {
                        st.is_f = true;
                        st.f_reason = '기말결시';
                    }
                }
            }
            if (!st.is_f) {
                for (const rule of customFRules) {
                    const scoreVal = rule.itemId === 'total_score' ? st.total_score : (st[`${rule.itemId}_score`] || 0);
                    if (scoreVal < rule.threshold) {
                        st.is_f = true;
                        if (rule.itemId === 'total_score') {
                            st.f_reason = '성적미달';
                        } else {
                            const matchedItem = activeEvalItems.find(e => e.id === rule.itemId);
                            st.f_reason = `${matchedItem ? matchedItem.label : rule.itemId}미달`;
                        }
                        break;
                    }
                }
            }
        });

        studentList.forEach(st => {
            applyRelativeExclusionMemo(st);
        });

        // Group by class_num
        const classes = {};
        studentList.forEach(st => {
            const cNum = st.class_num || 1;
            if (!classes[cNum]) {
                classes[cNum] = [];
            }
            classes[cNum].push(st);
        });

        const sortStudents = (a, b) => {
            const diff = b.total_score - a.total_score;
            if (Math.abs(diff) > 0.001) return diff;

            for (const itemId of tieBreakers) {
                const aScore = a[`${itemId}_score`] || 0;
                const bScore = b[`${itemId}_score`] || 0;
                const scoreDiff = bScore - aScore;
                if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
            }
            return 0;
        };

        const classTargetStats = {};

        // Run grading pipeline per class section
        for (const [cNum, classSts] of Object.entries(classes)) {
            const normalStudents = classSts.filter(st => !st.is_f && !st.is_relative_excluded);
            const fStudents = classSts.filter(st => st.is_f);

            normalStudents.sort(sortStudents);

            // Calculate ranks within this section
            for (let i = 0; i < normalStudents.length; i++) {
                if (i > 0 && sortStudents(normalStudents[i], normalStudents[i - 1]) === 0) {
                    normalStudents[i].rank = normalStudents[i - 1].rank;
                } else {
                    normalStudents[i].rank = String(i + 1);
                }
            }

            const N = normalStudents.length;
            let countA = 0, countB = 0, countC = 0, countD = 0;

            if (distType === 'ratio') {
                countA = Math.round(N * (valA / 100));
                countB = Math.round(N * (valB / 100));
                countC = Math.round(N * (valC / 100));
                countD = Math.max(0, N - (countA + countB + countC));
            } else {
                countA = Math.min(N, valA);
                countB = Math.min(Math.max(0, N - countA), valB);
                countC = Math.min(Math.max(0, N - (countA + countB)), valC);
                countD = Math.max(0, N - (countA + countB + countC));
            }

            const aStudents = normalStudents.slice(0, countA);
            const bStudents = normalStudents.slice(countA, countA + countB);
            const cStudents = normalStudents.slice(countA + countB, countA + countB + countC);
            const dStudents = normalStudents.slice(countA + countB + countC);

            const countPlusA = Math.round(aStudents.length * (plusRatioA / 100));
            const countPlusB = Math.round(bStudents.length * (plusRatioB / 100));
            const countPlusC = Math.round(cStudents.length * (plusRatioC / 100));
            const countPlusD = Math.round(dStudents.length * (plusRatioD / 100));

            aStudents.forEach((st, idx) => st.grade = idx < countPlusA ? 'A+' : 'A0');
            bStudents.forEach((st, idx) => st.grade = idx < countPlusB ? 'B+' : 'B0');
            cStudents.forEach((st, idx) => st.grade = idx < countPlusC ? 'C+' : 'C0');
            dStudents.forEach((st, idx) => st.grade = idx < countPlusD ? 'D+' : 'D0');

            classTargetStats[cNum] = {
                A: { targetCount: countA, targetRatio: valA },
                B: { targetCount: countB, targetRatio: valB },
                C: { targetCount: countC, targetRatio: valC },
                D: { targetCount: countD, targetRatio: valD },
                F: { targetCount: fStudents.length, targetRatio: 0 }
            };
        }

        // Set grade for F and Excluded globally
        studentList.forEach(st => {
            if (st.is_f) {
                st.grade = 'F';
                if (st.f_reason === '출석미달') {
                    st.total_score = 0;
                } else {
                    st.total_score = Math.min(59, st.total_score);
                }
            } else if (st.is_relative_excluded) {
                if (st.total_score >= 90) st.grade = 'A0';
                else if (st.total_score >= 80) st.grade = 'B0';
                else if (st.total_score >= 70) st.grade = 'C0';
                else if (st.total_score >= 60) st.grade = 'D0';
                else st.grade = 'F';
            }
        });

        pendingUploadData.classTargetStats = classTargetStats;
        pendingUploadData.distType = distType;

        showGradingSubPanel('c');
    }

    function updateGradingStats() {
        if (!pendingUploadData) return;
        const selectEl = document.getElementById('grading-stats-class-select');
        const selectedClass = selectEl ? selectEl.value : 'all';

        const studentList = Object.values(pendingUploadData.students);
        
        let filteredStudents = studentList;
        if (selectedClass !== 'all') {
            filteredStudents = studentList.filter(st => String(st.class_num || 1) === selectedClass);
        }

        const totalN = filteredStudents.length;
        const normalCount = filteredStudents.filter(st => !st.is_f && !st.is_relative_excluded).length;

        const counts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
        filteredStudents.forEach(st => {
            const main = st.grade ? st.grade[0] : 'F';
            if (counts[main] !== undefined) {
                counts[main]++;
            }
        });

        const tbody = document.getElementById('grading-stats-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        const classTargetStats = pendingUploadData.classTargetStats || {};
        const distType = pendingUploadData.distType || 'ratio';

        // Calculate target stats for this view
        const targetStats = { A: 0, B: 0, C: 0, D: 0, F: 0 };
        if (selectedClass === 'all') {
            Object.values(classTargetStats).forEach(cStats => {
                ['A', 'B', 'C', 'D', 'F'].forEach(grade => {
                    targetStats[grade] += cStats[grade] ? cStats[grade].targetCount : 0;
                });
            });
        } else {
            const cStats = classTargetStats[selectedClass] || {};
            ['A', 'B', 'C', 'D', 'F'].forEach(grade => {
                targetStats[grade] = cStats[grade] ? cStats[grade].targetCount : 0;
            });
        }

        const distValA = parseFloat(document.getElementById('grading-val-a').value) || 0;
        const distValB = parseFloat(document.getElementById('grading-val-b').value) || 0;
        const distValC = parseFloat(document.getElementById('grading-val-c').value) || 0;
        const distValD = parseFloat(document.getElementById('grading-val-d').value) || 0;
        const distRatios = { A: distValA, B: distValB, C: distValC, D: distValD, F: 0 };

        ['A', 'B', 'C', 'D', 'F'].forEach(grade => {
            const actual = counts[grade];
            const actualPct = normalCount > 0 && grade !== 'F'
                ? ((actual / normalCount) * 100).toFixed(1) + '%'
                : grade === 'F' ? ((actual / totalN) * 100).toFixed(1) + '%' : '0.0%';

            const targetCount = targetStats[grade];
            
            let targetText = '';
            if (grade === 'F') {
                targetText = '-';
            } else {
                targetText = distType === 'ratio'
                    ? `${distRatios[grade]}% (${targetCount}명)`
                    : `${targetCount}명`;
            }

            let statusText = '🟢 일치';
            let statusColor = '#34d399';
            
            if (grade !== 'F') {
                if (actual !== targetCount) {
                    statusText = `⚠️ 편차 (${actual - targetCount > 0 ? '+' : ''}${actual - targetCount}명)`;
                    statusColor = '#fbbf24';
                }
            } else {
                statusText = '일반 F';
            }

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-glass)';
            tr.innerHTML = `
                <td style="padding:10px; font-weight:700; color:white;">${grade} 등급</td>
                <td style="padding:10px; color:var(--text-secondary);">${targetText}</td>
                <td style="padding:10px; font-weight:700; color:white;">${actual}명</td>
                <td style="padding:10px; color:var(--text-secondary);">${actualPct}</td>
                <td style="padding:10px; color:${statusColor}; font-weight:600;">${statusText}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderStep5C() {
        const wrap = document.getElementById('override-scores-table-wrap');
        if (!wrap || !pendingUploadData) return;

        const allStudents = getPendingStudentList();
        const studentList = getVisibleSortedStudents('step5c', allStudents);

        let ths = `
            ${classFilterTh('step5c', allStudents)}
            ${sortableTh('step5c', '학번', 'student_id')}
            ${sortableTh('step5c', '성명', 'name')}
            ${sortableTh('step5c', '총점 조정', 'total_score', 'width:12%;')}
            ${sortableTh('step5c', '최종 학점', 'grade', 'width:18%;')}
            ${sortableTh('step5c', '상대평가 제외', 'relative_excluded', 'width:15%;')}
            ${sortableTh('step5c', '사유/비고', 'remark')}
        `;

        let trs = '';
        studentList.forEach(st => {
            const displayStudentId = escapeHtml(getProfessorStudentId(st));
            const displayStudentName = escapeHtml(getProfessorStudentName(st));
            const isAttendanceF = st.absences >= 4;
            const grades = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F'];
            let gradeOptions = '';
            grades.forEach(g => {
                const targetGrade = isAttendanceF ? 'F' : st.grade;
                const selected = targetGrade === g ? 'selected' : '';
                gradeOptions += `<option value="${g}" ${selected}>${g}</option>`;
            });

            const checkedExclude = st.is_relative_excluded ? 'checked' : '';
            const checkedF = st.is_f ? ' (자동 F)' : '';
            const exclusionReason = getRelativeExclusionReason(st);
            const remarkText = st.f_reason
                ? `🚫 ${st.f_reason}`
                : (st.is_relative_excluded && exclusionReason ? `상대평가 제외: ${exclusionReason}` : (st.remark || '-'));

            const disabledAttr = isAttendanceF ? 'disabled' : '';
            const cursorStyle = isAttendanceF ? 'cursor: not-allowed; opacity: 0.6;' : 'cursor: pointer;';

            const totalScoreVal = st.total_score !== null && st.total_score !== undefined && !isNaN(st.total_score) ? Number(st.total_score).toFixed(1) : '';
            trs += `
                <tr style="border-bottom:1px solid var(--border-glass);" data-student-key="${st._studentKey}" data-student-id="${displayStudentId}" data-name="${displayStudentName}">
                    <td style="padding:10px; text-align:center;">${st.class_num}반</td>
                    <td style="padding:10px; text-align:center; color:white;">${displayStudentId}</td>
                    <td style="padding:10px; text-align:center;">${displayStudentName}</td>
                    <td style="padding:10px; text-align:center;">
                        <input type="number" class="override-score-input" value="${totalScoreVal}" step="0.1" ${disabledAttr} style="width:70px; padding:6px; border-radius:4px; background:rgba(15,23,42,0.8); color:white; border:1px solid var(--border-glass); text-align:center; outline:none; ${isAttendanceF ? 'opacity:0.6;' : ''}">
                    </td>
                    <td style="padding:10px; text-align:center;">
                        <select class="override-grade-select" ${disabledAttr} style="padding:6px; border-radius:4px; background:rgba(15,23,42,0.8); color:white; border:1px solid var(--border-glass); outline:none; font-weight:700; ${isAttendanceF ? 'opacity:0.6;' : ''}">
                            ${gradeOptions}
                        </select>
                    </td>
                    <td style="padding:10px; text-align:center;">
                        <input type="checkbox" class="override-exclude-checkbox" ${checkedExclude} ${disabledAttr} style="${cursorStyle} width:16px; height:16px;">
                    </td>
                    <td style="padding:10px; text-align:left; font-size:11px; color:var(--text-secondary);">${remarkText}${checkedF}</td>
                </tr>
            `;
        });

        const filterHTML = classFilterDropdownHTML('step5c', allStudents);
        wrap.innerHTML = `
            ${filterHTML ? `<div style="display:flex; justify-content:flex-end; margin-bottom:8px;">${filterHTML}</div>` : ''}
            <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center;">
                <thead>
                    <tr style="background:rgba(255,255,255,0.05); color:var(--text-main); font-weight:600;">
                        ${ths}
                    </tr>
                </thead>
                <tbody>
                    ${trs}
                </tbody>
            </table>
        `;
        bindGradingTableControls(wrap, 'step5c', renderStep5C);

        wrap.querySelectorAll('tr[data-student-id]').forEach(tr => {
            const st = pendingUploadData.students[tr.dataset.studentKey];
            if (!st) return;

            tr.querySelector('.override-score-input').addEventListener('input', function() {
                const val = parseFloat(this.value);
                if (!isNaN(val)) {
                    st.total_score = val;
                    updateGradingStats();
                }
            });
            tr.querySelector('.override-score-input').addEventListener('change', function() {
                if (gradingTableState.step5c.sortKey === 'total_score') renderStep5C();
            });

            tr.querySelector('.override-grade-select').addEventListener('change', function() {
                st.grade = this.value;
                if (st.grade === 'F') {
                    st.is_f = true;
                    if (!st.f_reason) st.f_reason = '수동 F';
                } else {
                    st.is_f = false;
                    st.f_reason = null;
                }
                updateGradingStats();
                if (gradingTableState.step5c.sortKey === 'grade') renderStep5C();
            });

            tr.querySelector('.override-exclude-checkbox').addEventListener('change', function() {
                st.is_relative_excluded = this.checked;
                updateGradingStats();
                if (gradingTableState.step5c.sortKey === 'relative_excluded' || gradingTableState.step5c.sortKey === 'remark') {
                    renderStep5C();
                }
            });
        });

        // 분반 필터 드롭다운 채우기 및 바인딩
        const classSelect = document.getElementById('grading-stats-class-select');
        if (classSelect) {
            const classNums = getClassNumsFromStudents(allStudents);
            const prevValue = gradingTableState.step5c.classFilter || classSelect.value || 'all';
            classSelect.innerHTML = '<option value="all">전체 분반</option>';
            classNums.forEach(cNum => {
                const opt = document.createElement('option');
                opt.value = String(cNum);
                opt.textContent = `${cNum}분반`;
                classSelect.appendChild(opt);
            });
            if (classNums.map(String).includes(prevValue)) {
                classSelect.value = prevValue;
            } else {
                classSelect.value = 'all';
            }

            const newClassSelect = classSelect.cloneNode(true);
            classSelect.parentNode.replaceChild(newClassSelect, classSelect);
            newClassSelect.addEventListener('change', () => {
                gradingTableState.step5c.classFilter = newClassSelect.value;
                renderStep5C();
            });
        }

        updateGradingStats();
    }

    function confirmGradingResults() {
        if (!pendingUploadData) return;

        const { course } = adminConfig;
        const dataKey = getCourseDataKey(course);

        try {
            localStorage.setItem(dataKey, JSON.stringify(pendingUploadData));
            const legacyKey = getCourseDataKeys(course).find(key => key !== dataKey);
            if (legacyKey) localStorage.removeItem(legacyKey);

            const courseListRaw = localStorage.getItem('scorequery_courses') || '[]';
            const courseList = JSON.parse(courseListRaw);
            const exists = courseList.find(c =>
                c.year === course.year && c.semester === course.semester && c.name === course.name
            );
            if (!exists) {
                courseList.push(withCourseId({
                    year: course.year,
                    semester: course.semester,
                    name: course.name,
                    professor: currentUser ? { name: currentUser.name, email: currentUser.email } : null
                }));
                localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
            } else if (currentUser) {
                exists.id = getCourseId(course);
                exists.professor = { name: currentUser.name, email: currentUser.email };
                localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
            }

            localStorage.setItem('scorequery_data', JSON.stringify(pendingUploadData));
        } catch (e) {
            alert('⚠️ 데이터 저장 실패 (용량 초과 가능)');
            return;
        }

        const studentCount = Object.keys(pendingUploadData.students).length;
        const classCount = Object.keys(pendingUploadData.class_counts).length;

        showUploadStatus('success',
            `🎉 성적 데이터가 최종 확정되었습니다!\n` +
            `학생 ${studentCount}명 · ${classCount}개 분반\n` +
            `다음 단계에서 공시 기간을 설정하세요.`);

        goToStep(6);
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

        // 비밀번호 변경 감지 안내
        const accessCodeEl = document.getElementById('publish-access-code');
        if (accessCodeEl) {
            accessCodeEl.addEventListener('input', function() {
                const noticeEl = document.getElementById('edit-mode-notice');
                const dataKey = getCourseDataKey(adminConfig.course);
                const hasRaw = !!localStorage.getItem(dataKey);

                if (hasRaw && noticeEl) {
                    noticeEl.innerHTML = `
                        ⚠️ <strong>비밀번호 수정 감지됨</strong>: 접속 비밀번호를 새로 설정하고 있습니다. 변경을 완료하려면 새로운 엑셀 파일을 다시 업로드(선택 사항)한 후, 다음 단계로 이동하여 <strong>학점 산출을 재실행</strong>해 주십시오. (기존 비밀번호로 해싱된 학생 데이터를 새 비밀번호로 다시 해싱해야 합니다.)
                    `;
                    noticeEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                    noticeEl.style.background = 'rgba(239, 68, 68, 0.08)';
                }
            });
        }
    }

    // 업로드된 데이터를 임시 보관 (확정 전)
    let pendingUploadData = null;
    let pendingConvertedRows = null;
    let pendingConvertedHeaders = null;
    // 파이프라인 상태
    let pipelineIsStandard = false;
    let pipelineConvertedData = null; // { rows, headers }

    async function processUploadedFile(file) {
        // 🔑 접속 비밀번호 6자리 설정 검증
        const accessCodeEl = document.getElementById('publish-access-code');
        const accessCode = accessCodeEl ? accessCodeEl.value.trim() : '';
        if (!accessCode || accessCode.length !== 6 || !/^\d{6}$/.test(accessCode)) {
            alert('⚠️ 성적 파일을 업로드하기 전에, 먼저 6자리 성적조회 접속 비밀번호를 올바르게 입력해 주세요.');
            showUploadStatus('error', '⚠️ 접속 비밀번호 6자리 설정 필요');
            if (accessCodeEl) accessCodeEl.focus();
            return;
        }

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

            // 수정 시 안내 업데이트
            const dataKey = getCourseDataKey(adminConfig.course);
            const hasRaw = !!localStorage.getItem(dataKey);
            if (hasRaw) {
                const noticeEl = document.getElementById('edit-mode-notice');
                if (noticeEl) {
                    noticeEl.innerHTML = `
                        ⚠️ <strong>새 성적 파일이 업로드됨</strong>: 성적 파일이 성공적으로 교체되었습니다. 변경 내용을 최종 반영하려면 다음 단계로 이동하여 <strong>학점 산출을 실행</strong>해 주십시오.
                    `;
                    noticeEl.style.borderColor = 'rgba(245, 158, 11, 0.4)';
                    noticeEl.style.background = 'rgba(245, 158, 11, 0.08)';
                }
            }

        } catch (err) {
            console.error('[Upload Error]', err);
            showUploadStatus('error', `⚠️ 파일 처리 오류: ${err.message}\n${err.stack || ''}`);
        }
    }

    // ── 표준 포맷 판별 ──
    function isStandardFormat(headers, mapping) {
        // 기본 필수 헤더 존재 여부 (이름/성명 유연성 대응)
        const required = ['학번', ['이름', '성명'], '전화번호'];
        const hasBase = required.every(r => {
            if (Array.isArray(r)) {
                return r.some(sub => headers.some(h => h.includes(sub)));
            }
            return headers.some(h => h.includes(r));
        });
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

        return allEvalMatch;
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
                this.classList.remove('active');
                this.classList.add('done');
                this.textContent = '✅ 확정 완료';

                const nextBtn = document.getElementById('btn-upload-next');
                if (nextBtn) {
                    nextBtn.style.display = '';
                    nextBtn.removeAttribute('disabled');
                }
                goToStep(5);
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
                this.classList.remove('active');
                this.classList.add('done');
                this.textContent = '✅ 확정 완료';

                const nextBtn = document.getElementById('btn-upload-next');
                if (nextBtn) {
                    nextBtn.style.display = '';
                    nextBtn.removeAttribute('disabled');
                }
                goToStep(5);
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
            studentId:   find(['학번']),
            name:        find(['성명', '이름']),
            year:        find(['학년']),
            dept:        find(['소속', '학과', '학부', '전공']),
            classNum:    find(['분반', '반']),
            phone:       find(['전화', '핸드폰', '연락처', '휴대폰']),
            exclude:     find(['상대평가제외사유', '상대평가 제외 사유', '상대평가제외', '상대평가 제외', '제외사유', '제외']),
            extra:       find(['가산점']),
            extraMemo:   find(['가산메모']),
            special:     find(['특별점수', '특별']),
            specialMemo: find(['특별점수메모', '특별메모']),
            total:       find(['합계', '총점', '성적']),
            rank:        find(['석차', '순위', '등수'], ['결석']),
            grade:       find(['학점', '평점', '등급']),
            absences:    find(['결석', '결석횟수', '결석차시']),
            remark:      find(['비고', '메모', '참고']),
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

        // 필수: 성명
        if (mapping.name) {
            checks.push({ status: 'pass', label: '성명(이름)', detail: '확인됨' });
        } else {
            checks.push({ status: 'fail', label: '성명(이름)', detail: '열을 찾을 수 없음' });
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

        // 선택: 소속 학과, 분반, 학년
        ['dept', 'classNum', 'year'].forEach(key => {
            const labels = { dept: '소속(학과)', classNum: '분반', year: '학년' };
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

        // 성적, 석차, 평점 및 가산점, 특별점수 등
        ['total', 'rank', 'grade', 'absences', 'remark', 'exclude', 'extra', 'extraMemo', 'special', 'specialMemo'].forEach(key => {
            const labels = {
                total: '합계(성적)',
                rank: '석차',
                grade: '평점',
                absences: '결석',
                remark: '비고',
                exclude: '상대평가제외',
                extra: '가산점',
                extraMemo: '가산메모',
                special: '특별점수',
                specialMemo: '특별점수메모'
            };
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
        let verificationStatsHtml = '';
        if (dataJson && dataJson.verificationReport) {
            const report = dataJson.verificationReport;
            const modelText = '✅ <strong>비율 반영 완료</strong> (엑셀에 입력된 값에 추가 비율 가중치 변환 없이 그대로 수집 처리했습니다)';
            verificationStatsHtml = `
                <div class="validation-stat">
                    <div class="validation-stat-value" style="color:${report.totalMismatches > 0 ? '#fcd34d' : '#6ee7b7'}">${report.totalMismatches || 0}</div>
                    <div class="validation-stat-label">총점 불일치</div>
                </div>
                <div class="validation-stat">
                    <div class="validation-stat-value" style="color:${report.missingScoreCells > 0 ? '#fcd34d' : '#6ee7b7'}">${report.missingScoreCells || 0}</div>
                    <div class="validation-stat-label">점수 결측</div>
                </div>
                <div class="validation-stat">
                    <div class="validation-stat-value" style="color:${report.skippedRows > 0 ? '#fca5a5' : '#6ee7b7'}">${report.skippedRows || 0}</div>
                    <div class="validation-stat-label">인증정보 누락</div>
                </div>
            `;
                
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
                    ${verificationStatsHtml}
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
        const baseHeaders = ['분반', '소속', '학년', '학번', '성명', '전화번호'];
        const evalHeaders = effectiveEval.map(e => {
            const r = e.ratio > 0 ? `(${e.ratio}%)` : '';
            return `${e.label}${r}`;
        });
        const tailHeaders = ['가산점', '가산메모', '상대평가제외사유', '특별점수', '특별점수메모', '합계', '석차'];
        const sampleHeaders = [...baseHeaders, ...evalHeaders, ...tailHeaders];

        // 각 행을 샘플 규격으로 변환
        const convertedRows = rows.map(row => {
            const out = {};
            out['분반'] = mapping.classNum ? (parseInt(row[mapping.classNum]) || 1) : 1;
            out['소속'] = mapping.dept ? (row[mapping.dept] ?? '') : '';
            out['학년'] = mapping.year ? (row[mapping.year] ?? '') : '';
            out['학번'] = row[mapping.studentId] ?? '';
            out['성명'] = row[mapping.name] ?? '';
            out['전화번호'] = mapping.phone ? (row[mapping.phone] ?? '') : '';

            // 평가 항목 합산 계산
            let evalSum = 0;
            effectiveEval.forEach((e, idx) => {
                const headerName = evalHeaders[idx];
                const col = mapping.eval[e.id];
                const scoreVal = col ? parseFloat(row[col]) : 0;
                out[headerName] = col ? (row[col] ?? '') : '';
                evalSum += isNaN(scoreVal) ? 0 : scoreVal;
            });

            const extraVal = mapping.extra ? parseFloat(row[mapping.extra]) : 0;
            const extraScore = isNaN(extraVal) ? 0 : extraVal;
            out['가산점'] = mapping.extra ? (row[mapping.extra] ?? '') : '';
            out['가산메모'] = mapping.extraMemo ? (row[mapping.extraMemo] ?? '') : '';
            out['상대평가제외사유'] = mapping.exclude ? (row[mapping.exclude] ?? '') : '';

            const specialVal = mapping.special ? parseFloat(row[mapping.special]) : 0;
            const specialScore = isNaN(specialVal) ? 0 : specialVal;
            out['특별점수'] = mapping.special ? (row[mapping.special] ?? '') : '';
            out['특별점수메모'] = mapping.specialMemo ? (row[mapping.specialMemo] ?? '') : '';

            // 합계 = 평가항목합계 + 가산점 + 특별점수 (100점 초과 가능)
            out['합계'] = parseFloat((evalSum + extraScore + specialScore).toFixed(2));
            out['석차'] = ''; // 분반별 석차 계산에서 채워짐

            return out;
        });

        // 분반별 석차 계산
        const classGroups = {};
        convertedRows.forEach(row => {
            const cn = row['분반'];
            if (!classGroups[cn]) classGroups[cn] = [];
            classGroups[cn].push(row);
        });

        Object.values(classGroups).forEach(group => {
            group.forEach(row => {
                const mySum = row['합계'];
                const rank = group.filter(r => r['합계'] > mySum).length + 1;
                row['석차'] = rank;
            });
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
            if (h === '상대평가제외사유') return { wch: 18 };
            if (h === '성명' || h === '이름' || h === '소속' || h === '학과' || h === '특별점수메모' || h === '가산메모') return { wch: 12 };
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
            return `<th${clsAttr}>${escapeHtml(h)}</th>`;
        }).join('');

        // 행 (최대 200행)
        const displayRows = rows.slice(0, 200);
        const trHtml = displayRows.map(row => {
            const tds = headers.map(h => {
                let v = row[h];
                const alignCls = getAlignClass(h);
                let clsList = [];
                if (alignCls) clsList.push(alignCls);

                // 숫자
                if (typeof v === 'number') {
                    const formatted = v % 1 === 0 ? v : v.toFixed(2);
                    return `<td class="${clsList.join(' ')}">${formatted}</td>`;
                }
                
                const clsAttr = clsList.length > 0 ? ` class="${clsList.join(' ')}"` : '';
                return `<td${clsAttr}>${escapeHtml(v ?? '')}</td>`;
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
        const dataKey = getCourseDataKey(course);

        try {
            localStorage.setItem(dataKey, JSON.stringify(pendingUploadData));
            const legacyKey = getCourseDataKeys(course).find(key => key !== dataKey);
            if (legacyKey) localStorage.removeItem(legacyKey);

            // 과목 목록도 저장 (학생모드 선택용)
            const courseListRaw = localStorage.getItem('scorequery_courses') || '[]';
            const courseList = JSON.parse(courseListRaw);
            const exists = courseList.find(c =>
                c.year === course.year && c.semester === course.semester && c.name === course.name
            );
            if (!exists) {
                courseList.push(withCourseId({
                    year: course.year,
                    semester: course.semester,
                    name: course.name,
                    professor: currentUser ? { name: currentUser.name, email: currentUser.email } : null
                }));
                localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
            } else if (currentUser) {
                exists.id = getCourseId(course);
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
        let skippedRows = 0;
        let missingScoreCells = 0;

        const accessCodeEl = document.getElementById('publish-access-code');
        const accessCode = accessCodeEl ? accessCodeEl.value.trim() : '';

        // 2. 학생별 성적 변환 및 검증 루프
        let rowIndex = 0;
        for (const row of rows) {
            const studentId = String(row[mapping.studentId] || '').trim();
            const name = String(row[mapping.name] || '').trim();
            const rawPhone = mapping.phone ? String(row[mapping.phone] || '').trim() : '';
            const phone = rawPhone.replace(/[^0-9]/g, '');
            const phoneLast4 = phone.slice(-4);
            const dept = mapping.dept ? String(row[mapping.dept] || '').trim() : '';
            const classNum = mapping.classNum ? (parseInt(row[mapping.classNum]) || 1) : 1;
            const absences = mapping.absences ? (parseInt(row[mapping.absences]) || 0) : 0;
            const remark = mapping.remark ? String(row[mapping.remark] || '').trim() : '';
            const excludeReason = mapping.exclude ? String(row[mapping.exclude] || '').trim() : '';
            const grade = mapping.grade ? String(row[mapping.grade] || '').trim() : '';
            const rank = mapping.rank ? String(row[mapping.rank] || '').trim() : '';
            const totalScore = mapping.total ? (parseFloat(row[mapping.total]) || 0) : 0;
            const extraScore = mapping.extra ? (parseFloat(row[mapping.extra]) || 0) : 0;
            const extraMemo = mapping.extraMemo ? String(row[mapping.extraMemo] || '').trim() : '';
            const specialScore = mapping.special ? (parseFloat(row[mapping.special]) || 0) : 0;
            const specialMemo = mapping.specialMemo ? String(row[mapping.specialMemo] || '').trim() : '';

            if (!studentId || !phoneLast4) {
                skippedRows++;
                rowIndex++;
                continue;
            }

            const hashKey = await sha256(`${studentId}|${phoneLast4}|${accessCode}`);

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
                        missingScoreCells++;
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

            // 계산 총점 = 평가항목 가중합산 + 가산점 + 특별점수 (100점 초과 가능)
            const calculatedSum = Object.values(scores).reduce((sum, v) => sum + (v || 0), 0) + extraScore + specialScore;
            const finalCalculatedTotal = parseFloat(calculatedSum.toFixed(2));

            // 엑셀 총점 우선 사용
            const excelTotal = (mapping.total && row[mapping.total] !== undefined && row[mapping.total] !== '') ? parseFloat(row[mapping.total]) : null;
            let finalTotal = (excelTotal !== null && !isNaN(excelTotal)) ? parseFloat(excelTotal.toFixed(2)) : finalCalculatedTotal;

            let finalGrade = grade || '-';
            let finalIsF = false;
            let finalFReason = null;

            if (absences >= 4) {
                finalTotal = 0;
                finalGrade = 'F';
                finalIsF = true;
                finalFReason = '출석미달';
            }

            // 총점 불일치 검증
            if (mapping.total && totalScore !== 0 && absences < 4) {
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
                    if ('합계' in cRowRef) cRowRef['합계'] = finalTotal;
                    if ('석차' in cRowRef) cRowRef['석차'] = absences >= 4 ? '-' : rank;
                }
            }
            rowIndex++;

            const entry = {
                department: dept,
                class_num: classNum,
                student_id: studentId,
                student_name: name,
                phone: rawPhone,
                student_id_masked: idMasked,
                name_masked: nameMasked,
                ...scores,
                extra_score: extraScore || null,
                extra_memo: extraMemo,
                special_score: specialScore || null,
                special_memo: specialMemo,
                total_score: finalTotal,
                rank: absences >= 4 ? '-' : (rank || `-`),
                grade: finalGrade,
                absences: absences,
                remark: remark,
                exclude_reason: excludeReason,
                relative_exclusion_reason: uniqueNonEmpty([excludeReason, extraMemo]).join(' / '),
                is_relative_excluded: !!(excludeReason || extraMemo || hasRelativeExclusionMarker(remark)),
                is_f: finalIsF,
                f_reason: finalFReason,
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

            // 만약 석차가 누락된 학생이 있다면, 분반별로 합계(total_score) 기준 석차를 계산하여 보완합니다.
            const needsRankCalculation = entries.some(e => !e.rank || e.rank === '-' || e.rank === '');
            if (needsRankCalculation) {
                entries.forEach((e) => {
                    if (!e.rank || e.rank === '-' || e.rank === '') {
                        const myTotal = e.total_score || 0;
                        const computedRank = entries.filter(other => (other.total_score || 0) > myTotal).length + 1;
                        e.rank = String(computedRank);
                        
                        // cRow가 있으면 동기화
                        if (e._cRow) {
                            e._cRow['석차'] = computedRank;
                        }
                    }
                });
            }

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
                const vals = entries
                    .filter(e => {
                        const remark = String(e.remark || '').trim();
                        return !(remark.includes('결시') || remark.includes('미응시'));
                    })
                    .map(e => e[key])
                    .filter(v => v !== null && v !== undefined);

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
                id: getCourseId(adminConfig.course),
                year: adminConfig.course.year,
                semester: adminConfig.course.semester,
                name: adminConfig.course.name
            },
            professor: {
                name: adminConfig.professor.name,
                email: adminConfig.professor.email
            },
            access_code: accessCode,
            gas_url: localStorage.getItem('scorequery_gas_url') || '',
            api_url: localStorage.getItem('scorequery_api_url') || '',
            evaluation: adminConfig.evaluation,
            students,
            class_avg: classAvg,
            class_max: classMax,
            class_counts: classCounts,
            verificationReport: {
                useWeightedScaling,
                totalMismatches,
                mismatchDetails,
                skippedRows,
                missingScoreCells
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

        // New course list controls
        const btnCreateNew = document.getElementById('btn-create-new-course');
        if (btnCreateNew) {
            btnCreateNew.addEventListener('click', startNewWizardCourse);
        }
        const filterSemester = document.getElementById('filter-semester');
        if (filterSemester) {
            filterSemester.addEventListener('change', (e) => {
                renderWizardCourseList(e.target.value);
            });
        }

        // Semester custom toggle and class styling
        const cSemester = document.getElementById('course-semester');
        if (cSemester) {
            cSemester.addEventListener('change', (e) => {
                toggleSemesterCustom();
                e.target.classList.toggle('select-unselected', !e.target.value);
            });
        }

        const cYear = document.getElementById('course-year');
        if (cYear) {
            cYear.addEventListener('change', (e) => {
                e.target.classList.toggle('select-unselected', !e.target.value);
            });
        }

        const cName = document.getElementById('course-name');
        if (cName) {
            cName.addEventListener('input', checkStep2SaveButtonVisibility);
        }

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
            const courseEntry = withCourseId({
                ...adminConfig.course,
                evaluation: [...adminConfig.evaluation]
            });
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

        // 📊 수강생 성적 열람 현황 - 자세히 보기
        const btnViewStatsDetail = document.getElementById('btn-view-stats-detail');
        if (btnViewStatsDetail) {
            btnViewStatsDetail.addEventListener('click', openStatsDetailModal);
        }
        const btnViewStatsDownload = document.getElementById('btn-view-stats-download');
        if (btnViewStatsDownload) {
            btnViewStatsDownload.addEventListener('click', downloadStatsExcel);
        }

        // 상세 모달 닫기
        const btnStatsModalClose = document.getElementById('btn-stats-modal-close');
        const btnStatsModalCloseX = document.getElementById('btn-stats-modal-close-x');
        const statsDetailModal = document.getElementById('stats-detail-modal');

        if (btnStatsModalClose) {
            btnStatsModalClose.addEventListener('click', closeStatsDetailModal);
        }
        if (btnStatsModalCloseX) {
            btnStatsModalCloseX.addEventListener('click', closeStatsDetailModal);
        }
        if (statsDetailModal) {
            statsDetailModal.addEventListener('click', (e) => {
                if (e.target === statsDetailModal) {
                    closeStatsDetailModal();
                }
            });
        }

        // 상세 모달 필터 탭 바인딩
        const tabFilterAll = document.getElementById('tab-filter-all');
        const tabFilterViewed = document.getElementById('tab-filter-viewed');
        const tabFilterUnviewed = document.getElementById('tab-filter-unviewed');

        if (tabFilterAll) tabFilterAll.addEventListener('click', () => switchStatsFilter('all'));
        if (tabFilterViewed) tabFilterViewed.addEventListener('click', () => switchStatsFilter('viewed'));
        if (tabFilterUnviewed) tabFilterUnviewed.addEventListener('click', () => switchStatsFilter('unviewed'));

        // 상세 모달 엑셀 다운로드 바인딩
        const btnStatsExcelDownload = document.getElementById('btn-stats-excel-download');
        if (btnStatsExcelDownload) {
            btnStatsExcelDownload.addEventListener('click', downloadStatsExcel);
        }

        // Complete actions
        document.getElementById('btn-download-excel').addEventListener('click', downloadSampleExcel);
        const btnDownloadFinalGrades = document.getElementById('btn-download-final-grades');
        if (btnDownloadFinalGrades) {
            btnDownloadFinalGrades.addEventListener('click', downloadFinalGradesExcel);
        }
        document.getElementById('btn-go-home').addEventListener('click', showModeSelection);

        // Step 4 navigation buttons
        const btnUploadBack = document.getElementById('btn-upload-back');
        if (btnUploadBack) {
            btnUploadBack.addEventListener('click', () => goToStep(3));
        }
        const btnUploadNext = document.getElementById('btn-upload-next');
        if (btnUploadNext) {
            btnUploadNext.addEventListener('click', () => goToStep(5));
        }

        // Step 5 navigation buttons
        const btnGradingABack = document.getElementById('btn-grading-a-back');
        if (btnGradingABack) {
            btnGradingABack.addEventListener('click', () => goToStep(4));
        }
        const btnGradingANext = document.getElementById('btn-grading-a-next');
        if (btnGradingANext) {
            btnGradingANext.addEventListener('click', () => showGradingSubPanel('b'));
        }

        const btnGradingBBack = document.getElementById('btn-grading-b-back');
        if (btnGradingBBack) {
            btnGradingBBack.addEventListener('click', () => showGradingSubPanel('a'));
        }
        const btnGradingBRun = document.getElementById('btn-grading-b-run');
        if (btnGradingBRun) {
            btnGradingBRun.addEventListener('click', runGradingPipeline);
        }

        const btnGradingCBack = document.getElementById('btn-grading-c-back');
        if (btnGradingCBack) {
            btnGradingCBack.addEventListener('click', () => showGradingSubPanel('b'));
        }
        const btnGradingCConfirm = document.getElementById('btn-grading-c-confirm');
        if (btnGradingCConfirm) {
            btnGradingCConfirm.addEventListener('click', confirmGradingResults);
        }

        // Step 6 navigation buttons
        const btnPublishBack = document.getElementById('btn-publish-back');
        if (btnPublishBack) {
            btnPublishBack.addEventListener('click', () => {
                goToStep(5);
                showGradingSubPanel('c');
            });
        }
        
        // 과목 선택 변경
        document.getElementById('select-course').addEventListener('change', (e) => {
            selectCourse(parseInt(e.target.value));
        });

        // 공시 버튼
        document.getElementById('btn-publish').addEventListener('click', publishGrades);
        document.getElementById('btn-unpublish').addEventListener('click', unpublishGrades);

        // data.enc.json 다운로드 버튼
        const btnDownloadJson = document.getElementById('btn-download-json');
        if (btnDownloadJson) {
            btnDownloadJson.addEventListener('click', downloadDataJson);
        }

        // Upload (파이프라인 버튼은 renderPipeline에서 동적 바인딩)
        setupUpload();

        // 🔒 성적조회 접속 비밀번호 노출 토글 바인딩 (2차 인증 모달 없이 즉시 토글)
        const btnViewCode = document.getElementById('btn-view-access-code');
        const maskedEl = document.getElementById('publish-access-code-masked');

        if (btnViewCode && maskedEl) {
            btnViewCode.addEventListener('click', () => {
                const originalCode = maskedEl.dataset.original || '';
                if (!originalCode) return;

                const isMasked = maskedEl.textContent.includes('*');
                if (isMasked) {
                    // 마스킹 해제 -> 평문 표시
                    maskedEl.textContent = originalCode.split('').join(' ');
                    btnViewCode.textContent = '숨기기 🙈';
                } else {
                    // 다시 마스킹
                    maskedEl.textContent = originalCode[0] + ' * * * * *';
                    btnViewCode.textContent = '보기 👁';
                }
            });
        }
    }

    // ── 마스터/교수 회원 DB 초기화 ──
    async function initUsersDB() {
        const knownDefaultHashes = new Set([
            '84668ba4df93b3f27df7a360fde2f72c4ad3d9020970a24c2ed2b144bd3540b6',
            'e1fc0011b9b5764beb72e5ecc04625fb77d954041aa442dd943b230a55a45e1d'
        ]);
        const knownDefaultEmails = new Set([
            'armour@tu.ac.kr',
            'changgab.seo@gmail.com',
            'armour@g.tu.ac.kr'
        ]);

        let users = [];
        try {
            users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
            if (!Array.isArray(users)) users = [];
        } catch {
            users = [];
        }

        const filtered = users.filter(user => {
            const email = String(user.email || '').toLowerCase();
            const hash = String(user.pw || '');
            return !(knownDefaultEmails.has(email) && knownDefaultHashes.has(hash));
        });

        if (filtered.length !== users.length) {
            clearProfessorSession();
        }
        localStorage.setItem('scorequery_users', JSON.stringify(filtered));
    }
    async function callGasApi(action, payload, auth) {
        const gasUrl = localStorage.getItem('scorequery_gas_url');
        if (!gasUrl) {
            console.warn('[ScoreQuery] GAS URL is not configured. Falling back to local offline mode.');
            return null;
        }

        try {
            const res = await fetch(gasUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain' // CORS preflight 방지를 위해 단순 요청 타입 사용
                },
                body: JSON.stringify({
                    action: action,
                    payload: payload,
                    auth: auth
                })
            });

            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }

            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Unknown GAS error');
            }
            return data.data;
        } catch (e) {
            console.error(`[ScoreQuery] GAS API Error (${action}):`, e);
            throw e;
        }
    }

    async function syncUsersFromGas() {
        // 마스터만 목록을 동기화할 수 있음
        if (!currentUser || !currentUser.isMaster) return;

        if (hasConfiguredServerApi()) {
            try {
                const result = await callServerJson('/api/auth/users');
                if (result && Array.isArray(result.users)) {
                    localStorage.setItem('scorequery_users', JSON.stringify(result.users.map(u => markServerAuthUser(u))));
                    console.log('[ScoreQuery] Successfully synchronized user database from server auth API.');
                    return;
                }
            } catch (e) {
                if (currentUser._authProvider === 'server') {
                    console.error('[ScoreQuery] Failed to sync users from server:', e);
                    alert('⚠️ 서버 회원 목록 동기화 실패: ' + (e.message || '네트워크 오류'));
                    return;
                }
                console.warn('[ScoreQuery] Server user sync failed, using GAS fallback if available.', e);
            }
        }

        const gasUrl = localStorage.getItem('scorequery_gas_url');
        if (!gasUrl) return;

        try {
            const users = await callGasApi('get_users', null, {
                email: currentUser.email,
                pwHash: currentUser.pw
            });
            if (users && Array.isArray(users)) {
                // 구글 시트에서 받은 데이터를 로컬에 덮어씌워 동기화
                localStorage.setItem('scorequery_users', JSON.stringify(users));
                console.log('[ScoreQuery] Successfully synchronized user database from Google Sheet.');
            }
        } catch (e) {
            console.error('[ScoreQuery] Failed to sync users from GAS:', e);
            alert('⚠️ 원격 데이터 동기화 실패: ' + (e.message || '네트워크 오류'));
        }
    }

    async function loadPublicConfig() {
        try {
            const res = await fetch('public-config.json?_t=' + Date.now());
            if (res.ok) {
                const config = await res.json();
                if (config && config.gas_url) {
                    localStorage.setItem('scorequery_gas_url', config.gas_url);
                    console.log('[ScoreQuery] Public GAS URL loaded from server:', config.gas_url);
                }
                if (config && config.api_url) {
                    localStorage.setItem('scorequery_api_url', config.api_url);
                    console.log('[ScoreQuery] Public API URL loaded from server:', config.api_url);
                }
            }
        } catch (e) {
            console.warn('[ScoreQuery] Failed to load public config from server:', e);
        }
    }

    async function autoSavePublicConfigToServer(gasUrl) {
        try {
            const apiUrl = (localStorage.getItem('scorequery_api_url') || '').trim();
            const result = await postLocalAdminJson('/api/save_public_config', {
                gas_url: gasUrl,
                api_url: apiUrl
            });
            if (result.success) {
                console.log('[ScoreQuery] Auto-save public config success:', result.message);
            } else {
                console.warn('[ScoreQuery] Auto-save public config failed on server:', result.error);
            }
            return result;
        } catch (e) {
            console.warn('[ScoreQuery] Auto-save public config connection failed (Flask server might be offline):', e);
            return { success: false, error: 'Connection failed' };
        }
    }

    async function syncGasUrlFromServer() {
        try {
            const savedUrl = localStorage.getItem('scorequery_gas_url');
            if (savedUrl) {
                const gasInput = document.getElementById('gas-url-input');
                if (gasInput) {
                    gasInput.value = savedUrl;
                }
                return savedUrl;
            }
        } catch (e) {
            console.warn('[ScoreQuery] Failed to load GAS URL from local storage:', e);
        }
        return null;
    }

    // ── 인증 세션 처리 초기화 ──
    async function initAuth() {
        await initUsersDB();
        await loadPublicConfig();
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
            const forgotCard = document.getElementById('admin-forgot-pw-card');
            if (forgotCard) forgotCard.style.display = 'none';
        });

        const loginLink = document.getElementById('go-to-login');
        if (loginLink) loginLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('admin-login-card').style.display = '';
            document.getElementById('admin-register-card').style.display = 'none';
            const forgotCard = document.getElementById('admin-forgot-pw-card');
            if (forgotCard) forgotCard.style.display = 'none';
        });

        // 비밀번호 찾기(셀프 리셋) 흐름 바인딩
        bindForgotPasswordFlow();

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
        if (masterChangePw) masterChangePw.addEventListener('click', () => showProfessorInfoMgmtDrawer('pw'));

        const masterBack = document.getElementById('master-back-home');
        if (masterBack) masterBack.addEventListener('click', showModeSelection);

        const adminLogout = document.getElementById('admin-logout-btn');
        if (adminLogout) adminLogout.addEventListener('click', handleLogoutAction);

        const infoMgmtBtn = document.getElementById('admin-info-mgmt-btn');
        if (infoMgmtBtn) infoMgmtBtn.addEventListener('click', () => showProfessorInfoMgmtDrawer('info'));

        try {
            if (isProfessorSessionExpired()) {
                await handleLogoutAction({ reason: 'timeout' });
            } else {
                const storedUser = getStoredProfessorSessionUser();
                if (storedUser) {
                    routeAuthenticatedUser(storedUser);
                } else if (!professorSessionTimedOut) {
                    const serverUser = await getServerSessionUser();
                    if (serverUser) {
                        storeCurrentSession(serverUser);
                        routeAuthenticatedUser(serverUser);
                        bindManualDrawerEvents();
                        return;
                    }
                }
            }
        } catch (e) {
            console.error('Session load error:', e);
        }

        bindManualDrawerEvents();
    }

    function bindManualDrawerEvents() {
        // 1. 교수자 매뉴얼 바인딩
        const btnProfOpen = document.getElementById('btn-open-prof-manual');
        const btnProfClose = document.getElementById('btn-close-prof-manual');
        const profBackdrop = document.getElementById('prof-manual-drawer-backdrop');
        const profDrawer = document.getElementById('prof-manual-drawer');
        
        if (btnProfOpen && profDrawer && profBackdrop) {
            btnProfOpen.addEventListener('click', () => {
                profBackdrop.style.display = 'block';
                profDrawer.style.display = 'flex';
                setTimeout(() => {
                    profBackdrop.classList.add('active');
                    profDrawer.classList.add('active');
                }, 10);
            });
            const closeProf = () => {
                profBackdrop.classList.remove('active');
                profDrawer.classList.remove('active');
                setTimeout(() => {
                    profBackdrop.style.display = 'none';
                    profDrawer.style.display = 'none';
                }, 300);
            };
            if (btnProfClose) btnProfClose.addEventListener('click', closeProf);
            profBackdrop.addEventListener('click', closeProf);
            
            const profVerBtns = profDrawer.querySelectorAll('.prof-version-btn');
            profVerBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const ver = btn.dataset.version;
                    profVerBtns.forEach(b => b.classList.toggle('active', b === btn));
                    document.getElementById('manual-prof-summary').style.display = ver === 'summary' ? 'block' : 'none';
                    document.getElementById('manual-prof-detailed').style.display = ver === 'detailed' ? 'block' : 'none';
                });
            });
        }

        // 2. 학생 매뉴얼 바인딩
        const btnStuOpen = document.getElementById('btn-open-student-manual');
        const btnStuClose = document.getElementById('btn-close-student-manual');
        const stuBackdrop = document.getElementById('student-manual-drawer-backdrop');
        const stuDrawer = document.getElementById('student-manual-drawer');
        
        if (btnStuOpen && stuDrawer && stuBackdrop) {
            btnStuOpen.addEventListener('click', () => {
                stuBackdrop.style.display = 'block';
                stuDrawer.style.display = 'flex';
                setTimeout(() => {
                    stuBackdrop.classList.add('active');
                    stuDrawer.classList.add('active');
                }, 10);
            });
            const closeStu = () => {
                stuBackdrop.classList.remove('active');
                stuDrawer.classList.remove('active');
                setTimeout(() => {
                    stuBackdrop.style.display = 'none';
                    stuDrawer.style.display = 'none';
                }, 300);
            };
            if (btnStuClose) btnStuClose.addEventListener('click', closeStu);
            stuBackdrop.addEventListener('click', closeStu);
            
            const stuVerBtns = stuDrawer.querySelectorAll('.student-version-btn');
            stuVerBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const ver = btn.dataset.version;
                    stuVerBtns.forEach(b => b.classList.toggle('active', b === btn));
                    document.getElementById('manual-student-summary').style.display = ver === 'summary' ? 'block' : 'none';
                    document.getElementById('manual-student-detailed').style.display = ver === 'detailed' ? 'block' : 'none';
                });
            });
        }
    }

    async function handleProfLogin(e) {
        e.preventDefault();
        const email = document.getElementById('admin-login-email').value.trim();
        const pw = document.getElementById('admin-login-pw').value.trim();
        const errorEl = document.getElementById('admin-login-error');
        errorEl.style.display = 'none';

        let user = null;
        let loginError = null;

        if (hasConfiguredServerApi()) {
            try {
                const result = await callServerJson('/api/auth/login', {
                    method: 'POST',
                    payload: { email, password: pw }
                });
                if (result && result.user) {
                    user = markServerAuthUser(result.user);
                }
            } catch (err) {
                console.warn('[ScoreQuery] Server login check failed, using GAS/local fallback if available.', err);
                loginError = err.message || '이메일 또는 비밀번호가 올바르지 않습니다.';
                if ([401, 403, 409].includes(err.status)) {
                    errorEl.textContent = '❌ ' + loginError;
                    errorEl.style.display = 'block';
                    return;
                }
            }
        }

        const pwHashed = user ? null : await sha256(pw);
        const gasUrl = localStorage.getItem('scorequery_gas_url');
        if (!user && gasUrl) {
            try {
                // GAS 데이터베이스에서 검증 및 최신 정보 동기화
                const gasUser = await callGasApi('login', { email, pwHash: pwHashed });
                if (gasUser) {
                    // 로컬스토리지 동기화 및 병합
                    const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
                    const idx = users.findIndex(u => u.email === email);
                    const syncedUser = {
                        name: gasUser.name,
                        univ: gasUser.univ,
                        dept: gasUser.dept,
                        email: gasUser.email,
                        pw: pwHashed,
                        phone: gasUser.phone,
                        status: gasUser.status,
                        isMaster: gasUser.isMaster === true || gasUser.isMaster === 'true',
                        regDate: gasUser.regDate
                    };
                    const cachedUser = { ...syncedUser };
                    delete cachedUser.pw;
                    if (idx >= 0) {
                        users[idx] = cachedUser;
                    } else {
                        users.push(cachedUser);
                    }
                    localStorage.setItem('scorequery_users', JSON.stringify(users));
                    user = syncedUser;
                }
            } catch (err) {
                console.warn('[ScoreQuery] GAS login check failed, using local fallback if available.', err);
                loginError = err.message || '이메일 또는 비밀번호가 올바르지 않습니다.';
            }
        }

        // 서버/GAS 검증이 실패했거나 오프라인일 때 로컬 스토리지 대조로 폴백
        if (!user) {
            const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
            user = users.find(u => u.email === email && u.pw === pwHashed);
            if (!user) {
                errorEl.textContent = '❌ ' + (loginError || '이메일 또는 비밀번호가 올바르지 않습니다.');
                errorEl.style.display = 'block';
                return;
            }
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
        storeCurrentSession(user);
        routeAuthenticatedUser(user);
    }

    // ──────────────────────────────────────────────
    // 셀프 비밀번호 리셋(비밀번호 찾기) 흐름
    // ──────────────────────────────────────────────
    //
    // 동작 요약:
    //  STEP 1 (forgot-pw-step1-form):
    //    - 이메일을 GAS 'request_pw_reset' 액션으로 전송 → 6자리 코드 메일 발송 요청.
    //    - 응답은 계정 존재 여부와 관계없이 항상 동일(계정 열거 방지).
    //    - 성공 시 STEP 2 폼을 표시.
    //
    //  STEP 2 (forgot-pw-step2-form):
    //    - 6자리 코드 + 새 비밀번호(+재확인)를 GAS 'confirm_pw_reset' 로 검증.
    //    - 새 비밀번호는 브라우저에서 SHA-256 해시 후 전송(평문 미전송).
    //    - 성공 시 안내 alert → 로그인 카드로 복귀, 새 비밀번호로 로그인 유도.
    //
    //  오프라인(GAS 미설정) 폴백:
    //    - 셀프 리셋은 메일 발송을 GAS 측에서 수행하므로 GAS 가 없으면 사용 불가.
    //      이 경우 마스터 교수에게 문의하라는 안내를 표시.

    function _resetForgotPwUI() {
        const step1Form = document.getElementById('forgot-pw-step1-form');
        const step2Form = document.getElementById('forgot-pw-step2-form');
        const step1Err  = document.getElementById('forgot-pw-step1-error');
        const step1Info = document.getElementById('forgot-pw-step1-info');
        const step2Err  = document.getElementById('forgot-pw-step2-error');
        if (step1Form) step1Form.reset();
        if (step2Form) {
            step2Form.reset();
            step2Form.style.display = 'none';
        }
        if (step1Form) step1Form.style.display = '';
        if (step1Err)  { step1Err.style.display  = 'none'; step1Err.textContent  = ''; }
        if (step1Info) { step1Info.style.display = 'none'; step1Info.textContent = ''; }
        if (step2Err)  { step2Err.style.display  = 'none'; step2Err.textContent  = ''; }
    }

    function _showForgotPwCard() {
        document.getElementById('admin-login-card').style.display    = 'none';
        document.getElementById('admin-register-card').style.display = 'none';
        document.getElementById('admin-forgot-pw-card').style.display = '';
        _resetForgotPwUI();
        setTimeout(() => {
            const emailInput = document.getElementById('forgot-pw-email');
            if (emailInput) emailInput.focus();
        }, 50);
    }

    function _showLoginCardFromForgot() {
        document.getElementById('admin-forgot-pw-card').style.display = 'none';
        document.getElementById('admin-register-card').style.display  = 'none';
        document.getElementById('admin-login-card').style.display     = '';
        _resetForgotPwUI();
    }

    // 비밀번호 강도 검증 (회원가입과 동일 정책)
    function _isStrongPassword(pw) {
        if (!pw || pw.length < 10) return false;
        const hasLower   = /[a-z]/.test(pw);
        const hasUpper   = /[A-Z]/.test(pw);
        const hasDigit   = /[0-9]/.test(pw);
        const hasSpecial = /[^A-Za-z0-9]/.test(pw);
        return [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length >= 3;
    }

    async function _handleForgotPwStep1(e) {
        e.preventDefault();
        const emailEl = document.getElementById('forgot-pw-email');
        const errEl   = document.getElementById('forgot-pw-step1-error');
        const infoEl  = document.getElementById('forgot-pw-step1-info');
        const btn     = document.getElementById('forgot-pw-step1-btn');
        const step2Form = document.getElementById('forgot-pw-step2-form');

        errEl.style.display = 'none';
        infoEl.style.display = 'none';

        const email = (emailEl.value || '').trim().toLowerCase();
        if (!email || email.indexOf('@') < 0) {
            errEl.textContent = '❌ 올바른 이메일 주소를 입력해 주세요.';
            errEl.style.display = 'block';
            return;
        }

        const gasUrl = localStorage.getItem('scorequery_gas_url');
        if (!gasUrl) {
            errEl.innerHTML =
                '⚠️ 셀프 비밀번호 재설정은 원격(GAS) 서버 연동이 필요합니다.<br>' +
                '관리자(마스터 교수)에게 비밀번호 초기화를 요청해 주세요.';
            errEl.style.display = 'block';
            return;
        }

        const originalBtnText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '발송 중...';

        try {
            // GAS 측에서 계정 존재 여부와 무관하게 동일 응답을 줌(계정 열거 방지)
            const res = await callGasApi('request_pw_reset', { email });
            const msg = (res && res.message)
                ? res.message
                : '해당 이메일이 승인된 회원이라면 비밀번호 재설정 코드를 발송했습니다. 메일함을 확인해 주세요.';
            infoEl.textContent = '✅ ' + msg;
            infoEl.style.display = 'block';
            // 코드 발급 추적용으로 step2 에서 이메일 사용
            step2Form.dataset.email = email;
            step2Form.style.display = '';
            setTimeout(() => {
                const codeEl = document.getElementById('forgot-pw-code');
                if (codeEl) codeEl.focus();
            }, 50);
        } catch (err) {
            console.error('[ScoreQuery] request_pw_reset failed:', err);
            errEl.textContent = '❌ ' + (err.message || '재설정 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
            errEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = originalBtnText;
        }
    }

    async function _handleForgotPwStep2(e) {
        e.preventDefault();
        const step2Form = document.getElementById('forgot-pw-step2-form');
        const codeEl    = document.getElementById('forgot-pw-code');
        const newPwEl   = document.getElementById('forgot-pw-new');
        const newPwConfirmEl = document.getElementById('forgot-pw-new-confirm');
        const errEl     = document.getElementById('forgot-pw-step2-error');
        const btn       = document.getElementById('forgot-pw-step2-btn');

        errEl.style.display = 'none';

        const email = (step2Form.dataset.email || '').trim().toLowerCase();
        const code  = (codeEl.value || '').trim();
        const newPw = (newPwEl.value || '').trim();
        const newPwConfirm = (newPwConfirmEl.value || '').trim();

        if (!email) {
            errEl.textContent = '❌ 이메일 정보가 사라졌습니다. 처음부터 다시 시도해 주세요.';
            errEl.style.display = 'block';
            return;
        }
        if (!/^[0-9]{6}$/.test(code)) {
            errEl.textContent = '❌ 인증 코드는 6자리 숫자여야 합니다.';
            errEl.style.display = 'block';
            return;
        }
        if (!_isStrongPassword(newPw)) {
            errEl.textContent = '❌ 새 비밀번호는 10자 이상이며 영문 대/소문자, 숫자, 특수문자 중 3종 이상을 포함해야 합니다.';
            errEl.style.display = 'block';
            return;
        }
        if (newPw !== newPwConfirm) {
            errEl.textContent = '❌ 새 비밀번호 확인이 일치하지 않습니다.';
            errEl.style.display = 'block';
            return;
        }

        const gasUrl = localStorage.getItem('scorequery_gas_url');
        if (!gasUrl) {
            errEl.textContent = '⚠️ 원격(GAS) 서버 연동이 해제되어 인증을 마칠 수 없습니다.';
            errEl.style.display = 'block';
            return;
        }

        const newPwHash = await sha256(newPw);
        const originalBtnText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '확인 중...';

        try {
            await callGasApi('confirm_pw_reset', { email, code, newPwHash });

            // 로컬 캐시 동기화
            try {
                const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
                const idx = users.findIndex(u => String(u.email || '').toLowerCase() === email);
                if (idx >= 0) {
                    users[idx].pw = newPwHash;
                    localStorage.setItem('scorequery_users', JSON.stringify(users));
                }
            } catch (cacheErr) {
                console.warn('[ScoreQuery] local user cache update skipped:', cacheErr);
            }

            alert('✅ 비밀번호가 성공적으로 재설정되었습니다.\n새 비밀번호로 로그인해 주세요.');
            _showLoginCardFromForgot();

            // 로그인 폼에 이메일 자동 채워 넣어 사용자 편의 향상
            const loginEmailEl = document.getElementById('admin-login-email');
            if (loginEmailEl) loginEmailEl.value = email;
            const loginPwEl = document.getElementById('admin-login-pw');
            if (loginPwEl) {
                loginPwEl.value = '';
                setTimeout(() => loginPwEl.focus(), 50);
            }
        } catch (err) {
            console.error('[ScoreQuery] confirm_pw_reset failed:', err);
            errEl.textContent = '❌ ' + (err.message || '비밀번호 재설정에 실패했습니다.');
            errEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = originalBtnText;
        }
    }

    function bindForgotPasswordFlow() {
        const forgotLink = document.getElementById('go-to-forgot-pw');
        if (forgotLink) {
            forgotLink.addEventListener('click', (e) => {
                e.preventDefault();
                _showForgotPwCard();
            });
        }

        const backToLogin = document.getElementById('forgot-pw-back-to-login');
        if (backToLogin) {
            backToLogin.addEventListener('click', (e) => {
                e.preventDefault();
                _showLoginCardFromForgot();
            });
        }

        const step1Form = document.getElementById('forgot-pw-step1-form');
        if (step1Form) step1Form.addEventListener('submit', _handleForgotPwStep1);

        const step2Form = document.getElementById('forgot-pw-step2-form');
        if (step2Form) step2Form.addEventListener('submit', _handleForgotPwStep2);

        const resendBtn = document.getElementById('forgot-pw-resend');
        if (resendBtn) {
            resendBtn.addEventListener('click', () => {
                const step2Form = document.getElementById('forgot-pw-step2-form');
                if (step2Form) step2Form.style.display = 'none';
                const step1Form = document.getElementById('forgot-pw-step1-form');
                if (step1Form) step1Form.style.display = '';
                const infoEl = document.getElementById('forgot-pw-step1-info');
                if (infoEl) {
                    infoEl.textContent = '';
                    infoEl.style.display = 'none';
                }
                const codeEl = document.getElementById('forgot-pw-code');
                if (codeEl) codeEl.value = '';
                const emailEl = document.getElementById('forgot-pw-email');
                if (emailEl) emailEl.focus();
            });
        }

        // 코드 입력은 숫자만 허용
        const codeInput = document.getElementById('forgot-pw-code');
        if (codeInput) {
            codeInput.addEventListener('input', (e) => {
                e.target.value = (e.target.value || '').replace(/[^0-9]/g, '').slice(0, 6);
            });
        }
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

        // 비밀번호 강도 조건 체크: 10자 이상, 4종 중 3종 이상
        if (!_isStrongPassword(pw)) {
            errorEl.textContent = '❌ 비밀번호는 10자 이상이며 영문 대/소문자, 숫자, 특수문자 중 3종 이상을 포함해야 합니다.';
            errorEl.style.display = 'block';
            return;
        }

        // 비밀번호 재확인 검증
        if (pw !== pwConfirm) {
            errorEl.textContent = '❌ 비밀번호와 비밀번호 재확인이 일치하지 않습니다.';
            errorEl.style.display = 'block';
            return;
        }

        const serverApiAvailable = hasConfiguredServerApi();
        const gasUrl = localStorage.getItem('scorequery_gas_url');
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (!serverApiAvailable && !gasUrl && !isLocalhost) {
            errorEl.textContent = '❌ 원격 승인 데이터베이스 설정(API 또는 GAS URL)이 완료되지 않았습니다. 마스터 교수님께 문의하여 설정(public-config.json 배포)을 완료해 주십시오.';
            errorEl.style.display = 'block';
            return;
        }

        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const isLocalBootstrap = !gasUrl && isLocalhost && users.length === 0;
        const now = new Date().toISOString();
        const pwHashed = await sha256(pw);
        const newUser = {
            name, univ, dept, email,
            pw: pwHashed,
            phone,
            status: isLocalBootstrap ? 'approved' : 'pending',
            isMaster: isLocalBootstrap,
            regDate: now,
            approveDate: isLocalBootstrap ? now : ''
        };

        if (serverApiAvailable) {
            try {
                const result = await callServerJson('/api/auth/register', {
                    method: 'POST',
                    payload: { name, univ, dept, email, password: pw, phone }
                });
                const serverUser = markServerAuthUser(result.user || newUser);
                const existingUserIdx = users.findIndex(u => u.email === email);
                if (existingUserIdx >= 0) {
                    users[existingUserIdx] = serverUser;
                } else {
                    users.push(serverUser);
                }
                localStorage.setItem('scorequery_users', JSON.stringify(users));
                currentUser = serverUser;
                showPendingView(serverUser);
                return;
            } catch (err) {
                if (!gasUrl && !isLocalBootstrap) {
                    errorEl.textContent = '❌ 서버 가입 신청에 실패했습니다: ' + (err.message || '네트워크 오류');
                    errorEl.style.display = 'block';
                    return;
                }
                console.warn('[ScoreQuery] Server register failed, using GAS/local fallback if available.', err);
            }
        }

        if (gasUrl) {
            try {
                // GAS 데이터베이스에 가입 요청 전송
                await callGasApi('register', newUser);
            } catch (err) {
                errorEl.textContent = '❌ 가입 신청에 실패했습니다: ' + (err.message || '네트워크 오류');
                errorEl.style.display = 'block';
                return;
            }
        }

        // 로컬 스토리지 캐시 업데이트 및 재가입 처리
        const existingUserIdx = users.findIndex(u => u.email === email);
        if (existingUserIdx >= 0) {
            users[existingUserIdx] = newUser;
        } else {
            users.push(newUser);
        }
        localStorage.setItem('scorequery_users', JSON.stringify(users));

        currentUser = newUser;
        if (isLocalBootstrap) {
            storeCurrentSession(newUser);
            showMasterDashboard();
            return;
        }
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
        // 1. 가입 신청 정보 텍스트 생성
        const infoText = 
            `[ScoreQuery 가입 신청 정보]\n` +
            `- 신청자 성명: ${user.name}\n` +
            `- 소속 대학교: ${user.univ || '-'}\n` +
            `- 소속 학과: ${user.dept}\n` +
            `- 이메일 주소: ${user.email}\n` +
            `- 휴대전화 번호: ${user.phone}\n` +
            `- 신청 일시: ${new Date(user.regDate).toLocaleString()}`;

        // 2. 클립보드 복사 시도
        navigator.clipboard.writeText(infoText).then(() => {
            alert('📋 가입 신청 정보가 클립보드에 복사되었습니다!\n\n확인을 누르면 마스터(서창갑 교수님)의 승인 요청 구글 폼으로 이동합니다.\n폼 입력란에 복사한 정보를 붙여넣어(Ctrl+V) 신청을 완료해 주세요.');
            
            // 3. 구글 폼 URL로 이동
            const googleFormUrl = localStorage.getItem('scorequery_gas_url') || 'https://forms.google.com';
            window.open(googleFormUrl, '_blank');
        }).catch(err => {
            console.error('Clipboard copy failed:', err);
            alert('가입 신청 정보를 복사하지 못했습니다. 수동 메일 발송 화면을 실행합니다.');
            // 실패 시 기존 메일 클라이언트 및 모달 폴백
            const to = 'armour@tu.ac.kr';
            const subjectText = `[ScoreQuery] 교수자 회원가입 승인 요청 - ${user.name} 교수`;
            sendMail(to, subjectText, infoText);
        });
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

        // 공개 연동 URL 로드 및 바인딩
        const gasInput = document.getElementById('gas-url-input');
        const apiInput = document.getElementById('api-url-input');
        const saveBtn = document.getElementById('save-gas-url-btn');
        const loadGasBtn = document.getElementById('load-gas-url-btn');
        if (gasInput) {
            gasInput.value = localStorage.getItem('scorequery_gas_url') || '';
            if (apiInput) apiInput.value = localStorage.getItem('scorequery_api_url') || '';
            if (saveBtn) {
                saveBtn.onclick = () => {
                    const url = gasInput.value.trim();
                    const apiUrl = apiInput ? apiInput.value.trim().replace(/\/+$/, '') : '';
                    localStorage.setItem('scorequery_gas_url', url);
                    localStorage.setItem('scorequery_api_url', apiUrl);
                    autoSavePublicConfigToServer(url);
                    alert((url || apiUrl) ? '✅ 공개 연동 URL 설정이 저장되었습니다.' : 'ℹ️ 공개 연동 URL 설정이 삭제되었습니다.');
                };
            }
            if (loadGasBtn) {
                loadGasBtn.onclick = async () => {
                    const loadedUrl = await syncGasUrlFromServer();
                    const loadedApiUrl = localStorage.getItem('scorequery_api_url') || '';
                    if (loadedUrl) {
                        gasInput.value = loadedUrl;
                        if (apiInput) apiInput.value = loadedApiUrl;
                        alert('✅ 로컬 저장소에서 공개 연동 URL을 성공적으로 가져왔습니다.');
                    } else if (loadedApiUrl) {
                        if (apiInput) apiInput.value = loadedApiUrl;
                        alert('✅ 로컬 저장소에서 성적 조회 API URL을 성공적으로 가져왔습니다.');
                    } else {
                        if (apiInput) apiInput.value = '';
                        alert('ℹ️ 로컬 저장소에 설정된 공개 연동 URL이 없습니다.');
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

        syncUsersFromGas().then(() => {
            renderMasterPendingList();
        });
    }

    function renderMasterPendingList() {
        const pendingListEl = document.getElementById('master-pending-list');
        const approvedListEl = document.getElementById('master-approved-list');
        const deletedListEl = document.getElementById('master-deleted-list');

        const pendingCountEl = document.getElementById('pending-count-badge');
        const approvedCountEl = document.getElementById('approved-count-badge');
        const deletedCountEl = document.getElementById('deleted-count-badge');

        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const applicants = users;

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
                    const masterBadge = user.isMaster ? `<span style="background:var(--primary);color:white;padding:3px 6px;border-radius:4px;font-size:10px;margin-left:6px;vertical-align:middle;">마스터</span>` : '';

                    const actionHtml = `
                        <div class="master-actions">
                            <button class="btn-approve" data-email="${user.email}">승인</button>
                            ${user.status === 'pending' ? `<button class="btn-reject" data-email="${user.email}">반려</button>` : ''}
                            <button class="btn-delete-user" data-email="${user.email}">삭제</button>
                        </div>
                    `;

                    tr.innerHTML = `
                        <td style="padding:12px; text-align:center; color:var(--text-secondary);">${idx + 1}</td>
                        <td style="padding:12px;">${user.name}${masterBadge}</td>
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
                    const masterBadge = user.isMaster ? `<span style="background:var(--primary);color:white;padding:3px 6px;border-radius:4px;font-size:10px;margin-left:6px;vertical-align:middle;">마스터</span>` : '';
                    const actionHtml = `
                        <div class="master-actions">
                            <button class="btn-reset-pw" data-email="${user.email}">비밀번호 리셋</button>
                            <button class="btn-reject-approved" data-email="${user.email}" style="background:linear-gradient(135deg, #f59e0b, #d97706); border:none; color:white; padding:6px 12px; border-radius:var(--radius-sm); font-size:12px; cursor:pointer;">반려</button>
                            <button class="btn-delete-user" data-email="${user.email}">삭제</button>
                        </div>
                    `;

                    tr.innerHTML = `
                        <td style="padding:12px; text-align:center; color:var(--text-secondary);">${idx + 1}</td>
                        <td style="padding:12px;">${user.name}${masterBadge}</td>
                        <td style="padding:12px;">${user.univ || '-'}</td>
                        <td style="padding:12px;">${user.dept}</td>
                        <td style="padding:12px;">${user.email}</td>
                        <td style="padding:12px;">${user.phone}</td>
                        <td style="padding:12px;">${new Date(user.regDate).toLocaleDateString()}</td>
                        <td style="padding:12px;">${user.approveDate ? new Date(user.approveDate).toLocaleDateString() : '-'}</td>
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

                    const deletedDateStr = user.withdrawReqDate ? new Date(user.withdrawReqDate).toLocaleDateString() : (user.deletedDate ? new Date(user.deletedDate).toLocaleDateString() : '-');

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

    async function updateAuthStatusRemote(email, status, gasAction) {
        if (hasConfiguredServerApi()) {
            try {
                const result = await callServerJson('/api/auth/set_status', {
                    method: 'POST',
                    payload: { email, status }
                });
                return { source: 'server', user: markServerAuthUser(result.user) };
            } catch (err) {
                if (currentUser && currentUser._authProvider === 'server') {
                    throw err;
                }
                console.warn('[ScoreQuery] Server status update failed, using GAS/local fallback if available.', err);
            }
        }

        const gasUrl = localStorage.getItem('scorequery_gas_url');
        if (gasUrl && gasAction) {
            await callGasApi(gasAction, { email }, {
                email: currentUser.email,
                pwHash: currentUser.pw
            });
            return { source: 'gas' };
        }
        return { source: 'local' };
    }

    async function handleApprove(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        const targetUser = users[idx];
        let remoteResult = { source: 'local' };
        try {
            showMailLoading(true);
            remoteResult = await updateAuthStatusRemote(email, 'approved', 'approve');
            showMailLoading(false);
        } catch (err) {
            showMailLoading(false);
            alert('⚠️ 원격 승인 처리에 실패했습니다: ' + (err.message || '네트워크 오류'));
            return;
        }

        if (remoteResult.source === 'local') {
            // 로컬 오프라인 모드에서는 메일 클라이언트/모달 발송 연동
            const to = targetUser.email;
            const subjectText = '[ScoreQuery] 교수 회원가입 승인 완료 안내';
            const bodyText = 
                `${targetUser.name} 교수님 안녕하십니까,\n\n` +
                `성적 조회 및 관리 시스템(ScoreQuery)의 교수 회원가입 신청이 성공적으로 승인 완료되었음을 알려드립니다.\n\n` +
                `이제 아래의 시스템 주소로 접속하신 뒤, 등록하신 교수 이메일(${targetUser.email})과 설정하신 비밀번호로 로그인하여 시스템에 진입하실 수 있습니다.\n\n` +
                `- 시스템 접속 주소: https://chgseo3820.github.io/GradeInquirySystem/\n\n` +
                `감사합니다.\n` +
                `마스터 서창갑 드림\n`;

            sendMail(to, subjectText, bodyText);
        }

        users[idx] = remoteResult.user || { ...users[idx], status: 'approved', approveDate: new Date().toISOString() };
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
        alert(`✅ ${targetUser.name} 교수님의 회원가입이 승인되었습니다.`);
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
        const tempPw = `Sq!${emailId}${randNum}`;

        // 비밀번호 해시화 저장
        const pwHashed = await sha256(tempPw);

        let resetHandled = false;
        let resetSource = 'local';
        try {
            showMailLoading(true);
            if (hasConfiguredServerApi()) {
                try {
                    await callServerJson('/api/auth/reset_password', {
                        method: 'POST',
                        payload: { email, password: tempPw }
                    });
                    resetHandled = true;
                    resetSource = 'server';
                } catch (err) {
                    if (currentUser && currentUser._authProvider === 'server') {
                        throw err;
                    }
                    console.warn('[ScoreQuery] Server password reset failed, using GAS/local fallback if available.', err);
                }
            }
            if (!resetHandled && localStorage.getItem('scorequery_gas_url')) {
                await callGasApi('reset_pw', { email: email, tempPw: pwHashed }, {
                    email: currentUser.email,
                    pwHash: currentUser.pw
                });
                resetHandled = true;
                resetSource = 'gas';
            }
            showMailLoading(false);
        } catch (err) {
            showMailLoading(false);
            alert('⚠️ 원격 비밀번호 초기화에 실패했습니다: ' + (err.message || '네트워크 오류'));
            return;
        }

        if (!resetHandled) {
            // 로컬 오프라인 모드 메일 발송
            const to = targetUser.email;
            const subjectText = '[ScoreQuery] 교수자 계정 비밀번호 초기화 안내';
            const bodyText = 
                `${targetUser.name} 교수님 안녕하십니까,\n\n` +
                `요청하신 ScoreQuery 교수자 계정의 비밀번호가 임시 비밀번호로 초기화되었습니다.\n\n` +
                `- 이메일 ID: ${targetUser.email}\n` +
                `- 임시 비밀번호: ${tempPw}\n\n` +
                `아래의 시스템 주소로 접속하신 후, 임시 비밀번호로 로그인하여 안전한 비밀번호로 변경하여 사용해 주시기 바랍니다.\n\n` +
                `- 시스템 접속 주소: https://chgseo3820.github.io/GradeInquirySystem/\n\n` +
                `감사합니다.\n` +
                `마스터 서창갑 드림\n`;

            sendMail(to, subjectText, bodyText);
        }

        if (resetSource === 'server') {
            delete users[idx].pw;
        } else {
            users[idx].pw = pwHashed;
        }
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
        alert(`✅ ${targetUser.name} 교수님의 비밀번호가 임시 비밀번호로 초기화되었습니다.\n\n임시 비밀번호: ${tempPw}\n\n(이 정보는 가입자에게 별도로 전달해 주세요.)`);
    }

    async function handleReject(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        if (!confirm('정말 본 신청을 반려 처리하시겠습니까?')) return;

        let remoteResult = { source: 'local' };
        try {
            showMailLoading(true);
            remoteResult = await updateAuthStatusRemote(email, 'rejected', 'reject');
            showMailLoading(false);
        } catch (err) {
            showMailLoading(false);
            alert('⚠️ 원격 반려 처리에 실패했습니다: ' + (err.message || '네트워크 오류'));
            return;
        }

        users[idx] = remoteResult.user || { ...users[idx], status: 'rejected' };
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
    }

    async function handleRejectApproved(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        if (!confirm('⚠️ 정말 본 회원의 가입 승인을 취소하고 반려 상태로 전환하시겠습니까?\n이 회원은 로그인 권한을 즉시 상실하게 됩니다.')) return;

        let remoteResult = { source: 'local' };
        try {
            showMailLoading(true);
            remoteResult = await updateAuthStatusRemote(email, 'rejected', 'reject');
            showMailLoading(false);
        } catch (err) {
            showMailLoading(false);
            alert('⚠️ 원격 가입 취소 처리에 실패했습니다: ' + (err.message || '네트워크 오류'));
            return;
        }

        users[idx] = remoteResult.user || { ...users[idx], status: 'rejected' };
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
    }

    async function handleDeleteUserByMaster(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        const targetUser = users[idx];
        if (!confirm(`⚠️ 정말로 ${targetUser.name} 교수님의 계정을 삭제하시겠습니까?\n계정 정보는 삭제 이력 로그(Soft Delete)에 영구 보존됩니다.`)) return;

        let remoteResult = { source: 'local' };
        try {
            showMailLoading(true);
            remoteResult = await updateAuthStatusRemote(email, 'deleted', 'delete');
            showMailLoading(false);
        } catch (err) {
            showMailLoading(false);
            alert('⚠️ 원격 계정 삭제 처리에 실패했습니다: ' + (err.message || '네트워크 오류'));
            return;
        }

        users[idx] = remoteResult.user || { ...users[idx], status: 'deleted', deletedDate: new Date().toISOString() };
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
        alert(`🗑️ ${targetUser.name} 교수님의 계정이 성공적으로 삭제 처리되어 이력 로그에 기록되었습니다.`);
    }

    async function handleRestoreUserByMaster(email) {
        const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
        const idx = users.findIndex(u => u.email === email);
        if (idx < 0) return;

        const targetUser = users[idx];
        if (!confirm(`ℹ️ ${targetUser.name} 교수님의 삭제된 계정을 가입 신청(대기) 상태로 복구하시겠습니까?`)) return;

        let remoteResult = { source: 'local' };
        try {
            showMailLoading(true);
            remoteResult = await updateAuthStatusRemote(email, 'pending', 'restore');
            showMailLoading(false);
        } catch (err) {
            showMailLoading(false);
            alert('⚠️ 원격 계정 복구 처리에 실패했습니다: ' + (err.message || '네트워크 오류'));
            return;
        }

        users[idx] = remoteResult.user || { ...users[idx], status: 'pending' };
        if (users[idx].deletedDate) delete users[idx].deletedDate;
        localStorage.setItem('scorequery_users', JSON.stringify(users));
        renderMasterPendingList();
        alert(`✨ ${targetUser.name} 교수님의 계정이 가입 대기 상태로 복구되었습니다.`);
    }

    async function handleSelfDelete() {
        if (!currentUser) return;
        if (currentUser.isMaster) {
            alert('⚠️ 마스터 계정은 탈퇴할 수 없습니다.');
            return;
        }

        if (!confirm('⚠️ 정말로 회원 탈퇴를 신청하시겠습니까?\n마스터 승인 시 최종 삭제되며 그 전까지 로그인이 제한됩니다.')) {
            return;
        }

        try {
            let withdrawalHandled = false;
            if (currentUser._authProvider === 'server' || hasConfiguredServerApi()) {
                try {
                    await callServerJson('/api/auth/withdraw', { method: 'POST', payload: {} });
                    withdrawalHandled = true;
                } catch (err) {
                    if (currentUser._authProvider === 'server') {
                        throw err;
                    }
                    console.warn('[ScoreQuery] Server withdrawal failed, using GAS/local fallback if available.', err);
                }
            }
            if (!withdrawalHandled && localStorage.getItem('scorequery_gas_url')) {
                await callGasApi('withdraw_request', null, {
                    email: currentUser.email,
                    pwHash: currentUser.pw
                });
                withdrawalHandled = true;
            }
            if (!withdrawalHandled) {
                const users = JSON.parse(localStorage.getItem('scorequery_users') || '[]');
                const idx = users.findIndex(u => u.email === currentUser.email);
                if (idx >= 0) {
                    users[idx].status = 'withdraw_pending';
                    users[idx].withdrawReqDate = new Date().toISOString();
                    localStorage.setItem('scorequery_users', JSON.stringify(users));
                }
            }
            alert('🗑️ 회원 탈퇴 신청이 완료되었습니다. 처음 화면으로 돌아갑니다.');
            handleLogoutAction();
        } catch (err) {
            alert('탈퇴 신청 중 오류가 발생했습니다: ' + err.message);
        }
    }

    async function handleLogoutAction(options = {}) {
        professorSessionTimedOut = options.reason === 'timeout';
        const shouldLogoutServer = currentUser && currentUser._authProvider === 'server';
        if (shouldLogoutServer) {
            try {
                await callServerJson('/api/auth/logout', { method: 'POST', payload: {} });
            } catch (e) {
                console.warn('[ScoreQuery] Server logout failed:', e);
            }
        }
        currentUser = null;
        clearProfessorSession();
        
        const loginForm = document.getElementById('admin-login-form');
        if (loginForm) loginForm.reset();
        
        const regForm = document.getElementById('admin-register-form');
        if (regForm) regForm.reset();

        // 비밀번호 찾기 카드도 함께 닫고 입력 초기화
        const forgotCard = document.getElementById('admin-forgot-pw-card');
        if (forgotCard) forgotCard.style.display = 'none';
        const forgotStep1 = document.getElementById('forgot-pw-step1-form');
        if (forgotStep1) forgotStep1.reset();
        const forgotStep2 = document.getElementById('forgot-pw-step2-form');
        if (forgotStep2) { forgotStep2.reset(); forgotStep2.style.display = 'none'; }

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
        if (options.reason === 'timeout') {
            const errEl = document.getElementById('admin-login-error');
            if (errEl) {
                errEl.textContent = '10분 동안 활동이 없어 자동 로그아웃되었습니다.';
                errEl.style.display = 'block';
            }
        }
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

        // 1. 기존 설정 로드하여 복원 (확인 절차 생략)
        const saved = loadConfig();
        if (saved) {
            populateFromConfig(saved);
        }

        // 2. 로그인한 교수의 정보로 인적사항 강제 바인딩 (보안 및 일관성 확보)
        if (currentUser) {
            document.getElementById('prof-name').value = currentUser.name;
            document.getElementById('prof-email').value = currentUser.email;
            document.getElementById('prof-phone').value = currentUser.phone || '';
            adminConfig.professor = {
                name: currentUser.name,
                email: currentUser.email,
                phone: currentUser.phone || ''
            };
        }

        // 3. 년도-학기 필터 드롭다운 구성 및 과목 목록 렌더링
        buildSemesterFilterOptions();
        renderWizardCourseList();

        goToStep(1);
    }

    function buildSemesterFilterOptions() {
        const filterSelect = document.getElementById('filter-semester');
        if (!filterSelect) return;
        
        // 기존 옵션 초기화 (첫 번째 "전체 학기" 제외)
        filterSelect.innerHTML = '<option value="">전체 학기</option>';
        
        const courses = adminConfig.courses || [];
        if (courses.length === 0) return;
        
        // 고유한 년도-학기 키 추출 (정렬: 최근 학기 우선)
        const semesters = [...new Set(courses.map(c => `${c.year}-${c.semester}`))];
        semesters.sort((a, b) => b.localeCompare(a));
        
        semesters.forEach(sem => {
            const opt = document.createElement('option');
            opt.value = sem;
            opt.textContent = sem;
            filterSelect.appendChild(opt);
        });
    }

    function renderWizardCourseList(filterValue = '') {
        const listUl = document.getElementById('course-list-ul');
        if (!listUl) return;
        listUl.innerHTML = '';

        const courses = adminConfig.courses || [];
        
        // 필터링 적용
        let filtered = courses.map((c, originalIndex) => ({ ...c, originalIndex }));
        if (filterValue) {
            filtered = filtered.filter(c => `${c.year}-${c.semester}` === filterValue);
        }
        filtered = filtered.filter(c => hasCourseAuthority(c));

        if (filtered.length === 0) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'course-list-empty';
            emptyDiv.textContent = filterValue ? '선택한 학기에 등록된 과목이 없습니다.' : '등록된 과목이 없습니다. 아래 버튼을 눌러 새 과목 설정을 시작하세요.';
            listUl.appendChild(emptyDiv);
            return;
        }

        filtered.forEach(c => {
            const item = document.createElement('div');
            item.className = 'course-item-btn';
            item.dataset.courseId = getCourseId(c);
            
            // 정보 컨테이너
            const infoDiv = document.createElement('div');
            infoDiv.className = 'course-item-info';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'course-item-name';
            nameSpan.textContent = c.name;
            
            const metaSpan = document.createElement('span');
            metaSpan.className = 'course-item-meta';
            const evalCount = c.evaluation ? c.evaluation.length : 0;
            metaSpan.textContent = `${c.year} ${c.semester} · 평가항목 ${evalCount}개`;

            const badgeSpan = document.createElement('span');
            const pubInfo = (() => {
                try {
                    for (const key of getCoursePublishKeys(c)) {
                        const raw = localStorage.getItem(key);
                        if (raw) return JSON.parse(raw);
                    }
                } catch { /* ignore */ }
                return null;
            })();
            const isPublished = pubInfo && pubInfo.published;
            badgeSpan.className = `course-status-badge ${isPublished ? 'published' : 'draft'}`;
            badgeSpan.textContent = isPublished ? '공시 설정됨' : '미공시';
            
            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(metaSpan);
            infoDiv.appendChild(badgeSpan);
            item.appendChild(infoDiv);

            // 액션 버튼 그룹
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'course-item-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-course-action btn-course-edit';
            editBtn.textContent = '편집';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                selectWizardCourse(c.originalIndex);
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-course-action btn-course-delete';
            delBtn.textContent = '삭제';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteWizardCourse(c.originalIndex);
            };

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(delBtn);
            item.appendChild(actionsDiv);

            // 행 자체를 클릭해도 수정으로 이동하도록 지원
            item.onclick = () => {
                if (hasCourseAuthority(c)) {
                    selectWizardCourse(c.originalIndex);
                } else {
                    alert('⚠️ 본인이 등록한 과목만 편집할 수 있습니다.');
                }
            };

            listUl.appendChild(item);
        });
    }

    function selectWizardCourse(index) {
        const c = adminConfig.courses[index];
        if (!c) return;

        if (!hasCourseAuthority(c)) {
            alert('⚠️ 본인이 등록한 과목만 편집할 수 있습니다.');
            return;
        }

        adminConfig.course = {
            year: c.year,
            semester: c.semester,
            name: c.name
        };
        adminConfig.evaluation = c.evaluation ? [...c.evaluation] : [];

        // Step 2 입력 폼 채우기
        const yearSelect = document.getElementById('course-year');
        if (yearSelect) {
            for (let i = 0; i < yearSelect.options.length; i++) {
                if (yearSelect.options[i].value == c.year) {
                    yearSelect.selectedIndex = i;
                    break;
                }
            }
        }

        const semSelect = document.getElementById('course-semester');
        if (semSelect) {
            let found = false;
            for (let i = 0; i < semSelect.options.length; i++) {
                if (semSelect.options[i].value === c.semester) {
                    semSelect.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            const customInput = document.getElementById('course-semester-custom');
            if (!found && c.semester) {
                semSelect.value = '__custom__';
                if (customInput) {
                    customInput.value = c.semester;
                    customInput.classList.add('visible');
                }
            } else {
                if (customInput) {
                    customInput.value = '';
                    customInput.classList.remove('visible');
                }
            }
        }

        const nameInput = document.getElementById('course-name');
        if (nameInput) {
            nameInput.value = c.name || '';
        }

        // Step 3 평가 기준 바인딩
        initEvalCriteria();
        updateEvalTotal();

        goToStep(2);
    }

    function deleteWizardCourse(index) {
        const c = adminConfig.courses[index];
        if (!c) return;

        if (!hasCourseAuthority(c)) {
            alert('⚠️ 본인이 등록한 과목만 삭제할 수 있습니다.');
            return;
        }

        if (!confirm(`⚠️ 정말로 이 과목을 삭제하시겠습니까?\n\n「${c.year} ${c.semester} — ${c.name}」\n\n삭제 시 관련된 성적 데이터 및 공시 일정 설정도 복구할 수 없이 함께 제거됩니다.`)) {
            return;
        }

        // 1. 로컬 저장소 키값들 청소
        getCourseDataKeys(c).forEach(key => localStorage.removeItem(key));
        getCoursePublishKeys(c).forEach(key => localStorage.removeItem(key));

        // 2. adminConfig.courses 에서 해당 과목 제거
        adminConfig.courses.splice(index, 1);
        saveConfig(adminConfig);

        // 3. scorequery_courses 과목 목록 배열에서도 제거 및 저장
        const courseListRaw = localStorage.getItem('scorequery_courses') || '[]';
        const courseList = JSON.parse(courseListRaw);
        const listIdx = courseList.findIndex(item =>
            item.year === c.year &&
            item.semester === c.semester &&
            item.name === c.name
        );
        if (listIdx >= 0) {
            courseList.splice(listIdx, 1);
            localStorage.setItem('scorequery_courses', JSON.stringify(courseList));
        }

        // 4. 드롭다운 필터 및 과목 리스트 UI 다시 그리기
        buildSemesterFilterOptions();
        const filterSelect = document.getElementById('filter-semester');
        const currentFilter = filterSelect ? filterSelect.value : '';
        renderWizardCourseList(currentFilter);

        alert('✅ 과목 설정과 데이터가 완전히 삭제되었습니다.');
    }

    function startNewWizardCourse() {
        // 전역 설정 비우기
        adminConfig.course = { year: '2026', semester: '1학기', name: '' };
        adminConfig.evaluation = [];

        // Step 2 입력 폼 초기화
        const yearSelect = document.getElementById('course-year');
        if (yearSelect) yearSelect.value = '2026';
        
        const semSelect = document.getElementById('course-semester');
        if (semSelect) semSelect.value = '1학기';
        
        const customInput = document.getElementById('course-semester-custom');
        if (customInput) {
            customInput.value = '';
            customInput.classList.remove('visible');
        }

        const nameInput = document.getElementById('course-name');
        if (nameInput) nameInput.value = '';

        initEvalCriteria();
        updateEvalTotal();

        goToStep(2);
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

    async function refreshServerViewStats(course, widget, textEl, fillEl) {
        const courseId = getCourseId(course);
        const stats = await getLocalAdminJson(`/api/view_stats?course_id=${encodeURIComponent(courseId)}`);
        if (!stats || !stats.success) return;

        sessionStorage.setItem(`scorequery_server_view_stats_${courseId}`, JSON.stringify(stats));
        const totalCount = stats.total || 0;
        const viewedCount = stats.viewed || 0;
        const percent = totalCount ? Number(stats.percent || ((viewedCount / totalCount) * 100)).toFixed(1) : '0.0';

        widget.style.display = 'block';
        textEl.innerHTML = `📚 <strong>${course.year} ${course.semester} — ${course.name}</strong><br>서버 조회 로그 기준: 총 <strong>${totalCount}</strong>명 중 <strong>${viewedCount}</strong>명(열람률 <strong>${percent}%</strong>)이 확인되었습니다.`;
        fillEl.style.width = `${percent}%`;

        const btnDetail = document.getElementById('btn-view-stats-detail');
        if (btnDetail) {
            btnDetail.style.display = 'inline-flex';
        }
        const btnDownload = document.getElementById('btn-view-stats-download');
        if (btnDownload) {
            btnDownload.style.display = 'inline-flex';
        }
    }

    function renderViewStats() {
        const widget = document.getElementById('course-view-stats-widget');
        const textEl = document.getElementById('course-view-stats-text');
        const fillEl = document.getElementById('course-view-stats-fill');
        if (!widget || !textEl || !fillEl) return;
        const btnDetail = document.getElementById('btn-view-stats-detail');
        const btnDownload = document.getElementById('btn-view-stats-download');
        if (btnDetail) btnDetail.style.display = 'none';
        if (btnDownload) btnDownload.style.display = 'none';

        const { course } = adminConfig;
        if (!course || !course.name) {
            widget.style.display = 'none';
            return;
        }
        refreshServerViewStats(course, widget, textEl, fillEl);

        let rawData = null;
        for (const key of getCourseDataKeys(course)) {
            rawData = localStorage.getItem(key);
            if (rawData) break;
        }
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

            const viewLogs = JSON.parse(localStorage.getItem('scorequery_view_logs') || '[]');
            const subjectId = getCourseId(course);
            const subjectLogs = viewLogs.filter(log => log.subjectId === subjectId);
            const viewedKeys = new Set(subjectLogs.map(log => log.viewKey || log.studentKey).filter(Boolean));
            const legacyViewedHashes = new Set(subjectLogs.map(log => log.sidHash).filter(Boolean));
            const studentKeys = Object.keys(parsed.students || {});

            let viewedCount = 0;
            studentKeys.forEach(key => {
                if (viewedKeys.has(key)) {
                    viewedCount++;
                }
            });

            // 하위 호환: 이전 버전의 student_id_hash/sidHash 로그가 남아 있는 경우만 보조 집계
            if (viewedCount === 0 && legacyViewedHashes.size > 0) {
                studentEntries.forEach(s => {
                    if (s.student_id_hash && legacyViewedHashes.has(s.student_id_hash)) {
                        viewedCount++;
                    }
                });
            }

            const percent = ((viewedCount / totalCount) * 100).toFixed(1);
            widget.style.display = 'block';
            textEl.innerHTML = `📚 <strong>${course.year} ${course.semester} — ${course.name}</strong><br>이 브라우저에 저장된 열람 기록 기준: 총 <strong>${totalCount}</strong>명 중 <strong>${viewedCount}</strong>명(참고율 <strong>${percent}%</strong>)이 확인되었습니다.<br><span style="font-size:11px;color:var(--text-muted);">서버 API와 관리자 토큰이 연결되면 전체 열람률은 서버 조회 로그 기준으로 표시됩니다.</span>`;
            fillEl.style.width = `${percent}%`;

            // 자세히 보기 버튼 표시 처리
            if (btnDetail) {
                btnDetail.style.display = 'inline-flex';
            }
            if (btnDownload) {
                btnDownload.style.display = 'inline-flex';
            }

        } catch (e) {
            console.error('Error rendering view stats:', e);
            widget.style.display = 'none';
        }
    }

    let currentStatsFilter = 'all';

    function openStatsDetailModal() {
        const modal = document.getElementById('stats-detail-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        modal.offsetHeight; // Force reflow
        modal.classList.add('active');
        
        switchStatsFilter('all');
    }

    function closeStatsDetailModal(immediate = false) {
        const modal = document.getElementById('stats-detail-modal');
        if (!modal) return;
        modal.classList.remove('active');
        if (immediate) {
            modal.style.display = 'none';
            return;
        }
        setTimeout(() => {
            if (!modal.classList.contains('active')) {
                modal.style.display = 'none';
            }
        }, 300);
    }

    function handleStatsModalActionClick(event) {
        const target = event.target;
        if (!target || !target.closest) return;
        if (isProfessorSessionExpired()) {
            if (event.cancelable) event.preventDefault();
            event.stopImmediatePropagation();
            handleLogoutAction({ reason: 'timeout' });
            return;
        }

        const closeBtn = target.closest('#btn-stats-modal-close, #btn-stats-modal-close-x');
        if (closeBtn) {
            event.preventDefault();
            event.stopPropagation();
            closeStatsDetailModal(true);
            return;
        }

        const excelBtn = target.closest('#btn-stats-excel-download, #btn-view-stats-download');
        if (excelBtn) {
            event.preventDefault();
            event.stopPropagation();
            downloadStatsExcel();
            return;
        }

        const finalGradesBtn = target.closest('#btn-download-final-grades');
        if (finalGradesBtn) {
            event.preventDefault();
            event.stopPropagation();
            downloadFinalGradesExcel();
            return;
        }

        const modal = document.getElementById('stats-detail-modal');
        if (modal && target === modal) {
            event.preventDefault();
            closeStatsDetailModal(true);
        }
    }

    function handleStatsModalKeydown(event) {
        if (event.key !== 'Escape') return;
        const modal = document.getElementById('stats-detail-modal');
        if (modal && modal.style.display !== 'none') {
            closeStatsDetailModal(true);
        }
    }

    function switchStatsFilter(filterType) {
        currentStatsFilter = filterType;
        
        const tabs = ['all', 'viewed', 'unviewed'];
        tabs.forEach(tab => {
            const btn = document.getElementById(`tab-filter-${tab}`);
            if (btn) {
                if (tab === filterType) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        });
        
        renderViewStatsDetail(filterType);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderServerStatsDetail(stats, filterType, summaryEl, tbody) {
        const course = stats.course || adminConfig.course || {};
        const totalCount = stats.total || 0;
        const viewedCount = stats.viewed || 0;
        const percent = totalCount ? Number(stats.percent || ((viewedCount / totalCount) * 100)).toFixed(1) : '0.0';
        const studentsList = (stats.students || []).map(s => ({
            name: getProfessorStudentName(s) || '이름',
            sid: getProfessorStudentId(s) || '학번',
            department: s.department || '-',
            classNum: s.class_num || '-',
            isViewed: !!s.is_viewed,
            viewDate: s.view_date || null
        })).sort((a, b) => a.sid.localeCompare(b.sid));

        summaryEl.innerHTML = `📚 <strong>${course.year || ''} ${course.semester || ''} — ${course.name || ''}</strong><br>서버 조회 로그 기준: 총 <strong>${totalCount}</strong>명 중 <strong>${viewedCount}</strong>명(열람률 <strong>${percent}%</strong>)이 확인되었습니다.`;

        const tabAll = document.getElementById('tab-filter-all');
        const tabViewed = document.getElementById('tab-filter-viewed');
        const tabUnviewed = document.getElementById('tab-filter-unviewed');
        if (tabAll) tabAll.textContent = `전체 (${totalCount})`;
        if (tabViewed) tabViewed.textContent = `열람함 (${viewedCount})`;
        if (tabUnviewed) tabUnviewed.textContent = `미열람 (${Math.max(totalCount - viewedCount, 0)})`;

        let filteredList = studentsList;
        if (filterType === 'viewed') {
            filteredList = studentsList.filter(s => s.isViewed);
        } else if (filterType === 'unviewed') {
            filteredList = studentsList.filter(s => !s.isViewed);
        }

        if (filteredList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding: 20px;">조건에 해당하는 학생이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = filteredList.map((s, idx) => {
            const statusBadge = s.isViewed
                ? '<span class="badge-viewed">열람</span>'
                : '<span class="badge-unviewed">미열람</span>';
            let dateStr = '-';
            if (s.isViewed && s.viewDate) {
                try {
                    const d = new Date(s.viewDate);
                    const pad = (n) => String(n).padStart(2, '0');
                    dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                } catch (err) {
                    dateStr = '-';
                }
            }
            return `
                <tr>
                    <td style="text-align: center; color: var(--text-secondary);">${idx + 1}</td>
                    <td>${escapeHtml(s.name)}</td>
                    <td>${escapeHtml(s.sid)}</td>
                    <td style="text-align: center;">${statusBadge}</td>
                    <td class="view-date-col" style="text-align: center; color: var(--text-secondary);">${dateStr}</td>
                </tr>
            `;
        }).join('');
    }

    function renderViewStatsDetail(filterType) {
        const summaryEl = document.getElementById('stats-detail-summary');
        const tbody = document.getElementById('stats-detail-tbody');
        if (!summaryEl || !tbody) return;

        const { course } = adminConfig;
        if (!course || !course.name) return;
        try {
            const cached = sessionStorage.getItem(`scorequery_server_view_stats_${getCourseId(course)}`);
            if (cached) {
                const stats = JSON.parse(cached);
                if (stats && stats.success && Array.isArray(stats.students)) {
                    renderServerStatsDetail(stats, filterType, summaryEl, tbody);
                    return;
                }
            }
        } catch (e) { /* fall back to browser-local stats */ }

        let rawData = null;
        for (const key of getCourseDataKeys(course)) {
            rawData = localStorage.getItem(key);
            if (rawData) break;
        }
        if (!rawData) {
            summaryEl.innerHTML = '성적 데이터가 존재하지 않습니다.';
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding: 20px;">성적 데이터가 업로드되지 않았습니다.</td></tr>';
            return;
        }

        try {
            const parsed = JSON.parse(rawData);
            const studentEntries = Object.values(parsed.students || {});
            const totalCount = studentEntries.length;
            if (totalCount === 0) {
                summaryEl.innerHTML = '등록된 수강생이 없습니다.';
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding: 20px;">등록된 수강생이 없습니다.</td></tr>';
                return;
            }

            const viewLogs = JSON.parse(localStorage.getItem('scorequery_view_logs') || '[]');
            const subjectId = getCourseId(course);
            const subjectLogs = viewLogs.filter(log => log.subjectId === subjectId);
            const viewedKeys = new Set(subjectLogs.map(log => log.viewKey || log.studentKey).filter(Boolean));
            const legacyViewedHashes = new Set(subjectLogs.map(log => log.sidHash).filter(Boolean));

            const viewDateMap = {};
            subjectLogs.forEach(log => {
                const key = log.viewKey || log.studentKey;
                if (key) {
                    const existing = viewDateMap[key];
                    if (!existing || new Date(log.viewDate || log.timestamp) > new Date(existing)) {
                        viewDateMap[key] = log.viewDate || log.timestamp;
                    }
                }
            });

            const studentsList = [];
            Object.entries(parsed.students || {}).forEach(([key, s]) => {
                const isViewed = viewedKeys.has(key) || (s.student_id_hash && legacyViewedHashes.has(s.student_id_hash));
                
                let viewDate = viewDateMap[key] || null;
                if (!viewDate && s.student_id_hash) {
                    const legLog = subjectLogs.find(l => l.sidHash === s.student_id_hash);
                    if (legLog) {
                        viewDate = legLog.viewDate || legLog.timestamp || null;
                    }
                }

                studentsList.push({
                    key: key,
                    name: getProfessorStudentName(s) || '이름',
                    sid: getProfessorStudentId(s) || '학번',
                    department: s.department || '-',
                    classNum: s.class_num || '-',
                    isViewed: isViewed,
                    viewDate: viewDate
                });
            });

            studentsList.sort((a, b) => a.sid.localeCompare(b.sid));

            const viewedCount = studentsList.filter(s => s.isViewed).length;
            const unviewedCount = totalCount - viewedCount;
            const percent = ((viewedCount / totalCount) * 100).toFixed(1);

            summaryEl.innerHTML = `📚 <strong>${course.year} ${course.semester} — ${course.name}</strong><br>이 브라우저에 저장된 열람 기록 기준: 총 <strong>${totalCount}</strong>명 중 <strong>${viewedCount}</strong>명(참고율 <strong>${percent}%</strong>)이 확인되었습니다.<br><span style="font-size:11px;color:var(--text-muted);">서버 API와 관리자 토큰이 연결되면 전체 열람률은 서버 조회 로그 기준으로 표시됩니다.</span>`;
            
            const tabAll = document.getElementById('tab-filter-all');
            const tabViewed = document.getElementById('tab-filter-viewed');
            const tabUnviewed = document.getElementById('tab-filter-unviewed');
            if (tabAll) tabAll.textContent = `전체 (${totalCount})`;
            if (tabViewed) tabViewed.textContent = `열람함 (${viewedCount})`;
            if (tabUnviewed) tabUnviewed.textContent = `미열람 (${unviewedCount})`;

            let filteredList = studentsList;
            if (filterType === 'viewed') {
                filteredList = studentsList.filter(s => s.isViewed);
            } else if (filterType === 'unviewed') {
                filteredList = studentsList.filter(s => !s.isViewed);
            }

            if (filteredList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding: 20px;">조건에 해당하는 학생이 없습니다.</td></tr>`;
                return;
            }

            let html = '';
            filteredList.forEach((s, idx) => {
                const statusBadge = s.isViewed 
                    ? '<span class="badge-viewed">열람</span>' 
                    : '<span class="badge-unviewed">미열람</span>';
                
                let dateStr = '-';
                if (s.isViewed && s.viewDate) {
                    try {
                        const d = new Date(s.viewDate);
                        const pad = (n) => String(n).padStart(2, '0');
                        dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                    } catch (err) {
                        dateStr = '-';
                    }
                }

                html += `
                    <tr>
                        <td style="text-align: center; color: var(--text-secondary);">${idx + 1}</td>
                        <td>${escapeHtml(s.name)}</td>
                        <td>${escapeHtml(s.sid)}</td>
                        <td style="text-align: center;">${statusBadge}</td>
                        <td class="view-date-col" style="text-align: center; color: var(--text-secondary);">${dateStr}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;

        } catch (err) {
            console.error('Error rendering view stats detail:', err);
            summaryEl.innerHTML = '에러 발생: 상세 현황을 렌더링하지 못했습니다.';
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding: 20px;">에러가 발생했습니다.</td></tr>';
        }
    }

    function writeViewStatsWorkbook(course, studentsList, sourceLabel) {
        if (typeof XLSX === 'undefined') {
            alert('Excel 라이브러리가 아직 로드되지 않았습니다. 네트워크 연결을 확인한 뒤 새로고침해 주세요.');
            return;
        }

        const sortedList = [...studentsList].sort((a, b) => String(a.sid || '').localeCompare(String(b.sid || ''), 'ko', { numeric: true }));
        let filteredList = sortedList;
        let filterLabel = '전체';
        if (currentStatsFilter === 'viewed') {
            filteredList = sortedList.filter(s => s.isViewed);
            filterLabel = '열람함';
        } else if (currentStatsFilter === 'unviewed') {
            filteredList = sortedList.filter(s => !s.isViewed);
            filterLabel = '미열람';
        }

        if (filteredList.length === 0) {
            alert(`${filterLabel} 상태에 해당하는 수강생이 없습니다.`);
            return;
        }

        const headers = ['번호', '학과', '분반', '이름', '학번', '열람여부', '열람일시', '집계기준'];
        const aoa = [headers];
        filteredList.forEach((s, idx) => {
            aoa.push([
                idx + 1,
                s.department || '-',
                s.classNum || '-',
                s.name,
                s.sid,
                s.isViewed ? '열람함' : '미열람',
                s.isViewed ? formatExcelDateTime(s.viewDate) : '-',
                sourceLabel
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [
            { wch: 8 }, { wch: 16 }, { wch: 8 }, { wch: 16 },
            { wch: 16 }, { wch: 10 }, { wch: 20 }, { wch: 14 }
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '열람현황');

        const filename = [
            safeFileNamePart(course.year, '년도'),
            safeFileNamePart(course.semester, '학기'),
            safeFileNamePart(course.name, '과목명'),
            '열람현황',
            filterLabel,
            sourceLabel
        ].join('_') + '.xlsx';
        try {
            XLSX.writeFile(wb, filename);
        } catch (err) {
            console.error('Error writing view stats Excel file:', err);
            alert('Excel 파일 다운로드 중 오류가 발생했습니다. 브라우저 다운로드 권한과 팝업/다운로드 차단 설정을 확인해 주세요.');
        }
    }

    function downloadStatsExcel() {
        const { course } = adminConfig;
        if (!course || !course.name) {
            alert('과목 정보가 없어 열람 현황 Excel을 다운로드할 수 없습니다.');
            return;
        }

        try {
            const cached = sessionStorage.getItem(`scorequery_server_view_stats_${getCourseId(course)}`);
            if (cached) {
                const stats = JSON.parse(cached);
                if (stats && stats.success && Array.isArray(stats.students)) {
                    const serverRows = stats.students.map(s => ({
                        name: getProfessorStudentName(s) || '이름',
                        sid: getProfessorStudentId(s) || '학번',
                        department: s.department || '-',
                        classNum: s.class_num || '-',
                        isViewed: !!s.is_viewed,
                        viewDate: s.view_date || null
                    }));
                    writeViewStatsWorkbook(stats.course || course, serverRows, '서버조회로그');
                    return;
                }
            }
        } catch (e) {
            console.warn('[ScoreQuery] Failed to use cached server view stats for download:', e);
        }

        let rawData = null;
        for (const key of getCourseDataKeys(course)) {
            rawData = localStorage.getItem(key);
            if (rawData) break;
        }
        if (!rawData) {
            alert('성적 데이터가 존재하지 않아 다운로드할 수 없습니다.');
            return;
        }

        try {
            const parsed = JSON.parse(rawData);
            const studentEntries = Object.values(parsed.students || {});
            if (studentEntries.length === 0) {
                alert('등록된 수강생이 없어 다운로드할 수 없습니다.');
                return;
            }

            const viewLogs = JSON.parse(localStorage.getItem('scorequery_view_logs') || '[]');
            const subjectId = getCourseId(course);
            const subjectLogs = viewLogs.filter(log => log.subjectId === subjectId);
            const viewedKeys = new Set(subjectLogs.map(log => log.viewKey || log.studentKey).filter(Boolean));
            const legacyViewedHashes = new Set(subjectLogs.map(log => log.sidHash).filter(Boolean));

            const viewDateMap = {};
            subjectLogs.forEach(log => {
                const key = log.viewKey || log.studentKey;
                if (key) {
                    const existing = viewDateMap[key];
                    if (!existing || new Date(log.viewDate || log.timestamp) > new Date(existing)) {
                        viewDateMap[key] = log.viewDate || log.timestamp;
                    }
                }
            });

            const studentsList = [];
            Object.entries(parsed.students || {}).forEach(([key, s]) => {
                const isViewed = viewedKeys.has(key) || (s.student_id_hash && legacyViewedHashes.has(s.student_id_hash));
                
                let viewDate = viewDateMap[key] || null;
                if (!viewDate && s.student_id_hash) {
                    const legLog = subjectLogs.find(l => l.sidHash === s.student_id_hash);
                    if (legLog) {
                        viewDate = legLog.viewDate || legLog.timestamp || null;
                    }
                }

                studentsList.push({
                    key: key,
                    name: getProfessorStudentName(s) || '이름',
                    sid: getProfessorStudentId(s) || '학번',
                    department: s.department || '-',
                    classNum: s.class_num || '-',
                    isViewed: isViewed,
                    viewDate: viewDate
                });
            });

            writeViewStatsWorkbook(course, studentsList, '브라우저로컬기록');

        } catch (err) {
            console.error('Error generating Excel stats file:', err);
            alert('Excel 파일 생성 중 오류가 발생했습니다.');
        }
    }

    function handlePasswordStrength(e) {
        const val = e.target.value;
        let score = 0;
        if (val.length >= 10) score++;
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

    function showCustomAlert(title, message, type = 'info') {
        const modalId = 'scorequery-custom-alert-modal';
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        let icon = '📢';
        let iconColor = '#38bdf8';
        if (type === 'success') {
            icon = '✨';
            iconColor = '#34d399';
        } else if (type === 'warning') {
            icon = '⚠️';
            iconColor = '#fbbf24';
        } else if (type === 'error') {
            icon = '❌';
            iconColor = '#f87171';
        }

        const modalHtml = `
            <div id="${modalId}" style="position: fixed; inset: 0; z-index: 100000; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 20px;">
                <div class="auth-card" style="width: 100%; max-width: 480px; padding: 28px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); text-align: left; background: var(--bg-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-xl); animation: modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;">
                    <div style="display: flex; gap: 14px; align-items: flex-start; margin-bottom: 20px;">
                        <span style="font-size: 24px; padding: 8px; border-radius: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-glass); flex-shrink: 0; display: inline-flex; justify-content: center; align-items: center; color: ${iconColor};">
                            ${icon}
                        </span>
                        <div style="flex: 1;">
                            <h4 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main); line-height: 1.4;">${title}</h4>
                            <div style="margin-top: 10px; font-size: 13.5px; color: #cbd5e1; line-height: 1.6; white-space: pre-wrap;">${message}</div>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
                        <button id="custom-alert-close-btn" class="btn-next" style="margin: 0; padding: 10px 24px; font-size: 13px; font-weight: 600;">확인</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        if (!document.getElementById('modal-animation-style')) {
            const style = document.createElement('style');
            style.id = 'modal-animation-style';
            style.textContent = `
                @keyframes modalFadeIn {
                    from { opacity: 0; transform: scale(0.96) translateY(8px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
            `;
            document.head.appendChild(style);
        }

        const modal = document.getElementById(modalId);
        const closeBtn = document.getElementById('custom-alert-close-btn');
        const closeModal = () => modal.remove();

        closeBtn.onclick = closeModal;
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleKeyDown);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
    }

    // Expose mode functions for app.js
    window.ScoreQueryAdmin = {
        showModeSelection,
        enterStudentMode,
    };
    
    // (이하 소스코드의 종료 브래킷)
})();
