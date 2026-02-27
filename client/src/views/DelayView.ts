/**
 * DelayView - DELAY 逾期任務明細
 */
import { ApiService } from '../services/ApiService';

export class DelayView {
    async render() {
        const container = document.getElementById('delay-container');
        if (!container) return;
        try {
            const tasks = await ApiService.getDelayedTasks();

            if (tasks.length === 0) {
                container.innerHTML = `
                    <div class="task-detail-container">
                        <h2>⚠️ DELAY 明細</h2>
                        <div class="task-detail-empty">✅ 沒有逾期任務</div>
                    </div>`;
                return;
            }

            container.innerHTML = `
                <div class="task-detail-container">
                    <h2>⚠️ DELAY 明細 (${tasks.length})</h2>
                    <table class="task-detail-table">
                        <thead>
                            <tr>
                                <th>專案</th>
                                <th>階段</th>
                                <th>任務名稱</th>
                                <th>部門</th>
                                <th>原訂截止</th>
                                <th>逾期天數</th>
                                <th>進度</th>
                                <th>狀態</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tasks.map((t: any) => {
                const endDate = new Date(t.end_date);
                const today = new Date();
                const diffDays = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
                return `
                                <tr>
                                    <td><span class="task-project-tag">${t.project_name}</span></td>
                                    <td>${t.stage_name}</td>
                                    <td><strong>${t.name}</strong></td>
                                    <td>${t.department || '-'}</td>
                                    <td>${t.end_date?.slice(0, 10) || '-'}</td>
                                    <td style="color:#dc2626;font-weight:700;">+${diffDays} 天</td>
                                    <td>${t.progress}%</td>
                                    <td><span class="task-status-badge overdue">逾期</span></td>
                                </tr>`;
            }).join('')}
                        </tbody>
                    </table>
                </div>`;
        } catch (err) {
            console.error('Delay details error:', err);
            container.innerHTML = '<div class="task-detail-empty">載入DELAY明細時發生錯誤</div>';
        }
    }
}
