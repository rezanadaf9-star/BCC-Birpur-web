# Real Chromium (Playwright) tests of the real pages against the local test backend (see server.js). Usage: python3 run_browser.py <role|flows|all>
import json, os, subprocess, sys, time, re, urllib.request
from playwright.sync_api import sync_playwright
PORT = 8123; BASE = f'http://127.0.0.1:{PORT}'
HERE = os.path.dirname(os.path.abspath(__file__)); SHOTS = os.path.join(HERE, 'shots'); os.makedirs(SHOTS, exist_ok=True)
CLASS_PAGES = {'marks', 'attendance', 'lectures', 'notes', 'homework', 'quizzes', 'examinations', 'answer-sheets', 'timetable', 'leaderboards', 'students', 'ai-hub', 'print', 'discussions'}
def start_server():
    p = subprocess.Popen(['node', os.path.join(HERE, 'server.js')], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    line = p.stdout.readline()
    if not line.startswith('READY'): print(line, p.stdout.read()); raise SystemExit('server failed')
    return p, json.loads(line[6:])
JS = lambda: "export * from 'http://127.0.0.1:%d/__shim/core.js';" % PORT
def new_context(br, vw=1280, vh=800):
    ctx = br.new_context(viewport={'width': vw, 'height': vh}, user_agent='Mozilla/5.0 (X11; Linux x86_64) Chrome/153 BCCtest')
    def route(r):
        u = r.request.url
        if u.startswith(BASE): return r.continue_()
        if 'gstatic.com/firebasejs' in u: return r.fulfill(status=200, content_type='text/javascript', headers={'Access-Control-Allow-Origin': '*'}, body=JS())
        if re.search(r'\.(css)(\?|$)|fonts\.googleapis', u): return r.fulfill(status=200, content_type='text/css', body='')
        if re.search(r'\.(woff2?|ttf)(\?|$)|fonts\.gstatic', u): return r.fulfill(status=200, content_type='font/woff2', body='')
        if re.search(r'\.(png|jpe?g|gif|svg|webp)(\?|$)', u): return r.fulfill(status=200, content_type='image/png', body=b'\x89PNG\r\n\x1a\n')
        return r.fulfill(status=200, content_type='text/javascript', body='')
    ctx.route('**/*', route); return ctx
def watch(page, store):
    page.on('pageerror', lambda e: store['errors'].append('PAGEERROR: ' + str(e)[:300]))
    def con(m):
        if m.type == 'error' and BASE in (m.location.get('url') or BASE): store['errors'].append('CONSOLE: ' + m.text[:300])
    page.on('console', con)
    def resp(r):
        if '/__fb/' in r.url and r.request.method == 'POST':
            try:
                j = r.json()
                if isinstance(j, dict) and j.get('error'):
                    e = j['error']; msg = e if isinstance(e, str) else f"{e.get('status')}: {e.get('message')}"
                    store['backend_errors'].append(r.url.split('/__fb')[1] + ' -> ' + msg[:250])
            except Exception: pass
    def fail(r):
        if r.url.startswith(BASE) and '/__fb/' not in r.url and r.status >= 400: store['backend_errors'].append(f'HTTP {r.status} {r.url[len(BASE):]}')
    page.on('response', fail)
    page.on('response', resp)
def login(page, portal, ident, pw, add=False):
    page.goto(BASE + ('/index.html?add=1' if add else '/index.html')); page.wait_for_timeout(600)
    page.evaluate("(()=>{const b=document.querySelector('[data-open-login]'); if(b) b.click();})()"); page.wait_for_timeout(300)
    if portal == 'teacher': page.evaluate("document.getElementById('teacherButton').click()")
    page.evaluate("(a)=>{const i=document.getElementById('userId');i.removeAttribute('readonly');i.value=a[0];i.dispatchEvent(new Event('input',{bubbles:true}));const p=document.getElementById('password');p.value=a[1];p.dispatchEvent(new Event('input',{bubbles:true}));}", [ident, pw])
    page.evaluate("document.getElementById('loginButton').click()")
    try: page.wait_for_url(re.compile(r'/(student|teacher|admin)/dashboard\.html'), timeout=15000)
    except Exception: return False, page.evaluate("document.getElementById('loginMessage')?.innerText || ''")
    return True, ''
def check_page(page, path, mobile_shot=None):
    store = {'errors': [], 'backend_errors': []}
    page.remove_listener if False else None
    t0 = time.time(); page.goto(BASE + path); page.wait_for_timeout(2200)
    text = page.evaluate("document.body.innerText")
    flags = [w for w in ['undefined', 'NaN', '[object Object]', 'null null'] if w in text]
    ow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    return {'path': path, 'ms': int((time.time() - t0) * 1000), 'text_len': len(text), 'flags': flags, 'overflow_desktop': ow}
def role_run(pw, role, ident, pw_, portal, pages, out):
    br = pw.chromium.launch(); ctx = new_context(br); page = ctx.new_page(); store = {'errors': [], 'backend_errors': []}; watch(page, store)
    ok, msg = login(page, portal, ident, pw_)
    out.append({'path': f'LOGIN {role}', 'ok': ok, 'msg': msg, 'errors': list(store['errors']), 'backend_errors': list(store['backend_errors'])})
    if not ok: br.close(); return
    for path in pages:
        store['errors'].clear(); store['backend_errors'].clear()
        r = check_page(page, path)
        # mobile: same page at a phone width
        page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(500)
        r['overflow_mobile'] = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        if path.endswith(('dashboard.html',)): page.screenshot(path=os.path.join(SHOTS, f"{role}-{path.strip('/').replace('/','-').replace('?','_')}-mobile.png"))
        page.set_viewport_size({'width': 1280, 'height': 800})
        r['errors'] = list(store['errors']); r['backend_errors'] = list(store['backend_errors']); out.append(r)
    br.close()
def pages_for(role, listing):
    res = []
    for f in sorted(os.listdir(os.path.join(HERE, '../..', role))):
        if not f.endswith('.html'): continue
        name = f[:-5]; res.append(f'/{role}/{f}')
        if name in CLASS_PAGES: res.append(f'/{role}/{f}?class=10')
    return res
def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    server, seed = start_server(); results = {}
    try:
        with sync_playwright() as pw:
            sid = seed['students'][0]
            plan = {'admin': ('admin', 'ADMIN' if False else 'admin@bcc.test', 'AdminPass1', 'teacher'), 'teacher': ('teacher', 'teacher@bcc.test', 'TeacherPass1', 'teacher'), 'student': ('student', sid, 'StudentPass1', 'student')}
            for role in (plan if which == 'all' else [which]):
                if role not in plan: continue
                r, ident, pwd, portal = plan[role]; out = []
                role_run(pw, role, ident, pwd, portal, pages_for(role, None), out); results[role] = out
                json.dump(out, open(os.path.join(HERE, f'results-{role}.json'), 'w'), indent=1)
                bad = [x for x in out if x.get('errors') or x.get('backend_errors') or x.get('ok') is False or x.get('flags')]
                print(f'{role}: {len(out)} checks, {len(bad)} with problems')
                for x in bad[:60]: print('  ', x['path'], '|', (x.get('errors') or [])[:2], '|', (x.get('backend_errors') or [])[:2], '|', x.get('flags'), x.get('msg', ''))
    finally: server.terminate()
if __name__ == '__main__': main()
