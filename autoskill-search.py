#!/usr/bin/env python3
"""
rocky-auto-skill v2.4.1
autoskill-searchx - 混合搜索引擎（BM25 + 向量语义 + 缓存 + 有效性）
"""

import json
import os
import re
import sys
import math
import urllib.request
from collections import Counter
from pathlib import Path

DATA_DIR = os.environ.get('AUTOSKILL_DIR', os.path.expanduser('~/.openclaw/.auto-skill'))
CARDS_DIR = os.path.join(DATA_DIR, 'cards')
CACHE_FILE = os.path.join(DATA_DIR, 'embed-cache.json')
EMBED_URL = os.environ.get('AUTOSKILL_EMBED_URL', '')
EMBED_MODEL = os.environ.get('AUTOSKILL_EMBED_MODEL', '')
_AUTO_DETECTED = False

def auto_detect_service():
    """自动探测 LM Studio 或 Ollama embedding 服务"""
    global EMBED_URL, EMBED_MODEL, _AUTO_DETECTED
    if _AUTO_DETECTED:
        return
    _AUTO_DETECTED = True
    if EMBED_URL and EMBED_MODEL:
        return  # 用户手动设置了（两者都必须有）
    # 如果只设置了URL或只设置了MODEL，清空另一个并继续自动探测
    if EMBED_URL or EMBED_MODEL:
        import sys
        print("⚠️ AUTOSKILL_EMBED_URL 和 AUTOSKILL_EMBED_MODEL 必须同时设置，忽略手动配置，自动探测中...", file=sys.stderr)
        EMBED_URL = ''
        EMBED_MODEL = ''

    # 探测 LM Studio
    try:
        req = urllib.request.Request('http://localhost:1234/v1/models')
        with urllib.request.urlopen(req, timeout=2) as resp:
            d = json.loads(resp.read())
            for m in d.get('data', []):
                name = m.get('id', '')
                if 'embed' in name.lower() or 'nomic' in name.lower():
                    EMBED_URL = 'http://localhost:1234/v1/embeddings'
                    EMBED_MODEL = name
                    return
            # 没找到 embedding 模型，用默认
            EMBED_URL = 'http://localhost:1234/v1/embeddings'
            EMBED_MODEL = 'text-embedding-nomic-embed-text-v1.5'
            return
    except Exception:
        pass

    # 探测 Ollama
    try:
        req = urllib.request.Request('http://localhost:11434/api/tags')
        with urllib.request.urlopen(req, timeout=2) as resp:
            d = json.loads(resp.read())
            for m in d.get('models', []):
                name = m.get('name', '')
                if 'embed' in name.lower() or 'nomic' in name.lower() or 'bge' in name.lower():
                    EMBED_URL = 'http://localhost:11434/v1/embeddings'
                    EMBED_MODEL = name
                    return
            # Ollama 在运行但没 embedding 模型
            return
    except Exception:
        pass

# ============ 分词 ============

def tokenize(text):
    text = text.lower()
    en_tokens = re.findall(r'[a-z0-9]+', text)
    cn_chars = re.findall(r'[\u4e00-\u9fff]', text)
    cn_bigrams = [cn_chars[i]+cn_chars[i+1] for i in range(len(cn_chars)-1)] if len(cn_chars) > 1 else cn_chars
    return en_tokens + cn_bigrams

# ============ 缓存 ============

def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE) as f:
            return json.load(f)
    return {}

def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f)

def check_vector_available():
    """检查向量搜索是否可用"""
    auto_detect_service()
    if not EMBED_URL or not EMBED_MODEL:
        return False
    try:
        req = urllib.request.Request(
            EMBED_URL,
            data=json.dumps({"input": "test", "model": EMBED_MODEL}).encode(),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            d = json.loads(resp.read())
            return bool(d.get('data'))
    except Exception:
        return False

def get_query_embedding(query):
    cache = load_cache()
    cache_key = f"__query__{query}"
    if cache_key in cache:
        return cache[cache_key]
    try:
        req = urllib.request.Request(
            EMBED_URL,
            data=json.dumps({"input": query, "model": EMBED_MODEL}).encode(),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            d = json.loads(resp.read())
            emb = d['data'][0]['embedding']
        query_keys = [k for k in cache if k.startswith("__query__")]
        if len(query_keys) > 20:
            for k in sorted(query_keys)[:10]:
                del cache[k]
        cache[cache_key] = emb
        save_cache(cache)
        return emb
    except Exception as e:
        return None

def get_card_embeddings():
    cache = load_cache()
    results = {}
    for fpath in sorted(Path(CARDS_DIR).glob('*.yaml')):
        with open(fpath) as f:
            content = f.read()
        id_m = re.search(r'^id: (\S+)', content, re.M)
        if not id_m:
            continue
        card_id = id_m.group(1)
        card_mtime = os.path.getmtime(fpath)
        cache_key = f"card_{card_id}"
        if cache_key in cache:
            cached = cache[cache_key]
            if cached.get('mtime', 0) >= card_mtime:
                results[card_id] = {'embedding': cached['embedding'], 'path': str(fpath), 'content': content}
                continue
        m = re.search(r'embedding: \[([\d\s,.\-e]+)\]', content)
        if m:
            emb = [float(x) for x in m.group(1).split(',') if x.strip()]
            cache[cache_key] = {'embedding': emb, 'mtime': card_mtime}
            results[card_id] = {'embedding': emb, 'path': str(fpath), 'content': content}
    save_cache(cache)
    return results

# ============ BM25 ============

class BM25:
    def __init__(self, documents):
        self.documents = documents
        self.doc_count = len(documents)
        self.avg_len = sum(len(d['tokens']) for d in documents) / max(self.doc_count, 1)
        self.df = Counter()
        for doc in documents:
            for t in set(doc['tokens']):
                self.df[t] += 1

    def score(self, query_tokens, doc_id):
        doc = next((d for d in self.documents if d['id'] == doc_id), None)
        if not doc:
            return 0
        tf = Counter(doc['tokens'])
        doc_len = len(doc['tokens'])
        k1, b = 1.5, 0.75
        score = 0
        for qt in query_tokens:
            if qt not in tf:
                continue
            n = self.df.get(qt, 0)
            idf = math.log((self.doc_count - n + 0.5) / (n + 0.5) + 1)
            freq = tf[qt]
            tf_score = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * doc_len / self.avg_len))
            score += idf * tf_score
        return score

# ============ 余弦相似度 ============

def cosine_similarity(a, b):
    dot = sum(x*y for x,y in zip(a,b))
    norm_a = sum(x*x for x in a) ** 0.5
    norm_b = sum(x*x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0
    return dot / (norm_a * norm_b)

# ============ 元数据提取 ============

def extract_yaml_field(content, field):
    m = re.search(rf'^{field}: \|\n((?:  .*\n)*)', content, re.M)
    if m:
        return m.group(1).strip().replace('\n  ', ' ')
    return ""

def get_card_meta(content):
    def get(pattern):
        m = re.search(pattern, content, re.M)
        return m.group(1) if m else ""
    return {
        'level': get(r'^level: (\S+)') or 'L1',
        'hit_count': int(get(r'^hit_count: (\d+)') or '0'),
        'status': get(r'^status: (\S+)') or 'active',
        'last_hit': get(r'^last_hit_at: (\S+)') or '',
        'type': get(r'^type: (\S+)') or 'experience',
        'source': get(r'^source: (\S+)') or '',
    }

def format_effectiveness(meta):
    """格式化有效性标签"""
    tags = []
    level = meta['level']
    hits = meta['hit_count']
    status = meta['status']
    ctype = meta['type']

    # 类型标签
    if ctype == 'pitfall':
        tags.append('⚠️踩坑')

    # 级别标签
    level_icons = {'L1': '🟡', 'L2': '🟠', 'L3': '🔴'}
    tags.append(f"{level_icons.get(level, '🟡')}{level}")

    # 有效性判断
    if status == 'expired':
        tags.append('❌已失效')
    elif status == 'review':
        tags.append('🔍待审查')
    elif hits == 0:
        tags.append('🆕未验证')
    elif hits == 1:
        tags.append('🔄验证中')
    elif hits >= 2:
        tags.append(f'✅已验证({hits}次)')

    if level == 'L3' and hits >= 3:
        tags.append('🤖可自动')

    return ' '.join(tags)

# ============ 混合搜索 ============

def hybrid_search(query, top_k=5, bm25_weight=0.3, vector_weight=0.7):
    cards = {}
    docs = []
    for fpath in sorted(Path(CARDS_DIR).glob('*.yaml')):
        with open(fpath) as f:
            content = f.read()
        id_m = re.search(r'^id: (\S+)', content, re.M)
        title_m = re.search(r'^title: "?([^"\n]+)"?', content, re.M)
        if not id_m:
            continue
        card_id = id_m.group(1)
        title = title_m.group(1) if title_m else ""
        problem = extract_yaml_field(content, 'problem')
        solution = extract_yaml_field(content, 'solution')
        prevention = extract_yaml_field(content, 'prevention')
        text = f"{title} {problem} {solution} {prevention}"
        cards[card_id] = {'path': str(fpath), 'content': content, 'title': title, 'text': text}
        docs.append({'id': card_id, 'tokens': tokenize(text)})

    if not docs:
        return [], False

    query_tokens = tokenize(query)

    bm25 = BM25(docs)
    bm25_scores = {}
    if query_tokens:
        for doc in docs:
            s = bm25.score(query_tokens, doc['id'])
            if s > 0:
                bm25_scores[doc['id']] = s

    vector_available = check_vector_available()

    vector_scores = {}
    if vector_available:
        query_emb = get_query_embedding(query)
        if query_emb:
            card_embs = get_card_embeddings()
            for card_id, data in card_embs.items():
                sim = cosine_similarity(query_emb, data['embedding'])
                if sim > 0.3:
                    vector_scores[card_id] = sim
    elif not query_tokens:
        # 无关键词也无向量，无法搜索
        return [], False
    else:
        # 降级为纯 BM25，调整权重
        bm25_weight = 1.0
        vector_weight = 0.0

    all_ids = set(bm25_scores.keys()) | set(vector_scores.keys())
    results = []
    max_bm25 = max(bm25_scores.values()) if bm25_scores else 1
    max_vector = max(vector_scores.values()) if vector_scores else 1

    has_any_bm25 = len(bm25_scores) > 0

    for card_id in all_ids:
        b_score = bm25_scores.get(card_id, 0) / max_bm25 if max_bm25 > 0 else 0
        v_score = vector_scores.get(card_id, 0) / max_vector if max_vector > 0 else 0

        if bm25_scores.get(card_id, 0) > 0 and vector_scores.get(card_id, 0) > 0:
            # 双命中：混合得分
            final = bm25_weight * b_score + vector_weight * v_score
        elif b_score > 0:
            # 只有 BM25：略微打折
            final = b_score * 0.8
        else:
            # 只有向量：重度惩罚（embedding对无关内容也可能给高分，需保守；向量分数需≥1.33才能通过0.4阈值，实际不可能）
            final = v_score * (0.5 if has_any_bm25 else 0.3)

        results.append({
            'id': card_id,
            'score': final,
            'bm25': b_score,
            'vector': v_score,
            'title': cards.get(card_id, {}).get('title', '?'),
            'path': cards.get(card_id, {}).get('path', ''),
            'content': cards.get(card_id, {}).get('content', ''),
        })

    results.sort(key=lambda x: x['score'], reverse=True)
    # 过滤掉低分结果（最终得分 < 0.3 认为不相关）
    results = [r for r in results if r['score'] >= 0.4]
    return results[:top_k], vector_available

# ============ 主入口 ============

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='rocky-auto-skill 混合搜索')
    parser.add_argument('query', nargs='?', help='搜索关键词')
    parser.add_argument('--all', action='store_true', help='查看全部')
    parser.add_argument('--top', type=int, default=5, help='返回数量（默认5）')
    parser.add_argument('--json', action='store_true', help='JSON输出')
    parser.add_argument('--with-embed', action='store_true', help='JSON输出包含embedding向量')
    parser.add_argument('--rebuild-cache', action='store_true', help='重建缓存')
    args = parser.parse_args()

    if args.rebuild_cache:
        if os.path.exists(CACHE_FILE):
            os.remove(CACHE_FILE)
        get_card_embeddings()
        print("✅ 缓存已重建")
        sys.exit(0)

    if args.all:
        for fpath in sorted(Path(CARDS_DIR).glob('*.yaml')):
            with open(fpath) as f:
                content = f.read()
            meta = get_card_meta(content)
            id_m = re.search(r'^id: (\S+)', content, re.M)
            title_m = re.search(r'^title: "?([^"\n]+)"?', content, re.M)
            cid = id_m.group(1) if id_m else "?"
            title = title_m.group(1) if title_m else "?"
            eff = format_effectiveness(meta)
            print(f"[{cid}] {title}")
            print(f"   {eff}")
        sys.exit(0)

    if not args.query:
        print("❌ 请提供搜索关键词", file=sys.stderr)
        sys.exit(1)

    results, vector_available = hybrid_search(args.query, top_k=args.top)

    if args.json:
        # JSON 输出时移除 embedding 向量（太大，按需用 --with-embed）
        if not args.with_embed:
            for r in results:
                r.pop('embedding', None)
        print(json.dumps(results, ensure_ascii=False, indent=2))
        sys.exit(0)

    if not results:
        print(f"❌ 没有找到与 '{args.query}' 相关的卡片")
        sys.exit(0)

    search_mode = "BM25关键词搜索"
    if vector_available:
        has_vector = any(r['vector'] > 0 for r in results)
        has_bm25 = any(r['bm25'] > 0 for r in results)
        if has_vector and has_bm25:
            search_mode = "混合搜索（BM25+向量）"
        elif has_vector:
            search_mode = "向量搜索"
        else:
            search_mode = "BM25关键词搜索"
    else:
        search_mode = "BM25关键词搜索（本地 embedding 服务不可用）"

    print(f"🔍 {search_mode} '{args.query}'：")
    print("=" * 40)

    for r in results:
        pct = int(r['score'] * 100)
        methods = []
        if r['bm25'] > 0:
            methods.append(f"BM25:{int(r['bm25']*100)}%")
        if r['vector'] > 0:
            methods.append(f"向量:{int(r['vector']*100)}%")
        method_str = " | ".join(methods)

        content = r.get('content', '')
        meta = get_card_meta(content) if content else {}
        eff = format_effectiveness(meta)

        print(f"[{r['id']}] {r['title']} (匹配度: {pct}%)")
        print(f"   有效性: {eff}")
        print(f"   匹配方式: {method_str}")

        if content:
            problem = extract_yaml_field(content, 'problem')
            solution = extract_yaml_field(content, 'solution')
            prevention = extract_yaml_field(content, 'prevention')
            if problem:
                print(f"   问题: {problem[:80]}")
            if solution:
                print(f"   方案: {solution[:80]}")
            if prevention:
                print(f"   预防: {prevention[:80]}")
        print()
