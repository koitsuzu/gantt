const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
    console.log('Creating data directory:', dbDir);
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.resolve(dbDir, 'gantt.db');
console.log('Connecting to database:', dbPath);

const db = new Database(dbPath, { verbose: console.log });
db.exec('PRAGMA foreign_keys = ON');

// Initialize DB schema
const schemaPath = path.resolve(__dirname, 'schema.sql');
if (!fs.existsSync(schemaPath)) {
    console.error('CRITICAL: Schema file not found at', schemaPath);
    process.exit(1);
}
const schema = fs.readFileSync(schemaPath, 'utf8');
console.log('Applying schema...');
db.exec(schema);

// Migration: Add status column if it doesn't exist
try {
    const columns = db.prepare('PRAGMA table_info(projects)').all();
    const hasStatus = columns.some(c => c.name === 'status');
    if (!hasStatus) {
        console.log('Migrating: Adding status column to projects table...');
        db.prepare("ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active'").run();
    }
} catch (err) {
    console.error('Migration error (projects.status):', err);
}

// Migration: Add parent_task_id column for recursive sub-tasks
try {
    const stColumns = db.prepare('PRAGMA table_info(sub_tasks)').all();
    const hasParentTaskId = stColumns.some(c => c.name === 'parent_task_id');
    if (!hasParentTaskId) {
        console.log('Migrating: Adding parent_task_id column to sub_tasks table...');
        db.prepare('ALTER TABLE sub_tasks ADD COLUMN parent_task_id INTEGER DEFAULT NULL REFERENCES sub_tasks(id) ON DELETE CASCADE').run();
    }
} catch (err) {
    console.error('Migration error (sub_tasks.parent_task_id):', err);
}

// Migration: Fix announcements table if it has wrong column names
try {
    const annColumns = db.prepare('PRAGMA table_info(announcements)').all();
    const hasUserId = annColumns.some(c => c.name === 'user_id');
    if (annColumns.length > 0 && !hasUserId) {
        console.log('Migrating: Recreating announcements table with correct schema...');
        db.exec('DROP TABLE IF EXISTS announcements');
        db.exec(`CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            department TEXT DEFAULT '',
            title TEXT NOT NULL,
            content TEXT DEFAULT '',
            pinned INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
    }
} catch (err) {
    console.error('Migration error (announcements):', err);
}

// Migration: Create stage_templates and stage_template_items tables if not exists
try {
    const templateTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stage_templates'").get();
    if (!templateTables) {
        console.log('Migrating: Creating stage_templates tables...');
        db.exec(`CREATE TABLE IF NOT EXISTS stage_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.exec(`CREATE TABLE IF NOT EXISTS stage_template_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            days INTEGER NOT NULL DEFAULT 7,
            "order" INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (template_id) REFERENCES stage_templates(id) ON DELETE CASCADE
        )`);
        // Seed default template
        const info = db.prepare('INSERT OR IGNORE INTO stage_templates (name) VALUES (?)').run('預設範本');
        if (info.lastInsertRowid) {
            const insertItem = db.prepare('INSERT INTO stage_template_items (template_id, name, days, "order") VALUES (?, ?, ?, ?)');
            [['需求確認', 3], ['規格定義', 5], ['執行', 10], ['測試', 5], ['結案', 2]].forEach(([n, d], i) => {
                insertItem.run(info.lastInsertRowid, n, d, i);
            });
        }
    }
} catch (err) {
    console.error('Migration error (stage_templates):', err);
}

// Migration: Add baseline columns, kanban_status, completed_at to sub_tasks
try {
    const stCols = db.prepare('PRAGMA table_info(sub_tasks)').all();
    const colNames = stCols.map(c => c.name);

    if (!colNames.includes('baseline_start_date')) {
        console.log('Migrating: Adding baseline_start_date to sub_tasks...');
        db.prepare('ALTER TABLE sub_tasks ADD COLUMN baseline_start_date DATETIME').run();
        // Backfill: set baseline = current dates for existing tasks
        db.prepare('UPDATE sub_tasks SET baseline_start_date = start_date WHERE baseline_start_date IS NULL').run();
    }
    if (!colNames.includes('baseline_end_date')) {
        console.log('Migrating: Adding baseline_end_date to sub_tasks...');
        db.prepare('ALTER TABLE sub_tasks ADD COLUMN baseline_end_date DATETIME').run();
        db.prepare('UPDATE sub_tasks SET baseline_end_date = end_date WHERE baseline_end_date IS NULL').run();
    }
    if (!colNames.includes('kanban_status')) {
        console.log('Migrating: Adding kanban_status to sub_tasks...');
        db.prepare("ALTER TABLE sub_tasks ADD COLUMN kanban_status TEXT DEFAULT 'todo'").run();
    }
    if (!colNames.includes('completed_at')) {
        console.log('Migrating: Adding completed_at to sub_tasks...');
        db.prepare('ALTER TABLE sub_tasks ADD COLUMN completed_at DATETIME').run();
        // Backfill: set completed_at for tasks already completed
        db.prepare("UPDATE sub_tasks SET completed_at = CURRENT_TIMESTAMP WHERE status = 'completed' AND completed_at IS NULL").run();
    }
} catch (err) {
    console.error('Migration error (sub_tasks baseline/kanban):', err);
}

// Migration: Create sub_task_logs table
try {
    const logTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_task_logs'").get();
    if (!logTable) {
        console.log('Migrating: Creating sub_task_logs table...');
        db.exec(`CREATE TABLE IF NOT EXISTS sub_task_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            change_type TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            reason TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES sub_tasks(id) ON DELETE CASCADE
        )`);
    }
} catch (err) {
    console.error('Migration error (sub_task_logs):', err);
}

console.log('Database initialized successfully.');

module.exports = db;
