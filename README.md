# kbserve

知识库 + 客服系统，基于 selfforge 核心检索引擎构建。

## 仓库容器

通过 `D:\opencode\kbserve\` 收纳三个独立 GitHub 仓库（各自的 `.git` 与 remote 保留）：

```
kbserve/
├── kbserve/           主项目（remote: Cuering/kbserve）
├── kbserve-plugins/   插件仓库，Marketplace 索引来源（remote: Cuering/kbserve-plugins）
└── kbserve-sandbox/   沙箱副本，独立实例（remote: Cuering/kbserve-sandbox）
```

| 实例 | 端口 | 数据目录 | 用途 |
|------|------|----------|------|
| 主服务 | `3090` | `~/.kbserve`（`EVOLVE_HOME`） | 正式知识库客服 |
| 沙箱 | `3099` | `~/.kbserve` | 实验/隔离副本 |

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

## 部署

### 快速启动（开发/测试）

```bash
# 安装 bun（如未安装）
curl -fsSL https://bun.sh/install | bash

# 启动服务
bun serve.ts
# → http://127.0.0.1:3090
```

端口可通过 `KBSERVE_PORT` 环境变量修改：

```bash
KBSERVE_PORT=3091 bun serve.ts
```

### Docker 部署

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

数据持久化在 `./data/` 目录，映射到容器内的 `/data`。

### 生产部署（nginx + systemd）

推荐用于生产环境。脚本和配置在 `docs/deployment/` 目录下。

#### 一键安装（GitHub）

从 GitHub 一键安装全部功能（主服务 + 插件 + 沙箱）：

**Windows（PowerShell）：**

```powershell
# 下载并运行一键脚本
Invoke-RestMethod https://raw.githubusercontent.com/Cuering/kbserve/main/docs/deployment/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本自动完成：检查/安装 bun → 克隆三个仓库（主服务 + 插件 + 沙箱）→ 安装依赖 → 预装插件（telegram-bot / web-search / rate-limiter）→ 写 `.env` → 注册登录自启任务（主 `kbserve-main-3090`、沙箱 `kbserve-sandbox-3099`）→ 打开 dashboard。

**Linux：**

```bash
# install.sh 已内置 Cuering/kbserve 仓库地址，直接运行
bash docs/deployment/install.sh
```

脚本自动完成：创建用户 → 安装 bun → 克隆主项目与插件仓库 → 安装依赖 → 预装插件 → 配置 systemd 服务 → 配置 nginx。

端口分层：

| 实例 | 端口 | 数据目录 | 说明 |
|------|------|----------|------|
| 主服务 | `3090` | `~/.kbserve` | 正式知识库客服 |
| 沙箱 | `3099` | `~/.kbserve` | 隔离实验副本 |

插件机制：插件仓库（`Cuering/kbserve-plugins`）是 Marketplace 索引来源，也可通过 dashboard 的 Plugins / Marketplace 标签页自装；本地不要求放置插件副本。

#### 手动安装

```bash
# 1. 创建用户
sudo useradd --system --no-create-home --shell /usr/sbin/nologin kbserve

# 2. 创建目录
sudo mkdir -p /opt/kbserve
sudo mkdir -p /var/lib/kbserve
sudo chown kbserve:kbserve /opt/kbserve /var/lib/kbserve

# 3. 拷贝项目
sudo cp -r . /opt/kbserve/
cd /opt/kbserve
sudo -u kbserve bun install --production

# 4. 创建环境文件
sudo tee /opt/kbserve/.env > /dev/null <<EOF
KBSERVE_PORT=3090
EVOLVE_HOME=/var/lib/kbserve
NODE_ENV=production
EOF
sudo chmod 600 /opt/kbserve/.env

# 5. 安装 systemd 服务
sudo cp docs/deployment/kbserve.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kbserve

# 6. 配置 nginx
sudo cp docs/deployment/nginx.conf /etc/nginx/sites-available/kbserve
sudo ln -s /etc/nginx/sites-available/kbserve /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

#### 管理服务

```bash
# 查看状态
sudo systemctl status kbserve

# 查看日志
sudo journalctl -u kbserve -f

# 重启
sudo systemctl restart kbserve

# 停止
sudo systemctl stop kbserve
```

### HTTPS 配置

详见 `docs/deployment/ssl-setup.md`，提供两种方式：

- **Option A: Let's Encrypt / Certbot** — 自动获取可信证书，推荐对外服务
- **Option B: 自签名证书** — 内网使用，无需域名

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KBSERVE_PORT` | `3090` | 服务监听端口 |
| `EVOLVE_HOME` | `~/.kbserve` | 数据存储目录（SQLite 数据库） |
| `NODE_ENV` | *(none)* | 设为 `production` 开启生产模式 |
| `TZ` | *(none)* | 时区，如 `Asia/Shanghai` |

### 数据备份

```bash
# 备份整个数据目录
tar -czf kbserve-backup-$(date +%Y%m%d).tar.gz -C ~/.kbserve .

# 恢复
tar -xzf kbserve-backup-20250101.tar.gz -C ~/.kbserve/
```

生产环境建议：

- 将 `EVOLVE_HOME` 指向独立数据目录（如 `/var/lib/kbserve`）便于备份
- 配置定时备份（crontab）：`0 3 * * * tar -czf /backups/kbserve-\$(date +\%Y\%m\%d).tar.gz -C /var/lib/kbserve .`
- 结合文件系统快照（LVM / ZFS / btrfs）实现增量备份