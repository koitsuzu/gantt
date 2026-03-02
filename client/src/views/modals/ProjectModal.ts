/**
 * ProjectModal - 建立新專案
 */
import { format, addDays } from 'date-fns';

const API_URL = 'http://localhost:3000/api';

export class ProjectModal {
    private stageTemplates: any[];
    private currentUserId: number;
    private onCreated: () => Promise<void>;

    constructor(stageTemplates: any[], currentUserId: number, onCreated: () => Promise<void>) {
        this.stageTemplates = stageTemplates;
        this.currentUserId = currentUserId;
        this.onCreated = onCreated;
    }

    updateState(stageTemplates: any[]) {
        this.stageTemplates = stageTemplates;
    }

    show() {
        const modal = document.getElementById('modal-overlay');
        const content = document.getElementById('modal-content');
        if (!modal || !content) return;

        const today = format(new Date(), 'yyyy-MM-dd');
        const defaultEnd = format(addDays(new Date(), 30), 'yyyy-MM-dd');
        const hasTemplates = this.stageTemplates.length > 0;

        const buildStageFields = (stages: { name: string, days: number }[]) =>
            stages.map(s => `
                <div class="stage-field">
                    <input type="text" value="${s.name}" class="stage-name-input">
                    <input type="number" value="${s.days}" class="stage-days-input" min="1">
                    <span>天</span>
                    <button type="button" class="btn-remove-stage" title="移除此階段">✕</button>
                </div>`).join('');

        const fallbackStages = [
            { name: '需求確認', days: 3 }, { name: '規格定義', days: 5 },
            { name: '執行', days: 10 }, { name: '測試', days: 5 }, { name: '結案', days: 2 }
        ];
        const initialStages = hasTemplates ? this.stageTemplates[0].stages.map((s: any) => ({ name: s.name, days: s.days })) : fallbackStages;

        content.innerHTML = `
            <button class="btn-close" id="close-new-project">&times;</button>
            <h3>建立新專案</h3>
            <div class="form-group"><label>專案名稱</label><input type="text" id="p-name" placeholder="輸入專案名稱"></div>
            <div class="form-row">
                <div class="form-group"><label>專案起始日</label><input type="date" id="p-start" value="${today}"></div>
                <div class="form-group"><label>專案結束日</label><input type="date" id="p-end" value="${defaultEnd}"></div>
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
                                <span class="custom-select-text">${this.stageTemplates[0].name}</span>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </div>
                            <div class="custom-options">
                                <div class="custom-option" data-value="">──自訂──</div>
                                ${this.stageTemplates.map(t => `<div class="custom-option ${t.id === this.stageTemplates[0].id ? 'active' : ''}" data-value="${t.id}">${t.name}</div>`).join('')}
                            </div>
                        </div>
                    </div>` : `<span style="font-size:0.75rem;color:var(--text-secondary)">尚無範本（可在設定中新增）</span>`}
                </div>
                <div id="stage-fields-container">${buildStageFields(initialStages)}</div>
                <button type="button" id="add-stage-row" class="btn-tool" style="margin-top:8px;width:100%;font-size:0.85rem">＋ 新增階段</button>
            </div>
            <div class="modal-actions"><button id="submit-project" class="btn-primary">建立專案</button></div>`;

        modal.classList.remove('hidden');

        const container = document.getElementById('stage-fields-container')!;

        const updateSummary = () => {
            const startVal = (document.getElementById('p-start') as HTMLInputElement).value;
            const endVal = (document.getElementById('p-end') as HTMLInputElement).value;
            const summaryEl = document.getElementById('days-summary');
            if (!summaryEl || !startVal || !endVal) return;
            const totalDays = Array.from(container.querySelectorAll('.stage-days-input')).reduce((sum, inp) => sum + (parseInt((inp as HTMLInputElement).value) || 0), 0);
            const availDays = Math.ceil((new Date(endVal).getTime() - new Date(startVal).getTime()) / 86400000);
            if (totalDays > availDays) { summaryEl.textContent = `⚠ 階段共 ${totalDays} 天，超過專案可用 ${availDays} 天`; summaryEl.style.color = '#dc2626'; }
            else { summaryEl.textContent = `✓ 階段共 ${totalDays} 天 / 專案可用 ${availDays} 天`; summaryEl.style.color = ''; }
        };

        container.addEventListener('input', updateSummary);
        container.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.btn-remove-stage');
            if (btn) {
                if (container.querySelectorAll('.stage-field').length > 1) { btn.closest('.stage-field')?.remove(); updateSummary(); }
                else alert('至少需保留一個階段');
            }
        });

        document.getElementById('add-stage-row')?.addEventListener('click', () => {
            const newField = document.createElement('div');
            newField.className = 'stage-field';
            newField.innerHTML = `<input type="text" value="" placeholder="階段名稱" class="stage-name-input"><input type="number" value="7" class="stage-days-input" min="1"><span>天</span><button type="button" class="btn-remove-stage" title="移除此階段">✕</button>`;
            container.appendChild(newField);
            updateSummary();
            (newField.querySelector('.stage-name-input') as HTMLInputElement)?.focus();
        });

        // Template custom select
        const customSelect = document.getElementById('template-custom-select');
        if (customSelect) {
            const trigger = customSelect.querySelector('.custom-select-trigger');
            const options = customSelect.querySelectorAll('.custom-option');
            const triggerText = customSelect.querySelector('.custom-select-text')!;
            trigger?.addEventListener('click', (e) => { e.stopPropagation(); customSelect.classList.toggle('open'); });
            options.forEach(opt => {
                opt.addEventListener('click', (e) => {
                    const el = e.currentTarget as HTMLElement;
                    const val = el.dataset.value;
                    options.forEach(o => o.classList.remove('active'));
                    el.classList.add('active');
                    triggerText.textContent = el.textContent || '';
                    customSelect.classList.remove('open');
                    if (val) {
                        const tmpl = this.stageTemplates.find(t => t.id === parseInt(val));
                        if (tmpl) { container.innerHTML = buildStageFields(tmpl.stages.map((s: any) => ({ name: s.name, days: s.days }))); updateSummary(); }
                    } else { container.innerHTML = buildStageFields(fallbackStages); updateSummary(); }
                });
            });
            document.addEventListener('click', (e) => { if (!customSelect.contains(e.target as Node)) customSelect.classList.remove('open'); });
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
                stages.push({ name: n || '未命名', days: parseInt(d) || 1 });
            });
            try {
                const res = await fetch(`${API_URL}/projects`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: this.currentUserId, name, stages, start_date: new Date(startDate).toISOString(), end_date: new Date(endDate).toISOString() })
                });
                if (!res.ok) { const errData = await res.json(); throw new Error(errData.error || '建立失敗'); }
                modal.classList.add('hidden');
                await this.onCreated();
            } catch (err) { alert((err as Error).message); }
        });
    }
}
