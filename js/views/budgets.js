import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { emptyState } from '../components/ui.js';
import { toast } from '../components/toast.js';
import { formatVND, formatNumber, attachMoneyInput, unformatMoney } from '../utils.js';

const MONTH_NAMES = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
const PALETTE = ['#2563eb', '#2f6fed', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#dc2626'];

let tab = 'budget';
let cursor = new Date();

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Ngân sách' });
}

export function render(contentEl) {
  contentEl.innerHTML = `
    <div class="tabs mb-16">
      <button data-tab="budget" class="${tab === 'budget' ? 'active' : ''}">Ngân sách tháng</button>
      <button data-tab="category" class="${tab === 'category' ? 'active' : ''}">Danh mục</button>
    </div>
    <div id="tab-body"></div>
  `;
  contentEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { tab = btn.dataset.tab; render(contentEl); });
  });
  const body = contentEl.querySelector('#tab-body');
  if (tab === 'budget') renderBudgetTab(body); else renderCategoryTab(body);
}

function renderBudgetTab(body) {
  const year = cursor.getFullYear(), month = cursor.getMonth() + 1;
  const rows = S.budgetOverviewForMonth(year, month);
  const totalLimit = rows.reduce((s, r) => s + (r.limit || 0), 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);

  body.innerHTML = `
    <div class="flex items-center justify-between mb-16">
      <button class="icon-btn" id="btn-prev-month">${icon('chevronLeft')}</button>
      <b>${MONTH_NAMES[month - 1]} ${year}</b>
      <button class="icon-btn" id="btn-next-month">${icon('chevronRight')}</button>
    </div>
    ${totalLimit ? `
    <div class="card card-pad mb-16">
      <div class="flex items-center justify-between mb-4">
        <span class="text-sm fw-700">Tổng ngân sách</span>
        <span class="text-sm ${totalSpent > totalLimit ? 'text-danger' : 'text-muted'}">${formatVND(totalSpent)} / ${formatVND(totalLimit)}</span>
      </div>
      <div class="progress-bar ${totalSpent > totalLimit ? 'over' : ''}"><div class="progress-fill" style="width:${Math.min(100, Math.round(totalSpent / totalLimit * 100))}%"></div></div>
    </div>` : ''}
    <div class="mb-12"><button class="btn btn-outline btn-sm" id="btn-copy-prev">${icon('refresh', 'icon-sm')} Sao chép hạn mức từ tháng trước</button></div>
    ${rows.length ? `<div class="card">${rows.map((r) => budgetRowHtml(r)).join('')}</div>` : `<div class="card card-pad">${emptyState({ iconName: 'wallet', title: 'Chưa có danh mục chi tiêu', message: 'Sang tab Danh mục để tạo danh mục trước.' })}</div>`}
  `;

  body.querySelector('#btn-prev-month').addEventListener('click', () => { cursor = new Date(year, month - 2, 1); render(body.closest('.app-content')); });
  body.querySelector('#btn-next-month').addEventListener('click', () => { cursor = new Date(year, month, 1); render(body.closest('.app-content')); });
  body.querySelector('#btn-copy-prev').addEventListener('click', async () => {
    const n = await S.copyBudgetsFromPreviousMonth(year, month);
    toast(n ? `Đã sao chép ${n} hạn mức từ tháng trước` : 'Tháng trước chưa đặt hạn mức riêng nào', n ? 'success' : 'default');
  });
  body.querySelectorAll('[data-budget-cat]').forEach((row) => {
    row.addEventListener('click', () => openBudgetEditModal(row.dataset.budgetCat, year, month));
  });
}

function budgetRowHtml(r) {
  const pct = Math.min(100, r.percent || 0);
  return `
    <div class="list-row" data-budget-cat="${r.category.id}" style="cursor:pointer;flex-direction:column;align-items:stretch;gap:6px">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-8">
          <div class="cat-icon" style="background:${r.category.color}">${icon(r.category.icon, 'icon-sm')}</div>
          <span class="text-sm fw-700">${r.category.name}</span>
        </div>
        <span class="text-sm ${r.over ? 'text-danger' : 'text-muted'}">${formatVND(r.spent)}${r.limit != null ? ` / ${formatVND(r.limit)}` : ''}</span>
      </div>
      ${r.limit != null ? `<div class="progress-bar ${r.over ? 'over' : ''}"><div class="progress-fill" style="width:${pct}%"></div></div>` : `<div class="text-sm text-faint">Chưa đặt hạn mức — bấm để đặt</div>`}
    </div>`;
}

function openBudgetEditModal(categoryId, year, month) {
  const cat = S.getCategory(categoryId);
  const current = S.effectiveBudget(categoryId, year, month);
  openModal({
    title: `Hạn mức — ${cat.name}`,
    bodyHtml: `
      <div class="field">
        <label>Hạn mức tháng ${month}/${year}</label>
        <input id="budget-amount" type="text" inputmode="numeric" value="${current != null ? formatNumber(current) : ''}" placeholder="Để trống = không giới hạn"/>
        <div class="field-hint">Chỉ áp dụng cho tháng này. Muốn đổi hạn mức mặc định cho mọi tháng, sửa ở tab Danh mục.</div>
      </div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-save>Lưu</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#budget-amount'));
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const val = sheet.querySelector('#budget-amount').value;
        closeFn();
        try { await S.setBudget(year, month, categoryId, val === '' ? null : unformatMoney(val)); toast('Đã lưu hạn mức', 'success'); }
        catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
      });
    },
  });
}

function renderCategoryTab(body) {
  const expense = S.listCategories({ type: 'expense' });
  const income = S.listCategories({ type: 'income' });
  body.innerHTML = `
    <div class="mb-16"><button class="btn btn-primary btn-block" id="btn-add-cat">${icon('plus', 'icon-sm')} Thêm danh mục</button></div>
    <div class="section-head"><h2>Khoản chi</h2></div>
    ${expense.length ? `<div class="card mb-16">${expense.map((c, i) => categoryRowHtml(c, i === 0, i === expense.length - 1)).join('')}</div>` : `<p class="text-sm text-muted mb-16">Chưa có danh mục chi nào.</p>`}
    <div class="section-head"><h2>Khoản thu</h2></div>
    ${income.length ? `<div class="card">${income.map((c, i) => categoryRowHtml(c, i === 0, i === income.length - 1)).join('')}</div>` : `<p class="text-sm text-muted">Chưa có danh mục thu nào.</p>`}
  `;
  body.querySelector('#btn-add-cat').addEventListener('click', () => openCategoryFormModal());
  body.querySelectorAll('[data-cat-edit]').forEach((row) => {
    row.addEventListener('click', () => openCategoryFormModal(S.getCategory(row.dataset.catEdit)));
  });
  body.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await S.moveCategory(btn.dataset.move, btn.dataset.dir); }
      catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
    });
  });
}

function categoryRowHtml(c, isFirst, isLast) {
  return `
    <div class="list-row" data-cat-edit="${c.id}" style="cursor:pointer">
      <div class="cat-icon" style="background:${c.color}">${icon(c.icon, 'icon-sm')}</div>
      <div class="row-main">
        <div class="row-title">${c.name}</div>
        <div class="row-sub">${c.monthlyBudget != null ? `Mặc định ${formatVND(c.monthlyBudget)}/tháng` : 'Chưa đặt hạn mức mặc định'}</div>
      </div>
      <div class="flex items-center gap-4">
        <button class="icon-btn" data-move="${c.id}" data-dir="up" ${isFirst ? 'disabled style="opacity:.3"' : ''}>${icon('chevronUp', 'icon-sm')}</button>
        <button class="icon-btn" data-move="${c.id}" data-dir="down" ${isLast ? 'disabled style="opacity:.3"' : ''}>${icon('chevronDown', 'icon-sm')}</button>
      </div>
    </div>`;
}

function openCategoryFormModal(category) {
  let type = category ? category.type : 'expense';
  let selectedIcon = category ? category.icon : 'tag';
  let selectedColor = category ? category.color : PALETTE[0];
  const iconChoices = S.CATEGORY_ICONS;

  const close = openModal({
    title: category ? 'Sửa danh mục' : 'Thêm danh mục',
    bodyHtml: `
      <div class="tabs mb-16">
        <button type="button" data-type="expense" class="${type === 'expense' ? 'active' : ''}">Khoản chi</button>
        <button type="button" data-type="income" class="${type === 'income' ? 'active' : ''}">Khoản thu</button>
      </div>
      <div class="field">
        <label>Tên danh mục</label>
        <input id="cat-name" value="${category ? category.name.replace(/"/g, '&quot;') : ''}" required/>
      </div>
      <div class="field">
        <label>Biểu tượng</label>
        <div class="flex gap-8" id="icon-grid" style="flex-wrap:wrap">
          ${iconChoices.map((ic) => `<button type="button" class="icon-btn" data-icon="${ic}" style="border:2px solid ${ic === selectedIcon ? 'var(--color-primary)' : 'transparent'}">${icon(ic, 'icon-sm')}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Màu</label>
        <div class="flex gap-8" id="color-grid">
          ${PALETTE.map((cl) => `<button type="button" data-color="${cl}" style="width:28px;height:28px;border-radius:50%;background:${cl};border:2px solid ${cl === selectedColor ? 'var(--text)' : 'transparent'};cursor:pointer"></button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Hạn mức mặc định hàng tháng</label>
        <input id="cat-budget" type="text" inputmode="numeric" value="${category?.monthlyBudget != null ? formatNumber(category.monthlyBudget) : ''}" placeholder="Để trống = không giới hạn"/>
      </div>
      <div class="field-error" id="cat-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `
      <button class="btn btn-primary btn-block" data-save>Lưu</button>
      ${category ? `<button class="btn btn-danger-outline btn-block" data-del style="margin-top:8px">${icon('trash', 'icon-sm')} Xóa danh mục</button>` : ''}
    `,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#cat-budget'));
      sheet.querySelectorAll('[data-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
          type = btn.dataset.type;
          sheet.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b === btn));
        });
      });
      sheet.querySelectorAll('[data-icon]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedIcon = btn.dataset.icon;
          sheet.querySelectorAll('[data-icon]').forEach((b) => b.style.borderColor = b === btn ? 'var(--color-primary)' : 'transparent');
        });
      });
      sheet.querySelectorAll('[data-color]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedColor = btn.dataset.color;
          sheet.querySelectorAll('[data-color]').forEach((b) => b.style.borderColor = b === btn ? 'var(--text)' : 'transparent');
        });
      });
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const name = sheet.querySelector('#cat-name').value.trim();
        const budget = sheet.querySelector('#cat-budget').value;
        const errEl = sheet.querySelector('#cat-error');
        if (!name) { errEl.textContent = 'Cần nhập tên danh mục.'; errEl.style.display = 'block'; return; }
        try {
          await S.upsertCategory({ id: category?.id, name, type, icon: selectedIcon, color: selectedColor, monthlyBudget: budget === '' ? null : unformatMoney(budget) });
          toast('Đã lưu danh mục', 'success');
          closeFn();
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
      const delBtn = sheet.querySelector('[data-del]');
      if (delBtn) delBtn.addEventListener('click', () => {
        closeFn();
        confirmDialog({
          title: 'Xóa danh mục?', message: 'Giao dịch cũ dùng danh mục này sẽ không bị xóa, chỉ mất liên kết.', confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try { await S.deleteCategory(category.id); toast('Đã xóa danh mục', 'success'); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
  return close;
}
