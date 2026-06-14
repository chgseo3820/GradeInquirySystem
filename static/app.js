/**
 * ScoreQuery ??Frontend Logic
 * ?±Ï†Å Ï°∞Ìöå ?úÏä§???ÑÎ°†?∏Ïóî?? */

(() => {
    'use strict';

    // ?Ä?Ä DOM References ?Ä?Ä
    const loginSection = document.getElementById('login-section');
    const resultSection = document.getElementById('result-section');
    const loginForm = document.getElementById('login-form');
    const studentIdInput = document.getElementById('student-id');
    const phoneLast4Input = document.getElementById('phone-last4');
    const submitBtn = document.getElementById('submit-btn');
    const errorMsg = document.getElementById('error-message');
    const logoutBtn = document.getElementById('logout-btn');

    // ?Ä?Ä Score Card Config ?Ä?Ä
    const SCORE_FIELDS = [
        { key: 'quiz_score', label: '?¥Ï¶à', icon: '?éØ', max: 30, cssClass: 'card-quiz' },
        { key: 'attendance_score', label: 'Ï∂úÏÑù', icon: '?ìã', max: 30, cssClass: 'card-attendance' },
        { key: 'midterm_score', label: 'Ï§ëÍ∞ÑÍ≥†ÏÇ¨', icon: '?ìù', max: 20, cssClass: 'card-midterm' },
        { key: 'final_score', label: 'Í∏∞ÎßêÍ≥†ÏÇ¨', icon: '?ìñ', max: 20, cssClass: 'card-final' },
        { key: 'total_score', label: 'Ï¥ùÏ†ê', icon: '?èÜ', max: 100, cssClass: 'card-total' },
    ];

    // ?Ä?Ä Chart Instance ?Ä?Ä
    let radarChart = null;

    // ?Ä?Ä Event Listeners ?Ä?Ä
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);

    // ?ÑÌôîÎ≤àÌò∏ ?ÖÎ†• ???´ÏûêÎß??àÏö©, 4?êÎ¶¨ ?úÌïú
    phoneLast4Input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
    });

    // ?ôÎ≤à ?ÖÎ†• ???´ÏûêÎß??àÏö©
    studentIdInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });

    // ?Ä?Ä Login Handler ?Ä?Ä
    async function handleLogin(e) {
        e.preventDefault();
        hideError();

        const studentId = studentIdInput.value.trim();
        const phoneLast4 = phoneLast4Input.value.trim();

        if (!studentId || !phoneLast4) {
            showError('?ôÎ≤àÍ≥??ÑÌôîÎ≤àÌò∏ ?∑ÏûêÎ¶¨Î? Î™®Îëê ?ÖÎ†•??Ï£ºÏÑ∏??');
            return;
        }

        if (phoneLast4.length !== 4) {
            showError('?ÑÌôîÎ≤àÌò∏ ?∑ÏûêÎ¶?4?êÎ¶¨Î•??ïÌôï???ÖÎ†•??Ï£ºÏÑ∏??');
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
                showError(data.error || 'Ï°∞Ìöå???§Ìå®?àÏäµ?àÎã§.');
                setLoading(false);
                return;
            }

            renderResult(data);
        } catch (err) {
            showError('?úÎ≤Ñ???∞Í≤∞?????ÜÏäµ?àÎã§.\n?†Ïãú ???§Ïãú ?úÎèÑ??Ï£ºÏÑ∏??');
        } finally {
            setLoading(false);
        }
    }

    // ?Ä?Ä Logout Handler ?Ä?Ä
    function handleLogout() {
        resultSection.classList.remove('visible');
        loginSection.style.display = '';
        loginForm.reset();
        hideError();

        if (radarChart) {
            radarChart.destroy();
            radarChart = null;
        }

        // Î∂Ä?úÎü¨???ÑÌôò ???ΩÍ∞Ñ???úÎ†à?????§ÌÅ¨Î°?        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    }

    // ?Ä?Ä Render Result ?Ä?Ä
    function renderResult(data) {
        const { student, class_avg, class_max, class_count } = data;

        // Hide login, show result
        loginSection.style.display = 'none';
        resultSection.classList.add('visible');

        // Student info header
        document.getElementById('avatar-initial').textContent = student.name_masked[0];
        document.getElementById('student-name').textContent = student.name_masked;
        document.getElementById('student-dept').textContent =
            `${student.department} ¬∑ ${student.class_num}Î∂ÑÎ∞ò ¬∑ ${student.student_id_masked}`;

        // Score cards
        renderScoreCards(student, class_avg);

        // Chart
        renderRadarChart(student, class_avg, class_max);

        // Summary
        renderSummary(student, class_count);

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ?Ä?Ä Render Score Cards ?Ä?Ä
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
            card.innerHTML = `
                <div class="card-icon">${field.icon}</div>
                <div class="card-label">${field.label}</div>
                <div class="card-score">${displayVal}</div>
                <div class="card-max">${field.max}??ÎßåÏ†ê</div>
                <div class="progress-bar">
                    <div class="progress-fill" data-width="${pct}"></div>
                </div>
                <div class="card-avg-hint">
                    <span class="avg-dot"></span>
                    Î∂ÑÎ∞ò ?âÍ∑† ${avgDisplay}
                </div>
            `;
            container.appendChild(card);
        });

        // ?ÑÎ°úÍ∑∏Î†à?§Î∞î ?†ÎãàÎ©îÏù¥??(?ΩÍ∞Ñ???úÎ†à??
        requestAnimationFrame(() => {
            setTimeout(() => {
                container.querySelectorAll('.progress-fill').forEach((bar) => {
                    bar.style.width = bar.dataset.width + '%';
                });
            }, 100);
        });
    }

    // ?Ä?Ä Render Radar Chart ?Ä?Ä
    function renderRadarChart(student, classAvg, classMax) {
        const ctx = document.getElementById('radar-chart').getContext('2d');

        if (radarChart) {
            radarChart.destroy();
        }

        // ÎßåÏ†ê ?ÄÎπ?% Î≥Ä??        const labels = [];
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
                        label: '???êÏàò',
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
                        label: 'Î∂ÑÎ∞ò ?âÍ∑†',
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
                        label: 'ÏµúÍ≥†?êÏàò',
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

    // ?Ä?Ä Render Summary ?Ä?Ä
    function renderSummary(student, classCount) {
        // ?âÏ†ê Î±ÉÏ?
        const gradeEl = document.getElementById('summary-grade');
        const gradeText = student.grade || '-';
        const gradeClass = getGradeClass(gradeText);
        gradeEl.innerHTML = `<span class="grade-badge ${gradeClass}">${gradeText}</span>`;

        // ?ùÏ∞®
        document.getElementById('summary-rank').textContent = student.rank;

        // Í≤∞ÏÑù (Í∞úÍ∑º ?úÏãú)
        const absencesEl = document.getElementById('summary-absences');
        if (student.absences === 0) {
            absencesEl.innerHTML = `<span class="attendance-perfect"><span class="perfect-badge">??Í∞úÍ∑º</span> 0??/span>`;
        } else {
            absencesEl.textContent = `${student.absences}??;
        }

        // Ï¥ùÏ†ê
        document.getElementById('summary-total').textContent =
            student.total_score !== null ? `${student.total_score}?? : '-';

        // ÎπÑÍ≥†
        const remarkBox = document.getElementById('remark-box');
        const remarkContent = document.getElementById('remark-content');
        if (student.remark && student.remark.trim()) {
            remarkContent.textContent = student.remark;
            remarkBox.style.display = 'block';
        } else {
            remarkBox.style.display = 'none';
        }
    }

    // ?Ä?Ä Utilities ?Ä?Ä
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
