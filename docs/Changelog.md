# 更新日志 | Changelog

All notable changes to this project will be documented in this file.

---

## [2.10.1] - 2026-04-19

### Changed
- 最多保留2个版本备份（从5个减少）
- 强化技能改进提示词，学习Hermes主动性

### Fixed
- 回滚时跳过 contextModify 检测，避免Python调用失败

---

## [2.10.0] - 2026-04-19

### Added
- **版本备份机制**：脚本修改前自动备份，最多2个版本
- **回滚机制**：用户可说"回到上一个版本"回滚
- **改进日志**：记录到 `logs/improvements.jsonl`
- **Agent主动改进提示词**：学习Hermes SKILLS_GUIDANCE

### Changed
- `prependSystemContext` 新增技能改进指南

---

## [2.9.1] - 2026-04-19

### Added
- 完整中英文文档（README.md）
- docs/ 目录（Wiki格式）
- Home.md, Installation.md, Usage.md, Architecture.md, FAQ.md

---

## [2.9.0] - 2026-04-18

### Added
- 完整脚本内置到 `scripts/` 目录
- 路径独立化（插件自身优先）
- 完整中英文文档

---

## [2.0.0] - 2026-03-22

### Added
- L1/L2/L3 技能等级机制
- 自动晋升规则
- BM25 + 向量搜索
- 衰减机制

---

## [1.0.0] - 2026-03-09

### Added
- 初始版本
- 基础经验搜索
- 脚本执行

---

[返回首页](./Home.md)
