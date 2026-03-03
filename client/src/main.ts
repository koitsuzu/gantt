import './style.css';
import { GanttRenderer, GanttItem } from './renderer';
import { GanttInteraction } from './interaction';
import { AgentChat } from './agent-chat';
import { KanbanView } from './views/KanbanView';
import { AnnouncementsView } from './views/AnnouncementsView';
import { TodayView } from './views/TodayView';
import { DelayView } from './views/DelayView';
import { OverviewView } from './views/OverviewView';
import { ProjectModal } from './views/modals/ProjectModal';
import { SubTaskModal } from './views/modals/SubTaskModal';
import { StageModal } from './views/modals/StageModal';
import { SettingsModal } from './views/modals/SettingsModal';
import { ImportModal } from './views/modals/ImportModal';
import { startOfDay, addDays, format } from 'date-fns';

const API_URL = 'http://localhost:3000/api';

class GanttApp {
    private renderer: GanttRenderer;
    private interaction: GanttInteraction;
    private currentUserId = 1;
    private departments: any[] = [];
    private stageTemplates: any[] = [];
    private allProjectsData: any[] = [];
    private currentProjectId: number | null = null;
    private isEditMode = false;
    private isAdminMode = false;
    private activeTab = 'today';
    private kanbanView: KanbanView | null = null;
    private todayViewMode: 'kanban' | 'gantt' = 'kanban';

    // View instances
    private announcementsView!: AnnouncementsView;
    private todayView!: TodayView;
    private delayView!: DelayView;
    private overviewView!: OverviewView;
    private projectModal!: ProjectModal;
    private subTaskModal!: SubTaskModal;
    private stageModal!: StageModal;
    private settingsModal!: SettingsModal;
    private importModal!: ImportModal;

    constructor() {
        this.renderer = new GanttRenderer('gantt-chart', 'day');
        this.interaction = new GanttInteraction(this.handleBarUpdate.bind(this));
        this.interaction.setEnabled(this.isEditMode);
        this.initViews();
        this.init();
        this.setupEventListeners();
    }

    private initViews() {
        const reloadAll = this.init.bind(this);
        const reloadGantt = async () => { await this.loadAllProjectsGantt(); await this.loadProjectSummary(); };

        this.announcementsView = new AnnouncementsView(this.isEditMode, this.departments, this.currentUserId);
        this.todayView = new TodayView();
        this.delayView = new DelayView();
        this.overviewView = new OverviewView(this.isAdminMode, reloadAll);

        this.projectModal = new ProjectModal(this.stageTemplates, this.currentUserId, reloadGantt);
        this.subTaskModal = new SubTaskModal(this.departments, reloadGantt);
        this.stageModal = new StageModal(this.allProjectsData, reloadGantt);
        this.settingsModal = new SettingsModal(
            this.departments,
            this.stageTemplates,
            async () => { await this.loadDepartments(); this.syncViewState(); },
            async () => { await this.loadStageTemplates(); this.syncViewState(); },
            () => this.refreshGantt()
        );
        this.importModal = new ImportModal(this.currentUserId, reloadGantt);
    }

    /** Keeps all view instances in sync with the controller's current state */
    private syncViewState() {
        this.announcementsView.updateState(this.isEditMode, this.departments);
        this.overviewView.updateState(this.isAdminMode);
        this.projectModal.updateState(this.stageTemplates);
        this.subTaskModal.updateState(this.departments);
        this.stageModal.updateState(this.allProjectsData);
        this.settingsModal.updateState(this.departments, this.stageTemplates);
    }

    async init() {
        await this.loadDepartments();
        await this.loadStageTemplates();
        await this.loadAllProjectsGantt();
        await this.loadProjectSummary();
        // Start on today tab — sync view state then render
        this.syncViewState();
        this.renderAnnouncements();
        this.renderKanbanBoard();
    }

    async loadDepartments() {
        try {
            const res = await fetch(`${API_URL}/departments`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            this.departments = await res.json();
        } catch (err) { console.error('Dept Load Error:', err); }
    }

    async loadStageTemplates() {
        try {
            const res = await fetch(`${API_URL}/stage-templates`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            this.stageTemplates = await res.json();
        } catch (err) { console.error('Stage Templates Load Error:', err); this.stageTemplates = []; }
    }

    async loadAllProjectsGantt() {
        try {
            const url = `${API_URL}/all-projects-gantt?userId=${this.currentUserId}${this.isAdminMode ? '&showAll=true' : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            this.allProjectsData = await res.json();
            this.renderProjectList();
            this.refreshGantt();
        } catch (err) { console.error('All projects load error:', err); }
    }

    async loadProjectSummary() {
        try {
            const url = `${API_URL}/projects/summary?userId=${this.currentUserId}${this.isAdminMode ? '&showAll=true' : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const summaries = await res.json();
            summaries.sort((a: any, b: any) => {
                if (!a.end_date) return 1;
                if (!b.end_date) return -1;
                return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
            });
            this.overviewView.updateState(this.isAdminMode);
            this.overviewView.render(summaries);
            this.overviewView.bindCardClick(summaries, this.isEditMode, (project) => {
                this.overviewView.showProjectEditModal(project, async () => {
                    await this.loadProjectSummary();
                    await this.loadAllProjectsGantt();
                });
            });
        } catch (err) { console.error('Summary Load Error:', err); }
    }

    renderProjectList() {
        const list = document.getElementById('projects');
        if (!list) return;

        const activeProjects = this.allProjectsData
            .filter(p => this.isAdminMode ? true : p.status === 'active')
            .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());

        if (activeProjects.length === 0) { list.innerHTML = '<li class="no-projects">尚未建立專案</li>'; return; }

        const showAllItem = `<li data-id="all" class="${this.currentProjectId === null ? 'active' : ''}">顯示全部</li>`;
        list.innerHTML = showAllItem + activeProjects.map(p =>
            `<li data-id="${p.id}" class="${this.currentProjectId === p.id ? 'active' : ''}">${p.name}</li>`
        ).join('');

        list.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => {
                this.currentProjectId = li.dataset.id === 'all' ? null : parseInt(li.dataset.id!);
                this.renderProjectList();
                this.refreshGantt();
                this.loadProjectSummary();
            });
        });
    }

    /** Delegating rendering to view instances */
    renderAnnouncements() {
        this.announcementsView.updateState(this.isEditMode, this.departments);
        this.announcementsView.render();
    }

    async renderKanbanBoard() {
        // 1. Always render the list at the top (today-container)
        await this.todayView.render();

        // 2. Update toggle button
        const toggleBtn = document.getElementById('kanban-gantt-toggle');
        if (toggleBtn) {
            toggleBtn.style.display = '';
            toggleBtn.textContent = this.todayViewMode === 'kanban' ? '📊 甘特圖模式' : '📋 看板模式';
        }

        // 3. Toggle the bottom area: gantt chart vs kanban board
        const ganttChart = document.getElementById('gantt-chart');
        if (!ganttChart) return;

        if (this.todayViewMode === 'kanban') {
            const toolbar = document.querySelector('.toolbar') as HTMLElement;
            if (toolbar) toolbar.style.display = 'none';
            if (!this.kanbanView) this.kanbanView = new KanbanView();
            await this.kanbanView.render(ganttChart, () => this.loadAllProjectsGantt());
        } else {
            this.showGanttChart();
        }
    }

    renderDelayDetails() {
        this.delayView.render();
    }

    private showGanttChart() {
        const toolbar = document.querySelector('.toolbar') as HTMLElement;
        if (toolbar) toolbar.style.display = '';
        const ganttChart = document.getElementById('gantt-chart');
        if (ganttChart) {
            if (!ganttChart.querySelector('#gantt-time-scale')) {
                ganttChart.innerHTML = `
                    <div class="gantt-header-sticky" id="gantt-time-scale"></div>
                    <div class="gantt-body" id="gantt-rows"></div>`;
                this.renderer = new GanttRenderer('gantt-chart', 'day');
            }
        }
        this.currentProjectId = null;
        this.loadAllProjectsGantt();
    }

    refreshGantt() {
        const items = this.getCurrentGanttItems();
        let viewStart = startOfDay(new Date());
        let viewEnd = addDays(viewStart, 30);

        if (items.length > 0) {
            const allStarts = items.map(i => i.startDate.getTime());
            const allEnds = items.map(i => i.endDate.getTime());
            viewStart = startOfDay(addDays(new Date(Math.min(...allStarts)), -1));
            viewEnd = addDays(new Date(Math.max(...allEnds)), 3);
        }
        this.renderer.render(items, viewStart, viewEnd);

        // 渲染完成後，利用 setTimeout 確保 DOM 已更新，然後自動滾動至今日
        setTimeout(() => {
            this.renderer.scrollToToday(viewStart);
        }, 50);
    }

    getCurrentGanttItems(): GanttItem[] {
        const items: GanttItem[] = [];

        const countTasks = (tasks: any[]): { total: number, completed: number } => {
            let total = 0, completed = 0;
            tasks.forEach((t: any) => {
                total++;
                if (t.status === 'completed') completed++;
                if (t.children?.length > 0) {
                    const c = countTasks(t.children);
                    total += c.total; completed += c.completed;
                }
            });
            return { total, completed };
        };

        const flattenTasks = (tasks: any[], projectId: number, stageId: number, depth: number) => {
            tasks.forEach((task: any) => {
                const dept = this.departments.find(d => d.name === task.department);
                const children = task.children || [];
                const childCounts = countTasks(children);
                const hasChildren = children.length > 0;

                items.push({
                    id: task.id, name: task.name,
                    startDate: task.start_date ? new Date(task.start_date) : new Date(),
                    endDate: task.end_date ? new Date(task.end_date) : new Date(),
                    progress: task.status === 'completed' ? 100 : 0,
                    status: task.status, type: 'task',
                    projectId, stageId,
                    parentTaskId: task.parent_task_id || undefined,
                    depth, hasChildren,
                    department: task.department,
                    color: dept ? dept.color : '#6b7280',
                    completionLabel: hasChildren ? `${childCounts.completed}/${childCounts.total}` : undefined
                });
                if (hasChildren) flattenTasks(children, projectId, stageId, depth + 1);
            });
        };

        [...this.allProjectsData]
            .sort((a, b) => {
                const aEnd = a.end_date ? new Date(a.end_date).getTime() : 0;
                const bEnd = b.end_date ? new Date(b.end_date).getTime() : 0;
                return aEnd - bEnd;
            })
            .filter(p => this.currentProjectId === null || p.id === this.currentProjectId)
            .forEach(project => {
                const stages = project.stages || [];
                let totalTasks = 0, completedTasks = 0;
                stages.forEach((s: any) => { const c = countTasks(s.tasks || []); totalTasks += c.total; completedTasks += c.completed; });
                const projectCompleted = totalTasks > 0 && completedTasks === totalTasks;

                // Filter out invalid/empty dates and dates before year 2000 (timestamp < 946684800000)
                const allDates = stages.flatMap((s: any) => [
                    s.start_date ? new Date(s.start_date).getTime() : NaN,
                    s.end_date ? new Date(s.end_date).getTime() : NaN
                ]).filter((t: number) => !isNaN(t) && t > 946684800000);

                const projStart = allDates.length > 0 ? new Date(Math.min(...allDates)) : new Date();
                const projEnd = allDates.length > 0 ? new Date(Math.max(...allDates)) : addDays(new Date(), 30);

                items.push({
                    id: project.id, name: project.name,
                    startDate: projStart, endDate: projEnd,
                    progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
                    stageCompleted: projectCompleted, type: 'project',
                    color: '#1e293b', completionLabel: `${completedTasks}/${totalTasks}`
                });

                stages.forEach((stage: any) => {
                    const tasks = stage.tasks || [];
                    const stageCounts = countTasks(tasks);
                    const stageCompleted = stageCounts.total > 0 && stageCounts.completed === stageCounts.total;

                    items.push({
                        id: stage.id, name: stage.name,
                        startDate: stage.start_date ? new Date(stage.start_date) : new Date(),
                        endDate: stage.end_date ? new Date(stage.end_date) : new Date(),
                        progress: stageCounts.total > 0 ? Math.round((stageCounts.completed / stageCounts.total) * 100) : 0,
                        stageCompleted, type: 'stage',
                        color: 'var(--accent)', projectId: project.id,
                        completionLabel: stageCounts.total > 0 ? `${stageCounts.completed}/${stageCounts.total}` : ''
                    });
                    flattenTasks(tasks, project.id, stage.id, 0);
                });
            });
        return items;
    }

    private findTaskById(taskId: number): any | null {
        const searchTasks = (tasks: any[]): any | null => {
            for (const task of tasks) {
                if (task.id === taskId) return task;
                if (task.children?.length > 0) { const found = searchTasks(task.children); if (found) return found; }
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

    private findStageById(stageId: number): any {
        for (const proj of this.allProjectsData) {
            for (const stage of proj.stages || []) {
                if (stage.id === stageId) return stage;
            }
        }
        return { name: '未知', start_date: new Date().toISOString(), end_date: new Date().toISOString() };
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

                const toggleBtn = document.getElementById('kanban-gantt-toggle');
                if (toggleBtn) toggleBtn.style.display = tabId === 'today' ? '' : 'none';

                if (tabId !== 'today' && this.todayViewMode === 'kanban') this.showGanttChart();

                if (tabId === 'today') { this.renderAnnouncements(); this.renderKanbanBoard(); }
                if (tabId === 'delay') this.renderDelayDetails();
                if (tabId === 'projects') this.loadAllProjectsGantt();
            });
        });

        // Kanban/Gantt toggle
        document.getElementById('kanban-gantt-toggle')?.addEventListener('click', () => {
            this.todayViewMode = this.todayViewMode === 'kanban' ? 'gantt' : 'kanban';
            this.renderKanbanBoard();
        });

        // Gantt Resizer
        const ganttResizer = document.getElementById('gantt-resizer');
        if (ganttResizer) {
            let startY = 0, startMaxH = 220;
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
            this.syncViewState();
            this.projectModal.show();
        });
        document.getElementById('import-project-btn')?.addEventListener('click', () => {
            if (!this.isEditMode) return;
            this.importModal.show();
        });
        document.getElementById('settings-btn')?.addEventListener('click', () => {
            if (!this.isEditMode) return;
            this.syncViewState();
            this.settingsModal.show();
        });

        // Edit mode toggle
        const editToggle = document.getElementById('edit-mode-check') as HTMLInputElement;
        const toggleLabel = editToggle.closest('.toggle-group')?.querySelector('.toggle-label');

        editToggle.addEventListener('change', async () => {
            if (editToggle.checked) {
                const pass = prompt('請輸入密碼：');
                if (!pass) { editToggle.checked = false; return; }
                try {
                    const res = await fetch(`${API_URL}/verify-password`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: pass })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        this.isEditMode = true;
                        this.isAdminMode = data.role === 'admin';
                        document.body.classList.add('is-editing');
                        if (this.isAdminMode) { document.body.classList.add('is-admin'); if (toggleLabel) toggleLabel.textContent = '🛡️ 管理員模式'; }
                        else { if (toggleLabel) toggleLabel.textContent = '🔓 編輯模式'; }
                        this.interaction.setEnabled(true);
                        this.loadAllProjectsGantt();
                        this.loadProjectSummary();
                        if (this.activeTab === 'today') { this.renderAnnouncements(); this.renderKanbanBoard(); }
                    } else { alert('密碼錯誤！'); editToggle.checked = false; }
                } catch { alert('無法驗證密碼，請確認伺服器是否正常運行'); editToggle.checked = false; }
            } else {
                this.isEditMode = false;
                this.isAdminMode = false;
                document.body.classList.remove('is-editing', 'is-admin');
                if (toggleLabel) toggleLabel.textContent = '🔒 唯讀模式';
                this.interaction.setEnabled(false);
                this.loadAllProjectsGantt();
                this.loadProjectSummary();
                if (this.activeTab === 'today') { this.renderAnnouncements(); this.renderKanbanBoard(); }
            }
        });

        // Time scale switcher
        document.getElementById('view-controls')?.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('button');
            if (!btn || !btn.dataset.scale) return;
            this.renderer.setScale(btn.dataset.scale as any);
            document.querySelectorAll('#view-controls button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.refreshGantt();
        });

        // Level buttons
        ['level-1-btn', 'level-2-btn', 'level-3-btn', 'level-4-btn'].forEach((id, idx) => {
            document.getElementById(id)?.addEventListener('click', () => {
                this.renderer.expandToLevel(idx + 1, this.getCurrentGanttItems());
                this.refreshGantt();
            });
        });

        // Gantt row click (collapse, add, edit) — delegate on stable #gantt-chart (not #gantt-rows which gets replaced)
        document.getElementById('gantt-chart')?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // Collapse toggle - check both the target and its closest collapse-btn
            const collapseBtn = target.closest('.collapse-btn') as HTMLElement;
            if (collapseBtn) {
                if (collapseBtn.dataset.toggleProject) { this.renderer.toggleProject(parseInt(collapseBtn.dataset.toggleProject)); this.refreshGantt(); return; }
                if (collapseBtn.dataset.toggleStage) { this.renderer.toggleStage(parseInt(collapseBtn.dataset.toggleStage)); this.refreshGantt(); return; }
                if (collapseBtn.dataset.toggleTask) { this.renderer.toggleTask(parseInt(collapseBtn.dataset.toggleTask)); this.refreshGantt(); return; }
            }

            if (target.classList.contains('add-sub-btn')) {
                if (!this.isEditMode) return;
                const type = target.dataset.type;
                if (type === 'stage') {
                    this.syncViewState();
                    this.stageModal.show(parseInt(target.dataset.projectId!));
                } else if (type === 'task') {
                    const stageId = parseInt(target.dataset.stageId!);
                    for (const proj of this.allProjectsData) {
                        const stage = (proj.stages || []).find((s: any) => s.id === stageId);
                        if (stage) { this.syncViewState(); this.subTaskModal.show(stageId, target.dataset.stageName!, new Date(stage.start_date), new Date(stage.end_date)); break; }
                    }
                } else if (type === 'child-task') {
                    const parentTask = this.findTaskById(parseInt(target.dataset.taskId!));
                    if (parentTask) { this.syncViewState(); this.subTaskModal.show(parseInt(target.dataset.stageId!), parentTask.name, new Date(parentTask.start_date), new Date(parentTask.end_date), undefined, parentTask.id); }
                }
                return;
            }

            if (target.classList.contains('task-checkbox') || target.closest('.task-checkbox')) return;
            if (target.classList.contains('add-sub-btn') || target.closest('.add-sub-btn')) return;

            const taskBar = target.closest('.gantt-bar.task') as HTMLElement;
            const rowName = target.closest('.row-name') as HTMLElement;
            const rowLabel = target.closest('.row-label') as HTMLElement;
            let taskId: number | null = null;
            if (taskBar) taskId = parseInt(taskBar.dataset.id!);
            else if (rowName || rowLabel) {
                const bar = (rowName || rowLabel).closest('.gantt-row.row-task')?.querySelector('.gantt-bar.task') as HTMLElement;
                if (bar) taskId = parseInt(bar.dataset.id!);
            }

            if (taskId !== null && !isNaN(taskId)) {
                if (!this.isEditMode) return;
                const task = this.findTaskById(taskId);
                if (task) {
                    let constraintStart: Date, constraintEnd: Date, constraintName: string;
                    if (task.parent_task_id) {
                        const parentTask = this.findTaskById(task.parent_task_id);
                        if (parentTask) { constraintStart = new Date(parentTask.start_date); constraintEnd = new Date(parentTask.end_date); constraintName = parentTask.name; }
                        else { const s = this.findStageById(task.stage_id); constraintStart = new Date(s.start_date); constraintEnd = new Date(s.end_date); constraintName = s.name; }
                    } else { const s = this.findStageById(task.stage_id); constraintStart = new Date(s.start_date); constraintEnd = new Date(s.end_date); constraintName = s.name; }
                    this.syncViewState();
                    this.subTaskModal.show(task.stage_id, constraintName!, constraintStart!, constraintEnd!, task, task.parent_task_id || undefined);
                }
            }
        });

        // Sub-task completion checkbox — also delegate on #gantt-chart
        document.getElementById('gantt-chart')?.addEventListener('change', async (e) => {
            const target = e.target as HTMLInputElement;
            if (target.classList.contains('task-checkbox')) {
                const taskId = parseInt(target.dataset.taskId!);
                const newStatus = target.checked ? 'completed' : 'pending';
                try {
                    await fetch(`${API_URL}/sub-tasks/${taskId}/complete`, {
                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: newStatus })
                    });
                    await this.loadAllProjectsGantt();
                    await this.loadProjectSummary();
                } catch (err) { console.error('Completion toggle error:', err); }
            }
        });
    }

    private async handleBarUpdate(id: number, offset: number, width: number, isStage: boolean) {
        let viewStart = startOfDay(new Date());
        const items = this.allProjectsData.flatMap((p: any) => (p.stages || []).flatMap((s: any) => [s, ...(s.tasks || [])]));
        if (items.length > 0) {
            const allStarts = items.map((i: any) => (i.start_date ? new Date(i.start_date).getTime() : i.startDate.getTime()));
            viewStart = startOfDay(addDays(new Date(Math.min(...allStarts)), -1));
        }

        const engine = this.renderer.getEngine();
        const newStart = engine.getDate(offset, viewStart);
        const newEnd = engine.getDate(offset + width, viewStart);

        try {
            await fetch(`${API_URL}/${isStage ? 'stages' : 'sub-tasks'}/${id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ start_date: newStart.toISOString(), end_date: newEnd.toISOString() })
            });
            await this.loadAllProjectsGantt();
            await this.loadProjectSummary();
        } catch (err) { console.error('Update fail:', err); }
    }
}

// Suppress unused import warning for format (used in OverviewView)
const _format = format;
void _format;

new GanttApp();

// AI Agent Chat Panel
new AgentChat();
