const express = require('express');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Logging Middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// === Helper: add N days to a date ===
function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
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
        const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY end_date ASC').all(userId);
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
        const summaries = projects.map(project => {
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

// === Stages API ===
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

// === Create Stage ===
app.post('/api/stages', (req, res) => {
    const { project_id, name, start_date, end_date, order } = req.body;
    if (!project_id || !name || !start_date || !end_date) {
        return res.status(400).json({ error: 'Missing required fields: project_id, name, start_date, end_date' });
    }

    try {
        const stmt = db.prepare('INSERT INTO stages (project_id, name, "order", start_date, end_date) VALUES (?, ?, ?, ?, ?)');
        const info = stmt.run(project_id, name, order || 0, start_date, end_date);
        res.json({ success: true, stageId: info.lastInsertRowid });
    } catch (err) {
        console.error('Stage creation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Sub-task Completion Toggle ===
app.patch('/api/sub-tasks/:id/complete', (req, res) => {
    const { status } = req.body;
    try {
        const newStatus = status === 'completed' ? 'completed' : 'pending';
        const progress = newStatus === 'completed' ? 100 : 0;
        db.prepare('UPDATE sub_tasks SET status = ?, progress = ? WHERE id = ?').run(newStatus, progress, req.params.id);
        res.json({ success: true, status: newStatus });
    } catch (err) {
        console.error('Sub-task completion error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Sub-tasks API ===
app.post('/api/sub-tasks', (req, res) => {
    const { stageId, name, department, start_date, end_date } = req.body;
    console.log('Creating sub-task:', { stageId, name, department, start_date, end_date });

    if (!stageId || !name || !start_date || !end_date) {
        return res.status(400).json({ error: 'Missing required fields: stageId, name, start_date, end_date' });
    }

    // Validate: sub-task must be within parent stage range
    try {
        const stage = db.prepare('SELECT start_date, end_date FROM stages WHERE id = ?').get(stageId);
        if (!stage) {
            return res.status(400).json({ error: '找不到對應的階段' });
        }
        const stageStart = new Date(stage.start_date);
        const stageEnd = new Date(stage.end_date);
        const subStart = new Date(start_date);
        const subEnd = new Date(end_date);

        if (subStart < stageStart || subEnd > stageEnd) {
            return res.status(400).json({ error: '子任務時間範圍不能超過所屬階段的時間範圍' });
        }
        if (subStart >= subEnd) {
            return res.status(400).json({ error: '開始時間必須早於結束時間' });
        }

        const stmt = db.prepare('INSERT INTO sub_tasks (stage_id, name, department, start_date, end_date) VALUES (?, ?, ?, ?, ?)');
        const info = stmt.run(stageId, name, department || '', start_date, end_date);
        console.log('Sub-task created:', info.lastInsertRowid);
        res.json({ success: true, taskId: info.lastInsertRowid });
    } catch (err) {
        console.error('Sub-task Creation Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/sub-tasks/:id', (req, res) => {
    const { start_date, end_date } = req.body;
    try {
        // Find parent stage to clamp dates
        const subTask = db.prepare('SELECT stage_id FROM sub_tasks WHERE id = ?').get(req.params.id);
        if (subTask) {
            const stage = db.prepare('SELECT start_date, end_date FROM stages WHERE id = ?').get(subTask.stage_id);
            if (stage) {
                const stageStart = new Date(stage.start_date);
                const stageEnd = new Date(stage.end_date);
                let subStart = new Date(start_date);
                let subEnd = new Date(end_date);

                // Clamp within parent stage
                if (subStart < stageStart) subStart = stageStart;
                if (subEnd > stageEnd) subEnd = stageEnd;
                if (subStart >= subEnd) subStart = new Date(subEnd.getTime() - 3600000); // At least 1hr

                const stmt = db.prepare('UPDATE sub_tasks SET start_date = ?, end_date = ? WHERE id = ?');
                stmt.run(subStart.toISOString(), subEnd.toISOString(), req.params.id);
                return res.json({ success: true });
            }
        }
        const stmt = db.prepare('UPDATE sub_tasks SET start_date = ?, end_date = ? WHERE id = ?');
        stmt.run(start_date, end_date, req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Sub-task update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === All Projects Gantt (unified timeline) ===
app.get('/api/all-projects-gantt', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    try {
        const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY end_date ASC').all(userId);
        const result = projects.map(project => {
            const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY "order"').all(project.id);
            const detailedStages = stages.map(stage => {
                const tasks = db.prepare('SELECT * FROM sub_tasks WHERE stage_id = ?').all(stage.id);
                return { ...stage, tasks };
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
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
}).on('error', (err) => {
    console.error('Server Listen Error:', err);
});

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
