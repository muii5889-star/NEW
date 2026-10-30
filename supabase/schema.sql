-- =====================================================================
--  قاعدة بيانات محطة تنقية سد خليص
--  الصق هذا الملف كاملاً في Supabase → SQL Editor → Run (مرة وحدة فقط)
-- =====================================================================

-- ---------- 1) المستخدمون وصلاحياتهم ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'user' check (role in ('admin','user')),
  can_insert  boolean not null default false,   -- إدخال قراءات
  can_edit    boolean not null default false,   -- تعديل القراءات
  can_delete  boolean not null default false,   -- حذف القراءات
  can_yearly  boolean not null default false,   -- إدارة السجل السنوي
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- 2) القراءات اليومية ----------
create table if not exists public.daily_readings (
  day             date primary key,
  production      numeric(14,2) not null check (production >= 0),
  export_khulais  numeric(14,2) not null default 0 check (export_khulais >= 0),
  export_kamil    numeric(14,2) not null default 0 check (export_kamil >= 0),
  energy          numeric(14,2) not null default 0 check (energy >= 0),
  chemicals       numeric(14,3) not null default 0 check (chemicals >= 0),
  note            text check (char_length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz
);

-- ---------- 3) الإجماليات السنوية (للسنوات أو الفترات بدون قراءات يومية) ----------
create table if not exists public.yearly_totals (
  year            int primary key check (year between 2000 and 2100),
  through_date    date not null,               -- المجموع يغطي من 1 يناير إلى هذا التاريخ
  production      numeric(16,2) not null default 0 check (production >= 0),
  export_khulais  numeric(16,2) not null default 0 check (export_khulais >= 0),
  export_kamil    numeric(16,2) not null default 0 check (export_kamil >= 0),
  energy          numeric(16,2) not null default 0 check (energy >= 0),
  chemicals       numeric(16,3) not null default 0 check (chemicals >= 0),
  note            text check (char_length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz,
  check (extract(year from through_date)::int = year)
);

-- ---------- 4) سجل العمليات (من أضاف/عدّل/حذف ومتى) ----------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid,
  user_email  text,
  action      text not null,
  table_name  text not null,
  row_key     text,
  old_data    jsonb,
  new_data    jsonb
);

-- =====================================================================
--  الدوال
-- =====================================================================

-- هل المستخدم الحالي يملك صلاحية معينة؟ (المدير يملك الكل)
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select active and (
      role = 'admin' or case p
        when 'read'   then true
        when 'insert' then can_insert
        when 'edit'   then can_edit
        when 'delete' then can_delete
        when 'yearly' then can_yearly
        else false end)
    from public.profiles where id = auth.uid()), false);
$$;

-- إنشاء ملف تعريف تلقائياً عند إضافة مستخدم (بدون أي صلاحيات)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ختم تلقائي: من أضاف ومتى / من عدّل ومتى (لا يمكن تزويره من المتصفح)
create or replace function public.tg_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
    new.updated_by := null;       new.updated_at := null;
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.updated_by := auth.uid();     new.updated_at := now();
  end if;
  return new;
end $$;

-- منع تسجيل تاريخ في المستقبل
create or replace function public.tg_daily_check()
returns trigger language plpgsql as $$
begin
  if new.day > current_date + 1 then
    raise exception 'لا يمكن تسجيل قراءة لتاريخ في المستقبل';
  end if;
  return new;
end $$;

-- تسجيل كل عملية في سجل العمليات
create or replace function public.tg_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  k := coalesce(to_jsonb(new), to_jsonb(old)) ->> (case tg_table_name when 'daily_readings' then 'day' else 'year' end);
  insert into public.audit_log (user_id, user_email, action, table_name, row_key, old_data, new_data)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()), tg_op, tg_table_name, k,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

-- حماية: لا يمكن حذف أو إيقاف آخر مدير
create or replace function public.tg_keep_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.active and
     (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    if not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
      raise exception 'لا يمكن إزالة آخر مدير في النظام';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists stamp on public.daily_readings;
create trigger stamp before insert or update on public.daily_readings for each row execute function public.tg_stamp();
drop trigger if exists stamp on public.yearly_totals;
create trigger stamp before insert or update on public.yearly_totals for each row execute function public.tg_stamp();
drop trigger if exists daily_check on public.daily_readings;
create trigger daily_check before insert or update on public.daily_readings for each row execute function public.tg_daily_check();
drop trigger if exists audit on public.daily_readings;
create trigger audit after insert or update or delete on public.daily_readings for each row execute function public.tg_audit();
drop trigger if exists audit on public.yearly_totals;
create trigger audit after insert or update or delete on public.yearly_totals for each row execute function public.tg_audit();
drop trigger if exists keep_admin on public.profiles;
create trigger keep_admin before update or delete on public.profiles for each row execute function public.tg_keep_admin();

-- الملخص العام للزوار: مجموع كل سنة (السنوي + اليومي) بدون كشف أي تفاصيل أخرى
create or replace function public.public_summary()
returns table (yr int, production numeric, export_khulais numeric, export_kamil numeric,
               energy numeric, chemicals numeric, days int, last_date date)
language sql stable security definer set search_path = public as $$
  select y, sum(p), sum(ek), sum(em), sum(e), sum(c), sum(n)::int, max(ld)
  from (
    select extract(year from day)::int as y, production p, export_khulais ek, export_kamil em,
           energy e, chemicals c, 1 as n, day as ld
    from public.daily_readings
    union all
    select year, production, export_khulais, export_kamil, energy, chemicals,
           (through_date - make_date(year, 1, 1) + 1), through_date
    from public.yearly_totals
  ) u
  group by y order by y;
$$;

revoke all on function public.public_summary() from public;
grant execute on function public.public_summary() to anon, authenticated;

-- =====================================================================
--  قواعد الحماية (Row Level Security)
--  الزائر (anon) لا يستطيع قراءة أي جدول، فقط الملخص أعلاه.
-- =====================================================================
alter table public.profiles       enable row level security;
alter table public.daily_readings enable row level security;
alter table public.yearly_totals  enable row level security;
alter table public.audit_log      enable row level security;

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
revoke all on public.profiles, public.daily_readings, public.yearly_totals from anon;

drop policy if exists "profiles read"  on public.profiles;
create policy "profiles read"  on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_perm('admin'));

drop policy if exists "readings read"   on public.daily_readings;
drop policy if exists "readings insert" on public.daily_readings;
drop policy if exists "readings update" on public.daily_readings;
drop policy if exists "readings delete" on public.daily_readings;
create policy "readings read"   on public.daily_readings for select to authenticated using (public.has_perm('read'));
create policy "readings insert" on public.daily_readings for insert to authenticated with check (public.has_perm('insert'));
create policy "readings update" on public.daily_readings for update to authenticated using (public.has_perm('edit')) with check (public.has_perm('edit'));
create policy "readings delete" on public.daily_readings for delete to authenticated using (public.has_perm('delete'));

drop policy if exists "yearly read"  on public.yearly_totals;
drop policy if exists "yearly write" on public.yearly_totals;
create policy "yearly read"  on public.yearly_totals for select to authenticated using (public.has_perm('read'));
create policy "yearly write" on public.yearly_totals for all    to authenticated using (public.has_perm('yearly')) with check (public.has_perm('yearly'));

drop policy if exists "audit read" on public.audit_log;
create policy "audit read" on public.audit_log for select to authenticated using (public.has_perm('admin'));

-- =====================================================================
--  بعد إنشاء حسابك من Authentication → Users، اجعله مديراً بهذا السطر
--  (غيّر الإيميل لإيميلك ثم شغّله لوحده):
--
--  update public.profiles set role = 'admin' where email = 'you@example.com';
-- =====================================================================
