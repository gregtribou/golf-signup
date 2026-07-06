#!/usr/bin/env python3
import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import date, timedelta, datetime
from urllib.parse import unquote, urlparse, parse_qs

PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')
DATA_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'signups.json')
DATABASE_URL = os.environ.get('DATABASE_URL')

# ---------------------------------------------------------------------------
# Storage — PostgreSQL when DATABASE_URL is set, JSON file otherwise
# ---------------------------------------------------------------------------

if DATABASE_URL:
    import psycopg2
    from psycopg2.extras import RealDictCursor

    def _conn():
        return psycopg2.connect(DATABASE_URL)

    def _init_db():
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("""CREATE TABLE IF NOT EXISTS signups (
                    name TEXT PRIMARY KEY,
                    days JSONB NOT NULL DEFAULT '{}',
                    either BOOLEAN NOT NULL DEFAULT FALSE,
                    filler BOOLEAN NOT NULL DEFAULT FALSE
                )""")
                cur.execute("""CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL
                )""")
                cur.execute("""CREATE TABLE IF NOT EXISTS teams (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    players TEXT NOT NULL DEFAULT '',
                    score INTEGER NOT NULL DEFAULT 0,
                    hole INTEGER NOT NULL DEFAULT 0,
                    sort_order INTEGER NOT NULL DEFAULT 0
                )""")
                cur.execute("""CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    text TEXT NOT NULL,
                    ts TIMESTAMP NOT NULL DEFAULT NOW(),
                    play_date TEXT NOT NULL DEFAULT '',
                    reactions JSONB NOT NULL DEFAULT '{}'
                )""")
                cur.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS play_date TEXT NOT NULL DEFAULT ''")
                cur.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'")
                cur.execute("ALTER TABLE signups ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()")
    _init_db()

    def _get_play_dates():
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("SELECT value FROM settings WHERE key = 'playDates'")
                row = cur.fetchone()
                return row[0] if row else _default_dates()

    def _set_play_dates(dates):
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("""
                    INSERT INTO settings (key, value) VALUES ('playDates', %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """, (json.dumps(dates),))

    def _get_game_dates():
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("SELECT value FROM settings WHERE key = 'gameDates'")
                row = cur.fetchone()
                return row[0] if row else []

    def _set_game_dates(dates):
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("""
                    INSERT INTO settings (key, value) VALUES ('gameDates', %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """, (json.dumps(dates),))

    def set_game_dates(dates):
        _set_game_dates(dates)

    def load_data():
        with _conn() as c:
            with c.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT name, days, either, filler FROM signups ORDER BY created_at")
                signups = [dict(r) for r in cur.fetchall()]
        return {'playDates': _get_play_dates(), 'gameDates': _get_game_dates(), 'signups': signups}

    def save_signup(name, days, either, filler):
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("""
                    INSERT INTO signups (name, days, either, filler) VALUES (%s, %s, %s, %s)
                    ON CONFLICT (name) DO UPDATE
                    SET days=EXCLUDED.days, either=EXCLUDED.either, filler=EXCLUDED.filler
                """, (name, json.dumps(days), either, filler))

    def delete_signup(name):
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("DELETE FROM signups WHERE LOWER(name)=LOWER(%s)", (name,))

    def reset_signups():
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("DELETE FROM signups")

    def set_dates(dates):
        current = _get_play_dates()
        _set_play_dates(dates)
        if sorted(dates) != sorted(current):
            reset_signups()

    def _team_prefix(d):
        return f"{d}_"

    def load_teams(play_date):
        prefix = _team_prefix(play_date)
        with _conn() as c:
            with c.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, name, players, score, hole FROM teams
                    WHERE id LIKE %s ORDER BY sort_order, id
                """, (f"{play_date}_%",))
                rows = []
                for r in cur.fetchall():
                    d = dict(r)
                    d['id'] = d['id'][len(prefix):]
                    rows.append(d)
                return rows

    def save_teams(teams, play_date):
        prefix = _team_prefix(play_date)
        existing = {}
        with _conn() as c:
            with c.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT name, score, hole FROM teams WHERE id LIKE %s", (f"{play_date}_%",))
                for r in cur.fetchall():
                    existing[r['name']] = dict(r)
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("DELETE FROM teams WHERE id LIKE %s", (f"{play_date}_%",))
                for i, t in enumerate(teams):
                    old = existing.get(t['name'], {})
                    cur.execute("""
                        INSERT INTO teams (id, name, players, score, hole, sort_order)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (f"{prefix}{t['id']}", t['name'], t['players'],
                          old.get('score', 0), old.get('hole', 0), i))

    def update_team_score(team_id, score, hole, play_date):
        full_id = f"{_team_prefix(play_date)}{team_id}"
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("UPDATE teams SET score=%s, hole=%s WHERE id=%s", (score, hole, full_id))

    def reset_team_scores(play_date):
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("DELETE FROM teams WHERE id LIKE %s", (f"{play_date}_%",))

    def _ctp_key(play_date):
        return f"ctp_{play_date}"

    def load_ctp(play_date):
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("SELECT value FROM settings WHERE key = %s", (_ctp_key(play_date),))
                row = cur.fetchone()
                return row[0] if row else {'active': False, 'hole': 13, 'entries': []}

    def save_ctp(ctp, play_date):
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("""
                    INSERT INTO settings (key, value) VALUES (%s, %s)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """, (_ctp_key(play_date), json.dumps(ctp)))

    def load_messages(play_date):
        with _conn() as c:
            with c.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT name, text, ts, reactions FROM messages WHERE play_date=%s ORDER BY ts DESC LIMIT 50", (play_date,))
                return [{'name': r['name'], 'text': r['text'],
                         'ts': r['ts'].strftime('%Y-%m-%dT%H:%M:%S'),
                         'reactions': r['reactions'] or {}} for r in cur.fetchall()]

    def add_message(name, text, play_date):
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("INSERT INTO messages (name, text, play_date, reactions) VALUES (%s, %s, %s, %s)", (name, text, play_date, '{}'))

    def clear_messages(play_date):
        with _conn() as c:
            with c.cursor() as cur:
                cur.execute("DELETE FROM messages WHERE play_date=%s", (play_date,))

    def react_message(play_date, ts, name, emoji, delta):
        with _conn() as c:
            with c.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT id, reactions FROM messages WHERE play_date=%s AND DATE_TRUNC('second', ts)=%s::timestamp AND name=%s", (play_date, ts, name))
                row = cur.fetchone()
                if not row:
                    return
                reactions = row['reactions'] or {}
                count = reactions.get(emoji, 0) + delta
                if count <= 0:
                    reactions.pop(emoji, None)
                else:
                    reactions[emoji] = count
                cur.execute("UPDATE messages SET reactions=%s WHERE id=%s", (json.dumps(reactions), row['id']))

else:
    # ---- local JSON file storage ----

    def load_data():
        if not os.path.exists(DATA_FILE):
            data = {'playDates': _default_dates(), 'signups': [], 'scores': {}}
            _save(data); return data
        data = json.loads(open(DATA_FILE).read())
        if 'week' in data or (data.get('signups') and 'saturday' in data['signups'][0]):
            old = data.pop('week', {})
            old_dates = [d for d in [old.get('saturdayFull'), old.get('sundayFull')] if d] or _default_dates()
            data.setdefault('playDates', old_dates)
            for s in data.get('signups', []):
                if 'saturday' in s:
                    days = {}
                    if len(old_dates) > 0 and s.get('saturday'): days[old_dates[0]] = True
                    if len(old_dates) > 1 and s.get('sunday'):   days[old_dates[1]] = True
                    s['days'] = days
                    s.pop('saturday', None); s.pop('sunday', None)
            _save(data)
        # migrate old flat teams/ctp to per-date scores
        if 'teams' in data or 'ctp' in data:
            first = data.get('playDates', _default_dates())[0]
            data.setdefault('scores', {})
            data['scores'].setdefault(first, {})
            if 'teams' in data:
                data['scores'][first]['teams'] = data.pop('teams')
            if 'ctp' in data:
                data['scores'][first]['ctp'] = data.pop('ctp')
            _save(data)
        data.setdefault('gameDates', data.get('playDates', _default_dates()))
        data.setdefault('scores', {})
        return data

    def _day_scores(data, play_date):
        data['scores'].setdefault(play_date, {'teams': [], 'ctp': {'active': False, 'hole': 13, 'entries': []}})
        data['scores'][play_date].setdefault('teams', [])
        data['scores'][play_date].setdefault('ctp', {'active': False, 'hole': 13, 'entries': []})
        return data['scores'][play_date]

    def save_signup(name, days, either, filler):
        data = load_data()
        entry = {'name': name, 'days': days, 'either': either, 'filler': filler}
        idx = next((i for i, s in enumerate(data['signups']) if s['name'].lower() == name.lower()), -1)
        if idx >= 0: data['signups'][idx] = entry
        else:        data['signups'].append(entry)
        _save(data)

    def delete_signup(name):
        data = load_data()
        data['signups'] = [s for s in data['signups'] if s['name'].lower() != name.lower()]
        _save(data)

    def reset_signups():
        data = load_data()
        data['signups'] = []
        _save(data)

    def set_dates(dates):
        data = load_data()
        if sorted(dates) != sorted(data.get('playDates', [])):
            data['signups'] = []
        data['playDates'] = dates
        _save(data)

    def set_game_dates(dates):
        data = load_data()
        data['gameDates'] = dates
        _save(data)

    def load_teams(play_date):
        return _day_scores(load_data(), play_date)['teams']

    def save_teams(teams, play_date):
        data = load_data()
        day = _day_scores(data, play_date)
        existing = {t['name']: t for t in day['teams']}
        day['teams'] = [{
            'id': t['id'], 'name': t['name'], 'players': t['players'],
            'score': existing.get(t['name'], {}).get('score', 0),
            'hole':  existing.get(t['name'], {}).get('hole', 0),
        } for t in teams]
        _save(data)

    def update_team_score(team_id, score, hole, play_date):
        data = load_data()
        for t in _day_scores(data, play_date)['teams']:
            if t['id'] == team_id:
                t['score'] = score; t['hole'] = hole; break
        _save(data)

    def reset_team_scores(play_date):
        data = load_data()
        _day_scores(data, play_date)['teams'] = []
        _save(data)

    def load_ctp(play_date):
        return _day_scores(load_data(), play_date)['ctp']

    def save_ctp(ctp, play_date):
        data = load_data()
        _day_scores(data, play_date)['ctp'] = ctp
        _save(data)

    def load_messages(play_date):
        data = load_data()
        msgs = data.get('messages', {})
        if isinstance(msgs, list):
            return []  # old format, ignore
        return msgs.get(play_date, [])[:50]

    def add_message(name, text, play_date):
        data = load_data()
        if not isinstance(data.get('messages'), dict):
            data['messages'] = {}
        data['messages'].setdefault(play_date, [])
        data['messages'][play_date].insert(0, {
            'name': name, 'text': text,
            'ts': datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
        })
        data['messages'][play_date] = data['messages'][play_date][:50]
        _save(data)

    def clear_messages(play_date):
        data = load_data()
        if isinstance(data.get('messages'), dict):
            data['messages'][play_date] = []
        _save(data)

    def react_message(play_date, ts, name, emoji, delta):
        data = load_data()
        msgs = data.get('messages', {})
        if not isinstance(msgs, dict):
            return
        day_msgs = msgs.get(play_date, [])
        for m in day_msgs:
            if m.get('ts') == ts and m.get('name') == name:
                reactions = m.setdefault('reactions', {})
                count = reactions.get(emoji, 0) + delta
                if count <= 0:
                    reactions.pop(emoji, None)
                else:
                    reactions[emoji] = count
                break
        _save(data)

    def _save(data):
        os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
        with open(DATA_FILE, 'w') as f: json.dump(data, f, indent=2)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _default_dates():
    today = date.today()
    diff = (5 - today.weekday()) % 7
    sat = today + timedelta(days=diff)
    return [sat.isoformat(), (sat + timedelta(days=1)).isoformat()]


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, fmt, *args): pass

    def end_headers(self):
        path = self.path.split('?')[0]
        if path == '/' or path.endswith('.html'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        path = parsed.path

        if path == '/api/signups':
            self.json_response(load_data())
        elif path == '/api/scores':
            play_date = params.get('date', [''])[0].strip()
            if not play_date:
                return self.json_response({'error': 'date param required'}, 400)
            self.json_response({'teams': load_teams(play_date), 'ctp': load_ctp(play_date)})
        elif path == '/api/messages':
            play_date = params.get('date', [''])[0].strip()
            if not play_date:
                return self.json_response({'error': 'date param required'}, 400)
            self.json_response(load_messages(play_date))
        else:
            super().do_GET()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if self.path == '/api/signup':
            name   = (body.get('name') or '').strip()
            days   = body.get('days', {})
            either = bool(body.get('either'))
            filler = bool(body.get('filler'))
            if not name or (not any(days.values()) and not either and not filler):
                return self.json_response({'error': 'Name and at least one option required.'}, 400)
            save_signup(name, days, either, filler)
            self.json_response({'success': True})

        elif self.path == '/api/setdates':
            dates = sorted(set(d.strip() for d in body.get('dates', []) if d and d.strip()))
            if not dates:
                return self.json_response({'error': 'At least one date required.'}, 400)
            set_dates(dates)
            self.json_response({'success': True})

        elif self.path == '/api/setgamedates':
            dates = sorted(set(d.strip() for d in body.get('dates', []) if d and d.strip()))
            if not dates:
                return self.json_response({'error': 'At least one date required.'}, 400)
            set_game_dates(dates)
            self.json_response({'success': True})

        elif self.path == '/api/reset':
            reset_signups()
            self.json_response({'success': True})

        elif self.path == '/api/scores/teams':
            play_date = (body.get('date') or '').strip()
            if not play_date:
                return self.json_response({'error': 'date required'}, 400)
            raw = body.get('teams', [])
            teams = []
            for t in raw:
                name = (t.get('name') or '').strip()
                players = (t.get('players') or '').strip()
                if name:
                    tid = (t.get('id') or name).lower().replace(' ', '-')
                    teams.append({'id': tid, 'name': name, 'players': players})
            save_teams(teams, play_date)
            self.json_response({'success': True})

        elif self.path == '/api/scores/update':
            play_date = (body.get('date') or '').strip()
            team_id = (body.get('id') or '').strip()
            try:
                score = int(body.get('score', 0))
                hole  = max(0, min(18, int(body.get('hole', 0))))
            except (ValueError, TypeError):
                return self.json_response({'error': 'Invalid score or hole.'}, 400)
            if not team_id or not play_date:
                return self.json_response({'error': 'id and date required.'}, 400)
            update_team_score(team_id, score, hole, play_date)
            self.json_response({'success': True})

        elif self.path == '/api/scores/reset':
            play_date = (body.get('date') or '').strip()
            if not play_date:
                return self.json_response({'error': 'date required'}, 400)
            reset_team_scores(play_date)
            self.json_response({'success': True})

        elif self.path == '/api/ctp':
            play_date = (body.get('date') or '').strip()
            if not play_date:
                return self.json_response({'error': 'date required'}, 400)
            ctp = load_ctp(play_date)
            if 'active' in body: ctp['active'] = bool(body['active'])
            if 'hole'   in body: ctp['hole']   = int(body['hole'])
            ctp.setdefault('entries', [])
            save_ctp(ctp, play_date)
            self.json_response({'success': True})

        elif self.path == '/api/ctp/entry':
            play_date = (body.get('date') or '').strip()
            name = (body.get('name') or '').strip()
            try:
                distance = float(body.get('distance', 0))
            except (ValueError, TypeError):
                return self.json_response({'error': 'Invalid distance.'}, 400)
            if not name or distance <= 0 or not play_date:
                return self.json_response({'error': 'Name, distance, and date required.'}, 400)
            ctp = load_ctp(play_date)
            ctp.setdefault('entries', [])
            ctp['entries'] = [e for e in ctp['entries'] if e['name'].lower() != name.lower()]
            ctp['entries'].append({'name': name, 'distance': distance})
            save_ctp(ctp, play_date)
            self.json_response({'success': True})

        elif self.path == '/api/ctp/entry/remove':
            play_date = (body.get('date') or '').strip()
            name = (body.get('name') or '').strip()
            if not name or not play_date:
                return self.json_response({'error': 'name and date required'}, 400)
            ctp = load_ctp(play_date)
            ctp['entries'] = [e for e in ctp.get('entries', []) if e['name'].lower() != name.lower()]
            save_ctp(ctp, play_date)
            self.json_response({'success': True})

        elif self.path == '/api/ctp/reset':
            play_date = (body.get('date') or '').strip()
            if not play_date:
                return self.json_response({'error': 'date required'}, 400)
            ctp = load_ctp(play_date)
            ctp['entries'] = []
            save_ctp(ctp, play_date)
            self.json_response({'success': True})

        elif self.path == '/api/messages':
            name = (body.get('name') or '').strip()
            text = (body.get('text') or '').strip()
            play_date = (body.get('date') or '').strip()
            if not name or not text or not play_date:
                return self.json_response({'error': 'Name, message, and date required.'}, 400)
            if len(text) > 300:
                return self.json_response({'error': 'Message too long (max 300 chars).'}, 400)
            add_message(name, text, play_date)
            self.json_response({'success': True})

        elif self.path == '/api/messages/clear':
            play_date = (body.get('date') or '').strip()
            if not play_date:
                return self.json_response({'error': 'date required'}, 400)
            clear_messages(play_date)
            self.json_response({'success': True})

        elif self.path == '/api/messages/react':
            play_date = (body.get('date') or '').strip()
            ts        = (body.get('ts') or '').strip()
            name      = (body.get('name') or '').strip()
            emoji     = (body.get('emoji') or '').strip()
            action    = (body.get('action') or '').strip()  # 'add' or 'remove'
            if not all([play_date, ts, name, emoji, action]):
                return self.json_response({'error': 'Missing fields'}, 400)
            delta = 1 if action == 'add' else -1
            react_message(play_date, ts, name, emoji, delta)
            self.json_response({'success': True})

        else:
            self.send_error(404)

    def do_DELETE(self):
        if self.path.startswith('/api/signup/'):
            delete_signup(unquote(self.path[len('/api/signup/'):]))
            self.json_response({'success': True})
        else:
            self.send_error(404)

    def json_response(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print(f'Golf signup running at http://localhost:{port}')
    HTTPServer(('', port), Handler).serve_forever()
