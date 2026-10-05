/* Voice-phrase parser and bank-SMS parser. Pure functions, no DOM. */
(function (root) {
  'use strict';

  var CAT_WORDS = {
    Food: ['food', 'lunch', 'dinner', 'breakfast', 'tiffin', 'tea', 'coffee', 'snack', 'snacks', 'biryani', 'restaurant', 'swiggy', 'zomato', 'hotel', 'భోజనం', 'టిఫిన్', 'టీ', 'కాఫీ', 'హోటల్', 'తిండి'],
    Groceries: ['grocery', 'groceries', 'vegetables', 'veggies', 'milk', 'kirana', 'supermarket', 'bigbasket', 'blinkit', 'zepto', 'dmart', 'కూరగాయలు', 'పాలు', 'కిరాణా', 'సరుకులు'],
    Transport: ['petrol', 'diesel', 'fuel', 'bus', 'auto', 'cab', 'uber', 'ola', 'rapido', 'metro', 'train', 'irctc', 'ticket', 'parking', 'toll', 'పెట్రోల్', 'డీజిల్', 'బస్సు', 'బస్', 'ఆటో', 'ప్రయాణం'],
    Rent: ['rent', 'అద్దె'],
    Bills: ['bill', 'electricity', 'current', 'recharge', 'wifi', 'internet', 'broadband', 'water', 'gas', 'cylinder', 'dth', 'emi', 'insurance', 'బిల్లు', 'బిల్', 'కరెంట్', 'రీచార్జ్', 'గ్యాస్'],
    Shopping: ['shopping', 'clothes', 'amazon', 'flipkart', 'myntra', 'shirt', 'shoes', 'mall', 'షాపింగ్', 'బట్టలు'],
    Health: ['medicine', 'medicines', 'doctor', 'hospital', 'pharmacy', 'medical', 'clinic', 'apollo', 'మందులు', 'డాక్టర్', 'ఆసుపత్రి'],
    Entertainment: ['movie', 'cinema', 'netflix', 'hotstar', 'spotify', 'game', 'party', 'సినిమా'],
    Education: ['fees', 'fee', 'course', 'book', 'books', 'tuition', 'college', 'exam', 'ఫీజు', 'పుస్తకాలు']
  };
  var INCOME_CAT_WORDS = {
    Salary: ['salary', 'payroll', 'జీతం'],
    Freelance: ['freelance', 'project', 'client'],
    Interest: ['interest', 'వడ్డీ'],
    Gift: ['gift', 'బహుమతి']
  };

  function hasWord(text, w) {
    if (/[^\x00-\x7F]/.test(w)) return text.indexOf(w) >= 0; // Telugu etc.: substring
    return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(text);
  }
  function guessCategory(text, kind) {
    var map = kind === 'income' ? INCOME_CAT_WORDS : CAT_WORDS, t = String(text || '').toLowerCase();
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      for (var j = 0; j < map[keys[i]].length; j++) if (hasWord(t, map[keys[i]][j])) return keys[i];
    }
    return null;
  }

  /* ---------------- voice ---------------- */
  var MULT = { k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7 };
  function parseSpokenAmount(text) {
    var s = String(text).toLowerCase().replace(/(\d),(?=\d)/g, '$1');
    var m = s.match(/(\d+(?:\.\d+)?)(?:\s*(k|thousand|lakhs?|lacs?|crores?)(?![a-z]))?/);
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * (m[2] ? MULT[m[2]] : 1) * 100) / 100;
  }
  function tokens(name) {
    return String(name).toLowerCase().split(/[\s\-_.]+/).filter(function (w) { return w.length >= 3 || /[^\x00-\x7F]/.test(w); });
  }
  function findEntities(text, items) { // items: [{id,name}] → [{id, pos}] sorted by position
    var t = text.toLowerCase(), out = [];
    items.forEach(function (it) {
      var best = -1;
      var full = it.name.toLowerCase();
      if (full.length >= 2 && t.indexOf(full) >= 0) best = t.indexOf(full);
      else tokens(it.name).forEach(function (w) {
        if (/^(bank|account|savings|current|ac|a\/c)$/.test(w)) return;
        var re = /[^\x00-\x7F]/.test(w) ? t.indexOf(w) : (function () { var mm = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').exec(t); return mm ? mm.index + mm[1].length : -1; })();
        if (re >= 0 && (best < 0 || re < best)) best = re;
      });
      if (best >= 0) out.push({ id: it.id, pos: best });
    });
    return out.sort(function (a, b) { return a.pos - b.pos; });
  }

  function parseVoice(text, state) {
    var raw = String(text || '').trim();
    var t = raw.toLowerCase();
    var res = { type: 'expense', amount: parseSpokenAmount(raw), cat: null, acc: null, to: null, person: null, note: raw.slice(0, 120) };

    if (/gave back to me|paid me back|returned (it )?to me|returned me|repaid me|received back|తిరిగి ఇచ్చాడు|తిరిగి ఇచ్చింది|తిరిగి ఇచ్చారు/.test(t)) res.type = 'received';
    else if (/paid back|repaid|returned to|gave back|తిరిగి ఇచ్చాను/.test(t)) res.type = 'paidback';
    else if (/\b(gave|given|lent|lend|loaned)\b|ఇచ్చాను/.test(t)) res.type = 'given';
    else if (/\b(borrowed|borrow)\b|took from|taken from|తీసుకున్నాను|అప్పు తీసుకున్నా/.test(t)) res.type = 'taken';
    else if (/\btransfer(red)?\b|బదిలీ/.test(t)) res.type = 'transfer';
    else if (/\b(received|got|earned|salary|income|credited|deposit(ed)?|bonus|refund)\b|జీతం|ఆదాయం|వచ్చాయి|వచ్చింది|అందింది/.test(t)) res.type = 'income';

    var accs = state.accounts.map(function (a) { return { id: a.id, name: a.name }; });
    var found = findEntities(t, accs);
    var cashWord = /\bcash\b|నగదు|క్యాష్/.test(t);
    if (cashWord) {
      var cashAcc = state.accounts.filter(function (a) { return a.type === 'cash'; })[0];
      if (cashAcc && !found.some(function (f) { return f.id === cashAcc.id; })) found.push({ id: cashAcc.id, pos: t.search(/cash|నగదు|క్యాష్/) });
      found.sort(function (a, b) { return a.pos - b.pos; });
    }
    if (found.length) { res.acc = found[0].id; if (res.type === 'transfer' && found[1]) res.to = found[1].id; }

    var pf = findEntities(t, state.people.map(function (p) { return { id: p.id, name: p.name }; }));
    if (pf.length) res.person = pf[0].id;

    if (res.type === 'expense') res.cat = guessCategory(t, 'expense');
    if (res.type === 'income') res.cat = guessCategory(t, 'income') || 'Other';
    if (res.type === 'expense' && !res.cat) res.cat = 'Other';
    return res;
  }

  /* ---------------- bank SMS ---------------- */
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return 'h' + (h >>> 0).toString(36); }

  function parseSmsDate(s, today) {
    var m = s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/);
    var d, mo, y;
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else {
      m = s.match(/\b(\d{1,2})[-\/ ]?([A-Za-z]{3})[a-z]*[-\/ ,]*(\d{2,4})\b/);
      if (m && MONTHS[m[2].toLowerCase()]) { d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3]; }
      else return today;
    }
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return today;
    var dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1) return today;
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }

  function parseOneSms(msg, today) {
    var s = msg.replace(/\s+/g, ' ').trim();
    if (!s || /\b(otp|one time password|verification code)\b/i.test(s)) return null;
    var amt = s.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)/i) || s.match(/(?:debited|credited)\s+(?:by|for|with)\s+([\d,]+(?:\.\d+)?)/i);
    if (!amt) return null;
    var amount = parseFloat(amt[1].replace(/,/g, ''));
    if (!(amount > 0)) return null;
    var dm = s.search(/\b(debited|debit|spent|withdrawn|purchase|paid|sent|dr)\b/i);
    var cm = s.search(/\b(credited|credit|received|deposited|cr)\b/i);
    if (dm < 0 && cm < 0) return null;
    if (/will be (?:debited|credited)|is due|due on|payment request|collect request|requested money/i.test(s)) return null;
    var type = dm >= 0 && (cm < 0 || dm < cm) ? 'expense' : 'income';
    var l4 = s.match(/(?:a\/c|ac|acct|account|card)[^\d]{0,14}(?:x+|\*+)?\s*(\d{4})\b/i) || s.match(/(?:x{2,}|\*{2,})(\d{3,4})\b/i);
    var ref = s.match(/(?:ref(?:erence)?(?:\s*no)?\.?|utr|rrn|txn(?:\s*id)?)[\s:.\-#]*([A-Za-z0-9]{6,})/i);
    var merchant = '';
    var mm = s.match(/(?:\bvpa\s+|\bto\s+|\bat\s+|\btowards\s+|\binfo[:\-]\s*|\bfrom\s+)([A-Za-z0-9@._&\- ]{2,40}?)(?=\s+(?:on|ref\w*|upi|via|using|utr|avl|bal|not|if|call|is|has|was)\b|[.,;(]|$)/i);
    if (mm) merchant = mm[1].trim().replace(/^vpa\s+/i, '').replace(/@.*$/, '').trim();
    if (/^(your|a\/c|ac|account|card|hdfc|sbi|icici|axis)\b/i.test(merchant) || /^\d+$/.test(merchant)) merchant = '';
    var note = merchant ? merchant.slice(0, 50) : 'Bank SMS';
    return {
      type: type, amount: amount, date: parseSmsDate(s, today), last4: l4 ? l4[1].slice(-4) : '',
      note: note, cat: guessCategory(merchant + ' ' + s, type === 'income' ? 'income' : 'expense') || (type === 'income' ? 'Other' : 'Other'),
      key: ref ? 'ref:' + ref[1].toUpperCase() : hash(s.toLowerCase()), raw: s.slice(0, 300)
    };
  }

  /* Split pasted text into messages and parse each. Returns array of detected transactions. */
  function parseSms(text, today) {
    var chunks = String(text || '').split(/\n\s*\n+/);
    if (chunks.length === 1) { // one message per line?
      var lines = chunks[0].split(/\n/).filter(function (l) { return l.trim(); });
      if (lines.length > 1 && lines.every(function (l) { return /(?:rs\.?|inr|₹)\s*[\d,]/i.test(l); })) chunks = lines;
    }
    var out = [], seen = {};
    chunks.forEach(function (c) {
      var r = parseOneSms(c, today);
      if (r && !seen[r.key]) { seen[r.key] = 1; out.push(r); }
    });
    return out;
  }

  function matchAccountByLast4(state, last4) {
    if (!last4) return null;
    return state.accounts.filter(function (a) { return a.last4 && a.last4 === last4; })[0] || null;
  }

  var Parsers = { guessCategory: guessCategory, parseSpokenAmount: parseSpokenAmount, parseVoice: parseVoice, parseSms: parseSms, parseOneSms: parseOneSms, matchAccountByLast4: matchAccountByLast4 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Parsers;
  else root.FT = Object.assign(root.FT || {}, Parsers);
})(typeof window !== 'undefined' ? window : globalThis);
