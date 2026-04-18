# rocky-auto-skill

自动运维经验闭环系统 | Automated Operations Experience Closed-Loop System

---

## 📖 概述 | Overview

**rocky-auto-skill** 是一个自动运维经验闭环系统，检测错误自动搜索经验，解决后自动提示记录，高频复用自动晋升为可执行技能。

**rocky-auto-skill** is an automated operations experience closed-loop system that automatically searches experience when errors are detected, prompts recording after issues are resolved, and automatically promotes frequently-used solutions into executable skills.

---

## ✨ 功能特性 | Features

| 功能 Feature | 中文 | English |
|-------------|------|---------|
| 自动搜索 | 遇问题自动搜索经验库 | Auto-search experience base on problems |
| 自动执行 | L3技能脚本自动执行（≥90%成功率）| Auto-execute L3 scripts (≥90% success rate) |
| 自动记录 | 解决后自动提示记录经验 | Auto-prompt recording after resolution |
| 自动晋升 | 高频经验自动晋升为L3技能 | Auto-promote frequent experience to L3 skills |
| 三级制 | L1→L2→L3 渐进晋升机制 | L1→L2→L3 progressive promotion |

---

## 🏗️ 系统架构 | Architecture

```
用户消息/错误
    ↓
自动提取关键词
    ↓
搜索经验库 (BM25 + 向量混合)
    ↓
匹配 L3 技能
    ↓
检查脚本成功率 (≥90%?)
    ↓
自动执行脚本 → 注入结果到 context
    ↓
自动 hit 计数 → 晋升
```

---

## 📦 目录结构 | Directory Structure

```
rocky-auto-skill/
├── index.js              # 主插件代码 | Main plugin code
├── openclaw.plugin.json  # 插件配置 | Plugin configuration
├── autoskill-search      # 搜索 wrapper | Search wrapper
├── autoskill-search.py   # 混合搜索引擎 | Hybrid search engine
└── README.md             # 本文档 | This file
```

---

## 🔧 安装 | Installation

### 方式一：自动安装（推荐）| Auto-install (Recommended)

插件加载时自动检测并创建所需目录和文件：

Plugin automatically detects and creates required directories and files on load:

```bash
# 插件首次加载时自动安装
# Plugin auto-installs on first load
openclaw gateway restart
```

### 方式二：手动安装 | Manual Install

```bash
# 复制到 extensions 目录
cp -r rocky-auto-skill ~/.openclaw/extensions/

# 重启网关
openclaw gateway restart
```

---

## 📋 经验卡片格式 | Experience Card Format

经验存储在 `~/.openclaw/.auto-skill/cards/` 目录：

Experience cards stored in `~/.openclaw/.auto-skill/cards/`:

```yaml
id: 001
title: 端口占用
level: L3
problem: 端口被占用无法启动服务
solution: 使用 lsof 和 kill 命令释放端口
skill_script: 001.sh
created_at: 2026-04-18
```

---

## 🎯 使用方法 | Usage

### 自动触发 | Auto Trigger

当用户发送包含关键词的消息时，自动匹配L3技能并执行：

When user sends message containing keywords, auto-match and execute L3 skills:

```
用户: "端口占用"
系统: → 自动执行 015.sh → 返回结果
```

### 手动搜索 | Manual Search

```bash
# 搜索经验
python3 ~/.openclaw/extensions/rocky-auto-skill/autoskill-search "关键词"

# 记录经验
bash ~/.openclaw/extensions/rocky-auto-skill/autoskill-record \
  --title "标题" \
  --tool "工具" \
  --problem "问题" \
  --solution "方案"
```

---

## 📊 技能等级 | Skill Levels

| 等级 | 名称 | 说明 |
|------|------|------|
| L1 | 基础 | 搜索结果，人工判断 |
| L2 | 进阶 | 带脚本模板，成功率≥60%晋升 |
| L3 | 专家 | 自动执行，成功率≥90% |

| Level | Name | Description |
|-------|------|-------------|
| L1 | Basic | Search results, manual decision |
| L2 | Advanced | With script template, promote at ≥60% success |
| L3 | Expert | Auto-execute, promote at ≥90% success |

---

## 🔐 安全机制 | Security

- 脚本执行超时：30秒
- 执行结果缓存：60秒（避免重复执行）
- 只执行 `.auto-skill/skills/` 目录下的脚本
- 自动跳过含 `auto-generated` 标记的模板脚本

- Script execution timeout: 30 seconds
- Execution result cache: 60 seconds (avoid repeated execution)
- Only execute scripts in `.auto-skill/skills/` directory
- Auto-skip template scripts with `auto-generated` marker

---

## 📝 配置文件 | Configuration

### openclaw.plugin.json

```json
{
  "id": "rocky-auto-skill",
  "name": "Auto Skill",
  "description": "自动经验搜索与记录",
  "version": "2.7.0",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

---

## 🐛 故障排查 | Troubleshooting

### 插件未加载 | Plugin Not Loading

```bash
# 检查插件状态
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log

# 检查目录结构
ls -la ~/.openclaw/extensions/rocky-auto-skill/
```

### 自动执行未触发 | Auto-Execute Not Triggering

1. 确认消息≥3字符（中文）
2. 确认L3技能存在且有 `skill_script` 字段
3. 检查脚本文件存在：`ls ~/.openclaw/.auto-skill/skills/`

---

## 📄 许可证 | License

MIT License

---

## 🤝 贡献 | Contributing

欢迎提交 Issue 和 Pull Request！

Issues and Pull Requests are welcome!

---

_版本 Version: 2.7.0_  
_更新 Update: 2026-04-18_
