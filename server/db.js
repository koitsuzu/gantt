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

console.log('Database initialized successfully.');

module.exports = db;
