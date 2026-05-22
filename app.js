/* ===================================================
   お金カウンター – app.js
   =================================================== */

'use strict';

// ── 金種定義 ──────────────────────────────────────────
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

const ALL_DENOMS = [...BILLS, ...COINS];

// ── 状態 ─────────────────────────────────────────────
const counts   = {};
let   ledger   = 0;            // 帳簿残額

ALL_DENOMS.forEach(d => { counts[d.value] = 0; });

// ── ローカルストレージ ─────────────────────────────
const STORAGE_KEY = 'okane-counter-v1';

function saveState() {
  const data = { counts: {}, ledger };
  ALL_DENOMS.forEach(d => { data.counts[d.value] = counts[d.value]; });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.counts) {
      ALL_DENOMS.forEach(d => {
        const v = parseInt(data.counts[d.value], 10);
        if (!isNaN(v) && v >= 0) counts[d.value] = v;
      });
    }
    if (typeof data.ledger === 'number' && !isNaN(data.ledger)) {
      ledger = data.ledger;
    }
  } catch(_) {}
}

// ── DOM構築：金種行 ────────────────────────────────
function buildRows(denominations, containerId) {
  const container = document.getElementById(containerId);
  denominations.forEach(d => {
    const row = document.createElement('div');
    row.className = 'denom-row';
    row.innerHTML = `
      <div class="denom-label">${d.label}</div>
      <div class="denom-controls">
        <button class="btn btn-minus" data-value="${d.value}" data-delta="-1" disabled>−</button>
        <div class="count-display">
          <span class="count-num" id="count-${d.value}">0</span>
          <div class="count-unit">枚</div>
        </div>
        <button class="btn btn-plus" data-value="${d.value}" data-delta="1">＋</button>
      </div>
      <div class="subtotal" id="subtotal-${d.value}"></div>
    `;
    container.appendChild(row);
  });
}

// ── 表示更新 ──────────────────────────────────────
function updateCountUI(value, animate = true) {
  const c   = counts[value];
  const el  = document.getElementById(`count-${value}`);
  const sub = document.getElementById(`subtotal-${value}`);
  const mb  = document.querySelector(`.btn-minus[data-value="${value}"]`);

  el.textContent = c;
  mb.disabled    = (c === 0);

  // 小計
  const subtotalVal = value * c;
  sub.textContent = c > 0
    ? `${value.toLocaleString('ja-JP')} × ${c} = ${subtotalVal.toLocaleString('ja-JP')}円`
    : '';

  if (animate) {
    el.classList.remove('animate');
    void el.offsetWidth;
    el.classList.add('animate');
  }
}

function recalc() {
  let total = 0;
  ALL_DENOMS.forEach(d => { total += d.value * counts[d.value]; });

  const diff = total - ledger;

  document.getElementById('totalDisplay').textContent  = '¥' + total.toLocaleString('ja-JP');
  document.getElementById('ledgerDisplay').textContent = '¥' + ledger.toLocaleString('ja-JP');

  const diffEl = document.getElementById('diffDisplay');
  if (diff > 0) {
    diffEl.textContent = '+' + diff.toLocaleString('ja-JP') + '円';
    diffEl.className = 'diff-value positive';
  } else if (diff < 0) {
    diffEl.textContent = diff.toLocaleString('ja-JP') + '円';
    diffEl.className = 'diff-value negative';
  } else {
    diffEl.textContent = '±0円';
    diffEl.className = 'diff-value zero';
  }

  // 帳簿トリガー表示
  document.getElementById('ledgerValueDisplay').textContent =
    ledger > 0 ? ledger.toLocaleString('ja-JP') : '0';
}

function updateCount(value, delta) {
  const newVal = counts[value] + delta;
  if (newVal < 0) return;
  counts[value] = newVal;
  updateCountUI(value, true);
  recalc();
  saveState();
}

// ── 長押し制御 ────────────────────────────────────
// 仕様: 短押し→1回だけ / 長押し→最初の1回なしで連続
const LONG_PRESS_DELAY = 400;    // ms後に連続開始
const REPEAT_INTERVAL  = 100;    // ms間隔で連続
const RUNAWAY_MARGIN   = 30;     // px: ボタン境界からこれ以上離れたら停止

let pressState = {
  active:    false,
  value:     null,
  delta:     null,
  btn:       null,
  timer:     null,
  interval:  null,
  startX:    0,
  startY:    0,
  isLong:    false,
};

function clearPress() {
  if (pressState.timer)    { clearTimeout(pressState.timer);   pressState.timer    = null; }
  if (pressState.interval) { clearInterval(pressState.interval); pressState.interval = null; }
  if (pressState.btn)      { pressState.btn.classList.remove('pressing'); }
  pressState.active  = false;
  pressState.isLong  = false;
  pressState.btn     = null;
}

function startPress(value, delta, btn, x, y) {
  clearPress();
  pressState.active  = true;
  pressState.value   = value;
  pressState.delta   = delta;
  pressState.btn     = btn;
  pressState.startX  = x;
  pressState.startY  = y;
  pressState.isLong  = false;
  btn.classList.add('pressing');

  // 長押し開始：LONG_PRESS_DELAY後に連続モードへ（最初の1回は短押しで処理）
  pressState.timer = setTimeout(() => {
    pressState.isLong = true;
    pressState.interval = setInterval(() => {
      if (!pressState.active) { clearPress(); return; }
      updateCount(pressState.value, pressState.delta);
    }, REPEAT_INTERVAL);
  }, LONG_PRESS_DELAY);
}

function endPress(isShortTap) {
  if (!pressState.active) return;
  const wasLong = pressState.isLong;
  clearPress();
  // 短押しの場合のみ1回実行
  if (isShortTap && !wasLong && pressState.value !== null) {
    // すでにclearPressでbtnをnullにしているのでvalueを先に保存
  }
}

// ボタン外スライド検知
document.addEventListener('pointermove', e => {
  if (!pressState.active || !pressState.btn) return;
  const rect = pressState.btn.getBoundingClientRect();
  const outside =
    e.clientX < rect.left   - RUNAWAY_MARGIN ||
    e.clientX > rect.right  + RUNAWAY_MARGIN ||
    e.clientY < rect.top    - RUNAWAY_MARGIN ||
    e.clientY > rect.bottom + RUNAWAY_MARGIN;
  if (outside) clearPress();
}, { passive: true });

// イベント委任
document.addEventListener('pointerdown', e => {
  const btn = e.target.closest('.btn');
  if (!btn || btn.disabled) return;
  e.preventDefault();

  const value = parseInt(btn.dataset.value, 10);
  const delta = parseInt(btn.dataset.delta, 10);

  startPress(value, delta, btn, e.clientX, e.clientY);
}, { passive: false });

document.addEventListener('pointerup', e => {
  if (!pressState.active) return;
  const wasLong = pressState.isLong;
  const value   = pressState.value;
  const delta   = pressState.delta;
  clearPress();
  // 短押しのとき1回だけ実行
  if (!wasLong && value !== null) {
    updateCount(value, delta);
  }
});

document.addEventListener('pointercancel', () => clearPress());

// アニメーション終了
document.addEventListener('animationend', e => {
  if (e.target.classList.contains('count-num')) {
    e.target.classList.remove('animate');
  }
});

// ── ドラムロールピッカー ───────────────────────────

// 列定義: [ラベル, アイテム数, 最大桁の特例]
// 万: 0〜99, 千〜一: 0〜9
const PICKER_COLS = [
  { label: '万', count: 100, multiplier: 10000 },
  { label: '千', count:  10, multiplier:  1000 },
  { label: '百', count:  10, multiplier:   100 },
  { label: '十', count:  10, multiplier:    10 },
  { label: '一', count:  10, multiplier:     1 },
];

const ITEM_H  = 44;   // px
const PADDING = 3;    // 表示パディング（上下の余分アイテム数）

// ピッカーの各列の状態
const pickerState = PICKER_COLS.map(() => ({
  index: 0,       // 現在の選択インデックス
  offset: 0,      // 現在のpx offset (アニメ中)
  dragging: false,
  dragStartY: 0,
  dragStartOffset: 0,
  velocity: 0,
  lastY: 0,
  lastT: 0,
  rafId: null,
}));

let pickerOpen = false;
let pickerTempValue = 0;  // ピッカー操作中の一時値

function ledgerToPickerIndices(val) {
  const indices = [];
  let remaining = Math.max(0, Math.min(val, 999999));
  PICKER_COLS.forEach(col => {
    const digit = Math.floor(remaining / col.multiplier);
    indices.push(digit);
    remaining -= digit * col.multiplier;
  });
  return indices;
}

function pickerIndicesToValue(indices) {
  let val = 0;
  PICKER_COLS.forEach((col, i) => { val += indices[i] * col.multiplier; });
  return val;
}

function buildPicker() {
  const body = document.getElementById('pickerBody');
  body.innerHTML = '';

  // ハイライト
  const hl = document.createElement('div');
  hl.className = 'picker-highlight';
  body.appendChild(hl);

  PICKER_COLS.forEach((col, ci) => {
    const wrap = document.createElement('div');
    wrap.className = 'picker-col-wrap';

    const label = document.createElement('div');
    label.className = 'picker-col-label';
    label.textContent = col.label;

    const colEl = document.createElement('div');
    colEl.className = 'picker-col';
    colEl.id = `picker-col-${ci}`;

    const inner = document.createElement('div');
    inner.className = 'picker-col-inner';
    inner.id = `picker-inner-${ci}`;

    // アイテム生成（上下PADDING分の余裕）
    for (let i = 0; i < col.count; i++) {
      const item = document.createElement('div');
      item.className = 'picker-item';
      item.textContent = ci === 0 ? String(i) : String(i);
      inner.appendChild(item);
    }

    colEl.appendChild(inner);
    wrap.appendChild(label);
    wrap.appendChild(colEl);
    body.appendChild(wrap);

    setupPickerColEvents(ci, colEl, inner, col.count);
  });
}

function getPickerOffset(ci) {
  // offset = -(index * ITEM_H) + center
  // center = bodyHeight/2 - ITEM_H/2 = 110 - 22 = 88
  const CENTER_OFFSET = 88;
  return CENTER_OFFSET - pickerState[ci].index * ITEM_H + pickerState[ci].offset;
}

function applyPickerTransform(ci, inner, animated = false) {
  const y = getPickerOffset(ci);
  inner.style.transition = animated ? 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
  inner.style.transform  = `translateY(${y}px)`;
}

function clampIndex(ci, idx) {
  return Math.max(0, Math.min(PICKER_COLS[ci].count - 1, Math.round(idx)));
}

function snapPickerCol(ci) {
  const inner = document.getElementById(`picker-inner-${ci}`);
  if (!inner) return;
  pickerState[ci].index  = clampIndex(ci, pickerState[ci].index + pickerState[ci].offset / -ITEM_H);
  pickerState[ci].offset = 0;
  applyPickerTransform(ci, inner, true);
  updatePickerPreview();
}

function flingPickerCol(ci, velocity) {
  const inner = document.getElementById(`picker-inner-${ci}`);
  if (!inner) return;

  const state = pickerState[ci];
  const maxI  = PICKER_COLS[ci].count - 1;

  // velocity: px/ms → 慣性でどれだけ飛ぶか
  const flyDistance = velocity * 120;  // 減衰係数
  const rawNewIndex = state.index - flyDistance / ITEM_H;
  const newIndex    = Math.max(0, Math.min(maxI, Math.round(rawNewIndex)));

  state.index  = newIndex;
  state.offset = 0;
  applyPickerTransform(ci, inner, true);
  updatePickerPreview();
}

function setPickerIndex(ci, idx, animated = false) {
  const inner = document.getElementById(`picker-inner-${ci}`);
  if (!inner) return;
  pickerState[ci].index  = clampIndex(ci, idx);
  pickerState[ci].offset = 0;
  applyPickerTransform(ci, inner, animated);
}

function setupPickerColEvents(ci, colEl, inner, count) {
  const state = pickerState[ci];

  function onDragStart(y) {
    state.dragging        = true;
    state.dragStartY      = y;
    state.dragStartOffset = state.offset;
    state.lastY           = y;
    state.lastT           = Date.now();
    state.velocity        = 0;
    inner.style.transition = 'none';
  }

  function onDragMove(y) {
    if (!state.dragging) return;
    const dy  = y - state.dragStartY;
    const now = Date.now();
    const dt  = Math.max(now - state.lastT, 1);
    state.velocity = (y - state.lastY) / dt;
    state.lastY    = y;
    state.lastT    = now;

    // ゴム引きクランプ
    const maxI     = count - 1;
    const rawIndex = state.index - dy / ITEM_H;
    if (rawIndex < 0) {
      // 先頭を超えようとしている：ゴム引き
      state.offset = state.index * ITEM_H + dy * 0.35;
    } else if (rawIndex > maxI) {
      // 末尾を超えようとしている：ゴム引き
      const overDy = dy - (state.index - maxI) * ITEM_H;
      state.offset = (state.index - maxI) * ITEM_H + overDy * 0.35;
    } else {
      state.offset = dy;
    }
    applyPickerTransform(ci, inner, false);
  }

  function onDragEnd() {
    if (!state.dragging) return;
    state.dragging = false;
    // 慣性フリック or スナップ
    if (Math.abs(state.velocity) > 0.25) {
      flingPickerCol(ci, state.velocity);
    } else {
      state.index  = clampIndex(ci, state.index - state.offset / ITEM_H);
      state.offset = 0;
      applyPickerTransform(ci, inner, true);
      updatePickerPreview();
    }
  }

  // Touch events（Safari iOS）
  colEl.addEventListener('touchstart', e => {
    e.preventDefault();
    onDragStart(e.touches[0].clientY);
  }, { passive: false });

  colEl.addEventListener('touchmove', e => {
    e.preventDefault();
    onDragMove(e.touches[0].clientY);
  }, { passive: false });

  colEl.addEventListener('touchend', e => {
    e.preventDefault();
    onDragEnd();
  }, { passive: false });

  // Pointer events（デスクトップ・テスト用）
  colEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return; // touchに任せる
    e.preventDefault();
    colEl.setPointerCapture(e.pointerId);
    onDragStart(e.clientY);
  });

  colEl.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    onDragMove(e.clientY);
  });

  colEl.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') return;
    onDragEnd();
  });

  colEl.addEventListener('pointercancel', e => {
    if (e.pointerType === 'touch') return;
    state.dragging = false;
    snapPickerCol(ci);
  });
}

function updatePickerPreview() {
  const indices = pickerState.map(s => s.index);
  const val = pickerIndicesToValue(indices);
  const el  = document.getElementById('pickerPreview');
  if (el) el.textContent = '¥ ' + val.toLocaleString('ja-JP');
}

function openPicker() {
  if (pickerOpen) return;
  pickerOpen = true;

  // 現在の帳簿残額をピッカーに反映
  const indices = ledgerToPickerIndices(ledger);
  PICKER_COLS.forEach((_, ci) => {
    setPickerIndex(ci, indices[ci], false);
    // 即座にtransformを更新
    const inner = document.getElementById(`picker-inner-${ci}`);
    if (inner) applyPickerTransform(ci, inner, false);
  });
  updatePickerPreview();

  document.getElementById('pickerOverlay').classList.add('visible');
  document.getElementById('pickerSheet').classList.add('visible');
}

function closePicker(apply) {
  if (!pickerOpen) return;
  pickerOpen = false;

  if (apply) {
    const indices = pickerState.map(s => s.index);
    ledger = pickerIndicesToValue(indices);
    recalc();
    saveState();
  }

  document.getElementById('pickerOverlay').classList.remove('visible');
  document.getElementById('pickerSheet').classList.remove('visible');
}

// シートのドラッグで閉じる
function setupSheetDrag() {
  const sheet = document.getElementById('pickerSheet');
  let startY = 0, startTranslate = 0, isDragging = false;

  function getTranslate() {
    const t = sheet.style.transform;
    if (!t || t === 'translateY(0%)' || t === 'translateY(0px)') return 0;
    const m = t.match(/translateY\((.+?)px\)/);
    return m ? parseFloat(m[1]) : 0;
  }

  const handle = document.getElementById('pickerHandle');

  handle.addEventListener('touchstart', e => {
    isDragging    = true;
    startY        = e.touches[0].clientY;
    startTranslate = 0;
    sheet.style.transition = 'none';
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!isDragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      sheet.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!isDragging) return;
    isDragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    sheet.style.transition = '';
    if (dy > 80) {
      closePicker(false);
    } else {
      sheet.style.transform = 'translateY(0)';
    }
  }, { passive: true });
}

// ── 確認モーダル ──────────────────────────────────
function showConfirm(title, message, onOk) {
  document.getElementById('confirmTitle').textContent   = title;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmOverlay').classList.add('visible');

  const doReset = document.getElementById('confirmDoReset');
  const cancel  = document.getElementById('confirmCancel');

  function cleanup() {
    document.getElementById('confirmOverlay').classList.remove('visible');
    doReset.removeEventListener('click', onConfirm);
    cancel.removeEventListener('click', onCancel);
  }

  function onConfirm() { cleanup(); onOk(); }
  function onCancel()  { cleanup(); }

  doReset.addEventListener('click', onConfirm);
  cancel.addEventListener('click',  onCancel);
}

// ── リセット処理 ──────────────────────────────────
function doReset() {
  ALL_DENOMS.forEach(d => {
    counts[d.value] = 0;
    updateCountUI(d.value, false);
  });
  ledger = 0;
  recalc();
  saveState();
}

// ── 初期化 ────────────────────────────────────────
function init() {
  loadState();

  buildRows(BILLS, 'billRows');
  buildRows(COINS, 'coinRows');
  buildPicker();
  setupSheetDrag();

  // 保存データを表示に反映
  ALL_DENOMS.forEach(d => updateCountUI(d.value, false));
  recalc();

  // 帳簿入力トリガー
  document.getElementById('ledgerTrigger').addEventListener('click', openPicker);

  // ピッカーボタン
  document.getElementById('pickerCancel').addEventListener('click', () => closePicker(false));
  document.getElementById('pickerDone').addEventListener('click',   () => closePicker(true));

  // オーバーレイタップで閉じる
  document.getElementById('pickerOverlay').addEventListener('click', () => closePicker(false));

  // リセットボタン
  document.getElementById('resetBtn').addEventListener('click', () => {
    showConfirm(
      'リセットの確認',
      'すべての枚数と帳簿残額をリセットします。',
      doReset
    );
  });

  // テキスト選択禁止
  document.addEventListener('selectstart', e => {
    if (e.target.closest('.btn')) e.preventDefault();
  });
}

document.addEventListener('DOMContentLoaded', init);
