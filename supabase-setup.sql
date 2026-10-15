-- 덕수궁 "잃어버린 반쪽을 찾아라" — Supabase 초기 설정
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요. (한 번만 실행)

-- 1) 참가 기록 테이블
create table if not exists public.submissions (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  participant_id uuid        not null,
  nickname       text        not null check (char_length(nickname) between 1 and 20),
  mission        smallint    not null check (mission between 1 and 6),
  photo_path     text        not null,
  thumb_path     text        not null
);

create index if not exists submissions_participant_idx on public.submissions (participant_id);

alter table public.submissions enable row level security;

-- 참가자(로그인 안 한 방문객)는 기록 추가만 가능, 조회 불가
create policy "participants can insert"
  on public.submissions for insert
  to anon, authenticated
  with check (true);

-- 관리자(로그인한 사용자)만 조회/삭제 가능
create policy "admins can read"
  on public.submissions for select
  to authenticated
  using (true);

create policy "admins can delete"
  on public.submissions for delete
  to authenticated
  using (true);

-- 2) 사진 저장소 (비공개 버킷, 장당 5MB, JPG만)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- 참가자는 업로드만 가능 (덮어쓰기·조회 불가)
create policy "participants can upload photos"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'photos');

-- 관리자만 사진 조회/삭제 가능
create policy "admins can view photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'photos');

create policy "admins can delete photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'photos');
