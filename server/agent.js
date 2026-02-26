/**
 * AI Agent Module — 專甘管 (支援 Gemini & Groq)
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// ─── AI Setup ────────────────────────────────────────────
let provider = 'gemini'; // default
let geminiModel = null;
let groqClient = null;

function initAgent() {
    provider = (process.env.AGENT_LLM_PROVIDER || 'gemini').toLowerCase();
    let hasAnyProvider = false;

    // Initialize Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
        const genAI = new GoogleGenerativeAI(geminiKey);
        geminiModel = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: SYSTEM_PROMPT,
            tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } }
        });
        hasAnyProvider = true;
    } else {
        console.warn('⚠️ GEMINI_API_KEY not set');
    }

    // Initialize Groq
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
        groqClient = new Groq({ apiKey: groqKey });
        hasAnyProvider = true;
    } else {
        console.warn('⚠️ GROQ_API_KEY not set');
    }

    if (!hasAnyProvider) {
        console.warn('⚠️ No AI API keys set — Agent is fully disabled');
        return false;
    }

    console.log(`🤖 AI Agent initialized. Default provider: ${provider}`);
    return true;
}

// ─── System Prompt ───────────────────────────────────────────
const SYSTEM_PROMPT = `你是「專甘管」專案管理系統的 AI 助理。你的職責是幫助使用者查詢專案資訊、分析風險、評估工作負載。

## ⚠️ 核心指令 (CRITICAL)
你現在沒有任何專案資料！當使用者提問時，你**必須**且**一定**要先呼叫工具 (Tools) 來取得系統中的即時數據。絕對不能用「請問你想查詢什麼專案」、「請告訴我專案名稱」等話術推託。
- 使用者問「今天的工作進度」、「所有專案狀態」 -> 呼叫 \`query_projects\`
- 使用者問特定專案 -> 呼叫 \`query_project_detail\`
- 使用者問「現在誰比較忙」、「工作負載」 -> 呼叫 \`query_workload\`
- 使用者問「有沒有風險」、「哪些快到期」 -> 呼叫 \`query_risks\`
- 使用者問「時間軸」、「工作密度」 -> 呼叫 \`query_timeline\`
- 使用者問「變更紀錄」 -> 呼叫 \`query_changelog\`

## 行為準則
1. 呼叫工具後，根據回傳的 JSON 數據詳細回答。
2. 用繁體中文回覆，語氣專業但親切。
3. 回覆要精簡有力，使用 emoji 讓重點更醒目。
4. 數據要精確，如果查詢結果為空，明確告知使用者。
5. 日期格式使用 M/d（如 2/25）。
6. 百分比保留整數。
7. 主動提供分析觀點和建議。

## 回覆格式建議
- 使用表格呈現多專案比較
- 使用條列清單呈現任務明細
- 使用 ⚠️🔴🟡🟢 表示風險等級
- 使用 📊📋🔍💡 標示不同類型的資訊`;

// ─── Tool Declarations ────────────────────────────────────────
const TOOL_DECLARATIONS = [
    {
        name: 'query_projects',
        description: '查詢所有專案的狀態摘要，包含名稱、時程、完成率、逾期狀況。可選擇篩選條件與排序方式。',
        parameters: {
            type: "object",
            properties: {
                status_filter: {
                    type: "string",
                    description: '狀態篩選：all=全部, active=進行中, completed=已完成, delayed=逾期',
                    enum: ['all', 'active', 'completed', 'delayed'],
                },
                sort_by: {
                    type: "string",
                    description: '排序方式：end_date=結案日, progress=進度, name=名稱',
                    enum: ['end_date', 'progress', 'name'],
                },
            },
        },
    },
    {
        name: 'query_project_detail',
        description: '取得特定專案的完整結構，包含所有階段、任務、子任務的狀態與時程。支援模糊搜尋專案名稱。',
        parameters: {
            type: "object",
            properties: {
                project_name: {
                    type: "string",
                    description: '專案名稱（支援模糊匹配）',
                },
            },
            required: ['project_name'],
        },
    },
    {
        name: 'query_workload',
        description: '分析各部門或各專案的工作負載，找出過載或閒置的團隊。',
        parameters: {
            type: "object",
            properties: {
                group_by: {
                    type: "string",
                    description: '分組方式：department=按部門, project=按專案',
                    enum: ['department', 'project'],
                },
                time_range: {
                    type: "string",
                    description: '時間範圍：this_week=本週, this_month=本月, all=全部',
                    enum: ['this_week', 'this_month', 'all'],
                },
            },
        },
    },
    {
        name: 'query_risks',
        description: '掃描所有進行中專案的風險，包括逾期任務、瓶頸階段、進度落後項目。',
        parameters: {
            type: "object",
            properties: {
                risk_level: {
                    type: "string",
                    description: '風險等級篩選：all=全部, high=高, medium=中, low=低',
                    enum: ['all', 'high', 'medium', 'low'],
                },
            },
        },
    },
    {
        name: 'query_timeline',
        description: '分析指定時間區間內的任務密度、衝突、閒置時段。',
        parameters: {
            type: "object",
            properties: {
                start_date: {
                    type: "string",
                    description: '開始日期 (ISO 格式，如 2026-02-01)',
                },
                end_date: {
                    type: "string",
                    description: '結束日期 (ISO 格式，如 2026-03-01)',
                },
                department: {
                    type: "string",
                    description: '篩選特定部門（可選）',
                },
            },
            required: ['start_date', 'end_date'],
        },
    },
    {
        name: 'query_changelog',
        description: '查詢專案的歷史變更紀錄，包含延期原因、日期調整等。',
        parameters: {
            type: "object",
            properties: {
                project_name: {
                    type: "string",
                    description: '專案名稱（支援模糊匹配）',
                },
            },
            required: ['project_name'],
        },
    },
];

// 針對 Groq API 的 tool format
const GROQ_TOOLS = TOOL_DECLARATIONS.map(decl => ({
    type: "function",
    function: {
        name: decl.name,
        description: decl.description,
        parameters: decl.parameters
    }
}));

// ─── Tool Implementations ─────────────────────────────────────

function executeQueryProjects(db, args) {
    const { status_filter = 'all', sort_by = 'end_date' } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const now = new Date();

    const result = projects.map(project => {
        const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY "order"').all(project.id);
        let totalTasks = 0, completedTasks = 0;

        stages.forEach(stage => {
            const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
            totalTasks += tasks.length;
            completedTasks += tasks.filter(t => t.status === 'completed').length;
        });

        const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        const isDelayed = project.end_date && new Date(project.end_date) < now && pct < 100 && project.status === 'active';

        return {
            id: project.id,
            name: project.name,
            start_date: project.start_date,
            end_date: project.end_date,
            project_status: project.status,
            total_tasks: totalTasks,
            completed_tasks: completedTasks,
            completion_pct: pct,
            is_delayed: isDelayed,
        };
    });

    // Filter
    let filtered = result;
    if (status_filter === 'active') filtered = result.filter(p => p.project_status === 'active');
    else if (status_filter === 'completed') filtered = result.filter(p => p.completion_pct === 100 || p.project_status === 'closed');
    else if (status_filter === 'delayed') filtered = result.filter(p => p.is_delayed);

    // Sort
    if (sort_by === 'end_date') filtered.sort((a, b) => new Date(a.end_date || '9999-12-31') - new Date(b.end_date || '9999-12-31'));
    else if (sort_by === 'progress') filtered.sort((a, b) => a.completion_pct - b.completion_pct);
    else if (sort_by === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));

    return { total: filtered.length, projects: filtered };
}

function executeQueryProjectDetail(db, args) {
    const { project_name } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = projects.find(p => p.name.includes(project_name) || project_name.includes(p.name));

    if (!match) return { error: `找不到名稱包含「${project_name}」的專案` };

    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY "order"').all(match.id);

    function buildTaskTree(tasks, parentId = null) {
        return tasks
            .filter(t => t.parent_task_id === parentId)
            .map(t => ({
                id: t.id,
                name: t.name,
                department: t.department,
                start_date: t.start_date,
                end_date: t.end_date,
                status: t.status,
                progress: t.progress,
                children: buildTaskTree(tasks, t.id),
            }));
    }

    const stageDetails = stages.map(stage => {
        const allTasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
        const total = allTasks.length;
        const completed = allTasks.filter(t => t.status === 'completed').length;

        return {
            id: stage.id,
            name: stage.name,
            start_date: stage.start_date,
            end_date: stage.end_date,
            total_tasks: total,
            completed_tasks: completed,
            completion_pct: total > 0 ? Math.round((completed / total) * 100) : 0,
            tasks: buildTaskTree(allTasks),
        };
    });

    const totalTasks = stageDetails.reduce((s, st) => s + st.total_tasks, 0);
    const completedTasks = stageDetails.reduce((s, st) => s + st.completed_tasks, 0);

    return {
        id: match.id,
        name: match.name,
        start_date: match.start_date,
        end_date: match.end_date,
        project_status: match.status,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        completion_pct: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        stages: stageDetails,
    };
}

function executeQueryWorkload(db, args) {
    const { group_by = 'department', time_range = 'all' } = args;
    const now = new Date();
    let startFilter = null, endFilter = null;

    if (time_range === 'this_week') {
        const day = now.getDay();
        startFilter = new Date(now);
        startFilter.setDate(now.getDate() - day);
        endFilter = new Date(startFilter);
        endFilter.setDate(startFilter.getDate() + 6);
    } else if (time_range === 'this_month') {
        startFilter = new Date(now.getFullYear(), now.getMonth(), 1);
        endFilter = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    const activeProjects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
    const allTasks = [];

    activeProjects.forEach(project => {
        const stages = db.prepare('SELECT * FROM stages WHERE project_id = ?').all(project.id);
        stages.forEach(stage => {
            const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
            tasks.forEach(t => {
                if (startFilter && endFilter) {
                    const tStart = new Date(t.start_date);
                    const tEnd = new Date(t.end_date);
                    if (tEnd < startFilter || tStart > endFilter) return;
                }
                allTasks.push({ ...t, project_name: project.name, stage_name: stage.name });
            });
        });
    });

    if (group_by === 'department') {
        const groups = {};
        allTasks.forEach(t => {
            const dept = t.department || '未指定';
            if (!groups[dept]) groups[dept] = { total: 0, completed: 0, pending: 0, delayed: 0, tasks: [] };
            groups[dept].total++;
            if (t.status === 'completed') groups[dept].completed++;
            else {
                groups[dept].pending++;
                if (new Date(t.end_date) < now) groups[dept].delayed++;
            }
            groups[dept].tasks.push({ name: t.name, project: t.project_name, status: t.status, end_date: t.end_date });
        });
        return { group_by: 'department', time_range, workload: groups };
    } else {
        const groups = {};
        allTasks.forEach(t => {
            const proj = t.project_name;
            if (!groups[proj]) groups[proj] = { total: 0, completed: 0, pending: 0, delayed: 0 };
            groups[proj].total++;
            if (t.status === 'completed') groups[proj].completed++;
            else {
                groups[proj].pending++;
                if (new Date(t.end_date) < now) groups[proj].delayed++;
            }
        });
        return { group_by: 'project', time_range, workload: groups };
    }
}

function executeQueryRisks(db, args) {
    const { risk_level = 'all' } = args;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const activeProjects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
    const risks = [];

    activeProjects.forEach(project => {
        const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY "order"').all(project.id);
        let totalTasks = 0, completedTasks = 0;

        // Project-level check
        if (project.end_date && new Date(project.end_date) < now) {
            risks.push({
                level: 'high',
                type: 'project_overdue',
                project: project.name,
                message: `專案已逾期（結案日：${project.end_date.slice(0, 10)}）`,
                days_overdue: Math.ceil((now - new Date(project.end_date)) / 86400000),
            });
        }

        stages.forEach(stage => {
            const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
            totalTasks += tasks.length;

            // Stage-level check
            const stageComplete = tasks.filter(t => t.status === 'completed').length;
            completedTasks += stageComplete;
            if (stage.end_date && new Date(stage.end_date) < now && stageComplete < tasks.length) {
                risks.push({
                    level: 'high',
                    type: 'stage_overdue',
                    project: project.name,
                    stage: stage.name,
                    message: `階段逾期，${tasks.length - stageComplete} 個任務未完成`,
                });
            }

            // Task-level check
            tasks.forEach(t => {
                if (t.status !== 'completed' && t.end_date && new Date(t.end_date) < now) {
                    const daysOverdue = Math.ceil((now - new Date(t.end_date)) / 86400000);
                    risks.push({
                        level: daysOverdue > 7 ? 'high' : daysOverdue > 3 ? 'medium' : 'low',
                        type: 'task_overdue',
                        project: project.name,
                        stage: stage.name,
                        task: t.name,
                        department: t.department,
                        message: `任務逾期 ${daysOverdue} 天`,
                        days_overdue: daysOverdue,
                    });
                }
            });
        });

        // Progress check
        const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        if (project.end_date) {
            const totalDuration = (new Date(project.end_date) - new Date(project.start_date)) / 86400000;
            const elapsed = (now - new Date(project.start_date)) / 86400000;
            const expectedPct = Math.min(100, Math.round((elapsed / totalDuration) * 100));
            if (pct < expectedPct - 20 && totalTasks > 0) {
                risks.push({
                    level: 'medium',
                    type: 'progress_behind',
                    project: project.name,
                    message: `進度落後：實際 ${pct}% vs 預期 ${expectedPct}%`,
                });
            }
        }
    });

    // Filter by level
    let filtered = risks;
    if (risk_level !== 'all') filtered = risks.filter(r => r.level === risk_level);

    // Sort: high > medium > low
    const order = { high: 0, medium: 1, low: 2 };
    filtered.sort((a, b) => order[a.level] - order[b.level]);

    return {
        total_risks: filtered.length,
        high: filtered.filter(r => r.level === 'high').length,
        medium: filtered.filter(r => r.level === 'medium').length,
        low: filtered.filter(r => r.level === 'low').length,
        risks: filtered,
    };
}

function executeQueryTimeline(db, args) {
    const { start_date, end_date, department } = args;
    const rangeStart = new Date(start_date);
    const rangeEnd = new Date(end_date);
    const activeProjects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
    const tasksInRange = [];

    activeProjects.forEach(project => {
        const stages = db.prepare('SELECT * FROM stages WHERE project_id = ?').all(project.id);
        stages.forEach(stage => {
            const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
            tasks.forEach(t => {
                const tStart = new Date(t.start_date);
                const tEnd = new Date(t.end_date);
                if (tEnd < rangeStart || tStart > rangeEnd) return;
                if (department && t.department !== department) return;
                tasksInRange.push({
                    name: t.name,
                    project: project.name,
                    stage: stage.name,
                    department: t.department,
                    start_date: t.start_date,
                    end_date: t.end_date,
                    status: t.status,
                });
            });
        });
    });

    // Daily density
    const totalDays = Math.ceil((rangeEnd - rangeStart) / 86400000);
    const dailyCount = {};
    for (let d = 0; d <= totalDays; d++) {
        const date = new Date(rangeStart);
        date.setDate(date.getDate() + d);
        const key = date.toISOString().slice(0, 10);
        dailyCount[key] = 0;
    }

    tasksInRange.forEach(t => {
        const tStart = new Date(t.start_date);
        const tEnd = new Date(t.end_date);
        for (let d = new Date(Math.max(tStart, rangeStart)); d <= Math.min(tEnd, rangeEnd); d.setDate(d.getDate() + 1)) {
            const key = d.toISOString().slice(0, 10);
            if (dailyCount[key] !== undefined) dailyCount[key]++;
        }
    });

    const peakDay = Object.entries(dailyCount).sort((a, b) => b[1] - a[1])[0];
    const idleDays = Object.entries(dailyCount).filter(([, c]) => c === 0).map(([d]) => d);

    return {
        range: { start: start_date, end: end_date },
        total_tasks: tasksInRange.length,
        peak_day: peakDay ? { date: peakDay[0], count: peakDay[1] } : null,
        idle_days_count: idleDays.length,
        idle_days: idleDays.slice(0, 10),
        tasks: tasksInRange,
    };
}

function executeQueryChangelog(db, args) {
    const { project_name } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = projects.find(p => p.name.includes(project_name) || project_name.includes(p.name));

    if (!match) return { error: `找不到名稱包含「${project_name}」的專案` };

    const logs = db.prepare('SELECT * FROM project_logs WHERE project_id = ? ORDER BY created_at DESC').all(match.id);

    return {
        project: match.name,
        total_changes: logs.length,
        logs: logs.map(l => ({
            reason: l.reason,
            old_end_date: l.old_end_date,
            new_end_date: l.new_end_date,
            changed_at: l.created_at,
        })),
    };
}

// ─── Tool Router ──────────────────────────────────────────────
const TOOL_MAP = {
    query_projects: executeQueryProjects,
    query_project_detail: executeQueryProjectDetail,
    query_workload: executeQueryWorkload,
    query_risks: executeQueryRisks,
    query_timeline: executeQueryTimeline,
    query_changelog: executeQueryChangelog,
};

// ─── Chat Handlers ─────────────────────────────────────────────
const geminiConversations = new Map();
const groqConversations = new Map();

async function handleGeminiChat(db, sessionId, userMessage) {
    if (!geminiModel) return { reply: '⚠️ Gemini 設定缺失', tools_called: [] };
    if (!geminiConversations.has(sessionId)) geminiConversations.set(sessionId, []);

    const history = geminiConversations.get(sessionId);
    const chat = geminiModel.startChat({ history });

    const toolsCalled = [];
    let response = await chat.sendMessage(userMessage);

    // Function Calling loop
    while (response.response.candidates?.[0]?.content?.parts) {
        const parts = response.response.candidates[0].content.parts;
        const functionCalls = parts.filter(p => p.functionCall);

        if (functionCalls.length === 0) break;

        const toolResults = [];
        for (const part of functionCalls) {
            const { name, args } = part.functionCall;
            console.log(`🔧 [Gemini] Tool called: ${name}`, JSON.stringify(args));

            const toolFn = TOOL_MAP[name];
            let result = toolFn ? (await Promise.resolve(toolFn(db, args || {}))) : { error: `未知工具：${name}` };

            toolsCalled.push({ name, args, result_summary: typeof result === 'object' ? Object.keys(result) : 'string' });
            toolResults.push({ functionResponse: { name, response: result } });
        }

        // Send tool results back to LLM
        response = await chat.sendMessage(toolResults);
    }

    const reply = response.response.text() || '🤔 無法生成回覆，請再試一次。';

    const updatedHistory = await chat.getHistory();
    geminiConversations.set(sessionId, updatedHistory.length > 40 ? updatedHistory.slice(-40) : updatedHistory);

    return { reply, tools_called: toolsCalled };
}

async function handleGroqChat(db, sessionId, userMessage) {
    if (!groqClient) return { reply: '⚠️ Groq 設定缺失', tools_called: [] };
    if (!groqConversations.has(sessionId)) {
        groqConversations.set(sessionId, [{ role: 'system', content: SYSTEM_PROMPT }]);
    }

    const messages = groqConversations.get(sessionId);
    messages.push({ role: 'user', content: userMessage });

    const toolsCalled = [];
    let isToolCalling = true;

    while (isToolCalling) {
        let response;
        try {
            response = await groqClient.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: messages,
                tools: GROQ_TOOLS,
                tool_choice: "auto",
                max_tokens: 4096
            });
        } catch (err) {
            console.error(err);
            return { reply: `❌ API Error: ${err.message}`, tools_called: toolsCalled };
        }

        const responseMessage = response.choices[0].message;
        const toolCalls = responseMessage.tool_calls;

        messages.push(responseMessage); // Add assistant response to history

        if (!toolCalls || toolCalls.length === 0) {
            isToolCalling = false;
        } else {
            // Processing tool calls
            for (const toolCall of toolCalls) {
                const name = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`🔧 [Groq] Tool called: ${name}`, JSON.stringify(args));

                const toolFn = TOOL_MAP[name];
                let result;
                try {
                    result = toolFn ? toolFn(db, args || {}) : { error: `未知工具：${name}` };
                } catch (e) {
                    result = { error: `工具執行失敗：${e.message}` };
                }

                toolsCalled.push({ name, args, result_summary: typeof result === 'object' ? Object.keys(result) : 'string' });
                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: name,
                    content: JSON.stringify(result),
                });
            }
        }
    }

    const reply = messages[messages.length - 1].content || '🤔 無法生成回覆，請再試一次。';

    // Prune history if too long to save context limits
    if (messages.length > 40) {
        const systemMsg = messages[0];
        const recentHistory = messages.slice(-39);
        groqConversations.set(sessionId, [systemMsg, ...recentHistory]);
    }

    return { reply, tools_called: toolsCalled };
}

async function handleChat(db, sessionId, userMessage) {
    if (provider === 'gemini') {
        return await handleGeminiChat(db, sessionId, userMessage);
    } else if (provider === 'groq') {
        return await handleGroqChat(db, sessionId, userMessage);
    }
    return { reply: '⚠️ 未知 Provider，請檢查 AGENT_LLM_PROVIDER 設定', tools_called: [] };
}

function clearConversation(sessionId) {
    if (provider === 'gemini') geminiConversations.delete(sessionId);
    if (provider === 'groq') groqConversations.delete(sessionId);
}

function getActiveProvider() {
    return provider;
}

function setProvider(newProvider) {
    if (newProvider === 'gemini' && !geminiModel) {
        throw new Error('Gemini API 金鑰未設定');
    }
    if (newProvider === 'groq' && !groqClient) {
        throw new Error('Groq API 金鑰未設定');
    }
    if (newProvider !== 'gemini' && newProvider !== 'groq') {
        throw new Error('未知的 Provider: ' + newProvider);
    }
    provider = newProvider;
    console.log(`🔄 AI Provider switched to: ${provider}`);
}

module.exports = { initAgent, handleChat, clearConversation, getActiveProvider, setProvider };
