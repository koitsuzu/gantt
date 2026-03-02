/**
 * SubTaskModal - 新增 / 編輯子任務
 */
import { format } from 'date-fns';

const API_URL = 'http://localhost:3000/api';

export class SubTaskModal {
    private departments: any[];
    private onSaved: () => Promise<void>;

    constructor(departments: any[], onSaved: () => Promise<void>) {
        this.departments = departments;
        this.onSaved = onSaved;
    }

    updateState(departments: any[]) {
        this.departments = departments;
    }

    show(stageId: number, constraintName: string, constraintStart: Date, constraintEnd: Date, existingTask?: any, parentTaskId?: number) {
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
        const deptOptions = this.departments.map(d => `<option value="${d.name}" ${existingTask?.department === d.name ? 'selected' : ''}>${d.name}</option>`).join('');

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
                            <option value="">請選擇部門</option>${deptOptions}
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
                    <div class="form-group"><label>起始時間</label><input type="datetime-local" id="sub-start" value="${defaultStart}" min="${minDate}" max="${maxDate}" required></div>
                    <div class="form-group"><label>結束時間</label><input type="datetime-local" id="sub-end" value="${defaultEnd}" min="${minDate}" max="${maxDate}" required></div>
                </div>
                <div class="modal-actions">
                    ${existingTask ? `<button type="button" class="btn-del" id="delete-task">刪除任務</button>` : ''}
                    <button type="submit" class="btn-primary" style="flex:1">${submitBtnText}</button>
                </div>
            </form>`;

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
                </div>`;
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
                let options = dept.tasks.map((t: string) => `<option value="${t}" ${existingTask?.name === t ? 'selected' : ''}>${t}</option>`).join('');
                if (existingTask && !dept.tasks.includes(existingTask.name)) options += `<option value="${existingTask.name}" selected>${existingTask.name}</option>`;
                options += `<option value="__custom__">✏️ 自訂名稱...</option>`;
                nameSelect.innerHTML = options;
            } else {
                nameSelect.disabled = true;
                nameSelect.innerHTML = '<option value="">請先選擇部門</option>';
            }
        };

        deptSelect.addEventListener('change', () => {
            if (isCustomMode) { isCustomMode = false; nameWrapper.innerHTML = `<select id="sub-name" required></select>`; nameSelect = document.getElementById('sub-name') as HTMLSelectElement; }
            updateTasks();
        });
        nameWrapper.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            if (target.id === 'sub-name' && target.value === '__custom__') switchToCustomInput();
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
                    await this.onSaved();
                } catch (err) { alert((err as Error).message); }
            });
        }

        document.getElementById('add-sub-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            let taskName = '';
            if (isCustomMode) taskName = (document.getElementById('sub-name-custom') as HTMLInputElement)?.value?.trim() || '';
            else taskName = (document.getElementById('sub-name') as HTMLSelectElement)?.value || '';
            if (!taskName) { alert('請輸入任務名稱'); return; }

            const data: any = {
                stageId, name: taskName, department: deptSelect.value,
                start_date: new Date((document.getElementById('sub-start') as HTMLInputElement).value).toISOString(),
                end_date: new Date((document.getElementById('sub-end') as HTMLInputElement).value).toISOString()
            };
            if (parentTaskId && !existingTask) data.parentTaskId = parentTaskId;

            const url = existingTask ? `${API_URL}/sub-tasks/${existingTask.id}` : `${API_URL}/sub-tasks`;
            try {
                const res = await fetch(url, { method: existingTask ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
                if (!res.ok) { const errData = await res.json(); throw new Error(errData.error || '儲存失敗'); }
                modal.classList.add('hidden');
                await this.onSaved();
            } catch (err) { alert((err as Error).message); }
        });
    }
}
