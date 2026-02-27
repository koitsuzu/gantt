/**
 * ApiService - 集中管理所有後端 API 呼叫
 */
const API_URL = 'http://localhost:3000/api';

export class ApiService {
    // === 部門 ===
    static async getDepartments(): Promise<any[]> {
        const res = await fetch(`${API_URL}/departments`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    }

    // === 階段範本 ===
    static async getStageTemplates(): Promise<any[]> {
        const res = await fetch(`${API_URL}/stage-templates`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    }

    // === 專案 ===
    static async getAllProjectsGantt(userId: number, showAll = false): Promise<any[]> {
        const url = `${API_URL}/all-projects-gantt?userId=${userId}${showAll ? '&showAll=true' : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    }

    static async getProjectSummary(userId: number, showAll = false): Promise<any[]> {
        const url = `${API_URL}/projects/summary?userId=${userId}${showAll ? '&showAll=true' : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    }

    static async deleteProject(projectId: number): Promise<void> {
        await fetch(`${API_URL}/projects/${projectId}`, { method: 'DELETE' });
    }

    static async archiveProject(projectId: number): Promise<void> {
        const res = await fetch(`${API_URL}/projects/${projectId}/archive`, { method: 'PATCH' });
        if (!res.ok) throw new Error('結案失敗');
    }

    static async unarchiveProject(projectId: number): Promise<void> {
        await fetch(`${API_URL}/projects/${projectId}/unarchive`, { method: 'PATCH' });
    }

    static async updateProjectSchedule(projectId: number, newEndDate: string, reason: string): Promise<void> {
        const res = await fetch(`${API_URL}/projects/${projectId}/schedule`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_end_date: newEndDate, reason })
        });
        if (!res.ok) throw new Error('更新失敗');
    }

    static async getProjectLogs(projectId: number): Promise<any[]> {
        const res = await fetch(`${API_URL}/projects/${projectId}/logs`);
        if (!res.ok) return [];
        return res.json();
    }

    // === 公告 ===
    static async getAnnouncements(): Promise<any[]> {
        const res = await fetch(`${API_URL}/announcements`);
        return res.json();
    }

    static async updateAnnouncement(id: number, data: any): Promise<void> {
        await fetch(`${API_URL}/announcements/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }

    static async deleteAnnouncement(id: number): Promise<void> {
        await fetch(`${API_URL}/announcements/${id}`, { method: 'DELETE' });
    }

    // === 任務 ===
    static async getTodayTasks(): Promise<any[]> {
        const res = await fetch(`${API_URL}/tasks/today`);
        return res.json();
    }

    static async getDelayedTasks(): Promise<any[]> {
        const res = await fetch(`${API_URL}/tasks/delayed`);
        return res.json();
    }

    static async updateTaskStatus(taskId: number, status: string): Promise<void> {
        await fetch(`${API_URL}/sub-tasks/${taskId}/complete`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
    }

    static async updateTaskDates(id: number, startDate: string, endDate: string, isStage = false): Promise<void> {
        const type = isStage ? 'stages' : 'sub-tasks';
        await fetch(`${API_URL}/${type}/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_date: startDate, end_date: endDate })
        });
    }

    // === 看板 ===
    static async getTodayKanban(): Promise<any[]> {
        const res = await fetch(`${API_URL}/tasks/today/kanban`);
        return res.json();
    }

    static async updateKanbanStatus(taskId: number, kanbanStatus: string): Promise<void> {
        const res = await fetch(`${API_URL}/sub-tasks/${taskId}/kanban`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kanban_status: kanbanStatus })
        });
        if (!res.ok) throw new Error('更新看板狀態失敗');
    }

    // === 密碼驗證 ===
    static async verifyPassword(password: string): Promise<{ role: string }> {
        const res = await fetch(`${API_URL}/verify-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (!res.ok) throw new Error('密碼錯誤');
        return res.json();
    }

    // === 匯出 ===
    static getExportUrl(projectId: number, type: string): string {
        return `${API_URL}/projects/${projectId}/export/${type}`;
    }
}
