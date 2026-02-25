# 專甘管 — 精準專案管理甘特圖系統

互動式甘特圖專案管理工具，支援多專案、階段 / 子任務管理、部門色標、公告系統，並可透過 Docker 一鍵部署。

---

## 功能總覽

| 功能模組 | 說明 |
|---------|------|
| 📊 **甘特圖** | 支援時/日/週/月/季/年六種時間尺度，可摺疊展開各層級 |
| 📁 **多專案管理** | 建立多個專案，每個專案有獨立階段 (Stage) 與子任務 (Sub-task) |
| 🎨 **部門色標** | 自訂各部門顏色，任務依部門自動著色 |
| 📢 **公告系統** | 新增 / 編輯 / 刪除 / 置頂公告，可依部門篩選 |
| ✅ **今日待辦** | 自動篩選今日範圍內的未完成任務 |
| ⚠️ **DELAY 明細** | 自動篩選已逾期未完成任務，顯示逾期天數 |
| 🔒 **唯讀 / 編輯模式** | 預設唯讀，輸入密碼後切換至編輯模式 |
| 📥 **專案匯入** | 支援 CSV 批次匯入專案資料 |
| 📤 **專案匯出** | 匯出 Excel (.xlsx) 含甘特圖 |
| 🖱️ **拖拉調整** | 可拖拉分隔線調整專案概覽 / 甘特圖區域比例 |
| 🏷️ **變更紀錄** | 記錄專案結束日期的每次變更原因 |

---

## 技術架構

```
gantt/
├── client/                  # 前端 (Vite + TypeScript)
│   ├── src/
│   │   ├── main.ts          # 主程式邏輯
│   │   ├── renderer.ts      # 甘特圖渲染引擎
│   │   ├── interaction.ts   # 拖拉互動邏輯
│   │   └── style.css        # 全域樣式
│   └── index.html
├── server/                  # 後端 (Express + SQLite)
│   ├── app.js               # API 路由
│   ├── db.js                # 資料庫初始化 + Migration
│   ├── schema.sql           # 資料表結構
│   └── data/                # 資料庫檔案 (自動建立)
├── .env.example             # 環境變數範本
├── Dockerfile               # Docker 映像建置
├── docker-compose.yml       # Docker Compose 部署
└── README.md
```

---

## 快速啟動

### 方式一：Docker 部署（推薦）

> 需先安裝 [Docker Desktop](https://www.docker.com/products/docker-desktop/)

#### 1. 複製專案

```bash
git clone https://github.com/koitsuzu/gantt.git
cd gantt
```

#### 2. 設定環境變數

```bash
cp .env.example .env
```

編輯 `.env` 檔案設定您的編輯密碼：

```env
PORT=3000
EDIT_PASSWORD=您的密碼
```

#### 3. 啟動服務

```bash
docker compose up -d --build
```

#### 4. 開啟瀏覽器

前往 [http://localhost:3000](http://localhost:3000)

#### 其他 Docker 指令

```bash
# 查看日誌
docker compose logs -f

# 停止服務
docker compose down

# 停止服務並清除資料庫
docker compose down -v

# 重新建置
docker compose up -d --build
```

> 📌 資料庫使用 Docker Volume (`gantt-data`) 持久化，重啟容器不會遺失資料。  
> 若要全新空資料庫，執行 `docker compose down -v` 後重新啟動即可。

---

### 方式二：本機開發

> 需安裝 [Node.js 20+](https://nodejs.org/)

#### 1. 安裝相依套件

```bash
# 前端
cd client
npm install
cd ..

# 後端
cd server
npm install
cd ..
```

#### 2. 設定環境變數

```bash
cp .env.example .env
```

#### 3. 啟動開發伺服器

```bash
# 終端 1：啟動後端 (port 3000)
cd server
npm run dev

# 終端 2：啟動前端 (port 5173)
cd client
npm run dev
```

#### 4. 開啟瀏覽器

前往 [http://localhost:5173](http://localhost:5173)

---

## 環境變數說明

| 變數名稱 | 預設值 | 說明 |
|---------|-------|------|
| `PORT` | `3000` | 後端 API 伺服器端口 |
| `EDIT_PASSWORD` | `1234` | 切換編輯模式所需密碼 |

---

## API 端點列表

| 方法 | 路徑 | 說明 |
|-----|------|------|
| `POST` | `/api/verify-password` | 驗證編輯密碼 |
| `GET` | `/api/users` | 取得使用者列表 |
| `GET` | `/api/projects/summary` | 取得所有專案摘要 |
| `GET` | `/api/projects/all-gantt` | 取得全部專案甘特圖資料 |
| `POST` | `/api/projects` | 新增專案 |
| `PUT` | `/api/projects/:id` | 更新專案 |
| `DELETE` | `/api/projects/:id` | 刪除專案 |
| `GET` | `/api/projects/:id/logs` | 取得專案變更紀錄 |
| `GET` | `/api/projects/:id/gantt` | 取得單一專案甘特圖資料 |
| `POST` | `/api/stages` | 新增階段 |
| `PUT` | `/api/stages/:id` | 更新階段 |
| `DELETE` | `/api/stages/:id` | 刪除階段 |
| `POST` | `/api/sub-tasks` | 新增子任務 |
| `PUT` | `/api/sub-tasks/:id` | 更新子任務 |
| `DELETE` | `/api/sub-tasks/:id` | 刪除子任務 |
| `GET` | `/api/departments` | 取得部門列表 |
| `POST` | `/api/departments` | 新增部門 |
| `GET` | `/api/announcements` | 取得公告列表 |
| `POST` | `/api/announcements` | 新增公告 |
| `PUT` | `/api/announcements/:id` | 更新公告 |
| `DELETE` | `/api/announcements/:id` | 刪除公告 |
| `GET` | `/api/tasks/today` | 取得今日待辦 |
| `GET` | `/api/tasks/delayed` | 取得 DELAY 任務 |
| `POST` | `/api/projects/:id/export-excel` | 匯出專案 Excel |
| `POST` | `/api/import/project` | CSV 匯入專案 |

---

## 使用說明

### 🔓 進入編輯模式
點擊右上角「🔒 唯讀模式」旁的開關，輸入密碼即可切換至編輯模式。

### 📁 新增專案
編輯模式下，點擊「+ 專案」按鈕填寫專案資訊。

### 🖱️ 甘特圖操作
- **展開 / 收合**：點擊專案名稱前的箭頭
- **顯示層級**：使用工具列的「1 階 / 2 階 / 3 階 / 全部」按鈕
- **時間尺度**：切換「時 / 日 / 週 / 月 / 季 / 年」
- **調整區域大小**：拖拉專案卡片與甘特圖之間的分隔線

---

## License

MIT
