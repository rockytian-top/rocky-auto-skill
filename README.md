# rocky-auto-skill

> OpenClaw 模型驱动的经验闭环插件 | Model-Driven Experience Closed-Loop Plugin for OpenClaw

[![Version](https://img.shields.io/badge/version-3.0-blue)](./openclaw.plugin.json)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-orange)](https://github.com/openclaw/openclaw)

---

## 📖 概述 | Overview

**rocky-auto-skill** 是一个 [OpenClaw](https://github.com/openclaw/openclaw) 网关插件，让 AI 助手自动积累运维经验、自动执行修复脚本、自动学习优化——形成完整的**经验闭环**。

**rocky-auto-skill** is an [OpenClaw](https://github.com/openclaw/openclaw) gateway plugin that enables your AI assistant to automatically accumulate operations experience, auto-execute repair scripts, and self-optimize — forming a complete **experience closed-loop**.

### v3.0 核心变化 | v3.0 Key Changes

- ❌ 移除 L1/L2/L3 级别机制
- ❌ 移除 hit_count 晋升规则
- ✅ 模型自主决策（而非固定规则）
- ✅ 上下文感知的技能改进

---

## 🎯 核心理念 | Core Philosophy

```
遇问题 → 自动搜索经验 → 模型判断 → 自动执行脚本 → 自动记录改进 → 模型持续优化
  ↑                                                                                  |
  └──────────────────── 经验闭环 Complete Closed Loop ──────────────────────────────┘
```

---

## ✨ 核心功能 | Core Features

### 1. 🔍 自动搜索经验 | Auto Search Experience

**触发时机**：`before_agent_start` Hook，每次对话自动触发

| 功能 | 说明 |
|------|------|
| 错误检测 | 自动从AI响应提取错误（error:、failed、ENOENT等） |
| 用户消息触发 | 检测用户问题关键词 |
| 混合搜索 | BM25 + 向量语义相似度 |

**验证方法 | Verification:**
```bash
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "关键词"
```

---

### 2. 🤖 模型驱动决策 | Model-Driven Decision

| 场景 | 模型决策 |
|------|----------|
| 匹配到技能 | 是否自动执行？ |
| 未匹配技能 | 是否创建新技能？ |
| 用户有反馈 | 是否改进技能？ |
| 技能长期不用 | 是否删除？ |

模型根据上下文自主判断，不再依赖固定规则。

---

### 3. 🔄 版本备份与回滚 | Version Backup & Rollback

**备份触发**：脚本修改前自动备份

**版本数量**：最多保留2个版本（.v1, .v2）

**回滚触发**（自然语言）：
- "回到上一个版本"
- "撤销" / "回滚" / "恢复上一版"

**验证方法 | Verification:**
```bash
# 查看备份文件
ls -la ~/.openclaw/.auto-skill/skills/*/*.sh.v*

# 回滚日志
cat ~/.openclaw/.auto-skill/logs/improvements.jsonl
```

---

### 4. 📝 上下文感知改进 | Context-Aware Improvement

模型理解用户反馈的**真实意图**，而不只是匹配关键词。

| 用户说 | 模型理解 |
|--------|----------|
| "不对" | 需要回滚或修改 |
| "还要看XX" | 增强脚本 |
| "太慢了" | 优化性能 |

---

### 5. 📊 每日沉寂扫描 | Daily Decay Scan

自动清理长期不用的技能：
- 30天未用 → 标记为沉寂
- 90天未用 → 考虑删除

---

## 📊 功能对比图 | Feature Comparison

### vs Hermes Agent

| 功能 | Hermes Agent | rocky-auto-skill |
|------|-------------|------------------|
| **技能存储** | SKILL.md | .sh 脚本 + YAML |
| **技能管理** | skill_manage 工具 | 直接写文件 |
| **版本控制** | ❌ | ✅ 最多2个版本 |
| **用户可控回滚** | ❌ | ✅ 自然语言触发 |
| **改进日志** | ❌ | ✅ jsonl记录 |
| **模型决策** | ✅ 自主决定 | ✅ 自主决定 |
| **上下文理解** | ✅ | ✅ |
| **衰减机制** | ❌ | ✅ |

---

## 🏗️ 架构 | Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              rocky-auto-skill Plugin                 │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │            before_agent_start Hook              │  │  │
│  │  │  1. 错误/用户消息检测                           │  │  │
│  │  │  2. 经验搜索 (BM25 + 向量)                     │  │  │
│  │  │  3. 匹配技能 → 模型判断是否执行               │  │  │
│  │  │  4. 脚本执行 (autoExecuteScript)               │  │  │
│  │  │  5. 结果注入 (prependContext)                 │  │  │
│  │  │  6. 模型驱动的工作流分析                       │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Directory                           │
│  ~/.openclaw/.auto-skill/                                  │
│  ├── cards/           # 经验卡片 (YAML)                    │
│  ├── skills/          # 技能脚本 (.sh)                     │
│  ├── scripts/         # 工具脚本                           │
│  │   ├── autoskill-search.py                              │
│  │   ├── autoskill-record.sh                              │
│  │   ├── autoskill-list.sh                                │
│  │   ├── autoskill-hit.sh                                 │
│  │   └── autoskill-enhance.py                             │
│  └── logs/            # 改进日志                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 数据结构 | Data Structure

### 经验卡片 (cards/)

```yaml
# rocky-auto-skill 经验卡片
id: 013
title: "我的服务器内存怎么看"
tool: bash
tags: [服务器,监控]
category: 运维

hit_count: 6
source: auto

created_at: 2026-04-01
last_hit_at: 2026-04-19
updated_at: 2026-04-19
status: active

problem: |
  如何查看服务器内存使用情况

solution: |
  使用 free 或 ps 命令查看内存

skill_script: "013-memory.sh"
```

### 技能脚本 (skills/)

```bash
#!/bin/bash
# 查看服务器内存
set -euo pipefail
echo "=== 内存使用情况 ==="
free -h
```

---

## 🚀 安装 | Installation

### 自动安装 | Auto Install

配置 `openclaw.plugin.json`：

```json
{
  "plugins": {
    "entries": {
      "rocky-auto-skill": {
        "url": "github:rockytian-top/rocky-auto-skill"
      }
    }
  }
}
```

### 手动安装 | Manual Install

```bash
# 1. 克隆仓库
git clone https://github.com/rockytian-top/rocky-auto-skill.git
cd rocky-auto-skill

# 2. 复制到插件目录
cp -r . ~/.openclaw/extensions/rocky-auto-skill/

# 3. 重启网关
openclaw gateway restart
```

---

## 📖 使用方法 | Usage

### 自动触发（无需手动）

| 操作 | 说明 |
|------|------|
| 遇到问题 | 自动搜索经验库 |
| 匹配到技能 | 模型判断是否执行 |
| 执行后有反馈 | 模型判断是否改进 |

### 手动命令 | Manual Commands

```bash
# 搜索经验
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "关键词"

# 记录经验
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-record.sh \
  --title "标题" --tool "工具" --problem "问题" --solution "方案"

# 查看列表
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list.sh

# 标记有用
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-hit.sh 013

# 回滚（自然语言）
"回到上一个版本"
```

### 自然语言交互

| 你说 | 插件自动 |
|------|----------|
| "帮我记录一个经验：..." | 创建经验卡片 |
| "查看经验统计" | 显示统计面板 |
| "列出所有经验" | 列出所有卡片 |
| "回到上一个版本" | 回滚脚本 |
| "这个有用" / "hit" | 标记经验有用 |

---

## 🔧 配置 | Configuration

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | 数据目录根路径 |

### 数据目录

| 路径 | 说明 |
|------|------|
| `~/.openclaw/.auto-skill/cards/` | 经验卡片 |
| `~/.openclaw/.auto-skill/skills/` | 技能脚本 |
| `~/.openclaw/.auto-skill/scripts/` | 工具脚本 |
| `~/.openclaw/.auto-skill/logs/` | 改进日志 |

---

## ❓ 常见问题 | FAQ

### Q: 插件不生效怎么办？

1. 检查插件是否加载：`grep rocky-auto-skill ~/.openclaw/logs/gateway.log`
2. 检查数据目录：`ls ~/.openclaw/.auto-skill/cards/`
3. 重启网关：`openclaw gateway restart`

### Q: 如何查看技能脚本？

```bash
ls ~/.openclaw/.auto-skill/skills/
```

### Q: 如何手动触发技能？

在对话中包含关键词，或直接调用脚本：
```bash
bash ~/.openclaw/.auto-skill/skills/013-memory.sh
```

### Q: 回滚失败怎么办？

1. 检查备份文件是否存在：`ls ~/.openclaw/.auto-skill/skills/*/*.sh.v*`
2. 检查日志：`cat ~/.openclaw/.auto-skill/logs/improvements.jsonl`

---

## 📄 许可证 | License

MIT License

---

## 🔗 相关链接 | Links

- [GitHub](https://github.com/rockytian-top/rocky-auto-skill)
- [Gitee](https://gitee.com/rocky_tian/rocky-auto-skill)
- [OpenClaw](https://github.com/openclaw/openclaw)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)

---

_Version: 3.0 | Updated: 2026-04-19_
