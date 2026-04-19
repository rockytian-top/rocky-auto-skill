# rocky-auto-skill Wiki

> 自动运维经验闭环系统 | Automated Operations Experience Closed-Loop System

---

## 🎯 是什么 | What is it

**rocky-auto-skill** 是 [OpenClaw](https://github.com/openclaw/openclaw) 网关插件，让 AI 助手：

1. **自动搜索** — 遇问题自动搜索经验库（BM25 + 向量混合搜索）
2. **自动执行** — L3 技能自动执行修复脚本（成功率 ≥ 90%）
3. **自动记录** — 新问题自动创建经验卡片，解决后提示记录
4. **自动晋升** — 经验从 L1 → L2 → L3 逐级晋升
5. **自动衰减** — 长期未用的经验自动降级和清理
6. **模型分析** — AI 模型自动判断生成/优化/删除技能

**rocky-auto-skill** is an [OpenClaw](https://github.com/openclaw/openclaw) gateway plugin that enables your AI assistant to auto-search experience, auto-execute fix scripts, auto-record new issues, auto-promote skills, auto-decay unused ones, and use AI models to generate/optimize/delete skills.

---

## 📖 文档导航 | Documentation

| 页面 | 内容 | Page | Content |
|------|------|------|---------|
| [安装指南](./Installation.md) | 环境要求、安装步骤、验证方法 | [Installation](./Installation.md) | Requirements, steps, verification |
| [使用说明](./Usage.md) | 功能详解、命令参数、使用场景 | [Usage](./Usage.md) | Features, CLI params, use cases |
| [架构说明](./Architecture.md) | 系统架构、数据流、工作原理 | [Architecture](./Architecture.md) | System design, data flow, internals |
| [更新日志](./Changelog.md) | 完整版本历史 | [Changelog](./Changelog.md) | Full version history |
| [常见问题](./FAQ.md) | 故障排查、FAQ | [FAQ](./FAQ.md) | Troubleshooting, FAQ |

---

## 🏆 三级技能体系 | Three-Level Skill System

```
🟡 L1 基础     搜索命中，仅返回经验内容
  │            hit ≥ 3 自动晋升
  ▼
🟠 L2 验证     AI 参考建议，可生成脚本模板
  │            hit ≥ 5 + 脚本 + 成功率 ≥ 90% 自动晋升
  ▼
🔴 L3 技能     自动执行脚本，结果注入 AI 上下文
```

### 衰减规则 | Decay Rules

| 级别 | 降级阈值 | 删除阈值 |
|------|----------|----------|
| 🟡 L1 | — | 30 天 |
| 🟠 L2 | 60 天 → L1 | 120 天 |
| 🔴 L3 | 90 天 → L2 | 180 天 |

---

## 🚀 快速开始 | Quick Start

```bash
# 1. 克隆
git clone https://gitee.com/rocky_tian/rocky-auto-skill.git

# 2. 安装
cp -r rocky-auto-skill ~/.openclaw/extensions/

# 3. 重启网关
openclaw gateway restart

# 4. 验证
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log | tail -3
```

---

## 📦 内置工具 | Built-in Tools

| 命令 | 用途 |
|------|------|
| `autoskill-search` | 搜索经验卡片（BM25 + 向量） |
| `autoskill-record` | 记录 L1 经验 |
| `autoskill-create` | 创建 L3 技能（带脚本） |
| `autoskill-hit` | 标记命中 + 晋升检查 |
| `autoskill-list` | 查看卡片列表 |
| `autoskill-stats` | 统计面板 |
| `autoskill-promote` | 手动晋升/降级 |
| `autoskill-decay` | 衰减扫描 |
| `autoskill-embed` | 向量嵌入生成 |
| `autoskill-log` | 执行日志记录 |

---

## 🔗 链接 | Links

- **GitHub**: https://github.com/rockytian-top/rocky-auto-skill
- **Gitee**: https://gitee.com/rocky_tian/rocky-auto-skill
- **OpenClaw**: https://github.com/openclaw/openclaw

---

_版本: 2.9.1 | 更新: 2026-04-19_
