import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { emptyState } from '../components/ui.js';
import { toast } from '../components/toast.js';
import { formatVND, formatDate, formatNumber, attachMoneyInput, unformatMoney } from '../utils.js';

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Tiết kiệm' });
}

export function render(contentEl) {
  const goals = S.listSavingsGoals();
  contentEl.innerHTML = `
    <div class="mb-16"><button class="btn btn-primary btn-block" id="btn-add">${icon('plus', 'icon-sm')} Thêm mục tiêu tiết kiệm</button></div>
    ${goals.length ? goals.map((g) => goalCardHtml(g)).join('') : `<div class="card card-pad">${emptyState({ iconName: 'target', title: 'Chưa có mục tiêu nào', message: 'Đặt mục tiêu tiết kiệm (mua xe, du lịch, quỹ dự phòng...) để theo dõi tiến độ.' })}</div>`}
  `;
  contentEl.querySelector('#btn-add').addEventListener('click', () => openGoalForm());
  contentEl.querySelectorAll('[data-goal-edit]').forEach((btn) => btn.addEventListener('click', () => openGoalForm(goals.find((g) => g.id === btn.dataset.goalEdit))));
  contentEl.querySelectorAll('[data-contribute]').forEach((btn) => btn.addEventListener('click', () => openContributeModal(goals.find((g) => g.id === btn.dataset.contribute))));
}

function goalCardHtml(g) {
  const pct = g.targetAmount ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100)) : 0;
  const done = g.currentAmount >= g.targetAmount;
  return `
    <div class="card card-pad mb-16">
      <div class="flex items-center justify-between mb-8">
        <div class="flex items-center gap-8">
          <div class="cat-icon" style="background:var(--color-primary)">${icon('target', 'icon-sm')}</div>
          <b>${g.name}</b>
        </div>
        <button class="icon-btn" data-goal-edit="${g.id}">${icon('edit', 'icon-sm')}</button>
      </div>
      <div class="flex items-center justify-between mb-4">
        <span class="text-sm text-muted">${formatVND(g.currentAmount)} / ${formatVND(g.targetAmount)}</span>
        <span class="text-sm fw-700" style="color:${done ? 'var(--success)' : 'var(--color-primary)'}">${pct}%</span>
      </div>
      <div class="progress-bar mb-12"><div class="progress-fill" style="width:${pct}%;background:${done ? 'var(--success)' : 'var(--color-primary)'}"></div></div>
      ${g.deadline ? `<div class="text-sm text-muted mb-8">Hạn: ${formatDate(g.deadline)}</div>` : ''}
      <button class="btn btn-outline btn-block btn-sm" data-contribute="${g.id}">${icon('plus', 'icon-sm')} Góp thêm / Rút bớt</button>
    </div>`;
}

function openContributeModal(g) {
  openModal({
    title: `Góp/rút — ${g.name}`,
    bodyHtml: `
      <p class="text-sm text-muted mb-16">Nhập số dương để góp thêm, số âm để rút bớt.</p>
      <div class="field"><label>Số tiền</label><input id="contrib-amount" type="text" inputmode="numeric" placeholder="VD: 500.000 hoặc -200.000"/></div>
    `,
    footHtml: `<button class="btn btn-primary btn-block" data-ok>Xác nhận</button>`,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#contrib-amount'), { allowNegative: true });
      sheet.querySelector('[data-ok]').addEventListener('click', async () => {
        const val = sheet.querySelector('#contrib-amount').value;
        closeFn();
        if (!val) return;
        try { await S.contributeSavingsGoal(g.id, unformatMoney(val)); toast('Đã cập nhật', 'success'); }
        catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
      });
    },
  });
}

function openGoalForm(g) {
  openModal({
    title: g ? 'Sửa mục tiêu' : 'Thêm mục tiêu tiết kiệm',
    bodyHtml: `
      <div class="field"><label>Tên mục tiêu</label><input id="goal-name" value="${g ? g.name.replace(/"/g, '&quot;') : ''}" required/></div>
      <div class="field"><label>Số tiền mục tiêu</label><input id="goal-target" type="text" inputmode="numeric" value="${g ? formatNumber(g.targetAmount) : ''}" required/></div>
      <div class="field"><label>Hạn hoàn thành</label><input id="goal-deadline" type="date" value="${g?.deadline || ''}"/></div>
      <div class="field"><label>Ghi chú</label><input id="goal-note" value="${g ? (g.note || '').replace(/"/g, '&quot;') : ''}"/></div>
      <div class="field-error" id="goal-error" style="display:none;margin-bottom:10px"></div>
    `,
    footHtml: `
      <button class="btn btn-primary btn-block" data-save>Lưu</button>
      ${g ? `<button class="btn btn-danger-outline btn-block" data-del style="margin-top:8px">${icon('trash', 'icon-sm')} Xóa mục tiêu</button>` : ''}
    `,
    onMount(sheet, closeFn) {
      attachMoneyInput(sheet.querySelector('#goal-target'));
      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const name = sheet.querySelector('#goal-name').value.trim();
        const targetAmount = unformatMoney(sheet.querySelector('#goal-target').value);
        const deadline = sheet.querySelector('#goal-deadline').value;
        const note = sheet.querySelector('#goal-note').value;
        const errEl = sheet.querySelector('#goal-error');
        if (!name || !targetAmount) { errEl.textContent = 'Cần nhập đủ tên và số tiền mục tiêu.'; errEl.style.display = 'block'; return; }
        try {
          if (g) await S.updateSavingsGoal(g.id, { name, targetAmount, deadline, note });
          else await S.addSavingsGoal({ name, targetAmount, deadline, note });
          toast('Đã lưu', 'success');
          closeFn();
        } catch (err) { errEl.textContent = err.message || 'Có lỗi xảy ra'; errEl.style.display = 'block'; }
      });
      const delBtn = sheet.querySelector('[data-del]');
      if (delBtn) delBtn.addEventListener('click', () => {
        closeFn();
        confirmDialog({
          title: 'Xóa mục tiêu?', message: 'Không thể hoàn tác.', confirmLabel: 'Xóa', danger: true,
          onConfirm: async () => {
            try { await S.deleteSavingsGoal(g.id); toast('Đã xóa', 'success'); }
            catch (err) { toast(err.message || 'Có lỗi xảy ra', 'error'); }
          },
        });
      });
    },
  });
}
