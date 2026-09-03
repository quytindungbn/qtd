import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { emptyState } from '../components/ui.js';
import { openTransactionForm } from '../components/txnForm.js';
import { formatVND, formatDate, initials, colorFor } from '../utils.js';

const MONTH_NAMES = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Tổng quan' });
}

export function render(contentEl) {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  const session = S.getSession();
  const user = S.getUser(session.id);
  const { income, expense, balance } = S.totalsForMonth(year, month);
  const forecast = S.forecastExpense(year, month, now);
  const budgetRows = S.budgetOverviewForMonth(year, month).filter((r) => r.limit != null);
  const overBudget = budgetRows.filter((r) => r.over);
  const reminders = S.pendingRecurringReminders(now);
  const plans = S.upcomingPlans(now);
  const debtsSummary = S.debtsSummary();
  const recent = S.listTransactions({}).slice(0, 6);

  contentEl.innerHTML = `
    <div class="card card-pad mb-16">
      <div class="text-sm text-muted">Xin chào,</div>
      <div class="fw-700" style="font-size:17px;margin-bottom:14px">${user ? user.name : ''} · ${MONTH_NAMES[month - 1]}</div>
      <div class="grid-4 dash-stats">
        <div class="stat-tile c-blue">
          <div class="stat-icon">${icon('trendingUp', 'icon-sm')}</div>
          <div class="stat-label">Tổng thu</div>
          <div class="stat-value" style="font-size:15px">${formatVND(income)}</div>
        </div>
        <div class="stat-tile c-pink">
          <div class="stat-icon">${icon('trendingDown', 'icon-sm')}</div>
          <div class="stat-label">Tổng chi</div>
          <div class="stat-value" style="font-size:15px">${formatVND(expense)}</div>
        </div>
        <div class="stat-tile ${balance >= 0 ? 'c-green' : 'c-orange'}">
          <div class="stat-icon">${icon('wallet', 'icon-sm')}</div>
          <div class="stat-label">Số dư tháng này</div>
          <div class="stat-value" style="font-size:15px">${formatVND(balance)}</div>
        </div>
        <div class="stat-tile c-purple">
          <div class="stat-icon">${icon('chart', 'icon-sm')}</div>
          <div class="stat-label">Dự báo chi cuối tháng</div>
          <div class="stat-value" style="font-size:${forecast == null ? '12.5px' : '15px'}">${forecast == null ? 'Chưa đủ dữ liệu (từ ngày 3)' : formatVND(forecast)}</div>
        </div>
      </div>
    </div>

    ${reminders.length ? `
    <div class="card card-pad mb-16" style="background:var(--warning-bg);border-color:transparent">
      <div class="flex items-center gap-8 mb-8" style="color:var(--warning)">${icon('bell', 'icon-sm')}<b class="text-sm">Có ${reminders.length} khoản định kỳ đến hạn chưa ghi sổ</b></div>
      ${reminders.map((r) => {
        const cat = S.getCategory(r.categoryId);
        return `<div class="oc-line"><span>${cat ? cat.name : r.note || 'Định kỳ'} (ngày ${r.dayOfMonth})</span><b>${formatVND(r.amount)}</b></div>`;
      }).join('')}
      <a href="#/dinh-ky" class="link-more" style="display:inline-block;margin-top:8px">Xem & xác nhận →</a>
    </div>` : ''}

    ${plans.length ? `
    <div class="card card-pad mb-16" style="background:var(--info-bg);border-color:transparent">
      <div class="flex items-center gap-8 mb-8" style="color:var(--color-primary-dark)">${icon('calendar', 'icon-sm')}<b class="text-sm">${plans.length} kế hoạch chi tiêu sắp tới/quá hạn</b></div>
      ${plans.map((p) => `<div class="oc-line"><span>${p.title} (${formatDate(p.dueDate)})</span><b>${p.type === 'expense' ? '-' : '+'}${formatVND(p.amount)}</b></div>`).join('')}
      <a href="#/ke-hoach" class="link-more" style="display:inline-block;margin-top:8px">Xem & đánh dấu hoàn thành →</a>
    </div>` : ''}

    ${debtsSummary.totalRemaining > 0 ? `
    <div class="card card-pad mb-16" style="background:var(--danger-bg);border-color:transparent">
      <div class="flex items-center justify-between" style="color:var(--danger)">
        <div class="flex items-center gap-8">${icon('creditCard', 'icon-sm')}<b class="text-sm">Còn nợ</b></div>
        <b class="text-sm">${formatVND(debtsSummary.totalRemaining)}</b>
      </div>
      <a href="#/no" class="link-more" style="display:inline-block;margin-top:8px">Xem & trả nợ →</a>
    </div>` : ''}

    ${overBudget.length ? `
    <div class="card card-pad mb-16" style="background:var(--danger-bg);border-color:transparent">
      <div class="flex items-center gap-8 mb-4" style="color:var(--danger)">${icon('alert', 'icon-sm')}<b class="text-sm">${overBudget.length} danh mục đã vượt ngân sách tháng này</b></div>
      ${overBudget.map((r) => `<div class="oc-line"><span>${r.category.name}</span><b style="color:var(--danger)">${formatVND(r.spent)} / ${formatVND(r.limit)}</b></div>`).join('')}
      <a href="#/danh-muc" class="link-more" style="display:inline-block;margin-top:8px">Xem danh mục →</a>
    </div>` : ''}

    ${budgetRows.length ? `
    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Ngân sách theo danh mục</h2><a href="#/danh-muc" class="link-more">Xem tất cả</a></div>
      ${budgetRows.slice(0, 5).map((r) => budgetRowHtml(r)).join('')}
    </div>` : ''}

    <div class="card card-pad">
      <div class="section-head"><h2>Giao dịch gần đây</h2><a href="#/giao-dich" class="link-more">Xem tất cả</a></div>
      ${recent.length ? recent.map((t) => transactionRowHtml(t)).join('') : `<p class="text-sm text-muted">Chưa có giao dịch nào.</p>`}
    </div>
  `;

  if (!S.listCategories().length) {
    contentEl.insertAdjacentHTML('afterbegin', `<div class="card card-pad mb-16">${emptyState({ iconName: 'wallet', title: 'Chưa có danh mục nào', message: 'Vào trang Danh mục để tạo danh mục thu/chi trước khi bắt đầu ghi sổ.' })}</div>`);
  }

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = icon('plus');
  fab.addEventListener('click', () => openTransactionForm({ onSaved: () => {} }));
  document.body.appendChild(fab);
}

function budgetRowHtml(r) {
  const pct = Math.min(100, r.percent || 0);
  return `
    <div class="mb-12">
      <div class="flex items-center justify-between mb-4">
        <span class="text-sm">${r.category.name}</span>
        <span class="text-sm ${r.over ? 'text-danger' : 'text-muted'}">${formatVND(r.spent)} / ${formatVND(r.limit)}</span>
      </div>
      <div class="progress-bar ${r.over ? 'over' : ''}"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
}

function transactionRowHtml(t) {
  const cat = S.getCategory(t.categoryId);
  const isExpense = t.type === 'expense';
  return `
    <div class="list-row">
      <div class="row-thumb" style="background:${cat ? cat.color : colorFor(t.categoryId || 'x')}">${icon(cat ? cat.icon : 'tag', 'icon-sm')}</div>
      <div class="row-main">
        <div class="row-title">${cat ? cat.name : 'Không rõ danh mục'}</div>
        <div class="row-sub">${t.note ? t.note + ' · ' : ''}${formatDate(t.date)}</div>
      </div>
      <div class="row-end"><span class="amount" style="color:${isExpense ? 'var(--danger)' : 'var(--success)'}">${isExpense ? '-' : '+'}${formatVND(t.amount)}</span></div>
    </div>`;
}
