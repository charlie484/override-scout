#!/usr/bin/env python3
"""Build the season snapshot that powers Override Scout.

Runs on a schedule in GitHub Actions (see .github/workflows/deploy.yml). It downloads every V5RC
event, match, ranking, skills run and award for the current season from the official VEX Events
API, then computes TrueSkill ratings plus OPR / DPR / CCWM and writes compact JSON files the app reads.

    VEX_API_TOKEN=...  python scripts/build_data.py --out data
    python scripts/build_data.py --fixture --out test-data     # synthetic data for local UI testing

Only the Python standard library is used.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = 'https://events.vex.com/api/v2'
PROGRAM_IDS = {'V5RC': 1, 'VIQRC': 41, 'VEXU': 4}
ROUND_ORDER = {1: 0, 2: 1, 16: 1, 9: 2, 8: 3, 7: 4, 6: 5, 3: 6, 4: 7, 5: 8, 15: 9}
UA = 'OverrideScout-DataBuilder/1.0 (+team 1940D)'

NOW = dt.datetime.now(dt.timezone.utc)


def log(*a):
    print(*a, flush=True)


def parse_time(s):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# API client with polite rate limiting and an on-disk cache
# ---------------------------------------------------------------------------
class Api:
    def __init__(self, token: str, min_interval: float = 0.35):
        self.token = token
        self.min_interval = min_interval
        self.last = 0.0
        self.calls = 0

    def get(self, path: str, params: dict | None = None, attempt: int = 0):
        q = []
        for k, v in (params or {}).items():
            if v is None:
                continue
            if isinstance(v, (list, tuple)):
                q += [(k if k.endswith('[]') else k + '[]', str(x)) for x in v]
            else:
                q.append((k, str(v).lower() if isinstance(v, bool) else str(v)))
        url = API + path + ('?' + urllib.parse.urlencode(q) if q else '')
        wait = self.min_interval - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json', 'User-Agent': UA})
        self.last = time.time()
        self.calls += 1
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                remaining = res.headers.get('x-ratelimit-remaining')
                if remaining is not None and remaining.isdigit() and int(remaining) < 5:
                    time.sleep(3)
                return json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 6:
                ra = e.headers.get('retry-after')
                delay = int(ra) if ra and ra.isdigit() else 10 * (attempt + 1)
                log(f'  rate limited, waiting {delay}s')
                time.sleep(delay)
                return self.get(path, params, attempt + 1)
            if e.code >= 500 and attempt < 3:
                time.sleep(3 * (attempt + 1))
                return self.get(path, params, attempt + 1)
            if e.code == 404:
                return None
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
                return self.get(path, params, attempt + 1)
            raise

    def all(self, path: str, params: dict | None = None):
        params = dict(params or {})
        params['per_page'] = 250
        out, page = [], 1
        while True:
            params['page'] = page
            r = self.get(path, params)
            if not r:
                break
            out += r.get('data', [])
            meta = r.get('meta') or {}
            if page >= (meta.get('last_page') or 1):
                break
            page += 1
        return out


class Cache:
    def __init__(self, root: str):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def path(self, key):
        return os.path.join(self.root, key + '.json')

    def load(self, key):
        try:
            with open(self.path(key), encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def save(self, key, value):
        with open(self.path(key), 'w', encoding='utf-8') as f:
            json.dump(value, f, separators=(',', ':'))


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------
def fetch_season(api: Api, program: str):
    r = api.get('/seasons', {'program[]': [PROGRAM_IDS[program]], 'active': True}) or {}
    seasons = sorted(r.get('data', []), key=lambda s: s['id'], reverse=True)
    if not seasons:
        raise SystemExit('No active season found')
    return seasons[0]


def fetch_event_bundle(api: Api, ev: dict, cache: Cache, teams_only=False):
    """Download everything for one event (teams, matches, rankings, skills, awards)."""
    eid = ev['id']
    bundle = {'fetched': NOW.isoformat(), 'event': ev}
    bundle['teams'] = api.all(f'/events/{eid}/teams')
    if teams_only:
        bundle['teams_only'] = True
        return bundle
    bundle['divisions'] = []
    for d in ev.get('divisions') or []:
        matches = api.all(f'/events/{eid}/divisions/{d["id"]}/matches')
        rankings = api.all(f'/events/{eid}/divisions/{d["id"]}/rankings')
        bundle['divisions'].append({'id': d['id'], 'name': d.get('name'), 'matches': matches, 'rankings': rankings})
    bundle['skills'] = api.all(f'/events/{eid}/skills')
    bundle['awards'] = api.all(f'/events/{eid}/awards')
    end = parse_time(ev.get('end')) or parse_time(ev.get('start'))
    bundle['final'] = bool(end and (NOW - end).days >= 5)
    return bundle


def gather_live(api: Api, program: str, cache: Cache, max_events: int | None):
    season = fetch_season(api, program)
    sid = season['id']
    log(f'Season {sid}: {season["name"]}')
    events = api.all(f'/seasons/{sid}/events')
    log(f'{len(events)} events in season')
    cache.save(f'season_{program}', season)
    cache.save(f'events_{sid}', events)
    bundles = {}
    fetched = 0
    for ev in sorted(events, key=lambda e: e.get('start') or ''):
        start, end = parse_time(ev.get('start')), parse_time(ev.get('end')) or parse_time(ev.get('start'))
        key = f'ev_{ev["id"]}'
        cached = cache.load(key)
        if start and start > NOW:
            # upcoming: refresh the team list daily for events in the next 3 weeks
            if (start - NOW).days <= 21:
                if not cached or (NOW - parse_time(cached['fetched'])).total_seconds() > 86400:
                    cached = fetch_event_bundle(api, ev, cache, teams_only=True)
                    cache.save(key, cached)
                    fetched += 1
            if cached:
                cached['event'] = ev
                bundles[ev['id']] = cached
            continue
        recent = end is None or (NOW - end).days < 5
        if cached and cached.get('final') and not cached.get('teams_only') and not recent:
            bundles[ev['id']] = cached
            continue
        if max_events is not None and fetched >= max_events:
            if cached:
                bundles[ev['id']] = cached
            continue
        log(f'  fetching {ev["sku"]} {ev["name"][:60]}')
        b = fetch_event_bundle(api, ev, cache)
        cache.save(key, b)
        bundles[ev['id']] = b
        fetched += 1
    # registered teams (refresh daily)
    teams = cache.load(f'teams_{sid}')
    if not teams or (NOW - parse_time(teams['fetched'])).total_seconds() > 86400:
        log('Fetching registered teams')
        teams = {'fetched': NOW.isoformat(), 'list': api.all('/teams', {'program[]': [PROGRAM_IDS[program]], 'registered': True})}
        cache.save(f'teams_{sid}', teams)
    qa = api.get(f'/seasons/{sid}/qa')
    judging = api.get('/judging/qa')
    if qa:
        cache.save(f'qa_{sid}', qa)
    if judging:
        cache.save('qa_judging', judging)
    log(f'API calls this run: {api.calls}')
    return season, events, bundles, teams['list'], qa, judging


def gather_cached(program: str, cache: Cache):
    """Rebuild from the on-disk cache only (used when the API is unreachable)."""
    season = cache.load(f'season_{program}')
    if not season:
        raise SystemExit('No cached data to fall back on')
    sid = season['id']
    events = cache.load(f'events_{sid}') or []
    bundles = {}
    for e in events:
        b = cache.load(f'ev_{e["id"]}')
        if b:
            bundles[e['id']] = b
    teams = (cache.load(f'teams_{sid}') or {}).get('list', [])
    log(f'Rebuilding from cache: {len(bundles)} events')
    return season, events, bundles, teams, cache.load(f'qa_{sid}'), cache.load('qa_judging')


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
MU, SIGMA = 25.0, 25.0 / 3
BETA, TAU, DRAW_P = 25.0 / 6, 25.0 / 300, 0.02


def cdf(x):
    return 0.5 * math.erfc(-x / math.sqrt(2))


def pdf(x):
    return math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def ppf(p):
    lo, hi = -10.0, 10.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if cdf(mid) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def v_win(t, e):
    x = t - e
    d = cdf(x)
    return -x if d < 1e-300 else pdf(x) / d


def w_win(t, e):
    v = v_win(t, e)
    return v * (v + t - e)


def v_draw(t, e):
    a, b = e - t, -e - t
    d = cdf(a) - cdf(b)
    if d < 1e-300:
        return (-t - e) if t < 0 else (-t + e)
    return (pdf(b) - pdf(a)) / d


def w_draw(t, e):
    a, b = e - t, -e - t
    d = cdf(a) - cdf(b)
    if d < 1e-300:
        return 1.0
    v = v_draw(t, e)
    return v * v + (a * pdf(a) - b * pdf(b)) / d


def rate(red, blue, outcome):
    """TrueSkill update for two teams of players (lists of [mu, sigma]). outcome: 1 red, -1 blue, 0 tie."""
    players = red + blue
    s2 = [p[1] ** 2 + TAU ** 2 for p in players]
    n = len(players)
    c2 = sum(s2) + n * BETA ** 2
    c = math.sqrt(c2)
    eps = ppf((DRAW_P + 1) / 2) * math.sqrt(n) * BETA / c
    win, lose = (blue, red) if outcome < 0 else (red, blue)
    sw = s2[len(red):] if outcome < 0 else s2[:len(red)]
    sl = s2[:len(red)] if outcome < 0 else s2[len(red):]
    t = (sum(p[0] for p in win) - sum(p[0] for p in lose)) / c
    v = v_draw(t, eps) if outcome == 0 else v_win(t, eps)
    w = w_draw(t, eps) if outcome == 0 else w_win(t, eps)
    for p, s in zip(win, sw):
        p[0] += s / c * v
        p[1] = math.sqrt(s * max(1e-4, 1 - s / c2 * w))
    for p, s in zip(lose, sl):
        p[0] -= s / c * v
        p[1] = math.sqrt(s * max(1e-4, 1 - s / c2 * w))


def side(match, color):
    for a in match.get('alliances') or []:
        if a.get('color') == color:
            teams = [t['team']['name'] for t in a.get('teams') or [] if t.get('team')]
            sit = [t['team']['name'] for t in a.get('teams') or [] if t.get('team') and t.get('sitting')]
            return teams, sit, a.get('score') or 0
    return [], [], 0


def played(m):
    r, _, rs = side(m, 'red')
    b, _, bs = side(m, 'blue')
    return bool(m.get('scored')) or rs > 0 or bs > 0


def solve_opr(quals):
    """Least-squares OPR / DPR / CCWM for one division. Returns {team: (opr, dpr, ccwm)}."""
    idx, rows = {}, []
    for m in quals:
        for own, opp in (('red', 'blue'), ('blue', 'red')):
            teams, sit, s = side(m, own)
            _, _, o = side(m, opp)
            ts = [t for t in teams if t not in sit]
            for t in ts:
                idx.setdefault(t, len(idx))
            rows.append(([idx[t] for t in ts], s, o))
    n = len(idx)
    if n == 0:
        return {}
    A = [[0.0] * n for _ in range(n)]
    bs, bo, bm = [0.0] * n, [0.0] * n, [0.0] * n
    for ids, s, o in rows:
        for i in ids:
            for j in ids:
                A[i][j] += 1
            bs[i] += s
            bo[i] += o
            bm[i] += s - o
    for i in range(n):
        A[i][i] += 0.05
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = A[i][j] - sum(L[i][k] * L[j][k] for k in range(j))
            L[i][j] = math.sqrt(max(s, 1e-9)) if i == j else s / L[j][j]

    def solve(b):
        y = [0.0] * n
        for i in range(n):
            y[i] = (b[i] - sum(L[i][k] * y[k] for k in range(i))) / L[i][i]
        x = [0.0] * n
        for i in reversed(range(n)):
            x[i] = (y[i] - sum(L[k][i] * x[k] for k in range(i + 1, n))) / L[i][i]
        return x

    o, d, c = solve(bs), solve(bo), solve(bm)
    return {t: (o[i], d[i], c[i]) for t, i in idx.items()}


def compact_match(m, event_id):
    rt, rx, rs = side(m, 'red')
    bt, bx, bs = side(m, 'blue')
    c = {'i': m['id'], 'e': event_id, 'd': (m.get('division') or {}).get('id'), 'r': m.get('round'), 'n': m.get('instance'),
         'm': m.get('matchnum'), 'rt': rt, 'bt': bt, 'rs': rs, 'bs': bs}
    if m.get('scored'):
        c['sc'] = 1
    if m.get('scheduled'):
        c['s'] = m['scheduled']
    if m.get('started'):
        c['st'] = m['started']
    if m.get('field'):
        c['f'] = m['field']
    if rx:
        c['rx'] = rx
    if bx:
        c['bx'] = bx
    return c


def slim_event(ev):
    loc = ev.get('location') or {}
    return {
        'id': ev['id'], 'sku': ev.get('sku'), 'name': ev.get('name'), 'start': ev.get('start'), 'end': ev.get('end'),
        'level': ev.get('level'), 'event_type': ev.get('event_type'), 'ongoing': ev.get('ongoing', False),
        'season': ev.get('season'), 'program': ev.get('program'),
        'divisions': [{'id': d['id'], 'name': d.get('name'), 'order': d.get('order')} for d in ev.get('divisions') or []],
        'location': {k: loc.get(k) for k in ('venue', 'address_1', 'city', 'region', 'postcode', 'country', 'coordinates')}
    }


def slim_team(t):
    loc = t.get('location') or {}
    return {'id': t.get('id'), 'number': t.get('number'), 'team_name': t.get('team_name'), 'robot_name': t.get('robot_name'),
            'organization': t.get('organization'), 'grade': t.get('grade'),
            'location': {k: loc.get(k) for k in ('city', 'region', 'country')}}


def build(season, events, bundles, teams, qa, judging, out, program):
    pdir = os.path.join(out, program.lower())
    for sub in ('team', 'event'):
        os.makedirs(os.path.join(pdir, sub), exist_ok=True)
    os.makedirs(os.path.join(out, 'qa'), exist_ok=True)
    ev_by_id = {e['id']: e for e in events}

    # ---- collect matches chronologically ----
    entries = []
    for eid, b in bundles.items():
        ev = ev_by_id.get(eid) or b['event']
        start = ev.get('start') or ''
        for d in b.get('divisions') or []:
            for m in d.get('matches') or []:
                m.setdefault('division', {'id': d['id'], 'name': d.get('name')})
                entries.append((start, eid, m.get('started') or m.get('scheduled') or '', ROUND_ORDER.get(m.get('round'), 10),
                                m.get('instance') or 0, m.get('matchnum') or 0, m))
    # chronological by event, then by match time / round within the event
    entries.sort(key=lambda x: x[:6])
    log(f'{len(entries)} matches')

    ratings, rec, hist = {}, {}, {}
    team_matches, team_events = {}, {}
    last_event_of = {}

    def r_of(t):
        if t not in ratings:
            ratings[t] = [MU, SIGMA]
        return ratings[t]

    def note_event_end(eid):
        for t in event_teams.get(eid, ()):
            hist.setdefault(t, []).append([eid, round(ratings[t][0] - 3 * ratings[t][1], 2)])

    event_teams = {}
    prev_event = None
    for start, eid, _, _, _, _, m in entries:
        rt, rx, rs = side(m, 'red')
        bt, bx, bs = side(m, 'blue')
        for t in rt + bt:
            team_matches.setdefault(t, []).append(compact_match(m, eid))
            team_events.setdefault(t, set()).add(eid)
        if m.get('round') == 1 or not played(m):
            continue
        if prev_event is not None and prev_event != eid:
            note_event_end(prev_event)
        prev_event = eid
        red = [r_of(t) for t in rt if t not in rx]
        blue = [r_of(t) for t in bt if t not in bx]
        if not red or not blue:
            continue
        rate(red, blue, (rs > bs) - (rs < bs))
        for ts, own, opp, sit in ((rt, rs, bs, rx), (bt, bs, rs, bx)):
            for t in ts:
                if t in sit:
                    continue
                event_teams.setdefault(eid, set()).add(t)
                r = rec.setdefault(t, {'w': 0, 'l': 0, 't': 0, 'pts': 0, 'n': 0, 'high': 0})
                r['n'] += 1
                r['pts'] += own
                r['high'] = max(r['high'], own)
                r['w' if own > opp else 'l' if own < opp else 't'] += 1
    if prev_event is not None:
        note_event_end(prev_event)

    # ---- per-event OPR ----
    opr_lists = {}
    event_opr = {}
    for eid, b in bundles.items():
        for d in b.get('divisions') or []:
            quals = [m for m in d.get('matches') or [] if m.get('round') == 2 and played(m)]
            if len(quals) < 4:
                continue
            res = solve_opr(quals)
            for t, v in res.items():
                opr_lists.setdefault(t, []).append(v)
                event_opr[(eid, t)] = v

    # ---- team index ----
    info = {}
    for t in teams:
        info[t['number']] = t
    for b in bundles.values():
        for t in b.get('teams') or []:
            info.setdefault(t['number'], t)
    numbers = set(info) | set(team_matches)
    rated = sorted([t for t in ratings if rec.get(t, {}).get('n')], key=lambda t: ratings[t][0] - 3 * ratings[t][1], reverse=True)
    ts_rank = {t: i + 1 for i, t in enumerate(rated)}

    awards_by_team = {}
    skills_by_team = {}
    rankings_by_team = {}
    for eid, b in bundles.items():
        ev = ev_by_id.get(eid) or b['event']
        for a in b.get('awards') or []:
            for w in a.get('teamWinners') or []:
                num = (w.get('team') or {}).get('name')
                if num:
                    awards_by_team.setdefault(num, []).append({'event': {'id': eid, 'name': ev.get('name')}, 'title': a.get('title'), 'qualifications': a.get('qualifications') or []})
        for s in b.get('skills') or []:
            num = (s.get('team') or {}).get('name')
            if num:
                skills_by_team.setdefault(num, []).append({'event': {'id': eid, 'name': ev.get('name')}, 'type': s.get('type'), 'score': s.get('score'), 'attempts': s.get('attempts'), 'rank': s.get('rank')})
        for d in b.get('divisions') or []:
            for r in d.get('rankings') or []:
                num = (r.get('team') or {}).get('name')
                if num:
                    rankings_by_team.setdefault(num, []).append({'event': {'id': eid}, 'division': {'id': d['id'], 'name': d.get('name')}, 'rank': r.get('rank'),
                                                                 'wins': r.get('wins'), 'losses': r.get('losses'), 'ties': r.get('ties'), 'wp': r.get('wp'), 'ap': r.get('ap'),
                                                                 'sp': r.get('sp'), 'high_score': r.get('high_score'), 'average_points': r.get('average_points')})
        for t in b.get('teams') or []:
            team_events.setdefault(t['number'], set()).add(eid)

    fields = ['id', 'number', 'name', 'org', 'city', 'region', 'country', 'grade', 'robot', 'mu', 'sigma', 'ts', 'tsRank',
              'w', 'l', 't', 'played', 'avg', 'high', 'opr', 'dpr', 'ccwm', 'events', 'awards']
    rows = []
    for num in sorted(numbers):
        t = info.get(num, {'number': num})
        loc = t.get('location') or {}
        r = rec.get(num)
        rt = ratings.get(num)
        ol = opr_lists.get(num)
        mean = (lambda i: round(sum(v[i] for v in ol) / len(ol), 2)) if ol else (lambda i: None)
        rows.append([
            t.get('id'), num, t.get('team_name'), t.get('organization'), loc.get('city'), loc.get('region'), loc.get('country'),
            t.get('grade'), t.get('robot_name') or None,
            round(rt[0], 3) if rt and r else None, round(rt[1], 3) if rt and r else None,
            round(rt[0] - 3 * rt[1], 2) if rt and r else None, ts_rank.get(num),
            r['w'] if r else None, r['l'] if r else None, r['t'] if r else None, r['n'] if r else 0,
            round(r['pts'] / r['n'], 1) if r and r['n'] else None, r['high'] if r else None,
            mean(0), mean(1), mean(2), len(team_events.get(num, ())), len(awards_by_team.get(num, []))
        ])
    gen = NOW.isoformat()
    write(os.path.join(pdir, 'teams.json'), {'generated': gen, 'season': season['id'], 'fields': fields, 'rows': rows})

    # ---- events index ----
    ef = ['id', 'sku', 'name', 'start', 'end', 'level', 'type', 'venue', 'city', 'region', 'country', 'lat', 'lon', 'divisions', 'teams']
    erows = []
    for e in events:
        loc = e.get('location') or {}
        co = loc.get('coordinates') or {}
        b = bundles.get(e['id']) or {}
        erows.append([e['id'], e.get('sku'), e.get('name'), e.get('start'), e.get('end'), e.get('level'), e.get('event_type'),
                      loc.get('venue'), loc.get('city'), loc.get('region'), loc.get('country'), co.get('lat'), co.get('lon'),
                      [[d['id'], d.get('name')] for d in e.get('divisions') or []], len(b.get('teams') or []) or None])
    write(os.path.join(pdir, 'events.json'), {'generated': gen, 'season': season['id'], 'fields': ef, 'rows': erows})

    # ---- per-event files ----
    for eid, b in bundles.items():
        ev = ev_by_id.get(eid) or b['event']
        write(os.path.join(pdir, 'event', f'{eid}.json'), {
            'generated': gen,
            'event': slim_event(ev),
            'teams': [slim_team(t) for t in b.get('teams') or []],
            'divisions': [{'id': d['id'], 'name': d.get('name'),
                           'matches': [compact_match(m, eid) for m in d.get('matches') or []],
                           'rankings': [{k: r.get(k) for k in ('rank', 'team', 'wins', 'losses', 'ties', 'wp', 'ap', 'sp', 'high_score', 'average_points', 'total_points')}
                                        for r in d.get('rankings') or []]}
                          for d in b.get('divisions') or []],
            'skills': [{'team': s.get('team'), 'type': s.get('type'), 'score': s.get('score'), 'attempts': s.get('attempts'), 'rank': s.get('rank')} for s in b.get('skills') or []],
            'awards': [{'title': a.get('title'), 'order': a.get('order'), 'qualifications': a.get('qualifications') or [],
                        'teamWinners': [{'team': w.get('team')} for w in a.get('teamWinners') or []],
                        'individualWinners': a.get('individualWinners') or []} for a in b.get('awards') or []]
        })

    # ---- per-team files ----
    for num in numbers:
        evs = sorted([ev_by_id[e] for e in team_events.get(num, ()) if e in ev_by_id], key=lambda e: e.get('start') or '')
        write(os.path.join(pdir, 'team', f'{num}.json'), {
            'generated': gen,
            'events': [slim_event(e) for e in evs],
            'rankings': rankings_by_team.get(num, []),
            'matches': team_matches.get(num, []),
            'awards': awards_by_team.get(num, []),
            'skills': skills_by_team.get(num, []),
            'history': hist.get(num, []),
            'opr': {str(eid): [round(x, 2) for x in event_opr[(eid, num)]] for eid in team_events.get(num, ()) if (eid, num) in event_opr}
        })

    if qa:
        write(os.path.join(out, 'qa', f'{season["id"]}.json'), qa)
    if judging:
        write(os.path.join(out, 'qa', 'judging.json'), judging)
    write(os.path.join(out, 'manifest.json'), {
        'generated': gen,
        'programs': {program: {'season': season['id'], 'seasonName': season['name'], 'teams': len(rows), 'events': len(events), 'matches': len(entries)}}
    })
    log(f'Wrote {len(rows)} teams, {len(bundles)} event files')


def write(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)


# ---------------------------------------------------------------------------
# Synthetic fixture (for testing the UI without an API key). Never deployed.
# ---------------------------------------------------------------------------
def fixture():
    rnd = random.Random(1940)
    season = {'id': 204, 'name': 'TEST DATA — VEX V5 Robotics Competition 2026-2027: Override'}
    regions = [('Sydney', 'New South Wales', 'Australia'), ('Melbourne', 'Victoria', 'Australia'), ('Brisbane', 'Queensland', 'Australia'),
               ('Auckland', 'Auckland', 'New Zealand'), ('Dallas', 'Texas', 'United States')]
    numbers = ['1940D', '1940A', '1940B', '1940C'] + [f'{rnd.randint(1000, 99999)}{rnd.choice("ABCDEFGHXYZ")}' for _ in range(96)]
    teams = []
    strength = {}
    for i, n in enumerate(numbers):
        city, region, country = regions[i % len(regions)] if i > 3 else regions[0]
        teams.append({'id': 900000 + i, 'number': n, 'team_name': f'Test Team {n}', 'robot_name': '', 'organization': f'Test School {i % 23}',
                      'location': {'city': city, 'region': region, 'country': country}, 'grade': 'Middle School' if i % 3 == 0 else 'High School',
                      'program': {'id': 1, 'name': 'VEX V5 Robotics Competition', 'code': 'V5RC'}, 'registered': True})
        strength[n] = rnd.gauss(30, 12)
    strength['1940D'] = 38
    today = NOW.replace(hour=0, minute=0, second=0, microsecond=0)
    plan = [(-60, 'Test Kickoff Scrimmage'), (-42, 'Test Spring Showdown'), (-28, 'Test State Qualifier'), (-14, 'Test Signature Event'),
            (0, 'Test Live Tournament (today)'), (12, 'Test Regional Championship')]
    events, bundles = [], {}
    mid = 700000
    for k, (offset, name) in enumerate(plan):
        start = today + dt.timedelta(days=offset)
        eid = 800000 + k
        ev = {'id': eid, 'sku': f'RE-V5RC-26-T{k}', 'name': name, 'start': start.isoformat(), 'end': (start + dt.timedelta(days=1 if k == 3 else 0)).isoformat(),
              'season': {'id': 204, 'name': season['name']}, 'program': {'id': 1, 'name': 'V5RC', 'code': 'V5RC'},
              'location': {'venue': 'Test Venue', 'address_1': '1 Test St', 'city': 'Sydney', 'region': 'New South Wales', 'postcode': '2000', 'country': 'Australia',
                           'coordinates': {'lat': -33.86 + k * 0.1, 'lon': 151.2 + k * 0.05}},
              'divisions': [{'id': 1, 'name': 'Division 1', 'order': 1}], 'level': 'Signature' if k == 3 else 'Other' if k < 2 else 'State',
              'ongoing': offset == 0, 'event_type': 'tournament'}
        events.append(ev)
        pool = ['1940D'] + rnd.sample(numbers[1:], 27)
        ev_teams = [t for t in teams if t['number'] in pool]
        matches = []
        qn = 0
        for rnd_i in range(7):
            order = pool[:]
            rnd.shuffle(order)
            for j in range(0, len(order) - 3, 4):
                qn += 1
                red, blue = order[j:j + 2], order[j + 2:j + 4]
                t0 = (start + dt.timedelta(hours=9, minutes=4 * qn))
                is_played = offset < 0 or (offset == 0 and t0 < NOW)
                rs = max(0, int(sum(strength[t] for t in red) + rnd.gauss(0, 14))) if is_played else 0
                bs = max(0, int(sum(strength[t] for t in blue) + rnd.gauss(0, 14))) if is_played else 0
                mid += 1
                matches.append({'id': mid, 'event': {'id': eid, 'name': name}, 'division': {'id': 1, 'name': 'Division 1'}, 'round': 2, 'instance': 1, 'matchnum': qn,
                                'scheduled': t0.isoformat(), 'started': t0.isoformat() if is_played else None, 'field': f'Field {1 + qn % 2}', 'scored': is_played,
                                'name': f'Qualifier #{qn}',
                                'alliances': [{'color': 'red', 'score': rs, 'teams': [{'team': {'id': 0, 'name': t}, 'sitting': False} for t in red]},
                                              {'color': 'blue', 'score': bs, 'teams': [{'team': {'id': 0, 'name': t}, 'sitting': False} for t in blue]}]})
        # simple rankings
        recs = {t: {'w': 0, 'l': 0, 't': 0, 'pts': 0, 'hi': 0, 'n': 0} for t in pool}
        for m in matches:
            if not m['scored']:
                continue
            r, b = m['alliances']
            for own, opp in ((r, b), (b, r)):
                for tm in own['teams']:
                    x = recs[tm['team']['name']]
                    x['n'] += 1; x['pts'] += own['score']; x['hi'] = max(x['hi'], own['score'])
                    x['w' if own['score'] > opp['score'] else 'l' if own['score'] < opp['score'] else 't'] += 1
        ordered = sorted(pool, key=lambda t: (recs[t]['w'] * 2 + recs[t]['t'], recs[t]['pts']), reverse=True)
        rankings = [{'id': i, 'event': {'id': eid}, 'division': {'id': 1}, 'rank': i + 1, 'team': {'id': 0, 'name': t}, 'wins': recs[t]['w'], 'losses': recs[t]['l'],
                     'ties': recs[t]['t'], 'wp': recs[t]['w'] * 2 + recs[t]['t'], 'ap': rnd.randint(0, 8), 'sp': recs[t]['pts'] // 3,
                     'high_score': recs[t]['hi'], 'average_points': round(recs[t]['pts'] / recs[t]['n'], 2) if recs[t]['n'] else 0,
                     'total_points': recs[t]['pts']} for i, t in enumerate(ordered)] if offset <= 0 else []
        # elims for finished events
        if offset < 0:
            top = ordered[:8]
            alliances = [top[i:i + 2] for i in range(0, 8, 2)]
            for inst, (a1, a2) in enumerate([(alliances[0], alliances[3]), (alliances[1], alliances[2])], start=1):
                mid += 1
                rs = int(sum(strength[t] for t in a1) + rnd.gauss(0, 10)); bs = int(sum(strength[t] for t in a2) + rnd.gauss(0, 10))
                matches.append({'id': mid, 'event': {'id': eid}, 'division': {'id': 1}, 'round': 4, 'instance': inst, 'matchnum': 1, 'scored': True,
                                'scheduled': (start + dt.timedelta(hours=15, minutes=inst * 6)).isoformat(), 'field': 'Field 1', 'name': f'SF {inst}-1',
                                'alliances': [{'color': 'red', 'score': rs, 'teams': [{'team': {'id': 0, 'name': t}, 'sitting': False} for t in a1]},
                                              {'color': 'blue', 'score': bs, 'teams': [{'team': {'id': 0, 'name': t}, 'sitting': False} for t in a2]}]})
        skills = []
        if offset <= 0:
            for i, t in enumerate(rnd.sample(pool, 14)):
                skills.append({'team': {'id': 0, 'name': t}, 'type': 'driver', 'score': int(strength[t] * 2 + rnd.gauss(0, 10)), 'attempts': 3, 'rank': i + 1})
                skills.append({'team': {'id': 0, 'name': t}, 'type': 'programming', 'score': max(0, int(strength[t] * 1.4 + rnd.gauss(0, 15))), 'attempts': 2, 'rank': i + 1})
        awards = [{'title': 'Excellence Award (VRC/VEXU/VAIRC)', 'order': 1, 'qualifications': ['Test Championship'], 'teamWinners': [{'team': {'id': 0, 'name': ordered[2]}}]},
                  {'title': 'Tournament Champions (VRC/VEXU/VAIRC)', 'order': 2, 'qualifications': [], 'teamWinners': [{'team': {'id': 0, 'name': t}} for t in ordered[:2]]},
                  {'title': 'Design Award (VRC/VEXU/VAIRC)', 'order': 3, 'qualifications': [], 'teamWinners': [{'team': {'id': 0, 'name': ordered[5]}}]}] if offset < 0 else []
        bundles[eid] = {'fetched': NOW.isoformat(), 'event': ev, 'teams': ev_teams,
                        'divisions': [{'id': 1, 'name': 'Division 1', 'matches': matches, 'rankings': rankings}], 'skills': skills, 'awards': awards}
    qa = {'id': 1, 'type': 'season', 'is_open': True, 'questions': [
        {'id': 3001, 'title': 'TEST: Can a robot hold two Pins at once?', 'content': '<p>Test question body about <b>SG5</b>.</p>', 'asked_by': '1940D',
         'publish_to_game_manual': True, 'summary': None, 'tags': [{'name': 'SG5', 'game_rule': True}], 'published_tags': [],
         'answers': [{'id': 1, 'content': '<p>Test answer. See <a href="https://manuals.vex.com">the manual</a>.</p>', 'created_at': NOW.isoformat()}], 'created_at': NOW.isoformat()},
        {'id': 3002, 'title': 'TEST: Toggle contact during autonomous', 'content': '<p>Another test question.</p>', 'asked_by': '1940A',
         'publish_to_game_manual': False, 'summary': None, 'tags': [{'name': 'SC4', 'game_rule': True}], 'published_tags': [], 'answers': [], 'created_at': NOW.isoformat()}]}
    return season, events, bundles, teams, qa, {'id': 2, 'type': 'judging', 'questions': []}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='data')
    ap.add_argument('--program', default='V5RC')
    ap.add_argument('--cache', default='.cache/vex')
    ap.add_argument('--fixture', action='store_true', help='write synthetic test data instead of calling the API')
    ap.add_argument('--max-events', type=int, default=None, help='limit new event downloads this run')
    args = ap.parse_args()

    if args.fixture:
        season, events, bundles, teams, qa, judging = fixture()
    else:
        token = os.environ.get('VEX_API_TOKEN', '').strip()
        if not token:
            raise SystemExit('Set VEX_API_TOKEN (an events.vex.com API key) to build live data')
        cache = Cache(args.cache)
        try:
            season, events, bundles, teams, qa, judging = gather_live(Api(token), args.program, cache, args.max_events)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                log('::error::The VEX API rejected VEX_API_TOKEN (check the repository secret)')
            else:
                log(f'::warning::VEX API error {e.code}; rebuilding from cache')
            season, events, bundles, teams, qa, judging = gather_cached(args.program, cache)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            log(f'::warning::VEX API unreachable ({e}); rebuilding from cache')
            season, events, bundles, teams, qa, judging = gather_cached(args.program, cache)
    build(season, events, bundles, teams, qa, judging, args.out, args.program)


if __name__ == '__main__':
    main()
