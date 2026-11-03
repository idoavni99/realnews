#!/usr/bin/env python3
"""Daily news pipeline: fetch RSS -> extract full text -> cluster stories -> site/data.json.

Stdlib only, so it runs anywhere (GitHub Actions) with no dependencies.

Coverage semantics (product contract):
- A source's political side comes only from sources.yaml, confirmed by the owner.
- monitored_sides = sides with at least one source that fetched OK in this run.
- A side with healthy sources but no articles on a story is "no coverage found".
- A side with no healthy sources (or no confirmed label) is NOT part of the
  percentage at all - the UI shows it as "not monitored", never as 0%.
"""
import gzip, html, json, os, re, sys, time, urllib.parse, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone

UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIRMED_SIDES = ('right', 'center', 'left')

def http_get(url, timeout=25):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'he-IL,he;q=0.9',
        'Accept-Encoding': 'gzip'})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308) and e.headers.get('Location'):
            return http_get(urllib.parse.urljoin(url, e.headers['Location']), timeout)
        raise
    with resp as r:
        data = r.read()
        if r.headers.get('Content-Encoding') == 'gzip' or data[:2] == b'\x1f\x8b':
            data = gzip.decompress(data)
        return data.decode('utf-8', errors='ignore')

def load_config():
    srcs, cur, opts = [], None, {}
    for line in open(os.path.join(ROOT, 'sources.yaml'), encoding='utf-8'):
        if line.startswith('  - id:'):
            cur = {'id': line.split(':', 1)[1].strip()}; srcs.append(cur)
        elif cur is not None and line.startswith('    ') and ':' in line:
            k, v = line.strip().split(':', 1)
            cur[k.strip()] = v.strip()
        elif ':' in line and not line.startswith((' ', '#')):
            k, v = line.split(':', 1)
            opts[k.strip()] = v.strip()
    return srcs, opts

def parse_feed(xml_text, source):
    items = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items
    for it in root.iter('item'):
        def t(tag):
            el = it.find(tag)
            return (el.text or '').strip() if el is not None and el.text else ''
        title = html.unescape(t('title'))
        link = t('link')
        desc = re.sub(r'<[^>]+>', '', t('description')).strip()
        if title and link:
            items.append({'source': source['id'], 'source_name': source['name'],
                          'side': source.get('side', 'unknown'), 'title': title,
                          'url': link, 'summary': html.unescape(desc)[:600],
                          'published': t('pubDate')})
    return items

STOP = set(('של את על עם אל מה כי לא הוא היא זה זאת גם או אם כל כך אחרי לפני נגד בין אצל תחת מול יחד אבל רק עוד כבר '
            'יהיה היו היה אני אתה הם אנחנו לי לו לה לך לנו מהם אותו אותה אותם יש אין כאן שם הזה הזאת אומר אמר אמרו '
            'in the a an of to and for on at by from with as is are was were').split())

def norm_tokens(title):
    t = re.sub(r'[^\w\s]', ' ', title, flags=re.UNICODE)
    out = set()
    for w in t.split():
        w = w.strip('״"׳\'')
        if len(w) > 3 and w[0] in 'והבלמש':  # strip common Hebrew prefixes on long tokens
            w = w[1:]
        if len(w) > 1 and w.lower() not in STOP:
            out.add(w)
    return out

def cluster(items, threshold=0.45):
    clusters = []
    for it in items:
        toks = norm_tokens(it['title'] + ' ' + it['summary'][:120])
        best, best_sim = None, 0.0
        for c in clusters:
            # containment: how much of the smaller token set is shared
            denom = min(len(toks), len(c['tokens'])) or 1
            sim = len(toks & c['tokens']) / denom
            if sim > best_sim:
                best, best_sim = c, sim
        if best is not None and best_sim >= threshold:
            best['items'].append(it); best['tokens'] |= toks
        else:
            clusters.append({'tokens': set(toks), 'items': [it]})
    for c in clusters:
        del c['tokens']
    return clusters

def extract_fulltext(url, title):
    """Return (text, status). status: full | partial | lead_only.
    Validates the body is real article text, not boilerplate: needs a minimum
    length and token overlap with the article title/summary."""
    try:
        page = http_get(url)
    except Exception:
        return '', 'lead_only'
    body = ''
    m = re.search(r'"articleBody"\s*:\s*"(.*?)"\s*[,}]', page, re.S)
    if m:
        raw = m.group(1)
        try:
            body = json.loads('"' + raw + '"')
        except Exception:
            body = raw
        body = re.sub(r'\s+', ' ', body).strip()
    if not body:
        txt = re.sub(r'<script.*?</script>|<style.*?</style>', '', page, flags=re.S)
        txt = re.sub(r'<[^>]+>', ' ', txt)
        body = re.sub(r'\s+', ' ', txt).strip()
    overlap = len(norm_tokens(title) & norm_tokens(body[:1500]))
    if len(body) >= 400 and overlap >= 2:
        return body[:4000], 'full'
    if len(body) >= 200 and overlap >= 1:
        return body[:1500], 'partial'
    return '', 'lead_only'

def story_summary(cluster_items):
    best = max(cluster_items, key=lambda i: len(i.get('fulltext') or i['summary']))
    return (best.get('fulltext') or best['summary'])[:400]

def main():
    srcs, opts = load_config()
    max_per = int(opts.get('max_articles_per_source', 15))
    items, source_health = [], {}
    for s in srcs:
        try:
            got = parse_feed(http_get(s['rss']), s)[:max_per]
            items += got
            source_health[s['id']] = {'ok': len(got) > 0, 'items': len(got),
                                      'side': s.get('side', 'unknown'), 'name': s['name']}
            print(f"{s['id']}: {len(got)} items", file=sys.stderr)
        except Exception as e:
            source_health[s['id']] = {'ok': False, 'items': 0,
                                      'side': s.get('side', 'unknown'), 'name': s['name']}
            print(f"{s['id']}: FAILED {e}", file=sys.stderr)
    for it in items:
        it['fulltext'], it['extraction'] = extract_fulltext(it['url'], it['title'])
        time.sleep(0.4)
    monitored_sides = sorted({h['side'] for h in source_health.values()
                              if h['ok'] and h['side'] in CONFIRMED_SIDES})
    stories = []
    for c in cluster(items):
        counts = {}
        for i in c['items']:
            if i['side'] in monitored_sides:
                counts[i['side']] = counts.get(i['side'], 0) + 1
        stories.append({
            'headline': max(c['items'], key=lambda i: len(i['title']))['title'],
            'summary': story_summary(c['items']),
            'counts': counts,
            'total': len(c['items']),
            'articles': [{'source': i['source_name'], 'side': i['side'],
                          'title': i['title'], 'url': i['url'],
                          'extraction': i['extraction'],
                          'summary': i['summary'][:300]} for i in c['items']],
        })
    stories.sort(key=lambda s: -s['total'])
    out = {'generated_at': datetime.now(timezone.utc).isoformat(),
           'window_hours': int(opts.get('window_hours', 24)),
           'monitored_sides': monitored_sides,
           'source_health': source_health,
           'stories': stories[:30]}
    dest = os.path.join(ROOT, 'site', 'data.json')
    json.dump(out, open(dest, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    n_full = sum(1 for i in items if i['extraction'] == 'full')
    print(f"wrote {len(stories)} stories, {len(items)} items ({n_full} full-text) -> {dest}", file=sys.stderr)

if __name__ == '__main__':
    main()
