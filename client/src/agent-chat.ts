/**
 * Agent Chat UI — 群組聊天模式
 * 單一聊天串，使用 @顧問/@操作員 或自動路由
 * 支援拖拉移動、縮放大小、密碼驗證跳窗
 */

const AGENT_API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000';

interface ChatMessage {
    role: 'user' | 'consultant' | 'operator';
    content: string;
    timestamp: Date;
    toolsCalled?: string[];
}

export class AgentChat {
    private container: HTMLElement;
    private messages: ChatMessage[] = [];
    private sessionId: string;
    private isOpen = false;
    private isLoading = false;

    // Drag state
    private isDragging = false;
    private dragOffsetX = 0;
    private dragOffsetY = 0;

    // Resize state
    private isResizing = false;
    private resizeEdge = '';
    private resizeStartX = 0;
    private resizeStartY = 0;
    private resizeStartW = 0;
    private resizeStartH = 0;
    private resizeStartLeft = 0;
    private resizeStartTop = 0;

    // @mention dropdown
    private showingMention = false;

    constructor() {
        // Restore sessionId or create new
        this.sessionId = localStorage.getItem('agent-session-id') || `group_${Date.now()}`;
        localStorage.setItem('agent-session-id', this.sessionId);
        this.container = this.createUI();
        document.body.appendChild(this.container);
        this.bindEvents();
        this.fetchProvider();
        this.restorePosition();
        this.restoreMessages();
    }

    private async fetchProvider() {
        try {
            const res = await fetch(`${AGENT_API}/api/agent/provider`);
            const data = await res.json();
            const providerText = this.container.querySelector('.agent-custom-select-text');
            if (providerText && data.provider) {
                providerText.textContent = data.provider === 'groq' ? 'Groq LLaMA 3.3 70b' : 'Gemini 2.5 Flash';
                const options = this.container.querySelectorAll('.agent-custom-option');
                options.forEach(opt => {
                    if ((opt as HTMLElement).dataset.value === data.provider) opt.classList.add('active');
                    else opt.classList.remove('active');
                });
            }
        } catch (err) { console.error('Failed to fetch provider', err); }
    }

    private createUI(): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.id = 'agent-chat-wrapper';
        wrapper.innerHTML = `
            <button id="agent-toggle" class="agent-toggle" title="AI 助理">
                <span class="agent-toggle-icon">🤖</span>
                <span class="agent-toggle-label">AI 助理</span>
            </button>

            <div id="agent-panel" class="agent-panel">
                <!-- Resize handles -->
                <div class="agent-resize-handle agent-resize-n" data-edge="n"></div>
                <div class="agent-resize-handle agent-resize-s" data-edge="s"></div>
                <div class="agent-resize-handle agent-resize-e" data-edge="e"></div>
                <div class="agent-resize-handle agent-resize-w" data-edge="w"></div>
                <div class="agent-resize-handle agent-resize-ne" data-edge="ne"></div>
                <div class="agent-resize-handle agent-resize-nw" data-edge="nw"></div>
                <div class="agent-resize-handle agent-resize-se" data-edge="se"></div>
                <div class="agent-resize-handle agent-resize-sw" data-edge="sw"></div>

                <div class="agent-header" id="agent-drag-handle">
                    <div class="agent-header-left">
                        <span class="agent-avatar">🤖</span>
                        <div class="agent-header-title-box">
                            <h3 class="agent-title">AI 群組助理</h3>
                            <div class="agent-custom-select" id="agent-custom-select">
                                <div class="agent-custom-select-trigger">
                                    <span class="agent-custom-select-text">載入模型...</span>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                </div>
                                <div class="agent-custom-options">
                                    <div class="agent-custom-option" data-value="gemini">Gemini 2.5 Flash</div>
                                    <div class="agent-custom-option" data-value="groq">Groq LLaMA 3.3 70b</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="agent-header-actions">
                        <button id="agent-clear" class="agent-btn-icon" title="清除對話">🗑️</button>
                        <button id="agent-close" class="agent-btn-icon" title="關閉">✕</button>
                    </div>
                </div>

                <!-- Agent legend bar -->
                <div class="agent-legend">
                    <span class="agent-legend-item consultant">🔍 顧問</span>
                    <span class="agent-legend-item operator">🔧 操作員</span>
                    <span class="agent-legend-tip">輸入 @ 可指定助理</span>
                </div>

                <div id="agent-messages" class="agent-messages">
                    <div class="agent-welcome">
                        <div class="agent-welcome-icon">💬</div>
                        <h4>歡迎使用 AI 群組助理</h4>
                        <p>🔍 <strong>顧問</strong>：查詢、分析、風險評估<br>🔧 <strong>操作員</strong>：新增、修改、刪除、結案<br><br>直接輸入問題，系統會自動判斷，<br>或用 <code>@顧問</code> / <code>@操作員</code> 指定。</p>
                    </div>
                </div>

                <div class="agent-input-area">
                    <div class="agent-quick-actions" id="agent-quick-actions">
                        <button class="agent-quick-btn" data-msg="目前所有專案狀態如何？">📊 專案總覽</button>
                        <button class="agent-quick-btn" data-msg="有哪些逾期的任務？">⚠️ 風險掃描</button>
                        <button class="agent-quick-btn" data-msg="@操作員 幫我新增一個子任務">➕ 新增任務</button>
                        <button class="agent-quick-btn" data-msg="@操作員 列出所有可結案的專案">📦 結案專案</button>
                    </div>
                    <div class="agent-input-wrapper">
                        <textarea id="agent-input" class="agent-input" placeholder="輸入問題，或用 @顧問/@操作員 指定..." rows="1"></textarea>
                        <button id="agent-send" class="agent-send-btn" disabled>
                            <span>➤</span>
                        </button>
                        <!-- @mention dropdown -->
                        <div id="agent-mention-dropdown" class="agent-mention-dropdown" style="display:none">
                            <div class="agent-mention-option" data-mention="@顧問 ">🔍 顧問 — 查詢分析</div>
                            <div class="agent-mention-option" data-mention="@操作員 ">🔧 操作員 — 執行操作</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Password Modal -->
            <div id="agent-password-modal" class="agent-password-modal" style="display:none">
                <div class="agent-password-modal-backdrop"></div>
                <div class="agent-password-modal-content">
                    <h4 id="agent-password-title">🔐 請輸入密碼</h4>
                    <p id="agent-password-desc">此操作需要驗證才能執行</p>
                    <input type="password" id="agent-password-input" placeholder="請輸入密碼..." autocomplete="off" />
                    <div class="agent-password-actions">
                        <button id="agent-password-cancel" class="agent-password-btn cancel">取消</button>
                        <button id="agent-password-confirm" class="agent-password-btn confirm">確認執行</button>
                    </div>
                    <p id="agent-password-error" class="agent-password-error" style="display:none"></p>
                </div>
            </div>
        `;
        return wrapper;
    }

    private bindEvents() {
        const toggle = this.container.querySelector('#agent-toggle') as HTMLElement;
        const close = this.container.querySelector('#agent-close') as HTMLElement;
        const clear = this.container.querySelector('#agent-clear') as HTMLElement;
        const input = this.container.querySelector('#agent-input') as HTMLTextAreaElement;
        const send = this.container.querySelector('#agent-send') as HTMLButtonElement;

        toggle.addEventListener('click', () => this.togglePanel());
        close.addEventListener('click', () => this.togglePanel(false));
        clear.addEventListener('click', () => this.clearChat());
        send.addEventListener('click', () => this.sendMessage());

        input.addEventListener('input', () => {
            send.disabled = !input.value.trim();
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';

            // Check for @ mention trigger
            const val = input.value;
            const cursorPos = input.selectionStart || val.length;
            const textBeforeCursor = val.substring(0, cursorPos);
            const lastAt = textBeforeCursor.lastIndexOf('@');
            if (lastAt >= 0) {
                const afterAt = textBeforeCursor.substring(lastAt + 1);
                // Show dropdown if @ is at end, or partial match like @顧 @操
                if (afterAt === '' || '顧問'.startsWith(afterAt) || '操作員'.startsWith(afterAt)) {
                    this.showMentionDropdown();
                } else {
                    this.hideMentionDropdown();
                }
            } else {
                this.hideMentionDropdown();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.value.trim()) this.sendMessage();
            }
            if (e.key === 'Escape') this.hideMentionDropdown();
        });

        // Quick btns
        this.container.querySelectorAll('.agent-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const msg = (btn as HTMLElement).dataset.msg;
                if (msg) { input.value = msg; this.sendMessage(); }
            });
        });

        // @mention dropdown options
        this.container.querySelectorAll('.agent-mention-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const mention = (opt as HTMLElement).dataset.mention || '';
                const val = input.value;
                const lastAt = val.lastIndexOf('@');
                input.value = val.substring(0, lastAt) + mention;
                this.hideMentionDropdown();
                input.focus();
            });
        });

        // Custom Select (provider)
        const customSelect = this.container.querySelector('#agent-custom-select');
        const trigger = this.container.querySelector('.agent-custom-select-trigger');
        const options = this.container.querySelectorAll('.agent-custom-option');

        if (customSelect && trigger) {
            trigger.addEventListener('click', (e) => { e.stopPropagation(); customSelect.classList.toggle('open'); });
            options.forEach(option => {
                option.addEventListener('click', async (e) => {
                    const el = e.currentTarget as HTMLElement;
                    const newProvider = el.dataset.value;
                    const textContent = el.textContent;
                    if (!newProvider) return;
                    customSelect.classList.remove('open');
                    try {
                        // Switch both agents
                        const [res1, res2] = await Promise.all([
                            fetch(`${AGENT_API}/api/agent/provider`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ provider: newProvider })
                            }),
                            fetch(`${AGENT_API}/api/operator/provider`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ provider: newProvider })
                            })
                        ]);
                        const data = await res1.json();
                        if (!data.success) { alert(`切換失敗: ${data.error}`); this.fetchProvider(); }
                        else {
                            const providerText = this.container.querySelector('.agent-custom-select-text');
                            if (providerText && textContent) providerText.textContent = textContent;
                            options.forEach(opt => opt.classList.remove('active'));
                            el.classList.add('active');
                        }
                    } catch (err) {
                        alert('切換失敗，請檢查網路連線或 API Key 設定。');
                        this.fetchProvider();
                    }
                });
            });
            document.addEventListener('click', (e) => {
                if (!customSelect.contains(e.target as Node)) customSelect.classList.remove('open');
            });
        }

        // Drag & Resize
        this.initDrag();
        this.initResize();

        // Password modal
        this.container.querySelector('#agent-password-cancel')?.addEventListener('click', () => this.hidePasswordModal());
        this.container.querySelector('.agent-password-modal-backdrop')?.addEventListener('click', () => this.hidePasswordModal());
    }

    // ─── @mention Dropdown ─────────────────────────────
    private showMentionDropdown() {
        const dd = this.container.querySelector('#agent-mention-dropdown') as HTMLElement;
        dd.style.display = 'block';
        this.showingMention = true;
    }

    private hideMentionDropdown() {
        const dd = this.container.querySelector('#agent-mention-dropdown') as HTMLElement;
        dd.style.display = 'none';
        this.showingMention = false;
    }

    // ─── Shared Context Builder ────────────────────────
    private buildSharedContext(targetAgent: string): string {
        // Collect last 5 messages NOT from the target agent (and not from user)
        const otherAgent = targetAgent === 'consultant' ? 'operator' : 'consultant';
        const relevant: string[] = [];
        const roleEmoji: Record<string, string> = {
            user: '👤 使用者', consultant: '🔍 顧問', operator: '🔧 操作員',
        };

        // Walk backwards through messages, collect last 5 relevant
        for (let i = this.messages.length - 1; i >= 0 && relevant.length < 5; i--) {
            const msg = this.messages[i];
            if (msg.role === otherAgent || msg.role === 'user') {
                const truncated = msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content;
                relevant.unshift(`${roleEmoji[msg.role]}：${truncated}`);
            }
        }

        if (relevant.length === 0) return '';
        return `[群組上下文 — 最近對話]\n${relevant.join('\n')}\n---以上為其他成員的對話，請根據此上下文回覆---`;
    }

    // ─── Drag ─────────────────────────────────────────
    private initDrag() {
        const handle = this.container.querySelector('#agent-drag-handle') as HTMLElement;
        handle.style.cursor = 'move';

        handle.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement).closest('.agent-btn-icon, .agent-custom-select')) return;
            const panel = this.container.querySelector('#agent-panel') as HTMLElement;
            this.isDragging = true;
            this.dragOffsetX = e.clientX - panel.getBoundingClientRect().left;
            this.dragOffsetY = e.clientY - panel.getBoundingClientRect().top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            const panel = this.container.querySelector('#agent-panel') as HTMLElement;
            let newLeft = e.clientX - this.dragOffsetX;
            let newTop = e.clientY - this.dragOffsetY;
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - panel.offsetWidth));
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - 60));
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (this.isDragging) { this.isDragging = false; this.savePosition(); }
        });
    }

    // ─── Resize ───────────────────────────────────────
    private initResize() {
        const handles = this.container.querySelectorAll('.agent-resize-handle');
        handles.forEach(h => {
            h.addEventListener('mousedown', (e) => {
                const panel = this.container.querySelector('#agent-panel') as HTMLElement;
                this.isResizing = true;
                this.resizeEdge = (h as HTMLElement).dataset.edge || '';
                this.resizeStartX = (e as MouseEvent).clientX;
                this.resizeStartY = (e as MouseEvent).clientY;
                this.resizeStartW = panel.offsetWidth;
                this.resizeStartH = panel.offsetHeight;
                this.resizeStartLeft = panel.getBoundingClientRect().left;
                this.resizeStartTop = panel.getBoundingClientRect().top;
                (e as MouseEvent).preventDefault();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isResizing) return;
            const panel = this.container.querySelector('#agent-panel') as HTMLElement;
            const dx = e.clientX - this.resizeStartX;
            const dy = e.clientY - this.resizeStartY;
            const minW = 360, minH = 400;

            if (this.resizeEdge.includes('e')) panel.style.width = Math.max(minW, this.resizeStartW + dx) + 'px';
            if (this.resizeEdge.includes('s')) panel.style.height = Math.max(minH, this.resizeStartH + dy) + 'px';
            if (this.resizeEdge.includes('w')) {
                const newW = Math.max(minW, this.resizeStartW - dx);
                panel.style.width = newW + 'px';
                panel.style.left = (this.resizeStartLeft + this.resizeStartW - newW) + 'px';
                panel.style.right = 'auto';
            }
            if (this.resizeEdge.includes('n')) {
                const newH = Math.max(minH, this.resizeStartH - dy);
                panel.style.height = newH + 'px';
                panel.style.top = (this.resizeStartTop + this.resizeStartH - newH) + 'px';
                panel.style.bottom = 'auto';
            }
        });

        document.addEventListener('mouseup', () => {
            if (this.isResizing) { this.isResizing = false; this.savePosition(); }
        });
    }

    private savePosition() {
        const panel = this.container.querySelector('#agent-panel') as HTMLElement;
        localStorage.setItem('agent-panel-pos', JSON.stringify({
            left: panel.style.left, top: panel.style.top,
            width: panel.style.width, height: panel.style.height,
        }));
    }

    private restorePosition() {
        const saved = localStorage.getItem('agent-panel-pos');
        if (!saved) return;
        try {
            const pos = JSON.parse(saved);
            const panel = this.container.querySelector('#agent-panel') as HTMLElement;
            if (pos.left) { panel.style.left = pos.left; panel.style.right = 'auto'; }
            if (pos.top) { panel.style.top = pos.top; panel.style.bottom = 'auto'; }
            if (pos.width) panel.style.width = pos.width;
            if (pos.height) panel.style.height = pos.height;
        } catch { }
    }

    // ─── Panel Toggle ──────────────────────────────────
    private togglePanel(open?: boolean) {
        this.isOpen = open !== undefined ? open : !this.isOpen;
        const panel = this.container.querySelector('#agent-panel') as HTMLElement;
        const toggle = this.container.querySelector('#agent-toggle') as HTMLElement;

        if (this.isOpen) {
            panel.classList.add('open');
            toggle.classList.add('hidden');
            setTimeout(() => (this.container.querySelector('#agent-input') as HTMLTextAreaElement).focus(), 300);
        } else {
            panel.classList.remove('open');
            toggle.classList.remove('hidden');
        }
    }

    // ─── Send Message ──────────────────────────────────
    private async sendMessage() {
        const input = this.container.querySelector('#agent-input') as HTMLTextAreaElement;
        const message = input.value.trim();
        if (!message || this.isLoading) return;

        input.value = '';
        input.style.height = 'auto';
        (this.container.querySelector('#agent-send') as HTMLButtonElement).disabled = true;
        this.hideMentionDropdown();


        const welcome = this.container.querySelector('.agent-welcome');
        if (welcome) welcome.remove();

        // Add user message
        this.addMessage('user', message);
        this.isLoading = true;
        const loadingEl = this.addLoading();

        // Detect target from message for shared context building
        const target = this.detectTargetLocally(message);
        const sharedContext = this.buildSharedContext(target);

        try {
            const res = await fetch(`${AGENT_API}/api/group-chat`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, sessionId: this.sessionId, target, sharedContext }),
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || `HTTP ${res.status}`); }

            const data = await res.json();
            loadingEl.remove();
            const agentRole = data.agent === 'operator' ? 'operator' : 'consultant';
            this.addMessage(agentRole as any, data.reply, data.tools_called?.map((t: any) => t.name));

            // Check if auth is required
            if (data.requires_auth && data.action_id) {
                this.showPasswordModal(data.requires_auth, data.action_id);
            }
        } catch (err: any) {
            loadingEl.remove();
            // Show user-friendly error message
            let friendlyMsg = '😅 不好意思，處理您的請求時遇到了一些技術問題，能麻煩您再試一次嗎？😊';
            if (err.message?.includes('Failed to call a function') || err.message?.includes('tool_use_failed') || err.message?.includes('tool call validation')) {
                friendlyMsg = '😅 AI 處理時遇到了一點小問題，能麻煩換個方式描述一下嗎？我會盡力幫您完成！😊';
                console.error('Agent tool call error:', err.message);
            }
            this.addMessage('consultant', friendlyMsg);
        } finally {
            this.isLoading = false;
        }
    }

    private detectTargetLocally(message: string): string {
        if (message.startsWith('@顧問') || message.startsWith('@consultant')) return 'consultant';
        if (message.startsWith('@操作員') || message.startsWith('@operator')) return 'operator';
        const operatorKw = ['新增', '刪除', '移除', '修改', '調整', '更新', '結案', '解除結案', '加入', '建立', '設定', '延後', '提前', '標記完成', '截止', '確認執行'];
        for (const kw of operatorKw) { if (message.includes(kw)) return 'operator'; }
        const consultantKw = ['查詢', '分析', '風險', '狀態', '目前', '報告', '建議', '工作負載', '逾期', '待辦', '如何', '為什麼', '怎麼', '嗎', '哪些', '幾個', '多少'];
        for (const kw of consultantKw) { if (message.includes(kw)) return 'consultant'; }

        // Conversation continuity: if no keyword match, stay with the last responding agent
        const lastAgentMsg = [...this.messages].reverse().find(m => m.role === 'consultant' || m.role === 'operator');
        if (lastAgentMsg) return lastAgentMsg.role;

        return 'consultant';
    }

    // ─── Password Modal ────────────────────────────────
    private pendingActionId: string | null = null;

    private showPasswordModal(authLevel: 'edit' | 'admin', actionId: string) {
        this.pendingActionId = actionId;
        const modal = this.container.querySelector('#agent-password-modal') as HTMLElement;
        const title = this.container.querySelector('#agent-password-title') as HTMLElement;
        const desc = this.container.querySelector('#agent-password-desc') as HTMLElement;
        const input = this.container.querySelector('#agent-password-input') as HTMLInputElement;
        const error = this.container.querySelector('#agent-password-error') as HTMLElement;

        title.textContent = authLevel === 'admin' ? '🔐 請輸入管理員密碼' : '🔐 請輸入編輯密碼';
        desc.textContent = authLevel === 'admin'
            ? '此操作為高風險操作（刪除/解除結案），需要管理員權限。'
            : '此操作需要編輯權限才能執行。';
        input.value = '';
        error.style.display = 'none';
        modal.style.display = 'flex';
        setTimeout(() => input.focus(), 100);

        const confirmBtn = this.container.querySelector('#agent-password-confirm') as HTMLButtonElement;
        const newConfirm = confirmBtn.cloneNode(true) as HTMLButtonElement;
        confirmBtn.replaceWith(newConfirm);
        newConfirm.addEventListener('click', () => this.executeWithPassword());
        input.onkeydown = (e) => { if (e.key === 'Enter') this.executeWithPassword(); };
    }

    private hidePasswordModal() {
        (this.container.querySelector('#agent-password-modal') as HTMLElement).style.display = 'none';
        this.pendingActionId = null;
    }

    private async executeWithPassword() {
        if (!this.pendingActionId) return;
        const input = this.container.querySelector('#agent-password-input') as HTMLInputElement;
        const error = this.container.querySelector('#agent-password-error') as HTMLElement;
        const password = input.value.trim();
        if (!password) { error.textContent = '請輸入密碼'; error.style.display = 'block'; return; }

        try {
            const res = await fetch(`${AGENT_API}/api/operator/execute`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, action_id: this.pendingActionId }),
            });
            const data = await res.json();
            if (!res.ok) { error.textContent = data.error || '驗證失敗'; error.style.display = 'block'; return; }

            this.hidePasswordModal();
            this.addMessage('operator', data.success ? `✅ ${data.message}` : `❌ ${data.error || '執行失敗'}`);

            if (data.success) {
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('agent-data-changed'));
                    const reloadBtn = document.querySelector('.reload-btn, #reload-data') as HTMLElement;
                    if (reloadBtn) reloadBtn.click();
                }, 500);
            }
        } catch (err: any) {
            error.textContent = '網路錯誤：' + err.message;
            error.style.display = 'block';
        }
    }

    // ─── Message Rendering ─────────────────────────────
    private addMessage(role: 'user' | 'consultant' | 'operator', content: string, toolsCalled?: string[]) {
        this.messages.push({ role, content, timestamp: new Date(), toolsCalled });
        this.saveMessages();
        this.renderMessage(role, content, toolsCalled, true);
    }

    private saveMessages() {
        // Keep last 50 messages to avoid localStorage overflow
        const toSave = this.messages.slice(-50).map(m => ({
            role: m.role, content: m.content,
            timestamp: m.timestamp.toISOString(),
            toolsCalled: m.toolsCalled,
        }));
        localStorage.setItem('agent-chat-messages', JSON.stringify(toSave));
    }

    private restoreMessages() {
        const saved = localStorage.getItem('agent-chat-messages');
        if (!saved) return;
        try {
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed) || parsed.length === 0) return;
            this.messages = parsed.map((m: any) => ({
                role: m.role, content: m.content,
                timestamp: new Date(m.timestamp),
                toolsCalled: m.toolsCalled,
            }));
            // Remove welcome and quick actions
            // Remove welcome
            const welcome = this.container.querySelector('.agent-welcome');
            if (welcome) welcome.remove();
            // Re-render all messages
            for (const msg of this.messages) {
                this.renderMessage(msg.role, msg.content, msg.toolsCalled, false);
            }
            // Scroll to bottom
            const messagesEl = this.container.querySelector('#agent-messages') as HTMLElement;
            messagesEl.scrollTop = messagesEl.scrollHeight;
        } catch { }
    }

    private renderMessage(role: 'user' | 'consultant' | 'operator', content: string, toolsCalled?: string[], scroll = true) {
        const messagesEl = this.container.querySelector('#agent-messages') as HTMLElement;
        const msgEl = document.createElement('div');
        const isAgent = role !== 'user';
        msgEl.className = `agent-msg agent-msg-${isAgent ? 'agent' : 'user'} agent-msg-${role}`;

        let formatted = this.formatContent(content);

        const avatars: Record<string, string> = { consultant: '🔍', operator: '🔧', user: '' };
        const labels: Record<string, string> = { consultant: '顧問', operator: '操作員', user: '' };

        let toolBadges = '';
        if (toolsCalled && toolsCalled.length > 0) {
            const toolNames: Record<string, string> = {
                query_projects: '📊 專案查詢', query_project_detail: '🔍 專案詳情',
                query_workload: '👥 工作負載', query_risks: '⚠️ 風險掃描',
                query_timeline: '📅 時間軸', query_changelog: '📝 變更紀錄',
                query_departments: '🏢 部門列表',
                add_project: '➕ 新增專案', add_stage: '➕ 新增階段',
                add_sub_task: '➕ 新增任務', update_task: '✏️ 修改任務',
                update_stage: '✏️ 修改階段', close_project: '📦 結案',
                reopen_project: '📂 解除結案', delete_project: '🗑️ 刪除專案',
                delete_task: '🗑️ 刪除任務',
            };
            toolBadges = `<div class="agent-tool-badges">${toolsCalled.map(t => `<span class="agent-tool-badge">${toolNames[t] || t}</span>`).join('')}</div>`;
        }

        // Detect confirmation prompt from operator — add confirm button
        let confirmBtn = '';
        if (role === 'operator' && (
            content.includes('確認') && (content.includes('執行') || content.includes('無誤'))
        )) {
            confirmBtn = `<div class="agent-confirm-action">
                <button class="agent-confirm-btn" data-action="confirm">✅ 確認執行</button>
                <button class="agent-confirm-btn cancel" data-action="cancel">❌ 取消</button>
            </div>`;
        }

        // 2) Parse [選項] syntax to buttons
        let optionHtml = '';
        formatted = formatted.replace(/\[選項\]\s*(.+?)(?:<br>|$)/g, (match, optionText) => {
            optionHtml += `<button class="agent-guess-option" data-option="${optionText.trim()}">${optionText.trim()}</button>`;
            return ''; // Remove from text, we will append it later
        });
        if (optionHtml) {
            formatted += `<div class="agent-guess-options">${optionHtml}</div>`;
        }

        msgEl.innerHTML = `
            <div class="agent-msg-bubble">
                ${isAgent ? `<span class="agent-msg-avatar agent-avatar-${role}">${avatars[role]}</span>` : ''}
                <div class="agent-msg-content">
                    ${isAgent ? `<div class="agent-msg-label agent-label-${role}">${labels[role]}</div>` : ''}
                    ${toolBadges}
                    <div class="agent-msg-text">${formatted}</div>
                    ${confirmBtn}
                </div>
            </div>
        `;

        // Bind intent option button events
        const optionBtns = msgEl.querySelectorAll('.agent-guess-option');
        if (optionBtns.length > 0) {
            optionBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const optionText = (btn as HTMLElement).dataset.option;
                    if (!optionText) return;

                    // Disable all options in this group
                    optionBtns.forEach(b => (b as HTMLButtonElement).disabled = true);

                    // Auto fill and send
                    const input = this.container.querySelector('#agent-input') as HTMLTextAreaElement;
                    if (input) {
                        input.value = optionText;
                        this.sendMessage();
                    }
                });
            });
        }

        // Bind confirm/cancel button events
        const confirmBtnEl = msgEl.querySelector('.agent-confirm-btn[data-action="confirm"]') as HTMLButtonElement;
        const cancelBtnEl = msgEl.querySelector('.agent-confirm-btn[data-action="cancel"]') as HTMLButtonElement;
        if (confirmBtnEl) {
            confirmBtnEl.addEventListener('click', () => {
                // Disable both buttons after click
                confirmBtnEl.disabled = true;
                confirmBtnEl.textContent = '⏳ 執行中...';
                if (cancelBtnEl) cancelBtnEl.disabled = true;
                // Send confirm message
                const input = this.container.querySelector('#agent-input') as HTMLTextAreaElement;
                input.value = '確認';
                this.sendMessage();
            });
        }
        if (cancelBtnEl) {
            cancelBtnEl.addEventListener('click', () => {
                confirmBtnEl.disabled = true;
                cancelBtnEl.disabled = true;
                this.addMessage('user', '取消操作');
                this.addMessage('operator', '✅ 已取消此操作。');
            });
        }

        messagesEl.appendChild(msgEl);
        if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    private addLoading(): HTMLElement {
        const messagesEl = this.container.querySelector('#agent-messages') as HTMLElement;
        const loadingEl = document.createElement('div');
        loadingEl.className = 'agent-msg agent-msg-agent';
        loadingEl.innerHTML = `
            <div class="agent-msg-bubble">
                <span class="agent-msg-avatar">🤖</span>
                <div class="agent-msg-content">
                    <div class="agent-loading">
                        <span class="agent-loading-dot"></span>
                        <span class="agent-loading-dot"></span>
                        <span class="agent-loading-dot"></span>
                    </div>
                </div>
            </div>
        `;
        messagesEl.appendChild(loadingEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return loadingEl;
    }

    private formatContent(text: string): string {
        let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        s = s.replace(/\n/g, '<br>');

        const lines = s.split('<br>');
        let inTable = false;
        let tableHtml = '';
        const result: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                if (!inTable) { inTable = true; tableHtml = '<table class="agent-table">'; }
                const cells = trimmed.split('|').filter(c => c.trim());
                if (cells.every(c => /^[-:]+$/.test(c.trim()))) continue;
                const tag = tableHtml.includes('<tr>') ? 'td' : 'th';
                tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
            } else {
                if (inTable) { tableHtml += '</table>'; result.push(tableHtml); tableHtml = ''; inTable = false; }
                result.push(line);
            }
        }
        if (inTable) { tableHtml += '</table>'; result.push(tableHtml); }
        return result.join('<br>');
    }

    private async clearChat() {
        try {
            await fetch(`${AGENT_API}/api/group-chat/clear`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId }),
            });
        } catch { }
        this.messages = [];
        this.sessionId = `group_${Date.now()}`;
        localStorage.setItem('agent-session-id', this.sessionId);
        localStorage.removeItem('agent-chat-messages');
        const messagesEl = this.container.querySelector('#agent-messages') as HTMLElement;
        messagesEl.innerHTML = `
            <div class="agent-welcome">
                <div class="agent-welcome-icon">💬</div>
                <h4>歡迎使用 AI 群組助理</h4>
                <p>🔍 <strong>顧問</strong>：查詢、分析、風險評估<br>🔧 <strong>操作員</strong>：新增、修改、刪除、結案<br><br>直接輸入問題，系統會自動判斷，<br>或用 <code>@顧問</code> / <code>@操作員</code> 指定。</p>
            </div>
        `;
        const quickActions = this.container.querySelector('#agent-quick-actions') as HTMLElement;
        if (quickActions) quickActions.style.display = '';
    }
}
