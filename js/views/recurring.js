import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { emptyState } from '../components/ui.js';
import { toast } from '../components/toast.js';
import { formatVND, formatNumber, attachMoneyInput, unformatMoney } from '../utils.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Định kỳ' });
}

export function render(contentEl) {
  const pending = S.pendingRecurringReminders();
  const list = S.listRecurring();

  contentEl.innerHTML = `
    <div class="mb-16"><button class="btn btn-primary btn-block" id="btn-add">${icon('plus', 'icon-sm')} Thêm khoản định kỳ</button></div>
    ${pending.length ? `
    <div class="card card-pad mb-16" style="background:var(--warning-bg);border-color:transparent">
      <div class="flex items-center gap-8 mb-8" style="color:var(--warning)">${icon('bell', 'icon-sm')}<b class="text-sm">Đến hạn tháng này, chưa ghi sổ</b></div>
      ${pending.map((r) => pendingRowHtml(r)).join('')}
    </div>` : ''}
    <div class="section-head"><h2>Tất cả khoản định kỳ</h2></div>
    ${list.length ? `<div class="card">${list.map((r) => recurringRowHtml(r)).join('')}</div>` : `<div class="card card-pad">${emptyState({ iconName: 'refresh', title: 'Chưa có khoản định kỳ nào', message: 'Thêm tiền điện, tiền nhà, lương... để app tự nhắc hàng tháng.' })}</div>`}
  `;

  contentEl.querySelector('#btn-add').addEventListener('click', () => openRecurringForm());
  contentEl.querySelectorAll('[data-rec-edit]').forEach((row) => {
    row.addEventListener('click', () => openRecurringForm(S.listRecurring().find((r) => r.id === row.dataset.recEdit)));
  });
  contentEl.querySelectorAll('[data-confirm]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirmModal(btn.dataset.confirm);
    });
  });
}

function pendingRowHtml(r) {
  const cat = S.getCategory(r.categoryId);
  return `
    <div class="oc-line">
      <span>${cat ? cat.name : r.note || 'Định kỳ'} (ngày ${r.dayOfMonth})</span>
      <span class="flex items-center gap-8"><b>${formatVND(r.amount)}</b><button class="btn btn-sm btn-outline" data-confirm="${r.id}">Xác nhận</button></span>
    </div>`;
}

function recurringRowHtml(r) {
  const cat = S.getCategory(r.categoryId);
  const isExpense = r.type === 'expense';
  return `
    <div class="list-row" data-rec-edit="${r.id}" style="cursor:pointer">
      <div class="cat-icon" style="background:${cat ? cat.color : '#94a3b8'}">${icon(cat ? cat.icon : 'refresh', 'icon-sm')}</div>
      <div class="row-main">
        <div class="row-title">${cat ? cat.name : r.note || 'Định kỳ'}</div>
        <div class="row-sub">Ngày ${r.dayOfMonth} hàng tháng${r.note ? ' · ' + r.note : ''}</div>
      </div>
      <div class="row-end"><span class="amount" style="color:${isExpense ? 'var(--danger)' : 'var(--success)'}">${isExpense ? '-' : '+'}${formatVND(r.amount)}</span></div>
    </div>`;
}

function openConfirmModal(recurringId) {
  const r = S.listRecurring().find((x) => x.id === recurringId);
  if (!r) return;
  openModal({
    title: 'Xác nhận khoản định kỳ',
    bodyHtml: `
      <p class="text-sm text-muted mb-16">Tạo giao dịch cho tháng này — có thể sửa số tiền nếu tháng này khác thường.</p>
      <div class="field"><label>Số tiền</label><input id="confirm-amount" type="text" inputmode="numeric" value="${formatNumber(r.amount)}"/></div>
      <div class="field"><label>Ngày ghi sổ</label><input id="confirm-date" type="date" value="${new Date().toISOString().slice(0, 10)}"/></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-ok>Xác nhận & ghi sổ</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#confirm-amount'));
      sheet.querySelector('[data-ok]').addEventListener('click', async () => {
        const amount = unformatMoney(sheet.querySelector('#confirm-amount').value);
        const date = sheet.querySelector('#confirm-date').value;
        closeFn();
        try { await S.confirmRecurring(recurringId, { amount, date }); toast('Đã ghi sổ', 'success'); }
        catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
      });
    },
  });
}

function openRecurringForm(r) {
  let type = r ? r.type : 'expense';
  function catOptions() {
    return S.listCategories({ type }).map((c) => `<option value="${c.id}" ${r?.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
  }
  openModal({
    title: r ? 'Sửa khoản định kỳ' : 'Thêm khoản định kỳ',
    bodyHtml: `
      <div class="tabs mb-16">
        <button type="button" data-type="expense" class="${type === 'expense' ? 'active' : ''}">Khoản chi</button>
        <button type="button" data-type="income" class="${type === 'income' ? 'active' : ''}">Khoản thu</button>
      </div>
      <div class="field"><label>Số tiền</label><input id="rec-amount" type="text" inputmode="numeric" value="${r ? formatNumber(r.amount) : ''}" required/></div>
      <div class="field"><label>Danh mục</label><select id="rec-cat">${catOptions()}</select></div>
      <div class="field"><label>Ngày trong tháng</label><input id="rec-day" type="number" min="1" max="28" value="${r ? r.dayOfMonth : 5}" required/><div class="field-hint">1-28, để tránh lỗi với tháng 2.</div></div>
      <div class="field"><label>Ghi chú</label><input id="rec-note" value="${r ? (r.note || '').replace(/"/g, '&quot;') : ''}"/></div>
      <div class="field-error" id="rec-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `
      <button class="btn btn-primary btn-block" data-save>Lưu</button>
      ${r ? `<button class="btn btn-danger-outline btn-block" data-del style="margin-top:8px">${icon('trash', 'icon-sm')} Xóa</button>` : ''}
    `,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#rec-amount'));
      sheet.querySelectorAll('[data-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
          type = btn.dataset.type;
          sheet.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b === btn));
          sheet.querySelector('#rec-cat').innerHTML = catOptions();
        });
      });
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const payload = {
          type, amount: unformatMoney(sheet.querySelector('#rec-amount').value), categoryId: sheet.querySelector('#rec-cat').value,
          dayOfMonth: sheet.querySelector('#rec-day').value, note: sheet.querySelector('#rec-note').value, active: true,
        };
        const errEl = sheet.querySelector('#rec-error');
        try {
          if (r) await S.updateRecurring(r.id, payload); else await S.addRecurring(payload);
          toast('Đã lưu', 'success');
          closeFn();
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
      const delBtn = sheet.querySelector('[data-del]');
      if (delBtn) delBtn.addEventListener('click', () => {
        closeFn();
        confirmDialog({
          title: 'Xóa khoản định kỳ?', message: 'Các giao dịch đã ghi từ trước vẫn được giữ nguyên.', confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try { await S.deleteRecurring(r.id); toast('Đã xóa', 'success'); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
}
