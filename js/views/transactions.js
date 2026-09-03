import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { emptyState } from '../components/ui.js';
import { openTransactionForm } from '../components/txnForm.js';
import { confirmDialog, openModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { formatVND, formatDate, debounce } from '../utils.js';

let filters = { type: '', categoryId: '', userId: '', q: '' };

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Giao dịch' });
}

export function render(contentEl, filterEl) {
  const members = S.listMembers();
  const categories = S.listCategories();

  filterEl.innerHTML = `
    <div class="flex gap-8 mb-8" style="flex-wrap:wrap">
      <select id="f-type" class="pill-select">
        <option value="">Tất cả</option>
        <option value="expense" ${filters.type === 'expense' ? 'selected' : ''}>Khoản chi</option>
        <option value="income" ${filters.type === 'income' ? 'selected' : ''}>Khoản thu</option>
      </select>
      <select id="f-cat" class="pill-select">
        <option value="">Mọi danh mục</option>
        ${categories.map((c) => `<option value="${c.id}" ${filters.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
      </select>
      ${members.length > 1 ? `
      <select id="f-user" class="pill-select">
        <option value="">Mọi người</option>
        ${members.map((u) => `<option value="${u.id}" ${filters.userId === u.id ? 'selected' : ''}>${u.name}</option>`).join('')}
      </select>` : ''}
    </div>
    <div class="field" style="margin-bottom:12px">
      <input id="f-search" placeholder="Tìm theo ghi chú/danh mục..." value="${filters.q}"/>
    </div>
  `;
  filterEl.querySelector('#f-type').addEventListener('change', (e) => { filters.type = e.target.value; renderList(contentEl); });
  filterEl.querySelector('#f-cat').addEventListener('change', (e) => { filters.categoryId = e.target.value; renderList(contentEl); });
  const fUser = filterEl.querySelector('#f-user');
  if (fUser) fUser.addEventListener('change', (e) => { filters.userId = e.target.value; renderList(contentEl); });
  filterEl.querySelector('#f-search').addEventListener('input', debounce((e) => { filters.q = e.target.value; renderList(contentEl); }, 250));

  renderList(contentEl);

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = icon('plus');
  fab.addEventListener('click', () => openTransactionForm({}));
  document.body.appendChild(fab);
}

function renderList(contentEl) {
  const list = S.listTransactions(filters);
  const totalExpense = list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const totalIncome = list.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);

  // Nhóm theo ngày để dễ theo dõi (danh sách đã sắp xếp mới nhất trước).
  const groups = [];
  for (const t of list) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  contentEl.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="oc-line"><span>Tổng thu</span><b style="color:var(--success)">+${formatVND(totalIncome)}</b></div>
      <div class="oc-line"><span>Tổng chi</span><b style="color:var(--danger)">-${formatVND(totalExpense)}</b></div>
    </div>
    ${list.length ? groups.map((g) => `
      <div class="mb-16">
        <div class="text-sm fw-700 text-muted mb-6">${formatDate(g.date)}</div>
        <div class="card">
          ${g.items.map((t) => transactionRowHtml(t)).join('')}
        </div>
      </div>
    `).join('') : `<div class="card card-pad">${emptyState({ iconName: 'wallet', title: 'Chưa có giao dịch nào', message: 'Bấm nút + để thêm giao dịch đầu tiên.' })}</div>`}
  `;

  contentEl.querySelectorAll('[data-txn]').forEach((row) => {
    row.addEventListener('click', () => openTxnDetail(S.getTransaction(row.dataset.txn)));
  });
}

function transactionRowHtml(t) {
  const cat = S.getCategory(t.categoryId);
  const isExpense = t.type === 'expense';
  const user = S.getUser(t.userId);
  return `
    <div class="list-row" data-txn="${t.id}" style="cursor:pointer">
      <div class="row-thumb" style="background:${cat ? cat.color : '#94a3b8'}">${icon(cat ? cat.icon : 'tag', 'icon-sm')}</div>
      <div class="row-main">
        <div class="row-title">${cat ? cat.name : 'Không rõ danh mục'}</div>
        <div class="row-sub">${t.note ? t.note + ' · ' : ''}${user ? user.name : ''}</div>
      </div>
      <div class="row-end"><span class="amount" style="color:${isExpense ? 'var(--danger)' : 'var(--success)'}">${isExpense ? '-' : '+'}${formatVND(t.amount)}</span></div>
    </div>`;
}

function openTxnDetail(t) {
  if (!t) return;
  const cat = S.getCategory(t.categoryId);
  openModal({
    title: 'Giao dịch',
    bodyHtml: `
      <div class="oc-line"><span>Danh mục</span><b>${cat ? cat.name : 'Không rõ danh mục'}</b></div>
      <div class="oc-line"><span>Số tiền</span><b>${formatVND(t.amount)}</b></div>
      <div class="oc-line"><span>Ngày</span><b>${formatDate(t.date)}</b></div>
      ${t.note ? `<div class="oc-line"><span>Ghi chú</span><b>${t.note}</b></div>` : ''}
    `,
    footHtml: `
      <button class="btn btn-outline btn-block" data-edit>${icon('edit', 'icon-sm')} Sửa</button>
      <button class="btn btn-danger-outline btn-block" data-del style="margin-top:8px">${icon('trash', 'icon-sm')} Xóa</button>
    `,
    onMount(sheet, closeFn) {
      sheet.querySelector('[data-edit]').addEventListener('click', () => { closeFn(); openTransactionForm({ transaction: t }); });
      sheet.querySelector('[data-del]').addEventListener('click', () => {
        closeFn();
        confirmDialog({
          title: 'Xóa giao dịch?', message: 'Không thể hoàn tác sau khi xóa.', confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try { await S.deleteTransaction(t.id); toast('Đã xóa giao dịch', 'success'); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
}
