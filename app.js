/* Daily Finance Tracker — logic + UI. Logic functions are pure and testable in Node. */
(function (root) {
  'use strict';

  var DEFAULT_CATS = {
    expense: ['Food', 'Groceries', 'Transport', 'Rent', 'Bills', 'Shopping', 'Health', 'Entertainment', 'Education', 'Other'],
    income: ['Salary', 'Freelance', 'Interest', 'Gift', 'Other']
  };

  function defaultState() {
    var accounts = [];
    for (var i = 1; i <= 5; i++) accounts.push({ id: 'a' + i, name: 'Bank ' + i, opening: 0 });
    return { v: 1, accounts: accounts, tx: [], budgets: {}, cats: JSON.parse(JSON.stringify(DEFAULT_CATS)) };
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function monthOf(dateStr) { return dateStr.slice(0, 7); }
  function round2(n) { return Math.round(n * 100) / 100; }

  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* Returns {ok, error, tx}. Mutates state.tx on success. */
  function addTx(state, input) {
    var amount = round2(parseFloat(input.amount));
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount greater than 0' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) return { ok: false, error: 'Pick a valid date' };
    var ids = state.accounts.map(function (a) { return a.id; });
    if (ids.indexOf(input.acc) < 0) return { ok: false, error: 'Pick an account' };
    var type = input.type;
    if (['expense', 'income', 'transfer'].indexOf(type) < 0) return { ok: false, error: 'Invalid type' };
    var tx = { id: uid(), type: type, amount: amount, acc: input.acc, date: input.date, note: (input.note || '').trim().slice(0, 120) };
    if (type === 'transfer') {
      if (ids.indexOf(input.to) < 0) return { ok: false, error: 'Pick the destination account' };
      if (input.to === input.acc) return { ok: false, error: 'Choose two different accounts' };
      tx.to = input.to;
    } else {
      tx.cat = input.cat || 'Other';
    }
    state.tx.push(tx);
    return { ok: true, tx: tx };
  }

  function balances(state) {
    var b = {};
    state.accounts.forEach(function (a) { b[a.id] = Number(a.opening) || 0; });
    state.tx.forEach(function (t) {
      if (t.type === 'income') b[t.acc] = (b[t.acc] || 0) + t.amount;
      else if (t.type === 'expense') b[t.acc] = (b[t.acc] || 0) - t.amount;
      else if (t.type === 'transfer') {
        b[t.acc] = (b[t.acc] || 0) - t.amount;
        b[t.to] = (b[t.to] || 0) + t.amount;
      }
    });
    Object.keys(b).forEach(function (k) { b[k] = round2(b[k]); });
    return b;
  }

  function totalBalance(state) {
    var b = balances(state), s = 0;
    Object.keys(b).forEach(function (k) { s += b[k]; });
    return round2(s);
  }

  function txInMonth(state, ym) {
    return state.tx.filter(function (t) { return monthOf(t.date) === ym; });
  }

  function totals(list) {
    var inc = 0, exp = 0;
    list.forEach(function (t) {
      if (t.type === 'income') inc += t.amount;
      else if (t.type === 'expense') exp += t.amount;
    });
    return { income: round2(inc), expense: round2(exp), net: round2(inc - exp) };
  }

  function byCategory(list) {
    var m = {};
    list.forEach(function (t) { if (t.type === 'expense') m[t.cat] = (m[t.cat] || 0) + t.amount; });
    return Object.keys(m).map(function (c) { return { cat: c, amount: round2(m[c]) }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  function dailyExpense(list, ym) {
    var parts = ym.split('-');
    var days = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10), 0).getDate();
    var out = [];
    for (var i = 0; i < days; i++) out.push(0);
    list.forEach(function (t) {
      if (t.type === 'expense') out[parseInt(t.date.slice(8, 10), 10) - 1] += t.amount;
    });
    return out.map(round2);
  }

  function budgetStatus(state, ym) {
    var spent = {};
    byCategory(txInMonth(state, ym)).forEach(function (r) { spent[r.cat] = r.amount; });
    return Object.keys(state.budgets).filter(function (c) { return state.budgets[c] > 0; }).map(function (c) {
      var limit = state.budgets[c], s = spent[c] || 0;
      return { cat: c, limit: limit, spent: s, pct: Math.round((s / limit) * 100) };
    }).sort(function (a, b) { return b.pct - a.pct; });
  }

  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(v)) v = "'" + v; // avoid spreadsheet formula injection
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function toCSV(state) {
    var names = {};
    state.accounts.forEach(function (a) { names[a.id] = a.name; });
    var rows = [['Date', 'Type', 'Amount', 'Account', 'To account', 'Category', 'Note']];
    state.tx.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).forEach(function (t) {
      rows.push([t.date, t.type, t.amount, names[t.acc] || t.acc, t.to ? (names[t.to] || t.to) : '', t.cat || '', t.note || '']);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }

  function validateImport(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.accounts) || !Array.isArray(obj.tx)) return null;
    var s = defaultState();
    s.accounts = obj.accounts.slice(0, 10).map(function (a, i) {
      return { id: String(a.id || 'a' + (i + 1)), name: String(a.name || 'Bank ' + (i + 1)).slice(0, 40), opening: Number(a.opening) || 0 };
    });
    s.tx = obj.tx.filter(function (t) {
      return t && isFinite(t.amount) && /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') && ['expense', 'income', 'transfer'].indexOf(t.type) >= 0;
    }).map(function (t) {
      var o = { id: String(t.id || uid()), type: t.type, amount: Number(t.amount), acc: String(t.acc), date: t.date, note: String(t.note || '').slice(0, 120) };
      if (t.type === 'transfer') o.to = String(t.to); else o.cat = String(t.cat || 'Other');
      return o;
    });
    if (obj.budgets && typeof obj.budgets === 'object') {
      Object.keys(obj.budgets).forEach(function (k) { var v = Number(obj.budgets[k]); if (v > 0) s.budgets[k] = v; });
    }
    if (obj.cats && Array.isArray(obj.cats.expense) && Array.isArray(obj.cats.income)) {
      s.cats = { expense: obj.cats.expense.map(String), income: obj.cats.income.map(String) };
    }
    return s;
  }

  var Logic = {
    DEFAULT_CATS: DEFAULT_CATS, defaultState: defaultState, todayStr: todayStr, monthOf: monthOf,
    addTx: addTx, balances: balances, totalBalance: totalBalance, txInMonth: txInMonth, totals: totals,
    byCategory: byCategory, dailyExpense: dailyExpense, budgetStatus: budgetStatus, toCSV: toCSV, validateImport: validateImport
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
  if (typeof document === 'undefined') return;

  /* ---------------- UI ---------------- */
  var KEY = 'finance-tracker-v1';
  var memoryFallback = null;
  var state = load();
  var ui = { tab: 'home', month: monthOf(todayStr()), addType: 'expense' };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var s = validateImport(JSON.parse(raw)); if (s) return s; }
    } catch (e) { /* storage unavailable */ }
    return memoryFallback || defaultState();
  }
  function save() {
    memoryFallback = state;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  var inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
  function money(n) { return inr.format(n); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function $(id) { return document.getElementById(id); }
  function accName(id) {
    var a = state.accounts.filter(function (x) { return x.id === id; })[0];
    return a ? a.name : '(deleted)';
  }
  function prettyDate(d) {
    var t = todayStr();
    if (d === t) return 'Today';
    var y = new Date(); y.setDate(y.getDate() - 1);
    if (d === todayStr(y)) return 'Yesterday';
    var p = d.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function monthLabel(ym) {
    var p = ym.split('-');
    return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }
  function shiftMonth(ym, d) {
    var p = ym.split('-');
    var dt = new Date(+p[0], +p[1] - 1 + d, 1);
    return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1);
  }

  function txRow(t, withDelete) {
    var sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '⇄';
    var cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg' : 'mut';
    var title = t.type === 'transfer' ? 'Transfer' : esc(t.cat);
    var sub = t.type === 'transfer' ? esc(accName(t.acc)) + ' → ' + esc(accName(t.to)) : esc(accName(t.acc));
    if (t.note) sub += ' · ' + esc(t.note);
    return '<div class="row"><div class="grow"><div class="t">' + title + '</div><div class="s">' + sub + '</div></div>' +
      '<div class="amt ' + cls + '">' + sign + ' ' + money(t.amount) + '</div>' +
      (withDelete ? '<button class="icon" data-del="' + t.id + '" aria-label="Delete transaction">✕</button>' : '') + '</div>';
  }

  function groupedList(list, withDelete) {
    if (!list.length) return '<p class="empty">No transactions yet.</p>';
    var sorted = list.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var html = '', last = '';
    sorted.forEach(function (t) {
      if (t.date !== last) { html += '<h4 class="day">' + prettyDate(t.date) + '</h4>'; last = t.date; }
      html += txRow(t, withDelete);
    });
    return html;
  }

  function renderHome() {
    var ym = monthOf(todayStr());
    var mt = totals(txInMonth(state, ym));
    var today = totals(state.tx.filter(function (t) { return t.date === todayStr(); }));
    var b = balances(state);
    var accs = state.accounts.map(function (a) {
      return '<div class="acc"><div class="s">' + esc(a.name) + '</div><div class="v ' + (b[a.id] < 0 ? 'neg' : '') + '">' + money(b[a.id]) + '</div></div>';
    }).join('');
    var recent = state.tx.slice().sort(function (a, c) { return a.date < c.date ? 1 : a.date > c.date ? -1 : 0; }).slice(0, 8);
    var alerts = budgetStatus(state, ym).filter(function (r) { return r.pct >= 80; }).map(function (r) {
      return '<div class="alert ' + (r.pct >= 100 ? 'over' : 'warn') + '">' + esc(r.cat) + ': ' + r.pct + '% of budget used (' + money(r.spent) + ' of ' + money(r.limit) + ')</div>';
    }).join('');
    return '<section class="hero"><div class="s">Total balance</div><div class="big">' + money(totalBalance(state)) + '</div>' +
      '<div class="chips"><span>Spent today <b>' + money(today.expense) + '</b></span><span>This month in <b class="pos">' + money(mt.income) + '</b></span><span>out <b class="neg">' + money(mt.expense) + '</b></span></div></section>' +
      alerts +
      '<h3>Accounts</h3><div class="accs">' + accs + '</div>' +
      '<h3>Recent</h3><div class="card">' + groupedList(recent, false) + '</div>';
  }

  function renderHistory() {
    var list = txInMonth(state, ui.month);
    return monthNav() + '<div class="card">' + groupedList(list, true) + '</div>';
  }

  function monthNav() {
    return '<div class="mnav"><button class="icon" data-month="-1" aria-label="Previous month">‹</button><b>' + monthLabel(ui.month) +
      '</b><button class="icon" data-month="1" aria-label="Next month">›</button></div>';
  }

  function renderSummary() {
    var list = txInMonth(state, ui.month);
    var t = totals(list);
    var cats = byCategory(list);
    var maxC = cats.length ? cats[0].amount : 1;
    var catHtml = cats.length ? cats.map(function (c) {
      var pct = t.expense ? Math.round((c.amount / t.expense) * 100) : 0;
      return '<div class="bar"><div class="bl"><span>' + esc(c.cat) + '</span><span>' + money(c.amount) + ' · ' + pct + '%</span></div>' +
        '<div class="track"><div class="fill" style="width:' + Math.max(2, (c.amount / maxC) * 100) + '%"></div></div></div>';
    }).join('') : '<p class="empty">No expenses this month.</p>';

    var daily = dailyExpense(list, ui.month), maxD = Math.max.apply(null, daily.concat([1]));
    var W = 320, H = 90, bw = W / daily.length;
    var bars = daily.map(function (v, i) {
      var h = v ? Math.max(2, (v / maxD) * (H - 4)) : 0;
      return '<rect x="' + (i * bw + 1) + '" y="' + (H - h) + '" width="' + Math.max(1, bw - 2) + '" height="' + h + '" rx="2"><title>' + (i + 1) + ': ' + money(v) + '</title></rect>';
    }).join('');
    return monthNav() +
      '<div class="grid3"><div class="card sm"><div class="s">Income</div><div class="v pos">' + money(t.income) + '</div></div>' +
      '<div class="card sm"><div class="s">Expense</div><div class="v neg">' + money(t.expense) + '</div></div>' +
      '<div class="card sm"><div class="s">Saved</div><div class="v ' + (t.net < 0 ? 'neg' : 'pos') + '">' + money(t.net) + '</div></div></div>' +
      '<h3>Daily spending</h3><div class="card"><svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Daily spending bars">' + bars + '</svg>' +
      '<div class="axis"><span>1</span><span>' + daily.length + '</span></div></div>' +
      '<h3>By category</h3><div class="card">' + catHtml + '</div>';
  }

  function renderBudgets() {
    var ym = monthOf(todayStr());
    var status = budgetStatus(state, ym);
    var have = {}; status.forEach(function (r) { have[r.cat] = true; });
    var list = status.length ? status.map(function (r) {
      var cls = r.pct >= 100 ? 'over' : r.pct >= 80 ? 'warn' : '';
      return '<div class="bar"><div class="bl"><span>' + esc(r.cat) + '</span><span>' + money(r.spent) + ' / ' + money(r.limit) + ' (' + r.pct + '%)</span></div>' +
        '<div class="track"><div class="fill ' + cls + '" style="width:' + Math.min(100, r.pct) + '%"></div></div>' +
        '<button class="link" data-delbudget="' + esc(r.cat) + '">Remove</button></div>';
    }).join('') : '<p class="empty">No budgets yet. Add one below.</p>';
    var opts = state.cats.expense.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    return '<h3>' + monthLabel(ym) + ' budgets</h3><div class="card">' + list + '</div>' +
      '<h3>Set a monthly limit</h3><form id="budgetForm" class="card form"><label>Category<select id="bCat">' + opts + '</select></label>' +
      '<label>Monthly limit (₹)<input id="bLimit" inputmode="decimal" placeholder="e.g. 5000" required></label><button class="primary">Save budget</button></form>';
  }

  function renderAccounts() {
    var b = balances(state);
    var rows = state.accounts.map(function (a) {
      return '<div class="accedit"><label>Name<input data-accname="' + a.id + '" value="' + esc(a.name) + '" maxlength="40"></label>' +
        '<label>Opening balance (₹)<input data-accopen="' + a.id + '" inputmode="decimal" value="' + a.opening + '"></label>' +
        '<div class="s">Current balance: <b>' + money(b[a.id]) + '</b></div></div>';
    }).join('');
    return '<h3>Your 5 bank accounts</h3><p class="hint">Rename each account and enter today\'s balance as the opening balance. Every transaction after that updates it.</p>' +
      '<div class="card">' + rows + '</div>' +
      '<h3>Data</h3><div class="card form"><button class="secondary" id="expCsv">Export CSV (Excel / Power BI)</button>' +
      '<button class="secondary" id="expJson">Backup (JSON)</button>' +
      '<label class="file">Restore backup<input type="file" id="impJson" accept="application/json,.json"></label>' +
      '<button class="danger" id="reset">Erase all data</button>' +
      '<p class="hint">Data stays on this device only. Back up regularly — clearing browser data erases it.</p></div>';
  }

  function render() {
    var map = { home: renderHome, history: renderHistory, summary: renderSummary, budgets: renderBudgets, accounts: renderAccounts };
    $('view').innerHTML = map[ui.tab]();
    Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (b) {
      b.classList.toggle('on', b.dataset.tab === ui.tab);
      b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false');
    });
    window.scrollTo(0, 0);
  }

  function toast(msg, kind) {
    var el = $('toast');
    el.textContent = msg; el.className = 'show ' + (kind || '');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.className = ''; }, 3500);
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* Add sheet */
  function openSheet() {
    $('sheet').classList.add('open'); $('scrim').classList.add('open');
    fillSheet();
    setTimeout(function () { $('fAmount').focus(); }, 50);
  }
  function closeSheet() { $('sheet').classList.remove('open'); $('scrim').classList.remove('open'); }
  function fillSheet() {
    var t = ui.addType;
    Array.prototype.forEach.call(document.querySelectorAll('#seg button'), function (b) { b.classList.toggle('on', b.dataset.type === t); });
    var accOpts = state.accounts.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join('');
    $('fAcc').innerHTML = accOpts;
    $('fTo').innerHTML = accOpts;
    if (state.accounts.length > 1) $('fTo').selectedIndex = 1;
    $('rowTo').hidden = t !== 'transfer';
    $('rowCat').hidden = t === 'transfer';
    $('lblAcc').firstChild.nodeValue = t === 'transfer' ? 'From account' : 'Account';
    var cats = t === 'income' ? state.cats.income : state.cats.expense;
    $('fCat').innerHTML = cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    if (!$('fDate').value) $('fDate').value = todayStr();
  }

  function onSave(e) {
    e.preventDefault();
    var input = { type: ui.addType, amount: $('fAmount').value.replace(/,/g, ''), acc: $('fAcc').value, to: $('fTo').value,
      cat: $('fCat').value, date: $('fDate').value, note: $('fNote').value };
    var r = addTx(state, input);
    if (!r.ok) { toast(r.error, 'bad'); return; }
    save();
    $('fAmount').value = ''; $('fNote').value = '';
    closeSheet(); render();
    if (r.tx.type === 'expense') {
      var ym = monthOf(r.tx.date);
      var hit = budgetStatus(state, ym).filter(function (x) { return x.cat === r.tx.cat; })[0];
      if (hit && hit.pct >= 100) toast('Over budget: ' + hit.cat + ' is at ' + hit.pct + '%', 'bad');
      else if (hit && hit.pct >= 80) toast('Heads up: ' + hit.cat + ' is at ' + hit.pct + '% of budget', 'warn');
      else toast('Saved');
    } else toast('Saved');
  }

  function init() {
    $('nav').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]'); if (!b) return;
      ui.tab = b.dataset.tab; render();
    });
    $('fab').addEventListener('click', openSheet);
    $('scrim').addEventListener('click', closeSheet);
    $('close').addEventListener('click', closeSheet);
    $('seg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-type]'); if (!b) return;
      ui.addType = b.dataset.type; fillSheet();
    });
    $('addForm').addEventListener('submit', onSave);

    $('view').addEventListener('click', function (e) {
      var t = e.target;
      var m = t.closest('[data-month]');
      if (m) { ui.month = shiftMonth(ui.month, +m.dataset.month); render(); return; }
      var d = t.closest('[data-del]');
      if (d) {
        if (confirm('Delete this transaction?')) {
          state.tx = state.tx.filter(function (x) { return x.id !== d.dataset.del; }); save(); render();
        }
        return;
      }
      var db = t.closest('[data-delbudget]');
      if (db) { delete state.budgets[db.dataset.delbudget]; save(); render(); return; }
      if (t.id === 'expCsv') download('finance-' + todayStr() + '.csv', toCSV(state), 'text/csv');
      if (t.id === 'expJson') download('finance-backup-' + todayStr() + '.json', JSON.stringify(state, null, 2), 'application/json');
      if (t.id === 'reset' && confirm('Erase ALL transactions and settings on this device? This cannot be undone.')) {
        state = defaultState(); save(); render(); toast('All data erased');
      }
    });
    $('view').addEventListener('submit', function (e) {
      if (e.target.id !== 'budgetForm') return;
      e.preventDefault();
      var v = parseFloat($('bLimit').value.replace(/,/g, ''));
      if (!(v > 0)) { toast('Enter a limit greater than 0', 'bad'); return; }
      state.budgets[$('bCat').value] = round2(v); save(); render(); toast('Budget saved');
    });
    $('view').addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.accname) {
        var a = state.accounts.filter(function (x) { return x.id === t.dataset.accname; })[0];
        a.name = t.value.trim() || a.name; save(); render();
      } else if (t.dataset.accopen) {
        var a2 = state.accounts.filter(function (x) { return x.id === t.dataset.accopen; })[0];
        var v = parseFloat(String(t.value).replace(/,/g, ''));
        a2.opening = isFinite(v) ? round2(v) : 0; save(); render();
      } else if (t.id === 'impJson' && t.files[0]) {
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var s = validateImport(JSON.parse(rd.result));
            if (!s) throw new Error('bad');
            if (confirm('Replace current data with this backup?')) { state = s; save(); render(); toast('Backup restored'); }
          } catch (err) { toast('That file is not a valid backup', 'bad'); }
        };
        rd.readAsText(t.files[0]);
      }
    });

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline cache is optional */ });
    }
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
