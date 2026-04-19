# 安装指南 | Installation Guide

## 环境要求 | Requirements

| 要求 | 说明 |
|------|------|
| OpenClaw | 2026.04.15+ |
| Node.js | 内置 |
| Python | 3.8+ (用于向量搜索) |

---

## 安装方式 | Installation Methods

### 方式一：自动安装 (推荐)

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

### 方式二：手动安装

```bash
# 1. 克隆仓库
git clone https://github.com/rockytian-top/rocky-auto-skill.git
cd rocky-auto-skill

# 2. 复制到插件目录
cp -r . ~/.openclaw/extensions/rocky-auto-skill/

# 3. 重启网关
openclaw gateway restart
```

### 方式三：符号链接

```bash
# 如果已有仓库
ln -s /path/to/rocky-auto-skill ~/.openclaw/extensions/rocky-auto-skill
```

---

## 验证安装 | Verification

```bash
# 检查插件是否加载
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log

# 检查数据目录
ls ~/.openclaw/.auto-skill/

# 检查技能脚本
ls ~/.openclaw/.auto-skill/scripts/
```

---

## 多网关安装 | Multi-Gateway Installation

每个网关实例需要独立的数据目录：

```bash
# 网关1
OPENCLAW_STATE_DIR=~/.openclaw

# 网关2
OPENCLAW_STATE_DIR=~/.openclaw-gateway2
```

数据会自动创建在对应目录的 `.auto-skill/` 下。

---

## 卸载 | Uninstall

```bash
# 删除插件目录
rm -rf ~/.openclaw/extensions/rocky-auto-skill

# (可选) 删除数据目录
rm -rf ~/.openclaw/.auto-skill/

# 重启网关
openclaw gateway restart
```

---

## 故障排查 | Troubleshooting

| 问题 | 解决方案 |
|------|----------|
| 插件未加载 | 检查 `openclaw plugin list` |
| 数据目录未创建 | 重启网关 |
| 脚本无执行权限 | `chmod +x ~/.openclaw/.auto-skill/scripts/*.sh` |

---

[返回首页](./Home.md)
