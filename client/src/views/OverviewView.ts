/**
 * OverviewView - 專案概覽卡片與匯出功能
 */
import { ApiService } from '../services/ApiService';
import { AppState } from '../services/AppState';
import { format } from 'date-fns';

// Reference external modal functions (declared globally by component files)
declare function showProjectEditModal(project: any): void;

export class OverviewView {
    private state: AppState;

    constructor(state: AppState) {
        this.state = state;
    }

    async render() {
        try {
            const summaries = await ApiService.getProjectSummary(
                this.state.currentUserId,
                this.state.isAdminMode
            );
            summaries.sort((a: any, b: any) => {
                if (!a.end_date) return 1;
                if (!b.end_date) return -1;
                return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
            });
            this.renderCards(summaries);
        } catch (err) {
            console.error('Summary Load Error:', err);
        }
    }

    private renderCards(summaries: any[]) {
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

            if (p.raw_status === 'closed') {
                displayStatus = '已封存';
                statusClass = 'closed';
            }

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
                                <div class="ov-stat">
                                    <span class="ov-stat-value">${p.totalTasks}</span>
                                    <span class="ov-stat-label">總任務</span>
                                </div>
                                <div class="ov-stat">
                                    <span class="ov-stat-value">${p.completedTasks}</span>
                                    <span class="ov-stat-label">已完成</span>
                                </div>
                                <div class="ov-stat">
                                    <span class="ov-stat-value">${pct}%</span>
                                    <span class="ov-stat-label">完成率</span>
                                </div>
                                <div class="ov-stat">
                                    <span class="ov-stat-value">${dateRange}</span>
                                    <span class="ov-stat-label">時程</span>
                                </div>
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
                                ${this.state.isAdminMode ? `
                                <div class="ov-export-dropdown">
                                    <button class="btn-admin-toggle" data-id="admin-${p.id}">🛡️ 管理</button>
                                    <div class="ov-dropdown-menu dropdown-right" id="dropdown-admin-${p.id}">
                                        ${p.raw_status === 'closed'
                        ? `<button class="btn-export-opt btn-unarchive" style="color:var(--text-main)" data-project-id="${p.id}">👁️ 解除隱藏</button>`
                        : ''}
                                        <button class="btn-export-opt btn-hard-delete" style="color:var(--danger)" data-project-id="${p.id}">🗑️ 徹底刪除專案</button>
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;

        this.bindEvents(summaries);
    }

    private bindEvents(summaries: any[]) {
        // Dropdown toggle
        document.querySelectorAll('.btn-download-toggle, .btn-admin-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const btnId = (btn as HTMLElement).dataset.id;
                const menu = document.getElementById(`dropdown-${btnId}`);
                document.querySelectorAll('.ov-dropdown-menu').forEach(m => {
                    if (m !== menu) m.classList.remove('show');
                });
                menu?.classList.toggle('show');
            });
        });

        // Export options
        document.querySelectorAll('.btn-export-opt:not(.btn-hard-delete):not(.btn-unarchive)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = e.currentTarget as HTMLElement;
                const exportType = target.dataset.export;
                const projectId = target.dataset.projectId;
                if (exportType && projectId) {
                    window.open(ApiService.getExportUrl(parseInt(projectId), exportType), '_blank');
                }
                target.closest('.ov-dropdown-menu')?.classList.remove('show');
            });
        });

        // Delete project
        document.querySelectorAll('.btn-hard-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const target = e.currentTarget as HTMLElement;
                const projectId = target.dataset.projectId;
                if (confirm('此操作將永久刪除專案與其所有資料，確定嗎？')) {
                    try {
                        await ApiService.deleteProject(parseInt(projectId!));
                        await this.state.reloadAll();
                    } catch (err) {
                        alert('刪除失敗');
                    }
                }
                target.closest('.ov-dropdown-menu')?.classList.remove('show');
            });
        });

        // Unarchive project
        document.querySelectorAll('.btn-unarchive').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const target = e.currentTarget as HTMLElement;
                const projectId = target.dataset.projectId;
                try {
                    await ApiService.unarchiveProject(parseInt(projectId!));
                    await this.state.reloadAll();
                } catch (err) {
                    alert('解除隱藏失敗');
                }
                target.closest('.ov-dropdown-menu')?.classList.remove('show');
            });
        });

        // Close dropdowns
        document.addEventListener('click', () => {
            document.querySelectorAll('.ov-dropdown-menu').forEach(m => m.classList.remove('show'));
        }, { once: false });

        // Edit project card click
        document.querySelectorAll('.overview-card').forEach(card => {
            card.addEventListener('click', () => {
                if (!this.state.isEditMode) return;
                const id = (card as HTMLElement).dataset.id;
                const project = summaries.find(s => s.id === parseInt(id!));
                if (project) showProjectEditModal(project);
            });
        });
    }
}
