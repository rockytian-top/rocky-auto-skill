# 架构说明 | Architecture

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              rocky-auto-skill Plugin                 │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │            before_agent_start Hook              │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │ 1. refreshCache() - 刷新缓存             │  │  │  │
│  │  │  │ 2. extractLastError() - 错误检测         │  │  │  │
│  │  │  │ 3. autoskill-search - 经验搜索           │  │  │  │
│  │  │  │ 4. L3 match check - L3技能匹配           │  │  │  │
│  │  │  │ 5. autoExecuteScript() - 脚本执行       │  │  │  │
│  │  │  │ 6. prependContext - 结果注入             │  │  │  │
│  │  │  │ 7. detectContextModification - 改进检测  │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Directory                            │
│  ${OPENCLAW_STATE_DIR}/.auto-skill/                        │
│  ├── cards/              # 经验卡片 (YAML)                  │
│  ├── skills/             # L3脚本 (.sh)                     │
│  ├── scripts/            # 工具脚本                         │
│  │   ├── autoskill-search.py                              │
│  │   ├── autoskill-record.sh                              │
│  │   ├── autoskill-list.sh                                │
│  │   ├── autoskill-hit.sh                                 │
│  │   ├── autoskill-enhance.py                             │
│  │   └── autoskill-promo.py                               │
│  └── logs/               # 改进日志                         │
│      └── improvements.jsonl                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心模块

### 1. 经验卡片 (cards/)

```yaml
id: 013
title: "服务器内存查看"
level: L3          # L1/L2/L3
hit_count: 10      # 被搜索次数
exec_count: 5      # 执行次数
success_count: 5   # 成功次数
success_rate: 100   # 成功率
status: active     # active/inactive
```

### 2. L3脚本 (skills/)

```bash
#!/bin/bash
# 查看服务器内存
free -h
```

### 3. 版本备份

```
skills/013/
├── script.sh           # 当前版本
├── script.sh.v1        # 版本1
├── script.sh.v2        # 版本2
└── script.sh.versions.json
```

---

## 数据流

```
用户消息
    │
    ▼
before_agent_start 钩子
    │
    ├─► 错误检测 ─► 搜索经验 ─► 注入上下文
    │
    ├─► L3匹配 ─► 自动执行 ─► 结果注入
    │
    └─► 改进检测 ─► 备份 ─► 修改 ─► 记录
```

---

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| 2.10.1 | 2026-04-19 | 最多2个版本，强化提示词 |
| 2.10.0 | 2026-04-19 | 版本备份+回滚+改进日志 |
| 2.9.1 | 2026-04-19 | 完整中英文文档 |
| 2.9.0 | 2026-04-18 | 初始版本 |

---

[返回首页](./Home.md)
