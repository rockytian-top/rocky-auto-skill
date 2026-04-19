# 常见问题 | FAQ

## 安装问题

### Q: 插件不生效怎么办？

```bash
# 1. 检查插件是否加载
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log

# 2. 检查数据目录
ls ~/.openclaw/.auto-skill/

# 3. 重启网关
openclaw gateway restart
```

### Q: 数据目录在哪里？

默认在 `${OPENCLAW_STATE_DIR}/.auto-skill/`

---

## 使用问题

### Q: 如何查看所有技能？

```bash
ls ~/.openclaw/.auto-skill/cards/
```

### Q: 如何手动触发技能？

```bash
# 直接执行脚本
bash ~/.openclaw/.auto-skill/skills/013-memory.sh
```

### Q: 回滚失败怎么办？

1. 检查备份文件：`ls ~/.openclaw/.auto-skill/skills/*/*.sh.v*`
2. 检查日志：`cat ~/.openclaw/.auto-skill/logs/improvements.jsonl`

### Q: 如何删除一个技能？

手动删除对应卡片和脚本：
```bash
rm ~/.openclaw/.auto-skill/cards/013*.yaml
rm ~/.openclaw/.auto-skill/skills/013*.sh*
```

---

## 技术问题

### Q: 支持向量搜索吗？

支持。BM25 + 向量语义混合搜索。

### Q: 最多支持多少个技能？

无限制。

### Q: 版本可以保留多久？

默认保留2个版本。长期不用的技能会被沉寂扫描自动清理。

---

## 与Hermes对比

### Q: 和Hermes Agent有什么区别？

| 功能 | Hermes | rocky-auto-skill |
|------|--------|------------------|
| 技能存储 | SKILL.md | .sh 脚本 + YAML |
| 版本控制 | ❌ | ✅ 最多2个版本 |
| 用户回滚 | ❌ | ✅ 自然语言触发 |
| 模型决策 | ✅ | ✅ |
| 上下文理解 | ✅ | ✅ |
| 衰减机制 | ❌ | ✅ |

详细对比见 [Home.md](./Home.md)

---

[返回首页](./Home.md)
