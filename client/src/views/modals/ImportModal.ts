/**
 * ImportModal - 匯入專案模板
 */
import { format } from 'date-fns';

const API_URL = 'http://localhost:3000/api';

export class ImportModal {
    private currentUserId: number;
    private onImported: () => Promise<void>;

    constructor(currentUserId: number, onImported: () => Promise<void>) {
        this.currentUserId = currentUserId;
        this.onImported = onImported;
    }

    show() {
        const modal = document.getElementById('modal-overlay')!;
        const content = document.getElementById('modal-content')!;
        modal.classList.remove('hidden');

        const today = format(new Date(), 'yyyy-MM-dd');

        content.innerHTML = `
            <h2 style="margin-top:0;color:var(--text-primary)">📥 匯入專案模板</h2>
            <form id="import-form">
                <div class="form-group">
                    <label>選擇 JSON 模板檔案</label>
                    <input type="file" id="import-file" accept=".json" required style="padding:8px;border:1px dashed var(--border);border-radius:8px;background:var(--bg-secondary)">
                </div>
                <div id="import-preview" style="display:none;margin:12px 0;padding:10px;background:var(--bg-secondary);border-radius:8px;font-size:0.85rem"></div>
                <div class="form-group">
                    <label>新專案名稱</label>
                    <input type="text" id="import-name" required placeholder="輸入新專案名稱">
                </div>
                <div class="form-group">
                    <label>起始日期</label>
                    <input type="date" id="import-start" required value="${today}">
                </div>
                <div class="modal-actions" style="display:flex;gap:8px;margin-top:16px">
                    <button type="submit" class="btn-submit" style="flex:1">匯入建立</button>
                    <button type="button" id="close-import" class="btn-cancel" style="flex:1">取消</button>
                </div>
            </form>`;

        const fileInput = document.getElementById('import-file') as HTMLInputElement;
        const preview = document.getElementById('import-preview')!;
        let templateData: any = null;

        fileInput.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    templateData = JSON.parse(e.target?.result as string);
                    if (templateData._format !== 'antigravity-gantt-v1') {
                        preview.innerHTML = '<span style="color:#ef4444">❌ 無效的模板格式</span>';
                        preview.style.display = 'block';
                        templateData = null;
                        return;
                    }
                    preview.innerHTML = `
                        <div>✅ 模板載入成功</div>
                        <div>原始專案：<strong>${templateData.name}</strong></div>
                        <div>階段數：${templateData.stages?.length || 0}</div>
                        <div>專案天數：${templateData.totalDays} 天</div>`;
                    preview.style.display = 'block';
                    const nameInput = document.getElementById('import-name') as HTMLInputElement;
                    if (nameInput && !nameInput.value) nameInput.value = templateData.name + ' (副本)';
                } catch {
                    preview.innerHTML = '<span style="color:#ef4444">❌ JSON 解析失敗</span>';
                    preview.style.display = 'block';
                    templateData = null;
                }
            };
            reader.readAsText(file);
        });

        document.getElementById('close-import')?.addEventListener('click', () => modal.classList.add('hidden'));

        document.getElementById('import-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!templateData) { alert('請先選擇有效的 JSON 模板檔案'); return; }
            const name = (document.getElementById('import-name') as HTMLInputElement).value;
            const startDate = (document.getElementById('import-start') as HTMLInputElement).value;
            try {
                const res = await fetch(`${API_URL}/projects/import`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: this.currentUserId, template: templateData, name, start_date: new Date(startDate).toISOString() })
                });
                if (!res.ok) { const err = await res.json(); throw new Error(err.error || '匯入失敗'); }
                modal.classList.add('hidden');
                alert('✅ 專案匯入成功！');
                await this.onImported();
            } catch (err) { alert(`匯入失敗：${(err as Error).message}`); }
        });
    }
}
