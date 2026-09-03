# Sổ Chi Tiêu — hướng dẫn tạo Supabase project mới

> App đã được viết lại toàn bộ từ "Quỹ tín dụng" sang **quản lý chi tiêu cá nhân/gia đình**. Vì
> bạn muốn tách hẳn khỏi dữ liệu quỹ tín dụng cũ, app này cần **1 project Supabase MỚI, riêng biệt**
> (không dùng chung với project cũ). Làm đúng theo thứ tự dưới đây — y hệt lần trước, chỉ đổi schema.

## 1. Tạo project mới

1. Vào [supabase.com](https://supabase.com) → **New project** → đặt tên (VD: `so-chi-tieu`) → đặt
   **Database Password** (lưu lại chỗ an toàn) → chọn Region **Singapore** → **Create new project**.
2. Vào **Project Settings → API**, lấy 2 giá trị: **Project URL** và **anon public key** — 2 giá trị
   này được phép công khai/commit (bảo mật thật nằm ở RLS + Edge Function, không phải giấu key).
3. Vào **Project Settings → API → JWT Keys**, tìm **"Legacy JWT secret"** (hoặc "JWT Secret") — copy
   giá trị này lại, **không dán vào chat**, sẽ dùng ở bước 4.

## 2. Tạo bảng (schema)

Mở **SQL Editor** → chạy nguyên đoạn dưới:

```sql
create extension if not exists pgcrypto;

-- Người dùng: 1 "owner" (bạn, toàn quyền) + nhiều "member" (Use phụ owner tạo
-- thêm) — TẤT CẢ dùng CHUNG 1 sổ chi tiêu (giao dịch/danh mục/ngân sách...
-- không tách riêng theo người), chỉ khác nhau ở quyền quản lý thành viên.
create table users (
  id text primary key,
  username text unique not null,
  name text not null,
  role text not null check (role in ('owner','member')),
  salt text,
  hash text,
  must_change_password boolean default true,
  failed_attempts int default 0,
  locked_until timestamptz,
  auth_user_id uuid unique default gen_random_uuid(), -- KHÔNG phải auth.users thật, xem mục 4
  created_at timestamptz default now()
);
-- View an toàn: chỉ lộ tên/vai trò, KHÔNG lộ salt/hash — dùng để hiện "người
-- ghi giao dịch" / danh sách thành viên trên giao diện mà không cần đi qua
-- Edge Function. Bảng users thật thì KHÔNG cấp quyền đọc trực tiếp cho client
-- (xem GRANT ở mục 3) — chỉ Edge Function (service_role) mới đọc được salt/hash.
create view user_profiles as select id, name, role, created_at from users;

create table categories (
  id text primary key,
  name text not null,
  type text not null check (type in ('expense','income')),
  icon text not null default 'tag',
  color text not null default '#0f6f61',
  monthly_budget numeric, -- hạn mức ngân sách MẶC ĐỊNH hàng tháng (có thể ghi đè riêng theo tháng ở bảng budgets)
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now()
);

create table recurring_transactions (
  id text primary key,
  type text not null check (type in ('expense','income')),
  amount numeric not null,
  category_id text references categories(id) on delete set null,
  note text,
  day_of_month int not null check (day_of_month between 1 and 28),
  active boolean not null default true,
  user_id text references users(id) on delete set null,
  created_at timestamptz default now()
);

create table transactions (
  id text primary key,
  type text not null check (type in ('expense','income')),
  amount numeric not null check (amount > 0),
  category_id text references categories(id) on delete set null,
  note text,
  txn_date date not null,
  user_id text references users(id) on delete set null, -- ai ghi giao dịch này
  recurring_id text references recurring_transactions(id) on delete set null, -- có nếu ghi từ nhắc định kỳ, để không nhắc lại trong tháng
  created_at timestamptz default now()
);

create table budgets (
  id text primary key,
  year int not null,
  month int not null check (month between 1 and 12),
  category_id text not null references categories(id) on delete cascade,
  amount numeric not null,
  created_at timestamptz default now(),
  unique (year, month, category_id)
);

create table savings_goals (
  id text primary key,
  name text not null,
  target_amount numeric not null,
  current_amount numeric not null default 0,
  deadline date,
  note text,
  user_id text references users(id) on delete set null,
  created_at timestamptz default now()
);

-- Kế hoạch chi tiêu: khoản thu/chi DỰ ĐỊNH (vd "cuối tháng mua sắm 2 triệu")
-- — chỉ để nhắc/theo dõi, CHƯA tính vào thu/chi thật cho tới khi tick "Hoàn
-- thành" (lúc đó mới tự tạo 1 dòng trong transactions, xem transaction_id).
create table plans (
  id text primary key,
  type text not null check (type in ('expense','income')),
  amount numeric not null,
  category_id text references categories(id) on delete set null,
  title text not null,
  due_date date,
  status text not null default 'pending' check (status in ('pending','done')),
  transaction_id text references transactions(id) on delete set null,
  user_id text references users(id) on delete set null,
  created_at timestamptz default now()
);

-- Quản lý nợ (vd nợ mua sắm trả góp, vay mượn) — dư nợ giảm dần mỗi lần trả,
-- mỗi lần trả tự tạo 1 giao dịch chi tiêu thật (xem debt_payments.transaction_id)
-- để không bị lệch tổng chi tiêu tháng.
create table debts (
  id text primary key,
  name text not null,
  creditor text, -- vay/mua của ai (không bắt buộc)
  total_amount numeric not null,
  remaining_amount numeric not null,
  start_date date not null default current_date,
  status text not null default 'active' check (status in ('active','paid')),
  note text,
  user_id text references users(id) on delete set null,
  created_at timestamptz default now()
);
create table debt_payments (
  id text primary key,
  debt_id text not null references debts(id) on delete cascade,
  amount numeric not null,
  payment_date date not null,
  transaction_id text references transactions(id) on delete set null,
  user_id text references users(id) on delete set null,
  created_at timestamptz default now()
);

create table app_settings (
  id text primary key default 'main',
  household_name text not null default 'Sổ chi tiêu của tôi',
  currency text not null default 'đ'
);
insert into app_settings (id) values ('main');

create index on transactions (txn_date);
create index on transactions (category_id);
create index on transactions (user_id);
create index on budgets (year, month);
create index on plans (status);
create index on plans (due_date);
create index on debts (status);
create index on debt_payments (debt_id);
```

## 3. Row Level Security + quyền bảng

```sql
alter table users enable row level security;
alter table categories enable row level security;
alter table recurring_transactions enable row level security;
alter table transactions enable row level security;
alter table budgets enable row level security;
alter table savings_goals enable row level security;
alter table plans enable row level security;
alter table debts enable row level security;
alter table debt_payments enable row level security;
alter table app_settings enable row level security;

grant usage on schema public to anon, authenticated, service_role;

-- users: KHÔNG cấp gì cho anon/authenticated — chỉ service_role (Edge
-- Function) được đọc/ghi trực tiếp, vì bảng này có salt/hash mật khẩu.
grant select, insert, update, delete on users to service_role;
grant select on user_profiles to anon, authenticated;

grant select, insert, update, delete on categories, recurring_transactions, transactions, budgets, savings_goals, plans, debts, debt_payments
  to authenticated, service_role;
grant select on app_settings to anon, authenticated;
grant update on app_settings to authenticated, service_role;

-- Mọi người dùng đã đăng nhập (owner hoặc member) đều đọc/ghi CHUNG 1 sổ —
-- không tách riêng theo người, chỉ cần đúng JWT hợp lệ do Edge Function cấp.
create policy "authenticated full access categories" on categories
  for all using ((auth.jwt() ->> 'app_role') in ('owner','member'))
  with check ((auth.jwt() ->> 'app_role') in ('owner','member'));
create policy "authenticated full access recurring" on recurring_transactions
  for all using ((auth.jwt() ->> 'app_role') in ('owner','member'))
  with check ((auth.jwt() ->> 'app_role') in ('owner','member'));
create policy "authenticated full access transactions" on transactions
  for all using ((auth.jwt() ->> 'app_role') in ('owner','member'))
  with check ((auth.jwt() ->> 'app_role') in ('owner','member'));
create policy "authenticated full access budgets" on budgets
  for all using ((auth.jwt() ->> 'app_role') in ('owner','member'))
  with check ((auth.jwt() ->> 'app_role') in ('owner','member'));
create policy "authenticated full access savings" on savings_goals
  for all using ((auth.jwt() ->> 'app_role') in ('owner','member'))
  with check ((auth.jwt() ->> 'app_role') in ('owner','member'));
create policy "authenticated full access plans" on plans
  for all using ((auth.jwt() ->> 'app_role') in ('owner','member'))
  with check ((auth.jwt() ->> 'app_role') in ('owner','member'));
-- Quản lý nợ RIÊNG của từng người dùng (không chia sẻ như các bảng trên) —
-- mỗi người chỉ xem/sửa được đúng khoản nợ do mình tạo (kể cả owner).
create policy "own debts only" on debts
  for all using ((auth.jwt() ->> 'row_id') = user_id)
  with check ((auth.jwt() ->> 'row_id') = user_id);
create policy "own debt_payments only" on debt_payments
  for all using ((auth.jwt() ->> 'row_id') = user_id)
  with check ((auth.jwt() ->> 'row_id') = user_id);

-- app_settings: ai cũng xem được (tên sổ hiện ở màn đăng nhập, chưa cần đăng
-- nhập cũng phải thấy), chỉ owner sửa được.
create policy "anyone sees settings" on app_settings for select using (true);
create policy "owner updates settings" on app_settings
  for update using ((auth.jwt() ->> 'app_role') = 'owner');
```

## 4. Xác thực — giữ nguyên kiến trúc JWT tự ký đã dùng ở app cũ

Không dùng Supabase Auth/GoTrue — Edge Function tự băm/so mật khẩu (SHA-256 salted, giống hệt code cũ)
rồi **tự ký 1 JWT** bằng "Legacy JWT secret" của project này, chứa `app_role` ('owner'/'member') và
`row_id` (id của dòng trong bảng `users`) để RLS ở trên dùng. Không có OTP (giữ đúng quyết định đã
chốt trước đây: bảo mật cơ bản — mật khẩu băm + JWT ký server — là đủ cho quy mô gia đình/cá nhân).

### Deploy Edge Function
1. Vào Supabase Dashboard → menu ☰ → **Edge Functions** → tạo function mới (tên gì cũng được).
2. Copy toàn bộ nội dung `supabase/functions/create-account/index.ts` trong repo này → dán → **Deploy**.
3. Vào **Edge Functions → Secrets** → thêm secret **`CUSTOM_JWT_SECRET`**, dán giá trị "Legacy JWT
   secret" đã lấy ở bước 1.3 → Save.
4. Copy đúng **URL thật** của function vừa deploy (không phải tên hiển thị) → báo lại để cập nhật
   `js/lib/supabaseClient.js` (3 giá trị cần cập nhật: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_FN_URL`).

## 5. Tài khoản owner đầu tiên

Vì chưa có tài khoản nào để tự tạo tài khoản đầu tiên (owner), chạy tay 1 lần trong SQL Editor —
thay `TEN_DANG_NHAP`/`MAT_KHAU` trước khi chạy (mật khẩu này chỉ dùng để đăng nhập lần đầu, app sẽ
bắt đổi ngay sau đó vì `must_change_password` mặc định `true`):

```sql
-- Chạy trong SQL Editor — Postgres có sẵn hàm băm digest() từ extension pgcrypto đã bật ở mục 2.
insert into users (id, username, name, role, salt, hash, must_change_password)
select
  'owner_1', 'TEN_DANG_NHAP', 'Chủ sổ', 'owner',
  salt, encode(digest(salt || ':' || 'MAT_KHAU', 'sha256'), 'hex'), true
from (select encode(gen_random_bytes(8), 'hex') as salt) s;
```

## 7. Bổ sung sau: bảng "Kế hoạch chi tiêu" (nếu project đã tạo trước khi có mục này)

Nếu bạn đã chạy schema ở mục 2 TRƯỚC KHI bảng `plans` được thêm vào tài liệu này, chạy bổ sung
đúng đoạn SQL sau trong **SQL Editor** (không ảnh hưởng gì tới dữ liệu đã có):

```sql
create table plans (
  id text primary key,
  type text not null check (type in ('expense','income')),
  amount numeric not null,
  category_id text references categories(id) on delete set null,
  title text not null,
  due_date date,
  status text not null default 'pending' check (status in ('pending','done')),
  transaction_id text references transactions(id) on delete set null,
  user_id text references users(id) on delete set null,
  created_at timestamptz default now()
);
create index on plans (status);
create index on plans (due_date);

alter table plans enable row level security;
grant select, insert, update, delete on plans to authenticated, service_role;
create policy "authenticated full access plans" on plans
  for all using ((auth.jwt() ->> 'app_role') in ('owner','member'))
  with check ((auth.jwt() ->> 'app_role') in ('owner','member'));
```

Sau đó cần **deploy lại Edge Function** với code mới nhất (không đổi gì về SQL/JWT, chỉ để chắc
chắn code khớp bản mới nhất — xem lại mục 4).

## 8. Bổ sung sau: bảng "Quản lý nợ" (nếu project đã tạo trước khi có mục này)

Chạy đúng đoạn SQL sau trong **SQL Editor** (không ảnh hưởng gì tới dữ liệu đã có):

```sql
create table debts (
  id text primary key,
  name text not null,
  creditor text,
  total_amount numeric not null,
  remaining_amount numeric not null,
  start_date date not null default current_date,
  status text not null default 'active' check (status in ('active','paid')),
  note text,
  user_id text references users(id) on delete set null,
  created_at timestamptz default now()
);
create table debt_payments (
  id text primary key,
  debt_id text not null references debts(id) on delete cascade,
  amount numeric not null,
  payment_date date not null,
  transaction_id text references transactions(id) on delete set null,
  user_id text references users(id) on delete set null,
  created_at timestamptz default now()
);
create index on debts (status);
create index on debt_payments (debt_id);

alter table debts enable row level security;
alter table debt_payments enable row level security;
grant select, insert, update, delete on debts, debt_payments to authenticated, service_role;
-- Riêng của từng người dùng, không chia sẻ như các bảng khác — mỗi người chỉ
-- xem/sửa được đúng khoản nợ do mình tạo (kể cả owner).
create policy "own debts only" on debts
  for all using ((auth.jwt() ->> 'row_id') = user_id)
  with check ((auth.jwt() ->> 'row_id') = user_id);
create policy "own debt_payments only" on debt_payments
  for all using ((auth.jwt() ->> 'row_id') = user_id)
  with check ((auth.jwt() ->> 'row_id') = user_id);
```

Nếu project của bạn đã chạy đoạn SQL debts/debt_payments cũ (dùng chung cho cả nhà) từ
trước, đổi sang riêng-tư bằng cách chạy thêm:

```sql
drop policy if exists "authenticated full access debts" on debts;
drop policy if exists "authenticated full access debt_payments" on debt_payments;
create policy "own debts only" on debts
  for all using ((auth.jwt() ->> 'row_id') = user_id)
  with check ((auth.jwt() ->> 'row_id') = user_id);
create policy "own debt_payments only" on debt_payments
  for all using ((auth.jwt() ->> 'row_id') = user_id)
  with check ((auth.jwt() ->> 'row_id') = user_id);
```

## 9. Việc còn lại

- [ ] Đổi mật khẩu owner ngay sau lần đăng nhập đầu tiên (app tự bắt đổi).
- [ ] Rà soát dữ liệu chi tiêu thật trước khi coi là "đang dùng thật".
