# 架构说明 | Architecture

---

## 系统架构 | System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     用户交互层                               │
│                User Interaction Layer                        │
│         (飞书 / Discord / 终端 / Web)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  OpenClaw Gateway                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              rocky-auto-skill Plugin                   │  │
│  │                  (index.js)                            │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │           before_agent_start Hook                │  │  │
│  │  │                                                 │  │  │
│  │  │  1. extractLastError()   ── 提取错误信息        │  │  │
│  │  │  2. extractUserMessage() ── 提取用户消息        │  │  │
│  │  │  3. refreshCache()      ── 刷新技能缓存         │  │  │
│  │  │  4. searchCards()       ── 搜索经验卡片         │  │  │
│  │  │  5. matchL3Skills()     ── 匹配 L3 技能        │  │  │
│  │  │  6. autoExecuteScript() ── 自动执行脚本        │  │  │
│  │  │  7. injectContext()     ── 注入结果到上下文     │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    数据存储层                                 │
│                 Data Storage Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   cards/     │  │   skills/    │  │    logs/     │     │
│  │  经验卡片     │  │   脚本文件    │  │   执行日志    │     │
│  │  (YAML)      │  │   (.sh)      │  │             │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                                                              │
│              ~/.openclaw/.auto-skill/                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心模块 | Core Modules

### 1. 插件入口 (index.js)

插件通过 OpenClaw 的 Hook 机制注入，在 `before_agent_start` 阶段执行所有自动化逻辑。

```javascript
// 伪代码
function before_agent_start(context) {
  const error = extractLastError(context);
  const userMsg = extractUserMessage(context);
  const searchQuery = error || userMsg;

  refreshCache();
  const cards = searchCards(searchQuery);
  const matchedSkills = matchL3Skills(cards);

  for (const skill of matchedSkills) {
    if (skill.rate >= 90) {
      const result = autoExecuteScript(skill.script);
      injectContext(context, result);
    }
  }
}
```

### 2. 混合搜索引擎 (autoskill-search.py)

支持 BM25 + 向量混合搜索，提供精确的相似度匹配：

```python
# 搜索流程
1. BM25 关键词匹配 → 粗筛候选集
2. 向量相似度计算 → 精排 Top-K
3. 融合排序 → 返回最终结果
```

### 3. Shell 包装器 (autoskill-search)

提供命令行友好接口，内部调用 Python 搜索引擎：

```bash
./autoskill-search "端口占用"
# 解析参数 → 调用 autoskill-search.py → 格式化输出
```

---

## 数据流 | Data Flow

### 搜索匹配流程

```
用户消息 / 错误信息
       │
       ▼
  关键词提取
       │
       ├──→ BM25 粗排 ──→ 候选集
       │                     │
       │                     ▼
       └──→ 向量嵌入 ──→ 相似度计算
                           │
                           ▼
                     融合排序
                           │
                           ▼
                    返回 Top-K 结果
```

### 自动执行流程

```
检测到 L3 技能
       │
       ▼
 检查缓存（60秒去重）
       │
  ┌────┴────┐
  │  命中   │──→ 返回缓存结果
  └────┬────┘
       │ 未命中
       ▼
 执行脚本（30秒超时）
       │
  ┌────┴────┐
  │  成功   │──→ 更新 stats.exec_success
  └────┬────┘
       │ 失败
       ▼
 更新 stats.exec_fail
       │
       ▼
  检查晋升条件
       │
  ┌────┴────┐
  │ L2→L3   │──→ 自动晋升
  └────┬────┘
       │ 未达到
       ▼
  保持当前等级
```

---

## 数据存储设计 | Data Storage

### 经验卡片 (cards/)

```yaml
# 文件: cards/{id}.yaml
id: string          # 唯一标识 (如 "015")
title: string       # 经验标题
level: L1|L2|L3     # 当前等级
problem: string     # 问题描述
solution: string    # 解决方案
tool: string        # 使用的工具
skill_script: string # 关联脚本文件名
embedding: float[]  # 向量嵌入 (自动生成)
created_at: string  # 创建时间
updated_at: string  # 更新时间
stats:
  exec_count: int   # 执行次数
  exec_success: int # 成功次数
  exec_fail: int    # 失败次数
  hit_count: int    # 命中次数
  rate: float       # 成功率 (%)
  last_used: string # 最后使用时间
```

### 脚本文件 (skills/)

脚本命名规则：`{card_id}.sh`

示例 `015.sh`:
```bash
#!/bin/bash
# 端口占用处理脚本
PORT=${1:-80}
PID=$(lsof -ti:$PORT)
if [ -n "$PID" ]; then
  kill -9 $PID
  echo "端口 $PORT 已释放 (PID: $PID)"
else
  echo "端口 $PORT 当前空闲"
fi
```

---

## 缓存机制 | Caching

### L3 技能缓存

- **TTL**: 5 分钟
- **内容**: 所有 L3 技能列表 + 模板脚本列表
- **刷新**: 缓存过期或检测到新的卡片刻

### 执行结果缓存

- **TTL**: 60 秒
- **Key**: `scriptPath`
- **用途**: 避免同一脚本在短时间内重复执行

---

## 安全设计 | Security

| 机制 | 实现 |
|------|------|
| **路径限制** | 脚本必须位于 `~/.openclaw/.auto-skill/skills/` |
| **超时保护** | 执行超时 30 秒自动终止 |
| **去重机制** | 60 秒内同一脚本不重复执行 |
| **成功率门槛** | 低于 90% 不自动执行 |
| **模板跳过** | 自动跳过含 `auto-generated` 标记的模板 |

---

## 扩展性设计 | Extensibility

### 添加新的搜索模式

在 `index.js` 中扩展 `extractLastError()` 和 `extractUserMessage()`：

```javascript
function extractLastError(context) {
  // 支持更多错误格式
  const patterns = [
    /\[error\]\s*(.+)/i,
    /Error:\s*(.+)/i,
    /ERROR\s+(.+)/i,
  ];
  // ...
}
```

### 添加新的技能等级

在 `stats` 中添加新的等级判断逻辑：

```javascript
// L4: 跨技能组合
if (stats.combo_count >= 10 && stats.rate >= 95) {
  level = 'L4';
}
```

---

## 设计原则 | Design Principles

1. **最小干预**: 插件静默运行，不打扰正常对话
2. **渐进信任**: L1 → L3 逐步提升自动化程度
3. **可观测性**: 所有操作都有日志记录
4. **本地优先**: 数据存储在本地，不依赖云端
5. **无配置**: 零配置开箱即用
