CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    start_date DATETIME,
    end_date DATETIME,
    status TEXT DEFAULT 'active', -- 'active' or 'closed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    old_end_date DATETIME,
    new_end_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    start_date DATETIME,
    end_date DATETIME,
    color TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sub_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER NOT NULL,
    parent_task_id INTEGER DEFAULT NULL,
    name TEXT NOT NULL,
    department TEXT DEFAULT '',
    start_date DATETIME NOT NULL,
    end_date DATETIME NOT NULL,
    baseline_start_date DATETIME,
    baseline_end_date DATETIME,
    progress INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    kanban_status TEXT DEFAULT 'todo',
    completed_at DATETIME,
    FOREIGN KEY (stage_id) REFERENCES stages(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_task_id) REFERENCES sub_tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sub_task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    change_type TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES sub_tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS department_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    task_name TEXT NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- Update sub_tasks to include optional department_id for color relations
-- Note: We'll keep 'department' TEXT for display, but can use it to link to settings.

CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    department TEXT DEFAULT '',
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT OR IGNORE INTO users (username, email) VALUES ('admin', 'admin@example.com');
INSERT OR IGNORE INTO users (username, email) VALUES ('user1', 'user1@example.com');

CREATE TABLE IF NOT EXISTS stage_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stage_template_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    days INTEGER NOT NULL DEFAULT 7,
    "order" INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (template_id) REFERENCES stage_templates(id) ON DELETE CASCADE
);

