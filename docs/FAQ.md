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

### Q: 如何查看所有L3技能？

```bash
grep "level: L3" ~/.openclaw/.auto-skill/cards/*.yaml
```

### Q: 如何手动触发技能？

```bash
# 直接执行脚本
bash ~/.openclaw/.auto-skill/skills/013-.sh
```

### Q: 回滚失败怎么办？

1. 检查备份文件：`ls ~/.openclaw/.auto-skill/skills/013*.sh.v*`
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

支持。需要配置 LM Studio 或类似向量服务。

### Q: 最多支持多少个技能？

无限制。

### Q: 版本可以保留多久？

默认保留2个版本。降级规则：
- L3：180天无执行 → 删除
- L2：30天无执行 → L1

---

## 与Hermes对比

### Q: 和Hermes Agent有什么区别？

| 功能 | Hermes | rocky-auto-skill |
|------|--------|------------------|
| 备份 | 内存1份 | 文件2份 |
| 回滚 | 仅安全失败 | 用户主动 |
| 技能等级 | 无 | L1/L2/L3 |
| 自动晋升 | 无 | 有 |
| 安全扫描 | 有 | 无 |

详细对比见 [Home.md](./Home.md)

---

[返回首页](./Home.md)
