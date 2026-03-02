/**
 * OverviewView - 專案總覽卡片渲染與編輯
 */
import { format } from 'date-fns';

const API_URL = 'http://localhost:3000/api';

export class OverviewView {
    private isAdminMode: boolean;
    private onReloadAll: () => Promise<void>;

    constructor(isAdminMode: boolean, onReloadAll: () => Promise<void>) {
        this.isAdminMode = isAdminMode;
        this.onReloadAll = onReloadAll;
    }

    updateState(isAdminMode: boolean) {
        this.isAdminMode = isAdminMode;
    }

    render(summaries: any[]) {
        const container = document.getElementById('project-overview');
        if (!container) return;

        if (summaries.length === 0) {
            container.innerHTML = '<p class="overview-empty">尚無專案，點擊「+ 新建專案」開始</p>';
            return;
        }

        container.innerHTML = `
            <div class="overview-cards">
                ${summaries.map(p => {
            const pct = p.totalTasks > 0 ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0;
            let displayStatus = p.status;
            let statusClass = p.status === '已完成' ? 'done' : p.status === '未開始' ? 'idle' : p.status === '進行中' ? 'active' : 'empty';
            if (p.raw_status === 'closed') { displayStatus = '已封存'; statusClass = 'closed'; }

            const dateRange = p.start_date && p.end_date
                ? `${format(new Date(p.start_date), 'M/d')} ~ ${format(new Date(p.end_date), 'M/d')}`
                : '未設定';

            return `
                <div class="overview-card ${p.raw_status === 'closed' ? 'card-closed' : ''}" data-id="${p.id}">
                    <div class="ov-header">
                        <h3>${p.name}</h3>
                        <span class="ov-badge ${statusClass}">${displayStatus}</span>
                    </div>
                    <div class="ov-progress-bar">
                        <div class="ov-progress-fill" style="width: ${pct}%"></div>
                    </div>
                    <div class="ov-stats">
                        <div class="ov-stat"><span class="ov-stat-value">${p.totalTasks}</span><span class="ov-stat-label">總任務</span></div>
                        <div class="ov-stat"><span class="ov-stat-value">${p.completedTasks}</span><span class="ov-stat-label">已完成</span></div>
                        <div class="ov-stat"><span class="ov-stat-value">${pct}%</span><span class="ov-stat-label">完成率</span></div>
                        <div class="ov-stat"><span class="ov-stat-value">${dateRange}</span><span class="ov-stat-label">時程</span></div>
                    </div>
                    <div class="ov-export-actions">
                        <div class="ov-export-dropdown">
                            <button class="btn-download-toggle" data-id="${p.id}">📥 下載</button>
                            <div class="ov-dropdown-menu" id="dropdown-${p.id}">
                                <button class="btn-export-opt" data-export="excel" data-project-id="${p.id}">📊 Excel 報表</button>
                                <button class="btn-export-opt" data-export="pdf" data-project-id="${p.id}">📄 PDF 簡報</button>
                                <button class="btn-export-opt" data-export="json" data-project-id="${p.id}">📋 JSON 模板</button>
                            </div>
                        </div>
                        ${this.isAdminMode ? `
                        <div class="ov-export-dropdown">
                            <button class="btn-admin-toggle" data-id="admin-${p.id}">🛡️ 管理</button>
                            <div class="ov-dropdown-menu dropdown-right" id="dropdown-admin-${p.id}">
                                ${p.raw_status === 'closed' ? `<button class="btn-export-opt btn-unarchive" style="color:var(--text-main)" data-project-id="${p.id}">👁️ 解除隱藏</button>` : ''}
                                <button class="btn-export-opt btn-hard-delete" style="color:var(--danger)" data-project-id="${p.id}">🗑️ 徹底刪除專案</button>
                            </div>
                        </div>` : ''}
                    </div>
                </div>`;
        }).join('')}
            </div>`;

        // Dropdown toggle
        container.querySelectorAll('.btn-download-toggle, .btn-admin-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const btnId = (btn as HTMLElement).dataset.id;
                const menu = document.getElementById(`dropdown-${btnId}`);
                document.querySelectorAll('.ov-dropdown-menu').forEach(m => { if (m !== menu) m.classList.remove('show'); });
                menu?.classList.toggle('show');
            });
        });

        // Export
        container.querySelectorAll('.btn-export-opt:not(.btn-hard-delete):not(.btn-unarchive)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = e.currentTarget as HTMLElement;
                const exportType = target.dataset.export;
                const projectId = target.dataset.projectId;
                if (exportType && projectId) window.open(`${API_URL}/projects/${projectId}/export/${exportType}`, '_blank');
                target.closest('.ov-dropdown-menu')?.classList.remove('show');
            });
        });

        // Delete
        container.querySelectorAll('.btn-hard-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const target = e.currentTarget as HTMLElement;
                const projectId = target.dataset.projectId;
                if (confirm('此操作將永久刪除專案與其所有資料，確定嗎？')) {
                    try {
                        await fetch(`${API_URL}/projects/${projectId}`, { method: 'DELETE' });
                        await this.onReloadAll();
                    } catch { alert('刪除失敗'); }
                }
                target.closest('.ov-dropdown-menu')?.classList.remove('show');
            });
        });

        // Unarchive
        container.querySelectorAll('.btn-unarchive').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const target = e.currentTarget as HTMLElement;
                const projectId = target.dataset.projectId;
                try {
                    await fetch(`${API_URL}/projects/${projectId}/unarchive`, { method: 'PATCH' });
                    await this.onReloadAll();
                } catch { alert('解除隱藏失敗'); }
                target.closest('.ov-dropdown-menu')?.classList.remove('show');
            });
        });

        document.addEventListener('click', () => {
            document.querySelectorAll('.ov-dropdown-menu').forEach(m => m.classList.remove('show'));
        }, { once: false });
    }

    bindCardClick(summaries: any[], isEditMode: boolean, onEdit: (project: any) => void) {
        document.querySelectorAll('.overview-card').forEach(card => {
            card.addEventListener('click', () => {
                if (!isEditMode) return;
                const id = (card as HTMLElement).dataset.id;
                const project = summaries.find(s => s.id === parseInt(id!));
                if (project) onEdit(project);
            });
        });
    }

    async showProjectEditModal(project: any, onReload: () => Promise<void>) {
        const modal = document.getElementById('modal-overlay');
        const content = document.getElementById('modal-content');
        if (!modal || !content) return;

        modal.classList.remove('hidden');

        let logsHtml = '<p style="font-size:0.95rem; color:#666">尚無變更紀錄</p>';
        try {
            const res = await fetch(`${API_URL}/projects/${project.id}/logs`);
            if (res.ok) {
                const logs = await res.json();
                if (logs.length > 0) {
                    logsHtml = logs.map((l: any) => `
                        <div style="font-size:0.9rem; border-left:2px solid #ddd; padding-left:8px; margin-bottom:8px">
                            <div style="color:#333; font-weight:600">${format(new Date(l.created_at), 'yyyy/MM/dd HH:mm')}</div>
                            <div style="color:#666">${l.reason}</div>
                            <div style="color:#999; font-size:0.85rem">${format(new Date(l.old_end_date), 'MM/dd')} ➔ ${format(new Date(l.new_end_date), 'MM/dd')}</div>
                        </div>`).join('');
                }
            }
        } catch (err) { console.error('Error loading logs:', err); }

        content.innerHTML = `
            <button class="btn-close" id="close-proj-modal">&times;</button>
            <h3>編輯專案時程</h3>
            <p class="modal-subtitle">專案：${project.name}</p>
            <div style="margin-top:1.5rem">
                <div class="form-group">
                    <label>新結束日期</label>
                    <input type="date" id="edit-p-end" value="${format(new Date(project.end_date), 'yyyy-MM-dd')}">
                </div>
                <div class="form-group">
                    <label>變更理由 <span style="color:red">*</span></label>
                    <textarea id="edit-p-reason" placeholder="請輸入延後或提早結束的理由" required style="height:80px"></textarea>
                </div>
            </div>
            <div style="margin-top:1.5rem">
                <p class="section-title">時程變更歷史</p>
                <div style="max-height:150px; overflow-y:auto; padding:8px; background:#f9f9f9; border-radius:8px">${logsHtml}</div>
            </div>
            <div class="modal-actions" style="margin-top:2rem">
                <button type="button" class="btn-del" id="archive-project" style="background:#f1f5f9; color:#475569">結案 (隱藏)</button>
                <button type="button" class="btn-primary" id="update-proj-schedule" style="flex:2">更新時程</button>
            </div>`;

        document.getElementById('close-proj-modal')?.addEventListener('click', () => modal.classList.add('hidden'));

        document.getElementById('archive-project')?.addEventListener('click', async () => {
            if (!confirm('將專案存檔(結案)後將不再顯示於儀表板，確定嗎？')) return;
            try {
                const res = await fetch(`${API_URL}/projects/${project.id}/archive`, { method: 'PATCH' });
                if (!res.ok) throw new Error('結案失敗');
                modal.classList.add('hidden');
                await onReload();
            } catch (err) { alert((err as Error).message); }
        });

        document.getElementById('update-proj-schedule')?.addEventListener('click', async () => {
            const endDate = (document.getElementById('edit-p-end') as HTMLInputElement).value;
            const reason = (document.getElementById('edit-p-reason') as HTMLTextAreaElement).value;
            if (!reason.trim()) { alert('請輸入變更理由'); return; }
            try {
                const res = await fetch(`${API_URL}/projects/${project.id}/schedule`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_end_date: new Date(endDate).toISOString(), reason })
                });
                if (!res.ok) throw new Error('更新失敗');
                modal.classList.add('hidden');
                await onReload();
            } catch (err) { alert((err as Error).message); }
        });
    }
}
