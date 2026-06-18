/**
 * ScoreQuery ??Frontend Logic
 * ?적 조회 ?스???론?엔?? */

(() => {
    'use strict';

    // ?? DOM References ??
    const loginSection = document.getElementById('login-section');
    const resultSection = document.getElementById('result-section');
    const loginForm = document.getElementById('login-form');
    const studentIdInput = document.getElementById('student-id');
    const phoneLast4Input = document.getElementById('phone-last4');
    const submitBtn = document.getElementById('submit-btn');
    const errorMsg = document.getElementById('error-message');
    const logoutBtn = document.getElementById('logout-btn');

    // ?? Score Card Config ??
    const SCORE_FIELDS = [
        { key: 'quiz_score', label: '?즈', icon: '?', max: 30, cssClass: 'card-quiz' },
        { key: 'attendance_score', label: '출석', icon: '?', max: 30, cssClass: 'card-attendance' },
        { key: 'midterm_score', label: '중간고사', icon: '?', max: 20, cssClass: 'card-midterm' },
        { key: 'final_score', label: '기말고사', icon: '?', max: 20, cssClass: 'card-final' },
        { key: 'total_score', label: '성적', icon: '🏆', max: 100, cssClass: 'card-total' },
    ];

    // ?? Chart Instance ??
    let radarChart = null;

    // ?? Event Listeners ??
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);

    // ?화번호 ?력 ???자??용, 4?리 ?한
    phoneLast4Input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
    });

    // ?번 ?력 ???자??용
    studentIdInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });

    // ?? Login Handler ??
    async function handleLogin(e) {
        e.preventDefault();
        hideError();

        const studentId = studentIdInput.value.trim();
        const phoneLast4 = phoneLast4Input.value.trim();

        if (!studentId || !phoneLast4) {
            showError('?번??화번호 ?자리? 모두 ?력??주세??');
            return;
        }

        if (phoneLast4.length !== 4) {
            showError('?화번호 ?자?4?리??확???력??주세??');
            return;
        }

        setLoading(true);

        try {
            const res = await fetch('/api/score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_id: studentId, phone_last4: phoneLast4 }),
            });

            const data = await res.json();

            if (!res.ok) {
                showError(data.error || '조회???패?습?다.');
                setLoading(false);
                return;
            }

            renderResult(data);
        } catch (err) {
            showError('?버???결?????습?다.\n?시 ???시 ?도??주세??');
        } finally {
            setLoading(false);
        }
    }

    // ?? Logout Handler ??
    function handleLogout() {
        resultSection.classList.remove('visible');
        loginSection.style.display = '';
        loginForm.reset();
        hideError();

        if (radarChart) {
            radarChart.destroy();
            radarChart = null;
        }

        // 부?러???환 ???간???레?????크?        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    }

    // ?? Render Result ??
    function renderResult(data) {
        const { student, class_avg, class_max, class_count } = data;

        // Hide login, show result
        loginSection.style.display = 'none';
        resultSection.classList.add('visible');

        // Student info header
        document.getElementById('avatar-initial').textContent = student.name_masked[0];
        document.getElementById('student-name').textContent = student.name_masked;
        document.getElementById('student-dept').textContent =
            `${student.department} · ${student.class_num}분반 · ${student.student_id_masked}`;

        // Score cards
        renderScoreCards(student, class_avg);

        // Chart
        renderRadarChart(student, class_avg, class_max);

        // Summary
        renderSummary(student, class_count);

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ?? Render Score Cards ??
    function renderScoreCards(student, classAvg) {
        const container = document.getElementById('score-cards');
        container.innerHTML = '';

        SCORE_FIELDS.forEach((field) => {
            let value = student[field.key];
            let avg = classAvg[field.key];

            // 근거가 되는 점수는 소수점 첫째 자리에서 반올림 (정수형 변환)
            if (field.key !== 'total_score') {
                if (value !== null && value !== undefined) value = Math.round(value);
                if (avg !== null && avg !== undefined) avg = Math.round(avg);
            }

            const displayVal = value !== null && value !== undefined ? value : '-';
            const pct = value !== null && value !== undefined ? (value / field.max) * 100 : 0;
            const avgDisplay = avg !== null && avg !== undefined ? avg : '-';

            const card = document.createElement('div');
            card.className = `score-card ${field.cssClass}`;
            card.innerHTML = `
                <div class="card-icon">${field.icon}</div>
                <div class="card-label">${field.label}</div>
                <div class="card-score">${displayVal}</div>
                <div class="card-max">${field.max}??만점</div>
                <div class="progress-bar">
                    <div class="progress-fill" data-width="${pct}"></div>
                </div>
                <div class="card-avg-hint">
                    <span class="avg-dot"></span>
                    분반 ?균 ${avgDisplay}
                </div>
            `;
            container.appendChild(card);
        });

        // ?로그레?바 ?니메이??(?간???레??
        requestAnimationFrame(() => {
            setTimeout(() => {
                container.querySelectorAll('.progress-fill').forEach((bar) => {
                    bar.style.width = bar.dataset.width + '%';
                });
            }, 100);
        });
    }

    // ?? Render Radar Chart ??
    function renderRadarChart(student, classAvg, classMax) {
        const ctx = document.getElementById('radar-chart').getContext('2d');

        if (radarChart) {
            radarChart.destroy();
        }

        // 만점 대비 % 변환
        const labels = [];
        const myData = [];
        const avgData = [];
        const maxData = [];

        SCORE_FIELDS.forEach((field) => {
            labels.push(field.label);
            let myVal = student[field.key];
            let avgVal = classAvg[field.key];
            let maxVal = classMax[field.key];

            // 근거가 되는 점수는 소수점 첫째 자리에서 반올림
            if (field.key !== 'total_score') {
                if (myVal !== null && myVal !== undefined) myVal = Math.round(myVal);
                if (avgVal !== null && avgVal !== undefined) avgVal = Math.round(avgVal);
                if (maxVal !== null && maxVal !== undefined) maxVal = Math.round(maxVal);
            }

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
                        label: '???수',
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
                        label: '분반 ?균',
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
                        label: '최고?수',
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

    // ?? Render Summary ??
    function renderSummary(student, classCount) {
        // ?점 뱃?
        const gradeEl = document.getElementById('summary-grade');
        const gradeText = student.grade || '-';
        const gradeClass = getGradeClass(gradeText);
        gradeEl.innerHTML = `<span class="grade-badge ${gradeClass}">${gradeText}</span>`;

        // ?차
        document.getElementById('summary-rank').textContent = student.rank;

        // 결석 (개근 ?시)
        const absencesEl = document.getElementById('summary-absences');
        if (student.absences === 0) {
            absencesEl.innerHTML = `<span class="attendance-perfect"><span class="perfect-badge">??개근</span> 0??/span>`;
        } else {
            absencesEl.textContent = `${student.absences}??;
        }

        // 총점
        document.getElementById('summary-total').textContent =
            student.total_score !== null ? `${student.total_score}?? : '-';

        // 비고
        const remarkBox = document.getElementById('remark-box');
        const remarkContent = document.getElementById('remark-content');
        if (student.remark && student.remark.trim()) {
            remarkContent.textContent = student.remark;
            remarkBox.style.display = 'block';
        } else {
            remarkBox.style.display = 'none';
        }
    }

    // ?? Utilities ??
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
})();
