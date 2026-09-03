import { icon } from '../icons.js';
import { openModal } from './modal.js';

// Thứ tự ở đây quyết định luôn 4 mục đầu hiện TRỰC TIẾP trên thanh menu dưới
// di động (BOTTOM_NAV_MAX_DIRECT bên dưới) — mục nào muốn dễ thấy, xếp
// trong 4 mục đầu; còn lại tự động gộp vào "Thêm".
export const NAV = [
  { path: '#/', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: 'chart' },
  { path: '#/giao-dich', label: 'Giao dịch', shortLabel: 'Giao dịch', icon: 'wallet' },
  { path: '#/bao-cao', label: 'Báo cáo', shortLabel: 'Báo cáo', icon: 'trendingUp' },
  { path: '#/ke-hoach', label: 'Kế hoạch', shortLabel: 'Kế hoạch', icon: 'calendar' },
  { path: '#/danh-muc', label: 'Danh mục', shortLabel: 'Danh mục', icon: 'tag' },
  { path: '#/dinh-ky', label: 'Định kỳ', shortLabel: 'Định kỳ', icon: 'refresh' },
  { path: '#/tiet-kiem', label: 'Tiết kiệm', shortLabel: 'Tiết kiệm', icon: 'target' },
];
export const NAV_OWNER_ONLY = [
  { path: '#/nguoi-dung', label: 'Quản lý User', shortLabel: 'User', icon: 'idCard' },
  { path: '#/cai-dat', label: 'Cài đặt', shortLabel: 'Cài đặt', icon: 'settings' },
];
// Số mục tối đa hiện trực tiếp trên thanh menu dưới (mobile) — còn lại gộp vào "Thêm"
// để không bị lệch/chồng chữ khi có nhiều mục.
const BOTTOM_NAV_MAX_DIRECT = 4;

function matchPath(navPath, current) {
  if (navPath === '#/') return current === '#/' || current === '' || current === '#';
  return current === navPath || current.startsWith(navPath + '/');
}

export function buildShell(root, isOwner) {
  const nav = [...NAV, ...(isOwner ? NAV_OWNER_ONLY : [])];
  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="logo-mark">${icon('wallet', 'icon-sm')}</div>
          <div>
            <strong id="brand-name">Sổ chi tiêu</strong>
            <span>${isOwner ? 'Chủ sổ' : 'Thành viên'}</span>
          </div>
        </div>
        <nav class="sidebar-nav" id="sidebar-nav"></nav>
        <a href="#/doi-mat-khau" class="btn btn-outline btn-block" style="margin-top:16px">${icon('lock', 'icon-sm')} Đổi mật khẩu</a>
        <button class="btn btn-outline btn-block" id="btn-logout-side" style="margin-top:8px">${icon('logout', 'icon-sm')} Đăng xuất</button>
      </aside>
      <div class="main-col">
        <header class="app-header" id="app-header"></header>
        <div id="filter-slot"></div>
        <main class="app-content" id="app-content"></main>
      </div>
      <nav class="bottom-nav" id="bottom-nav"></nav>
    </div>
  `;
  renderSidebarNav(nav);
  renderBottomNav(nav);
  document.getElementById('btn-logout-side').addEventListener('click', onLogoutClick);
}

function renderSidebarNav(nav) {
  const el = document.getElementById('sidebar-nav');
  el.innerHTML = nav.map((item) => `<a href="${item.path}" data-path="${item.path}">${icon(item.icon)}<span>${item.label}</span></a>`).join('');
}

const CHANGE_PW_ITEM = { path: '#/doi-mat-khau', label: 'Đổi mật khẩu', icon: 'lock' };

function renderBottomNav(nav) {
  const el = document.getElementById('bottom-nav');
  const direct = nav.slice(0, BOTTOM_NAV_MAX_DIRECT);
  const overflow = [...nav.slice(BOTTOM_NAV_MAX_DIRECT), CHANGE_PW_ITEM];
  // Luôn còn ít nhất "Đổi mật khẩu" trong "Thêm" nên nút Thêm luôn hiện trên mobile.
  el.innerHTML = direct.map((item) => `<a href="${item.path}" data-path="${item.path}">${icon(item.icon)}<span>${item.shortLabel || item.label}</span></a>`).join('')
    + `<button class="more-btn" id="btn-more-bottom">${icon('more')}<span>Thêm</span></button>`;
  const moreBtn = document.getElementById('btn-more-bottom');
  if (moreBtn) moreBtn.addEventListener('click', () => openMoreSheet(overflow));
}

/** Bảng "Thêm" — gộp các mục menu còn lại + Đổi mật khẩu + Đăng xuất, tránh nhồi quá nhiều mục vào 1 hàng menu. */
function openMoreSheet(overflowItems) {
  openModal({
    title: 'Thêm',
    bodyHtml: `
      <div class="flex-col gap-6">
        ${overflowItems.map((item) => `
          <a href="${item.path}" data-path="${item.path}" class="list-row" style="cursor:pointer;text-decoration:none;color:inherit">
            <div class="row-thumb" style="background:var(--surface-alt);color:var(--text)">${icon(item.icon, 'icon-sm')}</div>
            <div class="row-main"><div class="row-title">${item.label}</div></div>
          </a>`).join('')}
      </div>
    `,
    footHtml: `<button class="btn btn-outline btn-block" id="sheet-logout">${icon('logout', 'icon-sm')} Đăng xuất</button>`,
    onMount(sheet, closeFn) {
      sheet.querySelectorAll('a[data-path]').forEach((a) => a.addEventListener('click', closeFn));
      sheet.querySelector('#sheet-logout').addEventListener('click', () => { closeFn(); onLogoutClick(); });
    },
  });
}

function onLogoutClick() {
  openModal({
    title: 'Đăng xuất?',
    bodyHtml: `<p style="font-size:14px;color:var(--text-muted)">Bạn sẽ cần đăng nhập lại để tiếp tục sử dụng.</p>`,
    footHtml: `
      <button class="btn btn-outline btn-block" data-cancel>Hủy</button>
      <button class="btn btn-primary btn-block" data-ok>Đăng xuất</button>
    `,
    onMount(root, close) {
      root.querySelector('[data-cancel]').addEventListener('click', close);
      root.querySelector('[data-ok]').addEventListener('click', () => {
        close();
        window.dispatchEvent(new CustomEvent('qtd:logout'));
      });
    },
  });
}

export function updateActiveNav(hash) {
  document.querySelectorAll('.sidebar-nav a, .bottom-nav a').forEach((a) => {
    a.classList.toggle('active', matchPath(a.dataset.path, hash));
  });
}

export function pageHeader({ title, back, actions = [] }) {
  return `
    <div class="flex items-center gap-8" style="width:100%">
      ${back ? `<button class="icon-btn back-btn" id="btn-back">${icon('arrowLeft')}</button>` : `<div class="avatar">${icon('wallet', 'icon-sm')}</div>`}
      <h1>${title}</h1>
      <div class="header-actions">
        ${actions.map((a) => `<button class="icon-btn" data-action="${a.action}">${icon(a.icon)}</button>`).join('')}
      </div>
    </div>
  `;
}
export function bindHeaderActions(headerEl, handlers) {
  const backBtn = headerEl.querySelector('#btn-back');
  if (backBtn && handlers.back) backBtn.addEventListener('click', handlers.back);
  headerEl.querySelectorAll('[data-action]').forEach((btn) => {
    const act = btn.dataset.action;
    if (handlers[act]) btn.addEventListener('click', handlers[act]);
  });
}
