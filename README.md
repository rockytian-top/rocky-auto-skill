# rocky-auto-skill

> OpenClaw 全自动运维经验闭环插件 | Fully Automated Operations Experience Plugin for OpenClaw

[![Version](https://img.shields.io/badge/version-2.9.1-blue)](./openclaw.plugin.json)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-orange)](https://github.com/openclaw/openclaw)

---

## 📖 概述 | Overview

**rocky-auto-skill** 是一个 [OpenClaw](https://github.com/openclaw/openclaw) 网关插件，让 AI 助手自动积累运维经验、自动执行修复脚本、自动学习优化——形成完整的**经验闭环**。

**rocky-auto-skill** is an [OpenClaw](https://github.com/openclaw/openclaw) gateway plugin that enables your AI assistant to automatically accumulate operations experience, auto-execute repair scripts, and self-optimize — forming a complete **experience closed-loop**.

### 核心理念 | Core Philosophy

```
遇问题 → 自动搜索经验 → 自动匹配技能 → 自动执行脚本 → 自动记录结果 → 自动晋升优化
  ↑                                                                          |
  └──────────────────── 经验闭环 Complete Closed Loop ──────────────────────┘
```

---

## ✨ 核心功能 | Core Features

### 1. 🔍 自动搜索经验 | Auto Search

**触发方式：** 每次用户对话自动触发（`before_agent_start` Hook）

| 触发条件 | 说明 |
|----------|------|
| **错误检测** | 自动从 AI 响应中提取错误信息（支持 `error:`、`failed`、`ENOENT`、`EACCES` 等） |
| **用户消息** | 提取用户消息关键词（中文≥3字符） |
| **混合搜索** | BM25 关键词匹配 + 向量语义相似度（需要 LM Studio） |

**验证方法 | Verification:**
```bash
# 1. 手动搜索测试
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "端口占用" --top 3

# 2. 在 AI 对话中提到已记录的问题关键词，观察是否返回匹配结果
```

---

### 2. 🤖 自动执行 L3 脚本 | Auto Execute

**条件：** L3 技能且执行成功率 ≥ 90%（或首次执行）自动执行，无需人工干预。

**执行流程：**
1. 提取用户消息/错误关键词
2. 搜索匹配的 L3 技能卡片
3. 检查成功率（exec_count=0 或 rate≥90%）
4. 自动执行 Bash 脚本（30秒超时）
5. 将执行结果注入 AI 上下文
6. 自动记录执行日志（success/failed）
7. 自动标记 hit +1

**验证方法 | Verification:**
```bash
# 1. 查看执行日志
cat ~/.openclaw/.auto-skill/logs/executions.log

# 2. 在 AI 对话中触发一个已有 L3 技能的关键词，观察是否自动执行并返回结果
```

---

### 3. 📝 自动记录经验 | Auto Record

**触发条件：** 用户消息未匹配到任何已有经验时，自动创建 L1 卡片。

**自动创建的内容：**
- 标题：用户消息前30字符
- 问题描述：完整用户消息
- 解决方案：标记为"待补充"
- 级别：L1（基础）

**验证方法 | Verification:**
```bash
# 1. 查看自动创建的卡片
ls ~/.openclaw/.auto-skill/cards/

# 2. 在 AI 对话中说一个新问题，检查是否自动生成了卡片
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list
```

---

### 4. 📊 自动 Hit 计数 + 晋升 | Auto Hit & Promotion

每次匹配到已有经验卡片时，自动 hit_count +1。达到阈值自动晋升：

| 级别 | 晋升条件 | 能力 |
|------|----------|------|
| 🟡 **L1** 基础 | 初始创建 | 仅搜索返回 |
| 🟠 **L2** 验证 | hit ≥ 3 次 | 提示 AI 参考（hit ≥ 5 且有脚本时自动晋升 L3） |
| 🔴 **L3** 技能 | hit ≥ 5 + 脚本 + ≥90% 成功率 | **自动执行脚本** |

**L2 → L3 自动晋升细节：**
- L2 卡片 hit ≥ 5 且 solution 为"待补充"时，自动生成修复脚本
- 脚本根据标题关键词生成（内存→`ps aux --sort=-%mem`、CPU→`ps aux --sort=-%cpu` 等）
- 生成后自动调用 `autoskill-promote` 晋升

**验证方法 | Verification:**
```bash
# 查看卡片级别和命中次数
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list

# 手动标记命中（测试晋升）
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-hit <id>
```

---

### 5. 🧠 模型分析工作流 | AI Model Analysis

插件内置 MiniMax M2.7 模型分析，在对话中自动判断：

| 指令 | 说明 | 触发条件 |
|------|------|----------|
| `[WORKFLOW_GEN]` | 生成新的 L3 技能（含自动生成 Bash 脚本） | 对话 ≥ 6 轮且检测到可自动化的操作 |
| `[SKILL_UPDATE]` | 更新已有技能脚本 | 检测到 AI 输出包含修正指令 |
| `[SKILL_DELETE]` | 删除无效技能 | 长期未用或执行失败 |
| `[NO_OP]` | 无操作 | 不需要任何变更 |

**生成的工作流技能特点：**
- 自动兼容目标系统（macOS / Linux）
- 直接创建为 L3 级别
- 脚本自动赋予执行权限

**验证方法 | Verification:**
```bash
# 查看 AI 生成的工作流技能
ls ~/.openclaw/.auto-skill/workflows/
cat ~/.openclaw/.auto-skill/workflows/current.json

# 查看工作流生成的卡片
grep "workflow" ~/.openclaw/.auto-skill/cards/*.yaml
```

---

### 6. 📉 每日沉寂扫描 | Daily Decay Scan

每小时检查一次，每天执行一次沉寂扫描：

| 级别 | 衰减阈值 | 过期阈值 |
|------|----------|----------|
| 🟡 L1 | — | 30 天未命中 → 删除 |
| 🟠 L2 | 60 天未命中 → 降为 L1 | 120 天未命中 → 删除 |
| 🔴 L3 | 90 天未命中 → 降为 L2 | 180 天未命中 → 删除 |

**额外规则：**
- 创建超过 365 天的卡片标记为 `review` 状态
- 自动清理无对应卡片的孤儿脚本文件
- 模型辅助判断是否删除（非硬性规则）

**验证方法 | Verification:**
```bash
# 手动执行衰减扫描
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-decay

# 查看衰减日志
cat ~/.openclaw/.auto-skill/logs/decay.log
```

---

### 7. 🔒 安全机制 | Security

| 机制 | 说明 |
|------|------|
| **脚本超时** | 30 秒自动终止 |
| **执行去重** | 60 秒内同一脚本不重复执行 |
| **路径限制** | 只执行 `.auto-skill/skills/` 目录下的脚本 |
| **成功率门槛** | 成功率 < 90% 的 L3 技能不自动执行，交给 AI 判断 |
| **缓存机制** | L3 技能列表缓存 5 分钟，减少 IO |

---

## 🛠️ 命令行工具 | CLI Tools

插件内置 11 个命令行工具，位于 `scripts/` 目录：

| 命令 | 用途 | 示例 |
|------|------|------|
| `autoskill-search` | 搜索经验卡片 | `python3 autoskill-search.py "关键词" --top 3` |
| `autoskill-record` | 记录 L1 经验 | `bash autoskill-record --title "标题" --tool "工具" --problem "问题" --solution "方案"` |
| `autoskill-create` | 直接创建 L3 技能 | `bash autoskill-create --title "标题" --tool "工具" --problem "问题" --solution "方案" --script "脚本.sh"` |
| `autoskill-hit` | 标记命中 +1 | `bash autoskill-hit <id>` |
| `autoskill-list` | 查看所有卡片 | `bash autoskill-list [--level L3] [--status active]` |
| `autoskill-stats` | 统计面板 | `bash autoskill-stats` |
| `autoskill-promote` | 手动晋升/降级 | `bash autoskill-promote <id> --up` / `--down` / `--to L3` |
| `autoskill-decay` | 执行衰减扫描 | `bash autoskill-decay` |
| `autoskill-embed` | 生成向量嵌入 | `bash autoskill-embed <id>` / `--all` / `--rebuild` |
| `autoskill-log` | 记录执行日志 | `bash autoskill-log <id> success` / `failed` |

### 详细参数说明

#### autoskill-record
```bash
bash autoskill-record \
  --title "标题" \           # 必填：卡片标题
  --tool "工具名" \           # 必填：关联工具（如 nginx, docker）
  --problem "问题描述" \      # 必填：问题描述
  --solution "解决方案" \     # 必填：解决方案
  [--tags "tag1,tag2"] \      # 可选：分类标签
  [--root-cause "根因"] \     # 可选：根因分析
  [--commands "命令"] \       # 可选：相关命令
  [--category "config"]       # 可选：大类 config/deploy/network/service
```

#### autoskill-hit
```bash
bash autoskill-hit <id>           # 确认复用成功（默认）
bash autoskill-hit <id> --confirm  # 同上
bash autoskill-hit <id> --invalid  # 标记方案无效（卡片 → expired）
```

#### autoskill-create
```bash
bash autoskill-create \
  --title "标题" \           # 必填
  --tool "工具" \            # 必填
  --problem "问题" \         # 必填
  --solution "方案" \        # 必填
  --script "修复脚本.sh"      # 必填：脚本文件路径
```

#### autoskill-promote
```bash
bash autoskill-promote <id> --up          # 晋升一级（L1→L2, L2→L3）
bash autoskill-promote <id> --down        # 降级一级（L3→L2, L2→L1）
bash autoskill-promote <id> --to L3       # 直接指定级别
```

#### autoskill-embed
```bash
bash autoskill-embed <id>       # 为指定卡片生成 embedding
bash autoskill-embed --all      # 为所有缺少 embedding 的卡片生成
bash autoskill-embed --rebuild  # 重建所有卡片的 embedding
```
> ⚠️ 需要 LM Studio 运行 `text-embedding-nomic-embed-text-v1.5` 模型（localhost:1234）

---

## 🏗️ 系统架构 | Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       OpenClaw Gateway                          │
│                                                                 │
│  before_agent_start Hook 触发                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Plugin Core                           │  │
│  │                                                          │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │  │
│  │  │ 错误检测     │  │ 用户消息提取  │  │ 自动安装检查   │ │  │
│  │  └──────┬──────┘  └──────┬───────┘  └────────────────┘ │  │
│  │         │                │                              │  │
│  │         └───────┬────────┘                              │  │
│  │                 ▼                                       │  │
│  │  ┌─────────────────────────────┐                       │  │
│  │  │  BM25 + 向量混合搜索        │                       │  │
│  │  │  (autoskill-search.py)      │                       │  │
│  │  └──────────┬──────────────────┘                       │  │
│  │             ▼                                           │  │
│  │  ┌──────────────────────┐  ┌───────────────────────┐  │  │
│  │  │ L3 技能自动执行      │  │ 匹配卡片 Hit +1       │  │  │
│  │  │ (rate ≥ 90%)         │  │ (autoskill-hit)        │  │  │
│  │  └──────────┬───────────┘  └───────────────────────┘  │  │
│  │             ▼                                           │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  结果注入 AI 上下文 (prependContext)              │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                         │  │
│  │  ┌─────────────────────┐  ┌─────────────────────────┐ │  │
│  │  │ 模型分析工作流       │  │ 每日沉寂扫描            │ │  │
│  │  │ (MiniMax M2.7)      │  │ (每小时检查,每天执行)    │ │  │
│  │  │ WORKFLOW_GEN        │  │ L3→L2→L1→删除           │ │  │
│  │  │ SKILL_UPDATE        │  │ 孤儿脚本清理            │ │  │
│  │  │ SKILL_DELETE        │  │ 模型辅助判断            │ │  │
│  │  └─────────────────────┘  └─────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     Data Storage                          │  │
│  │  ~/.openclaw/.auto-skill/                                │  │
│  │  ├── cards/      经验卡片 (YAML)                         │  │
│  │  ├── skills/     可执行脚本 (.sh)                        │  │
│  │  ├── workflows/  AI 生成的工作流                         │  │
│  │  └── logs/       执行日志                                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📦 目录结构 | Directory Structure

```
rocky-auto-skill/                           # 插件目录 | Plugin Directory
├── index.js                    # 主插件代码 (1359行) | Main plugin code
├── openclaw.plugin.json        # 插件配置 | Plugin manifest
├── README.md                   # 本文档 | This file
├── autoskill-search            # Shell 搜索包装器 | Shell search wrapper
├── autoskill-search.py         # 混合搜索引擎 | Hybrid search engine
├── scripts/                    # 命令行工具 | CLI tools
│   ├── autoskill-search        # Shell 搜索包装器
│   ├── autoskill-search.py     # 混合搜索引擎
│   ├── autoskill-record        # 记录 L1 经验
│   ├── autoskill-create        # 创建 L3 技能
│   ├── autoskill-hit           # 命中计数 + 晋升检查
│   ├── autoskill-list          # 查看卡片列表
│   ├── autoskill-stats         # 统计面板
│   ├── autoskill-promote       # 手动晋升/降级
│   ├── autoskill-decay         # 衰减扫描
│   ├── autoskill-embed         # 向量嵌入生成
│   └── autoskill-log           # 执行日志记录
└── docs/                       # Wiki 文档 | Wiki pages
    ├── Home.md                 # Wiki 首页
    ├── Installation.md         # 安装指南
    ├── Usage.md                # 使用说明
    ├── Architecture.md         # 架构说明
    ├── Changelog.md            # 更新日志
    └── FAQ.md                  # 常见问题

~/.openclaw/.auto-skill/        # 数据目录（自动创建）| Data directory (auto-created)
├── cards/                      # 经验卡片 (YAML)
│   ├── 001-nginx-port.yaml
│   ├── 002-docker-cleanup.yaml
│   └── ...
├── skills/                     # 可执行脚本
│   ├── 001-nginx-port.sh
│   └── ...
├── workflows/                  # AI 工作流
│   └── current.json
├── logs/                       # 日志
│   ├── executions.log          # 执行日志
│   └── decay.log               # 衰减日志
├── INDEX.md                    # 卡片索引（自动生成）
└── .decay-scan-state           # 衰减扫描状态
```

---

## 📋 经验卡片格式 | Experience Card Format

```yaml
# ~/.openclaw/.auto-skill/cards/001-nginx-port.yaml
id: "001"
title: "Nginx 端口占用"
tool: nginx
tags: [nginx, network, port]
category: network

level: L3                    # 🟡L1 基础 | 🟠L2 验证 | 🔴L3 技能
hit_count: 12                # 命中次数
source: auto                 # auto=自动 | manual=手动 | workflow_ai=AI生成

created_at: "2026-04-10"
last_hit_at: "2026-04-19"
updated_at: "2026-04-19"
status: active               # active | review | expired

problem: |
  Nginx 启动失败，端口被占用

root_cause: |
  之前 Nginx 进程未正常退出

solution: |
  使用 lsof 查找占用进程并终止

commands: |
  lsof -i:80
  kill -9 <PID>

skill_script: "001-nginx-port.sh"    # L3 关联脚本
exec_count: 5                         # 执行次数
exec_success: 5                       # 成功次数
```

---

## 🔧 安装 | Installation

### 环境要求 | Requirements

| 依赖 | 版本 | 说明 |
|------|------|------|
| **OpenClaw** | 最新版 | 已安装并运行网关 |
| **Node.js** | ≥ 14.0.0 | OpenClaw 运行所需（内置） |
| **Python** | ≥ 3.8 | 混合搜索引擎所需 |
| **LM Studio** (可选) | 任意版 | 向量搜索和 Embedding 生成 |

### 方式一：Git 克隆（推荐）| Git Clone (Recommended)

```bash
# 从 GitHub 克隆
git clone https://github.com/rockytian-top/rocky-auto-skill.git

# 或从 Gitee 克隆（国内更快）
git clone https://gitee.com/rocky_tian/rocky-auto-skill.git

# 复制到 extensions 目录
cp -r rocky-auto-skill ~/.openclaw/extensions/

# 重启网关（插件自动安装数据目录）
openclaw gateway restart
```

### 方式二：手动下载 | Manual Download

1. 下载仓库 ZIP
2. 解压到 `~/.openclaw/extensions/rocky-auto-skill/`
3. 重启网关

### 验证安装 | Verify Installation

```bash
# 方法 1：检查插件日志
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log | tail -5

# 方法 2：检查数据目录
ls ~/.openclaw/.auto-skill/
# 应显示: cards/ skills/ logs/

# 方法 3：手动测试搜索
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "测试"
```

---

## 📊 三级技能体系详解 | Three-Level Skill System

### 晋升流程 | Promotion Flow

```
                    自动创建
                       │
                       ▼
              ┌─────────────────┐
              │   🟡 L1 基础    │  仅搜索返回，无执行能力
              │   hit_count: 0  │
              └────────┬────────┘
                       │
              hit ≥ 3 自动晋升
                       │
                       ▼
              ┌─────────────────┐
              │   🟠 L2 验证    │  AI 参考建议，可生成脚本模板
              │   hit_count: 3+ │
              └────────┬────────┘
                       │
           hit ≥ 5 + 脚本 + 成功率 ≥ 90%
                       │
                       ▼
              ┌─────────────────┐
              │   🔴 L3 技能    │  自动执行脚本，结果注入 AI 上下文
              │   rate: ≥ 90%   │
              └─────────────────┘
```

### 衰减规则 | Decay Rules

```
🔴 L3  ── 90天未用 ──→ 🟠 L2  ── 60天未用 ──→ 🟡 L1  ── 30天未用 ──→ 🗑️ 删除
  │                       │                       │
  └── 180天 ──→ 🗑️ 删除   └── 120天 ──→ 🗑️ 删除   └── 30天 ──→ 🗑️ 删除
```

### 生命周期 | Lifecycle

```
用户提问新问题
    ↓
自动创建 L1 卡片（solution: "待补充"）
    ↓
用户/AI 补充解决方案
    ↓
hit +1 × 3 → 自动晋升 L2
    ↓
hit +1 × 5 + 自动生成脚本
    ↓
晋升 L3 → 自动执行
    ↓
长期不用 → 衰减降级 → 最终删除
```

---

## 🎯 使用场景 | Use Cases

### 场景 1：首次遇到问题 | First Encounter

```
用户: "Nginx 启动报错端口被占用"

系统行为:
  1. 提取关键词 "Nginx 启动报错端口被占用"
  2. 搜索经验库 → 无匹配
  3. 自动创建 L1 卡片: "Nginx 启动报错端口被占用" (solution: 待补充)
  4. 注入提示: "💡 经验系统：遇问题搜经验..."

AI 回答: 基于通用知识回答如何解决端口占用

用户: "解决了，用 lsof -i:80 找到进程 kill 掉"

系统行为:
  5. 匹配到 L1 卡片，hit +1
  6. AI 自动提示记录经验
```

### 场景 2：经验已积累 | Experience Accumulated

```
用户: "Nginx 端口占用"

系统行为:
  1. 搜索经验库 → 匹配到 L3 技能 "Nginx 端口占用"
  2. 检查成功率: 100% (5/5)
  3. 自动执行修复脚本
  4. 注入结果到 AI 上下文
  5. 自动 hit +1

AI 回答: "已自动执行修复脚本，端口 80 已释放。进程 PID 12345 已终止。"
```

### 场景 3：错误自动修复 | Auto Error Fix

```
AI 执行任务时遇到错误:
  [ERROR] port 80 already in use

系统行为:
  1. 从错误信息提取关键词 "port 80 already in use"
  2. 搜索匹配到 L3 技能
  3. 自动执行脚本
  4. 将修复结果注入 AI 下一次回复

AI 继续执行: 无需人工干预，错误已自动修复
```

---

## 🐛 故障排查 | Troubleshooting

### 插件未加载

```bash
# 检查日志
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log

# 确认文件存在
ls ~/.openclaw/extensions/rocky-auto-skill/

# 确认网关状态
openclaw gateway status
```

### 搜索不生效

```bash
# 1. 检查是否有经验卡片
ls ~/.openclaw/.auto-skill/cards/

# 2. 手动测试搜索
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "关键词"

# 3. 检查 Python 版本
python3 --version  # 需要 ≥ 3.8
```

### L3 脚本不自动执行

```bash
# 1. 确认是 L3 级别
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list --level L3

# 2. 检查成功率
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-stats

# 3. 确认脚本文件存在
ls ~/.openclaw/.auto-skill/skills/

# 4. 手动测试脚本
bash ~/.openclaw/.auto-skill/skills/001-xxx.sh
```

### 向量搜索不可用

向量搜索需要 LM Studio 运行 Embedding 模型。如果不可用，插件自动降级为纯 BM25 关键词搜索。

```bash
# 检查 LM Studio 是否运行
curl http://localhost:1234/v1/models
```

---

## 📝 更新日志 | Changelog

### v2.9.1 (2026-04-19)
- **完整脚本内置**: 11 个命令行工具全部内置到 `scripts/` 目录
- **路径独立化**: 优先查找插件自身 `scripts/` 目录，其他用户下载即可用
- **完整中英文文档**: README + 6 个 Wiki 页面

### v2.9.0 (2026-04-19)
- **路径独立化修复**: 支持不同 OpenClaw 安装路径

### v2.7.0 (2026-04-18)
- 完整中英文文档
- 功能对比表

### v2.6.0 (2026-04-17)
- BM25 + 向量混合搜索
- Shell 搜索包装器

### v2.5.0 (2026-04-16)
- 自动晋升机制
- 成功率追踪

### v2.4.0 (2026-04-15)
- L3 自动执行
- 执行结果注入

### v2.0.0 (2026-04-11)
- 从 rocky-skill 重命名
- OpenClaw 插件化改造
- Hook 机制接入

### v1.0.0 (2026-04-05)
- 初始版本

> 完整更新日志见 [docs/Changelog.md](./docs/Changelog.md)

---

## 📄 License

MIT License

---

## 🤝 贡献 | Contributing

Issues and Pull Requests are welcome!

- **GitHub**: https://github.com/rockytian-top/rocky-auto-skill
- **Gitee**: https://gitee.com/rocky_tian/rocky-auto-skill

---

## 🔗 相关链接 | Links

- [OpenClaw](https://github.com/openclaw/openclaw) - AI 助手网关
- [ClawHub](https://clawhub.ai) - 技能市场
- [Wiki 文档](./docs/Home.md)

---

_版本 Version: 2.9.1_
_更新 Update: 2026-04-19_
