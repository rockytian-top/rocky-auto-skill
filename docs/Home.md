# rocky-auto-skill

> 自动运维经验闭环系统 | Automated Operations Experience Closed-Loop System

## 🎯 是什么 | What is it

**rocky-auto-skill** 是一个运行在 [OpenClaw](https://github.com/rockytian-top/openclaw) 上的插件，它将 AI 助手从"被动回答者"变为"主动执行者"。

当用户遇到问题时，它自动搜索经验库并执行可自动化的 L3 技能脚本；问题解决后，自动提示记录经验；高频经验自动晋升为可执行技能，形成**闭环**。

---

## 🚀 快速开始 | Quick Start

```bash
# 1. 复制插件到 extensions 目录
git clone https://github.com/rockytian-top/rocky-auto-skill.git
cp -r rocky-auto-skill ~/.openclaw/extensions/

# 2. 重启网关（自动安装）
openclaw gateway restart

# 3. 正常使用即可，插件自动工作
# 用户: "端口占用"
# AI: → 自动执行修复脚本 → 返回: "端口已释放"
```

---

## 📌 核心能力 | Core Capabilities

| 能力 | 说明 |
|------|------|
| **自动搜索** | 遇问题自动搜索经验库（BM25 + 向量混合） |
| **自动执行** | L3 技能成功率 ≥90% 时自动执行脚本 |
| **自动记录** | 问题解决后自动提示记录经验 |
| **自动晋升** | L1 → L2 → L3 渐进晋升机制 |
| **结果注入** | 脚本执行结果自动注入 AI 上下文 |

---

## 📖 文档导航 | Documentation

| 页面 | 内容 |
|------|------|
| [安装指南](./Installation.md) | 完整安装步骤、依赖要求 |
| [使用说明](./Usage.md) | 自动触发场景、手动命令详解 |
| [架构说明](./Architecture.md) | 系统架构、数据流、设计理念 |
| [更新日志](./Changelog.md) | 完整版本历史 |
| [常见问题](./FAQ.md) | FAQ 和故障排查 |

---

## 🏆 三级技能体系 | Three-Level Skill System

```
L1 (基础) ─── 搜索命中 ─── 仅返回经验内容
   │
   │ 命中≥3次 + 脚本模板 + ≥60%成功率
   ▼
L2 (进阶) ─── 人工确认 ─── 确认后执行脚本
   │
   │ 成功率≥90%
   ▼
L3 (专家) ─── 自动执行 ─── 无需干预，直接执行
```

---

## 📦 数据存储 | Data Storage

```
~/.openclaw/.auto-skill/
├── cards/          # 经验卡片 (YAML)
│   ├── 001.yaml
│   └── ...
├── skills/         # 可执行脚本
│   ├── 001.sh
│   └── ...
└── logs/           # 执行日志
    └── auto-skill.log
```

---

## 🛡️ 安全机制 | Security

- **超时保护**: 脚本执行超时 30 秒自动终止
- **缓存去重**: 60 秒内同一脚本不重复执行
- **路径限制**: 只执行 `.auto-skill/skills/` 目录
- **成功率门槛**: 低于 90% 不自动执行

---

## 📄 License

MIT License

---

## 🤝 贡献 | Contributing

Issues and Pull Requests are welcome!
