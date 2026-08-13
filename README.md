# kbserve

知识库 + 客服系统，基于 selfforge 核心检索引擎构建。

## 架构

```
kbserve/
├── serve.ts              主服务器入口（端口 3090）
├── lib/
│   ├── db.ts             SQLite 数据库（复用 selfforge）
│   ├── bench.ts          记忆存储/检索（复用 selfforge）
│   ├── retrieve.ts       增强检索（复用 selfforge）
│   ├── ingest.ts         实体抽取（复用 selfforge）
│   ├── user.ts           用户画像
│   ├── knowledge.ts      知识库文档 CRUD + 版本管理
│   ├── qa.ts             LLM 问答（复用 opencode auth）
│   ├── conversation.ts   会话管理
│   ├── feedback.ts       用户反馈收集
│   ├── report.ts         用户分析报告
│   ├── admin.ts          管理员操作聚合
│   └── dashboard-log.ts  调用日志
├── dashboard/
│   └── index.html        单页 Web UI（客服对话 + 管理后台）
└── package.json
```

## 快速启动

```bash
bun serve.ts
# → http://127.0.0.1:3090
```

## 功能

| 功能 | 说明 |
|------|------|
| 客服对话 | 用户提问 → 检索知识库 → LLM 整合回答 |
| 用户反馈 | 对回答满意/不满意，管理员后台查看 |
| 知识库管理 | 文档 CRUD、版本历史、标签 |
| QA 审核 | 问答对入库审批 |
| 用户画像 | 对话中收集偏好信息 |
| 分析报告 | 用户维度/汇总报告 |
| 中英文 | 客服对话 + 管理后台双语 |

## API 接口

```
POST /qa          问答
POST /qa/feedback 反馈
POST /conv/start  开始会话
GET  /kb/search   知识库检索
GET  /admin/*     管理后台 API
```

## 数据存储

- `~/.kbserve/kbserve.db` — 全部数据（知识库、会话、反馈、用户画像）
- 复用 opencode 的 `auth.json` 获取 LLM 提供商配置