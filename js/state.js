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
    users: [], categories: [], transactions: [], budgets: [], recurring: [], savingsGoals: [], plans: [], creditors: [], debtEntries: [],
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
  const [{ data: userRows }, { data: catRows }, { data: txnRows }, { data: budgetRows }, { data: recRows }, { data: goalRows }, { data: planRows }, { data: creditorRows }, { data: debtEntryRows }] = await Promise.all([
    sb.from('user_profiles').select('*'),
    sb.from('categories').select('*').order('sort_order'),
    sb.from('transactions').select('*').order('txn_date', { ascending: false }),
    sb.from('budgets').select('*'),
    sb.from('recurring_transactions').select('*'),
    sb.from('savings_goals').select('*'),
    sb.from('plans').select('*'),
    sb.from('creditors').select('*'),
    sb.from('debt_entries').select('*').order('entry_date', { ascending: false }),
  ]);
  state.users = (userRows || []).map(mapUserProfileRow);
  state.categories = (catRows || []).map(mapCategoryRow);
  state.transactions = (txnRows || []).map(mapTransactionRow);
  state.budgets = (budgetRows || []).map(mapBudgetRow);
  state.recurring = (recRows || []).map(mapRecurringRow);
  state.savingsGoals = (goalRows || []).map(mapSavingsGoalRow);
  state.plans = (planRows || []).map(mapPlanRow);
  state.creditors = (creditorRows || []).map(mapCreditorRow);
  state.debtEntries = (debtEntryRows || []).map(mapDebtEntryRow);
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
function mapCreditorRow(row) {
  return { id: row.id, name: row.name, note: row.note || '', userId: row.user_id, createdAt: row.created_at };
}
function mapDebtEntryRow(row) {
  return {
    id: row.id, creditorId: row.creditor_id, kind: row.kind, amount: Number(row.amount),
    date: row.entry_date, description: row.description || '',
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
// Quản lý nợ theo TỪNG CHỦ NỢ (vd "Tạp hóa A", "Anh Ba") — mỗi chủ nợ có 1
// sổ riêng (debtEntries) gồm 2 loại dòng: "charge" (ghi nợ thêm — mua gì,
// ngày nào, nợ bao nhiêu) và "payment" (trả nợ — ngày nào, trả bao nhiêu).
// Còn nợ = tổng charge - tổng payment, tính ngay lúc đọc (không lưu cột
// riêng để khỏi lệch). MẶC ĐỊNH ghi nợ/trả nợ đều KHÔNG đụng tới thu/chi
// thật — chỉ khi người dùng tự TÍCH CHỌN "đưa vào chi tiêu" lúc ghi/sửa mới
// tự tạo (hoặc đồng bộ) 1 giao dịch chi tiêu thật, liên kết qua
// transactionId. Riêng tư từng người dùng (RLS lọc theo user_id), KHÔNG
// hiện trên Tổng quan.
// ------------------------------------------------------------
function entriesOf(creditorId) { return state.debtEntries.filter((e) => e.creditorId === creditorId); }
/** Còn nợ của 1 chủ nợ = tổng ghi nợ - tổng đã trả. */
export function creditorBalance(creditorId) {
  return entriesOf(creditorId).reduce((s, e) => s + (e.kind === 'charge' ? e.amount : -e.amount), 0);
}
/** Danh sách chủ nợ kèm số dư còn nợ + ngày hoạt động gần nhất, mới nhất trước. filters.status: 'active' (còn nợ) | 'paid' (đã trả hết). */
export function listCreditors(filters = {}) {
  let list = state.creditors.map((c) => {
    const entries = entriesOf(c.id);
    const lastDate = entries.reduce((m, e) => (e.date > m ? e.date : m), '');
    return { ...c, balance: creditorBalance(c.id), lastDate, entryCount: entries.length };
  });
  if (filters.status === 'active') list = list.filter((c) => c.balance > 0);
  else if (filters.status === 'paid') list = list.filter((c) => c.balance <= 0 && c.entryCount > 0);
  return list.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
}
export function getCreditor(id) { return state.creditors.find((c) => c.id === id); }
/** Toàn bộ TÊN chủ nợ đã dùng qua, không trùng (kể cả đã "đã trả hết") — để gợi ý lúc ghi nợ mới, hoạt động gần nhất trước. */
export function listCreditorNames() {
  const seen = new Set();
  const names = [];
  listCreditors().forEach((c) => {
    const key = c.name.trim().toLowerCase();
    if (!seen.has(key)) { seen.add(key); names.push(c.name); }
  });
  return names;
}
/** Sổ nợ của 1 chủ nợ (ghi nợ + trả nợ), mới nhất trước. */
export function listDebtEntries(creditorId) {
  return entriesOf(creditorId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
/** Tổng còn nợ của TẤT CẢ chủ nợ (của riêng người đang đăng nhập). */
export function totalDebtRemaining() {
  return state.creditors.reduce((s, c) => s + Math.max(0, creditorBalance(c.id)), 0);
}

/** Chỉ tìm chủ nợ CÒN ĐANG NỢ (balance > 0) theo tên — chủ nợ đã "đã trả hết" không tính, để lần
 * ghi nợ mới cùng tên KHÔNG bị chồng vào sổ cũ đã đóng, mà tự mở 1 sổ nợ mới (cùng tên, id khác). */
function findOpenCreditorByName(name) {
  const key = name.trim().toLowerCase();
  return state.creditors.find((c) => c.name.trim().toLowerCase() === key && creditorBalance(c.id) > 0);
}
async function ensureCreditor(name, sb, session) {
  const existing = findOpenCreditorByName(name);
  if (existing) return existing;
  const row = { id: genId('creditor'), name: name.trim(), note: '', user_id: session.id };
  const { error } = await sb.from('creditors').insert(row);
  if (error) throw new Error('Không tạo được chủ nợ, thử lại sau.');
  const c = mapCreditorRow({ ...row, created_at: new Date().toISOString() });
  state.creditors.push(c);
  return c;
}
/** Ghi nợ mới. Truyền creditorId khi đã biết đúng chủ nợ (VD đang ở trang chi tiết 1 chủ nợ) — dùng
 * đúng sổ đó dù đang nợ hay đã trả hết. Truyền creditorName để tự tìm chủ nợ CÒN ĐANG NỢ theo tên
 * (không phân biệt hoa/thường); nếu chưa có ai đang nợ tên đó thì tự mở 1 sổ nợ MỚI (không chồng vào
 * sổ cũ đã trả hết, kể cả trùng tên). Mặc định KHÔNG đụng thu/chi thật; chỉ tạo giao dịch chi khi
 * addToTransactions=true (người dùng tự tích chọn). */
export async function addDebtCharge({ creditorId, creditorName, amount, date, description, categoryId, addToTransactions }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const chargeAmount = Number(amount) || 0;
  if (chargeAmount <= 0) throw new Error('Số tiền nợ phải lớn hơn 0.');
  const entryDate = date || new Date().toISOString().slice(0, 10);
  let creditor;
  if (creditorId) {
    creditor = getCreditor(creditorId);
    if (!creditor) throw new Error('Không tìm thấy chủ nợ.');
  } else {
    const name = (creditorName || '').trim();
    if (!name) throw new Error('Cần nhập tên chủ nợ.');
    creditor = await ensureCreditor(name, sb, session);
  }

  let txnRow = null;
  if (addToTransactions) {
    txnRow = {
      id: genId('txn'), type: 'expense', amount: chargeAmount, category_id: categoryId || null,
      note: `Mua nợ: ${creditor.name}${description ? ' - ' + description : ''}`, txn_date: entryDate, user_id: session.id, recurring_id: null,
    };
    const { error: txnErr } = await sb.from('transactions').insert(txnRow);
    if (txnErr) throw new Error('Không tạo được giao dịch, thử lại sau.');
  }
  const row = {
    id: genId('debtentry'), creditor_id: creditor.id, kind: 'charge', amount: chargeAmount,
    entry_date: entryDate, description: description || '',
    transaction_id: txnRow ? txnRow.id : null, user_id: session.id,
  };
  const { error } = await sb.from('debt_entries').insert(row);
  if (error) throw new Error('Không lưu được ghi nợ, thử lại sau.');
  if (txnRow) state.transactions.unshift(mapTransactionRow({ ...txnRow, created_at: new Date().toISOString() }));
  state.debtEntries.unshift(mapDebtEntryRow({ ...row, created_at: new Date().toISOString() }));
  notify();
}
/** Trả nợ (1 phần hoặc hết) cho 1 chủ nợ. Mặc định KHÔNG đụng thu/chi thật; chỉ tạo giao dịch chi khi addToTransactions=true (người dùng tự tích chọn). */
export async function addDebtPayment(creditorId, { amount, date, categoryId, description, addToTransactions }) {
  const creditor = getCreditor(creditorId);
  if (!creditor) throw new Error('Không tìm thấy chủ nợ.');
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const payAmount = Number(amount) || 0;
  if (payAmount <= 0) throw new Error('Số tiền trả phải lớn hơn 0.');
  const payDate = date || new Date().toISOString().slice(0, 10);

  let txnRow = null;
  if (addToTransactions) {
    txnRow = {
      id: genId('txn'), type: 'expense', amount: payAmount, category_id: categoryId || null,
      note: `Trả nợ: ${creditor.name}`, txn_date: payDate, user_id: session.id, recurring_id: null,
    };
    const { error: txnErr } = await sb.from('transactions').insert(txnRow);
    if (txnErr) throw new Error('Không tạo được giao dịch, thử lại sau.');
  }
  const row = {
    id: genId('debtentry'), creditor_id: creditorId, kind: 'payment', amount: payAmount,
    entry_date: payDate, description: description || '', transaction_id: txnRow ? txnRow.id : null, user_id: session.id,
  };
  const { error: entryErr } = await sb.from('debt_entries').insert(row);
  if (entryErr) throw new Error(txnRow ? 'Đã tạo giao dịch nhưng chưa lưu được vào sổ nợ, thử lại sau.' : 'Không lưu được vào sổ nợ, thử lại sau.');

  if (txnRow) state.transactions.unshift(mapTransactionRow({ ...txnRow, created_at: new Date().toISOString() }));
  state.debtEntries.unshift(mapDebtEntryRow({ ...row, created_at: new Date().toISOString() }));
  notify();
}
/** Sửa 1 dòng ghi nợ/trả nợ. addToTransactions điều khiển việc tạo/xóa/đồng bộ giao dịch chi tiêu thật đi kèm (nếu có). */
export async function updateDebtEntry(id, { amount, date, description, categoryId, addToTransactions }) {
  const e = state.debtEntries.find((x) => x.id === id);
  if (!e) throw new Error('Không tìm thấy dòng sổ nợ.');
  const creditor = getCreditor(e.creditorId);
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const newAmount = Number(amount) || 0;
  if (newAmount <= 0) throw new Error('Số tiền phải lớn hơn 0.');
  const newDate = date || e.date;
  const patch = { amount: newAmount, entry_date: newDate, description: description || '' };

  let newTransactionId = e.transactionId;
  if (addToTransactions && !e.transactionId) {
    // Trước đây chưa đưa vào chi tiêu, giờ tích chọn -> tạo mới giao dịch.
    const note = e.kind === 'charge' ? `Mua nợ: ${creditor ? creditor.name : ''}${patch.description ? ' - ' + patch.description : ''}` : `Trả nợ: ${creditor ? creditor.name : ''}`;
    const txnRow = {
      id: genId('txn'), type: 'expense', amount: newAmount, category_id: categoryId || null,
      note, txn_date: newDate, user_id: session.id, recurring_id: null,
    };
    const { error: txnErr } = await sb.from('transactions').insert(txnRow);
    if (txnErr) throw new Error('Không tạo được giao dịch, thử lại sau.');
    state.transactions.unshift(mapTransactionRow({ ...txnRow, created_at: new Date().toISOString() }));
    newTransactionId = txnRow.id;
  } else if (!addToTransactions && e.transactionId) {
    // Trước đây có đưa vào chi tiêu, giờ bỏ tích -> xóa giao dịch đã tạo.
    await sb.from('transactions').delete().eq('id', e.transactionId);
    state.transactions = state.transactions.filter((t) => t.id !== e.transactionId);
    newTransactionId = null;
  } else if (addToTransactions && e.transactionId) {
    // Vẫn đưa vào chi tiêu -> đồng bộ số tiền/ngày cho giao dịch đã có.
    const { error: txnErr } = await sb.from('transactions').update({ amount: newAmount, txn_date: newDate }).eq('id', e.transactionId);
    if (txnErr) throw new Error('Đã cập nhật sổ nợ nhưng chưa đồng bộ được giao dịch, thử lại sau.');
    const t = state.transactions.find((x) => x.id === e.transactionId);
    if (t) { t.amount = newAmount; t.date = newDate; }
  }
  patch.transaction_id = newTransactionId;
  const { error } = await sb.from('debt_entries').update(patch).eq('id', id);
  if (error) throw new Error('Không cập nhật được, thử lại sau.');
  Object.assign(e, { amount: newAmount, date: newDate, description: patch.description, transactionId: newTransactionId });
  notify();
}
/** Xóa 1 dòng ghi nợ/trả nợ. Nếu dòng có kèm giao dịch chi tiêu thật (đã tích "đưa vào chi tiêu") thì xóa luôn giao dịch đó. */
export async function deleteDebtEntry(id) {
  const e = state.debtEntries.find((x) => x.id === id);
  if (!e) throw new Error('Không tìm thấy dòng sổ nợ.');
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('debt_entries').delete().eq('id', id);
  if (error) throw new Error('Không xóa được, thử lại sau.');
  if (e.transactionId) {
    await sb.from('transactions').delete().eq('id', e.transactionId);
    state.transactions = state.transactions.filter((t) => t.id !== e.transactionId);
  }
  state.debtEntries = state.debtEntries.filter((x) => x.id !== id);
  notify();
}
export async function updateCreditor(id, { name, note }) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const patch = { name: (name || '').trim(), note: note || '' };
  if (!patch.name) throw new Error('Cần nhập tên chủ nợ.');
  const { error } = await sb.from('creditors').update(patch).eq('id', id);
  if (error) throw new Error('Không cập nhật được, thử lại sau.');
  const c = getCreditor(id);
  if (c) Object.assign(c, patch);
  notify();
}
/** Xóa hẳn 1 chủ nợ + toàn bộ sổ nợ (cascade ở DB) — KHÔNG xóa các giao dịch chi tiêu thật đã trả trước đó. */
export async function deleteCreditor(id) {
  const session = getSession();
  const sb = getSupabaseClient(session?.sbToken);
  const { error } = await sb.from('creditors').delete().eq('id', id);
  if (error) throw new Error('Không xóa được, thử lại sau.');
  state.creditors = state.creditors.filter((c) => c.id !== id);
  state.debtEntries = state.debtEntries.filter((e) => e.creditorId !== id);
  notify();
}

// ------------------------------------------------------------
// Session (đăng nhập hiện tại)
// ------------------------------------------------------------
export function getSession() { return state.session; }
export function setSession(session) { state.session = session; notify(); }
export function logout() {
  state.session = null;
  state.users = []; state.categories = []; state.transactions = []; state.budgets = []; state.recurring = []; state.savingsGoals = []; state.plans = []; state.creditors = []; state.debtEntries = [];
  notify();
}
