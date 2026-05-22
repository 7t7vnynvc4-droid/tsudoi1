// 金種データの定義
const denominations = [
    { value: 10000, label: '1万円札' },
    { value: 5000, label: '5千円札' },
    { value: 1000, label: '千円札' },
    { value: 500, label: '500円玉' },
    { value: 100, label: '100円玉' },
    { value: 50, label: '50円玉' },
    { value: 10, label: '10円玉' },
    { value: 5, label: '5円玉' },
    { value: 1, label: '1円玉' }
];

const container = document.getElementById('denom-container');
const bookBalanceInput = document.getElementById('book-balance');

// HTML生成：各金種のドラムロール(0〜99)を作成
denominations.forEach(denom => {
    const row = document.createElement('div');
    row.className = 'denom-row';

    const label = document.createElement('div');
    label.className = 'denom-label';
    label.textContent = denom.label;

    const select = document.createElement('select');
    select.className = 'denom-picker';
    select.id = `denom-${denom.value}`;
    
    for (let i = 0; i <= 99; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `${i} 枚`;
        select.appendChild(option);
    }

    select.addEventListener('change', calculateTotal);

    const subtotal = document.createElement('div');
    subtotal.className = 'denom-subtotal';
    subtotal.id = `subtotal-${denom.value}`;
    subtotal.textContent = '0 円';

    row.appendChild(label);
    row.appendChild(select);
    row.appendChild(subtotal);
    container.appendChild(row);
});

// テンキーの入力処理
function appendNumber(num) {
    let current = bookBalanceInput.value;
    if (current === "0") {
        current = num.toString();
    } else {
        current += num.toString();
    }
    bookBalanceInput.value = current;
    calculateTotal();
}

// 帳簿残高クリア機能
function clearBalance() {
    bookBalanceInput.value = "0";
    calculateTotal();
}

// 計算メインロジック
function calculateTotal() {
    let totalCash = 0;

    denominations.forEach(denom => {
        const count = parseInt(document.getElementById(`denom-${denom.value}`).value) || 0;
        const subtotal = denom.value * count;
        totalCash += subtotal;
        
        document.getElementById(`subtotal-${denom.value}`).textContent = `${subtotal.toLocaleString()} 円`;
    });

    document.getElementById('total-cash').textContent = totalCash.toLocaleString();

    const bookBalance = parseInt(bookBalanceInput.value) || 0;
    const diff = totalCash - bookBalance;
    const diffEl = document.getElementById('diff-balance');
    
    diffEl.textContent = diff.toLocaleString();

    diffEl.className = '';
    if (diff === 0) {
        diffEl.classList.add('zero');
    } else if (diff > 0) {
        diffEl.classList.add('success');
        diffEl.textContent = `+${diff.toLocaleString()}`;
    } else {
        diffEl.classList.add('error');
    }
}

// PWA サービスワーカーの登録
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW registered', reg))
            .catch(err => console.error('SW registration failed', err));
    });
}
