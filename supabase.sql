-- ============================================================
-- CƠ SỞ DỮ LIỆU CHO APP KIỂM KÊ FOREMOST (SUPABASE)
-- Chạy toàn bộ file này một lần trong Supabase: SQL Editor → New query → dán → Run.
-- Chỉ cần sửa MỘT chỗ: email quản trị chính trong hàm kk_owner_email() bên dưới.
-- ============================================================

-- Mỗi dòng là một "tài liệu", đường dẫn giống bản cũ: md_catalog/main, htk_sessions/<đợt>/counts/<mã>, ...
create table if not exists public.docs (
  path       text primary key,
  col        text not null,                       -- đường dẫn bộ sưu tập chứa tài liệu
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists docs_col_idx on public.docs (col);
alter table public.docs replica identity full;
alter table public.docs enable row level security;

-- Email quản trị chính: luôn có toàn quyền
create or replace function public.kk_owner_email() returns text
language sql immutable as $$ select 'DAN_EMAIL_QUAN_TRI_VAO_DAY'::text $$;

create or replace function public.kk_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- Quản trị = email chính hoặc email trong config/roles.admins
create or replace function public.kk_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.kk_email() = public.kk_owner_email()
    or exists (select 1 from public.docs where path = 'config/roles' and coalesce(data -> 'admins', '[]'::jsonb) ? public.kk_email())
  )
$$;

-- Nhân viên = tài khoản đã đăng nhập (tài khoản chỉ do quản trị tạo trong Supabase)
create or replace function public.kk_is_member() returns boolean
language sql stable as $$ select auth.uid() is not null $$;

-- Quy tắc đọc
drop policy if exists kk_read on public.docs;
create policy kk_read on public.docs for select to authenticated using (
  public.kk_is_admin()
  or (public.kk_is_member() and (
        path = 'gate/main'
     or path like 'users/%'
     or path ~ '^(md|htk|ahd)_(catalog|nl_catalog|sessions|approvals)/'
  ))
);

-- Quy tắc thêm mới
drop policy if exists kk_insert on public.docs;
create policy kk_insert on public.docs for insert to authenticated with check (
  public.kk_is_admin()
  or (public.kk_is_member() and (
        path = 'users/' || auth.uid()::text
     or path ~ '^(md|htk|ahd)_sessions/'
  ))
);

-- Quy tắc sửa
drop policy if exists kk_update on public.docs;
create policy kk_update on public.docs for update to authenticated using (
  public.kk_is_admin()
  or (public.kk_is_member() and (path = 'users/' || auth.uid()::text or path ~ '^(md|htk|ahd)_sessions/'))
) with check (
  public.kk_is_admin()
  or (public.kk_is_member() and (path = 'users/' || auth.uid()::text or path ~ '^(md|htk|ahd)_sessions/'))
);

-- Quy tắc xóa: nhân viên chỉ xóa được số đếm (mục phát sinh)
drop policy if exists kk_delete on public.docs;
create policy kk_delete on public.docs for delete to authenticated using (
  public.kk_is_admin()
  or (public.kk_is_member() and path ~ '^(md|htk|ahd)_sessions/[^/]+/counts/')
);

-- Gộp các trường (giống "update" của bản cũ). Chạy với quyền người gọi nên vẫn theo quy tắc trên.
create or replace function public.kk_update(p_path text, p_patch jsonb) returns boolean
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update public.docs set data = data || p_patch, updated_at = now() where path = p_path;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not-found' using errcode = 'P0002'; end if;
  return true;
end $$;

grant select, insert, update, delete on public.docs to authenticated;
grant execute on function public.kk_update(text, jsonb) to authenticated;
grant execute on function public.kk_is_admin() to authenticated;
revoke all on public.docs from anon;

-- Cập nhật tức thời giữa các máy
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
