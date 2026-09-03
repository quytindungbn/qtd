import * as S from '../state.js';
import { icon } from '../icons.js';
import { pageHeader } from '../components/shell.js';
import { emptyState } from '../components/ui.js';
import { formatVND, formatCompact } from '../utils.js';

const MONTH_NAMES = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
let cursor = new Date();

export function renderHeader(headerEl) {
  headerEl.innerHTML = pageHeader({ title: 'Báo cáo' });
}

export function render(contentEl) {
  const year = cursor.getFullYear(), month = cursor.getMonth() + 1;
  const spentMap = S.expenseByCategoryForMonth(year, month);
  const catRows = [...spentMap.entries()]
    .map(([categoryId, total]) => ({ category: S.getCategory(categoryId), total }))
    .filter((r) => r.category)
    .sort((a, b) => b.total - a.total);
  const totalExpense = catRows.reduce((s, r) => s + r.total, 0);
  const trend = S.last6MonthsTotals(cursor);
  const maxTrend = Math.max(1, ...trend.map((m) => Math.max(m.income, m.expense)));

  // Tổng kết cả năm (đúng năm đang xem theo tháng ở trên) — cộng dồn số dư
  // từng tháng thành lũy kế, để nhìn được cả năm tại 1 bảng thay vì bấm
  // từng tháng riêng lẻ.
  let cumulative = 0;
  const yearRows = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const t = S.totalsForMonth(year, m);
    cumulative += t.balance;
    return { month: m, ...t, cumulative };
  });

  contentEl.innerHTML = `
    <div class="flex items-center justify-between mb-16">
      <button class="icon-btn" id="btn-prev-month">${icon('chevronLeft')}</button>
      <b>${MONTH_NAMES[month - 1]} ${year}</b>
      <button class="icon-btn" id="btn-next-month">${icon('chevronRight')}</button>
    </div>

    <div class="card card-pad mb-16">
      <div class="section-head"><h2>Chi tiêu theo danh mục</h2></div>
      ${catRows.length ? `
        <div class="flex items-center justify-center mb-16">
          <div id="donut" style="width:160px;height:160px;border-radius:50%;background:${donutGradient(catRows, totalExpense)};display:flex;align-items:center;justify-content:center">
            <div style="width:96px;height:96px;border-radius:50%;background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center">
              <div class="text-sm text-muted">Tổng chi</div>
              <div class="fw-700">${formatCompact(totalExpense)}</div>
            </div>
          </div>
        </div>
        ${catRows.map((r) => {
          const pct = totalExpense ? Math.round((r.total / totalExpense) * 100) : 0;
          return `
          <div class="flex items-center gap-8 mb-8">
            <span class="dot" style="width:10px;height:10px;border-radius:50%;background:${r.category.color};flex-shrink:0"></span>
            <span class="text-sm" style="flex:1">${r.category.name}</span>
            <span class="text-sm text-muted">${pct}%</span>
            <b class="text-sm" style="min-width:90px;text-align:right">${formatVND(r.total)}</b>
          </div>`;
        }).join('')}
      ` : emptyState({ iconName: 'chart', title: 'Chưa có khoản chi nào', message: 'Tháng này chưa ghi khoản chi nào.' })}
    </div>

    <div class="card card-pad">
      <div class="section-head"><h2>Xu hướng thu chi 6 tháng</h2></div>
      <div class="flex items-end gap-8" style="height:140px">
        ${trend.map((m) => `
          <div class="flex-col items-center gap-4" style="flex:1;height:100%;justify-content:flex-end">
            <div class="flex items-end gap-3" style="height:110px">
              <div style="width:10px;border-radius:3px 3px 0 0;background:var(--success);height:${Math.round((m.income / maxTrend) * 110)}px" title="Thu: ${formatVND(m.income)}"></div>
              <div style="width:10px;border-radius:3px 3px 0 0;background:var(--danger);height:${Math.round((m.expense / maxTrend) * 110)}px" title="Chi: ${formatVND(m.expense)}"></div>
            </div>
            <div class="text-sm text-muted" style="font-size:10.5px">T${m.month}</div>
          </div>
        `).join('')}
      </div>
      <div class="chart-legend-row">
        <span><span class="dot" style="background:var(--success)"></span>Thu</span>
        <span><span class="dot" style="background:var(--danger)"></span>Chi</span>
      </div>
    </div>

    <div class="card card-pad mt-16">
      <div class="section-head"><h2>Tổng kết theo tháng — năm ${year}</h2></div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>Tháng</th><th>Thu</th><th>Chi</th><th>Số dư</th><th>Lũy kế cả năm</th></tr></thead>
          <tbody>
            ${yearRows.map((r) => `
              <tr class="${r.month === month ? 'current-month' : ''}">
                <td>Tháng ${r.month}</td>
                <td style="color:var(--success)">${r.income ? formatVND(r.income) : '—'}</td>
                <td style="color:var(--danger)">${r.expense ? formatVND(r.expense) : '—'}</td>
                <td>${formatVND(r.balance)}</td>
                <td>${formatVND(r.cumulative)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  contentEl.querySelector('#btn-prev-month').addEventListener('click', () => { cursor = new Date(year, month - 2, 1); render(contentEl); });
  contentEl.querySelector('#btn-next-month').addEventListener('click', () => { cursor = new Date(year, month, 1); render(contentEl); });
}

/** Chuỗi conic-gradient CSS vẽ biểu đồ tròn (donut) thuần CSS, không cần thư viện chart nào. */
function donutGradient(rows, total) {
  if (!total) return 'var(--surface-alt)';
  let acc = 0;
  const stops = rows.map((r) => {
    const from = (acc / total) * 360;
    acc += r.total;
    const to = (acc / total) * 360;
    return `${r.category.color} ${from}deg ${to}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}
