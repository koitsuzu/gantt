/**
 * Operator Agent — 專甘管 執行操作員 (獨立 LLM 實例)
 * 負責：新增、修改、刪除、結案等 CUD 操作
 * 與查詢型 agent.js 完全隔離
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// ─── 獨立 LLM Setup ─────────────────────────────────────
let operatorProvider = 'gemini';
let operatorGeminiModel = null;
let operatorGroqClient = null;

function initOperatorAgent() {
    operatorProvider = (process.env.AGENT_LLM_PROVIDER || 'gemini').toLowerCase();
    let hasAny = false;

    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
        const genAI = new GoogleGenerativeAI(geminiKey);
        operatorGeminiModel = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: OPERATOR_SYSTEM_PROMPT,
            tools: [{ functionDeclarations: OPERATOR_TOOL_DECLARATIONS }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } }
        });
        hasAny = true;
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
        operatorGroqClient = new Groq({ apiKey: groqKey });
        hasAny = true;
    }

    if (!hasAny) {
        console.warn('⚠️ Operator Agent: No API keys — disabled');
        return false;
    }
    console.log(`🔧 Operator Agent initialized. Provider: ${operatorProvider}`);
    return true;
}

// ─── System Prompt ───────────────────────────────────────
const OPERATOR_SYSTEM_PROMPT = `你是「專甘管」系統的 **執行操作員 AI**。你的職責是幫助使用者**實際執行**專案的新增、修改、刪除、結案等操作。

## ⚠️⚠️⚠️ 最高優先規則 — 絕對禁止未經確認就呼叫 CUD 工具 ⚠️⚠️⚠️

你**絕對不可以**在使用者明確說出「確認」、「OK」、「好」、「執行」之前呼叫以下任何工具：
add_project, add_stage, add_sub_task, update_task, update_stage, close_project, reopen_project, delete_project, delete_stage, delete_task

違反此規則 = 嚴重錯誤。你只能先使用 query_projects 或 query_project_detail 來查詢資料，然後**用純文字回覆**列出待執行明細。

### 🕒 日期推算防呆基準
**當前伺服器真實時間為：${new Date().toLocaleString('zh-TW')}**。
若使用者要求新增或修改任務，且提到「今天」「明天」「下週」「本月」等時間詞，**必須**以上述日期為絕對基準進行推演。嚴禁自行假設年份為 2000 年或 1970 年。

## 核心工作流程

### 第一步：理解意圖與溫柔引導
判斷使用者是否有 CUD 意圖。如果是純查詢問題，回覆：「查詢相關問題請用 @顧問 詢問，我是負責執行操作的助手。」
如果使用者有異動意圖，但**資訊極度缺乏**（例如只說「刪除任務」卻沒說哪個）：
1. **溫柔詢問**：請以親切、如同真人助理般的口吻，主動猜測使用者的意圖並向其確認。
2. **提供快捷選項**：在回覆的最後換行，使用 \`[選項] 建議的完整指令\` 格式，列出 1~3 個最可能的意圖供點擊。
   *範例*：
   「您剛剛提到『刪除』，請問是要刪除剛剛提到的『API 開發』子任務嗎？還是其他專案呢？😊」
   \`[選項] 刪除 API 開發任務\`
   \`[選項] 刪除其他專案的任務\`
（如果資訊足夠，則進入第二步）

### 第二步：查詢現有資料
呼叫 query_projects（預設只查詢 active 狀態）或 query_project_detail 來確認目標專案/階段/任務是否存在。
**已關閉（closed）的專案不要顯示給使用者，除非使用者明確要求查看。**

### 第三步：列出待執行明細（純文字，不呼叫 CUD 工具！）
用以下格式整理出操作明細，讓使用者確認：

📋 待執行操作確認

🔹 操作類型：新增子任務
🔹 專案：A 專案
🔹 階段：開發階段
🔹 任務名稱：前端測試
🔹 部門：品管部門
🔹 起始日：3/3
🔹 截止日：3/10

⚠️ 請確認以上內容無誤後，輸入「確認」來執行。

如有缺少的資訊（部門、日期等），主動詢問使用者。

### 第四步：使用者補充或修改
如果使用者補充或修改資訊（如「改成品管部門」或「日期改 3/5」），更新明細並**重新列出**。仍然不呼叫 CUD 工具。

### 第五步：使用者確認後才呼叫工具（!!CRITICAL!!）
**只有當使用者明確發送「確認」、「OK」、「好」、「執行」等確認詞時**，才呼叫對應的 CUD 工具。
呼叫工具後，系統會自動要求密碼驗證。

### 🔄 批量修改規則（!!重要!!）
當使用者的操作涉及**多個層級**（例如同時修改階段日期和子任務日期），你**必須在確認後逐一呼叫所有需要的工具，不要遺漏任何一個**。
- 例如：修改「結案階段」的日期 + 修改「出貨」任務的日期 → 先呼叫 update_stage，再呼叫 update_task。
- **不要害怕日期邊界衝突**：後端資料庫會安全處理所有修改，不會因為中間狀態而失敗。
- **絕對不要**因為「子任務目前超出階段範圍」而拒絕呼叫工具。輸出的結果會是正確的。
- 必須把使用者要求的所有變更**全部執行完**，不要拆成多次確認或跳過任何一項。

## 行為準則
1. 繁體中文回覆，語氣專業但親切
2. 你**不做分析建議**，那是顧問 Agent 的職責
3. 每次操作前必須先列出明細讓使用者確認，**絕對不能跳過確認步驟**
4. 日期格式使用 M/d（如 3/3）
5. 使用 emoji 讓重點醒目
6. 對於刪除操作，一定要加上 ⚠️ 此操作不可撤回 的警語
7. query_projects 預設只查 active 專案，不顯示 closed 的
8. 你**只能使用以下工具**，不要嘗試呼叫任何其他工具：
   查詢：query_projects、query_project_detail、query_departments
   執行：add_project、add_stage、add_sub_task、update_task、update_stage、close_project、reopen_project、delete_project、delete_stage、delete_task
9. 如果遇到不確定的資訊（如日期、部門），直接詢問使用者，不要猜測
10. 使用者確認後，你**必須一次性呼叫所有需要的工具**，不可拆分或遺漏`;


// ─── Tool Declarations ───────────────────────────────────
const OPERATOR_TOOL_DECLARATIONS = [
    // 查詢工具（操作前需要先查詢現有資料）
    {
        name: 'query_projects',
        description: '查詢所有專案的狀態摘要，用於操作前確認專案存在與狀態。',
        parameters: {
            type: "object",
            properties: {
                status_filter: {
                    type: "string",
                    description: '狀態篩選：all=全部, active=進行中, closed=已結案',
                    enum: ['all', 'active', 'closed'],
                },
            },
        },
    },
    {
        name: 'query_project_detail',
        description: '取得特定專案的完整結構（階段、子任務），用於在操作前確認目標。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱（支援模糊匹配）' },
            },
            required: ['project_name'],
        },
    },
    {
        name: 'query_departments',
        description: '查詢所有可用的部門列表，用於為新任務指定部門。',
        parameters: { type: "object", properties: {} },
    },
    // CUD 工具
    {
        name: 'add_project',
        description: '新增一個專案，包含名稱、日期與階段。需要使用者確認後執行。',
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: '專案名稱' },
                start_date: { type: "string", description: '開始日期 (ISO 格式)' },
                end_date: { type: "string", description: '結束日期 (ISO 格式)' },
                stages: {
                    type: "array",
                    description: '階段列表',
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string", description: '階段名稱' },
                            days: { type: "number", description: '天數' },
                        },
                        required: ['name', 'days'],
                    },
                },
            },
            required: ['name', 'start_date', 'stages'],
        },
    },
    {
        name: 'add_stage',
        description: '為現有專案新增一個階段。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱' },
                stage_name: { type: "string", description: '階段名稱' },
                start_date: { type: "string", description: '開始日期 (ISO)' },
                end_date: { type: "string", description: '結束日期 (ISO)' },
            },
            required: ['project_name', 'stage_name', 'start_date', 'end_date'],
        },
    },
    {
        name: 'add_sub_task',
        description: '為現有階段新增一個子任務。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱' },
                stage_name: { type: "string", description: '階段名稱' },
                task_name: { type: "string", description: '子任務名稱' },
                department: { type: "string", description: '所屬部門' },
                start_date: { type: "string", description: '開始日期 (ISO)' },
                end_date: { type: "string", description: '結束日期 (ISO)' },
            },
            required: ['project_name', 'stage_name', 'task_name', 'start_date', 'end_date'],
        },
    },
    {
        name: 'update_task',
        description: '修改現有子任務的日期或狀態。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱' },
                task_name: { type: "string", description: '子任務名稱' },
                new_start_date: { type: "string", description: '新開始日期 (ISO，可選)' },
                new_end_date: { type: "string", description: '新結束日期 (ISO，可選)' },
                new_status: { type: "string", description: '新狀態 (pending/completed，可選)', enum: ['pending', 'completed'] },
            },
            required: ['project_name', 'task_name'],
        },
    },
    {
        name: 'update_stage',
        description: '修改現有階段的日期。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱' },
                stage_name: { type: "string", description: '階段名稱' },
                new_start_date: { type: "string", description: '新開始日期 (ISO)' },
                new_end_date: { type: "string", description: '新結束日期 (ISO)' },
            },
            required: ['project_name', 'stage_name'],
        },
    },
    {
        name: 'close_project',
        description: '結案專案（設為 closed 狀態，從主畫面隱藏）。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱' },
            },
            required: ['project_name'],
        },
    },
    {
        name: 'reopen_project',
        description: '解除結案（重新設為 active 狀態）。此操作需要管理員密碼。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱' },
            },
            required: ['project_name'],
        },
    },
    {
        name: 'delete_project',
        description: '永久刪除整個專案及其所有階段與子任務。此操作不可撤回，需要管理員密碼。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱' },
            },
            required: ['project_name'],
        },
    },
    {
        name: 'delete_stage',
        description: '刪除特定階段。此操作將連帶刪除該階段底下所有的子任務。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱' },
                stage_name: { type: "string", description: '階段名稱' },
            },
            required: ['project_name', 'stage_name'],
        },
    },
    {
        name: 'delete_task',
        description: '刪除特定子任務。',
        parameters: {
            type: "object",
            properties: {
                project_name: { type: "string", description: '專案名稱' },
                task_name: { type: "string", description: '子任務名稱' },
            },
            required: ['project_name', 'task_name'],
        },
    },
];

// Groq format
const GROQ_OPERATOR_TOOLS = OPERATOR_TOOL_DECLARATIONS.map(decl => ({
    type: "function",
    function: { name: decl.name, description: decl.description, parameters: decl.parameters }
}));

// ─── Tool Implementations ─────────────────────────────────
function executeQueryProjects(db, args) {
    const { status_filter = 'active' } = args;
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
        return {
            id: project.id, name: project.name,
            start_date: project.start_date, end_date: project.end_date,
            project_status: project.status || 'active',
            total_tasks: totalTasks, completed_tasks: completedTasks, completion_pct: pct,
        };
    });

    let filtered = result;
    if (status_filter === 'active') filtered = result.filter(p => p.project_status === 'active');
    else if (status_filter === 'closed') filtered = result.filter(p => p.project_status === 'closed');
    return { total: filtered.length, projects: filtered };
}

function executeQueryProjectDetail(db, args) {
    const { project_name } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = projects.find(p => p.name.includes(project_name) || project_name.includes(p.name));
    if (!match) return { error: `找不到名稱包含「${project_name}」的專案` };

    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY "order"').all(match.id);
    const stageDetails = stages.map(stage => {
        const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
        return {
            id: stage.id, name: stage.name,
            start_date: stage.start_date, end_date: stage.end_date,
            tasks: tasks.map(t => ({
                id: t.id, name: t.name, department: t.department,
                start_date: t.start_date, end_date: t.end_date,
                status: t.status,
            })),
        };
    });
    return { id: match.id, name: match.name, start_date: match.start_date, end_date: match.end_date, status: match.status, stages: stageDetails };
}

function executeQueryDepartments(db) {
    const rows = db.prepare('SELECT * FROM departments').all();
    return { departments: rows.map(d => d.name) };
}

// ─── CUD Implementations ──────────────────────────────────

// Helper to securely find target by name (exact first, then shortest includes)
function findBestMatch(list, queryName) {
    if (!queryName) return null;
    const exact = list.find(item => item.name === queryName);
    if (exact) return exact;
    const matches = list.filter(item => item.name.includes(queryName) || queryName.includes(item.name));
    if (matches.length === 0) return null;
    // Return the one with the shortest name to avoid "發包" matching "關模系統發包" when both exist
    return matches.reduce((prev, curr) => prev.name.length < curr.name.length ? prev : curr);
}

function executeAddProject(db, args) {
    const { name, start_date, end_date, stages = [] } = args;
    // Use default userId = 1
    const userId = 1;
    const projectStart = new Date(start_date);

    const insertProject = db.prepare('INSERT INTO projects (user_id, name, start_date, end_date) VALUES (?, ?, ?, ?)');
    const insertStage = db.prepare('INSERT INTO stages (project_id, name, "order", start_date, end_date) VALUES (?, ?, ?, ?, ?)');

    const result = db.transaction(() => {
        const info = insertProject.run(userId, name, projectStart.toISOString(), end_date || null);
        const projectId = info.lastInsertRowid;

        let runningDate = new Date(projectStart);
        stages.forEach((stage, index) => {
            const stageEnd = new Date(runningDate);
            stageEnd.setDate(stageEnd.getDate() + (stage.days || 7));
            insertStage.run(projectId, stage.name, index, runningDate.toISOString(), stageEnd.toISOString());
            runningDate = new Date(stageEnd);
        });
        return projectId;
    })();

    return { success: true, message: `專案「${name}」已成功建立（ID: ${result}）` };
}

function executeAddStage(db, args) {
    const { project_name, stage_name, start_date, end_date } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = findBestMatch(projects, project_name);
    if (!match) return { error: `找不到專案「${project_name}」` };

    // Date validation
    const sStart = new Date(start_date);
    const sEnd = new Date(end_date);
    if (isNaN(sStart.getTime()) || isNaN(sEnd.getTime())) {
        return { error: `日期格式有誤，請使用 YYYY-MM-DD 格式（如 2026-03-03）` };
    }
    if (sStart >= sEnd) {
        return { error: `開始日期 (${start_date}) 必須早於結束日期 (${end_date})` };
    }
    const projStart = new Date(match.start_date);
    const projEnd = match.end_date ? new Date(match.end_date) : null;
    if (sStart < projStart || (projEnd && sEnd > projEnd)) {
        return { error: `階段時間 (${start_date} ~ ${end_date}) 超出專案「${match.name}」的範圍 (${match.start_date.slice(0, 10)} ~ ${projEnd ? match.end_date.slice(0, 10) : '未設定'})。請調整日期或先延長專案時間。` };
    }

    const existingStages = db.prepare('SELECT MAX("order") as maxOrder FROM stages WHERE project_id = ?').get(match.id);
    const order = (existingStages?.maxOrder ?? -1) + 1;

    const info = db.prepare('INSERT INTO stages (project_id, name, "order", start_date, end_date) VALUES (?, ?, ?, ?, ?)')
        .run(match.id, stage_name, order, start_date, end_date);
    return { success: true, message: `階段「${stage_name}」已新增至專案「${match.name}」（ID: ${info.lastInsertRowid}）` };
}

function executeAddSubTask(db, args) {
    const { project_name, stage_name, task_name, department = '', start_date, end_date } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = findBestMatch(projects, project_name);
    if (!match) return { error: `找不到專案「${project_name}」` };

    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ?').all(match.id);
    const stage = findBestMatch(stages, stage_name);
    if (!stage) return { error: `找不到專案「${match.name}」中的階段「${stage_name}」` };

    // Date validation
    const subStart = new Date(start_date);
    const subEnd = new Date(end_date);
    if (isNaN(subStart.getTime()) || isNaN(subEnd.getTime())) {
        return { error: `日期格式有誤，請使用 YYYY-MM-DD 格式（如 2026-03-03）` };
    }
    if (subStart >= subEnd) {
        return { error: `開始日期 (${start_date}) 必須早於結束日期 (${end_date})` };
    }
    const stageStart = new Date(stage.start_date);
    const stageEnd = new Date(stage.end_date);
    if (subStart < stageStart || subEnd > stageEnd) {
        return { error: `子任務時間 (${start_date} ~ ${end_date}) 超出所屬階段「${stage.name}」的範圍 (${stage.start_date.slice(0, 10)} ~ ${stage.end_date.slice(0, 10)})。請調整日期或先延長階段時間。` };
    }

    const info = db.prepare('INSERT INTO sub_tasks (stage_id, name, department, start_date, end_date, baseline_start_date, baseline_end_date) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(stage.id, task_name, department, start_date, end_date, start_date, end_date);
    return { success: true, message: `子任務「${task_name}」已新增至「${match.name} > ${stage.name}」（ID: ${info.lastInsertRowid}）` };
}

function executeUpdateTask(db, args) {
    const { project_name, task_name, new_start_date, new_end_date, new_status } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = findBestMatch(projects, project_name);
    if (!match) return { error: `找不到專案「${project_name}」` };

    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ?').all(match.id);
    let targetTask = null;
    let allTasks = [];
    for (const stage of stages) {
        const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
        allTasks = allTasks.concat(tasks);
    }
    targetTask = findBestMatch(allTasks, task_name);
    if (!targetTask) return { error: `找不到任務「${task_name}」` };

    const updates = [];
    const values = [];
    if (new_start_date) { updates.push('start_date = ?'); values.push(new_start_date); }
    if (new_end_date) { updates.push('end_date = ?'); values.push(new_end_date); }
    if (new_status) {
        updates.push('status = ?'); values.push(new_status);
        if (new_status === 'completed') {
            updates.push('progress = ?'); values.push(100);
            updates.push('completed_at = ?'); values.push(new Date().toISOString());
        } else {
            updates.push('progress = ?'); values.push(0);
            updates.push('completed_at = ?'); values.push(null);
        }
    }
    if (updates.length === 0) return { error: '沒有指定要修改的欄位' };

    values.push(targetTask.id);
    db.prepare(`UPDATE sub_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return { success: true, message: `任務「${targetTask.name}」已成功更新` };
}

function executeUpdateStage(db, args) {
    const { project_name, stage_name, new_start_date, new_end_date } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = findBestMatch(projects, project_name);
    if (!match) return { error: `找不到專案「${project_name}」` };

    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ?').all(match.id);
    const stage = findBestMatch(stages, stage_name);
    if (!stage) return { error: `找不到階段「${stage_name}」` };

    const updates = [];
    const values = [];
    if (new_start_date) { updates.push('start_date = ?'); values.push(new_start_date); }
    if (new_end_date) { updates.push('end_date = ?'); values.push(new_end_date); }
    if (updates.length === 0) return { error: '沒有指定要修改的欄位' };

    values.push(stage.id);
    db.prepare(`UPDATE stages SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return { success: true, message: `階段「${stage.name}」已成功更新` };
}

function executeCloseProject(db, args) {
    const { project_name } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = findBestMatch(projects, project_name);
    if (!match) return { error: `找不到專案「${project_name}」` };

    db.prepare("UPDATE projects SET status = 'closed' WHERE id = ?").run(match.id);
    return { success: true, message: `專案「${match.name}」已結案並隱藏` };
}

function executeReopenProject(db, args) {
    const { project_name } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = findBestMatch(projects, project_name);
    if (!match) return { error: `找不到專案「${project_name}」` };

    db.prepare("UPDATE projects SET status = 'active' WHERE id = ?").run(match.id);
    return { success: true, message: `專案「${match.name}」已解除結案，重新顯示` };
}

function executeDeleteProject(db, args) {
    const { project_name } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = findBestMatch(projects, project_name);
    if (!match) return { error: `找不到專案「${project_name}」` };

    db.transaction(() => {
        const stages = db.prepare('SELECT id FROM stages WHERE project_id = ?').all(match.id);
        stages.forEach(s => {
            db.prepare('DELETE FROM sub_tasks WHERE stage_id = ?').run(s.id);
        });
        db.prepare('DELETE FROM stages WHERE project_id = ?').run(match.id);
        db.prepare('DELETE FROM project_logs WHERE project_id = ?').run(match.id);
        db.prepare('DELETE FROM projects WHERE id = ?').run(match.id);
    })();
    return { success: true, message: `專案「${match.name}」及其所有資料已永久刪除` };
}

function executeDeleteStage(db, args) {
    const { project_name, stage_name } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = findBestMatch(projects, project_name);
    if (!match) return { error: `找不到專案「${project_name}」` };

    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ?').all(match.id);
    const targetStage = findBestMatch(stages, stage_name);
    if (!targetStage) return { error: `找不到階段「${stage_name}」` };

    db.transaction(() => {
        db.prepare('DELETE FROM sub_tasks WHERE stage_id = ?').run(targetStage.id);
        db.prepare('DELETE FROM stages WHERE id = ?').run(targetStage.id);
    })();
    return { success: true, message: `階段「${targetStage.name}」及其所有任務已永久刪除` };
}

function executeDeleteTask(db, args) {
    const { project_name, task_name } = args;
    const projects = db.prepare('SELECT * FROM projects').all();
    const match = findBestMatch(projects, project_name);
    if (!match) return { error: `找不到專案「${project_name}」` };

    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ?').all(match.id);
    let targetTask = null;
    let allTasks = [];
    for (const stage of stages) {
        const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
        allTasks = allTasks.concat(tasks);
    }
    targetTask = findBestMatch(allTasks, task_name);
    if (!targetTask) return { error: `找不到任務「${task_name}」` };

    db.prepare('DELETE FROM sub_tasks WHERE id = ?').run(targetTask.id);
    return { success: true, message: `子任務「${targetTask.name}」已刪除` };
}

// ─── Tool Router ──────────────────────────────────────────
const OPERATOR_TOOL_MAP = {
    query_projects: executeQueryProjects,
    query_project_detail: executeQueryProjectDetail,
    query_departments: executeQueryDepartments,
    add_project: executeAddProject,
    add_stage: executeAddStage,
    add_sub_task: executeAddSubTask,
    update_task: executeUpdateTask,
    update_stage: executeUpdateStage,
    close_project: executeCloseProject,
    reopen_project: executeReopenProject,
    delete_project: executeDeleteProject,
    delete_stage: executeDeleteStage,
    delete_task: executeDeleteTask,
};

// CUD tool names (these require auth)
const CUD_TOOLS = new Set([
    'add_project', 'add_stage', 'add_sub_task',
    'update_task', 'update_stage',
    'close_project', 'reopen_project',
    'delete_project', 'delete_stage', 'delete_task',
]);

// Admin-level tools
const ADMIN_TOOLS = new Set(['delete_project', 'reopen_project']);

// ─── Chat Handlers ──────────────────────────────────────────
const operatorGeminiConvos = new Map();
const operatorGroqConvos = new Map();
const operatorGeminiSummaries = new Map();
const operatorGroqSummaries = new Map();

// Pending actions waiting for auth
const pendingActions = new Map();

async function handleOperatorGeminiChat(db, sessionId, userMessage, sharedContext = '') {
    if (!operatorGeminiModel) return { reply: '⚠️ Gemini 設定缺失', tools_called: [] };
    if (!operatorGeminiConvos.has(sessionId)) operatorGeminiConvos.set(sessionId, []);

    const history = operatorGeminiConvos.get(sessionId);
    const chat = operatorGeminiModel.startChat({ history });

    // Inject shared context & long-term summary
    const summary = operatorGeminiSummaries.get(sessionId);
    const contextPrefix = (summary ? `[長期記憶摘要]\n${summary}\n\n` : '') +
        (sharedContext ? `[臨時群組上下文]\n${sharedContext}\n\n` : '');
    const fullMessage = contextPrefix ? `${contextPrefix}使用者訊息：${userMessage}` : userMessage;

    const toolsCalled = [];
    let response = await chat.sendMessage(fullMessage);

    while (response.response.candidates?.[0]?.content?.parts) {
        const parts = response.response.candidates[0].content.parts;
        const functionCalls = parts.filter(p => p.functionCall);
        if (functionCalls.length === 0) break;

        const toolResults = [];
        for (const part of functionCalls) {
            const { name, args } = part.functionCall;
            console.log(`🔧 [Operator/Gemini] Tool: ${name}`, JSON.stringify(args));

            // If it's a CUD tool, don't execute — store as pending
            if (CUD_TOOLS.has(name)) {
                const authLevel = ADMIN_TOOLS.has(name) ? 'admin' : 'edit';
                const actionId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                pendingActions.set(actionId, { tool: name, args, sessionId });

                toolsCalled.push({ name, args, pending: true, auth_level: authLevel });
                toolResults.push({
                    functionResponse: {
                        name,
                        response: {
                            status: 'pending_auth',
                            message: `此操作需要${authLevel === 'admin' ? '管理員' : '編輯'}密碼驗證。已儲存待執行指令。`,
                            action_id: actionId,
                            auth_level: authLevel,
                        }
                    }
                });
            } else {
                // Query tools — execute immediately
                const toolFn = OPERATOR_TOOL_MAP[name];
                const result = toolFn ? toolFn(db, args || {}) : { error: `未知工具：${name}` };
                toolsCalled.push({ name, args });
                toolResults.push({ functionResponse: { name, response: result } });
            }
        }
        response = await chat.sendMessage(toolResults);
    }

    const reply = response.response.text() || '🤔 無法生成回覆。';
    const updatedHistory = await chat.getHistory();

    // Context Isolation: 剝離臨時 injected 的 sharedContext，不存入長期記憶
    if (contextPrefix) {
        const lastUserMsg = [...updatedHistory].reverse().find(m => m.role === 'user');
        if (lastUserMsg && lastUserMsg.parts[0].text.includes(contextPrefix.trim())) {
            lastUserMsg.parts[0].text = userMessage;
        }
    }

    // Prune history & Summarize Background
    if (updatedHistory.length > 15) {
        const pruned = updatedHistory.slice(0, updatedHistory.length - 15);
        const prunedText = pruned.map(m => `${m.role}: ${m.parts.map(p => p.text).join(' ')}`).join('\n').slice(0, 3000);
        const { summarizeConversationContext } = require('./agent-leader');

        summarizeConversationContext(prunedText, operatorGeminiSummaries.get(sessionId)).then(newSummary => {
            if (newSummary) operatorGeminiSummaries.set(sessionId, newSummary);
        });

        operatorGeminiConvos.set(sessionId, updatedHistory.slice(-15));
    } else {
        operatorGeminiConvos.set(sessionId, updatedHistory);
    }

    // Check if reply contains auth markers
    let requires_auth = null;
    let action_id = null;
    if (reply.includes('[REQUIRES_AUTH:admin]')) {
        requires_auth = 'admin';
    } else if (reply.includes('[REQUIRES_AUTH:edit]')) {
        requires_auth = 'edit';
    }

    // Collect ALL pending action_ids for this session (supports batch updates)
    const pendingTools = toolsCalled.filter(t => t.pending);
    if (pendingTools.length > 0) {
        // Use highest auth level among all pending tools
        requires_auth = pendingTools.some(t => t.auth_level === 'admin') ? 'admin' : 'edit';
        // Collect all action_ids for this session
        const allActionIds = Array.from(pendingActions.entries())
            .filter(([, v]) => v.sessionId === sessionId)
            .map(([id]) => id);
        action_id = allActionIds.join(',');
    }

    const cleanReply = reply.replace(/\[REQUIRES_AUTH:(edit|admin)\]/g, '').trim();

    return {
        reply: cleanReply,
        tools_called: toolsCalled,
        requires_auth,
        action_id,
    };
}

async function handleOperatorGroqChat(db, sessionId, userMessage, sharedContext = '') {
    if (!operatorGroqClient) return { reply: '⚠️ Groq 設定缺失', tools_called: [] };
    if (!operatorGroqConvos.has(sessionId)) {
        operatorGroqConvos.set(sessionId, [{ role: 'system', content: OPERATOR_SYSTEM_PROMPT }]);
    }

    // Inject shared context & long-term summary
    const summary = operatorGroqSummaries.get(sessionId);
    const contextPrefix = (summary ? `[長期記憶摘要]\n${summary}\n\n` : '') +
        (sharedContext ? `[臨時群組上下文]\n${sharedContext}\n\n` : '');
    const fullMessage = contextPrefix ? `${contextPrefix}使用者訊息：${userMessage}` : userMessage;

    const messages = operatorGroqConvos.get(sessionId);
    const userMsgIndex = messages.length;
    messages.push({ role: 'user', content: fullMessage });
    const toolsCalled = [];
    let isToolCalling = true;

    while (isToolCalling) {
        let response;
        try {
            response = await operatorGroqClient.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages, tools: GROQ_OPERATOR_TOOLS,
                tool_choice: "auto", max_tokens: 4096,
                parallel_tool_calls: false, // Groq/Llama struggles with parallel calls
            });
        } catch (err) {
            const errMsg = err.message || String(err);
            console.error('🔧 [Operator/Groq] API Error:', errMsg);

            // Retry once without tools if it's a function call format error
            if (errMsg.includes('Failed to call a function') || errMsg.includes('failed_generation')) {
                console.log('🔧 [Operator/Groq] Retrying without tool_choice...');
                try {
                    // Add a hint to help the model
                    messages.push({ role: 'user', content: '（系統提示：請直接呼叫工具執行操作，一次一個工具即可。）' });
                    const retryResponse = await operatorGroqClient.chat.completions.create({
                        model: 'llama-3.3-70b-versatile',
                        messages, tools: GROQ_OPERATOR_TOOLS,
                        tool_choice: "auto", max_tokens: 4096,
                        parallel_tool_calls: false,
                    });
                    // Remove the hint message
                    messages.pop();
                    response = retryResponse;
                } catch (retryErr) {
                    console.error('🔧 [Operator/Groq] Retry also failed:', retryErr.message || retryErr);
                    messages.pop(); // Clean up hint
                }
            }

            if (!response) {
                // Extract any tool error from previous messages for warm guidance
                const lastToolMsg = [...messages].reverse().find(m => m.role === 'tool');
                let toolError = '';
                if (lastToolMsg) {
                    try { const parsed = JSON.parse(lastToolMsg.content); if (parsed.error) toolError = parsed.error; } catch { }
                }
                const warmReply = toolError
                    ? `😅 哎呀，操作遇到了一點問題：\n\n⚠️ ${toolError}\n\n需要我幫您調整嗎？您可以告訴我新的日期或其他修改方式 😊`
                    : '😅 不好意思，我在處理這個操作時遇到了一些技術問題。能麻煩您再說一次「確認」嗎？我會盡力幫您完成！😊';
                return { reply: warmReply, tools_called: toolsCalled };
            }
        }

        const responseMessage = response.choices[0].message;
        const toolCalls = responseMessage.tool_calls;
        messages.push(responseMessage);

        if (!toolCalls || toolCalls.length === 0) {
            isToolCalling = false;
        } else {
            for (const toolCall of toolCalls) {
                const name = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`🔧 [Operator/Groq] Tool: ${name}`, JSON.stringify(args));

                if (CUD_TOOLS.has(name)) {
                    const authLevel = ADMIN_TOOLS.has(name) ? 'admin' : 'edit';
                    const actionId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    pendingActions.set(actionId, { tool: name, args, sessionId });

                    toolsCalled.push({ name, args, pending: true, auth_level: authLevel });
                    messages.push({
                        tool_call_id: toolCall.id, role: "tool", name,
                        content: JSON.stringify({
                            status: 'pending_auth', action_id: actionId, auth_level: authLevel,
                            message: `此操作需要${authLevel === 'admin' ? '管理員' : '編輯'}密碼驗證。`,
                        }),
                    });
                } else {
                    const toolFn = OPERATOR_TOOL_MAP[name];
                    let result;
                    try { result = toolFn ? toolFn(db, args || {}) : { error: `未知工具：${name}` }; }
                    catch (e) { result = { error: e.message }; }
                    toolsCalled.push({ name, args });
                    messages.push({ tool_call_id: toolCall.id, role: "tool", name, content: JSON.stringify(result) });
                }
            }
        }
    }

    // Context Isolation: 剝離臨時 injected 的 sharedContext，不存入長期記憶
    if (contextPrefix && messages[userMsgIndex] && messages[userMsgIndex].role === 'user') {
        messages[userMsgIndex].content = userMessage;
    }

    const reply = messages[messages.length - 1].content || '🤔 無法生成回覆。';

    // Prune history & Summarize Background
    if (messages.length > 15) {
        const sys = messages[0];
        const pruned = messages.slice(1, messages.length - 14);
        const prunedText = pruned.map(m => `${m.role}: ${m.content}`).join('\n').slice(0, 3000);
        const { summarizeConversationContext } = require('./agent-leader');

        summarizeConversationContext(prunedText, operatorGroqSummaries.get(sessionId)).then(newSummary => {
            if (newSummary) operatorGroqSummaries.set(sessionId, newSummary);
        });

        operatorGroqConvos.set(sessionId, [sys, ...messages.slice(-14)]);
    }

    let requires_auth = null;
    let action_id = null;
    const pendingTools = toolsCalled.filter(t => t.pending);
    if (pendingTools.length > 0) {
        requires_auth = pendingTools.some(t => t.auth_level === 'admin') ? 'admin' : 'edit';
        const allActionIds = Array.from(pendingActions.entries())
            .filter(([, v]) => v.sessionId === sessionId)
            .map(([id]) => id);
        action_id = allActionIds.join(',');
    }
    if (reply.includes('[REQUIRES_AUTH:admin]')) requires_auth = 'admin';
    else if (reply.includes('[REQUIRES_AUTH:edit]')) requires_auth = 'edit';

    const cleanReply = reply.replace(/\[REQUIRES_AUTH:(edit|admin)\]/g, '').trim();
    return { reply: cleanReply, tools_called: toolsCalled, requires_auth, action_id };
}

async function handleOperatorChat(db, sessionId, userMessage, sharedContext = '') {
    if (operatorProvider === 'gemini') return handleOperatorGeminiChat(db, sessionId, userMessage, sharedContext);
    if (operatorProvider === 'groq') return handleOperatorGroqChat(db, sessionId, userMessage, sharedContext);
    return { reply: '⚠️ 未知 Provider', tools_called: [] };
}

// Execute a pending action after password verification
function handleOperatorExecute(db, actionId) {
    const pending = pendingActions.get(actionId);
    if (!pending) return { error: '找不到待執行操作或已過期' };

    const toolFn = OPERATOR_TOOL_MAP[pending.tool];
    if (!toolFn) return { error: `未知工具：${pending.tool}` };

    try {
        const result = toolFn(db, pending.args);
        pendingActions.delete(actionId);
        return result;
    } catch (err) {
        return { error: `執行失敗：${err.message}` };
    }
}

function getOperatorAuthLevel(actionId) {
    const pending = pendingActions.get(actionId);
    if (!pending) return null;
    return ADMIN_TOOLS.has(pending.tool) ? 'admin' : 'edit';
}

function clearOperatorConversation(sessionId) {
    operatorGeminiConvos.delete(sessionId);
    operatorGroqConvos.delete(sessionId);
    // Clean up any pending actions for this session
    for (const [id, action] of pendingActions.entries()) {
        if (action.sessionId === sessionId) pendingActions.delete(id);
    }
}

function getOperatorProvider() { return operatorProvider; }

function setOperatorProvider(newProvider) {
    if (newProvider === 'gemini' && !operatorGeminiModel) throw new Error('Gemini API 金鑰未設定');
    if (newProvider === 'groq' && !operatorGroqClient) throw new Error('Groq API 金鑰未設定');
    if (newProvider !== 'gemini' && newProvider !== 'groq') throw new Error('未知 Provider');
    operatorProvider = newProvider;
    console.log(`🔄 Operator Provider switched to: ${operatorProvider}`);
}

module.exports = {
    initOperatorAgent,
    handleOperatorChat,
    handleOperatorExecute,
    getOperatorAuthLevel,
    clearOperatorConversation,
    getOperatorProvider,
    setOperatorProvider,
};
