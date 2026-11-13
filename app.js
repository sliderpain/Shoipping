/* =========================================================
   רשימת קניות משותפת
   ---------------------------------------------------------
   הדביקו כאן את כתובת ה-Web App של Apps Script
   (מסתיימת ב-/exec), בין הגרשיים:
   ========================================================= */
const API_URL = 'https://script.google.com/macros/s/AKfycbwZ3FeeOGlYx81rNZierVcIlYNANUsqtUYWZvm_i9frQpEVUl41PQH6dDy6jisDAa8J/exec';

const DEFAULT_CATEGORY = 'כללי';
const POLL_MS = 5000;
const KEY_STORAGE = 'shopping-key';
const LAST_CAT_STORAGE = 'shopping-last-cat';

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();

/* ---------- אחסון מקומי (עם הגנה במקרה שהדפדפן חוסם) ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

let state = { items: [], categories: [DEFAULT_CATEGORY], memory: {} };
let key = store.get(KEY_STORAGE);
let pendingWrites = 0;   // כמה שמירות עדיין בדרך לשרת
let writeCounter = 0;    // עולה בכל שמירה, כדי לזהות רענון שהתיישן
let writeChain = Promise.resolve();

/* ---------- תקשורת עם השרת ---------- */
async function call(payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // בלי בקשת preflight
    body: JSON.stringify({ key, ...payload }),
  });
  const json = await res.json();
  if (!json.ok) {
    const err = new Error(json.error || 'error');
    err.code = json.error;
    throw err;
  }
  return json.data;
}

async function refresh() {
  if (!key || pendingWrites > 0 || document.hidden) return;
  const startedAt = writeCounter;
  try {
    const data = await call({ action: 'get' });
    if (pendingWrites === 0 && startedAt === writeCounter) apply(data);
  } catch (e) {
    handleError(e, false);
  }
}

/** משנה מקומית מיד, ושולח לשרת ברקע (לפי הסדר) */
function write(payload, localChange) {
  localChange();
  render();
  pendingWrites++;
  writeCounter++;
  writeChain = writeChain.then(async () => {
    try {
      const data = await call(payload);
      pendingWrites--;
      if (pendingWrites === 0) apply(data);
    } catch (e) {
      pendingWrites--;
      handleError(e, true);
      if (pendingWrites === 0) refresh();
    }
  });
}

function apply(data) {
  state = data;
  if (!state.categories.includes(DEFAULT_CATEGORY)) state.categories.push(DEFAULT_CATEGORY);
  render();
}

function handleError(e, wasSaving) {
  if (e.code === 'unauthorized') {
    store.del(KEY_STORAGE);
    key = null;
    showKeyScreen('המפתח לא נכון. נסו שוב.');
    return;
  }
  toast(wasSaving ? 'השמירה נכשלה — בדקו חיבור לאינטרנט' : 'אין חיבור לשרת');
}

/* ---------- פעולות ---------- */
function addItem(rawName, category) {
  const name = String(rawName).trim().replace(/\s+/g, ' ');
  if (!name) return;
  const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random();
  write({ action: 'add', id, name, category }, () => {
    const existing = state.items.find((i) => norm(i.name) === norm(name));
    if (existing) Object.assign(existing, { category, status: 'active', updated: Date.now() });
    else state.items.push({ id, name, category, status: 'active', updated: Date.now() });
    state.memory[norm(name)] = category;
  });
}

function setStatus(id, status) {
  write({ action: status === 'bought' ? 'setBought' : 'setActive', id }, () => {
    const it = state.items.find((i) => i.id === id);
    if (it) Object.assign(it, { status, updated: Date.now() });
  });
}

function changeCategory(id, category) {
  write({ action: 'changeCategory', id, category }, () => {
    const it = state.items.find((i) => i.id === id);
    if (it) { it.category = category; state.memory[norm(it.name)] = category; }
  });
}

function deleteItem(id) {
  write({ action: 'delete', id }, () => {
    state.items = state.items.filter((i) => i.id !== id);
  });
}

function addCategory(rawName) {
  const name = String(rawName).trim().replace(/\s+/g, ' ');
  if (!name || state.categories.includes(name)) return;
  write({ action: 'addCategory', name }, () => {
    state.categories.push(name);
  });
}

function deleteCategory(name) {
  if (name === DEFAULT_CATEGORY) return;
  if (!confirm(`למחוק את הקטגוריה "${name}"?\nפריטים שבה יעברו ל"${DEFAULT_CATEGORY}".`)) return;
  write({ action: 'deleteCategory', name }, () => {
    state.categories = state.categories.filter((c) => c !== name);
    state.items.forEach((i) => { if (i.category === name) i.category = DEFAULT_CATEGORY; });
  });
}

/* ---------- תצוגה ---------- */
/** סדר הקטגוריות לתצוגה: "כללי" תמיד בסוף */
function orderedCategories() {
  return state.categories.filter((c) => c !== DEFAULT_CATEGORY).concat(DEFAULT_CATEGORY);
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  children.forEach((c) => node.append(c));
  return node;
}

function categorySelect(selected, className) {
  const sel = el('select', { className });
  orderedCategories().forEach((c) => sel.append(el('option', { value: c, textContent: c, selected: c === selected })));
  return sel;
}

function render() {
  const cats = orderedCategories();

  // תפריט הקטגוריות בטופס ההוספה (שומר את הבחירה הנוכחית)
  const catSelect = $('catSelect');
  const current = catSelect.value || store.get(LAST_CAT_STORAGE) || DEFAULT_CATEGORY;
  catSelect.replaceChildren(...cats.map((c) => el('option', { value: c, textContent: c })));
  catSelect.value = cats.includes(current) ? current : DEFAULT_CATEGORY;

  // הרשימה, מקובצת לפי קטגוריה
  const active = state.items.filter((i) => i.status !== 'bought');
  const list = $('list');
  list.replaceChildren();
  if (active.length === 0) {
    list.append(el('p', { className: 'empty', textContent: 'הרשימה ריקה' }));
  }
  const known = new Set(cats);
  cats.forEach((cat) => {
    const inCat = active
      .filter((i) => (known.has(i.category) ? i.category : DEFAULT_CATEGORY) === cat)
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
    if (!inCat.length) return;
    const ul = el('ul');
    inCat.forEach((it) => {
      const li = el('li', { className: 'item' });
      const nameBtn = el('button', { className: 'item-name', textContent: it.name, type: 'button' });
      nameBtn.addEventListener('click', () => {
        li.classList.add('leaving');
        setTimeout(() => setStatus(it.id, 'bought'), 150);
      });
      const sel = categorySelect(known.has(it.category) ? it.category : DEFAULT_CATEGORY, 'item-cat');
      sel.setAttribute('aria-label', `קטגוריה של ${it.name}`);
      sel.addEventListener('change', () => changeCategory(it.id, sel.value));
      li.append(nameBtn, sel);
      ul.append(li);
    });
    list.append(el('section', { className: 'group' }, el('h2', { textContent: cat }), ul));
  });

  // נקנו (החדשים למעלה)
  const bought = state.items.filter((i) => i.status === 'bought').sort((a, b) => b.updated - a.updated);
  $('boughtCount').textContent = bought.length ? `(${bought.length})` : '';
  $('boughtBox').hidden = bought.length === 0;
  $('boughtList').replaceChildren(...bought.map((it) => {
    const back = el('button', { className: 'item-name', textContent: it.name, type: 'button', title: 'החזרה לרשימה' });
    back.addEventListener('click', () => setStatus(it.id, 'active'));
    const del = el('button', { className: 'icon-btn del-btn', textContent: '✕', type: 'button', title: 'מחיקה' });
    del.setAttribute('aria-label', `מחיקת ${it.name}`);
    del.addEventListener('click', () => deleteItem(it.id));
    return el('li', {}, back, del);
  }));

  // ניהול קטגוריות
  $('catsList').replaceChildren(...cats.map((c) => {
    const li = el('li', {}, el('span', { textContent: c }));
    if (c === DEFAULT_CATEGORY) {
      li.append(el('span', { className: 'fixed', textContent: 'קבועה' }));
    } else {
      const del = el('button', { className: 'icon-btn del-btn', textContent: '✕', type: 'button' });
      del.setAttribute('aria-label', `מחיקת הקטגוריה ${c}`);
      del.addEventListener('click', () => deleteCategory(c));
      li.append(del);
    }
    return li;
  }));
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

/* ---------- מסכים ---------- */
function showKeyScreen(error) {
  $('mainScreen').hidden = true;
  $('keyScreen').hidden = false;
  $('keyError').hidden = !error;
  $('keyError').textContent = error || '';
}

function showMain() {
  $('keyScreen').hidden = true;
  $('mainScreen').hidden = false;
  render();
  refresh();
}

/* ---------- אירועים ---------- */
$('keyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  key = $('keyInput').value.trim();
  if (!key) return;
  store.set(KEY_STORAGE, key);
  showMain();
});

// זיכרון קטגוריה: בזמן ההקלדה, אם הפריט כבר הופיע בעבר — הקטגוריה שלו נבחרת לבד
$('itemInput').addEventListener('input', (e) => {
  const remembered = state.memory[norm(e.target.value)];
  if (remembered && state.categories.includes(remembered)) $('catSelect').value = remembered;
});

$('catSelect').addEventListener('change', (e) => store.set(LAST_CAT_STORAGE, e.target.value));

$('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('itemInput');
  addItem(input.value, $('catSelect').value);
  input.value = '';
  input.focus();
});

$('catsBtn').addEventListener('click', () => $('catsDialog').showModal());
$('catsClose').addEventListener('click', () => $('catsDialog').close());
$('catAddForm').addEventListener('submit', (e) => {
  e.preventDefault();
  addCategory($('catInput').value);
  $('catInput').value = '';
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(refresh, POLL_MS);

/* ---------- הפעלה ---------- */
(function start() {
  // אפשר להיכנס עם קישור שמכיל את המפתח: .../#k=המפתח (שומר אותו ומנקה מהכתובת)
  const m = location.hash.match(/k=([^&]+)/);
  if (m) {
    key = decodeURIComponent(m[1]);
    store.set(KEY_STORAGE, key);
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (API_URL.startsWith('PASTE')) {
    showKeyScreen('עדיין לא הוגדרה כתובת השרת בקובץ app.js');
    return;
  }
  if (key) showMain(); else showKeyScreen();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
