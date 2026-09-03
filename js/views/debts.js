import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { emptyState } from '../components/ui.js';
import { toast } from '../components/toast.js';
import { formatVND, formatDate, formatNumber, attachMoneyInput, unformatMoney } from '../utils.js';

// Quản lý nợ theo TỪNG CHỦ NỢ (vd "Tạp hóa A") — mỗi chủ nợ 1 sổ riêng gồm
// nhiều dòng "ghi nợ" (mua gì, ngày nào, nợ bao nhiêu) và "trả nợ" (ngày
// nào, trả bao nhiêu). Riêng tư của người đang đăng nhập, không hiện ở
// Tổng quan (xem state.js).
let tab = 'active';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Quản lý nợ' });
}

export function render(contentEl) {
  const total = S.totalDebtRemaining();
  contentEl.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="oc-line"><span>Tổng còn nợ</span><b style="color:var(--danger)">${formatVND(total)}</b></div>
    </div>
    <div class="mb-16"><button class="btn btn-primary btn-block" id="btn-add">${icon('plus', 'icon-sm')} Ghi nợ mới</button></div>
    <div class="tabs mb-16">
      <button data-tab="active" class="${tab === 'active' ? 'active' : ''}">Đang nợ</button>
      <button data-tab="paid" class="${tab === 'paid' ? 'active' : ''}">Đã trả hết</button>
    </div>
    <div id="creditor-list"></div>
  `;
  contentEl.querySelector('#btn-add').addEventListener('click', () => openChargeForm());
  contentEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { tab = btn.dataset.tab; render(contentEl); });
  });
  renderList(contentEl.querySelector('#creditor-list'));
}

function renderList(listEl) {
  const creditors = S.listCreditors({ status: tab });
  listEl.innerHTML = creditors.length
    ? creditors.map((c) => creditorCardHtml(c)).join('')
    : `<div class="card card-pad">${emptyState({
        iconName: 'creditCard',
        title: tab === 'active' ? 'Chưa có khoản nợ nào' : 'Chưa có chủ nợ nào trả hết',
        message: tab === 'active' ? 'Bấm "Ghi nợ mới" để ghi lại khoản mua/vay nợ theo từng chủ nợ.' : 'Chủ nợ trả hết nợ sẽ chuyển sang đây.',
      })}</div>`;
  listEl.querySelectorAll('[data-creditor]').forEach((row) => {
    row.addEventListener('click', () => openCreditorDetail(row.dataset.creditor));
  });
}

function creditorCardHtml(c) {
  return `
    <div class="card card-pad mb-16" data-creditor="${c.id}" style="cursor:pointer">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-8">
          <div class="cat-icon" style="background:var(--color-primary)">${icon('creditCard', 'icon-sm')}</div>
          <div>
            <b>${c.name}</b>
            ${c.lastDate ? `<div class="text-sm text-muted">Gần nhất: ${formatDate(c.lastDate)}</div>` : ''}
          </div>
        </div>
        <div style="text-align:right">
          <div class="fw-700" style="color:${c.balance > 0 ? 'var(--danger)' : 'var(--success)'}">${formatVND(c.balance)}</div>
          <div class="text-sm text-muted">${c.balance > 0 ? 'còn nợ' : 'đã hết nợ'}</div>
        </div>
      </div>
    </div>`;
}

function openCreditorDetail(creditorId) {
  const c = S.getCreditor(creditorId);
  if (!c) return;
  const balance = S.creditorBalance(c.id);
  const entries = S.listDebtEntries(c.id);
  openModal({
    title: c.name,
    bodyHtml: `
      <div class="oc-line mb-16"><span>Còn nợ</span><b style="color:${balance > 0 ? 'var(--danger)' : 'var(--success)'}">${formatVND(balance)}</b></div>
      ${entries.length ? `
        <div class="fw-700 text-sm mb-8">Sổ nợ</div>
        ${entries.map((e) => entryRowHtml(e)).join('')}
      ` : `<p class="text-sm text-muted">Chưa có dòng nào trong sổ nợ.</p>`}
    `,
    footHtml: `
      <button class="btn btn-primary btn-block" data-charge>${icon('plus', 'icon-sm')} Ghi nợ thêm</button>
      <button class="btn btn-outline btn-block" data-pay style="margin-top:8px">${icon('check', 'icon-sm')} Trả nợ</button>
      <button class="btn btn-outline btn-block" data-rename style="margin-top:8px">${icon('edit', 'icon-sm')} Đổi tên chủ nợ</button>
      <button class="btn btn-danger-outline btn-block" data-del style="margin-top:8px">${icon('trash', 'icon-sm')} Xóa chủ nợ này</button>
    `,
    onMount(sheet, closeFn) {
      sheet.querySelector('[data-charge]').addEventListener('click', () => { closeFn(); openChargeForm({ creditorId: c.id, creditorName: c.name }); });
      sheet.querySelector('[data-pay]').addEventListener('click', () => { closeFn(); openPayModal(c, balance); });
      sheet.querySelector('[data-rename]').addEventListener('click', () => { closeFn(); openRenameModal(c); });
      sheet.querySelector('[data-del]').addEventListener('click', () => {
        closeFn();
        confirmDialog({
          title: 'Xóa chủ nợ này?', message: `Xóa toàn bộ sổ nợ của "${c.name}". Các giao dịch chi tiêu đã ghi khi trả nợ trước đó vẫn được giữ nguyên. Không thể hoàn tác.`, confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try { await S.deleteCreditor(c.id); toast('Đã xóa chủ nợ', 'success'); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
      sheet.querySelectorAll('[data-entry]').forEach((row) => {
        row.addEventListener('click', () => { closeFn(); openEntryActions(entries.find((e) => e.id === row.dataset.entry), c); });
      });
    },
  });
}

function entryRowHtml(e) {
  const isCharge = e.kind === 'charge';
  return `
    <div class="list-row" data-entry="${e.id}" style="cursor:pointer">
      <div class="row-thumb" style="background:${isCharge ? 'var(--danger)' : 'var(--success)'}">${icon(isCharge ? 'cart' : 'check', 'icon-sm')}</div>
      <div class="row-main">
        <div class="row-title">${isCharge ? (e.description || 'Ghi nợ') : (e.description || 'Trả nợ')}</div>
        <div class="row-sub">${formatDate(e.date)}${e.transactionId ? ' · đã tính vào chi tiêu' : ''}</div>
      </div>
      <div class="row-end"><span class="amount" style="color:${isCharge ? 'var(--danger)' : 'var(--success)'}">${isCharge ? '+' : '-'}${formatVND(e.amount)}</span></div>
    </div>`;
}

function openEntryActions(e, c) {
  if (!e) return;
  const isCharge = e.kind === 'charge';
  openModal({
    title: isCharge ? 'Dòng ghi nợ' : 'Dòng trả nợ',
    bodyHtml: `
      <div class="oc-line"><span>Ngày</span><b>${formatDate(e.date)}</b></div>
      ${e.description ? `<div class="oc-line"><span>${isCharge ? 'Mua gì' : 'Ghi chú'}</span><b>${e.description}</b></div>` : ''}
      <div class="oc-line"><span>Số tiền</span><b>${formatVND(e.amount)}</b></div>
      <div class="oc-line"><span>Đưa vào chi tiêu</span><b>${e.transactionId ? 'Có' : 'Không'}</b></div>
      ${e.transactionId ? `<p class="text-sm text-muted mt-16">Dòng này có kèm 1 giao dịch chi tiêu thật. Sửa/xóa sẽ đồng bộ luôn giao dịch đó.</p>` : ''}
    `,
    footHtml: `
      <button class="btn btn-outline btn-block" data-edit>${icon('edit', 'icon-sm')} Sửa</button>
      <button class="btn btn-danger-outline btn-block" data-del style="margin-top:8px">${icon('trash', 'icon-sm')} Xóa</button>
    `,
    onMount(sheet, closeFn) {
      sheet.querySelector('[data-edit]').addEventListener('click', () => { closeFn(); openEditEntryForm(e, c); });
      sheet.querySelector('[data-del]').addEventListener('click', () => {
        closeFn();
        confirmDialog({
          title: 'Xóa dòng này?',
          message: e.transactionId ? 'Giao dịch chi tiêu thật đã tạo kèm dòng này cũng sẽ bị xóa. Không thể hoàn tác.' : 'Không thể hoàn tác.',
          confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try { await S.deleteDebtEntry(e.id); toast('Đã xóa', 'success'); openCreditorDetail(c.id); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
}

function openEditEntryForm(e, c) {
  const isCharge = e.kind === 'charge';
  openModal({
    title: isCharge ? 'Sửa ghi nợ' : 'Sửa trả nợ',
    bodyHtml: `
      <div class="field"><label>Ngày</label><input id="entry-date" type="date" value="${e.date}" required/></div>
      <div class="field"><label>${isCharge ? 'Mua gì' : 'Ghi chú (không bắt buộc)'}</label><input id="entry-desc" value="${(e.description || '').replace(/"/g, '&quot;')}"/></div>
      <div class="field"><label>Số tiền</label><input id="entry-amount" type="text" inputmode="numeric" value="${formatNumber(e.amount)}" required/></div>
      ${addToTxnFieldsHtml('entry', !!e.transactionId)}
      <div class="field-error" id="entry-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-save>Lưu thay đổi</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#entry-amount'));
      bindAddToTxnToggle(sheet, 'entry');
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const date = sheet.querySelector('#entry-date').value;
        const description = sheet.querySelector('#entry-desc').value.trim();
        const amount = unformatMoney(sheet.querySelector('#entry-amount').value);
        const addToTransactions = sheet.querySelector('#entry-add-txn').checked;
        const categoryId = sheet.querySelector('#entry-cat').value;
        const errEl = sheet.querySelector('#entry-error');
        try {
          await S.updateDebtEntry(e.id, { amount, date, description, categoryId, addToTransactions });
          toast('Đã lưu', 'success');
          closeFn();
          openCreditorDetail(c.id);
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
    },
  });
}

function openRenameModal(c) {
  openModal({
    title: 'Đổi tên chủ nợ',
    bodyHtml: `
      <div class="field"><label>Tên chủ nợ</label><input id="creditor-name" value="${c.name.replace(/"/g, '&quot;')}" required/></div>
      <div class="field"><label>Ghi chú (không bắt buộc)</label><input id="creditor-note" value="${(c.note || '').replace(/"/g, '&quot;')}"/></div>
      <div class="field-error" id="creditor-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-save>Lưu thay đổi</button>`,
    onMount(sheet, closeFn) {
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const name = sheet.querySelector('#creditor-name').value.trim();
        const note = sheet.querySelector('#creditor-note').value.trim();
        const errEl = sheet.querySelector('#creditor-error');
        try {
          await S.updateCreditor(c.id, { name, note });
          toast('Đã lưu', 'success');
          closeFn();
          openCreditorDetail(c.id);
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
    },
  });
}

/** Ô "Đưa vào chi tiêu" dùng chung cho form ghi nợ/trả nợ/sửa dòng — mặc định KHÔNG tích, tích vào mới tự tạo giao dịch chi tiêu thật + hiện thêm ô chọn danh mục. idPrefix để tránh trùng id khi nhiều form trên cùng trang. */
function addToTxnFieldsHtml(idPrefix, checked = false) {
  const catOptions = `<option value="">Không chọn</option>` + S.listCategories({ type: 'expense' }).map((cat) => `<option value="${cat.id}">${cat.name}</option>`).join('');
  return `
    <label class="flex items-center gap-8 mb-16" style="cursor:pointer">
      <input type="checkbox" id="${idPrefix}-add-txn" ${checked ? 'checked' : ''}/>
      <span class="text-sm">Đưa vào chi tiêu tháng này</span>
    </label>
    <div class="field" id="${idPrefix}-cat-field" style="display:${checked ? '' : 'none'}">
      <label>Danh mục (không bắt buộc)</label><select id="${idPrefix}-cat">${catOptions}</select>
    </div>`;
}
function bindAddToTxnToggle(sheet, idPrefix) {
  const cb = sheet.querySelector(`#${idPrefix}-add-txn`);
  const field = sheet.querySelector(`#${idPrefix}-cat-field`);
  cb.addEventListener('change', () => { field.style.display = cb.checked ? '' : 'none'; });
}

function openPayModal(c, balance) {
  openModal({
    title: `Trả nợ — ${c.name}`,
    bodyHtml: `
      <p class="text-sm text-muted mb-16">Còn nợ: <b>${formatVND(balance)}</b></p>
      <div class="field"><label>Số tiền trả</label><input id="pay-amount" type="text" inputmode="numeric" value="${formatNumber(Math.max(0, balance))}"/></div>
      <div class="field"><label>Ngày trả</label><input id="pay-date" type="date" value="${new Date().toISOString().slice(0, 10)}"/></div>
      ${addToTxnFieldsHtml('pay')}
      <div class="field-error" id="pay-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-ok>Xác nhận trả nợ</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#pay-amount'));
      bindAddToTxnToggle(sheet, 'pay');
      sheet.querySelector('[data-ok]').addEventListener('click', async () => {
        const amount = unformatMoney(sheet.querySelector('#pay-amount').value);
        const date = sheet.querySelector('#pay-date').value;
        const addToTransactions = sheet.querySelector('#pay-add-txn').checked;
        const categoryId = sheet.querySelector('#pay-cat').value;
        const errEl = sheet.querySelector('#pay-error');
        try {
          await S.addDebtPayment(c.id, { amount, date, categoryId, addToTransactions });
          toast('Đã ghi nhận trả nợ', 'success');
          closeFn();
          openCreditorDetail(c.id);
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
    },
  });
}

/** Gợi ý tên chủ nợ đã dùng qua (kể cả đã "đã trả hết" — vẫn giữ tên để chọn lại lần sau), chỉ hiện
 * TÊN cho gọn, không hiện số tiền. CHỈ xổ ra khi bấm nút mũi tên bên cạnh (không tự bung lúc gõ, đỡ
 * dài dòng) — gõ tên mới hoàn toàn thì cứ gõ, không cần bấm gì. */
function bindCreditorNameSuggestions(sheet, inputId, listId, toggleId) {
  const input = sheet.querySelector(`#${inputId}`);
  const list = sheet.querySelector(`#${listId}`);
  const toggle = sheet.querySelector(`#${toggleId}`);
  const allNames = S.listCreditorNames();
  function render() {
    const q = input.value.trim().toLowerCase();
    const matches = q ? allNames.filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q) : allNames;
    list.innerHTML = matches.length
      ? matches.map((n) => `<div data-name="${n.replace(/"/g, '&quot;')}" style="padding:8px 12px;cursor:pointer;font-size:14px;border-bottom:1px solid var(--border)">${n}</div>`).join('')
      : `<div style="padding:8px 12px;font-size:14px;color:var(--text-muted)">Chưa có tên nào</div>`;
  }
  function close() { list.style.display = 'none'; }
  function open() { render(); list.style.display = ''; }
  toggle.addEventListener('mousedown', (e) => e.preventDefault());
  toggle.addEventListener('click', () => { if (list.style.display === 'none') open(); else close(); });
  input.addEventListener('input', () => { if (list.style.display !== 'none') render(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const item = e.target.closest('[data-name]');
    if (!item) return;
    input.value = item.dataset.name;
    close();
  });
}

function openChargeForm({ creditorId, creditorName } = {}) {
  const locked = !!creditorId;
  openModal({
    title: 'Ghi nợ mới',
    bodyHtml: `
      <div class="field" style="position:relative">
        <label>Chủ nợ</label>
        ${locked
          ? `<input id="charge-creditor-name" value="${creditorName.replace(/"/g, '&quot;')}" readonly/>`
          : `<div class="flex items-center gap-8">
              <input id="charge-creditor-name" placeholder="VD: Tạp hóa A" autocomplete="off" style="flex:1"/>
              <button type="button" class="icon-btn" id="charge-creditor-toggle" aria-label="Chọn tên đã dùng">${icon('chevronDown', 'icon-sm')}</button>
            </div>
            <div id="charge-creditor-list" style="display:none;position:absolute;left:0;right:0;z-index:5;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-top:4px;max-height:160px;overflow-y:auto"></div>`}
      </div>
      <div class="field"><label>Ngày mua nợ</label><input id="charge-date" type="date" value="${new Date().toISOString().slice(0, 10)}" required/></div>
      <div class="field"><label>Mua gì (không bắt buộc)</label><input id="charge-desc" placeholder="VD: gạo, mắm, dầu ăn"/></div>
      <div class="field"><label>Số tiền nợ</label><input id="charge-amount" type="text" inputmode="numeric" required/></div>
      ${addToTxnFieldsHtml('charge')}
      <div class="field-error" id="charge-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-save>Ghi nợ</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#charge-amount'));
      bindAddToTxnToggle(sheet, 'charge');
      if (!locked) bindCreditorNameSuggestions(sheet, 'charge-creditor-name', 'charge-creditor-list', 'charge-creditor-toggle');
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const creditorNameVal = locked ? creditorName : sheet.querySelector('#charge-creditor-name').value.trim();
        const date = sheet.querySelector('#charge-date').value;
        const description = sheet.querySelector('#charge-desc').value.trim();
        const amount = unformatMoney(sheet.querySelector('#charge-amount').value);
        const addToTransactions = sheet.querySelector('#charge-add-txn').checked;
        const categoryId = sheet.querySelector('#charge-cat').value;
        const errEl = sheet.querySelector('#charge-error');
        if (!creditorNameVal) { errEl.textContent = 'Cần nhập tên chủ nợ.'; errEl.style.display = 'block'; return; }
        try {
          await S.addDebtCharge({ creditorId: locked ? creditorId : undefined, creditorName: locked ? undefined : creditorNameVal, amount, date, description, categoryId, addToTransactions });
          toast('Đã ghi nợ', 'success');
          closeFn();
          if (locked) openCreditorDetail(creditorId);
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
    },
  });
}
