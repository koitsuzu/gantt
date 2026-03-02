/**
 * SettingsModal - 系統設定（部門、範本、一般）
 */
const API_URL = 'http://localhost:3000/api';

export class SettingsModal {
    private departments: any[];
    private stageTemplates: any[];
    private editingDeptId: number | null = null;
    private editingTemplateId: number | null = null;
    private onDeptReload: () => Promise<void>;
    private onTemplateReload: () => Promise<void>;
    private onRefreshGantt: () => void;

    constructor(
        departments: any[],
        stageTemplates: any[],
        onDeptReload: () => Promise<void>,
        onTemplateReload: () => Promise<void>,
        onRefreshGantt: () => void
    ) {
        this.departments = departments;
        this.stageTemplates = stageTemplates;
        this.onDeptReload = onDeptReload;
        this.onTemplateReload = onTemplateReload;
        this.onRefreshGantt = onRefreshGantt;
    }

    updateState(departments: any[], stageTemplates: any[]) {
        this.departments = departments;
        this.stageTemplates = stageTemplates;
    }

    show(initialTab = 'depts') {
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
                        <div class="dept-details"><h4>${d.name}</h4><p>${d.tasks.join(', ') || '無預設任務'}</p></div>
                        <span class="dept-edit-hint">點擊編輯</span>
                    </div>
                    <button class="dept-item-delete" data-id="${d.id}">刪除</button>
                </div>`).join('');
        };

        const renderTemplates = () => {
            if (this.stageTemplates.length === 0) return '<p style="color:var(--text-secondary);font-size:0.85rem">尚無範本</p>';
            return this.stageTemplates.map(t => `
                <div class="dept-item-wrapper" data-tmpl-id="${t.id}">
                    <div class="dept-item-content" style="cursor:pointer">
                        <div class="dept-details"><h4>${t.name}</h4><p>${t.stages.map((s: any) => `${s.name}(${s.days}天)`).join(' → ')}</p></div>
                        <span class="dept-edit-hint">點擊編輯</span>
                    </div>
                    <button class="dept-item-delete" data-tmpl-id="${t.id}">刪除</button>
                </div>`).join('');
        };

        content.innerHTML = `
            <button class="btn-close" id="close-settings-btn">&times;</button>
            <div class="settings-container" style="padding: 1rem 0.5rem">
                <div class="settings-header" style="margin-bottom: 2rem"><h2>系統設定</h2></div>
                <div class="settings-tabs">
                    <button class="settings-tab ${initialTab === 'depts' ? 'active' : ''}" data-tab="depts">部門與預設任務</button>
                    <button class="settings-tab ${initialTab === 'templates' ? 'active' : ''}" data-tab="templates">專案階段範本</button>
                    <button class="settings-tab ${initialTab === 'general' ? 'active' : ''}" data-tab="general">一般設定</button>
                </div>
                <!-- Depts Tab -->
                <div class="settings-tab-panel ${initialTab === 'depts' ? 'active' : ''}" id="tab-depts">
                    <div class="settings-grid">
                        <div class="settings-column">
                            <div class="settings-section">
                                <div class="section-header"><h3 id="dept-form-title">${this.editingDeptId ? '編輯部門' : '新增部門'}</h3></div>
                                <div class="dept-form" style="margin-bottom:0">
                                    <div class="form-group"><label>部門名稱</label><input type="text" id="new-dept-name" placeholder="例如：研發部"></div>
                                    <div class="form-group"><label>代表顏色</label><div class="color-input-wrapper"><input type="color" id="new-dept-color" value="#3b82f6"></div></div>
                                    <div class="form-group"><label>預設任務 (每行一個)</label><textarea id="new-dept-tasks" placeholder="任務 A\n任務 B" rows="5"></textarea></div>
                                    <div style="display:flex;gap:12px;margin-top:8px">
                                        <button class="btn-primary" id="save-dept-btn" style="flex:1">儲存部門</button>
                                        <button class="btn-secondary" id="cancel-dept-btn" style="display:${this.editingDeptId ? 'inline-flex' : 'none'}">取消</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="settings-column">
                            <div class="settings-section">
                                <div class="section-header"><h3>現有部門列表</h3></div>
                                <div class="dept-items">${renderDepts()}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- Templates Tab -->
                <div class="settings-tab-panel ${initialTab === 'templates' ? 'active' : ''}" id="tab-templates">
                    <div class="settings-grid">
                        <div class="settings-column">
                            <div class="settings-section">
                                <div class="section-header"><h3 id="tmpl-form-title">${this.editingTemplateId ? '編輯階段範本' : '新增階段範本'}</h3></div>
                                <div id="tmpl-form-wrapper" class="dept-form" style="margin-bottom:0">
                                    <div class="form-group"><label>範本名稱</label><input type="text" id="tmpl-name-input" placeholder="例如：標準開發流程"></div>
                                    <div class="form-group"><label>階段設定</label><div id="tmpl-stages-container"></div>
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
                                <div class="section-header"><h3>現有範本列表</h3></div>
                                <div id="tmpl-items" class="dept-items">${renderTemplates()}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- General Tab -->
                <div class="settings-tab-panel ${initialTab === 'general' ? 'active' : ''}" id="tab-general">
                    <div class="settings-section">
                        <div class="section-header"><h3>一般設定</h3></div>
                        <p style="color:var(--text-secondary); margin-bottom: 1.5rem">這裡將來可以放置使用者權限、公司資訊或其他全域設定。</p>
                    </div>
                </div>
            </div>`;

        // Tab switching
        content.querySelectorAll('.settings-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = (btn as HTMLElement).dataset.tab!;
                content.querySelectorAll('.settings-tab').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tab === target));
                content.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${target}`));
                if (target !== 'depts') this.editingDeptId = null;
                if (target !== 'templates') this.editingTemplateId = null;
            });
        });

        document.getElementById('close-settings-btn')?.addEventListener('click', () => {
            overlay.classList.add('hidden');
            modal.classList.remove('modal-lg');
            this.editingDeptId = null;
            this.editingTemplateId = null;
        });

        // Dept handlers
        const cancelDeptEdit = () => { this.editingDeptId = null; this.show('depts'); };
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
                const res = await fetch(url, { method: this.editingDeptId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color, tasks }) });
                if (!res.ok) throw new Error('儲存部門失敗');
                this.editingDeptId = null;
                await this.onDeptReload();
                this.show('depts');
                this.onRefreshGantt();
            } catch (err) { alert((err as Error).message); }
        });

        // Template handlers
        const tmplContainer = document.getElementById('tmpl-stages-container')!;
        const buildTmplStageRow = (name = '', days = 7) => {
            const div = document.createElement('div');
            div.className = 'stage-field';
            div.style.marginBottom = '8px';
            div.innerHTML = `
                <input type="text" value="${name}" placeholder="階段名稱" class="stage-name-input" style="flex:2">
                <input type="number" value="${days}" class="stage-days-input" min="1" style="flex:1">
                <span style="font-size:0.8rem;color:var(--text-secondary)">天</span>
                <button type="button" class="btn-remove-stage" title="移除">✕</button>`;
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
            if (btn && tmplContainer.querySelectorAll('.stage-field').length > 1) btn.closest('.stage-field')?.remove();
            else if (btn) alert('至少需保留一個階段');
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
                const res = await fetch(url, { method: this.editingTemplateId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: tmplName, stages }) });
                if (!res.ok) throw new Error('儲存範本失敗');
                this.editingTemplateId = null;
                await this.onTemplateReload();
                this.show('templates');
            } catch (err) { alert((err as Error).message); }
        });

        document.getElementById('cancel-tmpl-btn')?.addEventListener('click', () => { this.editingTemplateId = null; this.show('templates'); });

        content.querySelectorAll('.dept-item-content').forEach(item => {
            item.addEventListener('click', () => {
                const wrapper = item.closest('.dept-item-wrapper') as HTMLElement;
                if (wrapper.dataset.id) { this.editingDeptId = parseInt(wrapper.dataset.id!); this.show('depts'); }
                else if (wrapper.dataset.tmplId) { this.editingTemplateId = parseInt(wrapper.dataset.tmplId!); this.show('templates'); }
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
                    if (isTmpl) await this.onTemplateReload(); else await this.onDeptReload();
                    this.show(isTmpl ? 'templates' : 'depts');
                } catch (err) { alert((err as Error).message); }
            });
        });
    }
}
