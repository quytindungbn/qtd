import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { emptyState } from '../components/ui.js';
import { toast } from '../components/toast.js';
import { formatVND, formatDate, formatNumber, attachMoneyInput, unformatMoney } from '../utils.js';

let tab = 'active';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Quản lý nợ' });
}

export function render(contentEl) {
  const summary = S.debtsSummary();
  contentEl.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="oc-line"><span>Tổng nợ gốc</span><b>${formatVND(summary.totalOriginal)}</b></div>
      <div class="oc-line"><span>Còn phải trả</span><b style="color:var(--danger)">${formatVND(summary.totalRemaining)}</b></div>
    </div>
    <div class="mb-16"><button class="btn btn-primary btn-block" id="btn-add">${icon('plus', 'icon-sm')} Thêm khoản nợ</button></div>
    <div class="tabs mb-16">
      <button data-tab="active" class="${tab === 'active' ? 'active' : ''}">Đang nợ</button>
      <button data-tab="paid" class="${tab === 'paid' ? 'active' : ''}">Đã trả xong</button>
    </div>
    <div id="debt-list"></div>
  `;
  contentEl.querySelector('#btn-add').addEventListener('click', () => openDebtForm());
  contentEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { tab = btn.dataset.tab; render(contentEl); });
  });
  renderList(contentEl.querySelector('#debt-list'));
}

function renderList(listEl) {
  const debts = S.listDebts({ status: tab });
  listEl.innerHTML = debts.length
    ? debts.map((d) => debtCardHtml(d)).join('')
    : `<div class="card card-pad">${emptyState({
        iconName: 'creditCard',
        title: tab === 'active' ? 'Chưa có khoản nợ nào' : 'Chưa có khoản nợ nào trả xong',
        message: tab === 'active' ? 'Thêm khoản nợ mua trả góp, vay mượn... để theo dõi dư nợ.' : 'Khoản nợ trả hết sẽ chuyển sang đây.',
      })}</div>`;
  listEl.querySelectorAll('[data-debt]').forEach((row) => {
    row.addEventListener('click', () => openDebtDetail(S.getDebt(row.dataset.debt)));
  });
}

function debtCardHtml(d) {
  const pct = d.totalAmount ? Math.min(100, Math.round(((d.totalAmount - d.remainingAmount) / d.totalAmount) * 100)) : 0;
  return `
    <div class="card card-pad mb-16" data-debt="${d.id}" style="cursor:pointer">
      <div class="flex items-center justify-between mb-8">
        <div class="flex items-center gap-8">
          <div class="cat-icon" style="background:var(--color-primary)">${icon('creditCard', 'icon-sm')}</div>
          <div>
            <b>${d.name}</b>
            ${d.creditor ? `<div class="text-sm text-muted">${d.creditor}</div>` : ''}
          </div>
        </div>
        ${icon('chevronRight', 'icon-sm')}
      </div>
      <div class="flex items-center justify-between mb-4">
        <span class="text-sm text-muted">Còn lại ${formatVND(d.remainingAmount)} / ${formatVND(d.totalAmount)}</span>
        <span class="text-sm fw-700">${pct}%</span>
      </div>
      <div class="progress-bar mb-8"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
}

function openDebtDetail(d) {
  if (!d) return;
  const payments = S.listDebtPayments(d.id);
  openModal({
    title: d.name,
    bodyHtml: `
      ${d.creditor ? `<div class="oc-line"><span>Vay/mua của</span><b>${d.creditor}</b></div>` : ''}
      <div class="oc-line"><span>Tổng nợ gốc</span><b>${formatVND(d.totalAmount)}</b></div>
      <div class="oc-line"><span>Còn phải trả</span><b style="color:var(--danger)">${formatVND(d.remainingAmount)}</b></div>
      <div class="oc-line"><span>Ngày vay/mua</span><b>${formatDate(d.startDate)}</b></div>
      ${d.note ? `<div class="oc-line"><span>Ghi chú</span><b>${d.note}</b></div>` : ''}
      ${payments.length ? `
        <div class="fw-700 text-sm mt-16 mb-8">Lịch sử trả nợ</div>
        ${payments.map((p) => `<div class="oc-line"><span>${formatDate(p.paymentDate)}</span><b>${formatVND(p.amount)}</b></div>`).join('')}
      ` : ''}
    `,
    footHtml: d.status === 'active' ? `
      <button class="btn btn-primary btn-block" data-pay>${icon('check', 'icon-sm')} Trả nợ</button>
      <button class="btn btn-outline btn-block" data-edit style="margin-top:8px">${icon('edit', 'icon-sm')} Sửa</button>
      <button class="btn btn-danger-outline btn-block" data-del style="margin-top:8px">${icon('trash', 'icon-sm')} Xóa</button>
    ` : `
      <button class="btn btn-danger-outline btn-block" data-del>${icon('trash', 'icon-sm')} Xóa khoản nợ (không xóa giao dịch đã ghi)</button>
    `,
    onMount(sheet, closeFn) {
      const payBtn = sheet.querySelector('[data-pay]');
      if (payBtn) payBtn.addEventListener('click', () => { closeFn(); openPayModal(d); });
      const editBtn = sheet.querySelector('[data-edit]');
      if (editBtn) editBtn.addEventListener('click', () => { closeFn(); openDebtForm(d); });
      sheet.querySelector('[data-del]').addEventListener('click', () => {
        closeFn();
        confirmDialog({
          title: 'Xóa khoản nợ?', message: 'Không thể hoàn tác. Các giao dịch đã ghi khi trả nợ trước đó vẫn được giữ nguyên.', confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try { await S.deleteDebt(d.id); toast('Đã xóa khoản nợ', 'success'); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
}

function openPayModal(d) {
  const suggested = d.remainingAmount;
  function categoryOptionsHtml() {
    return `<option value="">Không chọn</option>` + S.listCategories({ type: 'expense' }).map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  }
  openModal({
    title: `Trả nợ — ${d.name}`,
    bodyHtml: `
      <p class="text-sm text-muted mb-16">Còn phải trả: <b>${formatVND(d.remainingAmount)}</b> — sẽ tự tạo 1 giao dịch chi tương ứng.</p>
      <div class="field"><label>Số tiền trả</label><input id="pay-amount" type="text" inputmode="numeric" value="${formatNumber(suggested)}"/></div>
      <div class="field"><label>Ngày trả</label><input id="pay-date" type="date" value="${new Date().toISOString().slice(0, 10)}"/></div>
      <div class="field"><label>Danh mục (không bắt buộc)</label><select id="pay-cat">${categoryOptionsHtml()}</select></div>
      <div class="field-error" id="pay-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-ok>Xác nhận trả nợ</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#pay-amount'));
      sheet.querySelector('[data-ok]').addEventListener('click', async () => {
        const amount = unformatMoney(sheet.querySelector('#pay-amount').value);
        const date = sheet.querySelector('#pay-date').value;
        const categoryId = sheet.querySelector('#pay-cat').value;
        const errEl = sheet.querySelector('#pay-error');
        try {
          await S.payDebt(d.id, { amount, date, categoryId });
          toast('Đã ghi nhận trả nợ', 'success');
          closeFn();
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
    },
  });
}

function openDebtForm(d) {
  openModal({
    title: d ? 'Sửa khoản nợ' : 'Thêm khoản nợ',
    bodyHtml: `
      <div class="field"><label>Tên khoản nợ</label><input id="debt-name" value="${d ? d.name.replace(/"/g, '&quot;') : ''}" placeholder="VD: Trả góp điện thoại" required/></div>
      <div class="field"><label>Vay/mua của (không bắt buộc)</label><input id="debt-creditor" value="${d ? (d.creditor || '').replace(/"/g, '&quot;') : ''}"/></div>
      <div class="field"><label>Tổng nợ gốc</label><input id="debt-total" type="text" inputmode="numeric" value="${d ? formatNumber(d.totalAmount) : ''}" required/></div>
      <div class="field"><label>Ngày vay/mua</label><input id="debt-start" type="date" value="${d ? d.startDate : new Date().toISOString().slice(0, 10)}" required/></div>
      <div class="field"><label>Ghi chú</label><input id="debt-note" value="${d ? (d.note || '').replace(/"/g, '&quot;') : ''}"/></div>
      <div class="field-error" id="debt-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-save>${d ? 'Lưu thay đổi' : 'Thêm khoản nợ'}</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#debt-total'));
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const name = sheet.querySelector('#debt-name').value.trim();
        const creditor = sheet.querySelector('#debt-creditor').value.trim();
        const totalAmount = unformatMoney(sheet.querySelector('#debt-total').value);
        const startDate = sheet.querySelector('#debt-start').value;
        const note = sheet.querySelector('#debt-note').value;
        const errEl = sheet.querySelector('#debt-error');
        if (!name || !totalAmount) { errEl.textContent = 'Cần nhập đủ tên và tổng nợ gốc.'; errEl.style.display = 'block'; return; }
        try {
          if (d) await S.updateDebt(d.id, { name, creditor, totalAmount, startDate, note });
          else await S.addDebt({ name, creditor, totalAmount, startDate, note });
          toast('Đã lưu khoản nợ', 'success');
          closeFn();
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
    },
  });
}
