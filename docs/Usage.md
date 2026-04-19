# 使用说明 | Usage Guide

---

## 自动触发 | Auto Trigger

插件在 OpenClaw Gateway 运行期间全程自动工作，无需人工干预。

### 触发条件

| 触发类型 | 条件 | 示例 |
|----------|------|------|
| **错误检测** | AI 响应中包含错误关键词 | `[error] port 80 already in use` |
| **问题搜索** | 用户消息 ≥3 字符（中文） | `端口占用怎么办` |
| **L3 自动执行** | 技能成功率 ≥90% | 自动执行，无需确认 |

### 场景示例

#### 场景 1：用户报告问题（自动搜索 + 执行）

```
用户: "端口占用"
  │
  ▼
系统: → 检测关键词 "端口占用"
     → 搜索经验库，匹配 L3 技能
     → 检查 015.sh 成功率 ≥90%
     → 自动执行 015.sh
     → 注入结果到上下文
  │
  ▼
AI: "端口 80 已释放，当前空闲"
```

#### 场景 2：AI 遇到错误（自动检测 + 执行）

```
AI: [error] port 80 already in use
  │
  ▼
系统: → 提取错误 "port 80 already in use"
     → 搜索匹配的经验卡片
     → 自动执行对应脚本
  │
  ▼
AI: "端口占用已解决：进程 PID 1234 已终止"
```

#### 场景 3：问题解决后（自动提示记录）

```
AI: 问题已解决
  │
  ▼
系统: → 检测问题已解决
     → 自动发送提示：
  │
  ▼
💡 提示：这个问题解决了吗？记入经验库方便下次复用：
bash autoskill-record --title "..." --tool "..." --problem "..." --solution "..."
```

---

## 手动命令 | Manual Commands

### 搜索经验 | Search Experience

```bash
# 基本搜索
python3 ~/.openclaw/extensions/rocky-auto-skill/autoskill-search "端口占用"

# 输出示例
# [INFO] 搜索: "端口占用"
# [INFO] 找到 2 个匹配:
#   - 015: 端口占用 (L3, 成功率 100%, 已执行 5 次)
```

### 记录经验 | Record Experience

```bash
bash ~/.openclaw/extensions/rocky-auto-skill/autoskill-record \
  --title "Nginx端口占用处理" \
  --tool "lsof, kill" \
  --problem "端口被占用无法启动Nginx" \
  --solution "lsof -i:80 找到PID，kill -9 终止进程"
```

参数说明：

| 参数 | 必填 | 说明 |
|------|------|------|
| `--title` | ✅ | 经验标题 |
| `--tool` | ✅ | 使用的工具 |
| `--problem` | ✅ | 问题描述 |
| `--solution` | ✅ | 解决方案 |

### 晋升经验 | Promote Experience

```bash
# 晋升指定 ID 的经验
bash ~/.openclaw/extensions/rocky-auto-skill/autoskill-promote 015

# 输出示例
# [INFO] 晋升 015: 端口占用
# [INFO] L1 → L2: 需要脚本模板 + ≥60% 成功率
# [INFO] L2 → L3: 需要 ≥90% 成功率
```

### 查看统计 | View Statistics

```bash
# 查看单个经验统计
bash ~/.openclaw/extensions/rocky-auto-skill/autoskill-stats 015

# 查看所有经验
bash ~/.openclaw/extensions/rocky-auto-skill/autoskill-stats --all
```

### 经验卡片格式 | Card Format

经验卡片存储在 `~/.openclaw/.auto-skill/cards/` 目录下，以 YAML 格式保存：

```yaml
# ~/.openclaw/.auto-skill/cards/015.yaml
id: 015
title: 端口占用
level: L3
problem: 端口被占用无法启动服务
solution: 使用 lsof 和 kill 命令释放端口
tool: lsof, kill
skill_script: 015.sh
embedding: [...]  # 向量嵌入（自动生成）
created_at: 2026-04-18
updated_at: 2026-04-19
stats:
  exec_count: 5
  exec_success: 5
  exec_fail: 0
  last_used: 2026-04-19
  hit_count: 12
  rate: 100
```

---

## 技能等级说明 | Skill Levels

| 等级 | 触发条件 | 执行方式 | 提示信息 |
|------|----------|----------|----------|
| **L1** | 搜索命中 | 无 | "找到 N 个相关经验" |
| **L2** | 命中≥3次 + 脚本 + ≥60%成功率 | 需人工确认 | "建议执行脚本..." |
| **L3** | 成功率 ≥90% | **自动执行** | "已自动执行..." |

### 晋升流程

```
用户遇到问题 → 搜索匹配 → L1: 返回经验文本
       │
       │ 命中≥3次 + 创建脚本 + ≥60%成功率
       ▼
L2: 人工确认后执行脚本
       │
       │ 成功率≥90%
       ▼
L3: 自动执行，无需干预
```

---

## 执行日志 | Execution Logs

### 查看实时日志

```bash
# 实时查看插件日志
tail -f ~/.openclaw/logs/gateway.log | grep "rocky-auto-skill"

# 仅查看执行结果
tail -f ~/.openclaw/logs/gateway.log | grep "execResult"
```

### 日志示例

```
[DEBUG] refreshCache: rebuilding
[DEBUG] cache.l3Skills: 3 ['015/端口占用', '016/磁盘满', '017/npm超时']
[INFO] searchCards: found 2 matches for "端口占用"
[INFO] matchL3Skills: matched L3 skill 015 (rate: 100%)
[INFO] autoExecuteScript: executing 015.sh
[INFO] execResult: port 80 released, PID 1234 killed
```

---

## 配置文件 | Configuration

插件无需配置文件，所有配置通过环境变量或代码内默认值实现。

### 相关环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OPENCLAW_STATE_DIR` | `~/.openclaw` | OpenClaw 状态目录 |
| `AUTO_SKILL_CACHE_TTL` | `300000` | 缓存 TTL（毫秒）|
| `AUTO_SKILL_EXEC_TIMEOUT` | `30000` | 脚本执行超时（毫秒）|

---

## 下一步 | Next Steps

- 阅读 [架构说明](./Architecture.md) 了解系统内部设计
- 阅读 [常见问题](./FAQ.md) 解决使用中的问题
