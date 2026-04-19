# 架构说明 | Architecture

---

## 系统架构 | System Architecture

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       OpenClaw Gateway                          │
│                                                                 │
│  用户消息/AI响应 → before_agent_start Hook 触发                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  rocky-auto-skill Core                    │  │
│  │                                                          │  │
│  │  ┌─ Phase 1: 初始化 ─────────────────────────────────┐  │  │
│  │  │  autoInstall()    创建数据目录，复制命令行工具      │  │  │
│  │  │  refreshCache()   加载 L3 技能列表和模板列表       │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  ┌─ Phase 2: 信号提取 ───────────────────────────────┐  │  │
│  │  │  extractLastError()           从最近3条消息提取错误 │  │  │
│  │  │  extractUserMessageKeywords()  从用户消息提取关键词│  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  ┌─ Phase 3: 搜索匹配 ───────────────────────────────┐  │  │
│  │  │  searchCards()     BM25 + 向量混合搜索              │  │  │
│  │  │  getAllCards()     全量卡片扫描（用于 hit 匹配）    │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  ┌─ Phase 4: 执行与记录 ─────────────────────────────┐  │  │
│  │  │  autoExecuteScript()    执行 L3 脚本（30s 超时）   │  │  │
│  │  │  autoHit()              命中计数 +1                │  │  │
│  │  │  autoskill-log          记录执行日志               │  │  │
│  │  │  未匹配 → autoskill-record  自动创建 L1 卡片      │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  ┌─ Phase 5: 上下文注入 ─────────────────────────────┐  │  │
│  │  │  prependSystemContext  注入使用提示                │  │  │
│  │  │  prependContext        注入搜索/执行结果           │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  ┌─ 后台任务 ───────────────────────────────────────┐   │  │
│  │  │  processWorkflow()      模型分析工作流（异步）     │  │  │
│  │  │  dailyDecayScan()       每日沉寂扫描（每小时检查） │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 数据流 | Data Flow

### 用户消息处理流程

```
用户发送消息
    │
    ▼
OpenClaw Gateway 触发 before_agent_start
    │
    ▼
autoInstall() — 检查数据目录（首次自动创建）
    │
    ▼
refreshCache() — 刷新 L3 技能缓存（5分钟 TTL）
    │
    ▼
extractLastError() — 从最近 3 条消息提取错误关键词
    │
    ├── 有错误 → searchCards(errorKeyword)
    │               │
    │               ├── 匹配到 L3 + rate≥90% → autoExecuteScript()
    │               │       │
    │               │       ├── 成功 → autoHit() + log("success")
    │               │       └── 失败 → log("failed")
    │               │
    │               └── 匹配到 L3 + rate<90% → 交给 AI 判断
    │
    ▼
extractUserMessageKeywords() — 提取用户消息关键词（中文≥3字符）
    │
    ├── 匹配到卡片 → autoHit(id)
    │       │
    │       ├── L1 + hit≥3 → 晋升 L2
    │       ├── L2 + hit≥5 + 脚本 → 晋升 L3
    │       └── L2 + hit≥5 + "待补充" → 自动生成脚本 + promote
    │
    ├── 无匹配 → autoskill-record — 自动创建 L1 卡片
    │
    └── 匹配到 L3 → 同上执行流程
    │
    ▼
prependContext — 注入结果到 AI 上下文
    │
    ▼
AI 生成回复（包含经验系统提示的上下文）
```

### 模型分析工作流

```
对话消息 ≥ 6 轮
    │
    ▼
analyzeWithModel(history, context)
    │
    ├── 构建提示词：
    │   - 对话历史（每条最多 300 字符）
    │   - 技能使用统计（最后使用时间、hit 次数）
    │   - 目标系统信息（macOS/Linux）
    │
    ▼
MiniMax M2.7 API 调用
    │
    ├── [WORKFLOW_GEN] → createWorkflowSkill()
    │       │
    │       ├── 生成 Bash 脚本（适配目标系统）
    │       ├── 创建 YAML 卡片（直接 L3）
    │       └── 保存到 workflows/current.json
    │
    ├── [SKILL_UPDATE] → applySkillUpdate()
    │       │
    │       └── 更新脚本文件 + 更新卡片 updated_at
    │
    ├── [SKILL_DELETE] → deleteSkill()
    │       │
    │       └── 删除卡片 YAML + 关联脚本
    │
    └── [NO_OP] → 无操作
```

### 每日沉寂扫描

```
setInterval (每小时触发)
    │
    ├── 检查上次扫描日期（每天只执行一次）
    │
    ▼
读取所有卡片使用统计
    │
    ▼
模型分析哪些技能该删除
    │
    ├── 输出 [DECAY_DELETE] 指令
    │
    ▼
执行删除（删除卡片 + 关联脚本）
```

---

## 缓存机制 | Caching

### L3 技能缓存

```javascript
cache = {
  l3Skills: [...],     // 所有 L3 技能列表
  templates: [...],    // 模板脚本列表
  ts: Date.now()       // 缓存时间戳
}
// TTL: 5 分钟
// 每次记录/晋升/删除后自动失效（cache.ts = 0）
```

### 执行结果缓存

```javascript
execCache = new Map();  // key: scriptPath, value: {result, ts}
// TTL: 60 秒
// 防止同一脚本短时间内重复执行
```

---

## 配置与路径 | Configuration

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTOSKILL_DIR` | `~/.openclaw/.auto-skill` | 数据目录 |
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | OpenClaw 状态目录 |
| `OPENCLAW_WORKSPACE` | — | OpenClaw 工作空间路径 |

### 脚本查找顺序

```
getScriptsDir() 查找顺序:
1. __dirname/scripts           — 插件自带（优先，下载即可用）
2. $OPENCLAW_WORKSPACE/skills/ — 工作空间
3. $OPENCLAW_STATE_DIR/skills/ — 状态目录
```

### 自动安装脚本复制顺序

```
autoInstall() 复制顺序（仅 skills 目录为空时）:
1. __dirname/scripts           — 插件自带
2. $OPENCLAW_STATE_DIR/shared-skills/ — 共享技能
3. $OPENCLAW_STATE_DIR/skills/ — 状态目录
```

---

## 经验卡片 YAML 结构 | Card YAML Structure

```yaml
# 基础信息
id: "001"                     # 唯一 ID（3位数字）
title: "Nginx 端口占用"       # 标题
tool: nginx                   # 关联工具
tags: [nginx, network, port]  # 分类标签
category: network             # 大类: config/deploy/network/service

# 技能等级
level: L3                     # L1 | L2 | L3
hit_count: 12                 # 命中次数（自动累计）
source: auto                  # auto | manual | workflow_ai

# 时间
created_at: "2026-04-10"
last_hit_at: "2026-04-19"     # 最后命中日期
updated_at: "2026-04-19"
status: active                # active | review | expired

# 内容
problem: |                    # 问题描述
  Nginx 启动失败，端口被占用
root_cause: |                 # 根因分析
  之前进程未正常退出
solution: |                   # 解决方案
  使用 lsof 查找占用进程并终止
commands: |                   # 相关命令
  lsof -i:80
  kill -9 <PID>

# L3 脚本关联
skill_script: "001-nginx-port.sh"  # 脚本文件名

# 执行统计（由 autoskill-log 自动维护）
exec_count: 5                      # 总执行次数
exec_success: 5                    # 成功次数

# 可选: 向量嵌入（由 autoskill-embed 生成）
embedding: [0.123, -0.456, ...]
```

---

## 技术依赖 | Technical Dependencies

### Node.js（内置模块，无需安装）

- `child_process` — 执行 Bash 命令
- `fs` — 文件读写
- `path` — 路径处理
- `os` — 系统信息

### Python（标准库，无需安装）

- `json`, `os`, `re`, `sys`, `math` — 基础模块
- `urllib.request` — HTTP 请求（用于 Embedding）
- `collections.Counter` — BM25 分词统计
- `pathlib.Path` — 路径处理

### 外部服务（可选）

| 服务 | 用途 | 默认地址 |
|------|------|----------|
| LM Studio | 向量搜索 + Embedding | localhost:1234 |
| MiniMax API | 模型分析工作流 + 衰减判断 | api.minimaxi.com |

---

## 下一步 | Next Steps

- [更新日志](./Changelog.md) — 完整版本历史
- [常见问题](./FAQ.md) — 故障排查
