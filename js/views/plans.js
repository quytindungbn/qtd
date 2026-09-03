import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { emptyState } from '../components/ui.js';
import { toast } from '../components/toast.js';
import { formatVND, formatDate, formatNumber, attachMoneyInput, unformatMoney } from '../utils.js';

let tab = 'pending';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Kế hoạch chi tiêu' });
}

export function render(contentEl) {
  contentEl.innerHTML = `
    <p class="text-sm text-muted mb-16">Ghi lại khoản thu/chi DỰ ĐỊNH (vd: "cuối tháng mua sắm 2 triệu") để nhắc trước — chưa tính vào thu/chi thật. Tick <b>Hoàn thành</b> khi đã thật sự xảy ra để tự động đưa vào giao dịch.</p>
    <div class="mb-16"><button class="btn btn-primary btn-block" id="btn-add">${icon('plus', 'icon-sm')} Thêm kế hoạch</button></div>
    <div class="tabs mb-16">
      <button data-tab="pending" class="${tab === 'pending' ? 'active' : ''}">Chưa hoàn thành</button>
      <button data-tab="done" class="${tab === 'done' ? 'active' : ''}">Đã hoàn thành</button>
    </div>
    <div id="plan-list"></div>
  `;
  contentEl.querySelector('#btn-add').addEventListener('click', () => openPlanForm());
  contentEl.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => { tab = btn.dataset.tab; render(contentEl); });
  });
  renderList(contentEl.querySelector('#plan-list'));
}

function renderList(listEl) {
  const plans = S.listPlans({ status: tab });
  listEl.innerHTML = plans.length
    ? `<div class="card">${plans.map((p) => planRowHtml(p)).join('')}</div>`
    : emptyState({
        iconName: 'calendar',
        title: tab === 'pending' ? 'Chưa có kế hoạch nào' : 'Chưa có kế hoạch nào hoàn thành',
        message: tab === 'pending' ? 'Thêm khoản thu/chi dự định để app nhắc trước.' : 'Kế hoạch đã tick Hoàn thành sẽ hiện ở đây.',
      });
  listEl.querySelectorAll('[data-plan]').forEach((row) => {
    row.addEventListener('click', () => openPlanDetail(S.getPlan(row.dataset.plan)));
  });
}

function planRowHtml(p) {
  const cat = S.getCategory(p.categoryId);
  const isExpense = p.type === 'expense';
  const overdue = tab === 'pending' && p.dueDate && p.dueDate < new Date().toISOString().slice(0, 10);
  return `
    <div class="list-row" data-plan="${p.id}" style="cursor:pointer">
      <div class="cat-icon" style="background:${cat ? cat.color : '#94a3b8'}">${icon(cat ? cat.icon : 'calendar', 'icon-sm')}</div>
      <div class="row-main">
        <div class="row-title">${p.title}</div>
        <div class="row-sub" style="${overdue ? 'color:var(--danger)' : ''}">${p.dueDate ? `${overdue ? 'Quá hạn ' : 'Dự định '}${formatDate(p.dueDate)}` : 'Chưa đặt ngày'}${cat ? ' · ' + cat.name : ''}</div>
      </div>
      <div class="row-end"><span class="amount" style="color:${isExpense ? 'var(--danger)' : 'var(--success)'}">${isExpense ? '-' : '+'}${formatVND(p.amount)}</span></div>
    </div>`;
}

function openPlanDetail(p) {
  if (!p) return;
  const cat = S.getCategory(p.categoryId);
  openModal({
    title: p.title,
    bodyHtml: `
      <div class="oc-line"><span>Loại</span><b>${p.type === 'expense' ? 'Khoản chi' : 'Khoản thu'}</b></div>
      <div class="oc-line"><span>Số tiền dự định</span><b>${formatVND(p.amount)}</b></div>
      ${cat ? `<div class="oc-line"><span>Danh mục</span><b>${cat.name}</b></div>` : ''}
      <div class="oc-line"><span>Ngày dự định</span><b>${p.dueDate ? formatDate(p.dueDate) : 'Chưa đặt'}</b></div>
      <div class="oc-line"><span>Trạng thái</span><b>${p.status === 'done' ? 'Đã hoàn thành (đã đưa vào giao dịch)' : 'Chưa hoàn thành'}</b></div>
    `,
    footHtml: p.status === 'pending' ? `
      <button class="btn btn-primary btn-block" data-complete>${icon('check', 'icon-sm')} Đánh dấu Hoàn thành</button>
      <button class="btn btn-outline btn-block" data-edit style="margin-top:8px">${icon('edit', 'icon-sm')} Sửa</button>
      <button class="btn btn-danger-outline btn-block" data-del style="margin-top:8px">${icon('trash', 'icon-sm')} Xóa</button>
    ` : `
      <button class="btn btn-danger-outline btn-block" data-del>${icon('trash', 'icon-sm')} Xóa kế hoạch (không xóa giao dịch đã tạo)</button>
    `,
    onMount(sheet, closeFn) {
      const completeBtn = sheet.querySelector('[data-complete]');
      if (completeBtn) completeBtn.addEventListener('click', () => { closeFn(); openCompleteModal(p); });
      const editBtn = sheet.querySelector('[data-edit]');
      if (editBtn) editBtn.addEventListener('click', () => { closeFn(); openPlanForm(p); });
      sheet.querySelector('[data-del]').addEventListener('click', () => {
        closeFn();
        confirmDialog({
          title: 'Xóa kế hoạch?', message: 'Không thể hoàn tác.', confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try { await S.deletePlan(p.id); toast('Đã xóa kế hoạch', 'success'); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
}

function openCompleteModal(p) {
  openModal({
    title: `Hoàn thành — ${p.title}`,
    bodyHtml: `
      <p class="text-sm text-muted mb-16">Xác nhận số tiền/ngày thực tế — sẽ tự tạo 1 giao dịch ${p.type === 'expense' ? 'chi' : 'thu'} tương ứng.</p>
      <div class="field"><label>Số tiền thực tế</label><input id="complete-amount" type="text" inputmode="numeric" value="${formatNumber(p.amount)}"/></div>
      <div class="field"><label>Ngày</label><input id="complete-date" type="date" value="${new Date().toISOString().slice(0, 10)}"/></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-ok>Xác nhận & ghi sổ</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#complete-amount'));
      sheet.querySelector('[data-ok]').addEventListener('click', async () => {
        const amount = unformatMoney(sheet.querySelector('#complete-amount').value);
        const date = sheet.querySelector('#complete-date').value;
        closeFn();
        try { await S.completePlan(p.id, { amount, date }); toast('Đã ghi sổ giao dịch', 'success'); }
        catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
      });
    },
  });
}

function openPlanForm(plan) {
  let type = plan ? plan.type : 'expense';
  function categoryOptionsHtml() {
    return `<option value="">Không chọn</option>` + S.listCategories({ type }).map((c) => `<option value="${c.id}" ${plan?.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
  }
  openModal({
    title: plan ? 'Sửa kế hoạch' : 'Thêm kế hoạch chi tiêu',
    bodyHtml: `
      <div class="tabs mb-16">
        <button type="button" data-type="expense" class="${type === 'expense' ? 'active' : ''}">Khoản chi</button>
        <button type="button" data-type="income" class="${type === 'income' ? 'active' : ''}">Khoản thu</button>
      </div>
      <div class="field"><label>Nội dung</label><input id="plan-title" value="${plan ? plan.title.replace(/"/g, '&quot;') : ''}" placeholder="VD: Mua sắm cuối tháng" required/></div>
      <div class="field"><label>Số tiền dự định</label><input id="plan-amount" type="text" inputmode="numeric" value="${plan ? formatNumber(plan.amount) : ''}" required/></div>
      <div class="field"><label>Danh mục</label><select id="plan-cat">${categoryOptionsHtml()}</select></div>
      <div class="field"><label>Ngày dự định (không bắt buộc)</label><input id="plan-date" type="date" value="${plan?.dueDate || ''}"/></div>
      <div class="field-error" id="plan-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-save>${plan ? 'Lưu thay đổi' : 'Thêm kế hoạch'}</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#plan-amount'));
      sheet.querySelectorAll('[data-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
          type = btn.dataset.type;
          sheet.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b === btn));
          sheet.querySelector('#plan-cat').innerHTML = categoryOptionsHtml();
        });
      });
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const title = sheet.querySelector('#plan-title').value.trim();
        const amount = unformatMoney(sheet.querySelector('#plan-amount').value);
        const categoryId = sheet.querySelector('#plan-cat').value;
        const dueDate = sheet.querySelector('#plan-date').value;
        const errEl = sheet.querySelector('#plan-error');
        if (!title || !amount) { errEl.textContent = 'Cần nhập đủ nội dung và số tiền.'; errEl.style.display = 'block'; return; }
        try {
          if (plan) await S.updatePlan(plan.id, { type, amount, categoryId, title, dueDate });
          else await S.addPlan({ type, amount, categoryId, title, dueDate });
          toast('Đã lưu kế hoạch', 'success');
          closeFn();
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
    },
  });
}
