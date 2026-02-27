/**
 * AnnouncementsView - 公告欄渲染與互動
 */
import { ApiService } from '../services/ApiService';
import { AppState } from '../services/AppState';

declare function showAnnouncementForm(): void;

export class AnnouncementsView {
    private state: AppState;

    constructor(state: AppState) {
        this.state = state;
    }

    async render() {
        const container = document.getElementById('announcements-container');
        if (!container) return;
        try {
            const announcements = await ApiService.getAnnouncements();

            const addBtn = this.state.isEditMode ? `<button class="btn-add-announcement" id="btn-add-ann">+ 新增公告</button>` : '';

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
                                    ${this.state.isEditMode ? `
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

            this.bindEvents(container);
        } catch (err) {
            console.error('Announcements load error:', err);
            container.innerHTML = '<div class="ann-empty">載入公告時發生錯誤</div>';
        }
    }

    private bindEvents(container: HTMLElement) {
        document.getElementById('btn-add-ann')?.addEventListener('click', () => {
            showAnnouncementForm();
        });

        container.querySelectorAll('.ann-pin-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt((btn as HTMLElement).dataset.annId!);
                const currentPinned = (btn as HTMLElement).dataset.pinned === '1';
                await ApiService.updateAnnouncement(id, { pinned: !currentPinned });
                this.render();
            });
        });

        container.querySelectorAll('.ann-del-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = parseInt((btn as HTMLElement).dataset.annId!);
                if (confirm('確定刪除此公告？')) {
                    await ApiService.deleteAnnouncement(id);
                    this.render();
                }
            });
        });
    }
}
