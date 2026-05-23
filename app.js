/* =====================================================
   お金カウンター v2.2 — app.js
   - 帳簿残高: input[type=number] 直接入力
   - 枚数: ドラムロールピッカー（ラベル分離で CENTER_Y 正確化）
   - DrumCol: rAF + 現在Y読み取り方式でスナップ位置確実
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
    if (typeof d.ledger === 'number' && !isNaN(d.ledger)) ledger = d.ledger;
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
      ? `${value.toLocaleString('ja-JP')}×${c}=¥${(value * c).toLocaleString('ja-JP')}`
      : '';
  }
}

function recalc() {
  let total = 0;
  ALL.forEach(d => { total += d.value * counts[d.value]; });
  const diff = total - ledger;

  document.getElementById('totalDisplay').textContent  = '¥' + total.toLocaleString('ja-JP');
  document.getElementById('ledgerDisplay').textContent = '¥' + ledger.toLocaleString('ja-JP');

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

/* ── DOM構築（金種行） ─────────────────────────── */
function buildRows(list, containerId) {
  const container = document.getElementById(containerId);
  list.forEach(d => {
    const row = document.createElement('div');
    row.className    = 'denom-row';
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
   ─────────────────────────────────────────────────────
   .pk-drum-wrap  height: 200px  (= DRUM_H)
   .pk-col        height: 100%   → 200px  ← ラベルを外に出したので正確
   .pk-item       height: 40px   (= ITEM_H)

   中心ライン (px from top of .pk-col) = DRUM_H / 2 = 100

   index 番目のアイテム中心を中心ラインに合わせる translateY:
     y + index * ITEM_H + ITEM_H/2 = 100
     y = 100 - ITEM_H/2 - index * ITEM_H
     y(index=0) = 100 - 20 - 0 = 80  = CENTER_Y
   ===================================================== */
const ITEM_H   = 40;
const DRUM_H   = 200;
const CENTER_Y = DRUM_H / 2 - ITEM_H / 2;  // 80

/* =====================================================
   DrumCol クラス
   ===================================================== */
class DrumCol {
  constructor(colEl, innerEl, count) {
    this.colEl   = colEl;
    this.innerEl = innerEl;
    this.count   = count;
    this.index   = 0;        // 確定インデックス（常に整数）
    this._baseY  = CENTER_Y; // ドラッグ開始時の currentY
    this._rafId  = null;
    this._pendingY = null;
    this._dragging = false;
    this._startClientY = 0;
    this._lastClientY  = 0;
    this._lastT        = 0;
    this._velocity     = 0;  // px/ms (EMA)
    this._onChangeCb   = null;

    // 初期位置・GPU昇格
    this.innerEl.style.willChange = 'transform';
    this._applyY(CENTER_Y, false);

    this._bindEvents();
  }

  /* ── 公開 API ── */
  setIndex(idx, animated = false) {
    this._cancelRaf();
    this.index  = this._clamp(idx);
    const y     = this._snapY(this.index);
    this._baseY = y;
    this._applyY(y, animated);
    this._onChangeCb && this._onChangeCb(this.index);
  }

  onChange(cb) { this._onChangeCb = cb; }

  /* ── 内部 ── */

  /** index の正しいスナップ位置 */
  _snapY(idx) {
    return CENTER_Y - idx * ITEM_H;
  }

  /** 現在の style.transform から translateY を読む */
  _readY() {
    const m = this.innerEl.style.transform.match(/translateY\(\s*(-?[\d.]+)px\s*\)/);
    return m ? parseFloat(m[1]) : CENTER_Y;
  }

  _clamp(v) {
    return Math.max(0, Math.min(this.count - 1, Math.round(v)));
  }

  _applyY(y, animated) {
    this.innerEl.style.transition = animated
      ? 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      : 'none';
    this.innerEl.style.transform = `translateY(${y}px)`;
  }

  _cancelRaf() {
    if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    this._pendingY = null;
  }

  _scheduleRaf(y) {
    this._pendingY = y;
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (this._pendingY === null) return;
      // transition なしで直接適用（ドラッグ中）
      this.innerEl.style.transition = 'none';
      this.innerEl.style.transform  = `translateY(${this._pendingY}px)`;
      this._pendingY = null;
    });
  }

  /* ── ドラッグ処理 ── */
  _onStart(clientY) {
    this._cancelRaf();
    // 現在の実際の Y を読み取る（トランジション途中でも正確に追従）
    this._baseY        = this._readY();
    this.innerEl.style.transition = 'none';

    this._dragging     = true;
    this._startClientY = clientY;
    this._lastClientY  = clientY;
    this._lastT        = performance.now();
    this._velocity     = 0;
  }

  _onMove(clientY) {
    if (!this._dragging) return;
    const now = performance.now();
    const dt  = Math.max(now - this._lastT, 1);

    // EMA 速度
    const rawV     = (clientY - this._lastClientY) / dt;
    this._velocity = this._velocity * 0.6 + rawV * 0.4;
    this._lastClientY = clientY;
    this._lastT       = now;

    const dy    = clientY - this._startClientY;
    let   newY  = this._baseY + dy;

    // ゴム引き
    const minY  = this._snapY(this.count - 1);
    const maxY  = this._snapY(0);              // = CENTER_Y
    const RUB   = 0.25;
    if      (newY > maxY) newY = maxY + (newY - maxY) * RUB;
    else if (newY < minY) newY = minY + (newY - minY) * RUB;

    this._scheduleRaf(newY);
  }

  _onEnd() {
    if (!this._dragging) return;
    this._dragging = false;
    this._cancelRaf();

    // 現在位置 → 浮動インデックス
    const curY     = this._readY();
    const floatIdx = (CENTER_Y - curY) / ITEM_H;

    // 慣性フリック
    const THRESH   = 0.15; // px/ms
    let   target;
    if (Math.abs(this._velocity) > THRESH) {
      target = floatIdx - (this._velocity * 80) / ITEM_H;
    } else {
      target = floatIdx;
    }

    const newIdx = this._clamp(target);
    this.index   = newIdx;
    const snapY  = this._snapY(newIdx);
    this._baseY  = snapY;

    this._applyY(snapY, true);
    this._onChangeCb && this._onChangeCb(this.index);
  }

  _onCancel() {
    if (!this._dragging) return;
    this._dragging = false;
    this._cancelRaf();
    const snapY = this._snapY(this.index);
    this._baseY = snapY;
    this._applyY(snapY, true);
  }

  /* ── イベントバインド ── */
  _bindEvents() {
    const el = this.colEl;

    /* Touch（iOS Safari メイン） */
    el.addEventListener('touchstart', e => {
      e.preventDefault();    // スクロール競合防止・必須
      e.stopPropagation();
      if (e.touches.length !== 1) return;
      this._onStart(e.touches[0].clientY);
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      e.preventDefault();    // スクロール競合防止・必須
      e.stopPropagation();
      if (e.touches.length !== 1) return;
      this._onMove(e.touches[0].clientY);
    }, { passive: false });

    el.addEventListener('touchend', e => {
      e.preventDefault();    // 意図しないクリック防止
      e.stopPropagation();
      this._onEnd();
    }, { passive: false });

    el.addEventListener('touchcancel', e => {
      e.stopPropagation();
      this._onCancel();
    }, { passive: true });

    /* Pointer（デスクトップ確認用） */
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this._onStart(e.clientY);
    }, { passive: false });

    el.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || !this._dragging) return;
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
   ピッカーシート 共通
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

/* ハンドルを下ドラッグでシートを閉じる */
function bindSheetDrag(handleEl, sheetEl, onClose) {
  let startY = 0, dragging = false;
  handleEl.addEventListener('touchstart', e => {
    dragging = true;
    startY   = e.touches[0].clientY;
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
   枚数ピッカー（各金種共用・1列）
   ===================================================== */
const COUNT_MAX = 99;
let countPickerDenom = null;
let countPickerDrum  = null;

function buildCountPicker() {
  const inner = document.getElementById('countInner');
  inner.innerHTML = '';
  for (let i = 0; i <= COUNT_MAX; i++) {
    const item       = document.createElement('div');
    item.className   = 'pk-item';
    item.textContent = String(i);
    inner.appendChild(item);
  }

  countPickerDrum = new DrumCol(
    document.getElementById('countCol'),
    inner,
    COUNT_MAX + 1
  );

  countPickerDrum.onChange(idx => {
    if (!countPickerDenom) return;
    const preview = document.getElementById('countPreview');
    preview.textContent = idx > 0
      ? `${countPickerDenom.value.toLocaleString('ja-JP')} × ${idx} = ¥${(countPickerDenom.value * idx).toLocaleString('ja-JP')}`
      : '0枚';
  });

  bindSheetDrag(
    document.getElementById('countHandle'),
    document.getElementById('countSheet'),
    () => closeCountPicker(false)
  );
}

function openCountPicker(denom) {
  countPickerDenom = denom;
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
   帳簿残高 — input[type=number] 直接入力
   ===================================================== */
function initLedgerInput() {
  const input = document.getElementById('ledgerInput');

  // 保存値を表示
  if (ledger > 0) input.value = String(ledger);

  input.addEventListener('input', () => {
    const raw = parseInt(input.value, 10);
    ledger = (!isNaN(raw) && raw >= 0) ? raw : 0;
    recalc();
    save();
  });

  // 負数・小数の入力を弾く
  input.addEventListener('blur', () => {
    const raw = parseInt(input.value, 10);
    if (isNaN(raw) || raw < 0) {
      input.value = '';
      ledger = 0;
    } else {
      input.value = String(raw);
      ledger = raw;
    }
    recalc();
    save();
  });
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
  ALL.forEach(d => { counts[d.value] = 0; refreshRow(d.value, false); });
  ledger = 0;
  const input = document.getElementById('ledgerInput');
  if (input) input.value = '';
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
  initLedgerInput();

  ALL.forEach(d => refreshRow(d.value, false));
  recalc();

  document.getElementById('countCancel').addEventListener('click',  () => closeCountPicker(false));
  document.getElementById('countDone').addEventListener('click',    () => closeCountPicker(true));
  document.getElementById('countOverlay').addEventListener('click', () => closeCountPicker(false));

  document.getElementById('resetBtn').addEventListener('click', () => {
    showConfirm('リセットの確認', 'すべての枚数と帳簿残額をリセットします。', doReset);
  });

  // input 以外でのテキスト選択を禁止
  document.addEventListener('selectstart', e => {
    if (!e.target.closest('input')) e.preventDefault();
  });
}

document.addEventListener('DOMContentLoaded', init);
