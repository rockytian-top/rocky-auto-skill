# 常见问题 | FAQ

---

## 安装问题 | Installation Issues

### Q: 插件未加载？

```bash
# 1. 检查目录是否正确
ls ~/.openclaw/extensions/rocky-auto-skill/
# 应显示: index.js, openclaw.plugin.json, scripts/, docs/

# 2. 检查网关日志
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log | tail -10

# 3. 检查网关状态
openclaw gateway status

# 4. 重启网关
openclaw gateway restart
```

### Q: 数据目录未创建？

插件首次加载时自动创建。如果未创建：

```bash
mkdir -p ~/.openclaw/.auto-skill/{cards,skills,logs}
```

### Q: Python 报错？

```bash
# 检查 Python 版本
python3 --version  # 需要 ≥ 3.8

# 手动测试搜索脚本
python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "测试"
```

---

## 功能问题 | Feature Issues

### Q: 搜索不返回结果？

可能原因和解决方案：

1. **经验库为空** — 需要先记录一些经验
   ```bash
   bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list
   ```

2. **关键词不匹配** — 尝试不同的搜索词
   ```bash
   python3 ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-search.py "端口" --top 5
   ```

3. **向量搜索不可用** — 检查 LM Studio
   ```bash
   curl http://localhost:1234/v1/models
   ```
   > 无 LM Studio 时自动降级为纯 BM25 搜索

### Q: L3 脚本不自动执行？

检查清单：

```bash
# 1. 确认有 L3 技能
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list --level L3

# 2. 检查成功率（需要 ≥ 90%）
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-stats

# 3. 确认脚本文件存在
ls ~/.openclaw/.auto-skill/skills/

# 4. 手动测试脚本
bash ~/.openclaw/.auto-skill/skills/001-xxx.sh

# 5. 查看执行日志
cat ~/.openclaw/.auto-skill/logs/executions.log
```

**注意：** 首次执行的脚本（exec_count=0）也会自动执行。

### Q: 自动晋升不生效？

```bash
# 检查卡片命中次数
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-list

# L1 → L2 需要 hit ≥ 3
# L2 → L3 需要 hit ≥ 5 + 脚本文件存在

# 检查是否有脚本
ls ~/.openclaw/.auto-skill/skills/

# 手动晋升
bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-promote <id> --up
```

### Q: 经验卡片没有自动创建？

- 用户消息需要 ≥ 3 个中文字符才会触发
- 检查是否已有类似问题的卡片（会去重）
- 查看日志：
  ```bash
  grep "auto-created card" ~/.openclaw/logs/gateway.log | tail -5
  ```

---

## 性能问题 | Performance Issues

### Q: 插件影响响应速度？

插件在 `before_agent_start` Hook 中同步执行，但：
- L3 技能列表缓存 5 分钟
- 脚本执行结果缓存 60 秒
- 搜索超时 15 秒
- 脚本执行超时 30 秒
- 模型分析为异步执行（不阻塞）

### Q: 向量搜索很慢？

向量搜索需要 LM Studio 加载 Embedding 模型。如果 LM Studio 未运行或模型未加载：
- 自动降级为纯 BM25 关键词搜索
- 不影响基本功能

### Q: 缓存太多内存？

缓存数据量很小：
- L3 技能列表：通常 < 100 条
- 执行结果：60 秒自动过期

---

## 数据问题 | Data Issues

### Q: 如何备份经验数据？

```bash
# 备份整个数据目录
cp -r ~/.openclaw/.auto-skill/ ~/auto-skill-backup/

# 或只备份卡片
cp -r ~/.openclaw/.auto-skill/cards/ ~/cards-backup/
```

### Q: 如何清空经验库？

```bash
# 删除所有数据
rm -rf ~/.openclaw/.auto-skill/cards/*
rm -rf ~/.openclaw/.auto-skill/skills/*
rm -rf ~/.openclaw/.auto-skill/logs/*
rm -rf ~/.openclaw/.auto-skill/workflows/*
```

### Q: 如何迁移到新机器？

```bash
# 旧机器打包
tar czf auto-skill.tar.gz -C ~/.openclaw .auto-skill

# 新机器解压
tar xzf auto-skill.tar.gz -C ~/.openclaw/
```

### Q: 衰减扫描误删了有用的技能？

手动恢复：
```bash
# 查看衰减日志
cat ~/.openclaw/.auto-skill/logs/decay.log

# 被删除的卡片无法自动恢复，建议定期备份
```

---

## 安全问题 | Security Issues

### Q: 自动执行脚本安全吗？

安全机制：
- ✅ 只执行 `.auto-skill/skills/` 目录下的脚本
- ✅ 脚本执行 30 秒超时自动终止
- ✅ 成功率 < 90% 的技能不自动执行
- ✅ 60 秒内同一脚本不重复执行

### Q: 可以禁用自动执行吗？

目前不能单独禁用。可以：
- 将不需要自动执行的技能降级为 L2 或 L1
  ```bash
  bash ~/.openclaw/extensions/rocky-auto-skill/scripts/autoskill-promote <id> --down
  ```

### Q: 模型分析会发送什么数据？

模型分析发送：
- 对话历史（每条最多 300 字符）
- 技能使用统计
- 目标系统类型（macOS/Linux）

**不会发送：** 密码、密钥、完整代码等敏感信息。

---

## 其他问题 | Other Issues

### Q: 支持哪些操作系统？

| 系统 | 状态 | 说明 |
|------|------|------|
| **macOS** | ✅ 完整支持 | 自动适配 macOS 命令 |
| **Linux** | ✅ 完整支持 | 自动适配 Linux 命令 |
| **Windows** | ❌ 不支持 | Bash 脚本不兼容 |

### Q: 支持多 OpenClaw 实例吗？

支持。通过 `OPENCLAW_STATE_DIR` 环境变量区分不同实例的数据目录。

### Q: 能和其他插件共存吗？

可以。插件通过 `before_agent_start` Hook 工作，不修改 OpenClaw 核心逻辑。

---

## 还没找到答案？ | Still have questions?

- 查看 [架构说明](./Architecture.md) 了解内部工作原理
- 查看 [使用说明](./Usage.md) 了解完整功能
- 提交 Issue: [GitHub](https://github.com/rockytian-top/rocky-auto-skill/issues) | [Gitee](https://gitee.com/rocky_tian/rocky-auto-skill/issues)
