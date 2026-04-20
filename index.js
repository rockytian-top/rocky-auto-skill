/**
 * rocky-auto-skill Plugin v3.0
 *
 * 模型驱动的经验系统（简化版）：
 * 1. 自动检测错误 + 用户问题关键词
 * 2. 自动搜索经验库（有脚本的技能）
 * 3. 模型决定是否执行脚本
 * 4. 自动注入执行结果到 context
 * 5. 模型自主决定生成/优化/删除技能
 * 6. 每日沉寂扫描，自动清理长期不用的技能
 *
 * 简化说明（v3.0）：
 * - 去掉 L1/L2/L3 级别机制
 * - 去掉 hit_count 晋升规则
 * - 模型根据上下文自主决定
 */

const { execSync } = require('child_process');
const { existsSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync, copyFileSync, unlinkSync } = require('fs');
const { join } = require('path');

// ==================== 网关配置读取 ====================
function getGatewayConfig() {
  try {
    const configPath = process.env.OPENCLAW_STATE_DIR 
      ? join(process.env.OPENCLAW_STATE_DIR, 'openclaw.json')
      : join(require('os').homedir(), '.openclaw-gateway2', 'openclaw.json');
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    }
  } catch(e) {}
  return null;
}

// 模块级变量，存储当前 sessionKey、prompt 和检测到的 agent model（在 before_agent_start 中设置）
let _currentSessionKey = null;
let _currentPrompt = null;
let _detectedAgentModel = null; // 存储检测到的 agent model，供异步调用使用

// 从 sessionKey 解析 agent 名称并获取其 model
// sessionKey 格式: agent:xiaoying:onebot:xxx 或 agent:fs-daying:main
function getAgentModelFromSession(sessionKey) {
  if (!sessionKey) {
    console.log('[DEBUG] getAgentModelFromSession: sessionKey is null');
    return null;
  }
  // 格式: agent:agentName:...
  const match = sessionKey.match(/^agent:([^:]+):/);
  if (!match) {
    console.log('[DEBUG] getAgentModelFromSession: sessionKey format mismatch, key:', sessionKey);
    return null;
  }
  const agentName = match[1];
  console.log('[DEBUG] getAgentModelFromSession: extracted agentName:', agentName);

  const config = getGatewayConfig();
  if (!config || !config.agents || !config.agents.list) return null;

  // 遍历 agents 找匹配的
  for (const agent of config.agents.list) {
    if (agent.id === agentName || agent.name === agentName) {
      if (agent.model && agent.model.includes('/')) {
        console.log('[DEBUG] getAgentModelFromSession: found model:', agent.model);
        return agent.model;
      }
    }
  }
  console.log('[DEBUG] getAgentModelFromSession: agent found but no model');
  return null;
}

// 从 prompt 中检测当前 agent 的 model
// 通过 prompt 内容识别渠道和发送者，推断使用哪个 agent
function detectAgentModelFromPrompt(promptStr) {
  if (!promptStr || typeof promptStr !== 'string') return null;

  const config = getGatewayConfig();
  if (!config || !config.agents || !config.agents.list) return null;

  // 从 config.bindings 查找当前 channel 对应的 agent
  // bindings 格式: [{ agentId: "xiaoying", match: { channel: "onebot" } }]
  // 从 prompt 中提取 channel 信息
  const channelMatch = promptStr.match(/channel["\s:]+(\w+)/i);
  const channel = channelMatch ? channelMatch[1] : null;

  if (channel && config.bindings) {
    const binding = config.bindings.find(b => b.match && b.match.channel === channel);
    if (binding && binding.agentId) {
      const agent = config.agents.list.find(a => a.id === binding.agentId);
      if (agent && agent.model && agent.model.includes('/')) {
        return agent.model;
      }
    }
  }

  // 回退到读取第一个有 model 配置的 agent
  for (const agent of config.agents.list) {
    if (agent.model && agent.model.includes('/')) {
      return agent.model;
    }
  }

  return null;
}

function getModelCredentials(agentModel, promptOverride) {
  // agentModel 格式: "provider/model" 如 "minimax-portal/MiniMax-M2.7-highspeed"
  const config = getGatewayConfig();
  const effectivePrompt = promptOverride || _currentPrompt;
  console.log('[DEBUG] getModelCredentials called, agentModel:', agentModel);

  // 如果没有提供 agentModel，尝试从 sessionKey、prompt 或已检测的 model 获取
  if (!agentModel) {
    if (_currentSessionKey) agentModel = getAgentModelFromSession(_currentSessionKey);
    if (!agentModel && effectivePrompt) agentModel = detectAgentModelFromPrompt(effectivePrompt);
    // 兜底：使用之前检测到的 agent model（防止 async 调用期间被覆盖）
    if (!agentModel && _detectedAgentModel) agentModel = _detectedAgentModel;
    // 最终兜底：使用配置中第一个有 model 的 agent
    if (!agentModel && config && config.agents && config.agents.list) {
      for (const agent of config.agents.list) {
        if (agent.model && agent.model.includes('/')) {
          agentModel = agent.model;
          console.log('[DEBUG] using first available agent model as fallback:', agentModel);
          break;
        }
      }
    }
  }

  // 解析 provider 和 model
  let targetProvider = null;
  let targetModel = null;
  if (agentModel && agentModel.includes('/')) {
    const parts = agentModel.split('/');
    targetProvider = parts[0];
    targetModel = parts[1];
  }

  // 如果没有 targetProvider，从 agents 配置中获取第一个有 model 的
  if (!targetProvider && config && config.agents && config.agents.list) {
    for (const agent of config.agents.list) {
      if (agent.model && agent.model.includes('/')) {
        const parts = agent.model.split('/');
        targetProvider = parts[0];
        targetModel = parts[1];
        break;
      }
    }
  }

  // 策略：优先用 provider 的 apiKey（API key 模式），其次用环境变量（OAuth 模式）
  // 优先级：targetProvider > 任意有 apiKey 的 provider > 环境变量
  const oauthToken = process.env.ANTHROPIC_AUTH_TOKEN || null;
  const openaiToken = (process.env.OPENAI_API_KEY || process.env.API_KEY || null);

  // 优先：targetProvider 有自己的 apiKey
  if (targetProvider && config && config.models && config.models.providers) {
    const provider = config.models.providers[targetProvider];
    if (provider && provider.apiKey) {
      const modelId = targetModel || (provider.models && provider.models[0] ? provider.models[0].id : null);
      console.log('[DEBUG] using targetProvider apiKey, model:', modelId);
      return {
        baseUrl: provider.baseUrl || 'https://api.minimaxi.com/anthropic',
        apiKey: provider.apiKey,
        authHeader: false,
        apiType: (provider.api && provider.api.includes('openai')) ? 'openai' : 'anthropic',
        model: modelId
      };
    }
  }

  // 其次：targetProvider 是 OAuth 模式（有 authHeader: true 但无 apiKey）
  if (targetProvider && config && config.models && config.models.providers) {
    const provider = config.models.providers[targetProvider];
    if (provider && provider.authHeader === true && !provider.apiKey && oauthToken) {
      const modelId = targetModel || (provider.models && provider.models[0] ? provider.models[0].id : null);
      console.log('[DEBUG] using OAuth token, model:', modelId);
      return {
        baseUrl: provider.baseUrl || 'https://api.minimaxi.com/anthropic',
        apiKey: oauthToken,
        authHeader: true,
        apiType: 'anthropic',
        model: modelId
      };
    }
  }

  // 兜底：找任意一个有有效 apiKey 的 provider（允许回退到其他 provider，包括 OAuth provider 无 token 时）
  if (config && config.models && config.models.providers) {
    for (const [name, p] of Object.entries(config.models.providers)) {
      const apiKeyStr = p.apiKey;
      const isValidApiKey = apiKeyStr && typeof apiKeyStr === 'string' && apiKeyStr.trim().length > 0;
      console.log('[DEBUG] fallback provider check:', name, 'apiKey present:', !!apiKeyStr, 'apiKey length:', typeof apiKeyStr === 'string' ? apiKeyStr.length : 'N/A', 'isValid:', isValidApiKey);
      if (isValidApiKey) {
        const modelId = p.models && p.models[0] ? p.models[0].id : null;
        console.log('[DEBUG] using fallback provider:', name, 'model:', modelId, 'apiKey len:', apiKeyStr.length);
        return {
          baseUrl: p.baseUrl || 'https://open.bigmodel.cn/api/coding/paas/v4',
          apiKey: apiKeyStr,
          authHeader: false,
          apiType: (p.api && p.api.includes('openai')) ? 'openai' : 'anthropic',
          model: modelId
        };
      }
    }
  }

  // 最后：使用环境变量（无 targetProvider）
  if (oauthToken) {
    console.log('[DEBUG] using OAuth env var as last resort');
    return {
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: oauthToken,
      authHeader: true,
      apiType: 'anthropic',
      model: targetModel
    };
  }
  if (openaiToken) {
    console.log('[DEBUG] using OpenAI env var as last resort');
    return {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: openaiToken,
      authHeader: false,
      apiType: 'openai',
      model: 'gpt-4o-mini'
    };
  }

  console.log('[DEBUG] getModelCredentials: no credentials found');
  return { baseUrl: '', apiKey: '', authHeader: false, apiType: 'anthropic', model: '' };
}

// ==================== 脚本版本备份 ====================
const MAX_BACKUP_VERSIONS = 2;

/**
 * 转义 bash 特殊字符
 * @param {string} str - 待转义字符串
 * @returns {string} - 转义后的字符串
 */
function bashEscape(str) {
  if (!str) return '';
  // 先转义反斜杠，再转义双引号和美元符号
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

/**
 * 带环境变量的 execSync 调用
 */
function execSyncWithEnv(cmd, options = {}) {
  const env = {
    ...process.env,
    OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR || (process.env.HOME + '/.openclaw')
  };
  return execSync(cmd, { ...options, env });
}

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
let cache = { skillsWithScripts: null, templates: null, ts: 0 };

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
  cache.skillsWithScripts = getSkillsWithScripts();
  console.log("[DEBUG] cache.skillsWithScripts:", cache.skillsWithScripts.length, cache.skillsWithScripts.map(s=>s.id+'/'+s.title));
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
// 简化版：模型驱动，不需要硬编码晋升规则
function askModelDecision(type, ctx) {
  // create_card: 仅作为提示，模型最终决定
  if (type === 'create_card') {
    const isQuestion = (ctx.userMsg||'').length>=10 && /[吗？么什怎如何为什么]|\?|how|what|why|can/i.test(ctx.userMsg||'');
    return { 
      decision: isQuestion ? 'yes' : 'no',
      title: (ctx.userMsg||'').slice(0,30).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g,'')
    };
  }
  return { decision: 'no' };
}

// ==================== 反馈处理函数 ====================
// 获取最近执行的技能
// lastExecutedSkill 持久化到文件，避免网关重启后丢失
const LAST_SKILL_FILE = () => join(getDataDir(), 'last_executed_skill.json');

function loadLastExecutedSkill() {
  try {
    if (!existsSync(LAST_SKILL_FILE())) return null;
    const content = readFileSync(LAST_SKILL_FILE(), 'utf-8');
    const data = JSON.parse(content);
    // 检查是否在5分钟窗口内
    if (Date.now() - data.ts > 5 * 60 * 1000) {
      try { unlinkSync(LAST_SKILL_FILE()); } catch(e) {}
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveLastExecutedSkill(data) {
  try {
    writeFileSync(LAST_SKILL_FILE(), JSON.stringify(data), 'utf-8');
  } catch(e) {
    console.log('[DEBUG] saveLastExecutedSkill error:', e.message);
  }
}

let lastExecutedSkill = null; // { cardId, scriptPath, title, currentScript, ts }

function setLastExecutedSkill(cardId, scriptPath, title, currentScript) {
  lastExecutedSkill = { cardId, scriptPath, title, currentScript, ts: Date.now() };
  saveLastExecutedSkill(lastExecutedSkill);
  console.log('[DEBUG] setLastExecutedSkill called:', cardId, title, 'expires in 5min');
}

function getRecentExecutedScript() {
  // 优先从内存获取
  if (lastExecutedSkill) {
    if (Date.now() - lastExecutedSkill.ts > 5 * 60 * 1000) {
      lastExecutedSkill = null;
      try { unlinkSync(LAST_SKILL_FILE()); } catch(e) {}
      return null;
    }
    return lastExecutedSkill;
  }
  // 内存没有，从文件恢复
  lastExecutedSkill = loadLastExecutedSkill();
  return lastExecutedSkill;
}

// 从消息历史中查找最近讨论过的有脚本的技能
function findRecentSkillFromMessages(messages, scriptsDir, skillsDir) {
  if (!messages || messages.length === 0) return null;
  
  // 获取有脚本的技能列表（不再区分L3）
  let skillsWithScripts = [];
  try {
    const cardsDir = join(dataDir, 'cards');
    if (!existsSync(cardsDir)) return null;
    const files = readdirSync(cardsDir).filter(f => f.endsWith('.yaml'));
    for (const file of files) {
      const content = readFileSync(join(cardsDir, file), 'utf-8');
      // 不再检查 level，只要有 script 就收集
      const scriptM = content.match(/^skill_script:\s*"?(.+?)"?\s*$/m);
      if (scriptM) {
        const idM = content.match(/^id:\s*(\d+)/m);
        const titleM = content.match(/^title:\s*(.+)/m);
        const scriptPath = join(skillsDir, scriptM[1]);
        if (existsSync(scriptPath)) {
          const scriptContent = readFileSync(scriptPath, 'utf-8');
          skillsWithScripts.push({
            id: idM ? idM[1] : '???',
            title: titleM ? titleM[1] : '',
            scriptPath: scriptPath,
            scriptContent: scriptContent
          });
        }
      }
    }
  } catch(e) {
    console.log('[DEBUG] findRecentSkillFromMessages error:', e.message);
    return null;
  }
  
  if (skillsWithScripts.length === 0) return null;
  
  // 从最近的消息中查找提到的技能
  const recentMsgs = (messages || []).slice(-10);
  for (const msg of recentMsgs) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    for (const skill of skillsWithScripts) {
      // 检查消息是否提到这个技能
      if (content.includes(skill.title) || skill.title.includes(content.slice(0, 20))) {
        console.log('[DEBUG] findRecentSkillFromMessages: found', skill.id, skill.title);
        return {
          cardId: skill.id,
          scriptPath: skill.scriptPath,
          title: skill.title,
          currentScript: skill.scriptContent,
          ts: Date.now() - 60000 // 设为1分钟前，在5分钟窗口内
        };
      }
    }
  }
  
  return null;
}

// ==================== 基于规则的脚本增强 ====================
/**
 * 根据用户反馈关键词，应用规则增强脚本
 * 返回增强描述，如果规则不匹配则返回 null
 */
function applyRuleBasedEnhancement(userMsg, currentScript, title) {
  if (!userMsg || !currentScript) return null;

  const msg = userMsg.toLowerCase();
  const titleLower = title.toLowerCase();

  // 规则表：匹配模式 -> 增强描述
  const rules = [
    // 在线用户数
    { patterns: [/在线用户|当前用户|who命令|登录用户|活跃用户/i], enhancement: '显示在线用户数（who | wc -l）' },
    // 运行时间
    { patterns: [/运行时间|uptime|开机时间|运行时长|启动了多久/i], enhancement: '显示系统运行时间（uptime）' },
    // CPU 信息
    { patterns: [/cpu信息|cpu详情|处理器信息|lscpu/i], enhancement: '显示 CPU 详细信息（lscpu）' },
    // 进程过滤
    { patterns: [/过滤.*进程|去掉.*进程|只看用户进程|排除系统进程/i], enhancement: '过滤掉系统进程，只显示用户进程' },
    // 排序
    { patterns: [/按.*排序|从高到低|从大到小/i], enhancement: '按 CPU 或内存使用率排序' },
    // Top N
    { patterns: [/top10|top15|前.*个|排名前/i], enhancement: '显示前10-15个进程' },
    // 内存详情
    { patterns: [/内存详情|swap|交换分区|虚拟内存/i], enhancement: '显示内存和 swap 使用情况' },
    // 磁盘使用
    { patterns: [/磁盘使用|硬盘使用|df.*h|目录占用/i], enhancement: '显示磁盘使用情况和目录占用' },
    // 网络连接
    { patterns: [/网络连接|端口|netstat|监听端口|连接数/i], enhancement: '显示网络连接和端口监听情况' },
    // 简化输出
    { patterns: [/只.*主要|只看|只显示.*重要/i], enhancement: '简化输出，只显示关键信息' },
    // 详细输出
    { patterns: [/详细|完整|更多.*信息/i], enhancement: '显示更详细的输出' },
  ];

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(msg)) {
        return { enhancement: rule.enhancement };
      }
    }
  }

  return null;
}

// ==================== 上下文感知的脚本修改检测（Hermes式 - 模型驱动） ====================
function detectContextScriptModification(userMsg, messages, recentSkill, scriptsDir, skillsDir, promptOverride) {
  // 优先使用传入的 recentSkill，其次从持久化存储获取，最后从消息历史查找
  if (!recentSkill) {
    recentSkill = getRecentExecutedScript();
    if (recentSkill) {
      console.log('[DEBUG] detectContextScriptModification: found skill from recent executed:', recentSkill.cardId, recentSkill.title);
    }
  }
  // 如果还是没有，从消息历史中找最近讨论过的技能
  if (!recentSkill) {
    recentSkill = findRecentSkillFromMessages(messages, scriptsDir, skillsDir);
    if (!recentSkill) {
      console.log('[DEBUG] detectContextScriptModification: no recent skill found');
      return null;
    }
    console.log('[DEBUG] detectContextScriptModification: found skill from messages:', recentSkill.cardId, recentSkill.title);
  }

  const { cardId, scriptPath, title, currentScript } = recentSkill;

  // 检查是否在5分钟窗口内
  if (Date.now() - recentSkill.ts > 5 * 60 * 1000) {
    return null;
  }

  // ========== 先尝试基于规则的增强 ==========
  const ruleResult = applyRuleBasedEnhancement(userMsg, currentScript, title);
  if (ruleResult) {
    console.log('[DEBUG] rule-based enhancement found:', ruleResult.enhancement);
    return { cardId, scriptPath, title, currentScript, enhancement: ruleResult.enhancement };
  }

  // ========== 使用 LLM 增强 ==========
  // 构建对话上下文
  const recentMessages = (messages || []).slice(-6);
  const contextText = recentMessages.map(m => {
    const role = m.role === 'user' ? '用户' : '助手';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${role}: ${content}`;
  }).join('\n');

  // 构建LLM prompt，让模型判断是否需要增强脚本
  const prompt = `技能：${title}
当前脚本：${currentScript.substring(0, 200)}
用户消息：${userMsg}

用户是否要求修改或增强这个脚本？比如用户说"还要显示"、"加上"、"添加"、"增加"等，都是要求增强。
如果用户要求修改脚本，请直接输出修改要求（30字以内）。
如果用户没有要求修改脚本，只输出"不需要"。

直接回复（只输出一行）：`;

  // 临时文件清理
  const tmpFile = '/tmp/autoskill_prompt_' + Date.now() + '.txt';
  const credsFile = '/tmp/autoskill_creds_' + Date.now() + '.json';
  const cleanup = () => { try { unlinkSync(tmpFile); unlinkSync(credsFile); } catch(e) {} };

  try {
    writeFileSync(tmpFile, prompt, 'utf-8');

    // 获取模型凭证（传入 promptOverride 防止 async 调用期间被覆盖）
    const creds = getModelCredentials(null, promptOverride);
    if (!creds.apiKey || !creds.model) {
      console.log('[DEBUG] LLM enhancement skipped: no valid credentials, apiKey:', !!creds.apiKey, 'model:', creds.model);
      cleanup();
      return null;
    }

    const headers = {
      'Content-Type': 'application/json'
    };
    if (creds.apiType === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    if (creds.authHeader) {
      headers['Authorization'] = `Bearer ${creds.apiKey}`;
    } else {
      headers['x-api-key'] = creds.apiKey;
    }
    writeFileSync(credsFile, JSON.stringify({ headers, baseUrl: creds.baseUrl, apiType: creds.apiType, model: creds.model, apiKey: creds.apiKey }), 'utf-8');

    const result = execSync(`python3 -W ignore -c "
import requests
import json
import sys
with open('${tmpFile}', 'r') as f:
    prompt = f.read()
with open('${credsFile}', 'r') as f:
    creds = json.load(f)

sys.stderr.write('DEBUG creds received:' + json.dumps({'model': creds.get('model'), 'baseUrl': creds.get('baseUrl'), 'apiType': creds.get('apiType'), 'apiKey_len': len(creds.get('apiKey', ''))}) + '\\n')

model = creds.get('model')
if not model:
    print('ERROR')
    sys.exit(0)
sys.stderr.write('DEBUG:model=' + str(model) + ' baseUrl=' + str(creds.get('baseUrl')) + ' apiType=' + str(creds.get('apiType')) + '\\n')

if creds.get('apiType') == 'openai':
    resp = requests.post(creds['baseUrl'] + '/chat/completions', headers=creds['headers'],
        json={'model': model, 'max_tokens': 100, 'messages': [{'role': 'user', 'content': prompt}]}, timeout=15)
    data = resp.json()
    choices = data.get('choices', [])
    if choices and len(choices) > 0:
        msg = choices[0].get('message', {})
        # 优先用 content，推理模型用 reasoning_content
        output = msg.get('content', '') or msg.get('reasoning_content', '') or ''
    else:
        output = 'ERROR'
    sys.stderr.write('DEBUG:openai_response=' + output[:50] + '\\n')
    print(output)
else:
    resp = requests.post(creds['baseUrl'] + '/v1/messages', headers=creds['headers'],
        json={'model': model, 'max_tokens': 100, 'messages': [{'role': 'user', 'content': prompt}]}, timeout=15)
    data = resp.json()
    sys.stderr.write('DEBUG:anthropic_response=' + str(data)[:100] + '\\n')
    content = data.get('content', [])
    for c in content:
        if c.get('type') == 'text':
            print(c.get('text', ''))
            break
    else:
        print('ERROR')
" 2>&1`, { encoding: 'utf-8', timeout: 20000 });

    cleanup(); // 成功后清理

    const trimmed = result.trim();
    console.log('[DEBUG] LLM enhancement check:', trimmed.slice(0, 300));

    // 如果回复包含"不需要"，说明不需要增强
    if (trimmed === 'ERROR' || trimmed.includes('不需要')) {
      return null;
    }

    // 检查用户消息是否暗示需要增强（还要/加上/添加/显示等）
    const userMsgLower = userMsg.toLowerCase();
    const impliesEnhancement = /还要|加上|添加|增加|显示|也要|再说|再问/.test(userMsgLower);

    if (!impliesEnhancement) {
      return null;
    }

    // 用户暗示需要增强，提取可能的增强内容
    // 如果回复中有"用户消息"字样，说明是分析文本，从中提取用户消息内容作为增强需求
    let enhancement = '';
    if (trimmed.includes('用户消息') || trimmed.includes('用户说')) {
      const match = trimmed.match(/用户[消息说][：:]\s*[""']?([^""'\n]+)[""']?/);
      if (match) {
        enhancement = match[1].trim();
      }
    }

    // 如果没有提取到，使用用户原始消息
    if (!enhancement || enhancement.length < 2) {
      enhancement = userMsg;
    }

    console.log('[DEBUG] LLM detected enhancement intent:', enhancement);

    console.log('[DEBUG] LLM detected enhancement intent:', enhancement);
    return { cardId, scriptPath, title, currentScript, enhancement };

  } catch(e) {
    console.log('[DEBUG] detectContextScriptModification error:', e.message);
    cleanup(); // 失败时也清理
    return null;
  }
}

// ==================== 基于规则的脚本修改 ====================
function applyRuleBasedScript(currentScript, enhancement) {
  if (!currentScript || !enhancement) return null;

  // 从 enhancement 描述中提取要添加的内容
  const enhancementLower = enhancement.toLowerCase();

  // 规则：提取括号中的命令
  const cmdMatch = enhancement.match(/（([^）]+)）/);
  const addCmd = cmdMatch ? cmdMatch[1].trim() : null;

  // 检查脚本是否已经包含这个命令
  if (addCmd && currentScript.includes(addCmd.split('|')[0].trim())) {
    console.log('[DEBUG] rule-based: script already contains', addCmd.split('|')[0]);
    return null;
  }

  // 根据 enhancement 决定如何修改脚本
  let newScript = currentScript;

  // 在线用户数：添加 who | wc -l
  if (enhancementLower.includes('在线用户') || enhancementLower.includes('who')) {
    const whoCmd = 'echo "=== 在线用户 ===" && who';
    if (!currentScript.includes('who')) {
      newScript = currentScript.replace(/\n$/, '') + '\n' + whoCmd;
    }
  }

  // 运行时间：已有 uptime
  if (enhancementLower.includes('运行时间') || enhancementLower.includes('uptime')) {
    const uptimeCmd = 'echo "=== 运行时间 ===" && uptime';
    if (!currentScript.includes('uptime')) {
      newScript = newScript.replace(/\n$/, '') + '\n' + uptimeCmd;
    }
  }

  // CPU 信息：添加 lscpu
  if (enhancementLower.includes('cpu信息') || enhancementLower.includes('lscpu')) {
    const lscpuCmd = 'echo "=== CPU 信息 ===" && lscpu';
    if (!currentScript.includes('lscpu')) {
      newScript = newScript.replace(/\n$/, '') + '\n' + lscpuCmd;
    }
  }

  // 内存详情：添加 free -h
  if (enhancementLower.includes('内存') && enhancementLower.includes('详情')) {
    const freeCmd = 'echo "=== 内存详情 ===" && free -h';
    if (!currentScript.includes('free -h')) {
      newScript = newScript.replace(/\n$/, '') + '\n' + freeCmd;
    }
  }

  // 进程过滤：添加 grep -v
  if (enhancementLower.includes('过滤') && enhancementLower.includes('进程')) {
    // 假设原脚本有 ps aux，在其后面加 grep -v
    if (currentScript.includes('ps aux')) {
      newScript = currentScript.replace(/ps aux/g, 'ps aux | grep -v "\\[.*\\]"');
    }
  }

  // 如果脚本没有变化，返回 null
  if (newScript === currentScript) {
    return null;
  }

  return newScript;
}

// ==================== 智能脚本增强（AI 根据上下文修改） ====================
function applyScriptEnhancement(title, currentScript, enhancement, agentModel) {
  // 使用 LLM 根据上下文增强脚本
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
  let prompt;
  if (enhancement && enhancement.trim().length > 0) {
    prompt = `你是一个shell脚本专家。只输出脚本代码，不要输出任何解释、思考过程或markdown格式。

当前脚本：
${scriptBody}

用户要求：${enhancement}

直接输出修改后的脚本（保留shebang，只修改body部分）：`;
  } else {
    // enhancement 为空，根据上下文智能判断需要什么增强
    prompt = `你是一个shell脚本专家。只输出脚本代码，不要输出任何解释、思考过程或markdown格式。

当前脚本：
${scriptBody}

用户要求增强此脚本。

直接输出修改后的脚本（保留shebang，只修改body部分）：`;
  }

  try {
    // 使用临时文件传递prompt，避免引号转义问题
    const tmpFile = '/tmp/autoskill_enhance_' + Date.now() + '.txt';
    const credsFile = '/tmp/autoskill_creds_' + Date.now() + '.json';
    writeFileSync(tmpFile, prompt, 'utf-8');
    
    // 获取模型凭证（优先使用传入的 agentModel）
    const creds = getModelCredentials(agentModel || null);
    if (!creds.apiKey || !creds.model) {
      console.log('[DEBUG] LLM enhancement skipped: no valid credentials, apiKey:', !!creds.apiKey, 'model:', creds.model);
      try { unlinkSync(tmpFile); } catch(e) {}
      return null;
    }
    const apiKey = creds.apiKey;
    const baseUrl = creds.baseUrl || 'https://api.minimaxi.com/anthropic';
    const apiType = creds.apiType || 'anthropic';
    
    // 构建请求头并写入临时文件
    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiType === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    if (creds.authHeader) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      headers['x-api-key'] = apiKey;
    }
    writeFileSync(credsFile, JSON.stringify({ headers, baseUrl, apiType, model: creds.model, apiKey }), 'utf-8');
    
    const result = execSync(`python3 -W ignore -c "
import requests
import json
with open('${tmpFile}', 'r') as f:
    prompt = f.read()
with open('${credsFile}', 'r') as f:
    creds = json.load(f)

model = creds.get('model')
if not model:
    print('ERROR')
    sys.exit(0)

if creds.get('apiType') == 'openai':
    # OpenAI 格式
    resp = requests.post(
        creds['baseUrl'] + '/chat/completions',
        headers=creds['headers'],
        json={
            'model': model,
            'max_tokens': 500,
            'messages': [{'role': 'user', 'content': prompt}]
        },
        timeout=15
    )
    data = resp.json()
    choices = data.get('choices', [])
    if choices and len(choices) > 0:
        msg = choices[0].get('message', {})
        content = msg.get('content', '') or msg.get('reasoning_content', '') or ''
        print(content)
    else:
        print('ERROR')
else:
    # Anthropic 格式
    resp = requests.post(
        creds['baseUrl'] + '/v1/messages',
        headers=creds['headers'],
        json={
            'model': model,
            'max_tokens': 500,
            'messages': [{'role': 'user', 'content': prompt}]
        },
        timeout=15
    )
    data = resp.json()
    content = data.get('content', [])
    if content and len(content) > 0:
        # 遍历找到 text 类型
        for c in content:
            if c.get('type') == 'text':
                print(c.get('text', ''))
                break
        else:
            print('ERROR')
    else:
        print('ERROR')
" 2>&1`, { encoding: 'utf-8', timeout: 20000 });

    const trimmed = result.trim();
    if (trimmed === 'ERROR' || !trimmed) {
      console.log('[DEBUG] applyScriptEnhancement: LLM call failed');
      try { unlinkSync(tmpFile); unlinkSync(credsFile); } catch(e) {}
      return currentScript;
    }
    // 清理临时文件
    try { unlinkSync(tmpFile); unlinkSync(credsFile); } catch(e) {}

    // 过滤非脚本内容（移除解释性文字、markdown格式等）
    const lines = trimmed.split('\n');
    const scriptLines = [];
    for (const line of lines) {
      const trimmedLine = line.trim();
      // 跳过空行
      if (!trimmedLine) continue;
      // 跳过 markdown 格式行（如 1. 2. 或 ** 或 - ）
      if (/^\d+\.?\s/.test(trimmedLine) || /^\*\*|^\* |^-\s/.test(trimmedLine)) continue;
      // 跳过包含中文解释的行（可能是 LLM 的解释）
      if (/[\u4e00-\u9fa5]/.test(trimmedLine) && !trimmedLine.startsWith('#') && !trimmedLine.startsWith('echo') && !trimmedLine.startsWith('ssh') && !trimmedLine.startsWith('if')) continue;
      // 跳过包含 markdown 链接或复杂格式的行
      if (trimmedLine.includes('```') || trimmedLine.includes('**') || trimmedLine.includes('`') && trimmedLine.length > 50) continue;
      scriptLines.push(trimmedLine);
    }
    let newBody = scriptLines.join('\n');
    // 如果过滤后是空的或太短，说明解析失败，使用原始输出
    if (newBody.length < 20) {
      console.log('[DEBUG] applyScriptEnhancement: LLM output parsing failed, using raw output');
      newBody = trimmed;
    }
    newBody = newBody.replace(/^#!/,'echo "skip" && #!').split('\n').filter(l => !l.match(/^echo "skip"/)).join('\n');
    const newScript = shebangLines.length > 0
      ? shebangLines.join('\n') + '\n' + newBody
      : newBody;

    console.log('[DEBUG] applyScriptEnhancement: LLM generated new script, length:', newScript.length);
    return newScript;

  } catch(e) {
    console.log('[DEBUG] applyScriptEnhancement error:', e.message);
    if (e.stderr) {
      console.log('[DEBUG] applyScriptEnhancement stderr:', e.stderr.toString().slice(0, 500));
    }
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

  // 获取模型凭证
  const creds = getModelCredentials();
  if (!creds.apiKey || !creds.model) {
    console.log('[DEBUG] daily scan: skipped, no valid credentials, apiKey:', !!creds.apiKey, 'model:', creds.model);
    return;
  }

  try {
    // 构建请求头
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (creds.authHeader) {
      headers['Authorization'] = `Bearer ${creds.apiKey}`;
    } else {
      headers['x-api-key'] = creds.apiKey;
    }

    // 构建Python脚本
    const escapedPrompt = prompt.replace(/'/g, "\\'");
    const modelName = creds.model;
    const pythonScript = `
import requests
import json
resp = requests.post(
    '${creds.baseUrl}/v1/messages',
    headers=${JSON.stringify(headers)},
    json={
        'model': '${modelName}',
        'max_tokens': 2000,
        'messages': [{'role': 'user', 'content': '${escapedPrompt}'}]
    },
    timeout=60
)
# 处理可能包含 thinking 类型的响应
content = resp.json().get('content', [])
for c in content:
    if c.get('type') == 'text':
        print(c.get('text', '')[:4000])
        break
else:
    print('ERROR')
`;

    const result = execSync(`python3 -W ignore -c "${pythonScript}" 2>/dev/null`, { encoding: 'utf-8', timeout: 70000 });

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

  // 获取模型凭证
  const creds = getModelCredentials();
  if (!creds.apiKey || !creds.model) {
    console.log('[DEBUG] analyzeWithModel: skipped, no valid credentials, apiKey:', !!creds.apiKey, 'model:', creds.model);
    return null;
  }

  try {
    // 构建请求头
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (creds.authHeader) {
      headers['Authorization'] = `Bearer ${creds.apiKey}`;
    } else {
      headers['x-api-key'] = creds.apiKey;
    }

    // 构建Python脚本
    const escapedPrompt = prompt.replace(/'/g, "\\'");
    const modelName = creds.model;
    const pythonScript = `
import requests
resp = requests.post(
    '${creds.baseUrl}/v1/messages',
    headers=${JSON.stringify(headers)},
    json={
        'model': '${modelName}',
        'max_tokens': 2000,
        'messages': [{'role': 'user', 'content': '${escapedPrompt}'}]
    },
    timeout=60
)
# 处理可能包含 thinking 类型的响应
content = resp.json().get('content', [])
for c in content:
    if c.get('type') == 'text':
        print(c.get('text', '')[:4000])
        break
else:
    print('ERROR')
`;

    const result = execSync(`python3 -W ignore -c "${pythonScript}" 2>/dev/null`, { encoding: 'utf-8', timeout: 70000 });

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

// ==================== 自动执行脚本 ====================
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
    execSyncWithEnv(`bash "${scriptsDir}/autoskill-hit" ${cardId} 2>&1`, {
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

  const marker = '<<<END_OPENCLAW_INTERNAL_CONTEXT>>>';
  const markerIdx = promptStr.lastIndexOf(marker);
  const searchStr = markerIdx >= 0 ? promptStr.slice(markerIdx + marker.length) : promptStr.slice(-2000);
  const lines = searchStr.split('\n');

  const candidates = [];
  let inJsonBlock = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length === 0) continue;
    const trimmedLower = trimmed.toLowerCase();

    // 跳过 markdown code block 标记
    if (trimmed === '```' || trimmed.startsWith('```json') || trimmed.startsWith('``` ')) continue;

    // 跟踪 JSON 块（metadata 区域）
    if (trimmed === '{') { inJsonBlock = true; continue; }
    if (trimmed === '}') { inJsonBlock = true; continue; }
    if (inJsonBlock && (trimmed.startsWith('"') || /^[a-z_]+:/i.test(trimmed))) continue;
    if (inJsonBlock) inJsonBlock = false;

    // 跳过系统 metadata 行
    if (trimmed.startsWith('[message_id:') ||
        trimmedLower.includes('conversation info') || trimmedLower.includes('(untrusted metadata)') ||
        trimmedLower.includes('sender (untrusted') ||
        trimmedLower.includes('return your response as plain text')) continue;

    // 处理 [时间戳] 用户消息 格式
    if (trimmed.startsWith('[') && trimmed.includes(']')) {
      const bracketIdx = trimmed.indexOf(']');
      const afterBracket = trimmed.slice(bracketIdx + 1).trim();
      if (afterBracket.length > 0 && /[\u4e00-\u9fa5a-zA-Z]/.test(afterBracket)) {
        candidates.push(afterBracket.replace(/[""]$/, '').slice(0, 80));
        continue;
      }
    }

    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(trimmed)) continue;

    // 提取冒号后的内容（如 "Rocky: 下载目录有多少个文件"）
    const colonMatch = trimmed.match(/^[^:]{1,20}:\s*(.+)/);
    if (colonMatch && colonMatch[1].trim().length > 0) {
      candidates.push(colonMatch[1].trim().slice(0, 80));
      continue;
    }

    candidates.push(trimmed.slice(0, 80));
  }

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

// ==================== 有脚本的技能扫描（简化版：不再区分L3） ====================
function getSkillsWithScripts() {
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

        // 简化版：不再检查 level，只要有 skill_script 就认为是可执行技能
        const scriptM = content.match(/^skill_script:\s*"?([^"\n]+)"?/m);
        if (!scriptM || !scriptM[1]) continue;

        const idM = content.match(/^id:\s*(\S+)/m);
        const titleM = content.match(/^title:\s*"?([^"\n]+)"?/m);

        const scriptName = scriptM[1];
        const scriptPath = join(skillsDir, scriptName);

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
      _currentSessionKey = event.sessionKey || null; // 设置当前 sessionKey，供 getModelCredentials 使用
      _currentPrompt = event.prompt || null; // 设置当前 prompt，用于检测 agent
      // 捕获当前 prompt 到局部变量，防止 async 调用期间被新消息覆盖
      const currentPrompt = event.prompt || null;
      _detectedAgentModel = null; // 重置检测到的 model
      if (_currentSessionKey) {
        const agentModel = getAgentModelFromSession(_currentSessionKey);
        if (agentModel) {
          _detectedAgentModel = agentModel;
          console.log('[DEBUG] agent model from session:', agentModel);
        }
      } else if (currentPrompt) {
        // sessionKey 不可用，尝试从 prompt 检测
        const agentModel = detectAgentModelFromPrompt(currentPrompt);
        if (agentModel) {
          _detectedAgentModel = agentModel;
          console.log('[DEBUG] agent model from prompt:', agentModel);
        }
      }
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
      const _msgs = event.messages || [];
      const errorMsg = extractLastError(_msgs);
      // DEBUG: 打印 messages 数组最后2条
      if (_msgs.length > 0) {
        const last2 = _msgs.slice(-2).map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 120) : JSON.stringify(m.content).slice(0, 120) }));
        console.log('[DEBUG] messages last 2:', JSON.stringify(last2));
      }
      const userMsgStr = typeof event.prompt === 'string' ? event.prompt : '';
      // 优先从 messages 数组提取用户消息（更准确），再用 prompt 补充
      let userMsg = extractUserMessageKeywords(_msgs);
      if (!userMsg || userMsg.length < 2) {
        userMsg = extractUserMessageKeywordsFromPrompt(userMsgStr);
      }
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
          const recordOutput = execSyncWithEnv(recordCmd, { encoding: 'utf-8', timeout: 10000 });
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
          const listOutput = execSyncWithEnv(listCmd, { encoding: 'utf-8', timeout: 10000 });
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
          const searchOutput = execSyncWithEnv(searchCmd, { encoding: 'utf-8', timeout: 10000 });
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
          console.log('[DEBUG] hit listCmd:', listCmd.slice(0, 100));
          const listOutput = execSyncWithEnv(listCmd, { encoding: 'utf-8', timeout: 10000 });
          console.log('[DEBUG] hit listOutput:', listOutput.slice(0, 200));
          const idMatch = listOutput.match(/[🟡🔴🟠]\s*\[(\d+)\]/);
          console.log('[DEBUG] hit idMatch:', idMatch ? idMatch[1] : 'NULL');
          if (idMatch) {
            const cardId = idMatch[1];
            const hitCmd = `bash "${scriptsDir}/autoskill-hit" ${cardId} 2>&1`;
            const hitOutput = execSyncWithEnv(hitCmd, { encoding: 'utf-8', timeout: 10000 });
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
        contextModify = detectContextScriptModification(userMsg, event.messages || [], lastExecutedSkill, scriptsDir, skillsDir, currentPrompt);
      }
      if (contextModify) {
        console.log('[DEBUG] context script modification detected:', contextModify.enhancement);
        const { cardId, scriptPath, title, currentScript, enhancement } = contextModify;
        // 根据上下文增强脚本（使用检测到的 agent model，无硬编码）
        const agentModel = _detectedAgentModel;
        const newScript = applyScriptEnhancement(title, currentScript, enhancement, agentModel);
        if (newScript && newScript !== currentScript) {
          // 写回增强后的脚本
          try {
            writeFileSync(scriptPath, newScript, 'utf-8');
            result.prependContext = `💡 已根据上下文增强技能「${title}」：${enhancement}

原脚本已更新，新脚本：

\`\`\`bash
${newScript}
\`\`\`

---
`;
          } catch(e) {
            console.log('[DEBUG] failed to write enhanced script:', e.message);
            result.prependContext = `💡 用户想要增强技能「${title}」：${enhancement}

AI 可选择：执行脚本来验证，或更新脚本，或忽略

---
`;
          }
        } else {
          // 无法增强，通知 AI 处理
          result.prependContext = `💡 用户想要增强技能「${title}」：${enhancement}

AI 可选择：执行脚本来验证，或更新脚本，或忽略

---
`;
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
      const matchedScripts = [];
      const triggerInfo = [];

      if (errorMsg) {
        const keyword = extractErrorKeywords(errorMsg);
        const searchResults = searchCards(scriptsDir, keyword);
        if (searchResults && searchResults.length > 0) {
          const matchingScripts = searchResults.filter(r => r.skill_script);
          matchingScripts.forEach(r => {
            if (!matchedScripts.some(s => s.id === r.id)) {
              matchedScripts.push({ ...r, trigger: 'error', keyword });
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

        // 简化版：不再追踪 hit_count，不再自动晋升
        // 模型根据上下文自行决定如何处理匹配到的技能
        matchedAll.forEach(c => {
          console.log('[DEBUG] matched skill:', c.id, c.title, 'hasScript:', !!c.skill_script);
        });

        // 从有脚本的技能库中匹配
        const matched = cache.skillsWithScripts.filter(s => {
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
          if (!matchedScripts.some(s2 => s2.id === s.id)) {
            matchedScripts.push({ ...s, trigger: 'user', keyword: userMsg });
            triggerInfo.push(`🟡 用户消息: "${userMsg.slice(0, 30)}..."`);
          }
        });

        console.log('[DEBUG] skill match check: matched count:', matched.length, 'matchedScripts:', matchedScripts.length, matchedScripts.map(s=>s.id));

        // 如果没有匹配到任何技能，模型决定是否创建卡片
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
                const recordCmd = `bash "${scriptsDir}/autoskill-record" --title "${safeTitle}" --tool "ai" --problem "${bashEscape(userMsg)}" --solution "待补充" 2>&1`;
                const recordOutput = execSyncWithEnv(recordCmd, { encoding: 'utf-8', timeout: 10000 });
                console.log('[DEBUG] model-driven auto-created card:', decision.reason, recordOutput.slice(0, 100));
                cache.ts = 0;
              } catch(e) {
                console.log('[DEBUG] auto-create failed:', e.message);
              }
            }
          }
        }
      }

      // 执行匹配的脚本
      if (matchedScripts.length > 0) {
        const execResults = [];
        const modelCheckSkills = [];  // 成功率不足90%，交给模型

      for (const r of matchedScripts) {
          const scriptPath = join(skillsDir, r.skill_script);
          console.log('[DEBUG] script loop:', r.id, 'scriptPath:', scriptPath, 'exists:', existsSync(scriptPath));
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
            execSyncWithEnv(`bash "${scriptsDir}/autoskill-log" ${r.id} ${logResult}`, {
              timeout: 5000, encoding: 'utf-8'
            });
          } catch {}
        }

        // 构建 context
        console.log('[DEBUG] building prepend: matchedScripts:', matchedScripts.length, 'execResults:', execResults.length);
        const uniqueTriggers = [...new Set(triggerInfo)].slice(0, 3);
        let prepend = `🔍 auto-skill 检测到 ${matchedScripts.length} 条相关经验:
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
