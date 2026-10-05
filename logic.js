/* Daily Finance Tracker — pure logic (no DOM). Works in browser (window.FT) and Node (module.exports). */
(function (root) {
  'use strict';

  var DEFAULT_CATS = {
    expense: ['Food', 'Groceries', 'Transport', 'Rent', 'Bills', 'Shopping', 'Health', 'Entertainment', 'Education', 'Other'],
    income: ['Salary', 'Freelance', 'Interest', 'Gift', 'Other']
  };
  var PEOPLE_TYPES = ['given', 'taken', 'received', 'paidback'];
  var TYPES = ['expense', 'income', 'transfer'].concat(PEOPLE_TYPES);
  var DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];
  var REPEATS = ['once', 'weekly', 'monthly', 'yearly'];

  /* ---------- helpers ---------- */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function num(v) { return parseFloat(String(v == null ? '' : v).replace(/[,\s₹]/g, '')); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    var p = s.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
  }
  function parseDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return todayStr(d); }
  function daysBetween(a, b) { // b - a in whole days
    var A = parseDate(a), B = parseDate(b);
    return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000);
  }
  function monthOf(s) { return s.slice(0, 7); }
  function shiftMonth(ym, n) {
    var p = ym.split('-').map(Number), d = new Date(p[0], p[1] - 1 + n, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }
  function daysInMonth(ym) { var p = ym.split('-').map(Number); return new Date(p[0], p[1], 0).getDate(); }
  function addMonthsDate(s, n, dom) {
    var p = s.split('-').map(Number), y = p[0], m = p[1] - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(y, m + 1, 0).getDate();
    return y + '-' + pad2(m + 1) + '-' + pad2(Math.min(dom || p[2], last));
  }
  function byDateAsc(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }
  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }

  /* ---------- state ---------- */
  function defaultState() {
    var accounts = [{ id: 'cash', name: 'Cash', type: 'cash', opening: 0, last4: '' }];
    for (var i = 1; i <= 5; i++) accounts.push({ id: 'a' + i, name: 'Bank ' + i, type: 'bank', opening: 0, last4: '' });
    return {
      v: 2, accounts: accounts, tx: [], budgets: {}, cats: clone(DEFAULT_CATS),
      people: [], bills: [], closings: [], notes: [],
      members: [{ id: 'm1', name: 'Me' }],
      settings: { lang: 'en', remindDays: 3, activeMember: 'm1', notifiedOn: '' }
    };
  }

  /* Accepts v1 or v2 data (backup file or localStorage). Returns a clean v2 state or null. */
  function migrate(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.accounts) || !Array.isArray(obj.tx)) return null;
    var s = defaultState();
    s.accounts = obj.accounts.slice(0, 15).map(function (a, i) {
      return {
        id: String(a.id || 'a' + (i + 1)), name: String(a.name || 'Account ' + (i + 1)).slice(0, 40),
        type: a.type === 'cash' ? 'cash' : (a.id === 'cash' ? 'cash' : 'bank'),
        opening: Number(a.opening) || 0, last4: String(a.last4 || '').replace(/\D/g, '').slice(-4)
      };
    });
    if (!s.accounts.some(function (a) { return a.type === 'cash'; })) {
      var cid = 'cash';
      while (s.accounts.some(function (a) { return a.id === cid; })) cid += '_';
      s.accounts.unshift({ id: cid, name: 'Cash', type: 'cash', opening: 0, last4: '' });
    }
    if (Array.isArray(obj.members) && obj.members.length) {
      s.members = obj.members.slice(0, 10).map(function (m, i) { return { id: String(m.id || 'm' + (i + 1)), name: String(m.name || 'Member').slice(0, 30) }; });
    }
    var st = obj.settings || {};
    s.settings.lang = st.lang === 'te' ? 'te' : 'en';
    s.settings.remindDays = isFinite(st.remindDays) ? Math.max(0, Math.min(30, Number(st.remindDays))) : 3;
    s.settings.activeMember = s.members.some(function (m) { return m.id === st.activeMember; }) ? st.activeMember : s.members[0].id;
    s.settings.notifiedOn = String(st.notifiedOn || '');
    if (Array.isArray(obj.people)) {
      s.people = obj.people.slice(0, 500).map(function (p) { return { id: String(p.id || uid()), name: String(p.name || '?').slice(0, 40), phone: String(p.phone || '').slice(0, 20) }; });
    }
    var memberIds = s.members.map(function (m) { return m.id; });
    s.tx = obj.tx.filter(function (t) {
      return t && isFinite(t.amount) && Number(t.amount) > 0 && validDate(t.date) && TYPES.indexOf(t.type) >= 0;
    }).map(function (t) {
      var o = { id: String(t.id || uid()), type: t.type, amount: round2(Number(t.amount)), acc: String(t.acc), date: t.date, note: String(t.note || '').slice(0, 120), by: memberIds.indexOf(t.by) >= 0 ? t.by : s.members[0].id };
      if (t.type === 'transfer') o.to = String(t.to);
      else if (PEOPLE_TYPES.indexOf(t.type) >= 0) o.p = String(t.p);
      else o.cat = String(t.cat || 'Other');
      if (t.r) o.r = true;
      if (t.sms) o.sms = String(t.sms);
      return o;
    });
    if (obj.budgets && typeof obj.budgets === 'object') {
      Object.keys(obj.budgets).forEach(function (k) { var v = Number(obj.budgets[k]); if (v > 0) s.budgets[k] = v; });
    }
    if (obj.cats && Array.isArray(obj.cats.expense) && Array.isArray(obj.cats.income)) {
      s.cats = { expense: obj.cats.expense.map(String).slice(0, 40), income: obj.cats.income.map(String).slice(0, 40) };
    }
    if (Array.isArray(obj.bills)) {
      s.bills = obj.bills.filter(function (b) { return b && validDate(b.due) && Number(b.amount) > 0; }).map(function (b) {
        return { id: String(b.id || uid()), name: String(b.name || 'Bill').slice(0, 40), amount: round2(Number(b.amount)), due: b.due,
          dom: Number(b.dom) || Number(b.due.slice(8, 10)), repeat: REPEATS.indexOf(b.repeat) >= 0 ? b.repeat : 'monthly',
          cat: String(b.cat || 'Bills'), remind: isFinite(b.remind) ? Number(b.remind) : 3 };
      });
    }
    if (Array.isArray(obj.closings)) {
      s.closings = obj.closings.filter(function (c) { return c && validDate(c.date); }).map(function (c) {
        return { id: String(c.id || uid()), date: c.date, acc: String(c.acc), expected: Number(c.expected) || 0, counted: Number(c.counted) || 0,
          diff: Number(c.diff) || 0, counts: c.counts && typeof c.counts === 'object' ? c.counts : {}, note: String(c.note || '').slice(0, 120), adjusted: !!c.adjusted };
      });
    }
    if (Array.isArray(obj.notes)) {
      s.notes = obj.notes.slice(0, 500).map(function (n) {
        return { id: String(n.id || uid()), text: String(n.text || '').slice(0, 2000), pinned: !!n.pinned, at: String(n.at || '') };
      });
    }
    return s;
  }

  /* ---------- transactions ---------- */
  function buildTx(state, input) {
    var amount = round2(num(input.amount));
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'err_amount' };
    if (!validDate(input.date)) return { ok: false, error: 'err_date' };
    var accIds = state.accounts.map(function (a) { return a.id; });
    if (accIds.indexOf(input.acc) < 0) return { ok: false, error: 'err_account' };
    if (TYPES.indexOf(input.type) < 0) return { ok: false, error: 'err_type' };
    var by = state.members.some(function (m) { return m.id === input.by; }) ? input.by : state.settings.activeMember;
    var tx = { id: input.id || uid(), type: input.type, amount: amount, acc: input.acc, date: input.date, note: String(input.note || '').trim().slice(0, 120), by: by };
    if (input.type === 'transfer') {
      if (accIds.indexOf(input.to) < 0) return { ok: false, error: 'err_to' };
      if (input.to === input.acc) return { ok: false, error: 'err_same' };
      tx.to = input.to;
    } else if (PEOPLE_TYPES.indexOf(input.type) >= 0) {
      if (!state.people.some(function (p) { return p.id === input.person; })) return { ok: false, error: 'err_person' };
      tx.p = input.person;
    } else {
      tx.cat = input.cat || 'Other';
    }
    if (input.r) tx.r = true;
    if (input.sms) tx.sms = String(input.sms);
    return { ok: true, tx: tx };
  }
  function addTx(state, input) {
    var r = buildTx(state, input);
    if (r.ok) state.tx.push(r.tx);
    return r;
  }
  function updateTx(state, id, input) {
    var idx = -1;
    state.tx.forEach(function (t, i) { if (t.id === id) idx = i; });
    if (idx < 0) return { ok: false, error: 'err_type' };
    var old = state.tx[idx], inp = clone(input);
    inp.id = id;
    if (inp.r === undefined) inp.r = old.r;
    if (inp.sms === undefined) inp.sms = old.sms;
    var r = buildTx(state, inp);
    if (r.ok) state.tx[idx] = r.tx;
    return r;
  }
  function deleteTx(state, id) { state.tx = state.tx.filter(function (t) { return t.id !== id; }); }

  /* effect of a tx on one account: returns [{acc, delta}] */
  function effects(t) {
    switch (t.type) {
      case 'income': case 'received': case 'taken': return [{ acc: t.acc, d: t.amount }];
      case 'expense': case 'given': case 'paidback': return [{ acc: t.acc, d: -t.amount }];
      case 'transfer': return [{ acc: t.acc, d: -t.amount }, { acc: t.to, d: t.amount }];
    }
    return [];
  }

  function balances(state, upTo) {
    var b = {};
    state.accounts.forEach(function (a) { b[a.id] = Number(a.opening) || 0; });
    state.tx.forEach(function (t) {
      if (upTo && t.date > upTo) return;
      effects(t).forEach(function (e) { b[e.acc] = (b[e.acc] || 0) + e.d; });
    });
    Object.keys(b).forEach(function (k) { b[k] = round2(b[k]); });
    return b;
  }
  function sumByType(state, type) {
    var b = balances(state), s = 0;
    state.accounts.forEach(function (a) { if (a.type === type) s += b[a.id]; });
    return round2(s);
  }
  function totalBalance(state) { return round2(sumByType(state, 'cash') + sumByType(state, 'bank')); }

  function txInMonth(state, ym) { return state.tx.filter(function (t) { return monthOf(t.date) === ym; }); }
  function totals(list) {
    var inc = 0, exp = 0;
    list.forEach(function (t) { if (t.type === 'income') inc += t.amount; else if (t.type === 'expense') exp += t.amount; });
    return { income: round2(inc), expense: round2(exp), net: round2(inc - exp) };
  }
  function byCategory(list) {
    var m = {};
    list.forEach(function (t) { if (t.type === 'expense') m[t.cat] = (m[t.cat] || 0) + t.amount; });
    return Object.keys(m).map(function (c) { return { cat: c, amount: round2(m[c]) }; }).sort(function (a, b) { return b.amount - a.amount; });
  }
  function dailyExpense(list, ym) {
    var out = [], n = daysInMonth(ym);
    for (var i = 0; i < n; i++) out.push(0);
    list.forEach(function (t) { if (t.type === 'expense') out[parseInt(t.date.slice(8, 10), 10) - 1] += t.amount; });
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

  /* ---------- search / filter ---------- */
  function filterTx(state, f) {
    f = f || {};
    var q = (f.q || '').trim().toLowerCase();
    var accName = {}, pName = {}, mName = {};
    state.accounts.forEach(function (a) { accName[a.id] = a.name; });
    state.people.forEach(function (p) { pName[p.id] = p.name; });
    state.members.forEach(function (m) { mName[m.id] = m.name; });
    var min = f.min !== '' && f.min != null ? num(f.min) : null, max = f.max !== '' && f.max != null ? num(f.max) : null;
    return state.tx.filter(function (t) {
      if (f.type && f.type !== 'all') {
        if (f.type === 'people') { if (PEOPLE_TYPES.indexOf(t.type) < 0) return false; }
        else if (t.type !== f.type) return false;
      }
      if (f.acc && f.acc !== 'all' && t.acc !== f.acc && t.to !== f.acc) return false;
      if (f.cat && f.cat !== 'all' && t.cat !== f.cat) return false;
      if (f.by && f.by !== 'all' && t.by !== f.by) return false;
      if (f.person && f.person !== 'all' && t.p !== f.person) return false;
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
      if (f.ym && monthOf(t.date) !== f.ym) return false;
      if (min !== null && isFinite(min) && t.amount < min) return false;
      if (max !== null && isFinite(max) && t.amount > max) return false;
      if (f.receipt && !t.r) return false;
      if (q) {
        var hay = [t.note, t.cat, t.type, t.date, String(t.amount), accName[t.acc], t.to ? accName[t.to] : '', t.p ? pName[t.p] : '', mName[t.by]].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  /* ---------- people ledger ---------- */
  function normalizePhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 10) return '91' + d;
    if (d.length === 11 && d.charAt(0) === '0') return '91' + d.slice(1);
    return d.length >= 8 && d.length <= 15 ? d : '';
  }
  function addPerson(state, input) {
    var name = String(input.name || '').trim().slice(0, 40);
    if (!name) return { ok: false, error: 'err_name' };
    var exist = state.people.filter(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })[0];
    if (exist) return { ok: false, error: 'err_dupe', person: exist };
    var person = { id: uid(), name: name, phone: String(input.phone || '').trim().slice(0, 20) };
    state.people.push(person);
    return { ok: true, person: person };
  }
  function personSign(type) { return type === 'given' || type === 'paidback' ? 1 : type === 'received' || type === 'taken' ? -1 : 0; }
  /* positive = they owe me, negative = I owe them */
  function personBalance(state, pid) {
    var s = 0;
    state.tx.forEach(function (t) { if (t.p === pid) s += personSign(t.type) * t.amount; });
    return round2(s);
  }
  function peopleSummary(state) {
    var rows = state.people.map(function (p) { return { person: p, balance: personBalance(state, p.id) }; });
    var recv = 0, pay = 0;
    rows.forEach(function (r) { if (r.balance > 0) recv += r.balance; else pay += -r.balance; });
    rows.sort(function (a, b) { return Math.abs(b.balance) - Math.abs(a.balance); });
    return { rows: rows, toReceive: round2(recv), toPay: round2(pay) };
  }
  function personLedger(state, pid) {
    var list = state.tx.map(function (t, i) { return { t: t, i: i }; }).filter(function (x) { return x.t.p === pid; });
    list.sort(function (a, b) { return a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i; });
    var run = 0;
    return list.map(function (x) { run = round2(run + personSign(x.t.type) * x.t.amount); return { tx: x.t, running: run }; });
  }
  function deletePerson(state, pid) {
    if (state.tx.some(function (t) { return t.p === pid; })) return false;
    state.people = state.people.filter(function (p) { return p.id !== pid; });
    return true;
  }
  function inr(n) { return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function reminderText(name, amount, lang, from) {
    var amt = '₹' + inr(amount);
    if (lang === 'te') return 'హాయ్ ' + name + ', చిన్న రిమైండర్: మీ దగ్గర ' + amt + ' బాకీ ఉంది. వీలైనప్పుడు పంపగలరు. ధన్యవాదాలు! 🙏' + (from ? ' - ' + from : '');
    return 'Hi ' + name + ', a gentle reminder: ' + amt + ' is pending with you. Please send it when you can. Thank you! 🙏' + (from ? ' - ' + from : '');
  }
  function whatsappLink(person, amount, lang, from) {
    var ph = normalizePhone(person.phone);
    var text = encodeURIComponent(reminderText(person.name, amount, lang, from));
    return ph ? 'https://wa.me/' + ph + '?text=' + text : 'https://wa.me/?text=' + text;
  }

  /* ---------- bills ---------- */
  function addBill(state, input) {
    var amount = round2(num(input.amount));
    var name = String(input.name || '').trim().slice(0, 40);
    if (!name) return { ok: false, error: 'err_name' };
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'err_amount' };
    if (!validDate(input.due)) return { ok: false, error: 'err_date' };
    var bill = { id: input.id || uid(), name: name, amount: amount, due: input.due, dom: Number(input.due.slice(8, 10)),
      repeat: REPEATS.indexOf(input.repeat) >= 0 ? input.repeat : 'monthly', cat: input.cat || 'Bills',
      remind: isFinite(num(input.remind)) ? Math.max(0, Math.min(30, num(input.remind))) : 3 };
    var idx = -1;
    state.bills.forEach(function (b, i) { if (b.id === bill.id) idx = i; });
    if (idx >= 0) state.bills[idx] = bill; else state.bills.push(bill);
    return { ok: true, bill: bill };
  }
  function billsStatus(state, today) {
    return state.bills.map(function (b) {
      var left = daysBetween(today, b.due);
      return { bill: b, daysLeft: left, status: left < 0 ? 'overdue' : left <= b.remind ? 'soon' : 'upcoming' };
    }).sort(function (a, b) { return a.daysLeft - b.daysLeft; });
  }
  function dueBills(state, today) {
    return billsStatus(state, today).filter(function (x) { return x.status !== 'upcoming'; });
  }
  function nextDue(b) {
    if (b.repeat === 'weekly') return addDays(b.due, 7);
    if (b.repeat === 'monthly') return addMonthsDate(b.due, 1, b.dom);
    if (b.repeat === 'yearly') return addMonthsDate(b.due, 12, b.dom);
    return null;
  }
  function markBillPaid(state, billId, accId, date) {
    var b = state.bills.filter(function (x) { return x.id === billId; })[0];
    if (!b) return { ok: false, error: 'err_type' };
    var r = addTx(state, { type: 'expense', amount: b.amount, acc: accId, date: date, cat: b.cat, note: 'Bill: ' + b.name });
    if (!r.ok) return r;
    var nd = nextDue(b);
    if (nd) b.due = nd; else state.bills = state.bills.filter(function (x) { return x.id !== billId; });
    return r;
  }
  function deleteBill(state, id) { state.bills = state.bills.filter(function (b) { return b.id !== id; }); }

  /* ---------- cash calculator + daily closing ---------- */
  function countTotal(counts) {
    var s = 0;
    DENOMS.forEach(function (d) { var n = parseInt((counts || {})[d], 10); if (n > 0) s += n * d; });
    return s;
  }
  function saveClosing(state, input) {
    if (!validDate(input.date)) return { ok: false, error: 'err_date' };
    if (!state.accounts.some(function (a) { return a.id === input.acc; })) return { ok: false, error: 'err_account' };
    var counts = {};
    DENOMS.forEach(function (d) { var n = parseInt((input.counts || {})[d], 10); if (n > 0) counts[d] = n; });
    var counted = countTotal(counts);
    var expected = balances(state, input.date)[input.acc] || 0;
    var rec = { id: uid(), date: input.date, acc: input.acc, expected: expected, counted: counted, diff: round2(counted - expected),
      counts: counts, note: String(input.note || '').trim().slice(0, 120), adjusted: false };
    state.closings = state.closings.filter(function (c) { return !(c.date === rec.date && c.acc === rec.acc); });
    state.closings.push(rec);
    state.closings.sort(byDateDesc);
    return { ok: true, closing: rec };
  }
  function adjustForClosing(state, closingId) {
    var c = state.closings.filter(function (x) { return x.id === closingId; })[0];
    if (!c || c.adjusted || c.diff === 0) return { ok: false, error: 'err_type' };
    var r = addTx(state, { type: c.diff > 0 ? 'income' : 'expense', amount: Math.abs(c.diff), acc: c.acc, date: c.date, cat: 'Other', note: 'Cash closing adjustment' });
    if (r.ok) c.adjusted = true;
    return r;
  }

  /* ---------- notes ---------- */
  function saveNote(state, input) {
    var text = String(input.text || '').trim().slice(0, 2000);
    if (!text) return { ok: false, error: 'err_text' };
    var n = state.notes.filter(function (x) { return x.id === input.id; })[0];
    if (n) { n.text = text; if (input.pinned !== undefined) n.pinned = !!input.pinned; }
    else { n = { id: uid(), text: text, pinned: !!input.pinned, at: todayStr() }; state.notes.unshift(n); }
    return { ok: true, note: n };
  }
  function deleteNote(state, id) { state.notes = state.notes.filter(function (n) { return n.id !== id; }); }
  function sortedNotes(state) {
    return state.notes.slice().sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); });
  }

  /* ---------- accounts / members ---------- */
  function addAccount(state, input) {
    var name = String(input.name || '').trim().slice(0, 40);
    if (!name) return { ok: false, error: 'err_name' };
    if (state.accounts.length >= 15) return { ok: false, error: 'err_limit' };
    var a = { id: 'a' + uid(), name: name, type: input.type === 'cash' ? 'cash' : 'bank', opening: round2(num(input.opening)) || 0, last4: '' };
    state.accounts.push(a);
    return { ok: true, account: a };
  }
  function deleteAccount(state, id) {
    var used = state.tx.some(function (t) { return t.acc === id || t.to === id; }) || state.closings.some(function (c) { return c.acc === id; });
    var a = state.accounts.filter(function (x) { return x.id === id; })[0];
    if (!a || used) return false;
    var sameType = state.accounts.filter(function (x) { return x.type === a.type; }).length;
    if (a.type === 'cash' && sameType <= 1) return false;
    state.accounts = state.accounts.filter(function (x) { return x.id !== id; });
    return true;
  }
  function addMember(state, name) {
    name = String(name || '').trim().slice(0, 30);
    if (!name) return { ok: false, error: 'err_name' };
    if (state.members.length >= 10) return { ok: false, error: 'err_limit' };
    if (state.members.some(function (m) { return m.name.toLowerCase() === name.toLowerCase(); })) return { ok: false, error: 'err_dupe' };
    var m = { id: 'm' + uid(), name: name };
    state.members.push(m);
    return { ok: true, member: m };
  }

  /* Merge a family member's exported backup into this state. Dedupes by transaction id. */
  function mergeState(state, raw) {
    var inc = migrate(raw);
    if (!inc) return { ok: false, error: 'err_file' };
    var accMap = {}, memMap = {}, perMap = {}, added = 0;
    inc.accounts.forEach(function (a) {
      var ex = state.accounts.filter(function (x) { return x.name.toLowerCase() === a.name.toLowerCase(); })[0];
      if (ex) accMap[a.id] = ex.id;
      else {
        var n = { id: 'a' + uid(), name: a.name, type: a.type, opening: a.opening, last4: a.last4 };
        state.accounts.push(n); accMap[a.id] = n.id;
      }
    });
    inc.members.forEach(function (m) {
      var ex = state.members.filter(function (x) { return x.name.toLowerCase() === m.name.toLowerCase(); })[0];
      if (ex) memMap[m.id] = ex.id;
      else {
        if (state.members.length >= 10) { memMap[m.id] = state.settings.activeMember; return; }
        var n = { id: 'm' + uid(), name: m.name }; state.members.push(n); memMap[m.id] = n.id;
      }
    });
    inc.people.forEach(function (p) {
      var ex = state.people.filter(function (x) { return x.name.toLowerCase() === p.name.toLowerCase(); })[0];
      if (ex) perMap[p.id] = ex.id;
      else { var n = { id: uid(), name: p.name, phone: p.phone }; state.people.push(n); perMap[p.id] = n.id; }
    });
    var have = {};
    state.tx.forEach(function (t) { have[t.id] = true; });
    inc.tx.forEach(function (t) {
      if (have[t.id]) return;
      var o = clone(t);
      o.acc = accMap[t.acc] || t.acc; if (t.to) o.to = accMap[t.to] || t.to;
      if (t.p) o.p = perMap[t.p] || t.p;
      o.by = memMap[t.by] || state.settings.activeMember;
      state.tx.push(o); added++;
    });
    return { ok: true, added: added };
  }

  /* ---------- reports ---------- */
  function monthlySummary(state, list) {
    list = list || state.tx;
    var m = {};
    list.forEach(function (t) {
      var ym = monthOf(t.date);
      m[ym] = m[ym] || { ym: ym, income: 0, expense: 0 };
      if (t.type === 'income') m[ym].income += t.amount; else if (t.type === 'expense') m[ym].expense += t.amount;
    });
    return Object.keys(m).sort().map(function (k) {
      var r = m[k]; r.income = round2(r.income); r.expense = round2(r.expense); r.net = round2(r.income - r.expense);
      r.savingsPct = r.income > 0 ? Math.round((r.net / r.income) * 100) : null; return r;
    });
  }
  function lastMonths(state, n, endYm) {
    var out = [], have = {};
    monthlySummary(state).forEach(function (r) { have[r.ym] = r; });
    for (var i = n - 1; i >= 0; i--) {
      var ym = shiftMonth(endYm, -i);
      out.push(have[ym] || { ym: ym, income: 0, expense: 0, net: 0, savingsPct: null });
    }
    return out;
  }
  function categoryCompare(state, ym) {
    var cur = {}, prev = {};
    byCategory(txInMonth(state, ym)).forEach(function (r) { cur[r.cat] = r.amount; });
    byCategory(txInMonth(state, shiftMonth(ym, -1))).forEach(function (r) { prev[r.cat] = r.amount; });
    var cats = {};
    Object.keys(cur).concat(Object.keys(prev)).forEach(function (c) { cats[c] = 1; });
    return Object.keys(cats).map(function (c) { return { cat: c, cur: cur[c] || 0, prev: prev[c] || 0 }; })
      .sort(function (a, b) { return (b.cur - a.cur) || (b.prev - a.prev); });
  }
  function topExpenses(list, n) {
    return list.filter(function (t) { return t.type === 'expense'; }).sort(function (a, b) { return b.amount - a.amount; }).slice(0, n);
  }
  function weekdayTotals(list) { // Mon..Sun
    var out = [0, 0, 0, 0, 0, 0, 0];
    list.forEach(function (t) { if (t.type === 'expense') out[(parseDate(t.date).getDay() + 6) % 7] += t.amount; });
    return out.map(round2);
  }
  function memberTotals(state, ym) {
    var list = txInMonth(state, ym);
    return state.members.map(function (m) {
      var t = totals(list.filter(function (x) { return x.by === m.id; }));
      return { id: m.id, name: m.name, income: t.income, expense: t.expense };
    });
  }
  function accountFlows(state, ym) {
    var f = {};
    state.accounts.forEach(function (a) { f[a.id] = { id: a.id, name: a.name, type: a.type, inflow: 0, outflow: 0 }; });
    txInMonth(state, ym).forEach(function (t) {
      effects(t).forEach(function (e) { if (!f[e.acc]) return; if (e.d > 0) f[e.acc].inflow += e.d; else f[e.acc].outflow += -e.d; });
    });
    return Object.keys(f).map(function (k) { f[k].inflow = round2(f[k].inflow); f[k].outflow = round2(f[k].outflow); return f[k]; });
  }
  function stats(state, ym, today) {
    var t = totals(txInMonth(state, ym));
    var days = ym === monthOf(today) ? parseInt(today.slice(8, 10), 10) : daysInMonth(ym);
    var cats = byCategory(txInMonth(state, ym));
    return { income: t.income, expense: t.expense, net: t.net, avgDaily: round2(t.expense / Math.max(1, days)),
      savingsPct: t.income > 0 ? Math.round((t.net / t.income) * 100) : null, topCat: cats[0] || null };
  }

  /* ---------- exports ---------- */
  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function lookups(state) {
    var L = { acc: {}, per: {}, mem: {} };
    state.accounts.forEach(function (a) { L.acc[a.id] = a.name; });
    state.people.forEach(function (p) { L.per[p.id] = p.name; });
    state.members.forEach(function (m) { L.mem[m.id] = m.name; });
    return L;
  }
  function txRows(state, list) {
    var L = lookups(state);
    var rows = [['Date', 'Type', 'Amount', 'Account', 'To account', 'Category', 'Person', 'Member', 'Note']];
    list.slice().sort(byDateAsc).forEach(function (t) {
      rows.push([t.date, t.type, t.amount, L.acc[t.acc] || t.acc, t.to ? (L.acc[t.to] || t.to) : '', t.cat || '', t.p ? (L.per[t.p] || '') : '', L.mem[t.by] || '', t.note || '']);
    });
    return rows;
  }
  function toCSV(state, list) {
    return txRows(state, list || state.tx).map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }
  function exportSheets(state, list) {
    list = list || state.tx;
    var b = balances(state);
    var ms = monthlySummary(state, list);
    var catRows = [['Month', 'Category', 'Expense']];
    var months = {};
    list.forEach(function (t) { months[monthOf(t.date)] = 1; });
    Object.keys(months).sort().forEach(function (ym) {
      byCategory(list.filter(function (t) { return monthOf(t.date) === ym; })).forEach(function (r) { catRows.push([ym, r.cat, r.amount]); });
    });
    var acc = [['Account', 'Type', 'Opening balance', 'Current balance']];
    state.accounts.forEach(function (a) { acc.push([a.name, a.type, a.opening, b[a.id]]); });
    var ppl = [['Person', 'Phone', 'Balance', 'Status']];
    peopleSummary(state).rows.forEach(function (r) {
      ppl.push([r.person.name, r.person.phone, Math.abs(r.balance), r.balance > 0 ? 'Owes you' : r.balance < 0 ? 'You owe' : 'Settled']);
    });
    return [
      { name: 'Transactions', rows: txRows(state, list) },
      { name: 'Monthly summary', rows: [['Month', 'Income', 'Expense', 'Net', 'Savings %']].concat(ms.map(function (r) { return [r.ym, r.income, r.expense, r.net, r.savingsPct == null ? '' : r.savingsPct]; })) },
      { name: 'By category', rows: catRows },
      { name: 'Accounts', rows: acc },
      { name: 'People', rows: ppl }
    ];
  }

  var Logic = {
    DEFAULT_CATS: DEFAULT_CATS, TYPES: TYPES, PEOPLE_TYPES: PEOPLE_TYPES, DENOMS: DENOMS, REPEATS: REPEATS,
    round2: round2, num: num, uid: uid, todayStr: todayStr, validDate: validDate, parseDate: parseDate, addDays: addDays, daysBetween: daysBetween,
    monthOf: monthOf, shiftMonth: shiftMonth, daysInMonth: daysInMonth, addMonthsDate: addMonthsDate, byDateAsc: byDateAsc, byDateDesc: byDateDesc,
    defaultState: defaultState, migrate: migrate, buildTx: buildTx, addTx: addTx, updateTx: updateTx, deleteTx: deleteTx, effects: effects,
    balances: balances, sumByType: sumByType, totalBalance: totalBalance, txInMonth: txInMonth, totals: totals, byCategory: byCategory,
    dailyExpense: dailyExpense, budgetStatus: budgetStatus, filterTx: filterTx,
    normalizePhone: normalizePhone, addPerson: addPerson, personBalance: personBalance, peopleSummary: peopleSummary, personLedger: personLedger,
    deletePerson: deletePerson, reminderText: reminderText, whatsappLink: whatsappLink, inr: inr,
    addBill: addBill, billsStatus: billsStatus, dueBills: dueBills, nextDue: nextDue, markBillPaid: markBillPaid, deleteBill: deleteBill,
    countTotal: countTotal, saveClosing: saveClosing, adjustForClosing: adjustForClosing,
    saveNote: saveNote, deleteNote: deleteNote, sortedNotes: sortedNotes,
    addAccount: addAccount, deleteAccount: deleteAccount, addMember: addMember, mergeState: mergeState,
    monthlySummary: monthlySummary, lastMonths: lastMonths, categoryCompare: categoryCompare, topExpenses: topExpenses,
    weekdayTotals: weekdayTotals, memberTotals: memberTotals, accountFlows: accountFlows, stats: stats,
    csvCell: csvCell, txRows: txRows, toCSV: toCSV, exportSheets: exportSheets
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
  else root.FT = Object.assign(root.FT || {}, Logic);
})(typeof window !== 'undefined' ? window : globalThis);
