/**
 * AnnouncementsView - 公告欄渲染與互動（含新增/編輯表單）
 */
const API_URL = 'http://localhost:3000/api';

export class AnnouncementsView {
    private isEditMode: boolean;
    private departments: any[];
    private currentUserId: number;

    constructor(isEditMode: boolean, departments: any[], currentUserId: number) {
        this.isEditMode = isEditMode;
        this.departments = departments;
        this.currentUserId = currentUserId;
    }

    updateState(isEditMode: boolean, departments: any[]) {
        this.isEditMode = isEditMode;
        this.departments = departments;
    }

    async render() {
        const container = document.getElementById('announcements-container');
        if (!container) return;
        try {
            const res = await fetch(`${API_URL}/announcements`);
            const announcements = await res.json();

            const addBtn = this.isEditMode
                ? `<button class="btn-add-announcement" id="btn-add-ann">+ 新增公告</button>`
                : '';

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
                this.showForm();
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
                    this.render();
                });
            });

            container.querySelectorAll('.ann-del-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = (btn as HTMLElement).dataset.annId;
                    if (confirm('確定刪除此公告？')) {
                        await fetch(`${API_URL}/announcements/${id}`, { method: 'DELETE' });
                        this.render();
                    }
                });
            });
        } catch (err) {
            console.error('Announcements load error:', err);
            const container = document.getElementById('announcements-container');
            if (container) container.innerHTML = '<div class="ann-empty">載入公告時發生錯誤</div>';
        }
    }

    showForm(existing?: any) {
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
            this.render();
        });
    }
}
