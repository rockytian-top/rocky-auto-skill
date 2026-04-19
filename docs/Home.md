# 首页 | Home

> rocky-auto-skill v3.0 - OpenClaw 模型驱动的经验闭环插件

## 📖 关于 | About

**rocky-auto-skill** 是 OpenClaw 网关插件，让 AI 助手自动积累运维经验、自动执行修复脚本、自动学习优化——形成完整的**经验闭环**。

---

## 🎯 核心理念 | Core Value

```
遇问题 → 自动搜索经验 → 模型判断 → 自动执行脚本 → 自动记录改进 → 模型持续优化
```

### v3.0 核心变化

- ❌ 移除 L1/L2/L3 级别机制
- ❌ 移除 hit_count 晋升规则
- ✅ 模型自主决策（而非固定规则）
- ✅ 上下文感知的技能改进

---

## ✨ 功能一览 | Features

| 功能 | 说明 |
|------|------|
| 🔍 自动搜索 | 错误检测 + 关键词 + 语义搜索 |
| 🤖 模型驱动 | 模型自主判断是否执行 |
| 🔄 版本回滚 | 最多2个版本备份 |
| 📝 改进日志 | 所有修改记录 |
| 🔧 自我改进 | Agent 主动优化 |

---

## 📊 横向对比 | Comparison

### vs Hermes Agent

| 功能 | Hermes | rocky-auto-skill |
|------|--------|------------------|
| 技能存储 | SKILL.md | .sh 脚本 + YAML |
| 版本控制 | ❌ | ✅ 最多2个版本 |
| 用户回滚 | ❌ | ✅ 自然语言触发 |
| 模型决策 | ✅ | ✅ |
| 上下文理解 | ✅ | ✅ |
| 衰减机制 | ❌ | ✅ |

---

## 🚀 快速开始 | Quick Start

1. 安装插件
2. 重启网关
3. 自动生效，无需配置

详细文档：[Installation](./Installation.md) | [Usage](./Usage.md)

---

## 📂 文档目录 | Docs

- [安装指南](./Installation.md) - Installation Guide
- [使用说明](./Usage.md) - Usage Guide
- [架构说明](./Architecture.md) - Architecture
- [更新日志](./Changelog.md) - Changelog
- [常见问题](./FAQ.md) - FAQ
