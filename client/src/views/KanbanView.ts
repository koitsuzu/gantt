/**
 * KanbanView - 三欄式看板（Todo / Doing / Done）
 * 渲染在甘特圖區域，拖拉支援狀態同步
 */

const API_URL = 'http://localhost:3000/api';

interface KanbanTask {
    id: number;
    name: string;
    project_name: string;
    stage_name: string;
    department: string;
    end_date: string;
    kanban_status: string;
    status: string;
}

const COLUMNS = [
    { key: 'todo', label: '📋 待辦', emptyMsg: '沒有待辦任務' },
    { key: 'doing', label: '🔧 進行中', emptyMsg: '沒有進行中的任務' },
    { key: 'done', label: '✅ 完成', emptyMsg: '尚無完成的任務' },
];

export class KanbanView {
    private tasks: KanbanTask[] = [];
    private draggedTaskId: number | null = null;
    private ganttContainer: HTMLElement | null = null;
    private onRefreshGantt: (() => void) | null = null;

    constructor() { }

    /**
     * Render the kanban board into the gantt-chart area
     * @param ganttContainer - the #gantt-chart element to be replaced with kanban
     * @param onRefreshGantt - callback to refresh the gantt chart data after drag
     */
    async render(ganttContainer: HTMLElement, onRefreshGantt: () => void) {
        this.ganttContainer = ganttContainer;
        this.onRefreshGantt = onRefreshGantt;

        try {
            const res = await fetch(`${API_URL}/tasks/today/kanban`);
            this.tasks = await res.json();

            // Hide the original gantt content and show kanban instead
            ganttContainer.innerHTML = `
                <div class="task-detail-container" style="padding: 16px;">
                    <div class="kanban-board">
                        ${COLUMNS.map(col => this.renderColumn(col)).join('')}
                    </div>
                </div>`;

            this.bindDragEvents();
        } catch (err) {
            console.error('Kanban load error:', err);
            ganttContainer.innerHTML = '<div class="task-detail-empty">載入看板時發生錯誤</div>';
        }
    }

    /** Restore the gantt chart content (called externally) */
    destroy() {
        // Will be handled by main.ts re-rendering the gantt chart
    }

    private renderColumn(col: { key: string; label: string; emptyMsg: string }): string {
        const colTasks = this.tasks.filter(t => (t.kanban_status || 'todo') === col.key);
        const count = colTasks.length;

        return `
            <div class="kanban-column" data-column="${col.key}">
                <div class="kanban-column-header">
                    <span>${col.label}</span>
                    <span class="kanban-count">${count}</span>
                </div>
                <div class="kanban-cards" data-column="${col.key}">
                    ${colTasks.length === 0
                ? `<div class="kanban-empty">${col.emptyMsg}</div>`
                : colTasks.map(t => this.renderCard(t)).join('')}
                </div>
            </div>`;
    }

    private renderCard(task: KanbanTask): string {
        const endDate = task.end_date ? task.end_date.slice(0, 10) : '';
        const today = new Date();
        const endD = new Date(task.end_date);
        const isOverdue = endD < today && task.status !== 'completed';
        const diffDays = Math.floor((today.getTime() - endD.getTime()) / (1000 * 60 * 60 * 24));

        return `
            <div class="kanban-card ${isOverdue ? 'kanban-card-overdue' : ''}" 
                 draggable="true" data-task-id="${task.id}">
                <div class="kanban-card-project">${task.project_name}</div>
                <div class="kanban-card-name">${task.name}</div>
                <div class="kanban-card-meta">
                    <span class="kanban-card-stage">${task.stage_name}</span>
                    ${task.department ? `<span class="kanban-card-dept">${task.department}</span>` : ''}
                </div>
                <div class="kanban-card-footer">
                    <span class="kanban-card-date ${isOverdue ? 'overdue' : ''}">${endDate}</span>
                    ${isOverdue ? `<span class="kanban-card-delay">+${diffDays}天</span>` : ''}
                </div>
            </div>`;
    }

    private bindDragEvents() {
        // Drag start - always enabled
        document.querySelectorAll('.kanban-card[draggable]').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                this.draggedTaskId = parseInt((card as HTMLElement).dataset.taskId!);
                (card as HTMLElement).classList.add('dragging');
                (e as DragEvent).dataTransfer!.effectAllowed = 'move';
            });
            card.addEventListener('dragend', () => {
                (card as HTMLElement).classList.remove('dragging');
                this.draggedTaskId = null;
                document.querySelectorAll('.kanban-cards').forEach(c => c.classList.remove('drag-over'));
            });
        });

        // Drop zones
        document.querySelectorAll('.kanban-cards').forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                (e as DragEvent).dataTransfer!.dropEffect = 'move';
                (zone as HTMLElement).classList.add('drag-over');
            });
            zone.addEventListener('dragleave', () => {
                (zone as HTMLElement).classList.remove('drag-over');
            });
            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                (zone as HTMLElement).classList.remove('drag-over');

                const newStatus = (zone as HTMLElement).dataset.column;
                if (!this.draggedTaskId || !newStatus) return;

                try {
                    await fetch(`${API_URL}/sub-tasks/${this.draggedTaskId}/kanban`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ kanban_status: newStatus })
                    });
                    // Re-render kanban after status change
                    if (this.ganttContainer && this.onRefreshGantt) {
                        await this.render(this.ganttContainer, this.onRefreshGantt);
                        // Also refresh the gantt data so it syncs
                        this.onRefreshGantt();
                    }
                } catch (err) {
                    console.error('Drop error:', err);
                    alert('更新狀態失敗');
                }
            });
        });
    }
}
