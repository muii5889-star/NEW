/* =====================================================================
   المكتبة المشتركة بين موقع الزوار ولوحة الإدخال:
   الحسابات (السنوي/الشهري/اليومي)، التواريخ، تنبيه الشاذ، والوضع التجريبي
   ===================================================================== */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const isDemo = !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  /* الحقول اليومية */
  const FIELDS = [
    { k: 'production',     l: 'الإنتاج',                    u: 'م³',  d: 2 },
    { k: 'export_khulais', l: 'التصدير إلى خليص',           u: 'م³',  d: 2 },
    { k: 'export_kamil',   l: 'التصدير إلى الكامل',         u: 'م³',  d: 2 },
    { k: 'energy',         l: 'استهلاك الطاقة',             u: 'kWh', d: 2 },
    { k: 'chemicals',      l: 'استهلاك المواد الكيميائية',  u: 'kg',  d: 3 }
  ];

  /* ---------- أرقام ونصوص ---------- */
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const round = (v, d = 0) => { const p = 10 ** d; return Math.round(num(v) * p) / p; };
  const fmt = (v, d = 0) => num(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtA = v => { v = num(v); const d = v !== 0 && Math.abs(v) < 10 ? 3 : v % 1 ? 2 : 0; return num(v).toLocaleString('en-US', { maximumFractionDigits: d }); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- تواريخ (بصيغة YYYY-MM-DD) ---------- */
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const toD = s => new Date(s + 'T00:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((toD(b) - toD(a)) / 864e5);
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInYear = y => (isLeap(y) ? 366 : 365);
  const dayOfYear = s => diffDays(`${s.slice(0, 4)}-01-01`, s) + 1;
  const dateAr = (s, o) => s ? toD(s).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn',
    Object.assign({ day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }, o)) : '—';
  const weekday = s => toD(s).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', timeZone: 'UTC' });

  /* ---------- الصلاحيات ---------- */
  const can = (p, perm) => !!p && p.active !== false && (p.role === 'admin' || perm === 'read' || p['can_' + perm] === true);

  /* ---------- حسابات السنة ----------
     السنوي = المجموع منذ 1 يناير
     المتوسط اليومي = المجموع ÷ عدد الأيام المسجلة
     المتوسط الشهري = المتوسط اليومي × (أيام السنة ÷ 12) */
  function stats(r) {
    const y = +r.yr, diy = daysInYear(y), days = num(r.days);
    const o = { yr: y, days, diy, last_date: r.last_date || null, daily: {}, monthly: {} };
    FIELDS.forEach(f => (o[f.k] = num(r[f.k])));
    o.export_total = o.export_khulais + o.export_kamil;
    FIELDS.map(f => f.k).concat('export_total').forEach(k => {
      o.daily[k] = days ? o[k] / days : 0;
      o.monthly[k] = days ? (o[k] / days) * diy / 12 : 0;
    });
    o.energy_per_m3 = o.production ? o.energy / o.production : 0;
    o.chem_per_m3 = o.production ? o.chemicals / o.production : 0;
    o.complete = days >= diy;
    return o;
  }

  function summarize(rows) {
    const years = (rows || []).map(stats).sort((a, b) => a.yr - b.yr);
    const cy = new Date().getFullYear();
    let current = years.find(y => y.yr === cy) || null;
    if (!current && years.length) current = years[years.length - 1];
    const history = years.filter(y => y.yr < cy);
    const lastDate = years.reduce((m, y) => (y.last_date && y.last_date > m ? y.last_date : m), '');
    return { years, current, history, lastDate, isDemo };
  }

  /* ---------- تنبيه الأرقام الشاذة (تكيفي) ----------
     يأخذ آخر N قراءة، يحسب الوسيط (المعتاد) ومدى التذبذب الطبيعي.
     لو تغيّر مستوى المحطة فعلاً (مثلاً من 1000 إلى 5000) وتكرر عدة أيام،
     يصير الوسيط الجديد هو المعتاد ويختفي التنبيه تلقائياً. */
  const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  function baseline(hist) {
    const n = cfg.ANOMALY_WINDOW || 10, minPct = cfg.ANOMALY_MIN_PCT || 0.25;
    const h = hist.map(num).filter(v => v > 0).slice(0, n);
    if (h.length < 5) return null;
    const m = median(h), mad = median(h.map(v => Math.abs(v - m)));
    const spread = Math.max(mad * 1.4826 * 3.5, m * minPct);
    return { m, lo: Math.max(0, m - spread), hi: m + spread, n: h.length };
  }
  function check(v, b) {
    if (!b || v === '' || v == null) return null;
    v = num(v);
    if (v > b.hi) return { t: 'high', pct: b.m ? v / b.m - 1 : 0 };
    if (v < b.lo) return { t: 'low', pct: b.m ? 1 - v / b.m : 1 };
    return null;
  }

  /* ---------- الوضع التجريبي (بدون سيرفر: يحفظ في المتصفح) ---------- */
  const DK = 'khulais-demo-v1';
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function mix(p, j = () => 0.5) {
    return {
      production: round(p, 2),
      export_khulais: round(p * (0.61 + (j() - 0.5) * 0.02), 2),
      export_kamil: round(p * (0.355 + (j() - 0.5) * 0.02), 2),
      energy: round(p * (0.62 + (j() - 0.5) * 0.04), 2),
      chemicals: round(p * (0.0447 + (j() - 0.5) * 0.004), 3)
    };
  }
  function seed() {
    const t = today(), cy = +t.slice(0, 4), j = rng(cy * 7 + 3), now = new Date().toISOString();
    const yearly = {}, readings = {};
    const base = (y, perDay, through) => (yearly[y] = Object.assign({ year: y, through_date: through, note: '', created_at: now }, mix(perDay * dayOfYear(through))));
    base(cy - 2, 7050, `${cy - 2}-12-31`);
    base(cy - 1, 7180, `${cy - 1}-12-31`);
    let start = addDays(t, -14);
    if (start.slice(0, 4) < String(cy)) start = `${cy}-01-01`;
    if (start > `${cy}-01-01`) base(cy, 7250, addDays(start, -1));
    for (let d = start; d < t; d = addDays(d, 1)) readings[d] = Object.assign({ day: d, note: '', created_at: now }, mix(7250 * (1 + (j() - 0.5) * 0.08), j));
    const P = (id, email, full_name, role, ins, ed, del, yr) => ({ id, email, full_name, role, can_insert: ins, can_edit: ed, can_delete: del, can_yearly: yr, active: true, created_at: now });
    const users = [
      P('demo-admin', 'admin@demo.local', 'مدير النظام', 'admin', true, true, true, true),
      P('demo-op', 'operator@demo.local', 'مشغّل الوردية', 'user', true, false, false, false)
    ];
    return { v: 1, readings, yearly, users, audit: [] };
  }
  const demo = {
    load() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(DK)); } catch (e) { /* ignore */ }
      if (!d || d.v !== 1) { d = seed(); demo.save(d); }
      return d;
    },
    save(d) { try { localStorage.setItem(DK, JSON.stringify(d)); } catch (e) { /* ignore */ } },
    reset() { try { localStorage.removeItem(DK); } catch (e) { /* ignore */ } },
    summaryRows(d) {
      const m = {};
      const add = (y, r, n, ld) => {
        const o = m[y] || (m[y] = { yr: y, days: 0, last_date: null });
        FIELDS.forEach(f => (o[f.k] = (o[f.k] || 0) + num(r[f.k])));
        o.days += n; if (!o.last_date || ld > o.last_date) o.last_date = ld;
      };
      Object.values(d.readings).forEach(r => add(+r.day.slice(0, 4), r, 1, r.day));
      Object.values(d.yearly).forEach(r => add(+r.year, r, dayOfYear(r.through_date), r.through_date));
      return Object.values(m);
    }
  };

  /* ---------- تحميل الملخص لموقع الزوار ---------- */
  const CK = 'khulais-public-cache';
  async function loadPublic() {
    try {
      let rows;
      if (isDemo) rows = demo.summaryRows(demo.load());
      else {
        const key = cfg.SUPABASE_ANON_KEY, h = { apikey: key, 'Content-Type': 'application/json' };
        if (!/^sb_/.test(key)) h.Authorization = 'Bearer ' + key;
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(cfg.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/public_summary', { method: 'POST', headers: h, body: '{}', signal: ctl.signal });
        clearTimeout(to);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        rows = await res.json();
        try { localStorage.setItem(CK, JSON.stringify(rows)); } catch (e) { /* ignore */ }
      }
      return summarize(rows);
    } catch (e) {
      console.warn('تعذّر تحميل البيانات:', e);
      try { const c = JSON.parse(localStorage.getItem(CK)); if (c) return Object.assign(summarize(c), { stale: true }); } catch (x) { /* ignore */ }
      return null;
    }
  }

  window.Core = {
    cfg, isDemo, FIELDS, num, round, fmt, fmtA, esc, pad, today, toD, iso, addDays, diffDays,
    isLeap, daysInYear, dayOfYear, dateAr, weekday, can, stats, summarize, median, baseline, check,
    demo, loadPublic
  };
})();
