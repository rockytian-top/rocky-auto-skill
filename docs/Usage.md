# 使用说明 | Usage Guide

## 自动触发 | Auto Trigger

插件在 `before_agent_start` 钩子自动运行，无需手动干预：

| 场景 | 自动行为 |
|------|----------|
| 用户提问 | 搜索经验库 |
| 匹配L3技能 | 自动执行脚本 |
| 脚本失败 | 记录失败日志 |
| 成功率达标 | 自动晋升L3 |

---

## 手动命令 | Manual Commands

### 搜索经验

```bash
python3 ~/.openclaw/.auto-skill/scripts/autoskill-search.py "关键词"
python3 ~/.openclaw/.auto-skill/scripts/autoskill-search.py "端口占用" --top 5
```

### 记录经验

```bash
bash ~/.openclaw/.auto-skill/scripts/autoskill-record.sh \
  --title "SSH连接超时" \
  --tool "ssh" \
  --problem "服务器连接超时" \
  --solution "检查网络和防火墙"
```

### 查看列表

```bash
bash ~/.openclaw/.auto-skill/scripts/autoskill-list.sh
```

### 标记有用

```bash
bash ~/.openclaw/.auto-skill/scripts/autoskill-hit.sh 013
```

### 查看单个卡片

```bash
bash ~/.openclaw/.auto-skill/scripts/autoskill-list.sh 013
```

---

## 自然语言操作 | Natural Language

| 操作 | 示例 |
|------|------|
| 搜索经验 | "帮我搜一下端口占用的解决方法" |
| 记录经验 | "把这个解决方法记下来" |
| 回滚 | "回到上一个版本" / "撤销" |
| 标记有用 | "这个有用" |

---

## 查看日志 | View Logs

```bash
# 查看改进日志
cat ~/.openclaw/.auto-skill/logs/improvements.jsonl

# 查看网关日志
tail -f ~/.openclaw/logs/gateway.log | grep rocky-auto-skill
```

---

## 版本备份 | Version Backup

备份自动创建在：
```
~/.openclaw/.auto-skill/skills/013/.sh.v1
~/.openclaw/.auto-skill/skills/013/.sh.v2
```

---

[返回首页](./Home.md)
