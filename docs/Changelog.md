# 更新日志 | Changelog

All notable changes to this project will be documented in this file.

---

## [v2.9.1] - 2026-04-19

### 新增 | Added
- **完整脚本内置**: 11 个命令行工具全部内置到 `scripts/` 目录，用户下载即可用
- **插件路径优先**: `getScriptsDir()` 和 `autoInstall()` 优先查找插件自身 `scripts/` 目录
- **完整中英文文档**: README.md 重写，6 个 Wiki 页面全部中英文双语

### 修复 | Fixed
- 其他用户下载后缺少脚本文件的问题
- 符号链接指向本机绝对路径导致跨机器不可用的问题

---

## [v2.9.0] - 2026-04-19

### 修复 | Fixed
- 路径独立化问题：在不同 OpenClaw 安装路径下的兼容性
- 共享技能目录复制逻辑改进

---

## [v2.7.0] - 2026-04-18

### 新增 | Added
- 完整中英文 README 文档
- 功能对比表
- docs/ Wiki 目录（6 个页面）

---

## [v2.6.0] - 2026-04-17

### 新增 | Added
- BM25 + 向量混合搜索引擎（autoskill-search.py）
- Shell 搜索包装器（autoskill-search）

---

## [v2.5.0] - 2026-04-16

### 新增 | Added
- 自动晋升机制（L1 → L2 → L3）
- 成功率追踪

### 修复 | Fixed
- 缓存 TTL 计算错误

---

## [v2.4.0] - 2026-04-15

### 新增 | Added
- L3 自动执行（成功率 ≥ 90%）
- 执行结果注入 AI 上下文
- autoskill-log 执行日志记录

---

## [v2.3.0] - 2026-04-14

### 新增 | Added
- L2 确认执行
- hit 计数

### 修复 | Fixed
- 多并发场景缓存竞态问题

---

## [v2.2.0] - 2026-04-13

### 新增 | Added
- 错误检测（自动从 AI 响应提取错误）
- 经验卡片 YAML 格式

---

## [v2.1.0] - 2026-04-12

### 新增 | Added
- 自动安装（首次加载创建数据目录）
- 5 分钟 L3 技能缓存
- 模板脚本发现

---

## [v2.0.0] - 2026-04-11

### 重构 | Major Changes
- 从 rocky-skill 重命名为 rocky-auto-skill
- OpenClaw 插件化改造
- 接入 `before_agent_start` Hook

---

## [v1.x] - 2026-04-05 ~ 2026-04-10

早期独立脚本版本（非插件形式）。

| 版本 | 说明 |
|------|------|
| v1.5 | 执行日志功能 |
| v1.4 | 经验卡片搜索 |
| v1.3 | autoskill-record 脚本 |
| v1.2 | YAML 格式卡片 |
| v1.1 | 基础统计 |
| v1.0 | 初始版本 |

---

## 版本规范 | Versioning

使用 [语义化版本](https://semver.org/lang/zh-CN/)：

```
主版本.次版本.修订号
MAJOR.MINOR.PATCH
```

---

## 发布计划 | Roadmap

- [ ] v3.0: 多技能组合执行（L4）
- [ ] v3.1: Web 管理界面
- [ ] v3.2: 远程经验同步
- [ ] v3.3: 技能评分系统
