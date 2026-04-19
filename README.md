# rocky-auto-skill

> 自动运维经验闭环系统 | Automated Operations Experience Closed-Loop System

---

## 📖 概述 | Overview

**rocky-auto-skill** 是一个运行在 [OpenClaw](https://github.com/rockytian-top/openclaw) 上的插件，核心理念是"让 AI 助手从被动回答者变为主动执行者"。

- 遇问题时 → 自动搜索经验库 + 匹配 L3 技能脚本
- 问题解决后 → 自动提示记录经验
- 高频经验 → 自动晋升为可执行技能（L1 → L2 → L3）

**rocky-auto-skill** is an OpenClaw plugin that transforms your AI assistant from a passive responder into a proactive executor.

- On problem detection → Auto-search experience base + match L3 skill scripts
- After resolution → Auto-prompt to record experience
- Frequent experiences → Auto-promoted to executable skills (L1 → L2 → L3)

---

## ⚖️ 功能对比 | Feature Comparison

### OpenClaw 无插件 vs 安装插件 vs Hermes Agent

| 功能 Feature | OpenClaw (无插件) | + rocky-auto-skill | Hermes Agent |
|-------------|:-----------------:|:------------------:|:------------:|
| **问题搜索** | ❌ 手动搜索 | ✅ 自动搜索 | ✅ 手动搜索 |
| **经验记录** | ❌ 无提示 | ✅ 自动提示 | ❌ 无提示 |
| **脚本执行** | ❌ 手动执行 | ✅ 自动执行 (L3) | ❌ 手动执行 |
| **自动晋升** | ❌ 无 | ✅ L1 → L2 → L3 | ❌ 无 |
| **成功率追踪** | ❌ 无 | ✅ 自动追踪 | ❌ 无 |
| **hit 计数** | ❌ 无 | ✅ 自动计数 | ❌ 无 |
| **模板生成** | ❌ 无 | ✅ 自动生成 | ❌ 无 |
| **上下文注入** | ❌ 无 | ✅ 自动注入 | ❌ 无 |
| **错误检测** | ❌ 无 | ✅ 自动检测 | ❌ 无 |
| **缓存机制** | ❌ 无 | ✅ 5 分钟缓存 | ❌ 无 |

---

### 核心差异说明 | Core Difference

#### OpenClaw 无插件（基础状态）

```
用户: "端口占用"
AI: (需要人工描述解决方案)
用户: "如何解决端口占用？"
AI: "使用 lsof -i:端口 查找进程，然后用 kill -9 PID 终止"
```

#### + rocky-auto-skill（增强状态）

```
用户: "端口占用"
AI: → 自动匹配 L3 技能 "端口占用"
     → 自动执行 015.sh
     → 注入结果到上下文
     → 返回: "端口 80 已释放"
```

#### Hermes Agent

```
用户: "端口占用"
AI: (基于训练知识回答，但不执行脚本)
"端口占用通常是由于未关闭的进程导致..."
```

---

## ✨ 功能特性 | Features

### 1. 自动搜索 | Auto Search

> 遇问题时自动搜索经验库，支持 BM25 + 向量混合搜索

```
触发条件：检测到错误信息 或 用户消息 ≥3 字符（中文）
```

### 2. 自动执行 | Auto Execute

> L3 技能成功率 ≥90% 时自动执行，无需人工干预

```javascript
if (stats.exec_count === 0 || stats.rate >= 90) {
  autoExecuteScript(scriptPath, cardId, title);
}
```

### 3. 自动记录 | Auto Record

> 问题解决后自动提示记录经验到知识库

```
💡 提示：这个问题解决了吗？记入经验库方便下次复用：
bash autoskill-record --title "标题" --tool "工具" --problem "问题" --solution "方案"
```

### 4. 自动晋升 | Auto Promotion

> 高频使用的经验自动从 L1 晋升到 L2 再到 L3

| 等级 | 晋升条件 | 执行方式 |
|------|----------|----------|
| **L1** | 初始 | 仅搜索结果 |
| **L2** | L1 + 脚本模板 + ≥60% 成功率 | 人工确认后执行 |
| **L3** | L2 + ≥90% 成功率 | **自动执行** |

### 5. 三级渐进机制 | Three-Level Progressive

```
L1 (基础) → 人工判断搜索结果
    ↓ 命中 ≥3 次 + 创建脚本
L2 (进阶) → 人工确认后执行
    ↓ 成功率 ≥90%
L3 (专家) → 自动执行
```

---

## 🏗️ 系统架构 | Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      用户交互层                              │
│                  User Interaction Layer                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    插件核心 (Hook)                           │
│                  Plugin Core (Hook)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            before_agent_start                         │   │
│  │  1. extractLastError()   - 提取错误信息            │   │
│  │  2. extractUserMessage() - 提取用户消息            │   │
│  │  3. refreshCache()       - 刷新技能缓存            │   │
│  │  4. searchCards()       - 搜索经验卡片            │   │
│  │  5. matchL3Skills()     - 匹配 L3 技能            │   │
│  │  6. autoExecuteScript() - 自动执行脚本            │   │
│  │  7. injectContext()     - 注入结果到上下文         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      数据存储层                              │
│                   Data Storage Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │    cards/   │  │   skills/    │  │    logs/    │     │
│  │   经验卡片    │  │   脚本文件    │  │   执行日志    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 目录结构 | Directory Structure

```
rocky-auto-skill/                      # 插件目录
├── index.js                  # 主插件代码 | Main plugin code
├── openclaw.plugin.json      # 插件配置 | Plugin configuration
├── autoskill-search          # Shell 包装器 | Shell wrapper
├── autoskill-search.py       # 混合搜索引擎 | Hybrid search engine
├── README.md                 # 本文档 | This file
└── docs/                    # Wiki 文档 | Wiki documentation

~/.openclaw/.auto-skill/      # 数据目录 | Data directory
├── cards/                    # 经验卡片 | Experience cards (YAML)
│   ├── 001.yaml
│   ├── 002.yaml
│   └── ...
├── skills/                  # 脚本文件 | Script files
│   ├── 001.sh
│   ├── 002.sh
│   └── ...
└── logs/                    # 执行日志 | Execution logs
    └── auto-skill.log
```

---

## 🔧 安装 | Installation

### 方式一：自动安装（推荐）| Auto-install (Recommended)

插件首次加载时自动检测并创建所需目录和文件。只需重启网关即可：

```bash
# 重启网关，插件自动安装
openclaw gateway restart
```

### 方式二：手动安装 | Manual Install

```bash
# 克隆仓库
git clone https://github.com/rockytian-top/rocky-auto-skill.git
# 或从 Gitee 克隆（国内推荐）
git clone https://gitee.com/rocky_tian/rocky-auto-skill.git

# 复制到 extensions 目录
cp -r rocky-auto-skill ~/.openclaw/extensions/

# 重启网关
openclaw gateway restart
```

---

## 📋 经验卡片格式 | Experience Card Format

```yaml
# ~/.openclaw/.auto-skill/cards/015.yaml
id: 015
title: 端口占用
level: L3
problem: 端口被占用无法启动服务
solution: 使用 lsof 和 kill 命令释放端口
tool: lsof, kill
skill_script: 015.sh
created_at: 2026-04-18
updated_at: 2026-04-19
stats:
  exec_count: 5
  exec_success: 5
  exec_fail: 0
  hit_count: 12
  rate: 100
  last_used: 2026-04-19
```

---

## 🎯 使用方法 | Usage

### 自动触发场景 | Auto Trigger Scenarios

**场景 1：用户报告问题**

```
用户: "端口占用"
系统: → 检测关键词 "端口占用"
     → 匹配 L3 技能 "端口占用"
     → 检查成功率 ≥90%
     → 自动执行 015.sh
     → 注入结果: "端口 80 已释放"
AI: "端口 80 已释放，当前空闲"
```

**场景 2：AI 遇到错误**

```
AI: [error] port 80 already in use
系统: → 提取错误 "port 80 already in use"
     → 搜索匹配的经验
     → 自动执行解决方案
AI: "端口占用已解决：进程 PID 1234 已终止"
```

### 手动命令 | Manual Commands

```bash
# 搜索经验
python3 ~/.openclaw/extensions/rocky-auto-skill/autoskill-search "端口占用"

# 记录经验
bash ~/.openclaw/extensions/rocky-auto-skill/autoskill-record \
  --title "Nginx端口占用处理" \
  --tool "lsof, kill" \
  --problem "端口被占用无法启动" \
  --solution "lsof -i:80 找到PID，kill -9 终止"

# 晋升经验
bash ~/.openclaw/extensions/rocky-auto-skill/autoskill-promote 015

# 查看统计
bash ~/.openclaw/extensions/rocky-auto-skill/autoskill-stats 015
```

---

## 📊 技能等级 | Skill Levels

| 等级 | 触发条件 | 执行方式 | 提示信息 |
|------|----------|----------|----------|
| **L1** | 搜索命中 | 无 | "找到 N 个相关经验" |
| **L2** | 命中 ≥3 次 + 脚本 + ≥60% 成功率 | 需人工确认 | "建议执行脚本..." |
| **L3** | 成功率 ≥90% | **自动执行** | "已自动执行..." |

---

## 🔐 安全机制 | Security

| 机制 | 说明 |
|------|------|
| **超时保护** | 脚本执行超时 30 秒自动终止 |
| **缓存去重** | 60 秒内同一脚本不重复执行 |
| **路径限制** | 只执行 `.auto-skill/skills/` 目录 |
| **成功率门槛** | 低于 90% 不自动执行 |

---

## 🐛 故障排查 | Troubleshooting

### 插件未加载

```bash
# 检查插件状态
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log

# 确认目录结构
ls -la ~/.openclaw/extensions/rocky-auto-skill/
```

### 自动执行未触发

1. 确认消息 ≥3 字符（中文）
2. 确认 L3 技能存在：`ls ~/.openclaw/.auto-skill/cards/`
3. 确认脚本文件存在：`ls ~/.openclaw/.auto-skill/skills/`
4. 检查成功率 ≥90%

### 查看执行日志

```bash
tail -f ~/.openclaw/logs/gateway.log | grep "rocky-auto-skill"
```

---

## 📝 与 Hermes Agent 对比 | vs Hermes Agent

| 维度 | rocky-auto-skill | Hermes Agent |
|------|-----------------|---------------|
| **架构** | OpenClaw Plugin | 独立 Agent |
| **执行方式** | 自动执行脚本 | 知识回答 |
| **学习方式** | 自动晋升 | 训练知识 |
| **数据存储** | 本地 YAML | 云端训练 |
| **定制难度** | 低（脚本即技能） | 高（需重新训练）|
| **响应速度** | 即时 | 依赖 LLM |

**核心差异**：rocky-auto-skill 是"执行者"，Hermes Agent 是"回答者"

---

## 📄 License

MIT License

---

## 🤝 贡献 | Contributing

Issues and Pull Requests are welcome!

---

## 🔗 相关链接 | Links

- [GitHub](https://github.com/rockytian-top/rocky-auto-skill)
- [Gitee](https://gitee.com/rocky_tian/rocky-auto-skill)
- [Wiki 文档](./docs/Home.md)

---

_版本 Version: 2.9.1_  
_更新 Update: 2026-04-19_
