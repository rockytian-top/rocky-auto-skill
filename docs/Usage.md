# 使用说明 | Usage

## 自动触发 | Auto Trigger

插件在 `before_agent_start` Hook 自动运行，无需手动干预。

| 场景 | 自动行为 |
|------|----------|
| 用户遇到问题 | 自动搜索经验库 |
| 匹配到技能 | 模型判断是否执行 |
| 执行完成 | 模型判断是否改进 |
| 用户有反馈 | 模型理解意图并响应 |

---

## 手动命令 | Manual Commands

### 搜索经验

```bash
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "关键词"
```

### 记录经验

```bash
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-record.sh \
  --title "标题" --tool "工具" --problem "问题" --solution "方案"
```

### 查看列表

```bash
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list.sh
```

### 标记有用

```bash
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-hit.sh 013
```

---

## 自然语言交互 | Natural Language

| 你说 | 插件自动 |
|------|----------|
| "帮我记录一个经验：..." | 创建经验卡片 |
| "查看经验统计" | 显示统计面板 |
| "列出所有经验" | 列出所有卡片 |
| "搜索 XXX" | 搜索相关经验 |
| "这个有用" / "hit" | 标记经验有用 |
| "回到上一个版本" | 回滚脚本 |
| "撤销" / "回滚" | 回滚脚本 |

---

## 验证方法 | Verification

### 检查插件是否加载

```bash
grep rocky-auto-skill ~/.openclaw/logs/gateway.log
```

### 查看经验卡片

```bash
ls ~/.openclaw/.auto-skill/cards/
```

### 查看技能脚本

```bash
ls ~/.openclaw/.auto-skill/skills/
```

### 查看备份文件

```bash
ls -la ~/.openclaw/.auto-skill/skills/*/*.sh.v*
```

### 查看改进日志

```bash
cat ~/.openclaw/.auto-skill/logs/improvements.jsonl
```
