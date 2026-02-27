import './style.css'
import { GanttRenderer, GanttItem } from './renderer';
import { GanttInteraction } from './interaction';
import { AgentChat } from './agent-chat';
import { ApiService } from './services/ApiService';
import { AppState } from './services/AppState';
import { OverviewView } from './views/OverviewView';
import { AnnouncementsView } from './views/AnnouncementsView';
import { TodayView } from './views/TodayView';
import { DelayView } from './views/DelayView';
import { startOfDay, addDays } from 'date-fns';

// External modal functions (declared globally by component files)
declare function showProjectModal(): void;
declare function showImportModal(): void;
declare function showSettings(): void;
declare function showAddStageModal(projectId: number): void;
declare function showSubTaskModal(stageId: number, stageName: string, start: Date, end: Date, task?: any, parentId?: number): void;
declare function showProjectEditModal(project: any): void;

class GanttApp {
    private renderer: GanttRenderer;
    private interaction: GanttInteraction;

    // Views
    private overviewView: OverviewView;
    private announcementsView: AnnouncementsView;
    private todayView: TodayView;
    private delayView: DelayView;

    // Shared State
    private state: AppState;

    constructor() {
        this.renderer = new GanttRenderer('gantt-chart', 'day');
        this.interaction = new GanttInteraction(this.handleBarUpdate.bind(this));
        this.interaction.setEnabled(false);

        // Initialize shared state
        this.state = {
            currentUserId: 1,
            isEditMode: false,
            isAdminMode: false,
            activeTab: 'projects',
            currentProjectId: null,
            departments: [],
            stageTemplates: [],
            allProjectsData: [],
            reloadAll: this.reloadAll.bind(this),
            refreshGantt: this.refreshGantt.bind(this),
        };

        // Initialize Views
        this.overviewView = new OverviewView(this.state);
        this.announcementsView = new AnnouncementsView(this.state);
        this.todayView = new TodayView();
        this.delayView = new DelayView();

        this.init();
        this.setupEventListeners();
    }

    // === Initialization ===

    async init() {
        await this.loadDepartments();
        await this.loadStageTemplates();
        await this.loadAllProjectsGantt();
        await this.overviewView.render();
    }

    async reloadAll() {
        await this.loadAllProjectsGantt();
        await this.overviewView.render();
    }

    private async loadDepartments() {
        try {
            this.state.departments = await ApiService.getDepartments();
        } catch (err) {
            console.error('Dept Load Error:', err);
        }
    }

    private async loadStageTemplates() {
        try {
            this.state.stageTemplates = await ApiService.getStageTemplates();
        } catch (err) {
            console.error('Stage Templates Load Error:', err);
            this.state.stageTemplates = [];
        }
    }

    private async loadAllProjectsGantt() {
        try {
            this.state.allProjectsData = await ApiService.getAllProjectsGantt(
                this.state.currentUserId,
                this.state.isAdminMode
            );
            this.renderProjectList();
            this.refreshGantt();
        } catch (err) {
            console.error('All projects load error:', err);
        }
    }

    // === Project Selector ===

    private renderProjectList() {
        const list = document.getElementById('projects');
        if (!list) return;

        const activeProjects = this.state.allProjectsData
            .filter(p => this.state.isAdminMode ? true : p.status === 'active')
            .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());

        if (activeProjects.length === 0) {
            list.innerHTML = '<li class="no-projects">尚未建立專案</li>';
            return;
        }

        const showAllItem = `<li data-id="all" class="${this.state.currentProjectId === null ? 'active' : ''}">顯示全部</li>`;

        list.innerHTML = showAllItem + activeProjects.map(p => `
            <li data-id="${p.id}" class="${this.state.currentProjectId === p.id ? 'active' : ''}">${p.name}</li>
        `).join('');

        list.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => {
                const idAttr = li.dataset.id;
                this.state.currentProjectId = idAttr === 'all' ? null : parseInt(idAttr!);
                this.renderProjectList();
                this.refreshGantt();
                this.overviewView.render();
            });
        });
    }

    // === Gantt Chart ===

    refreshGantt() {
        const items = this.getCurrentGanttItems();
        let viewStart = startOfDay(new Date());
        let viewEnd = addDays(viewStart, 30);

        if (items.length > 0) {
            const allStarts = items.map(i => i.startDate.getTime());
            const allEnds = items.map(i => i.endDate.getTime());
            const earliestStart = new Date(Math.min(...allStarts));
            const latestEnd = new Date(Math.max(...allEnds));

            viewStart = startOfDay(addDays(earliestStart, -3));

            const today = new Date();
            viewEnd = new Date(Math.max(
                addDays(latestEnd, 7).getTime(),
                addDays(today, 30).getTime()
            ));
        }

        this.renderer.render(items, viewStart, viewEnd);
        setTimeout(() => this.scrollToToday(viewStart), 50);
    }

    private scrollToToday(viewStart: Date) {
        const container = document.getElementById('gantt-chart');
        if (!container) return;

        const engine = this.renderer.getEngine();
        const todayPos = engine.getPosition(new Date(), viewStart);

        const targetScroll = todayPos - (container.clientWidth / 2);
        container.scrollTo({
            left: Math.max(0, targetScroll),
            behavior: 'smooth'
        });
    }

    getCurrentGanttItems(): GanttItem[] {
        const items: GanttItem[] = [];

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

        const flattenTasks = (tasks: any[], projectId: number, stageId: number, depth: number) => {
            tasks.forEach((task: any) => {
                const dept = this.state.departments.find(d => d.name === task.department);
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

                if (hasChildren) {
                    flattenTasks(children, projectId, stageId, depth + 1);
                }
            });
        };

        [...this.state.allProjectsData]
            .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime())
            .filter(p => this.state.currentProjectId === null || p.id === this.state.currentProjectId)
            .forEach(project => {
                const stages = project.stages || [];

                let totalTasks = 0, completedTasks = 0;
                stages.forEach((s: any) => {
                    const tasks = s.tasks || [];
                    const counts = countTasks(tasks);
                    totalTasks += counts.total;
                    completedTasks += counts.completed;
                });
                const projectCompleted = totalTasks > 0 && completedTasks === totalTasks;

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

                    flattenTasks(tasks, project.id, stage.id, 0);
                });
            });
        return items;
    }

    // === Helper: Find task/stage by ID ===

    private findTaskById(taskId: number): any | null {
        const searchTasks = (tasks: any[]): any | null => {
            for (const t of tasks) {
                if (t.id === taskId) return t;
                if (t.children && t.children.length > 0) {
                    const found = searchTasks(t.children);
                    if (found) return found;
                }
            }
            return null;
        };

        for (const proj of this.state.allProjectsData) {
            for (const stage of (proj.stages || [])) {
                const found = searchTasks(stage.tasks || []);
                if (found) return { ...found, stage_id: stage.id };
            }
        }
        return null;
    }

    private findStageById(stageId: number): any | null {
        for (const proj of this.state.allProjectsData) {
            const stage = (proj.stages || []).find((s: any) => s.id === stageId);
            if (stage) return stage;
        }
        return null;
    }

    // === Event Listeners ===

    setupEventListeners() {
        // Focus Today
        document.getElementById('focus-today-btn')?.addEventListener('click', () => {
            const items = this.getCurrentGanttItems();
            if (items.length === 0) return;

            const allStarts = items.map(i => i.startDate.getTime());
            const earliestStart = new Date(Math.min(...allStarts));
            const viewStart = startOfDay(addDays(earliestStart, -1));

            this.scrollToToday(viewStart);
        });

        // Tab Switching
        document.querySelectorAll('.main-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = (tab as HTMLElement).dataset.tab!;
                this.state.activeTab = tabId;
                document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(`tab-${tabId}`)?.classList.add('active');

                if (tabId === 'announcements') this.announcementsView.render();
                if (tabId === 'today') this.todayView.render();
                if (tabId === 'delay') this.delayView.render();
            });
        });

        // Gantt Resizer
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

        // Toolbar buttons
        document.getElementById('new-project-btn')?.addEventListener('click', () => {
            if (!this.state.isEditMode) return;
            showProjectModal();
        });
        document.getElementById('import-project-btn')?.addEventListener('click', () => {
            showImportModal();
        });
        document.getElementById('settings-btn')?.addEventListener('click', () => {
            if (!this.state.isEditMode) return;
            showSettings();
        });

        // Edit/Admin mode toggle
        const editToggle = document.getElementById('edit-mode-check') as HTMLInputElement;
        const toggleLabel = editToggle?.closest('.toggle-group')?.querySelector('.toggle-label');

        editToggle?.addEventListener('change', async () => {
            if (editToggle.checked) {
                const pass = prompt('請輸入密碼：');
                if (!pass) { editToggle.checked = false; return; }
                try {
                    const data = await ApiService.verifyPassword(pass);
                    this.state.isEditMode = true;
                    this.state.isAdminMode = data.role === 'admin';
                    document.body.classList.add('is-editing');
                    if (this.state.isAdminMode) {
                        document.body.classList.add('is-admin');
                        if (toggleLabel) toggleLabel.textContent = '🛡️ 管理員模式';
                    } else {
                        if (toggleLabel) toggleLabel.textContent = '🔓 編輯模式';
                    }
                    this.interaction.setEnabled(true);
                    await this.reloadAll();
                } catch {
                    alert('密碼錯誤！');
                    editToggle.checked = false;
                }
            } else {
                this.state.isEditMode = false;
                this.state.isAdminMode = false;
                document.body.classList.remove('is-editing', 'is-admin');
                if (toggleLabel) toggleLabel.textContent = '🔒 唯讀模式';
                this.interaction.setEnabled(false);
                await this.reloadAll();
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
        [1, 2, 3, 4].forEach(level => {
            document.getElementById(`level-${level}-btn`)?.addEventListener('click', () => {
                const items = this.getCurrentGanttItems();
                this.renderer.expandToLevel(level, items);
                this.refreshGantt();
            });
        });

        // Gantt row interactions (collapse, add, edit)
        document.getElementById('gantt-rows')?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;

            // Project collapse
            if (target.dataset.toggleProject) {
                this.renderer.toggleProject(parseInt(target.dataset.toggleProject));
                this.refreshGantt();
                return;
            }
            // Stage collapse
            if (target.dataset.toggleStage) {
                this.renderer.toggleStage(parseInt(target.dataset.toggleStage));
                this.refreshGantt();
                return;
            }
            // Task collapse
            if (target.dataset.toggleTask) {
                this.renderer.toggleTask(parseInt(target.dataset.toggleTask));
                this.refreshGantt();
                return;
            }

            // Add sub-item
            if (target.classList.contains('add-sub-btn')) {
                if (!this.state.isEditMode) return;
                const type = target.dataset.type;

                if (type === 'stage') {
                    showAddStageModal(parseInt(target.dataset.projectId!));
                } else if (type === 'task') {
                    const stageId = parseInt(target.dataset.stageId!);
                    const stageName = target.dataset.stageName!;
                    for (const proj of this.state.allProjectsData) {
                        const stage = (proj.stages || []).find((s: any) => s.id === stageId);
                        if (stage) {
                            showSubTaskModal(stageId, stageName, new Date(stage.start_date), new Date(stage.end_date));
                            break;
                        }
                    }
                } else if (type === 'child-task') {
                    const parentTaskId = parseInt(target.dataset.taskId!);
                    const stageId = parseInt(target.dataset.stageId!);
                    const parentTask = this.findTaskById(parentTaskId);
                    if (parentTask) {
                        showSubTaskModal(
                            stageId, parentTask.name,
                            new Date(parentTask.start_date), new Date(parentTask.end_date),
                            undefined, parentTaskId
                        );
                    }
                }
                return;
            }

            // Edit task (click on bar or row name)
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
                if (!this.state.isEditMode) return;
                const task = this.findTaskById(taskId);
                if (task) {
                    let constraintStart: Date, constraintEnd: Date, constraintName: string;
                    if (task.parent_task_id) {
                        const parentTask = this.findTaskById(task.parent_task_id);
                        if (parentTask) {
                            constraintStart = new Date(parentTask.start_date);
                            constraintEnd = new Date(parentTask.end_date);
                            constraintName = parentTask.name;
                        } else {
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
                    showSubTaskModal(task.stage_id, constraintName, constraintStart!, constraintEnd!, task, task.parent_task_id || undefined);
                    return;
                }
            }
        });

        // Task completion checkbox
        document.getElementById('gantt-rows')?.addEventListener('change', async (e) => {
            const target = e.target as HTMLInputElement;
            if (target.classList.contains('task-checkbox')) {
                const taskId = parseInt(target.dataset.taskId!);
                const newStatus = target.checked ? 'completed' : 'pending';
                try {
                    await ApiService.updateTaskStatus(taskId, newStatus);
                    await this.reloadAll();
                } catch (err) {
                    console.error('Completion toggle error:', err);
                }
            }
        });
    }

    // === Bar drag update ===

    private async handleBarUpdate(id: number, offset: number, width: number, isStage: boolean) {
        let viewStart = startOfDay(new Date());
        const items = this.state.allProjectsData.flatMap((p: any) =>
            (p.stages || []).flatMap((s: any) => [s, ...(s.tasks || [])])
        );
        if (items.length > 0) {
            const allStarts = items.map((i: any) => (i.start_date ? new Date(i.start_date).getTime() : i.startDate.getTime()));
            viewStart = startOfDay(addDays(new Date(Math.min(...allStarts)), -1));
        }

        const engine = this.renderer.getEngine();
        const newStart = engine.getDate(offset, viewStart);
        const newEnd = engine.getDate(offset + width, viewStart);

        try {
            await ApiService.updateTaskDates(id, newStart.toISOString(), newEnd.toISOString(), isStage);
            await this.reloadAll();
        } catch (err) {
            console.error('Update fail:', err);
        }
    }
}

export const app = new GanttApp();

// AI Agent Chat Panel
new AgentChat();
