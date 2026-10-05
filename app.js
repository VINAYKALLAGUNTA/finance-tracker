/* Daily Finance Tracker — UI. Depends on logic.js, parsers.js, xlsx.js, i18n.js (all attach to window.FT). */
(function () {
  'use strict';
  const F = window.FT;
  const t = (k, v) => F.t(k, v);
  const tc = (c) => F.tc(c);
  const KEY = 'finance-tracker-v1';

  /* ---------------- state + storage ---------------- */
  let storageWarned = false;
  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const s = F.migrate(parsed);
        if (s) {
          if (parsed && parsed.v === 1) { try { localStorage.setItem('finance-tracker-backup-before-v2', raw); } catch (e) { /* ignore */ } }
          return s;
        }
      }
    } catch (e) { /* fall through */ }
    if (raw) { try { localStorage.setItem('finance-tracker-corrupt-copy', raw); } catch (e) { /* ignore */ } }
    return F.defaultState();
  }
  let state = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { if (!storageWarned) { storageWarned = true; toast(t('storage_fail'), 'bad'); } }
  }
  F.setLang(state.settings.lang);

  const ui = {
    tab: 'home', page: 'menu', month: F.monthOf(F.todayStr()), personId: null,
    addType: 'expense', pKind: 'given', editId: null, photo: null, photoState: 'none',
    scope: 'month', fOpen: false, f: { q: '', type: 'all', acc: 'all', cat: 'all', by: 'all', from: '', to: '', min: '', max: '', receipt: false },
    counts: {}, closeDate: F.todayStr(), closeAcc: '', closeNote: '', noteEdit: null, billEdit: null, payAcc: '',
    smsText: '', smsFound: null, catKind: 'expense'
  };

  /* ---------------- small helpers ---------------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
  const money = (n) => inrFmt.format(n);
  const loc = () => (state.settings.lang === 'te' ? 'te-IN' : 'en-IN');
  const acct = (id) => state.accounts.find((a) => a.id === id);
  const accName = (id) => (acct(id) ? acct(id).name : '?');
  const person = (id) => state.people.find((p) => p.id === id);
  const personName = (id) => (person(id) ? person(id).name : '?');
  const memberName = (id) => { const m = state.members.find((x) => x.id === id); return m ? m.name : ''; };
  const today = () => F.todayStr();
  const multiMember = () => state.members.length > 1;
  const flow = (type) => (type === 'income' || type === 'received' || type === 'taken' ? 1 : type === 'expense' || type === 'given' || type === 'paidback' ? -1 : 0);

  function prettyDate(d) {
    const td = today();
    if (d === td) return t('today');
    if (d === F.addDays(td, -1)) return t('yesterday');
    return F.parseDate(d).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function monthLabel(ym) {
    const p = ym.split('-');
    return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(loc(), { month: 'long', year: 'numeric' });
  }
  function monthShortYear(ym) {
    const p = ym.split('-');
    return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(loc(), { month: 'short', year: '2-digit' });
  }
  function monthShort(ym) {
    const p = ym.split('-');
    return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(loc(), { month: 'short' });
  }
  function toast(msg, kind) {
    const el = $('toast');
    el.textContent = msg; el.className = 'show ' + (kind || '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.className = ''; }, 3500);
  }
  function commit(msg, kind) { save(); render(); if (msg) toast(msg, kind); }
  function err(r) { toast(t(r.error || 'err_type'), 'bad'); }
  function opts(items, sel) { return items.map((i) => `<option value="${esc(i.v)}"${i.v === sel ? ' selected' : ''}>${esc(i.l)}</option>`).join(''); }
  const accOpts = (sel, only) => opts(state.accounts.filter((a) => !only || a.type === only).map((a) => ({ v: a.id, l: a.name })), sel);
  const catList = (kind) => state.cats[kind === 'income' ? 'income' : 'expense'];
  const catOpts = (kind, sel) => opts(catList(kind).map((c) => ({ v: c, l: tc(c) })), sel);

  function download(name, data, type) {
    const blob = new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }

  /* ---------------- receipts (IndexedDB) ---------------- */
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('no idb')); return; }
      const r = indexedDB.open('ft-receipts', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('r');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function idbOp(mode, fn) {
    return idb().then((db) => new Promise((res, rej) => {
      const tx = db.transaction('r', mode), store = tx.objectStore('r');
      const req = fn(store);
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    }));
  }
  const rGet = (id) => idbOp('readonly', (s) => s.get(id)).catch(() => null);
  const rPut = (id, d) => idbOp('readwrite', (s) => s.put(d, id)).catch(() => toast(t('photo_fail'), 'bad'));
  const rDel = (id) => idbOp('readwrite', (s) => s.delete(id)).catch(() => null);
  const rClear = () => idbOp('readwrite', (s) => s.clear()).catch(() => null);
  function rAll() {
    return idb().then((db) => new Promise((res) => {
      const out = {}, tx = db.transaction('r', 'readonly'), cur = tx.objectStore('r').openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { out[c.key] = c.value; c.continue(); } };
      tx.oncomplete = () => res(out);
      tx.onerror = () => res(out);
    })).catch(() => ({}));
  }
  function compress(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
      img.src = url;
    });
  }

  /* ---------------- svg chart helpers ---------------- */
  function barPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function monthsChart(months) {
    const W = 320, H = 140, base = H - 18, top = 8, n = months.length;
    const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));
    const slot = W / n, bw = Math.min(22, (slot - 10) / 2);
    let bars = '', labels = '';
    months.forEach((m, i) => {
      const cx = slot * i + slot / 2;
      const hi = m.income ? Math.max(3, (m.income / max) * (base - top)) : 0;
      const he = m.expense ? Math.max(3, (m.expense / max) * (base - top)) : 0;
      if (hi) bars += `<path class="s1" d="${barPath(cx - bw - 1, base - hi, bw, hi, 4)}"><title>${esc(monthLabel(m.ym))} ${esc(t('income'))}: ${esc(money(m.income))}</title></path>`;
      if (he) bars += `<path class="s2" d="${barPath(cx + 1, base - he, bw, he, 4)}"><title>${esc(monthLabel(m.ym))} ${esc(t('expense'))}: ${esc(money(m.expense))}</title></path>`;
      labels += `<text x="${cx}" y="${H - 4}" text-anchor="middle">${esc(monthShort(m.ym))}</text>`;
    });
    return `<div class="legend"><span><i style="background:var(--series-1)"></i>${esc(t('income'))}</span><span><i style="background:var(--series-2)"></i>${esc(t('expense'))}</span></div>` +
      `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(t('rep_months'))}"><line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--line)"/>${bars}${labels}</svg>`;
  }
  function weekdayChart(vals) {
    const W = 320, H = 110, base = H - 18, top = 6, n = 7, slot = W / n, bw = 26;
    const max = Math.max(1, ...vals);
    const names = t('weekdays').split(',');
    let out = '';
    vals.forEach((v, i) => {
      const cx = slot * i + slot / 2, h = v ? Math.max(3, (v / max) * (base - top)) : 0;
      if (h) out += `<path class="s1" d="${barPath(cx - bw / 2, base - h, bw, h, 4)}"><title>${esc(names[i])}: ${esc(money(v))}</title></path>`;
      out += `<text x="${cx}" y="${H - 4}" text-anchor="middle">${esc(names[i])}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(t('rep_weekday'))}"><line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--line)"/>${out}</svg>`;
  }

  /* ---------------- shared render pieces ---------------- */
  function txTitle(x) {
    if (x.type === 'transfer') return t('type_transfer');
    if (F.PEOPLE_TYPES.indexOf(x.type) >= 0) return t('k_' + x.type) + ' · ' + esc(personName(x.p));
    return esc(tc(x.cat));
  }
  function txSub(x) {
    let s = x.type === 'transfer' ? esc(accName(x.acc)) + ' → ' + esc(accName(x.to)) : esc(accName(x.acc));
    if (x.note) s += ' · ' + esc(x.note);
    if (multiMember()) s += ' · ' + esc(memberName(x.by));
    if (x.r) s += ' · 📎';
    return s;
  }
  function txRow(x) {
    const f = flow(x.type), sign = f > 0 ? '+' : f < 0 ? '−' : '⇄', cls = f > 0 ? 'pos' : f < 0 ? 'neg' : 'mut';
    return `<div class="row" data-act="tx" data-id="${esc(x.id)}"><div class="grow"><div class="t">${txTitle(x)}</div><div class="s">${txSub(x)}</div></div><div class="amt ${cls}">${sign} ${money(x.amount)}</div></div>`;
  }
  function groupedList(list) {
    if (!list.length) return `<p class="empty">${esc(t('no_tx'))}</p>`;
    const sorted = list.slice().sort(F.byDateDesc);
    let html = '', last = '';
    sorted.forEach((x) => {
      if (x.date !== last) { html += `<h4 class="day">${esc(prettyDate(x.date))}</h4>`; last = x.date; }
      html += txRow(x);
    });
    return html;
  }
  function monthNav() {
    return `<div class="mnav"><button class="icon" data-act="month" data-d="-1" aria-label="${esc(t('prev'))}">‹</button><b>${esc(monthLabel(ui.month))}</b><button class="icon" data-act="month" data-d="1" aria-label="${esc(t('next'))}">›</button></div>`;
  }
  function pageHead(title, back) {
    return `<button class="back" data-act="${back || 'more-back'}">‹ ${esc(t(back ? 'people' : 'more'))}</button><div class="pages-title">${esc(title)}</div>`;
  }
  function exportButtons(listKey) {
    return `<div class="btns"><button class="secondary small" data-act="exp-xlsx" data-src="${listKey}">⬇ Excel</button><button class="secondary small" data-act="exp-csv" data-src="${listKey}">⬇ CSV</button><button class="secondary small" data-act="exp-pdf" data-src="${listKey}">⬇ PDF</button></div>`;
  }
  function dueText(x) {
    return x.daysLeft < 0 ? t('overdue_days', { n: -x.daysLeft }) : x.daysLeft === 0 ? t('due_today') : t('due_in', { n: x.daysLeft });
  }

  /* ---------------- pages ---------------- */
  function renderHome() {
    const ym = F.monthOf(today());
    const mt = F.totals(F.txInMonth(state, ym));
    const td = F.totals(state.tx.filter((x) => x.date === today()));
    const b = F.balances(state);
    const cashTotal = F.sumByType(state, 'cash'), bankTotal = F.sumByType(state, 'bank');
    const accs = state.accounts.map((a) => `<div class="acc"><div class="s">${a.type === 'cash' ? '💵 ' : '🏦 '}${esc(a.name)}</div><div class="v ${b[a.id] < 0 ? 'neg' : ''}">${money(b[a.id])}</div></div>`).join('');
    const recent = state.tx.slice().sort(F.byDateDesc).slice(0, 8);
    const alerts = F.budgetStatus(state, ym).filter((r) => r.pct >= 80).map((r) =>
      `<div class="alert ${r.pct >= 100 ? 'over' : 'warn'}" data-act="goto" data-tab="more" data-page="budgets">🎯 ${esc(tc(r.cat))}: ${esc(t('budget_used', { pct: r.pct, spent: money(r.spent), limit: money(r.limit) }))}</div>`).join('');
    const bills = F.dueBills(state, today()).map((x) =>
      `<div class="alert ${x.status === 'overdue' ? 'over' : 'warn'}" data-act="goto" data-tab="more" data-page="bills">🔔 ${esc(x.bill.name)} · ${money(x.bill.amount)} · ${esc(dueText(x))}</div>`).join('');
    const ps = F.peopleSummary(state);
    const people = state.people.length ? `<div class="grid2" style="margin-top:10px"><div class="card sm" data-act="goto" data-tab="people"><div class="s">${esc(t('to_receive'))}</div><div class="v pos">${money(ps.toReceive)}</div></div><div class="card sm" data-act="goto" data-tab="people"><div class="s">${esc(t('to_pay'))}</div><div class="v neg">${money(ps.toPay)}</div></div></div>` : '';
    return `<section class="hero"><div class="s">${esc(t('total_balance'))}</div><div class="big">${money(F.totalBalance(state))}</div>
      <div class="chips"><span>💵 ${esc(t('cash'))} <b>${money(cashTotal)}</b></span><span>🏦 ${esc(t('banks'))} <b>${money(bankTotal)}</b></span></div>
      <div class="chips" style="margin-top:6px"><span>${esc(t('spent_today'))} <b>${money(td.expense)}</b></span><span>${esc(t('this_month'))}: +${money(mt.income)} / −${money(mt.expense)}</span></div></section>
      ${bills}${alerts}${people}
      <h3>${esc(t('accounts'))}</h3><div class="accs">${accs}</div>
      <h3>${esc(t('recent'))}</h3><div class="card">${groupedList(recent)}</div>`;
  }

  function historyFilters() {
    const f = ui.f;
    const types = ['all', 'expense', 'income', 'transfer', 'people'].map((x) => ({ v: x, l: x === 'all' ? t('all') : t('type_' + x) }));
    const accs = [{ v: 'all', l: t('all') }].concat(state.accounts.map((a) => ({ v: a.id, l: a.name })));
    const cats = [{ v: 'all', l: t('all') }].concat(Array.from(new Set(catList('expense').concat(catList('income')))).map((c) => ({ v: c, l: tc(c) })));
    const mems = [{ v: 'all', l: t('all') }].concat(state.members.map((m) => ({ v: m.id, l: m.name })));
    return `<div class="card form" style="margin-bottom:10px">
      <div class="grid2"><label>${esc(t('type'))}<select data-in="f" data-k="type">${opts(types, f.type)}</select></label>
      <label>${esc(t('account'))}<select data-in="f" data-k="acc">${opts(accs, f.acc)}</select></label></div>
      <div class="grid2"><label>${esc(t('category'))}<select data-in="f" data-k="cat">${opts(cats, f.cat)}</select></label>
      ${multiMember() ? `<label>${esc(t('member'))}<select data-in="f" data-k="by">${opts(mems, f.by)}</select></label>` : '<span></span>'}</div>
      <div class="grid2"><label>${esc(t('from'))}<input type="date" data-in="f" data-k="from" value="${esc(f.from)}"></label><label>${esc(t('to'))}<input type="date" data-in="f" data-k="to" value="${esc(f.to)}"></label></div>
      <div class="grid2"><label>${esc(t('min_amt'))}<input inputmode="decimal" data-in="f" data-k="min" value="${esc(f.min)}"></label><label>${esc(t('max_amt'))}<input inputmode="decimal" data-in="f" data-k="max" value="${esc(f.max)}"></label></div>
      <label class="inline"><input type="checkbox" data-in="f" data-k="receipt"${f.receipt ? ' checked' : ''}> ${esc(t('only_receipts'))}</label>
      <button class="secondary small" data-act="f-reset">${esc(t('reset_filters'))}</button></div>`;
  }
  function filteredList() {
    const f = Object.assign({}, ui.f);
    if (ui.scope === 'month' && !f.from && !f.to) f.ym = ui.month;
    return F.filterTx(state, f);
  }
  function historyListHtml() {
    const list = filteredList(), tt = F.totals(list);
    return `<div class="s" style="margin:0 4px 6px">${esc(t('n_results', { n: list.length }))} · <span class="pos">+${money(tt.income)}</span> · <span class="neg">−${money(tt.expense)}</span></div><div class="card">${groupedList(list)}</div>`;
  }
  function renderHistory() {
    return `<div style="margin-top:10px" class="form"><div style="display:flex;gap:8px"><input id="q" type="search" placeholder="${esc(t('search_ph'))}" value="${esc(ui.f.q)}" data-in="f" data-k="q" aria-label="${esc(t('search_ph'))}"><button class="secondary" data-act="f-toggle" style="flex:none">⚙︎ ${esc(t('filters'))}</button></div></div>
      <div class="pills"><button class="${ui.scope === 'month' ? 'on' : ''}" data-act="scope" data-v="month">${esc(t('by_month'))}</button><button class="${ui.scope === 'all' ? 'on' : ''}" data-act="scope" data-v="all">${esc(t('all_time'))}</button></div>
      ${ui.scope === 'month' ? monthNav() : ''}
      ${ui.fOpen ? historyFilters() : ''}
      <div id="hlist">${historyListHtml()}</div>
      <h3>${esc(t('export'))}</h3>${exportButtons('hist')}`;
  }

  function renderSummary() {
    const list = F.txInMonth(state, ui.month), tt = F.totals(list), cats = F.byCategory(list);
    const maxC = cats.length ? cats[0].amount : 1;
    const catHtml = cats.length ? cats.map((c) => {
      const pct = tt.expense ? Math.round((c.amount / tt.expense) * 100) : 0;
      return `<div class="bar"><div class="bl"><span>${esc(tc(c.cat))}</span><span>${money(c.amount)} · ${pct}%</span></div><div class="track"><div class="fill" style="width:${Math.max(2, (c.amount / maxC) * 100)}%"></div></div></div>`;
    }).join('') : `<p class="empty">${esc(t('no_expenses'))}</p>`;
    const daily = F.dailyExpense(list, ui.month), maxD = Math.max(1, ...daily);
    const W = 320, H = 90, bw = W / daily.length;
    const bars = daily.map((v, i) => {
      const h = v ? Math.max(3, (v / maxD) * (H - 6)) : 0;
      return h ? `<path class="bar-fill" d="${barPath(i * bw + 1, H - h, Math.max(2, bw - 2), h, 3)}"><title>${i + 1}: ${esc(money(v))}</title></path>` : '';
    }).join('');
    return `${monthNav()}<div class="grid3"><div class="card sm"><div class="s">${esc(t('income'))}</div><div class="v pos">${money(tt.income)}</div></div>
      <div class="card sm"><div class="s">${esc(t('expense'))}</div><div class="v neg">${money(tt.expense)}</div></div>
      <div class="card sm"><div class="s">${esc(t('saved'))}</div><div class="v ${tt.net < 0 ? 'neg' : 'pos'}">${money(tt.net)}</div></div></div>
      <h3>${esc(t('daily_spending'))}</h3><div class="card"><svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(t('daily_spending'))}"><line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/>${bars}</svg><div class="axis"><span>1</span><span>${daily.length}</span></div></div>
      <h3>${esc(t('by_category'))}</h3><div class="card">${catHtml}</div>
      <div class="btns" style="margin-top:12px"><button class="secondary" data-act="goto" data-tab="more" data-page="reports">📈 ${esc(t('adv_reports'))}</button></div>
      <h3>${esc(t('export'))}</h3>${exportButtons('month')}`;
  }

  function personRowBalance(b) {
    if (b > 0) return `<div class="amt pos">${money(b)}<div class="s">${esc(t('they_owe'))}</div></div>`;
    if (b < 0) return `<div class="amt neg">${money(-b)}<div class="s">${esc(t('you_owe'))}</div></div>`;
    return `<div class="amt mut">${esc(t('settled'))}</div>`;
  }
  function renderPeople() {
    if (ui.personId && person(ui.personId)) return renderPerson(person(ui.personId));
    ui.personId = null;
    const ps = F.peopleSummary(state);
    const rows = ps.rows.length ? ps.rows.map((r) => `<div class="row" data-act="person" data-id="${esc(r.person.id)}"><div class="grow"><div class="t">${esc(r.person.name)}</div><div class="s">${esc(r.person.phone || '')}</div></div>${personRowBalance(r.balance)}</div>`).join('') : `<p class="empty">${esc(t('no_people'))}</p>`;
    return `<div class="grid2" style="margin-top:10px"><div class="card sm"><div class="s">${esc(t('to_receive'))}</div><div class="v pos">${money(ps.toReceive)}</div></div><div class="card sm"><div class="s">${esc(t('to_pay'))}</div><div class="v neg">${money(ps.toPay)}</div></div></div>
      <h3>${esc(t('person_ledger'))}</h3><div class="card">${rows}</div>
      <h3>${esc(t('add_person'))}</h3><form class="card form" data-form="person"><label>${esc(t('name'))}<input name="name" maxlength="40" required></label><label>${esc(t('phone_opt'))}<input name="phone" inputmode="tel" maxlength="20"></label><button class="primary">${esc(t('add'))}</button></form>`;
  }
  function renderPerson(p) {
    const bal = F.personBalance(state, p.id), led = F.personLedger(state, p.id);
    const rows = led.length ? led.slice().reverse().map((x) => {
      const f = flow(x.tx.type);
      return `<div class="row" data-act="tx" data-id="${esc(x.tx.id)}"><div class="grow"><div class="t">${esc(t('k_' + x.tx.type))}</div><div class="s">${esc(prettyDate(x.tx.date))}${x.tx.note ? ' · ' + esc(x.tx.note) : ''}</div></div><div style="text-align:right"><div class="amt ${f > 0 ? 'pos' : 'neg'}">${f > 0 ? '+' : '−'} ${money(x.tx.amount)}</div><div class="ledger-run">${esc(t('balance'))}: ${money(x.running)}</div></div></div>`;
    }).join('') : `<p class="empty">${esc(t('no_tx'))}</p>`;
    const wa = bal > 0 ? `<a class="wa" style="text-decoration:none;text-align:center;display:flex;align-items:center;justify-content:center;border-radius:12px;font-weight:600;color:#fff;background:#1f9d55;min-height:46px;padding:11px 14px" href="${esc(F.whatsappLink(p, bal, state.settings.lang, memberName(state.settings.activeMember)))}" target="_blank" rel="noopener">💬 ${esc(t('wa_remind'))}</a>` : '';
    return `${pageHead(p.name, 'people-back')}
      <div class="card"><div class="s">${esc(bal > 0 ? t('they_owe') : bal < 0 ? t('you_owe') : t('settled'))}</div><div class="big" style="font-size:28px;margin:0;color:${bal > 0 ? 'var(--pos)' : bal < 0 ? 'var(--neg)' : 'inherit'}">${money(Math.abs(bal))}</div></div>
      <div class="btns" style="margin-top:10px"><button class="secondary" data-act="add-person-tx" data-kind="given">${esc(t('k_given'))}</button><button class="secondary" data-act="add-person-tx" data-kind="taken">${esc(t('k_taken'))}</button>
      <button class="secondary" data-act="add-person-tx" data-kind="received">${esc(t('k_received'))}</button><button class="secondary" data-act="add-person-tx" data-kind="paidback">${esc(t('k_paidback'))}</button></div>
      ${wa ? `<div class="btns" style="margin-top:10px">${wa}</div>` : ''}
      <h3>${esc(t('ledger'))}</h3><div class="card">${rows}</div>
      <h3>${esc(t('contact'))}</h3><div class="card form"><label>${esc(t('name'))}<input data-ch="pname" value="${esc(p.name)}" maxlength="40"></label><label>${esc(t('phone_opt'))}<input data-ch="pphone" inputmode="tel" value="${esc(p.phone)}" maxlength="20"></label>
      <p class="hint">${esc(t('wa_hint'))}</p>${led.length ? '' : `<button class="danger" data-act="person-del">${esc(t('delete'))}</button>`}</div>`;
  }

  /* more menu + sub pages */
  function renderMore() {
    const subs = { bills: renderBills, cash: renderCash, notes: renderNotes, budgets: renderBudgets, reports: renderReports, accounts: renderAccounts, sms: renderSms, family: renderFamily, settings: renderSettings };
    if (subs[ui.page]) return subs[ui.page]();
    const items = [['bills', '🔔'], ['cash', '💵'], ['notes', '📝'], ['budgets', '🎯'], ['reports', '📈'], ['accounts', '🏦'], ['sms', '💬'], ['family', '👨‍👩‍👧'], ['settings', '⚙️']];
    return `<div class="menu" style="margin-top:12px">${items.map((i) => `<button data-act="open-page" data-page="${i[0]}"><span>${i[1]}</span>${esc(t('pg_' + i[0]))}</button>`).join('')}</div>`;
  }

  function renderBills() {
    const list = F.billsStatus(state, today());
    if (!ui.payAcc || !acct(ui.payAcc)) ui.payAcc = (state.accounts.find((a) => a.type === 'bank') || state.accounts[0]).id;
    const b = ui.billEdit ? state.bills.find((x) => x.id === ui.billEdit) : null;
    const rows = list.length ? list.map((x) => `<div class="accedit"><div style="display:flex;gap:8px;align-items:center"><div class="grow"><div class="t">${esc(x.bill.name)}<span class="badge ${x.status === 'overdue' ? 'over' : x.status === 'soon' ? 'soon' : ''}">${esc(dueText(x))}</span></div>
      <div class="s">${money(x.bill.amount)} · ${esc(prettyDate(x.bill.due))} · ${esc(t('rep_' + x.bill.repeat))} · ${esc(tc(x.bill.cat))}</div></div></div>
      <div class="btns"><button class="primary small" data-act="bill-pay" data-id="${esc(x.bill.id)}">✓ ${esc(t('mark_paid'))}</button><button class="secondary small" data-act="bill-edit" data-id="${esc(x.bill.id)}">${esc(t('edit'))}</button><button class="danger small" data-act="bill-del" data-id="${esc(x.bill.id)}">${esc(t('delete'))}</button></div></div>`).join('') : `<p class="empty">${esc(t('no_bills'))}</p>`;
    const reps = F.REPEATS.map((r) => ({ v: r, l: t('rep_' + r) }));
    return `${pageHead(t('pg_bills'))}
      <label class="card" style="margin-bottom:10px">${esc(t('pay_from'))}<select data-ch="payacc">${accOpts(ui.payAcc)}</select></label>
      <div class="card">${rows}</div>
      <h3>${esc(b ? t('edit') : t('add_bill'))}</h3>
      <form class="card form" data-form="bill"><label>${esc(t('name'))}<input name="name" maxlength="40" required value="${esc(b ? b.name : '')}"></label>
      <div class="grid2"><label>${esc(t('amount'))}<input name="amount" inputmode="decimal" required value="${b ? b.amount : ''}"></label><label>${esc(t('due_date'))}<input name="due" type="date" required value="${esc(b ? b.due : today())}"></label></div>
      <div class="grid2"><label>${esc(t('repeat'))}<select name="repeat">${opts(reps, b ? b.repeat : 'monthly')}</select></label><label>${esc(t('category'))}<select name="cat">${catOpts('expense', b ? b.cat : 'Bills')}</select></label></div>
      <label>${esc(t('remind_before'))}<input name="remind" inputmode="numeric" value="${b ? b.remind : state.settings.remindDays}"></label>
      <div class="btns"><button class="primary">${esc(t('save'))}</button>${b ? `<button type="button" class="secondary" data-act="bill-cancel">${esc(t('cancel'))}</button>` : ''}</div></form>`;
  }

  function cashTotals() {
    const total = F.countTotal(ui.counts);
    const acc = ui.closeAcc && acct(ui.closeAcc) ? ui.closeAcc : (state.accounts.find((a) => a.type === 'cash') || state.accounts[0]).id;
    ui.closeAcc = acc;
    const expected = F.balances(state, ui.closeDate)[acc] || 0;
    return { total, expected, diff: F.round2(total - expected), acc };
  }
  function cashSummaryHtml() {
    const c = cashTotals();
    return `<div class="total"><span>${esc(t('counted'))}</span><span id="cTotal">${money(c.total)}</span></div>
      <div class="kv"><span>${esc(t('expected'))}</span><span id="cExp">${money(c.expected)}</span></div>
      <div class="kv"><span>${esc(t('difference'))}</span><span class="diff ${c.diff === 0 ? '' : c.diff > 0 ? 'pos' : 'neg'}" id="cDiff">${c.diff > 0 ? '+' : ''}${money(c.diff)}</span></div>`;
  }
  function renderCash() {
    const dens = F.DENOMS.map((d) => `<div class="denom"><span class="d">₹${d}</span><span>×</span><input inputmode="numeric" data-in="count" data-d="${d}" value="${esc(ui.counts[d] || '')}" placeholder="0" aria-label="₹${d}"><span class="sub" id="sub${d}">${money((parseInt(ui.counts[d], 10) || 0) * d)}</span></div>`).join('');
    const cashAccs = state.accounts.filter((a) => a.type === 'cash');
    const cl = state.closings.slice(0, 15).map((c) => `<div class="row plain"><div class="grow"><div class="t">${esc(prettyDate(c.date))} · ${esc(accName(c.acc))}</div><div class="s">${esc(t('counted'))} ${money(c.counted)} · ${esc(t('expected'))} ${money(c.expected)}${c.note ? ' · ' + esc(c.note) : ''}</div></div>
      <div style="text-align:right"><div class="amt ${c.diff === 0 ? 'mut' : c.diff > 0 ? 'pos' : 'neg'}">${c.diff > 0 ? '+' : ''}${money(c.diff)}</div>${c.diff !== 0 && !c.adjusted ? `<button class="link" data-act="close-adjust" data-id="${esc(c.id)}">${esc(t('adjust'))}</button>` : c.adjusted ? `<div class="s">✓ ${esc(t('adjusted'))}</div>` : ''}</div></div>`).join('');
    return `${pageHead(t('pg_cash'))}
      <h3>${esc(t('cash_calc'))}</h3><div class="card">${dens}<div id="cashSum">${cashSummaryHtml()}</div></div>
      <div class="btns" style="margin-top:10px"><button class="secondary" data-act="cash-reset">${esc(t('clear'))}</button></div>
      <h3>${esc(t('daily_closing'))}</h3>
      <div class="card form"><div class="grid2"><label>${esc(t('date'))}<input type="date" data-ch="closedate" value="${esc(ui.closeDate)}"></label>
      <label>${esc(t('account'))}<select data-ch="closeacc">${opts(cashAccs.map((a) => ({ v: a.id, l: a.name })), ui.closeAcc)}</select></label></div>
      <label>${esc(t('note_opt'))}<input data-in="closenote" maxlength="120" value="${esc(ui.closeNote)}"></label>
      <p class="hint">${esc(t('closing_hint'))}</p><button class="primary" data-act="close-save">${esc(t('save_closing'))}</button></div>
      <h3>${esc(t('closing_history'))}</h3><div class="card">${cl || `<p class="empty">${esc(t('none_yet'))}</p>`}</div>`;
  }

  function renderNotes() {
    const n = ui.noteEdit ? state.notes.find((x) => x.id === ui.noteEdit) : null;
    const list = F.sortedNotes(state).map((x) => `<div class="note"><p>${x.pinned ? '📌 ' : ''}${esc(x.text)}</p><div class="s">${esc(x.at ? prettyDate(x.at) : '')}</div>
      <div class="btns" style="margin-top:6px"><button class="secondary small" data-act="note-pin" data-id="${esc(x.id)}">${esc(x.pinned ? t('unpin') : t('pin'))}</button><button class="secondary small" data-act="note-edit" data-id="${esc(x.id)}">${esc(t('edit'))}</button><button class="danger small" data-act="note-del" data-id="${esc(x.id)}">${esc(t('delete'))}</button></div></div>`).join('');
    return `${pageHead(t('pg_notes'))}
      <form class="card form" data-form="note"><label>${esc(n ? t('edit') : t('new_note'))}<textarea name="text" maxlength="2000" required>${esc(n ? n.text : '')}</textarea></label><div class="btns"><button class="primary">${esc(t('save'))}</button>${n ? `<button type="button" class="secondary" data-act="note-cancel">${esc(t('cancel'))}</button>` : ''}</div></form>
      <h3>${esc(t('pg_notes'))}</h3><div class="card">${list || `<p class="empty">${esc(t('none_yet'))}</p>`}</div>`;
  }

  function renderBudgets() {
    const ym = F.monthOf(today()), status = F.budgetStatus(state, ym);
    const list = status.length ? status.map((r) => {
      const cls = r.pct >= 100 ? 'over' : r.pct >= 80 ? 'warn' : '';
      return `<div class="bar"><div class="bl"><span>${esc(tc(r.cat))}</span><span>${money(r.spent)} / ${money(r.limit)} (${r.pct}%)</span></div><div class="track"><div class="fill ${cls}" style="width:${Math.min(100, r.pct)}%"></div></div><button class="link" data-act="budget-del" data-cat="${esc(r.cat)}">${esc(t('remove'))}</button></div>`;
    }).join('') : `<p class="empty">${esc(t('no_budgets'))}</p>`;
    return `${pageHead(t('pg_budgets'))}<h3>${esc(monthLabel(ym))}</h3><div class="card">${list}</div>
      <h3>${esc(t('set_limit'))}</h3><form class="card form" data-form="budget"><label>${esc(t('category'))}<select name="cat">${catOpts('expense')}</select></label><label>${esc(t('monthly_limit'))}<input name="limit" inputmode="decimal" required></label><button class="primary">${esc(t('save'))}</button></form>`;
  }

  function renderReports() {
    const ym = ui.month, today_ = today();
    const st = F.stats(state, ym, today_), months = F.lastMonths(state, 6, ym);
    const cmp = F.categoryCompare(state, ym).slice(0, 8), maxCmp = Math.max(1, ...cmp.map((r) => Math.max(r.cur, r.prev)));
    const list = F.txInMonth(state, ym), top = F.topExpenses(list, 5);
    const wd = F.weekdayTotals(list);
    const monthRows = months.slice().reverse().map((m) => `<div class="kv"><span>${esc(monthShortYear(m.ym))}</span><span><span style="color:var(--series-1)">▲</span> ${money(m.income)} · <span style="color:var(--series-2)">▼</span> ${money(m.expense)}</span></div>`).join('');
    const cmpHtml = cmp.length ? `<div class="legend"><span><i style="background:var(--series-1)"></i>${esc(monthLabel(ym))}</span><span><i style="background:var(--series-prev)"></i>${esc(monthLabel(F.shiftMonth(ym, -1)))}</span></div>` + cmp.map((r) =>
      `<div class="bar"><div class="bl"><span>${esc(tc(r.cat))}</span><span>${money(r.cur)} <span class="s">/ ${money(r.prev)}</span></span></div><div class="track"><div class="fill f1" style="width:${r.cur ? Math.max(2, (r.cur / maxCmp) * 100) : 0}%"></div></div><div class="track"><div class="fill fprev" style="width:${r.prev ? Math.max(2, (r.prev / maxCmp) * 100) : 0}%"></div></div></div>`).join('') : `<p class="empty">${esc(t('no_expenses'))}</p>`;
    const flows = F.accountFlows(state, ym).filter((a) => a.inflow || a.outflow).map((a) => `<div class="kv"><span>${esc(a.name)}</span><span><span class="pos">+${money(a.inflow)}</span> · <span class="neg">−${money(a.outflow)}</span></span></div>`).join('');
    const mem = multiMember() ? `<h3>${esc(t('by_member'))}</h3><div class="card">${F.memberTotals(state, ym).map((m) => `<div class="kv"><span>${esc(m.name)}</span><span><span class="pos">+${money(m.income)}</span> · <span class="neg">−${money(m.expense)}</span></span></div>`).join('')}</div>` : '';
    return `${pageHead(t('pg_reports'))}${monthNav()}
      <div class="grid3"><div class="card sm"><div class="s">${esc(t('avg_daily'))}</div><div class="v">${money(st.avgDaily)}</div></div><div class="card sm"><div class="s">${esc(t('savings_rate'))}</div><div class="v ${st.savingsPct != null && st.savingsPct < 0 ? 'neg' : ''}">${st.savingsPct == null ? '—' : st.savingsPct + '%'}</div></div><div class="card sm"><div class="s">${esc(t('top_category'))}</div><div class="v">${st.topCat ? esc(tc(st.topCat.cat)) : '—'}</div></div></div>
      <h3>${esc(t('rep_months'))}</h3><div class="card">${monthsChart(months)}${monthRows}</div>
      <h3>${esc(t('rep_compare'))}</h3><div class="card">${cmpHtml}</div>
      <h3>${esc(t('rep_top'))}</h3><div class="card">${top.length ? top.map(txRow).join('') : `<p class="empty">${esc(t('no_expenses'))}</p>`}</div>
      <h3>${esc(t('rep_weekday'))}</h3><div class="card">${weekdayChart(wd)}</div>
      ${mem}
      <h3>${esc(t('rep_accounts'))}</h3><div class="card">${flows || `<p class="empty">${esc(t('no_tx'))}</p>`}</div>
      <h3>${esc(t('export'))}</h3>${exportButtons('month')}`;
  }

  function renderAccounts() {
    const b = F.balances(state);
    const rows = state.accounts.map((a) => `<div class="accedit"><div class="s">${a.type === 'cash' ? '💵 ' + esc(t('cash')) : '🏦 ' + esc(t('bank'))}</div>
      <label>${esc(t('name'))}<input data-ch="accname" data-id="${esc(a.id)}" value="${esc(a.name)}" maxlength="40"></label>
      <div class="grid2"><label>${esc(t('opening_balance'))}<input data-ch="accopen" data-id="${esc(a.id)}" inputmode="decimal" value="${a.opening}"></label>
      ${a.type === 'bank' ? `<label>${esc(t('last4'))}<input data-ch="acclast4" data-id="${esc(a.id)}" inputmode="numeric" maxlength="4" value="${esc(a.last4)}" placeholder="1234"></label>` : '<span></span>'}</div>
      <div class="s">${esc(t('current_balance'))}: <b>${money(b[a.id])}</b></div>
      <button class="link" data-act="acc-del" data-id="${esc(a.id)}">${esc(t('remove'))}</button></div>`).join('');
    return `${pageHead(t('pg_accounts'))}<p class="hint">${esc(t('accounts_hint'))}</p><div class="card">${rows}</div>
      <h3>${esc(t('add_account'))}</h3><form class="card form" data-form="account"><label>${esc(t('name'))}<input name="name" maxlength="40" required></label>
      <label>${esc(t('type'))}<select name="type">${opts([{ v: 'bank', l: t('bank') }, { v: 'cash', l: t('cash') }], 'bank')}</select></label><button class="primary">${esc(t('add'))}</button></form>`;
  }

  function smsHtml() {
    if (!ui.smsFound) return '';
    if (!ui.smsFound.length) return `<p class="empty">${esc(t('sms_none'))}</p>`;
    const banks = state.accounts;
    return `<div class="card">${ui.smsFound.map((x, i) => {
      const dup = state.tx.some((tx) => tx.sms === x.key);
      return `<div class="chk"><input type="checkbox" data-ch="smscheck" data-i="${i}"${x.checked && !dup ? ' checked' : ''}${dup ? ' disabled' : ''} aria-label="${esc(x.note)}"><div class="grow">
        <div class="t">${x.type === 'income' ? '+' : '−'} ${money(x.amount)} <span class="badge">${esc(x.type === 'income' ? t('type_income') : t('type_expense'))}</span>${dup ? `<span class="badge">${esc(t('already_imported'))}</span>` : ''}</div>
        <div class="s">${esc(prettyDate(x.date))} · ${esc(x.note)} · ${esc(tc(x.cat))}</div>
        <select data-ch="smsacc" data-i="${i}" aria-label="${esc(t('account'))}" style="margin-top:6px">${opts(banks.map((a) => ({ v: a.id, l: a.name })), x.acc)}</select></div></div>`;
    }).join('')}</div><button class="primary" style="margin-top:10px;width:100%" data-act="sms-import">${esc(t('sms_import'))}</button>`;
  }
  function renderSms() {
    return `${pageHead(t('pg_sms'))}<p class="hint">${esc(t('sms_hint'))}</p>
      <div class="card form"><label>${esc(t('sms_paste'))}<textarea data-in="smstext" placeholder="Rs.500.00 debited from A/c XX1234 on 03-10-26 ...">${esc(ui.smsText)}</textarea></label>
      <div class="btns"><button class="secondary" data-act="sms-clip">📋 ${esc(t('paste_clip'))}</button><button class="primary" data-act="sms-detect">${esc(t('detect'))}</button></div></div>
      <div id="smsOut" style="margin-top:10px">${smsHtml()}</div>
      <p class="hint" style="margin-top:12px">${esc(t('sms_last4_hint'))}</p>`;
  }

  function renderFamily() {
    const rows = state.members.map((m) => `<div class="accedit"><label>${esc(t('name'))}<input data-ch="mname" data-id="${esc(m.id)}" value="${esc(m.name)}" maxlength="30"></label>
      <div class="btns"><button class="${state.settings.activeMember === m.id ? 'primary' : 'secondary'} small" data-act="member-use" data-id="${esc(m.id)}">${state.settings.activeMember === m.id ? '✓ ' + esc(t('using_now')) : esc(t('use_member'))}</button></div></div>`).join('');
    return `${pageHead(t('pg_family'))}<p class="hint">${esc(t('family_hint'))}</p><div class="card">${rows}</div>
      <h3>${esc(t('add_member'))}</h3><form class="card form" data-form="member"><label>${esc(t('name'))}<input name="name" maxlength="30" required></label><button class="primary">${esc(t('add'))}</button></form>
      <h3>${esc(t('merge_title'))}</h3><div class="card form"><p class="hint" style="margin:0">${esc(t('merge_hint'))}</p>
      <button class="secondary" data-act="exp-json">${esc(t('share_mine'))}</button>
      <label class="file">${esc(t('merge_file'))}<input type="file" accept="application/json,.json" data-ch="merge"></label></div>`;
  }

  function renderSettings() {
    const notif = 'Notification' in window ? Notification.permission : 'unsupported';
    return `${pageHead(t('pg_settings'))}
      <div class="card form"><label>${esc(t('language'))}<select data-ch="lang">${opts([{ v: 'en', l: 'English' }, { v: 'te', l: 'తెలుగు' }], state.settings.lang)}</select></label>
      <label>${esc(t('remind_default'))}<input data-ch="remind" inputmode="numeric" value="${state.settings.remindDays}"></label>
      <button class="secondary" data-act="notif">🔔 ${esc(notif === 'granted' ? t('notif_on') : t('notif_enable'))}</button><p class="hint" style="margin:0">${esc(t('notif_hint'))}</p></div>
      <h3>${esc(t('add_category'))}</h3><form class="card form" data-form="category"><div class="grid2"><label>${esc(t('type'))}<select name="kind">${opts([{ v: 'expense', l: t('type_expense') }, { v: 'income', l: t('type_income') }], 'expense')}</select></label><label>${esc(t('name'))}<input name="name" maxlength="24" required></label></div><button class="primary">${esc(t('add'))}</button></form>
      <h3>${esc(t('data'))}</h3><div class="card form">
      <div class="btns"><button class="secondary" data-act="exp-xlsx" data-src="all">⬇ Excel</button><button class="secondary" data-act="exp-csv" data-src="all">⬇ CSV</button><button class="secondary" data-act="exp-pdf" data-src="all">⬇ PDF</button></div>
      <button class="secondary" data-act="exp-json">${esc(t('backup'))}</button><button class="secondary" data-act="exp-json-r">${esc(t('backup_receipts'))}</button>
      <label class="file">${esc(t('restore'))}<input type="file" accept="application/json,.json" data-ch="restore"></label>
      <button class="danger" data-act="reset">${esc(t('erase_all'))}</button><p class="hint" style="margin:0">${esc(t('data_hint'))}</p></div>`;
  }

  /* ---------------- main render ---------------- */
  const TABS = [['home', '🏠'], ['history', '🧾'], ['summary', '📊'], ['people', '🤝'], ['more', '⋯']];
  function render() {
    const map = { home: renderHome, history: renderHistory, summary: renderSummary, people: renderPeople, more: renderMore };
    $('view').innerHTML = map[ui.tab]();
    $('nav').innerHTML = TABS.map((x) => `<button data-act="nav" data-tab="${x[0]}" class="${ui.tab === x[0] ? 'on' : ''}" aria-current="${ui.tab === x[0] ? 'page' : 'false'}"><span>${x[1]}</span>${esc(t('tab_' + x[0]))}</button>`).join('');
    renderHeader();
    $('fab').hidden = ui.tab === 'more';
    window.scrollTo(0, 0);
  }
  function renderHeader() {
    $('appTitle').textContent = t('app');
    $('langBtn').textContent = state.settings.lang === 'te' ? 'EN' : 'తె';
    const sel = $('memberSel');
    sel.hidden = !multiMember();
    sel.innerHTML = opts(state.members.map((m) => ({ v: m.id, l: m.name })), state.settings.activeMember);
  }
  function applyStatic() {
    document.documentElement.lang = state.settings.lang;
    Array.prototype.forEach.call(document.querySelectorAll('[data-i]'), (el) => { el.textContent = t(el.dataset.i); });
    $('saveBtn').textContent = t('save');
    $('photoRm').textContent = t('remove_photo');
    $('fab').setAttribute('aria-label', t('add_tx'));
    $('mic').setAttribute('aria-label', t('voice'));
  }

  /* ---------------- add / edit sheet ---------------- */
  function keep(sel, html) { const old = sel.value; sel.innerHTML = html; if (old && Array.prototype.some.call(sel.options, (o) => o.value === old)) sel.value = old; }
  function fillSheet() {
    const ty = ui.addType;
    $('seg').innerHTML = ['expense', 'income', 'transfer', 'people'].map((x) => `<button type="button" data-act="seg" data-type="${x}" class="${ty === x ? 'on' : ''}">${esc(t('type_' + x))}</button>`).join('');
    keep($('fKind'), opts(F.PEOPLE_TYPES.map((k) => ({ v: k, l: t('k_' + k) })), ui.pKind)); $('fKind').value = ui.pKind;
    keep($('fPerson'), opts(state.people.map((p) => ({ v: p.id, l: p.name })).concat([{ v: '__new', l: '+ ' + t('new_person') }]), ''));
    keep($('fAcc'), accOpts('')); keep($('fTo'), accOpts(''));
    if ($('fTo').value === $('fAcc').value && state.accounts.length > 1) $('fTo').selectedIndex = ($('fAcc').selectedIndex + 1) % state.accounts.length;
    keep($('fCat'), catOpts(ty === 'income' ? 'income' : 'expense', ''));
    const isP = ty === 'people', isT = ty === 'transfer';
    $('rowKind').hidden = !isP; $('rowPerson').hidden = !isP; $('rowTo').hidden = !isT; $('rowCat').hidden = isT || isP;
    $('rowNewPerson').hidden = !(isP && $('fPerson').value === '__new');
    const moneyIn = ty === 'income' || (isP && (ui.pKind === 'taken' || ui.pKind === 'received'));
    $('lblAccTxt').textContent = isT ? t('from_account') : moneyIn ? t('received_in') : t('paid_from');
  }
  function openSheet() { $('sheet').classList.add('open'); $('scrim').classList.add('open'); }
  function closeSheet() { $('sheet').classList.remove('open'); if (!$('modal').classList.contains('open')) $('scrim').classList.remove('open'); }
  function setPhotoPreview(src) {
    $('photoPrev').hidden = !src; $('photoRm').hidden = !src;
    if (src) $('photoPrev').src = src; else $('photoPrev').removeAttribute('src');
  }
  function openAdd(o) {
    o = o || {};
    closeModal();
    ui.editId = null; ui.photo = null; ui.photoState = 'none';
    $('fAmount').value = ''; $('fNote').value = ''; $('fNewPerson').value = ''; $('fDate').value = today(); $('voiceTxt').textContent = '';
    $('fPhoto').value = ''; setPhotoPreview(null);
    $('vLang').value = state.settings.lang === 'te' ? 'te-IN' : 'en-IN';
    $('voiceRow').hidden = false;
    $('sheetTitle').textContent = t('add_tx');
    ui.addType = o.type || 'expense'; ui.pKind = o.kind || 'given';
    const x = o.tx;
    if (x) {
      ui.editId = x.id; $('sheetTitle').textContent = t('edit_tx');
      ui.addType = F.PEOPLE_TYPES.indexOf(x.type) >= 0 ? 'people' : x.type;
      if (ui.addType === 'people') ui.pKind = x.type;
    }
    ['fAcc', 'fTo', 'fCat', 'fPerson'].forEach((id) => { $(id).innerHTML = ''; });
    fillSheet();
    if (x) {
      $('fAmount').value = x.amount; $('fDate').value = x.date; $('fNote').value = x.note || '';
      $('fAcc').value = x.acc; if (x.to) $('fTo').value = x.to; if (x.cat) $('fCat').value = x.cat; if (x.p) $('fPerson').value = x.p;
      $('voiceRow').hidden = true;
      if (x.r) { ui.photoState = 'keep'; rGet(x.id).then((d) => { if (d && ui.editId === x.id && ui.photoState === 'keep') setPhotoPreview(d); }); }
    }
    if (o.person) { $('fPerson').value = o.person; }
    if (!state.people.length && ui.addType === 'people') { $('fPerson').value = '__new'; }
    fillSheet();
    openSheet();
    setTimeout(() => $('fAmount').focus(), 60);
  }
  function onSave(e) {
    e.preventDefault();
    let type = ui.addType === 'people' ? $('fKind').value : ui.addType;
    let pid = $('fPerson').value;
    if (ui.addType === 'people' && pid === '__new') {
      const r = F.addPerson(state, { name: $('fNewPerson').value });
      if (!r.ok && !r.person) { err(r); return; }
      pid = (r.person || r.person).id;
    }
    const input = { type, amount: $('fAmount').value, acc: $('fAcc').value, to: $('fTo').value, cat: $('fCat').value, date: $('fDate').value, note: $('fNote').value, person: pid, r: ui.photoState !== 'none' };
    const res = ui.editId ? F.updateTx(state, ui.editId, input) : F.addTx(state, input);
    if (!res.ok) { err(res); return; }
    const id = res.tx.id;
    if (ui.photoState === 'new' && ui.photo) rPut(id, ui.photo);
    if (ui.photoState === 'none' && ui.editId) rDel(id);
    const wasEdit = !!ui.editId;
    save(); closeSheet(); render();
    if (!wasEdit && res.tx.type === 'expense') {
      const hit = F.budgetStatus(state, F.monthOf(res.tx.date)).find((x) => x.cat === res.tx.cat);
      if (hit && hit.pct >= 100) { toast(t('over_budget', { cat: tc(hit.cat), pct: hit.pct }), 'bad'); return; }
      if (hit && hit.pct >= 80) { toast(t('near_budget', { cat: tc(hit.cat), pct: hit.pct }), 'warn'); return; }
    }
    toast(t('saved_ok'));
  }

  /* voice */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function voice() {
    if (!SR) { toast(t('voice_unsupported'), 'bad'); return; }
    const r = new SR();
    r.lang = $('vLang').value; r.interimResults = false; r.maxAlternatives = 1;
    $('mic').classList.add('on'); $('voiceTxt').textContent = t('listening');
    r.onresult = (e) => { const txt = e.results[0][0].transcript; $('voiceTxt').textContent = '“' + txt + '”'; applyVoice(txt); };
    r.onerror = () => { toast(t('voice_err'), 'bad'); };
    r.onend = () => { $('mic').classList.remove('on'); };
    try { r.start(); } catch (e) { $('mic').classList.remove('on'); }
  }
  function applyVoice(txt) {
    const p = F.parseVoice(txt, state);
    if (p.amount == null) { toast(t('voice_noamt'), 'warn'); return; }
    if (F.PEOPLE_TYPES.indexOf(p.type) >= 0) { ui.addType = 'people'; ui.pKind = p.type; } else ui.addType = p.type;
    $('fKind').value = ui.pKind;
    fillSheet();
    $('fAmount').value = p.amount; $('fNote').value = txt.slice(0, 120);
    if (p.acc) $('fAcc').value = p.acc;
    if (p.to) $('fTo').value = p.to;
    if (p.cat && catList(ui.addType === 'income' ? 'income' : 'expense').indexOf(p.cat) >= 0) $('fCat').value = p.cat;
    if (p.person) $('fPerson').value = p.person;
    fillSheet();
    toast(t('voice_filled'));
  }

  /* ---------------- tx detail modal ---------------- */
  function openModal(html) {
    $('modal').innerHTML = html; $('modal').classList.add('open'); $('scrim').classList.add('open');
  }
  function closeModal() { $('modal').classList.remove('open'); if (!$('sheet').classList.contains('open')) $('scrim').classList.remove('open'); }
  function showTx(id) {
    const x = state.tx.find((y) => y.id === id); if (!x) return;
    const kv = (k, v) => `<div class="kv"><span class="s">${esc(k)}</span><span>${v}</span></div>`;
    let h = `<div class="sh"><b>${txTitle(x)}</b><button class="icon" data-act="close-modal" aria-label="${esc(t('close'))}">✕</button></div>`;
    const f = flow(x.type);
    h += kv(t('amount'), `<b class="${f > 0 ? 'pos' : f < 0 ? 'neg' : ''}">${money(x.amount)}</b>`) + kv(t('date'), esc(prettyDate(x.date))) + kv(t('account'), esc(accName(x.acc)) + (x.to ? ' → ' + esc(accName(x.to)) : ''));
    if (x.cat) h += kv(t('category'), esc(tc(x.cat)));
    if (x.p) h += kv(t('person'), esc(personName(x.p)));
    if (multiMember()) h += kv(t('member'), esc(memberName(x.by)));
    if (x.note) h += kv(t('note'), esc(x.note));
    h += `<div id="rcpt"></div><div class="btns" style="margin-top:14px"><button class="secondary" data-act="tx-edit" data-id="${esc(x.id)}">${esc(t('edit'))}</button><button class="danger" data-act="tx-del" data-id="${esc(x.id)}">${esc(t('delete'))}</button></div>
      <label class="file" style="margin-top:10px">${esc(x.r ? t('replace_photo') : t('attach_photo'))}<input type="file" accept="image/*" capture="environment" data-ch="attach" data-id="${esc(x.id)}"></label>`;
    openModal(h);
    if (x.r) rGet(x.id).then((d) => { const el = $('rcpt'); if (el && d) el.innerHTML = `<img class="receipt" alt="${esc(t('receipt_photo'))}" src="${d}">`; });
  }

  /* ---------------- exports ---------------- */
  function listFor(src) {
    if (src === 'hist') return filteredList();
    if (src === 'month') return F.txInMonth(state, ui.month);
    return state.tx;
  }
  function labelFor(src) { return src === 'month' ? monthLabel(ui.month) : src === 'hist' ? t('filtered') : t('all_time'); }
  function exportXlsx(src) {
    const bytes = F.makeXlsx(F.exportSheets(state, listFor(src)));
    download('finance-' + today() + '.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  function exportCsv(src) { download('finance-' + today() + '.csv', '﻿' + F.toCSV(state, listFor(src)), 'text/csv;charset=utf-8'); }
  function exportPdf(src) {
    const list = listFor(src).slice().sort(F.byDateAsc), tt = F.totals(list), cats = F.byCategory(list), b = F.balances(state);
    const rowT = (x) => `<tr><td>${esc(x.date)}</td><td>${x.type === 'transfer' || F.PEOPLE_TYPES.indexOf(x.type) >= 0 ? txTitle(x) : esc(tc(x.cat))}</td><td>${esc(accName(x.acc))}${x.to ? ' → ' + esc(accName(x.to)) : ''}</td><td>${esc(x.note || '')}</td><td class="n">${flow(x.type) < 0 ? '−' : flow(x.type) > 0 ? '+' : ''}${money(x.amount)}</td></tr>`;
    $('printArea').innerHTML = `<h1>${esc(t('app'))}</h1><div>${esc(labelFor(src))} · ${esc(prettyDate(today()))}</div>
      <h2>${esc(t('summary'))}</h2><table><tr><td>${esc(t('income'))}</td><td class="n">${money(tt.income)}</td></tr><tr><td>${esc(t('expense'))}</td><td class="n">${money(tt.expense)}</td></tr><tr><td><b>${esc(t('saved'))}</b></td><td class="n"><b>${money(tt.net)}</b></td></tr></table>
      <h2>${esc(t('by_category'))}</h2><table>${cats.map((c) => `<tr><td>${esc(tc(c.cat))}</td><td class="n">${money(c.amount)}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</table>
      <h2>${esc(t('accounts'))}</h2><table>${state.accounts.map((a) => `<tr><td>${esc(a.name)}</td><td class="n">${money(b[a.id])}</td></tr>`).join('')}</table>
      <h2>${esc(t('pg_history'))} (${list.length})</h2><table><tr><th>${esc(t('date'))}</th><th>${esc(t('category'))}</th><th>${esc(t('account'))}</th><th>${esc(t('note'))}</th><th class="n">${esc(t('amount'))}</th></tr>${list.map(rowT).join('')}</table>`;
    setTimeout(() => { window.print(); }, 50);
  }
  async function exportJson(withReceipts) {
    const data = JSON.parse(JSON.stringify(state));
    if (withReceipts) data.receipts = await rAll();
    download('finance-backup-' + today() + '.json', JSON.stringify(data), 'application/json');
  }
  function readJsonFile(file, cb) {
    const rd = new FileReader();
    rd.onload = () => { let obj = null; try { obj = JSON.parse(rd.result); } catch (e) { /* invalid */ } cb(obj); };
    rd.readAsText(file);
  }

  /* ---------------- notifications ---------------- */
  function notifyDue() {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
    const td = today();
    if (state.settings.notifiedOn === td) return;
    const due = F.dueBills(state, td);
    if (!due.length) return;
    const body = due.map((x) => `${x.bill.name} ${money(x.bill.amount)} · ${dueText(x)}`).join('\n');
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(t('app'), { body, icon: 'icons/icon-192.png', tag: 'bills' })).catch(() => {});
    state.settings.notifiedOn = td; save();
  }

  /* ---------------- actions (click) ---------------- */
  function updateCashDom() {
    const el = $('cashSum'); if (el) el.innerHTML = cashSummaryHtml();
    F.DENOMS.forEach((d) => { const s = $('sub' + d); if (s) s.textContent = money((parseInt(ui.counts[d], 10) || 0) * d); });
  }
  const ACTS = {
    nav(el) { ui.tab = el.dataset.tab; ui.page = 'menu'; ui.personId = null; render(); },
    goto(el) { ui.tab = el.dataset.tab; ui.page = el.dataset.page || 'menu'; ui.personId = null; render(); },
    'open-page'(el) { ui.page = el.dataset.page; render(); },
    'more-back'() { ui.page = 'menu'; render(); },
    'people-back'() { ui.personId = null; render(); },
    month(el) { ui.month = F.shiftMonth(ui.month, +el.dataset.d); render(); },
    'close-sheet'() { closeSheet(); },
    'close-modal'() { closeModal(); },
    seg(el) { ui.addType = el.dataset.type; fillSheet(); },
    voice() { voice(); },
    'photo-rm'() { ui.photo = null; ui.photoState = 'none'; $('fPhoto').value = ''; setPhotoPreview(null); },
    tx(el) { showTx(el.dataset.id); },
    'tx-edit'(el) { const x = state.tx.find((y) => y.id === el.dataset.id); if (x) openAdd({ tx: x }); },
    'tx-del'(el) {
      if (!confirm(t('confirm_delete'))) return;
      const x = state.tx.find((y) => y.id === el.dataset.id);
      if (x && x.r) rDel(x.id);
      F.deleteTx(state, el.dataset.id); closeModal(); commit();
    },
    'f-toggle'() { ui.fOpen = !ui.fOpen; render(); },
    'f-reset'() { ui.f = { q: '', type: 'all', acc: 'all', cat: 'all', by: 'all', from: '', to: '', min: '', max: '', receipt: false }; render(); },
    scope(el) { ui.scope = el.dataset.v; render(); },
    person(el) { ui.personId = el.dataset.id; render(); },
    'add-person-tx'(el) { openAdd({ type: 'people', kind: el.dataset.kind, person: ui.personId }); },
    'person-del'() { if (confirm(t('confirm_delete'))) { F.deletePerson(state, ui.personId); ui.personId = null; commit(); } },
    'bill-pay'(el) {
      const r = F.markBillPaid(state, el.dataset.id, ui.payAcc, today());
      if (!r.ok) { err(r); return; }
      commit(t('bill_paid'));
    },
    'bill-edit'(el) { ui.billEdit = el.dataset.id; render(); },
    'bill-cancel'() { ui.billEdit = null; render(); },
    'bill-del'(el) { if (confirm(t('confirm_delete'))) { F.deleteBill(state, el.dataset.id); commit(); } },
    'cash-reset'() { ui.counts = {}; render(); },
    'close-save'() {
      const r = F.saveClosing(state, { date: ui.closeDate, acc: ui.closeAcc, counts: ui.counts, note: ui.closeNote });
      if (!r.ok) { err(r); return; }
      ui.closeNote = ''; commit(t('closing_saved'));
    },
    'close-adjust'(el) {
      if (!confirm(t('confirm_adjust'))) return;
      const r = F.adjustForClosing(state, el.dataset.id); if (!r.ok) { err(r); return; }
      commit(t('saved_ok'));
    },
    'note-pin'(el) { const n = state.notes.find((x) => x.id === el.dataset.id); if (n) { n.pinned = !n.pinned; commit(); } },
    'note-edit'(el) { ui.noteEdit = el.dataset.id; render(); },
    'note-cancel'() { ui.noteEdit = null; render(); },
    'note-del'(el) { if (confirm(t('confirm_delete'))) { F.deleteNote(state, el.dataset.id); commit(); } },
    'budget-del'(el) { delete state.budgets[el.dataset.cat]; commit(); },
    'acc-del'(el) { if (!F.deleteAccount(state, el.dataset.id)) { toast(t('acc_in_use'), 'bad'); return; } commit(); },
    'member-use'(el) { state.settings.activeMember = el.dataset.id; commit(t('saved_ok')); },
    'sms-clip'() {
      if (!navigator.clipboard || !navigator.clipboard.readText) { toast(t('clip_unsupported'), 'bad'); return; }
      navigator.clipboard.readText().then((txt) => { ui.smsText = txt; render(); ACTS['sms-detect'](); }).catch(() => toast(t('clip_denied'), 'bad'));
    },
    'sms-detect'() {
      const ta = document.querySelector('[data-in="smstext"]'); if (ta) ui.smsText = ta.value;
      const found = F.parseSms(ui.smsText, today());
      const defaultBank = (state.accounts.find((a) => a.type === 'bank') || state.accounts[0]).id;
      ui.smsFound = found.map((x) => { const m = F.matchAccountByLast4(state, x.last4); return Object.assign({}, x, { acc: m ? m.id : defaultBank, checked: true }); });
      const out = $('smsOut'); if (out) out.innerHTML = smsHtml();
    },
    'sms-import'() {
      let n = 0;
      (ui.smsFound || []).forEach((x) => {
        if (!x.checked || state.tx.some((tx) => tx.sms === x.key)) return;
        const r = F.addTx(state, { type: x.type, amount: x.amount, acc: x.acc, date: x.date, cat: x.cat, note: x.note, sms: x.key });
        if (r.ok) n++;
      });
      ui.smsFound = null; ui.smsText = '';
      commit(t('sms_imported', { n }));
    },
    'exp-xlsx'(el) { exportXlsx(el.dataset.src); },
    'exp-csv'(el) { exportCsv(el.dataset.src); },
    'exp-pdf'(el) { exportPdf(el.dataset.src); },
    'exp-json'() { exportJson(false); },
    'exp-json-r'() { exportJson(true); },
    notif() {
      if (!('Notification' in window)) { toast(t('notif_unsupported'), 'bad'); return; }
      Notification.requestPermission().then(() => { render(); notifyDue(); });
    },
    reset() {
      if (!confirm(t('confirm_erase'))) return;
      state = F.defaultState(); F.setLang('en'); rClear(); save(); applyStatic(); ui.page = 'menu'; render(); toast(t('erased'));
    }
  };
  function onClick(e) {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = ACTS[el.dataset.act]; if (fn) fn(el, e);
  }

  /* ---------------- change / input ---------------- */
  function setLang(l) {
    state.settings.lang = l === 'te' ? 'te' : 'en';
    F.setLang(state.settings.lang); save(); applyStatic(); render();
  }
  const CHANGE = {
    lang(el) { setLang(el.value); },
    remind(el) { const v = parseInt(el.value, 10); state.settings.remindDays = isFinite(v) ? Math.max(0, Math.min(30, v)) : 3; save(); },
    payacc(el) { ui.payAcc = el.value; },
    closedate(el) { if (F.validDate(el.value)) { ui.closeDate = el.value; updateCashDom(); } },
    closeacc(el) { ui.closeAcc = el.value; updateCashDom(); },
    pname(el) { const p = person(ui.personId); if (p && el.value.trim()) { p.name = el.value.trim().slice(0, 40); commit(); } },
    pphone(el) { const p = person(ui.personId); if (p) { p.phone = el.value.trim().slice(0, 20); commit(); } },
    accname(el) { const a = acct(el.dataset.id); if (a && el.value.trim()) { a.name = el.value.trim().slice(0, 40); commit(); } },
    accopen(el) { const a = acct(el.dataset.id); if (a) { const v = F.num(el.value); a.opening = isFinite(v) ? F.round2(v) : 0; commit(); } },
    acclast4(el) { const a = acct(el.dataset.id); if (a) { a.last4 = el.value.replace(/\D/g, '').slice(-4); commit(); } },
    mname(el) { const m = state.members.find((x) => x.id === el.dataset.id); if (m && el.value.trim()) { m.name = el.value.trim().slice(0, 30); commit(); } },
    smscheck(el) { ui.smsFound[+el.dataset.i].checked = el.checked; },
    smsacc(el) { ui.smsFound[+el.dataset.i].acc = el.value; },
    attach(el) {
      const f = el.files[0]; if (!f) return;
      const id = el.dataset.id;
      compress(f).then((d) => rPut(id, d).then(() => {
        const x = state.tx.find((y) => y.id === id); if (x) { x.r = true; save(); }
        render(); showTx(id); toast(t('saved_ok'));
      })).catch(() => toast(t('photo_fail'), 'bad'));
    },
    restore(el) {
      const f = el.files[0]; if (!f) return;
      readJsonFile(f, (obj) => {
        const s = F.migrate(obj);
        if (!s) { toast(t('bad_backup'), 'bad'); return; }
        if (!confirm(t('confirm_restore'))) return;
        state = s; F.setLang(state.settings.lang);
        const done = () => { save(); applyStatic(); render(); toast(t('restored')); };
        if (obj.receipts && typeof obj.receipts === 'object') {
          rClear().then(() => Promise.all(Object.keys(obj.receipts).map((k) => rPut(k, obj.receipts[k])))).then(done);
        } else done();
      });
    },
    merge(el) {
      const f = el.files[0]; if (!f) return;
      readJsonFile(f, (obj) => {
        const r = F.mergeState(state, obj);
        if (!r.ok) { toast(t('bad_backup'), 'bad'); return; }
        if (obj && obj.receipts) Object.keys(obj.receipts).forEach((k) => { if (state.tx.some((x) => x.id === k)) rPut(k, obj.receipts[k]); });
        commit(t('merged', { n: r.added }));
      });
    }
  };
  function onChange(e) {
    const el = e.target;
    if (el.id === 'fPhoto') {
      const f = el.files[0]; if (!f) return;
      compress(f).then((d) => { ui.photo = d; ui.photoState = 'new'; setPhotoPreview(d); }).catch(() => toast(t('photo_fail'), 'bad'));
      return;
    }
    if (el.id === 'fPerson' || el.id === 'fKind') { if (el.id === 'fKind') ui.pKind = el.value; fillSheet(); return; }
    if (el.id === 'memberSel') { state.settings.activeMember = el.value; save(); toast(t('saved_ok')); return; }
    if (el.dataset.in === 'f') { applyFilterInput(el); return; }
    const fn = CHANGE[el.dataset.ch]; if (fn) fn(el, e);
  }
  function applyFilterInput(el) {
    ui.f[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
    const list = $('hlist'); if (list) list.innerHTML = historyListHtml();
  }
  function onInput(e) {
    const el = e.target;
    if (el.dataset.in === 'f' && (el.type === 'search' || el.type === 'text' || el.inputMode === 'decimal')) { applyFilterInput(el); return; }
    if (el.dataset.in === 'count') { ui.counts[el.dataset.d] = el.value.replace(/\D/g, '').slice(0, 6); updateCashDom(); return; }
    if (el.dataset.in === 'closenote') { ui.closeNote = el.value; return; }
    if (el.dataset.in === 'smstext') { ui.smsText = el.value; }
  }

  /* ---------------- forms ---------------- */
  const FORMS = {
    person(form) {
      const r = F.addPerson(state, { name: form.name.value, phone: form.phone.value });
      if (!r.ok) { if (r.person) { ui.personId = r.person.id; render(); return; } err(r); return; }
      ui.personId = r.person.id; commit(t('saved_ok'));
    },
    bill(form) {
      const r = F.addBill(state, { id: ui.billEdit || undefined, name: form.name.value, amount: form.amount.value, due: form.due.value, repeat: form.repeat.value, cat: form.cat.value, remind: form.remind.value });
      if (!r.ok) { err(r); return; }
      ui.billEdit = null; commit(t('saved_ok'));
    },
    note(form) {
      const r = F.saveNote(state, { id: ui.noteEdit || undefined, text: form.text.value });
      if (!r.ok) { err(r); return; }
      ui.noteEdit = null; commit(t('saved_ok'));
    },
    budget(form) {
      const v = F.num(form.limit.value);
      if (!(v > 0)) { toast(t('err_amount'), 'bad'); return; }
      state.budgets[form.cat.value] = F.round2(v); commit(t('saved_ok'));
    },
    account(form) {
      const r = F.addAccount(state, { name: form.name.value, type: form.type.value });
      if (!r.ok) { err(r); return; }
      commit(t('saved_ok'));
    },
    member(form) {
      const r = F.addMember(state, form.name.value);
      if (!r.ok) { err(r); return; }
      commit(t('saved_ok'));
    },
    category(form) {
      const name = form.name.value.trim().slice(0, 24), kind = form.kind.value;
      if (!name) { toast(t('err_name'), 'bad'); return; }
      if (state.cats[kind].some((c) => c.toLowerCase() === name.toLowerCase())) { toast(t('err_dupe'), 'bad'); return; }
      state.cats[kind].push(name); commit(t('saved_ok'));
    }
  };
  function onSubmit(e) {
    const name = e.target.dataset && e.target.dataset.form;
    if (!name || !FORMS[name]) return;
    e.preventDefault(); FORMS[name](e.target);
  }

  /* ---------------- boot ---------------- */
  function init() {
    applyStatic();
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('submit', onSubmit);
    $('addForm').addEventListener('submit', onSave);
    $('scrim').addEventListener('click', () => { closeSheet(); closeModal(); });
    $('fab').addEventListener('click', () => openAdd());
    $('langBtn').addEventListener('click', () => setLang(state.settings.lang === 'te' ? 'en' : 'te'));

    // Launch shortcuts and Android "Share" target (share an SMS to this app)
    const params = new URLSearchParams(location.search);
    const shared = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join('\n');
    if (shared) { ui.tab = 'more'; ui.page = 'sms'; ui.smsText = shared; }
    if (/^https?:$/.test(location.protocol) && (shared || params.get('add'))) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } }
    render();
    if (shared) ACTS['sms-detect']();
    else if (params.get('add')) openAdd({ type: ['expense', 'income', 'transfer', 'people'].indexOf(params.get('add')) >= 0 ? params.get('add') : 'expense' });

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    notifyDue();
  }
  window.FT.__app = { get state() { return state; }, ui, ACTS, render, openAdd, onSave, applyVoice, FORMS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
