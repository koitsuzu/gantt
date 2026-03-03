const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const db = require('./db');
const { initAgent, handleChat, clearConversation, getActiveProvider, setProvider } = require('./agent');
const { initOperatorAgent, handleOperatorChat, handleOperatorExecute, getOperatorAuthLevel, clearOperatorConversation, getOperatorProvider, setOperatorProvider } = require('./agent-operator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Logging Middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// === Edit Password Verification ===
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || '1234';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

app.post('/api/verify-password', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, role: 'admin' });
    } else if (password === EDIT_PASSWORD) {
        res.json({ success: true, role: 'edit' });
    } else {
        res.status(401).json({ success: false, error: '密碼錯誤' });
    }
});

// === Helper: add N days to a date ===
function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

// === Helper: recursively build task tree ===
function buildTaskTree(allTasks, parentId = null) {
    return allTasks
        .filter(t => (t.parent_task_id || null) === parentId)
        .map(task => ({
            ...task,
            children: buildTaskTree(allTasks, task.id)
        }));
}

// === Helper: recursively mark all descendants as completed ===
function cascadeComplete(taskId, status) {
    const newStatus = status === 'completed' ? 'completed' : 'pending';
    const progress = newStatus === 'completed' ? 100 : 0;
    db.prepare('UPDATE sub_tasks SET status = ?, progress = ? WHERE id = ?').run(newStatus, progress, taskId);
    const children = db.prepare('SELECT id FROM sub_tasks WHERE parent_task_id = ?').all(taskId);
    children.forEach(child => cascadeComplete(child.id, status));
}

// === Helper: cascade completion status upward to parent tasks ===
function cascadeUp(taskId) {
    const task = db.prepare('SELECT parent_task_id FROM sub_tasks WHERE id = ?').get(taskId);
    if (!task || !task.parent_task_id) return;

    const parentId = task.parent_task_id;
    const siblings = db.prepare('SELECT id, status FROM sub_tasks WHERE parent_task_id = ?').all(parentId);

    const allCompleted = siblings.every(s => s.status === 'completed');
    const anyPending = siblings.some(s => s.status !== 'completed');

    if (allCompleted) {
        db.prepare('UPDATE sub_tasks SET status = ?, progress = 100, kanban_status = ? WHERE id = ?').run('completed', 'done', parentId);
        // Continue cascading upward
        cascadeUp(parentId);
    } else if (anyPending) {
        // If parent was completed but a child is now pending, mark parent as pending too
        const parent = db.prepare('SELECT status FROM sub_tasks WHERE id = ?').get(parentId);
        if (parent && parent.status === 'completed') {
            db.prepare('UPDATE sub_tasks SET status = ?, progress = 0, kanban_status = ? WHERE id = ?').run('pending', 'todo', parentId);
            // Continue cascading upward
            cascadeUp(parentId);
        }
    }
}

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

// === Users API ===
app.get('/api/users', (req, res) => {
    try {
        const users = db.prepare('SELECT id, username, email FROM users').all();
        res.json(users);
    } catch (err) {
        console.error('Users fetch error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Projects API ===
app.get('/api/projects', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    try {
        const condition = req.query.showAll === 'true' ? "status IN ('active', 'closed')" : "status = 'active'";
        const projects = db.prepare(`SELECT * FROM projects WHERE user_id = ? AND ${condition} ORDER BY end_date ASC`).all(userId);
        res.json(projects);
    } catch (err) {
        console.error('Projects fetch error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Project summary with completion stats
app.get('/api/projects/summary', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    try {
        const projects = db.prepare('SELECT * FROM projects WHERE user_id = ?').all(userId);
        const summaries = projects.filter(p => req.query.showAll === 'true' || p.status === 'active').map(project => {
            const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY "order"').all(project.id);

            let totalTasks = 0;
            let completedTasks = 0;
            const stageStats = stages.map(stage => {
                const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
                const done = tasks.filter(t => t.status === 'completed').length;
                totalTasks += tasks.length;
                completedTasks += done;
                return {
                    name: stage.name,
                    total: tasks.length,
                    completed: done
                };
            });

            // Calculate invested time (from project start to now, or to end if completed)
            const projectStart = new Date(project.start_date || project.created_at);
            const projectEnd = project.end_date ? new Date(project.end_date) : null;
            const now = new Date();
            const investedMs = Math.max(0, Math.min(now.getTime(), projectEnd ? projectEnd.getTime() : now.getTime()) - projectStart.getTime());
            const investedDays = Math.ceil(investedMs / 86400000);

            // Status
            let status = '進行中';
            if (totalTasks === 0) status = '未建立子任務';
            else if (completedTasks === 0) status = '未開始';
            else if (completedTasks === totalTasks) status = '已完成';

            return {
                id: project.id,
                name: project.name,
                start_date: project.start_date,
                end_date: project.end_date,
                totalTasks,
                completedTasks,
                investedDays,
                status,
                raw_status: project.status,
                stages: stageStats
            };
        });

        res.json(summaries);
    } catch (err) {
        console.error('Summary error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects', (req, res) => {
    const { userId, name, stages, start_date, end_date } = req.body;
    if (!userId || !name || !stages) {
        return res.status(400).json({ error: 'Missing userId, name, or stages' });
    }

    try {
        // Use provided dates or default to today
        const projectStart = start_date ? new Date(start_date) : startOfDay(new Date());
        const projectEnd = end_date ? new Date(end_date) : null;

        // Calculate total days for stages
        const totalDays = stages.reduce((sum, s) => sum + (s.days || 1), 0);

        // Validate stages fit within project date range
        if (projectEnd) {
            const maxDays = Math.ceil((projectEnd.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24));
            if (totalDays > maxDays) {
                return res.status(400).json({
                    error: `階段總天數 (${totalDays}天) 超過專案期限 (${maxDays}天)，請調整`
                });
            }
        }

        const insertProject = db.prepare('INSERT INTO projects (user_id, name, start_date, end_date) VALUES (?, ?, ?, ?)');
        const insertStage = db.prepare('INSERT INTO stages (project_id, name, "order", start_date, end_date) VALUES (?, ?, ?, ?, ?)');

        const transaction = db.transaction((uId, pName, pStages) => {
            const info = insertProject.run(uId, pName, projectStart.toISOString(), projectEnd ? projectEnd.toISOString() : null);
            const projectId = info.lastInsertRowid;

            let runningDate = new Date(projectStart);
            pStages.forEach((stage, index) => {
                const endDate = addDays(runningDate, stage.days);
                insertStage.run(projectId, stage.name, index, runningDate.toISOString(), endDate.toISOString());
                runningDate = endDate;
            });

            return projectId;
        });

        const projectId = transaction(userId, name, stages);
        res.json({ success: true, projectId });
    } catch (err) {
        console.error('Project Creation Trans Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Project delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Stages API ===
app.delete('/api/stages/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM stages WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Stage delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/stages/:id', (req, res) => {
    const { start_date, end_date, name } = req.body;
    try {
        const stage = db.prepare('SELECT project_id, start_date, end_date FROM stages WHERE id = ?').get(req.params.id);
        if (!stage) return res.status(404).json({ error: '找不到該階段' });

        let finalStart = start_date || stage.start_date;
        let finalEnd = end_date || stage.end_date;

        if (start_date || end_date) {
            const project = db.prepare('SELECT start_date, end_date FROM projects WHERE id = ?').get(stage.project_id);
            if (project) {
                const projStart = new Date(project.start_date);
                const projEnd = project.end_date ? new Date(project.end_date) : null;
                const sStart = new Date(finalStart);
                const sEnd = new Date(finalEnd);

                if (sStart >= sEnd) {
                    return res.status(400).json({ error: '開始時間必須早於或等於結束時間' });
                }
                if (sStart < projStart || (projEnd && sEnd > projEnd)) {
                    return res.status(400).json({
                        error: `階段時間 (${sStart.toISOString().slice(0, 10)} ~ ${sEnd.toISOString().slice(0, 10)}) 超出專案範圍 (${projStart.toISOString().slice(0, 10)} ~ ${projEnd ? projEnd.toISOString().slice(0, 10) : '未設定'})，請重新設定。`
                    });
                }
            }
        }

        // Build dynamic update query based on provided fields
        const updates = [];
        const params = [];
        if (start_date) { updates.push('start_date = ?'); params.push(start_date); }
        if (end_date) { updates.push('end_date = ?'); params.push(end_date); }
        if (name) { updates.push('name = ?'); params.push(name); }

        if (updates.length > 0) {
            params.push(req.params.id);
            const stmt = db.prepare(`UPDATE stages SET ${updates.join(', ')} WHERE id = ?`);
            stmt.run(...params);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Stage update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Create Stage (single) ===
app.post('/api/stages', (req, res) => {
    const { project_id, name, start_date, end_date, order } = req.body;
    if (!project_id || !name || !start_date || !end_date) {
        return res.status(400).json({ error: 'Missing required fields: project_id, name, start_date, end_date' });
    }

    try {
        const project = db.prepare('SELECT start_date, end_date FROM projects WHERE id = ?').get(project_id);
        if (!project) return res.status(404).json({ error: '找不到該專案' });

        const projStart = new Date(project.start_date);
        const projEnd = project.end_date ? new Date(project.end_date) : null;
        const sStart = new Date(start_date);
        const sEnd = new Date(end_date);

        if (sStart >= sEnd) {
            return res.status(400).json({ error: '開始時間必須早於或等於結束時間' });
        }
        if (sStart < projStart || (projEnd && sEnd > projEnd)) {
            return res.status(400).json({
                error: `階段時間 (${sStart.toISOString().slice(0, 10)} ~ ${sEnd.toISOString().slice(0, 10)}) 超出專案範圍 (${projStart.toISOString().slice(0, 10)} ~ ${projEnd ? projEnd.toISOString().slice(0, 10) : '未設定'})，請重新設定。`
            });
        }

        const stmt = db.prepare('INSERT INTO stages (project_id, name, "order", start_date, end_date) VALUES (?, ?, ?, ?, ?)');
        const info = stmt.run(project_id, name, order || 0, start_date, end_date);
        res.json({ success: true, stageId: info.lastInsertRowid });
    } catch (err) {
        console.error('Stage creation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Sub-task Completion Toggle (cascading to children + parents) ===
app.patch('/api/sub-tasks/:id/complete', (req, res) => {
    const { status } = req.body;
    try {
        db.transaction(() => {
            cascadeComplete(parseInt(req.params.id), status);
            // Record completed_at timestamp
            if (status === 'completed') {
                db.prepare('UPDATE sub_tasks SET completed_at = CURRENT_TIMESTAMP, kanban_status = ? WHERE id = ?').run('done', req.params.id);
            } else {
                db.prepare('UPDATE sub_tasks SET completed_at = NULL, kanban_status = ? WHERE id = ?').run('todo', req.params.id);
            }
            // Cascade upward: if all siblings complete, mark parent complete too
            cascadeUp(parseInt(req.params.id));
        })();
        res.json({ success: true, status: status === 'completed' ? 'completed' : 'pending' });
    } catch (err) {
        console.error('Sub-task completion error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Kanban API ===
app.get('/api/tasks/today/kanban', (req, res) => {
    try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const rows = db.prepare(`
            SELECT st.id, st.name, st.department, st.start_date, st.end_date,
                   st.status, st.kanban_status,
                   s.name as stage_name, p.name as project_name
            FROM sub_tasks st
            JOIN stages s ON st.stage_id = s.id
            JOIN projects p ON s.project_id = p.id
            WHERE p.status = 'active'
              AND date(st.start_date) <= date(?)
              AND (
                st.status != 'completed'
                OR st.kanban_status = 'done'
              )
            ORDER BY
              CASE st.kanban_status
                WHEN 'doing' THEN 1
                WHEN 'todo' THEN 2
                WHEN 'done' THEN 3
                ELSE 4
              END,
              st.end_date ASC
        `).all(todayStr);
        res.json(rows);
    } catch (err) {
        console.error('Kanban tasks error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/sub-tasks/:id/kanban', (req, res) => {
    const { kanban_status } = req.body;
    if (!kanban_status || !['todo', 'doing', 'done'].includes(kanban_status)) {
        return res.status(400).json({ error: 'Invalid kanban_status' });
    }
    try {
        db.prepare('UPDATE sub_tasks SET kanban_status = ? WHERE id = ?').run(kanban_status, req.params.id);

        // If moved to 'done', also mark as completed
        if (kanban_status === 'done') {
            cascadeComplete(parseInt(req.params.id), 'completed');
            db.prepare('UPDATE sub_tasks SET completed_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
            cascadeUp(parseInt(req.params.id));
        } else if (kanban_status === 'todo' || kanban_status === 'doing') {
            // If moved back from done, mark as pending
            const task = db.prepare('SELECT status FROM sub_tasks WHERE id = ?').get(req.params.id);
            if (task && task.status === 'completed') {
                db.prepare('UPDATE sub_tasks SET status = ?, completed_at = NULL WHERE id = ?').run('pending', req.params.id);
                cascadeUp(parseInt(req.params.id));
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Kanban status update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Sub-tasks API ===
app.post('/api/sub-tasks', (req, res) => {
    const { stageId, parentTaskId, name, department, start_date, end_date } = req.body;
    console.log('Creating sub-task:', { stageId, parentTaskId, name, department, start_date, end_date });

    if (!stageId || !name || !start_date || !end_date) {
        return res.status(400).json({ error: 'Missing required fields: stageId, name, start_date, end_date' });
    }

    try {
        const subStart = new Date(start_date);
        const subEnd = new Date(end_date);

        if (subStart >= subEnd) {
            return res.status(400).json({ error: '開始時間必須早於結束時間' });
        }

        // Validate against parent task or stage
        if (parentTaskId) {
            const parentTask = db.prepare('SELECT start_date, end_date FROM sub_tasks WHERE id = ?').get(parentTaskId);
            if (!parentTask) {
                return res.status(400).json({ error: '找不到父任務' });
            }
            const parentStart = new Date(parentTask.start_date);
            const parentEnd = new Date(parentTask.end_date);
            if (subStart < parentStart || subEnd > parentEnd) {
                return res.status(400).json({ error: '子任務時間範圍不能超過父任務的時間範圍' });
            }
        } else {
            const stage = db.prepare('SELECT start_date, end_date FROM stages WHERE id = ?').get(stageId);
            if (!stage) {
                return res.status(400).json({ error: '找不到對應的階段' });
            }
            const stageStart = new Date(stage.start_date);
            const stageEnd = new Date(stage.end_date);
            if (subStart < stageStart || subEnd > stageEnd) {
                return res.status(400).json({ error: '子任務時間範圍不能超過所屬階段的時間範圍' });
            }
        }

        const stmt = db.prepare('INSERT INTO sub_tasks (stage_id, parent_task_id, name, department, start_date, end_date, baseline_start_date, baseline_end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const info = stmt.run(stageId, parentTaskId || null, name, department || '', start_date, end_date, start_date, end_date);
        console.log('Sub-task created with baseline:', info.lastInsertRowid);
        res.json({ success: true, taskId: info.lastInsertRowid });
    } catch (err) {
        console.error('Sub-task Creation Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/sub-tasks/:id', (req, res) => {
    const { start_date, end_date, name, department } = req.body;
    try {
        // Find parent stage to clamp dates if dates are provided
        const subTask = db.prepare('SELECT stage_id, name, department, start_date, end_date FROM sub_tasks WHERE id = ?').get(req.params.id);

        if (!subTask) return res.status(404).json({ error: '找不到該子任務' });

        let finalStart = start_date || subTask.start_date;
        let finalEnd = end_date || subTask.end_date;
        let finalName = name || subTask.name;
        let finalDept = department !== undefined ? department : subTask.department;

        if (start_date || end_date) {
            const stage = db.prepare('SELECT start_date, end_date FROM stages WHERE id = ?').get(subTask.stage_id);
            if (stage) {
                const stageStart = new Date(stage.start_date);
                const stageEnd = new Date(stage.end_date);
                let subS = new Date(finalStart);
                let subE = new Date(finalEnd);

                if (subS < stageStart || subE > stageEnd) {
                    return res.status(400).json({
                        error: `子任務時間 (${subS.toISOString().slice(0, 10)} ~ ${subE.toISOString().slice(0, 10)}) 超出所屬階段允許的範圍 (${stageStart.toISOString().slice(0, 10)} ~ ${stageEnd.toISOString().slice(0, 10)})，請重新設定或先延長階段。`
                    });
                }
                if (subS >= subE) {
                    return res.status(400).json({ error: '開始時間必須早於或等於結束時間' });
                }

                finalStart = subS.toISOString();
                finalEnd = subE.toISOString();
            }
        }

        const stmt = db.prepare('UPDATE sub_tasks SET start_date = ?, end_date = ?, name = ?, department = ? WHERE id = ?');
        stmt.run(finalStart, finalEnd, finalName, finalDept, req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Sub-task update error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/sub-tasks/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM sub_tasks WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Sub-task delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Kanban Status Update ===
app.patch('/api/sub-tasks/:id/kanban', (req, res) => {
    const { kanban_status } = req.body;
    if (!['todo', 'doing', 'done'].includes(kanban_status)) {
        return res.status(400).json({ error: 'Invalid kanban_status. Must be: todo, doing, done' });
    }
    try {
        const taskId = parseInt(req.params.id);
        const task = db.prepare('SELECT status FROM sub_tasks WHERE id = ?').get(taskId);
        if (!task) return res.status(404).json({ error: '找不到該任務' });

        db.transaction(() => {
            // Update kanban status
            db.prepare('UPDATE sub_tasks SET kanban_status = ? WHERE id = ?').run(kanban_status, taskId);

            // If moved to 'done', also mark as completed
            if (kanban_status === 'done' && task.status !== 'completed') {
                cascadeComplete(taskId, 'completed');
                db.prepare('UPDATE sub_tasks SET completed_at = CURRENT_TIMESTAMP WHERE id = ?').run(taskId);
            }
            // If moved away from 'done', revert to pending
            if (kanban_status !== 'done' && task.status === 'completed') {
                cascadeComplete(taskId, 'pending');
                db.prepare('UPDATE sub_tasks SET completed_at = NULL WHERE id = ?').run(taskId);
            }

            // Log the change
            db.prepare('INSERT INTO sub_task_logs (task_id, change_type, old_value, new_value) VALUES (?, ?, ?, ?)').run(
                taskId, 'kanban_status', task.status === 'completed' ? 'done' : 'todo', kanban_status
            );
        })();

        res.json({ success: true });
    } catch (err) {
        console.error('Kanban status update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Today tasks with kanban status (shows all active tasks) ===
app.get('/api/tasks/today/kanban', (req, res) => {
    try {
        const tasks = db.prepare(`
            SELECT st.*, s.name AS stage_name, p.name AS project_name
            FROM sub_tasks st
            JOIN stages s ON st.stage_id = s.id
            JOIN projects p ON s.project_id = p.id
            WHERE p.status = 'active'
              AND (st.status != 'completed' OR st.kanban_status = 'done')
            ORDER BY
              CASE st.kanban_status
                WHEN 'doing' THEN 0
                WHEN 'todo' THEN 1
                WHEN 'done' THEN 2
                ELSE 3
              END,
              st.end_date ASC
        `).all();
        res.json(tasks);
    } catch (err) {
        console.error('Today kanban error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/stages/:id', (req, res) => {
    const { start_date, end_date } = req.body;
    try {
        const stmt = db.prepare('UPDATE stages SET start_date = ?, end_date = ? WHERE id = ?');
        stmt.run(start_date, end_date, req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Stage update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === All Projects Gantt (unified timeline) ===
app.get('/api/all-projects-gantt', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    try {
        const condition = req.query.showAll === 'true' ? "status IN ('active', 'closed')" : "status = 'active'";
        const projects = db.prepare(`SELECT * FROM projects WHERE user_id = ? AND ${condition} ORDER BY end_date ASC`).all(userId);
        const result = projects.map(project => {
            const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY "order"').all(project.id);
            const detailedStages = stages.map(stage => {
                // Load ALL tasks for this stage, then build tree
                const allTasks = db.prepare(`
                    SELECT s.*, d.color as dept_color 
                    FROM sub_tasks s 
                    LEFT JOIN departments d ON s.department = d.name
                    WHERE s.stage_id = ?
                `).all(stage.id);
                const taskTree = buildTaskTree(allTasks, null);
                return { ...stage, tasks: taskTree };
            });
            return { ...project, stages: detailedStages };
        });
        res.json(result);
    } catch (err) {
        console.error('All projects gantt error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Agent Tool APIs (for future AI agent integration) ===

// Agent: Query project status
app.get('/api/agent/status', (req, res) => {
    try {
        const projects = db.prepare('SELECT * FROM projects').all();
        const result = projects.map(project => {
            const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY "order"').all(project.id);
            let totalTasks = 0, completedTasks = 0;
            const stageDetails = stages.map(stage => {
                const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
                const done = tasks.filter(t => t.status === 'completed').length;
                totalTasks += tasks.length;
                completedTasks += done;
                return {
                    name: stage.name,
                    start_date: stage.start_date,
                    end_date: stage.end_date,
                    total_tasks: tasks.length,
                    completed_tasks: done,
                    is_delayed: tasks.some(t => t.status !== 'completed' && new Date(t.end_date) < new Date())
                };
            });

            const status = totalTasks === 0 ? 'no_tasks'
                : completedTasks === 0 ? 'not_started'
                    : completedTasks === totalTasks ? 'completed' : 'in_progress';

            return {
                id: project.id,
                name: project.name,
                start_date: project.start_date,
                end_date: project.end_date,
                status,
                total_tasks: totalTasks,
                completed_tasks: completedTasks,
                completion_pct: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
                stages: stageDetails
            };
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Agent: Workload / loading overview
app.get('/api/agent/loading', (req, res) => {
    try {
        const projects = db.prepare('SELECT * FROM projects').all();
        const now = new Date();

        let activeProjects = 0, delayedProjects = 0, totalTasks = 0, pendingTasks = 0, delayedTasks = 0;

        projects.forEach(project => {
            const stages = db.prepare('SELECT * FROM stages WHERE project_id = ?').all(project.id);
            let projTasks = 0, projCompleted = 0, projDelayed = false;
            stages.forEach(stage => {
                const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
                tasks.forEach(t => {
                    projTasks++;
                    totalTasks++;
                    if (t.status === 'completed') projCompleted++;
                    else {
                        pendingTasks++;
                        if (new Date(t.end_date) < now) { delayedTasks++; projDelayed = true; }
                    }
                });
            });
            if (projTasks > 0 && projCompleted < projTasks) activeProjects++;
            if (projDelayed) delayedProjects++;
        });

        res.json({
            timestamp: now.toISOString(),
            total_projects: projects.length,
            active_projects: activeProjects,
            delayed_projects: delayedProjects,
            total_tasks: totalTasks,
            pending_tasks: pendingTasks,
            delayed_tasks: delayedTasks
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Departments API ===
app.get('/api/departments', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM departments').all();
        const depts = rows.map(d => {
            const tasks = db.prepare('SELECT task_name FROM department_tasks WHERE department_id = ?').all(d.id);
            return { ...d, tasks: tasks.map(t => t.task_name) };
        });
        res.json(depts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/departments', (req, res) => {
    const { name, color, tasks } = req.body;
    console.log('Saving Department:', { name, color, tasks });
    try {
        const info = db.transaction(() => {
            const result = db.prepare('INSERT INTO departments (name, color) VALUES (?, ?)').run(name, color);
            const deptId = result.lastInsertRowid;
            console.log('Department inserted, ID:', deptId);
            if (tasks && Array.isArray(tasks)) {
                const stmt = db.prepare('INSERT INTO department_tasks (department_id, task_name) VALUES (?, ?)');
                for (const task of tasks) {
                    stmt.run(deptId, task);
                }
                console.log('Tasks inserted for dept:', deptId);
            }
            return deptId;
        })();
        res.json({ success: true, id: info });
    } catch (err) {
        console.error('Department Save Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/departments/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/departments/:id', (req, res) => {
    const { name, color, tasks } = req.body;
    try {
        db.transaction(() => {
            db.prepare('UPDATE departments SET name = ?, color = ? WHERE id = ?').run(name, color, req.params.id);
            // Re-sync tasks: delete old ones, insert new ones
            db.prepare('DELETE FROM department_tasks WHERE department_id = ?').run(req.params.id);
            if (tasks && Array.isArray(tasks)) {
                const stmt = db.prepare('INSERT INTO department_tasks (department_id, task_name) VALUES (?, ?)');
                for (const task of tasks) {
                    stmt.run(req.params.id, task);
                }
            }
        })();
        res.json({ success: true });
    } catch (err) {
        console.error('Dept Update Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Stage Templates API ===
app.get('/api/stage-templates', (req, res) => {
    try {
        const templates = db.prepare('SELECT * FROM stage_templates ORDER BY created_at ASC').all();
        const result = templates.map(t => {
            const items = db.prepare('SELECT * FROM stage_template_items WHERE template_id = ? ORDER BY "order" ASC').all(t.id);
            return { ...t, stages: items };
        });
        res.json(result);
    } catch (err) {
        console.error('Stage templates fetch error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stage-templates', (req, res) => {
    const { name, stages } = req.body;
    if (!name || !stages || !Array.isArray(stages)) {
        return res.status(400).json({ error: 'Missing name or stages' });
    }
    try {
        const result = db.transaction(() => {
            const info = db.prepare('INSERT INTO stage_templates (name) VALUES (?)').run(name);
            const templateId = info.lastInsertRowid;
            const insertItem = db.prepare('INSERT INTO stage_template_items (template_id, name, days, "order") VALUES (?, ?, ?, ?)');
            stages.forEach((s, i) => insertItem.run(templateId, s.name, s.days || 1, i));
            return templateId;
        })();
        const newTemplate = db.prepare('SELECT * FROM stage_templates WHERE id = ?').get(result);
        const items = db.prepare('SELECT * FROM stage_template_items WHERE template_id = ? ORDER BY "order" ASC').all(result);
        res.json({ success: true, template: { ...newTemplate, stages: items } });
    } catch (err) {
        console.error('Stage template create error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/stage-templates/:id', (req, res) => {
    const { name, stages } = req.body;
    if (!name || !stages || !Array.isArray(stages)) {
        return res.status(400).json({ error: 'Missing name or stages' });
    }
    try {
        db.transaction(() => {
            db.prepare('UPDATE stage_templates SET name = ? WHERE id = ?').run(name, req.params.id);
            db.prepare('DELETE FROM stage_template_items WHERE template_id = ?').run(req.params.id);
            const insertItem = db.prepare('INSERT INTO stage_template_items (template_id, name, days, "order") VALUES (?, ?, ?, ?)');
            stages.forEach((s, i) => insertItem.run(req.params.id, s.name, s.days || 1, i));
        })();
        res.json({ success: true });
    } catch (err) {
        console.error('Stage template update error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/stage-templates/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM stage_templates WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Stage template delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Start Server ===
// Archive project (soft delete)
app.patch('/api/projects/:id/archive', (req, res) => {
    try {
        db.prepare("UPDATE projects SET status = 'closed' WHERE id = ?").run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restore project from archive
app.patch('/api/projects/:id/unarchive', (req, res) => {
    try {
        db.prepare("UPDATE projects SET status = 'active' WHERE id = ?").run(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update project schedule with reason
app.patch('/api/projects/:id/schedule', (req, res) => {
    const { new_end_date, reason } = req.body;
    if (!new_end_date || !reason) {
        return res.status(400).json({ error: 'Missing new_end_date or reason' });
    }
    try {
        const project = db.prepare('SELECT end_date FROM projects WHERE id = ?').get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const transaction = db.transaction(() => {
            db.prepare('UPDATE projects SET end_date = ? WHERE id = ?').run(new_end_date, req.params.id);
            db.prepare('INSERT INTO project_logs (project_id, reason, old_end_date, new_end_date) VALUES (?, ?, ?, ?)')
                .run(req.params.id, reason, project.end_date, new_end_date);
        });
        transaction();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get project logs
app.get('/api/projects/:id/logs', (req, res) => {
    try {
        const logs = db.prepare('SELECT * FROM project_logs WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Helper: get full project data with recursive task tree ===
function getFullProjectData(projectId) {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) return null;

    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY "order"').all(projectId);
    project.stages = stages.map(stage => {
        const allTasks = db.prepare(`
            SELECT s.*, d.color as dept_color 
            FROM sub_tasks s 
            LEFT JOIN departments d ON s.department = d.name
            WHERE s.stage_id = ?
        `).all(stage.id);
        return { ...stage, tasks: buildTaskTree(allTasks, null) };
    });

    return project;
}
// === Announcements API ===
app.get('/api/announcements', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT a.*, u.username 
            FROM announcements a 
            LEFT JOIN users u ON a.user_id = u.id 
            ORDER BY a.pinned DESC, a.created_at DESC
        `).all();
        res.json(rows);
    } catch (err) {
        console.error('Announcements fetch error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/announcements', (req, res) => {
    try {
        const { user_id, department, title, content, pinned } = req.body;
        if (!title) return res.status(400).json({ error: 'title is required' });
        const result = db.prepare(
            'INSERT INTO announcements (user_id, department, title, content, pinned) VALUES (?, ?, ?, ?, ?)'
        ).run(user_id || 1, department || '', title, content || '', pinned ? 1 : 0);
        const newAnn = db.prepare('SELECT * FROM announcements WHERE id = ?').get(result.lastInsertRowid);
        res.json(newAnn);
    } catch (err) {
        console.error('Announcement create error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/announcements/:id', (req, res) => {
    try {
        const { title, content, department, pinned } = req.body;
        const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
        if (!existing) return res.status(404).json({ error: '公告不存在' });
        db.prepare(
            'UPDATE announcements SET title = ?, content = ?, department = ?, pinned = ? WHERE id = ?'
        ).run(
            title ?? existing.title,
            content ?? existing.content,
            department ?? existing.department,
            pinned !== undefined ? (pinned ? 1 : 0) : existing.pinned,
            req.params.id
        );
        const updated = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (err) {
        console.error('Announcement update error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/announcements/:id', (req, res) => {
    try {
        const result = db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
        if (result.changes === 0) return res.status(404).json({ error: '公告不存在' });
        res.json({ success: true });
    } catch (err) {
        console.error('Announcement delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Tasks: Today's Todos ===
app.get('/api/tasks/today', (req, res) => {
    try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const rows = db.prepare(`
            SELECT s.*, st.name as stage_name, p.name as project_name, p.id as project_id
            FROM sub_tasks s
            JOIN stages st ON s.stage_id = st.id
            JOIN projects p ON st.project_id = p.id
            WHERE p.status = 'active'
              AND s.status != 'completed'
              AND date(s.start_date) <= date(?)
            ORDER BY s.end_date ASC
        `).all(todayStr);
        res.json(rows);
    } catch (err) {
        console.error('Today tasks error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Tasks: Delayed (overdue) ===
app.get('/api/tasks/delayed', (req, res) => {
    try {
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        const rows = db.prepare(`
            SELECT s.*, st.name as stage_name, p.name as project_name, p.id as project_id
            FROM sub_tasks s
            JOIN stages st ON s.stage_id = st.id
            JOIN projects p ON st.project_id = p.id
            WHERE p.status = 'active'
              AND s.status != 'completed'
              AND date(s.end_date) < date(?)
            ORDER BY s.end_date ASC
        `).all(todayStr);
        res.json(rows);
    } catch (err) {
        console.error('Delayed tasks error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === EXPORT: Excel ===
const ExcelJS = require('exceljs');

app.get('/api/projects/:id/export/excel', async (req, res) => {
    try {
        const project = getFullProjectData(parseInt(req.params.id));
        if (!project) return res.status(404).json({ error: '專案不存在' });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = '專甘管';

        // Color palette for depth levels
        const depthColors = ['FF6366F1', 'FF22C55E', 'FFF59E0B', 'FFEF4444', 'FF8B5CF6', 'FF06B6D4'];
        const depthLightColors = ['FFE0E7FF', 'FFDCFCE7', 'FFFEF3C7', 'FFFEE2E2', 'FFEDE9FE', 'FFCFFAFE'];

        // === Summary sheet ===
        const summarySheet = workbook.addWorksheet('專案總覽');
        summarySheet.columns = [
            { header: '項目', key: 'label', width: 20 },
            { header: '內容', key: 'value', width: 40 }
        ];
        summarySheet.addRow({ label: '專案名稱', value: project.name });
        summarySheet.addRow({ label: '起始日期', value: project.start_date });
        summarySheet.addRow({ label: '結束日期', value: project.end_date });
        summarySheet.addRow({ label: '階段數', value: project.stages.length });
        summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

        // === Gantt Chart Sheet ===
        const ganttSheet = workbook.addWorksheet('📊 甘特圖');

        // Find project date range
        const projStart = new Date(project.start_date);
        const projEnd = project.end_date ? new Date(project.end_date) : new Date();
        const totalDays = Math.max(1, Math.ceil((projEnd - projStart) / 86400000));

        // Generate date columns
        const dateColumns = [];
        for (let d = 0; d <= totalDays; d++) {
            const dt = addDays(projStart, d);
            dateColumns.push({
                date: dt,
                label: `${(dt.getMonth() + 1)}/${dt.getDate()}`
            });
        }

        // Flatten all stages + tasks for Gantt rows  
        const flattenAll = (stages) => {
            const rows = [];
            stages.forEach(stage => {
                rows.push({ type: 'stage', name: stage.name, start: stage.start_date, end: stage.end_date, depth: -1, status: '' });
                const addTasks = (tasks, depth = 0) => {
                    tasks.forEach(t => {
                        rows.push({ type: 'task', name: t.name, start: t.start_date, end: t.end_date, depth, status: t.status, department: t.department || '' });
                        if (t.children && t.children.length) addTasks(t.children, depth + 1);
                    });
                };
                addTasks(stage.tasks || []);
            });
            return rows;
        };
        const ganttRows = flattenAll(project.stages);

        // Set up columns: Task name + date columns
        const ganttCols = [
            { header: '任務名稱', key: 'name', width: 25 },
            { header: '部門', key: 'dept', width: 10 }
        ];
        dateColumns.forEach((dc, i) => {
            ganttCols.push({ header: dc.label, key: `d${i}`, width: 5 });
        });
        ganttSheet.columns = ganttCols;

        // Style header
        const headerRow = ganttSheet.getRow(1);
        headerRow.font = { bold: true, size: 7, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        headerRow.height = 20;

        // Add Gantt rows
        ganttRows.forEach(row => {
            const isStage = row.type === 'stage';
            const indent = isStage ? '' : '  '.repeat(row.depth);
            const rowData = { name: `${indent}${row.name}`, dept: row.department || '' };

            // Fill date columns
            const taskStart = new Date(row.start);
            const taskEnd = new Date(row.end);

            dateColumns.forEach((dc, i) => {
                if (dc.date >= taskStart && dc.date <= taskEnd) {
                    rowData[`d${i}`] = ''; // Empty but will be colored
                }
            });

            const excelRow = ganttSheet.addRow(rowData);

            // Style the row
            if (isStage) {
                excelRow.font = { bold: true, size: 9 };
                excelRow.getCell('name').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            } else {
                excelRow.font = { size: 8 };
            }

            // Color the date cells
            dateColumns.forEach((dc, i) => {
                if (dc.date >= taskStart && dc.date <= taskEnd) {
                    const cell = excelRow.getCell(`d${i}`);
                    let fillColor;
                    if (isStage) {
                        fillColor = 'FFA78355';
                    } else if (row.status === 'completed') {
                        fillColor = 'FF22C55E';
                    } else {
                        const colorIdx = Math.max(0, row.depth) % depthColors.length;
                        fillColor = depthColors[colorIdx];
                    }
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
                }
            });

            excelRow.height = isStage ? 18 : 15;
        });

        // Freeze first 2 columns
        ganttSheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

        // === Detail sheets per stage ===
        project.stages.forEach((stage, idx) => {
            const sheetName = `${idx + 1}. ${stage.name}`.substring(0, 31);
            const sheet = workbook.addWorksheet(sheetName);

            sheet.columns = [
                { header: '層級', key: 'level', width: 8 },
                { header: '任務名稱', key: 'name', width: 35 },
                { header: '負責部門', key: 'department', width: 15 },
                { header: '起始時間', key: 'start_date', width: 22 },
                { header: '結束時間', key: 'end_date', width: 22 },
                { header: '狀態', key: 'status', width: 10 },
                { header: '進度', key: 'progress', width: 10 }
            ];
            sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFA78355' } };

            sheet.addRow({ level: '階段', name: stage.name, department: '', start_date: stage.start_date, end_date: stage.end_date, status: '', progress: '' });
            sheet.getRow(2).font = { bold: true };

            const addTaskRows = (tasks, depth = 0) => {
                tasks.forEach(task => {
                    const indent = '  '.repeat(depth);
                    sheet.addRow({
                        level: `L${depth + 1}`,
                        name: `${indent}${task.name}`,
                        department: task.department || '',
                        start_date: task.start_date,
                        end_date: task.end_date,
                        status: task.status === 'completed' ? '✅ 完成' : '⏳ 進行中',
                        progress: `${task.progress || 0}%`
                    });
                    if (task.children && task.children.length > 0) {
                        addTaskRows(task.children, depth + 1);
                    }
                });
            };
            addTaskRows(stage.tasks || []);
        });

        // Send as download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(project.name)}_gantt.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Excel export error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === EXPORT: JSON (template for import) ===
app.get('/api/projects/:id/export/json', (req, res) => {
    try {
        const project = getFullProjectData(parseInt(req.params.id));
        if (!project) return res.status(404).json({ error: '專案不存在' });

        const projectStart = new Date(project.start_date);

        // Convert task tree to template with relative days
        const taskToTemplate = (task) => {
            const startDays = Math.round((new Date(task.start_date) - projectStart) / 86400000);
            const endDays = Math.round((new Date(task.end_date) - projectStart) / 86400000);
            return {
                name: task.name,
                department: task.department || '',
                startDay: startDays,
                endDay: endDays,
                children: (task.children || []).map(taskToTemplate)
            };
        };

        const template = {
            _format: 'antigravity-gantt-v1',
            name: project.name,
            totalDays: project.end_date
                ? Math.round((new Date(project.end_date) - projectStart) / 86400000)
                : 30,
            stages: project.stages.map(stage => {
                const stageStartDays = Math.round((new Date(stage.start_date) - projectStart) / 86400000);
                const stageEndDays = Math.round((new Date(stage.end_date) - projectStart) / 86400000);
                return {
                    name: stage.name,
                    order: stage.order,
                    startDay: stageStartDays,
                    endDay: stageEndDays,
                    tasks: (stage.tasks || []).map(taskToTemplate)
                };
            })
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(project.name)}_template.json"`);
        res.json(template);
    } catch (err) {
        console.error('JSON export error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === IMPORT: JSON template → new project ===
app.post('/api/projects/import', (req, res) => {
    const { userId, template, name, start_date } = req.body;

    if (!userId || !template || !name || !start_date) {
        return res.status(400).json({ error: '需要 userId, template, name, start_date' });
    }

    if (template._format !== 'antigravity-gantt-v1') {
        return res.status(400).json({ error: '無效的模板格式' });
    }

    try {
        const projectStart = new Date(start_date);

        const insertProject = db.prepare('INSERT INTO projects (user_id, name, start_date, end_date) VALUES (?, ?, ?, ?)');
        const insertStage = db.prepare('INSERT INTO stages (project_id, name, "order", start_date, end_date) VALUES (?, ?, ?, ?, ?)');
        const insertTask = db.prepare('INSERT INTO sub_tasks (stage_id, parent_task_id, name, department, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)');

        const transaction = db.transaction(() => {
            const projectEnd = addDays(projectStart, template.totalDays);
            const projInfo = insertProject.run(userId, name, projectStart.toISOString(), projectEnd.toISOString());
            const projectId = projInfo.lastInsertRowid;

            template.stages.forEach(stageTemplate => {
                const stageStart = addDays(projectStart, stageTemplate.startDay);
                const stageEnd = addDays(projectStart, stageTemplate.endDay);
                const stageInfo = insertStage.run(projectId, stageTemplate.name, stageTemplate.order || 0, stageStart.toISOString(), stageEnd.toISOString());
                const stageId = stageInfo.lastInsertRowid;

                // Recursively insert tasks
                const insertTaskTree = (tasks, parentId = null) => {
                    tasks.forEach(taskTemplate => {
                        const taskStart = addDays(projectStart, taskTemplate.startDay);
                        const taskEnd = addDays(projectStart, taskTemplate.endDay);
                        const taskInfo = insertTask.run(stageId, parentId, taskTemplate.name, taskTemplate.department || '', taskStart.toISOString(), taskEnd.toISOString());
                        const taskId = taskInfo.lastInsertRowid;

                        if (taskTemplate.children && taskTemplate.children.length > 0) {
                            insertTaskTree(taskTemplate.children, taskId);
                        }
                    });
                };

                insertTaskTree(stageTemplate.tasks || []);
            });

            return projectId;
        });

        const projectId = transaction();
        res.json({ success: true, projectId });
    } catch (err) {
        console.error('JSON import error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === EXPORT: PDF (via Python reportlab) ===
const { execSync } = require('child_process');

app.get('/api/projects/:id/export/pdf', (req, res) => {
    try {
        const project = getFullProjectData(parseInt(req.params.id));
        if (!project) return res.status(404).json({ error: '專案不存在' });

        // Write project data to temp file
        const tmpDir = os.tmpdir();
        const dataFile = path.join(tmpDir, `gantt_pdf_data_${Date.now()}.json`);
        const outputFile = path.join(tmpDir, `gantt_pdf_output_${Date.now()}.pdf`);

        fs.writeFileSync(dataFile, JSON.stringify(project, null, 2), 'utf-8');

        // Run Python script
        const scriptPath = path.join(__dirname, 'generate_pdf.py');
        try {
            execSync(`python "${scriptPath}" "${dataFile}" "${outputFile}"`, {
                timeout: 30000,
                encoding: 'utf-8'
            });
        } catch (pyErr) {
            console.error('Python PDF generation failed:', pyErr.message);
            // Clean up
            try { fs.unlinkSync(dataFile); } catch (e) { }
            return res.status(500).json({ error: 'PDF 生成失敗，請確認已安裝 Python 和 reportlab' });
        }

        // Send PDF
        if (fs.existsSync(outputFile)) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(project.name)}_gantt.pdf"`);
            const stream = fs.createReadStream(outputFile);
            stream.pipe(res);
            stream.on('end', () => {
                // Clean up temp files
                try { fs.unlinkSync(dataFile); } catch (e) { }
                try { fs.unlinkSync(outputFile); } catch (e) { }
            });
        } else {
            try { fs.unlinkSync(dataFile); } catch (e) { }
            res.status(500).json({ error: 'PDF 檔案未生成' });
        }
    } catch (err) {
        console.error('PDF export error:', err);
        res.status(500).json({ error: err.message });
    }
});


// === AI Agent Chat API ===
initAgent();
initOperatorAgent();

app.get('/api/agent/provider', (req, res) => {
    res.json({ provider: getActiveProvider() });
});

app.post('/api/agent/provider', (req, res) => {
    try {
        const { provider } = req.body;
        if (!provider) return res.status(400).json({ error: 'provider is required' });
        setProvider(provider);
        res.json({ success: true, provider: getActiveProvider() });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/agent/chat', async (req, res) => {
    const { message, sessionId = 'default' } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    try {
        const result = await handleChat(db, sessionId, message);
        res.json(result);
    } catch (err) {
        console.error('Agent chat error:', err);
        res.status(500).json({ error: 'Agent 回覆失敗：' + err.message });
    }
});

app.post('/api/agent/clear', (req, res) => {
    const { sessionId = 'default' } = req.body;
    clearConversation(sessionId);
    res.json({ success: true });
});

// === Group Chat (Unified Route) ===
// Auto-route to consultant or operator based on @mention or intent keywords
const OPERATOR_KEYWORDS = ['新增', '刪除', '移除', '修改', '調整', '更新', '結案', '解除結案', '加入', '建立', '設定日期', '設定', '延後', '提前', '標記完成', '截止', '確認執行', '確認'];
const CONSULTANT_KEYWORDS = ['查詢', '分析', '風險', '狀態', '目前', '報告', '建議', '工作負載', '逾期', '待辦', '如何', '為什麼', '怎麼', '嗎', '哪些', '幾個', '多少'];

function detectTarget(message) {
    const trimmed = message.trim();
    if (trimmed.startsWith('@顧問') || trimmed.startsWith('@consultant')) return 'consultant';
    if (trimmed.startsWith('@操作員') || trimmed.startsWith('@operator')) return 'operator';
    // Auto-detect by keywords
    for (const kw of OPERATOR_KEYWORDS) {
        if (trimmed.includes(kw)) return 'operator';
    }
    for (const kw of CONSULTANT_KEYWORDS) {
        if (trimmed.includes(kw)) return 'consultant';
    }
    return 'consultant'; // default
}

function stripMention(message) {
    return message.replace(/^@(顧問|操作員|consultant|operator)\s*/i, '').trim();
}

app.post('/api/group-chat', async (req, res) => {
    const { message, sessionId = 'default', target: explicitTarget, sharedContext = '' } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const target = explicitTarget || detectTarget(message);
    const cleanMessage = stripMention(message);

    // Inject today's date info
    const now = new Date();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const dateInfo = `[系統資訊] 今天是 ${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}（星期${weekdays[now.getDay()]}）`;
    const fullSharedContext = sharedContext ? `${dateInfo}\n${sharedContext}` : dateInfo;

    try {
        let result;
        if (target === 'operator') {
            result = await handleOperatorChat(db, `op_${sessionId}`, cleanMessage, fullSharedContext);
        } else {
            result = await handleChat(db, `cs_${sessionId}`, cleanMessage, fullSharedContext);
        }
        result.agent = target;
        res.json(result);
    } catch (err) {
        console.error('Group chat error:', err);
        res.json({ agent: target, reply: '😅 不好意思，我在處理您的請求時遇到了一些技術問題。能麻煩您再描述一次嗎？我會盡力幫忙！😊', tools_called: [] });
    }
});

app.post('/api/group-chat/clear', (req, res) => {
    const { sessionId = 'default' } = req.body;
    clearConversation(`cs_${sessionId}`);
    clearOperatorConversation(`op_${sessionId}`);
    res.json({ success: true });
});

app.get('/api/operator/provider', (req, res) => {
    res.json({ provider: getOperatorProvider() });
});

app.post('/api/operator/provider', (req, res) => {
    try {
        const { provider } = req.body;
        if (!provider) return res.status(400).json({ error: 'provider is required' });
        setOperatorProvider(provider);
        res.json({ success: true, provider: getOperatorProvider() });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/operator/chat', async (req, res) => {
    const { message, sessionId = 'default' } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    try {
        const result = await handleOperatorChat(db, sessionId, message);
        res.json(result);
    } catch (err) {
        console.error('Operator chat error:', err);
        res.status(500).json({ error: '操作員 Agent 回覆失敗：' + err.message });
    }
});

app.post('/api/operator/execute', (req, res) => {
    const { password, action_id } = req.body;
    if (!password || !action_id) return res.status(400).json({ error: 'password and action_id are required' });

    // Check required auth level
    const authLevel = getOperatorAuthLevel(action_id);
    if (!authLevel) return res.status(404).json({ error: '找不到待執行操作或已過期' });

    // Verify password
    if (authLevel === 'admin') {
        if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: '管理員密碼錯誤' });
    } else {
        if (password !== EDIT_PASSWORD && password !== ADMIN_PASSWORD) return res.status(401).json({ error: '編輯密碼錯誤' });
    }

    try {
        const result = handleOperatorExecute(db, action_id);
        res.json(result);
    } catch (err) {
        console.error('Operator execute error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/operator/clear', (req, res) => {
    const { sessionId = 'default' } = req.body;
    clearOperatorConversation(sessionId);
    res.json({ success: true });
});

// === Serve static frontend (production / Docker) ===
const clientDistPath = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api')) {
            res.sendFile(path.join(clientDistPath, 'index.html'));
        } else {
            next();
        }
    });
    console.log('Serving static files from:', clientDistPath);
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
}).on('error', (err) => {
    console.error('Server Listen Error:', err);
});

process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
