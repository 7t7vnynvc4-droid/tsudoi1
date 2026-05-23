/* =====================================================
   お金カウンター v2 — app.js
   ===================================================== */
'use strict';

/* ── 金種定義 ──────────────────────────────────── */
const BILLS = [
  { value: 10000, label: '10,000円' },
  { value:  5000, label:  '5,000円' },
  { value:  1000, label:  '1,000円' },
];
const COINS = [
  { value: 500, label: '500円' },
  { value: 100, label: '100円' },
  { value:  50, label:  '50円' },
  { value:  10, label:  '10円' },
  { value:   5, label:   '5円' },
  { value:   1, label:   '1円' },
];
const ALL = [...BILLS, ...COINS];

/* ── 状態 ──────────────────────────────────────── */
const counts = {};
let   ledger = 0;
ALL.forEach(d => { counts[d.value] = 0; });

/* ── localStorage ──────────────────────────────── */
const STORE_KEY = 'okane-v2';
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      counts: Object.fromEntries(ALL.map(d => [d.value, counts[d.value]])),
      ledger,
    }));
  } catch(_) {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (d.counts) ALL.forEach(d2 => {
      const v = parseInt(d.counts[d2.value], 10);
      if (!isNaN(v) && v >= 0) counts[d2.value] = v;
    });
    if (typeof d.ledger === 'number') ledger = d.ledger;
  } catch(_) {}
}

/* ── 画面更新 ───────────────────────────────────── */
function refreshRow(value, bump = false) {
  const c  = counts[value];
  const el = document.getElementById(`cnt-${value}`);
  if (!el) return;
  el.textContent = c;
  if (bump) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  const sub = document.getElementById(`sub-${value}`);
  if (sub) {
    sub.textContent = c > 0
      ? `${value.toLocaleString('ja-JP')}×${c}=¥${(value*c).toLocaleString('ja-JP')}`
      : '';
  }
}

function recalc() {
  let total = 0;
  ALL.forEach(d => { total += d.value * counts[d.value]; });
  const diff = total - ledger;

  document.getElementById('totalDisplay').textContent  = '¥' + total.toLocaleString('ja-JP');
  document.getElementById('ledgerDisplay').textContent = '¥' + ledger.toLocaleString('ja-JP');
  document.getElementById('ledgerValue').textContent   = ledger.toLocaleString('ja-JP');

  const el = document.getElementById('diffDisplay');
  if (diff > 0) {
    el.textContent = '+' + diff.toLocaleString('ja-JP') + '円';
    el.className = 'diff-value positive';
  } else if (diff < 0) {
    el.textContent = diff.toLocaleString('ja-JP') + '円';
    el.className = 'diff-value negative';
  } else {
    el.textContent = '±0円';
    el.className = 'diff-value zero';
  }
}

/* ── DOM構築 ───────────────────────────────────── */
function buildRows(list, id) {
  const container = document.getElementById(id);
  list.forEach(d => {
    const row = document.createElement('div');
    row.className = 'denom-row';
    row.dataset.value = d.value;
    row.innerHTML = `
      <div class="denom-label">${d.label}</div>
      <div class="denom-tap">
        <span class="denom-count" id="cnt-${d.value}">0</span>
        <span class="denom-unit">枚</span>
        <span class="denom-subtotal" id="sub-${d.value}"></span>
      </div>
      <div class="denom-hint">タップして枚数を選択</div>
    `;
    row.addEventListener('click', () => openCountPicker(d));
    container.appendChild(row);
  });
}

/* =====================================================
   汎用ドラムロール・エンジン
   ===================================================== */
const ITEM_H    = 44;   // px / item
const CENTER_Y  = 88;   // viewport内の選択中心 (220/2 - 44/2)

/**
 * DrumCol — 1列のドラムロール
 * @param {HTMLElement} colEl   .pk-col
 * @param {HTMLElement} innerEl .pk-col-inner
 * @param {number}      count   アイテム総数
 */
class DrumCol {
  constructor(colEl, innerEl, count) {
    this.colEl   = colEl;
    this.innerEl = innerEl;
    this.count   = count;
    this.index   = 0;
    this._offset = 0;   // ドラッグ中の一時オフセット(px)
    this._dragging  = false;
    this._startY    = 0;
    this._lastY     = 0;
    this._lastT     = 0;
    this._velocity  = 0;
    this._onChangeCb = null;

    this._bindEvents();
  }

  /* インデックスをセット（アニメ有無） */
  setIndex(idx, animated = false) {
    this.index   = this._clamp(idx);
    this._offset = 0;
    this._applyTransform(animated);
    this._onChangeCb && this._onChangeCb(this.index);
  }

  onChange(cb) { this._onChangeCb = cb; }

  /* ── 内部 ── */
  _clamp(v) { return Math.max(0, Math.min(this.count - 1, Math.round(v))); }

  _y() { return CENTER_Y - this.index * ITEM_H + this._offset; }

  _applyTransform(animated = false) {
    this.innerEl.style.transition = animated
      ? 'transform .28s cubic-bezier(.25,.46,.45,.94)'
      : 'none';
    this.innerEl.style.transform = `translateY(${this._y()}px)`;
  }

  _snap(withVelocity = false) {
    if (withVelocity && Math.abs(this._velocity) > 0.25) {
      /* 慣性: velocity px/ms → 飛距離 */
      const fly = this._velocity * 110;
      this.index = this._clamp(this.index - fly / ITEM_H);
    } else {
      this.index = this._clamp(this.index - this._offset / ITEM_H);
    }
    this._offset = 0;
    this._applyTransform(true);
    this._onChangeCb && this._onChangeCb(this.index);
  }

  _onStart(y) {
    this._dragging  = true;
    this._startY    = y;
    this._lastY     = y;
    this._lastT     = Date.now();
    this._velocity  = 0;
    this.innerEl.style.transition = 'none';
  }

  _onMove(y) {
    if (!this._dragging) return;
    const now = Date.now();
    const dt  = Math.max(now - this._lastT, 1);
    this._velocity = (y - this._lastY) / dt;
    this._lastY    = y;
    this._lastT    = now;

    const dy       = y - this._startY;
    const rawIdx   = this.index - dy / ITEM_H;
    const maxI     = this.count - 1;

    /* ゴム引き */
    if (rawIdx < 0) {
      this._offset = this.index * ITEM_H + dy * 0.32;
    } else if (rawIdx > maxI) {
      this._offset = (this.index - maxI) * ITEM_H + (dy - (this.index - maxI) * ITEM_H) * 0.32;
    } else {
      this._offset = dy;
    }
    this._applyTransform(false);
  }

  _onEnd() {
    if (!this._dragging) return;
    this._dragging = false;
    this._snap(true);
  }

  _bindEvents() {
    const el = this.colEl;

    /* Touch（iOS Safari メイン） */
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      this._onStart(e.touches[0].clientY);
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      e.preventDefault();
      this._onMove(e.touches[0].clientY);
    }, { passive: false });

    el.addEventListener('touchend', e => {
      e.preventDefault();
      this._onEnd();
    }, { passive: false });

    el.addEventListener('touchcancel', () => {
      this._dragging = false;
      this.setIndex(this.index, true);
    }, { passive: true });

    /* Pointer（デスクトップ確認用） */
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this._onStart(e.clientY);
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      this._onMove(e.clientY);
    });
    el.addEventListener('pointerup', e => {
      if (e.pointerType === 'touch') return;
      this._onEnd();
    });
    el.addEventListener('pointercancel', e => {
      if (e.pointerType === 'touch') return;
      this._dragging = false;
      this.setIndex(this.index, true);
    });
  }
}

/* =====================================================
   ピッカーシート 共通操作
   ===================================================== */
function showSheet(overlay, sheet) {
  overlay.classList.add('open');
  sheet.classList.add('open');
}
function hideSheet(overlay, sheet) {
  overlay.classList.remove('open');
  sheet.classList.remove('open');
  sheet.style.transform = '';  /* transition終了後リセット */
}

/* シートをドラッグで閉じる */
function bindSheetDrag(handleEl, sheetEl, onClose) {
  let startY = 0, dragging = false;
  handleEl.addEventListener('touchstart', e => {
    dragging = true;
    startY = e.touches[0].clientY;
    sheetEl.style.transition = 'none';
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    sheetEl.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!dragging) return;
    dragging = false;
    sheetEl.style.transition = '';
    if (e.changedTouches[0].clientY - startY > 80) {
      onClose();
    } else {
      sheetEl.style.transform = '';
    }
  }, { passive: true });
}

/* =====================================================
   枚数ピッカー（各金種）
   ===================================================== */
const COUNT_MAX = 99;

let countPickerDenom  = null;   // 現在開いている金種
let countPickerDrum   = null;   // DrumCol インスタンス
let countPickerCancelValue = 0; // キャンセル用退避

function buildCountPicker() {
  const sheet   = document.getElementById('countSheet');
  const inner   = document.getElementById('countInner');

  /* アイテム生成 0〜99 */
  inner.innerHTML = '';
  for (let i = 0; i <= COUNT_MAX; i++) {
    const item = document.createElement('div');
    item.className = 'pk-item';
    item.textContent = String(i);
    inner.appendChild(item);
  }

  const colEl = document.getElementById('countCol');
  countPickerDrum = new DrumCol(colEl, inner, COUNT_MAX + 1);

  countPickerDrum.onChange(idx => {
    const preview = document.getElementById('countPreview');
    if (countPickerDenom) {
      const sub = idx > 0
        ? `${countPickerDenom.value.toLocaleString('ja-JP')} × ${idx} = ¥${(countPickerDenom.value * idx).toLocaleString('ja-JP')}`
        : '0枚';
      preview.textContent = sub;
    }
  });

  /* ドラッグで閉じる */
  bindSheetDrag(
    document.getElementById('countHandle'),
    sheet,
    () => closeCountPicker(false)
  );
}

function openCountPicker(denom) {
  countPickerDenom       = denom;
  countPickerCancelValue = counts[denom.value];

  /* タイトル更新 */
  document.getElementById('countTitle').textContent = denom.label + ' の枚数';

  /* 現在の枚数にセット */
  countPickerDrum.setIndex(counts[denom.value], false);

  /* プレビュー初期化 */
  const c = counts[denom.value];
  document.getElementById('countPreview').textContent = c > 0
    ? `${denom.value.toLocaleString('ja-JP')} × ${c} = ¥${(denom.value * c).toLocaleString('ja-JP')}`
    : '0枚';

  showSheet(
    document.getElementById('countOverlay'),
    document.getElementById('countSheet')
  );
}

function closeCountPicker(apply) {
  if (apply && countPickerDenom) {
    counts[countPickerDenom.value] = countPickerDrum.index;
    refreshRow(countPickerDenom.value, true);
    recalc();
    save();
  }
  hideSheet(
    document.getElementById('countOverlay'),
    document.getElementById('countSheet')
  );
  countPickerDenom = null;
}

/* =====================================================
   帳簿ピッカー（5列: 万/千/百/十/一）
   ===================================================== */
const LEDGER_COLS = [
  { label: '万', mult: 10000, count: 100 },
  { label: '千', mult:  1000, count:  10 },
  { label: '百', mult:   100, count:  10 },
  { label: '十', mult:    10, count:  10 },
  { label: '一', mult:     1, count:  10 },
];

let ledgerDrums = [];

function ledgerToIndices(val) {
  const indices = [];
  let rem = Math.max(0, Math.min(val, 999999));
  LEDGER_COLS.forEach(c => {
    const d = Math.floor(rem / c.mult);
    indices.push(d);
    rem -= d * c.mult;
  });
  return indices;
}

function indicesToLedger(indices) {
  return LEDGER_COLS.reduce((s, c, i) => s + indices[i] * c.mult, 0);
}

function updateLedgerPreview() {
  const val = indicesToLedger(ledgerDrums.map(d => d.index));
  document.getElementById('ledgerPreview').textContent = '¥ ' + val.toLocaleString('ja-JP');
}

function buildLedgerPicker() {
  const body = document.getElementById('ledgerBody');
  body.innerHTML = '';

  /* 選択ハイライト */
  const hl = document.createElement('div');
  hl.className = 'pk-selection';
  body.appendChild(hl);

  ledgerDrums = [];

  LEDGER_COLS.forEach((col, ci) => {
    const wrap  = document.createElement('div');
    wrap.className = 'pk-col-wrap';

    const lbl   = document.createElement('div');
    lbl.className = 'pk-col-label';
    lbl.textContent = col.label;

    const colEl = document.createElement('div');
    colEl.className = 'pk-col';
    colEl.id = `ledger-col-${ci}`;

    const inner = document.createElement('div');
    inner.className = 'pk-col-inner';
    inner.id = `ledger-inner-${ci}`;

    for (let i = 0; i < col.count; i++) {
      const item = document.createElement('div');
      item.className = 'pk-item';
      item.textContent = String(i);
      inner.appendChild(item);
    }

    colEl.appendChild(inner);
    wrap.appendChild(lbl);
    wrap.appendChild(colEl);
    body.appendChild(wrap);

    const drum = new DrumCol(colEl, inner, col.count);
    drum.onChange(() => updateLedgerPreview());
    ledgerDrums.push(drum);
  });

  bindSheetDrag(
    document.getElementById('ledgerHandle'),
    document.getElementById('ledgerSheet'),
    () => closeLedgerPicker(false)
  );
}

function openLedgerPicker() {
  const indices = ledgerToIndices(ledger);
  ledgerDrums.forEach((drum, i) => drum.setIndex(indices[i], false));
  updateLedgerPreview();
  showSheet(
    document.getElementById('ledgerOverlay'),
    document.getElementById('ledgerSheet')
  );
}

function closeLedgerPicker(apply) {
  if (apply) {
    ledger = indicesToLedger(ledgerDrums.map(d => d.index));
    recalc();
    save();
  }
  hideSheet(
    document.getElementById('ledgerOverlay'),
    document.getElementById('ledgerSheet')
  );
}

/* =====================================================
   確認モーダル
   ===================================================== */
function showConfirm(title, msg, onOk) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMsg').textContent   = msg;
  const overlay = document.getElementById('confirmOverlay');
  overlay.classList.add('open');

  const btnOk     = document.getElementById('modalOk');
  const btnCancel = document.getElementById('modalCancel');

  function cleanup() {
    overlay.classList.remove('open');
    btnOk.removeEventListener('click', doOk);
    btnCancel.removeEventListener('click', doCancel);
  }
  function doOk()     { cleanup(); onOk(); }
  function doCancel() { cleanup(); }

  btnOk.addEventListener('click', doOk);
  btnCancel.addEventListener('click', doCancel);
}

/* =====================================================
   リセット
   ===================================================== */
function doReset() {
  ALL.forEach(d => {
    counts[d.value] = 0;
    refreshRow(d.value, false);
  });
  ledger = 0;
  recalc();
  save();
}

/* =====================================================
   初期化
   ===================================================== */
function init() {
  load();
  buildRows(BILLS, 'billRows');
  buildRows(COINS, 'coinRows');
  buildCountPicker();
  buildLedgerPicker();

  /* 保存値を反映 */
  ALL.forEach(d => refreshRow(d.value, false));
  recalc();

  /* 帳簿トリガー */
  document.getElementById('ledgerTrigger').addEventListener('click', openLedgerPicker);

  /* 帳簿ピッカーボタン */
  document.getElementById('ledgerCancel').addEventListener('click', () => closeLedgerPicker(false));
  document.getElementById('ledgerDone').addEventListener('click',   () => closeLedgerPicker(true));
  document.getElementById('ledgerOverlay').addEventListener('click', () => closeLedgerPicker(false));

  /* 枚数ピッカーボタン */
  document.getElementById('countCancel').addEventListener('click', () => closeCountPicker(false));
  document.getElementById('countDone').addEventListener('click',   () => closeCountPicker(true));
  document.getElementById('countOverlay').addEventListener('click', () => closeCountPicker(false));

  /* リセット */
  document.getElementById('resetBtn').addEventListener('click', () => {
    showConfirm('リセットの確認', 'すべての枚数と帳簿残額をリセットします。', doReset);
  });

  /* テキスト選択禁止 */
  document.addEventListener('selectstart', e => {
    if (!e.target.closest('input')) e.preventDefault();
  });
}

document.addEventListener('DOMContentLoaded', init);
/* ▼ ドラムロール改善版 */
DrumCol.prototype._bindEvents = function () {
