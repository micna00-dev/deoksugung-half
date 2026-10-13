-- AI 채점 결과 테이블 (supabase-setup.sql 실행 후 한 번만 실행)
create table if not exists public.scores (
  submission_id bigint primary key references public.submissions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  model         text,
  alignment     smallint not null,   -- 선 연결 (40)
  perspective   smallint not null,   -- 크기·원근 (25)
  color         smallint not null,   -- 색감·밝기 (15)
  teamwork      smallint not null,   -- 조원 참여 (20)
  wit           smallint not null,   -- 재치 (20, 특별상용·총점 제외)
  total         smallint not null,   -- 앞 4개 합계 (100)
  summary       text,
  reasons       jsonb
);

alter table public.scores enable row level security;

-- 점수는 관리자(로그인한 사용자)만 볼 수 있음. 저장은 채점 함수(서버)만 함
create policy "admins can read scores"
  on public.scores for select
  to authenticated
  using (true);
