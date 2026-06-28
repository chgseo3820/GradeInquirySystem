/**
 * ScoreQuery — GitHub Pages 정적 프론트엔드
 * SHA-256 해시 기반 클라이언트 사이드 성적 조회 (학생 모드)
 */

(() => {
    'use strict';

    // ── DOM References ──
    const loginSection = document.getElementById('login-section');
    const resultSection = document.getElementById('result-section');
    const loginForm = document.getElementById('login-form');
    const studentIdInput = document.getElementById('student-id');
    const phoneLast4Input = document.getElementById('phone-last4');
    const submitBtn = document.getElementById('submit-btn');
    const errorMsg = document.getElementById('error-message');
    const logoutBtn = document.getElementById('logout-btn');
    const courseSelect = document.getElementById('stu-course-select');
    const authGroup = document.getElementById('student-auth-group');

    let lockInterval = null;
    let scheduleInterval = null;

    // ── Score Card Config ──
    // ── Dynamic Score Fields Resolver ──
    function getScoreFields(gradeData, student) {
        if (gradeData && gradeData.evaluation && gradeData.evaluation.length > 0) {
            const fields = gradeData.evaluation.map(e => ({
                key: `${e.id}_score`,
                label: e.label,
                icon: e.icon || '📊',
                max: e.ratio || 100,
                cssClass: `card-${e.id}`
            }));
            if (student && student.extra_score !== undefined && student.extra_score !== null && student.extra_score !== 0) {
                fields.push({ key: 'extra_score', label: '가산점', icon: '➕', max: '추가', cssClass: 'card-extra' });
            }
            if (student && student.special_score !== undefined && student.special_score !== null && student.special_score !== 0) {
                fields.push({ key: 'special_score', label: '특별점수', icon: '⭐', max: '추가', cssClass: 'card-special' });
            }
            fields.push({ key: 'total_score', label: '성적', icon: '🏆', max: 100, cssClass: 'card-total' });
            return fields;
        }

        // Fallback for legacy format
        const fields = [
            { key: 'quiz_score', label: '퀴즈', icon: '🎯', max: 30, cssClass: 'card-quiz' },
            { key: 'attendance_score', label: '출석', icon: '📋', max: 30, cssClass: 'card-attendance' },
            { key: 'midterm_score', label: '중간고사', icon: '📝', max: 20, cssClass: 'card-midterm' },
            { key: 'final_score', label: '기말고사', icon: '📖', max: 20, cssClass: 'card-final' },
        ];
        if (student && student.extra_score !== undefined && student.extra_score !== null && student.extra_score !== 0) {
            fields.push({ key: 'extra_score', label: '가산점', icon: '➕', max: '추가', cssClass: 'card-extra' });
        }
        if (student && student.special_score !== undefined && student.special_score !== null && student.special_score !== 0) {
            fields.push({ key: 'special_score', label: '특별점수', icon: '⭐', max: '추가', cssClass: 'card-special' });
        }
        fields.push({ key: 'total_score', label: '성적', icon: '🏆', max: 100, cssClass: 'card-total' });
        return fields;
    }

    // ── State ──
    let radarChart = null;
    let gradeData = null;
    let selectedCourse = null; // { year, semester, name }
    let cachedAvailableCourses = [];
    let publicConfig = null;

    async function loadPublicConfig() {
        if (publicConfig !== null) return publicConfig;
        publicConfig = {};
        try {
            const res = await fetch('public-config.json?_t=' + Date.now(), { cache: 'no-store' });
            if (res.ok) {
                publicConfig = await res.json();
            }
        } catch { /* public config is optional */ }
        return publicConfig || {};
    }

    function getApiOrigin() {
        const apiUrl = publicConfig && publicConfig.api_url ? String(publicConfig.api_url).trim().replace(/\/+$/, '') : '';
        if (apiUrl) return apiUrl;
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return window.location.origin;
        }
        return '';
    }

    async function fetchJsonFromApi(path, options = {}) {
        await loadPublicConfig();
        const origin = getApiOrigin();
        if (!origin) return null;
        const res = await fetch(origin + path, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error || `서버 요청 실패 (${res.status})`);
        }
        return payload;
    }

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

    function getCourseDataKeys(course) {
        const legacyKey = `scorequery_data_${course.year}_${course.semester}_${course.name}`;
        const idKey = `scorequery_data_${getCourseId(course)}`;
        return Array.from(new Set([idKey, legacyKey]));
    }

    function getCoursePublishKeys(course) {
        const legacyKey = `scorequery_publish_${course.year}_${course.semester}_${course.name}`;
        const idKey = `scorequery_publish_${getCourseId(course)}`;
        return Array.from(new Set([idKey, legacyKey]));
    }

    // ── Event Listeners ──
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);

    // 교수자 정보 모달 닫기
    document.addEventListener('click', (e) => {
        if (e.target.id === 'btn-prof-info-close' || e.target.id === 'btn-prof-info-close-x' || e.target.id === 'prof-info-modal') {
            const modal = document.getElementById('prof-info-modal');
            if (modal) modal.style.display = 'none';
        }
    });

    phoneLast4Input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
    });

    studentIdInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });

    // 학생 모드 진입 버튼 클릭 시 락 및 일정 체크
    const studentModeBtn = document.getElementById('mode-student-btn');
    if (studentModeBtn) {
        studentModeBtn.addEventListener('click', () => {
            checkStudentLock();
            checkScheduleAndControl();
        });
    }

    // 처음으로 버튼 클릭 시 학생 모드 상태 및 일정 초기화
    const loginBackBtn = document.getElementById('login-back-btn');
    if (loginBackBtn) {
        loginBackBtn.addEventListener('click', () => {
            // 학생 모드 입력 폼 리셋 및 에러 메시지 초기화
            if (loginForm) loginForm.reset();
            hideError();
            selectedCourse = null;
            gradeData = null;
            if (courseSelect) {
                courseSelect.value = '';
                courseSelect.classList.add('select-unselected');
            }
            if (authGroup) {
                authGroup.style.display = 'none';
            }
            const btnProfInfo = document.getElementById('btn-prof-info');
            if (btnProfInfo) btnProfInfo.style.display = 'none';
            const courseInfo = document.getElementById('login-course-info');
            if (courseInfo) {
                courseInfo.textContent = '과목을 선택하면 성적을 조회할 수 있습니다';
            }

            // 스케줄 카운트다운 타이머 정지 및 초기화
            if (scheduleInterval) {
                clearInterval(scheduleInterval);
                scheduleInterval = null;
            }

            const blockEl = document.getElementById('student-schedule-block');
            if (blockEl) {
                blockEl.style.display = 'none';
                blockEl.innerHTML = '';
            }
            if (loginForm) {
                loginForm.style.display = '';
            }
        });
    }

    // 즉시 및 로드 시 체크
    checkStudentLock();
    checkScheduleAndControl();
    loadAvailableCoursesAsync();
    document.addEventListener('DOMContentLoaded', () => {
        checkStudentLock();
        checkScheduleAndControl();
        loadAvailableCoursesAsync();


    });

    // 과목 선택 시 공시 상태 확인 후 인증 필드 표시
    courseSelect.addEventListener('change', () => {
        const val = courseSelect.value;
        courseSelect.classList.toggle('select-unselected', !val);
        hideError();

        if (val) {
            const courses = getAvailableCourses();
            selectedCourse = courses[parseInt(val)];
            gradeData = null; // 캐시 초기화

            // 과목명 표시
            document.getElementById('login-course-info').textContent =
                `${selectedCourse.year} ${selectedCourse.semester} — ${selectedCourse.name}`;

            // 담당교수 탑바 정보 동적 갱신
            const topBarProf = document.getElementById('top-bar-prof');
            if (topBarProf) {
                if (selectedCourse.professor && selectedCourse.professor.name) {
                    topBarProf.innerHTML = `담당교수: ${selectedCourse.professor.name} ` +
                        (selectedCourse.professor.email ? `(<a href="mailto:${selectedCourse.professor.email}">${selectedCourse.professor.email}</a>)` : '');
                } else {
                    // 폴백: 기존 로컬스토리지 설정
                    try {
                        const cfgRaw = localStorage.getItem('scorequery_config');
                        if (cfgRaw) {
                            const cfg = JSON.parse(cfgRaw);
                            if (cfg.professor) {
                                topBarProf.innerHTML = `담당교수: ${cfg.professor.name} (<a href="mailto:${cfg.professor.email}">${cfg.professor.email}</a>)`;
                            }
                        }
                    } catch { /* ignore */ }
                }
            }

            // 교수자 정보 버튼 처리
            const btnProfInfo = document.getElementById('btn-prof-info');
            if (btnProfInfo) {
                let profName = '';
                let profEmail = '';
                if (selectedCourse.professor && selectedCourse.professor.name) {
                    profName = selectedCourse.professor.name;
                    profEmail = selectedCourse.professor.email || '';
                } else {
                    try {
                        const cfg = JSON.parse(localStorage.getItem('scorequery_config') || '{}');
                        if (cfg.professor && cfg.professor.name) {
                            profName = cfg.professor.name;
                            profEmail = cfg.professor.email || '';
                        }
                    } catch { /* ignore */ }
                }
                
                if (profName) {
                    btnProfInfo.style.display = 'flex';
                    btnProfInfo.onclick = () => {
                        const modal = document.getElementById('prof-info-modal');
                        document.getElementById('prof-info-name').textContent = profName + ' 교수';
                        const emailEl = document.getElementById('prof-info-email');
                        if (profEmail) {
                            emailEl.textContent = profEmail;
                            emailEl.href = 'mailto:' + profEmail;
                            emailEl.parentElement.style.display = 'flex';
                        } else {
                            emailEl.parentElement.style.display = 'none';
                        }
                        if (modal) modal.style.display = 'flex';
                    };
                } else {
                    btnProfInfo.style.display = 'none';
                }
            }

            // 공시 상태 확인
            const publishStatus = checkPublishStatus(selectedCourse);

            if (publishStatus.available) {
                authGroup.style.display = '';
            } else {
                authGroup.style.display = 'none';
                showError(publishStatus.message);
            }
        } else {
            selectedCourse = null;
            authGroup.style.display = 'none';
            const btnProfInfo = document.getElementById('btn-prof-info');
            if (btnProfInfo) btnProfInfo.style.display = 'none';
            document.getElementById('login-course-info').textContent = '성적을 조회합니다';
        }
    });

    // ── 공시 상태 확인 ──
    function checkPublishStatus(course) {
        if (!course) {
            return { available: false, message: '📢 선택된 과목 정보가 올바르지 않습니다.' };
        }

        // 1) localStorage에서 먼저 최신 공시 정보를 체크해 봅니다.
        let info = null;
        try {
            for (const key of getCoursePublishKeys(course)) {
                const raw = localStorage.getItem(key);
                if (raw) {
                    info = JSON.parse(raw);
                    break;
                }
            }
        } catch { /* ignore */ }

        // 2) localStorage에 없거나 published 정보가 없다면 과목에 내장된 정보를 폴백으로 씁니다.
        if (!info) {
            if (course.published) {
                info = {
                    published: true,
                    publishStartDate: course.publishStartDate,
                    publishEndDate: course.publishEndDate,
                    publishDate: course.publishDate
                };
            } else {
                return { available: false, message: '📢 아직 성적이 공시되지 않았습니다.\n교수님께서 공시한 후 조회할 수 있습니다.' };
            }
        }

        // 3) 공시 여부 확인 및 시간 범위 검증
        if (!info.published) {
            return { available: false, message: '📢 아직 성적이 공시되지 않았습니다.\n교수님께서 공시한 후 조회할 수 있습니다.' };
        }

        const startVal = info.publishStartDate || info.publishDate;
        const endVal = info.publishEndDate;

        if (!startVal) {
            // 날짜가 없는데 published=true이면 즉시 허용
            return { available: true };
        }

        const startDt = new Date(startVal);
        const endDt = endVal ? new Date(endVal) : null;
        const now = new Date();

        if (now < startDt) {
            const dateStr = startDt.toLocaleString('ko-KR', {
                year:'numeric', month:'long', day:'numeric',
                hour:'2-digit', minute:'2-digit'
            });
            return { available: false, message: `⏳ 성적 공시 예정입니다.\n${dateStr}부터 조회할 수 있습니다.` };
        }

        if (endDt && now > endDt) {
            const dateStr = endDt.toLocaleString('ko-KR', {
                year:'numeric', month:'long', day:'numeric',
                hour:'2-digit', minute:'2-digit'
            });
            return { available: false, message: `🔒 성적 조회 기간이 종료되었습니다.\n(조회 기간: ~ ${dateStr} 까지)` };
        }

        return { available: true };
    }

    // ── 과목 목록 비동기 사전 로딩 ──
    async function loadAvailableCoursesAsync() {
        await loadPublicConfig();
        const coursesMap = new Map();
        const addCourse = (c) => {
            if (!c || !c.name) return;
            const key = `${c.year || ''}_${c.semester || ''}_${c.name}`;
            if (!coursesMap.has(key)) {
                coursesMap.set(key, {
                    id: c.id || getCourseId(c),
                    year: c.year || '',
                    semester: c.semester || '',
                    name: c.name,
                    professor: c.professor || null,
                    publishDate: c.publishDate || null,
                    publishStartDate: c.publishStartDate || null,
                    publishEndDate: c.publishEndDate || null,
                    published: c.published || false,
                    _source: c._source || 'local'
                });
            } else {
                const existing = coursesMap.get(key);
                if (c.published) existing.published = true;
                if (c.professor) existing.professor = c.professor;
                if (c.publishDate) existing.publishDate = c.publishDate;
                if (c.publishStartDate) existing.publishStartDate = c.publishStartDate;
                if (c.publishEndDate) existing.publishEndDate = c.publishEndDate;
                if (c.id) existing.id = c.id;
                if (c._source === 'data.json') existing._source = 'data.json';
                if (c._source === 'api') existing._source = 'api';
            }
        };

        // 0) Secure API metadata. Public deployments should use this path.
        try {
            const apiData = await fetchJsonFromApi('/api/courses', { method: 'GET' });
            if (apiData && Array.isArray(apiData.courses)) {
                apiData.courses.forEach(c => addCourse({ ...c, _source: 'api', published: c.published !== false }));
            }
        } catch (err) {
            console.warn('[ScoreQuery] API course loading failed:', err);
        }

        // 1) localStorage - scorequery_courses
        try {
            const raw = localStorage.getItem('scorequery_courses');
            if (raw) {
                const list = JSON.parse(raw);
                list.forEach(c => addCourse(c));
            }
        } catch { /* ignore */ }

        // 2) localStorage - scorequery_config
        try {
            const cfgRaw = localStorage.getItem('scorequery_config');
            if (cfgRaw) {
                const cfg = JSON.parse(cfgRaw);
                if (cfg.courses) {
                    cfg.courses.forEach(c => addCourse(c));
                }
                if (cfg.course) {
                    addCourse(cfg.course);
                }
            }
        } catch { /* ignore */ }

        // Plaintext data.json is intentionally not loaded. Private grade files must stay encrypted.

        cachedAvailableCourses = Array.from(coursesMap.values());
    }

    // ── 과목 목록 가져오기 ──
    function getAvailableCourses() {
        if (cachedAvailableCourses && cachedAvailableCourses.length > 0) {
            return cachedAvailableCourses;
        }
        // 캐시가 비어있을 때 동기 폴백
        const list = [];
        try {
            const raw = localStorage.getItem('scorequery_courses');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.length > 0) return parsed;
            }
        } catch { /* ignore */ }
        return list;
    }

    // ── 학생모드 진입 시 과목 목록 채우기 ──
    async function populateStudentCourses() {
        await loadAvailableCoursesAsync();
        const courses = getAvailableCourses();
        courseSelect.innerHTML = '<option value="">과목을 선택하세요</option>';
        courseSelect.classList.add('select-unselected');
        courses.forEach((c, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${c.year} ${c.semester} — ${c.name}`;
            courseSelect.appendChild(opt);
        });
        authGroup.style.display = 'none';
        selectedCourse = null;
        document.getElementById('login-course-info').textContent = '과목을 선택하면 성적을 조회할 수 있습니다';

        if (courses.length === 0) {
            courseSelect.innerHTML = '<option value="">등록된 과목이 없습니다</option>';
        }
    }

    // ── 데이터 로드 (모든 소스에서 순차 검색) ──
    async function loadAllDataSources() {
        const sources = [];
        const isValid = (d) => d && d.students && Object.keys(d.students).length > 0;

        // 1) 과목별 키
        if (selectedCourse) {
            for (const key of getCourseDataKeys(selectedCourse)) {
                try {
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (isValid(parsed)) {
                            parsed._source = 'course-key';
                            sources.push(parsed);
                            break;
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        }

        // 2) 기존 단일 키 (하위호환)
        try {
            const localRaw = localStorage.getItem('scorequery_data');
            if (localRaw) {
                const parsed = JSON.parse(localRaw);
                if (isValid(parsed)) {
                    parsed._source = 'single-key';
                    sources.push(parsed);
                }
            }
        } catch (e) { /* ignore */ }

        // Plaintext data.json is intentionally not loaded. Use local session data or a secure API.

        return sources;
    }

    // ── SHA-256 해시 (Web Crypto API) ──
    async function sha256(message) {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ── Login Handler ──
    async function handleLogin(e) {
        e.preventDefault();
        hideError();

        if (checkStudentLock()) {
            showError('❌ 무단 조회 방지를 위해 조회 기능이 잠겨 있습니다.');
            return;
        }

        if (!selectedCourse) {
            showError('과목을 먼저 선택해 주세요.');
            return;
        }

        const studentId = studentIdInput.value.trim();
        const phoneLast4 = phoneLast4Input.value.trim();
        const studentAccessCodeInput = document.getElementById('student-access-code');
        const accessCode = studentAccessCodeInput ? studentAccessCodeInput.value.trim() : '';

        if (!studentId || !phoneLast4 || !accessCode) {
            showError('학번, 전화번호 뒷자리, 접속 비밀번호를 모두 입력해 주세요.');
            return;
        }

        if (phoneLast4.length !== 4) {
            showError('전화번호 뒷자리 4자리를 정확히 입력해 주세요.');
            return;
        }

        if (accessCode.length !== 6 || !/^\d{6}$/.test(accessCode)) {
            showError('접속 비밀번호 6자리 숫자를 정확히 입력해 주세요.');
            return;
        }

        setLoading(true);

        try {
            await loadPublicConfig();
            const apiOrigin = getApiOrigin();
            if (apiOrigin) {
                try {
                    const apiResult = await fetchJsonFromApi('/api/score', {
                        method: 'POST',
                        body: JSON.stringify({
                            course_id: getCourseId(selectedCourse),
                            student_id: studentId,
                            phone_last4: phoneLast4,
                            access_code: accessCode
                        })
                    });

                    localStorage.removeItem('scorequery_fail_count');
                    gradeData = {
                        course: apiResult.course || selectedCourse,
                        evaluation: apiResult.evaluation || []
                    };
                    renderResult(apiResult);
                    return;
                } catch (apiErr) {
                    if (selectedCourse && selectedCourse._source === 'api') {
                        showError(apiErr.message || '성적 조회 서버 요청에 실패했습니다.');
                        return;
                    }
                    console.warn('[ScoreQuery] API score lookup failed, trying local preview data:', apiErr);
                }
            }

            const sources = await loadAllDataSources();
            if (sources.length === 0) {
                showError('성적 조회 서버가 설정되어 있지 않습니다.\n관리자에게 문의해 주세요.');
                setLoading(false);
                return;
            }

            const hashKey = await sha256(`${studentId}|${phoneLast4}|${accessCode}`);

            // 모든 데이터 소스에서 순차 검색
            let foundData = null;
            let foundStudent = null;
            for (const data of sources) {
                if (data.students[hashKey]) {
                    foundData = data;
                    foundStudent = data.students[hashKey];
                    break;
                }
            }

            if (!foundStudent) {
                let fails = parseInt(localStorage.getItem('scorequery_fail_count') || '0');
                fails++;
                localStorage.setItem('scorequery_fail_count', fails);
                if (fails >= 5) {
                    localStorage.setItem('scorequery_lock_until', Date.now() + 10 * 60 * 1000);
                    localStorage.removeItem('scorequery_fail_count');
                    checkStudentLock();
                    showError('❌ 5회 연속 실패하여 10분간 조회가 잠금되었습니다.');
                } else {
                    showError(`일치하는 정보를 찾을 수 없습니다. (실패 횟수: ${fails}/5)\n학번과 전화번호를 다시 확인해 주세요.`);
                }
                setLoading(false);
                return;
            }

            // 로그인 성공 시 실패 횟수 초기화 및 비식별 로그 적재
            localStorage.removeItem('scorequery_fail_count');
            
            const subjectId = getCourseId(selectedCourse);
            let viewLogs = [];
            try {
                viewLogs = JSON.parse(localStorage.getItem('scorequery_view_logs') || '[]');
            } catch (err) {}
            const alreadyLogged = viewLogs.some(log => log.subjectId === subjectId && log.viewKey === hashKey);
            if (!alreadyLogged) {
                viewLogs.push({
                    subjectId,
                    viewKey: hashKey,
                    viewDate: new Date().toISOString()
                });
                localStorage.setItem('scorequery_view_logs', JSON.stringify(viewLogs));
            }

            gradeData = foundData;
            const cn = String(foundStudent.class_num);
            const classAvg = foundData.class_avg[cn] || {};
            const classMax = foundData.class_max[cn] || {};
            const classCount = foundData.class_counts[cn] || 0;

            renderResult({ student: foundStudent, class_avg: classAvg, class_max: classMax, class_count: classCount });
        } catch (err) {
            showError(err.message || '조회에 실패했습니다.');
        } finally {
            setLoading(false);
        }
    }

    // ── Logout Handler ──
    function handleLogout() {
        resultSection.classList.remove('visible');
        loginSection.style.display = '';
        loginForm.reset();
        hideError();

        // 과목 선택 초기화
        selectedCourse = null;
        gradeData = null;
        courseSelect.value = '';
        authGroup.style.display = 'none';
        document.getElementById('login-course-info').textContent = '과목을 선택하면 성적을 조회할 수 있습니다';

        if (radarChart) {
            radarChart.destroy();
            radarChart = null;
        }

        // 상단 바 복원
        document.getElementById('top-bar-title').textContent = '📊 성적 관리 시스템';

        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    }

    // ── Render Result ──
    function renderResult(data) {
        const { student, class_avg, class_max, class_count } = data;

        loginSection.style.display = 'none';
        resultSection.classList.add('visible');

        // 상단 바에 과목+교수 정보 표시
        let profEmail = '';
        if (selectedCourse) {
            const titleEl = document.getElementById('top-bar-title');
            titleEl.textContent = `성적조회시스템: ${selectedCourse.year}-${selectedCourse.semester}-${selectedCourse.name}`;
            try {
                const cfg = JSON.parse(localStorage.getItem('scorequery_config') || '{}');
                if (cfg.professor && cfg.professor.name) {
                    profEmail = cfg.professor.email || 'armour@tu.ac.kr';
                    const profEl = document.getElementById('top-bar-prof');
                    profEl.textContent = `담당교수: ${cfg.professor.name}(${profEmail})`;
                }
            } catch {}
        }

        // 글로벌 공지사항 표시 (gradeData.schedule.notice 활용)
        const noticeBox = document.getElementById('student-notice-box');
        const noticeText = document.getElementById('student-notice-text');
        if (gradeData && gradeData.schedule && gradeData.schedule.notice) {
            noticeText.innerHTML = gradeData.schedule.notice.replace(/\n/g, '<br>');
            noticeBox.style.display = 'block';
        } else {
            noticeBox.style.display = 'none';
        }



        document.getElementById('avatar-initial').textContent = student.name_masked[0];
        document.getElementById('student-name').textContent = student.name_masked;
        document.getElementById('student-dept').textContent =
            `${student.department} · ${student.class_num}분반 · ${student.student_id_masked}`;

        renderScoreCards(student, class_avg);
        renderRadarChart(student, class_avg, class_max);
        renderSummary(student, class_count);

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ── Render Score Cards ──
    function renderScoreCards(student, classAvg) {
        const container = document.getElementById('score-cards');
        container.innerHTML = '';

        getScoreFields(gradeData, student).forEach((field) => {
            let value = student[field.key];
            let avg = classAvg[field.key];

            // 근거가 되는 점수는 소수점 첫째 자리에서 반올림 (정수형 변환, 단 total_score/extra_score/special_score는 제외)
            if (field.key !== 'total_score' && field.key !== 'extra_score' && field.key !== 'special_score') {
                if (value !== null && value !== undefined) value = Math.round(value);
                if (avg !== null && avg !== undefined) avg = Math.round(avg);
            }

            const displayVal = value !== null && value !== undefined ? value : '-';
            const maxText = typeof field.max === 'number' ? `${field.max}점 만점` : '추가 반영';
            const pct = (typeof field.max === 'number' && value !== null && value !== undefined)
                ? Math.min((value / field.max) * 100, 100)
                : (value !== null && value !== undefined ? 100 : 0);

            const avgDisplay = avg !== null && avg !== undefined 
                ? (field.key === 'total_score' || field.key === 'extra_score' || field.key === 'special_score' ? avg.toFixed(1) : Math.round(avg)) 
                : '-';

            const card = document.createElement('div');
            card.className = `score-card ${field.cssClass}`;
            // 분반 평균과의 차이 계산
            let diffHtml = '';
            if (value !== null && value !== undefined && avg !== null && avg !== undefined) {
                const diff = value - avg;
                const sign = diff >= 0 ? '+' : '';
                const color = diff >= 0 ? '#4ade80' : '#fbbf24';
                const diffText = (field.key === 'total_score' || field.key === 'extra_score' || field.key === 'special_score') ? diff.toFixed(1) : Math.round(diff).toString();
                diffHtml = `<div class="card-diff-hint" style="color:${color}; font-weight:700;">${sign}${diffText}</div>`;
            }

            let memoHtml = '';
            if (field.key === 'extra_score' && student.extra_memo) {
                memoHtml = `<div class="card-memo-hint" style="font-size: 0.6875rem; color: #34d399; margin-top: var(--space-xs); font-style: italic; line-height:1.4;">📝 ${student.extra_memo}</div>`;
            } else if (field.key === 'special_score' && student.special_memo) {
                memoHtml = `<div class="card-memo-hint" style="font-size: 0.6875rem; color: #fbbf24; margin-top: var(--space-xs); font-style: italic; line-height:1.4;">📝 ${student.special_memo}</div>`;
            }

            card.innerHTML = `
                <div class="card-icon">${field.icon}</div>
                <div class="card-label">${field.label}</div>
                <div class="card-score">${displayVal}</div>
                <div class="card-max">${maxText}</div>
                <div class="progress-bar">
                    <div class="progress-fill" data-width="${pct}"></div>
                </div>
                <div class="card-avg-hint">
                    <span class="avg-dot"></span>
                    분반 평균 ${avgDisplay}
                </div>
                ${diffHtml}
                ${memoHtml}
            `;
            container.appendChild(card);
        });

        requestAnimationFrame(() => {
            setTimeout(() => {
                container.querySelectorAll('.progress-fill').forEach((bar) => {
                    bar.style.width = bar.dataset.width + '%';
                });
            }, 100);
        });
    }

    // ── Render Radar Chart ──
    function renderRadarChart(student, classAvg, classMax) {
        const ctx = document.getElementById('radar-chart').getContext('2d');

        if (radarChart) {
            radarChart.destroy();
        }

        const labels = [];
        const myData = [];
        const avgData = [];
        const maxData = [];

        getScoreFields(gradeData, student).forEach((field) => {
            if (field.key === 'total_score' || field.key === 'extra_score' || field.key === 'special_score') return;
            labels.push(field.label);
            let myVal = student[field.key];
            let avgVal = classAvg[field.key];
            let maxVal = classMax[field.key];

            // 근거가 되는 점수는 소수점 첫째 자리에서 반올림
            if (myVal !== null && myVal !== undefined) myVal = Math.round(myVal);
            if (avgVal !== null && avgVal !== undefined) avgVal = Math.round(avgVal);
            if (maxVal !== null && maxVal !== undefined) maxVal = Math.round(maxVal);

            myData.push(myVal !== null && myVal !== undefined ? Math.max(0, Math.min(Math.round((myVal / field.max) * 100), 100)) : 0);
            avgData.push(avgVal !== null && avgVal !== undefined ? Math.max(0, Math.min(Math.round((avgVal / field.max) * 100), 100)) : 0);
            maxData.push(maxVal !== null && maxVal !== undefined ? Math.max(0, Math.min(Math.round((maxVal / field.max) * 100), 100)) : 0);
        });

        radarChart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '내 점수',
                        data: myData,
                        backgroundColor: 'rgba(99, 102, 241, 0.15)',
                        borderColor: 'rgba(129, 140, 248, 0.8)',
                        borderWidth: 2,
                        pointBackgroundColor: '#818cf8',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                    },
                    {
                        label: '분반 평균',
                        data: avgData,
                        backgroundColor: 'rgba(248, 113, 113, 0.08)',
                        borderColor: 'rgba(248, 113, 113, 0.5)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointBackgroundColor: '#f87171',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                    },
                    {
                        label: '최고점수',
                        data: maxData,
                        backgroundColor: 'rgba(250, 204, 21, 0.05)',
                        borderColor: 'rgba(250, 204, 21, 0.4)',
                        borderWidth: 1.5,
                        borderDash: [3, 3],
                        pointBackgroundColor: '#facc15',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 1,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                layout: {
                    padding: {
                        top: 5,
                        bottom: 25,
                        left: 10,
                        right: 10
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#f1f5f9',
                        bodyColor: '#cbd5e1',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.r}%`,
                        },
                    },
                },
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            stepSize: 20,
                            color: 'rgba(148, 163, 184, 0.5)',
                            backdropColor: 'transparent',
                            font: { size: 10 },
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.06)',
                        },
                        angleLines: {
                            color: 'rgba(255, 255, 255, 0.06)',
                        },
                        pointLabels: {
                            color: '#94a3b8',
                            font: { size: 12, weight: '500', family: "'Inter', 'Noto Sans KR', sans-serif" },
                        },
                    },
                },
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart',
                },
            },
        });
    }

    // ── Render Summary ──
    function renderSummary(student, classCount) {
        const gradeEl = document.getElementById('summary-grade');
        const gradeText = student.grade || '-';
        const gradeClass = getGradeClass(gradeText);
        gradeEl.innerHTML = `<span class="grade-badge ${gradeClass}">${gradeText}</span>`;

        document.getElementById('summary-rank').textContent = student.rank;

        const absencesEl = document.getElementById('summary-absences');
        if (student.absences === 0) {
            absencesEl.innerHTML = `<span class="attendance-perfect"><span class="perfect-badge">✨ 개근</span> 0회</span>`;
        } else {
            absencesEl.textContent = `${student.absences}회`;
        }

        document.getElementById('summary-total').textContent =
            student.total_score !== null ? `${student.total_score}점` : '-';

        const remarkBox = document.getElementById('remark-box');
        const remarkContent = document.getElementById('remark-content');
        if (student.remark && student.remark.trim()) {
            remarkContent.textContent = student.remark;
            remarkBox.style.display = 'block';
        } else {
            remarkBox.style.display = 'none';
        }
    }

    // ── Utilities ──
    function getGradeClass(grade) {
        if (!grade || grade === '-') return 'grade-f';
        const first = grade[0].toUpperCase();
        switch (first) {
            case 'A': return 'grade-a';
            case 'B': return 'grade-b';
            case 'C': return 'grade-c';
            case 'D': return 'grade-d';
            default: return 'grade-f';
        }
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.classList.add('visible');
    }

    function hideError() {
        errorMsg.textContent = '';
        errorMsg.classList.remove('visible');
    }

    function setLoading(isLoading) {
        if (isLoading) {
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;
        } else {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    }

    // ── 성적 문의 안내 마우스 추적 ──
    const inquiryNotice = document.getElementById('grade-inquiry-notice');
    if (inquiryNotice) {
        inquiryNotice.addEventListener('mousemove', (e) => {
            const rect = inquiryNotice.getBoundingClientRect();
            inquiryNotice.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            inquiryNotice.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        });
    }

    function checkStudentLock() {
        const lockUntil = localStorage.getItem('scorequery_lock_until');
        const timerEl = document.getElementById('student-lock-timer');
        if (!timerEl) return false;

        if (lockUntil) {
            const remaining = parseInt(lockUntil) - Date.now();
            if (remaining > 0) {
                // Lock active
                timerEl.style.display = 'block';
                studentIdInput.disabled = true;
                phoneLast4Input.disabled = true;
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.5';

                // Update timer text
                const minutes = Math.floor(remaining / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                timerEl.textContent = `❌ 무단 조회 방지를 위해 잠금되었습니다. 남은 시간: ${String(minutes).padStart(2, '0')}분 ${String(seconds).padStart(2, '0')}초`;

                if (!lockInterval) {
                    lockInterval = setInterval(checkStudentLock, 1000);
                }
                return true;
            }
        }

        // Unlock or no lock
        if (lockInterval) {
            clearInterval(lockInterval);
            lockInterval = null;
        }
        timerEl.style.display = 'none';
        
        // Only re-enable if schedule is not blocking
        const scheduleRaw = localStorage.getItem('scorequery_schedule');
        let scheduleBlocks = false;
        if (scheduleRaw) {
            try {
                const sched = JSON.parse(scheduleRaw);
                const now = new Date();
                if (sched.start && now < new Date(sched.start)) scheduleBlocks = true;
                if (sched.end && now > new Date(sched.end)) scheduleBlocks = true;
            } catch (e) {}
        }
        
        if (!scheduleBlocks) {
            studentIdInput.disabled = false;
            phoneLast4Input.disabled = false;
            submitBtn.disabled = false;
            submitBtn.style.opacity = '';
        }
        return false;
    }

    function checkScheduleAndControl() {
        // 교수자(관리자) 세션이 있으면 일정 블록을 무시하고 조회를 허용합니다. (테스트 목적)
        let isAdmin = false;
        try {
            const sess = sessionStorage.getItem('scorequery_session');
            if (sess) {
                const user = JSON.parse(sess);
                if (user && (user.isMaster || user.status === 'approved')) {
                    isAdmin = true;
                }
            }
        } catch (e) {}

        const scheduleRaw = localStorage.getItem('scorequery_schedule');
        const blockEl = document.getElementById('student-schedule-block');
        if (!blockEl) return;

        if (!scheduleRaw || isAdmin) {
            blockEl.style.display = 'none';
            loginForm.style.display = '';
            if (scheduleInterval) {
                clearInterval(scheduleInterval);
                scheduleInterval = null;
            }
            return;
        }

        try {
            const sched = JSON.parse(scheduleRaw);
            const { start, end, notice } = sched;
            const now = new Date();

            let isBefore = false;
            let isAfter = false;
            let diff = 0;

            if (start) {
                const startDate = new Date(start);
                if (now < startDate) {
                    isBefore = true;
                    diff = startDate - now;
                }
            }

            if (end && !isBefore) {
                const endDate = new Date(end);
                if (now > endDate) {
                    isAfter = true;
                }
            }

            if (isBefore) {
                blockEl.style.display = 'block';
                loginForm.style.display = 'none';

                const days = Math.floor(diff / 86400000);
                const hours = Math.floor((diff % 86400000) / 3600000);
                const mins = Math.floor((diff % 3600000) / 60000);
                const secs = Math.floor((diff % 60000) / 1000);
                
                let countdownStr = days > 0 ? `D-${days}일 ` : '';
                countdownStr += `${String(hours).padStart(2, '0')}시간 ${String(mins).padStart(2, '0')}분 ${String(secs).padStart(2, '0')}초`;

                blockEl.innerHTML = `
                    <div style="text-align: center; padding: 24px 16px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: var(--radius-xl);">
                        <span style="font-size: 40px; display: block; margin-bottom: 12px;">⏳</span>
                        <h3 style="margin: 0 0 8px 0; color: #fbbf24; font-size: 1.125rem;">성적 조회 개시 전</h3>
                        <p style="margin: 0 0 16px 0; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5;">아직 성적 조회 기간이 아닙니다. 아래 카운트다운 종료 후 조회가 가능합니다.</p>
                        <div style="font-size: 1.25rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 10px; display: inline-block; min-width: 200px;">
                            ${countdownStr}
                        </div>
                        ${notice ? `<div style="margin-top: 16px; font-size: 0.85rem; color: #cbd5e1; border-top: 1px solid var(--border-glass); padding-top: 12px; line-height: 1.5;">📢 ${notice}</div>` : ''}
                    </div>
                `;

                if (!scheduleInterval) {
                    scheduleInterval = setInterval(checkScheduleAndControl, 1000);
                }
                return;
            }

            if (isAfter) {
                blockEl.style.display = 'block';
                loginForm.style.display = 'none';
                blockEl.innerHTML = `
                    <div style="text-align: center; padding: 24px 16px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: var(--radius-xl);">
                        <span style="font-size: 40px; display: block; margin-bottom: 12px;">❌</span>
                        <h3 style="margin: 0 0 8px 0; color: #ef4444; font-size: 1.125rem;">성적 조회 마감</h3>
                        <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5;">이번 학기 성적 조회가 마감되었습니다.</p>
                        ${notice ? `<div style="margin-top: 16px; font-size: 0.85rem; color: #cbd5e1; border-top: 1px solid var(--border-glass); padding-top: 12px; line-height: 1.5;">📢 ${notice}</div>` : ''}
                    </div>
                `;

                if (scheduleInterval) {
                    clearInterval(scheduleInterval);
                    scheduleInterval = null;
                }
                return;
            }

            // Normal period
            blockEl.style.display = 'none';
            loginForm.style.display = '';
            if (scheduleInterval) {
                clearInterval(scheduleInterval);
                scheduleInterval = null;
            }

        } catch (e) {
            console.error('Schedule check error:', e);
            blockEl.style.display = 'none';
            loginForm.style.display = '';
        }
    }

    // Expose for admin.js
    window.populateStudentCourses = populateStudentCourses;
    window.checkStudentLock = checkStudentLock;
    window.checkScheduleAndControl = checkScheduleAndControl;
})();
