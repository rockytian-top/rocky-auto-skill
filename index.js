/**
 * rocky-auto-skill Plugin v2.10.1
 *
 * 全自动闭环经验系统：
 * 1. 自动检测错误 + 用户问题关键词
 * 2. 自动搜索经验库（L3技能）
 * 3. 自动执行 L3 脚本（成功率≥90%时）
 * 4. 自动注入执行结果到 context
 * 5. 自动 hit 计数（脚本成功时）
 * 6. 自动告知 agent 执行结果
 * 7. 模型判断生成/优化/删除技能
 * 8. 每日沉寂扫描，自动清理长期不用的技能
 */

const { execSync } = require('child_process');
const { existsSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync, copyFileSync, unlinkSync } = require('fs');
const { join } = require('path');

// ==================== 脚本版本备份 ====================
const MAX_BACKUP_VERSIONS = 5;

/**
 * 备份当前脚本版本
 * @param {string} scriptPath - 脚本完整路径
 * @returns {boolean} - 是否成功
 */
function backupScript(scriptPath) {
  try {
    if (!existsSync(scriptPath)) return false;
    
    const stats = statSync(scriptPath);
    const mtime = stats.mtime.toISOString().slice(0, 10);
    
    // 获取现有版本信息
    const metaPath = scriptPath + '.versions.json';
    let versions = [];
    if (existsSync(metaPath)) {
      try {
        versions = JSON.parse(readFileSync(metaPath, 'utf-8'));
      } catch(e) { versions = []; }
    }
    
    // 添加当前版本记录（如果内容有变化）
    const currentContent = readFileSync(scriptPath, 'utf-8');
    const lastVersion = versions[0];
    if (!lastVersion || lastVersion.content !== currentContent) {
      versions.unshift({
        version: (versions.length + 1),
        date: mtime,
        content: currentContent,
        size: currentContent.length
      });
    }
    
    // 只保留最近MAX_BACKUP_VERSIONS个版本
    versions = versions.slice(0, MAX_BACKUP_VERSIONS);
    
    // 保存版本元数据
    const metaToSave = versions.map(v => ({ version: v.version, date: v.date, size: v.size }));
    writeFileSync(metaPath, JSON.stringify(metaToSave, null, 2), 'utf-8');
    
    // 备份文件：v1, v2, v3, v4, v5
    for (let i = 0; i < versions.length; i++) {
      const backupPath = scriptPath + '.v' + (i + 1);
      if (!existsSync(backupPath) || readFileSync(backupPath, 'utf-8') !== versions[i].content) {
        writeFileSync(backupPath, versions[i].content, 'utf-8');
      }
    }
    
    // 删除多余的备份文件
    for (let i = versions.length + 1; i <= MAX_BACKUP_VERSIONS; i++) {
      const backupPath = scriptPath + '.v' + i;
      if (existsSync(backupPath)) {
        try { unlinkSync(backupPath); } catch(e) {}
      }
    }
    
    console.log('[DEBUG] backupScript: backed up', scriptPath, 'versions:', versions.length);
    return true;
  } catch(e) {
    console.log('[DEBUG] backupScript error:', e.message);
    return false;
  }
}

/**
 * 回滚到上一个版本
 * @param {string} scriptPath - 脚本完整路径
 * @returns {object} - {success, content, message}
 */
function rollbackScript(scriptPath) {
  try {
    const metaPath = scriptPath + '.versions.json';
    if (!existsSync(metaPath)) {
      return { success: false, message: '没有可用的备份版本' };
    }
    
    let versions = [];
    try {
      versions = JSON.parse(readFileSync(metaPath, 'utf-8'));
    } catch(e) {
      return { success: false, message: '备份元数据损坏' };
    }
    
    if (versions.length < 2) {
      return { success: false, message: '没有足够的备份版本可供回滚' };
    }
    
    // 使用倒数第二个版本（当前是第一个）
    const prevVersion = versions[1];
    const backupPath = scriptPath + '.v2';
    
    if (!existsSync(backupPath)) {
      return { success: false, message: '备份文件丢失' };
    }
    
    const prevContent = readFileSync(backupPath, 'utf-8');
    
    // 先备份当前版本
    backupScript(scriptPath);
    
    // 恢复为上一个版本
    writeFileSync(scriptPath, prevContent, 'utf-8');
    chmodSync(scriptPath, 0o755);
    
    // 更新元数据：移除最新版本（当前版本已变为上一个）
    const newVersions = versions.slice(1);
    const metaToSave = newVersions.map(v => ({ version: v.version, date: v.date, size: v.size }));
    writeFileSync(metaPath, JSON.stringify(metaToSave, null, 2), 'utf-8');
    
    return { success: true, content: prevContent, message: '已回滚到上一个版本', version: prevVersion.version };
  } catch(e) {
    console.log('[DEBUG] rollbackScript error:', e.message);
    return { success: false, message: '回滚失败: ' + e.message };
  }
}

/**
 * 记录技能改进日志
 * @param {string} cardId - 技能卡ID
 * @param {string} action - 动作类型
 * @param {object} details - 详情
 */
function logSkillImprovement(cardId, action, details) {
  try {
    const home = process.env.HOME || '/root';
    const stateDir = process.env.OPENCLAW_STATE_DIR || `${home}/.openclaw`;
    const dataDir = join(stateDir, '.auto-skill');
    const logDir = join(dataDir, 'logs');
    
    // 确保日志目录存在
    if (!existsSync(logDir)) {
      try { execSync('mkdir -p "' + logDir + '"'); } catch(e) {}
    }
    
    const logFile = join(logDir, 'improvements.jsonl');
    const timestamp = new Date().toISOString();
    const logEntry = JSON.stringify({ timestamp, cardId, action, ...details }) + '\n';
    
    // 追加到日志文件
    const existing = existsSync(logFile) ? readFileSync(logFile, 'utf-8') : '';
    writeFileSync(logFile, existing + logEntry, 'utf-8');
    
    console.log('[DEBUG] logSkillImprovement:', cardId, action);
  } catch(e) {
    console.log('[DEBUG] logSkillImprovement error:', e.message);
  }
}

// ==================== 自动安装 ====================
function autoInstall() {
  const home = process.env.HOME || '/root';
  const stateDir = process.env.OPENCLAW_STATE_DIR || (home + '/.openclaw');
  const dataDir = join(stateDir, '.auto-skill');
  const dirs = ['cards', 'skills', 'logs'];
  
  let installed = false;
  for (const d of dirs) {
    const path = join(dataDir, d);
    if (!existsSync(path)) {
      try {
        execSync('mkdir -p "' + path + '"');
        console.log('[DEBUG] autoInstall: created ' + path);
        installed = true;
      } catch(e) {}
    }
  }
  
  // 如果 skills 目录为空，从共享目录复制
  const scriptsDir = join(dataDir, 'skills');
  if (existsSync(scriptsDir)) {
    const files = execSync('ls "' + scriptsDir + '" 2>/dev/null || echo ""').toString().trim().split(/\n/).filter(f => f);
    if (files.length === 0) {
      const srcDirs = [
        join(__dirname, 'scripts'),  // 插件自带 scripts 目录（用户 clone 后即可用）
        join(stateDir, 'shared-skills', 'rocky-auto-skill', 'scripts'),
        join(stateDir, 'skills', 'rocky-auto-skill', 'scripts')
      ];
      for (const src of srcDirs) {
        if (existsSync(src)) {
          try {
            execSync('cp -r "' + src + '/." "' + scriptsDir + '/" 2>/dev/null || true');
            console.log('[DEBUG] autoInstall: copied scripts from ' + src);
            installed = true;
            break;
          } catch(e) {}
        }
      }
    }
  }
  
  if (installed) {
    console.log('[DEBUG] autoInstall: completed');
  }
}

// ==================== 缓存 ====================
let cache = { l3Skills: null, templates: null, ts: 0 };

// 执行结果缓存（避免同一错误重复执行脚本，1分钟内不重复执行）
const CACHE_TTL = 5 * 60 * 1000; // 5分钟
const EXEC_CACHE_TTL = 60 * 1000;
let execCache = new Map(); // key: scriptPath, value: {result, ts}

function isCacheValid() {
  return cache.ts > 0 && (Date.now() - cache.ts) < CACHE_TTL;
}

function refreshCache() {
  if (isCacheValid()) { console.log("[DEBUG] cache valid, skip"); return; }
  console.log("[DEBUG] refreshCache rebuilding");
  cache.l3Skills = getL3SkillsDirect();
  console.log("[DEBUG] cache.l3Skills:", cache.l3Skills.length, cache.l3Skills.map(s=>s.id+'/'+s.title));
  cache.templates = findTemplateScriptsDirect();
  cache.ts = Date.now();
}

function getCachedExec(scriptPath) {
  const entry = execCache.get(scriptPath);
  if (entry && (Date.now() - entry.ts) < EXEC_CACHE_TTL) {
    return entry.result;
  }
  return null;
}

function setCachedExec(scriptPath, result) {
  execCache.set(scriptPath, { result, ts: Date.now() });
}

// ==================== 模型决策函数 ====================
function askModelDecision(type, ctx) {
  const rules = {
    create_card: { decision: (ctx.userMsg||'').length>=10 && /[吗？么什怎如何为什么]|\?|how|what|why|can/i.test(ctx.userMsg||'') ? 'yes' : 'no', title: (ctx.userMsg||'').slice(0,30).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g,'') },
    promote_l2: { decision: (ctx.hit_count||0)>=2 ? 'yes' : 'no' },
    promote_l3: { decision: (ctx.exec_count||0)>=3 ? 'yes' : 'no' }
  };
  return rules[type] || { decision:'no' };
}

// ==================== 反馈处理函数 ====================
// 获取最近执行的 L3 技能
let lastExecutedSkill = null; // { cardId, scriptPath, title, currentScript, ts }

function setLastExecutedSkill(cardId, scriptPath, title, currentScript) {
  lastExecutedSkill = { cardId, scriptPath, title, currentScript, ts: Date.now() };
  console.log('[DEBUG] setLastExecutedSkill called:', cardId, title, 'expires in 5min');
}

function getRecentExecutedScript() {
  if (!lastExecutedSkill) return null;
  // 5分钟内有效
  if (Date.now() - lastExecutedSkill.ts > 5 * 60 * 1000) {
    lastExecutedSkill = null;
    return null;
  }
  return lastExecutedSkill;
}

// ==================== 上下文感知的脚本修改检测（Hermes式 - 模型驱动） ====================
function detectContextScriptModification(userMsg, messages, recentSkill) {
  if (!recentSkill) return null;

  const { cardId, scriptPath, title, currentScript } = recentSkill;

  // 检查是否在5分钟窗口内
  if (Date.now() - recentSkill.ts > 5 * 60 * 1000) {
    return null;
  }

  // 构建对话上下文
  const recentMessages = (messages || []).slice(-6);
  const contextText = recentMessages.map(m => {
    const role = m.role === 'user' ? '用户' : '助手';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${role}: ${content}`;
  }).join('\n');

  // 构建LLM prompt，让模型判断是否需要增强
  const prompt = `你是技能增强判断专家。

当前技能：${title}
当前脚本：
${currentScript}

最近对话：
${contextText}

用户最新消息：${userMsg}

判断：用户是否想要增强这个技能？（比如：添加功能、补充信息、改进输出等）

请仔细分析对话上下文，理解用户的真实意图。

如果用户确实想要增强技能，请提取他们想要什么增强内容（用一句话描述）。
如果用户不是要增强技能，请回答"不需要增强"。

回答格式：
- 如果需要增强："增强：<一句话描述用户想要的增强>"
- 如果不需要："不需要增强"`;

  try {
    const result = execSync(`python3 -c "
import requests
import json
resp = requests.post(
    'https://api.minimaxi.com/anthropic/v1/messages',
    headers={
        'Content-Type': 'application/json',
        'x-api-key': 'f0478a9dc1554fbe84b794e9528c6900.elAEl9DP520WLtaA',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
    },
    json={
        'model': 'MiniMax-M2.7',
        'max_tokens': 100,
        'messages': [{'role': 'user', 'content': ${JSON.stringify(prompt)}}]
    },
    timeout=15
)
data = resp.json()
content = data.get('content', [])
if content and len(content) > 0:
    print(content[0].get('text', ''))
else:
    print('ERROR')
" 2>&1`, { encoding: 'utf-8', timeout: 20000 });

    const trimmed = result.trim();
    console.log('[DEBUG] LLM enhancement check:', trimmed.slice(0, 100));

    if (trimmed === 'ERROR' || trimmed.includes('不需要增强') || trimmed.includes('不需要')) {
      return null;
    }

    // 提取增强内容
    let enhancement = trimmed;
    if (trimmed.includes('增强：')) {
      enhancement = trimmed.split('增强：')[1] || trimmed.split('增强:')[1] || '';
    }
    enhancement = enhancement.trim();

    if (!enhancement || enhancement.length < 2) {
      return null;
    }

    console.log('[DEBUG] LLM detected enhancement intent:', enhancement);
    return { cardId, scriptPath, title, currentScript, enhancement };

  } catch(e) {
    console.log('[DEBUG] detectContextScriptModification error:', e.message);
    return null;
  }
}

// ==================== 智能脚本增强（模型驱动） ====================
function applyScriptEnhancement(title, currentScript, enhancement) {
  // 提取shebang和注释
  const lines = currentScript.split('\n');
  const shebangLines = [];
  let bodyStartIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#!') || lines[i].startsWith('#')) {
      shebangLines.push(lines[i]);
      bodyStartIdx = i + 1;
    } else {
      break;
    }
  }
  const scriptBody = lines.slice(bodyStartIdx).join('\n').trim();

  // 提取问题描述
  const problemMatch = currentScript.match(/#\s*Problem:\s*(.+)/i);
  const problem = problemMatch ? problemMatch[1].trim() : (title || '未知问题');

  // 构建prompt让模型决定如何增强
  const prompt = `你是一个Linux shell脚本专家。

当前脚本：
${scriptBody}

用户想要增强："${enhancement}"

问题背景：${problem}

请生成增强后的完整shell脚本（保留shebang和注释，只修改脚本body）。
要求：
1. 在原脚本基础上智能增强，不要完全重写
2. 添加用户要求的增强功能
3. 用 && 或 || 连接多个命令
4. 只输出脚本内容，不要解释

输出格式：直接输出脚本内容`;

  try {
    const result = execSync(`python3 -c "
import requests
import json
resp = requests.post(
    'https://api.minimaxi.com/anthropic/v1/messages',
    headers={
        'Content-Type': 'application/json',
        'x-api-key': 'f0478a9dc1554fbe84b794e9528c6900.elAEl9DP520WLtaA',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
    },
    json={
        'model': 'MiniMax-M2.7',
        'max_tokens': 500,
        'messages': [{'role': 'user', 'content': ${JSON.stringify(prompt)}}]
    },
    timeout=15
)
data = resp.json()
content = data.get('content', [])
if content and len(content) > 0:
    print(content[0].get('text', ''))
else:
    print('ERROR')
" 2>&1`, { encoding: 'utf-8', timeout: 20000 });

    const trimmed = result.trim();
    if (trimmed === 'ERROR' || !trimmed) {
      console.log('[DEBUG] applyScriptEnhancement: LLM call failed');
      return currentScript;
    }

    // 重建完整脚本（保留shebang和注释）
    const newBody = trimmed.replace(/^#!/,'echo "skip" && #!').split('\n').filter(l => !l.match(/^echo "skip"/)).join('\n');
    const newScript = shebangLines.length > 0
      ? shebangLines.join('\n') + '\n' + newBody
      : newBody;

    console.log('[DEBUG] applyScriptEnhancement: LLM generated new script');
    return newScript;

  } catch(e) {
    console.log('[DEBUG] applyScriptEnhancement error:', e.message);
    return currentScript;
  }
}

// 根据反馈生成新脚本
function generateScriptFromFeedback(feedback, title, currentScript) {
  const titleLower = (title || '').toLowerCase();
  const feedbackLower = (feedback || '').toLowerCase();

  // 分析反馈内容
  const wantsMore = /还要|加|增加|多|包含|加上/.test(feedback);
  const wantsDifferent = /不对|不是|应该|不是这样|说错了/.test(feedback);
  const wantsReplace = /改成|改为|换成|重新|再来/.test(feedback);

  let newScript = currentScript;

  // 内存相关
  if (titleLower.includes('内存') || titleLower.includes('mem')) {
    if (wantsMore && (feedbackLower.includes('swap') || feedbackLower.includes('交换'))) {
      newScript = '#!/bin/bash\n# Auto-generated skill script\n# Problem: ' + title + '\nfree -h && echo "---" && swapon --show && echo "---" && ps aux --sort=-%mem | head -11';
    } else if (wantsMore && (feedbackLower.includes('详细') || feedbackLower.includes('更多'))) {
      newScript = '#!/bin/bash\n# Auto-generated skill script\n# Problem: ' + title + '\necho "=== 内存使用 ===" && free -h && echo "=== Swap 使用 ===" && swapon --show && echo "=== 进程排名 Top15 ===" && ps aux --sort=-%mem | head -16';
    } else if (wantsReplace || wantsDifferent) {
      newScript = '#!/bin/bash\n# Auto-generated skill script\n# Problem: ' + title + '\necho "free -h 显示内存，ps aux --sort=-%mem | head 显示进程"';
    }
  }
  // CPU相关
  else if (titleLower.includes('cpu') || titleLower.includes('处理器')) {
    if (wantsMore) {
      newScript = '#!/bin/bash\n# Auto-generated skill script\n# Problem: ' + title + '\necho "=== CPU 信息 ===" && lscpu && echo "=== CPU 使用 Top10 ===" && ps aux --sort=-%cpu | head -11';
    }
  }
  // 磁盘相关
  else if (titleLower.includes('disk') || titleLower.includes('磁盘') || titleLower.includes('硬盘')) {
    if (wantsMore) {
      newScript = '#!/bin/bash\n# Auto-generated skill script\n# Problem: ' + title + '\ndf -h && echo "---" && du -sh /* 2>/dev/null | sort -hr | head -10';
    }
  }
  // 进程相关
  else if (titleLower.includes('进程') || titleLower.includes('process')) {
    if (wantsMore) {
      newScript = '#!/bin/bash\n# Auto-generated skill script\n# Problem: ' + title + '\nps aux && echo "---" && pstree -p && echo "=== 资源使用 Top10 ===" && ps aux --sort=-%mem | head -11';
    }
  }

  // 如果没有变化，返回原脚本
  if (newScript === currentScript) {
    console.log('[DEBUG] generateScriptFromFeedback: no change needed');
    return currentScript;
  }

  return newScript;
}

// ==================== 自动分析执行结果并优化脚本 ====================
async function analyzeAndOptimizeScript(cardId, scriptPath, title, output) {
  try {
    // 检查输出是否为空或过短（可能不完整）
    if (!output || output.trim().length < 10) {
      console.log('[DEBUG] analyzeAndOptimize: output too short, skipping');
      return;
    }

    // 简单的启发式分析
    const titleLower = (title || '').toLowerCase();
    let needsMore = false;
    let suggestion = '';

    // 内存相关检查
    if (titleLower.includes('内存') || titleLower.includes('mem')) {
      if (!output.includes('Mem:') && !output.includes('内存')) {
        needsMore = true;
        suggestion = '添加 free -h 显示内存总量和使用情况';
      }
      if (!output.includes('Swap:') && !output.includes('swap') && !output.includes('交换')) {
        needsMore = true;
        suggestion = '添加 swap 使用情况显示';
      }
    }

    // CPU相关检查
    if (titleLower.includes('cpu') || titleLower.includes('处理器')) {
      if (!output.includes('CPU') && !output.includes('cpu')) {
        needsMore = true;
        suggestion = '添加 lscpu 显示 CPU 信息';
      }
    }

    // 进程相关检查
    if (titleLower.includes('进程') || titleLower.includes('process')) {
      if (!output.includes('PID') && !output.includes('USER')) {
        needsMore = true;
        suggestion = '添加完整的进程列表';
      }
    }

    if (!needsMore) {
      console.log('[DEBUG] analyzeAndOptimize: output looks good for', title);
      return;
    }

    console.log('[DEBUG] analyzeAndOptimize: suggesting improvement:', suggestion);

    // 根据建议生成优化后的脚本
    let newScript = '#!/bin/bash\n# Auto-generated skill script (optimized)\n# Problem: ' + title + '\n';

    if (titleLower.includes('内存') || titleLower.includes('mem')) {
      newScript += 'echo "=== 内存使用情况 ===" && free -h && echo "=== Swap 使用情况 ===" && swapon --show && echo "=== 进程内存使用 Top15 ===" && ps aux --sort=-%mem | head -16';
    } else if (titleLower.includes('cpu') || titleLower.includes('处理器')) {
      newScript += 'echo "=== CPU 信息 ===" && lscpu && echo "=== CPU 使用 Top10 ===" && ps aux --sort=-%cpu | head -11';
    } else if (titleLower.includes('磁盘') || titleLower.includes('disk')) {
      newScript += 'df -h && echo "=== 目录占用 Top10 ===" && du -sh /* 2>/dev/null | sort -hr | head -10';
    } else if (titleLower.includes('进程') || titleLower.includes('process')) {
      newScript += 'ps aux && echo "=== 进程树 ===" && pstree -p && echo "=== 资源 Top10 ===" && ps aux --sort=-%mem | head -11';
    } else {
      newScript += output.split('\n')[0]; // 保留原有输出
    }

    // 更新脚本
    writeFileSync(scriptPath, newScript, 'utf-8');
    chmodSync(scriptPath, 0o755);
    console.log('[DEBUG] analyzeAndOptimize: script updated for card:', cardId);

    // 记录优化日志
    const logsDir = join(getDataDir(), 'logs');
    if (!existsSync(logsDir)) {
      require('fs').mkdirSync(logsDir, { recursive: true });
    }
    const logFile = join(logsDir, 'optimize.log');
    const logEntry = `[${new Date().toISOString()}]优化技能 ${cardId} (${title}): ${suggestion}\n`;
    appendFileSync(logFile, logEntry, 'utf-8');

  } catch(e) {
    console.log('[DEBUG] analyzeAndOptimize error:', e.message);
  }
}

// ==================== 工作流模式识别（模型判断） ====================
const WORKFLOW_DIR = join(process.env.OPENCLAW_STATE_DIR || (process.env.HOME || '/root') + '/.openclaw', '.auto-skill', 'workflows');
const WORKFLOW_SEQ_TTL = 30 * 60 * 1000; // 30分钟会话窗口

// 工具调用阈值（超过此阈值准备生成技能）- 仅作为快速参考，模型决定主判断
const WORKFLOW_TOOL_THRESHOLD = 5;

// 会话级消息缓存
let workflowCache = {
  sessionKey: null,
  messages: [],
  taskCompleted: false,
  ts: 0,
  lastAssistantOutput: null,
  lastWorkflow: null
};

function ensureWorkflowDir() {
  try {
    if (!existsSync(WORKFLOW_DIR)) {
      require('fs').mkdirSync(WORKFLOW_DIR, { recursive: true });
    }
  } catch {}
}

function getExistingWorkflow() {
  ensureWorkflowDir();
  try {
    const wfPath = join(WORKFLOW_DIR, 'current.json');
    if (existsSync(wfPath)) {
      return JSON.parse(readFileSync(wfPath, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveWorkflowFile(workflow) {
  ensureWorkflowDir();
  try {
    writeFileSync(join(WORKFLOW_DIR, 'current.json'), JSON.stringify(workflow, null, 2), 'utf-8');
  } catch(e) {
    console.log('[DEBUG] workflow save error:', e.message);
  }
}

// ==================== 每日沉寂扫描 ====================
const SCAN_STATE_FILE = join(process.env.OPENCLAW_STATE_DIR || (process.env.HOME || '/root') + '/.openclaw', '.auto-skill', '.decay-scan-state');

function getLastScanDate() {
  try {
    if (existsSync(SCAN_STATE_FILE)) {
      const data = JSON.parse(readFileSync(SCAN_STATE_FILE, 'utf-8'));
      return data.lastScanDate || null;
    }
  } catch {}
  return null;
}

function setLastScanDate(date) {
  try {
    writeFileSync(SCAN_STATE_FILE, JSON.stringify({ lastScanDate: date }), 'utf-8');
  } catch {}
}

async function dailyDecayScan() {
  const today = new Date().toISOString().slice(0, 10);
  const lastScan = getLastScanDate();

  // 每天只扫描一次
  if (lastScan === today) {
    console.log('[DEBUG] daily scan: already ran today');
    return;
  }

  console.log('[DEBUG] daily scan: starting...');
  setLastScanDate(today);

  const dataDir = getDataDir();
  const cardsDir = join(dataDir, 'cards');
  const skillsDir = join(dataDir, 'skills');

  if (!existsSync(cardsDir)) return;

  // 收集所有技能的使用统计
  const skillStats = [];
  try {
    const files = readdirSync(cardsDir).filter(f => f.endsWith('.yaml'));
    const now = Date.now();
    for (const f of files) {
      const content = readFileSync(join(cardsDir, f), 'utf-8');
      const lastHit = content.match(/^last_hit_at:\s*(\S+)/m);
      const hitCount = content.match(/^hit_count:\s*(\d+)/m);
      const level = content.match(/^level:\s*(\S+)/m);
      const title = content.match(/^title:\s*"?([^"\n]+)"?/m);
      const cardId = content.match(/^id:\s*(\S+)/m);
      const scriptM = content.match(/^skill_script:\s*"?([^"\n]+)"?/m);

      if (lastHit && cardId) {
        const lastDate = new Date(lastHit[1]);
        const daysUnused = Math.floor((now - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        skillStats.push({
          cardId: cardId[1],
          title: title ? title[1] : '未知',
          level: level ? level[1] : 'L1',
          hitCount: hitCount ? parseInt(hitCount[1]) : 0,
          daysUnused,
          scriptExists: scriptM ? existsSync(join(skillsDir, scriptM[1])) : false
        });
      }
    }
  } catch(e) {
    console.log('[DEBUG] daily scan: error reading cards:', e.message);
    return;
  }

  if (skillStats.length === 0) {
    console.log('[DEBUG] daily scan: no skills to analyze');
    return;
  }

  // 让模型判断哪些该删除
  const statsText = skillStats.map(s =>
    `- [${s.cardId}] "${s.title}" (${s.level}): ${s.hitCount}次使用, ${s.daysUnused}天未用`
  ).join('\n');

  const prompt = `你是经验系统的管理员。请分析以下技能使用情况，判断哪些应该删除。

技能统计：
${statsText}

请根据实际情况判断：
- 长期不用的技能可以删除
- 但有价值的技能（高频使用、刚创建不久）要保留
- 给每条删除指令写出具体原因

输出指令：
[DECAY_DELETE]
[
  {"cardId": "ID1", "reason": "原因"},
  {"cardId": "ID2", "reason": "原因"}
]
[/DECAY_DELETE]

如果没有技能该删除，输出：
[DECAY_DELETE]
[]
[/DECAY_DELETE]

只输出指令。`;

  try {
    const result = execSync(`python3 -c "
import requests
resp = requests.post(
    'https://api.minimaxi.com/anthropic/v1/messages',
    headers={
        'Content-Type': 'application/json',
        'x-api-key': 'f0478a9dc1554fbe84b794e9528c6900.elAEl9DP520WLtaA',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
    },
    json={
        'model': 'MiniMax-M2.7-highspeed',
        'max_tokens': 2000,
        'messages': [{'role': 'user', 'content': '''${prompt.replace(/'/g, "\\'")}'''}]
    },
    timeout=60
)
print(resp.json()['content'][0]['text'][:4000])
" 2>/dev/null`, { encoding: 'utf-8', timeout: 70000 });

    // 解析删除指令
    const deleteMatch = result.match(/\[DECAY_DELETE\]\s*([\s\S]*?)\s*\[\/DECAY_DELETE\]/);
    if (deleteMatch && deleteMatch[1]) {
      const jsonMatch = deleteMatch[1].match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const deleteList = JSON.parse(jsonMatch[0]);
        if (Array.isArray(deleteList) && deleteList.length > 0) {
          console.log('[DEBUG] daily scan: deleting', deleteList.length, 'skills');
          for (const item of deleteList) {
            if (item.cardId) {
              deleteSkill(item.cardId, dataDir);
              console.log('[DEBUG] daily scan: deleted', item.cardId, 'reason:', item.reason);
            }
          }
        } else {
          console.log('[DEBUG] daily scan: no skills to delete');
        }
      }
    }
  } catch(e) {
    console.log('[DEBUG] daily scan: model error:', e.message.slice(0, 100));
  }
}

// 提取对话内容
function extractContent(msg) {
  if (!msg) return '';
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg)) {
    return msg.map(m => typeof m === 'string' ? m : (m.text || '')).join(' ');
  }
  if (msg.text) return msg.text;
  return '';
}

// 模型分析工作流
async function analyzeWithModel(history, context) {
  if (history.length < 2) return null;

  const conversationText = history.map((m, i) => `${i+1}. [${m.role}] ${m.content.slice(0, 300)}`).join('\n');

  // 获取技能使用情况
  let skillStats = '';
  try {
    const dataDir = getDataDir();
    const cardsDir = join(dataDir, 'cards');
    const files = readdirSync(cardsDir).filter(f => f.endsWith('.yaml'));
    const now = Date.now();
    for (const f of files.slice(0, 20)) {
      const content = readFileSync(join(cardsDir, f), 'utf-8');
      const lastHit = content.match(/^last_hit_at:\s*(\S+)/m);
      const hitCount = content.match(/^hit_count:\s*(\d+)/m);
      const title = content.match(/^title:\s*"?([^"\n]+)"?/m);
      if (lastHit && title) {
        const lastDate = new Date(lastHit[1]);
        const daysUnused = Math.floor((now - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        skillStats += `- ${title[1]}: 最后使用${daysUnused}天前, hit=${hitCount ? hitCount[1] : 0}\n`;
      }
    }
  } catch {}

  // 获取目标系统信息
  const osType = require('os').type() === 'Darwin' ? 'macOS' : 'Linux';

  const prompt = `你是经验系统的大脑。你需要分析对话，判断是否需要生成、优化或删除技能。

目标系统：${osType}（生成的脚本必须兼容此系统）

对话历史：
${conversationText}

技能使用情况：
${skillStats || '(无技能数据)'}

你的判断：
1. 任务是否完成？是否需要生成新技能？
2. 用户是否有反馈说技能执行结果不对/有偏差？
3. 是否有技能长期不用（>30天）应该删除？

重要：${osType} 系统下，进程相关命令：
- 内存：ps -eo pid,comm,%mem,rss | sort -k3 -rn
- CPU：ps -eo pid,comm,%cpu,rss | sort -k3 -rn
- 进程：ps aux | head -20

输出指令：

[WORKFLOW_GEN] 生成新技能（脚本必须兼容${osType}）
{"workflowId": "ID", "title": "标题", "description": "描述", "scriptTemplate": "bash脚本，兼容${osType}", "trigger": "触发条件", "example": "示例"}

[SKILL_UPDATE] 更新技能
{"cardId": "ID", "reason": "原因", "newScript": "新脚本（兼容${osType}）"}

[SKILL_DELETE] 删除技能
{"cardId": "ID", "reason": "原因"}

[NO_OP] 无操作

只输出指令，不要其他内容。`;

  try {
    const result = execSync(`python3 -c "
import requests
resp = requests.post(
    'https://api.minimaxi.com/anthropic/v1/messages',
    headers={
        'Content-Type': 'application/json',
        'x-api-key': 'f0478a9dc1554fbe84b794e9528c6900.elAEl9DP520WLtaA',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
    },
    json={
        'model': 'MiniMax-M2.7-highspeed',
        'max_tokens': 2000,
        'messages': [{'role': 'user', 'content': '''${prompt.replace(/'/g, "\\'")}'''}]
    },
    timeout=60
)
print(resp.json()['content'][0]['text'][:4000])
" 2>/dev/null`, { encoding: 'utf-8', timeout: 70000 });

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const wf = JSON.parse(jsonMatch[0]);
      if (wf && wf.workflowId) {
        console.log('[DEBUG] workflow: model found:', wf.title, 'script:', wf.scriptTemplate?.slice(0, 50));
        // 返回带类型的对象
        return { type: 'WORKFLOW_GEN', data: wf };
      }
    }
    // 检查是否有其他指令
    const instruction = detectModelInstruction(result);
    if (instruction) return instruction;
  } catch(e) {
    console.log('[DEBUG] workflow: model error:', e.message.slice(0, 100));
  }
  return null;
}

// 创建工作流技能
async function createWorkflowSkill(workflow, sessionDir) {
  try {
    ensureWorkflowDir();
    const existingFiles = readdirSync(join(sessionDir, 'cards')).filter(f => f.endsWith('.yaml'));
    let maxId = 0;
    for (const f of existingFiles) {
      const match = f.match(/^(\d+)/);
      if (match) maxId = Math.max(maxId, parseInt(match[1]));
    }
    const cardId = String(maxId + 1).padStart(3, '0');

    const scriptName = `${cardId}-wf-${workflow.workflowId}.sh`;
    const scriptPath = join(sessionDir, 'skills', scriptName);
    const scriptContent = `#!/bin/bash
# AI Generated Workflow: ${workflow.title}
# ${workflow.trigger || ''}
# Created: ${new Date().toISOString()}

${workflow.scriptTemplate}
`;
    writeFileSync(scriptPath, scriptContent, 'utf-8');
    chmodSync(scriptPath, 0o755);

    const cardContent = `# rocky-auto-skill 工作流技能（AI分析生成）
id: ${cardId}
title: "${workflow.title}"
tool: workflow
tags: [workflow, ai-generated]
category: workflow

level: L3
hit_count: 1
source: workflow_ai

created_at: ${new Date().toISOString().slice(0, 10)}
last_hit_at: ${new Date().toISOString().slice(0, 10)}
updated_at: ${new Date().toISOString().slice(0, 10)}
status: active

problem: |
  ${workflow.description || workflow.trigger}

solution: |
  ${workflow.scriptTemplate}

skill_script: "${scriptName}"
workflow_id: "${workflow.workflowId}"
workflow_trigger: "${workflow.trigger || ''}"
workflow_example: "${workflow.example || ''}"
`;
    writeFileSync(join(sessionDir, 'cards', `${cardId}-wf-${workflow.workflowId}.yaml`), cardContent, 'utf-8');
    console.log('[DEBUG] workflow: created skill, card:', cardId, 'script:', scriptName);
    cache.ts = 0;
    return { cardId, scriptName };
  } catch(e) {
    console.log('[DEBUG] workflow: create error:', e.message);
    return null;
  }
}

// 处理工作流
async function processWorkflow(sessionKey, messages, sessionDir) {
  const now = Date.now();

  // 初始化或超时重置
  if (workflowCache.sessionKey !== sessionKey || (now - workflowCache.ts) > WORKFLOW_SEQ_TTL) {
    workflowCache = { sessionKey, messages: [], taskCompleted: false, ts: now, lastAssistantOutput: null, lastWorkflow: null };
  }
  workflowCache.ts = now;

  // 从消息中提取最新的 assistant 输出，检测 [SKILL_UPDATE] 标记
  let latestAssistantOutput = null;
  for (const m of messages) {
    if (m.role === 'assistant' && m.content) {
      const content = extractContent(m.content);
      if (content && content.length > 0) {
        latestAssistantOutput = content.slice(0, 2000);
      }
    }
  }

  // 如果有新的模型输出，检测指令
  if (latestAssistantOutput && latestAssistantOutput !== workflowCache.lastAssistantOutput) {
    workflowCache.lastAssistantOutput = latestAssistantOutput;
    const instruction = detectModelInstruction(latestAssistantOutput);
    if (instruction) {
      console.log('[DEBUG] workflow: detected instruction:', instruction.type);
      if (instruction.type === 'SKILL_UPDATE') {
        // 优先从内存中的 lastWorkflow 获取，否则从磁盘获取
        const wf = workflowCache.lastWorkflow || getExistingWorkflow();
        if (wf && (wf.cardId || wf.id)) {
          const cardId = wf.cardId || wf.id;
          const cardFiles = readdirSync(join(sessionDir, 'cards')).filter(f => f.includes(cardId));
          if (cardFiles.length > 0) {
            const cardContent = readFileSync(join(sessionDir, 'cards', cardFiles[0]), 'utf-8');
            const scriptM = cardContent.match(/^skill_script:\s*"?([^"\n]+)"?/m);
            const idM = cardContent.match(/^id:\s*(\S+)/m);
            const titleM = cardContent.match(/^title:\s*"?([^"\n]+)"?/m);
            if (scriptM && idM) {
              const skillCard = {
                id: idM[1],
                title: titleM ? titleM[1] : '',
                skill_script: scriptM[1]
              };
              const updated = applySkillUpdate(skillCard, instruction.data, sessionDir);
              if (updated) {
                console.log('[DEBUG] workflow: skill updated successfully');
                cache.ts = 0;
              }
            }
          }
        }
      }
    }
  }

  // 收集对话历史用于模型分析
  for (const m of messages) {
    const content = extractContent(m.content);
    if (content && !workflowCache.messages.some(pm => pm.content === content.slice(0, 200))) {
      workflowCache.messages.push({
        role: m.role || 'unknown',
        content: content.slice(0, 500),
        timestamp: now
      });
    }
  }

  // 保留最近50条消息
  if (workflowCache.messages.length > 50) {
    workflowCache.messages = workflowCache.messages.slice(-50);
  }

  // 检查是否已创建（优先内存，其次磁盘）
  const existing = workflowCache.lastWorkflow || getExistingWorkflow();
  if (existing && existing.registered) {
    return existing;
  }

  // 模型判断触发：当消息足够多时，让模型判断是否需要生成/更新技能
  // 简化逻辑：直接让模型分析，模型自己决定是否需要操作
  if (!workflowCache.preparingSkill && !workflowCache.skillReady && workflowCache.messages.length >= 6) {
    workflowCache.preparingSkill = true;
    console.log('[DEBUG] workflow: requesting model judgment, messages:', workflowCache.messages.length);
    const result = await analyzeWithModel(workflowCache.messages);
      // result 是 detectModelInstruction 解析后的对象 { type, data }

      if (result && result.type === 'WORKFLOW_GEN') {
        // 模型判断需要生成技能
        const workflow = result.data;
        workflow.registered = false;
        const createResult = await createWorkflowSkill(workflow, sessionDir);
        if (createResult) {
          workflow.cardId = createResult.cardId;
          workflow.scriptName = createResult.scriptName;
          workflow.registered = true;
          workflowCache.skillReady = true;
          workflowCache.lastWorkflow = workflow;
          workflow.createdAt = new Date().toISOString();
          saveWorkflowFile(workflow);
          return workflow;
        }
      } else if (result && result.type === 'SKILL_UPDATE') {
        // 模型判断需要更新技能，指令在上面已处理
        workflowCache.preparingSkill = false;
      } else if (result && result.type === 'SKILL_DELETE') {
        // 模型判断需要删除技能
        if (result.data && result.data.cardId) {
          deleteSkill(result.data.cardId, sessionDir);
        }
        workflowCache.preparingSkill = false;
      } else {
        // NO_OP 或无效，重置状态允许后续重试
        workflowCache.preparingSkill = false;
        console.log('[DEBUG] workflow: model decided no action needed');
      }
    }
  return null;
}

// 检查是否正在准备生成技能
function isPreparingSkill() {
  return workflowCache.preparingSkill && !workflowCache.skillReady;
}

// 从模型输出中检测指令
function detectModelInstruction(modelOutput) {
  if (!modelOutput) return null;
  try {
    // 检查是否生成新技能
    const genMatch = modelOutput.match(/\[WORKFLOW_GEN\]\s*([\s\S]*?)\s*\[\/WORKFLOW_GEN\]/);
    if (genMatch && genMatch[1]) {
      const content = genMatch[1].trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { type: 'WORKFLOW_GEN', data: JSON.parse(jsonMatch[0]) };
      }
    }
    // 检查是否更新技能
    const updateMatch = modelOutput.match(/\[SKILL_UPDATE\]\s*([\s\S]*?)\s*\[\/SKILL_UPDATE\]/);
    if (updateMatch && updateMatch[1]) {
      const content = updateMatch[1].trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { type: 'SKILL_UPDATE', data: JSON.parse(jsonMatch[0]) };
      }
      return { type: 'SKILL_UPDATE', data: { newScript: content } };
    }
    // 检查是否删除技能
    const deleteMatch = modelOutput.match(/\[SKILL_DELETE\]\s*([\s\S]*?)\s*\[\/SKILL_DELETE\]/);
    if (deleteMatch && deleteMatch[1]) {
      const content = deleteMatch[1].trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { type: 'SKILL_DELETE', data: JSON.parse(jsonMatch[0]) };
      }
      return { type: 'SKILL_DELETE', data: { reason: content } };
    }
    // 检查是否无操作
    if (modelOutput.includes('[NO_OP]')) {
      return { type: 'NO_OP' };
    }
  } catch {}
  return null;
}

// 删除技能
function deleteSkill(cardId, sessionDir) {
  try {
    const cardsDir = join(sessionDir, 'cards');
    const skillsDir = join(sessionDir, 'skills');
    const cardFiles = readdirSync(cardsDir).filter(f => f.includes(cardId));
    for (const cardFile of cardFiles) {
      const cardPath = join(cardsDir, cardFile);
      const content = readFileSync(cardPath, 'utf-8');
      const scriptM = content.match(/^skill_script:\s*"?([^"\n]+)"?/m);
      if (scriptM && scriptM[1]) {
        const scriptPath = join(skillsDir, scriptM[1]);
        if (existsSync(scriptPath)) {
          execSync(`rm -f "${scriptPath}"`);
        }
      }
      execSync(`rm -f "${cardPath}"`);
    }
    console.log('[DEBUG] workflow: deleted skill:', cardId);
    cache.ts = 0;
    return true;
  } catch(e) {
    console.log('[DEBUG] workflow: delete skill error:', e.message);
  }
  return false;
}

// 更新技能脚本
function applySkillUpdate(skillCard, update, sessionDir) {
  try {
    const scriptPath = join(sessionDir, 'skills', skillCard.skill_script);
    if (!existsSync(scriptPath)) return false;

    const newScript = update.newScript || update.script;
    if (!newScript) return false;

    // 更新前先备份当前版本
    backupScript(scriptPath);

    writeFileSync(scriptPath, `#!/bin/bash\n# Auto-updated by model\n# ${update.reason || ''}\n\n${newScript}\n`, 'utf-8');
    chmodSync(scriptPath, 0o755);

    // 更新卡片
    const cardFiles = readdirSync(join(sessionDir, 'cards')).filter(f => f.startsWith(skillCard.id));
    for (const cardFile of cardFiles) {
      let cardContent = readFileSync(join(sessionDir, 'cards', cardFile), 'utf-8');
      cardContent = cardContent.replace(/^updated_at:.*$/m, `updated_at: ${new Date().toISOString().slice(0, 10)}`);
      writeFileSync(join(sessionDir, 'cards', cardFile), cardContent, 'utf-8');
    }

    // 记录改进日志
    logSkillImprovement(skillCard.id, 'apply_update', {
      reason: update.reason || '',
      scriptPath: scriptPath
    });

    console.log('[DEBUG] workflow: skill updated by model:', skillCard.id, update.reason || '');
    cache.ts = 0;
    return true;
  } catch(e) {
    console.log('[DEBUG] workflow: apply update error:', e.message);
  }
  return false;
}

// ==================== 路径 ====================
function getScriptsDir() {
  const home = process.env.HOME || '/root';
  const stateDir = process.env.OPENCLAW_STATE_DIR || `${home}/.openclaw`;
  const candidates = [
    join(__dirname, 'scripts'),  // 插件自带 scripts 目录
    join(stateDir, 'skills', 'rocky-auto-skill', 'scripts')
  ];
  const ws = process.env.OPENCLAW_WORKSPACE;
  if (ws) candidates.splice(1, 0, join(ws, 'skills', 'rocky-auto-skill', 'scripts'));
  for (const dir of candidates) {
    if (existsSync(join(dir, 'autoskill-search'))) return dir;
  }
  return join(stateDir, 'skills', 'rocky-auto-skill', 'scripts');
}

function getDataDir() {
  const home = process.env.HOME || '/root';
  const stateDir = process.env.OPENCLAW_STATE_DIR || `${home}/.openclaw`;
  return process.env.AUTOSKILL_DIR || `${stateDir}/.auto-skill`;
}

// ==================== 搜索 ====================
function searchCards(scriptsDir, keyword) {
  try {
    const safeKeyword = keyword.replace(/"/g, '').replace(/`/g, '').slice(0, 200);
    const result = execSync(
      `python3 "${scriptsDir}/autoskill-search.py" "${safeKeyword}" --top 3 --json 2>/dev/null`,
      { timeout: 15000, encoding: 'utf-8' }
    );
    return JSON.parse(result);
  } catch {
    return [];
  }
}

// ==================== 自动执行 L3 脚本 ====================
function autoExecuteScript(scriptPath, cardId, title) {
  // 检查缓存
  const cached = getCachedExec(scriptPath);
  if (cached) {
    return cached;
  }

  let result;
  try {
    const start = Date.now();
    const stdout = execSync(`bash "${scriptPath}" 2>&1`, { timeout: 30000, encoding: 'utf-8' });
    const duration = Date.now() - start;
    result = {
      success: true,
      exitCode: 0,
      stdout: stdout.slice(0, 500),
      stderr: '',
      duration,
      cardId,
      title
    };
  } catch (err) {
    const exitCode = err.status || 1;
    const stderr = err.stderr ? err.stderr.slice(0, 300) : '';
    const stdout = err.stdout ? err.stdout.slice(0, 300) : '';
    result = {
      success: exitCode === 0,
      exitCode,
      stdout: stdout.slice(0, 500),
      stderr,
      duration: 0,
      cardId,
      title
    };
  }

  setCachedExec(scriptPath, result);
  return result;
}

// ==================== 自动 hit 计数 ====================
function autoHit(cardId, scriptsDir) {
  try {
    execSync(`bash "${scriptsDir}/autoskill-hit" ${cardId} 2>&1`, {
      timeout: 10000, encoding: 'utf-8'
    });
    return true;
  } catch {
    return false;
  }
}

// ==================== 提取核心错误关键词 ====================
function extractErrorKeywords(errorMsg) {
  const patterns = [
    /E[A-Z]{5,}/,
    /(?:error|错误|失败)[：:]\s*(.{5,50})/i,
    /(?:not found|不存在|denied|refused|timeout|failed)/i,
    /exception:\s*(.{5,50})/i,
  ];
  for (const p of patterns) {
    const m = errorMsg.match(p);
    if (m) return (m[1] || m[0]).slice(0, 100);
  }
  return errorMsg.replace(/^(?:error|错误|失败)\s*[：:]?\s*/i, '').slice(0, 80);
}

// ==================== 提取用户消息关键词 ====================
function extractUserMessageKeywords(messages) {
  if (!messages || messages.length === 0) return '';
  
  // 从后往前找最后一条用户消息
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === 'user' && msg.content) {
      const content = typeof msg.content === 'string' ? msg.content : msg.content.text || '';
      if (content.length > 3) {
        // 提取前50个字符作为关键词
        return content.slice(0, 80).replace(/\n/g, ' ').trim();
      }
    }
  }
  return '';
}

// 从prompt字符串中提取最后一条用户消息（用于before_agent_start等事件）
function extractUserMessageKeywordsFromPrompt(promptStr) {
  if (!promptStr || typeof promptStr !== 'string') return '';

  // 用户消息在 <<<END_OPENCLAW_INTERNAL_CONTEXT>>> 标记之后，格式如：
  // [Sun 2026-04-19 08:04 GMT+8] 用户消息内容
  const marker = '<<<END_OPENCLAW_INTERNAL_CONTEXT>>>';
  const markerIdx = promptStr.lastIndexOf(marker);
  const searchStr = markerIdx >= 0 ? promptStr.slice(markerIdx + marker.length) : promptStr.slice(-500);
  const lines = searchStr.split('\n');

  // 收集所有可能是用户消息的行
  const candidates = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length === 0) continue;
    const trimmedLower = trimmed.toLowerCase();

    // 跳过系统内部内容
    if (trimmed.startsWith('{') || trimmed.startsWith('```') || trimmed.startsWith('"') ||
        trimmed === '"' ||
        trimmedLower.includes('conversation info') || trimmedLower.includes('timestamp') ||
        trimmedLower.includes('sender') || trimmedLower.includes('message_id') ||
        trimmedLower.includes('return your response as plain text')) {
      continue;
    }

    // 处理 [时间戳] 用户消息 格式：提取 ] 之后的内容
    if (trimmed.startsWith('[') && trimmed.includes(']')) {
      const bracketIdx = trimmed.indexOf(']');
      const afterBracket = trimmed.slice(bracketIdx + 1).trim();
      if (afterBracket.length > 0) {
        candidates.push(afterBracket.replace(/[""]$/, '').slice(0, 80));
        continue;
      }
    }

    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(trimmed)) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      const content = trimmed.slice(colonIdx + 1).trim();
      if (content.length > 0) {
        candidates.push(content.slice(0, 80));
        continue;
      }
    }

    candidates.push(trimmed.slice(0, 80));
  }

  // 返回最后一个候选项（最近的用户消息）
  return candidates.length > 0 ? candidates[candidates.length - 1] : '';
}

// ==================== 从 prompt 中提取模型回答 ====================
function extractAssistantResponseFromPrompt(promptStr) {
  if (!promptStr || typeof promptStr !== 'string') return null;
  // 尝试在 END_OPENCLAW_INTERNAL_CONTEXT 之后查找 assistant 回答
  const marker = '<<<END_OPENCLAW_INTERNAL_CONTEXT>>>';
  const markerIdx = promptStr.lastIndexOf(marker);
  const searchStr = markerIdx >= 0 ? promptStr.slice(markerIdx + marker.length) : promptStr;
  // 查找 "assistant:" 或 "Assistant:" 开头的行
  const lines = searchStr.split('\n');
  let lastAssistantLine = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('assistant') || trimmed.startsWith('Assistant')) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0 && colonIdx < 20) {
        lastAssistantLine = trimmed.slice(colonIdx + 1).trim();
      }
    }
  }
  if (lastAssistantLine) return lastAssistantLine.slice(0, 500);
  return null;
}

// ==================== 获取所有卡片 ====================
function getAllCards() {
  const dataDir = getDataDir();
  const cardsDir = join(dataDir, 'cards');
  if (!existsSync(cardsDir)) return [];

  const cards = [];
  try {
    const cardFiles = execSync(`find "${cardsDir}" -name "*.yaml" -maxdepth 1`, {
      encoding: 'utf-8', timeout: 5000
    }).trim().split('\n').filter(Boolean);

    for (const cardPath of cardFiles) {
      try {
        const content = readFileSync(cardPath, 'utf-8');
        const idM = content.match(/^id:\s*(\S+)/m);
        const titleM = content.match(/^title:\s*"?([^"\n]+)"?/m);
        const problemM = content.match(/^problem:\s*\|?\s*([^\n]+)/m);
        const solutionM = content.match(/^solution:\s*\|?\s*([^\n]+)/m);
        const levelM = content.match(/^level:\s*(\S+)/m);
        const hitM = content.match(/^hit_count:\s*(\d+)/m);

        cards.push({
          id: idM ? idM[1] : '',
          title: titleM ? titleM[1] : '',
          problem: problemM ? problemM[1].replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+/, '') : '',
          solution: solutionM ? solutionM[1].replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+/, '') : '',
          level: levelM ? levelM[1] : 'L1',
          hit_count: hitM ? parseInt(hitM[1]) : 0
        });
      } catch(e) {}
    }
  } catch(e) {}
  return cards;
}

// ==================== L3 技能扫描 ====================
function getL3SkillsDirect() {
  const dataDir = getDataDir();
  const cardsDir = join(dataDir, 'cards');
  const skillsDir = join(dataDir, 'skills');

  if (!existsSync(cardsDir)) return [];

  const skills = [];
  try {
    const cardFiles = execSync(`find "${cardsDir}" -name "*.yaml" -maxdepth 1`, {
      encoding: 'utf-8', timeout: 5000
    }).trim().split('\n').filter(Boolean);

    for (const cardPath of cardFiles) {
      try {
        const content = readFileSync(cardPath, 'utf-8');
        const levelM = content.match(/^level:\s*(\S+)/m);
        if (!levelM || levelM[1] !== 'L3') continue;

        const scriptM = content.match(/^skill_script:\s*"?([^"\n]+)"?/m);
        if (!scriptM || !scriptM[1]) continue;

        const idM = content.match(/^id:\s*(\S+)/m);
        const titleM = content.match(/^title:\s*"?([^"\n]+)"?/m);

        const scriptName = scriptM[1];
        const scriptPath = join(skillsDir, scriptName);

        // 不再跳过 auto-generated 脚本，这些是我们创建的自动化技能

        if (!existsSync(scriptPath)) continue;

        skills.push({
          id: idM ? idM[1] : '???',
          title: titleM ? titleM[1] : '',
          skill_script: scriptName,
          scriptPath,
          problem: extractProblem(content),
        });
      } catch {}
    }
  } catch {}

  return skills;
}

function extractProblem(content) {
  const m = content.match(/problem:\s*\|\s*\n([\s\S]*?)(?=\n[a-z_]+:|\n\n)/);
  return m ? m[1].trim().slice(0, 100) : '';
}

// ==================== 获取卡片执行统计 ====================
function getCardStats(cardId) {
  const dataDir = getDataDir();
  const cardsDir = join(dataDir, 'cards');
  const cardPath = join(cardsDir, cardId.padStart(3, '0') + '.yaml');
  
  if (!existsSync(cardPath)) return { exec_count: 0, exec_success: 0, rate: 0 };
  
  try {
    const content = readFileSync(cardPath, 'utf-8');
    const countM = content.match(/^exec_count:\s*(\d+)/m);
    const successM = content.match(/^exec_success:\s*(\d+)/m);
    
    const exec_count = countM ? parseInt(countM[1]) : 0;
    const exec_success = successM ? parseInt(successM[1]) : 0;
    const rate = exec_count > 0 ? Math.round(exec_success * 100 / exec_count) : 0;
    
    return { exec_count, exec_success, rate };
  } catch {
    return { exec_count: 0, exec_success: 0, rate: 0 };
  }
}

// ==================== 模板脚本扫描 ====================
function findTemplateScriptsDirect() {
  const dataDir = getDataDir();
  const skillsDir = join(dataDir, 'skills');
  const cardsDir = join(dataDir, 'cards');

  if (!existsSync(skillsDir) || !existsSync(cardsDir)) return [];

  const templates = [];
  try {
    const files = execSync(`find "${skillsDir}" -name "*.sh" -maxdepth 1`, {
      encoding: 'utf-8', timeout: 5000
    }).trim().split('\n').filter(Boolean);

    for (const scriptPath of files) {
      try {
        const content = readFileSync(scriptPath, 'utf-8');
        if (!content.includes('auto-generated')) continue;

        const scriptName = scriptPath.split('/').pop();
        const cardSlug = scriptName.replace('.sh', '');
        const idMatch = cardSlug.match(/^(\d+)/);
        if (!idMatch) continue;

        const cardId = idMatch[1];
        let title = cardSlug, problem = '', solution = '';

        try {
          const cardFiles = execSync(`find "${cardsDir}" -name "${cardSlug}.yaml" -maxdepth 1`, {
            encoding: 'utf-8', timeout: 3000
          }).trim();
          if (cardFiles) {
            const cc = readFileSync(cardFiles.split('\n')[0], 'utf-8');
            const tm = cc.match(/^title:\s*"?(.+?)"?\s*$/m);
            if (tm) title = tm[1];
            const pm = cc.match(/problem:\s*\|\s*\n([\s\S]*?)(?=\n[a-z_]+:|\n$)/);
            if (pm) problem = pm[1].trim().slice(0, 150);
            const sm = cc.match(/solution:\s*\|\s*\n([\s\S]*?)(?=\n[a-z_]+:|\n$)/);
            if (sm) solution = sm[1].trim().slice(0, 150);
          }
        } catch {}

        templates.push({ id: cardId, title, problem, solution, scriptPath });
      } catch {}
    }
  } catch {}

  return templates;
}

// ==================== 错误检测 ====================
function extractLastError(messages) {
  if (!Array.isArray(messages)) return null;
  const recent = messages.slice(-3);
  for (const msg of recent) {
    if (!msg || typeof msg !== 'object') continue;
    const content = typeof msg.content === 'string' ? msg.content
      : Array.isArray(msg.content) ? msg.content.map(c => typeof c === 'string' ? c : (c?.text || '')).join(' ')
      : '';
    if (!content) continue;
    const clean = content.replace(/\x1b\[[0-9;]*m/g, '').replace(/\n/g, ' ').trim();
    if (/^\[(?:error|ERROR)\]/i.test(clean) ||
        /^error[：:]\s*/i.test(clean) ||
        /^\[?(?:fatal|exception)[\]:]?\s*/i.test(clean) ||
        /(?:not found|不存在|denied|refused|timeout|EADDRINUSE|ENOENT|EACCES)/i.test(clean)) {
      return clean.slice(0, 200);
    }
  }
  return null;
}

// ==================== 模板提示 ====================
// 模板脚本优化由模型判断是否需要，不再硬编码限流

// ==================== 主逻辑 ====================
module.exports = {
  register(api) {
    console.log("[DEBUG] rocky-auto-skill register called, hooks:", Object.keys(api));
    autoInstall();
    console.log('[DEBUG] autoInstall check done');

    // 启动每日沉寂扫描定时器（每小时检查一次）
    setInterval(() => {
      dailyDecayScan().catch(e => console.log('[DEBUG] daily scan error:', e.message));
    }, 60 * 60 * 1000);
    // 启动时立即执行一次
    dailyDecayScan().catch(e => console.log('[DEBUG] daily scan initial error:', e.message));

    api.on('before_agent_start', (event) => {
      console.log("[DEBUG] HOOK FIRING, event keys:", Object.keys(event || {}));
      let result = null;
      try {
      const scriptsDir = getScriptsDir();
      if (!existsSync(scriptsDir)) { return result || {}; }

      const dataDir = getDataDir();
      const skillsDir = join(dataDir, 'skills');
      const cardsDir = join(dataDir, 'cards');

      refreshCache();

      result = {
        prependSystemContext: `💡 经验系统：遇问题搜经验 python3 ${scriptsDir}/autoskill-search "关键词"，解决后记录 bash ${scriptsDir}/autoskill-record --title "标题" --tool "工具" --problem "问题" --solution "方案"

🔧 技能改进：执行脚本后如果结果不完整、有错误、或者发现更好的方法，立即用 python3 ${scriptsDir}/autoskill-enhance 改进脚本。不要等到用户说"不对"才改。发现技能过时或有问题时，主动更新。`
      };

      // ========== 触发条件：检测到错误 或 用户消息 ==========
      const errorMsg = extractLastError(event.messages || []);
      const userMsgStr = typeof event.prompt === 'string' ? event.prompt : '';
      console.log("[DEBUG] userMsgStr length:", userMsgStr.length, "prompt slice:", userMsgStr.slice(-100));
      const userMsg = extractUserMessageKeywordsFromPrompt(userMsgStr);
      console.log("[DEBUG] extracted userMsg:", JSON.stringify(userMsg), "len:", userMsg.length);

      // ========== 自然语言意图检测 ==========
      // ---------- 记录意图 ----------
      const recordIntentPatterns = [
        /^\s*(帮我)?记录(一个)?经验/,
        /^\s*记一下/,
        /^\s*备忘/,
        /^\s*把这个记下来/,
        /^\s*记录一下/,
        /^\s*我要记录/,
        /^\s*想记录/,
        /^\s*记个/,
        /^\s*记笔记/,
        /^\s*收藏/,
        /^\s*抄下来/,
        /^\s*存档/
      ];
      const hasRecordIntent = recordIntentPatterns.some(p => p.test(userMsg));

      // ---------- 统计意图 ----------
      const statsIntentPatterns = [
        /^\s*(帮我)?查看?统计/,
        /^\s*统计(一下)?/,
        /^\s*状态/,
        /^\s*情况/,
        /^\s*看看.*情况/,
        /^\s*有什么/,
        /^\s*查看/,
        /^\s*查看经验/,
        /^\s*经验列表/
      ];
      const hasStatsIntent = statsIntentPatterns.some(p => p.test(userMsg)) && !hasRecordIntent;

      // ---------- 列表意图 ----------
      const listIntentPatterns = [
        /^\s*(帮我)?列出(所有)?经验/,
        /^\s*列表/,
        /^\s*经验列表/,
        /^\s*所有经验/,
        /^\s*有哪些/,
        /^\s*看看列表/
      ];
      const hasListIntent = listIntentPatterns.some(p => p.test(userMsg)) && !hasRecordIntent;

      // ---------- 搜索意图 ----------
      const searchMatch = userMsg.match(/^(搜索|找|查找|查询)\s*(.+)/);

      // ---------- 命中意图 ----------
      const hitIntentPatterns = [
        /^\s*(这个)?有用/,
        /^\s*(帮我)?标记.*有用/,
        /^\s*(帮我)?标记/,
        /^\s*hit/,
        /^\s*点赞/,
        /^\s*喜欢/,
        /^\s*收藏/,
        /^\s*记住了/
      ];
      const hasHitIntent = hitIntentPatterns.some(p => p.test(userMsg)) && !hasRecordIntent;

      // ---------- 回滚意图 ----------
      const rollbackIntentPatterns = [
        /^\s*回到上一个版本/,
        /^\s*撤销/,
        /^\s*回滚/,
        /^\s*恢复上一版/,
        /^\s*取消.*修改/,
        /^\s*不对.*取消/
      ];
      const hasRollbackIntent = rollbackIntentPatterns.some(p => p.test(userMsg));

      // ---------- 反馈意图 ----------
      // 上下文相关的脚本修改（无需明确命令，根据对话上下文隐式判断）
      // 只要消息与当前执行的技能相关，且包含"增加"、"加"、"还要"等词，就触发脚本修改

      // ========== 执行自然语言命令 ==========
      try {
        // ----- 记录意图 -----
        if (hasRecordIntent) {
          console.log('[DEBUG] natural language record intent detected:', userMsg.slice(0, 50));
          let extractedTitle = userMsg;
          let extractedProblem = userMsg;
          let extractedSolution = '待补充';

          const colonMatch = userMsg.match(/[：:]\s*(.+)/);
          if (colonMatch) {
            const content = colonMatch[1].trim();
            if (content.includes('，') || content.includes(',')) {
              const parts = content.split(/[，,]/);
              extractedTitle = parts[0].trim();
              extractedProblem = content.trim();
              if (parts[1] && parts[1].trim() !== '') {
                extractedSolution = parts[1].trim();
              }
            } else {
              extractedTitle = content.slice(0, 20);
              extractedProblem = content;
            }
          }

          const safeTitle = extractedTitle.replace(/[#*`$\\]/g, '').slice(0, 50);
          const safeProblem = extractedProblem.replace(/[#*`$\\]/g, '').slice(0, 500);
          const safeSolution = extractedSolution.replace(/[#*`$\\]/g, '').slice(0, 500);
          const recordCmd = `bash "${scriptsDir}/autoskill-record" --title "${safeTitle}" --tool "qq" --problem "${safeProblem}" --solution "${safeSolution}" 2>&1`;
          console.log('[DEBUG] natural record cmd:', recordCmd.slice(0, 100));
          const recordOutput = execSync(recordCmd, { encoding: 'utf-8', timeout: 10000 });
          console.log('[DEBUG] natural record output:', recordOutput.slice(0, 200));

          result.prependContext = `✅ 已记录经验卡片：
📌 标题：${safeTitle}
📋 问题：${safeProblem.slice(0, 50)}${safeProblem.length > 50 ? '...' : ''}
🔧 方案：${safeSolution}

卡片ID：${recordOutput.match(/id:\s*(\d+)/)?.[1] || '未知'}

---
`;
          cache.ts = 0;
        }
        // ----- 统计意图 -----
        else if (hasStatsIntent) {
          console.log('[DEBUG] natural language stats intent detected:', userMsg.slice(0, 50));
          const statsCmd = `bash "${scriptsDir}/autoskill-stats" 2>&1`;
          const statsOutput = execSync(statsCmd, { encoding: 'utf-8', timeout: 10000 });
          result.prependContext = `📊 经验统计：
${statsOutput}

---
`;
        }
        // ----- 列表意图 -----
        else if (hasListIntent) {
          console.log('[DEBUG] natural language list intent detected:', userMsg.slice(0, 50));
          const listCmd = `bash "${scriptsDir}/autoskill-list" 2>&1`;
          const listOutput = execSync(listCmd, { encoding: 'utf-8', timeout: 10000 });
          result.prependContext = `📋 经验列表：
${listOutput}

---
`;
        }
        // ----- 搜索意图 -----
        else if (searchMatch) {
          const keyword = searchMatch[2].trim();
          console.log('[DEBUG] natural language search intent detected:', keyword);
          const searchCmd = `bash "${scriptsDir}/autoskill-search" "${keyword}" 2>&1`;
          const searchOutput = execSync(searchCmd, { encoding: 'utf-8', timeout: 10000 });
          result.prependContext = `🔍 搜索"${keyword}"结果：
${searchOutput}

---
`;
        }
        // ----- 命中意图 -----
        else if (hasHitIntent) {
          console.log('[DEBUG] natural language hit intent detected:', userMsg.slice(0, 50));
          // 获取最新创建的卡片ID
          const listCmd = `bash "${scriptsDir}/autoskill-list" 2>&1`;
          const listOutput = execSync(listCmd, { encoding: 'utf-8', timeout: 10000 });
          const idMatch = listOutput.match(/ID:\s*(\d+)/);
          if (idMatch) {
            const cardId = idMatch[1];
            const hitCmd = `bash "${scriptsDir}/autoskill-hit" ${cardId} 2>&1`;
            const hitOutput = execSync(hitCmd, { encoding: 'utf-8', timeout: 10000 });
            result.prependContext = `👍 已标记卡片 #${cardId} 为有用！
${hitOutput}

---
`;
            cache.ts = 0;
          }
        }
        // ----- 回滚意图 -----
        else if (hasRollbackIntent) {
          console.log('[DEBUG] natural language rollback intent detected:', userMsg.slice(0, 50));
          console.log('[DEBUG] lastExecutedSkill check:', lastExecutedSkill ? `${lastExecutedSkill.cardId} ${lastExecutedSkill.title}` : 'NULL');
          // 获取当前执行的技能路径（如果有）
          if (lastExecutedSkill && lastExecutedSkill.scriptPath) {
            console.log('[DEBUG] rollback: calling rollbackScript with path:', lastExecutedSkill.scriptPath);
            const rollbackResult = rollbackScript(lastExecutedSkill.scriptPath);
            console.log('[DEBUG] rollbackResult:', JSON.stringify(rollbackResult));
            if (rollbackResult.success) {
              result.prependContext = `🔄 ${rollbackResult.message}
📌 技能：${lastExecutedSkill.title}

脚本已恢复到版本 #${rollbackResult.version}，下次执行会使用该版本~

---
`;
              logSkillImprovement(lastExecutedSkill.cardId, 'rollback', {
                fromVersion: 'current',
                toVersion: rollbackResult.version
              });
              cache.ts = 0;
            } else {
              result.prependContext = `⚠️ ${rollbackResult.message}

---
`;
            }
          } else {
            result.prependContext = `⚠️ 没有可回滚的技能记录

---
`;
          }
        }
      } catch(e) {
        console.log('[DEBUG] natural language command error:', e.message);
      }

      // ========== 反馈意图检测：用户说"不对"、"应该还要"等 = 触发脚本优化 ==========
      // ========== 上下文感知的脚本修改（Hermes式） ==========
      // 只在非回滚意图时检测上下文修改，避免 Python 调用失败影响回滚流程
      let contextModify = null;
      if (!hasRollbackIntent) {
        contextModify = detectContextScriptModification(userMsg, event.messages || [], lastExecutedSkill);
      }
      if (contextModify) {
        console.log('[DEBUG] context script modification detected:', contextModify.reason);
        try {
          const { cardId, scriptPath, title, currentScript, enhancement } = contextModify;

          // 生成增强后的脚本
          const newScript = applyScriptEnhancement(title, currentScript, enhancement);
          if (newScript && newScript !== currentScript) {
            // 更新前先备份当前版本
            backupScript(scriptPath);

            writeFileSync(scriptPath, newScript, 'utf-8');
            chmodSync(scriptPath, 0o755);

            // 记录改进日志
            logSkillImprovement(cardId, 'context_enhancement', {
              enhancement: enhancement,
              scriptPath: scriptPath
            });

            console.log('[DEBUG] context script updated for card:', cardId, 'enhancement:', enhancement);

            result.prependContext = `🔧 已根据上下文自动增强技能脚本：
📌 技能：${title}
💡 增强：${enhancement}

脚本已更新，下次执行会使用增强版本~ 如需回滚，说"回到上一个版本"

---
`;
            cache.ts = 0;
          }
        } catch(e) {
          console.log('[DEBUG] context modification error:', e.message);
        }
      }

      // ========== 工作流模式检测（模型分析） ==========
      const sessionKey = event.sessionKey || 'default';
      // 将消息历史发送给模型判断
      processWorkflow(sessionKey, event.messages || [], dataDir).then(workflow => {
        if (workflow) {
          console.log('[DEBUG] workflow: generated by model:', workflow.workflowId, workflow.title);
        }
      }).catch(e => {
        console.log('[DEBUG] workflow: process error:', e.message);
      });

      // 方式1：错误触发
      const allL3Scripts = [];
      const triggerInfo = [];

      if (errorMsg) {
        const keyword = extractErrorKeywords(errorMsg);
        const searchResults = searchCards(scriptsDir, keyword);
        if (searchResults && searchResults.length > 0) {
          const l3Scripts = searchResults.filter(r => r.level === 'L3' && r.skill_script);
          l3Scripts.forEach(r => {
            if (!allL3Scripts.some(s => s.id === r.id)) {
              allL3Scripts.push({ ...r, trigger: 'error', keyword });
              triggerInfo.push(`🔴 错误触发: "${keyword}"`);
            }
          });
        }
      }

      // 方式2：用户消息触发（关键词匹配）
      if (userMsg && userMsg.length > 2) { // 中文3字符起触发（兼容短查询）
        // 从所有卡片中匹配（用于 hit 累计）
        const allCards = getAllCards();
        const matchedAll = allCards.filter(c => {
          const title = (c.title || '').toLowerCase();
          const problem = (c.problem || '').toLowerCase();
          const userLower = userMsg.toLowerCase();
          const titleStr = Array.isArray(title) ? title.join(' ') : title;
          const problemStr = Array.isArray(problem) ? problem.join(' ') : problem;
          return titleStr.includes(userLower) || problemStr.includes(userLower);
        });

        // 对匹配到的已有卡片累计 hit（排除刚创建的待补充卡片）
        matchedAll.forEach(c => {
          if (c.problem !== '待补充') {
            // L2 卡片的 solution="待补充" 时，模型判断是否晋升
            if (c.level === 'L2' && c.solution === '待补充' && c.hit_count >= 3) {
              const modelDecision = askModelDecision('promote_l2', { title: c.title, hit_count: c.hit_count });
              if (modelDecision.decision === 'yes') {
                try {
                  const cardFiles = readdirSync(cardsDir).filter(f => f.startsWith(c.id + '-') || f.startsWith(c.id + '.'));
                  const cardFile = cardFiles.find(f => f.endsWith('.yaml')) || '';
                  const base = cardFile.replace(/\.yaml$/, '');
                  let scriptContent = '#!/bin/bash\n';
                  scriptContent += `# Auto-generated skill script\n`;
                  scriptContent += `# Problem: ${c.title}\n`;
                  const titleLower = (c.title || '').toLowerCase();
                  if (titleLower.includes('内存') || titleLower.includes('mem')) {
                    scriptContent += 'echo "ps aux --sort=-%mem | head -11"\n';
                  } else if (titleLower.includes('cpu') || titleLower.includes('处理器')) {
                    scriptContent += 'echo "ps aux --sort=-%cpu | head -11"\n';
                  } else if (titleLower.includes('disk') || titleLower.includes('磁盘')) {
                    scriptContent += 'echo "df -h"\n';
                  } else if (titleLower.includes('进程') || titleLower.includes('process')) {
                    scriptContent += 'echo "ps aux | head -20"\n';
                  } else {
                    scriptContent += 'echo "echo \'待补充解决方案\'"\n';
                  }
                  const scriptPath = join(skillsDir, `${base}.sh`);
                  writeFileSync(scriptPath, scriptContent, 'utf-8');
                  chmodSync(scriptPath, 0o755);
                  const cardPath = join(cardsDir, cardFile);
                  let cardContent = readFileSync(cardPath, 'utf-8');
                  cardContent = cardContent.replace(/^skill_script:.*$/m, `skill_script: "${base}.sh"`);
                  writeFileSync(cardPath, cardContent, 'utf-8');
                  const promoteCmd = `bash "${scriptsDir}/autoskill-promote" ${c.id} 2>&1`;
                  execSync(promoteCmd, { encoding: 'utf-8', timeout: 15000 });
                  cache.ts = 0;
                } catch(e) {
                  console.log('[DEBUG] auto-promote failed:', e.message);
                }
              }
            }
            try {
              execSync(`bash "${scriptsDir}/autoskill-hit" ${c.id} 2>&1`, { timeout: 5000 });
              console.log('[DEBUG] hit +1 for card:', c.id, c.title, 'level:', c.level);
            } catch(e) {}
          }
        });

        // 从 L3 技能库中匹配（用于自动执行）
        const matched = cache.l3Skills.filter(s => {
          const title = (s.title || '').toLowerCase();
          const problem = (s.problem || '').toLowerCase();
          const userLower = userMsg.toLowerCase();
          // title和problem可能是字符串或数组，统一处理
          const titleStr = Array.isArray(title) ? title.join(' ') : title;
          const problemStr = Array.isArray(problem) ? problem.join(' ') : problem;
          // 检查用户消息是否包含技能标题或问题的关键词
          return titleStr.includes(userLower) || problemStr.includes(userLower);
        });

        matched.forEach(s => {
          if (!allL3Scripts.some(s2 => s2.id === s.id)) {
            allL3Scripts.push({ ...s, trigger: 'user', keyword: userMsg });
            triggerInfo.push(`🟡 用户消息: "${userMsg.slice(0, 30)}..."`);
          }
        });

        console.log('[DEBUG] L3 match check: matched count:', matched.length, 'allL3Scripts:', allL3Scripts.length, allL3Scripts.map(s=>s.id));

        // 如果没有匹配到任何技能，自动创建 L1 卡片（去重）
        if (matched.length === 0) {
          // 检查是否已存在相同问题的卡片
          const existingCards = getAllCards();
          const alreadyExists = existingCards.some(c => {
            const cProblem = (c.problem || '').toLowerCase();
            return cProblem === userMsg.toLowerCase() || cProblem.includes(userMsg.toLowerCase()) || userMsg.toLowerCase().includes(cProblem);
          });

          if (alreadyExists) {
            console.log('[DEBUG] card already exists, skip auto-create');
          } else {
            const decision = askModelDecision('create_card', { userMsg });
            if (decision.decision === 'yes') {
              try {
                const safeTitle = (decision.title || userMsg.slice(0, 30)).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-');
                const recordCmd = `bash "${scriptsDir}/autoskill-record" --title "${safeTitle}" --tool "ai" --problem "${userMsg}" --solution "待补充" 2>&1`;
                const recordOutput = execSync(recordCmd, { encoding: 'utf-8', timeout: 10000 });
                console.log('[DEBUG] model-driven auto-created card:', decision.reason, recordOutput.slice(0, 100));
                cache.ts = 0;
              } catch(e) {
                console.log('[DEBUG] auto-create failed:', e.message);
              }
            }
          }
        }
      }

      // 执行 L3 脚本（根据成功率决定）
      if (allL3Scripts.length > 0) {
        const execResults = [];
        const modelCheckSkills = [];  // 成功率不足90%，交给模型

      for (const r of allL3Scripts) {
          const scriptPath = join(skillsDir, r.skill_script);
          console.log('[DEBUG] L3 script loop:', r.id, 'scriptPath:', scriptPath, 'exists:', existsSync(scriptPath));
          if (!existsSync(scriptPath)) continue;

          // 跳过模板脚本
          try {
            const sc = readFileSync(scriptPath, 'utf-8');
            if (sc.includes('auto-generated')) { console.log('[DEBUG] skipping auto-generated script:', scriptPath); continue; }
          } catch {}

          // 检查成功率
          const stats = getCardStats(r.id);
          const shouldAutoRun = stats.exec_count === 0 || stats.rate >= 90;
          
          if (!shouldAutoRun) {
            // 成功率低于90%，交给模型判断
            modelCheckSkills.push({ ...r, stats });
            continue;
          }

          // 自动执行脚本
          console.log('[DEBUG] autoExecuteScript for:', r.id, scriptPath);
          const execResult = autoExecuteScript(scriptPath, r.id, r.title);
          console.log('[DEBUG] execResult:', JSON.stringify(execResult));
          execResults.push({
            id: r.id,
            title: r.title,
            scriptPath,
            trigger: r.trigger,
            ...execResult
          });

          // 记录最近执行的技能（用于反馈优化）
          const currentScript = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf-8') : '';
          setLastExecutedSkill(r.id, scriptPath, r.title, currentScript);

          // 自动分析执行结果，决定是否优化脚本（异步，不阻塞）
          if (execResult.success) {
            analyzeAndOptimizeScript(r.id, scriptPath, r.title, execResult.stdout).catch(e => {
              console.log('[DEBUG] analyzeAndOptimize error:', e.message);
            });
          }

          // 记录执行结果（方案E）
          try {
            const logResult = execResult.success ? 'success' : 'failed';
            execSync(`bash "${scriptsDir}/autoskill-log" ${r.id} ${logResult}`, {
              timeout: 5000, encoding: 'utf-8'
            });
          } catch {}
        }

        // 构建 context
        console.log('[DEBUG] building prepend: allL3Scripts:', allL3Scripts.length, 'execResults:', execResults.length);
        const uniqueTriggers = [...new Set(triggerInfo)].slice(0, 3);
        let prepend = `🔍 auto-skill 检测到 ${allL3Scripts.length} 条相关经验:
`;
        prepend += uniqueTriggers.join('\n') + '\n\n';

        // 执行结果
        if (execResults.length > 0) {
          const execBlocks = execResults.map(er => {
            const status = er.success ? `✅ 成功` : `⚠️ 退出码: ${er.exitCode}`;
            const triggerLabel = er.trigger === 'error' ? '🔴' : '🟡';
            let block = `${triggerLabel} 自动执行: [${er.id}] ${er.title}
   状态: ${status} | 耗时: ${er.duration}ms`;
            if (er.stdout) block += `\n   输出: ${er.stdout.slice(0, 200)}`;
            if (er.stderr) block += `\n   错误: ${er.stderr.slice(0, 200)}`;
            if (er.success && er.cardId) {
              const hitOk = autoHit(er.cardId, scriptsDir);
              if (hitOk) block += `\n   ✅ 自动标记: hit +1`;
            }
            return block;
          }).join('\n\n');

          prepend += `\n═══════════════════════════════════\n`;
          prepend += `🤖 【自动执行结果】\n${execBlocks}\n`;
          prepend += `═══════════════════════════════════`;
        }

        // 成功率不足90%的技能，交给模型判断
        if (modelCheckSkills.length > 0) {
          prepend += '\n\n🔧 相关技能（需模型判断）：';
          for (const s of modelCheckSkills) {
            prepend += `\n  [${s.id}] ${s.title} (${s.stats.rate}%成功率 ${s.stats.exec_count}次)`;
            prepend += `\n     → bash "${s.scriptPath}"`;
          }
          prepend += '\n💡 提示: 执行5次以上且成功率≥90%后自动执行';
        }

        result.prependContext = prepend;
      }

      } catch(e) {
        console.log("[DEBUG] HOOK ERROR:", e.message, e.stack);
        return result || {};
      }

      return result || {};
    });
  }
};
