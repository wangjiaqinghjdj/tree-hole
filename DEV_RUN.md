# Vue + Node 开发启动

## 1. 安装依赖

```bash
npm install
```

## 2. 启动（不需要 Tomcat）

```bash
npm run dev
```

启动后：
- 前端（Vue）：`http://localhost:5173`
- 后端（Express API）：`http://localhost:3000`

## 3. 数据库

默认读取：
- `DB_HOST=localhost`
- `DB_PORT=3306`
- `DB_USER=root`
- `DB_PASSWORD=123456`
- `DB_NAME=student_db`

可复制 `.env.example` 为 `.env` 后修改。
