import './style.css'
import { GanttRenderer, GanttItem } from './renderer';
import { GanttInteraction } from './interaction';
import { AgentChat } from './agent-chat';
import { KanbanView } from './views/KanbanView';
import { startOfDay, addDays, format, addHours } from 'date-fns';

const API_URL = 'http://localhost:3000/api';

class GanttApp {
    private renderer: GanttRenderer;
    private interaction: GanttInteraction;
    private currentUserId = 1;
    private collapsedStages: Set<number> = new Set();
    private editingDeptId: number | null = null;
    private editingTemplateId: number | null = null;
    private departments: any[] = [];
    private stageTemplates: any[] = [];
    private projects: any[] = [];
    private allProjectsData: any[] = [];
    private currentProjectId: number | null = null;
    private isEditMode = false;
    private isAdminMode = false;
    private activeTab = 'today';
    private kanbanView: KanbanView | null = null;
    private todayViewMode: 'kanban' | 'gantt' = 'kanban';

    constructor() {
        this.renderer = new GanttRenderer('gantt-chart', 'day');
        this.interaction = new GanttInteraction(this.handleBarUpdate.bind(this));
        this.interaction.setEnabled(this.isEditMode);
        this.init();
        this.setupEventListeners();
    }

    async init() {
        await this.loadDepartments();
        await this.loadStageTemplates();
        await this.loadAllProjectsGantt();
        await this.loadProjectSummary();
        // Start on today tab
        this.renderAnnouncements();
        this.renderKanbanBoard();
    }

    async loadDepartments() {
        try {
            const res = await fetch(`${API_URL}/departments`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            this.departments = await res.json();
        } catch (err) {
            console.error('Dept Load Error:', err);
        }
    }

    async loadStageTemplates() {
        try {
            const res = await fetch(`${API_URL}/stage-templates`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            this.stageTemplates = await res.json();
        } catch (err) {
            console.error('Stage Templates Load Error:', err);
            this.stageTemplates = [];
        }
    }

    async loadAllProjectsGantt() {
        try {
            const url = `${API_URL}/all-projects-gantt?userId=${this.currentUserId}${this.isAdminMode ? '&showAll=true' : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            this.allProjectsData = await res.json();
            this.projects = this.allProjectsData;
            this.renderProjectList();
            this.refreshGantt();
        } catch (err) {
            console.error('All projects load error:', err);
        }
    }

    async loadProjectSummary() {
        try {
            const url = `${API_URL}/projects/summary?userId=${this.currentUserId}${this.isAdminMode ? '&showAll=true' : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const summaries = await res.json();
            // Sort by end_date (nearest first)
            summaries.sort((a: any, b: any) => {
                if (!a.end_date) return 1;
                if (!b.end_date) return -1;
                return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
            });
            this.renderOverview(summaries);
        } catch (err) {
            console.error('Summary Load Error:', err);
        }
    }

    renderProjectList() {
        const list = document.getElementById('projects');
        if (!list) return;

        const activeProjects = this.allProjectsData
            .filter(p => this.isAdminMode ? true : p.status === 'active')
            .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());

        if (activeProjects.length === 0) {
            list.innerHTML = '<li class="no-projects">尚未建立專案</li>';
            return;
        }

        const showAllItem = `<li data-id="all" class="${this.currentProjectId === null ? 'active' : ''}">顯示全部</li>`;

        list.innerHTML = showAllItem + activeProjects.map(p => `
            <li data-id="${p.id}" class="${this.currentProjectId === p.id ? 'active' : ''}">${p.name}</li>
        `).join('');

        list.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => {
                const idAttr = li.dataset.id;
                if (idAttr === 'all') {
                    this.currentProjectId = null;
                } else {
                    this.currentProjectId = parseInt(idAttr!);
                }
                this.renderProjectList();
                this.refreshGantt();
                this.loadProjectSummary();
            });
        });
    }

    renderOverview(summaries: any[]) {
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
                                ${this.isAdminMode ? `
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

        // Dropdown toggle logic
        document.querySelectorAll('.btn-download-toggle, .btn-admin-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const btnId = (btn as HTMLElement).dataset.id;
                const menu = document.getElementById(`dropdown-${btnId}`);

                // Close other open menus
                document.querySelectorAll('.ov-dropdown-menu').forEach(m => {
                    if (m !== menu) m.classList.remove('show');
                });

                menu?.classList.toggle('show');
            });
        });

        // Export option click handlers
        document.querySelectorAll('.btn-export-opt:not(.btn-hard-delete):not(.btn-unarchive)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = e.currentTarget as HTMLElement;
                const exportType = target.dataset.export;
                const projectId = target.dataset.projectId;
                if (exportType && projectId) {
                    window.open(`${API_URL}/projects/${projectId}/export/${exportType}`, '_blank');
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
                        await fetch(`${API_URL}/projects/${projectId}`, { method: 'DELETE' });
                        this.init(); // Reload all data
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
                    await fetch(`${API_URL}/projects/${projectId}/unarchive`, { method: 'PATCH' });
                    this.init(); // Reload all data
                } catch (err) {
                    alert('解除隱藏失敗');
                }
                target.closest('.ov-dropdown-menu')?.classList.remove('show');
            });
        });

        // Close dropdowns when clicking anywhere else
        document.addEventListener('click', () => {
            document.querySelectorAll('.ov-dropdown-menu').forEach(m => m.classList.remove('show'));
        }, { once: false });

        document.querySelectorAll('.overview-card').forEach(card => {
            card.addEventListener('click', () => {
                if (!this.isEditMode) return;
                const id = (card as HTMLElement).dataset.id;
                const project = summaries.find(s => s.id === parseInt(id!));
                if (project) this.showProjectEditModal(project);
            });
        });
    }

    async showProjectEditModal(project: any) {
        const modal = document.getElementById('modal-overlay');
        const content = document.getElementById('modal-content');
        if (!modal || !content) return;

        modal.classList.remove('hidden');

        // Fetch logs
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
                        </div>
                    `).join('');
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
                <div style="max-height:150px; overflow-y:auto; padding:8px; background:#f9f9f9; border-radius:8px">
                    ${logsHtml}
                </div>
            </div>

            <div class="modal-actions" style="margin-top:2rem">
                <button type="button" class="btn-del" id="archive-project" style="background:#f1f5f9; color:#475569">結案 (隱藏)</button>
                <button type="button" class="btn-primary" id="update-proj-schedule" style="flex:2">更新時程</button>
            </div>
        `;

        document.getElementById('close-proj-modal')?.addEventListener('click', () => modal.classList.add('hidden'));

        document.getElementById('archive-project')?.addEventListener('click', async () => {
            if (!confirm('將專案存檔(結案)後將不再顯示於儀表板，確定嗎？')) return;
            try {
                const res = await fetch(`${API_URL}/projects/${project.id}/archive`, { method: 'PATCH' });
                if (!res.ok) throw new Error('結案失敗');
                modal.classList.add('hidden');
                await this.loadProjectSummary();
                await this.loadAllProjectsGantt();
            } catch (err) { alert((err as Error).message); }
        });

        document.getElementById('update-proj-schedule')?.addEventListener('click', async () => {
            const endDate = (document.getElementById('edit-p-end') as HTMLInputElement).value;
            const reason = (document.getElementById('edit-p-reason') as HTMLTextAreaElement).value;

            if (!reason.trim()) {
                alert('請輸入變更理由');
                return;
            }

            try {
                const res = await fetch(`${API_URL}/projects/${project.id}/schedule`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_end_date: new Date(endDate).toISOString(), reason })
                });
                if (!res.ok) throw new Error('更新失敗');
                modal.classList.add('hidden');
                await this.loadProjectSummary();
                await this.loadAllProjectsGantt();
            } catch (err) { alert((err as Error).message); }
        });
    }

    refreshGantt() {
        const items = this.getCurrentGanttItems();
        let viewStart = startOfDay(new Date());
        let viewEnd = addDays(viewStart, 30);

        if (items.length > 0) {
            const allStarts = items.map(i => i.startDate.getTime());
            const allEnds = items.map(i => i.endDate.getTime());
            const earliestStart = new Date(Math.min(...allStarts));
            const latestEnd = new Date(Math.max(...allEnds));
            viewStart = startOfDay(addDays(earliestStart, -1));
            viewEnd = addDays(latestEnd, 3);
        }

        this.renderer.render(items, viewStart, viewEnd);
    }

    getCurrentGanttItems(): GanttItem[] {
        const items: GanttItem[] = [];

        // Recursive helper to count all tasks (including nested)
        const countTasks = (tasks: any[]): { total: number, completed: number } => {
            let total = 0, completed = 0;
            tasks.forEach((t: any) => {
                total++;
                if (t.status === 'completed') completed++;
                if (t.children && t.children.length > 0) {
                    const childCounts = countTasks(t.children);
                    total += childCounts.total;
                    completed += childCounts.completed;
                }
            });
            return { total, completed };
        };

        // Recursive helper to flatten task tree into GanttItem[]
        const flattenTasks = (tasks: any[], projectId: number, stageId: number, depth: number) => {
            tasks.forEach((task: any) => {
                const dept = this.departments.find(d => d.name === task.department);
                const children = task.children || [];
                const childCounts = countTasks(children);
                const hasChildren = children.length > 0;

                items.push({
                    id: task.id,
                    name: task.name,
                    startDate: new Date(task.start_date),
                    endDate: new Date(task.end_date),
                    progress: task.status === 'completed' ? 100 : 0,
                    status: task.status,
                    type: 'task',
                    projectId,
                    stageId,
                    parentTaskId: task.parent_task_id || undefined,
                    depth,
                    hasChildren,
                    department: task.department,
                    color: dept ? dept.color : '#6b7280',
                    completionLabel: hasChildren ? `${childCounts.completed}/${childCounts.total}` : undefined
                });

                // Recursively add children
                if (hasChildren) {
                    flattenTasks(children, projectId, stageId, depth + 1);
                }
            });
        };

        [...this.allProjectsData]
            .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime())
            .filter(p => this.currentProjectId === null || p.id === this.currentProjectId)
            .forEach(project => {
                const stages = project.stages || [];

                // Project-level stats (recursive)
                let totalTasks = 0, completedTasks = 0;
                stages.forEach((s: any) => {
                    const tasks = s.tasks || [];
                    const counts = countTasks(tasks);
                    totalTasks += counts.total;
                    completedTasks += counts.completed;
                });
                const projectCompleted = totalTasks > 0 && completedTasks === totalTasks;

                // Project start/end from stages
                const allDates = stages.flatMap((s: any) => [new Date(s.start_date).getTime(), new Date(s.end_date).getTime()]);
                const projStart = allDates.length > 0 ? new Date(Math.min(...allDates)) : new Date();
                const projEnd = allDates.length > 0 ? new Date(Math.max(...allDates)) : addDays(new Date(), 30);

                items.push({
                    id: project.id,
                    name: project.name,
                    startDate: projStart,
                    endDate: projEnd,
                    progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
                    stageCompleted: projectCompleted,
                    type: 'project',
                    color: '#1e293b',
                    completionLabel: `${completedTasks}/${totalTasks}`
                });

                stages.forEach((stage: any) => {
                    const stageStart = new Date(stage.start_date);
                    const stageEnd = new Date(stage.end_date);
                    const tasks = stage.tasks || [];
                    const stageCounts = countTasks(tasks);
                    const stageCompleted = stageCounts.total > 0 && stageCounts.completed === stageCounts.total;
                    const stageProgress = stageCounts.total > 0 ? Math.round((stageCounts.completed / stageCounts.total) * 100) : 0;

                    items.push({
                        id: stage.id,
                        name: stage.name,
                        startDate: stageStart,
                        endDate: stageEnd,
                        progress: stageProgress,
                        stageCompleted,
                        type: 'stage',
                        color: 'var(--accent)',
                        projectId: project.id,
                        completionLabel: stageCounts.total > 0 ? `${stageCounts.completed}/${stageCounts.total}` : ''
                    });

                    // Recursively flatten task tree
                    flattenTasks(tasks, project.id, stage.id, 0);
                });
            });
        return items;
    }

    async renderAnnouncements() {
        const container = document.getElementById('announcements-container');
        if (!container) return;
        try {
            const res = await fetch(`${API_URL}/announcements`);
            const announcements = await res.json();

            const addBtn = this.isEditMode ? `<button class="btn-add-announcement" id="btn-add-ann">+ 新增公告</button>` : '';

            if (announcements.length === 0) {
                container.innerHTML = `
                    <div class="task-detail-container">
                        <div class="ann-header">
                            <h2>📢 公告欄</h2>
                            ${addBtn}
                        </div>
                        <div class="ann-empty">目前沒有公告</div>
                    </div>`;
            } else {
                container.innerHTML = `
                    <div class="task-detail-container">
                        <div class="ann-header">
                            <h2>📢 公告欄</h2>
                            ${addBtn}
                        </div>
                        <div class="ann-cards">
                            ${announcements.map((a: any) => `
                                <div class="ann-card ${a.pinned ? 'pinned' : ''}">
                                    ${this.isEditMode ? `
                                        <div class="ann-actions">
                                            <button class="ann-pin-btn" data-ann-id="${a.id}" data-pinned="${a.pinned}" title="${a.pinned ? '取消置頂' : '置頂'}">${a.pinned ? '📌' : '📍'}</button>
                                            <button class="ann-del-btn" data-ann-id="${a.id}" title="刪除">🗑</button>
                                        </div>
                                    ` : ''}
                                    ${a.pinned ? '<span class="ann-pin-badge">📌 置頂</span>' : ''}
                                    ${a.department ? `<div class="ann-dept">${a.department}</div>` : ''}
                                    <h3>${a.title}</h3>
                                    <p>${a.content || ''}</p>
                                    <div class="ann-time">${new Date(a.created_at).toLocaleString('zh-TW')}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
            }

            // Add button handler
            document.getElementById('btn-add-ann')?.addEventListener('click', () => {
                this.showAnnouncementForm();
            });

            // Pin/Delete handlers
            container.querySelectorAll('.ann-pin-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = (btn as HTMLElement).dataset.annId;
                    const currentPinned = (btn as HTMLElement).dataset.pinned === '1';
                    await fetch(`${API_URL}/announcements/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pinned: !currentPinned })
                    });
                    this.renderAnnouncements();
                });
            });

            container.querySelectorAll('.ann-del-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = (btn as HTMLElement).dataset.annId;
                    if (confirm('確定刪除此公告？')) {
                        await fetch(`${API_URL}/announcements/${id}`, { method: 'DELETE' });
                        this.renderAnnouncements();
                    }
                });
            });
        } catch (err) {
            console.error('Announcements load error:', err);
            container.innerHTML = '<div class="ann-empty">載入公告時發生錯誤</div>';
        }
    }

    showAnnouncementForm(existing?: any) {
        const overlay = document.getElementById('modal-overlay')!;
        const content = document.getElementById('modal-content')!;

        const deptOptions = this.departments.map(d =>
            `<option value="${d.name}" ${existing?.department === d.name ? 'selected' : ''}>${d.name}</option>`
        ).join('');

        content.innerHTML = `
            <h2>${existing ? '編輯公告' : '新增公告'}</h2>
            <form id="ann-form" style="display:flex;flex-direction:column;gap:12px;margin-top:16px;">
                <label style="font-size:0.95rem;font-weight:600;color:var(--text-muted);">
                    部門
                    <select id="ann-dept" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;margin-top:4px;font-size:1rem;">
                        <option value="">全體</option>
                        ${deptOptions}
                    </select>
                </label>
                <label style="font-size:0.95rem;font-weight:600;color:var(--text-muted);">
                    標題 *
                    <input type="text" id="ann-title" value="${existing?.title || ''}" required 
                        style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;margin-top:4px;font-size:1rem;box-sizing:border-box;">
                </label>
                <label style="font-size:0.95rem;font-weight:600;color:var(--text-muted);">
                    內容
                    <textarea id="ann-content" rows="4" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:6px;margin-top:4px;font-size:1rem;resize:vertical;box-sizing:border-box;">${existing?.content || ''}</textarea>
                </label>
                <label style="display:flex;align-items:center;gap:8px;font-size:1rem;">
                    <input type="checkbox" id="ann-pinned" ${existing?.pinned ? 'checked' : ''}>
                    📌 置頂此公告
                </label>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
                    <button type="button" id="ann-cancel" class="btn-secondary" style="padding:8px 16px;border:1px solid var(--border);border-radius:6px;background:white;cursor:pointer;">取消</button>
                    <button type="submit" class="btn-primary" style="padding:8px 16px;border:none;border-radius:6px;background:var(--accent);color:white;cursor:pointer;font-weight:600;">送出</button>
                </div>
            </form>
        `;
        overlay.classList.remove('hidden');

        document.getElementById('ann-cancel')?.addEventListener('click', () => {
            overlay.classList.add('hidden');
        });

        document.getElementById('ann-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = (document.getElementById('ann-title') as HTMLInputElement).value.trim();
            const contentVal = (document.getElementById('ann-content') as HTMLTextAreaElement).value.trim();
            const department = (document.getElementById('ann-dept') as HTMLSelectElement).value;
            const pinned = (document.getElementById('ann-pinned') as HTMLInputElement).checked;

            if (!title) { alert('請輸入標題'); return; }

            const payload = { user_id: this.currentUserId, title, content: contentVal, department, pinned };

            if (existing) {
                await fetch(`${API_URL}/announcements/${existing.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                await fetch(`${API_URL}/announcements`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }
            overlay.classList.add('hidden');
            this.renderAnnouncements();
        });
    }

    async renderTodayTodos() {
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

    async renderKanbanBoard() {
        // 1. Always render the list at the top (today-container)
        await this.renderTodayTodos();

        // 2. Update the top toggle button
        const toggleBtn = document.getElementById('kanban-gantt-toggle');
        if (toggleBtn) {
            toggleBtn.style.display = '';
            if (this.todayViewMode === 'kanban') {
                toggleBtn.textContent = '📊 甘特圖模式';
            } else {
                toggleBtn.textContent = '📋 看板模式';
            }
        }

        // 3. Toggle the bottom area: gantt chart vs kanban board
        const ganttChart = document.getElementById('gantt-chart');
        if (!ganttChart) return;

        if (this.todayViewMode === 'kanban') {
            // Hide toolbar, show kanban in gantt area
            const toolbar = document.querySelector('.toolbar') as HTMLElement;
            if (toolbar) toolbar.style.display = 'none';

            if (!this.kanbanView) {
                this.kanbanView = new KanbanView();
            }
            await this.kanbanView.render(ganttChart, () => {
                // Refresh gantt data after drag
                this.loadAllProjectsGantt();
            });
        } else {
            // Show toolbar and restore gantt chart
            this.showGanttChart();
        }
    }

    private showGanttChart() {
        const toolbar = document.querySelector('.toolbar') as HTMLElement;
        if (toolbar) toolbar.style.display = '';

        // Restore the gantt container HTML structure if it was replaced by kanban
        const ganttChart = document.getElementById('gantt-chart');
        if (ganttChart) {
            const hasGanttStructure = ganttChart.querySelector('#gantt-time-scale');
            if (!hasGanttStructure) {
                ganttChart.innerHTML = `
                    <div class="gantt-header-sticky" id="gantt-time-scale"></div>
                    <div class="gantt-body" id="gantt-rows"></div>
                `;
                // Re-initialize the renderer since the DOM was destroyed
                this.renderer = new GanttRenderer('gantt-chart', 'day');
            }
        }

        // Show all projects in gantt chart
        this.currentProjectId = null;
        this.loadAllProjectsGantt();
    }

    async renderDelayDetails() {
        const container = document.getElementById('delay-container');
        if (!container) return;
        try {
            const res = await fetch(`${API_URL}/tasks/delayed`);
            const tasks = await res.json();

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

    setupEventListeners() {
        // Main Tab Switching
        document.querySelectorAll('.main-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = (tab as HTMLElement).dataset.tab!;
                this.activeTab = tabId;
                document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(`tab-${tabId}`)?.classList.add('active');

                // Show/hide kanban toggle — only on today tab
                const toggleBtn = document.getElementById('kanban-gantt-toggle');
                if (toggleBtn) {
                    toggleBtn.style.display = tabId === 'today' ? '' : 'none';
                }

                // When leaving today tab in kanban mode, restore gantt chart
                if (tabId !== 'today' && this.todayViewMode === 'kanban') {
                    this.showGanttChart();
                }

                // Load data for the selected tab
                if (tabId === 'today') {
                    this.renderAnnouncements();
                    this.renderKanbanBoard();
                }
                if (tabId === 'delay') this.renderDelayDetails();
                if (tabId === 'projects') this.loadAllProjectsGantt();
            });
        });

        // Kanban/Gantt toggle button handler
        const kanbanToggle = document.getElementById('kanban-gantt-toggle');
        if (kanbanToggle) {
            kanbanToggle.addEventListener('click', () => {
                if (this.todayViewMode === 'kanban') {
                    this.todayViewMode = 'gantt';
                } else {
                    this.todayViewMode = 'kanban';
                }
                this.renderKanbanBoard();
            });
        }

        // === Gantt Resizer (drag to adjust card/gantt split) ===
        const ganttResizer = document.getElementById('gantt-resizer');
        if (ganttResizer) {
            let startY = 0;
            let startMaxH = 220;

            const getActiveTabContent = () => document.querySelector('.tab-content.active') as HTMLElement | null;

            const onMouseMove = (e: MouseEvent) => {
                const delta = e.clientY - startY;
                const newMaxH = Math.min(500, Math.max(60, startMaxH + delta));
                const tc = getActiveTabContent();
                if (tc) tc.style.maxHeight = `${newMaxH}px`;
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                document.body.classList.remove('resizing');
                ganttResizer.classList.remove('active');
            };

            ganttResizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                startY = e.clientY;
                const tc = getActiveTabContent();
                startMaxH = tc ? tc.offsetHeight : 220;
                document.body.classList.add('resizing');
                ganttResizer.classList.add('active');
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        document.getElementById('new-project-btn')?.addEventListener('click', () => {
            if (!this.isEditMode) return;
            this.showModal();
        });
        document.getElementById('import-project-btn')?.addEventListener('click', () => {
            this.showImportModal();
        });
        document.getElementById('settings-btn')?.addEventListener('click', () => {
            if (!this.isEditMode) return;
            this.showSettings();
        });

        const editToggle = document.getElementById('edit-mode-check') as HTMLInputElement;
        const toggleLabel = editToggle.closest('.toggle-group')?.querySelector('.toggle-label');

        editToggle.addEventListener('change', async () => {
            if (editToggle.checked) {
                const pass = prompt('請輸入密碼：');
                if (!pass) { editToggle.checked = false; return; }
                try {
                    const res = await fetch(`${API_URL}/verify-password`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: pass })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        this.isEditMode = true;
                        this.isAdminMode = data.role === 'admin';
                        document.body.classList.add('is-editing');
                        if (this.isAdminMode) {
                            document.body.classList.add('is-admin');
                            if (toggleLabel) toggleLabel.textContent = '🛡️ 管理員模式';
                        } else {
                            if (toggleLabel) toggleLabel.textContent = '🔓 編輯模式';
                        }
                        this.interaction.setEnabled(true);
                        // Reload data
                        this.loadAllProjectsGantt();
                        this.loadProjectSummary();
                        // Re-render today tab content if active
                        if (this.activeTab === 'today') {
                            this.renderAnnouncements();
                            this.renderKanbanBoard();
                        }
                    } else {
                        alert('密碼錯誤！');
                        editToggle.checked = false;
                    }
                } catch {
                    alert('無法驗證密碼，請確認伺服器是否正常運行');
                    editToggle.checked = false;
                }
            } else {
                this.isEditMode = false;
                this.isAdminMode = false;
                document.body.classList.remove('is-editing', 'is-admin');
                if (toggleLabel) toggleLabel.textContent = '🔒 唯讀模式';
                this.interaction.setEnabled(false);
                // Reload data to hide archived projects
                this.loadAllProjectsGantt();
                this.loadProjectSummary();
                // Re-render today tab content if active
                if (this.activeTab === 'today') {
                    this.renderAnnouncements();
                    this.renderKanbanBoard();
                }
            }
        });

        // Time scale switcher
        document.getElementById('view-controls')?.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('button');
            if (!btn || !btn.dataset.scale) return;
            const scale = btn.dataset.scale as any;
            this.renderer.setScale(scale);
            document.querySelectorAll('#view-controls button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.refreshGantt();
        });

        // Global Levels
        document.getElementById('level-1-btn')?.addEventListener('click', () => {
            const items = this.getCurrentGanttItems();
            this.renderer.expandToLevel(1, items);
            this.refreshGantt();
        });

        document.getElementById('level-2-btn')?.addEventListener('click', () => {
            const items = this.getCurrentGanttItems();
            this.renderer.expandToLevel(2, items);
            this.refreshGantt();
        });

        document.getElementById('level-3-btn')?.addEventListener('click', () => {
            const items = this.getCurrentGanttItems();
            this.renderer.expandToLevel(3, items);
            this.refreshGantt();
        });

        // Level 4: All expanded
        document.getElementById('level-4-btn')?.addEventListener('click', () => {
            const items = this.getCurrentGanttItems();
            this.renderer.expandToLevel(4, items);
            this.refreshGantt();
        });

        // Click handlers for Gantt rows (Collapse, Add, Edit)
        document.getElementById('gantt-rows')?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // Project collapse
            if (target.dataset.toggleProject) {
                const pid = parseInt(target.dataset.toggleProject);
                this.renderer.toggleProject(pid);
                this.refreshGantt();
                return;
            }
            // Stage collapse
            if (target.dataset.toggleStage) {
                const sid = parseInt(target.dataset.toggleStage);
                this.renderer.toggleStage(sid);
                this.refreshGantt();
                return;
            }
            // Task collapse toggle
            if (target.dataset.toggleTask) {
                const tid = parseInt(target.dataset.toggleTask);
                this.renderer.toggleTask(tid);
                this.refreshGantt();
                return;
            }
            // Add sub-item (Project -> Add Stage, Stage -> Add Task, Task -> Add Child Task)
            if (target.classList.contains('add-sub-btn')) {
                if (!this.isEditMode) return;
                const type = target.dataset.type;

                if (type === 'stage') {
                    const projectId = parseInt(target.dataset.projectId!);
                    this.showAddStageModal(projectId);
                } else if (type === 'task') {
                    const stageId = parseInt(target.dataset.stageId!);
                    const stageName = target.dataset.stageName!;
                    for (const proj of this.allProjectsData) {
                        const stage = (proj.stages || []).find((s: any) => s.id === stageId);
                        if (stage) {
                            this.showSubTaskModal(stageId, stageName, new Date(stage.start_date), new Date(stage.end_date));
                            break;
                        }
                    }
                } else if (type === 'child-task') {
                    const parentTaskId = parseInt(target.dataset.taskId!);
                    const stageId = parseInt(target.dataset.stageId!);
                    // Find parent task data recursively
                    const parentTask = this.findTaskById(parentTaskId);
                    if (parentTask) {
                        this.showSubTaskModal(
                            stageId,
                            parentTask.name,
                            new Date(parentTask.start_date),
                            new Date(parentTask.end_date),
                            undefined,
                            parentTaskId
                        );
                    }
                }
                return;
            }

            // Edit sub-task (click on bar or row name)
            if (target.classList.contains('task-checkbox') || target.closest('.task-checkbox')) return;
            if (target.classList.contains('add-sub-btn') || target.closest('.add-sub-btn')) return;

            const taskBar = target.closest('.gantt-bar.task') as HTMLElement;
            const rowLabel = target.closest('.row-label') as HTMLElement;
            const rowName = target.closest('.row-name') as HTMLElement;

            let taskId: number | null = null;
            if (taskBar) {
                taskId = parseInt(taskBar.dataset.id!);
            } else if (rowName || rowLabel) {
                const row = (rowName || rowLabel).closest('.gantt-row.row-task') as HTMLElement;
                const bar = row?.querySelector('.gantt-bar.task') as HTMLElement;
                if (bar) taskId = parseInt(bar.dataset.id!);
            }

            if (taskId !== null && !isNaN(taskId)) {
                if (!this.isEditMode) return;
                console.log('Editing Task ID:', taskId);
                const task = this.findTaskById(taskId);
                if (task) {
                    console.log('Found Task:', task.name);
                    // Find the constraining parent (parent_task or stage)
                    let constraintStart: Date, constraintEnd: Date, constraintName: string;
                    if (task.parent_task_id) {
                        const parentTask = this.findTaskById(task.parent_task_id);
                        if (parentTask) {
                            constraintStart = new Date(parentTask.start_date);
                            constraintEnd = new Date(parentTask.end_date);
                            constraintName = parentTask.name;
                        } else {
                            // Fallback to stage
                            const stageInfo = this.findStageById(task.stage_id);
                            constraintStart = new Date(stageInfo.start_date);
                            constraintEnd = new Date(stageInfo.end_date);
                            constraintName = stageInfo.name;
                        }
                    } else {
                        const stageInfo = this.findStageById(task.stage_id);
                        constraintStart = new Date(stageInfo.start_date);
                        constraintEnd = new Date(stageInfo.end_date);
                        constraintName = stageInfo.name;
                    }
                    this.showSubTaskModal(task.stage_id, constraintName, constraintStart, constraintEnd, task, task.parent_task_id || undefined);
                    return;
                }
                console.warn('Task data not found for ID:', taskId);
            }
        });

        // Sub-task completion checkbox
        document.getElementById('gantt-rows')?.addEventListener('change', async (e) => {
            const target = e.target as HTMLInputElement;
            if (target.classList.contains('task-checkbox')) {
                const taskId = parseInt(target.dataset.taskId!);
                const newStatus = target.checked ? 'completed' : 'pending';
                try {
                    await fetch(`${API_URL}/sub-tasks/${taskId}/complete`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: newStatus })
                    });
                    await this.loadAllProjectsGantt();
                    await this.loadProjectSummary();
                } catch (err) {
                    console.error('Completion toggle error:', err);
                }
            }
        });
    }

    showImportModal() {
        const modal = document.getElementById('modal-overlay')!;
        const content = document.getElementById('modal-content')!;
        modal.classList.remove('hidden');

        const today = format(new Date(), 'yyyy-MM-dd');

        content.innerHTML = `
            <h2 style="margin-top:0;color:var(--text-primary)">📥 匯入專案模板</h2>
            <form id="import-form">
                <div class="form-group">
                    <label>選擇 JSON 模板檔案</label>
                    <input type="file" id="import-file" accept=".json" required style="padding:8px;border:1px dashed var(--border);border-radius:8px;background:var(--bg-secondary)">
                </div>
                <div id="import-preview" style="display:none;margin:12px 0;padding:10px;background:var(--bg-secondary);border-radius:8px;font-size:0.85rem">
                </div>
                <div class="form-group">
                    <label>新專案名稱</label>
                    <input type="text" id="import-name" required placeholder="輸入新專案名稱">
                </div>
                <div class="form-group">
                    <label>起始日期</label>
                    <input type="date" id="import-start" required value="${today}">
                </div>
                <div class="modal-actions" style="display:flex;gap:8px;margin-top:16px">
                    <button type="submit" class="btn-submit" style="flex:1">匯入建立</button>
                    <button type="button" id="close-import" class="btn-cancel" style="flex:1">取消</button>
                </div>
            </form>
        `;

        const fileInput = document.getElementById('import-file') as HTMLInputElement;
        const preview = document.getElementById('import-preview')!;
        let templateData: any = null;

        fileInput.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    templateData = JSON.parse(e.target?.result as string);
                    if (templateData._format !== 'antigravity-gantt-v1') {
                        preview.innerHTML = '<span style="color:#ef4444">❌ 無效的模板格式</span>';
                        preview.style.display = 'block';
                        templateData = null;
                        return;
                    }
                    preview.innerHTML = `
                        <div>✅ 模板載入成功</div>
                        <div>原始專案：<strong>${templateData.name}</strong></div>
                        <div>階段數：${templateData.stages?.length || 0}</div>
                        <div>專案天數：${templateData.totalDays} 天</div>
                    `;
                    preview.style.display = 'block';
                    // Pre-fill name
                    const nameInput = document.getElementById('import-name') as HTMLInputElement;
                    if (nameInput && !nameInput.value) {
                        nameInput.value = templateData.name + ' (副本)';
                    }
                } catch {
                    preview.innerHTML = '<span style="color:#ef4444">❌ JSON 解析失敗</span>';
                    preview.style.display = 'block';
                    templateData = null;
                }
            };
            reader.readAsText(file);
        });

        document.getElementById('close-import')?.addEventListener('click', () => modal.classList.add('hidden'));

        document.getElementById('import-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!templateData) {
                alert('請先選擇有效的 JSON 模板檔案');
                return;
            }

            const name = (document.getElementById('import-name') as HTMLInputElement).value;
            const startDate = (document.getElementById('import-start') as HTMLInputElement).value;

            try {
                const res = await fetch(`${API_URL}/projects/import`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: this.currentUserId,
                        template: templateData,
                        name,
                        start_date: new Date(startDate).toISOString()
                    })
                });

                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || '匯入失敗');
                }

                modal.classList.add('hidden');
                alert('✅ 專案匯入成功！');
                await this.loadAllProjectsGantt();
            } catch (err) {
                alert(`匯入失敗：${(err as Error).message}`);
            }
        });
    }

    async showSettings(initialTab = 'depts') {
        const overlay = document.getElementById('modal-overlay')!;
        const modal = overlay.querySelector('.modal')!;
        const content = document.getElementById('modal-content')!;

        overlay.classList.remove('hidden');
        modal.classList.add('modal-lg');

        const renderDepts = () => {
            if (this.departments.length === 0) return '<p style="color:var(--text-secondary);font-size:0.85rem">尚無部門</p>';
            return this.departments.map(d => `
                <div class="dept-item-wrapper" data-id="${d.id}">
                    <div class="dept-item-content">
                        <div class="dept-color-stripe" style="background: ${d.color}"></div>
                        <div class="dept-details">
                            <h4>${d.name}</h4>
                            <p>${d.tasks.join(', ') || '無預設任務'}</p>
                        </div>
                        <span class="dept-edit-hint">點擊編輯</span>
                    </div>
                    <button class="dept-item-delete" data-id="${d.id}">刪除</button>
                </div>
            `).join('');
        };

        const renderTemplates = () => {
            if (this.stageTemplates.length === 0) return '<p style="color:var(--text-secondary);font-size:0.85rem">尚無範本</p>';
            return this.stageTemplates.map(t => `
                <div class="dept-item-wrapper" data-tmpl-id="${t.id}">
                    <div class="dept-item-content" style="cursor:pointer">
                        <div class="dept-details">
                            <h4>${t.name}</h4>
                            <p>${t.stages.map((s: any) => `${s.name}(${s.days}天)`).join(' → ')}</p>
                        </div>
                        <span class="dept-edit-hint">點擊編輯</span>
                    </div>
                    <button class="dept-item-delete" data-tmpl-id="${t.id}">刪除</button>
                </div>
            `).join('');
        };

        content.innerHTML = `
            <button class="btn-close" id="close-settings-btn">&times;</button>
            <div class="settings-container" style="padding: 1rem 0.5rem">
                <div class="settings-header" style="margin-bottom: 2rem">
                    <h2>系統設定</h2>
                </div>
                
                <div class="settings-tabs">
                    <button class="settings-tab ${initialTab === 'depts' ? 'active' : ''}" data-tab="depts">部門與預設任務</button>
                    <button class="settings-tab ${initialTab === 'templates' ? 'active' : ''}" data-tab="templates">專案階段範本</button>
                    <button class="settings-tab ${initialTab === 'general' ? 'active' : ''}" data-tab="general">一般設定</button>
                </div>

                <!-- Tab: Departments -->
                <div class="settings-tab-panel ${initialTab === 'depts' ? 'active' : ''}" id="tab-depts">
                    <div class="settings-grid">
                        <div class="settings-column">
                            <div class="settings-section">
                                <div class="section-header">
                                    <h3 id="dept-form-title">${this.editingDeptId ? '編輯部門' : '新增部門'}</h3>
                                </div>
                                <div class="dept-form" style="margin-bottom:0">
                                    <div class="form-group">
                                        <label>部門名稱</label>
                                        <input type="text" id="new-dept-name" placeholder="例如：研發部">
                                    </div>
                                    <div class="form-group">
                                        <label>代表顏色</label>
                                        <div class="color-input-wrapper">
                                            <input type="color" id="new-dept-color" value="#3b82f6">
                                        </div>
                                    </div>
                                    <div class="form-group">
                                        <label>預設任務 (每行一個)</label>
                                        <textarea id="new-dept-tasks" placeholder="任務 A\n任務 B" rows="5"></textarea>
                                    </div>
                                    <div style="display:flex;gap:12px;margin-top:8px">
                                        <button class="btn-primary" id="save-dept-btn" style="flex:1">儲存部門</button>
                                        <button class="btn-secondary" id="cancel-dept-btn" style="display:${this.editingDeptId ? 'inline-flex' : 'none'}">取消</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="settings-column">
                            <div class="settings-section">
                                <div class="section-header">
                                    <h3>現有部門列表</h3>
                                </div>
                                <div class="dept-items">${renderDepts()}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tab: Templates -->
                <div class="settings-tab-panel ${initialTab === 'templates' ? 'active' : ''}" id="tab-templates">
                    <div class="settings-grid">
                        <div class="settings-column">
                            <div class="settings-section">
                                <div class="section-header">
                                    <h3 id="tmpl-form-title">${this.editingTemplateId ? '編輯階段範本' : '新增階段範本'}</h3>
                                </div>
                                <div id="tmpl-form-wrapper" class="dept-form" style="margin-bottom:0">
                                    <div class="form-group">
                                        <label>範本名稱</label>
                                        <input type="text" id="tmpl-name-input" placeholder="例如：標準開發流程">
                                    </div>
                                    <div class="form-group">
                                        <label>階段設定</label>
                                        <div id="tmpl-stages-container"></div>
                                        <button type="button" id="add-tmpl-stage-row" class="btn-tool" style="margin-top:8px;width:100%">＋ 新增階段</button>
                                    </div>
                                    <div style="display:flex;gap:12px;margin-top:16px">
                                        <button class="btn-primary" id="save-tmpl-btn" style="flex:1">儲存範本</button>
                                        <button class="btn-secondary" id="cancel-tmpl-btn" style="display:${this.editingTemplateId ? 'inline-flex' : 'none'}">取消</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="settings-column">
                            <div class="settings-section">
                                <div class="section-header">
                                    <h3>現有範本列表</h3>
                                </div>
                                <div id="tmpl-items" class="dept-items">${renderTemplates()}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tab: General (Placeholder) -->
                <div class="settings-tab-panel ${initialTab === 'general' ? 'active' : ''}" id="tab-general">
                    <div class="settings-section">
                        <div class="section-header"><h3>一般設定</h3></div>
                        <p style="color:var(--text-secondary); margin-bottom: 1.5rem">這裡將來可以放置使用者權限、公司資訊或其他全域設定。</p>
                        <div class="form-group" style="max-width: 400px">
                            <label>預設語系</label>
                            <select class="premium-select" style="width:100%; border:1px solid var(--border); padding:8px; border-radius:8px">
                                <option>繁體中文 (台灣)</option>
                                <option disabled>English (Coming Soon)</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // === Tab Switching Logic ===
        content.querySelectorAll('.settings-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = (btn as HTMLElement).dataset.tab!;
                content.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tab === target));
                content.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${target}`));

                // Clear state when switching tabs to avoid confusion
                if (target !== 'depts') this.editingDeptId = null;
                if (target !== 'templates') this.editingTemplateId = null;
            });
        });

        // === Event Listeners (Commonly Shared or Tab-Specific) ===

        document.getElementById('close-settings-btn')?.addEventListener('click', () => {
            overlay.classList.add('hidden');
            modal.classList.remove('modal-lg');
            this.editingDeptId = null;
            this.editingTemplateId = null;
        });

        // --- Department Handlers ---
        const cancelDeptEdit = () => {
            this.editingDeptId = null;
            this.showSettings('depts');
        };

        document.getElementById('cancel-dept-btn')?.addEventListener('click', cancelDeptEdit);

        if (this.editingDeptId) {
            const dept = this.departments.find(d => d.id === this.editingDeptId);
            if (dept) {
                (document.getElementById('new-dept-name') as HTMLInputElement).value = dept.name;
                (document.getElementById('new-dept-color') as HTMLInputElement).value = dept.color;
                (document.getElementById('new-dept-tasks') as HTMLTextAreaElement).value = dept.tasks.join('\n');
            }
        }

        document.getElementById('save-dept-btn')?.addEventListener('click', async () => {
            const name = (document.getElementById('new-dept-name') as HTMLInputElement).value.trim();
            const color = (document.getElementById('new-dept-color') as HTMLInputElement).value;
            const tasks = (document.getElementById('new-dept-tasks') as HTMLTextAreaElement).value.split('\n').map(t => t.trim()).filter(t => t);

            if (!name) return alert('請輸入部門名稱');

            try {
                const url = this.editingDeptId ? `${API_URL}/departments/${this.editingDeptId}` : `${API_URL}/departments`;
                const method = this.editingDeptId ? 'PATCH' : 'POST';
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, color, tasks })
                });

                if (!res.ok) throw new Error('儲存部門失敗');
                this.editingDeptId = null;
                await this.loadDepartments();
                this.showSettings('depts');
                this.refreshGantt();
            } catch (err) { alert((err as Error).message); }
        });

        // --- Template Handlers ---
        const tmplContainer = document.getElementById('tmpl-stages-container')!;
        const buildTmplStageRow = (name = '', days = 7) => {
            const div = document.createElement('div');
            div.className = 'stage-field';
            div.style.marginBottom = '8px';
            div.innerHTML = `
                <input type="text" value="${name}" placeholder="階段名稱" class="stage-name-input" style="flex:2">
                <input type="number" value="${days}" class="stage-days-input" min="1" style="flex:1">
                <span style="font-size:0.8rem;color:var(--text-secondary)">天</span>
                <button type="button" class="btn-remove-stage" title="移除">✕</button>
            `;
            return div;
        };

        if (this.editingTemplateId) {
            const tmpl = this.stageTemplates.find(t => t.id === this.editingTemplateId);
            if (tmpl) {
                (document.getElementById('tmpl-name-input') as HTMLInputElement).value = tmpl.name;
                tmpl.stages.forEach((s: any) => tmplContainer.appendChild(buildTmplStageRow(s.name, s.days)));
            }
        } else if (tmplContainer) {
            tmplContainer.appendChild(buildTmplStageRow());
        }

        document.getElementById('add-tmpl-stage-row')?.addEventListener('click', () => tmplContainer.appendChild(buildTmplStageRow()));

        tmplContainer?.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.btn-remove-stage');
            if (btn && tmplContainer.querySelectorAll('.stage-field').length > 1) {
                btn.closest('.stage-field')?.remove();
            } else if (btn) {
                alert('至少需保留一個階段');
            }
        });

        document.getElementById('save-tmpl-btn')?.addEventListener('click', async () => {
            const tmplName = (document.getElementById('tmpl-name-input') as HTMLInputElement).value.trim();
            if (!tmplName) return alert('請輸入範本名稱');

            const stages: any[] = [];
            tmplContainer.querySelectorAll('.stage-field').forEach(field => {
                const n = (field.querySelector('.stage-name-input') as HTMLInputElement).value.trim();
                const d = parseInt((field.querySelector('.stage-days-input') as HTMLInputElement).value) || 1;
                if (n) stages.push({ name: n, days: d });
            });
            if (stages.length === 0) return alert('請至少新增一個階段');

            try {
                const url = this.editingTemplateId ? `${API_URL}/stage-templates/${this.editingTemplateId}` : `${API_URL}/stage-templates`;
                const method = this.editingTemplateId ? 'PUT' : 'POST';
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: tmplName, stages })
                });
                if (!res.ok) throw new Error('儲存範本失敗');
                this.editingTemplateId = null;
                await this.loadStageTemplates();
                this.showSettings('templates');
            } catch (err) { alert((err as Error).message); }
        });

        document.getElementById('cancel-tmpl-btn')?.addEventListener('click', () => {
            this.editingTemplateId = null;
            this.showSettings('templates');
        });

        // Edit/Delete handlers for both tabs
        content.querySelectorAll('.dept-item-content').forEach(item => {
            item.addEventListener('click', () => {
                const wrapper = item.closest('.dept-item-wrapper') as HTMLElement;
                if (wrapper.dataset.id) {
                    this.editingDeptId = parseInt(wrapper.dataset.id!);
                    this.showSettings('depts');
                } else if (wrapper.dataset.tmplId) {
                    this.editingTemplateId = parseInt(wrapper.dataset.tmplId!);
                    this.showSettings('templates');
                }
            });
        });

        content.querySelectorAll('.dept-item-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const wrapper = (e.currentTarget as HTMLElement).closest('.dept-item-wrapper') as HTMLElement;
                const id = wrapper.dataset.id || wrapper.dataset.tmplId;
                const isTmpl = !!wrapper.dataset.tmplId;
                if (!confirm(`確定要刪除此${isTmpl ? '範本' : '部門'}嗎？`)) return;

                try {
                    const url = isTmpl ? `${API_URL}/stage-templates/${id}` : `${API_URL}/departments/${id}`;
                    const res = await fetch(url, { method: 'DELETE' });
                    if (!res.ok) throw new Error('刪除失敗');
                    if (isTmpl) await this.loadStageTemplates();
                    else await this.loadDepartments();
                    this.showSettings(isTmpl ? 'templates' : 'depts');
                } catch (err) { alert((err as Error).message); }
            });
        });
    }


    // Recursively find a task by ID in the allProjectsData tree
    private findTaskById(taskId: number): any | null {
        const searchTasks = (tasks: any[]): any | null => {
            for (const task of tasks) {
                if (task.id === taskId) return task;
                if (task.children && task.children.length > 0) {
                    const found = searchTasks(task.children);
                    if (found) return found;
                }
            }
            return null;
        };
        for (const proj of this.allProjectsData) {
            for (const stage of proj.stages || []) {
                const found = searchTasks(stage.tasks || []);
                if (found) return found;
            }
        }
        return null;
    }

    // Find a stage by ID
    private findStageById(stageId: number): any {
        for (const proj of this.allProjectsData) {
            for (const stage of proj.stages || []) {
                if (stage.id === stageId) return stage;
            }
        }
        return { name: '未知', start_date: new Date().toISOString(), end_date: new Date().toISOString() };
    }

    showAddStageModal(projectId: number) {
        const overlay = document.getElementById('modal-overlay')!;
        const content = document.getElementById('modal-content')!;
        overlay.classList.remove('hidden');

        content.innerHTML = `
            <div class="modal-header">
                <h2>新增階段 (Stage)</h2>
            </div>
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
            </div>
        `;

        const close = () => overlay.classList.add('hidden');
        document.getElementById('cancel-add-stage')?.addEventListener('click', close);
        document.getElementById('confirm-add-stage')?.addEventListener('click', async () => {
            const name = (document.getElementById('new-stage-name') as HTMLInputElement).value.trim();
            const days = parseInt((document.getElementById('new-stage-days') as HTMLInputElement).value);

            if (!name) return alert('請輸入階段名稱');

            const project = this.allProjectsData.find(p => p.id === projectId);
            let startDate = new Date();
            if (project && project.stages && project.stages.length > 0) {
                const lastStage = project.stages[project.stages.length - 1];
                startDate = new Date(lastStage.end_date);
            }
            const endDate = addDays(startDate, days);

            try {
                const res = await fetch(`${API_URL}/stages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        project_id: projectId,
                        name,
                        start_date: startDate.toISOString(),
                        end_date: endDate.toISOString(),
                        order: (project?.stages?.length || 0) + 1
                    })
                });

                if (!res.ok) throw new Error('儲存失敗');

                close();
                await this.loadAllProjectsGantt();
            } catch (err) {
                alert('階段儲存出錯！');
            }
        });
    }

    private showSubTaskModal(stageId: number, constraintName: string, constraintStart: Date, constraintEnd: Date, existingTask?: any, parentTaskId?: number) {
        const modal = document.getElementById('modal-overlay')!;
        const content = document.getElementById('modal-content')!;
        modal.classList.remove('hidden');

        const title = existingTask ? '編輯子任務' : (parentTaskId ? '新增子任務（巢狀）' : '新增子任務');
        const submitBtnText = existingTask ? '完成更新' : '新增';

        const minDate = format(constraintStart, "yyyy-MM-dd'T'HH:mm");
        const maxDate = format(constraintEnd, "yyyy-MM-dd'T'HH:mm");
        const constraintRange = `${format(constraintStart, 'M/d HH:mm')} ~ ${format(constraintEnd, 'M/d HH:mm')}`;

        const defaultStart = existingTask ? format(new Date(existingTask.start_date), "yyyy-MM-dd'T'HH:mm") : minDate;
        const defaultEnd = existingTask ? format(new Date(existingTask.end_date), "yyyy-MM-dd'T'HH:mm") : maxDate;

        const deptOptions = this.departments.map(d => `<option value="${d.name}" ${existingTask && existingTask.department === d.name ? 'selected' : ''}>${d.name}</option>`).join('');

        content.innerHTML = `
            <button class="btn-close" id="close-modal-btn">&times;</button>
            <h3>${title}</h3>
            <p class="modal-subtitle">${parentTaskId ? '父任務' : '階段'}：${constraintName}</p>
            <p class="modal-range-hint">可用範圍：${constraintRange}</p>
            <form id="add-sub-form">
                <div class="form-row">
                    <div class="form-group" style="flex:1">
                        <label>負責部門</label>
                        <select id="sub-dept" required>
                            <option value="">請選擇部門</option>
                            ${deptOptions}
                        </select>
                    </div>
                    <div class="form-group" style="flex:1">
                        <label>子任務名稱</label>
                        <div id="sub-name-wrapper">
                            <select id="sub-name" required ${!existingTask ? 'disabled' : ''}>
                                ${existingTask ? `<option value="${existingTask.name}">${existingTask.name}</option>` : '<option value="">請先選擇部門</option>'}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>起始時間</label>
                        <input type="datetime-local" id="sub-start" value="${defaultStart}" min="${minDate}" max="${maxDate}" required>
                    </div>
                    <div class="form-group">
                        <label>結束時間</label>
                        <input type="datetime-local" id="sub-end" value="${defaultEnd}" min="${minDate}" max="${maxDate}" required>
                    </div>
                </div>
                <div class="modal-actions">
                    ${existingTask ? `<button type="button" class="btn-del" id="delete-task">刪除任務</button>` : ''}
                    <button type="submit" class="btn-primary" style="flex:1">${submitBtnText}</button>
                </div>
            </form>
        `;

        const deptSelect = document.getElementById('sub-dept') as HTMLSelectElement;
        const nameWrapper = document.getElementById('sub-name-wrapper')!;
        let nameSelect = document.getElementById('sub-name') as HTMLSelectElement;
        let isCustomMode = false;

        const switchToCustomInput = () => {
            isCustomMode = true;
            nameWrapper.innerHTML = `
                <div style="display:flex;gap:6px;align-items:center">
                    <input type="text" id="sub-name-custom" placeholder="輸入自訂任務名稱" required style="flex:1">
                    <button type="button" id="back-to-select" class="btn-tool" style="white-space:nowrap;padding:6px 10px;font-size:12px">↩ 選單</button>
                </div>
            `;
            document.getElementById('sub-name-custom')?.focus();
            document.getElementById('back-to-select')?.addEventListener('click', () => {
                isCustomMode = false;
                nameWrapper.innerHTML = `<select id="sub-name" required></select>`;
                nameSelect = document.getElementById('sub-name') as HTMLSelectElement;
                updateTasks();
            });
        };

        const updateTasks = () => {
            if (isCustomMode) return;
            const dept = this.departments.find(d => d.name === deptSelect.value);
            nameSelect = document.getElementById('sub-name') as HTMLSelectElement;
            if (!nameSelect) return;
            if (dept) {
                nameSelect.disabled = false;
                let options = dept.tasks.map((t: string) => `<option value="${t}" ${existingTask && existingTask.name === t ? 'selected' : ''}>${t}</option>`).join('');
                // If the existing task name is NOT in the list, add it
                if (existingTask && !dept.tasks.includes(existingTask.name)) {
                    options += `<option value="${existingTask.name}" selected>${existingTask.name}</option>`;
                }
                // Add custom option
                options += `<option value="__custom__">✏️ 自訂名稱...</option>`;
                nameSelect.innerHTML = options;
            } else {
                nameSelect.disabled = true;
                nameSelect.innerHTML = '<option value="">請先選擇部門</option>';
            }
        };

        deptSelect.addEventListener('change', () => {
            if (isCustomMode) {
                // Reset to select mode when department changes
                isCustomMode = false;
                nameWrapper.innerHTML = `<select id="sub-name" required></select>`;
                nameSelect = document.getElementById('sub-name') as HTMLSelectElement;
            }
            updateTasks();
        });

        // Listen for custom option selection
        nameWrapper.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            if (target.id === 'sub-name' && target.value === '__custom__') {
                switchToCustomInput();
            }
        });

        if (existingTask) updateTasks();

        document.getElementById('close-modal-btn')?.addEventListener('click', () => modal.classList.add('hidden'));

        if (existingTask) {
            document.getElementById('delete-task')?.addEventListener('click', async () => {
                if (!confirm('確定要刪除此子任務嗎？')) return;
                try {
                    const res = await fetch(`${API_URL}/sub-tasks/${existingTask.id}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error('刪除子任務失敗');
                    modal.classList.add('hidden');
                    await this.loadAllProjectsGantt();
                    await this.loadProjectSummary();
                } catch (err) {
                    alert((err as Error).message);
                }
            });
        }

        document.getElementById('add-sub-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            // Read name from custom input or select
            let taskName = '';
            if (isCustomMode) {
                const customInput = document.getElementById('sub-name-custom') as HTMLInputElement;
                taskName = customInput?.value?.trim() || '';
            } else {
                const sel = document.getElementById('sub-name') as HTMLSelectElement;
                taskName = sel?.value || '';
            }
            if (!taskName) {
                alert('請輸入任務名稱');
                return;
            }
            const data: any = {
                stageId,
                name: taskName,
                department: deptSelect.value,
                start_date: new Date((document.getElementById('sub-start') as HTMLInputElement).value).toISOString(),
                end_date: new Date((document.getElementById('sub-end') as HTMLInputElement).value).toISOString()
            };
            // Include parentTaskId for nested sub-tasks
            if (parentTaskId && !existingTask) {
                data.parentTaskId = parentTaskId;
            }

            const url = existingTask ? `${API_URL}/sub-tasks/${existingTask.id}` : `${API_URL}/sub-tasks`;
            const method = existingTask ? 'PATCH' : 'POST';

            try {
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || '儲存失敗');
                }
                modal.classList.add('hidden');
                await this.loadAllProjectsGantt();
                await this.loadProjectSummary();
            } catch (err) {
                alert((err as Error).message);
            }
        });
    }

    showModal() {
        const modal = document.getElementById('modal-overlay');
        const content = document.getElementById('modal-content');
        if (!modal || !content) return;

        const today = format(new Date(), 'yyyy-MM-dd');
        const defaultEnd = format(addDays(new Date(), 30), 'yyyy-MM-dd');

        // Build template options for the select
        const templateOptions = this.stageTemplates.map(t =>
            `<option value="${t.id}">${t.name}</option>`
        ).join('');
        const hasTemplates = this.stageTemplates.length > 0;

        // Stage fields renderer (used for initial render and when switching templates)
        const buildStageFields = (stages: { name: string, days: number }[]) =>
            stages.map(s => `
                <div class="stage-field">
                    <input type="text" value="${s.name}" class="stage-name-input">
                    <input type="number" value="${s.days}" class="stage-days-input" min="1">
                    <span>天</span>
                    <button type="button" class="btn-remove-stage" title="移除此階段">✕</button>
                </div>
            `).join('');

        // Default stages when no template available
        const fallbackStages = [
            { name: '需求確認', days: 3 }, { name: '規格定義', days: 5 },
            { name: '執行', days: 10 }, { name: '測試', days: 5 }, { name: '結案', days: 2 }
        ];
        const initialStages = hasTemplates ? this.stageTemplates[0].stages.map((s: any) => ({ name: s.name, days: s.days })) : fallbackStages;

        content.innerHTML = `
            <button class="btn-close" id="close-new-project">&times;</button>
            <h3>建立新專案</h3>
            <div class="form-group">
                <label>專案名稱</label>
                <input type="text" id="p-name" placeholder="輸入專案名稱">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>專案起始日</label>
                    <input type="date" id="p-start" value="${today}">
                </div>
                <div class="form-group">
                    <label>專案結束日</label>
                    <input type="date" id="p-end" value="${defaultEnd}">
                </div>
            </div>
            <p id="days-summary" class="modal-range-hint"></p>
            <div class="stages-input">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                    <p class="section-title" style="margin:0">設定階段名稱與天數</p>
                    ${hasTemplates ? `
                    <div style="display:flex;align-items:center;gap:8px">
                        <label style="font-size:0.8rem;color:var(--text-secondary)">套用範本：</label>
                        <div class="custom-select" id="template-custom-select">
                            <div class="custom-select-trigger">
                                <span class="custom-select-text">${hasTemplates ? this.stageTemplates[0].name : '──自訂──'}</span>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </div>
                            <div class="custom-options">
                                <div class="custom-option ${!hasTemplates ? 'active' : ''}" data-value="">──自訂──</div>
                                ${this.stageTemplates.map(t => `<div class="custom-option ${hasTemplates && t.id === this.stageTemplates[0].id ? 'active' : ''}" data-value="${t.id}">${t.name}</div>`).join('')}
                            </div>
                        </div>
                    </div>` : `<span style="font-size:0.75rem;color:var(--text-secondary)">尚無範本（可在設定中新增）</span>`}
                </div>
                <div id="stage-fields-container">
                    ${buildStageFields(initialStages)}
                </div>
                <button type="button" id="add-stage-row" class="btn-tool" style="margin-top:8px;width:100%;font-size:0.85rem">＋ 新增階段</button>
            </div>
            <div class="modal-actions">
                <button id="submit-project" class="btn-primary">建立專案</button>
            </div>
        `;

        modal.classList.remove('hidden');

        const container = document.getElementById('stage-fields-container')!;

        const updateSummary = () => {
            const startVal = (document.getElementById('p-start') as HTMLInputElement).value;
            const endVal = (document.getElementById('p-end') as HTMLInputElement).value;
            const summaryEl = document.getElementById('days-summary');
            if (!summaryEl || !startVal || !endVal) return;

            const totalDays = Array.from(container.querySelectorAll('.stage-days-input'))
                .reduce((sum, inp) => sum + (parseInt((inp as HTMLInputElement).value) || 0), 0);
            const availDays = Math.ceil((new Date(endVal).getTime() - new Date(startVal).getTime()) / 86400000);

            if (totalDays > availDays) {
                summaryEl.textContent = `⚠ 階段共 ${totalDays} 天，超過專案可用 ${availDays} 天`;
                summaryEl.style.background = '#fef2f2';
                summaryEl.style.color = '#dc2626';
            } else {
                summaryEl.textContent = `✓ 階段共 ${totalDays} 天 / 專案可用 ${availDays} 天`;
                summaryEl.style.background = '';
                summaryEl.style.color = '';
            }
        };

        // Delegate: listen for days changes inside container
        container.addEventListener('input', updateSummary);

        // Delegate: remove stage row
        container.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.btn-remove-stage');
            if (btn) {
                const field = btn.closest('.stage-field');
                if (field && container.querySelectorAll('.stage-field').length > 1) {
                    field.remove();
                    updateSummary();
                } else {
                    alert('至少需保留一個階段');
                }
            }
        });

        // Add stage row
        document.getElementById('add-stage-row')?.addEventListener('click', () => {
            const newField = document.createElement('div');
            newField.className = 'stage-field';
            newField.innerHTML = `
                <input type="text" value="" placeholder="階段名稱" class="stage-name-input">
                <input type="number" value="7" class="stage-days-input" min="1">
                <span>天</span>
                <button type="button" class="btn-remove-stage" title="移除此階段">✕</button>
            `;
            container.appendChild(newField);
            updateSummary();
            (newField.querySelector('.stage-name-input') as HTMLInputElement)?.focus();
        });

        // Custom Selector Logic
        const customSelect = document.getElementById('template-custom-select');
        if (customSelect) {
            const trigger = customSelect.querySelector('.custom-select-trigger');
            const options = customSelect.querySelectorAll('.custom-option');
            const triggerText = customSelect.querySelector('.custom-select-text')!;

            trigger?.addEventListener('click', (e) => {
                e.stopPropagation();
                customSelect.classList.toggle('open');
            });

            options.forEach(opt => {
                opt.addEventListener('click', (e) => {
                    const el = e.currentTarget as HTMLElement;
                    const val = el.dataset.value;

                    options.forEach(o => o.classList.remove('active'));
                    el.classList.add('active');
                    triggerText.textContent = el.textContent || '';
                    customSelect.classList.remove('open');

                    // Trigger change logic
                    if (val) {
                        const tmpl = this.stageTemplates.find(t => t.id === parseInt(val));
                        if (tmpl) {
                            container.innerHTML = buildStageFields(tmpl.stages.map((s: any) => ({ name: s.name, days: s.days })));
                            updateSummary();
                        }
                    } else { // "──自訂──" option
                        container.innerHTML = buildStageFields(fallbackStages);
                        updateSummary();
                    }
                });
            });

            document.addEventListener('click', (e) => {
                if (!customSelect.contains(e.target as Node)) {
                    customSelect.classList.remove('open');
                }
            });
        }

        document.getElementById('p-start')?.addEventListener('change', updateSummary);
        document.getElementById('p-end')?.addEventListener('change', updateSummary);
        updateSummary();

        document.getElementById('close-new-project')?.addEventListener('click', () => modal!.classList.add('hidden'));
        document.getElementById('submit-project')?.addEventListener('click', async () => {
            const name = (document.getElementById('p-name') as HTMLInputElement).value;
            const startDate = (document.getElementById('p-start') as HTMLInputElement).value;
            const endDate = (document.getElementById('p-end') as HTMLInputElement).value;
            if (!name) return alert('請輸入專案名稱');
            if (!startDate || !endDate) return alert('請選擇專案起迄日');

            const stages: any[] = [];
            container.querySelectorAll('.stage-field').forEach(field => {
                const n = (field.querySelector('.stage-name-input') as HTMLInputElement).value;
                const d = (field.querySelector('.stage-days-input') as HTMLInputElement).value;
                stages.push({
                    name: n || '未命名',
                    days: parseInt(d) || 1
                });
            });

            try {
                const res = await fetch(`${API_URL}/projects`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: this.currentUserId,
                        name,
                        stages,
                        start_date: new Date(startDate).toISOString(),
                        end_date: new Date(endDate).toISOString()
                    })
                });
                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || '建立失敗');
                }
                modal.classList.add('hidden');
                await this.loadAllProjectsGantt();
                await this.loadProjectSummary();
            } catch (err) { alert((err as Error).message); }
        });
    }

    private async handleBarUpdate(id: number, offset: number, width: number, isStage: boolean) {
        let viewStart = startOfDay(new Date());
        const items = this.allProjectsData.flatMap((p: any) =>
            (p.stages || []).flatMap((s: any) => [s, ...(s.tasks || [])])
        );
        if (items.length > 0) {
            const allStarts = items.map((i: any) => (i.start_date ? new Date(i.start_date).getTime() : i.startDate.getTime()));
            viewStart = startOfDay(addDays(new Date(Math.min(...allStarts)), -1));
        }

        const engine = this.renderer.getEngine();
        const newStart = engine.getDate(offset, viewStart);
        const newEnd = engine.getDate(offset + width, viewStart);

        const type = isStage ? 'stages' : 'sub-tasks';
        try {
            await fetch(`${API_URL}/${type}/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    start_date: newStart.toISOString(),
                    end_date: newEnd.toISOString()
                })
            });
            await this.loadAllProjectsGantt();
            await this.loadProjectSummary();
        } catch (err) {
            console.error('Update fail:', err);
        }
    }
}

new GanttApp();

// AI Agent Chat Panel
new AgentChat();
