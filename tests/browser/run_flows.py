# Functional browser flows (real Chromium, real pages, real Cloud Function code on an in-memory database). Prints PASS/FAIL per flow.
import json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_browser as R
from playwright.sync_api import sync_playwright
RES = []
def rec(feature, scenario, expected, fn):
    t0 = time.time()
    try: actual = fn() or 'as expected'; ok = True
    except Exception as e: actual = 'FAILED: ' + str(e)[:300]; ok = False
    RES.append({'feature': feature, 'scenario': scenario, 'expected': expected, 'actual': actual, 'pass': ok, 'ms': int((time.time() - t0) * 1000)}); print(('PASS' if ok else 'FAIL'), '|', feature, '|', scenario, '|', actual)
def get_doc(page, path): return page.evaluate("async p=>(await (await fetch('/__fb/fs/get',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:p})})).json()).data", path)
def run_fn(page, name): page.evaluate("async n=>fetch('/__fb/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})})", name)
def hide(page, h): page.evaluate("h=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>h});document.dispatchEvent(new Event('visibilitychange'))}", h)
def main():
    server, seed = R.start_server()
    sid = seed['students']; ids = seed['ids']; quiz = seed['quiz']
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch()
            # --- login behaviour
            ctx = R.new_context(br); page = ctx.new_page(); st = {'errors': [], 'backend_errors': []}; R.watch(page, st)
            rec('Login', 'Wrong password', 'message "Incorrect ID or password", stays on login page', lambda: (lambda r: (_ for _ in ()).throw(Exception('logged in?!')) if r[0] else (r[1] if 'Incorrect' in r[1] else (_ for _ in ()).throw(Exception('message: ' + r[1]))))(R.login(page, 'student', sid[0], 'wrong-password')))
            rec('Login', 'Student ID on the Teacher card', 'refused with a clear message', lambda: (lambda r: (r[1] or (_ for _ in ()).throw(Exception('no message'))) if not r[0] else (_ for _ in ()).throw(Exception('logged in')))(R.login(page, 'teacher', sid[0], 'StudentPass1')))
            rec('Login', 'Student signs in with Student ID', 'lands on student dashboard; dashboard shows the student name', lambda: (lambda r: None if r[0] and 'Asha' in (page.wait_for_timeout(1500) or page.evaluate('document.body.innerText')) else (_ for _ in ()).throw(Exception('login/dash failed ' + str(r))))(R.login(page, 'student', sid[0], 'StudentPass1')))
            ctx.close()
            # --- 2 web sessions: the third login signs the first browser out
            ctxs = [R.new_context(br) for _ in range(3)]; pages = [c.new_page() for c in ctxs]
            for p in pages: R.watch(p, {'errors': [], 'backend_errors': []})
            def sessions():
                for i in (0, 1): assert R.login(pages[i], 'student', sid[1], 'StudentPass1')[0]
                pages[0].goto(R.BASE + '/student/dashboard.html'); pages[0].wait_for_timeout(1500)
                assert R.login(pages[2], 'student', sid[1], 'StudentPass1')[0]
                pages[0].wait_for_timeout(5000)
                url0, url1 = pages[0].url, pages[1].url
                assert 'index.html' in url0 and 'session-ended' in url0, 'first browser not signed out: ' + url0
                assert 'student/' in url1 or 'dashboard' in url1, 'second browser wrongly signed out: ' + url1
                return 'oldest browser sent to the login page with #session-ended; the other two stay signed in'
            rec('Device sessions', 'Three browsers for one student (limit 2)', 'first browser signed out within seconds', sessions)
            for c in ctxs: c.close()
            # --- quiz: desktop tab switch
            ctx = R.new_context(br); page = ctx.new_page(); R.watch(page, {'errors': [], 'backend_errors': []}); assert R.login(page, 'student', sid[1], 'StudentPass1')[0]
            def desktop():
                page.goto(R.BASE + f'/student/quiz.html?id={quiz}'); page.wait_for_selector('#tv', timeout=8000)
                hide(page, True); page.wait_for_timeout(2500)
                a = get_doc(page, f'quizzes/{quiz}/attempts/{ids[1]}'); assert a and a['submission_reason'] == 'tab-switch', f'attempt={a and a.get("submission_reason")}'
                assert 'Quiz result' in page.evaluate('document.body.innerText'), 'result screen not shown'
                return f"auto-submitted ({a['submission_reason']}), score {a['score']}/{a['total_marks']}, result screen shown"
            rec('Quiz anti-cheat', 'Desktop: page hidden (tab switched)', 'submitted at once with reason tab-switch', desktop); ctx.close()
            # --- quiz: phone rule
            ctx = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')
            ctx.route('**/*', lambda r, _c=R.new_context(br): None) if False else None
            ctx2 = R.new_context(br, 390, 844); ctx.close(); page = ctx2.new_page(); R.watch(page, {'errors': [], 'backend_errors': []})
            page.add_init_script("Object.defineProperty(navigator,'userAgent',{get:()=>'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'})")
            assert R.login(page, 'student', sid[2], 'StudentPass1')[0]
            def phone():
                page.goto(R.BASE + f'/student/quiz.html?id={quiz}'); page.wait_for_selector('#tv', timeout=8000)
                page.evaluate("()=>{window.__s=0;const r=Date.now.bind(Date);Date.now=()=>r()+window.__s;}")
                hide(page, True); page.evaluate('window.__s=5000'); hide(page, False); page.wait_for_timeout(1200)
                assert get_doc(page, f'quizzes/{quiz}/attempts/{ids[2]}') is None, 'submitted after only 5 seconds away'
                hide(page, True); page.evaluate('window.__s+=30000'); hide(page, False); page.wait_for_timeout(2500)
                a = get_doc(page, f'quizzes/{quiz}/attempts/{ids[2]}'); assert a and a['submission_reason'] == 'tab-switch-phone', f'attempt={a and a.get("submission_reason")}'
                return f"5 s away ignored; 30 s away submitted on return (reason {a['submission_reason']}); hidden_count={a['hidden_count']}"
            rec('Quiz anti-cheat', 'Phone: 5 s away ignored, 30 s away submits on return (D5)', 'matches the approved rule', phone); ctx2.close()
            # --- quiz: manual answer + submit + leaderboard
            ctx = R.new_context(br); page = ctx.new_page(); R.watch(page, {'errors': [], 'backend_errors': []}); page.on('dialog', lambda d: d.accept()); assert R.login(page, 'student', sid[0], 'StudentPass1')[0]
            def manual():
                page.goto(R.BASE + f'/student/quiz.html?id={quiz}'); page.wait_for_selector('.opt', timeout=8000); page.click('.opt[data-o="B"]'); page.click('#sub'); page.wait_for_timeout(2500)
                a = get_doc(page, f'quizzes/{quiz}/attempts/{ids[0]}'); assert a and a['submission_reason'] == 'manual' and a['correct_count'] == 1, str(a and (a['submission_reason'], a['correct_count']))
                run_fn(page, 'processQuizBoards'); page.wait_for_timeout(600); page.goto(R.BASE + '/student/leaderboard.html'); page.wait_for_timeout(2200)
                t = page.evaluate('document.body.innerText'); assert 'Asha Kumari' in t, 'student missing on leaderboard'
                return f"score {a['score']}/{a['total_marks']} saved by the server; student shown on the leaderboard"
            rec('Quizzes', 'Answer, submit, leaderboard', 'server-scored attempt and leaderboard row', manual)
            def second_try():
                page.goto(R.BASE + f'/student/quiz.html?id={quiz}'); page.wait_for_timeout(1500); t = page.evaluate('document.body.innerText'); assert 'already submitted' in t, t[:120]; return 'second start refused: "You have already submitted this quiz."'
            rec('Quizzes', 'Open the same quiz again', 'refused', second_try)
            # --- cache isolation + account switch
            def switch():
                page.goto(R.BASE + '/student/dashboard.html'); page.wait_for_timeout(1800)
                ua = page.evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('bcc:'))")
                a_keys = [k for k in ua if ids[0] in k]; assert a_keys, 'no per-user cache keys found for the first student'
                assert R.login(page, 'student', sid[1], 'StudentPass1', add=True)[0]; page.wait_for_timeout(1800)
                ub = page.evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('bcc:'))")
                assert not [k for k in ub if ids[0] in k], 'first student cache survived: ' + str([k for k in ub if ids[0] in k])
                txt = page.evaluate('document.body.innerText'); me = json.loads(page.evaluate("sessionStorage.getItem('bcc:me')"))['v']['id']; assert 'Bilal' in txt and me == ids[1], f'wrong student shown after switch (me={me})'
                accts = json.loads(page.evaluate("localStorage.getItem('bcc-accounts')")); assert len(accts) == 2
                page.evaluate("async id=>{const m=await import('/js/core/accounts.js');await m.switchTo(id)}", ids[0]); page.goto(R.BASE + '/student/dashboard.html'); page.wait_for_timeout(1800)
                txt = page.evaluate('document.body.innerText'); me = json.loads(page.evaluate("sessionStorage.getItem('bcc:me')"))['v']['id']; assert 'Asha' in txt and me == ids[0], f'switch back failed (me={me})'
                uc = page.evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('bcc:'))"); assert not [k for k in uc if ids[1] in k and ':me' not in k and k != 'bcc:me'], 'second student cache survived the switch back'
                return 'two accounts on one device; after each switch the other student\'s cached data is gone and the right student is shown'
            rec('Cache isolation', 'Switch between two students on one device', 'no cached data of the previous student remains', switch); ctx.close()
            # --- staff: admission via the real form, lecture form with Drive link
            ctx = R.new_context(br); page = ctx.new_page(); st = {'errors': [], 'backend_errors': []}; R.watch(page, st); assert R.login(page, 'teacher', 'admin@bcc.test', 'AdminPass1')[0]
            def admit():
                page.goto(R.BASE + '/admin/admission.html'); page.wait_for_selector('#go'); page.click('#go'); page.wait_for_selector('#f_full_name')
                page.fill('#f_full_name', 'Browser Test Student'); page.select_option('#f_class_no', '10'); page.fill('#f_father_name', 'Father Test'); page.click('[data-ok]'); page.wait_for_timeout(2500)
                t = page.evaluate('document.body.innerText'); assert re.search(r'26BCC10\d\d', t), 'no Student ID shown: ' + t[-200:]
                m = re.search(r'26BCC10\d\d', t).group(0); return f'admission created {m}; credentials shown to the admin'
            rec('Admission', 'Admin admits a student through the real form', 'Student ID and password shown', admit)
            def lecture_form():
                page.goto(R.BASE + '/admin/lectures.html?class=10&subject=maths'); page.wait_for_selector('#add'); page.click('#add'); page.wait_for_selector('#f_src')
                assert page.is_visible('#f_yt') and not page.is_visible('#f_lk'), 'initial fields wrong'
                page.select_option('#f_src', 'gdrive'); page.wait_for_timeout(200); assert page.is_visible('#f_lk') and not page.is_visible('#f_yt') and page.is_visible('#f_dl') and page.is_visible('#f_title'), 'drive fields wrong / whole form hidden'
                page.fill('#f_title', 'Drive lecture via UI'); page.fill('#f_lk', 'https://drive.google.com/file/d/ABCDEFGHIJK12/view'); page.click('[data-ok]'); page.wait_for_timeout(2500)
                assert 'Drive lecture via UI' in page.evaluate('document.body.innerText'), 'new lecture not listed'; return 'form switches YouTube/Drive fields correctly; lecture saved and listed'
            rec('Lectures', 'Add a Google Drive lecture through the real form', 'saved and listed', lecture_form)
            def notes_upload():
                page.goto(R.BASE + '/admin/notes.html?class=10&subject=maths'); page.wait_for_selector('#add'); page.click('#add'); page.wait_for_selector('#f_src')
                assert 'upload' in page.evaluate("[...document.querySelectorAll('#f_src option')].map(o=>o.value).join()"), 'upload option missing'
                open('/tmp/test.pdf', 'wb').write(b'%PDF-1.4 test'); page.fill('#f_title', 'Uploaded PDF note'); page.set_input_files('#f_file', '/tmp/test.pdf'); page.click('[data-ok]'); page.wait_for_timeout(3000)
                assert 'Uploaded PDF note' in page.evaluate('document.body.innerText'), 'uploaded note not listed: ' + str(st['errors'][-2:]) + str(st['backend_errors'][-2:]); return 'PDF uploaded to storage, checked by the server, note listed'
            rec('Notes', 'Upload a PDF note', 'file stored, metadata saved, listed', notes_upload)
            ctx.close(); br.close()
    finally: server.terminate()
    json.dump(RES, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results-flows.json'), 'w'), indent=1)
    print(f"\nBROWSER FLOWS: {sum(r['pass'] for r in RES)}/{len(RES)} passed")
if __name__ == '__main__': main()
