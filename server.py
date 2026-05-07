#!/usr/bin/env python3
import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import date, timedelta
from urllib.parse import unquote

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
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS signups (
                        name TEXT PRIMARY KEY,
                        days JSONB NOT NULL DEFAULT '{}',
                        either BOOLEAN NOT NULL DEFAULT FALSE,
                        filler BOOLEAN NOT NULL DEFAULT FALSE
                    );
                    CREATE TABLE IF NOT EXISTS settings (
                        key TEXT PRIMARY KEY,
                        value JSONB NOT NULL
                    );
                """)
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

    def load_data():
        with _conn() as c:
            with c.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT name, days, either, filler FROM signups ORDER BY LOWER(name)")
                signups = [dict(r) for r in cur.fetchall()]
        return {'playDates': _get_play_dates(), 'signups': signups}

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
        _set_play_dates(dates)
        reset_signups()

else:
    # ---- local JSON file storage ----

    def load_data():
        if not os.path.exists(DATA_FILE):
            data = {'playDates': _default_dates(), 'signups': []}
            _save(data); return data
        data = json.loads(open(DATA_FILE).read())
        # migrate old saturday/sunday format
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
        return data

    def save_signup(name, days, either, filler):
        data = load_data()
        entry = {'name': name, 'days': days, 'either': either, 'filler': filler}
        idx = next((i for i, s in enumerate(data['signups']) if s['name'].lower() == name.lower()), -1)
        if idx >= 0: data['signups'][idx] = entry
        else:        data['signups'].append(entry)
        data['signups'].sort(key=lambda s: s['name'].lower())
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
        data['playDates'] = dates
        data['signups'] = []
        _save(data)

    def _save(data):
        os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
        with open(DATA_FILE, 'w') as f: json.dump(data, f, indent=2)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _default_dates():
    today = date.today()
    diff = (5 - today.weekday()) % 7 or 7
    sat = today + timedelta(days=diff)
    return [sat.isoformat(), (sat + timedelta(days=1)).isoformat()]


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, fmt, *args): pass

    def do_GET(self):
        if self.path == '/api/signups':
            self.json_response(load_data())
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

        elif self.path == '/api/reset':
            reset_signups()
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
