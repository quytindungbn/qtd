// Form thêm/sửa giao dịch (thu/chi) — dùng chung cho Dashboard (FAB), trang
// Giao dịch, và khi xác nhận 1 khoản định kỳ. Gom vào 1 chỗ để 3 nơi gọi
// khác nhau không phải chép lại y hệt nhau.
import * as S from '../state.js';
import { icon } from '../icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { formatNumber, attachMoneyInput, unformatMoney } from '../utils.js';

/**
 * opts: { transaction? (sửa nếu có), defaultType?, onSaved? }
 */
export function openTransactionForm({ transaction, defaultType = 'expense', onSaved } = {}) {
  let type = transaction ? transaction.type : defaultType;

  function categoryOptionsHtml() {
    return S.listCategories({ type }).map((c) => `<option value="${c.id}" ${transaction?.categoryId === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
  }

  const close = openModal({
    title: transaction ? 'Sửa giao dịch' : 'Thêm giao dịch',
    bodyHtml: `
      <div class="tabs mb-16">
        <button type="button" data-type="expense" class="${type === 'expense' ? 'active' : ''}">Khoản chi</button>
        <button type="button" data-type="income" class="${type === 'income' ? 'active' : ''}">Khoản thu</button>
      </div>
      <form id="txn-form">
        <div class="field">
          <label>Số tiền</label>
          <input name="amount" id="txn-amount" type="text" inputmode="numeric" required value="${transaction ? formatNumber(transaction.amount) : ''}" placeholder="0"/>
        </div>
        <div class="field">
          <label>Danh mục</label>
          <select name="categoryId" id="txn-cat-select" required>${categoryOptionsHtml()}</select>
        </div>
        <div class="field">
          <label>Ngày</label>
          <input name="date" type="date" required value="${transaction ? transaction.date : new Date().toISOString().slice(0, 10)}"/>
        </div>
        <div class="field">
          <label>Ghi chú</label>
          <input name="note" value="${transaction ? (transaction.note || '').replace(/"/g, '&quot;') : ''}" placeholder="Không bắt buộc"/>
        </div>
        <div class="field-error" id="txn-error" style="display:none;margin-bottom:10px"></div>
        <button class="btn btn-primary btn-block" type="submit">${icon('check', 'icon-sm')} ${transaction ? 'Lưu thay đổi' : 'Thêm giao dịch'}</button>
      </form>
    `,
    onMount(sheet) {
      const form = sheet.querySelector('#txn-form');
      const catSelect = sheet.querySelector('#txn-cat-select');
      attachMoneyInput(sheet.querySelector('#txn-amount'));
      sheet.querySelectorAll('[data-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
          type = btn.dataset.type;
          sheet.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b === btn));
          catSelect.innerHTML = categoryOptionsHtml();
        });
      });

      if (!S.listCategories({ type }).length) {
        sheet.querySelector('#txn-error').style.display = 'block';
        sheet.querySelector('#txn-error').textContent = 'Chưa có danh mục nào — tạo danh mục trước ở trang Danh mục.';
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const payload = { type, amount: unformatMoney(fd.get('amount')), categoryId: fd.get('categoryId'), date: fd.get('date'), note: fd.get('note') };
        const errEl = sheet.querySelector('#txn-error');
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          if (transaction) await S.updateTransaction(transaction.id, payload);
          else await S.addTransaction(payload);
          toast(transaction ? 'Đã lưu thay đổi' : 'Đã thêm giao dịch', 'success');
          close();
          onSaved && onSaved();
        } catch (err) {
          errEl.textContent = err.message || 'Có lỗi xảy ra, thử lại sau.';
          errEl.style.display = 'block';
        } finally {
          btn.disabled = false;
        }
      });
    },
  });
  return close;
}
