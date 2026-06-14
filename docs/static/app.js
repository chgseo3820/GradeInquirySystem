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

    // ── Score Card Config ──
    const SCORE_FIELDS = [
        { key: 'quiz_score', label: '퀴즈', icon: '🎯', max: 30, cssClass: 'card-quiz' },
        { key: 'attendance_score', label: '출석', icon: '📋', max: 30, cssClass: 'card-attendance' },
        { key: 'midterm_score', label: '중간고사', icon: '📝', max: 20, cssClass: 'card-midterm' },
        { key: 'final_score', label: '기말고사', icon: '📖', max: 20, cssClass: 'card-final' },
        { key: 'total_score', label: '총점', icon: '🏆', max: 100, cssClass: 'card-total' },
    ];

    // ── State ──
    let radarChart = null;
    let gradeData = null;
    let selectedCourse = null; // { year, semester, name }

    // ── Event Listeners ──
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);

    phoneLast4Input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
    });

    studentIdInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
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
            document.getElementById('login-course-info').textContent = '성적을 조회합니다';
        }
    });

    // ── 공시 상태 확인 ──
    function checkPublishStatus(course) {
        const key = `scorequery_publish_${course.year}_${course.semester}_${course.name}`;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) {
                return { available: false, message: '📢 아직 성적이 공시되지 않았습니다.\n교수님께서 공시한 후 조회할 수 있습니다.' };
            }
            const info = JSON.parse(raw);
            if (!info.published) {
                return { available: false, message: '📢 아직 성적이 공시되지 않았습니다.\n교수님께서 공시한 후 조회할 수 있습니다.' };
            }
            const publishDate = new Date(info.publishDate);
            const now = new Date();
            if (now < publishDate) {
                const dateStr = publishDate.toLocaleString('ko-KR', {
                    year:'numeric', month:'long', day:'numeric',
                    hour:'2-digit', minute:'2-digit'
                });
                return { available: false, message: `⏳ 성적 공시 예정입니다.\n${dateStr}부터 조회할 수 있습니다.` };
            }
            return { available: true };
        } catch {
            return { available: false, message: '📢 아직 성적이 공시되지 않았습니다.' };
        }
    }

    // ── 과목 목록 가져오기 ──
    function getAvailableCourses() {
        // 1) 전용 과목 목록 키
        try {
            const raw = localStorage.getItem('scorequery_courses');
            if (raw) {
                const list = JSON.parse(raw);
                if (list.length > 0) return list;
            }
        } catch { /* ignore */ }

        // 2) 교수 설정에서 courses 배열 가져오기 (폴백)
        try {
            const cfgRaw = localStorage.getItem('scorequery_config');
            if (cfgRaw) {
                const cfg = JSON.parse(cfgRaw);
                if (cfg.courses && cfg.courses.length > 0) {
                    return cfg.courses.map(c => ({ year: c.year, semester: c.semester, name: c.name }));
                }
                // 이전 형식: 단일 course
                if (cfg.course && cfg.course.name) {
                    return [{ year: cfg.course.year, semester: cfg.course.semester, name: cfg.course.name }];
                }
            }
        } catch { /* ignore */ }

        return [];
    }

    // ── 학생모드 진입 시 과목 목록 채우기 ──
    function populateStudentCourses() {
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
            const key = `scorequery_data_${selectedCourse.year}_${selectedCourse.semester}_${selectedCourse.name}`;
            try {
                const raw = localStorage.getItem(key);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (isValid(parsed)) {
                        parsed._source = 'course-key';
                        sources.push(parsed);
                    }
                }
            } catch (e) { /* ignore */ }
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

        // 3) data.json 파일
        try {
            const res = await fetch('data.json');
            if (res.ok) {
                const parsed = await res.json();
                if (isValid(parsed)) {
                    parsed._source = 'data.json';
                    sources.push(parsed);
                }
            }
        } catch (e) { /* ignore */ }

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

        if (!selectedCourse) {
            showError('과목을 먼저 선택해 주세요.');
            return;
        }

        const studentId = studentIdInput.value.trim();
        const phoneLast4 = phoneLast4Input.value.trim();

        if (!studentId || !phoneLast4) {
            showError('학번과 전화번호 뒷자리를 모두 입력해 주세요.');
            return;
        }

        if (phoneLast4.length !== 4) {
            showError('전화번호 뒷자리 4자리를 정확히 입력해 주세요.');
            return;
        }

        setLoading(true);

        try {
            const sources = await loadAllDataSources();
            if (sources.length === 0) {
                showError('성적 데이터가 없습니다.\n교수 모드에서 Excel을 업로드해 주세요.');
                setLoading(false);
                return;
            }

            const hashKey = await sha256(`${studentId}|${phoneLast4}`);

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
                showError('일치하는 정보를 찾을 수 없습니다.\n학번과 전화번호를 다시 확인해 주세요.');
                setLoading(false);
                return;
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
        if (selectedCourse) {
            const titleEl = document.getElementById('top-bar-title');
            titleEl.textContent = `성적조회시스템: ${selectedCourse.year}-${selectedCourse.semester}-${selectedCourse.name}`;
            try {
                const cfg = JSON.parse(localStorage.getItem('scorequery_config') || '{}');
                if (cfg.professor && cfg.professor.name) {
                    const profEl = document.getElementById('top-bar-prof');
                    profEl.textContent = `담당교수: ${cfg.professor.name}(${cfg.professor.email || ''})`;
                }
            } catch {}
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

        SCORE_FIELDS.forEach((field) => {
            const value = student[field.key];
            const avg = classAvg[field.key];
            const displayVal = value !== null && value !== undefined ? value : '-';
            const pct = value !== null && value !== undefined ? (value / field.max) * 100 : 0;
            const avgDisplay = avg !== null && avg !== undefined ? avg : '-';

            const card = document.createElement('div');
            card.className = `score-card ${field.cssClass}`;
            // 분반 평균과의 차이 계산
            let diffHtml = '';
            if (value !== null && value !== undefined && avg !== null && avg !== undefined) {
                const diff = value - avg;
                const sign = diff >= 0 ? '+' : '';
                const color = diff >= 0 ? '#4ade80' : '#fbbf24';
                diffHtml = `<div class="card-diff-hint" style="color:${color}; font-weight:700;">${sign}${diff.toFixed(1)}</div>`;
            }

            card.innerHTML = `
                <div class="card-icon">${field.icon}</div>
                <div class="card-label">${field.label}</div>
                <div class="card-score">${displayVal}</div>
                <div class="card-max">${field.max}점 만점</div>
                <div class="progress-bar">
                    <div class="progress-fill" data-width="${pct}"></div>
                </div>
                <div class="card-avg-hint">
                    <span class="avg-dot"></span>
                    분반 평균 ${avgDisplay}
                </div>
                ${diffHtml}
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

        SCORE_FIELDS.forEach((field) => {
            labels.push(field.label);
            const myVal = student[field.key];
            const avgVal = classAvg[field.key];
            const maxVal = classMax[field.key];
            myData.push(myVal !== null && myVal !== undefined ? Math.round((myVal / field.max) * 100) : 0);
            avgData.push(avgVal !== null && avgVal !== undefined ? Math.round((avgVal / field.max) * 100) : 0);
            maxData.push(maxVal !== null && maxVal !== undefined ? Math.round((maxVal / field.max) * 100) : 0);
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

    // Expose for admin.js
    window.populateStudentCourses = populateStudentCourses;
})();
