# rocky-auto-skill

> 模型驱动的经验闭环系统 | Model-Driven Experience Closed-Loop System
>
> **LLM-Enhanced Context-Aware Skill Improvement** — 智能理解用户意图，自动增强技能脚本

[![Version](https://img.shields.io/badge/version-3.1-blue)](./openclaw.plugin.json)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-orange)](https://github.com/openclaw/openclaw)

---

## 📖 概述 | Overview

**rocky-auto-skill** 是一个 [OpenClaw](https://github.com/openclaw/openclaw) 网关插件，实现**模型驱动的经验闭环系统**。

### 核心能力 | Core Capabilities

| 能力 | 说明 |
|------|------|
| 🔍 智能经验搜索 | BM25 + 向量语义混合搜索，自动匹配运维经验 |
| 🤖 模型决策 | AI 根据上下文自主判断：是否执行技能、是否创建新技能、是否改进现有技能 |
| ⚡ 自动执行 | 匹配到技能后自动执行脚本，结果注入 AI 上下文 |
| ✨ **LLM 增强** | **v3.1.0 新功能** — 智能理解用户"还要显示XXX"等意图，调用 LLM 自动增强脚本 |
| 🔄 版本管理 | 脚本修改前自动备份，支持自然语言回滚 |
| 🧹 沉寂清理 | 自动清理长期不用的技能 |

**rocky-auto-skill** is an [OpenClaw](https://github.com/openclaw/openclaw) gateway plugin that implements a **model-driven experience closed-loop system**.

| Capability | Description |
|-----------|-------------|
| 🔍 Smart Experience Search | BM25 + vector semantic hybrid search, auto-match ops experiences |
| 🤖 Model-Driven Decisions | AI autonomously decides based on context: execute skill, create new skill, or improve existing skill |
| ⚡ Auto-Execute | Automatically execute matched skill scripts, inject results into AI context |
| ✨ **LLM Enhancement** | **v3.1.0 New** — Intelligently understand user intents like "还要显示XXX" (also show XXX), call LLM to auto-enhance scripts |
| 🔄 Version Management | Auto-backup before script modification, support natural language rollback |
| 🧹 Decay Cleanup | Automatically clean up unused skills |

---

## 🚀 快速开始 | Quick Start

### 安装 | Installation

```bash
# 克隆仓库
git clone https://github.com/rockytian-top/rocky-auto-skill.git
cd rocky-auto-skill

# 复制到插件目录
cp -r . ~/.openclaw/extensions/rocky-auto-skill/

# 重启网关
openclaw gateway restart
```

### 自动触发 | Auto Trigger (No Manual Action Needed)

插件在 `before_agent_start` Hook 自动运行，无需手动操作：

```
用户提问 → 插件检测 → 搜索经验库 → 匹配技能 → 模型判断 → 自动执行 → 结果注入上下文
```

---

## ✨ 核心功能详解 | Core Features

### 1. 🔍 智能经验搜索 | Smart Experience Search

**触发时机**：`before_agent_start` Hook，每次对话自动触发

```javascript
// 搜索逻辑
1. 错误检测：从AI响应提取错误关键词 (error:, failed, ENOENT, etc.)
2. 用户消息触发：检测问题关键词
3. 混合搜索：BM25 + 向量语义相似度
```

### 2. 🤖 模型驱动决策 | Model-Driven Decision

| 场景 | 模型决策 |
|------|----------|
| 匹配到技能 | 是否自动执行？ |
| 未匹配技能 | 是否创建新技能？ |
| 用户有反馈 | 是否改进技能？ |
| 技能长期不用 | 是否删除？ |

### 3. ⚡ 自动执行 | Auto-Execute

匹配到技能后自动执行脚本，结果通过 `prependContext` 注入 AI 上下文：

```javascript
result.prependContext = `💡 技能「${title}」执行结果：
${execResult.stdout}
`;
```

### 4. ✨ LLM 增强 (v3.1.0) | LLM Enhancement

**核心能力**：智能理解用户意图，自动调用 LLM 增强技能脚本。

#### 工作流程 | Workflow

```
用户: "还要显示是否启动MySQL"
  ↓
插件检测到增强意图（关键词：还要/加上/添加/显示等）
  ↓
调用 LLM 判断用户是否要求增强
  ↓
是 → 调用 LLM 生成增强后的脚本
  ↓
保存新版本脚本，执行并返回结果
```

#### 支持的增强指令 | Supported Enhancement Commands

| 用户说 | 插件理解 | 效果 |
|--------|----------|------|
| "还要显示MySQL" | 增强意图 | 添加 MySQL 状态显示 |
| "加上内存大小" | 增强意图 | 添加内存信息 |
| "显示在线用户数" | 增强意图 | 添加用户统计 |
| "不对，撤销" | 回滚意图 | 恢复到上一版本 |

#### 技术实现 | Technical Implementation

```javascript
// 1. 检测增强意图
const impliesEnhancement = /还要|加上|添加|增加|显示|也要/.test(userMsg);

// 2. 调用 LLM 判断
const prompt = `技能：${title}
当前脚本：${currentScript}
用户消息：${userMsg}

判断用户是否要求修改或增强脚本？
如果要求修改，只输出修改要求（30字以内）。
如果不需要，只输出"不需要"。`;

// 3. 调用 LLM 生成新脚本
const enhancementPrompt = `你是一个shell脚本专家。
当前脚本：${scriptBody}
用户要求：${enhancement}

直接输出修改后的脚本（保留shebang，只修改body部分）：`;
```

#### 支持的 LLM 提供商 | Supported LLM Providers

| Provider | API Type | Model |
|----------|----------|-------|
| MiniMax Portal | Anthropic | MiniMax-M2.7-highspeed |
| Zhipu (GLM) | OpenAI-compatible | glm-5, glm-5.1 |

> **Note**: glm-5.1 是推理模型，内容在 `reasoning_content` 字段，插件已兼容处理。

### 5. 🔄 版本备份与回滚 | Version Backup & Rollback

**备份触发**：脚本修改前自动备份

**版本数量**：最多保留 2 个版本

**回滚方式**：

```bash
# 自然语言触发
"回到上一个版本"
"撤销"
"回滚"
```

**备份文件位置**：
```
~/.openclaw/.auto-skill/skills/*/*.sh.v1
~/.openclaw/.auto-skill/skills/*/*.sh.v2
```

### 6. 📊 每日沉寂扫描 | Daily Decay Scan

自动清理长期不用的技能：

| 沉寂时间 | 处理 |
|----------|------|
| 30天未用 | 标记为沉寂 |
| 90天未用 | 考虑删除 |

---

## 🏗️ 架构 | Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              rocky-auto-skill Plugin                 │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │            before_agent_start Hook                │  │  │
│  │  │  1. 错误/用户消息检测                            │  │  │
│  │  │  2. 经验搜索 (BM25 + 向量)                      │  │  │
│  │  │  3. 匹配技能 → 模型判断是否执行                  │  │  │
│  │  │  4. 脚本执行 (autoExecuteScript)                │  │  │
│  │  │  5. 结果注入 (prependContext)                   │  │  │
│  │  │  6. LLM 增强检测 (v3.1.0)                      │  │  │
│  │  │  7. 模型驱动的工作流分析                         │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📂 数据结构 | Data Structure

### 经验卡片 | Experience Cards

```yaml
# ~/.openclaw/.auto-skill/cards/*.yaml
id: 013
title: "服务器内存查看"
tool: bash
tags: [服务器, 监控, 内存]
category: 运维

status: active
source: auto

problem: |
  如何查看服务器内存使用情况

solution: |
  使用 free 或 ps 命令查看内存

skill_script: "013-memory.sh"
```

### 技能脚本 | Skill Scripts

```bash
#!/bin/bash
# Problem: 服务器内存查看
set -euo pipefail
echo "=== 内存使用情况 ==="
free -h
```

---

## 📦 安装 | Installation

### 方式一：Git Clone

```bash
git clone https://github.com/rockytian-top/rocky-auto-skill.git
cd rocky-auto-skill
cp -r . ~/.openclaw/extensions/rocky-auto-skill/
openclaw gateway restart
```

### 方式二：通过 openclaw.plugin.json

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

---

## 🔧 配置 | Configuration

### 数据目录

| 路径 | 说明 |
|------|------|
| `~/.openclaw/.auto-skill/cards/` | 经验卡片 (YAML) |
| `~/.openclaw/.auto-skill/skills/` | 技能脚本 (.sh) |
| `~/.openclaw/.auto-skill/scripts/` | 工具脚本 |
| `~/.openclaw/.auto-skill/logs/` | 改进日志 |

### LLM 提供商配置

在 `openclaw.json` 中配置：

```json
{
  "models": {
    "providers": {
      "minimax-portal": {
        "baseUrl": "https://api.minimaxi.com/anthropic",
        "api": "anthropic-messages",
        "authHeader": true
      },
      "zai": {
        "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
        "apiKey": "your-api-key",
        "api": "openai-completions"
      }
    }
  }
}
```

---

## ❓ 常见问题 | FAQ

### Q: 插件不生效怎么办？

```bash
# 1. 检查插件是否加载
grep rocky-auto-skill ~/.openclaw/logs/gateway.log

# 2. 检查数据目录
ls ~/.openclaw/.auto-skill/cards/

# 3. 重启网关
openclaw gateway restart
```

### Q: LLM 增强不触发？

```bash
# 检查日志中的调试信息
grep "LLM enhancement" ~/.openclaw/logs/gateway.log

# 检查模型凭证
grep "apiKey" ~/.openclaw/logs/gateway.log
```

### Q: 如何查看技能列表？

```bash
ls ~/.openclaw/.auto-skill/skills/
```

---

## 📄 许可证 | License

MIT License

---

## 🔗 相关链接 | Links

- [GitHub](https://github.com/rockytian-top/rocky-auto-skill)
- [Gitee](https://gitee.com/rocky_tian/rocky-auto-skill)
- [OpenClaw](https://github.com/openclaw/openclaw)

---

_Version: 3.1.0 | LLM Enhancement Support | Updated: 2026-04-20_
