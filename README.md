# rocky-auto-skill

> OpenClaw 全自动运维经验闭环插件 | Fully Automated Operations Experience Plugin for OpenClaw

[![Version](https://img.shields.io/badge/version-2.10.1-blue)](./openclaw.plugin.json)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-orange)](https://github.com/openclaw/openclaw)

---

## 📖 概述 | Overview

**rocky-auto-skill** 是一个 [OpenClaw](https://github.com/openclaw/openclaw) 网关插件，让 AI 助手自动积累运维经验、自动执行修复脚本、自动学习优化——形成完整的**经验闭环**。

**rocky-auto-skill** is an [OpenClaw](https://github.com/openclaw/openclaw) gateway plugin that enables your AI assistant to automatically accumulate operations experience, auto-execute repair scripts, and self-optimize — forming a complete **experience closed-loop**.

---

## 🎯 核心理念 | Core Philosophy

```
遇问题 → 自动搜索经验 → 自动匹配技能 → 自动执行脚本 → 自动记录结果 → 自动晋升优化
  ↑                                                                          |
  └──────────────────── 经验闭环 Complete Closed Loop ──────────────────────┘
```

---

## ✨ 核心功能 | Core Features

### 1. 🔍 自动搜索经验 | Auto Search Experience

**触发时机**：`before_agent_start` Hook，每次对话自动触发

| 功能 | 说明 |
|------|------|
| 错误检测 | 自动从AI响应提取错误（error:、failed、ENOENT等） |
| 关键词搜索 | 用户消息中文≥3字符关键词 |
| 混合搜索 | BM25 + 向量语义相似度 |

**验证方法 | Verification:**
```bash
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "关键词"
```

---

### 2. 🤖 自动执行 L3 脚本 | Auto Execute L3 Scripts

| 等级 | 说明 | 触发条件 |
|------|------|----------|
| L1 | 关键词匹配，模型执行 | 命中关键词 |
| L2 | 自动执行一次，评估质量 | 首次执行 |
| L3 | 成功率≥90%，自动执行 | exec_count>0 且 rate≥90% |

**验证方法 | Verification:**
- 查看日志：`grep "L3 match check" ~/.openclaw/logs/gateway.log`

---

### 3. 📈 自动晋升机制 | Auto Promotion

| 晋升 | 条件 |
|------|------|
| L1 → L2 | 执行1次且成功 |
| L2 → L3 | 执行≥3次，成功率≥90% |

**降级规则 | Demotion:**
- L3 → L2：连续失败2次
- L2 → L1：30天无执行
- L3 → 删除：180天无执行

---

### 4. 🔄 版本备份与回滚 | Version Backup & Rollback

**备份触发**：脚本修改前自动备份

**版本数量**：最多保留2个版本（.v1, .v2）

**回滚触发**（自然语言）：
- "回到上一个版本"
- "撤销" / "回滚" / "恢复上一版"

**备份文件结构**：
```
skills/
└── 013/
    ├── script.sh              # 当前版本
    ├── script.sh.v1          # 上一个版本
    ├── script.sh.v2          # 上上版本
    └── script.sh.versions.json
```

**验证方法 | Verification:**
```bash
# 查看备份文件
ls -la ~/.openclaw/.auto-skill/skills/013*.sh.v*

# 回滚日志
cat ~/.openclaw/.auto-skill/logs/improvements.jsonl
```

---

### 5. 📝 改进日志 | Improvement Log

**记录位置**：`logs/improvements.jsonl`

**记录内容**：
```json
{"cardId":"013","action":"rollback","timestamp":"...","toVersion":1}
{"cardId":"013","action":"context_enhancement","timestamp":"...","enhancement":"..."}
```

---

### 6. 🔧 自我改进 | Self-Improvement

**提示词引导**：
```
🔧 技能改进：执行脚本后如果结果不完整、有错误、或者发现更好的方法，
   立即用 python3 .../autoskill-enhance 改进脚本。
   不要等到用户说"不对"才改。
```

**增强触发**：上下文感知，自动检测用户是否想增强技能

---

## 📊 功能对比图 | Feature Comparison

### 有插件 vs 无插件

| 功能 | 无插件 | 有插件 |
|------|--------|--------|
| 每次重新搜索解决方案 | ✅ | ❌ |
| 经验自动积累 | ❌ | ✅ |
| L3脚本自动执行 | ❌ | ✅ |
| 版本备份回滚 | ❌ | ✅ |
| 改进日志 | ❌ | ✅ |
| 自动晋升机制 | ❌ | ✅ |
| 衰减自动清理 | ❌ | ✅ |

### rocky-auto-skill vs Hermes Agent

| 功能 | Hermes Agent | rocky-auto-skill |
|------|-------------|------------------|
| **提示词引导** | ✅ SKILLS_GUIDANCE | ✅ 技能改进提示词 |
| **自我改进意识** | ✅ 模型自主决定 | ✅ 模型自主决定 |
| **备份方式** | 内存1份临时 | 文件持久化2份 |
| **回滚触发** | 仅安全扫描失败 | 用户主动 + 安全失败 |
| **版本控制** | ❌ | ✅ 最多2个版本 |
| **改进日志** | ❌ | ✅ jsonl记录 |
| **技能等级** | ❌ | ✅ L1/L2/L3 |
| **自动晋升** | ❌ | ✅ L1→L2→L3 |
| **衰减机制** | ❌ | ✅ 90天→删除 |
| **安全扫描** | ✅ 928行代码 | ❌ 自主开发无需 |
| **原子写入** | ✅ tempfile+replace | ✅ writeFileSync |
| **执行方式** | 手动skill_manage | 自动+L3自动执行 |

---

## 🏗️ 架构 | Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              rocky-auto-skill Plugin                 │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │            before_agent_start Hook              │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │ 1. 错误检测 (extractLastError)           │  │  │  │
│  │  │  │ 2. 经验搜索 (autoskill-search)           │  │  │  │
│  │  │  │ 3. L3匹配 (BM25 + 向量)                  │  │  │  │
│  │  │  │ 4. 脚本执行 (autoExecuteScript)           │  │  │  │
│  │  │  │ 5. 结果注入 (prependContext)             │  │  │  │
│  │  │  │ 6. 自我改进检测 (detectContextModify)     │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Directory                            │
│  ~/.openclaw/.auto-skill/                                   │
│  ├── cards/           # 经验卡片 (YAML)                     │
│  ├── skills/          # L3脚本 (.sh)                        │
│  ├── scripts/         # 工具脚本                            │
│  │   ├── autoskill-search.py                               │
│  │   ├── autoskill-record.sh                               │
│  │   ├── autoskill-list.sh                                 │
│  │   ├── autoskill-hit.sh                                  │
│  │   ├── autoskill-enhance.py                              │
│  │   └── autoskill-promo.py                                │
│  └── logs/            # 改进日志                            │
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

level: L3
hit_count: 6
exec_count: 5
success_count: 5
success_rate: 100
source: auto

created_at: 2026-04-01
last_hit_at: 2026-04-19
last_exec_at: 2026-04-19
updated_at: 2026-04-19
status: active

problem: |
  如何查看服务器内存使用情况

root_cause: |
  需要使用系统命令查看

solution: |
  使用 free 或 ps 命令查看内存
```

### L3脚本 (skills/)

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

插件支持自动从 GitHub 安装。配置 `openclaw.plugin.json`：

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
| 触发L3技能 | 自动执行脚本 |
| 执行失败 | 自动记录结果 |
| 成功率达标 | 自动晋升L3 |

### 手动命令 | Manual Commands

```bash
# 搜索经验
python3 ~/.openclaw/.auto-skill/scripts/autoskill-search.py "关键词"

# 记录经验
bash ~/.openclaw/.auto-skill/scripts/autoskill-record.sh \
  --title "标题" --tool "工具" --problem "问题" --solution "方案"

# 查看列表
bash ~/.openclaw/.auto-skill/scripts/autoskill-list.sh

# 标记有用
bash ~/.openclaw/.auto-skill/scripts/autoskill-hit.sh 013

# 回滚（自然语言）
"回到上一个版本"
```

---

## 🔧 配置 | Configuration

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | 数据目录 |

### 数据目录

| 路径 | 说明 |
|------|------|
| `~/.openclaw/.auto-skill/cards/` | 经验卡片 |
| `~/.openclaw/.auto-skill/skills/` | L3脚本 |
| `~/.openclaw/.auto-skill/scripts/` | 工具脚本 |
| `~/.openclaw/.auto-skill/logs/` | 日志 |

---

## ❓ 常见问题 | FAQ

### Q: 插件不生效怎么办？

1. 检查插件是否加载：`grep rocky-auto-skill ~/.openclaw/logs/gateway.log`
2. 检查数据目录：`ls ~/.openclaw/.auto-skill/cards/`
3. 重启网关：`openclaw gateway restart`

### Q: 如何查看L3技能？

```bash
grep "level: L3" ~/.openclaw/.auto-skill/cards/*.yaml
```

### Q: 如何手动触发技能？

在对话中包含关键词，或直接调用脚本：
```bash
bash ~/.openclaw/.auto-skill/skills/013-.sh
```

### Q: 回滚失败怎么办？

1. 检查备份文件是否存在：`ls ~/.openclaw/.auto-skill/skills/013*.sh.v*`
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

_Version: 2.10.1 | Updated: 2026-04-19_
