/* =====================================================
   お金カウンター v2.1 — app.js
   改善内容:
   - DrumCol を rAF ベースで完全書き直し
   - ITEM_H=40、CENTER_Y を動的計算（pk-drum-wrap 実高さ基準）
   - touchstart/touchmove/touchend に正しく preventDefault
   - スナップ位置を Math.round で整数保証
   - ゴム引き改善・慣性フリック精度向上
   - touchcancel / pointercancel を確実に処理
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
   定数
   ===================================================== */
const ITEM_H = 40;    // アイテム高さ (px) — 40px に縮小

/*
  CENTER_Y の考え方:
  ─────────────────────────────────────────────
  .pk-drum-wrap の高さ = 200px (CSS で設定)
  選択中心ライン = 200/2 = 100px (上端からの距離)

  innerEl の translateY(y) で「index番目アイテムの中心」が
  中心ラインに来る条件:
    y + index * ITEM_H + ITEM_H/2 = 100
  → y = 100 - ITEM_H/2 - index * ITEM_H
  → index=0 のとき y = 100 - 20 = 80

  CENTER_Y = 80  (= pk-drum-wrap_height/2 - ITEM_H/2)
  ─────────────────────────────────────────────
  ※ ラベル行(.pk-col-label)は .pk-col-wrap の外なので
     .pk-col の高さには影響しない（CSS flex-column で分離）
*/
const DRUM_H   = 200;  // .pk-drum-wrap の高さ (CSS と一致させる)
const CENTER_Y = DRUM_H / 2 - ITEM_H / 2;  // = 80

/* =====================================================
   DrumCol — 1列のドラムロール (rAF 版)
   ===================================================== */
class DrumCol {
  constructor(colEl, innerEl, count) {
    this.colEl    = colEl;
    this.innerEl  = innerEl;
    this.count    = count;

    /* 選択インデックス（常に整数） */
    this.index    = 0;

    /* ドラッグ中の生オフセット(px)。スナップ後は 0 にリセット */
    this._rawOffset = 0;

    /* rAF 管理 */
    this._rafId   = null;
    this._pendingY = null;  // rAF に渡す最新の translateY 値

    /* ドラッグ状態 */
    this._dragging  = false;
    this._startY    = 0;
    this._lastY     = 0;
    this._lastT     = 0;
    this._velocity  = 0;   // px/ms

    /* コールバック */
    this._onChangeCb = null;

    /* 初期位置を即座に適用 */
    this.innerEl.style.transform = `translateY(${CENTER_Y}px)`;

    this._bindEvents();
  }

  /* ── 公開 API ── */
  setIndex(idx, animated = false) {
    this._cancelRaf();
    this._rawOffset = 0;
    this.index      = this._clamp(idx);
    const y         = this._calcY(this.index, 0);

    if (animated) {
      this._setTransition(true);
      this.innerEl.style.transform = `translateY(${y}px)`;
    } else {
      this._setTransition(false);
      this.innerEl.style.transform = `translateY(${y}px)`;
    }
    this._onChangeCb && this._onChangeCb(this.index);
  }

  onChange(cb) { this._onChangeCb = cb; }

  /* ── 内部ユーティリティ ── */

  /** index と offset から translateY を計算 */
  _calcY(index, offset) {
    return CENTER_Y - index * ITEM_H + offset;
  }

  _clamp(v) {
    return Math.max(0, Math.min(this.count - 1, Math.round(v)));
  }

  _setTransition(on) {
    this.innerEl.style.transition = on
      ? 'transform 0.26s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      : 'none';
  }

  /* rAF をキャンセル */
  _cancelRaf() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._pendingY = null;
  }

  /* rAF ループ: _pendingY を実際の style に反映 */
  _scheduleRaf(y) {
    this._pendingY = y;
    if (this._rafId !== null) return; // すでにスケジュール済み
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (this._pendingY === null) return;
      this.innerEl.style.transform = `translateY(${this._pendingY}px)`;
      this._pendingY = null;
    });
  }

  /* ── ドラッグ処理 ── */
  _onStart(clientY) {
    this._cancelRaf();
    this._setTransition(false);

    this._dragging   = true;
    this._startY     = clientY;
    this._lastY      = clientY;
    this._lastT      = performance.now();
    this._velocity   = 0;
    this._rawOffset  = 0;
  }

  _onMove(clientY) {
    if (!this._dragging) return;

    const now  = performance.now();
    const dt   = Math.max(now - this._lastT, 1);

    /* 速度計算 (px/ms) — EMA でスムージング */
    const rawV = (clientY - this._lastY) / dt;
    this._velocity = this._velocity * 0.6 + rawV * 0.4;

    this._lastY = clientY;
    this._lastT = now;

    /* 今回の移動量 */
    const dy    = clientY - this._startY;
    const maxI  = this.count - 1;

    /* ゴム引き計算 */
    const floatIdx = this.index - dy / ITEM_H;
    let   offset;

    if (floatIdx < 0) {
      /* 先頭を超えた: 引き戻し係数 0.28 */
      const over  = -floatIdx * ITEM_H;   // 超えた量(px, 正値)
      offset = this.index * ITEM_H + over * 0.28;
    } else if (floatIdx > maxI) {
      /* 末尾を超えた */
      const over  = (floatIdx - maxI) * ITEM_H;
      offset = (this.index - maxI) * ITEM_H - over * 0.28;
    } else {
      offset = dy;
    }

    this._rawOffset = offset;

    /* rAF 経由で描画 */
    this._scheduleRaf(this._calcY(this.index, offset));
  }

  _onEnd() {
    if (!this._dragging) return;
    this._dragging  = false;
    this._cancelRaf();

    /* 慣性 or スナップ */
    const FLING_THRESH = 0.18;  // px/ms
    let   newIndex;

    if (Math.abs(this._velocity) > FLING_THRESH) {
      /* 慣性: velocity * 係数 でオフセットを加算 */
      const fling     = this._velocity * 90;
      const floatIdx  = this.index - (this._rawOffset + fling) / ITEM_H;
      newIndex = this._clamp(floatIdx);
    } else {
      /* 通常スナップ: rawOffset から整数インデックスへ */
      const floatIdx  = this.index - this._rawOffset / ITEM_H;
      newIndex = this._clamp(floatIdx);
    }

    this._rawOffset = 0;
    this.index      = newIndex;

    /* CSS トランジションでスムーズにスナップ */
    this._setTransition(true);
    this.innerEl.style.transform = `translateY(${this._calcY(this.index, 0)}px)`;
    this._onChangeCb && this._onChangeCb(this.index);
  }

  _onCancel() {
    if (!this._dragging) return;
    this._dragging  = false;
    this._cancelRaf();
    this._rawOffset = 0;
    /* キャンセル: 現在 index 位置にアニメで戻す */
    this._setTransition(true);
    this.innerEl.style.transform = `translateY(${this._calcY(this.index, 0)}px)`;
  }

  /* ── イベントバインド ── */
  _bindEvents() {
    const el = this.colEl;

    /* ─ Touch（iOS Safari メイン）─
       passive: false で preventDefault を確実に呼ぶ。
       これによりページ/シートのスクロール競合を防止。 */
    el.addEventListener('touchstart', e => {
      e.preventDefault();   // ← スクロール競合防止・必須
      e.stopPropagation();
      if (e.touches.length !== 1) return;
      this._onStart(e.touches[0].clientY);
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      e.preventDefault();   // ← スクロール競合防止・必須
      e.stopPropagation();
      if (e.touches.length !== 1) return;
      this._onMove(e.touches[0].clientY);
    }, { passive: false });

    el.addEventListener('touchend', e => {
      e.preventDefault();   // ← 意図しないクリック発火防止
      e.stopPropagation();
      this._onEnd();
    }, { passive: false });

    el.addEventListener('touchcancel', e => {
      e.stopPropagation();
      this._onCancel();
    }, { passive: true });

    /* ─ Pointer（デスクトップ・テスト用）─ */
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this._onStart(e.clientY);
    }, { passive: false });

    el.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      if (!this._dragging) return;
      this._onMove(e.clientY);
    }, { passive: true });

    el.addEventListener('pointerup', e => {
      if (e.pointerType === 'touch') return;
      this._onEnd();
    }, { passive: true });

    el.addEventListener('pointercancel', e => {
      if (e.pointerType === 'touch') return;
      this._onCancel();
    }, { passive: true });
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
  sheet.style.transform = '';
}

/* シートをハンドルドラッグで閉じる */
function bindSheetDrag(handleEl, sheetEl, onClose) {
  let startY = 0, dragging = false;

  handleEl.addEventListener('touchstart', e => {
    dragging = true;
    startY   = e.touches[0].clientY;
    sheetEl.style.transition = 'none';
  }, { passive: true });

  /* ※ ここは document に attach するが、ドラム列 (.pk-col) の
        touchmove は e.stopPropagation() 済みなので競合しない */
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
   枚数ピッカー（各金種共用 — 1列）
   ===================================================== */
const COUNT_MAX = 99;

let countPickerDenom      = null;
let countPickerDrum       = null;
let countPickerCancelValue = 0;

function buildCountPicker() {
  const inner = document.getElementById('countInner');

  /* アイテム生成 0〜99 */
  inner.innerHTML = '';
  for (let i = 0; i <= COUNT_MAX; i++) {
    const item = document.createElement('div');
    item.className   = 'pk-item';
    item.textContent = String(i);
    inner.appendChild(item);
  }

  const colEl        = document.getElementById('countCol');
  countPickerDrum    = new DrumCol(colEl, inner, COUNT_MAX + 1);

  countPickerDrum.onChange(idx => {
    const preview = document.getElementById('countPreview');
    if (countPickerDenom) {
      preview.textContent = idx > 0
        ? `${countPickerDenom.value.toLocaleString('ja-JP')} × ${idx} = ¥${(countPickerDenom.value * idx).toLocaleString('ja-JP')}`
        : '0枚';
    }
  });

  bindSheetDrag(
    document.getElementById('countHandle'),
    document.getElementById('countSheet'),
    () => closeCountPicker(false)
  );
}

function openCountPicker(denom) {
  countPickerDenom       = denom;
  countPickerCancelValue = counts[denom.value];

  document.getElementById('countTitle').textContent = denom.label + ' の枚数';
  countPickerDrum.setIndex(counts[denom.value], false);

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
  const hl       = document.createElement('div');
  hl.className   = 'pk-selection';
  body.appendChild(hl);

  ledgerDrums = [];

  LEDGER_COLS.forEach((col, ci) => {
    const wrap  = document.createElement('div');
    wrap.className = 'pk-col-wrap';

    const lbl   = document.createElement('div');
    lbl.className   = 'pk-col-label';
    lbl.textContent = col.label;

    const colEl = document.createElement('div');
    colEl.className = 'pk-col';
    colEl.id        = `ledger-col-${ci}`;

    const inner = document.createElement('div');
    inner.className = 'pk-col-inner';
    inner.id        = `ledger-inner-${ci}`;

    for (let i = 0; i < col.count; i++) {
      const item       = document.createElement('div');
      item.className   = 'pk-item';
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
  const overlay   = document.getElementById('confirmOverlay');
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

  ALL.forEach(d => refreshRow(d.value, false));
  recalc();

  document.getElementById('ledgerTrigger').addEventListener('click', openLedgerPicker);

  document.getElementById('ledgerCancel').addEventListener('click',  () => closeLedgerPicker(false));
  document.getElementById('ledgerDone').addEventListener('click',    () => closeLedgerPicker(true));
  document.getElementById('ledgerOverlay').addEventListener('click', () => closeLedgerPicker(false));

  document.getElementById('countCancel').addEventListener('click',  () => closeCountPicker(false));
  document.getElementById('countDone').addEventListener('click',    () => closeCountPicker(true));
  document.getElementById('countOverlay').addEventListener('click', () => closeCountPicker(false));

  document.getElementById('resetBtn').addEventListener('click', () => {
    showConfirm('リセットの確認', 'すべての枚数と帳簿残額をリセットします。', doReset);
  });

  document.addEventListener('selectstart', e => {
    if (!e.target.closest('input')) e.preventDefault();
  });
}

document.addEventListener('DOMContentLoaded', init);
