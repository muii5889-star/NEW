/* =====================================================================
   لوحة إدخال بيانات المحطة
   - تشتغل مع Supabase لما تعبّي js/config.js
   - وبدونه تشتغل "وضع تجريبي" محفوظ على الجهاز
   ===================================================================== */
(function () {
  'use strict';
  const C = Core, E = C.esc, cfg = C.cfg, F = C.FIELDS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const WIN = cfg.ANOMALY_WINDOW || 10;

  /* ---------------- فقاعات الخلفية ---------------- */
  (function () {
    const fx = $('#fx'); if (!fx) return; let h = '';
    for (let i = 0; i < 12; i++) {
      const s = 6 + Math.random() * 22;
      h += `<span style="left:${(Math.random() * 100).toFixed(1)}%;width:${s.toFixed(0)}px;height:${s.toFixed(0)}px;--x:${((Math.random() - .5) * 80).toFixed(0)}px;animation-duration:${(16 + Math.random() * 18).toFixed(1)}s;animation-delay:-${(Math.random() * 25).toFixed(1)}s"></span>`;
    }
    fx.innerHTML = h;
  })();

  /* =====================================================================
     طبقة البيانات: نسختين بنفس الواجهة (تجريبي / Supabase)
     ===================================================================== */
  const sortDesc = a => a.sort((x, y) => (x.day < y.day ? 1 : -1));
  const err = (m, code) => { const e = new Error(m); if (code) e.code = code; return e; };

  function DemoStore() {
    const SK = 'khulais-demo-session';
    const db = () => C.demo.load(), save = d => C.demo.save(d);
    let cur = null;
    const need = p => { if (!C.can(cur, p)) throw err('ليس لديك صلاحية لهذه العملية'); };
    const log = (d, action, table, key, o, n) => {
      d.audit.unshift({ id: Date.now() + Math.random(), at: new Date().toISOString(), user_id: cur.id, user_email: cur.email, action, table_name: table, row_key: String(key), old_data: o || null, new_data: n || null });
      d.audit = d.audit.slice(0, 500);
    };
    const now = () => new Date().toISOString();
    return {
      demo: true,
      async session() {
        let id = null; try { id = sessionStorage.getItem(SK); } catch (e) { /* */ }
        cur = db().users.find(u => u.id === id && u.active) || null; return cur;
      },
      async demoUsers() { return db().users.filter(u => u.active); },
      async demoLogin(id) { try { sessionStorage.setItem(SK, id); } catch (e) { /* */ } return this.session(); },
      async logout() { try { sessionStorage.removeItem(SK); } catch (e) { /* */ } cur = null; },
      async listReadings(from, to) { need('read'); return sortDesc(Object.values(db().readings).filter(r => r.day >= from && r.day <= to)); },
      async recentBefore(day, n) { return sortDesc(Object.values(db().readings).filter(r => r.day < day)).slice(0, n); },
      async getReading(day) { return db().readings[day] || null; },
      async addReading(r) {
        need('insert'); const d = db();
        if (d.readings[r.day]) throw err('هذا اليوم مسجّل مسبقاً', 'DUP');
        if (r.day > C.addDays(C.today(), 1)) throw err('لا يمكن تسجيل قراءة لتاريخ في المستقبل');
        const row = Object.assign({}, r, { created_by: cur.id, created_at: now(), updated_by: null, updated_at: null });
        d.readings[r.day] = row; log(d, 'INSERT', 'daily_readings', r.day, null, row); save(d);
      },
      async updateReading(day, r) {
        need('edit'); const d = db(), old = d.readings[day]; if (!old) throw err('السجل غير موجود');
        const row = Object.assign({}, old, r, { day, updated_by: cur.id, updated_at: now() });
        d.readings[day] = row; log(d, 'UPDATE', 'daily_readings', day, old, row); save(d);
      },
      async deleteReading(day) {
        need('delete'); const d = db(), old = d.readings[day]; if (!old) throw err('السجل غير موجود');
        delete d.readings[day]; log(d, 'DELETE', 'daily_readings', day, old, null); save(d);
      },
      async listYearly() { need('read'); return Object.values(db().yearly).sort((a, b) => a.year - b.year); },
      async saveYearly(r, orig) {
        need('yearly'); const d = db();
        if ((orig == null || +orig !== +r.year) && d.yearly[r.year]) throw err('هذه السنة مسجّلة مسبقاً', 'DUP');
        const old = orig != null ? d.yearly[orig] : null;
        if (orig != null) delete d.yearly[orig];
        const row = Object.assign({}, old || { created_by: cur.id, created_at: now() }, r, old ? { updated_by: cur.id, updated_at: now() } : {});
        d.yearly[r.year] = row; log(d, old ? 'UPDATE' : 'INSERT', 'yearly_totals', r.year, old, row); save(d);
      },
      async deleteYearly(y) {
        need('yearly'); const d = db(), old = d.yearly[y]; if (!old) throw err('السجل غير موجود');
        delete d.yearly[y]; log(d, 'DELETE', 'yearly_totals', y, old, null); save(d);
      },
      async summaryRows() { return C.demo.summaryRows(db()); },
      async listUsers() { need('admin'); return db().users; },
      async createUser(u) {
        need('admin'); const d = db(), email = String(u.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err('البريد الإلكتروني غير صحيح');
        if (String(u.password || '').length < 8) throw err('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
        if (d.users.some(x => x.email === email)) throw err('هذا البريد مسجّل مسبقاً');
        d.users.push({ id: 'demo-' + Date.now(), email, full_name: u.full_name || '', role: u.role === 'admin' ? 'admin' : 'user', can_insert: !!u.can_insert, can_edit: !!u.can_edit, can_delete: !!u.can_delete, can_yearly: !!u.can_yearly, active: true, created_at: now() });
        save(d);
      },
      async updateUser(id, p) {
        need('admin'); const d = db(), u = d.users.find(x => x.id === id); if (!u) throw err('المستخدم غير موجود');
        const role = p.role === 'admin' ? 'admin' : 'user', active = p.active !== false;
        if (id === cur.id && (role !== 'admin' || !active)) throw err('لا يمكنك إزالة صلاحية المدير أو إيقاف حسابك بنفسك');
        if (u.role === 'admin' && u.active && (role !== 'admin' || !active) && !d.users.some(x => x.id !== id && x.role === 'admin' && x.active)) throw err('لا يمكن إزالة آخر مدير في النظام');
        Object.assign(u, { full_name: p.full_name ?? u.full_name, role, active, can_insert: !!p.can_insert, can_edit: !!p.can_edit, can_delete: !!p.can_delete, can_yearly: !!p.can_yearly });
        save(d);
      },
      async deleteUser(id) {
        need('admin'); if (id === cur.id) throw err('لا يمكنك حذف حسابك بنفسك');
        const d = db(), u = d.users.find(x => x.id === id);
        if (u && u.role === 'admin' && !d.users.some(x => x.id !== id && x.role === 'admin' && x.active)) throw err('لا يمكن إزالة آخر مدير في النظام');
        d.users = d.users.filter(x => x.id !== id); save(d);
      },
      async listAudit() { need('admin'); return db().audit.slice(0, 300); },
      onSignedOut() { /* لا شيء في الوضع التجريبي */ }
    };
  }

  function RemoteStore() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'khulais-admin-auth' }
    });
    const mapErr = e => {
      const m = (e && e.message) || '';
      if (e && e.code === '23505') return err('هذا السجل موجود مسبقاً', 'DUP');
      if (/row-level security|permission denied|42501/i.test(m + (e && e.code))) return err('ليس لديك صلاحية لهذه العملية');
      if (/Invalid login credentials/i.test(m)) return err('البريد أو كلمة المرور غير صحيحة');
      if (/Email not confirmed/i.test(m)) return err('الحساب غير مفعّل بعد');
      if (/banned|User is banned/i.test(m)) return err('هذا الحساب موقوف، راجع المدير');
      if (e && e.code === '23514') return err('قيمة غير مقبولة، تأكد من الأرقام والتاريخ');
      if (/Failed to fetch|NetworkError/i.test(m)) return err('تعذّر الاتصال بالخادم، تأكد من الإنترنت');
      return err(m || 'حدث خطأ غير متوقع');
    };
    const chk = r => { if (r.error) throw mapErr(r.error); return r.data; };
    const changed = (rows, what) => { if (!rows || !rows.length) throw err(`ليس لديك صلاحية ${what} أو السجل غير موجود`); };
    const fn = async body => {
      const { data, error } = await sb.functions.invoke('admin-users', { body });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); msg = j.error || msg; } catch (x) { /* */ }
        throw err(msg);
      }
      if (data && data.error) throw err(data.error);
      return data;
    };
    let out = null;
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && out) out(); });
    return {
      demo: false,
      async session() {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return null;
        const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
        return data || null;
      },
      async login(email, password) { chk(await sb.auth.signInWithPassword({ email: email.trim(), password })); return this.session(); },
      async logout() { await sb.auth.signOut(); },
      onSignedOut(cb) { out = cb; },
      async listReadings(from, to) { return chk(await sb.from('daily_readings').select('*').gte('day', from).lte('day', to).order('day', { ascending: false }).limit(1000)); },
      async recentBefore(day, n) { return chk(await sb.from('daily_readings').select('*').lt('day', day).order('day', { ascending: false }).limit(n)); },
      async getReading(day) { return chk(await sb.from('daily_readings').select('*').eq('day', day).maybeSingle()); },
      async addReading(r) { chk(await sb.from('daily_readings').insert(r)); },
      async updateReading(day, r) { changed(chk(await sb.from('daily_readings').update(r).eq('day', day).select('day')), 'التعديل'); },
      async deleteReading(day) { changed(chk(await sb.from('daily_readings').delete().eq('day', day).select('day')), 'الحذف'); },
      async listYearly() { return chk(await sb.from('yearly_totals').select('*').order('year')); },
      async saveYearly(r, orig) {
        if (orig != null) changed(chk(await sb.from('yearly_totals').update(r).eq('year', orig).select('year')), 'التعديل');
        else chk(await sb.from('yearly_totals').insert(r));
      },
      async deleteYearly(y) { changed(chk(await sb.from('yearly_totals').delete().eq('year', y).select('year')), 'الحذف'); },
      async summaryRows() { return chk(await sb.rpc('public_summary')); },
      async listUsers() { return chk(await sb.from('profiles').select('*').order('created_at')); },
      createUser: u => fn(Object.assign({ action: 'create' }, u)),
      updateUser: (id, p) => fn(Object.assign({ action: 'update', id }, p)),
      deleteUser: id => fn({ action: 'delete', id }),
      async listAudit() { return chk(await sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300)); }
    };
  }

  /* =====================================================================
     أدوات الواجهة
     ===================================================================== */
  let ST = null, ME = null;
  const can = p => C.can(ME, p);

  function toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + type; t.textContent = (type === 'bad' ? '⚠ ' : '✓ ') + msg;
    $('#toasts').append(t); setTimeout(() => t.remove(), type === 'bad' ? 6000 : 3500);
  }
  let onModalClose = null;
  function modal(html, mount) {
    $('#mBody').innerHTML = html; $('#modal').hidden = false;
    if (mount) mount($('#mBody'));
    const f = $('#mBody input:not([disabled]),#mBody select,#mBody .btn'); if (f) f.focus();
  }
  function closeModal() {
    $('#modal').hidden = true; $('#mBody').innerHTML = '';
    const c = onModalClose; onModalClose = null; if (c) c();
  }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  function confirmBox(title, text, ok = 'تأكيد', danger = true) {
    return new Promise(res => {
      modal(`<h3>${E(title)}</h3><p class="mut">${E(text)}</p><div class="mfoot"><button class="btn ${danger ? 'danger' : 'pri'}" data-ok type="button">${E(ok)}</button><button class="btn ghost" data-close type="button">إلغاء</button></div>`,
        m => { m.querySelector('[data-ok]').addEventListener('click', () => { onModalClose = null; closeModal(); res(true); }); });
      onModalClose = () => res(false);
    });
  }
  async function busy(btn, fn) {
    const t = btn.innerHTML; btn.disabled = true; btn.textContent = 'جاري...';
    try { return await fn(); } catch (e) { toast(e.message || String(e), 'bad'); } finally { btn.disabled = false; btn.innerHTML = t; }
  }
  /* يقبل الأرقام العربية والفواصل */
  const toNum = s => {
    s = String(s ?? '').trim()
      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/٫/g, '.').replace(/[,،\s]/g, '');
    if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN;
  };
  const ap = v => (Math.abs(v) >= 100 ? C.fmt(v) : C.fmtA(v));
  const spin = '<div class="spin" role="status" aria-label="جاري التحميل"></div>';
  const ROLE = p => (p.role === 'admin' ? 'مدير' : 'مستخدم');
  const PERM_L = { insert: 'إدخال قراءات', edit: 'تعديل القراءات', delete: 'حذف القراءات', yearly: 'إدارة السجل السنوي' };

  /* =====================================================================
     حقول القراءة + تنبيه الشاذ (مشتركة بين الإدخال والتعديل)
     ===================================================================== */
  const fieldsHTML = (p, r = {}) => F.map(f => `
    <label class="fld"><span>${f.l} <small id="${p}b-${f.k}"></small></span>
      <span class="unit"><input id="${p}-${f.k}" data-k="${f.k}" inputmode="decimal" autocomplete="off" dir="ltr" placeholder="0" value="${r[f.k] != null ? E(r[f.k]) : ''}"><em>${f.u}</em></span>
      <div id="${p}w-${f.k}"></div></label>`).join('');

  async function baselines(day) {
    const h = await ST.recentBefore(day, WIN), b = {};
    F.forEach(f => (b[f.k] = C.baseline(h.map(r => r[f.k]))));
    return b;
  }
  function liveCheck(root, p, base) {
    const v = {}, flags = [];
    F.forEach(f => {
      v[f.k] = toNum(root.querySelector(`#${p}-${f.k}`).value);
      const b = base && base[f.k], w = root.querySelector(`#${p}w-${f.k}`);
      root.querySelector(`#${p}b-${f.k}`).textContent = b ? `المعتاد ≈ ${ap(b.m)}` : '';
      if (Number.isNaN(v[f.k]) || v[f.k] < 0) { w.innerHTML = '<div class="warn">⚠ <span>رقم غير صحيح</span></div>'; return; }
      const a = v[f.k] == null ? null : C.check(v[f.k], b);
      if (a) flags.push(f.l);
      w.innerHTML = a ? `<div class="warn">⚠ <span>${a.t === 'high' ? 'أعلى' : 'أقل'} من المعتاد بنسبة ${Math.round(a.pct * 100)}% (المعتاد ≈ ${ap(b.m)} ${f.u}). تأكد من الرقم، والحفظ مسموح.</span></div>` : '';
    });
    const ok = x => x != null && !Number.isNaN(x);
    const ex = (ok(v.export_khulais) ? v.export_khulais : 0) + (ok(v.export_kamil) ? v.export_kamil : 0);
    const x = root.querySelector(`#${p}x`);
    if (x) x.innerHTML = ok(v.production) && v.production > 0 && ex > v.production * 1.05
      ? `<div class="warn">⚠ <span>إجمالي التصدير (${C.fmtA(ex)} م³) أكبر من الإنتاج (${C.fmtA(v.production)} م³). تأكد من الأرقام.</span></div>` : '';
    const s = root.querySelector(`#${p}s`);
    if (s) s.innerHTML = `<span>إجمالي التصدير: <b>${ex ? C.fmtA(ex) : '—'}</b> م³</span>
      <span>الطاقة لكل م³: <b>${ok(v.production) && v.production && ok(v.energy) ? C.fmt(v.energy / v.production, 3) : '—'}</b> kWh</span>
      <span>الكيماويات لكل م³: <b>${ok(v.production) && v.production && ok(v.chemicals) ? C.fmt(v.chemicals / v.production, 4) : '—'}</b> kg</span>`;
    return flags;
  }
  function readFields(root, p) {
    const o = {}, bad = [];
    F.forEach(f => {
      const v = toNum(root.querySelector(`#${p}-${f.k}`).value);
      if (v === null || Number.isNaN(v) || v < 0) bad.push(f.l); else o[f.k] = C.round(v, f.d);
    });
    return { o, bad };
  }

  /* =====================================================================
     التبويبات والتنقل
     ===================================================================== */
  const IC = {
    home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    entry: '<path d="M12 5v14M5 12h14"/>',
    records: '<path d="M4 5h16M4 10h16M4 15h16M4 20h10"/>',
    yearly: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3.5 5.5"/>',
    audit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  const TABS = [
    { id: 'home', l: 'الرئيسية' },
    { id: 'entry', l: 'إدخال قراءة', p: 'insert' },
    { id: 'records', l: 'السجلات' },
    { id: 'yearly', l: 'السجل السنوي' },
    { id: 'users', l: 'المستخدمون', p: 'admin' },
    { id: 'audit', l: 'سجل العمليات', p: 'admin' }
  ];
  const VIEWS = {};
  let routeArg = null;
  function go(id, arg) { routeArg = arg ?? null; if (location.hash === '#' + id) route(); else location.hash = id; }
  function route() {
    if (!ME) return;
    const tabs = TABS.filter(t => !t.p || can(t.p));
    let id = location.hash.slice(1); if (!tabs.some(t => t.id === id)) id = 'home';
    $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.id === id));
    const on = $(`#tabs a[data-id="${id}"]`); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const v = $('#view'); v.innerHTML = spin; v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
    const arg = routeArg; routeArg = null;
    Promise.resolve(VIEWS[id](v, arg)).catch(e => { v.innerHTML = `<div class="card empty">⚠ ${E(e.message || e)}</div>`; });
  }
  addEventListener('hashchange', route);

  /* ---------------- الرئيسية ---------------- */
  VIEWS.home = async v => {
    const t = C.today(), cy = +t.slice(0, 4), yest = C.addDays(t, -1);
    const [rows, yearly, yr, recent] = await Promise.all([
      ST.summaryRows(), ST.listYearly(), ST.listReadings(`${cy}-01-01`, t), ST.listReadings(C.addDays(t, -45), t)
    ]);
    const S = (C.summarize(rows).years.find(y => y.yr === cy)) || C.stats({ yr: cy, days: 0 });
    const base = yearly.find(y => +y.year === cy);
    const have = new Set(yr.map(r => r.day));
    let start = base ? C.addDays(base.through_date, 1) : (yr.length ? yr[yr.length - 1].day : null);
    const missing = [];
    if (start) for (let d = start; d <= yest && missing.length < 400; d = C.addDays(d, 1)) if (!have.has(d)) missing.push(d);
    const todayDone = have.has(t);

    /* مخطط آخر 30 يوم */
    const asc = recent.slice().reverse(), map = {}; asc.forEach(r => (map[r.day] = r));
    const days = []; for (let i = 29; i >= 0; i--) days.push(C.addDays(t, -i));
    const mx = Math.max(1, ...asc.map(r => +r.production));
    const bars = days.map((d, i) => {
      const r = map[d];
      if (!r) return `<i class="miss" title="${E(C.dateAr(d))}: لا توجد قراءة"></i>`;
      const hist = asc.filter(x => x.day < d).reverse().map(x => x.production);
      const a = C.check(r.production, C.baseline(hist));
      return `<i class="${a ? 'wr' : ''}" style="height:${Math.max(4, r.production / mx * 100).toFixed(1)}%;animation-delay:${i * 18}ms" title="${E(C.dateAr(d))}: ${C.fmtA(r.production)} م³${a ? ' (غير معتاد)' : ''}"></i>`;
    }).join('');

    const name = (ME.full_name || ME.email).split(' ')[0];
    v.innerHTML = `
      <div class="fbar"><h1 class="h1" style="flex:1">أهلاً ${E(name)} 👋</h1>
        ${can('insert') ? `<button class="btn pri" id="goEntry" type="button">${todayDone ? 'إدخال قراءة' : '+ إدخال قراءة اليوم'}</button>` : ''}</div>
      <div class="card"><div class="ch"><h2>سنة ${cy} حتى الآن</h2><span class="badge acc">${S.last_date ? 'آخر قراءة: ' + E(C.dateAr(S.last_date)) : 'لا توجد بيانات بعد'}</span></div>
        <div class="prog" title="الأيام المسجلة"><i style="width:${Math.min(100, S.days / S.diy * 100).toFixed(1)}%"></i></div>
        <p class="hint" style="margin-top:6px">مسجّل ${S.days} يوم من ${S.diy}</p></div>
      <div class="kpis">
        <div class="kpi"><span>إنتاج السنة</span><b class="num">${C.fmt(S.production)}</b><small>م³</small></div>
        <div class="kpi"><span>المتوسط اليومي</span><b class="num">${C.fmt(S.daily.production)}</b><small>م³ / يوم</small></div>
        <div class="kpi"><span>الطاقة لكل م³</span><b class="num">${C.fmt(S.energy_per_m3, 3)}</b><small>kWh/m³</small></div>
        <div class="kpi"><span>الكيماويات لكل م³</span><b class="num">${C.fmt(S.chem_per_m3, 4)}</b><small>kg/m³</small></div>
      </div>
      <div class="grid2">
        <div class="card"><div class="ch"><h2>الإنتاج اليومي · آخر 30 يوم</h2></div>
          ${asc.length ? `<div class="bars">${bars}</div><div class="barx"><span>${E(C.dateAr(days[0], { year: undefined }))}</span><span>اليوم</span></div>
          <p class="hint" style="margin-top:8px">الأعمدة الصفراء = قيمة غير معتادة · المخطط = يوم بدون قراءة</p>` : '<p class="empty">لا توجد قراءات يومية بعد</p>'}</div>
        <div class="card"><div class="ch"><h2>أيام بدون قراءة</h2><span class="badge ${missing.length ? 'wr' : 'ok'}">${missing.length}</span></div>
          ${!start ? '<p class="empty">يبدأ الحساب من أول قراءة يومية تسجلها هذه السنة</p>'
            : missing.length ? `<p class="hint" style="margin-bottom:10px">${can('insert') ? 'اضغط على اليوم لإدخال قراءته' : 'هذه الأيام لم تُسجّل بعد'}</p><div class="chips">${missing.slice(-40).reverse().map(d => `<button type="button" class="chip" data-day="${d}">${E(C.dateAr(d, { year: undefined }))}</button>`).join('')}</div>`
            : '<p class="empty">✓ كل الأيام مسجّلة حتى أمس</p>'}</div>
      </div>
      <div class="grid3">
        <div class="kpi"><span>التصدير إلى خليص</span><b class="num">${C.fmt(S.export_khulais)}</b><small>م³ هذه السنة</small></div>
        <div class="kpi"><span>التصدير إلى الكامل</span><b class="num">${C.fmt(S.export_kamil)}</b><small>م³ هذه السنة</small></div>
        <div class="kpi"><span>استهلاك الطاقة</span><b class="num">${C.fmt(S.energy)}</b><small>kWh هذه السنة</small></div>
      </div>`;
    const g = $('#goEntry', v); if (g) g.addEventListener('click', () => go('entry'));
    if (can('insert')) $$('.chip[data-day]', v).forEach(b => b.addEventListener('click', () => go('entry', b.dataset.day)));
  };

  /* ---------------- إدخال قراءة ---------------- */
  VIEWS.entry = async (v, preset) => {
    const t = C.today();
    v.innerHTML = `
      <div class="card"><div class="ch"><h2>إدخال قراءة يومية</h2></div>
      <form class="form" id="fE" novalidate>
        <div class="fgrid">
          <label class="fld"><span>التاريخ <small id="wd"></small></span><input type="date" id="eDay" max="${t}" value="${E(preset || t)}" required></label>
          <div class="fld"><span>حالة اليوم</span><div id="dayState" class="hint" style="padding-top:10px">…</div></div>
        </div>
        <div id="dayWarn"></div>
        <div class="fgrid">${fieldsHTML('e')}
          <label class="fld" style="grid-column:1/-1"><span>ملاحظة <small>اختياري</small></span><textarea id="eNote" maxlength="500" placeholder="مثال: توقف مضخة لمدة ساعتين"></textarea></label>
        </div>
        <div id="ex"></div>
        <div class="sumline" id="es"></div>
        <p class="hint">💡 التنبيه الأصفر لا يمنع الحفظ. النظام يقارن بآخر ${WIN} قراءات، ولو تغيّر مستوى المحطة وتكرر عدة أيام يعتبره المعدل الجديد تلقائياً.</p>
        <div class="fbar"><button class="btn pri" type="submit" id="eSave">حفظ القراءة</button><button type="button" class="btn ghost" id="eClr">مسح الحقول</button></div>
      </form></div>`;
    const f = $('#fE', v), day = $('#eDay', v);
    let base = null, exists = null, tok = 0;
    const refresh = () => liveCheck(f, 'e', base);
    async function loadDay() {
      const d = day.value, my = ++tok;
      $('#wd', v).textContent = d ? C.weekday(d) : '';
      $('#dayWarn', v).innerHTML = ''; $('#dayState', v).textContent = '…';
      if (!d) return;
      const [b, r, yl] = await Promise.all([baselines(d), ST.getReading(d), ST.listYearly()]);
      if (my !== tok) return;
      base = b; exists = r;
      const yb = yl.find(y => +y.year === +d.slice(0, 4));
      let w = '';
      if (d > t) w += '<div class="warn">⚠ <span>هذا التاريخ في المستقبل.</span></div>';
      if (yb && d <= yb.through_date) w += `<div class="warn">⚠ <span>هذا اليوم داخل فترة الإجمالي السنوي لسنة ${yb.year} (حتى ${E(C.dateAr(yb.through_date))}). تسجيله يومياً سيحسبه مرتين.</span></div>`;
      $('#dayWarn', v).innerHTML = w;
      if (r) {
        $('#dayState', v).innerHTML = `<span class="badge wr">مسجّل مسبقاً</span> ${can('edit') ? '<button type="button" class="btn sm" id="eEdit">تعديل قراءته</button>' : ''}`;
        const eb = $('#eEdit', v); if (eb) eb.addEventListener('click', () => editReading(r, loadDay));
      } else $('#dayState', v).innerHTML = '<span class="badge ok">غير مسجّل، جاهز للإدخال</span>';
      $('#eSave', v).disabled = !!r;
      refresh();
    }
    day.addEventListener('change', loadDay);
    f.addEventListener('input', e => { if (e.target.dataset.k) refresh(); });
    $('#eClr', v).addEventListener('click', () => { F.forEach(x => ($(`#e-${x.k}`, v).value = '')); $('#eNote', v).value = ''; refresh(); });
    f.addEventListener('submit', e => {
      e.preventDefault();
      busy($('#eSave', v), async () => {
        const d = day.value; if (!d) throw err('اختر التاريخ');
        const { o, bad } = readFields(f, 'e');
        if (bad.length) throw err('أكمل الحقول التالية بأرقام صحيحة: ' + bad.join('، '));
        const flags = liveCheck(f, 'e', base);
        const note = $('#eNote', v).value.trim().slice(0, 500);
        await ST.addReading(Object.assign({ day: d, note: note || null }, o));
        toast(`تم حفظ قراءة ${C.dateAr(d)}${flags.length ? ' (مع تنبيه: ' + flags.join('، ') + ')' : ''}`);
        F.forEach(x => ($(`#e-${x.k}`, v).value = '')); $('#eNote', v).value = '';
        const nx = C.addDays(d, 1); if (nx <= t) day.value = nx;
        await loadDay(); $(`#e-${F[0].k}`, v).focus();
      }).catch(() => {});
    });
    await loadDay();
    $(`#e-${F[0].k}`, v).focus();
  };

  function editReading(r, after) {
    modal(`<h3>تعديل قراءة ${E(C.dateAr(r.day))}</h3>
      <form class="form" id="fM" novalidate><div class="fgrid">${fieldsHTML('m', r)}
      <label class="fld" style="grid-column:1/-1"><span>ملاحظة</span><textarea id="mNote" maxlength="500">${E(r.note || '')}</textarea></label></div>
      <div id="mx"></div><div class="sumline" id="ms"></div>
      <div class="mfoot"><button class="btn pri" type="submit" id="mSave">حفظ التعديل</button><button class="btn ghost" type="button" data-close>إلغاء</button></div></form>`,
      m => {
        let base = null; const f = $('#fM', m);
        baselines(r.day).then(b => { base = b; if (f.isConnected) liveCheck(f, 'm', base); });
        liveCheck(f, 'm', null);
        f.addEventListener('input', () => liveCheck(f, 'm', base));
        f.addEventListener('submit', e => {
          e.preventDefault();
          busy($('#mSave', m), async () => {
            const { o, bad } = readFields(f, 'm');
            if (bad.length) throw err('أكمل الحقول: ' + bad.join('، '));
            await ST.updateReading(r.day, Object.assign({ note: $('#mNote', m).value.trim().slice(0, 500) || null }, o));
            closeModal(); toast('تم حفظ التعديل'); if (after) after();
          });
        });
      });
  }
  async function delReading(r, after) {
    if (!(await confirmBox('حذف القراءة', `سيتم حذف قراءة ${C.dateAr(r.day)} نهائياً. هل أنت متأكد؟`, 'حذف'))) return;
    try { await ST.deleteReading(r.day); toast('تم الحذف'); if (after) after(); } catch (e) { toast(e.message, 'bad'); }
  }

  /* ---------------- السجلات ---------------- */
  let recMonth = C.today().slice(0, 7);
  VIEWS.records = async v => {
    const shift = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${C.pad(m)}`; };
    const from = recMonth + '-01', to = C.addDays(shift(recMonth, 1) + '-01', -1);
    const all = (await ST.listReadings(C.addDays(from, -40), to)).slice().reverse();
    const rows = all.filter(r => r.day >= from).reverse();
    const flags = {};
    rows.forEach(r => {
      const hist = all.filter(x => x.day < r.day).reverse();
      const fl = F.filter(f => C.check(r[f.k], C.baseline(hist.map(x => x[f.k])))).map(f => f.l);
      if (fl.length) flags[r.day] = fl;
    });
    const tot = {}; F.forEach(f => (tot[f.k] = rows.reduce((s, r) => s + C.num(r[f.k]), 0)));
    const hdr = ['الإنتاج م³', 'خليص م³', 'الكامل م³', 'الطاقة kWh', 'الكيماويات kg'];
    v.innerHTML = `
      <div class="card"><div class="ch"><h2>السجلات اليومية</h2>
        <button class="btn sm" id="rPrev" type="button" aria-label="الشهر السابق">→</button>
        <input type="month" id="rMonth" value="${recMonth}" style="width:auto">
        <button class="btn sm" id="rNext" type="button" aria-label="الشهر التالي">←</button>
        <button class="btn sm" id="rCsv" type="button" ${rows.length ? '' : 'disabled'}>⬇ Excel</button></div>
        ${rows.length ? `<div class="wrap"><table class="tbl rs"><thead><tr><th>التاريخ</th>${hdr.map(h => `<th>${h}</th>`).join('')}<th>kWh/م³</th><th></th></tr></thead><tbody>
        ${rows.map(r => `<tr class="${flags[r.day] ? 'flag' : ''}"><td data-l="التاريخ">${E(C.dateAr(r.day, { year: undefined }))} <small class="mut">${E(C.weekday(r.day))}</small>${flags[r.day] ? ` <span class="badge wr" title="غير معتاد: ${E(flags[r.day].join('، '))}">⚠</span>` : ''}${r.note ? ` <span class="badge" title="${E(r.note)}">📝</span>` : ''}</td>
          ${F.map((f, i) => `<td data-l="${hdr[i]}">${C.fmtA(r[f.k])}</td>`).join('')}
          <td data-l="kWh لكل م³">${r.production ? C.fmt(r.energy / r.production, 3) : '—'}</td>
          <td class="act">${can('edit') ? `<button class="ibtn" data-ed="${r.day}" title="تعديل" type="button">✎ تعديل</button>` : ''}${can('delete') ? `<button class="ibtn del" data-del="${r.day}" title="حذف" type="button">🗑</button>` : ''}</td></tr>`).join('')}
        </tbody><tfoot><tr><td data-l="المجموع">المجموع (${rows.length} يوم)</td>${F.map((f, i) => `<td data-l="${hdr[i]}">${C.fmtA(tot[f.k])}</td>`).join('')}<td data-l="kWh لكل م³">${tot.production ? C.fmt(tot.energy / tot.production, 3) : '—'}</td><td></td></tr></tfoot></table></div>`
        : '<p class="empty">لا توجد قراءات في هذا الشهر</p>'}</div>`;
    const re = () => VIEWS.records(v);
    $('#rMonth', v).addEventListener('change', e => { if (e.target.value) { recMonth = e.target.value; re(); } });
    $('#rPrev', v).addEventListener('click', () => { recMonth = shift(recMonth, -1); re(); });
    $('#rNext', v).addEventListener('click', () => { recMonth = shift(recMonth, 1); re(); });
    $('#rCsv', v).addEventListener('click', () => csv(rows.slice().reverse(), recMonth));
    const byDay = {}; rows.forEach(r => (byDay[r.day] = r));
    $$('[data-ed]', v).forEach(b => b.addEventListener('click', () => editReading(byDay[b.dataset.ed], re)));
    $$('[data-del]', v).forEach(b => b.addEventListener('click', () => delReading(byDay[b.dataset.del], re)));
  };
  function csv(rows, name) {
    const q = x => { x = String(x ?? ''); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const head = ['التاريخ'].concat(F.map(f => `${f.l} (${f.u})`), ['ملاحظة']);
    const lines = [head].concat(rows.map(r => [r.day].concat(F.map(f => r[f.k]), [(r.note || '').replace(/[\r\n]+/g, ' ')]))).map(a => a.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines], { type: 'text/csv;charset=utf-8' }));
    a.download = `قراءات-${name}.csv`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------------- السجل السنوي ---------------- */
  VIEWS.yearly = async v => {
    const [rows, yl] = await Promise.all([ST.summaryRows(), ST.listYearly()]);
    const years = C.summarize(rows).years.slice().reverse(), byY = {};
    yl.forEach(y => (byY[y.year] = y));
    const src = y => {
      const b = byY[y.yr], bd = b ? C.dayOfYear(b.through_date) : 0;
      return b && y.days > bd ? 'إجمالي + يومي' : b ? 'إجمالي' : 'يومي';
    };
    v.innerHTML = `
      <div class="card"><div class="ch"><h2>ملخص السنوات</h2><span class="hint">هذا اللي يظهر للزوار</span></div>
        ${years.length ? `<div class="wrap"><table class="tbl rs"><thead><tr><th>السنة</th><th>الأيام</th><th>الإنتاج م³</th><th>الطاقة kWh</th><th>الكيماويات kg</th><th>التصدير م³</th><th>المصدر</th></tr></thead><tbody>
        ${years.map(y => `<tr><td data-l="السنة">${y.yr} ${y.complete ? '<span class="badge ok">مكتملة</span>' : '<span class="badge acc">جارية</span>'}</td><td data-l="الأيام">${y.days} / ${y.diy}</td><td data-l="الإنتاج م³">${C.fmt(y.production)}</td><td data-l="الطاقة kWh">${C.fmt(y.energy)}</td><td data-l="الكيماويات kg">${C.fmt(y.chemicals)}</td><td data-l="التصدير م³">${C.fmt(y.export_total)}</td><td data-l="المصدر"><span class="badge">${src(y)}</span></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">لا توجد بيانات بعد</p>'}</div>
      <div class="card"><div class="ch"><h2>الإجماليات المسجّلة يدوياً</h2>${can('yearly') ? '<button class="btn pri sm" id="yAdd" type="button">+ إضافة إجمالي سنة</button>' : ''}</div>
        <p class="hint" style="margin-bottom:12px">للسنوات اللي ما لها قراءات يومية (مثل 2024 و2025)، أو لمجموع جزء من السنة قبل ما يبدأ التسجيل اليومي. مثال: سجّل 2026 "حتى 31 أكتوبر"، وبعدها ابدأ الإدخال اليومي من 1 نوفمبر، والموقع يجمعهم تلقائياً.</p>
        ${yl.length ? `<div class="wrap"><table class="tbl rs"><thead><tr><th>السنة</th><th>يغطي حتى</th>${F.map(f => `<th>${f.l} ${f.u}</th>`).join('')}<th></th></tr></thead><tbody>
        ${yl.slice().reverse().map(y => `<tr><td data-l="السنة">${y.year}</td><td data-l="يغطي حتى">${E(C.dateAr(y.through_date))}</td>${F.map(f => `<td data-l="${f.l}">${C.fmtA(y[f.k])}</td>`).join('')}
          <td class="act">${can('yearly') ? `<button class="ibtn" data-ye="${y.year}" type="button">✎ تعديل</button><button class="ibtn del" data-yd="${y.year}" type="button" title="حذف">🗑</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">لا توجد إجماليات مسجلة</p>'}</div>`;
    const re = () => VIEWS.yearly(v);
    const a = $('#yAdd', v); if (a) a.addEventListener('click', () => yearForm(null, re));
    $$('[data-ye]', v).forEach(b => b.addEventListener('click', () => yearForm(byY[b.dataset.ye], re)));
    $$('[data-yd]', v).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmBox('حذف الإجمالي', `سيتم حذف إجمالي سنة ${b.dataset.yd}. القراءات اليومية لن تتأثر.`, 'حذف'))) return;
      try { await ST.deleteYearly(+b.dataset.yd); toast('تم الحذف'); re(); } catch (e) { toast(e.message, 'bad'); }
    }));
  };
  function yearForm(y, after) {
    const cy = new Date().getFullYear(), yr = y ? y.year : cy - 1;
    modal(`<h3>${y ? 'تعديل إجمالي سنة ' + y.year : 'إضافة إجمالي سنة'}</h3>
      <form class="form" id="fY" novalidate>
        <div class="fgrid">
          <label class="fld"><span>السنة</span><input id="yYear" inputmode="numeric" dir="ltr" value="${yr}"></label>
          <label class="fld"><span>المجموع يغطي حتى <small id="yDays"></small></span><input type="date" id="yThrough" value="${y ? E(y.through_date) : yr + '-12-31'}"></label>
        </div>
        <div id="yWarn"></div>
        <div class="fgrid">${fieldsHTML('y', y || {})}
          <label class="fld" style="grid-column:1/-1"><span>ملاحظة <small>اختياري</small></span><textarea id="yNote" maxlength="500">${E((y && y.note) || '')}</textarea></label></div>
        <div id="yx"></div><div class="sumline" id="ys"></div>
        <div class="mfoot"><button class="btn pri" type="submit" id="ySave">حفظ</button><button class="btn ghost" type="button" data-close>إلغاء</button></div>
      </form>`, m => {
      const f = $('#fY', m), yy = $('#yYear', m), th = $('#yThrough', m);
      let tok = 0;
      async function upd(fromYear) {
        const n = toNum(yy.value);
        if (fromYear && n >= 2000 && n <= 2100) th.value = (n === cy ? C.today() : n + '-12-31');
        const d = th.value; $('#yDays', m).textContent = d ? `(${C.dayOfYear(d)} يوم)` : '';
        const my = ++tok; $('#yWarn', m).innerHTML = '';
        if (!d) return;
        try {
          const r = await ST.listReadings(d.slice(0, 4) + '-01-01', d);
          if (my === tok && r.length) $('#yWarn', m).innerHTML = `<div class="warn">⚠ <span>يوجد ${r.length} قراءة يومية داخل هذه الفترة، وستُحسب مرتين. خلّ تاريخ "يغطي حتى" قبل أول قراءة يومية.</span></div>`;
        } catch (e) { /* */ }
      }
      yy.addEventListener('change', () => upd(true)); th.addEventListener('change', () => upd(false));
      f.addEventListener('input', () => liveCheck(f, 'y', null));
      liveCheck(f, 'y', null); upd(false);
      f.addEventListener('submit', e => {
        e.preventDefault();
        busy($('#ySave', m), async () => {
          const year = toNum(yy.value), d = th.value;
          if (!(year >= 2000 && year <= 2100) || year % 1) throw err('السنة غير صحيحة');
          if (!d || +d.slice(0, 4) !== year) throw err(`تاريخ "يغطي حتى" لازم يكون داخل سنة ${year}`);
          const { o, bad } = readFields(f, 'y');
          if (bad.length) throw err('أكمل الحقول: ' + bad.join('، '));
          await ST.saveYearly(Object.assign({ year, through_date: d, note: $('#yNote', m).value.trim().slice(0, 500) || null }, o), y ? y.year : null);
          closeModal(); toast('تم حفظ إجمالي سنة ' + year); after();
        });
      });
    });
  }

  /* ---------------- المستخدمون ---------------- */
  VIEWS.users = async v => {
    const us = await ST.listUsers();
    v.innerHTML = `<div class="fbar"><h1 class="h1" style="flex:1">المستخدمون</h1><button class="btn pri" id="uAdd" type="button">+ إضافة مستخدم</button></div>
      <p class="hint">المدير يملك كل الصلاحيات. المستخدم العادي تحدد له وش يقدر يسوي بالضبط.</p>
      <div class="grid2">${us.map(u => `
        <div class="ucard ${u.active ? '' : 'off'}"><div class="uhead"><span class="av">${E((u.full_name || u.email).trim().charAt(0).toUpperCase())}</span>
          <div><b>${E(u.full_name || '—')}</b>${u.id === ME.id ? ' <span class="badge acc">أنت</span>' : ''}<small>${E(u.email)}</small></div>
          <span class="badge ${u.role === 'admin' ? 'acc' : ''}">${ROLE(u)}</span></div>
          <div class="perms">${!u.active ? '<span class="badge bad">موقوف</span>' : u.role === 'admin' ? '<span class="badge ok">كل الصلاحيات + إدارة المستخدمين</span>'
            : (Object.keys(PERM_L).filter(k => u['can_' + k]).map(k => `<span class="badge ok">${PERM_L[k]}</span>`).join('') || '<span class="badge">عرض فقط</span>')}</div>
          <div class="fbar"><button class="btn sm" data-ue="${E(u.id)}" type="button">✎ تعديل</button>${u.id !== ME.id ? `<button class="btn sm ghost" data-ud="${E(u.id)}" type="button">🗑 حذف</button>` : ''}</div>
        </div>`).join('')}</div>`;
    const re = () => VIEWS.users(v), by = {}; us.forEach(u => (by[u.id] = u));
    $('#uAdd', v).addEventListener('click', () => userForm(null, re));
    $$('[data-ue]', v).forEach(b => b.addEventListener('click', () => userForm(by[b.dataset.ue], re)));
    $$('[data-ud]', v).forEach(b => b.addEventListener('click', async () => {
      const u = by[b.dataset.ud];
      if (!(await confirmBox('حذف المستخدم', `سيتم حذف حساب ${u.full_name || u.email} نهائياً ولن يستطيع الدخول. قراءاته المسجلة تبقى. (بديل أخف: إيقاف الحساب من التعديل)`, 'حذف'))) return;
      try { await ST.deleteUser(u.id); toast('تم حذف المستخدم'); re(); } catch (e) { toast(e.message, 'bad'); }
    }));
  };
  function genPass() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%', r = new Uint32Array(12);
    crypto.getRandomValues(r); return [...r].map(x => a[x % a.length]).join('');
  }
  function userForm(u, after) {
    const isNew = !u; u = u || { role: 'user', can_insert: true, active: true };
    modal(`<h3>${isNew ? 'إضافة مستخدم' : 'تعديل ' + E(u.full_name || u.email)}</h3>
      <form class="form" id="fU" novalidate autocomplete="off">
        <label class="fld"><span>الاسم</span><input id="uName" maxlength="80" value="${E(u.full_name || '')}"></label>
        <label class="fld"><span>البريد الإلكتروني</span><input id="uEmail" type="email" dir="ltr" value="${E(u.email || '')}" ${isNew ? '' : 'disabled'}></label>
        ${ST.demo && !isNew ? '' : `<label class="fld"><span>كلمة المرور <small>${isNew ? '8 أحرف على الأقل' : 'اتركها فاضية إذا ما تبي تغيّرها'}</small></span>
          <span class="pw"><input id="uPass" type="text" dir="ltr" autocomplete="new-password"><button type="button" class="eye" id="uGen" title="توليد كلمة مرور قوية">🎲</button></span></label>`}
        <label class="fld"><span>نوع الحساب</span><select id="uRole"><option value="user">مستخدم (صلاحيات محددة)</option><option value="admin">مدير (كل الصلاحيات)</option></select></label>
        <div class="fld" id="uPerms"><span>الصلاحيات</span><div class="fgrid">
          ${Object.keys(PERM_L).map(k => `<label class="chk"><input type="checkbox" data-p="${k}" ${u['can_' + k] ? 'checked' : ''}> ${PERM_L[k]}</label>`).join('')}</div>
          <small class="hint">كل المستخدمين يقدرون يشوفون السجلات. الصلاحيات أعلاه للتعديل.</small></div>
        ${isNew ? '' : `<label class="chk"><input type="checkbox" id="uActive" ${u.active ? 'checked' : ''}> الحساب مفعّل (أزل العلامة لإيقافه مؤقتاً)</label>`}
        <p class="err" id="uErr"></p>
        <div class="mfoot"><button class="btn pri" type="submit" id="uSave">${isNew ? 'إنشاء الحساب' : 'حفظ'}</button><button class="btn ghost" type="button" data-close>إلغاء</button></div>
      </form>`, m => {
      const role = $('#uRole', m); role.value = u.role;
      const sync = () => { const ad = role.value === 'admin'; $$('[data-p]', m).forEach(c => { c.disabled = ad; if (ad) c.checked = true; }); };
      role.addEventListener('change', sync); sync();
      const g = $('#uGen', m); if (g) g.addEventListener('click', () => { $('#uPass', m).value = genPass(); });
      $('#fU', m).addEventListener('submit', e => {
        e.preventDefault();
        busy($('#uSave', m), async () => {
          const p = { full_name: $('#uName', m).value.trim(), role: role.value };
          $$('[data-p]', m).forEach(c => (p['can_' + c.dataset.p] = c.checked));
          const pw = $('#uPass', m) ? $('#uPass', m).value : '';
          if (isNew) {
            if (!p.full_name) throw err('اكتب الاسم');
            await ST.createUser(Object.assign(p, { email: $('#uEmail', m).value.trim(), password: pw }));
            closeModal(); toast('تم إنشاء الحساب. أرسل البريد وكلمة المرور للموظف بطريقة آمنة');
          } else {
            p.active = $('#uActive', m).checked; if (pw) p.password = pw;
            await ST.updateUser(u.id, p);
            closeModal(); toast('تم حفظ التعديل');
          }
          after();
        });
      });
    });
  }

  /* ---------------- سجل العمليات ---------------- */
  VIEWS.audit = async v => {
    const L = await ST.listAudit();
    const act = { INSERT: 'أضاف', UPDATE: 'عدّل', DELETE: 'حذف' };
    const what = a => a.table_name === 'daily_readings' ? `قراءة ${C.dateAr(a.row_key)}` : `إجمالي سنة ${a.row_key}`;
    const keys = F.map(f => [f.k, f.l]).concat([['through_date', 'يغطي حتى'], ['note', 'الملاحظة']]);
    const diff = a => {
      if (a.action === 'UPDATE') return keys.filter(([k]) => String(a.old_data[k] ?? '') !== String(a.new_data[k] ?? ''))
        .map(([k, l]) => `<span>${l}: <b>${E(typeof a.old_data[k] === 'number' ? C.fmtA(a.old_data[k]) : a.old_data[k] ?? '—')}</b> ← <b>${E(typeof a.new_data[k] === 'number' ? C.fmtA(a.new_data[k]) : a.new_data[k] ?? '—')}</b></span>`).join('') || '<span>بدون تغيير في الأرقام</span>';
      const d = a.new_data || a.old_data || {};
      return `<span>الإنتاج: <b>${C.fmtA(d.production)}</b> م³</span><span>الطاقة: <b>${C.fmtA(d.energy)}</b> kWh</span>`;
    };
    v.innerHTML = `<h1 class="h1">سجل العمليات</h1><p class="hint">آخر 300 عملية: من أضاف أو عدّل أو حذف، ومتى.</p>
      <div class="log">${L.length ? L.map(a => `<div class="li"><span class="dot ${E(a.action)}"></span><div>
        <b>${E(a.user_email || 'غير معروف')}</b> ${act[a.action] || E(a.action)} ${E(what(a))}
        <small>${E(new Date(a.at).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }))}</small>
        <div class="diff">${diff(a)}</div></div></div>`).join('') : '<p class="card empty">لا توجد عمليات بعد</p>'}</div>`;
  };

  /* =====================================================================
     الدخول والخروج
     ===================================================================== */
  function showLogin(msg) {
    ME = null; $('#app').hidden = true; $('#login').hidden = false; closeModal();
    $('#lErr').textContent = msg || '';
    if (ST.demo) {
      $('#demoBox').hidden = false; $('#realLogin').hidden = true;
      ST.demoUsers().then(us => {
        $('#demoUsers').innerHTML = us.map(u => `<button type="button" class="btn" data-du="${E(u.id)}">${E(u.full_name)} · ${ROLE(u)}</button>`).join('') +
          '<button type="button" class="btn ghost sm" id="demoReset">إعادة البيانات التجريبية من جديد</button>';
        $$('[data-du]').forEach(b => b.addEventListener('click', async () => { const p = await ST.demoLogin(b.dataset.du); if (p) startApp(p); }));
        $('#demoReset').addEventListener('click', async () => {
          if (await confirmBox('إعادة البيانات', 'سيتم مسح كل ما أدخلته في الوضع التجريبي.', 'إعادة')) { C.demo.reset(); C.demo.load(); showLogin(); toast('تمت إعادة البيانات'); }
        });
      });
    } else setTimeout(() => $('#lEmail').focus(), 50);
  }
  $('#lEye').addEventListener('click', () => { const i = $('#lPass'); i.type = i.type === 'password' ? 'text' : 'password'; });
  $('#loginForm').addEventListener('submit', e => {
    e.preventDefault(); if (ST.demo) return;
    const email = $('#lEmail').value, pass = $('#lPass').value;
    if (!email || !pass) { $('#lErr').textContent = 'اكتب البريد وكلمة المرور'; return; }
    $('#lErr').textContent = '';
    busy($('#lBtn'), async () => {
      try {
        const p = await ST.login(email, pass);
        if (!p) { await ST.logout(); throw err('لا يوجد ملف صلاحيات لهذا الحساب، راجع المدير'); }
        if (!p.active) { await ST.logout(); throw err('هذا الحساب موقوف، راجع المدير'); }
        $('#lPass').value = ''; startApp(p);
      } catch (x) { $('#lErr').textContent = x.message; }
    });
  });

  function startApp(p) {
    ME = p; $('#login').hidden = true; $('#app').hidden = false;
    $('#meName').textContent = p.full_name || p.email; $('#meRole').textContent = ROLE(p);
    $('#demoTag').hidden = !ST.demo;
    $('#tabs').innerHTML = TABS.filter(t => !t.p || can(t.p)).map(t =>
      `<a href="#${t.id}" data-id="${t.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[t.id]}</svg>${t.l}</a>`).join('');
    route(); idle();
  }
  async function logout(msg) { try { await ST.logout(); } catch (e) { /* */ } location.hash = ''; showLogin(msg); }
  $('#logout').addEventListener('click', () => logout());

  /* خروج تلقائي بعد عدم النشاط */
  let idleT = null;
  function idle() {
    clearTimeout(idleT);
    if (!ME || ST.demo) return;
    idleT = setTimeout(() => logout('تم تسجيل خروجك تلقائياً لعدم النشاط'), (cfg.IDLE_LOGOUT_MIN || 30) * 60000);
  }
  ['pointerdown', 'keydown', 'scroll'].forEach(ev => addEventListener(ev, () => { if (ME) idle(); }, { passive: true }));

  /* ---------------- تشغيل ---------------- */
  (async function boot() {
    if (!C.isDemo && !window.supabase) {
      document.body.insertAdjacentHTML('beforeend', '<div class="login"><div class="lcard"><h1>تعذّر التحميل</h1><p class="mut">تعذّر تحميل مكتبة الاتصال. تأكد من الإنترنت ثم حدّث الصفحة.</p></div></div>');
      return;
    }
    ST = C.isDemo ? DemoStore() : RemoteStore();
    ST.onSignedOut(() => { if (ME) showLogin('انتهت الجلسة، سجّل الدخول من جديد'); });
    let p = null; try { p = await ST.session(); } catch (e) { /* */ }
    if (p && p.active) startApp(p); else showLogin();
  })();
})();
