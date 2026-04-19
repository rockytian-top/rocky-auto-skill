# 安装指南 | Installation Guide

---

## 环境要求 | Requirements

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| **Node.js** | ≥ 14.0.0 | OpenClaw Gateway 运行所需 |
| **Python** | ≥ 3.8 | 混合搜索引擎所需 |
| **OpenClaw** | 最新版 | 已安装并正常运行 |

验证环境：

```bash
node --version   # 应显示 v14+
python3 --version # 应显示 3.8+
openclaw --version # 确认 OpenClaw 已安装
```

---

## 安装方式 | Installation Methods

### 方式一：自动安装（推荐）

插件首次加载时自动检测并创建所需目录和文件。只需重启网关即可：

```bash
# 重启网关，插件自动安装
openclaw gateway restart

# 查看日志确认插件加载成功
tail -f ~/.openclaw/logs/gateway.log | grep "rocky-auto-skill"
```

### 方式二：手动安装

#### Step 1: 克隆仓库

```bash
# 从 GitHub 克隆
git clone https://github.com/rockytian-top/rocky-auto-skill.git

# 或从 Gitee 克隆（国内推荐）
git clone https://gitee.com/rocky_tian/rocky-auto-skill.git
```

#### Step 2: 复制到 extensions 目录

```bash
# 复制插件到 extensions 目录
cp -r rocky-auto-skill ~/.openclaw/extensions/

# 确认文件已复制
ls -la ~/.openclaw/extensions/rocky-auto-skill/
```

#### Step 3: 重启网关

```bash
# 重启网关以加载插件
openclaw gateway restart

# 确认插件已加载
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log
```

---

## 目录结构 | Directory Structure

安装后，插件会在 `~/.openclaw/` 下创建数据目录：

```
~/.openclaw/
├── extensions/
│   └── rocky-auto-skill/      # 插件代码
│       ├── index.js           # 主插件代码
│       ├── openclaw.plugin.json
│       ├── autoskill-search   # Shell 包装器
│       ├── autoskill-search.py # 混合搜索引擎
│       └── README.md
└── .auto-skill/              # 数据目录（自动创建）
    ├── cards/                # 经验卡片 (YAML)
    │   ├── 001.yaml
    │   └── ...
    ├── skills/               # 脚本文件
    │   ├── 001.sh
    │   └── ...
    └── logs/                 # 执行日志
        └── auto-skill.log
```

---

## 验证安装 | Verify Installation

### 方法 1: 检查插件列表

```bash
openclaw plugins list
# 应显示 rocky-auto-skill
```

### 方法 2: 手动测试搜索

```bash
python3 ~/.openclaw/extensions/rocky-auto-skill/autoskill-search "端口占用"
# 应返回匹配的卡片信息
```

### 方法 3: 检查数据目录

```bash
ls -la ~/.openclaw/.auto-skill/
# 应显示 cards/, skills/, logs/ 目录
```

---

## 卸载 | Uninstall

```bash
# 1. 移除插件目录
rm -rf ~/.openclaw/extensions/rocky-auto-skill

# 2. 重启网关
openclaw gateway restart

# 3. (可选) 移除数据目录
# rm -rf ~/.openclaw/.auto-skill/
```

---

## 常见问题 | Common Issues

### Q: 插件未加载

```bash
# 检查插件状态
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log

# 确认目录结构
ls -la ~/.openclaw/extensions/rocky-auto-skill/
```

### Q: 数据目录未创建

首次加载插件后，数据目录应自动创建。如未创建，可手动创建：

```bash
mkdir -p ~/.openclaw/.auto-skill/{cards,skills,logs}
```

### Q: 权限问题

确保插件目录有执行权限：

```bash
chmod +x ~/.openclaw/extensions/rocky-auto-skill/autoskill-search
chmod +x ~/.openclaw/.auto-skill/skills/*.sh
```

---

## 下一步 | Next Steps

安装完成后，请阅读 [使用说明](./Usage.md) 了解如何触发和使用插件。
