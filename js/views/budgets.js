import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { formatVND, formatNumber, attachMoneyInput, unformatMoney } from '../utils.js';

const PALETTE = ['#2563eb', '#2f6fed', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0891b2', '#dc2626'];

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Danh mục' });
}

export function render(contentEl) {
  const expense = S.listCategories({ type: 'expense' });
  const income = S.listCategories({ type: 'income' });
  contentEl.innerHTML = `
    <div class="mb-16"><button class="btn btn-primary btn-block" id="btn-add-cat">${icon('plus', 'icon-sm')} Thêm danh mục</button></div>
    <div class="section-head"><h2>Khoản chi</h2></div>
    ${expense.length ? `<div class="card mb-16">${expense.map((c, i) => categoryRowHtml(c, i === 0, i === expense.length - 1)).join('')}</div>` : `<p class="text-sm text-muted mb-16">Chưa có danh mục chi nào.</p>`}
    <div class="section-head"><h2>Khoản thu</h2></div>
    ${income.length ? `<div class="card">${income.map((c, i) => categoryRowHtml(c, i === 0, i === income.length - 1)).join('')}</div>` : `<p class="text-sm text-muted">Chưa có danh mục thu nào.</p>`}
  `;
  contentEl.querySelector('#btn-add-cat').addEventListener('click', () => openCategoryFormModal());
  contentEl.querySelectorAll('[data-cat-edit]').forEach((row) => {
    row.addEventListener('click', () => openCategoryFormModal(S.getCategory(row.dataset.catEdit)));
  });
  contentEl.querySelectorAll('[data-move]').forEach((btn) => {
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
