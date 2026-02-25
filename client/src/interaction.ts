export class GanttInteraction {
    private isDragging = false;
    private isResizing = false;
    private isColumnResizing = false;
    private activeId: string | null = null;
    private startX = 0;
    private initialOffset = 0;
    private initialWidth = 0;
    private initialLabelWidth = 0;
    private activeElement: HTMLElement | null = null;
    private resizeDir: 'left' | 'right' | null = null;

    // Parent stage boundaries for sub-task constraint
    private parentLeft = -Infinity;
    private parentRight = Infinity;
    private enabled = false;

    constructor(private onUpdate: (id: number, offset: number, width: number, isStage: boolean) => void) {
        this.init();
    }

    public setEnabled(enabled: boolean) {
        this.enabled = enabled;
    }

    private init() {
        document.addEventListener('mousedown', this.handleMouseDown.bind(this));
        document.addEventListener('mousemove', this.handleMouseMove.bind(this));
        document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    }

    private handleMouseDown(e: MouseEvent) {
        const target = e.target as HTMLElement;

        // Column resizer works in ANY mode (not just edit mode)
        if (target.classList.contains('row-label-resizer')) {
            this.isColumnResizing = true;
            this.startX = e.clientX;
            const root = document.documentElement;
            const currentWidth = getComputedStyle(root).getPropertyValue('--label-width') || '280px';
            this.initialLabelWidth = parseInt(currentWidth);
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
            return;
        }

        if (!this.enabled) return;
        const bar = target.closest('.gantt-bar') as HTMLElement;

        if (!bar) {
            return;
        }

        this.activeElement = bar;
        this.activeId = bar.dataset.id!;
        this.startX = e.clientX;
        this.initialOffset = parseInt(bar.style.left);
        this.initialWidth = parseInt(bar.style.width);

        // Determine parent stage boundaries for sub-tasks
        this.parentLeft = -Infinity;
        this.parentRight = Infinity;

        const isTask = bar.classList.contains('task');
        if (isTask) {
            // Find the parent stage bar (previous sibling row with a stage bar)
            const currentRow = bar.closest('.gantt-row');
            if (currentRow) {
                let prevRow = currentRow.previousElementSibling;
                while (prevRow) {
                    const stageBar = prevRow.querySelector('.gantt-bar.stage') as HTMLElement;
                    if (stageBar) {
                        this.parentLeft = parseInt(stageBar.style.left) || 0;
                        this.parentRight = this.parentLeft + (parseInt(stageBar.style.width) || 0);
                        break;
                    }
                    // If it's another subtask, keep going up
                    if (prevRow.classList.contains('is-subtask')) {
                        prevRow = prevRow.previousElementSibling;
                    } else {
                        break;
                    }
                }
            }
        }

        if (target.classList.contains('bar-handle')) {
            this.isResizing = true;
            this.resizeDir = target.classList.contains('left') ? 'left' : 'right';
        } else {
            this.isDragging = true;
        }

        bar.style.zIndex = '100';
    }

    private handleMouseMove(e: MouseEvent) {
        // Column resizing (handled separately, not gated by enabled)
        if (this.isColumnResizing) {
            const delta = e.clientX - this.startX;
            const newWidth = Math.max(100, Math.min(600, this.initialLabelWidth + delta));
            document.documentElement.style.setProperty('--label-width', `${newWidth}px`);
            return;
        }

        if (!this.isDragging && !this.isResizing) return;
        if (!this.activeElement) return;

        const delta = e.clientX - this.startX;

        if (this.isDragging) {
            let newLeft = this.initialOffset + delta;
            const w = this.initialWidth;
            // Clamp within parent boundaries
            newLeft = Math.max(newLeft, this.parentLeft);
            newLeft = Math.min(newLeft, this.parentRight - w);
            this.activeElement.style.left = `${newLeft}px`;
        } else if (this.isResizing) {
            if (this.resizeDir === 'right') {
                let newWidth = Math.max(20, this.initialWidth + delta);
                // Clamp right edge to parent right boundary
                const rightEdge = this.initialOffset + newWidth;
                if (rightEdge > this.parentRight) {
                    newWidth = this.parentRight - this.initialOffset;
                }
                this.activeElement.style.width = `${newWidth}px`;
            } else {
                let newWidth = Math.max(20, this.initialWidth - delta);
                let newOffset = this.initialOffset + (this.initialWidth - newWidth);
                // Clamp left edge to parent left boundary
                if (newOffset < this.parentLeft) {
                    newOffset = this.parentLeft;
                    newWidth = this.initialOffset + this.initialWidth - this.parentLeft;
                }
                this.activeElement.style.width = `${newWidth}px`;
                this.activeElement.style.left = `${newOffset}px`;
            }
        }
    }

    private handleMouseUp() {
        if ((this.isDragging || this.isResizing) && this.activeElement) {
            const id = parseInt(this.activeId!);
            const offset = parseInt(this.activeElement.style.left);
            const width = parseInt(this.activeElement.style.width);
            const isStage = this.activeElement.classList.contains('stage');

            this.activeElement.style.zIndex = '';
            this.onUpdate(id, offset, width, isStage);
        }

        if (this.isColumnResizing) {
            document.body.style.cursor = '';
        }

        this.isDragging = false;
        this.isResizing = false;
        this.isColumnResizing = false;
        this.activeElement = null;
        this.activeId = null;
    }
}
