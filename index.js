/**
 * rocky-auto-skill Plugin v2.7.0
 *
 * 全自动闭环经验系统：
 * 1. 自动检测错误 + 用户问题关键词
 * 2. 自动搜索经验库（L3技能）
 * 3. 自动执行 L3 脚本（成功率≥90%时）
 * 4. 自动注入执行结果到 context
 * 5. 自动 hit 计数（脚本成功时）
 * 6. 自动告知 agent 执行结果
 * 7. 成功率低于90%时交给模型判断
 * 8. 模板脚本优化提示（限频：每天最多3次）
 */

const { execSync } = require('child_process');
const { existsSync, readFileSync, statSync, writeFileSync } = require('fs');
const { join } = require('path');

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
        join(stateDir, 'shared-skills', 'rocky-auto-skill', 'scripts'),
        join(stateDir, 'skills', 'rocky-auto-skill', 'scripts')
      ];
      for (const src of srcDirs) {
        if (existsSync(src)) {
          try {
            execSync('cp -r "' + src + '/*" "' + scriptsDir + '/" 2>/dev/null || true');
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

// ==================== 路径 ====================
function getScriptsDir() {
  const home = process.env.HOME || '/root';
  const stateDir = process.env.OPENCLAW_STATE_DIR || `${home}/.openclaw`;
  const candidates = [join(stateDir, 'skills', 'rocky-auto-skill', 'scripts')];
  const ws = process.env.OPENCLAW_WORKSPACE;
  if (ws) candidates.unshift(join(ws, 'skills', 'rocky-auto-skill', 'scripts'));
  for (const dir of candidates) {
    if (existsSync(join(dir, 'autoskill-search'))) return dir;
  }
  return join(stateDir, 'skills', 'rocky-auto-skill', 'scripts');
}

function getDataDir() {
  const home = process.env.HOME || '/root';
  return process.env.AUTOSKILL_DIR || `${home}/.openclaw/.auto-skill`;
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
  
  // 直接取prompt最后200字符中的非JSON内容
  const lastPart = promptStr.slice(-200);
  const lines = lastPart.split('\n');
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('{') || trimmed.startsWith('```') || trimmed.startsWith('"') || 
        trimmed.includes('Conversation info') || trimmed.includes('timestamp') || 
        trimmed.includes('sender') || trimmed.includes('message_id') ||
        /^[\[\(]\w+\s+\d{4}-\d{2}-\d{2}/.test(trimmed) || /GMT/.test(trimmed)) {
      continue;
    }
    
    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(trimmed)) continue;
    
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      const content = trimmed.slice(colonIdx + 1).trim();
      if (content.length > 0) {
        return content.slice(0, 80);
      }
    }
    
    return trimmed.slice(0, 80);
  }
  
  return '';
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

        // 跳过模板脚本
        if (existsSync(scriptPath)) {
          const sc = readFileSync(scriptPath, 'utf-8');
          if (sc.includes('auto-generated')) continue;
        }

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

// ==================== 模板提示限频 ====================
const TEMPLATE_PROMPT_FILE = join(process.env.HOME || '/root', '.openclaw', '.auto-skill', '.template-prompt-state');

function shouldPromptTemplate() {
  try {
    if (!existsSync(TEMPLATE_PROMPT_FILE)) return true;
    const data = JSON.parse(readFileSync(TEMPLATE_PROMPT_FILE, 'utf-8'));
    const today = new Date().toISOString().slice(0, 10);
    if (data.date !== today) return true;
    return (data.count || 0) < 3;
  } catch {
    return true;
  }
}

function recordTemplatePrompt() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    let data = { date: today, count: 0 };
    try {
      if (existsSync(TEMPLATE_PROMPT_FILE)) {
        data = JSON.parse(readFileSync(TEMPLATE_PROMPT_FILE, 'utf-8'));
        if (data.date !== today) data = { date: today, count: 0 };
      }
    } catch {}
    data.count = (data.count || 0) + 1;
    writeFileSync(TEMPLATE_PROMPT_FILE, JSON.stringify(data));
  } catch {}
}

// ==================== 主逻辑 ====================
module.exports = {
  register(api) {
    console.log("[DEBUG] rocky-auto-skill register called, hooks:", Object.keys(api));
    autoInstall();
    console.log('[DEBUG] autoInstall check done');
    api.on('before_agent_start', (event) => {
      try {
      console.log("[DEBUG] before_agent_start triggered");
      const scriptsDir = getScriptsDir();
      console.log("[DEBUG] scriptsDir:", scriptsDir);
      if (!existsSync(scriptsDir)) { console.log("[DEBUG] scriptsDir not found, return"); return; }

      const dataDir = getDataDir();
      const skillsDir = join(dataDir, 'skills');

      refreshCache();

      const result = {
        prependSystemContext: `💡 经验系统：遇问题搜经验 python3 ${scriptsDir}/autoskill-search "关键词"，解决后记录 bash ${scriptsDir}/autoskill-record --title "标题" --tool "工具" --problem "问题" --solution "方案"`
      };

      // ========== 触发条件：检测到错误 或 用户消息 ==========
      const errorMsg = extractLastError(event.messages || []);
      const userMsgStr = typeof event.prompt === 'string' ? event.prompt : '';
      const userMsg = extractUserMessageKeywordsFromPrompt(userMsgStr);
      console.log("[DEBUG] extracted userMsg:", userMsg, "len:", userMsg ? userMsg.length : 0);
      
      // 两种触发方式都收集 L3 脚本
      const allL3Scripts = [];
      const triggerInfo = [];

      // 方式1：错误触发
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
      console.log("[DEBUG] userMsg check:", userMsg, userMsg.length, cache.l3Skills ? cache.l3Skills.length : 'no cache');
      if (userMsg && userMsg.length > 2) { // 中文3字符起触发（兼容短查询）
        // 从 L3 技能库中匹配
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
        
        console.log("[DEBUG] matched L3 skills:", matched.length, matched.map(s=>s.title));
        matched.forEach(s => {
          if (!allL3Scripts.some(s2 => s2.id === s.id)) {
            allL3Scripts.push({ ...s, trigger: 'user', keyword: userMsg });
            triggerInfo.push(`🟡 用户消息: "${userMsg.slice(0, 30)}..."`);
          }
        });
        console.log("[DEBUG] allL3Scripts after userMsg:", allL3Scripts.length);
      }

      // 执行 L3 脚本（根据成功率决定）
      if (allL3Scripts.length > 0) {
        const execResults = [];
        const modelCheckSkills = [];  // 成功率不足90%，交给模型

        console.log("[DEBUG] allL3Scripts details:", JSON.stringify(allL3Scripts.map(r=>({id:r.id, title:r.title, skill_script:r.skill_script}))));
      for (const r of allL3Scripts) {
          const scriptPath = join(skillsDir, r.skill_script);
          console.log("[DEBUG] scriptPath:", scriptPath, existsSync(scriptPath) ? 'exists' : 'NOT FOUND');
          console.log("[DEBUG] r.id:", r.id, "r.skill_script:", r.skill_script);
          if (!existsSync(scriptPath)) continue;

          // 跳过模板脚本
          try {
            const sc = readFileSync(scriptPath, 'utf-8');
            if (sc.includes('auto-generated')) continue;
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
          console.log("[DEBUG] autoExecuteScript:", scriptPath);
          const execResult = autoExecuteScript(scriptPath, r.id, r.title);
          console.log("[DEBUG] execResult:", execResult.success, execResult.stdout ? execResult.stdout.slice(0,100) : 'none');
          execResults.push({
            id: r.id,
            title: r.title,
            scriptPath,
            trigger: r.trigger,
            ...execResult
          });

          // 记录执行结果（方案E）
          try {
            const logResult = execResult.success ? 'success' : 'failed';
            execSync(`bash "${scriptsDir}/autoskill-log" ${r.id} ${logResult}`, {
              timeout: 5000, encoding: 'utf-8'
            });
          } catch {}
        }

        // 构建 context
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

      // ========== 模板脚本优化提示（限频）==========
      const templates = cache.templates;
      if (templates.length > 0 && shouldPromptTemplate()) {
        const tip = templates.slice(0, 3).map(t =>
          `📝 [${t.id}] "${t.title}" → ${t.scriptPath}\n   问题: ${t.problem}\n   方案: ${t.solution}`
        ).join('\n');

        const ctx = result.prependContext || '';
        result.prependContext = ctx + (ctx ? '\n\n' : '') +
          `🔧 ${templates.length} 个模板脚本待优化（删除 auto-generated 标记后生效）：\n${tip}`;
        recordTemplatePrompt();
      }
      } catch(e) {
        console.log("[DEBUG] HOOK ERROR:", e.message, e.stack);
        return;
      }

      return result;
    });
  }
};
