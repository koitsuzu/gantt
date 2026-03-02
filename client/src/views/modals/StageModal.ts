/**
 * StageModal - 新增 Stage 到現有專案
 */
import { addDays } from 'date-fns';

const API_URL = 'http://localhost:3000/api';

export class StageModal {
    private allProjectsData: any[];
    private onSaved: () => Promise<void>;

    constructor(allProjectsData: any[], onSaved: () => Promise<void>) {
        this.allProjectsData = allProjectsData;
        this.onSaved = onSaved;
    }

    updateState(allProjectsData: any[]) {
        this.allProjectsData = allProjectsData;
    }

    show(projectId: number) {
        const overlay = document.getElementById('modal-overlay')!;
        const content = document.getElementById('modal-content')!;
        overlay.classList.remove('hidden');

        content.innerHTML = `
            <div class="modal-header"><h2>新增階段 (Stage)</h2></div>
            <div class="form-group">
                <label>階段名稱</label>
                <input type="text" id="new-stage-name" placeholder="例如：設計、開發、測試">
            </div>
            <div class="form-group">
                <label>預設天數</label>
                <input type="number" id="new-stage-days" value="7" min="1">
            </div>
            <div class="modal-actions">
                <button class="btn-secondary" id="cancel-add-stage">取消</button>
                <button class="btn-primary" id="confirm-add-stage">儲存階段</button>
            </div>`;

        const close = () => overlay.classList.add('hidden');
        document.getElementById('cancel-add-stage')?.addEventListener('click', close);
        document.getElementById('confirm-add-stage')?.addEventListener('click', async () => {
            const name = (document.getElementById('new-stage-name') as HTMLInputElement).value.trim();
            const days = parseInt((document.getElementById('new-stage-days') as HTMLInputElement).value);
            if (!name) return alert('請輸入階段名稱');

            const project = this.allProjectsData.find(p => p.id === projectId);
            let startDate = new Date();
            if (project?.stages?.length > 0) startDate = new Date(project.stages[project.stages.length - 1].end_date);
            const endDate = addDays(startDate, days);

            try {
                const res = await fetch(`${API_URL}/stages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        project_id: projectId, name,
                        start_date: startDate.toISOString(), end_date: endDate.toISOString(),
                        order: (project?.stages?.length || 0) + 1
                    })
                });
                if (!res.ok) throw new Error('儲存失敗');
                close();
                await this.onSaved();
            } catch { alert('階段儲存出錯！'); }
        });
    }
}
