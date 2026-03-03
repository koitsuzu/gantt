import { GanttTimeEngine, TimeScale } from './ganttEngine';
import { startOfDay, differenceInCalendarDays } from 'date-fns';

export interface GanttItem {
    id: number;
    name: string;
    department?: string;
    startDate: Date;
    endDate: Date;
    progress: number;
    status?: string;
    type: 'project' | 'stage' | 'task';
    color?: string;
    stageCompleted?: boolean;
    projectId?: number;
    stageId?: number;
    parentTaskId?: number;
    depth?: number;        // nesting depth (0 = direct child of stage)
    hasChildren?: boolean; // whether this task has children
    completionLabel?: string; // e.g. "3/5"
}

export class GanttRenderer {
    private engine: GanttTimeEngine;
    private container: HTMLElement;
    private header: HTMLElement;
    private body: HTMLElement;
    private collapsedProjects: Set<number> = new Set();
    private collapsedStages: Set<number> = new Set();
    private collapsedTasks: Set<number> = new Set();

    constructor(containerId: string, scale: TimeScale = 'day') {
        this.engine = new GanttTimeEngine(scale);
        this.container = document.getElementById(containerId) as HTMLElement;
        this.header = document.getElementById('gantt-time-scale') as HTMLElement;
        this.body = document.getElementById('gantt-rows') as HTMLElement;
    }

    getEngine() {
        return this.engine;
    }

    toggleProject(projectId: number) {
        if (this.collapsedProjects.has(projectId)) {
            this.collapsedProjects.delete(projectId);
        } else {
            this.collapsedProjects.add(projectId);
        }
    }

    toggleStage(stageId: number) {
        if (this.collapsedStages.has(stageId)) {
            this.collapsedStages.delete(stageId);
        } else {
            this.collapsedStages.add(stageId);
        }
    }

    toggleTask(taskId: number) {
        if (this.collapsedTasks.has(taskId)) {
            this.collapsedTasks.delete(taskId);
        } else {
            this.collapsedTasks.add(taskId);
        }
    }

    isProjectCollapsed(id: number) { return this.collapsedProjects.has(id); }
    isStageCollapsed(id: number) { return this.collapsedStages.has(id); }
    isTaskCollapsed(id: number) { return this.collapsedTasks.has(id); }

    expandAll() {
        this.collapsedProjects.clear();
        this.collapsedStages.clear();
        this.collapsedTasks.clear();
    }

    collapseAll(items: GanttItem[]) {
        items.forEach(item => {
            if (item.type === 'project') this.collapsedProjects.add(item.id);
            if (item.type === 'stage') this.collapsedStages.add(item.id);
            if (item.type === 'task' && item.hasChildren) this.collapsedTasks.add(item.id);
        });
    }

    render(items: GanttItem[], viewStart: Date, viewEnd: Date) {
        this.renderHeader(viewStart, viewEnd);
        this.renderBody(items, viewStart, viewEnd);
    }

    private renderHeader(start: Date, end: Date) {
        const cells = this.engine.getRange(start, end);
        const cellWidth = this.engine.getCellWidth();
        const now = new Date();

        this.header.innerHTML = cells.map(cell => {
            let isToday = false;
            if (this.engine.scale === 'day') {
                isToday = startOfDay(cell.date).getTime() === startOfDay(now).getTime();
            } else if (this.engine.scale === 'hour') {
                isToday = startOfDay(cell.date).getTime() === startOfDay(now).getTime() && cell.date.getHours() === now.getHours();
            }

            const todayClass = isToday ? 'is-today' : '';

            return `
                <div class="time-cell ${todayClass}" style="min-width:${cellWidth}px; max-width:${cellWidth}px;">
                    <div class="main-label">${cell.label}</div>
                    <div class="sub-label">${cell.subLabel}</div>
                </div>
            `;
        }).join('');
    }

    // Check if a task should be hidden because ANY ancestor task is collapsed
    private isTaskHiddenByAncestor(item: GanttItem, allItems: GanttItem[]): boolean {
        if (!item.parentTaskId) return false;
        // Check if parent task is collapsed
        if (this.collapsedTasks.has(item.parentTaskId)) return true;
        // Recursively check parent's parent
        const parentItem = allItems.find(i => i.type === 'task' && i.id === item.parentTaskId);
        if (parentItem) return this.isTaskHiddenByAncestor(parentItem, allItems);
        return false;
    }

    private renderBody(items: GanttItem[], viewStart: Date, viewEnd: Date) {
        const cellWidth = this.engine.getCellWidth();
        const today = new Date();
        const todayStart = startOfDay(today);

        // Calculate total width based on the same logic as header
        const cells = this.engine.getRange(viewStart, viewEnd);
        const totalWidth = cells.length * cellWidth;

        // Calculate today line position
        const todayPos = this.engine.getPosition(today, viewStart);
        const todayLine = (todayPos >= 0) ? `<div class="today-line" style="left: ${todayPos}px"></div>` : '';

        const rowsHtml = items.map(item => {
            // Skip hidden items (collapsed parents)
            if (item.type === 'stage' && item.projectId && this.collapsedProjects.has(item.projectId)) return '';
            if (item.type === 'task' && item.projectId && this.collapsedProjects.has(item.projectId)) return '';
            if (item.type === 'task' && item.stageId && this.collapsedStages.has(item.stageId)) return '';
            // Check if any ancestor task is collapsed
            if (item.type === 'task' && item.parentTaskId && this.isTaskHiddenByAncestor(item, items)) return '';

            const left = this.engine.getPosition(item.startDate, viewStart);
            const endPos = this.engine.getPosition(item.endDate, viewStart);
            const width = Math.max(endPos - left, 4);

            const isCompleted = item.type === 'task'
                ? item.status === 'completed'
                : item.stageCompleted === true;
            const isDelayed = !isCompleted && today > item.endDate;

            const alertClass = isDelayed ? 'is-delayed' : '';
            const completedClass = isCompleted ? 'is-completed' : '';

            // Duration label
            const days = differenceInCalendarDays(item.endDate, item.startDate);
            const durationLabel = days >= 1 ? `${days}天` : `${Math.round((item.endDate.getTime() - item.startDate.getTime()) / 3600000)}時`;

            let statusLabel = durationLabel;
            if (isCompleted) statusLabel = '✓';
            else if (isDelayed) statusLabel = `⚠ ${durationLabel}`;

            // Row class with depth
            let rowClass = '';
            if (item.type === 'project') rowClass = 'row-project';
            else if (item.type === 'stage') rowClass = 'row-stage';
            else rowClass = 'row-task';

            const depthClass = item.depth !== undefined && item.depth > 0 ? ` row-depth-${Math.min(item.depth, 5)}` : '';

            // Bar color
            let barColor = item.color || '#6b7280';
            if (isCompleted) barColor = '#22c55e';
            else if (isDelayed) barColor = '#ff0000';

            // Collapse toggle
            let toggleBtn = '';
            if (item.type === 'project') {
                const isCol = this.collapsedProjects.has(item.id);
                toggleBtn = `<button class="collapse-btn" data-toggle-project="${item.id}">${isCol ? '▸' : '▾'}</button>`;
            } else if (item.type === 'stage') {
                const isCol = this.collapsedStages.has(item.id);
                toggleBtn = `<button class="collapse-btn" data-toggle-stage="${item.id}">${isCol ? '▸' : '▾'}</button>`;
            } else if (item.type === 'task' && item.hasChildren) {
                const isCol = this.collapsedTasks.has(item.id);
                toggleBtn = `<button class="collapse-btn" data-toggle-task="${item.id}">${isCol ? '▸' : '▾'}</button>`;
            }

            // Checkbox for tasks
            const checkbox = item.type === 'task'
                ? `<input type="checkbox" class="task-checkbox" data-task-id="${item.id}" ${isCompleted ? 'checked' : ''}>`
                : '';

            // Completion label
            const compLabel = item.completionLabel
                ? `<span class="completion-label">${item.completionLabel}</span>`
                : '';

            // Add-sub button for all levels
            let addBtn = '';
            if (item.type === 'project') {
                addBtn = `<button class="add-sub-btn" data-project-id="${item.id}" data-type="stage">＋</button>`;
            } else if (item.type === 'stage') {
                addBtn = `<button class="add-sub-btn" data-stage-id="${item.id}" data-stage-name="${item.name}" data-type="task">＋</button>`;
            } else if (item.type === 'task') {
                // Every task can have child tasks
                addBtn = `<button class="add-sub-btn" data-task-id="${item.id}" data-stage-id="${item.stageId}" data-type="child-task">＋</button>`;
            }

            // Department tag
            const deptTag = item.department
                ? ` <em class="dept-tag" style="background-color: ${item.color || '#6b7280'}">${item.department}</em>`
                : '';

            // Status icon for stages/projects
            let statusIcon = '';
            if (item.type !== 'task') {
                if (isCompleted) statusIcon = '<span class="stage-status completed">✓</span>';
                else if (isDelayed) statusIcon = '<span class="stage-status delayed">!</span>';
            }

            // Indent spacer for depth
            const indentPx = (item.depth || 0) * 20;
            const indentSpacer = indentPx > 0 ? `<span style="display:inline-block;width:${indentPx}px"></span>` : '';

            return `
                <div class="gantt-row ${rowClass}${depthClass} ${alertClass} ${completedClass}">
                    <div class="row-label">
                        ${indentSpacer}
                        ${toggleBtn}
                        ${checkbox}
                        <span class="row-name">${item.name}${deptTag}</span>
                        ${compLabel}
                        ${statusIcon}
                        ${addBtn}
                        <div class="row-label-resizer"></div>
                    </div>
                    <div class="row-track" style="background-size: ${cellWidth}px 100%; min-width: ${totalWidth}px;">
                        <div class="gantt-bar ${item.type} ${alertClass} ${completedClass}" 
                             style="left: ${left}px; width: ${width}px; background-color: ${barColor}"
                             data-id="${item.id}">
                            <div class="bar-handle left"></div>
                            <div class="bar-handle right"></div>
                            <span class="bar-label">${statusLabel}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        this.body.innerHTML = todayLine + rowsHtml;
    }

    setScale(scale: TimeScale) {
        this.engine.scale = scale;
    }

    expandToLevel(level: number, items: GanttItem[]) {
        if (level === 1) {
            // Level 1: Collapse all projects & stages & tasks
            items.forEach(item => {
                if (item.type === 'project') this.collapsedProjects.add(item.id);
                if (item.type === 'stage') this.collapsedStages.add(item.id);
                if (item.type === 'task' && item.hasChildren) this.collapsedTasks.add(item.id);
            });
        } else if (level === 2) {
            // Level 2: Expand all projects, Collapse all stages & tasks
            this.collapsedProjects.clear();
            items.forEach(item => {
                if (item.type === 'stage') this.collapsedStages.add(item.id);
                if (item.type === 'task' && item.hasChildren) this.collapsedTasks.add(item.id);
            });
        } else if (level === 3) {
            // Level 3: Expand projects & stages, Collapse tasks with children
            this.collapsedProjects.clear();
            this.collapsedStages.clear();
            items.forEach(item => {
                if (item.type === 'task' && item.hasChildren) this.collapsedTasks.add(item.id);
            });
        } else if (level >= 4) {
            // Level 4+: Expand all
            this.expandAll();
        }
    }

    scrollToToday(viewStart: Date) {
        const today = new Date();
        const todayPos = this.engine.getPosition(today, viewStart);
        if (todayPos >= 0) {
            // 中心對齊：減去容器一半寬度，並稍微往左留一點空間 (例如 100px)
            const scrollX = Math.max(0, todayPos - (this.container.clientWidth / 2) + 100);
            this.container.scrollTo({ left: scrollX, behavior: 'smooth' });
        }
    }
}
