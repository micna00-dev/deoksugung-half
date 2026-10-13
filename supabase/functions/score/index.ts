// Supabase Edge Function: score
// 제출된 합성 사진 1장을 Claude 로 채점해 public.scores 에 저장한다.
//
// 필요한 비밀값 (Supabase 대시보드 > Edge Functions > Secrets)
//   ANTHROPIC_API_KEY  - Anthropic Console 에서 발급한 API 키
// 자동 제공: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// 호출
//   참가자(로그인 X): { photo_path }                  → 아직 채점 안 된 사진만 채점
//   관리자(로그인 O): { submission_id, rescore? }     → rescore=true 면 다시 채점
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { z } from "npm:zod@3.25.76";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const MODEL = "claude-opus-5-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 배점 (관리자 페이지·결과 이미지와 같은 값)
const MAX = { alignment: 40, perspective: 25, color: 15, teamwork: 20, wit: 20 } as const;

const SYSTEM = `당신은 사진 미션 대회의 공정한 심사위원입니다.

[미션 설명]
참가 조에게 덕수궁 건물 사진의 '반쪽'을 주고, 실제 현장에서 같은 건물을 찾아 나머지 반쪽을 조원들과 함께 촬영하게 했습니다.
채점할 이미지는 그 결과로 만든 합성 사진입니다.
- 가운데 세로 경계를 기준으로 한쪽은 미리 준비된 원본 사진, 다른 쪽은 참가자가 촬영한 사진입니다.
- 맨 아래의 어두운 띠(미션 번호, 조 이름, 행사명)는 자동으로 들어간 글자이므로 채점에서 무시하세요.
- 대회의 목표는 "두 반쪽이 원래 한 장의 사진처럼 보이게 만드는 것"입니다.

[채점 기준]
1. alignment (0~40) 선 연결: 지붕선·처마·기둥·창문·계단 등 건물의 윤곽선이 경계에서 끊기지 않고 이어지는가
   36~40 거의 완벽하게 이어짐 / 28~35 대부분 이어지고 작은 어긋남 / 18~27 같은 건물이지만 눈에 띄게 어긋남 / 8~17 많이 어긋남 / 0~7 다른 건물이거나 연결을 판단할 수 없음
2. perspective (0~25) 크기·원근: 건물의 크기, 높이, 촬영 각도와 거리가 원본 반쪽과 맞는가
   22~25 거의 같음 / 16~21 약간 다름 / 9~15 확연히 다름 / 0~8 전혀 맞지 않음
3. color (0~15) 색감·밝기: 하늘, 벽, 지붕의 색과 밝기, 날씨·그림자 느낌이 자연스럽게 이어지는가
   13~15 경계가 거의 느껴지지 않음 / 9~12 조금 다름 / 5~8 확연히 다름 / 0~4 매우 다름
4. teamwork (0~20) 조원 참여: 참가자 촬영 쪽에 조원들이 등장하고, 건물 연결을 해치지 않으면서 자연스럽게 어우러지는가
   17~20 여러 조원이 자연스럽게 어우러짐 / 11~16 조원이 등장하지만 다소 어색하거나 건물을 많이 가림 / 5~10 한두 명만 작게 등장 / 0~4 사람이 없음
5. wit (0~20) 재치 (특별상용, 총점에 포함되지 않음): 포즈, 연출, 아이디어가 재미있고 창의적인가
   17~20 매우 재치 있음 / 11~16 재미 요소가 있음 / 5~10 평범함 / 0~4 연출 없음

[원칙]
- 모든 사진에 같은 기준을 똑같이 적용하세요. 조 이름이나 미션 번호로 판단을 바꾸지 마세요.
- 각 점수의 reason 에는 사진에서 실제로 보이는 근거를 한국어 한 문장으로 구체적으로 적으세요. (예: "왼쪽 처마선과 오른쪽 처마선이 경계에서 손가락 한 마디 정도 어긋남")
- summary 에는 사진 전체에 대한 한 줄 평을 한국어로 적으세요. 결과 발표 때 그대로 읽어도 될 만큼 정중하게 쓰세요.`;

const Criterion = z.object({ score: z.number(), reason: z.string() });
const Result = z.object({
  alignment: Criterion,
  perspective: Criterion,
  color: Criterion,
  teamwork: Criterion,
  wit: Criterion,
  summary: z.string(),
});

const criterionSchema = {
  type: "object",
  properties: { score: { type: "integer" }, reason: { type: "string" } },
  required: ["score", "reason"],
  additionalProperties: false,
};
const SCHEMA = {
  type: "object",
  properties: {
    alignment: criterionSchema,
    perspective: criterionSchema,
    color: criterionSchema,
    teamwork: criterionSchema,
    wit: criterionSchema,
    summary: { type: "string" },
  },
  required: ["alignment", "perspective", "color", "teamwork", "wit", "summary"],
  additionalProperties: false,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 로그인한 관리자인지 확인 (참가자는 공개 키로 호출하므로 사용자 없음)
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let isAdmin = false;
  if (token && !token.startsWith("sb_")) {
    const { data } = await db.auth.getUser(token);
    isAdmin = !!data?.user;
  }

  let body: { submission_id?: number; photo_path?: string; rescore?: boolean };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  let q = db.from("submissions").select("*");
  if (isAdmin && body.submission_id) q = q.eq("id", body.submission_id);
  else if (body.photo_path) q = q.eq("photo_path", body.photo_path);
  else return json({ error: "submission_id(관리자) 또는 photo_path 가 필요합니다" }, 400);
  const { data: sub, error: subErr } = await q.maybeSingle();
  if (subErr) return json({ error: subErr.message }, 500);
  if (!sub) return json({ error: "제출 기록을 찾을 수 없습니다" }, 404);

  // 이미 채점된 사진은 관리자가 rescore 를 요청한 경우에만 다시 채점
  const { data: existing } = await db.from("scores").select("*").eq("submission_id", sub.id).maybeSingle();
  if (existing && !(isAdmin && body.rescore)) return json({ score: existing, cached: true });

  const { data: file, error: dlErr } = await db.storage.from("photos").download(sub.photo_path);
  if (dlErr || !file) return json({ error: "사진을 불러오지 못했습니다" }, 500);
  const image = toBase64(new Uint8Array(await file.arrayBuffer()));

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY 비밀값이 설정되지 않았습니다" }, 500);
  const anthropic = new Anthropic({ apiKey });

  let msg;
  try {
    msg = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // 안전 분류기가 요청을 거절하면 Anthropic 권장 모델로 자동 재시도
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: `미션 ${sub.mission} 합성 사진입니다. 채점 기준에 따라 채점하세요.` },
        ],
      }],
    // deno-lint-ignore no-explicit-any
    } as any);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "요청이 많아 잠시 후 다시 시도해 주세요", retry: true }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API 오류 (${e.status}): ${e.message}` }, 502);
    return json({ error: String(e) }, 500);
  }

  if (msg.stop_reason === "refusal") return json({ error: "채점이 거절되었습니다. 사진을 확인해 주세요." }, 422);
  // deno-lint-ignore no-explicit-any
  const text = (msg.content as any[]).find((b) => b.type === "text")?.text ?? "";
  let parsed;
  try { parsed = Result.parse(JSON.parse(text)); }
  catch { return json({ error: "채점 결과를 해석하지 못했습니다", raw: text.slice(0, 500) }, 502); }

  const s = {
    alignment: clamp(parsed.alignment.score, MAX.alignment),
    perspective: clamp(parsed.perspective.score, MAX.perspective),
    color: clamp(parsed.color.score, MAX.color),
    teamwork: clamp(parsed.teamwork.score, MAX.teamwork),
    wit: clamp(parsed.wit.score, MAX.wit),
  };
  const row = {
    submission_id: sub.id,
    created_at: new Date().toISOString(),
    model: msg.model,
    ...s,
    total: s.alignment + s.perspective + s.color + s.teamwork,
    summary: parsed.summary,
    reasons: {
      alignment: parsed.alignment.reason,
      perspective: parsed.perspective.reason,
      color: parsed.color.reason,
      teamwork: parsed.teamwork.reason,
      wit: parsed.wit.reason,
    },
  };
  const { error: upErr } = await db.from("scores").upsert(row);
  if (upErr) return json({ error: upErr.message }, 500);
  return json({ score: row });
});
