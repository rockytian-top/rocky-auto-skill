# 常见问题 | FAQ

---

## 安装问题 | Installation Issues

### Q: 插件未加载，如何排查？

**A:** 按以下步骤排查：

```bash
# 1. 检查插件是否在扩展目录
ls -la ~/.openclaw/extensions/rocky-auto-skill/

# 2. 检查网关日志
grep "rocky-auto-skill" ~/.openclaw/logs/gateway.log

# 3. 重启网关
openclaw gateway restart

# 4. 再次检查日志
tail -50 ~/.openclaw/logs/gateway.log | grep "rocky-auto-skill"
```

### Q: 数据目录未自动创建怎么办？

**A:** 可以手动创建：

```bash
mkdir -p ~/.openclaw/.auto-skill/{cards,skills,logs}

# 给脚本目录添加执行权限
chmod +x ~/.openclaw/.auto-skill/skills/*.sh
```

### Q: 权限不足如何解决？

**A:** 确保文件和目录有正确的权限：

```bash
# 插件目录
chmod -R 755 ~/.openclaw/extensions/rocky-auto-skill/

# 数据目录
chmod -R 755 ~/.openclaw/.auto-skill/

# 脚本文件
chmod +x ~/.openclaw/extensions/rocky-auto-skill/autoskill-search
chmod +x ~/.openclaw/.auto-skill/skills/*.sh
```

---

## 使用问题 | Usage Issues

### Q: 为什么自动执行没有触发？

**A:** 检查以下条件：

| 条件 | 检查方法 |
|------|----------|
| 消息 ≥3 字符 | 用户输入的消息长度是否足够 |
| L3 技能存在 | `ls ~/.openclaw/.auto-skill/cards/` |
| 成功率 ≥90% | 查看卡片 `stats.rate` 字段 |
| 脚本文件存在 | `ls ~/.openclaw/.auto-skill/skills/` |

```bash
# 查看所有 L3 技能
grep -l "level: L3" ~/.openclaw/.auto-skill/cards/*.yaml

# 查看指定技能的成功率
grep "rate:" ~/.openclaw/.auto-skill/cards/015.yaml
```

### Q: 如何手动触发搜索？

```bash
python3 ~/.openclaw/extensions/rocky-auto-skill/autoskill-search.py "端口占用"
```

### Q: 经验没有自动晋升怎么办？

**A:** 晋升需要满足以下条件：

| 晋升 | 条件 |
|------|------|
| L1 → L2 | 命中 ≥3次 + 脚本模板 + ≥60% 成功率 |
| L2 → L3 | ≥90% 成功率 |

```bash
# 查看当前状态
cat ~/.openclaw/.auto-skill/cards/015.yaml | grep -E "(level|hit_count|rate)"

# 手动更新统计（模拟多次使用）
# 编辑 YAML 文件，手动增加 hit_count 和 exec_success
```

### Q: 脚本执行超时怎么办？

**A:** 默认超时 30 秒。如需调整，修改 `index.js` 中的 `EXEC_TIMEOUT`：

```javascript
const EXEC_TIMEOUT = 30000; // 30 秒
```

---

## 搜索问题 | Search Issues

### Q: 搜索结果不准确？

**A:** 尝试以下方法：

1. **添加更多经验卡片**: 提供更多相似问题的解决方案
2. **更新向量嵌入**: 删除旧卡片重新记录，系统会自动生成新嵌入
3. **使用更精确的关键词**: 避免模糊描述

```bash
# 删除旧卡片
rm ~/.openclaw/.auto-skill/cards/015.yaml

# 重新记录
bash ~/.openclaw/extensions/rocky-auto-skill/autoskill-record \
  --title "Nginx端口占用" \
  --tool "lsof, kill" \
  --problem "Nginx端口被占用" \
  --solution "lsof -i:80 && kill -9"
```

### Q: BM25 和向量搜索的区别？

| 搜索方式 | 适用场景 | 特点 |
|----------|----------|------|
| **BM25** | 关键词精确匹配 | 快速、精确 |
| **向量搜索** | 语义相似 | 理解同义词 |
| **混合搜索** | 两者结合 | 最准确 |

---

## 数据问题 | Data Issues

### Q: 如何备份数据？

```bash
# 备份整个数据目录
cp -r ~/.openclaw/.auto-skill ~/backup-auto-skill-$(date +%Y%m%d)

# 备份卡片
cp -r ~/.openclaw/.auto-skill/cards ~/backup-cards-$(date +%Y%m%d)
```

### Q: 如何迁移数据到新机器？

```bash
# 在旧机器上打包
tar -czvf auto-skill-backup.tar.gz ~/.openclaw/.auto-skill/

# 传输到新机器
scp auto-skill-backup.tar.gz new-server:~/

# 在新机器上解压
tar -xzvf auto-skill-backup.tar.gz -C ~/
```

### Q: 经验卡片损坏怎么办？

**A:** 检查 YAML 语法：

```bash
# 验证 YAML 语法
python3 -c "import yaml; yaml.safe_load(open('~/.openclaw/.auto-skill/cards/015.yaml'))"

# 修复常见问题
# 1. 确保缩进正确（2空格）
# 2. 确保字符串无未转义的特殊字符
# 3. 确保数字类型正确
```

---

## 性能问题 | Performance Issues

### Q: 插件响应变慢怎么办？

**A:** 尝试以下优化：

1. **清理旧日志**

```bash
# 查看日志大小
du -sh ~/.openclaw/logs/

# 清理超过 30 天的日志
find ~/.openclaw/logs/ -mtime +30 -delete
```

2. **重建缓存**

```bash
# 删除缓存文件
rm -rf ~/.openclaw/.auto-skill/.cache/

# 重启网关
openclaw gateway restart
```

3. **减少卡片数量**: 将长期不用的卡片移到归档目录

### Q: 如何查看性能指标？

```bash
# 查看执行统计
find ~/.openclaw/.auto-skill/cards/ -name "*.yaml" -exec grep -l "exec_count" {} \; | \
  xargs grep "exec_count" | sort -t: -k2 -n -r | head -10
```

---

## 安全问题 | Security Issues

### Q: 可以执行任意脚本吗？

**A:** 不可以。插件有严格的安全限制：

- 脚本必须位于 `~/.openclaw/.auto-skill/skills/` 目录
- 脚本执行超时 30 秒自动终止
- 60 秒内同一脚本不重复执行
- 低于 90% 成功率的脚本不自动执行

### Q: 如何审核脚本？

```bash
# 查看所有脚本列表
ls -la ~/.openclaw/.auto-skill/skills/

# 查看脚本内容
cat ~/.openclaw/.auto-skill/skills/015.sh

# 移除可疑脚本
rm ~/.openclaw/.auto-skill/skills/suspicious.sh
```

---

## 其他问题 | Other Issues

### Q: 如何联系开发者？

**A:** 欢迎提交 Issue 或 Pull Request：

- GitHub: https://github.com/rockytian-top/rocky-auto-skill
- Gitee: https://gitee.com/rocky_tian/rocky-auto-skill

### Q: 如何参与贡献？

**A:** 贡献方式：

1. **报告 Bug**: 提交 Issue 并附上日志
2. **改进文档**: 完善文档或添加翻译
3. **代码贡献**: 提交 PR，请先 fork 并创建 feature 分支

```bash
# 1. Fork 仓库
# 2. 克隆你的 fork
git clone https://github.com/YOUR_USERNAME/rocky-auto-skill.git

# 3. 创建功能分支
git checkout -b feature/new-feature

# 4. 修改代码
# ... edit files ...

# 5. 提交并推送
git commit -m "feat: add new feature"
git push origin feature/new-feature

# 6. 在 GitHub 上创建 Pull Request
```

---

## 调试技巧 | Debug Tips

### 启用详细日志

在 `index.js` 中查找 `console.log` 并确保日志级别为 DEBUG：

```javascript
// 在 before_agent_start 中添加
console.log('[DEBUG] searchCards:', cards);
console.log('[DEBUG] matchedSkills:', matchedSkills);
```

### 测试搜索脚本

```bash
# 直接运行 Python 搜索引擎
cd ~/.openclaw/extensions/rocky-auto-skill/
python3 autoskill-search.py "端口占用" --verbose
```
