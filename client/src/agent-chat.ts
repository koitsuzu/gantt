/**
 * Agent Chat UI — 底部浮動式聊天面板
 */

const AGENT_API = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000';

interface ChatMessage {
    role: 'user' | 'agent';
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

    constructor() {
        this.sessionId = `session_${Date.now()}`;
        this.container = this.createUI();
        document.body.appendChild(this.container);
        this.bindEvents();
        this.fetchProvider();
    }

    private async fetchProvider() {
        try {
            const res = await fetch(`${AGENT_API}/api/agent/provider`);
            const data = await res.json();
            const providerText = this.container.querySelector('.agent-custom-select-text');
            if (providerText && data.provider) {
                if (data.provider === 'groq') {
                    providerText.textContent = 'Groq LLaMA 3.3 70b';
                } else {
                    providerText.textContent = 'Gemini 2.5 Flash';
                }

                // Update active state in dropdown
                const options = this.container.querySelectorAll('.agent-custom-option');
                options.forEach(opt => {
                    if ((opt as HTMLElement).dataset.value === data.provider) {
                        opt.classList.add('active');
                    } else {
                        opt.classList.remove('active');
                    }
                });
            }
        } catch (err) {
            console.error('Failed to fetch provider', err);
        }
    }

    private createUI(): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.id = 'agent-chat-wrapper';
        wrapper.innerHTML = `
            <!-- Floating Toggle Button -->
            <button id="agent-toggle" class="agent-toggle" title="AI 助理">
                <span class="agent-toggle-icon">🤖</span>
                <span class="agent-toggle-label">AI 助理</span>
            </button>

            <!-- Chat Panel -->
            <div id="agent-panel" class="agent-panel">
                <div class="agent-header">
                    <div class="agent-header-left">
                        <span class="agent-avatar">🤖</span>
                        <div class="agent-header-title-box">
                            <h3 class="agent-title">AI 助理</h3>
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

                <div id="agent-messages" class="agent-messages">
                    <div class="agent-welcome">
                        <div class="agent-welcome-icon">🤖</div>
                        <h4>你好，我是專甘管 AI 助理</h4>
                        <p>我可以幫你查詢專案狀態、分析風險、檢視工作負載。快來問我問題吧！</p>
                    </div>
                </div>

                <div class="agent-input-area">
                    <div class="agent-quick-actions">
                        <button class="agent-quick-btn" data-msg="目前所有專案狀態如何？">📊 專案總覽</button>
                        <button class="agent-quick-btn" data-msg="有哪些逾期的任務？">⚠️ 風險掃描</button>
                        <button class="agent-quick-btn" data-msg="各部門的工作負載如何？">👥 工作負載</button>
                        <button class="agent-quick-btn" data-msg="今天有哪些待辦事項？">📋 今日待辦</button>
                    </div>
                    <div class="agent-input-wrapper">
                        <textarea id="agent-input" class="agent-input" placeholder="輸入問題..." rows="1"></textarea>
                        <button id="agent-send" class="agent-send-btn" disabled>
                            <span>➤</span>
                        </button>
                    </div>
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
        const quickBtns = this.container.querySelectorAll('.agent-quick-btn');

        toggle.addEventListener('click', () => this.togglePanel());
        close.addEventListener('click', () => this.togglePanel(false));
        clear.addEventListener('click', () => this.clearChat());
        send.addEventListener('click', () => this.sendMessage());

        input.addEventListener('input', () => {
            send.disabled = !input.value.trim();
            // Auto-resize textarea
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.value.trim()) this.sendMessage();
            }
        });

        quickBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const msg = (btn as HTMLElement).dataset.msg;
                if (msg) {
                    input.value = msg;
                    this.sendMessage();
                }
            });
        });

        // Custom Select Logic
        const customSelect = this.container.querySelector('#agent-custom-select');
        const trigger = this.container.querySelector('.agent-custom-select-trigger');
        const options = this.container.querySelectorAll('.agent-custom-option');

        if (customSelect && trigger) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                customSelect.classList.toggle('open');
            });

            options.forEach(option => {
                option.addEventListener('click', async (e) => {
                    const el = e.currentTarget as HTMLElement;
                    const newProvider = el.dataset.value;
                    const textContent = el.textContent;

                    if (!newProvider) return;

                    customSelect.classList.remove('open');

                    try {
                        const res = await fetch(`${AGENT_API}/api/agent/provider`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ provider: newProvider })
                        });
                        const data = await res.json();
                        if (!data.success) {
                            alert(`切換失敗: ${data.error}`);
                            this.fetchProvider(); // Revert visually
                        } else {
                            console.log(`Switched provider to: ${data.provider}`);
                            // Update visually immediately
                            const providerText = this.container.querySelector('.agent-custom-select-text');
                            if (providerText && textContent) providerText.textContent = textContent;

                            options.forEach(opt => opt.classList.remove('active'));
                            el.classList.add('active');
                        }
                    } catch (err) {
                        console.error('Failed to change provider', err);
                        alert('切換失敗，請檢查網路連線或 API Key 設定。');
                        this.fetchProvider(); // Revert visually
                    }
                });
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!customSelect.contains(e.target as Node)) {
                    customSelect.classList.remove('open');
                }
            });
        }
    }

    private togglePanel(open?: boolean) {
        this.isOpen = open !== undefined ? open : !this.isOpen;
        const panel = this.container.querySelector('#agent-panel') as HTMLElement;
        const toggle = this.container.querySelector('#agent-toggle') as HTMLElement;

        if (this.isOpen) {
            panel.classList.add('open');
            toggle.classList.add('hidden');
            const input = this.container.querySelector('#agent-input') as HTMLTextAreaElement;
            setTimeout(() => input.focus(), 300);
        } else {
            panel.classList.remove('open');
            toggle.classList.remove('hidden');
        }
    }

    private async sendMessage() {
        const input = this.container.querySelector('#agent-input') as HTMLTextAreaElement;
        const message = input.value.trim();
        if (!message || this.isLoading) return;

        // Clear input
        input.value = '';
        input.style.height = 'auto';
        (this.container.querySelector('#agent-send') as HTMLButtonElement).disabled = true;

        // Hide welcome if first message
        const welcome = this.container.querySelector('.agent-welcome');
        if (welcome) welcome.remove();

        // Add user message
        this.addMessage('user', message);

        // Show loading
        this.isLoading = true;
        const loadingEl = this.addLoading();

        try {
            const res = await fetch(`${AGENT_API}/api/agent/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, sessionId: this.sessionId }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            loadingEl.remove();
            this.addMessage('agent', data.reply, data.tools_called?.map((t: any) => t.name));
        } catch (err: any) {
            loadingEl.remove();
            this.addMessage('agent', `❌ 發生錯誤：${err.message}`);
        } finally {
            this.isLoading = false;
        }
    }

    private addMessage(role: 'user' | 'agent', content: string, toolsCalled?: string[]) {
        const messagesEl = this.container.querySelector('#agent-messages') as HTMLElement;
        const msgEl = document.createElement('div');
        msgEl.className = `agent-msg agent-msg-${role}`;

        // Simple markdown-like formatting
        let formatted = this.formatContent(content);

        let toolBadges = '';
        if (toolsCalled && toolsCalled.length > 0) {
            const toolNames: Record<string, string> = {
                query_projects: '📊 專案查詢',
                query_project_detail: '🔍 專案詳情',
                query_workload: '👥 工作負載',
                query_risks: '⚠️ 風險掃描',
                query_timeline: '📅 時間軸',
                query_changelog: '📝 變更紀錄',
            };
            toolBadges = `<div class="agent-tool-badges">${toolsCalled.map(t => `<span class="agent-tool-badge">${toolNames[t] || t}</span>`).join('')}</div>`;
        }

        msgEl.innerHTML = `
            <div class="agent-msg-bubble">
                ${role === 'agent' ? '<span class="agent-msg-avatar">🤖</span>' : ''}
                <div class="agent-msg-content">
                    ${toolBadges}
                    <div class="agent-msg-text">${formatted}</div>
                </div>
            </div>
        `;

        messagesEl.appendChild(msgEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        this.messages.push({ role, content, timestamp: new Date(), toolsCalled });
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
        // Escape HTML
        let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Bold: **text**
        s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Code blocks: ```...```
        s = s.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

        // Inline code: `text`
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Line breaks
        s = s.replace(/\n/g, '<br>');

        // Tables: detect | separated lines
        // (basic support)
        const lines = s.split('<br>');
        let inTable = false;
        let tableHtml = '';
        const result: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                if (!inTable) {
                    inTable = true;
                    tableHtml = '<table class="agent-table">';
                }
                const cells = trimmed.split('|').filter(c => c.trim());
                if (cells.every(c => /^[-:]+$/.test(c.trim()))) continue; // separator row
                const tag = tableHtml.includes('<tr>') ? 'td' : 'th';
                tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
            } else {
                if (inTable) {
                    tableHtml += '</table>';
                    result.push(tableHtml);
                    tableHtml = '';
                    inTable = false;
                }
                result.push(line);
            }
        }
        if (inTable) {
            tableHtml += '</table>';
            result.push(tableHtml);
        }

        return result.join('<br>');
    }

    private async clearChat() {
        try {
            await fetch(`${AGENT_API}/api/agent/clear`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId }),
            });
        } catch (e) { /* ignore */ }

        this.messages = [];
        this.sessionId = `session_${Date.now()}`;

        const messagesEl = this.container.querySelector('#agent-messages') as HTMLElement;
        messagesEl.innerHTML = `
            <div class="agent-welcome">
                <div class="agent-welcome-icon">🤖</div>
                <h4>你好，我是專甘管 AI 助理</h4>
                <p>我可以幫你查詢專案狀態、分析風險、檢視工作負載。快來問我問題吧！</p>
            </div>
        `;
        // Quick buttons are permanent now, no need to re-bind
    }
}
