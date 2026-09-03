// ============================================================
// Lớp dữ liệu & nghiệp vụ trung tâm (state) cho app "Sổ Chi Tiêu" — kết nối
// Supabase thật (xem docs/expense-app-setup.md): đăng nhập, danh mục, giao
// dịch, ngân sách, giao dịch định kỳ, mục tiêu tiết kiệm, thành viên đều
// đọc/ghi qua Supabase (Edge Function cho thao tác nhạy cảm liên quan mật
// khẩu/tài khoản, còn lại đi thẳng qua Row Level Security). `state` object
// trong file này đóng vai trò CACHE trong bộ nhớ (+ lưu tạm vào localStorage
// để mở lại app không bị trắng trang / giữ được phiên đăng nhập) — mọi hàm
// ghi đều gọi Supabase trước, thành công mới cập nhật cache + notify() để
// vẽ lại màn hình.
// ============================================================
import { genId, colorAt } from './utils.js';
import { getSupabaseClient, callLoginFunction, callAccountFunction } from './lib/supabaseClient.js';

export const STORAGE_KEY = 'chitieu_v1';

export const CATEGORY_ICONS = ['home', 'cart', 'truck', 'store', 'film', 'heart', 'book', 'wallet', 'gift', 'trendingUp', 'building', 'tag'];

const DEFAULT_CATEGORIES = [
  { name: 'Ăn uống', type: 'expense', icon: 'cart' },
  { name: 'Di chuyển', type: 'expense', icon: 'truck' },
  { name: 'Nhà ở & hóa đơn', type: 'expense', icon: 'home' },
  { name: 'Mua sắm', type: 'expense', icon: 'store' },
  { name: 'Giải trí', type: 'expense', icon: 'film' },
  { name: 'Sức khỏe', type: 'expense', icon: 'heart' },
  { name: 'Giáo dục', type: 'expense', icon: 'book' },
  { name: 'Khác', type: 'expense', icon: 'tag' },
  { name: 'Lương', type: 'income', icon: 'wallet' },
  { name: 'Thưởng', type: 'income', icon: 'gift' },
  { name: 'Thu nhập khác', type: 'income', icon: 'trendingUp' },
];

let state = null;
const listeners = new Set();
function notify() { persist(); listeners.forEach((fn) => fn()); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getState() { return state; }
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('Không lưu được dữ liệu', e); }
}
function emptyState() {
  return {
    settings: { householdName: 'Sổ chi tiêu của tôi', currency: 'đ' },
    users: [], categories: [], transactions: [], budgets: [], recurring: [], savingsGoals: [], plans: [], debts: [], debtPayments: [],
    session: null,
  };
}

export async function init() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = JSON.parse(raw); } catch (e) { console.warn('Dữ liệu cache lỗi, tạo lại.', e); state = emptyState(); }
  } else {
    state = emptyState();
  }
  // Tên sổ là DUY NHẤT thứ cần hiện ra TRƯỚC khi đăng nhập (màn đăng nhập
  // hiện tên sổ) — tải thẳng từ Supabase ngay lúc khởi động app. Bảng
  // app_settings cho phép SELECT công khai, chỉ cần anon key.
  await loadSettingsPublic();
  // Có sẵn phiên đăng nhập từ lần trước (localStorage) -> tải lại dữ liệu
  // mới nhất từ Supabase ngay (cache cũ chỉ để vẽ tạm cho khỏi trắng trang).
  if (state.session?.sbToken) {
    try { await loadSessionData(state.session.sbToken); }
    catch (e) { console.warn('Không tải lại được dữ liệu phiên cũ.', e); }
  }
  persist();
}

async function loadSettingsPublic() {
  try {
    const sb = getSupabaseClient();
    const { data } = await sb.from('app_settings').select('*').eq('id', 'main').maybeSingle();
    if (data) state.settings = mapSettingsRow(data);
  } catch (e) {
    console.warn('Không tải được tên sổ từ Supabase.', e);
  }
}
function mapSettingsRow(row) {
  return { householdName: row.household_name, currency: row.currency || 'đ' };
}

// ------------------------------------------------------------
// Cài đặt sổ (tên sổ, đơn vị tiền) — chỉ owner sửa được (chặn bằng RLS)
// ------------------------------------------------------------
export function getSettings() { return state.settings; }
export async function updateSettings(patch) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const dbPatch = {};
  if (patch.householdName !== undefined) dbPatch.household_name = patch.householdName;
  if (patch.currency !== undefined) dbPatch.currency = patch.currency;
  const { error } = await sb.from('app_settings').update(dbPatch).eq('id', 'main');
  if (error) throw new Error('Không lưu được cài đặt, thử lại sau.');
  Object.assign(state.settings, patch);
  notify();
}

// ------------------------------------------------------------
// Đăng nhập / phiên làm việc
// ------------------------------------------------------------
export async function login(identifier, password) {
  const res = await callLoginFunction({ identifier, password });
  if (!res.ok) return { ok: false, reason: res.reason };
  await loadSessionData(res.token);
  return { ok: true, userId: res.id, role: res.role, mustChangePassword: !!res.mustChangePassword, sbToken: res.token };
}

async function loadSessionData(token) {
  const sb = getSupabaseClient(token);
  const [{ data: userRows }, { data: catRows }, { data: txnRows }, { data: budgetRows }, { data: recRows }, { data: goalRows }, { data: planRows }, { data: debtRows }, { data: debtPayRows }] = await Promise.all([
    sb.from('user_profiles').select('*'),
    sb.from('categories').select('*').order('sort_order'),
    sb.from('transactions').select('*').order('txn_date', { ascending: false }),
    sb.from('budgets').select('*'),
    sb.from('recurring_transactions').select('*'),
    sb.from('savings_goals').select('*'),
    sb.from('plans').select('*'),
    sb.from('debts').select('*'),
    sb.from('debt_payments').select('*').order('payment_date', { ascending: false }),
  ]);
  state.users = (userRows || []).map(mapUserProfileRow);
  state.categories = (catRows || []).map(mapCategoryRow);
  state.transactions = (txnRows || []).map(mapTransactionRow);
  state.budgets = (budgetRows || []).map(mapBudgetRow);
  state.recurring = (recRows || []).map(mapRecurringRow);
  state.savingsGoals = (goalRows || []).map(mapSavingsGoalRow);
  state.plans = (planRows || []).map(mapPlanRow);
  state.debts = (debtRows || []).map(mapDebtRow);
  state.debtPayments = (debtPayRows || []).map(mapDebtPaymentRow);
  if (state.categories.length === 0) await seedDefaultCategories(sb);
}

/** Lần đầu tiên chưa có danh mục nào (database Supabase mới toanh) -> tự tạo sẵn 1 bộ danh mục thường dùng, đỡ phải tự gõ từ đầu. */
async function seedDefaultCategories(sb) {
  const rows = DEFAULT_CATEGORIES.map((c, i) => ({
    id: genId('cat'), name: c.name, type: c.type, icon: c.icon, color: colorAt(i), sort_order: i,
  }));
  const { error } = await sb.from('categories').insert(rows);
  if (!error) state.categories = rows.map(mapCategoryRow);
}

function mapUserProfileRow(row) {
  return { id: row.id, name: row.name, role: row.role, createdAt: row.created_at };
}
function mapCategoryRow(row) {
  return {
    id: row.id, name: row.name, type: row.type, icon: row.icon || 'tag', color: row.color || '#2563eb',
    monthlyBudget: row.monthly_budget != null ? Number(row.monthly_budget) : null,
    sortOrder: row.sort_order || 0, active: row.active !== false,
  };
}
function mapTransactionRow(row) {
  return {
    id: row.id, type: row.type, amount: Number(row.amount), categoryId: row.category_id,
    note: row.note || '', date: row.txn_date, userId: row.user_id, recurringId: row.recurring_id,
    createdAt: row.created_at,
  };
}
function mapBudgetRow(row) {
  return { id: row.id, year: row.year, month: row.month, categoryId: row.category_id, amount: Number(row.amount) };
}
function mapRecurringRow(row) {
  return {
    id: row.id, type: row.type, amount: Number(row.amount), categoryId: row.category_id,
    note: row.note || '', dayOfMonth: row.day_of_month, active: row.active !== false, userId: row.user_id,
  };
}
function mapSavingsGoalRow(row) {
  return {
    id: row.id, name: row.name, targetAmount: Number(row.target_amount), currentAmount: Number(row.current_amount || 0),
    deadline: row.deadline, note: row.note || '', userId: row.user_id,
  };
}
function mapPlanRow(row) {
  return {
    id: row.id, type: row.type, amount: Number(row.amount), categoryId: row.category_id,
    title: row.title, dueDate: row.due_date, status: row.status,
    transactionId: row.transaction_id, userId: row.user_id, createdAt: row.created_at,
  };
}
function mapDebtRow(row) {
  return {
    id: row.id, name: row.name, creditor: row.creditor || '',
    totalAmount: Number(row.total_amount), remainingAmount: Number(row.remaining_amount),
    startDate: row.start_date, status: row.status, note: row.note || '',
    userId: row.user_id, createdAt: row.created_at,
  };
}
function mapDebtPaymentRow(row) {
  return {
    id: row.id, debtId: row.debt_id, amount: Number(row.amount), paymentDate: row.payment_date,
    transactionId: row.transaction_id, userId: row.user_id, createdAt: row.created_at,
  };
}

export async function verifyOwnPassword(password) {
  const session = getSession();
  if (!session) return false;
  const res = await callAccountFunction(session.sbToken, { type: 'verify-own-password', password });
  return !!(res.ok && res.valid);
}
export async function setOwnPassword(newPassword, opts = {}) {
  const session = getSession();
  const res = await callAccountFunction(session?.sbToken, { type: 'set-own-password', newPassword, mustChangePassword: !!opts.mustChangePassword });
  if (!res.ok) throw new Error(res.reason || 'Không đổi được mật khẩu.');
  setSession({ ...session, mustChangePassword: !!opts.mustChangePassword });
}

// ------------------------------------------------------------
// Thành viên (owner + member) — tạo/xóa/cấp lại mật khẩu qua Edge Function
// ------------------------------------------------------------
export function listMembers() { return state.users; }
export function getUser(id) { return state.users.find((u) => u.id === id); }
export function isOwner(id) { return getUser(id)?.role === 'owner'; }

export async function addMember({ username, name, password }) {
  const session = getSession();
  const res = await callAccountFunction(session?.sbToken, { type: 'member', username, name, password });
  if (!res.ok) throw new Error(res.reason || 'Không tạo được tài khoản.');
  state.users.push({ id: res.id, name: name || username, role: 'member', createdAt: new Date().toISOString() });
  notify();
  return { id: res.id, tempPassword: res.tempPassword };
}
export async function resetMemberPassword(userId, customPassword) {
  const session = getSession();
  const res = await callAccountFunction(session?.sbToken, { type: 'reset-member-password', userId, password: customPassword });
  if (!res.ok) throw new Error(res.reason || 'Không cấp lại được mật khẩu.');
  return res.tempPassword;
}
export async function deleteMember(userId) {
  const session = getSession();
  const res = await callAccountFunction(session?.sbToken, { type: 'delete-member', userId });
  if (!res.ok) throw new Error(res.reason || 'Không xóa được tài khoản.');
  state.users = state.users.filter((u) => u.id !== userId);
  notify();
}

// ------------------------------------------------------------
// Danh mục — CRUD trực tiếp qua RLS (không nhạy cảm, không cần Edge Function)
// ------------------------------------------------------------
export function listCategories(filters = {}) {
  let list = state.categories.filter((c) => c.active);
  if (filters.type) list = list.filter((c) => c.type === filters.type);
  return list.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'));
}
export function getCategory(id) { return state.categories.find((c) => c.id === id); }

export async function upsertCategory({ id, name, type, icon, color, monthlyBudget }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const row = {
    id: id || genId('cat'), name, type, icon: icon || 'tag', color: color || colorAt(state.categories.length),
    monthly_budget: monthlyBudget != null && monthlyBudget !== '' ? Number(monthlyBudget) : null,
    sort_order: id ? (getCategory(id)?.sortOrder ?? 0) : state.categories.length,
  };
  const { error } = await sb.from('categories').upsert(row, { onConflict: 'id' });
  if (error) throw new Error('Không lưu được danh mục, thử lại sau.');
  const idx = state.categories.findIndex((c) => c.id === row.id);
  const mapped = mapCategoryRow({ ...row, active: true });
  if (idx >= 0) state.categories[idx] = mapped; else state.categories.push(mapped);
  notify();
  return mapped;
}
/** Xóa danh mục — giao dịch/định kỳ cũ dùng danh mục này KHÔNG bị xóa theo, chỉ mất liên kết (hiện "Không rõ danh mục"). */
export async function deleteCategory(id) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) throw new Error('Không xóa được danh mục, thử lại sau.');
  state.categories = state.categories.filter((c) => c.id !== id);
  state.budgets = state.budgets.filter((b) => b.categoryId !== id);
  notify();
}
/** Đổi thứ tự hiển thị 1 danh mục — hoán đổi sort_order với danh mục liền kề CÙNG loại (thu/chi riêng). direction: 'up' | 'down'. */
export async function moveCategory(id, direction) {
  const cat = getCategory(id);
  if (!cat) return;
  const siblings = listCategories({ type: cat.type });
  const idx = siblings.findIndex((c) => c.id === id);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const other = siblings[swapIdx];
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const [{ error: err1 }, { error: err2 }] = await Promise.all([
    sb.from('categories').update({ sort_order: other.sortOrder }).eq('id', cat.id),
    sb.from('categories').update({ sort_order: cat.sortOrder }).eq('id', other.id),
  ]);
  if (err1 || err2) throw new Error('Không đổi được thứ tự, thử lại sau.');
  const tmp = cat.sortOrder; cat.sortOrder = other.sortOrder; other.sortOrder = tmp;
  notify();
}

// ------------------------------------------------------------
// Giao dịch (thu/chi)
// ------------------------------------------------------------
export function listTransactions(filters = {}) {
  let list = state.transactions;
  if (filters.type) list = list.filter((t) => t.type === filters.type);
  if (filters.categoryId) list = list.filter((t) => t.categoryId === filters.categoryId);
  if (filters.userId) list = list.filter((t) => t.userId === filters.userId);
  if (filters.from) list = list.filter((t) => t.date >= filters.from);
  if (filters.to) list = list.filter((t) => t.date <= filters.to);
  if (filters.q) {
    const q = filters.q.trim().toLowerCase();
    if (q) list = list.filter((t) => (t.note || '').toLowerCase().includes(q) || (getCategory(t.categoryId)?.name || '').toLowerCase().includes(q));
  }
  return list.slice().sort((a, b) => (b.date).localeCompare(a.date) || new Date(b.createdAt) - new Date(a.createdAt));
}
export function getTransaction(id) { return state.transactions.find((t) => t.id === id); }

export async function addTransaction({ type, amount, categoryId, note, date, recurringId }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const row = {
    id: genId('txn'), type, amount: Number(amount) || 0, category_id: categoryId || null,
    note: note || '', txn_date: date || new Date().toISOString().slice(0, 10),
    user_id: session.id, recurring_id: recurringId || null,
  };
  const { error } = await sb.from('transactions').insert(row);
  if (error) throw new Error('Không lưu được giao dịch, thử lại sau.');
  state.transactions.unshift(mapTransactionRow({ ...row, created_at: new Date().toISOString() }));
  notify();
}
export async function updateTransaction(id, { type, amount, categoryId, note, date }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const patch = { type, amount: Number(amount) || 0, category_id: categoryId || null, note: note || '', txn_date: date };
  const { error } = await sb.from('transactions').update(patch).eq('id', id);
  if (error) throw new Error('Không cập nhật được giao dịch, thử lại sau.');
  const t = getTransaction(id);
  if (t) Object.assign(t, { type, amount: Number(amount) || 0, categoryId: categoryId || null, note: note || '', date });
  notify();
}
export async function deleteTransaction(id) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('transactions').delete().eq('id', id);
  if (error) throw new Error('Không xóa được giao dịch, thử lại sau.');
  state.transactions = state.transactions.filter((t) => t.id !== id);
  notify();
}

// ------------------------------------------------------------
// Tính toán theo tháng — dashboard, ngân sách, báo cáo dùng chung
// ------------------------------------------------------------
export function monthKey(year, month) { return `${year}-${String(month).padStart(2, '0')}`; }
export function monthRange(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to, lastDay };
}
export function totalsForMonth(year, month) {
  const { from, to } = monthRange(year, month);
  const list = state.transactions.filter((t) => t.date >= from && t.date <= to);
  const income = list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return { income, expense, balance: income - expense };
}
/** Tổng chi theo từng danh mục trong tháng — Map<categoryId, số tiền>. */
export function expenseByCategoryForMonth(year, month) {
  const { from, to } = monthRange(year, month);
  const map = new Map();
  for (const t of state.transactions) {
    if (t.type !== 'expense' || t.date < from || t.date > to) continue;
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
  }
  return map;
}
/** Dự báo tổng chi cuối tháng dựa trên tốc độ chi tiêu hiện tại (chỉ có ý nghĩa với tháng hiện tại). */
/**
 * Công thức: (tổng đã chi từ đầu tháng đến hôm nay ÷ số ngày đã qua) × tổng
 * số ngày trong tháng — suy ra tốc độ chi trung bình mỗi ngày rồi nhân lên
 * cho cả tháng. Trả về null nếu mới đầu tháng (dưới 3 ngày dữ liệu): quá ít
 * dữ liệu khiến con số dễ lệch rất xa thực tế (vd: mới trả 1 khoản lớn như
 * tiền nhà ngay ngày 1-2 sẽ bị nhân lên thành số khổng lồ sai lệch).
 */
export function forecastExpense(year, month, asOf = new Date()) {
  const { lastDay } = monthRange(year, month);
  const dayOfMonth = Math.min(asOf.getDate(), lastDay);
  const { expense } = totalsForMonth(year, month);
  if (dayOfMonth < 3) return null;
  return Math.round((expense / dayOfMonth) * lastDay);
}
/** Tổng thu/chi 6 tháng gần nhất (tính cả tháng hiện tại) — mới nhất ở cuối mảng, dùng cho biểu đồ xu hướng. */
export function last6MonthsTotals(asOf = new Date()) {
  const result = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    result.push({ year: y, month: m, ...totalsForMonth(y, m) });
  }
  return result;
}

// ------------------------------------------------------------
// Ngân sách hàng tháng theo danh mục
// ------------------------------------------------------------
/** Hạn mức ĐANG ÁP DỤNG cho 1 danh mục trong tháng: ưu tiên số đã đặt riêng cho tháng đó, không có thì lấy mặc định của danh mục (có thể null = chưa đặt hạn mức). */
export function effectiveBudget(categoryId, year, month) {
  const override = state.budgets.find((b) => b.categoryId === categoryId && b.year === year && b.month === month);
  if (override) return override.amount;
  return getCategory(categoryId)?.monthlyBudget ?? null;
}
/** Danh sách đầy đủ: mỗi danh mục chi tiêu + hạn mức đang áp dụng + đã chi trong tháng + % đã dùng. */
export function budgetOverviewForMonth(year, month) {
  const spentMap = expenseByCategoryForMonth(year, month);
  return listCategories({ type: 'expense' }).map((cat) => {
    const limit = effectiveBudget(cat.id, year, month);
    const spent = spentMap.get(cat.id) || 0;
    return { category: cat, limit, spent, percent: limit ? Math.round((spent / limit) * 100) : null, over: limit != null && spent > limit };
  });
}

// ------------------------------------------------------------
// Giao dịch định kỳ (tiền điện, lương, thuê nhà...) — tự nhắc, không tự ý ghi sổ
// ------------------------------------------------------------
export function listRecurring() { return state.recurring.filter((r) => r.active); }
export async function addRecurring({ type, amount, categoryId, note, dayOfMonth }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const row = {
    id: genId('rec'), type, amount: Number(amount) || 0, category_id: categoryId || null,
    note: note || '', day_of_month: Number(dayOfMonth) || 1, active: true, user_id: session.id,
  };
  const { error } = await sb.from('recurring_transactions').insert(row);
  if (error) throw new Error('Không lưu được khoản định kỳ, thử lại sau.');
  state.recurring.push(mapRecurringRow(row));
  notify();
}
export async function updateRecurring(id, { type, amount, categoryId, note, dayOfMonth, active }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const patch = { type, amount: Number(amount) || 0, category_id: categoryId || null, note: note || '', day_of_month: Number(dayOfMonth) || 1, active: active !== false };
  const { error } = await sb.from('recurring_transactions').update(patch).eq('id', id);
  if (error) throw new Error('Không cập nhật được, thử lại sau.');
  const r = state.recurring.find((x) => x.id === id);
  if (r) Object.assign(r, { type, amount: patch.amount, categoryId: patch.category_id, note: patch.note, dayOfMonth: patch.day_of_month, active: patch.active });
  notify();
}
export async function deleteRecurring(id) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('recurring_transactions').delete().eq('id', id);
  if (error) throw new Error('Không xóa được, thử lại sau.');
  state.recurring = state.recurring.filter((r) => r.id !== id);
  notify();
}
/** Các khoản định kỳ đã tới/qua ngày trong THÁNG HIỆN TẠI mà chưa có giao dịch nào ghi từ nó -> cần nhắc. */
export function pendingRecurringReminders(asOf = new Date()) {
  const year = asOf.getFullYear(), month = asOf.getMonth() + 1;
  const { from, to } = monthRange(year, month);
  const loggedRecurringIds = new Set(state.transactions.filter((t) => t.date >= from && t.date <= to && t.recurringId).map((t) => t.recurringId));
  return listRecurring().filter((r) => asOf.getDate() >= r.dayOfMonth && !loggedRecurringIds.has(r.id));
}
/** Xác nhận 1 khoản định kỳ -> tự tạo giao dịch tương ứng cho tháng hiện tại (có thể sửa số tiền lúc xác nhận nếu tháng này khác thường). */
export async function confirmRecurring(recurringId, { amount, date } = {}) {
  const r = state.recurring.find((x) => x.id === recurringId);
  if (!r) throw new Error('Không tìm thấy khoản định kỳ.');
  await addTransaction({
    type: r.type, amount: amount != null ? amount : r.amount, categoryId: r.categoryId,
    note: r.note || 'Định kỳ', date: date || new Date().toISOString().slice(0, 10), recurringId: r.id,
  });
}

// ------------------------------------------------------------
// Mục tiêu tiết kiệm
// ------------------------------------------------------------
export function listSavingsGoals() { return state.savingsGoals; }
export async function addSavingsGoal({ name, targetAmount, deadline, note }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const row = { id: genId('goal'), name, target_amount: Number(targetAmount) || 0, current_amount: 0, deadline: deadline || null, note: note || '', user_id: session.id };
  const { error } = await sb.from('savings_goals').insert(row);
  if (error) throw new Error('Không tạo được mục tiêu, thử lại sau.');
  state.savingsGoals.push(mapSavingsGoalRow(row));
  notify();
}
export async function updateSavingsGoal(id, { name, targetAmount, deadline, note }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const patch = { name, target_amount: Number(targetAmount) || 0, deadline: deadline || null, note: note || '' };
  const { error } = await sb.from('savings_goals').update(patch).eq('id', id);
  if (error) throw new Error('Không cập nhật được, thử lại sau.');
  const g = state.savingsGoals.find((x) => x.id === id);
  if (g) Object.assign(g, { name, targetAmount: patch.target_amount, deadline: patch.deadline, note: patch.note });
  notify();
}
/** Góp thêm (hoặc rút bớt nếu truyền số âm) vào 1 mục tiêu tiết kiệm. */
export async function contributeSavingsGoal(id, amount) {
  const g = state.savingsGoals.find((x) => x.id === id);
  if (!g) throw new Error('Không tìm thấy mục tiêu.');
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const newAmount = Math.max(0, g.currentAmount + Number(amount));
  const { error } = await sb.from('savings_goals').update({ current_amount: newAmount }).eq('id', id);
  if (error) throw new Error('Không cập nhật được, thử lại sau.');
  g.currentAmount = newAmount;
  notify();
}
export async function deleteSavingsGoal(id) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('savings_goals').delete().eq('id', id);
  if (error) throw new Error('Không xóa được, thử lại sau.');
  state.savingsGoals = state.savingsGoals.filter((g) => g.id !== id);
  notify();
}

// ------------------------------------------------------------
// Kế hoạch chi tiêu — khoản thu/chi DỰ ĐỊNH (vd "cuối tháng mua sắm 2
// triệu"): chỉ để nhắc/theo dõi, KHÔNG tính vào tổng thu/chi thật cho tới
// khi tick "Hoàn thành" — lúc đó completePlan() mới tự tạo 1 giao dịch thật
// (transactions) và đánh dấu kế hoạch xong, liên kết qua transactionId.
// ------------------------------------------------------------
export function listPlans(filters = {}) {
  let list = state.plans;
  if (filters.status) list = list.filter((p) => p.status === filters.status);
  return list.slice().sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99'));
}
export function getPlan(id) { return state.plans.find((p) => p.id === id); }
/** Kế hoạch chưa hoàn thành đã có ngày dự định, sắp tới (trong `days` ngày) hoặc đã quá hạn — dùng cho thông báo trên Tổng quan. */
export function upcomingPlans(asOf = new Date(), days = 7) {
  const todayStr = asOf.toISOString().slice(0, 10);
  const limitStr = addDaysISO(todayStr, days);
  return listPlans({ status: 'pending' }).filter((p) => p.dueDate && p.dueDate <= limitStr);
}
function addDaysISO(iso, n) {
  const dt = new Date(iso);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

export async function addPlan({ type, amount, categoryId, title, dueDate }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const row = {
    id: genId('plan'), type, amount: Number(amount) || 0, category_id: categoryId || null,
    title, due_date: dueDate || null, status: 'pending', user_id: session.id,
  };
  const { error } = await sb.from('plans').insert(row);
  if (error) throw new Error('Không lưu được kế hoạch, thử lại sau.');
  state.plans.push(mapPlanRow({ ...row, created_at: new Date().toISOString() }));
  notify();
}
export async function updatePlan(id, { type, amount, categoryId, title, dueDate }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const patch = { type, amount: Number(amount) || 0, category_id: categoryId || null, title, due_date: dueDate || null };
  const { error } = await sb.from('plans').update(patch).eq('id', id);
  if (error) throw new Error('Không cập nhật được, thử lại sau.');
  const p = getPlan(id);
  if (p) Object.assign(p, { type, amount: patch.amount, categoryId: patch.category_id, title, dueDate: patch.due_date });
  notify();
}
export async function deletePlan(id) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('plans').delete().eq('id', id);
  if (error) throw new Error('Không xóa được, thử lại sau.');
  state.plans = state.plans.filter((p) => p.id !== id);
  notify();
}
/** Tick "Hoàn thành" — tự tạo giao dịch thật (thu hoặc chi) rồi mới đánh dấu kế hoạch xong, liên kết 2 bên qua transactionId. Có thể sửa lại số tiền/ngày lúc xác nhận nếu khác dự tính ban đầu. */
export async function completePlan(id, { amount, date } = {}) {
  const p = getPlan(id);
  if (!p) throw new Error('Không tìm thấy kế hoạch.');
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const finalAmount = amount != null ? Number(amount) || 0 : p.amount;
  const finalDate = date || new Date().toISOString().slice(0, 10);
  const txnRow = {
    id: genId('txn'), type: p.type, amount: finalAmount, category_id: p.categoryId,
    note: p.title, txn_date: finalDate, user_id: session.id, recurring_id: null,
  };
  const { error: txnErr } = await sb.from('transactions').insert(txnRow);
  if (txnErr) throw new Error('Không tạo được giao dịch, thử lại sau.');
  const { error: planErr } = await sb.from('plans').update({ status: 'done', transaction_id: txnRow.id }).eq('id', id);
  if (planErr) throw new Error('Đã tạo giao dịch nhưng chưa cập nhật được trạng thái kế hoạch, thử lại sau.');
  state.transactions.unshift(mapTransactionRow({ ...txnRow, created_at: new Date().toISOString() }));
  p.status = 'done';
  p.transactionId = txnRow.id;
  notify();
}

// ------------------------------------------------------------
// Quản lý nợ — khoản đang nợ (mua trả góp, vay mượn...): theo dõi dư nợ còn
// lại, lịch sử trả nợ (debt_payments), mỗi lần trả tự tạo 1 giao dịch chi
// tiêu thật (để không lệch tổng chi tiêu tháng) và liên kết lại qua
// transactionId — giống hệt cơ chế completePlan() ở trên.
// ------------------------------------------------------------
export function listDebts(filters = {}) {
  let list = state.debts;
  if (filters.status) list = list.filter((d) => d.status === filters.status);
  return list.slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
}
export function getDebt(id) { return state.debts.find((d) => d.id === id); }
/** Lịch sử trả nợ của 1 khoản nợ, mới nhất trước. */
export function listDebtPayments(debtId) {
  return state.debtPayments.filter((p) => p.debtId === debtId).sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
}
/** Tổng quan: tổng nợ gốc đã vay/mua và tổng dư nợ còn lại (mọi khoản, kể cả đã trả xong — lúc đó dư nợ = 0 nên không ảnh hưởng tổng). */
export function debtsSummary() {
  return state.debts.reduce((s, d) => ({ totalOriginal: s.totalOriginal + d.totalAmount, totalRemaining: s.totalRemaining + d.remainingAmount }), { totalOriginal: 0, totalRemaining: 0 });
}

export async function addDebt({ name, creditor, totalAmount, startDate, note }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const amount = Number(totalAmount) || 0;
  const row = {
    id: genId('debt'), name, creditor: creditor || null, total_amount: amount, remaining_amount: amount,
    start_date: startDate || new Date().toISOString().slice(0, 10), status: 'active', note: note || '', user_id: session.id,
  };
  const { error } = await sb.from('debts').insert(row);
  if (error) throw new Error('Không lưu được khoản nợ, thử lại sau.');
  state.debts.push(mapDebtRow({ ...row, created_at: new Date().toISOString() }));
  notify();
}
export async function updateDebt(id, { name, creditor, totalAmount, startDate, note }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const patch = {
    name, creditor: creditor || null, total_amount: Number(totalAmount) || 0,
    start_date: startDate, note: note || '',
  };
  const { error } = await sb.from('debts').update(patch).eq('id', id);
  if (error) throw new Error('Không cập nhật được, thử lại sau.');
  const d = getDebt(id);
  if (d) Object.assign(d, {
    name, creditor: patch.creditor || '', totalAmount: patch.total_amount, startDate: patch.start_date, note: patch.note,
  });
  notify();
}
export async function deleteDebt(id) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('debts').delete().eq('id', id);
  if (error) throw new Error('Không xóa được, thử lại sau.');
  state.debts = state.debts.filter((d) => d.id !== id);
  state.debtPayments = state.debtPayments.filter((p) => p.debtId !== id);
  notify();
}
/** Trả nợ (1 phần hoặc hết) — tự tạo giao dịch chi tiêu thật + ghi lịch sử trả nợ + giảm dư nợ, tự chuyển sang 'paid' nếu hết nợ. */
export async function payDebt(id, { amount, date, categoryId }) {
  const d = getDebt(id);
  if (!d) throw new Error('Không tìm thấy khoản nợ.');
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const payAmount = Number(amount) || 0;
  if (payAmount <= 0) throw new Error('Số tiền trả phải lớn hơn 0.');
  const payDate = date || new Date().toISOString().slice(0, 10);

  const txnRow = {
    id: genId('txn'), type: 'expense', amount: payAmount, category_id: categoryId || null,
    note: `Trả nợ: ${d.name}`, txn_date: payDate, user_id: session.id, recurring_id: null,
  };
  const { error: txnErr } = await sb.from('transactions').insert(txnRow);
  if (txnErr) throw new Error('Không tạo được giao dịch, thử lại sau.');

  const newRemaining = Math.max(0, d.remainingAmount - payAmount);
  const newStatus = newRemaining <= 0 ? 'paid' : 'active';
  const { error: debtErr } = await sb.from('debts').update({ remaining_amount: newRemaining, status: newStatus }).eq('id', id);
  if (debtErr) throw new Error('Đã tạo giao dịch nhưng chưa cập nhật được dư nợ, thử lại sau.');

  const payRow = { id: genId('debtpay'), debt_id: id, amount: payAmount, payment_date: payDate, transaction_id: txnRow.id, user_id: session.id };
  const { error: payErr } = await sb.from('debt_payments').insert(payRow);
  if (payErr) throw new Error('Đã trừ dư nợ nhưng chưa lưu được lịch sử trả nợ, thử lại sau.');

  state.transactions.unshift(mapTransactionRow({ ...txnRow, created_at: new Date().toISOString() }));
  state.debtPayments.unshift(mapDebtPaymentRow({ ...payRow, created_at: new Date().toISOString() }));
  d.remainingAmount = newRemaining;
  d.status = newStatus;
  notify();
}

// ------------------------------------------------------------
// Session (đăng nhập hiện tại)
// ------------------------------------------------------------
export function getSession() { return state.session; }
export function setSession(session) { state.session = session; notify(); }
export function logout() {
  state.session = null;
  state.users = []; state.categories = []; state.transactions = []; state.budgets = []; state.recurring = []; state.savingsGoals = []; state.plans = []; state.debts = []; state.debtPayments = [];
  notify();
}
