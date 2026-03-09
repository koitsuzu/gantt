/**
 * Leader Agent — 專甘管 監督者/路由 Agent
 * 負責：
 * 1. 智能意圖解析（取代關鍵字比對）
 * 2. 跨 Agent 協調（先查詢再操作）
 * 3. 資訊補足（自動從顧問取得缺失資訊後餵給操作員）
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

// ─── 獨立 LLM Setup ─────────────────────────────────────
let leaderProvider = 'gemini';
let leaderGeminiModel = null;
let leaderGroqClient = null;

function initLeaderAgent() {
    leaderProvider = (process.env.LEADER_LLM_PROVIDER || process.env.AGENT_LLM_PROVIDER || 'gemini').toLowerCase();
    let hasAnyProvider = false;

    // Initialize Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
        const genAI = new GoogleGenerativeAI(geminiKey);
        leaderGeminiModel = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: LEADER_SYSTEM_PROMPT,
        });
        hasAnyProvider = true;
    }

    // Initialize Groq
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
        leaderGroqClient = new Groq({ apiKey: groqKey });
        hasAnyProvider = true;
    }

    if (!hasAnyProvider) {
        console.warn('⚠️ Leader Agent: No API keys set — Leader is disabled, falling back to keyword routing');
        return false;
    }

    console.log(`🧠 Leader Agent initialized. Provider: ${leaderProvider}`);
    return true;
}

// ─── System Prompt ───────────────────────────────────────
const LEADER_SYSTEM_PROMPT = `你是專案管理系統「專甘管」的 AI 監督者（Leader Agent）。

你的角色是分析使用者的訊息意圖，並決定應該交給哪個子 Agent 處理。你不直接回答使用者的問題，只負責「路由判斷」與「資訊補足規劃」。

## 你管理的子 Agent
1. **顧問 (consultant)**：負責查詢專案資訊、分析風險、評估工作負載等唯讀操作
2. **操作員 (operator)**：負責新增、修改、刪除、結案等異動操作（CUD）

## 你的任務
分析使用者輸入的訊息，回傳一個 JSON 格式的「執行計畫」：

### JSON 格式（嚴格遵守）
\`\`\`json
{
  "plan": [
    { "step": 1, "agent": "consultant", "purpose": "查詢目前專案狀態和日期以補足操作資訊" },
    { "step": 2, "agent": "operator", "purpose": "使用查到的資訊來執行新增操作" }
  ],
  "enriched_message": "使用者原始意圖的清晰化描述",
  "missing_info": [],
  "needs_clarification": false
}
\`\`\`

### 欄位說明
- **plan**：執行步驟陣列，每個步驟指定哪個 agent 以及做什麼
  - 如果只需要一個 agent，就只有一個步驟
  - 如果需要「先查再操作」，就安排兩個步驟（先 consultant 再 operator）
- **enriched_message**：你對使用者意圖的精煉描述。把模糊的用語轉化為更明確的指令
- **missing_info**：如果連你都無法推斷出需要的資訊（例如完全沒提到是哪個專案），列出缺失項目
- **needs_clarification**：如果 missing_info 非空，設為 true

## 判斷規則

### 直接交給 consultant (單步驟)
- 使用者是在問問題、查詢狀態、分析風險、評估狀況
- 範例：「目前專案進度如何？」「有哪些逾期任務？」「各部門工作負載？」

### 直接交給 operator (單步驟)
- 使用者有明確的異動意圖，且資訊充足（已明確說出專案名稱、任務名稱、日期等）
- 範例：「把 111 專案的發包截止日改到 3/15」

### 先 consultant 再 operator (兩步驟)
- 使用者有異動意圖，但缺少關鍵資訊（例如沒説是哪個階段、不知道目前日期）
- 範例：「客人要改規格，需要新增重新討論的階段，大約5天」→ 先查專案現有進度，再操作新增
- 範例：「把上次提到的任務延後兩天」→ 先查上次談的是什麼，再操作

### 需要向使用者確認 (needs_clarification = true)
- 只有在完全無法推斷任何資訊時（例如：「幫我改一下」← 完全沒有上下文）
- 儘量減少對使用者的詢問，優先讓 consultant 去查

## 關於「確認」和後續回覆
- 如果使用者只說「確認」「OK」「好的」「執行」等，代表他們是在確認操作員之前提出的操作明細
  - 此時直接交給 operator，不用查詢
  - enriched_message 設為：「使用者確認執行先前提出的操作」

## 重要原則
1. 你**只輸出 JSON**，不要有任何其他文字
2. 優先假設使用者在講「最近/最活躍的專案」，避免多餘的確認
3. 回覆最新的對話上下文也能幫助你判斷
4. 對話繼續性：如果前面的對話記錄明確是在操作某個專案，你可以直接推斷是同一個`;

// ─── Intent Analysis ─────────────────────────────────────
const leaderGeminiConversations = new Map();
const leaderGroqConversations = new Map();

/**
 * Analyze user intent using LLM and return an execution plan
 */
async function analyzeIntent(message, conversationHistory = [], sharedContext = '') {
    const contextMessage = sharedContext
        ? `[上下文資訊]\n${sharedContext}\n\n[使用者訊息]\n${message}`
        : message;

    try {
        if (leaderProvider === 'gemini' && leaderGeminiModel) {
            return await analyzeWithGemini(contextMessage, conversationHistory);
        } else if (leaderProvider === 'groq' && leaderGroqClient) {
            return await analyzeWithGroq(contextMessage, conversationHistory);
        }
    } catch (err) {
        console.error('Leader Agent analysis error:', err);
    }

    // Fallback to keyword-based routing
    return fallbackKeywordRouting(message);
}

async function analyzeWithGemini(message, conversationHistory) {
    try {
        const chat = leaderGeminiModel.startChat({
            history: conversationHistory.map(h => ({
                role: h.role === 'user' ? 'user' : 'model',
                parts: [{ text: h.content }]
            }))
        });

        const result = await chat.sendMessage(message);
        const text = result.response.text().trim();
        return parseLeaderResponse(text);
    } catch (err) {
        console.error('Leader Gemini error:', err);
        return fallbackKeywordRouting(message);
    }
}

async function analyzeWithGroq(message, conversationHistory) {
    try {
        const messages = [
            { role: 'system', content: LEADER_SYSTEM_PROMPT },
            ...conversationHistory.map(h => ({
                role: h.role === 'user' ? 'user' : 'assistant',
                content: h.content
            })),
            { role: 'user', content: message }
        ];

        const completion = await leaderGroqClient.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages,
            temperature: 0.1,
            max_tokens: 500,
            response_format: { type: 'json_object' },
        });

        const text = completion.choices[0]?.message?.content?.trim() || '';
        return parseLeaderResponse(text);
    } catch (err) {
        console.error('Leader Groq error:', err);
        return fallbackKeywordRouting(message);
    }
}

/**
 * Parse the LLM JSON response into a structured plan
 */
function parseLeaderResponse(text) {
    try {
        // Strip markdown code fences if present
        let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const plan = JSON.parse(cleaned);

        // Validate structure
        if (!plan.plan || !Array.isArray(plan.plan) || plan.plan.length === 0) {
            throw new Error('Invalid plan structure');
        }

        // Validate each step
        for (const step of plan.plan) {
            if (!step.agent || !['consultant', 'operator'].includes(step.agent)) {
                throw new Error(`Invalid agent: ${step.agent}`);
            }
        }

        return {
            plan: plan.plan,
            enriched_message: plan.enriched_message || '',
            missing_info: plan.missing_info || [],
            needs_clarification: plan.needs_clarification || false,
        };
    } catch (err) {
        console.error('Leader response parse error:', err, 'Raw:', text);
        return fallbackKeywordRouting(text);
    }
}

/**
 * Background utility: Summarize old conversation context to save tokens
 */
async function summarizeConversationContext(messagesText, previousSummary = '') {
    const prompt = `[系統] 你是專案管理系統的記憶壓縮助理。
請將以下對話紀錄濃縮為 150 字以內的精華摘要。
重點保留：正在討論或操作的「專案名稱」、「任務細節」、「指定的日期時間」以及「目前進度狀態」。
這個摘要將用來取代舊對話提供給其他 AI 參考，請去除所有問候語和冗言贅字。
${previousSummary ? `\n[先前的摘要]\n${previousSummary}` : ''}

[要壓縮的舊對話]
${messagesText}`;

    try {
        if (leaderProvider === 'gemini' && leaderGeminiModel) {
            const result = await leaderGeminiModel.generateContent(prompt);
            return result.response.text().trim();
        } else if (leaderProvider === 'groq' && leaderGroqClient) {
            const completion = await leaderGroqClient.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1, max_tokens: 300
            });
            return completion.choices[0]?.message?.content?.trim() || previousSummary;
        }
    } catch (err) {
        console.error('Leader summarization error:', err);
    }
    return previousSummary; // fallback
}

/**
 * Fallback: keyword-based routing (legacy behavior)
 */
function fallbackKeywordRouting(message) {
    const trimmed = message.trim();
    // Check for explicit mentions
    if (trimmed.startsWith('@顧問') || trimmed.startsWith('@consultant')) {
        return { plan: [{ step: 1, agent: 'consultant', purpose: '使用者指定顧問' }], enriched_message: trimmed, missing_info: [], needs_clarification: false };
    }
    if (trimmed.startsWith('@操作員') || trimmed.startsWith('@operator')) {
        return { plan: [{ step: 1, agent: 'operator', purpose: '使用者指定操作員' }], enriched_message: trimmed, missing_info: [], needs_clarification: false };
    }

    // Keyword detection
    const operatorKw = ['新增', '刪除', '移除', '修改', '調整', '更新', '結案', '解除結案', '加入', '建立', '設定', '延後', '提前', '標記完成', '截止', '確認執行', '確認'];
    const consultantKw = ['查詢', '分析', '風險', '狀態', '目前', '報告', '建議', '工作負載', '逾期', '待辦', '如何', '為什麼', '怎麼', '嗎', '哪些', '幾個', '多少'];

    for (const kw of operatorKw) {
        if (trimmed.includes(kw)) {
            return { plan: [{ step: 1, agent: 'operator', purpose: '關鍵字判斷: ' + kw }], enriched_message: trimmed, missing_info: [], needs_clarification: false };
        }
    }
    for (const kw of consultantKw) {
        if (trimmed.includes(kw)) {
            return { plan: [{ step: 1, agent: 'consultant', purpose: '關鍵字判斷: ' + kw }], enriched_message: trimmed, missing_info: [], needs_clarification: false };
        }
    }

    return { plan: [{ step: 1, agent: 'consultant', purpose: '預設' }], enriched_message: trimmed, missing_info: [], needs_clarification: false };
}

// ─── Orchestrator ────────────────────────────────────────
/**
 * Main orchestration function: 
 * 1. Analyze intent via LLM
 * 2. Execute steps in order, passing context between agents
 * 3. Return the final response to the user
 * 
 * @param {Object} db - Database instance
 * @param {string} sessionId - Session ID
 * @param {string} message - User's raw message
 * @param {string} sharedContext - Shared context from front-end
 * @param {Function} handleChat - Consultant agent's chat handler
 * @param {Function} handleOperatorChat - Operator agent's chat handler
 * @param {Array} conversationHistory - Recent conversation history for context
 */
async function orchestrate(db, sessionId, message, sharedContext, handleChat, handleOperatorChat, conversationHistory = []) {
    // Step 1: Analyze intent
    const analysis = await analyzeIntent(message, conversationHistory, sharedContext);
    console.log('🧠 Leader analysis:', JSON.stringify(analysis, null, 2));

    // If needs clarification and Leader can't resolve, ask user
    if (analysis.needs_clarification && analysis.missing_info.length > 0) {
        const missingList = analysis.missing_info.map(info => `• ${info}`).join('\n');
        return {
            agent: 'leader',
            reply: `😊 我想幫您處理，但有些資訊還不太確定：\n\n${missingList}\n\n能麻煩您補充一下嗎？這樣我就能立刻幫您安排了！`,
            tools_called: [],
            leader_plan: analysis.plan,
        };
    }

    // Step 2: Execute plan steps
    let lastResult = null;
    let accumulatedContext = sharedContext || '';
    let finalAgent = analysis.plan[analysis.plan.length - 1].agent;

    for (const step of analysis.plan) {
        const stepMessage = step.step === 1
            ? (analysis.enriched_message || message)
            : `[Leader 指示] 以下是先前步驟取得的背景資訊：\n${accumulatedContext}\n\n使用者原始需求：${message}\n\n${analysis.enriched_message || ''}`;

        try {
            if (step.agent === 'consultant') {
                // For multi-step plans, instruct consultant to be concise
                const consultantPrefix = analysis.plan.length > 1
                    ? '[系統指示：此查詢是為了補足操作所需的資訊。請簡潔地回報關鍵事實（專案名稱、階段進度、日期、任務狀態），不需要詳細分析。]\n'
                    : '';
                lastResult = await handleChat(db, `cs_${sessionId}`, consultantPrefix + stepMessage, accumulatedContext);
                // Accumulate the consultant's reply as context for the next step
                if (analysis.plan.length > 1) {
                    accumulatedContext += `\n[顧問查詢結果]：${lastResult.reply}`;
                }
            } else if (step.agent === 'operator') {
                lastResult = await handleOperatorChat(db, `op_${sessionId}`, stepMessage, accumulatedContext);
            }
        } catch (err) {
            console.error(`Leader: Step ${step.step} (${step.agent}) failed:`, err);
            lastResult = {
                reply: `😅 在處理第 ${step.step} 步（${step.agent === 'consultant' ? '查詢' : '操作'}）時遇到了問題：${err.message}`,
                tools_called: [],
            };
            break; // Stop executing further steps on error
        }
    }

    if (!lastResult) {
        return {
            agent: finalAgent,
            reply: '😅 不好意思，處理時發生了錯誤，請再試一次！',
            tools_called: [],
        };
    }

    // Return the final result with agent information
    return {
        ...lastResult,
        agent: finalAgent,
        leader_plan: analysis.plan,
    };
}

// ─── Provider Management ─────────────────────────────────
function getLeaderProvider() { return leaderProvider; }

function setLeaderProvider(newProvider) {
    if (newProvider === 'gemini' && !leaderGeminiModel) throw new Error('Gemini API 金鑰未設定');
    if (newProvider === 'groq' && !leaderGroqClient) throw new Error('Groq API 金鑰未設定');
    if (newProvider !== 'gemini' && newProvider !== 'groq') throw new Error('未知 Provider');
    leaderProvider = newProvider;
    console.log(`🔄 Leader Provider switched to: ${leaderProvider}`);
}

function clearLeaderConversation(sessionId) {
    leaderGeminiConversations.delete(sessionId);
    leaderGroqConversations.delete(sessionId);
}

// ─── Exports ─────────────────────────────────────────────
module.exports = {
    initLeaderAgent,
    analyzeIntent,
    orchestrate,
    getLeaderProvider,
    setLeaderProvider,
    clearLeaderConversation,
    fallbackKeywordRouting,
    summarizeConversationContext,
};
