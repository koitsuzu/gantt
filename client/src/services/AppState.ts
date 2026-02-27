/**
 * AppState - 集中管理應用程式狀態
 * 所有 View 組件共享此狀態物件
 */
export interface AppState {
    currentUserId: number;
    isEditMode: boolean;
    isAdminMode: boolean;
    activeTab: string;
    currentProjectId: number | null;
    departments: any[];
    stageTemplates: any[];
    allProjectsData: any[];

    // 回調方法：讓 View 能觸發主控制器的重新載入
    reloadAll: () => Promise<void>;
    refreshGantt: () => void;
}
