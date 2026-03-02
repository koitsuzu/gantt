/**
 * TodayView - 今日待辦列表渲染
 */
const API_URL = 'http://localhost:3000/api';

export class TodayView {
    async render() {
        const container = document.getElementById('today-container');
        if (!container) return;
        try {
            const res = await fetch(`${API_URL}/tasks/today`);
            const tasks = await res.json();

            if (tasks.length === 0) {
                container.innerHTML = `
                    <div class="task-detail-container">
                        <h2>✅ 今日待辦</h2>
                        <div class="task-detail-empty">🎉 今天沒有待辦任務</div>
                    </div>`;
                return;
            }

            container.innerHTML = `
                <div class="task-detail-container">
                    <h2>✅ 今日待辦 (${tasks.length})</h2>
                    <table class="task-detail-table">
                        <thead>
                            <tr>
                                <th>專案</th>
                                <th>階段</th>
                                <th>任務名稱</th>
                                <th>部門</th>
                                <th>截止日</th>
                                <th>進度</th>
                                <th>狀態</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tasks.map((t: any) => `
                                <tr>
                                    <td><span class="task-project-tag">${t.project_name}</span></td>
                                    <td>${t.stage_name}</td>
                                    <td><strong>${t.name}</strong></td>
                                    <td>${t.department || '-'}</td>
                                    <td>${t.end_date?.slice(0, 10) || '-'}</td>
                                    <td>${t.progress}%</td>
                                    <td><span class="task-status-badge pending">${t.status === 'pending' ? '待處理' : t.status}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
        } catch (err) {
            console.error('Today todos error:', err);
            container.innerHTML = '<div class="task-detail-empty">載入待辦時發生錯誤</div>';
        }
    }
}
