# 安装指南 | Installation Guide

---

## 环境要求 | Requirements

| 依赖 | 版本 | 说明 | 必需 |
|------|------|------|------|
| **OpenClaw** | 最新版 | AI 助手网关 | ✅ 必需 |
| **Node.js** | ≥ 14.0.0 | OpenClaw 内置 | ✅ 必需 |
| **Python** | ≥ 3.8 | 混合搜索引擎 | ✅ 必需 |
| **LM Studio** | 任意版 | 向量搜索和 Embedding | ❌ 可选 |

验证环境：

```bash
openclaw --version     # 确认 OpenClaw 已安装
python3 --version      # 应显示 3.8+
node --version         # 应显示 v14+
```

---

## 安装方式 | Installation Methods

### 方式一：Git 克隆（推荐）

```bash
# 从 GitHub 克隆
git clone https://github.com/rockytian-top/rocky-auto-skill.git

# 或从 Gitee 克隆（国内更快）
git clone https://gitee.com/rocky_tian/rocky-auto-skill.git

# 复制到 extensions 目录
cp -r rocky-auto-skill ~/.openclaw/extensions/

# 重启网关
openclaw gateway restart
```

### 方式二：手动下载

1. 从 [GitHub](https://github.com/rockytian-top/rocky-auto-skill) 或 [Gitee](https://gitee.com/rocky_tian/rocky-auto-skill) 下载 ZIP
2. 解压到 `~/.openclaw/extensions/rocky-auto-skill/`
3. 重启网关

---

## 自动安装 | Auto-Install

插件首次加载时自动执行：

1. **创建数据目录** — `~/.openclaw/.auto-skill/` 下创建 `cards/`、`skills/`、`logs/`
2. **复制命令行工具** — 如果 `skills/` 目录为空，自动从插件自带 `scripts/` 复制
3. **无需任何额外操作**

---

## 验证安装 | Verify Installation

### 步骤 1：检查插件日志

```bash
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log | tail -5
# 应显示: [DEBUG] rocky-auto-skill register called
# 应显示: [DEBUG] autoInstall check done
```

### 步骤 2：检查数据目录

```bash
ls ~/.openclaw/.auto-skill/
# 应显示: cards/ skills/ logs/
```

### 步骤 3：手动测试搜索

```bash
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "测试" --top 3
# 应正常执行不报错
```

### 步骤 4：检查统计面板

```bash
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-stats
# 应显示统计面板（初始为空）
```

---

## LM Studio 配置（可选）| LM Studio Setup (Optional)

如果需要向量语义搜索能力：

1. 安装 [LM Studio](https://lmstudio.ai/)
2. 下载 `nomic-embed-text-v1.5` Embedding 模型
3. 启动本地服务器（默认端口 1234）
4. 验证：

```bash
curl http://localhost:1234/v1/models
# 应返回模型列表
```

> ⚠️ LM Studio 未运行时，插件自动降级为纯 BM25 关键词搜索，不影响基本功能。

---

## 目录结构 | Directory Structure

安装完成后的完整结构：

```
~/.openclaw/
├── extensions/
│   └── rocky-auto-skill/      # 插件代码
│       ├── index.js           # 主插件 (1359行)
│       ├── openclaw.plugin.json
│       ├── autoskill-search   # Shell 搜索包装器
│       ├── autoskill-search.py # 混合搜索引擎
│       ├── scripts/           # 11 个命令行工具
│       └── docs/              # Wiki 文档
└── .auto-skill/              # 数据目录（自动创建）
    ├── cards/                # 经验卡片 (YAML)
    ├── skills/               # 可执行脚本 (.sh)
    ├── workflows/            # AI 工作流
    └── logs/                 # 日志
```

---

## 卸载 | Uninstall

```bash
# 1. 移除插件
rm -rf ~/.openclaw/extensions/rocky-auto-skill

# 2. 重启网关
openclaw gateway restart

# 3. (可选) 移除数据
# rm -rf ~/.openclaw/.auto-skill/
```

---

## 下一步 | Next Steps

安装完成后，请阅读 [使用说明](./Usage.md) 了解完整功能。
