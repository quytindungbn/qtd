// Các hàm tiện ích dùng chung: định dạng tiền, ngày, id, rng...

export function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Định dạng số nguyên kiểu VN: 1234567 -> "1.234.567" */
export function formatNumber(n) {
  return Math.round(n || 0).toLocaleString('vi-VN');
}

/** Định dạng tiền tệ đầy đủ: 225000 -> "225.000 ₫" */
export function formatVND(n) {
  return `${formatNumber(n)} ₫`;
}

/** Định dạng rút gọn cho số liệu nổi bật: 1020000 -> "1,02 triệu" */
export function formatCompact(n) {
  const v = Math.round(n || 0);
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${trimNum(v / 1e9)} tỷ`;
  if (abs >= 1e6) return `${trimNum(v / 1e6)} triệu`;
  if (abs >= 1e3) return formatNumber(v);
  return formatNumber(v);
}

function trimNum(n) {
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

const WEEKDAYS = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const MONTHS = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12'];

export function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${dt.getFullYear()}`;
}

export function formatDateTime(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mi} ${formatDate(dt)}`;
}

export function formatRelativeShort(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${MONTHS[dt.getMonth()]}`;
}

export function startOfDay(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

/** RNG có seed để tạo dữ liệu mẫu ổn định */
export function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

const PALETTE = ['#2f6fed', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f'];
export function colorFor(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
/** Màu theo vị trí (đảm bảo không trùng nhau trong 1 danh sách ngắn) */
export function colorAt(index) {
  return PALETTE[index % PALETTE.length];
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Bỏ dấu tiếng Việt, in hoa — dùng cho nội dung chuyển khoản ngân hàng (thường yêu cầu không dấu). */
export function stripDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Che bớt số CCCD khi hiển thị, vd: 023xxxxxxxxx -> 023•••••6789 */
export function maskCccd(cccd) {
  const s = String(cccd || '');
  if (s.length <= 7) return s;
  return s.slice(0, 3) + '•'.repeat(s.length - 7) + s.slice(-4);
}

/** Số ngày còn lại đến hạn (âm = đã quá hạn) */
export function daysUntil(dateStr) {
  return daysBetween(new Date(), new Date(dateStr));
}

/**
 * Gắn định dạng "1.500.000" (dấu chấm ngăn cách hàng nghìn) tự động khi gõ
 * vào 1 ô input tiền — dùng cho input type="text" (KHÔNG dùng type="number"
 * vì trình duyệt không cho hiện dấu chấm trong ô number). `allowNegative`
 * cho phép gõ dấu "-" ở đầu (dùng cho ô "góp/rút" có thể âm).
 */
export function attachMoneyInput(inputEl, { allowNegative = false } = {}) {
  inputEl.setAttribute('inputmode', 'numeric');
  inputEl.addEventListener('input', () => {
    const negative = allowNegative && inputEl.value.trim().startsWith('-');
    const digits = inputEl.value.replace(/\D/g, '');
    inputEl.value = (negative ? '-' : '') + (digits ? formatNumber(Number(digits)) : '');
  });
}

/** Đọc lại số thật từ ô đã định dạng attachMoneyInput() ở trên (bỏ dấu chấm). */
export function unformatMoney(str) {
  const negative = String(str ?? '').trim().startsWith('-');
  const digits = String(str ?? '').replace(/\D/g, '');
  const n = digits ? Number(digits) : 0;
  return negative ? -n : n;
}
