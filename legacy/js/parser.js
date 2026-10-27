/* Statement parsing, entity extraction and categorisation.
 * Pure functions only — no DOM — so this file also runs under Node for testing. */
(function (root) {
  'use strict';

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    text = text.replace(/^﻿/, '');
    // Sniff delimiter from the first few lines (comma, tab or semicolon).
    const sample = text.slice(0, 4000);
    const delim = ['\t', ';', ','].map(d => [d, sample.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map(r => r.map(s => s.trim()));
  }

  // ---------- Values ----------
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

  // Day-first, as Indian bank statements are. Returns a local-midnight Date or null.
  function parseDate(s) {
    if (!s) return null;
    s = String(s).trim().split(/\s+(?=\d{1,2}:\d{2})/)[0]; // drop time part
    let m, d, mo, y;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2,4})$/))) { d = +m[1]; mo = +m[2] - 1; y = +m[3]; }
    else if ((m = s.match(/^(\d{1,2})[-\/ ]?([A-Za-z]{3,4})[A-Za-z]*[-\/ ,]*(\d{2,4})$/))) {
      d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3];
      if (mo === undefined) return null;
    } else return null;
    if (y < 100) y += 2000;
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo, d);
    return dt.getMonth() === mo ? dt : null;
  }

  function parseAmount(s) {
    if (s == null) return 0;
    s = String(s).replace(/[₹,\s]|INR|Rs\.?/gi, '');
    if (!s || s === '-') return 0;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/dr$/i.test(s)) { neg = true; s = s.slice(0, -2); } else if (/cr$/i.test(s)) s = s.slice(0, -2);
    const n = parseFloat(s);
    return isNaN(n) ? 0 : (neg ? -n : n);
  }

  // ---------- Header detection ----------
  const COLS = {
    sl: [/^s(l|r)\.?\s*no/, /^serial/, /^#$/],
    date: [/^tran(saction)?\.?\s*date/, /^txn\.?\s*date/, /^date$/, /^posting date/],
    particulars: [/particular/, /narration/, /description/, /remarks/, /details$/],
    valueDate: [/^value\s*d(a)?t/],
    tranType: [/^tran(saction)?\.?\s*type/, /^txn type/, /^type$/],
    cheque: [/cheque|chq|ref(erence)?\s*no/],
    withdrawal: [/withdrawal/, /^debit/, /^dr\b/],
    deposit: [/deposit/, /^credit/, /^cr\b/],
    balance: [/balance/],
  };

  function mapHeader(cells) {
    const norm = cells.map(c => c.toLowerCase().replace(/\s+/g, ' ').replace(/[()]/g, '').trim());
    const map = {};
    for (const [key, pats] of Object.entries(COLS)) {
      for (let i = 0; i < norm.length; i++) {
        if (Object.values(map).includes(i)) continue;
        if (pats.some(p => p.test(norm[i]))) { map[key] = i; break; }
      }
    }
    return map;
  }

  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const map = mapHeader(rows[i]);
      if (map.date != null && map.particulars != null && (map.withdrawal != null || map.deposit != null)) return { index: i, map };
    }
    return null;
  }

  // ---------- Channel ----------
  function detectChannel(U, tranType, cheque) {
    if (/\bUPI|UPIOUT|UPIIN|\bUPI\//.test(U)) return 'UPI';
    if (/\bIMPS/.test(U)) return 'IMPS';
    if (/\bNEFT/.test(U)) return 'NEFT';
    if (/\bRTGS/.test(U)) return 'RTGS';
    if (/\bATM\b|ATW|NWD|CASH\s*WDL|CASH WITHDRAWAL|\bAWB\b/.test(U)) return 'ATM / Cash';
    if (/\b(NACH|ACH|ECS|SI)\b|MANDATE|AUTOPAY|\bSTANDING INSTR/.test(U)) return 'Auto-debit';
    if (/\bPOS\b|\bPCD\b|\bVPS\b|\bIPS\b|DEBIT CARD|\bVIN\/|ECOM|\bMPS\b/.test(U)) return 'Card';
    if (/\bINT(EREST)?\b.*\b(PD|PAID|CR|CREDIT)\b|INTEREST|\bSB INT/.test(U)) return 'Interest';
    if (/CHRG|CHARGES|\bFEE\b|\bGST\b|AMC|SMS ALERT|PENAL/.test(U)) return 'Bank charges';
    if (/\bCLG\b|CLEARING|\bCHQ\b|CHEQUE/.test(U) || (cheque && /\d{4,}/.test(cheque) && !/UPI|NEFT|IMPS/.test(U))) return 'Cheque';
    if (/^CASH|\bCASH DEP|BY CASH/.test(U) || /^CASH$/i.test(tranType || '')) return 'Cash';
    if (/\bBIL\/|BILLPAY|BILL PAY|\bBBPS/.test(U)) return 'Bill pay';
    if (/\b(TRF|TRANSFER|TO A\/C|FROM A\/C|BY TRANSFER|TO TRANSFER|INB|NETBANKING|MOB)\b/.test(U) || /^TFR|TRF/i.test(tranType || '')) return 'Account transfer';
    return 'Other';
  }

  // ---------- Merchant dictionary: [regex on uppercased particulars, display name, category] ----------
  const MERCHANTS = [
    [/SWIGGY/, 'Swiggy', 'Food & dining'], [/ZOMATO/, 'Zomato', 'Food & dining'], [/DOMINO/, "Domino's", 'Food & dining'],
    [/MCDONALD/, "McDonald's", 'Food & dining'], [/STARBUCKS/, 'Starbucks', 'Food & dining'], [/KFC\b/, 'KFC', 'Food & dining'],
    [/EATCLUB|BOX8|FAASOS|REBEL FOODS/, 'Rebel Foods', 'Food & dining'],
    [/BLINKIT|GROFERS/, 'Blinkit', 'Groceries'], [/ZEPTO/, 'Zepto', 'Groceries'], [/BIGBASKET|BIG BASKET|INNOVATIVE RETAIL/, 'BigBasket', 'Groceries'],
    [/DMART|AVENUE SUPERMART/, 'DMart', 'Groceries'], [/INSTAMART/, 'Swiggy Instamart', 'Groceries'], [/JIOMART/, 'JioMart', 'Groceries'],
    [/RELIANCE (RETAIL|FRESH|SMART)/, 'Reliance Retail', 'Groceries'], [/MORE RETAIL/, 'More Retail', 'Groceries'],
    [/AMAZON PAY|AMAZONPAY/, 'Amazon Pay', 'Shopping'], [/AMAZON|AMZN/, 'Amazon', 'Shopping'], [/FLIPKART/, 'Flipkart', 'Shopping'],
    [/MYNTRA/, 'Myntra', 'Shopping'], [/AJIO/, 'Ajio', 'Shopping'], [/NYKAA/, 'Nykaa', 'Shopping'], [/MEESHO/, 'Meesho', 'Shopping'],
    [/DECATHLON/, 'Decathlon', 'Shopping'], [/IKEA/, 'IKEA', 'Shopping'], [/CROMA/, 'Croma', 'Shopping'],
    [/UBER/, 'Uber', 'Travel & transport'], [/\bOLA\b|ANI TECHNOLOGIES|OLACABS/, 'Ola', 'Travel & transport'], [/RAPIDO/, 'Rapido', 'Travel & transport'],
    [/IRCTC/, 'IRCTC', 'Travel & transport'], [/MAKEMYTRIP|MAKE MY TRIP/, 'MakeMyTrip', 'Travel & transport'], [/GOIBIBO/, 'Goibibo', 'Travel & transport'],
    [/INDIGO|INTERGLOBE/, 'IndiGo', 'Travel & transport'], [/AIR INDIA/, 'Air India', 'Travel & transport'], [/REDBUS/, 'redBus', 'Travel & transport'],
    [/FASTAG|NETC/, 'FASTag', 'Travel & transport'], [/METRO RAIL|BMRCL|DMRC|KMRL/, null, 'Travel & transport'],
    [/INDIAN OIL|IOCL|BHARAT PETROLEUM|BPCL|HINDUSTAN PETROLEUM|HPCL|SHELL|PETROL|FUEL/, null, 'Fuel'],
    [/AIRTEL/, 'Airtel', 'Telecom & internet'], [/\bJIO\b|RELIANCE JIO/, 'Jio', 'Telecom & internet'], [/VODAFONE|\bVI\b|VODAIDEA/, 'Vi', 'Telecom & internet'],
    [/BSNL/, 'BSNL', 'Telecom & internet'], [/ACT FIBERNET|ATRIA CONVERGENCE/, 'ACT Fibernet', 'Telecom & internet'],
    [/ELECTRICITY|BESCOM|KSEB|TNEB|MSEDCL|TATA POWER|ADANI ELEC|BSES|CESC/, null, 'Utilities & bills'],
    [/WATER|BWSSB/, null, 'Utilities & bills'], [/\bGAS\b|INDANE|HP GAS|BHARATGAS|MAHANAGAR GAS|IGL/, null, 'Utilities & bills'],
    [/NETFLIX/, 'Netflix', 'Entertainment'], [/SPOTIFY/, 'Spotify', 'Entertainment'], [/HOTSTAR|DISNEY/, 'Disney+ Hotstar', 'Entertainment'],
    [/BOOKMYSHOW|BIGTREE/, 'BookMyShow', 'Entertainment'], [/YOUTUBE|GOOGLE ?PLAY|GOOGLE\s*\*|GOOGLEPLAY/, 'Google', 'Entertainment'],
    [/PRIME VIDEO/, 'Prime Video', 'Entertainment'], [/APPLE\.COM|APPLE SERVICES|ITUNES/, 'Apple', 'Entertainment'],
    [/APOLLO|PHARMEASY|NETMEDS|1MG|TATA 1MG|MEDPLUS|PHARMACY|HOSPITAL|CLINIC|DIAGNOSTIC/, null, 'Health'],
    [/ZERODHA/, 'Zerodha', 'Investments'], [/GROWW|NEXTBILLION/, 'Groww', 'Investments'], [/\bKUVERA/, 'Kuvera', 'Investments'],
    [/UPSTOX|RKSV/, 'Upstox', 'Investments'], [/\bCAMS\b|KFIN|KARVY|MUTUAL FUND|\bMF\b|\bSIP\b|BSE STAR|ICCL|INDIAN CLEARING/, null, 'Investments'],
    [/\bPPF\b|\bNPS\b|\bRD\b INST|RECURRING DEP|FIXED DEP|\bFD\b/, null, 'Investments'],
    [/LIC\b|LIFE INSURANCE|INSURANCE|POLICYBAZAAR|HDFC ERGO|ICICI LOMBARD|STAR HEALTH|BAJAJ ALLIANZ|MAX LIFE|TATA AIA/, null, 'Insurance'],
    [/\bEMI\b|LOAN|BAJAJ FIN|HOME FIN|\bHFC\b/, null, 'Loans & EMI'],
    [/CRED\b|CREDITCARD|CREDIT CARD|\bCC\b PAY|CARD PAYMENT|BILLDESK.*CARD/, null, 'Credit card bills'],
    [/\bRENT\b|NOBROKER|NESTAWAY|HOUSING\.COM/, null, 'Rent & housing'],
    [/SALARY|\bSAL\b|PAYROLL/, null, 'Salary & income'],
    [/PAYTM/, 'Paytm', 'Wallets & payments'], [/PHONEPE/, 'PhonePe', 'Wallets & payments'], [/MOBIKWIK/, 'MobiKwik', 'Wallets & payments'],
    [/RAZORPAY|CASHFREE|PAYU|BILLDESK|CCAVENUE/, null, 'Wallets & payments'],
    [/URBAN ?COMPANY|URBANCLAP/, 'Urban Company', 'Services'], [/CULT\.?FIT|CUREFIT/, 'Cult.fit', 'Health'],
  ];

  const BANKS = /^(STATE BANK OF INDIA|SBI|HDFC( BANK)?|ICICI( BANK)?|AXIS( BANK)?|KOTAK( MAHINDRA)?( BANK)?|YES BANK|FEDERAL BANK|FEDERAL|CANARA( BANK)?|BANK OF BARODA|BOB|PUNJAB NATIONAL BANK|PNB|UNION BANK( OF INDIA)?|IDFC( FIRST)?( BANK)?|INDUSIND( BANK)?|PAYTM PAYMENTS BANK|AIRTEL PAYMENTS BANK|FINO|AU SMALL FINANCE BANK|SOUTH INDIAN BANK|CATHOLIC SYRIAN BANK|CSB|DBS|RBL( BANK)?|INDIAN BANK|INDIAN OVERSEAS BANK|IOB|BANK OF INDIA|CENTRAL BANK OF INDIA|UCO BANK|KARNATAKA BANK|KVB|KARUR VYSYA BANK|TMB|CITY UNION BANK|JIO PAYMENTS BANK|IDBI( BANK)?|EQUITAS|UJJIVAN|BANDHAN( BANK)?)$/;

  const STOP = new Set(('UPI UPIOUT UPIIN UPI OUT UPI IN IMPS NEFT RTGS P2A P2M P2P DR CR TO FROM BY TRANSFER TRF TFR PAYMENT PAY PAID OUT IN SENT RECEIVED ' +
    'MOB MMT INB IB NA NULL NONE REF REFNO TXN TRAN COLLECT REQUEST INWARD OUTWARD INFT INF CMS ACH NACH ECS DEBIT CREDIT POS ' +
    'IMPSIN IMPSOUT NEFTIN NEFTOUT RTGSIN RTGSOUT MB NETBANKING BIL ONL ECOM VPS IPS PCD VIN MPS BILLPAY BBPS CLG CHQ CHEQUE CLEARING INWARD CLG OUTWARD CLG').split(' '));

  const NOISE_PHRASES = /^(PAYMENT FROM PHONE(PE)?|PAY(MENT)? TO|PAID VIA.*|SENT (USING|FROM|VIA).*|NO REMARKS?|UPI PAYMENT|UPI TRANSACTION|PAYMENT|COLLECT ?REQ.*|OID\w*|PAYTM PAYMENT|VERIFY|PAYMENT ON CRED|AUTOPAY.*|MANDATE.*|NA|OTHERS?|REMARK.*|UPI INTENT|SMS|MONTHLY|QR.*)$/;

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s.&(\-'])([a-z])/g, (m, p, c) => p + c.toUpperCase())
      .replace(/\b(Pvt|Ltd|Llp|Inc)\b\.?/g, m => m)
      .replace(/\b(Upi|Neft|Imps|Atm|Emi|Sbi|Hdfc|Icici|Lic|Ola|Ipo|Hp|Kseb|Bsnl|Irctc|Bescom|Tneb|Kfc|Llp|Nri|Gst)\b/g, m => m.toUpperCase());
  }

  function cleanToken(t) {
    return t.replace(/[^\w @&.'\-]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isJunk(tok) {
    const U = tok.toUpperCase();
    if (!U || U.length < 3) return true;
    if (STOP.has(U)) return true;
    if (BANKS.test(U)) return true;
    if (NOISE_PHRASES.test(U)) return true;
    if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(U)) return true; // IFSC
    if (/^[A-Z]{4}0$/.test(U)) return true;          // IFSC prefix stub
    const letters = (U.match(/[A-Z]/g) || []).length, digits = (U.match(/\d/g) || []).length;
    if (letters < 3) return true;
    if (digits >= letters) return true;              // reference numbers
    if (/^[A-Z]{1,6}\d{5,}/.test(U) || /\d{6,}/.test(U)) return true;
    if (/^X+\d*$/.test(U)) return true;              // masked account numbers
    return false;
  }

  // Turns a UPI handle into something readable: "rahul.kumar99@oksbi" -> "Rahul Kumar"
  function nameFromVPA(vpa) {
    const local = vpa.split('@')[0];
    if (/^\d{8,}$/.test(local.replace(/\D/g, '')) && local.replace(/\D/g, '').length >= 8 && !/[a-z]{3}/i.test(local)) return vpa.toLowerCase();
    const words = local.replace(/[._\-]+/g, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
    return words.length >= 3 ? titleCase(words) : vpa.toLowerCase();
  }

  // "9895012345@PAYTM" names the payee's app, not the payee — drop handle domains before merchant matching.
  function stripVPADomains(U) { return U.replace(/@[A-Z]+\b/g, ' '); }

  function extractEntity(particulars, channel) {
    const raw = String(particulars || '').trim();
    const U = stripVPADomains(raw.toUpperCase());

    if (channel === 'ATM / Cash') return { name: 'Cash withdrawal (ATM)', merchantCategory: 'Cash' };
    if (channel === 'Interest') return { name: 'Bank interest', merchantCategory: 'Interest' };
    if (channel === 'Bank charges') return { name: 'Bank charges', merchantCategory: 'Bank charges' };
    if (channel === 'Cash') return { name: 'Cash', merchantCategory: 'Cash' };

    for (const [re, name, cat] of MERCHANTS) {
      if (re.test(U) && name) return { name, merchantCategory: cat };
    }

    const parts = raw.split(/[\/|\\:;]+|-+/).map(cleanToken).filter(Boolean);
    const vpa = parts.find(p => /^[\w.\-]+@[a-z]+$/i.test(p.replace(/\s/g, '')));

    const candidates = [];
    for (let p of parts) {
      if (/@/.test(p)) continue;
      // Strip leading channel words glued to the name: "UPI OUT RAHUL" -> "RAHUL"
      p = p.replace(/^(UPI ?(OUT|IN)?|IMPS|NEFT|RTGS|TRF|TRANSFER|TO|BY|FROM|INB|MOB|ACH|NACH|ECS)\b\s*/i, '').trim();
      p = p.replace(/^(TO|FROM|BY)\s+/i, '').replace(/^(D\s+)?(TP\s+)?(ACH|NACH)\s+/i, '').replace(/^(CLG|CHQ|CHEQUE)\s*(NO\.?)?\s*\d*\s*/i, '').trim();
      if (!isJunk(p)) candidates.push(p);
    }

    let name = candidates[0];
    if (!name && vpa) name = nameFromVPA(vpa);
    if (!name) {
      const fallback = raw.replace(/\d{5,}/g, ' ').replace(/[\/|\-:]+/g, ' ').replace(/\s+/g, ' ').trim();
      name = fallback || 'Unknown';
    }
    name = name.replace(/\s+(PVT|PRIVATE)\.?\s*(LTD|LIMITED)\.?$/i, '').replace(/\s+(LTD|LIMITED|LLP|INC)\.?$/i, '').trim();
    return { name: /[a-z]/.test(name) && /[A-Z]/.test(name) ? name : titleCase(name), vpa, merchantCategory: null };
  }

  function categorise(U, channel, merchantCategory, isDebit) {
    if (merchantCategory) return merchantCategory;
    for (const [re, , cat] of MERCHANTS) if (re.test(U)) return cat;
    if (channel === 'Auto-debit') return 'Auto-debits';
    if (channel === 'Cheque') return 'Cheques';
    if (channel === 'Bill pay') return 'Utilities & bills';
    if (channel === 'Card') return 'Shopping';
    if (['UPI', 'IMPS', 'NEFT', 'RTGS', 'Account transfer'].includes(channel)) return isDebit ? 'Transfers out' : 'Transfers in';
    return 'Other';
  }

  // ---------- Statement ----------
  function parseStatement(text, sourceName) {
    const rows = parseCSV(text);
    const hdr = findHeader(rows);
    if (!hdr) throw new Error(`Couldn't find a header row with Tran Date / Particulars / Withdrawal / Deposit columns in ${sourceName || 'the file'}.`);
    const M = hdr.map, out = [];
    let skipped = 0;
    for (let i = hdr.index + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r.some(c => c)) continue;
      const date = parseDate(r[M.date]);
      const wd = M.withdrawal != null ? Math.abs(parseAmount(r[M.withdrawal])) : 0;
      const dp = M.deposit != null ? Math.abs(parseAmount(r[M.deposit])) : 0;
      if (!date) {
        // Narration that wrapped onto the next line: no date, no amounts, only text.
        const extra = r[M.particulars];
        if (out.length && extra && !wd && !dp && !/^(opening|closing|total|grand total|statement|page|\*)/i.test(extra)) {
          const prev = out[out.length - 1];
          // Fixed-width exports split mid-token ("...@ax" + "isbank/..."); join those without a space.
          const hardWrap = prev.particulars.length >= 30 && /[\w@.]$/.test(prev.particulars) && /^[\w@.]/.test(extra) && !/\s/.test(extra.split('/')[0]);
          prev.particulars += (hardWrap ? '' : ' ') + extra;
        } else if (extra || wd || dp) skipped++;
        continue;
      }
      if (!wd && !dp) { skipped++; continue; }
      out.push({
        sl: M.sl != null ? r[M.sl] : String(out.length + 1),
        date,
        valueDate: M.valueDate != null ? parseDate(r[M.valueDate]) : null,
        particulars: (r[M.particulars] || '').replace(/\s+/g, ' '),
        tranType: M.tranType != null ? r[M.tranType] : '',
        cheque: M.cheque != null ? r[M.cheque] : '',
        withdrawal: wd,
        deposit: dp,
        balance: M.balance != null && r[M.balance] !== '' ? parseAmount(r[M.balance]) : null,
        source: sourceName || '',
      });
    }
    return { txns: out, skipped, columns: Object.keys(M) };
  }

  // Adds derived fields. `rules` = [{match, entity, category}] (match: case-insensitive substring or /regex/).
  function enrich(txns, rules) {
    const compiled = (rules || []).filter(r => r.match).map(r => {
      let re;
      const m = r.match.match(/^\/(.+)\/([a-z]*)$/);
      try { re = m ? new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i') : new RegExp(r.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
      catch (e) { re = null; }
      return { ...r, re };
    }).filter(r => r.re);

    return txns.map((t, idx) => {
      const U = stripVPADomains(t.particulars.toUpperCase());
      const channel = detectChannel(U, t.tranType, t.cheque);
      const isDebit = t.withdrawal > 0;
      const ent = extractEntity(t.particulars, channel);
      let entity = ent.name, category = categorise(U, channel, ent.merchantCategory, isDebit);
      for (const r of compiled) {
        if (r.re.test(t.particulars) || r.re.test(entity)) {
          if (r.entity) entity = r.entity;
          if (r.category) category = r.category;
          break;
        }
      }
      if (!isDebit && category === 'Transfers out') category = 'Transfers in';
      return { ...t, id: idx, channel, entity, autoEntity: ent.name, vpa: ent.vpa || null, category, amount: t.deposit - t.withdrawal };
    });
  }

  function dedupe(txns) {
    const seen = new Set();
    return txns.filter(t => {
      const k = [+t.date, t.particulars, t.withdrawal, t.deposit, t.balance].join('|');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  const api = { parseCSV, parseDate, parseAmount, findHeader, detectChannel, extractEntity, categorise, parseStatement, enrich, dedupe, titleCase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpendParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
