// Supabase 연결 정보
// 대시보드 > Project Settings > API 에서 복사해 넣으세요.
// - SUPABASE_URL: Project URL
// - SUPABASE_ANON_KEY: anon(public) 키 또는 publishable 키  ※ service_role / secret 키는 절대 넣지 마세요.
// 비워두면 업로드 없이 "폰에만 저장" 모드로 동작합니다.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://yvlfkitjdzihdunjajjt.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_D2791_sQyjrX5aTrnbCjLg_i5caMp-C',
  // 사진 전송 직후 AI 채점 자동 요청 (false 면 관리자 페이지에서 직접 채점)
  AUTO_SCORE: true,
};
