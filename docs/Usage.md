# 使用说明 | Usage Guide

---

## 🤖 自动功能 | Automatic Features

插件通过 OpenClaw 的 `before_agent_start` Hook 自动工作，**无需手动触发**。

### 1. 自动错误检测

从最近的 AI 响应中提取错误信息，自动搜索匹配的经验。

**支持的错误模式：**
- `[ERROR]` / `error:` / `错误：`
- `[FATAL]` / `exception:`
- `not found` / `denied` / `refused` / `timeout` / `failed`
- `ENOENT` / `EACCES` / `EADDRINUSE`

**验证：**
```bash
# 在 AI 对话中制造一个错误关键词，观察日志
grep "错误触发" ~/.openclaw/logs/gateway.log | tail -3
```

### 2. 自动用户消息匹配

从用户消息中提取关键词（中文 ≥ 3 字符），搜索匹配经验卡片。

**匹配规则：**
- 标题完全匹配
- 问题描述包含匹配
- 模糊关键词匹配

**匹配后自动执行：**
- 命中卡片 → hit_count +1
- 检查晋升条件（L1 ≥ 3 → L2, L2 ≥ 5 + 脚本 → L3）
- L3 技能 → 自动执行脚本

**验证：**
```bash
# 在 AI 对话中提到已记录经验的关键词
# 查看日志
grep "hit +1" ~/.openclaw/logs/gateway.log | tail -5
```

### 3. 自动创建经验卡片

当用户消息未匹配到任何已有经验时，自动创建 L1 卡片：
- 标题 = 用户消息前 30 字符
- 问题 = 完整用户消息
- 解决方案 = "待补充"
- 级别 = L1

**验证：**
```bash
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list
```

### 4. 自动 L2 → L3 晋升

L2 卡片满足以下条件时自动晋升：
- hit_count ≥ 5
- solution 为"待补充"
- 自动根据标题关键词生成修复脚本
- 自动调用 `autoskill-promote` 晋升

### 5. 模型分析工作流

当对话 ≥ 6 轮时，插件自动调用 MiniMax M2.7 模型分析：

| 分析结果 | 动作 |
|----------|------|
| `WORKFLOW_GEN` | 生成新 L3 技能（含自动生成 Bash 脚本） |
| `SKILL_UPDATE` | 更新已有技能的修复脚本 |
| `SKILL_DELETE` | 删除无效技能 |
| `NO_OP` | 无操作 |

**生成的脚本特点：**
- 自动适配目标系统（macOS / Linux）
- 直接创建为 L3 级别
- 自动赋予执行权限

### 6. 每日沉寂扫描

每小时检查一次，每天执行一次衰减扫描：

| 级别 | 衰减规则 |
|------|----------|
| 🟡 L1 | 30 天未命中 → 删除 |
| 🟠 L2 | 60 天 → 降为 L1，120 天 → 删除 |
| 🔴 L3 | 90 天 → 降为 L2，180 天 → 删除 |
| 所有 | 365 天 → 标记 review 状态 |

**额外：** 自动清理无对应卡片的孤儿脚本文件。

---

## 🛠️ 手动命令 | Manual Commands

### 搜索经验

```bash
# 基础搜索
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "关键词"

# 指定返回数量
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "关键词" --top 5

# JSON 格式输出
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "关键词" --top 3 --json
```

### 记录经验

```bash
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-record \
  --title "Nginx 端口占用处理" \
  --tool "nginx" \
  --problem "Nginx 启动报错端口被占用" \
  --solution "lsof -i:80 找到进程，kill -9 终止" \
  --tags "nginx,network,port" \
  --root-cause "之前进程未正常退出" \
  --commands "lsof -i:80 && kill -9 PID" \
  --category "network"
```

**必填参数：** `--title`, `--tool`, `--problem`, `--solution`
**可选参数：** `--tags`, `--root-cause`, `--commands`, `--category`

### 创建 L3 技能（直接带脚本）

```bash
# 1. 准备修复脚本
cat > fix-nginx-port.sh << 'EOF'
#!/bin/bash
PORT=${1:-80}
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill -9 $PID
  echo "已终止占用端口 $PORT 的进程: $PID"
else
  echo "端口 $PORT 当前空闲"
fi
EOF

# 2. 创建 L3 技能
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-create \
  --title "Nginx 端口占用修复" \
  --tool "nginx" \
  --problem "Nginx 启动时端口被占用" \
  --solution "自动检测并终止占用进程" \
  --script "fix-nginx-port.sh"
```

### 标记命中

```bash
# 确认复用成功（hit +1，自动检查晋升）
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-hit <id>

# 标记方案无效（卡片 → expired）
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-hit <id> --invalid
```

### 查看卡片列表

```bash
# 查看所有
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list

# 按级别过滤
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list --level L3

# 按状态过滤
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list --status active

# 按工具过滤
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list --tool nginx
```

### 统计面板

```bash
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-stats
```

输出示例：
```
╔══════════════════════════════════════╗
║   rocky-auto-skill 统计面板         ║
╚══════════════════════════════════════╝

📊 卡片总数: 14
   🟡 L1 经验: 8
   🟠 L2 验证: 3
   🔴 L3 技能: 3

📋 状态分布:
   ✅ 活跃: 12
   🔍 待审查: 1
   ❌ 已失效: 1

📈 总命中次数: 47
🤖 L3 脚本数: 3
```

### 手动晋升/降级

```bash
# 晋升一级
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-promote <id> --up

# 降级一级
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-promote <id> --down

# 直接指定级别
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-promote <id> --to L3
```

> ⚠️ 晋升到 L3 需要关联的脚本文件存在。

### 执行衰减扫描

```bash
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-decay
```

### 生成向量嵌入

```bash
# 为指定卡片生成 embedding
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-embed <id>

# 为所有缺少 embedding 的卡片生成
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-embed --all

# 重建所有卡片的 embedding
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-embed --rebuild
```

> ⚠️ 需要 LM Studio 运行 `text-embedding-nomic-embed-text-v1.5` 模型（localhost:1234）

### 记录执行日志

```bash
# 记录成功
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-log <id> success

# 记录失败
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-log <id> failed
```

---

## 🔒 安全机制 | Security

| 机制 | 说明 |
|------|------|
| **脚本超时** | 30 秒自动终止执行 |
| **执行去重** | 60 秒内同一脚本不重复执行 |
| **路径限制** | 只执行 `.auto-skill/skills/` 下的脚本 |
| **成功率门槛** | 成功率 < 90% 不自动执行，交给 AI 判断 |
| **技能缓存** | L3 列表缓存 5 分钟，减少 IO |
| **输入清洗** | 搜索关键词去除特殊字符，限制 200 字符 |

---

## 📊 三级体系详解 | Three-Level System Details

| 级别 | 颜色 | 创建方式 | 晋升条件 | 能力 |
|------|------|----------|----------|------|
| **L1** | 🟡 黄 | 自动创建 / 手动 record | hit ≥ 3 → L2 | 搜索返回 |
| **L2** | 🟠 橙 | L1 晋升 | hit ≥ 5 + 脚本 → L3 | AI 参考建议 |
| **L3** | 🔴 红 | L2 晋升 / 手动 create / AI 生成 | — | **自动执行** |

---

## 下一步 | Next Steps

- [架构说明](./Architecture.md) — 了解插件内部工作原理
- [常见问题](./FAQ.md) — 故障排查
