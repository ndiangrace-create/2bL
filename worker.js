import {
  capabilitiesForRole,
  selectActivePlatformAdminRecord,
  isDestructiveAdminAction,
  isSeriesManagerAction,
  PLATFORM_ADMIN_ACTIONS,
  TENANT_OWNER_ACTIONS,
  SESSION_TARGET_ACTIONS,
  REGISTRATION_TARGET_ACTIONS,
} from './lib/admin-authorization.js';

// SEAT_SINGLE_SOURCE_ACTUAL_FIX_20260722：實際移除舊 API、補上 saveSeatMapImage、統一位置分類與資料來源
// MEMBER_FASTPASS_PAYMENT_EQUIP_FIX_20260721：會員免審核狀態回傳＋付款卡片設備自備顯示
// FULL_FLOW_FIX_20260721：會員、選位、場地圖、取消退款、現場與拍照框閉環修復
// SEAT_FLOW_FIX_20260721：前台選位意願／場地圖套用／24h 保留與釋出閉環修復
// FINANCE_MODULE_CONFIRMED_20260707：包含 getPaymentProfiles / savePaymentProfile / disablePaymentProfile / getFinancePaymentGroups
// ================================================================
// 2BL V8 Cloudflare Worker
// 正式主線檔案：worker.js
// Worker 正式交付只提供 worker.js，不再產出 worker.txt。
// Cloudflare Workers 請直接部署本檔內容。
// 更新日期：2026-06-28（版本殘留清理版）
// ================================================================
// 環境變數 (Cloudflare Workers 設定)：
//   SUPABASE_URL  — 2BL Supabase Project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service_role key（SUPABASE_KEY 相容備援）
//   RESEND_KEY    — Resend API key
//   AUTH_SECRET   — token 鹽值（自訂字串，改後管理員需重新登入）
//   OPENAI_API_KEY — OpenAI API 金鑰（AI 主視覺生成模組）
//   OPENAI_IMAGE_MODEL — 可選，預設 gpt-image-1.5
// wrangler.toml cron：
//   [[triggers.crons]]
//   crons = ["0 1 * * *", "0 2 * * *"]
// ================================================================

// ── SECTION 1: 常數設定 ─────────────────────────────────────────
// DEFAULT_TENANT 已移除（M-02）：缺少 tenant 一律回傳 400，不允許 fallback
const PAY_DEADLINE_HOURS = 48;
const REMINDER_HOURS    = 36;
const STALL_HOLD_DAYS   = 3;
const SEAT_HOLD_HOURS   = 24; // 加價選位保留 24 小時
const FORCE_CHOICE_HOURS = 48; // 不可抗力選擇期限固定 48 小時

// 不可抗力原因代碼（後台單選清單）
const FORCE_REASON_CODES = {
  typhoon:                    '颱風警報',
  heavy_rain:                 '豪雨／大雨特報',
  earthquake_or_disaster:     '地震或災害安全疑慮',
  gov_work_school_suspension: '政府公告停班停課',
  gov_order_cancel:           '政府／主管機關要求停辦',
  venue_safety_request:       '場地方公共安全要求',
  venue_unavailable:          '場地突發不可使用',
  traffic_disruption:         '交通中斷或重大管制',
  other_force_majeure:        '其他不可抗力因素',
};

// fallback 常數（當 tenants 資料庫欄位為空時使用）
const FALLBACK_SITE_URL   = 'https://2b-love.com/';
// FALLBACK_LINE_URL 已移除：LINE 連結僅由 tenant_settings/tenants.line_url 提供，缺設定不 fallback
// FALLBACK_BANK_INFO 已移除：付款資訊僅由 tenant 設定提供，缺設定不 fallback
const FALLBACK_EMAIL_FROM = '兔彼樂共創 <no-reply@ndian.live>'; // fallback only；正式寄件資料以 tenants 設定 / env.MAIL_FROM 為準
const FALLBACK_EMAIL_REPLY= 'service@ndian.live'; // fallback only；正式回覆信箱以 tenants 設定 / env.MAIL_REPLY_TO 為準
const FALLBACK_TENANT_NAME= '2BL V8';
const DEFAULT_REFUND_RULES = {
  transferFeeDefault: 0,
  rules: [
    { key:'before_7', label:'活動前 7 日以上：扣行政費 NT$500', minDays:7, adminFeeType:'fixed', adminFee:500 },
    { key:'before_3_6', label:'活動前 3～6 日：退 50%', minDays:3, maxDays:6, adminFeeType:'percent', adminFeePercent:50 },
    { key:'within_3', label:'活動前 3 日內或當日：不退費', minDays:-9999, maxDays:2, adminFeeType:'percent', adminFeePercent:100 }
  ]
};

// ── 付款 API 設定（功能保留、尚未啟用，key 請設定於 Cloudflare Workers 環境變數）──
const ECPAY_MERCHANT_ID = 'YOUR_ECPAY_MERCHANT_ID';
const ECPAY_HASH_KEY    = 'YOUR_ECPAY_HASH_KEY';
const ECPAY_HASH_IV     = 'YOUR_ECPAY_HASH_IV';
const ECPAY_API_URL     = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';

const LINEPAY_CHANNEL_ID = 'YOUR_LINEPAY_CHANNEL_ID';
const LINEPAY_SECRET     = 'YOUR_LINEPAY_SECRET';
const LINEPAY_API_URL    = 'https://api-pay.line.me';
const WORKER_PUBLIC_URL  = 'https://2bl-v7.ndiangrace.workers.dev';

// ── AI 主視覺生成模組（022）────────────────────────────────────
const AI_VISUAL_BUCKET = 'session-visuals';
const AI_VISUAL_COUNT = 1;
const AI_VISUAL_SIZE = '1024x1024'; // 全部固定 1:1
const AI_VISUAL_DEFAULT_MODEL = 'gpt-image-1.5';
const AI_VISUAL_DEFAULT_QUALITY = 'medium';
const AI_VISUAL_YE_MARKET_LOGO_URL = 'https://raw.githubusercontent.com/ndiangrace-create/2bL/6a588574b94b794ee540c4f0616592fc2cb15b7e/17.jpg';
// 17.jpg 原圖為 2000x2000；以下裁切框只取實際 logo 圖形，去除大量白邊。
const AI_VISUAL_YE_MARKET_LOGO_CROP = { x:560, y:280, w:900, h:1480 };
const AI_VISUAL_PRESETS = {
  ye_market: {
    label: '耶市集',
    rules: 'pale soft green palette, hand-painted watercolor illustration, warm friendly everyday market life, gentle handmade feeling, airy composition, clean negative space, charming stalls and small market objects, soft paper texture, calm and welcoming, clearly a weekend community market',
    subject: 'must clearly show a lively Taiwanese market atmosphere: market stalls, awnings, bunting, handmade goods, small decor, people browsing or resting, warm open-air community market feeling',
    avoid: 'no generic city street, no railway crossing, no station platform, no empty scenic landscape, no unrelated Japanese-town street, no pure travel poster'
  },
  trip_market: {
    label: '市集小旅行',
    rules: 'American hand-drawn editorial illustration, lively travel and street-market feeling, playful but coherent composition, bold hand-drawn shapes, travel movement and small adventure mood, colorful yet controlled, not photorealistic',
    subject: 'must still be primarily a market-event visual: visible stalls, local browsing atmosphere, travel-meets-market storytelling, charming local props, people strolling through a market, not just transportation or city scenery',
    avoid: 'no generic train scene, no plain road trip poster, no empty street, no railway crossing, no pure landmark postcard'
  },
  flip_market: {
    label: '翻轉市集',
    rules: 'warm coffee brown, beige, kraft and muted natural green palette, environmental reuse and circular-living feeling, coffee, music and park atmosphere, community friendliness, relaxed weekend mood, natural materials, cozy and uncommercial',
    subject: 'must clearly express a park market with reuse and community life: booths, second-hand or sustainable-living props, coffee and music hints, picnic or park lounging feeling, visitors interacting in a market environment',
    avoid: 'no plain coffee shop interior, no empty park scenery, no generic landscape, no city street, no unrelated transport scene'
  },
  fantasy_festival: {
    label: '幻日祭',
    rules: 'diverse anime-inspired 2D illustration language, ACG fantasy event atmosphere, expressive and inclusive character-world energy, dynamic but orderly composition, polished anime key visual, smooth clean fabric and surfaces, no gold thread webbing, no tangled fine gold lines, no cracked gold-line patterns, no embroidery lace or net patterns, no glitter sparkle or particle clutter, no MMO armor texture, no excessive decorative micro-details',
    subject: 'must clearly feel like an anime-themed market/festival event: creator booths or market stalls, cosplay or character-event energy, event decorations, crowd or attendee presence, market-festival ambiance, not just a background scene',
    avoid: 'no generic Japanese street scene, no railway crossing, no empty anime city, no plain landscape, no unrelated urban background without event content'
  },
};


// ── SECTION 2: 工具函式 ──────────────────────────────────────────

// ── 租戶解析：從 GET params 或 POST body 取得 tenantId ──────────
function getTenantId(p) {
  // p 可能是 URL searchParams 或 POST body
  // M-02：缺少 tenant 回傳 null，不允許 fallback 至任何預設值
  const t = p && (p.tenant || p.tenantId || p.tenant_id);
  if (!t) return null;
  const clean = String(t).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return clean || null;
}

// ── JWT / Token 安全層（Google OAuth 升級）──────────────────────
// JWT_SECRET 必須來自環境變數，不得有任何預設值
function jwtSecret(env) {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET 環境變數未設定，請於 Cloudflare Workers Secrets 設定');
  return env.JWT_SECRET;
}

// 相容舊 token 格式（過渡期，90 天後可移除）
function authSecret(env) {
  if (!env.AUTH_SECRET) throw new Error('AUTH_SECRET 環境變數未設定');
  return env.AUTH_SECRET;
}
// makeToken 保留供舊路徑相容，新路徑全用 signAdminJwt
function makeToken(email, tenantId, env) {
  return md5(email + tenantId + authSecret(env));
}

// ── HS256 JWT 實作（Web Crypto API）──
async function signAdminJwt(payload, env) {
  const secret = jwtSecret(env);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey('raw', keyData, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const header = btoa(JSON.stringify({ alg:'HS256', typ:'JWT' })).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const body = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${header}.${body}.${sigB64}`;
}

async function verifyAdminJwt(token, env) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const secret = jwtSecret(env);
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey('raw', keyData, { name:'HMAC', hash:'SHA-256' }, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(parts[2].replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    let _raw = atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'));
    let _str; try { _str = decodeURIComponent(escape(_raw)); } catch(e) { _str = _raw; }
    const payload = JSON.parse(_str);
    if (payload.expires_at && Date.now() > payload.expires_at) return null; // 已過期
    return payload;
  } catch(e) { return null; }
}

// 簽發後台 admin JWT（30 天有效）
async function issueAdminToken(staffRow, tenantId, env) {
  const now = Date.now();
  const payload = {
    iss: '2BL-V8',
    sub: staffRow.id || staffRow.email,
    email: staffRow.email,
    tenant_id: tenantId,
    staff_id: staffRow.id || '',
    role: staffRow.role || 'organizer_admin',
    normalized_role: staffRow.normalized_role || staffRow.role || '',
    limit_sessions: staffRow.limit_sessions || '',
    display_name: (staffRow.name || staffRow.display_name || '').replace(/[^\x00-\x7F]/g, ''),
    issued_at: now,
    expires_at: now + 30 * 24 * 60 * 60 * 1000,  // 30 天
  };
  return signAdminJwt(payload, env);
}

// 簽發前台會員 JWT（30 天有效）
async function issueMemberToken(memberInfo, env) {
  const now = Date.now();
  const payload = {
    iss: '2BL-V8',
    type: 'member',
    sub: memberInfo.google_sub || memberInfo.email,
    email: memberInfo.email,
    google_sub: memberInfo.google_sub || '',
    display_name: (memberInfo.display_name || '').replace(/[^\x00-\x7F]/g, ''),
    avatar_url: memberInfo.avatar_url || '',
    issued_at: now,
    expires_at: now + 30 * 24 * 60 * 60 * 1000,  // 30 天
  };
  return signAdminJwt(payload, env);
}

// 檢查 tenant 是否被鎖定
async function checkTenantLocked(env, tenantId) {
  try {
    const rows = await dbGet(env, 'tenants', `id=eq.${tenantId}&select=is_locked,locked_reason,plan_type,trial_end_at`);
    const t = rows[0];
    if (!t) return { locked: false };
    if (t.is_locked) return { locked: true, reason: t.locked_reason || '帳號已鎖定' };
    // 檢查試用是否到期
    if (t.plan_type === 'trial' && t.trial_end_at) {
      if (new Date(t.trial_end_at) < new Date()) {
        return { locked: true, reason: '試用期已結束，請續費以繼續使用' };
      }
    }
    return { locked: false };
  } catch(e) { return { locked: false }; }
}

// 驗證 admin token（優先 JWT，回退舊 makeToken 格式相容）
async function verifyAdminToken(token, email, tenantId, env) {
  if (!token || !email) return null;
  // 新格式：JWT
  if (token.includes('.')) {
    const payload = await verifyAdminJwt(token, env);
    if (!payload) return null;
    if (payload.email !== email) return null;
    // platform_super_admin 不受 tenant 限制
    if (payload.normalized_role === 'platform_super_admin' || payload.role === 'platform_super_admin') return payload;
    if (payload.tenant_id !== tenantId) return null;
    return payload;
  }
  // 舊格式相容（過渡期）：重新查 DB 驗證
  const expected = makeToken(email, tenantId, env);
  const expectedPlatform = makeToken(email, 'platform', env);
  if (token !== expected && token !== expectedPlatform) return null;
  return { email, tenant_id: tenantId, role: '', legacy: true };
}

function genId(prefix) {
  // 報名表 ID 縮短且可依時間排序（自行編排、不過長）；其餘 ID 維持原樣
  if (prefix === 'REG') {
    return 'R' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,4).toUpperCase();
  }
  // H-04：改用 crypto.randomUUID，移除 4 碼尾碼碰撞風險
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
function isPaidStatus(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  if (['已繳費','已付款','付款完成','付款成功','paid','confirmed_paid','payment_confirmed'].includes(s)) return true;
  if (s.includes('已繳費') || s.includes('已付款')) return true;
  return false;
}
function safeNum(v) {
  const n = Number(v);
  return isNaN(n) || n < 0 ? 0 : n;
}
function isCapacityInactiveTransferStatus(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  if (['申請退費','退費中','退費待處理','退款待處理','已退費','已退款','refund_pending','refunded'].includes(s)) return true;
  return s.includes('退費') || s.includes('退款') || s.includes('refund');
}
function isCapacityInactiveReviewStatus(v) {
  return ['已取消','不錄取','未錄取'].includes(String(v || ''));
}
function isActiveForCapacity(reg) {
  if (!reg) return false;
  if (isCapacityInactiveReviewStatus(reg.review_status)) return false;
  if (isCapacityInactiveTransferStatus(reg.transfer_status)) return false;
  return true;
}
// M-01：adjustSessionCurrentCount 改用原子 RPC（防並發）
// delta > 0 = claim（報名），delta < 0 = release（取消/退費）
async function adjustSessionCurrentCount(env, tenantId, sessionId, delta) {
  if (!sessionId || !delta) return;
  if (delta > 0) {
    await dbRpc(env, 'claim_session_slot', { p_tenant_id: tenantId, p_session_id: sessionId, p_stall_count: delta });
  } else {
    await dbRpc(env, 'release_session_slot', { p_tenant_id: tenantId, p_session_id: sessionId, p_stall_count: Math.abs(delta) });
  }
}
async function writeAuditLog(env, tenantId, actorEmail, actorRole, action, targetTable, targetId, beforeJson, afterJson, metaJson) {
  try {
    await dbInsert(env, 'audit_logs', {
      id: genId('AUD'),
      tenant_id: tenantId,
      actor_email: actorEmail || '',
      actor_role: actorRole || '',
      action,
      target_table: targetTable || '',
      target_id: targetId || '',
      before_json: beforeJson || {},
      after_json: afterJson || {},
      meta_json: metaJson || {},
      created_at: nowIso(),
    });
  } catch(e) {
    console.error('audit log skipped', e && e.message ? e.message : e); logError(env, {source:'writeAuditLog', message:'audit log skipped', error:e && e.message ? e.message : e});
  }
}
function safeJson(str, fallback) {
  if (str === null || str === undefined) return fallback;
  if (typeof str !== 'string') return str;  // 已是 object/array，直接回傳
  if (!str.trim()) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
const REGISTRATION_SCHEDULE_TIME_ZONE = 'Asia/Taipei';
function parseRegistrationSchedule(value) {
  const raw = safeJson(value, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled:false, windows:[] };
  const windows = (Array.isArray(raw.windows) ? raw.windows : []).map((w, index) => {
    const openAt = String((w && w.openAt) || '').trim();
    const closeAt = String((w && w.closeAt) || '').trim();
    const openMs = Date.parse(openAt), closeMs = Date.parse(closeAt);
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || openMs > closeMs) return null;
    return { stage:Number((w && w.stage) || index + 1), openAt, closeAt, openMs, closeMs };
  }).filter(Boolean).sort((a,b)=>a.openMs-b.openMs);
  return {
    version: Number(raw.version)||1,
    enabled: raw.enabled === true || raw.enabled === 'true',
    preset: String(raw.preset||'three_stage'),
    timezone: String(raw.timezone||REGISTRATION_SCHEDULE_TIME_ZONE),
    firstOpenAt: String(raw.firstOpenAt||''),
    activityDate: String(raw.activityDate||''),
    windows,
  };
}
function shiftRegistrationDate(dateKey, days) {
  const m = String(dateKey||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3])));
  d.setUTCDate(d.getUTCDate()+Number(days||0));
  return d.toISOString().slice(0,10);
}
function taipeiScheduleIso(dateKey, timeText) {
  const raw = String(dateKey||'')+'T'+String(timeText||'00:00:00')+'+08:00';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}
function canonicalRegistrationSchedule(input, dates) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const enabled = raw.enabled === true || raw.enabled === 'true';
  const dateKeys = (Array.isArray(dates)?dates:[]).map(d=>String((d&&d.date)||d||'').slice(0,10)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const activityDate = dateKeys[0]||'';
  const firstOpenAt = String(raw.firstOpenAt||'').trim();
  const base = {version:1,enabled,preset:'three_stage',timezone:REGISTRATION_SCHEDULE_TIME_ZONE,firstOpenAt,activityDate,windows:[]};
  if (!enabled) return {schedule:base};
  if (!activityDate) return {error:'啟用報名排程前，請先設定活動日期'};
  const firstOpenMs = /(?:Z|[+-]\d{2}:\d{2})$/.test(firstOpenAt) ? Date.parse(firstOpenAt) : NaN;
  if (!Number.isFinite(firstOpenMs)) return {error:'請設定第一次開始報名的日期與時間'};
  const firstCloseAt = taipeiScheduleIso(shiftRegistrationDate(activityDate,-21),'23:59:59.999');
  const secondOpenAt = taipeiScheduleIso(shiftRegistrationDate(activityDate,-19),'00:00:00');
  const secondCloseAt = taipeiScheduleIso(shiftRegistrationDate(activityDate,-7),'23:59:59.999');
  const thirdOpenAt = taipeiScheduleIso(shiftRegistrationDate(activityDate,-6),'00:00:00');
  const thirdCloseAt = taipeiScheduleIso(shiftRegistrationDate(activityDate,-1),'23:59:59.999');
  if (firstOpenMs>Date.parse(firstCloseAt)) return {error:'第一次開始報名時間必須早於活動前三週的截止時間'};
  base.windows=[
    {stage:1,openAt:new Date(firstOpenMs).toISOString(),closeAt:firstCloseAt},
    {stage:2,openAt:secondOpenAt,closeAt:secondCloseAt},
    {stage:3,openAt:thirdOpenAt,closeAt:thirdCloseAt},
  ];
  return {schedule:base};
}
function registrationTimeText(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('zh-TW', {
      timeZone:REGISTRATION_SCHEDULE_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:false,
    }).format(new Date(iso));
  } catch (_e) { return String(iso); }
}
function registrationAvailability(session, nowMs=Date.now()) {
  const manualStatus = String((session && session.status)||'').trim();
  if (['關閉','已關閉','停用','封存','已封存','取消','已取消','已截止'].includes(manualStatus)) {
    return { open:false, state:'manual_closed', message:'報名已關閉', nextOpenAt:'', nextCloseAt:'' };
  }
  const schedule = parseRegistrationSchedule(session && (session.registration_schedule_json ?? session.registrationSchedule));
  if (!schedule.enabled || !schedule.windows.length) {
    return { open:true, state:'open', message:'開放報名中', nextOpenAt:'', nextCloseAt:'', schedule };
  }
  const active = schedule.windows.find(w=>nowMs>=w.openMs && nowMs<=w.closeMs);
  if (active) {
    return { open:true, state:'open', message:'開放報名中｜截止 '+registrationTimeText(active.closeAt), nextOpenAt:'', nextCloseAt:active.closeAt, schedule };
  }
  const next = schedule.windows.find(w=>nowMs<w.openMs);
  if (next) {
    const state = nowMs < schedule.windows[0].openMs ? 'upcoming' : 'paused';
    return { open:false, state, message:(state==='upcoming'?'尚未開放｜':'暫停報名｜')+'下次開放 '+registrationTimeText(next.openAt), nextOpenAt:next.openAt, nextCloseAt:'', schedule };
  }
  return { open:false, state:'ended', message:'報名已截止', nextOpenAt:'', nextCloseAt:'', schedule };
}
function agreementRequiredOn(v) {
  return !(v === false || v === 'false' || v === 0 || v === '0' || String(v || '').toLowerCase() === 'no' || String(v || '').toLowerCase() === 'off');
}
function getDisplayName(name, brand, sessionType) {
  const useBrand = ['市集場次', '通路寄賣'].includes(sessionType || '');
  return (useBrand && brand) ? brand : (name || brand || '您');
}
function nowIso() { return new Date().toISOString(); }
function nowTaipeiText() { return new Date().toLocaleString('zh-TW', {timeZone:'Asia/Taipei', hour12:false}); }

// 不可抗力三層對象分類（由後端 DB 狀態決定，前台不自行判斷）
// 第一層：已錄取＋已付款 or 已錄取＋付款待確認 → 可選延期或退費
// 第二層：已錄取未付款 or 待審核 → 只通知，不給選擇
// 第三層：已取消 / 不錄取 / 已退費 / 無有效報名 → 不進入流程
function classifyForceLayer(reg) {
  const rs = String(reg.review_status || '');
  const ps = String(reg.payment_status || '');
  const ts = String(reg.transfer_status || '');
  // 第三層
  if (['已取消'].includes(rs)) return 3;
  if (['不錄取', '未錄取'].includes(rs)) return 3;
  if (['已退費', 'refunded'].includes(ts)) return 3;
  // 第一層
  if (rs === '已錄取' && (isPaidStatus(ps) || ps === '待確認')) return 1;
  // 第二層
  if (rs === '已錄取' || rs === '待審核') return 2;
  return 3;
}
function cleanEventId(v) {
  const s = String(v ?? '').trim();
  if (!s || s === '0' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null;
  return s;
}

// ── SECTION 3: MD5（Token 驗證）────────────────────────────────
function md5(inputStr) {
  function safeAdd(x, y) {
    const lsw = (x & 0xFFFF) + (y & 0xFFFF);
    return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xFFFF);
  }
  const rol = (n, c) => (n << c) | (n >>> (32 - c));
  const F = (a,b,c,d,x,s,t) => safeAdd(rol(safeAdd(safeAdd(a,(b&c)|(~b&d)),safeAdd(x,t)),s),b);
  const G = (a,b,c,d,x,s,t) => safeAdd(rol(safeAdd(safeAdd(a,(b&d)|(c&~d)),safeAdd(x,t)),s),b);
  const H = (a,b,c,d,x,s,t) => safeAdd(rol(safeAdd(safeAdd(a,b^c^d),safeAdd(x,t)),s),b);
  const I = (a,b,c,d,x,s,t) => safeAdd(rol(safeAdd(safeAdd(a,c^(b|~d)),safeAdd(x,t)),s),b);
  const bytes = new TextEncoder().encode(inputStr);
  const len = bytes.length;
  const nWords = ((len + 72) >> 6) << 4;
  const w = new Int32Array(nWords);
  for (let j = 0; j < len; j++) w[j >> 2] |= bytes[j] << ((j & 3) << 3);
  w[len >> 2] |= 0x80 << ((len & 3) << 3);
  w[nWords - 2] = len * 8;
  let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  for (let j = 0; j < nWords; j += 16) {
    const [A,B,C,D] = [a,b,c,d];
    a=F(a,b,c,d,w[j+0],7,-680876936);   d=F(d,a,b,c,w[j+1],12,-389564586);
    c=F(c,d,a,b,w[j+2],17,606105819);   b=F(b,c,d,a,w[j+3],22,-1044525330);
    a=F(a,b,c,d,w[j+4],7,-176418897);   d=F(d,a,b,c,w[j+5],12,1200080426);
    c=F(c,d,a,b,w[j+6],17,-1473231341); b=F(b,c,d,a,w[j+7],22,-45705983);
    a=F(a,b,c,d,w[j+8],7,1770035416);   d=F(d,a,b,c,w[j+9],12,-1958414417);
    c=F(c,d,a,b,w[j+10],17,-42063);     b=F(b,c,d,a,w[j+11],22,-1990404162);
    a=F(a,b,c,d,w[j+12],7,1804603682);  d=F(d,a,b,c,w[j+13],12,-40341101);
    c=F(c,d,a,b,w[j+14],17,-1502002290);b=F(b,c,d,a,w[j+15],22,1236535329);
    a=G(a,b,c,d,w[j+1],5,-165796510);   d=G(d,a,b,c,w[j+6],9,-1069501632);
    c=G(c,d,a,b,w[j+11],14,643717713);  b=G(b,c,d,a,w[j+0],20,-373897302);
    a=G(a,b,c,d,w[j+5],5,-701558691);   d=G(d,a,b,c,w[j+10],9,38016083);
    c=G(c,d,a,b,w[j+15],14,-660478335); b=G(b,c,d,a,w[j+4],20,-405537848);
    a=G(a,b,c,d,w[j+9],5,568446438);    d=G(d,a,b,c,w[j+14],9,-1019803690);
    c=G(c,d,a,b,w[j+3],14,-187363961);  b=G(b,c,d,a,w[j+8],20,1163531501);
    a=G(a,b,c,d,w[j+13],5,-1444681467); d=G(d,a,b,c,w[j+2],9,-51403784);
    c=G(c,d,a,b,w[j+7],14,1735328473);  b=G(b,c,d,a,w[j+12],20,-1926607734);
    a=H(a,b,c,d,w[j+5],4,-378558);      d=H(d,a,b,c,w[j+8],11,-2022574463);
    c=H(c,d,a,b,w[j+11],16,1839030562); b=H(b,c,d,a,w[j+14],23,-35309556);
    a=H(a,b,c,d,w[j+1],4,-1530992060);  d=H(d,a,b,c,w[j+4],11,1272893353);
    c=H(c,d,a,b,w[j+7],16,-155497632);  b=H(b,c,d,a,w[j+10],23,-1094730640);
    a=H(a,b,c,d,w[j+13],4,681279174);   d=H(d,a,b,c,w[j+0],11,-358537222);
    c=H(c,d,a,b,w[j+3],16,-722521979);  b=H(b,c,d,a,w[j+6],23,76029189);
    a=H(a,b,c,d,w[j+9],4,-640364487);   d=H(d,a,b,c,w[j+12],11,-421815835);
    c=H(c,d,a,b,w[j+15],16,530742520);  b=H(b,c,d,a,w[j+2],23,-995338651);
    a=I(a,b,c,d,w[j+0],6,-198630844);   d=I(d,a,b,c,w[j+7],10,1126891415);
    c=I(c,d,a,b,w[j+14],15,-1416354905);b=I(b,c,d,a,w[j+5],21,-57434055);
    a=I(a,b,c,d,w[j+12],6,1700485571);  d=I(d,a,b,c,w[j+3],10,-1894986606);
    c=I(c,d,a,b,w[j+10],15,-1051523);   b=I(b,c,d,a,w[j+1],21,-2054922799);
    a=I(a,b,c,d,w[j+8],6,1873313359);   d=I(d,a,b,c,w[j+15],10,-30611744);
    c=I(c,d,a,b,w[j+6],15,-1560198380); b=I(b,c,d,a,w[j+13],21,1309151649);
    a=I(a,b,c,d,w[j+4],6,-145523070);   d=I(d,a,b,c,w[j+11],10,-1120210379);
    c=I(c,d,a,b,w[j+2],15,718787259);   b=I(b,c,d,a,w[j+9],21,-343485551);
    a=safeAdd(a,A); b=safeAdd(b,B); c=safeAdd(c,C); d=safeAdd(d,D);
  }
  const w2h = n => [(n)&0xFF,(n>>8)&0xFF,(n>>16)&0xFF,(n>>24)&0xFF]
    .map(x => ('0'+x.toString(16)).slice(-2)).join('');
  return w2h(a)+w2h(b)+w2h(c)+w2h(d);
}

// ── SECTION 4: 加密工具（ECPay / LINE Pay）──────────────────────
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
}
async function hmacSha256Base64(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ── SECTION 5: CORS / Response ──────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  };
}
function publicErrorMessage(msg){
  const text=String(msg||'系統暫時無法完成操作').trim();
  const technical=/(?:\bDB\s+(?:GET|INSERT|UPSERT|UPDATE|DELETE|RPC)\b|\bPGRST\w*\b|\bSQLSTATE\b|\/rest\/v\d+\/|supabase(?:\.co)?|service[_ -]?role|authorization:\s*bearer|(?:tenant|registration|session|payment)_id\b|(?:registrations|registration_items|sessions|staff|tenants|refund_transactions)\.[a-z_/]+|(?:relation|column)\s+["']?[^\s"']+["']?\s+does not exist)/i.test(text);
  if(technical) return '系統暫時無法完成操作，請稍後再試；若持續發生請聯繫管理者。';
  return text;
}
const jsonOk  = data => new Response(JSON.stringify(data), {status:200, headers:corsHeaders()});
const jsonErr = msg  => new Response(JSON.stringify({error:publicErrorMessage(msg)}), {status:200, headers:corsHeaders()});

// ── SECTION 6: Supabase 查詢工具 ────────────────────────────────
function supabaseServiceRoleKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
}
function sbHdr(env) {
  const key = supabaseServiceRoleKey(env);
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}
async function dbGetOnce(env, table, qs) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${qs?'?'+qs:''}`, {headers:sbHdr(env), cache:'no-store'});
  if (!res.ok) throw new Error(`DB GET ${table}: ${await res.text()}`);
  return res.json();
}
// 大量資料防截斷：Supabase 單次上限 1000 筆。呼叫端未自訂 limit 時，
// 一旦命中 1000 筆代表可能被截斷，改用穩定排序(order=id.asc，或沿用既有 order)
// 以 offset 逐頁抓齊全部，避免統計/加總/匯出算錯。有自訂 limit 者照舊單次抓。
async function dbGet(env, table, qs) {
  const PAGE = 1000;
  const q = qs || '';
  const first = await dbGetOnce(env, table, q);
  if (!Array.isArray(first) || first.length < PAGE || /(^|&)limit=/.test(q)) return first;
  const hasOrder = /(^|&)order=/.test(q);
  const baseQs = hasOrder ? q : (q ? q + '&order=id.asc' : 'order=id.asc');
  let all = []; let offset = 0;
  while (true) {
    const pageQs = `${baseQs}&limit=${PAGE}&offset=${offset}`;
    let page;
    try {
      page = await dbGetOnce(env, table, pageQs);
    } catch (e) {
      // 極少數無 id 欄位的表，加 order=id 會失敗 → 退回不加排序的 offset 翻頁
      if (!hasOrder) { page = await dbGetOnce(env, table, `${q?q+'&':''}limit=${PAGE}&offset=${offset}`); }
      else throw e;
    }
    if (!Array.isArray(page)) break;
    all = all.concat(page);
    if (page.length < PAGE) break;
    offset += PAGE;
    if (offset > 500000) { logError(env,{source:'dbGet',message:'pagination safety cap hit',error:`${table} ${q}`}); break; }
  }
  return all;
}
async function dbInsert(env, table, data) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method:'POST', body:JSON.stringify(data),
    headers:{...sbHdr(env),'Prefer':'return=representation'}, cache:'no-store',
  });
  if (!res.ok) throw new Error(`DB INSERT ${table}: ${await res.text()}`);
  const r = await res.json();
  return Array.isArray(r) ? r[0] : r;
}
async function dbUpsert(env, table, data, onConflict) {
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method:'POST', body:JSON.stringify(data),
    headers:{...sbHdr(env),'Prefer':'resolution=merge-duplicates,return=representation'}, cache:'no-store',
  });
  if (!res.ok) throw new Error(`DB UPSERT ${table}: ${await res.text()}`);
  const r = await res.json().catch(()=>[]);
  return Array.isArray(r) ? r[0] : r;
}
async function dbUpdate(env, table, qs, data) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method:'PATCH', body:JSON.stringify(data), headers:sbHdr(env), cache:'no-store',
  });
  if (!res.ok) throw new Error(`DB UPDATE ${table}: ${await res.text()}`);
  return true;
}
async function dbUpdateReturning(env, table, qs, data) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method:'PATCH', body:JSON.stringify(data),
    headers:{...sbHdr(env),'Prefer':'return=representation'}, cache:'no-store',
  });
  if (!res.ok) throw new Error(`DB UPDATE ${table}: ${await res.text()}`);
  const r = await res.json().catch(()=>[]);
  return Array.isArray(r) ? r : [];
}
async function dbDelete(env, table, qs) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method:'DELETE', headers:sbHdr(env), cache:'no-store',
  });
  if (!res.ok) throw new Error(`DB DELETE ${table}: ${await res.text()}`);
  return true;
}

// M-01：RPC 呼叫（用於原子名額操作）
async function dbRpc(env, fnName, params) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method:'POST',
    body: JSON.stringify(params),
    headers: {...sbHdr(env), 'Content-Type':'application/json'},
    cache: 'no-store',
  });
  if (!res.ok) {
    const errText = await res.text().catch(()=>'');
    throw new Error(`DB RPC ${fnName}: ${errText}`);
  }
  return res.json();
}

// ── SECTION 6.4: 系統異常紀錄 ───────────────────────────────────
// 全部錯誤都寫進 error_logs，後台「系統異常」頁看得到。
// 三個鐵則：
//   1. 記錄失敗絕不可以反過來害到主流程 —— 所以整段包 try/catch，永不 throw。
//   2. 不記密碼、token、金鑰 —— 出事的紀錄不能變成新的外洩來源。
//   3. 記下「哪一筆、哪個功能、什麼錯誤」，光寫「異常」等於沒寫。
const LOG_REDACT_KEYS = ['token','password','pwd','secret','key','apikey','api_key','authorization','passcode','session_token'];
function redactForLog(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (LOG_REDACT_KEYS.some(bad => String(k).toLowerCase().includes(bad))) continue;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') { out[k] = '[object]'; continue; }
    out[k] = String(v).slice(0, 300);
  }
  return out;
}
async function logError(env, opts) {
  try {
    const o = opts || {};
    const err = o.error;
    const msg = err ? (err.message || String(err)) : String(o.message || '');
    await dbInsert(env, 'error_logs', {
      tenant_id:  String(o.tenantId || ''),
      level:      o.level || 'error',
      source:     String(o.source || ''),
      action:     String(o.action || ''),
      reg_id:     String(o.regId || ''),
      session_id: String(o.sessionId || ''),
      email:      String(o.email || ''),
      message:    msg.slice(0, 2000),
      detail:     redactForLog(o.detail),
      created_at: nowIso(),
    });
  } catch (e) {
    // 寫紀錄本身失敗就只能吞掉 —— 但至少留在 console，不能讓它拖垮使用者的請求。
    console.error('logError failed:', e && e.message ? e.message : e);
  }
}

// 後台：讀系統異常紀錄
async function hGetErrorLogs(env, p) {
  const TENANT = p._tenantId;
  if (!await verifyStaff(env, p.email, p.token, TENANT, 'superadmin')) return jsonErr('無權限');
  const limit = Math.min(Math.max(parseInt(p.limit, 10) || 100, 1), 500);
  let q = `order=created_at.desc&limit=${limit}&select=*`;
  // 平台層級的錯誤可能還沒解析出 tenant（tenant_id 為空），超管要看得到，所以一併撈。
  q += `&or=(tenant_id.eq.${TENANT},tenant_id.eq.)`;
  if (p.level) q += `&level=eq.${encodeURIComponent(p.level)}`;
  if (p.regId) q += `&reg_id=eq.${encodeURIComponent(p.regId)}`;
  const rows = await dbGet(env, 'error_logs', q).catch(()=>[]);
  return jsonOk(rows.map(r => ({
    id: r.id, level: r.level || 'error', source: r.source || '', action: r.action || '',
    regId: r.reg_id || '', sessionId: r.session_id || '', email: r.email || '',
    message: r.message || '', detail: r.detail || {}, createdAt: r.created_at || '',
  })));
}
// 後台：清除舊的異常紀錄（全部都記 → 量會很大，要能清）
async function hPurgeErrorLogs(env, b) {
  const TENANT = b._tenantId;
  if (!await verifyStaff(env, b.email, b.token, TENANT, 'superadmin')) return jsonErr('無權限');
  const days = Math.min(Math.max(parseInt(b.days, 10) || 30, 1), 365);
  const res = await dbRpc(env, 'purge_error_logs', {p_days: days});
  return jsonOk(res || {ok:true});
}

// ── SECTION 6.5: 短網址 ─────────────────────────────────────────
// 攤友端分享用。/s/<code> 由 Cloudflare Route「2b-love.com/s/*」導進本 Worker。
// 去掉容易看錯的 l / o / 0 / 1，避免攤友手抄短碼時輸錯。
const SHORT_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SHORT_CODE_LEN = 6;
function genShortCode() {
  const arr = new Uint32Array(SHORT_CODE_LEN);
  crypto.getRandomValues(arr);
  let s = '';
  for (let i=0; i<SHORT_CODE_LEN; i++) s += SHORT_CODE_ALPHABET[arr[i] % SHORT_CODE_ALPHABET.length];
  return s;
}
// 短網址一律掛在租戶站台根目錄底下（例如 https://2b-love.com/s/a7k2mn）
function shortLinkUrl(siteUrl, code) {
  return new URL('/s/' + code, siteUrl || FALLBACK_SITE_URL).toString();
}
// 轉址目標＝場次報名頁。格式與前台 shareUrl() 一致，改一邊要記得改另一邊。
function sessionShareUrl(siteUrl, sessionId) {
  const u = new URL(siteUrl || FALLBACK_SITE_URL);
  u.pathname = '/';
  u.search = 'page=session&ses=' + encodeURIComponent(sessionId);
  return u.toString();
}
function shortLinkErrorPage(msg, status) {
  const html = '<!doctype html><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>連結無效</title>'
    + '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#F8F6F0;'
    + 'font-family:-apple-system,BlinkMacSystemFont,\'Noto Sans TC\',sans-serif;color:#111111">'
    + '<div style="text-align:center;padding:24px;line-height:1.8">'
    + '<div style="font-size:20px;font-weight:900;margin-bottom:12px">' + msg + '</div>'
    + '<a href="' + FALLBACK_SITE_URL + '" style="font-weight:900;color:#666666">回報名首頁</a>'
    + '</div></body>';
  return new Response(html, {status: status, headers: {'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}});
}
async function hShortRedirect(env, code) {
  let rows;
  try {
    rows = await dbRpc(env, 'short_link_hit', {p_code: code});
  } catch(e) {
    // 不吞錯誤：資料庫掛掉就明講，不要假裝連結壞掉。
    console.error('short_link_hit failed:', e && e.message); logError(env, {source:'hShortRedirect', message:'short_link_hit failed:', error:e && e.message});
    return shortLinkErrorPage('短網址服務暫時異常，請稍後再試。', 500);
  }
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || !row.session_id) return shortLinkErrorPage('這個短網址不存在或已失效。', 404);
  const ctx = await getTenantCtx(env, row.tenant_id).catch(()=>null);
  return Response.redirect(sessionShareUrl(ctx && ctx.siteUrl, row.session_id), 302);
}
// 取得或建立場次短網址。後台與前台共用同一份（一個場次永遠只有一組短網址）。
async function ensureShortLinkForSession(env, TENANT, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return {error:'缺少場次'};
  const ses = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sid)}&select=id`);
  if (!ses.length) return {error:'找不到這個場次'};
  const ctx = await getTenantCtx(env, TENANT);

  const exist = await dbGet(env, 'short_links', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sid)}&select=code,clicks`);
  if (exist.length) {
    return {sessionId:sid, code:exist[0].code, clicks:Number(exist[0].clicks)||0,
            url:shortLinkUrl(ctx && ctx.siteUrl, exist[0].code), created:false};
  }
  let row = null, lastErr = '';
  for (let i=0; i<6 && !row; i++) {
    const code = genShortCode();
    try {
      row = await dbInsert(env, 'short_links', {tenant_id:TENANT, session_id:sid, code});
    } catch(e) {
      lastErr = (e && e.message) ? e.message : String(e);
      if (!/duplicate|unique|23505/i.test(lastErr)) throw e;
      const again = await dbGet(env, 'short_links', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sid)}&select=code,clicks`);
      if (again.length) {
        return {sessionId:sid, code:again[0].code, clicks:Number(again[0].clicks)||0,
                url:shortLinkUrl(ctx && ctx.siteUrl, again[0].code), created:false};
      }
    }
  }
  if (!row) return {error:'短碼產生失敗，請再試一次：' + lastErr};
  return {sessionId:sid, code:row.code, clicks:0,
          url:shortLinkUrl(ctx && ctx.siteUrl, row.code), created:true};
}

// 後台：為場次產生短網址（含點擊數）
async function hCreateShortLink(env, b) {
  const TENANT = b._tenantId;
  if (!await verifyStaff(env, b.email, b.token, TENANT, 'sessions')) return jsonErr('無權限');
  const r = await ensureShortLinkForSession(env, TENANT, b.sessionId);
  return r.error ? jsonErr(r.error) : jsonOk(r);
}

// 前台（公開）：攤友分享場次用。只能「取得某場次的短網址」，不回傳點擊數。
async function hGetSessionShortLink(env, p) {
  const TENANT = p._tenantId;
  const r = await ensureShortLinkForSession(env, TENANT, p.sessionId);
  if (r.error) return jsonErr(r.error);
  return jsonOk({sessionId:r.sessionId, code:r.code, url:r.url});
}

// ── SECTION 7: 管理員驗證 ───────────────────────────────────────
// AI 高成本功能專用：只允許真正的平台超級管理員，不能用 organizer_owner 或一般 superadmin 權限代替。
async function verifyPlatformSuperAdmin(env, email, token, tenantId) {
  const auth = await loadFreshAdminAuthorization(env, email, token, tenantId);
  return !!(auth && auth.role === 'platform_super_admin' && auth.capabilities.canPlatform);
}

function _staffActive(row) {
  return !!row && (row.is_active !== undefined ? row.is_active !== false : row.active !== false);
}

// 平台總管的正式名單目前可能位於 platform_staff，亦可能沿用 staff 的
// platform_super_admin 紀錄。兩個來源都由同一個函式讀取，避免改權限模組時
// 只認其中一張表，造成既有總管全部被擋在登入頁。
async function loadActivePlatformAdminRecord(env, email) {
  const who = String(email || '').trim().toLowerCase();
  if (!who) return null;

  const platformRows = await dbGet(
    env,
    'platform_staff',
    `email=eq.${encodeURIComponent(who)}&is_active=eq.true&select=id,email,name,is_active,last_login_at`,
  ).catch(()=>[]);
  const directRecord = selectActivePlatformAdminRecord(platformRows, []);
  if (directRecord) return directRecord;

  const staffRows = await dbGet(
    env,
    'staff',
    `email=eq.${encodeURIComponent(who)}&select=*`,
  ).catch(()=>[]);
  return selectActivePlatformAdminRecord([], staffRows);
}

// 每次管理操作都以資料庫最新 staff 設定為準，不再相信登入時寫進 JWT 的舊角色或舊範圍。
async function loadFreshAdminAuthorization(env, email, token, tenantId) {
  const tid = String(tenantId || '').trim();
  const who = String(email || '').trim().toLowerCase();
  if (!tid || !who || !token) return null;
  let payload = await verifyAdminToken(token, who, tid, env);
  // 舊 platform_staff 簽出的 token 可能沒有 role 欄位，但 tenant_id 固定為 platform。
  if (!payload && tid !== 'platform') payload = await verifyAdminToken(token, who, 'platform', env);
  if (!payload) return null;

  const tokenRole = String(payload.normalized_role || payload.role || '').trim();
  const platformToken = tokenRole === 'platform_super_admin' || String(payload.tenant_id || '') === 'platform';
  if (platformToken) {
    const row = await loadActivePlatformAdminRecord(env, who);
    if (!row) return null;
    return {
      email: who, tenantId: tid, role: 'platform_super_admin', scopeType: 'platform',
      scopeEventId: '', allowedSessionIds: null, capabilities: capabilitiesForRole('platform_super_admin'),
      staffId: row.id || payload.staff_id || '', displayName: row.name || payload.display_name || who,
    };
  }

  if (!payload.legacy && String(payload.tenant_id || '') !== tid) return null;
  const rows = await dbGet(env, 'staff', `tenant_id=eq.${tid}&email=eq.${encodeURIComponent(who)}&select=*`).catch(()=>[]);
  const row = rows[0];
  if (!_staffActive(row)) return null;
  const role = String(row.normalized_role || row.role || '').trim();
  const scopeType = String(row.scope_type || '').trim().toLowerCase() || (role === 'organizer_owner' ? 'all' : 'session');
  const scopeEventId = String(row.scope_event_id || '').trim();
  let allowedSessionIds = null;

  if (role === 'organizer_admin') {
    if (scopeType !== 'event' || !scopeEventId) return null;
    const eventRows = await dbGet(env, 'events', `tenant_id=eq.${tid}&id=eq.${encodeURIComponent(scopeEventId)}&select=id`).catch(()=>[]);
    if (!eventRows.length) return null;
    const sessions = await dbGet(env, 'sessions', `tenant_id=eq.${tid}&event_id=eq.${encodeURIComponent(scopeEventId)}&select=id`).catch(()=>[]);
    allowedSessionIds = sessions.map(s => String(s.id));
  } else if (scopeType === 'event' && scopeEventId) {
    const sessions = await dbGet(env, 'sessions', `tenant_id=eq.${tid}&event_id=eq.${encodeURIComponent(scopeEventId)}&select=id`).catch(()=>[]);
    allowedSessionIds = sessions.map(s => String(s.id));
  } else if (scopeType === 'session' || ['session_admin','finance_admin','onsite_staff'].includes(role)) {
    const permRows = await dbGet(env, 'staff_session_permissions', `tenant_id=eq.${tid}&staff_email=eq.${encodeURIComponent(who)}&is_active=eq.true&select=session_id`).catch(()=>null);
    if (Array.isArray(permRows)) allowedSessionIds = permRows.map(x => String(x.session_id)).filter(Boolean);
    else allowedSessionIds = String(row.limit_sessions || '').split(',').map(x=>x.trim()).filter(Boolean);
  }

  return {
    email: who, tenantId: tid, role, scopeType, scopeEventId, allowedSessionIds,
    capabilities: capabilitiesForRole(role), staffId: row.id || payload.staff_id || '',
    displayName: row.display_name || row.name || payload.display_name || who,
  };
}

function _authAllowsSession(auth, sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  return auth && auth.allowedSessionIds === null ? true : !!(auth && auth.allowedSessionIds.includes(sid));
}

function _scopeRows(input, rows, sessionKey='session_id') {
  const auth = input && input._authz;
  if (!auth || auth.allowedSessionIds === null) return rows || [];
  const allowed = new Set(auth.allowedSessionIds || []);
  return (rows || []).filter(row => allowed.has(String(row && row[sessionKey] || '')));
}

function _scopeSessionRows(input, rows) { return _scopeRows(input, rows, 'id'); }
function _scopeEventRows(input, rows) {
  const auth = input && input._authz;
  if (!auth || auth.allowedSessionIds === null) return rows || [];
  return (rows || []).filter(row => String(row && row.id || '') === String(auth.scopeEventId || ''));
}

function _scopePhotoFrames(input, rows) {
  const auth = input && input._authz;
  if (!auth || auth.allowedSessionIds === null) return rows || [];
  return (rows || []).filter(frame => {
    const type = String(frame.scope_type || '');
    if (type === 'event') return String(frame.scope_event_id || '') === String(auth.scopeEventId || '');
    if (type === 'session') return _authAllowsSession(auth, frame.scope_session_id);
    return false;
  });
}

async function verifyStaff(env, email, token, tenantId, requiredRole='', sessionId='') {
  const auth = await loadFreshAdminAuthorization(env, email, token, tenantId);
  if (!auth) return false;
  if (sessionId && !_authAllowsSession(auth, sessionId)) return false;
  if (!requiredRole) return true;
  const c = auth.capabilities || {};
  if (requiredRole === 'superadmin') return !!c.canManageTenantSettings;
  if (requiredRole === 'finance') return !!c.canManageFinance;
  if (requiredRole === 'checkin') return !!c.canManageOnsite;
  if (requiredRole === 'review') return !!c.canManageRegistrations;
  if (requiredRole === 'sessions' || requiredRole === 'events') return !!c.canManageSessions;
  if (requiredRole === 'announce') return !!c.canManageCommunications;
  if (requiredRole === 'members') return !!c.canManageMembers;
  return false;
}

function _adminActionNeedsCentralGuard(action) {
  return isSeriesManagerAction(action) || TENANT_OWNER_ACTIONS.has(action) ||
    PLATFORM_ADMIN_ACTIONS.has(action) || isDestructiveAdminAction(action);
}

function _inputIds(value) {
  if (Array.isArray(value)) return value.map(String).map(x=>x.trim()).filter(Boolean);
  return String(value || '').split(',').map(x=>x.trim()).filter(Boolean);
}

async function _registrationScopeRows(env, tenantId, ids) {
  const out = [];
  for (const id of [...new Set(ids)]) {
    const rows = await dbGet(env, 'registrations', `tenant_id=eq.${tenantId}&id=eq.${encodeURIComponent(id)}&select=id,session_id,event_id,payment_group_id,bundle_group_id,email`).catch(()=>[]);
    if (!rows.length) return null;
    const row = rows[0];
    out.push(row);
    const groupId = String(row.payment_group_id || row.bundle_group_id || '').trim();
    if (groupId) {
      const column = row.payment_group_id ? 'payment_group_id' : 'bundle_group_id';
      const grouped = await dbGet(env, 'registrations', `tenant_id=eq.${tenantId}&${column}=eq.${encodeURIComponent(groupId)}&select=id,session_id,event_id,email`).catch(()=>[]);
      out.push(...grouped);
    }
  }
  return out;
}

async function _assertSeriesManagerScope(env, action, input, auth) {
  const tenantId = auth.tenantId;
  const eventId = String(input.eventId || input.event_id || (action === 'updateEvent' ? input.id : '') || '').trim();
  if (eventId && eventId !== auth.scopeEventId) return '此帳號只能管理被指定的活動系列';

  const sessionIds = [
    ..._inputIds(input.sessionId || input.session_id || input.sid),
    ..._inputIds(input.sessionIds || input.session_ids),
  ];
  if (SESSION_TARGET_ACTIONS.has(action) && !sessionIds.length) {
    const idAsSession = ['updateSession','toggleSession','copySession'].includes(action) ? String(input.id || '').trim() : '';
    if (idAsSession) sessionIds.push(idAsSession);
  }
  if (action === 'forceCancelSession') {
    sessionIds.push(..._inputIds(input.transferTargetSessionId || input.transfer_target_session_id));
  }
  if (sessionIds.some(id => !_authAllowsSession(auth, id))) return '此帳號只能管理被指定系列的場次';

  const regIds = [
    ..._inputIds(input.regId || input.registrationId || input.registration_id),
    ..._inputIds(input.regIds || input.registrationIds),
  ];
  if (REGISTRATION_TARGET_ACTIONS.has(action) || action === 'batchUpdateStatus') {
    if (!regIds.length) return '缺少可驗證的報名資料範圍';
    const rows = await _registrationScopeRows(env, tenantId, regIds);
    if (!rows || rows.some(r => !_authAllowsSession(auth, r.session_id))) return '此帳號不能管理其他系列的報名資料';
  }

  if (['saveMemberNote','getMemberHistory'].includes(action)) {
    const memberEmail = String(input.memberEmail || input.targetEmail || input.emailQuery || '').trim().toLowerCase();
    if (memberEmail) {
      const rows = await dbGet(env, 'registrations', `tenant_id=eq.${tenantId}&email=ilike.${encodeURIComponent(memberEmail)}&select=session_id`).catch(()=>[]);
      if (!rows.some(r => _authAllowsSession(auth, r.session_id))) return '此會員不在被指定系列內';
    }
  }

  if (action === 'sendNotify' && !sessionIds.length && !regIds.length) {
    return '系列管理者發送通知時必須指定場次或報名資料';
  }
  if (action === 'savePhotoFrame') {
    const scopeType = String(input.scopeType || input.scope_type || '').trim();
    const scopeId = String(input.scopeId || input.scope_id ||
      (scopeType === 'event' ? (input.scopeEventId || input.scope_event_id) : (input.scopeSessionId || input.scope_session_id)) || '').trim();
    if (scopeType === 'event' && scopeId !== auth.scopeEventId) return '相框只能套用在被指定系列';
    if (scopeType === 'session' && !_authAllowsSession(auth, scopeId)) return '相框只能套用在被指定系列的場次';
    if (!['event','session'].includes(scopeType)) return '系列管理者的相框必須指定活動或場次';
  }
  if (action === 'onsitePasscodeToggle') {
    const rows = await dbGet(env, 'onsite_passcodes', `tenant_id=eq.${tenantId}&id=eq.${encodeURIComponent(String(input.id||''))}&select=session_id`).catch(()=>[]);
    if (!rows.length || !_authAllowsSession(auth, rows[0].session_id)) return '此通行碼不屬於被指定系列';
  }
  return '';
}

async function authorizeAdminAction(env, action, input) {
  if (input && input.passcode && ['onsiteRegs','onsiteDaySummary','onsiteMark'].includes(action)) return null;
  if (!_adminActionNeedsCentralGuard(action)) return null;
  const auth = await loadFreshAdminAuthorization(env, input.email, input.token, input._tenantId);
  if (!auth) return { error: '登入權限已失效，請重新登入' };
  input._authz = auth;

  if (PLATFORM_ADMIN_ACTIONS.has(action) && !auth.capabilities.canPlatform) {
    return { error: '此功能僅限平台總管' };
  }
  if (TENANT_OWNER_ACTIONS.has(action) && !auth.capabilities.canManageTenantSettings) {
    return { error: '此功能屬於租戶設定，不在指定系列管理權限內' };
  }
  if (isDestructiveAdminAction(action) && !auth.capabilities.canDelete) {
    return { error: '管理者不可刪除資料，請使用停用、封存或取消' };
  }
  if (auth.role === 'organizer_admin') {
    if (!isSeriesManagerAction(action)) return { error: '此功能不在指定系列管理權限內' };
    const scopeError = await _assertSeriesManagerScope(env, action, input, auth);
    if (scopeError) return { error: scopeError };
  }
  return { auth };
}

// ── SECTION 8: Session 格式化 / 費用計算 ────────────────────────
function calcLimit(s) {
  const dates = safeJson(s.dates_json, []);
  if (!dates.length) return safeNum(s.limit_count);
  const hasLimit = dates.some(d => Number(d.limit) > 0);
  if (!hasLimit) return 0;
  return dates.reduce((sum, d) => sum + (Number(d.limit) || 0), 0);
}
function formatSession(s) {
  const availability = registrationAvailability(s);
  const parsedSchedule = parseRegistrationSchedule(s.registration_schedule_json);
  const registrationSchedule = {...parsedSchedule,windows:parsedSchedule.windows.map(w=>({stage:w.stage,openAt:w.openAt,closeAt:w.closeAt}))};
  return {
    id: s.id, eventId: s.event_id,
    name: s.name, type: s.type, region: s.region || '',
    dates: safeJson(s.dates_json, []),
    venue: s.venue, fee: safeNum(s.fee), deposit: safeNum(s.deposit),
    limit: calcLimit(s), maxStalls: safeNum(s.max_stalls),
    count: safeNum(s.current_count), status: s.status,
    registrationSchedule,
    registrationOpen: availability.open,
    registrationState: availability.state,
    registrationMessage: availability.message,
    registrationNextOpenAt: availability.nextOpenAt,
    registrationNextCloseAt: availability.nextCloseAt,
    needReview: s.need_review === true || s.need_review === 'true',
    modules: safeJson(s.modules_json, {}),
    equip: safeJson(s.equip_json, {}),
    customFields: safeJson(s.custom_fields_json, []),
    addons: safeJson(s.addons_json, []),
    invoiceTax: safeJson(s.invoice_tax_json, {stall:true,equip:false,extra:false}),
    refundRules: safeJson(s.refund_rules_json, null),
    basicEquip: s.basic_equip || '',
    theme: s.theme || '', organizer: s.organizer || '', coorg: s.co_organizer || '',
    portals: s.portals ? String(s.portals).split(',').map(x=>x.trim()).filter(Boolean) : [],
    cover: s.cover_url || '', desc: s.description || '',
    mainVisualAssetId: s.main_visual_asset_id || '',
    aiVisualPreset: s.ai_visual_preset || '',
    seatPricingEnabled: s.seat_pricing_enabled === true || s.seat_pricing_enabled === 'true',
    seatHoldHours: safeNum(s.seat_hold_hours) || SEAT_HOLD_HOURS,
    seatMapUrl: s.seat_map_url || '',
    seatBoard: safeJson(s.seat_board_json,{}),
    assignedStaff: s.assigned_staff ? String(s.assigned_staff).split(',').filter(Boolean) : [],
    forceCancel: s.force_cancel || false,
    forceCancelTargetId: s.force_cancel_target_id || '',
    forceCancelDeadline: s.force_cancel_deadline || '',
    // 不可抗力模組欄位
    forceCancelled: s.force_cancel || false,
    forceCancelReasonCode: s.force_cancel_reason_code || '',
    forceCancelReasonLabel: s.force_cancel_reason_label || '',
    forceCancelNote: s.force_cancel_note || '',
    forceCancelledAt: s.force_cancel_deadline || '',
    forceMode: s.force_cancel ? 'cancel' : '',
    forceTransferTargetSessionId: s.force_cancel_target_id || '',
    forceChoiceDeadline: s.force_cancel_deadline || '',
    forceNoticeSentAt: s.force_notice_sent_at || '',
    createdAt: s.created_at,
    paymentProfileId: s.payment_profile_id || '', payment_profile_id: s.payment_profile_id || '',
    // ── 合約同意設定 ──────────────────────────────────
    agreementRequired:  agreementRequiredOn(s.agreement_required),
    agreementTitle:     s.agreement_title   || '',
    agreementContent:   s.agreement_content || '',
    agreementVersion:   s.agreement_version || '',
    agreementUpdatedAt: s.agreement_updated_at || '',
  };
}

function buildOnsiteSeatBoard(session,stalls,regs,daySeats){
  const board=safeJson(session&&session.seat_board_json,{})||{},regById={};
  (regs||[]).forEach(r=>regById[String(r.id)]=r);
  const dates=(safeJson(session&&session.dates_json,[])||[]).map(x=>String((x&&x.date)||x||'').slice(0,10)).filter(Boolean);
  const today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10),activityDate=dates.includes(today)?today:(dates[0]||today);
  const assigned={};(daySeats||[]).filter(x=>String(x.activity_date).slice(0,10)===activityDate).forEach(x=>assigned[String(x.seat_code)]=String(x.registration_id||''));
  const markers=(stalls||[]).filter(s=>(Number(s.map_x)>0||Number(s.map_y)>0)&&s.is_active!==false&&s.is_active!=='false').map(s=>{
    const code=seatCodeOf(s),rid=assigned[code]||String(seatRegId(s)||''),r=regById[rid]||{};
    return {code,x:safeNum(s.map_x),y:safeNum(s.map_y),direction:safeNum((board.mapDirections||{})[code]),brand:r.brand_name||r.name||'',name:r.name||'',equipmentText:r.equipment_json?_equipmentTextFromMap(safeJson(r.equipment_json,{})):'',occupied:!!rid};
  });
  for(const m of (Array.isArray(board.customMarkers)?board.customMarkers:[]))markers.push({code:String(m.label||'自訂位置'),specialLabel:String(m.label||'自訂位置'),x:safeNum(m.x),y:safeNum(m.y),direction:safeNum(m.direction),markerType:m.markerType||'service'});
  return {...board,mode:'map',activityDate,markers};
}
function calcFee(ses, selectedDates, stallCount) {
  const dates = safeJson(ses.dates_json, []);
  const baseFee = safeNum(ses.fee);
  const stalls = Math.max(parseInt(stallCount)||1, 1); // 無上限，由後台 maxStalls 控制
  if (dates.length > 1 && selectedDates && selectedDates.length > 0) {
    const allSelected = dates.every(d => selectedDates.includes(d.date));
    if (allSelected && baseFee > 0) return baseFee * stalls;
    return selectedDates.reduce((sum, sd) => {
      const def = dates.find(d => d.date === sd);
      return sum + (def ? (Number(def.fee) || 0) : 0);
    }, 0) * stalls;
  }
  if (dates.length === 1) return (Number(dates[0].fee) || baseFee || 0) * stalls;
  return baseFee * stalls;
}
function effectiveEquipIncl(key, def, basicEquip) {
  // A→Z 阻斷修正：費用計算以後台設備設定 incl 為準。
  // 前台若顯示「本次含 N」，後端也必須把 N 件視為內含，不可再依 basic_equip 文字猜測。
  const raw = Number(def?.incl)||0;
  return raw > 0 ? raw : 0;
}
// B-04 設備正式語意（唯一定義，前後端一致）：
//   equipment_json = 該報名「實際選擇的設備總量」，不是加租量。
//   內含總量 = 每攤內含數 × 攤位數
//   加租數量 = max(0, 已選總量 - 內含總量)
//   設備費   = 加租數量 × 單價
// 原本 incl 沒乘攤位數（stalls 算了卻沒用），導致 4 攤含 1 桌選 4 桌時被多收 3 桌錢。
function calcEquipTotal(equip, equipJsonStr, stallCount, basicEquip='') {
  let total = 0;
  const stalls = Math.max(Number(stallCount) || 1, 1);
  try {
    const def = typeof equipJsonStr === 'string' ? JSON.parse(equipJsonStr||'{}') : (equipJsonStr||{});
    Object.entries(equip||{}).forEach(([k,qty]) => {
      if (def[k]?.open) {
        const inclPerStall = effectiveEquipIncl(k, def[k], basicEquip);
        const inclTotal = inclPerStall * stalls;
        const extra = Math.max(0, (Number(qty)||0) - inclTotal);
        total += (Number(def[k].price)||0) * extra;
      }
    });
  } catch {}
  return total;
}

// ── SECTION 9: Email 工具（Resend API）─────────────────────────
async function sendEmail(env, to, subject, htmlBody, tenantCtx) {
  // 相容舊寫法 sendEmail(env,{to,subject,html})，避免 SaaS 平台通知失效。
  if (to && typeof to === 'object' && !Array.isArray(to)) {
    const payload = to;
    const maybeTenantCtx = subject;
    to = payload.to;
    subject = payload.subject;
    htmlBody = payload.html || payload.body || payload.htmlBody || '';
    tenantCtx = maybeTenantCtx && typeof maybeTenantCtx === 'object' ? maybeTenantCtx : tenantCtx;
  }
  if (!to) return {ok:false, error:'missing recipient'};
  if (!env.RESEND_KEY) {
    console.error('Email skipped: RESEND_KEY missing'); logError(env, {source:'sendEmail', message:'Email skipped: RESEND_KEY missing', error:''});
    return {ok:false, error:'RESEND_KEY missing'};
  }
  const emailFrom    = (tenantCtx && tenantCtx.emailFrom)    || env.MAIL_FROM || FALLBACK_EMAIL_FROM;
  const emailReplyTo = (tenantCtx && tenantCtx.emailReplyTo) || env.MAIL_REPLY_TO || FALLBACK_EMAIL_REPLY;
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), 8000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{'Authorization':`Bearer ${env.RESEND_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:emailFrom, to:Array.isArray(to)?to:[to], subject, html:htmlBody, reply_to:emailReplyTo}),
      signal:ctrl.signal,
    });
    const txt = await res.text().catch(()=>'');
    if (!res.ok) {
      console.error('Email failed:', res.status, txt); logError(env, {source:'sendEmail', message:'Email failed:', error:txt});
      return {ok:false, error:txt || ('HTTP '+res.status)};
    }
    return {ok:true};
  } catch(e) {
    console.error('Email failed:', e && e.message ? e.message : String(e)); logError(env, {source:'sendEmail', message:'Email failed:', error:e && e.message ? e.message : String(e)});
    return {ok:false, error:e && e.name==='AbortError' ? 'timeout' : (e.message||String(e))};
  } finally {
    clearTimeout(timer);
  }
}
// emailWrap：依租戶動態顯示品牌名稱與頁尾
function emailWrap(content, tenantCtx) {
  const name    = (tenantCtx && tenantCtx.name)    || FALLBACK_TENANT_NAME;
  const footer  = (tenantCtx && tenantCtx.footer)  || (name + '　All rights reserved.');
  const color   = (tenantCtx && tenantCtx.color)   || '#2d6a4f';
  return `<div style="font-family:'Noto Sans TC',sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#fafaf8;border-radius:12px">
<div style="text-align:center;margin-bottom:24px"><h2 style="color:${color};font-size:20px;margin:0">${name}</h2></div>
${content}
<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0">
<p style="font-size:12px;color:#aaa;text-align:center">${footer}</p>
</div>`;
}
function memberUrl(regId, tenantCtx) {
  const base = (tenantCtx && tenantCtx.siteUrl) || FALLBACK_SITE_URL;
  const tid = (tenantCtx && tenantCtx.id) || '';  // M-02：id 缺漏時不輸出 'undefined' 字串
  const sep = base.includes('?') ? '&' : '?';
  // 前台以 page=member 判斷要開「我的紀錄」；member=1 一併保留以相容舊連結。
  return base + sep + 'page=member&member=1&tenant=' + encodeURIComponent(tid) + (regId ? '&pay='+encodeURIComponent(regId) : '');
}
function emailBtn(label, href, bg, color, extraStyle='') {
  return `<a href="${href}" style="display:block;background:${bg};color:${color};border-radius:10px;text-decoration:none;font-weight:700;font-size:13px;line-height:1.35;text-align:center;padding:11px 10px;white-space:nowrap;${extraStyle}">${label}</a>`;
}
function defaultEmailTemplates() {
  // SaaS 信件模板：功能保留，是否寄出由 email_templates.is_active 控制。
  // 兔彼樂目前預設關閉「查詢型通知」，其他主辦未來可在後台打開。
  return [
    {
      template_key:'registration_received',
      title:'報名確認信',
      subject:'【[場次名稱]】我們已收到您的報名',
      body:`親愛的 [顯示名稱]，

我們已收到您報名 [場次名稱]。

日期：[報名日期]
攤位數：[攤位數] 攤
設備：[設備]
應繳金額：NT$ [應繳金額]

請回到「我的紀錄」查看審核進度與報名狀態。

[按鈕:前往我的紀錄]`,
      is_active:false,
      group:'報名流程'
    },
    {
      template_key:'approval_notice',
      title:'錄取通知信',
      subject:'【[場次名稱]】錄取通知',
      body:`親愛的 [顯示名稱]，

恭喜您錄取 [場次名稱]。

場次：[場次名稱]
日期：[報名日期]
攤位數：[攤位數] 攤
設備：[設備]
應繳金額：NT$ [應繳金額]

攤位號碼將於活動前公布，屆時請至「我的紀錄」查看；行前通知信也會一併附上您的攤位與場地圖。

請回到報名系統「我的紀錄」登入查看繳費資訊、付款帳戶與最新進度。

[按鈕:前往我的紀錄]`,
      is_active:true,
      group:'審核流程'
    },
    {
      template_key:'rejection_notice',
      title:'未錄取通知信',
      subject:'【[場次名稱]】報名結果通知',
      body:`親愛的 [顯示名稱]，

感謝您報名 [場次名稱]。

很抱歉，本場次未錄取。您仍可回到「我的紀錄」查看報名紀錄，或查看其他開放場次。

[按鈕:前往我的紀錄]`,
      is_active:false,
      group:'審核流程'
    },
    {
      template_key:'payment_reminder',
      title:'繳費期限提醒',
      subject:'【[場次名稱]】繳費期限提醒',
      body:`親愛的 [顯示名稱]，

提醒您，您已錄取 [場次名稱]，目前尚未完成繳費。

日期：[報名日期]
攤位數：[攤位數] 攤
設備：[設備]
應繳金額：NT$ [應繳金額]

請回到「我的紀錄」查看付款帳戶並完成繳費。

[按鈕:前往我的紀錄]`,
      is_active:true,
      group:'付款流程'
    },
    {
      template_key:'payment_report_received',
      title:'繳費回報收到信',
      subject:'【[場次名稱]】繳費回報已收到',
      body:`親愛的 [顯示名稱]，

我們已收到您的繳費回報，付款狀態目前為待確認。

場次：[場次名稱]
付款方式：[付款方式]
回報金額：NT$ [回報金額]
末五碼：[末五碼]

請回到「我的紀錄」查看付款確認進度。

[按鈕:前往我的紀錄]`,
      is_active:false,
      group:'付款流程'
    },
    {
      template_key:'payment_confirmed',
      title:'繳費確認信',
      subject:'【[場次名稱]】繳費確認',
      body:`親愛的 [顯示名稱]，

您的付款已確認完成。

場次：[場次名稱]
繳費金額：NT$ [應繳金額]
設備：[設備]
攤位號碼：[攤位號碼]

您可回到「我的紀錄」查看最新報名狀態。

[按鈕:前往我的紀錄]`,
      is_active:false,
      group:'付款流程'
    },
    {
      template_key:'registration_cancelled',
      title:'取消報名信',
      subject:'【[場次名稱]】報名已取消',
      body:`親愛的 [顯示名稱]，

您報名的 [場次名稱] 已取消。

詳細狀態可回到「我的紀錄」查詢。

[按鈕:前往我的紀錄]`,
      is_active:false,
      group:'取消／退款'
    },
    {
      template_key:'refund_request_received',
      title:'退款申請通知',
      subject:'【[場次名稱]】退款申請已收到',
      body:`親愛的 [顯示名稱]，

我們已收到您 [場次名稱] 的退款申請。

主辦確認後，將依退款規則處理。您可回到「我的紀錄」查看進度。

[按鈕:前往我的紀錄]`,
      is_active:false,
      group:'取消／退款'
    },
    {
      template_key:'refund_done',
      title:'退費完成信',
      subject:'【[場次名稱]】退費已完成',
      body:`親愛的 [顯示名稱]，

您 [場次名稱] 的退費已處理完成。

退費金額：NT$ [退費金額]

款項將依實際金流或帳務處理時間退回。詳細紀錄可回到「我的紀錄」查詢。

[按鈕:前往我的紀錄]`,
      is_active:true,
      group:'取消／退款'
    },
    {
      template_key:'overdue_cancel',
      title:'逾期未繳取消信',
      subject:'【[場次名稱]】報名已因逾期未繳費取消',
      body:`親愛的 [顯示名稱]，

您報名的 [場次名稱] 因逾期未完成繳費，系統已取消本筆報名並釋出名額。

詳細狀態可回到「我的紀錄」查詢。

[按鈕:前往我的紀錄]`,
      is_active:true,
      group:'付款流程'
    },
    {
      template_key:'event_reminder',
      title:'行前提醒',
      subject:'【[場次名稱]】活動行前提醒',
      body:`親愛的 [顯示名稱]，

您報名的 [場次名稱] 即將開始。

日期：[活動日期]
地點：[地點]
您的攤位：[攤位號碼]
設備：[設備]

場地圖：[場地圖網址]

請留意報到、進場與現場規範。詳細資訊可回到「我的紀錄」查看。

[按鈕:前往我的紀錄]
[按鈕:加入官方LINE]`,
      is_active:true,
      group:'活動通知'
    },
    {
      template_key:'force_notice',
      title:'不可抗力通知',
      subject:'【[場次名稱]】不可抗力處理通知',
      body:`親愛的 [顯示名稱]，

您報名的 [場次名稱] 因不可抗力因素啟動處理流程。

原因：[取消原因]
[補充說明]

原場次：[原場次]
延期場次：[新場次]
請於 [選擇期限] 前完成選擇

請回到「我的紀錄」選擇「延期」或「退費」。
逾期未選擇者，系統將自動歸為退費處理。

[按鈕:前往我的紀錄]`,
      is_active:true,
      group:'不可抗力'
    },
    {
      template_key:'force_result_notice',
      title:'不可抗力處理結果通知',
      subject:'【[場次名稱]】不可抗力處理結果通知',
      body:`親愛的 [顯示名稱]，

您的不可抗力處理結果已更新。

原場次：[原場次]
新場次：[新場次]
退費金額：NT$ [退費金額]

請回到「我的紀錄」查看完整狀態。

[按鈕:前往我的紀錄]`,
      is_active:true,
      group:'不可抗力'
    },
    {
      template_key:'staff_invite',
      title:'管理員邀請信',
      subject:'【[主辦名稱]】您已被授權為活動管理員',
      body:`親愛的 [顯示名稱]，

[主辦名稱] 已開通您的後台管理權限。

角色：[管理員角色]
權限：[權限]
管理範圍：[管理範圍]

請從前台進入後台登入。

[按鈕:前往後台登入]`,
      is_active:true,
      group:'系統管理'
    },
    {
      template_key:'custom_notice',
      title:'自訂通知信',
      subject:'【[主辦名稱]】通知',
      body:`親愛的 [顯示名稱]，

[通知內容]

[按鈕:前往我的紀錄]`,
      is_active:false,
      group:'系統管理'
    }
  ];
}
function applyEmailVars(text, vars) {
  let out = String(text || '');
  for (const [k,v] of Object.entries(vars || {})) {
    out = out.split('['+k+']').join(String(v ?? ''));
  }
  return out;
}
function escapeEmailText(s) {
  return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function renderEmailTemplateBody(body, vars, tenantCtx, regId) {
  const prepared = applyEmailVars(body, vars);
  const lines = String(prepared || '').split(/\r?\n/);
  const parts = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^\[按鈕:(.+?)\]$/);
    if (m) {
      const label = m[1].trim();
      let href = '';
      if (label.includes('後台')) href = (tenantCtx && tenantCtx.siteUrl) || FALLBACK_SITE_URL;
      else if (label.includes('繳費') || label.includes('我的紀錄') || label.includes('報名紀錄') || label.includes('會員')) href = memberUrl(regId || null, tenantCtx);
      else if (label.includes('LINE') || label.includes('客服')) href = (tenantCtx && tenantCtx.lineUrl) || '';
      else if (label.includes('活動')) href = (tenantCtx && tenantCtx.siteUrl) || FALLBACK_SITE_URL;
      if (href) parts.push(emailBtn(label, href, label.includes('LINE') ? '#06C755' : '#2d6a4f', '#fff'));
      continue;
    }
    if (!line) { parts.push('<div style="height:8px"></div>'); continue; }
    parts.push('<p style="margin:8px 0;line-height:1.8">'+escapeEmailText(raw)+'</p>');
  }
  return parts.join('\n');
}
function emailDateText(selectedDates) {
  const arr = safeJson(selectedDates, []);
  if (Array.isArray(arr)) {
    return arr.map(d => {
      if (d && typeof d === 'object') return d.date || d.value || d.label || d.name || '';
      return String(d || '');
    }).filter(Boolean).join('、');
  }
  return String(arr || '');
}
function emailMoneyText(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toLocaleString('zh-TW') : '0';
}
async function getEmailTemplateOrDefault(env, tenantId, key) {
  const k = String(key || '').trim();
  const defaults = defaultEmailTemplates();
  const fallback = defaults.find(x => x.template_key === k) || {template_key:k,title:k,subject:'【[主辦名稱]】通知',body:'[通知內容]',is_active:false};
  try {
    const rows = await dbGet(env, 'email_templates', `tenant_id=eq.${tenantId}&template_key=eq.${encodeURIComponent(k)}&select=*`);
    if (rows && rows[0]) {
      const r = rows[0];
      return {
        template_key:k,
        title:r.title || fallback.title,
        subject:r.subject || fallback.subject,
        body:r.body || r.body_html || fallback.body,
        is_active:r.is_active !== false,
        from_db:true,
      };
    }
  } catch(e) {}
  return {...fallback, from_db:false};
}
async function logEmailDelivery(env, tenantId, templateKey, to, result, meta={}) {
  try {
    await writeAuditLog(env, tenantId, meta.actorEmail || '', meta.actorRole || 'system',
      result && result.skipped ? 'email_skipped_disabled' : (result && result.ok ? 'email_sent' : 'email_failed'),
      meta.targetTable || 'registrations', meta.targetId || '', null, null,
      { template_key:templateKey, to:to || '', error:(result && result.error)||'', subject:meta.subject||'', reason:meta.reason||'' });
  } catch(e) {}
}
async function sendTemplateEmail(env, tenantId, templateKey, to, vars, tenantCtx, regId='', meta={}) {
  if (!to) return {ok:false, error:'missing recipient'};
  const tpl = await getEmailTemplateOrDefault(env, tenantId, templateKey);
  const subject = applyEmailVars(tpl.subject || '【[主辦名稱]】通知', vars);
  if (tpl.is_active === false) {
    const skipped = {ok:true, skipped:true, disabled:true};
    await logEmailDelivery(env, tenantId, templateKey, to, skipped, {...meta, subject, reason:'template_disabled'});
    return skipped;
  }
  const bodyHtml = renderEmailTemplateBody(tpl.body || '', vars, tenantCtx, regId);
  const result = await sendEmail(env, to, subject, emailWrap(bodyHtml, tenantCtx), tenantCtx);
  await logEmailDelivery(env, tenantId, templateKey, to, result, {...meta, subject});
  return result;
}

function normalizeEquipName(k) {
  let name = String(k || '').trim();
  name = name.replace(/\s+/g, '');
  const aliases = {
    '椅子':'椅', '椅':'椅', '椅凳':'椅',
    '桌子':'桌', '桌':'桌', '長桌':'桌', '摺疊桌':'桌', '折疊桌':'桌', '桌台':'桌',
    '電':'電力', '用電':'電力', '插座':'電力', '電源':'電力',
  };
  return aliases[name] || name;
}
function equipSummaryFromJson(equip) {
  const eq = safeJson(equip, {});
  return Object.entries(eq)
    .filter(([k,v]) => Number(v) > 0)
    .map(([k,v]) => `${normalizeEquipName(k)} ×${Number(v)}`)
    .join('、');
}

function addonSummaryFromJson(addonQty, sessionRow={}) {
  const qty = safeJson(addonQty, {});
  const defs = safeJson(sessionRow.addons_json, []) || [];
  const parts = [];
  if (Array.isArray(qty)) {
    qty.forEach((it, i) => {
      if (it && typeof it === 'object') {
        const n = Number(it.qty || it.count || it.quantity || it.value || 0);
        const name = it.name || it.label || it.title || (defs[i] && defs[i].name) || `項目${i+1}`;
        if (n > 0) parts.push(`${name}×${n}`);
      } else {
        const n = Number(it || 0);
        const name = (defs[i] && defs[i].name) || `項目${i+1}`;
        if (n > 0) parts.push(`${name}×${n}`);
      }
    });
  } else if (qty && typeof qty === 'object') {
    Object.entries(qty).forEach(([k, v]) => {
      const n = Number((v && typeof v === 'object') ? (v.qty || v.count || v.quantity || v.value || 0) : v);
      if (n <= 0) return;
      const def = /^\d+$/.test(String(k)) && defs[Number(k)] ? defs[Number(k)] : null;
      const name = (v && typeof v === 'object' && (v.name || v.label || v.title)) || (def && def.name) || k;
      parts.push(`${name}×${n}`);
    });
  }
  return parts.length ? parts.join('、') : '無';
}
// 攤友自行撤回「付款回報」：App 中斷、轉帳失敗時常發生。
// 只允許在「待確認」階段撤回；主辦一旦確認入帳（已繳費）就不可撤回。
async function hUndoPaymentReport(env, b){
  const TENANT=b._tenantId; if(!TENANT) return jsonErr('缺少主辦代碼');
  if(!b.regId) return jsonErr('缺少報名編號');
  const rows=await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  const reg=(rows||[])[0];
  if(!reg) return jsonErr('找不到報名紀錄');
  const guard=regOwnerGuard(reg,b,'撤回付款回報'); if(guard) return guard;
  const ps=String(reg.payment_status||'');
  if(isPaidStatus(ps)) return jsonErr('主辦已確認入帳，無法撤回。若有問題請聯繫主辦');
  if(!/待確認|回報/.test(ps)) return jsonErr('目前狀態不需要撤回，可直接重新回報付款');
  await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}`,{
    payment_status:'未繳費',
    payment_report_amount:null,
    payment_last5:'',
    payment_reported_at:null,
    admin_note:(reg.admin_note||'')+` [攤友撤回付款回報] ${nowTaipeiText()}`
  });
  return jsonOk({success:true});
}
function buildPaymentLineCardText(reg, sesName, method, amount, session) {
  const brand = String(reg.brand_name || reg.brand || '').trim();
  const name = String(reg.name || reg.contact_name || reg.display_name || '').trim();
  const who = brand && name ? `${brand}／${name}` : (brand || name || '未填名稱');
  const stallCount = Math.max(Number(reg.stall_count || 1), 1);
  // 設備要顯示「每攤內含 + 加租」的實際總量（例：一攤含 1 桌 1 椅 → 桌×1、椅×1），
  // 只列加租會讓攤友看到「椅×1」這種缺漏的內容。
  let equipText = '';
  try {
    const map = _effectiveEquipmentMapForReg(reg, session || {});
    const parts = Object.entries(map).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${k}×${Number(v)}`);
    equipText = parts.join('、');
  } catch (e) { equipText = ''; }
  if (!equipText) equipText = equipSummaryFromJson(reg.equipment_json) || '';
  const deposit = Number(reg.deposit || 0);
  const total = Number(amount || reg.amount || 0);
  const fee = Math.max(0, total - deposit);
  const lines = [
    sesName || reg.session_name || '場次',
    who,
    `攤位 ${stallCount} 攤`,
    `設備：${equipText || '自備'}`,
  ];
  if (fee > 0) lines.push(`費用 NT$${fee.toLocaleString()}`);
  if (deposit > 0) lines.push(`保證金 NT$${deposit.toLocaleString()}`);
  lines.push('');
  lines.push(`付款金額：NT$${total.toLocaleString()}（${method || reg.payment_method || '付款'}）`);
  return lines.join('\n');
}


// ① 報名確認：可由後台開關控制，兔彼樂預設關閉
async function mailRegConfirm(env, email, displayName, sesName, regId, total, stallCount, selectedDates, equip, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
    '報名日期': emailDateText(selectedDates) || '未設定',
    '活動日期': emailDateText(selectedDates) || '未設定',
    '攤位數': Number(stallCount || 1) || 1,
    '設備': equipSummaryFromJson(equip) || '無',
    '應繳金額': emailMoneyText(total),
  };
  return sendTemplateEmail(env, tenantId, 'registration_received', email, vars, tenantCtx, regId, {targetId:regId, targetTable:'registrations'});
}

// ② 錄取通知：資料由 DB / Worker 帶入，前台只回我的紀錄查詢
async function mailApproval(env, email, displayName, sesName, regId, fee, stallCount, selectedDates, equip, sesEquipJson, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
    '報名日期': emailDateText(selectedDates) || '未設定',
    '活動日期': emailDateText(selectedDates) || '未設定',
    '攤位數': Number(stallCount || 1) || 1,
    '設備': equipSummaryFromJson(equip) || '無',
    '應繳金額': emailMoneyText(fee),
  };
  return sendTemplateEmail(env, tenantId, 'approval_notice', email, vars, tenantCtx, regId, {targetId:regId, targetTable:'registrations'});
}

// ③ 繳費回報已收到：保留 SaaS 功能，兔彼樂預設關閉
async function mailPaymentReceived(env, email, displayName, sesName, method, amount, last5, regId, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
    '付款方式': method || '付款',
    '回報金額': emailMoneyText(amount),
    '末五碼': last5 || '未提供',
  };
  return sendTemplateEmail(env, tenantId, 'payment_report_received', email, vars, tenantCtx, regId, {targetId:regId, targetTable:'registrations'});
}

// ④ 繳費確認信：保留 SaaS 功能，兔彼樂預設關閉
async function mailPaymentConfirm(env, email, displayName, sesName, amount, equipStr, stallNo, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
    '應繳金額': emailMoneyText(amount),
    '設備': equipStr || '無',
    '攤位號碼': stallNo || '尚未指定',
  };
  return sendTemplateEmail(env, tenantId, 'payment_confirmed', email, vars, tenantCtx, '', {targetTable:'registrations'});
}

// ⑤ 未錄取通知信：保留 SaaS 功能，兔彼樂預設關閉
async function mailRejection(env, email, displayName, sesName, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
  };
  return sendTemplateEmail(env, tenantId, 'rejection_notice', email, vars, tenantCtx, '', {targetTable:'registrations'});
}

// ⑥ 取消報名信：保留 SaaS 功能，兔彼樂預設關閉
async function mailCancelReg(env, email, displayName, sesName, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
  };
  return sendTemplateEmail(env, tenantId, 'registration_cancelled', email, vars, tenantCtx, '', {targetTable:'registrations'});
}

// ⑦ 退款申請已收到：保留 SaaS 功能，兔彼樂預設關閉
async function mailRefundRequestReceived(env, email, displayName, sesName, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
  };
  return sendTemplateEmail(env, tenantId, 'refund_request_received', email, vars, tenantCtx, '', {targetTable:'registrations'});
}

// ⑧ 一般退費完成信：保留，兔彼樂預設開啟
async function mailRefundConfirm(env, email, displayName, sesName, tenantCtx=null, refundAmount=0) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
    '退費金額': emailMoneyText(refundAmount),
  };
  return sendTemplateEmail(env, tenantId, 'refund_done', email, vars, tenantCtx, '', {targetTable:'registrations'});
}

// ⑨ 逾期未繳費自動取消
async function mailAutoCancel(env, email, displayName, sesName, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
  };
  return sendTemplateEmail(env, tenantId, 'overdue_cancel', email, vars, tenantCtx, '', {targetTable:'registrations'});
}

// 系統必要保留：繳費期限提醒
async function mailDeadlineReminder(env, email, displayName, sesName, regId, fee, selectedDates, equip, sesEquipJson, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
    '報名日期': emailDateText(selectedDates) || '未設定',
    '活動日期': emailDateText(selectedDates) || '未設定',
    '攤位數': '',
    '設備': equipSummaryFromJson(equip) || '無',
    '應繳金額': emailMoneyText(fee),
  };
  return sendTemplateEmail(env, tenantId, 'payment_reminder', email, vars, tenantCtx, regId, {targetId:regId, targetTable:'registrations'});
}

// 系統必要保留：行前提醒
async function mailPreEventReminder(env, email, displayName, sesName, date, venue, tenantCtx=null, regId='', equip='', stallNo='', mapUrl='') {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
    '活動日期': date || '未設定',
    '報名日期': date || '未設定',
    '地點': venue || '未設定',
    '設備': equip || '請以我的紀錄顯示為準',
    '攤位號碼': stallNo || '請至現場服務台洽詢',
    '場地圖網址': mapUrl || '（本場無場地圖，請以現場為準）',
  };
  return sendTemplateEmail(env, tenantId, 'event_reminder', email, vars, tenantCtx, regId, {targetId:regId, targetTable:'registrations'});
}

// 系統必要保留：不可抗力取消／延期通知
async function mailForceCancelChoice(env, email, displayName, sesName, targetSesName, deadline, tenantCtx=null, extra={}) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
    '原場次': sesName || '',
    '新場次': targetSesName || '無延期場次',
    '選擇期限': deadline || '依系統顯示',
    '取消原因': (extra && extra.reasonLabel) || '不可抗力因素',
    '補充說明': (extra && extra.note) || '',
  };
  return sendTemplateEmail(env, tenantId, 'force_notice', email, vars, tenantCtx, '', {targetTable:'registrations'});
}
async function mailTransferDiffFee(env, email, displayName, newSesName, newFee, oldFee, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': newSesName || '',
    '原場次': '',
    '新場次': newSesName || '',
    '退費金額': '0',
    '應繳金額': emailMoneyText(newFee),
  };
  return sendTemplateEmail(env, tenantId, 'force_result_notice', email, vars, tenantCtx, '', {targetTable:'registrations'});
}
async function mailTransferSameFee(env, email, displayName, newSesName, tenantCtx=null) {
  return mailTransferDiffFee(env, email, displayName, newSesName, 0, 0, tenantCtx);
}
async function mailAutoRefund(env, email, displayName, sesName, tenantCtx=null) {
  return mailRefundRequestReceived(env, email, displayName, sesName, tenantCtx);
}

// 不可抗力取消通知信
async function mailForceCancelNotice(env, email, displayName, sesName, tenantCtx=null, opts={}) {
  return mailForceCancelChoice(env, email, displayName, sesName,
    (opts && opts.targetSesName) || '', (opts && opts.deadlineText) || '', tenantCtx,
    {reasonLabel:(opts&&opts.reasonLabel)||'', note:(opts&&opts.note)||''});
}

// 延期完成信
async function mailForceTransferDone(env, email, displayName, oldSesName, newSesName, paidAmount, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': newSesName || '',
    '原場次': oldSesName || '',
    '新場次': newSesName || '',
    '退費金額': '0',
    '應繳金額': emailMoneyText(paidAmount),
  };
  return sendTemplateEmail(env, tenantId, 'force_result_notice', email, vars, tenantCtx, '', {targetTable:'registrations'});
}

// 退費完成信（不可抗力）
async function mailForceRefundDone(env, email, displayName, sesName, refundAmount, tenantCtx=null) {
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': displayName || '',
    '場次名稱': sesName || '',
    '原場次': sesName || '',
    '新場次': '',
    '退費金額': emailMoneyText(refundAmount),
  };
  return sendTemplateEmail(env, tenantId, 'force_result_notice', email, vars, tenantCtx, '', {targetTable:'registrations'});
}

// 管理員邀請
async function mailStaffInvite(env, email, name, role, perms, limitSessions, tenantCtx=null) {
  const labels = {review:'審核報名',checkin:'現場報到',sessions:'管理場次',events:'管理活動',finance:'財務管理',announce:'公告管理'};
  const permText = (role==='superadmin'||role==='超級管理員'||role==='platform_super_admin')
    ? '所有功能（超級管理員）'
    : Object.keys(perms||{}).filter(k=>perms[k]).map(k=>labels[k]||k).join('、') || '依後台權限設定';
  const sesText = limitSessions?.length ? '僅限指定場次' : '所有場次';
  const tenantId = tenantCtx?.id || '';
  const vars = {
    '主辦名稱': tenantCtx?.name || FALLBACK_TENANT_NAME,
    '顯示名稱': name || email || '',
    '管理員角色': role || '',
    '權限': permText,
    '管理範圍': sesText,
  };
  return sendTemplateEmail(env, tenantId, 'staff_invite', email, vars, tenantCtx, '', {targetTable:'staff', targetId:email});
}


// ── SECTION 10: DB 查詢輔助 ─────────────────────────────────────
async function getSessionRow(env, sessionId, tenantId) {
  const tid = tenantId ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env, 'sessions', `tenant_id=eq.${tid}&id=eq.${encodeURIComponent(sessionId)}&select=*`);
  return rows[0] || null;
}
async function getSessionName(env, sessionId, tenantId) {
  const tid = tenantId ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env, 'sessions', `tenant_id=eq.${tid}&id=eq.${encodeURIComponent(sessionId)}&select=name,type`);
  return rows.length ? rows[0].name : sessionId;
}
async function getSessionType(env, sessionId, tenantId) {
  const tid = tenantId ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env, 'sessions', `tenant_id=eq.${tid}&id=eq.${encodeURIComponent(sessionId)}&select=type`);
  return rows.length ? rows[0].type : '';
}
// 取得租戶 context（品牌資料、信件設定）
async function getTenantCtx(env, tenantId) {
  const tid = tenantId ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env, 'tenants', `id=eq.${tid}&select=id,name,slug,config_json,line_url,bank_info,email_from,email_reply_to,footer_text,site_url,default_refund_rules_json,payment_config_json`);
  const t = rows[0] || {};
  const cfg = safeJson(t.config_json, {});
  return {
    id:         tid,
    name:       t.name       || FALLBACK_TENANT_NAME,
    slug:       t.slug       || tid,
    siteUrl:    t.site_url   || cfg.siteUrl   || FALLBACK_SITE_URL,
    lineUrl:    t.line_url   || '',   // 付款/LINE 設定缺漏不 fallback（前台顯示未設定）
    bankInfo:   t.bank_info  || '',   // 付款設定缺漏不 fallback（前台顯示未設定）
    emailFrom:  t.email_from || FALLBACK_EMAIL_FROM,
    emailReplyTo: t.email_reply_to || FALLBACK_EMAIL_REPLY,
    footer:     t.footer_text || (t.name || FALLBACK_TENANT_NAME) + '　All rights reserved.',
    color:      cfg.brandColor || '#2d6a4f',
    heroImg:    cfg.heroImg  || '',
    infoText:   cfg.infoText || '',
    portals:    cfg.portals  || ['市集報名','體驗活動','通路寄賣','合作洽詢'],
    defaultRefundRules: safeJson(t.default_refund_rules_json, DEFAULT_REFUND_RULES),
    paymentConfig: safeJson(t.payment_config_json, {}),
  };
}


// ── SECTION 10.9: AI 主視覺生成模組（022）──────────────────────
function _aiVisualPresetKey(raw) {
  const s = String(raw || '').trim();
  return Object.prototype.hasOwnProperty.call(AI_VISUAL_PRESETS, s) ? s : '';
}
function _detectAiVisualPreset(sessionRow, eventRow, requested) {
  const explicit = _aiVisualPresetKey(requested) || _aiVisualPresetKey(sessionRow && sessionRow.ai_visual_preset);
  if (explicit) return explicit;
  const hay = [
    sessionRow && sessionRow.name,
    sessionRow && sessionRow.theme,
    sessionRow && sessionRow.description,
    eventRow && eventRow.title,
    eventRow && eventRow.description,
  ].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes('耶市集')) return 'ye_market';
  if (hay.includes('小旅行') || hay.includes('市集旅行')) return 'trip_market';
  if (hay.includes('翻轉市集') || hay.includes('翻轉')) return 'flip_market';
  if (hay.includes('幻日祭')) return 'fantasy_festival';
  return '';
}
function _aiVisualDateText(sessionRow) {
  const dates = safeJson(sessionRow && sessionRow.dates_json, []);
  const out = (Array.isArray(dates) ? dates : []).map(d => {
    if (d && typeof d === 'object') return String(d.label || d.name || d.date || '').trim();
    return String(d || '').trim();
  }).filter(Boolean);
  return out.join('、');
}
function _aiVisualCleanContext(v, maxLen = 700) {
  return String(v || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}
function _buildAiVisualPrompt(sessionRow, eventRow, presetKey, variantNo, visualThemeNote='') {
  const preset = AI_VISUAL_PRESETS[presetKey];
  const title = _aiVisualCleanContext(sessionRow.name, 120);
  const dateText = _aiVisualCleanContext(_aiVisualDateText(sessionRow), 160);
  const venue = _aiVisualCleanContext(sessionRow.venue, 180);
  const desc = _aiVisualCleanContext(sessionRow.description || (eventRow && eventRow.description) || '', 700);
  const themeNote = _aiVisualCleanContext(visualThemeNote, 400);
  const composition = variantNo === 1
    ? 'Use a strong primary composition with generous clean breathing room and clear visual hierarchy.'
    : 'Use a different but still clean composition with layered storytelling while preserving a clear overlay-safe area.';
  const yeCenterLock = presetKey === 'ye_market' ? [
    'YE MARKET FIXED TEMPLATE — mandatory composition lock:',
    'The CENTRAL area is reserved for the official Ye Market logo that the system will composite after generation.',
    'Keep the middle 42% of the canvas visually calm, low-detail, low-contrast and free of people, stalls, text, faces, landmarks or major objects.',
    'Do NOT create any logo, badge, emblem, arch, sign, title or symbol in the center.',
    'Place the theme-related market illustration around the TOP, LEFT, RIGHT and LOWER EDGES, framing the empty center like a hand-painted illustrated border.',
    'The surrounding illustrations must respond directly to the event title, saved description and optional visual-theme note. Do not substitute random scenery.'
  ].join(' ') : '';
  return [
    'Create a polished square 1:1 main visual background for this SPECIFIC Taiwanese market event.',
    `This is the event subject: title=${title}; date=${dateText}; location=${venue}; description=${desc || 'none'}; visual theme note=${themeNote || 'none'}.`,
    'The image must clearly communicate an active market-event atmosphere. The result must look like a market key visual, not a generic landscape or random scenery.',
    'Required core scene language: clearly visible market stalls or booths, display tables or awnings, event decorations, products or handmade goods, and a human atmosphere such as visitors browsing, gathering, resting, or participating.',
    'Theme relevance is mandatory: use the event title, description and visual-theme note to decide the surrounding props, season, activities, objects, decorations and mood.',
    'If the location suggests a famous place, use it only as subtle background flavor. Never let landmarks, roads, stations, railways, temples or city scenery dominate the image. The MARKET atmosphere is always the main subject.',
    `Brand preset: ${preset.label}.`,
    `Brand visual rules: ${preset.rules}.`,
    `Required subject emphasis: ${preset.subject}.`,
    `Strictly avoid: ${preset.avoid}.`,
    yeCenterLock,
    composition,
    'Hard output rules: no text, no letters, no numbers, no logos, no QR codes, no watermarks, no signage with readable writing. The system will overlay exact official elements after generation.',
    'Keep a stable illustration language, intentional negative space, strong readability for later overlay, and avoid clutter or generic stock-photo aesthetics.',
    'If unsure, always choose a market-event scene with clear booths and event ambiance rather than a travel scene, empty background or unrelated city view.'
  ].filter(Boolean).join('\n');
}
function _aiVisualBytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  return btoa(binary);
}
function _aiVisualXmlEscape(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
async function _fetchYeMarketOfficialLogo() {
  const res = await fetch(AI_VISUAL_YE_MARKET_LOGO_URL, { cf:{ cacheTtl:86400, cacheEverything:true } });
  if (!res.ok) throw new Error('耶市集正式 Logo 讀取失敗（' + res.status + '）');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new Error('耶市集正式 Logo 內容為空');
  return bytes;
}
function _composeYeMarketFinalSvg(backgroundBytes, logoBytes, sessionRow) {
  const bgB64 = _aiVisualBytesToBase64(backgroundBytes);
  const logoB64 = _aiVisualBytesToBase64(logoBytes);
  const title = _aiVisualXmlEscape(_aiVisualCleanContext(sessionRow.name, 120));
  const dateText = _aiVisualXmlEscape(_aiVisualCleanContext(_aiVisualDateText(sessionRow), 160));
  const venue = _aiVisualXmlEscape(_aiVisualCleanContext(sessionRow.venue, 180));
  const c = AI_VISUAL_YE_MARKET_LOGO_CROP;
  // 以 SVG 封裝 AI 背景、正式 logo 與 DB 正式文字；logo 使用 nested SVG 裁掉原圖大量白邊。
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.88"/>
    </linearGradient>
    <filter id="logoShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#365214" flood-opacity="0.18"/>
    </filter>
  </defs>
  <image href="data:image/png;base64,${bgB64}" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0" y="760" width="1024" height="264" fill="url(#bottomFade)"/>
  <clipPath id="yeLogoCrop"><rect x="337" y="165" width="341" height="560" rx="8"/></clipPath>
  <image href="data:image/jpeg;base64,${logoB64}" x="125" y="59" width="757" height="757" clip-path="url(#yeLogoCrop)" filter="url(#logoShadow)" style="mix-blend-mode:multiply"/>
  <g font-family="Noto Sans TC, Microsoft JhengHei, PingFang TC, sans-serif" fill="#2f4918">
    <text x="64" y="858" font-size="52" font-weight="900">${title}</text>
    <text x="66" y="908" font-size="28" font-weight="800">${dateText}</text>
    <text x="66" y="952" font-size="26" font-weight="700">${venue}</text>
  </g>
</svg>`;
  return new TextEncoder().encode(svg);
}

function _aiVisualAssetPublic(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    jobId: row.job_id,
    stylePreset: row.style_preset || '',
    publicUrl: row.public_url || '',
    storagePath: row.storage_path || '',
    variantNo: Number(row.variant_no || 0),
    isSelected: row.is_selected === true,
    width: Number(row.width || 1024),
    height: Number(row.height || 1024),
    createdAt: row.created_at || '',
  };
}
async function _openAiGenerateSquareVisual(env, prompt) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 環境變數未設定');
  const model = String(env.OPENAI_IMAGE_MODEL || AI_VISUAL_DEFAULT_MODEL).trim();
  const quality = String(env.OPENAI_IMAGE_QUALITY || AI_VISUAL_DEFAULT_QUALITY).trim();
  const payload = {
    model,
    prompt,
    n: 1,
    size: AI_VISUAL_SIZE,
    quality,
    output_format: 'png',
  };
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.OPENAI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : text.slice(0, 700);
    throw new Error('OpenAI 產圖失敗（' + res.status + '）：' + msg);
  }
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error('OpenAI 產圖成功但未回傳圖像資料');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, model, quality, usage: data.usage || null };
}
async function _aiVisualStorageUpload(env, storagePath, bytes, mime = 'image/png') {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  if (!base || !key) throw new Error('Supabase Storage 環境變數未設定');
  const res = await fetch(base + '/storage/v1/object/' + AI_VISUAL_BUCKET + '/' + storagePath, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'apikey': key,
      'Content-Type': mime,
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error('AI 主視覺 Storage 上傳失敗（' + res.status + '）：' + (await res.text()).slice(0, 500));
  return base + '/storage/v1/object/public/' + AI_VISUAL_BUCKET + '/' + storagePath;
}
async function _aiVisualStorageDelete(env, storagePath) {
  if (!storagePath) return;
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  if (!base || !key) return;
  const res = await fetch(base + '/storage/v1/object/' + AI_VISUAL_BUCKET + '/' + storagePath, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + key, 'apikey': key },
  });
  if (!res.ok && res.status !== 404) throw new Error('Storage 刪除失敗（' + res.status + '）：' + (await res.text()).slice(0, 400));
}

// ── SECTION 11: GET Handlers ─────────────────────────────────────

// frontBootstrap：前台資料庫主導總入口
async function hFrontBootstrap(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const [tc, eventRows, sessionRows, annRows] = await Promise.all([
    getTenantCtx(env, TENANT),
    dbGet(env, 'events', `tenant_id=eq.${TENANT}&status=neq.%E5%81%9C%E7%94%A8&select=*`),
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&status=in.(%E5%A0%B1%E5%90%8D%E4%B8%AD,%E9%96%8B%E6%94%BE%E4%B8%AD)&select=*`),
    dbGet(env, 'announcements', `tenant_id=eq.${TENANT}&select=*&order=created_at.desc`),
  ]);
  return jsonOk({
    tenant: {
      id:       tc.id,
      name:     tc.name,
      slug:     tc.slug,
      heroImg:  tc.heroImg,
      infoText: tc.infoText,
      lineUrl:  tc.lineUrl,
      bankInfo: tc.bankInfo,
      color:    tc.color,
      portals:  tc.portals,
      paymentConfig: tc.paymentConfig,
    },
    events:        eventRows.map(r=>({id:r.id,title:r.title,desc:r.description,location:r.location,cover:r.cover_url,status:r.status})),
    sessions:      sessionRows.map(formatSession),
    announcements: annRows.map(r=>({id:r.id,title:r.title,content:r.content,url:r.url,urlText:r.url_text,createdAt:r.created_at})),
  });
}

// getEvents
async function hGetEvents(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env, 'events', `tenant_id=eq.${TENANT}&status=neq.%E5%81%9C%E7%94%A8&select=*`);
  return jsonOk(rows.map(r=>({id:r.id,title:r.title,desc:r.description,location:r.location,cover:r.cover_url,status:r.status})));
}

// getSessions
async function hGetSessions(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  let qs = `tenant_id=eq.${TENANT}&status=in.(報名中,開放中)&select=*`;
  if (p.eventId) qs += `&event_id=eq.${encodeURIComponent(p.eventId)}`;
  let rows = await dbGet(env, 'sessions', qs);
  if (p.portal) rows = rows.filter(r=>{
    const ps = r.portals ? String(r.portals).split(',').map(x=>x.trim()) : [];
    return ps.includes(p.portal);
  });
  return jsonOk(rows.map(formatSession));
}

// getSession
async function hGetSession(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const id = p.id || p.sessionId;
  if (!id) return jsonErr('請提供 id');
  const rows = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}&select=*`);
  if (!rows.length) return jsonErr('找不到場次');
  return jsonOk(formatSession(rows[0]));
}

// getSessionAgreement（回傳場次合約設定，供前台 Modal 顯示）
async function hGetSessionAgreement(env, p) {
  const TENANT = (p && p._tenantId);
  const id = p.id || p.sessionId;
  if (!id) return jsonErr('請提供 id');
  const rows = await dbGet(env, 'sessions',
    `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}&select=*`);
  if (!rows.length) return jsonErr('找不到場次');
  const s = rows[0];
  let title = s.agreement_title || '報名合約／活動細則與攤商規範';
  let content = s.agreement_content || '';
  let version = s.agreement_version || '';
  let updatedAt = s.agreement_updated_at || null;

  // A→Z 阻斷修正：若場次尚未套用合約正文，但後台已有「預設合約範本」，
  // 前台仍要能讀到合約，避免報名者卡在「無法載入合約內容」。
  if (!String(content||'').trim()) {
    try {
      const templates = await dbGet(env, 'tenant_agreement_templates',
        `tenant_id=eq.${TENANT}&select=*&order=slot_no.asc,created_at.asc`);
      const t = (templates||[]).find(x => String(x.content||'').trim()) || null;
      if (t) {
        title = t.title || title;
        content = t.content || '';
        version = t.version || version;
        updatedAt = t.updated_at || updatedAt;
      }
    } catch(e) { console.error('agreement template fallback failed', e && e.message ? e.message : e); logError(env, {source:'hGetSessionAgreement', message:'agreement template fallback failed', error:e && e.message ? e.message : e}); }
  }

  return jsonOk({
    sessionId: s.id,
    sessionName: s.name || '',
    agreementRequired: agreementRequiredOn(s.agreement_required),
    title,
    content,
    version,
    updatedAt,
  });
}

// member lookup helpers（前台會員以 tenant_id + email 為主，phone 為查找輔助）
function normEmail(v){ return String(v||'').trim().toLowerCase(); }
// 手機比對修正：資料庫可能存 0955 / 886955 / +886955 / 955 等格式，
// 前台查詢時要視為同一支手機，不可用完全相同字串導致「會員紀錄消失」。
function phoneDigits(v){ return String(v||'').trim().replace(/[^0-9]/g,''); }
function normPhone(v){
  const d = phoneDigits(v);
  if (!d) return '';
  if (d.startsWith('886') && d.length >= 12) return '0' + d.slice(3);
  if (d.length === 9 && d.startsWith('9')) return '0' + d;
  return d;
}
function phoneMatches(a,b){
  const ca = normPhone(a), cb = normPhone(b);
  if (!ca || !cb) return false;
  return ca === cb;
}
// PROFILE_COMPLETE_FIX_20260726：後端漏了完整度判定，導致前台永遠要求補資料、報名被擋。
// 只有身分與審核必要資料會擋住報名；販售類別、品牌介紹等可稍後補充。
function _memberProfileStatus(m){
  m=m||{};
  const has=function(v){ return String(v==null?'':v).trim()!==''; };
  const brand = m.brand_name||m.brand;
  const socialOrWebsite = has(m.fb_url)||has(m.ig_url)||has(m.collab_url);
  const checks=[['聯絡人姓名',has(m.name)],['手機',has(m.phone)],['攤位／品牌名稱',has(brand)],['FB、IG 或官網（至少一項）',socialOrWebsite]];
  const missingFields=checks.filter(function(c){return !c[1];}).map(function(c){return c[0];});
  return { profileComplete: missingFields.length===0, missingFields: missingFields };
}
function memberPayloadFromRow(m){
  if (!m) return null;
  const brandName = m.brand_name || m.brand || '';
  const _ps = _memberProfileStatus(m);
  return {
    email:m.email||'', name:m.name||'', phone:String(m.phone||''),
    brand:brandName, brand_name:brandName,
    brandIntro:m.brand_intro||'', brand_intro:m.brand_intro||'',
    sellCat:m.sell_category||m.sell_cat||'', sell_category:m.sell_category||m.sell_cat||'',
    sellItem:m.sell_items||m.sell_item||'', sell_items:m.sell_items||m.sell_item||'',
    photo:m.photo_url||'', photo_url:m.photo_url||'',
    fb:m.fb_url||'', fb_url:m.fb_url||'', ig:m.ig_url||'', ig_url:m.ig_url||'',
    collabUrl:m.collab_url||'', collab_url:m.collab_url||'', website:m.collab_url||'', web:m.collab_url||'', collabDesc:m.collab_desc||'', collabItems:m.collab_items||'',
    company:m.company||m.invoice_title||'', taxId:m.tax_id||'', tax_id:m.tax_id||'',
    invoiceType:m.invoice_type||'', invoiceTitle:m.invoice_title||m.company||'', invoice_title:m.invoice_title||m.company||'',
    invoiceEmail:m.invoice_email||'', invoice_email:m.invoice_email||'',
    invoiceCarrier:m.invoice_carrier||'', invoice_carrier:m.invoice_carrier||'',
    city:m.city||'', lineId:m.line_id||'', line_id:m.line_id||'',
    fastPass:m.fast_pass===true||m.fast_pass==='true', joinedAt:m.joined_at||m.created_at||'',
    member_id:m.email||m.member_id||'', source:m._source||'members',
    profileComplete:_ps.profileComplete, missingFields:_ps.missingFields,
  };
}
// ── 嚴格身份驗證：Email＋手機必須成對相符 ─────────────────────────
// findMemberByEmailOrPhone 是「盡量找到人」的寬鬆查找（僅供 getMyRegs 內部比對用），
// 不可拿來當權限判斷。凡是會吐出個資、或會改動正式資料的 API，一律走下面兩個函式。
async function findVerifiedMemberByEmailPhone(env, tenantId, email, phone){
  const e = normEmail(email);
  const ph = normPhone(phone);
  if (!e || !ph) return null;
  // members 已有此 Email 時，只能用 members 目前的手機驗證，
  // 不得退回舊 registrations 繞過（否則改過手機的人，舊手機還能登入）。
  const members = await dbGet(env, 'members', `tenant_id=eq.${tenantId}&email=ilike.${encodeURIComponent(e)}&select=*`).catch(()=>[]);
  if (members.length) {
    const m = members[0];
    return phoneMatches(m.phone, ph) ? {...m, _source:'members'} : null;
  }
  // 尚未建立 members 的人，才允許用歷史報名紀錄的 Email＋手機配對。
  const regs = await dbGet(env, 'registrations', `tenant_id=eq.${tenantId}&email=ilike.${encodeURIComponent(e)}&select=email,phone,name,brand,brand_name,brand_intro,sell_category,sell_items,photo_url,fb_url,ig_url,tax_id,invoice_title,invoice_email,invoice_type,invoice_carrier,created_at&order=created_at.desc&limit=100`).catch(()=>[]);
  const found = regs.find(r => phoneMatches(r.phone, ph));
  return found ? {...found, _source:'registrations'} : null;
}
// 報名所有權：以 registrations 這筆本身的 email＋phone 驗證，兩者都必須相符。
function isRegistrationOwner(reg, email, phone){
  if (!reg) return false;
  const e = normEmail(email);
  const ph = normPhone(phone);
  if (!e || !ph) return false;
  return normEmail(reg.email) === e && phoneMatches(reg.phone, ph);
}
// 所有「會改動正式資料」的攤友端 API 共用這一道關卡（單一來源，不各寫各的）。
function regOwnerGuard(reg, b, actionLabel){
  if (!b || !b.email || !b.phone) return jsonErr('請先以 Email 與手機完成身份驗證');
  if (!isRegistrationOwner(reg, b.email, b.phone)) return jsonErr('無權限' + actionLabel + '此報名');
  return null;
}

async function findMemberByEmailOrPhone(env, tenantId, email, phone){
  const e = normEmail(email);
  const ph = normPhone(phone);
  let rows = [];
  if (e) {
    rows = await dbGet(env, 'members', `tenant_id=eq.${tenantId}&email=ilike.${encodeURIComponent(e)}&select=*`).catch(()=>[]);
    if (rows.length) return {...rows[0], _source:'members'};
  }
  if (ph) {
    rows = await dbGet(env, 'members', `tenant_id=eq.${tenantId}&select=*`).catch(()=>[]);
    const found = rows.find(r => phoneMatches(r.phone, ph));
    if (found) return {...found, _source:'members'};
  }
  if (e) {
    rows = await dbGet(env, 'registrations', `tenant_id=eq.${tenantId}&email=ilike.${encodeURIComponent(e)}&select=email,phone,name,brand,brand_name,brand_intro,sell_category,sell_items,photo_url,fb_url,ig_url,tax_id,invoice_title,invoice_email,invoice_type,invoice_carrier,created_at&order=created_at.desc&limit=20`).catch(()=>[]);
    if (!ph && rows.length) return {...rows[0], _source:'registrations'};
    const found = rows.find(r => phoneMatches(r.phone, ph));
    if (found) return {...found, _source:'registrations'};
    if (rows.length) return {...rows[0], _source:'registrations'};
  }
  if (ph) {
    rows = await dbGet(env, 'registrations', `tenant_id=eq.${tenantId}&select=email,phone,name,brand,brand_name,brand_intro,sell_category,sell_items,photo_url,fb_url,ig_url,tax_id,invoice_title,invoice_email,invoice_type,invoice_carrier,created_at&order=created_at.desc&limit=200`).catch(()=>[]);
    const found = rows.find(r => phoneMatches(r.phone, ph));
    if (found) return {...found, _source:'registrations'};
  }
  return null;
}
// getMember
// 報名前預檢：這個 Email 是否已有會員、手機是否一致。
// 只回傳兩個布林值，不吐任何個資，用來提前擋下「填完整張表才被拒」的死路。
async function hCheckMemberEmailPhone(env, p) {
  const TENANT = (p && p._tenantId);
  if (!TENANT) return jsonErr('缺少主辦代碼');
  const email = normEmail(p && p.email);
  const phone = normPhone(p && p.phone);
  if (!email) return jsonOk({exists:false, match:false});
  let rows = [];
  try {
    rows = await dbGet(env, 'members', `tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(email)}&select=phone`);
  } catch (e) {
    logError(env, {source:'hCheckMemberEmailPhone', message:'read member failed', error: e && e.message ? e.message : e});
    return jsonOk({exists:false, match:false});
  }
  if (!rows || !rows.length) return jsonOk({exists:false, match:false});
  const ok = phone ? phoneMatches(rows[0].phone, phone) : false;
  return jsonOk({exists:true, match:!!ok});
}
async function hGetMember(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const email = normEmail(p && p.email);
  const phone = normPhone(p && p.phone);
  // B-01：只給 Email 就撈得到姓名／手機／統編／發票信箱＝個資外洩。必須成對驗證。
  if (!email || !phone) return jsonErr('請提供 Email 與手機');
  const m = await findVerifiedMemberByEmailPhone(env, TENANT, email, phone);
  if (!m) return jsonOk(null);
  return jsonOk(memberPayloadFromRow(m));
}

// getMyRegs
async function hGetMyRegs(env, p) {
  const TENANT = (p && p._tenantId);
  const email = normEmail(p && p.email);
  const phone = normPhone(p && p.phone);
  if (!email || !phone) return jsonErr('請提供 Email 與手機，才能查詢我的紀錄');

  // 只用同一個 Email 的會員／報名進行驗證，避免「相同電話、不同 Email」被誤認為同一人。
  const [memberRows, regsByEmail] = await Promise.all([
    dbGet(env,'members',`tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(email)}&select=*`),
    dbGet(env,'registrations',`tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(email)}&select=*&order=created_at.desc`),
  ]);
  let member = memberRows[0] || null;
  const regMatched = regsByEmail.find(r=>phoneMatches(r.phone,phone));

  if (member && !phoneMatches(member.phone,phone)) {
    // 舊會員手機空白或格式不同時，可由自己既有報名紀錄完成補驗；真正不一致仍阻斷。
    if (!regMatched) return jsonErr('Email 已存在，但手機與會員資料不一致，請確認報名時使用的手機號碼。');
    try { await upsertMember(env,{_tenantId:TENANT,email,phone,name:regMatched.name||'',brand:regMatched.brand_name||regMatched.brand||'',brandIntro:regMatched.brand_intro||'',sellCat:regMatched.sell_category||'',photo:regMatched.photo_url||'',fb:regMatched.fb_url||'',ig:regMatched.ig_url||'',taxId:regMatched.tax_id||'',invoiceTitle:regMatched.invoice_title||'',invoiceEmail:regMatched.invoice_email||''}); } catch(e) {}
  } else if (!member) {
    if (regsByEmail.length && !regMatched) return jsonErr('查無符合 Email 與手機的報名紀錄，請確認是否與報名時一致。');
    if (regMatched) {
      try { await upsertMember(env,{_tenantId:TENANT,email,phone,name:regMatched.name||'',brand:regMatched.brand_name||regMatched.brand||'',brandIntro:regMatched.brand_intro||'',sellCat:regMatched.sell_category||'',photo:regMatched.photo_url||'',fb:regMatched.fb_url||'',ig:regMatched.ig_url||'',taxId:regMatched.tax_id||'',invoiceTitle:regMatched.invoice_title||'',invoiceEmail:regMatched.invoice_email||''}); } catch(e) {}
    } else {
      // 全新會員：建立最小會員紀錄，回傳空清單；「沒有舊報名」不是錯誤。
      try { await upsertMember(env,{_tenantId:TENANT,email,phone,name:'',brand:'',brandIntro:'',sellCat:''}); }
      catch(e) {
        const again=await dbGet(env,'members',`tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(email)}&select=phone`).catch(()=>[]);
        if(again.length && !phoneMatches(again[0].phone,phone)) return jsonErr('Email 已存在，但手機與會員資料不一致。');
      }
    }
  }

  const [regsByMember, sessions] = await Promise.all([
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&member_id=ilike.${encodeURIComponent(email)}&select=*&order=created_at.desc`).catch(()=>[]),
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&select=id,name,event_id,venue,dates_json,equip_json,basic_equip,payment_profile_id,seat_pricing_enabled,seat_hold_hours,seat_map_url,seat_layout_published_at,force_cancel,force_cancel_deadline,force_cancel_target_id`),
  ]);
  const regMap = new Map();
  [...regsByEmail, ...regsByMember].forEach(r=>{ if(r && r.id && phoneMatches(r.phone,phone)) regMap.set(String(r.id), r); });
  const regs = Array.from(regMap.values()).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const sMap = {}; sessions.forEach(s=>sMap[s.id]=s);
  return jsonOk(await Promise.all(regs.map(async r=>{
    const s = sMap[r.session_id]||{};
    const paySnap = await ensurePaymentSnapshotForReg(env,TENANT,r,s,{writeIfSafe:true}).catch(()=>_paymentSnapshotFromReg(r));
    const payPub = _paymentSnapshotPublic(paySnap);
    const daySeatRows=s.seat_layout_published_at?await dbGet(env,'registration_day_seats',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(r.session_id)}&registration_id=eq.${encodeURIComponent(r.id)}&select=activity_date,seat_code&order=activity_date.asc,seat_code.asc`).catch(()=>[]):[];
    const dayPositions=daySeatRows.reduce((out,x)=>{const date=String(x.activity_date||'').slice(0,10);let row=out.find(y=>y.date===date);if(!row){row={date,stallNumber:''};out.push(row);}row.stallNumber=[row.stallNumber,String(x.seat_code||'')].filter(Boolean).join(',');return out;},[]);
    return {
      id:r.id, sessionId:r.session_id, sessionName:s.name||r.session_id,
      eventId:r.event_id||s.event_id||'', status:r.review_status, payStatus:r.payment_status,
      amount:Number(r.amount||0), total:Number(r.total_amount||r.amount||0), paid:Number(r.paid_amount||0),
      due:Math.max(0, Number(r.total_amount||r.amount||0) - Number(r.paid_amount||0) - Number(r.activity_credit_applied||0)), deposit:Number(r.deposit||0),
      activityCreditApplied:safeNum(r.activity_credit_applied),
      stallCount:Number(r.stall_count||1), selectedDates:safeJson(r.selected_dates_json,[]), equip:safeJson(r.equipment_json,{}),
      totalEquipmentText:_equipmentTextFromMap(_effectiveEquipmentMapForReg(r, s)), preNoticeEquipmentText:_equipmentTextFromMap(_effectiveEquipmentMapForReg(r, s)),
      addonQty:safeJson(r.addon_qty_json,{}), participants:safeJson(r.participants_json,{}), stallNumber:(dayPositions[0]&&dayPositions[0].stallNumber)||'',
      seatChoiceIntent:r.seat_choice_intent||'auto', seatChoiceStatus:r.seat_choice_status||'', seatChoiceType:r.seat_choice_type||'',
      bundleId:r.bundle_id||'', bundleGroupId:r.bundle_group_id||'',
      seatPricingEnabled:(s.seat_pricing_enabled===true||s.seat_pricing_enabled==='true'), seatHoldHours:safeNum(s.seat_hold_hours)||SEAT_HOLD_HOURS,
      seatMapUrl:s.seat_layout_published_at?(s.seat_map_url||''):'', seatLayoutPublishedAt:s.seat_layout_published_at||'', dayPositions,
      seatFeeTotal:safeNum(r.seat_fee_total), seatHoldExpiresAt:r.seat_hold_expires_at||'',
      payMethod:r.payment_method||'', payLast5:r.payment_last5||'', checkin:r.checkin_status, createdAt:r.created_at,
      transferStatus:r.transfer_status||'', transferChosenAt:r.transfer_chosen_at||'', refundAmount:safeNum(r.refund_amount),
      refundAdminFee:safeNum(r.refund_admin_fee), refundTransferFee:safeNum(r.refund_transfer_fee), refundRuleLabel:r.refund_rule_label||'', refundedAt:r.refunded_at||'', refundNote:r.refund_note||'',
      forceStatus:r.force_status || (s.force_cancel ? (r.transfer_status==='申請退費'?'refund_requested':(r.transfer_status==='已延期'?'transferred':'pending_force_choice')) : null),
      forceChoiceDeadline:s.force_cancel_deadline||'', forceCancelled:s.force_cancel||false, forceMode:s.force_cancel?'cancel':'', forceCancelReasonLabel:s.force_cancel_reason_label||'',
      forceTransferTargetSessionId:r.transferred_to_session_id||s.force_cancel_target_id||'', forceRefundRequestedAt:r.force_refund_requested_at||'', forceRefundedAt:r.force_refunded_at||'',
      agreementAccepted:r.agreement_accepted||false, agreementVersion:r.agreement_version||'',
      paymentProfile:payPub, paymentProfileName:payPub.paymentProfileName, paymentOwnerMode:payPub.paymentOwnerMode,
      allowedPaymentMethods:payPub.allowedMethods, bankAccount:payPub.bankAccount, linepay:payPub.linepay, card:payPub.card,
    };
  })));
}
// getRegLookup（信件深連結用：依 regId 反查 email，不依賴瀏覽器暫存）
// B-02：本 API 原本可用 regId 反查 Email，而 regId 又能串取消／選位／付款／退費，
// 形成完整攻擊鏈。已停用，改由 Email＋手機登入「我的紀錄」取得自己的報名。
async function hGetRegLookup(env, p) {
  return jsonErr('為保護個資，此查詢已停用。請使用 Email＋手機登入「我的紀錄」。');
}

// getAnnouncements
async function hGetAnnouncements(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env, 'announcements', `tenant_id=eq.${TENANT}&select=*&order=created_at.desc`);
  return jsonOk(rows.map(r=>({id:r.id,title:r.title,content:r.content,url:r.url,urlText:r.url_text,createdAt:r.created_at,paymentProfileId:r.payment_profile_id||'',paymentProfile:_paymentSnapshotPublic(safeJson(r.payment_profile_snapshot,null))})));
}

// ── 統一 Google 登入入口（前台 + 後台共用）────────────────────────

// GET /auth/google/unified/start — 統一登入起點
async function hGoogleUnifiedStart(env, url) {
  const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
  const GOOGLE_REDIRECT_URI = env.GOOGLE_UNIFIED_REDIRECT_URI || env.GOOGLE_REDIRECT_URI;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    return new Response('Google OAuth 未設定', { status: 500 });
  }
  const tenant = url.searchParams.get('tenant') || 'tuibile';
  const next = url.searchParams.get('next') || 'auto'; // auto/admin/member
  const rawState = `${tenant}:${next}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const state = btoa(rawState);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

// GET /auth/google/unified/callback — 統一登入回調
async function hGoogleUnifiedCallback(env, url) {
  const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_REDIRECT_URI = env.GOOGLE_UNIFIED_REDIRECT_URI || env.GOOGLE_REDIRECT_URI;
  const FRONTEND_SITE_URL = env.FRONTEND_SITE_URL || env.ADMIN_SITE_URL || '';
  const ADMIN_SITE_URL = env.ADMIN_SITE_URL || '';
  const ONSITE_SITE_URL = env.ONSITE_SITE_URL || (ADMIN_SITE_URL ? ADMIN_SITE_URL.replace('admin.html','onsite.html') : 'https://2b-love.com/onsite.html');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const failRedirect = (reason, base) => {
    const u = new URL(base || FRONTEND_SITE_URL);
    u.searchParams.set('login_error', reason);
    return Response.redirect(u.toString(), 302);
  };

  if (errorParam) return failRedirect('google_cancelled', FRONTEND_SITE_URL);
  if (!code || !state) return failRedirect('missing_params', FRONTEND_SITE_URL);

  let tenant = 'tuibile', next = 'auto';
  try {
    const raw = atob(state);
    const parts = raw.split(':');
    tenant = parts[0] || 'tuibile';
    next = parts[1] || 'auto';
  } catch(e) { return failRedirect('invalid_state', FRONTEND_SITE_URL); }

  // 換 token
  let tokenRes;
  try {
    tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    }).then(r => r.json());
  } catch(e) { return failRedirect('token_exchange_failed', FRONTEND_SITE_URL); }

  if (!tokenRes.id_token) return failRedirect('no_id_token', FRONTEND_SITE_URL);

  // 驗證 id_token
  let userInfo;
  try {
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${tokenRes.id_token}`);
    userInfo = await infoRes.json();
    if (userInfo.error || userInfo.aud !== GOOGLE_CLIENT_ID) throw new Error('invalid');
  } catch(e) { return failRedirect('id_token_verify_failed', FRONTEND_SITE_URL); }

  const googleEmail = (userInfo.email || '').toLowerCase();
  const googleSub = userInfo.sub || '';
  const googleName = userInfo.name || '';
  const googleAvatar = userInfo.picture || '';

  if (!googleEmail) return failRedirect('no_email', FRONTEND_SITE_URL);

  // 判斷身份：主辦方 / 報名者 / 兩者
  const isStaff = await checkIsStaff(env, googleEmail, tenant);
  const isMember = await checkIsMember(env, googleEmail, tenant);

  // 記錄登入
  await logAdminLogin(env, tenant, null, googleEmail, 'google', 'success', 'unified_login', '', '');

  if (isStaff && isMember && next === 'auto') {
    // 兩種身份都有 → 跳轉到選擇頁
    const memberToken = await issueMemberToken({ email: googleEmail, google_sub: googleSub, display_name: googleName, avatar_url: googleAvatar }, env);
    const staffToken = await issueStaffTokenByEmail(env, googleEmail, tenant);
    const u = new URL(FRONTEND_SITE_URL || 'https://2b-love.com/');
    u.searchParams.set('choose_role', '1');
    u.searchParams.set('member_token', memberToken);
    u.searchParams.set('admin_token', staffToken);
    u.searchParams.set('tenant', tenant);
    u.searchParams.set('display_name', googleName);
    return Response.redirect(u.toString(), 302);
  }

  if ((isStaff && next === 'auto') || next === 'admin' || next === 'onsite') {
    // 主辦方 → 依入口進完整後台或現場管理頁
    const targetSite = next === 'onsite' ? ONSITE_SITE_URL : ADMIN_SITE_URL;
    if (!isStaff) return failRedirect('not_authorized', targetSite || ADMIN_SITE_URL);
    const lockCheck = await checkTenantLocked(env, tenant);
    const staffToken = await issueStaffTokenByEmail(env, googleEmail, tenant);
    await updateStaffLastLogin(env, googleEmail, tenant, googleName);
    const u = new URL(targetSite || 'https://2b-love.com/admin.html');
    u.searchParams.set('admin_token', staffToken);
    u.searchParams.set('tenant', tenant);
    if (lockCheck.locked) u.searchParams.set('locked', '1');
    return Response.redirect(u.toString(), 302);
  }

  // 報名者 → 進前台
  await updateMemberLastLogin(env, googleEmail, tenant, googleSub, googleName, googleAvatar);
  const memberToken = await issueMemberToken({ email: googleEmail, google_sub: googleSub, display_name: googleName, avatar_url: googleAvatar }, env);
  const u = new URL(FRONTEND_SITE_URL || 'https://2b-love.com/');
  u.searchParams.set('member_token', memberToken);
  u.searchParams.set('tenant', tenant);
  u.searchParams.set('display_name', googleName);
  return Response.redirect(u.toString(), 302);
}

// 輔助：檢查是否為 staff
async function checkIsStaff(env, email, tenantId) {
  const platformRows = await dbGet(env, 'platform_staff', `email=eq.${encodeURIComponent(email)}&is_active=eq.true&select=email`).catch(()=>[]);
  if (platformRows[0]) return true;
  const rows = await dbGet(env, 'staff', `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&select=email,is_active,active`).catch(()=>[]);
  if (!rows[0]) return false;
  const active = rows[0].is_active !== undefined ? rows[0].is_active : rows[0].active;
  return active !== false;
}

// 輔助：檢查是否為 member
async function checkIsMember(env, email, tenantId) {
  const rows = await dbGet(env, 'members', `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&select=email`).catch(()=>[]);
  return rows.length > 0;
}

// 輔助：用 email 簽發 staff token
async function issueStaffTokenByEmail(env, email, tenantId) {
  const platformRows = await dbGet(env, 'platform_staff', `email=eq.${encodeURIComponent(email)}&is_active=eq.true&select=*`).catch(()=>[]);
  if (platformRows[0]) return issueAdminToken({
    ...platformRows[0], email, role:'platform_super_admin', normalized_role:'platform_super_admin',
  }, 'platform', env);
  const rows = await dbGet(env, 'staff', `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&select=*`).catch(()=>[]);
  if (!rows[0]) throw new Error('staff not found');
  const active = rows[0].is_active !== undefined ? rows[0].is_active : rows[0].active;
  if (active === false) throw new Error('staff inactive');
  return issueAdminToken({ ...rows[0], email }, tenantId, env);
}

// 輔助：更新 staff 最後登入
async function updateStaffLastLogin(env, email, tenantId, displayName) {
  await dbUpdate(env, 'staff', `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}`,
    { last_login_at: new Date().toISOString(), display_name: displayName }).catch(()=>{});
}

// 輔助：更新 member 最後登入 + Google 資料
async function updateMemberLastLogin(env, email, tenantId, googleSub, displayName, avatarUrl) {
  const rows = await dbGet(env, 'members', `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&select=email`).catch(()=>[]);
  if (rows[0]) {
    await dbUpdate(env, 'members', `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}`,
      { last_login_at: new Date().toISOString(), google_sub: googleSub, display_name: displayName, avatar_url: avatarUrl, login_provider: 'google' }).catch(()=>{});
  } else {
    // 新會員：建立記錄
    await dbInsert(env, 'members', {
      email, tenant_id: tenantId, google_sub: googleSub,
      display_name: displayName, avatar_url: avatarUrl,
      login_provider: 'google', last_login_at: new Date().toISOString(),
      joined_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).catch(()=>{});
  }
}

// ── 申請試用 API ──────────────────────────────────────────────────

// POST /apply — 客戶申請試用（不需登入）
async function hApplyTrial(env, b) {
  return jsonErr('2BL 未開放自助申請，請直接聯繫管理者');
}

// POST /approveApply — 你的一鍵開通（需平台管理員身份）
async function hApproveApply(env, b) {
  return jsonErr('2BL 未開放自助租戶開通');
}

// GET /apply/list — 查詢申請列表（平台管理員用）
// GET /getTenantsAdmin — 平台管理員查詢所有租戶
// BUG-B FIX 2025-06
async function hGetTenantsAdmin(env, p) {
  const payload = await verifyAdminJwt(p.token, env);
  if (!payload || !await verifyPlatformSuperAdmin(env, payload.email, p.token, p.tenant || p.tenant_id || 'platform')) return jsonErr('無權限', 401);
  const rows = await dbGet(env, 'tenants',
    'order=created_at.desc&select=id,name,slug,plan_type,is_locked,locked_reason,trial_start_at,trial_end_at,session_count_used,contact_name,contact_phone,notify_email,created_at'
  );
  return jsonOk(rows);
}

async function hApplyList(env, p) {
  const payload = await verifyAdminJwt(p.token, env);
  if (!payload || !await verifyPlatformSuperAdmin(env, payload.email, p.token, p.tenant || p.tenant_id || 'platform')) return jsonErr('無權限', 401);
  return jsonOk([]);
}

// ── 鎖定 / 停用機制 API ──────────────────────────────────────────

// POST /lockTenant — 鎖定租戶（平台管理員用）
async function hLockTenant(env, b) {
  const payload = await verifyAdminJwt(b.token, env);
  if (!payload || !await verifyPlatformSuperAdmin(env, payload.email, b.token, b.tenant || b.tenant_id || 'platform')) return jsonErr('無權限', 401);
  await dbUpdate(env, 'tenants', `id=eq.${b.tenant_id}`, {
    is_locked: true,
    locked_at: new Date().toISOString(),
    locked_reason: b.reason || '帳號鎖定',
    updated_at: new Date().toISOString(),
  });
  return jsonOk({ ok: true });
}

// POST /unlockTenant — 解鎖租戶（收到付款後）
async function hUnlockTenant(env, b) {
  const payload = await verifyAdminJwt(b.token, env);
  if (!payload || !await verifyPlatformSuperAdmin(env, payload.email, b.token, b.tenant || b.tenant_id || 'platform')) return jsonErr('無權限', 401);
  const now = new Date();
  const newEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await dbUpdate(env, 'tenants', `id=eq.${b.tenant_id}`, {
    is_locked: false,
    locked_at: null,
    locked_reason: null,
    plan_type: 'active',
    trial_end_at: newEnd.toISOString(),
    updated_at: now.toISOString(),
  });
  // 2BL 沒有第二套 billing_logs；續費操作統一寫入既有 audit_logs。
  await dbInsert(env, 'audit_logs', {
    id: genId('AUD'),
    tenant_id: b.tenant_id,
    actor_email: payload.email || '',
    actor_role: payload.normalized_role || payload.role || 'platform_super_admin',
    action: 'tenant_manual_renewal_confirmed',
    target_table: 'tenants',
    target_id: b.tenant_id,
    before_json: {},
    after_json: { plan_type: 'active', trial_end_at: newEnd.toISOString() },
    meta_json: {
      amount: Number(b.amount) || 0,
      tax: Number(b.tax) || 0,
      total: (Number(b.amount) || 0) + (Number(b.tax) || 0),
      note: b.note || '手動續費'
    },
    created_at: now.toISOString(),
  });
  // 寄通知給客戶
  const tenant = (await dbGet(env, 'tenants', `id=eq.${b.tenant_id}&select=notify_email,name`))[0];
  if (tenant?.notify_email) {
    await sendEmail(env, {
      to: tenant.notify_email,
      subject: '【兔彼樂市集活動系統】您的帳號已恢復正常',
      html: `<p>您好！您的帳號已恢復正常，可以繼續使用所有功能。</p><p>有效期至：${newEnd.toLocaleDateString('zh-TW')}</p>`,
    }).catch(()=>{});
  }
  return jsonOk({ ok: true });
}

// ── 場次下載 Excel ────────────────────────────────────────────────

// GET /downloadSession — 下載單場次完整 Excel
async function hDownloadSession(env, p) {
  const TENANT = p._tenantId;
  if (!await verifyStaff(env, p.email, p.token, TENANT)) return jsonErr('無權限');

  const lockCheck = await checkTenantLocked(env, TENANT);
  if (lockCheck.locked) return jsonErr('帳號已鎖定，無法下載資料，請先續費');

  const sesId = p.sessionId;
  if (!sesId) return jsonErr('請指定場次');

  const sessions = await dbGet(env, 'sessions', `id=eq.${sesId}&tenant_id=eq.${TENANT}&select=*`);
  const session = sessions[0];
  if (!session) return jsonErr('找不到場次');

  const regs = await dbGet(env, 'registrations',
    `session_id=eq.${sesId}&tenant_id=eq.${TENANT}&select=*&order=created_at.asc`);
  const itemMap = await _getRegistrationItemsForRegs(env, regs);

  const regHeaders = ['報名編號','品牌名稱','聯絡人','Email','電話','攤位號碼','設備','攤位數','應收金額','押金','審核狀態','繳費狀態','報到狀態','申請時間'];
  const regRows = regs.map(r => {
    const money = _regFinanceAmounts(r, session, itemMap[r.id]);
    return [
      r.registration_no || r.id,
      r.brand_name || r.brand || '',
      r.name || '',
      r.email || '',
      r.phone || '',
      r.stall_number || r.stall_no || '',
      _equipmentTextFromMap(_effectiveEquipmentMapForReg(r, session)),
      safeNum(r.stall_count) || 1,
      money.cashTotal,
      money.depositTotal,
      _reviewStatus(r) || '',
      _payStatus(r) || '',
      _checkinStatus(r) || '',
      r.created_at ? new Date(r.created_at).toLocaleString('zh-TW') : '',
    ];
  });

  const activeRegs = regs.filter(_isActiveFinanceReg);
  const receivableRegs = activeRegs.filter(_isReceivableReg);
  const receivedRegs = activeRegs.filter(_isConfirmedPaidReg);
  const paidWorkflowRegs = activeRegs.filter(_isPaidReg);
  const totalReceivable = _sumCash(receivableRegs, session, itemMap);
  const totalReceived = _sumCash(receivedRegs, session, itemMap);
  const totalDeposit = _sumDeposit(receivedRegs, session, itemMap);
  const refundTotal = regs.reduce((sum,r)=>sum+_officialRefund(r),0);
  const invoiceTotal = receivedRegs.reduce((sum,r)=>{
    const m = _regFinanceAmounts(r, session, itemMap[r.id]);
    return sum + Math.max(0, m.cashTotal - m.depositTotal);
  },0);

  const finHeaders = ['項目','數值'];
  const finRows = [
    ['有效報名筆數', activeRegs.length],
    ['待審核筆數', activeRegs.filter(r=>_reviewStatus(r)==='待審核').length],
    ['已錄取筆數', activeRegs.filter(_isApprovedReg).length],
    ['未繳費筆數', activeRegs.filter(r=>_isApprovedReg(r) && (!_payStatus(r) || _payStatus(r)==='未繳費')).length],
    ['付款待確認筆數', activeRegs.filter(r=>_isApprovedReg(r) && _isPendingPaymentReg(r)).length],
    ['已繳費／免費筆數', paidWorkflowRegs.length],
    ['應收總額（含押金）', totalReceivable],
    ['已收總額（含押金）', totalReceived],
    ['未收總額', Math.max(0, totalReceivable - totalReceived)],
    ['已收押金', totalDeposit],
    ['已收發票金額（不含押金）', invoiceTotal],
    ['已退費金額', refundTotal],
  ];

  return jsonOk({
    session: {
      name: session.name,
      date: session.dates_json ? safeJson(session.dates_json, [])[0]?.date || '' : '',
      venue: session.venue || '',
    },
    registrations: { headers: regHeaders, rows: regRows },
    finance: { headers: finHeaders, rows: finRows },
  });
}


// ── Cron：試用到期提醒 ────────────────────────────────────────────
async function cronTrialExpireReminders(env) {
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 找 7 天後到期的試用帳號
  const expiring = await dbGet(env, 'tenants',
    `plan_type=eq.trial&is_locked=eq.false&trial_end_at=lte.${sevenDaysLater.toISOString()}&trial_end_at=gte.${now.toISOString()}&select=id,name,notify_email,trial_end_at`
  ).catch(()=>[]);

  for (const t of expiring) {
    if (!t.notify_email) continue;
    const endDate = new Date(t.trial_end_at).toLocaleDateString('zh-TW');
    await sendEmail(env, {
      to: t.notify_email,
      subject: `【兔彼樂市集活動系統】您的試用將於 ${endDate} 到期`,
      html: `
        <h2>試用期即將結束</h2>
        <p>您好！您的「${t.name}」試用帳號將於 <b>${endDate}</b> 到期。</p>
        <p>到期後帳號將自動鎖定，功能暫停使用，但歷史資料保留。</p>
        <p>如需繼續使用，請聯繫我們續費：</p>
        <p>Email：ndiangrace@gmail.com</p>
        <p>LINE：@2beloved</p>
      `,
    }).catch(()=>{});
  }

  // 自動鎖定已到期的試用帳號
  const expired = await dbGet(env, 'tenants',
    `plan_type=eq.trial&is_locked=eq.false&trial_end_at=lt.${now.toISOString()}&select=id,name,notify_email`
  ).catch(()=>[]);

  for (const t of expired) {
    await dbUpdate(env, 'tenants', `id=eq.${t.id}`, {
      is_locked: true,
      locked_at: now.toISOString(),
      locked_reason: '試用期已結束',
      updated_at: now.toISOString(),
    }).catch(()=>{});

    if (!t.notify_email) continue;
    await sendEmail(env, {
      to: t.notify_email,
      subject: '【兔彼樂市集活動系統】試用期已結束，帳號已鎖定',
      html: `
        <h2>試用期已結束</h2>
        <p>您的帳號已鎖定，目前只能查看歷史資料，無法新增或操作。</p>
        <p>如需繼續使用，請聯繫我們續費：</p>
        <p>Email：ndiangrace@gmail.com</p>
        <p>LINE：@2beloved</p>
      `,
    }).catch(()=>{});
  }
}



// GET /auth/google/start
async function hGoogleStart(env, url) {
  const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
  const GOOGLE_REDIRECT_URI = env.GOOGLE_REDIRECT_URI;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    return new Response('Google OAuth 未設定，請檢查 Cloudflare Worker 環境變數', { status: 500 });
  }
  const tenant = url.searchParams.get('tenant') || 'tuibile';
  // state = base64(tenant:timestamp:hmac) 防 CSRF
  const rawState = `${tenant}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const state = btoa(rawState);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

// GET /auth/google/callback
async function hGoogleCallback(env, url) {
  const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
  const GOOGLE_REDIRECT_URI = env.GOOGLE_REDIRECT_URI;
  const ADMIN_SITE_URL = env.ADMIN_SITE_URL || '';

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  const failRedirect = (reason) => {
    const u = new URL(ADMIN_SITE_URL || 'https://2b-love.com/admin.html');
    u.searchParams.set('login_error', reason);
    return Response.redirect(u.toString(), 302);
  };

  if (errorParam) return failRedirect('google_cancelled');
  if (!code || !state) return failRedirect('missing_params');

  // 解碼 state，取 tenant
  let tenant = 'tuibile';
  try {
    const raw = atob(state);
    tenant = raw.split(':')[0] || 'tuibile';
  } catch(e) { return failRedirect('invalid_state'); }

  // 用 code 換 token
  let tokenRes;
  try {
    tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    }).then(r => r.json());
  } catch(e) {
    await logAdminLogin(env, tenant, null, '', 'google', 'error', 'token_exchange_failed', '', '');
    return failRedirect('token_exchange_failed');
  }

  if (!tokenRes.id_token) {
    await logAdminLogin(env, tenant, null, '', 'google', 'error', 'no_id_token', '', '');
    return failRedirect('no_id_token');
  }

  // 驗證 id_token（向 Google tokeninfo 端點驗證）
  let userInfo;
  try {
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${tokenRes.id_token}`);
    userInfo = await infoRes.json();
    if (userInfo.error || userInfo.aud !== GOOGLE_CLIENT_ID) throw new Error('invalid_token');
  } catch(e) {
    await logAdminLogin(env, tenant, null, '', 'google', 'denied', 'id_token_verify_failed', '', '');
    return failRedirect('id_token_verify_failed');
  }

  const googleEmail = (userInfo.email || '').toLowerCase();
  const googleName = userInfo.name || '';
  if (!googleEmail) return failRedirect('no_email');

  // 查 platform_staff（跨 tenant 超管）
  const platformRows = await dbGet(env, 'platform_staff',
    `email=eq.${encodeURIComponent(googleEmail)}&is_active=eq.true&select=*`).catch(()=>[]);
  if (platformRows[0]) {
    const ps = platformRows[0];
    const adminToken = await issueAdminToken({
      ...ps, email: googleEmail, name: ps.name||googleName,
      role:'platform_super_admin', normalized_role:'platform_super_admin',
    }, 'platform', env);
    await dbUpdate(env, 'platform_staff', `email=eq.${encodeURIComponent(googleEmail)}`, { last_login_at: new Date().toISOString() });
    await logAdminLogin(env, tenant, ps.id, googleEmail, 'google', 'success', '', '', '');
    const u = new URL(ADMIN_SITE_URL || 'https://2b-love.com/admin.html');
    u.searchParams.set('admin_token', adminToken);
    u.searchParams.set('tenant', tenant);
    return Response.redirect(u.toString(), 302);
  }

  // 查 tenant staff
  const rows = await dbGet(env, 'staff',
    `tenant_id=eq.${tenant}&email=eq.${encodeURIComponent(googleEmail)}&select=*`);
  const staff = rows[0];

  if (!staff) {
    await logAdminLogin(env, tenant, null, googleEmail, 'google', 'denied', 'email_not_in_staff', '', '');
    return failRedirect('not_authorized');
  }
  // is_active 欄位（相容 active / is_active 兩種欄位名）
  const isActive = staff.is_active !== undefined ? staff.is_active : staff.active;
  if (!isActive) {
    await logAdminLogin(env, tenant, staff.id, googleEmail, 'google', 'denied', 'staff_inactive', '', '');
    return failRedirect('staff_inactive');
  }

  // 更新 last_login_at / display_name
  await dbUpdate(env, 'staff', `id=eq.${encodeURIComponent(staff.id)}`, { last_login_at: new Date().toISOString(), display_name: staff.display_name||googleName }).catch(()=>{});

  const adminToken = await issueAdminToken({ ...staff, email: googleEmail }, tenant, env);
  await logAdminLogin(env, tenant, staff.id, googleEmail, 'google', 'success', '', '', '');

  const u = new URL(ADMIN_SITE_URL || 'https://2b-love.com/admin.html');
  u.searchParams.set('admin_token', adminToken);
  u.searchParams.set('tenant', tenant);
  return Response.redirect(u.toString(), 302);
}

// POST /admin/logout
async function hAdminLogout(env, b) {
  // 前端負責清除 token；後端可在此將 token 加入黑名單（可擴充）
  // 目前：記錄登出事件
  if (b && b.email && b.token) {
    const payload = await verifyAdminJwt(b.token, env).catch(()=>null);
    if (payload) {
      await logAdminLogin(env, payload.tenant_id||'', payload.staff_id||'', payload.email||b.email, 'google', 'success', 'logout', '', '');
    }
  }
  return jsonOk({ ok: true, message: '已登出' });
}

// GET /admin/me
async function hAdminMe(env, p) {
  const token = p.token || p.admin_token;
  const email = p.email;
  if (!token) return jsonErr('未帶 token', 401);
  const payload = await verifyAdminJwt(token, env);
  if (!payload) return jsonErr('token 無效或已過期，請重新登入', 401);
  // email=_ 表示由 JWT 自行驗證，不做 email 比對
  if (email && email !== '_' && email !== '__jwt__' && payload.email !== email) return jsonErr('token 與 email 不符', 401);
  const tokenRole = String(payload.normalized_role || payload.role || '').trim();
  const authTenant = tokenRole === 'platform_super_admin'
    ? String(p.tenant || p.tenantId || payload.tenant_id || 'platform')
    : String(payload.tenant_id || '');
  const auth = await loadFreshAdminAuthorization(env, payload.email, token, authTenant);
  if (!auth) return jsonErr('管理者已停用、權限範圍無效或不完整，請聯絡平台管理者', 401);
  return jsonOk({
    email: auth.email,
    tenant_id: tokenRole === 'platform_super_admin' ? 'platform' : auth.tenantId,
    staff_id: auth.staffId,
    role: auth.role,
    normalized_role: auth.role,
    display_name: auth.displayName,
    authorization: {
      role: auth.role,
      scopeType: auth.scopeType,
      scopeEventId: auth.scopeEventId,
      allowedSessionIds: auth.allowedSessionIds,
      capabilities: auth.capabilities,
    },
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
  });
}

// 記錄登入 log
async function logAdminLogin(env, tenantId, staffId, email, provider, status, reason, ip, ua) {
  if (!tenantId) return;
  try {
    await dbInsert(env, 'staff_action_logs', {
      id: genId('LOG'),
      tenant_id: tenantId,
      staff_id: staffId || null,
      staff_email: email || '',
      action_type: status === 'success' ? 'admin_auth_success' : 'admin_auth_failure',
      target_type: 'authentication',
      target_id: staffId || email || null,
      before_data: null,
      after_data: null,
      meta_json: {
        provider: provider || 'google',
        status: status || 'error',
        reason: reason || '',
        ip: ip || '',
        user_agent: ua || ''
      },
      created_at: new Date().toISOString(),
    });
  } catch(e) { /* 登入 log 失敗不影響主流程 */ }
}

// adminLogin（保留用於緊急後門，但改為需要系統設定的 EMERGENCY_ADMIN_KEY）
async function hAdminLogin(env, p) {
  // Google OAuth 升級後，此 endpoint 僅供緊急恢復用
  // 必須提供 EMERGENCY_ADMIN_KEY 環境變數才能使用
  const emergencyKey = env.EMERGENCY_ADMIN_KEY;
  if (!emergencyKey) return jsonErr('Email 直接登入已停用，請使用 Google OAuth 登入');
  if (!p.emergency_key || p.emergency_key !== emergencyKey) return jsonErr('無效的緊急登入金鑰');

  const TENANT = p && p._tenantId;
  if (!TENANT) return jsonErr('缺少 tenant 參數');
  if (!p.email) return jsonErr('請提供 email');

  const platformRows = await dbGet(env, 'platform_staff',
    `email=eq.${encodeURIComponent(p.email)}&is_active=eq.true&select=*`).catch(()=>[]);
  if (platformRows.length) {
    const ps = platformRows[0];
    const token = await issueAdminToken({
      ...ps, email: p.email, role:'platform_super_admin', normalized_role:'platform_super_admin',
    }, 'platform', env);
    const tc = await getTenantCtx(env, TENANT);
    return jsonOk({ success:true, role:'platform_super_admin', name:ps.name||'', token, tenantId:TENANT, tenantName:tc.name, isPlatformStaff:true });
  }

  const rows = await dbGet(env, 'staff', `tenant_id=eq.${TENANT}&email=eq.${encodeURIComponent(p.email)}&select=*`);
  if (!rows.length) return jsonErr('此帳號無管理員權限');
  const isActive = rows[0].is_active;
  if (!isActive) return jsonErr('此帳號已停用');
  const token = await issueAdminToken({ ...rows[0], email: p.email }, TENANT, env);
  const tc = await getTenantCtx(env, TENANT);
  return jsonOk({ success:true, role:rows[0].role, name:rows[0].name||'', token, tenantId:TENANT, tenantName:tc.name });
}

// getDashboard
async function hGetDashboard(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env, p.email, p.token, TENANT)) return jsonErr('無權限');
  let qs = `tenant_id=eq.${TENANT}&select=review_status,payment_status,amount,transfer_status,refund_amount`;
  if (p.sessionId) qs += `&session_id=eq.${encodeURIComponent(p.sessionId)}`;
  if (p.eventId)   qs += `&event_id=eq.${encodeURIComponent(p.eventId)}`;
  const [regsRaw, sesCntRaw, evtCntRaw] = await Promise.all([
    dbGet(env, 'registrations', qs),
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&status=eq.%E5%A0%B1%E5%90%8D%E4%B8%AD&select=id`),
    dbGet(env, 'events', `tenant_id=eq.${TENANT}&status=neq.%E5%81%9C%E7%94%A8&select=id`),
  ]);
  const regs = _scopeRows(p, regsRaw);
  const sesCnt = _scopeSessionRows(p, sesCntRaw);
  const evtCnt = _scopeEventRows(p, evtCntRaw);
  const activeRegs = regs.filter(r => !_isCancelledReg(r));
  const paidList = activeRegs.filter(r=>isPaidStatus(r.payment_status));
  return jsonOk({
    total:activeRegs.length,
    pending:activeRegs.filter(r=>r.review_status==='待審核').length,
    approved:activeRegs.filter(r=>r.review_status==='已錄取').length,
    rejected:regs.filter(r=>r.review_status==='不錄取').length,
    paid:paidList.length,
    revenue:paidList.reduce((s,r)=>s+(Number(r.amount)||0),0) - regs.reduce((s,r)=>s+safeNum(r.refund_amount),0),
    sessionCount:sesCnt.length, eventCount:evtCnt.length,
  });
}


// adminBusinessOverview：後台「總覽」頁使用。
// 原則：所有數字由 Worker 從同一份 Supabase 即時計算，前端只負責顯示。
function _adminDateInRange(dateStr, start, end){
  const d = new Date(dateStr || '');
  if (isNaN(d.getTime())) return false;
  return d >= start && d < end;
}
function _adminMonthStart(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function _adminNextMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 1); }
function _adminQuarterStart(d){ const q=Math.floor(d.getMonth()/3)*3; return new Date(d.getFullYear(), q, 1); }
function _adminNextQuarter(d){ const q=Math.floor(d.getMonth()/3)*3; return new Date(d.getFullYear(), q+3, 1); }
function _adminYearStart(d){ return new Date(d.getFullYear(),0,1); }
function _adminNextYear(d){ return new Date(d.getFullYear()+1,0,1); }
function _sessionDateValue(s){
  const dates = safeJson(s.dates_json || s.dates || s.date_json, []);
  if (Array.isArray(dates) && dates.length) {
    const parts = dates.map(d => typeof d === 'object' ? (d.date || d.day || d.start || d.startDate || '') : String(d||'')).filter(Boolean);
    if (parts.length) return parts.join('、');
  }
  return s.date || s.event_date || s.start_date || s.created_at || '';
}
function _sessionVenueValue(s){ return String(s.region||s.location||s.venue||s.place||'未設定場域').trim() || '未設定場域'; }
function _sessionTypeValue(s){ return String(s.type||s.category||s.registration_type||s.kind||'未設定類型').trim() || '未設定類型'; }
function _regStatus(r){ return String(r.status || r.reg_status || '').trim(); }
function _reviewStatus(r){ return String(r.review_status || r.status || '').trim(); }
function _payStatus(r){ return String(r.payment_status || r.pay_status || '').trim(); }
function _transferStatus(r){ return String(r.transfer_status || r.refund_status || '').trim(); }
function _checkinStatus(r){ return String(r.checkin_status || r.checkin || '').trim(); }
function _clearStatus(r){ return String(r.clear_status || r.clearStatus || '').trim(); }
function _depositStatus(r){ return String(r.deposit_refunded || r.depositRefunded || '').trim(); }
function _invoiceStatus(r){ return String(r.invoice_status || r.invoiceStatus || '').trim(); }
function _firstNum() {
  for (const v of arguments) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return 0;
}
function _isFreePay(r){ return _payStatus(r)==='免費' || (safeNum(r.amount)===0 && safeNum(r.total_amount)===0 && _payStatus(r).includes('免費')); }
function _isPaidReg(r){ return isPaidStatus(_payStatus(r)) || _isFreePay(r); }
function _isConfirmedPaidReg(r){ return isPaidStatus(_payStatus(r)); }
function _isCancelledReg(r){
  const rev=_reviewStatus(r), st=_regStatus(r), tr=_transferStatus(r), pay=_payStatus(r);
  if (['已取消','不錄取','未錄取'].includes(rev) || st==='cancelled') return true;
  if (isCapacityInactiveTransferStatus(tr)) return true;
  if (['已退費','已退款'].includes(pay)) return true;
  return false;
}
function _isApprovedReg(r){ return _reviewStatus(r)==='已錄取'; }
function _isReceivableReg(r){
  if (_isCancelledReg(r)) return false;
  const p = _payStatus(r);
  // 應收只認「已錄取後」的正式金額：未繳費、付款待確認、已繳費／已付款、免費。
  return _isApprovedReg(r) || _isPendingPaymentReg(r) || _isPaidReg(r) || p === '未繳費';
}
function _officialAmount(r){ return safeNum(_firstNum(r.amount, r.total_amount, r.total, r.registration_total_amount)); }
function _sessionDeposit(s){ return safeNum(_firstNum(s && s.deposit, s && s.deposit_amount, s && s.deposit_total)); }
// 一筆報名只會有一筆押金；多日或多攤都不能把押金乘上日期／攤數。
// sessions.deposit 是正式場次設定，舊資料若曾重複寫入，財務彙總仍封頂為該場押金。
function _singleRegistrationDeposit(r, s, rawDeposit){
  const sessionDeposit = _sessionDeposit(s);
  const ownDeposit = safeNum(_firstNum(r && r.deposit, r && r.deposit_total, r && r.deposit_amount));
  const configured = sessionDeposit > 0 ? sessionDeposit : ownDeposit;
  const raw = safeNum(rawDeposit);
  if (configured > 0) return Math.max(0, raw > 0 ? Math.min(raw, configured) : configured);
  return Math.max(0, raw);
}
function _regDeposit(r, s){
  const own = safeNum(_firstNum(r.deposit, r.deposit_total, r.deposit_amount));
  return _singleRegistrationDeposit(r, s, own);
}
function _officialDeposit(r, s){ return _regDeposit(r, s); }
function _officialRefund(r){ return safeNum(_firstNum(r.refund_amount, r.refund_total)); }
function _equipmentEntries(r){
  // 從資料庫既有欄位抽取設備，不用前端猜、不用假資料。
  // 相容新舊欄位：equipment_json / equip_json / equipment / equip / equipment_text。
  const out = [];
  const push = (name, qty) => {
    name = normalizeEquipName(String(name || '').trim().replace(/^設備[:：]?/, ''));
    const n = Number(qty) || 0;
    if (!name || n <= 0) return;
    if (/^(無|沒有|未加購|不需|none)$/i.test(name)) return;
    out.push([name, n]);
  };
  const parseObj = (obj) => {
    obj = safeJson(obj, null);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    Object.entries(obj).forEach(([k,v]) => {
      if (v && typeof v === 'object') {
        push(k, v.qty ?? v.count ?? v.quantity ?? v.value ?? v.num ?? 0);
      } else {
        push(k, v);
      }
    });
  };
  parseObj(r.equipment_json);
  parseObj(r.equip_json);
  parseObj(r.equipment);
  parseObj(r.equip);

  const text = String(r.equipment_text || r.equipmentText || r.equip_text || r.equipment_summary || '').trim();
  if (text && !/^(無|沒有|未加購|不需|none)$/i.test(text)) {
    text.split(/[、,，;；\n]+/).forEach(part => {
      let s = String(part || '').trim();
      if (!s) return;
      s = s.replace(/^設備[:：]/, '').trim();
      let m = s.match(/^(.+?)[xX×＊*]\s*(\d+(?:\.\d+)?)$/);
      if (!m) m = s.match(/^(.+?)[：:]\s*(\d+(?:\.\d+)?)$/);
      if (!m) m = s.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
      if (m) push(m[1], m[2]);
    });
  }
  const merged = {};
  out.forEach(([k,v]) => { merged[k] = (merged[k] || 0) + Number(v || 0); });
  return Object.entries(merged);
}
function _inc(map, key, n=1){ key=String(key||'未設定').trim()||'未設定'; map[key]=(map[key]||0)+n; }
function _mapToRows(map){ return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count})); }
function _aggregateBiz(sessions, regs, members, staff, start, end){
  const sesMap={}; sessions.forEach(s=>{sesMap[s.id]=s;});
  const ses = sessions.filter(s => !start || _adminDateInRange(_sessionDateValue(s), start, end));
  const sesIds = new Set(ses.map(s=>s.id));
  const rgs = regs.filter(r => !start ? true : (sesIds.has(r.session_id) || _adminDateInRange(r.created_at, start, end)));
  const activeRgs = rgs.filter(_isActiveFinanceReg);
  const paid = activeRgs.filter(_isPaidReg);
  const brandSet = new Set();
  rgs.forEach(r=>{ const k=String(r.brand_name||r.brand||r.name||r.email||'').trim(); if(k) brandSet.add(k); });
  const memberSet = new Set();
  (members||[]).forEach(m=>{ if(!start || _adminDateInRange(m.updated_at||m.joined_at, start, end)){ const k=String(m.email||'').trim(); if(k) memberSet.add(k); } });
  const venueSet = new Set();
  ses.forEach(s=>{ const v=_sessionVenueValue(s); if(v) venueSet.add(v); });
  const equipmentMap={};
  rgs.forEach(r=>Object.entries(_effectiveEquipmentMapForReg(r, sesMap[r.session_id] || {})).forEach(([k,v])=>_inc(equipmentMap,k,v)));
  const totalIncome = paid.reduce((sum,r)=>sum+_officialAmount(r),0);
  const depositTotal = paid.filter(_isConfirmedPaidReg).reduce((sum,r)=>sum+_regDeposit(r, sesMap[r.session_id]),0);
  const refundTotal = rgs.reduce((sum,r)=>sum+_officialRefund(r),0);
  const operatingRevenue = Math.max(0, totalIncome - depositTotal);
  return {
    sessions: ses.length,
    activeSessions: ses.filter(s=>!['停用','關閉','已關閉','封存'].includes(String(s.status||''))).length,
    registrations: rgs.length,
    members: memberSet.size,
    pending: rgs.filter(r=>_reviewStatus(r)==='待審核').length,
    approved: rgs.filter(r=>_reviewStatus(r)==='已錄取').length,
    waitlist: rgs.filter(r=>_reviewStatus(r)==='備取').length,
    rejected: rgs.filter(r=>_reviewStatus(r)==='不錄取').length,
    cancelled: rgs.filter(r=>_reviewStatus(r)==='已取消' || _regStatus(r)==='cancelled').length,
    unpaid: rgs.filter(r=>_payStatus(r)==='未繳費').length,
    paymentPending: rgs.filter(r=>_payStatus(r)==='待確認').length,
    paid: paid.length,
    free: rgs.filter(_isFreePay).length,
    totalIncome,
    operatingRevenue,
    grossRevenue: operatingRevenue,
    depositTotal,
    refundTotal,
    // 已退費報名已由 activeRgs 排除；退款只保留為歷史紀錄，不可再次扣除。
    netRevenue: operatingRevenue,
    brands: brandSet.size,
    venues: venueSet.size,
    checkinDone: rgs.filter(r=>_checkinStatus(r)==='已報到').length,
    checkinNotYet: rgs.filter(r=>_checkinStatus(r)==='未報到' || !_checkinStatus(r)).length,
    absent: rgs.filter(r=>_checkinStatus(r)==='未到').length,
    clearDone: rgs.filter(r=>_clearStatus(r)==='已清場').length,
    depositRefunded: rgs.filter(r=>_depositStatus(r)==='已退押金').length,
    depositForfeited: rgs.filter(r=>_depositStatus(r)==='押金沒收').length,
    invoiceCount: rgs.filter(r=>String(r.invoice_type||r.invoice_title||r.tax_id||r.invoice_email||'').trim()).length,
    invoiceIssued: rgs.filter(r=>_invoiceStatus(r)==='已開立' || _invoiceStatus(r)==='已寄出').length,
    equipmentTotal: Object.values(equipmentMap).reduce((a,b)=>a+b,0),
    equipmentItems: _mapToRows(equipmentMap).slice(0,10),
  };
}
function _financeIssuesForReg(r){
  const issues=[];
  const st=_payStatus(r), rev=_reviewStatus(r), tr=_transferStatus(r);
  const amt=_officialAmount(r), total=safeNum(r.total_amount), deposit=_officialDeposit(r);
  if(_isPaidReg(r) && amt<=0 && !_isFreePay(r)) issues.push('已付款但金額為 0 或缺失');
  if(st==='待確認' && amt<=0) issues.push('付款待確認但金額為 0 或缺失');
  if((rev==='已取消' || _regStatus(r)==='cancelled') && _isPaidReg(r) && !['已退費','refunded'].includes(tr)) issues.push('已取消但仍為已付款且未完成退費');
  if(deposit<0) issues.push('押金金額異常');
  if(total>0 && amt>0 && Math.abs(total-amt)>1 && !String(st).includes('待')) issues.push('amount 與 total_amount 不一致');
  if(st==='待確認' && !String(r.payment_method||r.pay_method||r.payment_last5||r.payment_reported_at||'').trim()) issues.push('付款待確認但缺付款資料');
  return issues;
}
async function hAdminBusinessOverview(env, p){
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env, p.email, p.token, TENANT)) return jsonErr('無權限');
  const [sessionsRaw, regsRaw, membersRaw, staffRaw, eventsRaw, agreementsRaw] = await Promise.all([
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
    dbGet(env, 'members', `tenant_id=eq.${TENANT}&select=email,joined_at,updated_at`).catch(()=>[]),
    dbGet(env, 'staff', `tenant_id=eq.${TENANT}&select=id,email,name,role,is_active,active,created_at`).catch(()=>[]),
    dbGet(env, 'events', `tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
    dbGet(env, 'tenant_agreement_templates', `tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
  ]);
  const sessions = _scopeSessionRows(p, sessionsRaw);
  const regs = _scopeRows(p, regsRaw);
  const events = _scopeEventRows(p, eventsRaw);
  const scopedEmails = new Set(regs.map(r=>String(r.email||'').trim().toLowerCase()).filter(Boolean));
  const members = p._authz && p._authz.allowedSessionIds !== null
    ? membersRaw.filter(m=>scopedEmails.has(String(m.email||'').trim().toLowerCase())) : membersRaw;
  const staff = p._authz && p._authz.allowedSessionIds !== null ? [] : staffRaw;
  const agreements = p._authz && p._authz.allowedSessionIds !== null ? [] : agreementsRaw;
  const now = new Date();
  const month = _aggregateBiz(sessions, regs, members, staff, _adminMonthStart(now), _adminNextMonth(now));
  const quarter = _aggregateBiz(sessions, regs, members, staff, _adminQuarterStart(now), _adminNextQuarter(now));
  const year = _aggregateBiz(sessions, regs, members, staff, _adminYearStart(now), _adminNextYear(now));
  const all = _aggregateBiz(sessions, regs, members, staff, null, null);

  const byVenueMap={}, byTypeMap={}, bySession=[];
  sessions.forEach(s=>{
    _inc(byVenueMap, _sessionVenueValue(s));
    _inc(byTypeMap, _sessionTypeValue(s));
    const list=regs.filter(r=>r.session_id===s.id);
    const paid=list.filter(_isActiveFinanceReg).filter(_isPaidReg);
    const totalIncome=paid.reduce((sum,r)=>sum+_officialAmount(r),0);
    const depositTotal=paid.filter(_isConfirmedPaidReg).reduce((sum,r)=>sum+_regDeposit(r, s),0);
    bySession.push({
      id:s.id, name:s.name||s.title||s.id, date:_sessionDateValue(s), venue:_sessionVenueValue(s), status:s.status||'',
      total:list.length,
      pending:list.filter(r=>_reviewStatus(r)==='待審核').length,
      approved:list.filter(r=>_reviewStatus(r)==='已錄取').length,
      paymentPending:list.filter(r=>_payStatus(r)==='待確認').length,
      paid:paid.length,
      totalIncome,
      revenue:Math.max(0,totalIncome-depositTotal),
      depositTotal,
      checkinDone:list.filter(r=>_checkinStatus(r)==='已報到').length,
    });
  });
  bySession.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));

  const financeRows=[];
  regs.forEach(r=>_financeIssuesForReg(r).forEach(issue=>financeRows.push({
    id:r.id, session_id:r.session_id, email:r.email, name:r.brand_name||r.brand||r.name||'', issue,
    amount:_officialAmount(r), total_amount:safeNum(r.total_amount), payment_status:_payStatus(r), review_status:_reviewStatus(r)
  })));
  const activeStaff = staff.filter(s=>s.is_active!==false && s.active!==false);
  return jsonOk({
    generatedAt: new Date().toISOString(),
    month, quarter, year, all,
    registrationStatus: {
      total: regs.length,
      pendingReview: regs.filter(r=>_reviewStatus(r)==='待審核').length,
      approved: regs.filter(r=>_reviewStatus(r)==='已錄取').length,
      waitlist: regs.filter(r=>_reviewStatus(r)==='備取').length,
      rejected: regs.filter(r=>_reviewStatus(r)==='不錄取').length,
      cancelled: regs.filter(r=>_reviewStatus(r)==='已取消' || _regStatus(r)==='cancelled').length,
    },
    finance: {
      unpaid: regs.filter(r=>_payStatus(r)==='未繳費').length,
      paymentPending: regs.filter(r=>_payStatus(r)==='待確認').length,
      paid: regs.filter(_isPaidReg).length,
      free: regs.filter(_isFreePay).length,
      grossRevenue: all.grossRevenue,
      depositTotal: all.depositTotal,
      refundTotal: all.refundTotal,
      netRevenue: all.netRevenue,
      anomalies: financeRows.length,
    },
    onsite: {
      checkinDone: all.checkinDone,
      checkinNotYet: all.checkinNotYet,
      absent: all.absent,
      clearDone: all.clearDone,
      depositRefunded: all.depositRefunded,
      depositForfeited: all.depositForfeited,
    },
    databaseCounts: {
      sessions: sessions.length,
      registrations: regs.length,
      members: members.length,
      staff: staff.length,
      activeStaff: activeStaff.length,
      events: events.length,
      agreementTemplates: agreements.length,
    },
    byVenue: _mapToRows(byVenueMap),
    byType: _mapToRows(byTypeMap),
    bySession: bySession.slice(0,12),
    equipment: all.equipmentItems,
    tasks: {
      pendingReview: regs.filter(r=>_reviewStatus(r)==='待審核').length,
      pendingPayment: regs.filter(r=>_payStatus(r)==='待確認').length,
      unpaid: regs.filter(r=>_payStatus(r)==='未繳費').length,
      refundPending: regs.filter(r=>String(_transferStatus(r)).includes('退費') && !['已退費','refunded'].includes(_transferStatus(r))).length,
      financeAnomalies: financeRows.length,
      checkinNotYet: all.checkinNotYet,
    }
  });
}

async function hAdminFinanceAnomalies(env, p){
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env, p.email, p.token, TENANT, 'finance')) return jsonErr('無權限');
  const regs = _scopeRows(p, await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&select=id,session_id,email,name,brand,brand_name,review_status,payment_status,pay_status,amount,total_amount,deposit,refund_amount,transfer_status,payment_method,pay_method,payment_last5,payment_reported_at,created_at`).catch(()=>[]));
  const rows=[];
  regs.forEach(r=>{
    _financeIssuesForReg(r).forEach(issue=>rows.push({...r, issue, amount:_officialAmount(r)}));
  });
  return jsonOk(rows);
}

// getSessionDashboard
function _sessionEquipDefs(s){
  const obj = safeJson((s && (s.equip_json || s.equip || s.equipment_json || s.equipment)), {});
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
}
function _sessionBaseEquipmentMap(s, stallCount=1){
  // 內含設備一律以資料庫 equip_json 的 incl（每攤內含數）為唯一真實來源，
  // 不再用 basic_equip 文字猜數量：文字寫法千變萬化（「一攤一個木棧板」「不含桌椅」），
  // 猜測會導致桌椅數量錯誤或憑空消失。
  const map = {};
  const stalls = Math.max(Number(stallCount) || 1, 1);
  const defs = _sessionEquipDefs(s);
  Object.entries(defs).forEach(([rawName, def]) => {
    const name = normalizeEquipName(rawName);
    if (!name) return;
    const incl = Number(def && (def.incl ?? def.include ?? def.included ?? def.free ?? def.qty_included)) || 0;
    if (incl <= 0) return;
    map[name] = (map[name] || 0) + incl * stalls;
  });
  return map;
}
function _selectedEquipmentMapFromReg(r){
  const map = {};
  _equipmentEntries(r).forEach(([k,v]) => {
    const name = normalizeEquipName(k);
    const n = Number(v) || 0;
    if (name && n > 0) map[name] = (map[name] || 0) + n;
  });
  return map;
}
function _effectiveEquipmentMapForReg(r, session){
  const stallCount = safeNum(r && r.stall_count) || 1;
  const base = _sessionBaseEquipmentMap(session || {}, stallCount);
  const selected = _selectedEquipmentMapFromReg(r || {});
  // equipment_json 存的是「實際選擇總量」（前台 ST.equipQty 已含內含量），不是加租量。
  // 因此正式總設備必須取 max(內含總量, 已選總量)，相加會把內含量重複計一次。
  // 例：4 攤每攤含 1 桌、攤友沒加租 → base=4、selected=4 → 相加會變 8 桌。
  return _mergeEquipmentMapsByMax(base, selected);
}
function _mergeEquipmentMapsByMax(base, selected){
  const out = {};
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(selected || {})]);
  for (const rawKey of keys) {
    const name = normalizeEquipName(rawKey);
    if (!name) continue;
    const baseQty = Number((base || {})[rawKey]) || 0;
    const selQty  = Number((selected || {})[rawKey]) || 0;
    out[name] = Math.max(out[name] || 0, baseQty, selQty);
  }
  return out;
}
function _equipmentMapFromRegs(regs, session=null) {
  const map = {};
  (regs || []).forEach(r => {
    const one = session ? _effectiveEquipmentMapForReg(r, session) : _selectedEquipmentMapFromReg(r);
    Object.entries(one).forEach(([k,v]) => {
      const name = normalizeEquipName(k);
      const n = Number(v) || 0;
      if (name && n > 0) map[name] = (map[name] || 0) + n;
    });
  });
  return map;
}
function _equipmentTextFromMap(map) {
  const order = {'桌':1,'椅':2,'電力':3};
  const parts = Object.entries(map || {})
    .filter(([k,v]) => Number(v) > 0)
    .sort((a,b)=>(order[normalizeEquipName(a[0])]||99)-(order[normalizeEquipName(b[0])]||99) || String(a[0]).localeCompare(String(b[0]), 'zh-Hant'))
    .map(([k,v]) => `${normalizeEquipName(k)}×${Number(v)}`);
  return parts.length ? parts.join('、') : '無';
}
function _isPendingPaymentReg(r){
  const p = _payStatus(r);
  return p === '待確認' || p === '付款待確認' || p === '已回報';
}
function _isActiveFinanceReg(r){
  return !_isCancelledReg(r);
}
function _itemKind(it){
  return String(it.item_type || it.type || it.kind || it.name || it.item_name || '').trim();
}
function _financeItemKindLabel(kind){
  const raw=String(kind||'').trim(),key=raw.toLowerCase();
  const labels={
    stall_fee:'攤位費',equipment:'設備費',addon:'加購費',deposit:'押金',
    discount:'折扣',adjustment:'金額調整',seat_fee:'加價選位費'
  };
  if(labels[key]) return labels[key];
  if(raw.includes('押金')) return '押金';
  if(raw.includes('攤位')) return '攤位費';
  if(raw.includes('設備')) return '設備費';
  if(raw.includes('加購')) return '加購費';
  return '報名費用';
}
function _paymentOwnerModeLabel(mode){
  return ({
    tuibile_self:'兔彼樂自收',
    tuibile_agency:'兔彼樂代收',
    partner_self:'合作主辦自收',
    legacy:'既有收款方式'
  })[String(mode||'').trim()] || '一般收款';
}
function _itemAmount(it){
  const stored = _firstNum(it.amount, it.total);
  if (stored !== 0) return stored;
  const unit = _firstNum(it.unit_price, it.price);
  const qty = _firstNum(it.quantity, it.qty, 1) || 1;
  return unit * qty;
}
function _itemSums(items){
  const sums = {hasItems:false, hasCoreItems:false, cashTotal:0, revenueTotal:0, depositTotal:0, rows:[]};
  for (const it of (items || [])) {
    const amt = _itemAmount(it);
    if (!amt) continue;
    sums.hasItems = true;
    const kind = _itemKind(it);
    const k = String(kind || '').toLowerCase();
    const isDeposit = k === 'deposit' || k.includes('deposit') || kind.includes('押金') || String(it.note || '').includes('exclude_from_invoice');
    const isCore = isDeposit || ['stall_fee','equipment','addon','discount','adjustment','seat_fee'].includes(k) || kind.includes('攤位') || kind.includes('設備') || kind.includes('加購');
    if (isCore) sums.hasCoreItems = true;
    sums.cashTotal += amt;
    if (isDeposit) sums.depositTotal += amt;
    else sums.revenueTotal += amt;
    sums.rows.push({kind, amount:amt, name:it.item_name || it.name || kind || '財務項目', note:it.note || ''});
  }
  return sums;
}
function _regFinanceAmounts(r, s, regItems){
  // 正式金流總覽只用 DB 已存資料：registrations 的 total/amount 或 registration_items。
  // 依 V7/V8 原規則，registrations.total/amount 已是「攤位費 + 設備費 + 加購費 + 押金」。
  // 因此不得再把 sessions.deposit 加進應收/已收，避免重複計算。
  const item = _itemSums(regItems);
  const storedTotal = _officialAmount(r);
  const itemTotal = item.hasItems ? Math.max(0, item.cashTotal) : 0;

  let cashTotal = 0;
  let source = 'none';
  // registration_items 是正式財務明細；若明細存在，優先使用明細加總，避免 registrations.amount 舊值造成應收/已收錯誤。
  if (item.hasCoreItems && itemTotal > 0) {
    cashTotal = itemTotal;
    source = 'registration_items';
  } else if (storedTotal > 0) {
    cashTotal = storedTotal;
    source = 'registrations.total/amount';
  }

  const ownDeposit = safeNum(_firstNum(r.deposit, r.deposit_total, r.deposit_amount));
  let depositTotal = 0;
  let depositSource = 'none';
  if (item.depositTotal > 0) {
    depositTotal = _singleRegistrationDeposit(r, s, item.depositTotal);
    depositSource = 'registration_items.deposit';
  } else if (ownDeposit > 0) {
    depositTotal = _singleRegistrationDeposit(r, s, ownDeposit);
    depositSource = 'registrations.deposit';
  } else if (cashTotal > 0 || _isApprovedReg(r) || _isConfirmedPaidReg(r)) {
    depositTotal = _singleRegistrationDeposit(r, s, 0);
    depositSource = 'sessions.deposit';
  }
  depositTotal = Math.min(Math.max(0, depositTotal), Math.max(0, cashTotal));

  const revenueTotal = Math.max(0, cashTotal - depositTotal);
  return {
    cashTotal: Math.max(0, cashTotal),
    revenueTotal,
    depositTotal: Math.max(0, depositTotal),
    source,
    depositSource,
    itemRows: item.rows,
  };
}
async function _getRegistrationItemsForRegs(env, regs){
  const ids = Array.from(new Set((regs || []).map(r=>String(r.id||'').trim()).filter(Boolean)));
  const map = {};
  if (!ids.length) return map;
  for (let i=0; i<ids.length; i+=80) {
    const chunk = ids.slice(i, i+80);
    const _t = String((regs && regs[0] && regs[0].tenant_id) || '').trim();
    const qs = `${_t?`tenant_id=eq.${encodeURIComponent(_t)}&`:''}registration_id=in.(${chunk.map(id=>encodeURIComponent(id)).join(',')})&select=*`;
    const rows = await dbGet(env, 'registration_items', qs).catch(()=>[]);
    for (const it of rows) {
      const rid = String(it.registration_id || '').trim();
      if (!rid) continue;
      if (!map[rid]) map[rid] = [];
      map[rid].push(it);
    }
  }
  return map;
}
function _sumCash(regs, s, itemMap){
  return (regs || []).reduce((sum,r)=>sum+_regFinanceAmounts(r, s, itemMap && itemMap[r.id]).cashTotal,0);
}
function _sumDeposit(regs, s, itemMap){
  return (regs || []).reduce((sum,r)=>sum+_regFinanceAmounts(r, s, itemMap && itemMap[r.id]).depositTotal,0);
}
function _sumConfirmedCash(regs,s,itemMap){
  return (regs||[]).reduce((sum,r)=>{
    if(r.paid_amount!==null&&r.paid_amount!==undefined&&r.paid_amount!=='')return sum+safeNum(r.paid_amount);
    return sum+_regFinanceAmounts(r,s,itemMap&&itemMap[r.id]).cashTotal;
  },0);
}
function _sumActivityCredit(regs){return (regs||[]).reduce((sum,r)=>sum+safeNum(r.activity_credit_applied),0);}
function _buildAdminSessionRow(s, list, evt, itemMap = {}) {
  const activeList = (list || []).filter(_isActiveFinanceReg);
  const paidRegs = activeList.filter(_isPaidReg);                 // 流程完成數：含免費
  const receivedRegs = activeList.filter(_isConfirmedPaidReg);    // 金流已收：只含實際已繳費/已付款
  const receivableRegs = activeList.filter(_isReceivableReg);
  const approvedRegs = activeList.filter(r => _isApprovedReg(r));
  const paymentPendingRegs = activeList.filter(r => _isApprovedReg(r) && _isPendingPaymentReg(r));
  const unpaidRegs = activeList.filter(r => _isApprovedReg(r) && (!_payStatus(r) || _payStatus(r)==='未繳費'));
  const refundRegs = (list || []).filter(r => isCapacityInactiveTransferStatus(_transferStatus(r)) || ['已退費','已退款'].includes(_payStatus(r)));

  const received = _sumConfirmedCash(receivedRegs, s, itemMap);
  const activityCredit = _sumActivityCredit(receivedRegs);
  const funded = received + activityCredit;
  const receivable = _sumCash(receivableRegs, s, itemMap);
  const depositTotal = _sumDeposit(receivedRegs, s, itemMap);

  const allEquip = _equipmentMapFromRegs(activeList, s);
  const needEquip = _equipmentMapFromRegs(approvedRegs, s);
  // 免費報名數（真實付款狀態＝免費）
  const freeRegs = activeList.filter(_isFreePay);
  // 整場設備總計（甲：已錄取且已繳費／免費）＋每日設備（依 selected_dates_json 拆，一組不乘天數）
  const prepareRegs = activeList.filter(r => _isApprovedReg(r) && _isPaidReg(r));
  const prepareEquip = _equipmentMapFromRegs(prepareRegs, s);
  const _dk = (x)=> (x && typeof x === 'object') ? String(x.date || x.key || x.value || '') : String(x || '');
  const sessionDates = (safeJson(s.dates_json, []) || []).map(_dk).filter(Boolean);
  const _regDates = (r)=>{ const a=(safeJson(r.selected_dates_json, []) || []).map(_dk).filter(Boolean); return a.length ? a : sessionDates.slice(); };
  const dailyRows = sessionDates.map(dk=>{
    const dayRegs = prepareRegs.filter(r => _regDates(r).includes(dk));
    const dayMap = _equipmentMapFromRegs(dayRegs, s);
    const stallCount = dayRegs.reduce((a,r)=> a + (safeNum(r.stall_count)||1), 0);
    return { date:dk, key:dk, label:dk, stallCount, equipmentText:_equipmentTextFromMap(dayMap) };
  });
  const dailyText = dailyRows.length ? dailyRows.map(x=> x.label + '：' + x.equipmentText).join('｜') : '無';
  const contractedStalls = prepareRegs.reduce((n,r)=>n+(safeNum(r.stall_count)||1),0);
  const maxDailyStalls = dailyRows.reduce((n,x)=>Math.max(n,safeNum(x.stallCount)),0);
  const stallDays = dailyRows.reduce((n,x)=>n+safeNum(x.stallCount),0);
  // 現金、活動金、押金分開。營業收入＝已投入資金－仍應返還的押金。
  const invoiceTotal = Math.max(0, funded - depositTotal);
  const fmt = formatSession(s);
  // COUNT_LIST_ALIGN_20260726：狀態徽章計數與「點進去的名單」同口徑。
  // 名單會排除退費／轉場中的報名(isRegActiveForList)，卡片計數也要一致，
  // 否則會出現「待確認 1、點進去卻空白」。金流金額與設備維持原口徑不動。
  const listActive = activeList.filter(r => !isCapacityInactiveTransferStatus(_transferStatus(r)) && !['已退費','已退款'].includes(_payStatus(r)));
  const stats = {
    registrationTotal: activeList.length,
    pendingReview: listActive.filter(r=>_reviewStatus(r)==='待審核').length,
    approved: listActive.filter(r=>_isApprovedReg(r)).length,
    unpaid: listActive.filter(r=>_isApprovedReg(r) && (!_payStatus(r) || _payStatus(r)==='未繳費')).length,
    paymentPending: listActive.filter(r=>_isApprovedReg(r) && _isPendingPaymentReg(r)).length,
    paid: listActive.filter(_isPaidReg).length,
    free: listActive.filter(_isFreePay).length,
    checkedIn: listActive.filter(r=>_checkinStatus(r)==='已報到').length,
    refund: refundRegs.length,
    contractedStalls,
    maxDailyStalls,
    stallDays,
  };
  const finance = {
    depositTotal: Math.max(0, depositTotal),
    receivableTotal: Math.max(0, receivable),
    receivedTotal: Math.max(0, received),
    activityCreditTotal: Math.max(0, activityCredit),
    fundedTotal: Math.max(0, funded),
    revenueTotal: invoiceTotal,
    unreceivedTotal: Math.max(0, receivable - funded),
    invoiceTotal: invoiceTotal,
  };
  const equipment = {
    totalText: _equipmentTextFromMap(prepareEquip),   // 整場總計（甲：已錄取＋已繳費／免費，與設備面板一致）
    neededText: _equipmentTextFromMap(needEquip),      // 需求（已錄取，參考）
    dailyText: dailyText,
    dailyRows: dailyRows,
    approvedNeededText: _equipmentTextFromMap(needEquip),
    allRequestedText: _equipmentTextFromMap(allEquip),
  };
  return {
    ...fmt,
    eventName: (evt && (evt.title || evt.name)) || '',
    eventCover: (evt && evt.cover_url) || '',
    seriesName: (evt && (evt.title || evt.name)) || '',
    dateText: _sessionDateValue(s),
    venue: _sessionVenueValue(s),
    organizer: s.organizer || s.co_organizer || s.coorg || '',
    status: s.status || '',
    stats,
    finance,
    equipment,
    total: stats.registrationTotal,
    pending: stats.pendingReview,
    approved: stats.approved,
    unpaid: stats.unpaid,
    paymentPending: stats.paymentPending,
    pendingPayment: stats.paymentPending,
    paid: stats.paid,
    free: stats.free,
    seated: stats.checkedIn,
    checkedIn: stats.checkedIn,
    refundReq: stats.refund,
    revenue: finance.receivedTotal,
    depositTotal: finance.depositTotal,
    receivableTotal: finance.receivableTotal,
    receivedTotal: finance.receivedTotal,
    unreceivedTotal: finance.unreceivedTotal,
    invoiceTotal: finance.invoiceTotal,
    refundedAmount: 0,
    equipNeed: needEquip,
    equipAll: allEquip,
  };
}
async function hGetSessionDashboard(env, p) {
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env, p.email, p.token, TENANT)) return jsonErr('無權限');

  if (p.sessionId || p.session_id) {
    const sessionId = p.sessionId || p.session_id;
    if (!await verifyStaff(env, p.email, p.token, TENANT, '', sessionId)) return jsonErr('無權限');
    const [sesRows, regs, events] = await Promise.all([
      dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sessionId)}&select=*`),
      dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&select=*`),
      dbGet(env, 'events', `tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
    ]);
    if (!sesRows.length) return jsonOk([]);
    const itemMap = await _getRegistrationItemsForRegs(env, regs);
    const evtMap = {}; events.forEach(e=>evtMap[e.id]=e);
    const s = sesRows[0];
    return jsonOk([_buildAdminSessionRow(s, regs, evtMap[s.event_id] || {}, itemMap)]);
  }

  const _jwtForScope = await verifyAdminJwt(p.token, env);
  const _scopeRole = (_jwtForScope && (_jwtForScope.normalized_role || _jwtForScope.role)) || '';
  const allowedSesIds = await getStaffScopedSessionIds(env, TENANT, p.email, _scopeRole);
  const [allRegs, sessionsRaw, events] = await Promise.all([
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&select=*`),
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&select=*`),
    dbGet(env, 'events', `tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
  ]);
  const sessions = Array.isArray(allowedSesIds) ? sessionsRaw.filter(s => allowedSesIds.includes(String(s.id))) : sessionsRaw;
  const itemMap = await _getRegistrationItemsForRegs(env, allRegs);
  const evtMap = {}; events.forEach(e=>evtMap[e.id]=e);
  return jsonOk(sessions.map(s => _buildAdminSessionRow(s, allRegs.filter(r=>String(r.session_id)===String(s.id)), evtMap[s.event_id] || {}, itemMap)));
}

// getRegs
async function hGetRegs(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env, p.email, p.token, TENANT)) return jsonErr('無權限');
  let qs = `tenant_id=eq.${TENANT}&select=*`;
  if (p.sessionId) qs += `&session_id=eq.${encodeURIComponent(p.sessionId)}`;
  if (p.eventId)   qs += `&event_id=eq.${encodeURIComponent(p.eventId)}`;
  const rows = _scopeRows(p, await dbGet(env, 'registrations', qs));
  return jsonOk(rows.map(r=>({
    id:r.id, sessionId:r.session_id, eventId:r.event_id,
    email:r.email, name:r.name, phone:r.phone,
    brand:r.brand_name, brandIntro:r.brand_intro||'', sellCat:r.sell_category,
    products:r.sell_items||'', photo:r.photo_url,
    fb:r.fb_url||'', ig:r.ig_url||'',
    equip:r.equipment_json, customFields:r.custom_fields_json,
    participants:safeJson(r.participants_json,{}),
    status:r.review_status, payStatus:r.payment_status,
    stallCount:safeNum(r.stall_count)||1,
    selectedDates:safeJson(r.selected_dates_json,[]),
    amount:safeNum(r.amount), totalAmount:safeNum(r.total_amount), deposit:safeNum(r.deposit),
    payMethod:r.payment_method||'', payLast5:r.payment_last5||'', payReportAmount:safeNum(r.payment_report_amount),
    paymentLineCardText:r.payment_line_card_text||'', paymentScreenshotStatus:r.payment_screenshot_status||'', paymentReportedAt:r.payment_reported_at||'', paymentGroupId:r.payment_group_id||'',
    paidAt:r.paid_at||'',
    checkin:r.checkin_status, clearStatus:r.clear_status,
    depositRefunded:r.deposit_refunded||'未退押金',
    transferStatus:r.transfer_status||'', transferChosenAt:r.transfer_chosen_at||'',
    refundAmount:safeNum(r.refund_amount), refundAdminFee:safeNum(r.refund_admin_fee),
    refundTransferFee:safeNum(r.refund_transfer_fee), refundRuleLabel:r.refund_rule_label||'', refundedAt:r.refunded_at||'', refundNote:r.refund_note||'',
    adminNote:r.admin_note, createdAt:r.created_at,
    // ── 合約同意紀錄 ──────────────────────────────────
    agreementAccepted:      r.agreement_accepted || false,
    agreementViewed:        r.agreement_viewed   || false,
    agreementViewedAt:      r.agreement_viewed_at   || '',
    agreementAcceptedAt:    r.agreement_accepted_at || '',
    agreementEmail:         r.agreement_email    || '',
    agreementVersion:       r.agreement_version  || '',
    agreementTitleSnapshot: r.agreement_title_snapshot   || '',
  })));
}

// getRegsBySession
async function hGetRegsBySession(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env, p.email, p.token, TENANT)) return jsonErr('無權限');
  const sId = p.sessionId || p.session_id;
  if (!sId) return jsonErr('請提供 sessionId');
  const rows = await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sId)}&select=*`);
  return jsonOk(rows.map(r=>({
    id:r.id, sessionId:r.session_id, eventId:r.event_id,
    email:r.email, name:r.name, phone:r.phone,
    brand:r.brand_name, brandIntro:r.brand_intro||'',
    sellCat:r.sell_category||'', products:r.sell_items||'',
    fb:r.fb_url||'', ig:r.ig_url||'',
    stallCount:safeNum(r.stall_count)||1,
    equip:r.equipment_json||'{}',
    addonQty:safeJson(r.addon_qty_json,{}),
    selectedDates:safeJson(r.selected_dates_json,[]),
    customFields:safeJson(r.custom_fields_json,[]),
    participants:safeJson(r.participants_json,{}),
    status:r.review_status||'待審核',
    payStatus:r.payment_status||'未繳費',
    payMethod:r.payment_method||'',
    paidAt:r.paid_at||'',
    payLast5:r.payment_last5||'',
    payReportAmount:safeNum(r.payment_report_amount),
    amount:safeNum(r.amount), deposit:safeNum(r.deposit),
    checkin:r.checkin_status||'未報到',
    clearStatus:r.clear_status||'未清場',
    depositRefunded:r.deposit_refunded||'未退押金',
    refundAmount:safeNum(r.refund_amount), refundAdminFee:safeNum(r.refund_admin_fee),
    refundTransferFee:safeNum(r.refund_transfer_fee), refundRuleLabel:r.refund_rule_label||'',
    refundedAt:r.refunded_at||'', refundNote:r.refund_note||'',
    stallNo:r.stall_number||'',
    taxId:r.tax_id||'', invoiceTitle:r.invoice_title||'',
    invoiceEmail:r.invoice_email||'', invoiceStatus:r.invoice_status||'',
    transferStatus:r.transfer_status||'',
    createdAt:r.created_at||'', adminNote:r.admin_note||'',
  })));
}


function _adminRegAvailableActions(r) {
  const review = _reviewStatus(r);
  const pay = _payStatus(r);
  const check = _checkinStatus(r);
  const transfer = _transferStatus(r);
  const actions = [];
  if (review === '待審核' || review === '報名成功' || review === '') actions.push('approve','reject','waitlist');
  if (review === '已錄取' && !isPaidStatus(pay) && pay !== '免費' && !['申請退費','已退費','refunded'].includes(transfer)) {
    if (pay === '待確認' || pay === '付款待確認') actions.push('confirmPayment','markUnpaid');
    else actions.push('confirmPayment','markPaymentReported','cancelUnpaid');
    // 錄取後若尚未繳費，仍要能改判為不錄取／備取（原本錄取完就再也按不到，主辦只能手動改資料庫）
    actions.push('reject','waitlist');
  }
  if (review === '已錄取' && (isPaidStatus(pay) || pay === '免費') && !['申請退費','已退費','refunded'].includes(transfer)) {
    if (check === '已報到') actions.push('undoCheckin');
    else actions.push('checkin');
    // 主辦在任何階段都要能決定取消。
    // 已繳費者不可直接改狀態（會讓帳目消失），一律導向退費流程；
    // 免費錄取沒有金流問題，可直接改判不錄取。
    if (isPaidStatus(pay)) actions.push('refund');
    else actions.push('reject');
  }
  // 備取者主辦也要能改判
  if (review === '備取' && !isPaidStatus(pay) && !['申請退費','已退費','refunded'].includes(transfer)) {
    actions.push('approve','reject');
  }
  return actions;
}
function _formatAdminRegistration(r, sessionRow, eventRow) {
  const sesName = (sessionRow && sessionRow.name) || r.session_name || '';
  const eventName = (eventRow && (eventRow.title || eventRow.name)) || '';
  const brandName = r.brand_name || r.brand || r.name || '';
  return {
    id:r.id, regId:r.id,
    tenantId:r.tenant_id, tenant_id:r.tenant_id,
    sessionId:r.session_id, session_id:r.session_id,
    eventId:r.event_id, event_id:r.event_id,
    sessionName:sesName, eventName,
    email:r.email||'', name:r.name||'', phone:r.phone||'',
    brand:brandName, brandName, brand_name:brandName,
    brandIntro:r.brand_intro||'', sellCat:r.sell_category||'', products:r.sell_items||'',
    fb:r.fb_url||r.fb||'', ig:r.ig_url||r.ig||'',
    equip:r.equipment_json || r.equip_json || r.equipment_text || '{}',
    equipment:r.equipment_json || r.equip_json || r.equipment_text || '{}',
    equipmentText:equipSummaryFromJson(r.equipment_json || r.equip_json || {}),
    addonQty:safeJson(r.addon_qty_json,{}), addon_qty_json:r.addon_qty_json || '{}',
    addonAmount:safeNum(r.addon_amount), addonText:addonSummaryFromJson(r.addon_qty_json || {}, sessionRow),
    customFields:safeJson(r.custom_fields_json,[]), participants:safeJson(r.participants_json,{}),
    reviewStatus:_reviewStatus(r) || '待審核', status:_reviewStatus(r) || '待審核',
    paymentStatus:_payStatus(r) || '未繳費', payStatus:_payStatus(r) || '未繳費',
    checkinStatus:_checkinStatus(r) || '未報到', checkin:_checkinStatus(r) || '未報到',
    clearStatus:_clearStatus(r) || '未清場', depositRefunded:_depositStatus(r) || '未退押金',
    teardown:r.teardown_status||'未撤場', teardownStatus:r.teardown_status||'未撤場', violation:r.violation_flags||'',
    transferStatus:_transferStatus(r) || '', refundStatus:_transferStatus(r) || '',
    bundleGroupId:r.bundle_group_id||'', bundle_group_id:r.bundle_group_id||'',
    stallCount:safeNum(r.stall_count)||1, stall_count:safeNum(r.stall_count)||1,
    selectedDates:safeJson(r.selected_dates_json,[]),
    amount:_officialAmount(r), totalAmount:safeNum(_firstNum(r.total_amount, r.total, r.registration_total_amount, r.amount)),
    deposit:_regDeposit(r, sessionRow),
    payMethod:r.payment_method||r.pay_method||'', payLast5:r.payment_last5||'', payReportAmount:safeNum(r.payment_report_amount),
    paymentLineCardText:r.payment_line_card_text||'', paymentScreenshotStatus:r.payment_screenshot_status||'', paymentReportedAt:r.payment_reported_at||'', paymentGroupId:r.payment_group_id||'',
    paidAt:r.paid_at||'', refundAmount:safeNum(r.refund_amount), refundAdminFee:safeNum(r.refund_admin_fee),
    refundTransferFee:safeNum(r.refund_transfer_fee), refundRuleLabel:r.refund_rule_label||'', refundedAt:r.refunded_at||'', refundNote:r.refund_note||'',
    stallNo:r.stall_number||'', taxId:r.tax_id||'', invoiceTitle:r.invoice_title||'', invoiceEmail:r.invoice_email||'', invoiceStatus:_invoiceStatus(r),
    adminNote:r.admin_note||'', createdAt:r.created_at||'', created_at:r.created_at||'',
    paymentProfile:_paymentSnapshotPublic(_paymentSnapshotFromReg(r)),
    paymentProfileName:_paymentSnapshotPublic(_paymentSnapshotFromReg(r)).paymentProfileName,
    paymentOwnerMode:_paymentSnapshotPublic(_paymentSnapshotFromReg(r)).paymentOwnerMode,
    availableActions:_adminRegAvailableActions(r),
  };
}
async function hGetSessionRegistrations(env, p) {
  const TENANT = (p && p._tenantId);
  const sessionId = p.sessionId || p.session_id;
  if (!sessionId) return jsonErr('請提供 sessionId');
  if (!await verifyStaff(env, p.email, p.token, TENANT, '', sessionId)) return jsonErr('無權限');
  const [sessionRows, regs, events] = await Promise.all([
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sessionId)}&select=*`),
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&select=*`),
    dbGet(env, 'events', `tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
  ]);
  const sessionRow = sessionRows[0] || {};
  const evtMap = {}; events.forEach(e=>evtMap[e.id]=e);
  return jsonOk(regs.map(r=>_formatAdminRegistration(r, sessionRow, evtMap[sessionRow.event_id] || {})));
}


async function hGetTodos(env, p) {
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env,p.email,p.token,TENANT)) return jsonErr('無權限');
  const [regsRaw,sessionsRaw,eventsRaw] = await Promise.all([
    dbGet(env,'registrations',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
    dbGet(env,'sessions',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
    dbGet(env,'events',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
  ]);
  const regs = _scopeRows(p, regsRaw);
  const sessions = _scopeSessionRows(p, sessionsRaw);
  const events = _scopeEventRows(p, eventsRaw);
  const smap={}; sessions.forEach(s=>smap[s.id]=s);
  const emap={}; events.forEach(e=>emap[e.id]=e);
  const out=[];
  for (const r of regs) {
    const review=_reviewStatus(r), pay=_payStatus(r), transfer=_transferStatus(r);
    let kind='', label='';
    // 退費狀態優先於「未繳費／待付款」，避免退款中的資料被錯分到待付款。
    if (isCapacityInactiveTransferStatus(transfer) && !['已退費','已退款','refunded'].includes(String(transfer||''))) { kind='refund'; label='退款待處理'; }
    else if (['不錄取','婉拒','已婉拒','已取消'].includes(String(review||'')) || _regStatus(r)==='cancelled') { continue; } // 終態：不錄取／婉拒／已取消 不進任何待辦
    else if (review==='待審核' || review==='報名成功' || review==='') { kind='pending'; label='待審核'; }
    else if (pay==='待確認' || pay==='付款待確認') { kind='paymentPending'; label='付款待確認'; }
    else if (review==='已錄取' && (!pay || pay==='未繳費')) { kind='unpaid'; label='未繳費'; }
    if (!kind) continue;
    const s=smap[r.session_id]||{};
    out.push({..._formatAdminRegistration(r, s, emap[s.event_id]||{}), kind, label});
  }
  // 連動場次退款是一個整組動作：待辦只顯示一張，點一次由 confirmRefund 完成整組。
  const groupCounts={};
  for(const x of out){ if(x.kind==='refund'&&x.bundleGroupId) groupCounts[x.bundleGroupId]=(groupCounts[x.bundleGroupId]||0)+1; }
  const seen=new Set();
  const dedup=[];
  for(const x of out){
    if(x.kind==='refund'&&x.bundleGroupId){
      if(seen.has(x.bundleGroupId)) continue;
      seen.add(x.bundleGroupId);
      x.bundleCount=groupCounts[x.bundleGroupId]||1;
      if(x.bundleCount>1) x.label='退款待處理（連動 '+x.bundleCount+' 場）';
    }
    dedup.push(x);
  }
  return jsonOk(dedup);
}

async function hSaveRegNote(env, p) {
  const TENANT = (p && p._tenantId);
  const regId = p.regId || p.reg_id;
  const sessionId = p.sessionId || p.session_id || '';
  const note = String(p.note || '').trim();
  if (!regId) return jsonErr('請提供 regId');
  if (!note) return jsonErr('請填寫備註內容');
  if (!await verifyStaff(env, p.email, p.token, TENANT, '', sessionId)) return jsonErr('無權限');
  const rows = await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(regId)}&select=admin_note`);
  if (!rows.length) return jsonErr('找不到報名');
  const prev = String(rows[0].admin_note || '').trim();
  const stamp = new Date().toISOString().slice(0,16).replace('T',' ');
  const line = '[' + stamp + '] ' + note;
  const merged = prev ? (prev + '\n' + line) : line;
  await dbUpdate(env, 'registrations', `id=eq.${encodeURIComponent(regId)}&tenant_id=eq.${TENANT}`, { admin_note: merged });
  return jsonOk({ success:true, regId, adminNote: merged });
}

async function hGetSessionEquipmentDetails(env, p) {
  const TENANT = (p && p._tenantId);
  const sessionId = p.sessionId || p.session_id;
  if (!sessionId) return jsonErr('請提供 sessionId');
  if (!await verifyStaff(env, p.email, p.token, TENANT, '', sessionId)) return jsonErr('無權限');
  const [sesRows, regs] = await Promise.all([
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sessionId)}&select=*`),
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&select=*`),
  ]);
  const s = sesRows[0] || {};
  const active = regs.filter(_isActiveFinanceReg);
  const approved = active.filter(_isApprovedReg);
  // 甲口徑：整場設備總計＝已錄取 且（已繳費／免費）＝真正要準備、要訂的量。
  const prepare = active.filter(r => _isApprovedReg(r) && _isPaidReg(r));
  const approvedMap = _equipmentMapFromRegs(approved, s);   // 需求（含未繳費，僅參考）
  const prepareMap  = _equipmentMapFromRegs(prepare, s);    // 整場總計：每筆算一次，不乘天數
  // 每日設備：依報名選的日期拆。一組設備擺三天仍算一次；但三天當日清單都會出現（現場那三天都在）。
  const _dk = (x)=> (x && typeof x === 'object') ? String(x.date || x.key || x.value || '') : String(x || '');
  const sessionDates = (safeJson(s.dates_json, []) || []).map(_dk).filter(Boolean);
  const regDates = (r)=>{ const arr = (safeJson(r.selected_dates_json, []) || []).map(_dk).filter(Boolean); return arr.length ? arr : sessionDates.slice(); };
  const dailyRows = sessionDates.map(d=>{
    const dayRegs = prepare.filter(r => regDates(r).includes(d));
    const dayMap = _equipmentMapFromRegs(dayRegs, s); // 該日每筆算一次
    const stallCount = dayRegs.reduce((a,r)=> a + (safeNum(r.stall_count)||1), 0);
    return { date:d, key:d, label:d, stallCount, equipmentText:_equipmentTextFromMap(dayMap) };
  }).filter(x => x.equipmentText && x.equipmentText !== '無');
  const dailyText = dailyRows.length ? dailyRows.map(x => x.label + '：' + x.equipmentText).join('｜') : '無';
  const rows = active.map(r=>{
    const oneMap = _equipmentMapFromRegs([r], s);
    const inclMap = _sessionBaseEquipmentMap(s, safeNum(r.stall_count)||1);
    const extraMap = _selectedEquipmentMapFromReg(r);
    const rDates = regDates(r);
    const oneText = _equipmentTextFromMap(oneMap);
    return {
      id:r.id,
      sessionId:sessionId,
      brand:r.brand_name || r.brand || r.name || r.email || '',
      name:r.name || '',
      phone:r.phone || '',
      email:r.email || '',
      reviewStatus:_reviewStatus(r) || '待審核',
      paymentStatus:_payStatus(r) || '未繳費',
      stallCount:safeNum(r.stall_count)||1,
      selectedDatesText: rDates.join('、'),
      dailyEquipmentRows: rDates.map(d=>({date:d, key:d, label:d, equipmentText:oneText})),
      equipmentMap:oneMap,
      equipmentText:oneText,
      wholeEquipmentText:oneText,
      dailyEquipmentText:oneText,
      includedEquipmentText:_equipmentTextFromMap(inclMap),
      extraEquipmentText:_equipmentTextFromMap(extraMap),
      createdAt:r.created_at || '',
    };
  }).filter(x=>x.equipmentText !== '無');
  return jsonOk({
    session:{id:sessionId, name:s.name || sessionId},
    summary:{
      totalText:_equipmentTextFromMap(prepareMap),   // 整場設備總計（甲：已錄取＋已繳費／免費）
      neededText:_equipmentTextFromMap(approvedMap),  // 需求參考（含未繳費）
      dailyText:dailyText,
      dailyRows:dailyRows,
      // 舊欄位相容
      approvedNeededText:_equipmentTextFromMap(approvedMap),
      paidNeededText:_equipmentTextFromMap(prepareMap),
      allRequestedText:_equipmentTextFromMap(prepareMap),
    },
    rows
  });
}


// ── 現場管理模組：獨立 onsite.html 使用，不進完整後台 ───────────────
function onsitePaymentText(r) {
  const status = String(r.payment_status || '');
  if (isPaidStatus(status)) return '已繳費';
  if (status === '免費') return '免費';
  return status || '未繳費';
}
function _registrationDates(r) {
  return (safeJson(r && r.selected_dates_json, []) || [])
    .map(x => String((x && typeof x === 'object') ? (x.date || x.value || x.key || '') : (x || '')).slice(0,10))
    .filter(Boolean)
    .filter((x,i,a)=>a.indexOf(x)===i)
    .sort();
}
function _sessionDates(s) {
  return (safeJson(s && s.dates_json, []) || [])
    .map(x => String((x && typeof x === 'object') ? (x.date || x.value || x.key || '') : (x || '')).slice(0,10))
    .filter(Boolean)
    .filter((x,i,a)=>a.indexOf(x)===i)
    .sort();
}
function _dayDepositEligible(r, activityDate) {
  const dates=_registrationDates(r);
  return !!activityDate && dates.length>0 && activityDate===dates[dates.length-1];
}
function formatOnsiteReg(r, dayOp, activityDate) {
  const daily=dayOp||{};
  const depositEligible=_dayDepositEligible(r,activityDate);
  const globalDeposit=String(r.deposit_refunded||'');
  const dayDeposit=String(daily.deposit_status||'');
  return {
    id: r.id,
    sessionId: r.session_id,
    brand: r.brand_name || r.name || r.email || '',
    name: r.name || '',
    phone: r.phone || '',
    email: r.email || '',
    status: r.review_status || '',
    payStatus: onsitePaymentText(r),
    stallCount: safeNum(r.stall_count) || 1,
    equip: safeJson(r.equipment_json, {}),
    addonQty: safeJson(r.addon_qty_json, {}),
    selectedDates: safeJson(r.selected_dates_json, []),
    amount: safeNum(r.amount),
    totalAmount: safeNum(r.total_amount),
    deposit: safeNum(r.deposit),
    paidAt: r.paid_at || '',
    payMethod: r.payment_method || '',
    payLast5: r.payment_last5 || '',
    activityDate: activityDate || '',
    checkin: daily.checkin_status || '未報到',
    checkinAt: daily.checkin_at || '',
    clearStatus: r.clear_status || '',
    depositRefunded: globalDeposit || dayDeposit || (depositEligible ? '未退押金' : '非退押金日'),
    depositEligible,
    depositHint: depositEligible ? '完成撤場後可退押金' : '押金於最後參加日處理',
    teardown: daily.teardown_status || '未撤場',
    violation: daily.violation_flags || r.violation_flags || '',
    transferStatus: r.transfer_status || '',
    adminNote: daily.admin_note || r.admin_note || '',
    stallNumber: daily.stall_number || '',
    equipmentText: _equipmentTextFromMap(safeJson(daily.equipment_json, safeJson(r.equipment_json,{}))),
    pendingPartialRefund: safeNum(r.pending_partial_refund),
    pendingPartialNote: r.pending_partial_note || '',
    createdAt: r.created_at || '',
  };
}

async function getFreshOnsiteAllowedSessionIds(env, tenantId, email, token) {
  const payload = await verifyAdminJwt(token, env);
  if (!payload) return null;
  const role = payload.normalized_role || payload.role || '';
  if (role === 'platform_super_admin') return null; // 平台超管不限制
  const rows = await dbGet(env, 'staff', `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&select=id,limit_sessions,role,normalized_role,is_active,active,scope_type,scope_event_id`).catch(()=>[]);
  const s = rows[0];
  if (!s) return [];
  const active = s.is_active !== undefined ? s.is_active : s.active;
  if (active === false) return [];
  const dbRole = s.normalized_role || s.role || role;
  const scopeType = s.scope_type || 'all';
  // scope_type='all' 且角色是 organizer_owner/organizer_admin → 不限制，看全部場次
  if (scopeType === 'all' && (dbRole === 'organizer_owner' || dbRole === 'organizer_admin')) return null;
  // scope_type='event' → 依 event_id 過濾整個系列的場次
  if (scopeType === 'event' && s.scope_event_id) {
    const sesRows = await dbGet(env, 'sessions', `tenant_id=eq.${tenantId}&event_id=eq.${encodeURIComponent(s.scope_event_id)}&select=id`).catch(()=>[]);
    return sesRows.map(x=>String(x.id||'').trim()).filter(Boolean);
  }
  let ids = [];
  // 正式授權來源優先使用 009 新增的 staff_session_permissions；若表尚未執行，回退 staff.limit_sessions。
  const permRows = await dbGet(env, 'staff_session_permissions', `tenant_id=eq.${tenantId}&staff_email=eq.${encodeURIComponent(email)}&is_active=eq.true&select=session_id`).catch(()=>null);
  if (Array.isArray(permRows)) ids = permRows.map(x=>String(x.session_id||'').trim()).filter(Boolean);
  if (!ids.length) ids = String(s.limit_sessions || '').split(',').map(x=>x.trim()).filter(Boolean);
  if (dbRole === 'onsite_staff') return ids;
  if (dbRole === 'session_admin') return ids.length ? ids : null;
  return null;
}

// 通用：依 staff 的授權範圍（all/event/session）取得可見的場次ID清單，null=不限制
async function getStaffScopedSessionIds(env, tenantId, email, role) {
  if (role === 'platform_super_admin') return null;
  const rows = await dbGet(env, 'staff', `tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&select=limit_sessions,scope_type,scope_event_id,normalized_role,role`).catch(()=>[]);
  const s = rows[0];
  if (!s) return [];
  const dbRole = s.normalized_role || s.role || role;
  const scopeType = s.scope_type || 'all';
  if (scopeType === 'all') {
    // organizer_owner/organizer_admin 在 all 範圍下不限制；其他角色仍依 limit_sessions
    if (dbRole === 'organizer_owner' || dbRole === 'organizer_admin') return null;
  }
  if (scopeType === 'event' && s.scope_event_id) {
    const sesRows = await dbGet(env, 'sessions', `tenant_id=eq.${tenantId}&event_id=eq.${encodeURIComponent(s.scope_event_id)}&select=id`).catch(()=>[]);
    return sesRows.map(x=>String(x.id||'').trim()).filter(Boolean);
  }
  // scope_type==='session' 或其他：回退用 limit_sessions
  const ids = String(s.limit_sessions || '').split(',').map(x=>x.trim()).filter(Boolean);
  return ids;
}

// ── 金流總覽（FINANCE_OVERVIEW_20260726）：依權限縮到「可管理的場次／主題」再加總 ──
async function hFinanceOverview(env, p){
  const TENANT = (p && p._tenantId);
  // 金流敏感：限 owner / platform / organizer_admin / finance_admin
  if (!await verifyStaff(env, p.email, p.token, TENANT, 'finance')) return jsonErr('無權限');
  const _jwt = await verifyAdminJwt(p.token, env);
  const role = (_jwt && (_jwt.normalized_role || _jwt.role)) || '';
  const allowedIds = await getStaffScopedSessionIds(env, TENANT, p.email, role); // null=全部；陣列=限定
  const [allRegs, sessionsRaw, events] = await Promise.all([
    dbGet(env,'registrations',`tenant_id=eq.${TENANT}&select=*`),
    dbGet(env,'sessions',`tenant_id=eq.${TENANT}&select=*`),
    dbGet(env,'events',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
  ]);
  const sessions = Array.isArray(allowedIds) ? sessionsRaw.filter(s=>allowedIds.includes(String(s.id))) : sessionsRaw;
  const itemMap = await _getRegistrationItemsForRegs(env, allRegs);
  const evtMap = {}; events.forEach(e=>evtMap[e.id]=e);
  const totals = {received:0,receivable:0,unreceived:0,deposit:0,invoice:0,refund:0};
  const counts = {sessions:0,registrations:0,paid:0,unpaid:0,paymentPending:0,free:0};
  const themeMap = {}; const bySession = [];
  for(const s of sessions){
    const regsOfS = allRegs.filter(r=>String(r.session_id)===String(s.id));
    const evt = evtMap[s.event_id] || {};
    const row = _buildAdminSessionRow(s, regsOfS, evt, itemMap);
    const f = row.finance || {}; const st = row.stats || {};
    const refundAmt = regsOfS.reduce((a,r)=>a+(_officialRefund(r)||0),0);
    totals.received += f.receivedTotal||0; totals.receivable += f.receivableTotal||0;
    totals.unreceived += f.unreceivedTotal||0; totals.deposit += f.depositTotal||0;
    totals.invoice += f.invoiceTotal||0; totals.refund += refundAmt;
    counts.sessions += 1; counts.registrations += st.registrationTotal||0;
    counts.paid += st.paid||0; counts.unpaid += st.unpaid||0;
    counts.paymentPending += st.paymentPending||0; counts.free += st.free||0;
    const eid = String(s.event_id||'') || '_none';
    const ename = (evt.title||evt.name) || '（未分類主題）';
    if(!themeMap[eid]) themeMap[eid] = {eventId:eid,eventName:ename,received:0,receivable:0,unreceived:0,deposit:0,invoice:0,refund:0,sessions:0,paid:0};
    const t = themeMap[eid];
    t.received+=f.receivedTotal||0; t.receivable+=f.receivableTotal||0; t.unreceived+=f.unreceivedTotal||0;
    t.deposit+=f.depositTotal||0; t.invoice+=f.invoiceTotal||0; t.refund+=refundAmt; t.sessions+=1; t.paid+=st.paid||0;
    bySession.push({ id:s.id, name:row.name||s.name||s.id, eventName:ename, date:row.dateText||_sessionDateValue(s), status:s.status||'',
      received:f.receivedTotal||0, receivable:f.receivableTotal||0, unreceived:f.unreceivedTotal||0,
      deposit:f.depositTotal||0, refund:refundAmt, net:f.invoiceTotal||0, paid:st.paid||0 });
  }
  // received 是目前仍有效的已收總額（含押金），invoice 是目前營業收入（不含押金）。
  // 已退款報名已不在 received/invoice 內，所以 net 不得再扣 refund。
  totals.net = totals.invoice;
  const byTheme = Object.values(themeMap).map(t=>({...t, net:t.invoice})).sort((a,b)=>b.received-a.received);
  bySession.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  return jsonOk({ totals, counts, byTheme, bySession, scoped: Array.isArray(allowedIds), role, generatedAt: new Date().toISOString() });
}

async function hOnsiteSessions(env, p) {
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env, p.email, p.token, TENANT, 'checkin')) return jsonErr('無權限');
  const allowedIds = await getFreshOnsiteAllowedSessionIds(env, TENANT, p.email, p.token);
  if (Array.isArray(allowedIds) && allowedIds.length === 0) return jsonOk([]);

  const [sessions, regs, stalls, daySeats, dayOps] = await Promise.all([
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&select=*`),
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&select=id,session_id,name,brand_name,equipment_json,selected_dates_json,review_status,payment_status,checkin_status,transfer_status,stall_count,amount,deposit,deposit_refunded`),
    dbGet(env, 'stalls', `tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
    dbGet(env, 'registration_day_seats', `tenant_id=eq.${TENANT}&select=session_id,activity_date,seat_code,registration_id`).catch(()=>[]),
    dbGet(env, 'registration_day_ops', `tenant_id=eq.${TENANT}&select=session_id,registration_id,activity_date,checkin_status,teardown_status,deposit_status`).catch(()=>[]),
  ]);
  let list = sessions;
  if (Array.isArray(allowedIds)) list = sessions.filter(s => allowedIds.includes(String(s.id)));
  // 現場管理只服務「當天真的要報到」的場次：
  // 1) 排除封存／已取消的場次　2) 排除沒有任何可報到名單（已錄取＋已繳費或免費）的場次
  list = list.filter(s => {
    const st = String(s.status || '').trim();
    if (st === '封存' || st === '已取消') return false;
    const rs = regs.filter(r => r.session_id === s.id);
    const payable = rs.filter(r => String(r.review_status || '') === '已錄取'
      && (isPaidStatus(r.payment_status) || String(r.payment_status || '') === '免費')
      && !['申請退費','已退費'].includes(String(r.transfer_status || '')));
    return payable.length > 0;
  });
  return jsonOk(list.map(s => {
    const rs = regs.filter(r => r.session_id === s.id);
    const approved = rs.filter(r => String(r.review_status || '') === '已錄取');
    const paid = approved.filter(r => isPaidStatus(r.payment_status) || String(r.payment_status || '') === '免費');
    const dates=_sessionDates(s);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const activityDate=dates.includes(today)?today:(dates.find(d=>d>=today)||dates[dates.length-1]||'');
    const dayPaid=paid.filter(r=>!activityDate||_registrationDates(r).includes(activityDate));
    const sessionDayOps=dayOps.filter(o=>String(o.session_id)===String(s.id));
    const checkedIds=new Set(sessionDayOps.filter(o=>String(o.activity_date).slice(0,10)===activityDate&&String(o.checkin_status||'')==='已報到').map(o=>String(o.registration_id)));
    const checked = dayPaid.filter(r => checkedIds.has(String(r.id)));
    const flagged = rs.filter(r => String(r.transfer_status || '').includes('退費') || String(r.transfer_status || '').includes('退款'));
    const fmt = formatSession(s);
    return {
      id: fmt.id,
      name: fmt.name,
      type: fmt.type || '',
      region: fmt.region || '',
      dates: fmt.dates || [],
      status: fmt.status || s.status || '',
      activityDate,
      total: dayPaid.length,
      approved: dayPaid.length,
      payable: dayPaid.length,
      checkedIn: checked.length,
      refundFlag: flagged.length,
      stallCount: dayPaid.reduce((sum,r)=>sum+(safeNum(r.stall_count)||1),0),
      paidAmount: dayPaid.reduce((sum,r)=>sum+safeNum(r.amount),0),
      depositTotal: dayPaid.filter(r=>_dayDepositEligible(r,activityDate)).reduce((sum,r)=>sum+safeNum(r.deposit),0),
      dayStats: dates.map(day=>{
        const rows=paid.filter(r=>_registrationDates(r).includes(day));
        const opsOnDay=sessionDayOps.filter(o=>String(o.activity_date).slice(0,10)===day);
        const opByReg={};opsOnDay.forEach(o=>opByReg[String(o.registration_id)]=o);
        const checkedOnDay=new Set(opsOnDay.filter(o=>String(o.checkin_status||'')==='已報到').map(o=>String(o.registration_id)));
        const teardownOnDay=new Set(opsOnDay.filter(o=>String(o.teardown_status||'')==='已撤場').map(o=>String(o.registration_id)));
        const depositRows=rows.filter(r=>_dayDepositEligible(r,day)&&safeNum(r.deposit)>0);
        const depositDoneStatuses=new Set(['已退押金','已轉活動金','押金沒收','已隨退款退還']);
        const depositDone=depositRows.filter(r=>depositDoneStatuses.has(String(r.deposit_refunded||opByReg[String(r.id)]?.deposit_status||'')));
        return {
          activityDate:day,
          payable:rows.length,
          checkedIn:rows.filter(r=>checkedOnDay.has(String(r.id))).length,
          teardownDone:rows.filter(r=>teardownOnDay.has(String(r.id))).length,
          stallCount:rows.reduce((sum,r)=>sum+(safeNum(r.stall_count)||1),0),
          depositTotal:rows.filter(r=>_dayDepositEligible(r,day)).reduce((sum,r)=>sum+safeNum(r.deposit),0),
          depositTotalCount:depositRows.length,
          depositDoneCount:depositDone.length,
          depositPendingCount:Math.max(0,depositRows.length-depositDone.length),
        };
      }),
      seatMapUrl: s.seat_map_url||'',
      seatBoard: buildOnsiteSeatBoard(s,stalls.filter(x=>String(x.session_id)===String(s.id)),rs,daySeats.filter(x=>String(x.session_id)===String(s.id))),
    };
  }));
}

async function hOnsiteRegs(env, p) {
  const TENANT = (p && p._tenantId);
  const sId = p.sessionId || p.session_id;
  if (!sId) return jsonErr('請提供 sessionId');
  const pcOk = p.passcode ? await verifyPasscode(env, TENANT, sId, String(p.passcode)) : null;
  if (!pcOk && !await verifyStaff(env, p.email, p.token, TENANT, 'checkin', sId)) return jsonErr('無權限');
  const activityDate=String(p.activityDate||p.activity_date||'').slice(0,10);
  const sessions=await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sId)}&select=id,dates_json`);
  if(!sessions.length)return jsonErr('找不到場次');
  const availableDates=_sessionDates(sessions[0]);
  if(!activityDate||!availableDates.includes(activityDate))return jsonErr('請選擇正確的活動日期');
  const [rows,dayOps] = await Promise.all([
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sId)}&select=*`),
    dbGet(env, 'registration_day_ops', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sId)}&activity_date=eq.${encodeURIComponent(activityDate)}&select=*`).catch(()=>[]),
  ]);
  const dayMap={};for(const d of dayOps)dayMap[String(d.registration_id)]=d;
  // 現場名單：只出現「已錄取＋已繳費（含免費）＋非退費流程中」的攤友（與報到規則一致）
  const onsiteRows = rows.filter(r => !checkinGuard(r, false) && _registrationDates(r).includes(activityDate));
  return jsonOk(onsiteRows.map(r=>formatOnsiteReg(r,dayMap[String(r.id)],activityDate)));
}

function _addEquipment(total, raw){
  const m=safeJson(raw,{})||{};
  for(const [k,v] of Object.entries(m)){const n=safeNum(v);if(n>0)total[k]=(total[k]||0)+n;}
}
async function hOnsiteDaySummary(env,p){
  const TENANT=p._tenantId,sId=String(p.sessionId||p.session_id||''),activityDate=String(p.activityDate||p.activity_date||'').slice(0,10);
  if(!sId||!activityDate)return jsonErr('請選擇場次與活動日期');
  const pcOk=p.passcode?await verifyPasscode(env,TENANT,sId,String(p.passcode)):null;
  if(!pcOk&&!await verifyStaff(env,p.email,p.token,TENANT,'checkin',sId))return jsonErr('無權限');
  const [sesRows,regs,ops]=await Promise.all([
    dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sId)}&select=id,dates_json`),
    dbGet(env,'registrations',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sId)}&select=*`),
    dbGet(env,'registration_day_ops',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sId)}&activity_date=eq.${encodeURIComponent(activityDate)}&select=*`).catch(()=>[]),
  ]);
  if(!sesRows.length)return jsonErr('找不到場次');
  const availableDates=_sessionDates(sesRows[0]);
  if(!availableDates.includes(activityDate))return jsonErr('活動日期不屬於本場');
  const opMap={};for(const o of ops)opMap[String(o.registration_id)]=o;
  const list=regs.filter(r=>!checkinGuard(r,false)&&_registrationDates(r).includes(activityDate));
  let checked=0,teardownDone=0,totalStalls=0,depositTotal=0,depositRefunded=0,depositPending=0,depositTotalCount=0,depositRefundedCount=0,depositPendingCount=0;
  const equipment={};
  for(const r of list){
    const o=opMap[String(r.id)]||{};
    if(String(o.checkin_status||'')==='已報到')checked++;
    if(String(o.teardown_status||'')==='已撤場')teardownDone++;
    totalStalls+=Math.max(1,safeNum(r.stall_count)||1);
    _addEquipment(equipment,o.equipment_json||r.equipment_json);
    if(_dayDepositEligible(r,activityDate)&&safeNum(r.deposit)>0){
      const amount=safeNum(r.deposit),status=String(r.deposit_refunded||o.deposit_status||'');
      depositTotal+=amount;depositTotalCount++;
      if(['已退押金','已轉活動金','押金沒收','已隨退款退還'].includes(status)){depositRefunded+=amount;depositRefundedCount++;}
      else{depositPending+=amount;depositPendingCount++;}
    }
  }
  return jsonOk({sessionId:sId,activityDate,availableDates,
    attendance:{total:list.length,totalBrands:list.length,totalStalls,checked,checkedBrands:checked,unchecked:Math.max(0,list.length-checked)},
    teardown:{completed:teardownDone,pending:Math.max(0,list.length-teardownDone)},
    deposit:{totalAmount:depositTotal,totalCount:depositTotalCount,refundedAmount:depositRefunded,refundedCount:depositRefundedCount,pendingAmount:depositPending,pendingCount:depositPendingCount},
    equipment:Object.entries(equipment).map(([name,qty])=>({name,qty})).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'))
  });
}
async function hOpsDashboard(env,p){
  const ids=String(p.sessionIds||p.session_ids||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,60);
  if(!ids.length)return jsonOk([]);
  const out=[];
  for(const id of ids){
    const ses=await dbGet(env,'sessions',`tenant_id=eq.${p._tenantId}&id=eq.${encodeURIComponent(id)}&select=id,dates_json`);
    if(!ses.length)continue;
    const dates=_sessionDates(ses[0]),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),day=dates.includes(today)?today:(dates.find(d=>d>=today)||dates[dates.length-1]||'');
    if(!day)continue;
    const response=await hOnsiteDaySummary(env,{...p,sessionId:id,activityDate:day});
    const body=await response.clone().json().catch(()=>null);
    if(body&&body.ok!==false)out.push(body.data!==undefined?body.data:body);
  }
  return jsonOk(out);
}

async function _formalPaidAmount(env,tenantId,regId){
  const rows=await dbGet(env,'payments',`tenant_id=eq.${tenantId}&or=(registration_id.eq.${encodeURIComponent(regId)},reg_id.eq.${encodeURIComponent(regId)})&status=eq.${encodeURIComponent('已確認')}&select=amount`).catch(()=>[]);
  return rows.reduce((n,x)=>n+safeNum(x.amount),0);
}
async function hPreviewRegistrationResolution(env,b){
  const T=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,T,'finance',b.sessionId))return jsonErr('無權限');
  const rows=await dbGet(env,'registrations',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.regId||'')}&select=*`);if(!rows.length)return jsonErr('找不到報名');
  const reg=rows[0],paidAmount=Math.max(await _formalPaidAmount(env,T,reg.id),safeNum(reg.paid_amount)),credit=safeNum(reg.activity_credit_applied),funded=paidAmount+credit,depositPaid=Math.min(funded,safeNum(reg.deposit)),activityPaid=Math.max(0,funded-depositPaid);
  const sessions=await dbGet(env,'sessions',`tenant_id=eq.${T}&select=*`),targetSessions=sessions.filter(s=>String(s.id)!==String(reg.session_id)&&!['封存','已取消'].includes(String(s.status||''))).map(s=>({id:s.id,name:s.name||s.id,dateText:_sessionDateValue(s)}));
  const out={regId:reg.id,stallCount:Math.max(1,safeNum(reg.stall_count)||1),paidAmount,activityCreditApplied:credit,fundedAmount:funded,activityPaid,depositPaid,creditCreated:funded,targetSessions};
  const target=sessions.find(s=>String(s.id)===String(b.targetSessionId||''));
  if(target){const dates=_sessionDates(target),activityFee=calcFee(target,dates,out.stallCount),targetDeposit=safeNum(target.deposit),targetTotal=activityFee+targetDeposit;Object.assign(out,{targetActivityFee:activityFee,targetDeposit,targetTotal,appliedTotal:Math.min(funded,targetTotal),creditCreated:Math.max(0,activityPaid-activityFee),depositRefundDue:Math.max(0,depositPaid-targetDeposit),dueAmount:Math.max(0,activityFee-activityPaid)+Math.max(0,targetDeposit-depositPaid),targetDates:dates});}
  return jsonOk(out);
}
async function hResolveRegistration(env,b){
  const T=b._tenantId,mode=String(b.mode||'');
  if(!await verifyStaff(env,b.email,b.token,T,'finance',b.sessionId))return jsonErr('無權限');
  const previewResponse=await hPreviewRegistrationResolution(env,b),previewBody=await previewResponse.clone().json();
  if(previewBody.ok===false)return previewResponse;const p=previewBody.data||previewBody;
  let target=null;if(mode==='transfer'){const rows=await dbGet(env,'sessions',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.targetSessionId||'')}&select=*`);target=rows[0];if(!target)return jsonErr('找不到轉入場次');}
  if(!['transfer','credit'].includes(mode))return jsonErr('請選擇轉場或轉活動金');
  const targetDates=target?_sessionDates(target):[];
  const result=await dbRpc(env,'resolve_registration_atomic',{
    p_tenant_id:T,p_registration_id:String(b.regId),p_mode:mode,p_target_session_id:target?target.id:null,p_new_registration_id:target?genId('REG'):null,p_target_event_id:target?target.event_id:null,p_target_dates:targetDates,
    p_target_activity_fee:target?calcFee(target,targetDates,p.stallCount):0,p_target_deposit:target?safeNum(target.deposit):0,p_paid_amount:p.paidAmount,p_activity_paid:p.activityPaid,p_deposit_paid:p.depositPaid,p_credit_created:p.creditCreated,p_deposit_refund_due:p.depositRefundDue||0,p_due_amount:p.dueAmount||0,p_note:String(b.note||''),p_actor_email:String(b.email||'')
  });
  return jsonOk(result||{success:true});
}
async function hPartialDayRefund(env,b){
  const T=b._tenantId;if(!await verifyStaff(env,b.email,b.token,T,'finance',b.sessionId))return jsonErr('無權限');
  const rows=await dbGet(env,'registrations',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.regId||'')}&select=*`);if(!rows.length)return jsonErr('找不到報名');
  const reg=rows[0],all=_registrationDates(reg),remove=(Array.isArray(b.removeDates)?b.removeDates:[]).map(x=>String(x).slice(0,10)).filter(x=>all.includes(x));
  if(!remove.length)return jsonErr('請選擇退款日期');if(remove.length>=all.length)return jsonErr('整筆退款請使用整筆退款功能');
  const ses=(await dbGet(env,'sessions',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(reg.session_id)}&select=*`))[0]||{};
  const suggested=remove.reduce((n,d)=>n+calcFee(ses,[d],Math.max(1,safeNum(reg.stall_count)||1)),0),kept=all.filter(x=>!remove.includes(x));
  if(b.preview===true||b.preview==='true')return jsonOk({suggestedGrossRefund:suggested,deposit:safeNum(reg.deposit),removed:remove,kept});
  if(b.depositIncluded===true||b.depositIncluded==='true')return jsonErr('仍保留其他參加日，押金不能提前退還');
  const result=await dbRpc(env,'complete_partial_day_refund_atomic',{p_tenant_id:T,p_registration_id:reg.id,p_dates:remove,p_refund_amount:safeNum(b.refundAmount),p_admin_fee:safeNum(b.refundAdminFee),p_transfer_fee:safeNum(b.refundTransferFee),p_deposit_amount:0,p_deposit_included:false,p_refund_method:String(b.refundMethod||''),p_refund_reference:String(b.refundReference||''),p_refund_note:String(b.refundNote||''),p_refunded_at:b.refundedAt||nowIso(),p_actor_email:String(b.email||'')});
  return jsonOk(result||{success:true});
}
async function hActivityCreditCheckout(env,b){
  const T=b._tenantId,email=normEmail(b.email),phone=normPhone(b.phone);if(!email||!phone)return jsonErr('請提供 Email 與手機');
  const member=await findVerifiedMemberByEmailPhone(env,T,email,phone);if(!member)return jsonErr('會員資料不符');
  const rows=await dbGet(env,'registrations',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.regId||'')}&email=ilike.${encodeURIComponent(email)}&select=*`);if(!rows.length||!phoneMatches(rows[0].phone,phone))return jsonErr('找不到符合的報名');
  const reg=rows[0],ledger=await dbGet(env,'member_credit_ledger',`tenant_id=eq.${T}&member_email=ilike.${encodeURIComponent(email)}&status=eq.${encodeURIComponent('有效')}&select=direction,amount`).catch(()=>[]),balance=ledger.reduce((n,x)=>n+(x.direction==='debit'?-safeNum(x.amount):safeNum(x.amount)),0),remaining=Math.max(0,safeNum(reg.total_amount||reg.amount)-safeNum(reg.paid_amount)-safeNum(reg.activity_credit_applied)),canApply=Math.min(Math.max(0,balance),remaining);
  if(b.preview===true||b.preview==='true')return jsonOk({balance,canApply,remaining:Math.max(0,remaining-canApply)});
  const result=await dbRpc(env,'apply_member_credit_atomic',{p_tenant_id:T,p_registration_id:reg.id,p_member_email:email});return jsonOk(result||{success:true});
}
async function hAdminManualSession(env,p){const T=p._tenantId;if(!await verifyStaff(env,p.email,p.token,T,'review',p.sessionId))return jsonErr('無權限');const rows=await dbGet(env,'sessions',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(p.sessionId||'')}&select=*`);if(!rows.length)return jsonErr('找不到場次');const s=rows[0];return jsonOk({...formatSession(s),dates:safeJson(s.dates_json,[]),equip:safeJson(s.equip_json,{}),addons:safeJson(s.addons_json,[]),maxStalls:safeNum(s.max_stalls)||20,status:s.status||''});}
async function _adminManualPreview(env,b){const T=b._tenantId,ses=(await dbGet(env,'sessions',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.sessionId||'')}&select=*`))[0];if(!ses)throw new Error('找不到場次');const dates=(Array.isArray(b.selectedDates)?b.selectedDates:[]).map(x=>String(x).slice(0,10)),valid=_sessionDates(ses);if(!dates.length||dates.some(x=>!valid.includes(x)))throw new Error('請選擇正確參加日期');const stalls=Math.max(1,safeNum(b.stallCount)||1),fee=calcFee(ses,dates,stalls),deposit=safeNum(ses.deposit),equipment=calcEquipTotal(b.equip||{},ses.equip_json,stalls,ses.basic_equip||''),defs=safeJson(ses.addons_json,[]),addon=defs.reduce((n,a,i)=>n+((a&&a.open===true)?safeNum(a.price)*safeNum((b.addonQty||{})[i]):0),0);return {ses,dates,stalls,fee,deposit,equipment,addon,total:fee+deposit+equipment+addon};}
async function hAdminPreviewRegistration(env,b){if(!await verifyStaff(env,b.email,b.token,b._tenantId,'review',b.sessionId))return jsonErr('無權限');try{const p=await _adminManualPreview(env,b);return jsonOk({fee:p.fee,deposit:p.deposit,equipment:p.equipment,addon:p.addon,total:p.total});}catch(e){return jsonErr(e.message||String(e));}}
async function hAdminCreateRegistration(env,b){
  const T=b._tenantId;if(!await verifyStaff(env,b.email,b.token,T,'review',b.sessionId))return jsonErr('無權限');let p;try{p=await _adminManualPreview(env,b);}catch(e){return jsonErr(e.message||String(e));}
  const members=await dbGet(env,'members',`tenant_id=eq.${T}&email=ilike.${encodeURIComponent(normEmail(b.memberEmail))}&select=*`);if(!members.length)return jsonErr('找不到會員');const m=members[0],historical=b.historicalBackfill===true||b.historicalBackfill==='true';
  if(!historical){await dbRpc(env,'claim_session_slot',{p_tenant_id:T,p_session_id:p.ses.id,p_stall_count:p.stalls});}
  const id=genId('REG'),mode=String(b.paymentMode||'unpaid'),paymentStatus=mode==='paid'?'已繳費':mode==='free'?'免費':'未繳費';if(mode==='free'&&p.total>0){if(!historical)await dbRpc(env,'release_session_slot',{p_tenant_id:T,p_session_id:p.ses.id,p_stall_count:p.stalls}).catch(()=>{});return jsonErr('應繳金額不為 0，不能標示免費');}
  const now=nowIso(),row={id,tenant_id:T,session_id:p.ses.id,event_id:p.ses.event_id||null,email:normEmail(m.email),member_id:normEmail(m.email),name:m.name||m.display_name||'',phone:m.phone||'',brand_name:m.brand_name||m.brand||'',brand_intro:m.brand_intro||m.intro||'',sell_category:m.category||m.sell_category||'',fb_url:m.fb_url||'',ig_url:m.ig_url||'',stall_count:p.stalls,deposit:p.deposit,review_status:'已錄取',payment_status:paymentStatus,payment_method:mode==='paid'?String(b.paymentMethod||'主辦補登／手動確認'):'',amount:p.total,total_amount:p.total,paid_amount:mode==='paid'?p.total:0,paid_at:mode==='paid'?(b.paidAt||now):null,selected_dates_json:p.dates,equipment_json:b.equip||{},addon_qty_json:b.addonQty||{},addon_amount:p.addon,checkin_status:'未報到',clear_status:'未清場',teardown_status:'未撤場',deposit_refunded:'未退押金',admin_note:`[主辦代報] ${String(b.manualReason||'主辦代報名')}${historical?'｜歷史補登':''}`,created_at:now};
  try{await dbInsert(env,'registrations',row);for(const d of p.dates)await dbUpsert(env,'registration_day_ops',{tenant_id:T,session_id:p.ses.id,registration_id:id,activity_date:d,participation_status:'參加',checkin_status:'未報到',teardown_status:'未撤場',deposit_status:_dayDepositEligible(row,d)?'未退押金':'不適用',equipment_json:b.equip||{},created_at:now,updated_at:now},'tenant_id,registration_id,activity_date');if(mode==='paid')await dbInsert(env,'payments',{id:genId('PAY'),tenant_id:T,reg_id:id,registration_id:id,session_id:p.ses.id,email:row.email,amount:p.total,method:row.payment_method,status:'已確認',paid_at:row.paid_at,created_at:now});}
  catch(e){if(!historical)await dbRpc(env,'release_session_slot',{p_tenant_id:T,p_session_id:p.ses.id,p_stall_count:p.stalls}).catch(()=>{});throw e;}
  return jsonOk({success:true,id,paymentStatus,financeLinked:mode==='paid',historicalBackfill:historical});
}
async function hMemberNotifications(env,p){const T=p._tenantId,email=normEmail(p.email),phone=normPhone(p.phone);if(!email||!phone)return jsonErr('請提供 Email 與手機');const member=await findVerifiedMemberByEmailPhone(env,T,email,phone);if(!member)return jsonErr('會員資料不符');const rows=await dbGet(env,'member_notifications',`tenant_id=eq.${T}&member_email=ilike.${encodeURIComponent(email)}&select=*&order=created_at.desc&limit=50`).catch(()=>[]);return jsonOk(rows.map(x=>({id:x.id,regId:x.registration_id||'',title:x.title||'系統通知',message:x.message||'',kind:x.kind||'',isRead:!!x.is_read,createdAt:x.created_at||''})));}
async function hMarkMemberNotificationRead(env,b){const T=b._tenantId,email=normEmail(b.email),phone=normPhone(b.phone);if(!email||!phone)return jsonErr('請提供 Email 與手機');const member=await findVerifiedMemberByEmailPhone(env,T,email,phone);if(!member)return jsonErr('會員資料不符');let qs=`tenant_id=eq.${T}&member_email=ilike.${encodeURIComponent(email)}`;if(!(b.all===true||b.all==='true')){if(!b.id)return jsonErr('缺少通知編號');qs+=`&id=eq.${encodeURIComponent(b.id)}`;}await dbUpdate(env,'member_notifications',qs,{is_read:true,read_at:nowIso()});return jsonOk({success:true});}

// ── 現場通行碼（4位數，一場一碼，限報到相關） ──
async function verifyPasscode(env, tid, sessionId, code) {
  if (!code) return null;
  try {
    const rows = await dbGet(env, 'onsite_passcodes', `tenant_id=eq.${tid}&session_id=eq.${encodeURIComponent(sessionId)}&code=eq.${encodeURIComponent(code)}&active=eq.true&select=*`);
    if (!rows.length) return null;
    const p = rows[0]; const now = Date.now();
    if (p.open_from && now < new Date(p.open_from).getTime()) return null;
    if (p.open_until && now > new Date(p.open_until).getTime()) return null;
    return p;
  } catch (e) { return null; }
}
async function staffDisplayName(env, tid, email) {
  try {
    const r = await dbGet(env, 'staff', `tenant_id=eq.${tid}&email=eq.${encodeURIComponent(email)}&select=name,display_name,email`);
    const s = r[0] || {}; return s.name || s.display_name || s.email || email || '管理者';
  } catch (e) { return email || '管理者'; }
}
// 現場輸入碼 → 找出對應場次（公開，不需登入）
async function hOnsitePasscodeVerify(env, b) {
  const TENANT = (b && b._tenantId);
  const code = String((b && b.code) || '').trim();
  if (!/^\d{4}$/.test(code)) return jsonErr('請輸入 4 位數字通行碼');
  const now = Date.now();
  const rows = await dbGet(env, 'onsite_passcodes', `tenant_id=eq.${TENANT}&code=eq.${encodeURIComponent(code)}&active=eq.true&select=*`).catch(() => []);
  const valid = rows.filter(p => {
    if (p.open_from && now < new Date(p.open_from).getTime()) return false;
    if (p.open_until && now > new Date(p.open_until).getTime()) return false;
    return true;
  });
  if (!valid.length) return jsonErr('通行碼無效或已過期');
  const p = valid[0];
  const [ses,stalls,regs,daySeats] = await Promise.all([
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(p.session_id)}&select=*`).catch(() => []),
    dbGet(env, 'stalls', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(p.session_id)}&select=*`).catch(()=>[]),
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(p.session_id)}&select=id,name,brand_name,equipment_json`).catch(()=>[]),
    dbGet(env, 'registration_day_seats', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(p.session_id)}&select=activity_date,seat_code,registration_id`).catch(()=>[])
  ]);
  const s=ses[0]||{};
  return jsonOk({ sessionId: p.session_id, sessionName:s.name||'',dates:safeJson(s.dates_json,[]),seatMapUrl:s.seat_map_url||'',seatBoard:buildOnsiteSeatBoard(s,stalls,regs,daySeats),assignee: p.assignee_note || '' });
}
// 後台：列出通行碼
async function hOnsitePasscodeList(env, p) {
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env, p.email, p.token, TENANT, 'checkin')) return jsonErr('無權限');
  const rows = _scopeRows(p, await dbGet(env, 'onsite_passcodes', `tenant_id=eq.${TENANT}&select=*`).catch(() => []));
  return jsonOk(rows.map(r => ({ id: r.id, sessionId: r.session_id, code: r.code, assignee: r.assignee_note || '', openFrom: r.open_from, openUntil: r.open_until, active: r.active })));
}
// 後台：產生 / 換碼（自動算開放時間，4位不與現有啟用碼重複，一場一碼）
async function hOnsitePasscodeGenerate(env, b) {
  const TENANT = (b && b._tenantId);
  if (!await verifyStaff(env, b.email, b.token, TENANT, 'checkin')) return jsonErr('無權限');
  const sessionId = String((b && b.sessionId) || '');
  if (!sessionId) return jsonErr('缺少 sessionId');
  const ses = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sessionId)}&select=*`);
  if (!ses.length) return jsonErr('找不到場次');
  const s = ses[0];
  const dates = (safeJson(s.dates_json, []) || []).map(d => (d && d.date) ? d.date : d).filter(Boolean).sort();
  let openFrom = null, openUntil = null;
  if (dates.length) {
    const first = new Date(dates[0] + 'T00:00:00+08:00');
    const last = new Date(dates[dates.length - 1] + 'T23:59:59+08:00');
    openFrom = new Date(first.getTime() - 2 * 24 * 3600 * 1000).toISOString();
    openUntil = new Date(last.getTime() + 8 * 3600 * 1000).toISOString();
  }
  const existing = await dbGet(env, 'onsite_passcodes', `tenant_id=eq.${TENANT}&active=eq.true&select=code`).catch(() => []);
  const used = new Set(existing.map(x => String(x.code)));
  let code = '';
  for (let i = 0; i < 60; i++) { const c = String(Math.floor(1000 + Math.random() * 9000)); if (!used.has(c)) { code = c; break; } }
  if (!code) code = String(Math.floor(1000 + Math.random() * 9000));
  await dbUpdate(env, 'onsite_passcodes', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&active=eq.true`, { active: false, updated_at: nowIso() }).catch(() => {});
  const id = genId('PC');
  await dbInsert(env, 'onsite_passcodes', { id, tenant_id: TENANT, session_id: sessionId, code, assignee_note: String((b && b.assignee) || ''), open_from: openFrom, open_until: openUntil, active: true, created_at: nowIso(), updated_at: nowIso() });
  return jsonOk({ id, code, openFrom, openUntil });
}
// 後台：停用 / 啟用
async function hOnsitePasscodeToggle(env, b) {
  const TENANT = (b && b._tenantId);
  if (!await verifyStaff(env, b.email, b.token, TENANT, 'checkin')) return jsonErr('無權限');
  const id = String((b && b.id) || '');
  if (!id) return jsonErr('缺少 id');
  const active = (b.active === true || b.active === 'true');
  await dbUpdate(env, 'onsite_passcodes', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}`, { active, updated_at: nowIso() });
  return jsonOk({ success: true });
}
async function hOnsiteMark(env, b) {
  const TENANT = (b && b._tenantId);
  const regId = b.regId || b.id;
  const mode = String(b.mode || '').trim();
  if (!regId) return jsonErr('缺少 regId');
  if (!mode) return jsonErr('缺少 mode');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  // 認證：Google 管理者 或 現場通行碼（二擇一）；並記錄操作者
  let operator = '';
  const PASS_MODES = ['checkin','undoCheckin','noShow','lateFlag','ruleFlag','earlyFlag','teardownDone','teardownUndo','depositRefund','depositUnrefund','note'];
  const pc = b.passcode ? await verifyPasscode(env, TENANT, reg.session_id, String(b.passcode)) : null;
  if (pc) {
    if (!PASS_MODES.includes(mode)) return jsonErr('現場通行碼無權限做此操作');
    const who = String(b.operatorName || '').trim();
    operator = (who || pc.assignee_note || '現場人員') + '·現場碼';
  } else {
    if (!await verifyStaff(env,b.email,b.token,TENANT,'checkin',reg.session_id)) return jsonErr('無權限');
    operator = await staffDisplayName(env, TENANT, b.email);
  }

  const now = nowIso();
  const activityDate=String(b.activityDate||b.activity_date||'').slice(0,10);
  const selectedDates=_registrationDates(reg);
  if(!activityDate||!selectedDates.includes(activityDate))return jsonErr('請先選擇這位攤商實際參加的日期');
  const existingOps=await dbGet(env,'registration_day_ops',`tenant_id=eq.${TENANT}&registration_id=eq.${encodeURIComponent(regId)}&activity_date=eq.${encodeURIComponent(activityDate)}&select=*`).catch(()=>[]);
  const dayOp=existingOps[0]||{};
  const noteText = String(b.note || '').trim();
  const oldNote = String(reg.admin_note || '').trim();
  const appendNote = (label) => `${oldNote ? oldNote + ' ' : ''}[現場·${operator}] ${label} ${nowTaipeiText()}${noteText ? '｜' + noteText : ''}`;
  const data = {};
  const dayData={tenant_id:TENANT,session_id:reg.session_id,registration_id:regId,activity_date:activityDate,participation_status:'參加',updated_at:now};
  if(!existingOps.length)dayData.created_at=now;

  if (mode === 'checkin') {
    const err = checkinGuard(reg, false);
    if (err) return jsonErr(err);
    Object.assign(data, checkinData(false, now));
    dayData.checkin_status='已報到';dayData.checkin_at=now;
    data.admin_note = appendNote('已報到');
  } else if (mode === 'undoCheckin') {
    Object.assign(data, checkinData(true, now));
    dayData.checkin_status='未報到';dayData.checkin_at=null;
    data.admin_note = appendNote('取消報到');
  } else if (mode === 'noShow') {
    data.checkin_status = '未到';
    dayData.checkin_status='未到';dayData.checkin_at=null;
    data.admin_note = appendNote('標記未到');
  } else if (mode === 'refundFlag') {
    data.transfer_status = '退費待處理';
    data.admin_note = appendNote('特殊／退費待處理');
  } else if (mode === 'depositRefund') {
    if(!_dayDepositEligible(reg,activityDate))return jsonErr('兩天／多天報名只能在最後一個參加日退押金');
    if(String(dayOp.teardown_status||'')!=='已撤場')return jsonErr('請先完成當日撤場，再退押金');
    const refund=await dbRpc(env,'set_deposit_return_status_atomic',{
      p_tenant_id:TENANT,p_registration_id:regId,p_activity_date:activityDate,p_returned:true,
      p_actor_email:String(b.email||operator||''),p_note:noteText||'現場完成撤場後退押金'
    });
    await dbInsert(env,'seat_operation_logs',{id:genId('OPL'),tenant_id:TENANT,session_id:reg.session_id,registration_id:regId,stall_id:null,action:mode,operator_type:pc?'onsite_passcode':'admin',operator_id:operator,note:noteText||null,created_at:now}).catch(()=>{});
    return jsonOk({success:true,mode,regId,activityDate,depositAmount:safeNum(refund&&refund.deposit_amount)});
  } else if (mode === 'depositForfeited') {
    // 違約沒收押金：押金轉為主辦收入
    if (String(reg.deposit_refunded||'') === '押金沒收') return jsonErr('此報名押金已標記沒收');
    data.deposit_refunded = '押金沒收';
    if(!_dayDepositEligible(reg,activityDate))return jsonErr('押金只能在最後一個參加日結案');
    dayData.deposit_status='押金沒收';dayData.deposit_refunded_at=now;
    data.admin_note = appendNote('押金沒收（違約）');
  } else if (mode === 'lateFlag' || mode === 'ruleFlag' || mode === 'earlyFlag') {
    const labelMap = { lateFlag:'遲到', ruleFlag:'不遵守規定', earlyFlag:'早退' };
    const label = labelMap[mode];
    const cur = String(reg.violation_flags || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!cur.includes(label)) cur.push(label);
    data.violation_flags = cur.join(',');
    dayData.violation_flags=cur.join(',');
    data.admin_note = appendNote('違規標記：' + label);
  } else if (mode === 'teardownDone') {
    data.teardown_status = '已撤場';
    dayData.teardown_status='已撤場';
    data.admin_note = appendNote('已撤場');
  } else if (mode === 'teardownUndo') {
    data.teardown_status = '未撤場';
    dayData.teardown_status='未撤場';
    data.admin_note = appendNote('改為未撤場');
  } else if (mode === 'depositUnrefund') {
    if(!_dayDepositEligible(reg,activityDate))return jsonErr('押金只能在最後一個參加日處理');
    const refund=await dbRpc(env,'set_deposit_return_status_atomic',{
      p_tenant_id:TENANT,p_registration_id:regId,p_activity_date:activityDate,p_returned:false,
      p_actor_email:String(b.email||operator||''),p_note:noteText||'現場撤銷誤按退押金'
    });
    await dbInsert(env,'seat_operation_logs',{id:genId('OPL'),tenant_id:TENANT,session_id:reg.session_id,registration_id:regId,stall_id:null,action:mode,operator_type:pc?'onsite_passcode':'admin',operator_id:operator,note:noteText||'撤銷誤按退押金',created_at:now}).catch(()=>{});
    return jsonOk({success:true,mode,regId,activityDate,depositAmount:safeNum(refund&&refund.deposit_amount)});
  } else if (mode === 'note') {
    data.admin_note = appendNote('現場備註');
    dayData.admin_note=appendNote('現場備註');
  } else {
    return jsonErr('未知現場操作：' + mode);
  }
  await dbUpsert(env,'registration_day_ops',dayData,'tenant_id,registration_id,activity_date');
  // 舊欄位只保留整場相容狀態；每天畫面一律讀 registration_day_ops。
  if(Object.keys(data).length)await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(regId)}&tenant_id=eq.${TENANT}`,data);
  await dbInsert(env,'seat_operation_logs',{ id: genId('OPL'), tenant_id: TENANT, session_id: reg.session_id, registration_id: regId, stall_id: null, action: mode, operator_type: pc ? 'onsite_passcode' : 'admin', operator_id: operator, note: noteText || null, created_at: now }).catch(()=>{});
  return jsonOk({success:true, mode, regId});
}

// getStaff
async function hGetStaff(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,p.email,p.token,TENANT,'superadmin')) return jsonErr('無權限');
  const rows = await dbGet(env, 'staff', `tenant_id=eq.${TENANT}&select=*`);
  return jsonOk(rows.map(r=>({
    email:r.email,
    name:r.name || r.display_name || '',
    role:r.normalized_role || r.role,
    rawRole:r.role,
    isActive: r.is_active !== undefined ? r.is_active : r.active,
    permsJson:r.perms_json||'{}',
    limitSessions:r.limit_sessions ? String(r.limit_sessions).split(',').filter(Boolean) : [],
    scopeType:r.scope_type || 'all',
    scopeEventId:r.scope_event_id || '',
    joinedAt:r.created_at,
    lastLoginAt:r.last_login_at || '',
  })));
}

// getEventsAdmin
async function hGetEventsAdmin(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env, p.email, p.token, TENANT)) return jsonErr('無權限');
  const rows = _scopeEventRows(p, await dbGet(env, 'events', `tenant_id=eq.${TENANT}&select=*`));
  return jsonOk(rows.map(r=>({id:r.id,title:r.title,desc:r.description,location:r.location,cover:r.cover_url,status:r.status,createdAt:r.created_at,paymentProfileId:r.payment_profile_id||'',paymentProfile:_paymentSnapshotPublic(safeJson(r.payment_profile_snapshot,null))})));
}

// getSessionsAdmin
async function hGetSessionsAdmin(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env, p.email, p.token, TENANT)) return jsonErr('無權限');
  let qs = `tenant_id=eq.${TENANT}&select=*`;
  if (p.eventId) qs += `&event_id=eq.${encodeURIComponent(p.eventId)}`;
  const [sessionsRaw, allRegs, events] = await Promise.all([
    dbGet(env, 'sessions', qs),
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&select=*`),
    dbGet(env, 'events', `tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
  ]);
  const sessions = _scopeSessionRows(p, sessionsRaw);
  const scopedRegs = _scopeRows(p, allRegs);
  const itemMap = await _getRegistrationItemsForRegs(env, scopedRegs);
  const evtMap = {}; events.forEach(e=>evtMap[e.id]=e);
  return jsonOk(sessions.map(s => _buildAdminSessionRow(
    s,
    scopedRegs.filter(r=>String(r.session_id)===String(s.id)),
    evtMap[s.event_id] || {},
    itemMap
  )));
}

// getPayments
async function hGetPayments(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env, p.email, p.token, TENANT, 'finance')) return jsonErr('無權限');
  const rows = _scopeRows(p, await dbGet(env, 'payments', `tenant_id=eq.${TENANT}&select=*`));
  return jsonOk(rows.map(r=>({id:r.id,regId:r.registration_id||r.reg_id,sessionId:r.session_id,email:r.email,amount:r.amount,method:r.method,status:r.status,tradeNo:r.trade_no,paidAt:r.paid_at,createdAt:r.created_at,paymentProfileId:r.payment_profile_id||'',paymentProfile:_paymentSnapshotPublic(safeJson(r.payment_profile_snapshot,null))})));
}

// getFinance
async function hGetFinance(env, p) {
  const TENANT = (p && p._tenantId) ;
  if (!await verifyStaff(env,p.email,p.token,TENANT,'finance')) return jsonErr('無權限');
  const sId = p.sessionId||p.session_id;
  if (!sId) return jsonErr('請提供 sessionId');
  const [sesRows, regs] = await Promise.all([
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sId)}&select=*`),
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sId)}&select=*`),
  ]);
  const ses = sesRows[0] || {};
  const itemMap = await _getRegistrationItemsForRegs(env, regs);
  const out = [];
  for (const r of regs.filter(_isReceivableReg)) {
    const money = _regFinanceAmounts(r, ses, itemMap[r.id]);
    const brand = r.brand_name || r.brand || r.name || r.email || r.id;
    if (money.itemRows && money.itemRows.length) {
      for (const it of money.itemRows) {
        out.push({id:r.id, sessionId:sId, type:_financeItemKindLabel(it.kind), name:`${brand}｜${it.name}`, amount:it.amount, note:`${_reviewStatus(r)}／${_payStatus(r)}`, paymentProfileName:_paymentSnapshotPublic(_paymentSnapshotFromReg(r)).paymentProfileName||'既有收款設定'});
      }
    } else {
      out.push({id:r.id, sessionId:sId, type:'應收款', name:brand, amount:money.cashTotal, note:`${_reviewStatus(r)}／${_payStatus(r)}`, paymentProfileName:_paymentSnapshotPublic(_paymentSnapshotFromReg(r)).paymentProfileName||'既有收款設定'});
      if (money.depositTotal > 0) out.push({id:r.id+'-deposit', sessionId:sId, type:'押金', name:brand, amount:money.depositTotal, note:'押金獨立列，不列入發票'});
    }
  }
  return jsonOk(out);
}

// getInvoiceList
async function hGetInvoiceList(env, p) {
  const TENANT = (p && p._tenantId) ;
  if (!await verifyStaff(env, p.email, p.token, TENANT, 'finance')) return jsonErr('無權限');
  const sId = p.sessionId||p.session_id;
  if (!sId) return jsonErr('請提供 sessionId');
  const [sesRows, regs] = await Promise.all([
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sId)}&select=*`),
    dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sId)}&select=*`),
  ]);
  const ses = sesRows[0] || {};
  const itemMap = await _getRegistrationItemsForRegs(env, regs);
  return jsonOk(regs.filter(_isReceivableReg).map(r=>{
    const money = _regFinanceAmounts(r, ses, itemMap[r.id]);
    const invoiceAmount = Math.max(0, money.cashTotal - money.depositTotal);
    const untaxed = Math.round(invoiceAmount / 1.05);
    const tax = invoiceAmount - untaxed;
    return {
      id:r.id, email:r.email, name:r.name, brand:r.brand_name, phone:r.phone,
      invoiceType:r.tax_id ? '公司／機關' : '個人',
      taxId:r.tax_id||'', invoiceTitle:r.invoice_title||r.brand_name||'',
      invoiceEmail:r.invoice_email||r.email,
      deposit:money.depositTotal, amount:invoiceAmount,
      untaxedAmount:untaxed, taxAmount:tax,
      invoiceStatus:r.invoice_status||'待開立',
      note:r.admin_note||'',
    };
  }));
}

// getSiteConfig
async function hGetSiteConfig(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env, 'tenants', `id=eq.${TENANT}&select=config_json,line_url,bank_info`);
  if (!rows.length) return jsonOk({heroImg:'',infoText:''});
  const cfg = safeJson(rows[0].config_json, {});
  return jsonOk({
    heroImg:cfg.heroImg||'', logoUrl:cfg.logoUrl||'', infoText:cfg.infoText||'',
    lineUrl:rows[0].line_url||'',
    bankInfo:rows[0].bank_info||'',
  });
}

// getForceRefundList
async function hGetForceRefundList(env, p) {
  const TENANT = (p && p._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env, p.email, p.token, TENANT, 'finance')) return jsonErr('無權限');
  // 正式資料庫目前以 transfer_status=申請退費 作為不可抗力／一般退費待處理狀態。
  // 不查不存在的 registrations.force_status，避免前台/後台因欄位不同步中斷。
  const rows = _scopeRows(p, await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&transfer_status=eq.%E7%94%B3%E8%AB%8B%E9%80%80%E8%B2%BB&select=*`));
  // 取得場次名稱
  const sesIds = [...new Set(rows.map(r=>r.session_id).filter(Boolean))];
  const sesNames = {};
  if (sesIds.length) {
    const sesRows = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=in.(${sesIds.map(id=>encodeURIComponent(id)).join(',')})&select=id,name`);
    sesRows.forEach(s=>sesNames[s.id]=s.name||s.id);
  }
  return jsonOk(rows.map(r=>{
    const forceS = String(r.force_status||'');
    let applySource = '一般申請退費';
    if (forceS === 'auto_refund_requested') applySource = '逾期自動申請退費';
    else if (forceS === 'refund_only_auto') applySource = '無延期場次自動進入退費';
    else if (forceS === 'refund_requested') applySource = '主動申請退費（不可抗力）';
    return {
      id:r.id, sessionId:r.session_id, sessionName:sesNames[r.session_id]||r.session_id,
      email:r.email, name:r.name, brand:r.brand_name, phone:r.phone||'',
      amount:safeNum(r.amount), deposit:safeNum(r.deposit),
      payStatus:r.payment_status||'',
      transferChosenAt:r.transfer_chosen_at||'', depositRefunded:r.deposit_refunded||'未退押金',
      refundAmount:safeNum(r.refund_amount), refundAdminFee:safeNum(r.refund_admin_fee),
      refundTransferFee:safeNum(r.refund_transfer_fee), refundRuleLabel:r.refund_rule_label||'',
      refundedAt:r.refunded_at||'', refundNote:r.refund_note||'',
      // 不可抗力欄位
      forceStatus:forceS||'',
      applySource,
      forceRefundRequestedAt:r.force_refund_requested_at||r.transfer_chosen_at||'',
      forceRefundedAt:r.force_refunded_at||'',
      forceRefundNote:r.force_refund_note||'',
    };
  }));
}

// ── SECTION 12: POST Handlers ────────────────────────────────────

// register
// ── 場次組合套組（自由組合、同進退；押金/發票/合約等其他規則同單場） ──
async function hGetBundles(env, p) {
  const T = p._tenantId;
  if (!await verifyStaff(env, p.email, p.token, T)) return jsonErr('無權限');
  const rows = await dbGet(env, 'session_bundles', `tenant_id=eq.${T}&select=*`).catch(() => []);
  return jsonOk(rows.map(r => ({ id: r.id, name: r.name, sessionIds: String(r.session_ids || '').split(',').filter(Boolean), bundlePrice: r.bundle_price, active: r.active })));
}
async function hSaveBundle(env, b) {
  const T = b._tenantId;
  if (!await verifyStaff(env, b.email, b.token, T)) return jsonErr('無權限');
  const name = String(b.name || '').trim(); if (!name) return jsonErr('請填套組名稱');
  const sids = (Array.isArray(b.sessionIds) ? b.sessionIds : String(b.sessionIds || '').split(',')).map(x => String(x).trim()).filter(Boolean);
  if (sids.length < 2) return jsonErr('套組至少要綁 2 個場次');
  const price = Number(b.bundlePrice) || 0;
  if (b.id) {
    await dbUpdate(env, 'session_bundles', `tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.id)}`, { name, session_ids: sids.join(','), bundle_price: price, active: (b.active !== false), updated_at: nowIso() });
    return jsonOk({ id: b.id });
  }
  const id = genId('BND');
  await dbInsert(env, 'session_bundles', { id, tenant_id: T, name, session_ids: sids.join(','), bundle_price: price, active: true, created_at: nowIso(), updated_at: nowIso() });
  return jsonOk({ id });
}
async function hDeleteBundle(env, b) {
  const T = b._tenantId;
  if (!await verifyPlatformSuperAdmin(env, b.email, b.token, T)) return jsonErr('刪除套組僅限平台超級管理員');
  await dbDelete(env, 'session_bundles', `tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.id)}`);
  return jsonOk({ success: true });
}
async function hGetBundlesPublic(env, p) {
  const T = p._tenantId;
  const rows = await dbGet(env, 'session_bundles', `tenant_id=eq.${T}&active=eq.true&select=*`).catch(() => []);
  const sess = await dbGet(env, 'sessions', `tenant_id=eq.${T}&select=id,name,status,dates_json,registration_schedule_json`).catch(() => []);
  const sMap = {}; sess.forEach(s => sMap[s.id] = s);
  return jsonOk(rows.filter(r => {
    const sids = String(r.session_ids || '').split(',').filter(Boolean);
    return sids.length >= 2 && sids.every(id => sMap[id]);
  }).map(r => {
    const sids = String(r.session_ids || '').split(',').filter(Boolean);
    return { id: r.id, name: r.name, bundlePrice: r.bundle_price, sessions: sids.map(id => {
      const row=sMap[id], availability=registrationAvailability(row);
      return {id,name:row.name,status:row.status,dates:safeJson(row.dates_json,[]),available:availability.open,registrationState:availability.state,registrationMessage:availability.message};
    }) };
  }));
}
// ── 報名建立：計算與寫入分離（B-05）────────────────────────────
// prepareRegistration：只做驗證與計算，一個字都不寫進資料庫，回傳完整的 registrations 列。
//   單場與組合共用同一份，所以審核規則、費用、設備、發票只會有一套算法。
// finalizeRegistration：交易成功「之後」才做的非交易性後續（財務明細、會員、攤位、寄信）。
// 實際寫入：單場走 claim_session_slot；組合走 SQL 021 的單一交易 RPC，全成或全不成。
async function prepareRegistration(env, b) {
  const TENANT = (b && b._tenantId);
  b.email = normEmail(b.email);
  b.phone = normPhone(b.phone);
  if (!b.email) return {error:'請填寫 Email'};
  if (!b.phone) return {error:'請填寫手機'};
  const ses = await getSessionRow(env, b.sessionId, TENANT);
  if (!ses) return {error:'找不到場次'};
  const availability = registrationAvailability(ses);
  if (!availability.open) return {error:availability.message||'此場次目前未開放報名'};

  // ── 合約同意驗證（後端硬性規則）──────────────────────────
  const agreementRequired = agreementRequiredOn(ses.agreement_required);
  if (agreementRequired) {
    if (!b.agreementViewed)   return {error:'請先點開並閱讀報名合約，才能送出報名。'};
    if (!b.agreementAccepted) return {error:'請勾選同意報名合約後，才能送出報名。'};
  }

  const sesType = ses.type||'市集場次';
  const stallMax = (sesType==='市集場次'||sesType==='通路寄賣') ? 3 : 10;
  const stallCount = Math.min(Math.max(parseInt(b.stallCount)||1,1),stallMax);
  const selectedDates = Array.isArray(b.selectedDates) ? b.selectedDates : [];
  const dates = safeJson(ses.dates_json, []);

  // 逐日名額檢查（先擋掉明顯不足；最終名額由 DB 交易把關）
  if (dates.length>0 && selectedDates.length>0) {
    const existing = await dbGet(env, 'registrations',
      `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(b.sessionId)}&select=selected_dates_json,stall_count,review_status,transfer_status`);
    for (const sd of selectedDates) {
      const def = dates.find(d=>d.date===sd);
      if (!def) continue;
      const dayLimit = Number(def.limit)||0;
      if (!dayLimit) continue;
      const dayUsed = existing.reduce((s,r)=>{
        if (!isActiveForCapacity(r)) return s;
        const rd = safeJson(r.selected_dates_json,[]);
        return s+(rd.includes(sd)?(Number(r.stall_count)||1):0);
      },0);
      if (dayUsed+stallCount>dayLimit) return {error: sd.slice(5).replace('-','/')+'當日名額不足，剩 '+(dayLimit-dayUsed)+' 攤'};
    }
  } else {
    const cur = safeNum(ses.current_count), lim = safeNum(ses.limit_count);
    if (lim>0 && cur+stallCount>lim) return {error:'名額不足，剩 '+(lim-cur)+' 攤'};
  }

  // H-02：依 tenant_settings.module_flags_json.requireSocialLinks 決定是否強制 FB／IG／官網至少一項。
  try {
    const tsRows = await dbGet(env, 'tenant_settings', `tenant_id=eq.${TENANT}&select=module_flags_json`);
    const mf = safeJson(tsRows.length ? tsRows[0].module_flags_json : '{}', {});
    if (mf.requireSocialLinks === true) {
      const hasSocial = String(b.fb || b.fb_url || '').trim() || String(b.ig || b.ig_url || '').trim() || String(b.collabUrl || b.collab_url || b.website || b.web || '').trim();
      if (!hasSocial) return {error:'FB、IG 或官網至少需要填寫一項'};
    }
  } catch(e) { console.error('requireSocialLinks check skipped', e && e.message); logError(env, {source:'prepareRegistration', message:'requireSocialLinks check skipped', error:e && e.message}); }

  // B-01：Email 已有會員但手機不符 → 直接擋下。
  // 必須在任何寫入（占名額／建報名／覆寫 members）之前。
  const existingMemberRows = await dbGet(env, 'members', `tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(b.email)}&select=email,phone`).catch(()=>[]);
  if (existingMemberRows.length && !phoneMatches(existingMemberRows[0].phone, b.phone)) {
    return {error:'此 Email 已有會員資料，但手機不一致。請使用原報名手機登入，或聯繫主辦協助。'};
  }

  // 重複報名檢查：已取消、不錄取、已退費 → 視為結束，允許重新報名
  const dupExclude = encodeURIComponent('不錄取') + ',' + encodeURIComponent('已取消');
  const dupRaw = await dbGet(env, 'registrations',
    `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(b.sessionId)}&email=ilike.${encodeURIComponent(b.email)}&review_status=not.in.(${dupExclude})&select=id,transfer_status`
  ).catch(()=>[]);
  const dup = dupRaw.filter(r => {
    const ts = String(r.transfer_status || '').trim();
    return ts !== '已退費' && ts !== '已退款';
  });
  if (dup.length) return {error:'您已報名此場次'};

  // 審核規則：以場次設定為基礎；members.fast_pass（免審核會員）直接錄取。fast_pass 只信資料庫。
  const needReview = ses.need_review===true||ses.need_review==='true';
  let fastPass = false;
  if (needReview && b.email) {
    const mrows = await dbGet(env,'members',`tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(String(b.email).trim())}&select=fast_pass`).catch(()=>[]);
    fastPass = !!(mrows[0] && (mrows[0].fast_pass === true || mrows[0].fast_pass === 'true'));
  }
  const status = (needReview && !fastPass) ? '待審核' : '已錄取';

  // 費用計算（一律後端算，前端金額不可信）
  const fee = b.bundleGroupId ? (Number(b.bundleFee)||0) : calcFee(ses, selectedDates, stallCount);
  const deposit = Number(ses.deposit)||0;
  const equipTotal = calcEquipTotal(b.equip||{}, ses.equip_json, stallCount, ses.basic_equip||'');
  let addonTotal=0;
  try {
    const addonDefs = safeJson(ses.addons_json,[]);
    const addonQty = b.addonQty||{};
    addonDefs.forEach((a,i)=>{ if(a&&a.open===true) addonTotal+=(Number(a.price)||0)*(Number(addonQty[i])||0); });
  } catch {}
  const total = fee+deposit+equipTotal+addonTotal;

  const pjSrc = (b.participantsJson && typeof b.participantsJson==='object') ? b.participantsJson : {};
  const adultCount = Math.max(0, parseInt(b.adultCount ?? pjSrc.adultCount ?? 0, 10) || 0);
  const childCount = Math.max(0, parseInt(b.childCount ?? pjSrc.childCount ?? 0, 10) || 0);
  const childAgesRaw = Array.isArray(b.childAges) ? b.childAges : (Array.isArray(pjSrc.childAges) ? pjSrc.childAges : []);
  const childAges = childAgesRaw.slice(0, childCount).map(x=>Number(x)).filter(x=>Number.isFinite(x) && x>=0);
  const participantsJson = {adultCount, childCount, childAges, totalCount: adultCount + childCount};

  const invoiceStatus = ((b.needInvoice===false||b.invoiceType==='不需要')?'':'待開立');

  const id = genId('REG');
  const row = {
    id, tenant_id:TENANT, bundle_id:b.bundleId||'', bundle_group_id:b.bundleGroupId||'',
    session_id:b.sessionId, event_id:cleanEventId(ses.event_id),
    email:b.email, member_id:b.email, name:b.name, phone:String(b.phone||''),
    brand_name:b.brand||'', brand_intro:b.brandIntro||'',
    sell_category:b.sellCat||b.sellCategory||'', sell_items:b.sellItem||'',
    sell_link:b.sellLink||'', photo_url:b.photo||'', fb_url:b.fb||'', ig_url:b.ig||'',
    equipment_json:(b.equip||{}),
    custom_fields_json:(b.customFields||[]),
    participants_json:participantsJson,
    stall_count:stallCount, deposit,
    review_status:status,
    payment_status:total===0?'免費':'未繳費',
    // H-01: pay_status 欄位廢棄，不再寫入
    amount:total, total_amount:total, addon_amount:addonTotal,
    paid_amount: 0,
    checkin_status:'未報到', clear_status:'未清場',
    deposit_refunded:'未退押金', stall_number:'',
    seat_choice_intent: (b.seatChoiceIntent==='paid'?'paid':'auto'),
    seat_choice_status: 'pending',
    selected_dates_json:selectedDates,
    addon_qty_json:(b.addonQty||{}),
    tax_id:b.taxId||'', invoice_title:b.invoiceTitle||'',
    invoice_type:b.invoiceType||'', invoice_email:b.invoiceEmail||'', invoice_carrier:b.invoiceCarrier||'',
    invoice_status:invoiceStatus,
    reminder_sent:false, created_at:nowIso(),
    // ── 合約同意快照 ──────────────────────────────────────
    agreement_accepted: agreementRequired ? true : (b.agreementAccepted===true),
    agreement_viewed:   agreementRequired ? true : (b.agreementViewed===true),
  };

  return {ses, id, row, meta:{
    sesType, stallCount, selectedDates, needReview, fastPass, status,
    fee, deposit, equipTotal, addonTotal, total, invoiceStatus,
  }};
}

// 交易成功之後才跑。這裡失敗不會回捲報名（報名已成立），但一律記錄，不靜默吞掉。
async function finalizeRegistration(env, TENANT, b, ses, id, meta, ctx) {
  try {
    await createRegistrationFinanceRecords(env, TENANT, id, b.sessionId, b.email,
      meta.fee, meta.deposit, meta.equipTotal, meta.addonTotal, {
        invoice_status: meta.invoiceStatus,
        invoice_type: b.invoiceType || '',
        invoice_title: b.invoiceTitle || '',
        tax_id: b.taxId || '',
        invoice_email: b.invoiceEmail || '',
        invoice_carrier: b.invoiceCarrier || '',
      });
  } catch(e) {
    console.error('FINANCE RECORDS FAILED reg=' + id + ':', e && e.message ? e.message : e); logError(env, {source:'finalizeRegistration', message:'FINANCE RECORDS FAILED reg=' + id + ':', error:e && e.message ? e.message : e});
  }

  // 會員同步是報名成立後的附帶工作。就算 members 暫時寫入失敗，也不能讓
  // 已經寫進 registrations 的報名在前台顯示成「送出失敗」。
  try {
    await upsertMember(env, b);
  } catch(e) {
    console.error('MEMBER UPSERT FAILED reg=' + id + ':', e && e.message ? e.message : e);
    logError(env, {source:'finalizeRegistration', action:'upsertMember', regId:id, sessionId:b.sessionId, email:b.email, message:'MEMBER UPSERT FAILED reg=' + id, error:e && e.message ? e.message : e});
  }

  if (b.stallNumber) {
    try {
      await holdStall(env, b.sessionId, b.stallNumber, id, b.email||'', TENANT);
    } catch(e) {
      console.error('STALL HOLD FAILED reg=' + id + ':', e && e.message ? e.message : e);
      logError(env, {source:'finalizeRegistration', action:'holdStall', regId:id, sessionId:b.sessionId, email:b.email, message:'STALL HOLD FAILED reg=' + id, error:e && e.message ? e.message : e});
    }
  }

  // 寄信不可阻塞前台成功畫面：Email 服務慢或失敗時，使用者不該卡在報名頁。
  const sendConfirmMail = async () => {
    try {
      const tcReg = await getTenantCtx(env, TENANT);
      const dn = getDisplayName(b.name, b.brand || '', meta.sesType);
      await mailRegConfirm(env, b.email, dn, ses.name || b.sessionId, id, meta.total, meta.stallCount, meta.selectedDates, b.equip || {}, tcReg);
      // 免審核會員報名需審核的場次會直接錄取，必須一併寄錄取信，否則攤友拿不到繳費指引。
      if (meta.needReview && meta.fastPass) {
        await mailApproval(env, b.email, dn, ses.name || b.sessionId, id, meta.total, meta.stallCount, meta.selectedDates, b.equip || {}, ses.basic_equip || '', tcReg);
      }
    } catch(e) {
      console.error('mailRegConfirm after register failed:', e && e.message ? e.message : String(e)); logError(env, {source:'finalizeRegistration', message:'mailRegConfirm after register failed:', error:e && e.message ? e.message : String(e)});
    }
  };
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(sendConfirmMail());
  else sendConfirmMail();
}

// 報名主交易與後續工作之間的永久隔離層：
// registrations 一旦成功建立，任何會員、財務、攤位或寄信後續都不得改寫成功結果。
async function finalizeRegistrationSafely(env, TENANT, b, ses, id, meta, ctx) {
  try {
    await finalizeRegistration(env, TENANT, b, ses, id, meta, ctx);
  } catch(e) {
    console.error('POST-REGISTRATION FINALIZE FAILED reg=' + id + ':', e && e.message ? e.message : e);
    logError(env, {source:'finalizeRegistrationSafely', action:'register', regId:id, sessionId:b.sessionId, email:b.email, message:'POST-REGISTRATION FINALIZE FAILED reg=' + id, error:e && e.message ? e.message : e});
  }
}

// 找出這個 Email 在某場次「還有效」的既有報名（已取消／不錄取／已退費 視為結束，不算）
async function findActiveRegForSession(env, TENANT, sessionId, email) {
  const exclude = encodeURIComponent('不錄取') + ',' + encodeURIComponent('已取消');
  const rows = await dbGet(env, 'registrations',
    `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&email=ilike.${encodeURIComponent(email)}&review_status=not.in.(${exclude})&select=*`
  ).catch(()=>[]);
  const live = rows.filter(r => {
    const ts = String(r.transfer_status || '').trim();
    return ts !== '已退費' && ts !== '已退款';
  });
  return live.length ? live[0] : null;
}

async function hRegisterBundle(env, b, ctx) {
  const T = b._tenantId;
  b.email = normEmail(b.email);
  b.phone = normPhone(b.phone);
  if (!b.email || !b.phone) return jsonErr('請填寫 Email 與手機');

  const bundleId = String(b.bundleId || '');
  const rows = await dbGet(env, 'session_bundles', `tenant_id=eq.${T}&id=eq.${encodeURIComponent(bundleId)}&active=eq.true&select=*`);
  if (!rows.length) return jsonErr('找不到套組');
  const bundle = rows[0];
  const sids = String(bundle.session_ids || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!sids.length) return jsonErr('套組沒有綁定場次');
  const groupId = genId('BGRP');

  // 套組場地費分攤：每一場的「應收」都是同一個數字，主辦拆帳才對得起來。
  const _btot = Number(bundle.bundle_price) || 0;
  const _bper = Math.floor(_btot / sids.length);
  const _brem = _btot - _bper * sids.length;
  const shareOf = i => _bper + (i === 0 ? _brem : 0);

  // 1) 全部先算好，此階段一個字都不寫資料庫。任一場不過就整組退回。
  //    已經單場報過的場次 → 併入（不重報、不退費，避免手續費）。
  const preps = [];   // 要新建的
  const merges = [];  // 要併入的既有報名
  for (let i = 0; i < sids.length; i++) {
    const sid = sids[i];
    const existing = await findActiveRegForSession(env, T, sid, b.email);

    if (existing) {
      if (String(existing.bundle_group_id || '').trim()) {
        return jsonErr('您在「' + sid + '」的報名已屬於其他套組，請聯繫主辦協助處理。');
      }
      const ses = await getSessionRow(env, sid, T);
      if (!ses) return jsonErr('找不到場次 ' + sid);
      // 應收重寫 = 套組分攤價 + 這筆自己的押金／設備／加購（設備費用同一套公式重算，不另寫一份）
      const equipTotal = calcEquipTotal(safeJson(existing.equipment_json, {}), ses.equip_json,
                                        safeNum(existing.stall_count) || 1, ses.basic_equip || '');
      const newTotal = shareOf(i) + safeNum(existing.deposit) + equipTotal + safeNum(existing.addon_amount);
      const paid = safeNum(existing.paid_amount);
      // 實收 >= 新應收 → 仍是已繳費；否則退回未繳費，差額（應收−已繳）由攤友補繳。
      // paid_amount 完全不碰：他付過的錢不可以被改寫。
      const payStatus = newTotal <= 0 ? '免費' : (paid >= newTotal ? '已繳費' : '未繳費');
      merges.push({
        id: existing.id, bundle_id: bundleId, bundle_group_id: groupId,
        amount: newTotal, total_amount: newTotal, payment_status: payStatus,
        _sessionId: sid, _paid: paid, _due: Math.max(0, newTotal - paid),
      });
      continue;
    }

    const bb = Object.assign({}, b, { sessionId: sid, bundleId, bundleGroupId: groupId, bundleFee: shareOf(i) });
    // BUNDLE_DATES_FIX_20260726：組合的「非主場」不可沿用主場 b.selectedDates（那是別場的日期，
    // 會導致第二場日期/費用算錯、顯示只剩一天）。改用該場自己 dates_json 的全部日期。
    if (String(sid) !== String(b.sessionId)) {
      try {
        const _ses = await getSessionRow(env, sid, T);
        bb.selectedDates = safeJson(_ses && _ses.dates_json, []).map(function(d){ return d && (d.date||d.day); }).filter(Boolean);
      } catch(_e){ bb.selectedDates = []; }
    }
    const prep = await prepareRegistration(env, bb);
    if (prep.error) return jsonErr('套組報名失敗：' + prep.error);
    preps.push({ bb, prep });
  }

  if (!preps.length && !merges.length) return jsonErr('套組沒有任何場次可處理');

  // 2) 單一資料庫交易：鎖場次 → 驗名額 → 更新 current_count → 改寫舊筆 → 插入新筆。
  //    任一步失敗，PostgreSQL 自動 rollback：不會半套報名、不會半套名額、不會改到一半的金額。
  let res;
  try {
    res = await dbRpc(env, 'create_bundle_registrations_atomic', {
      p_tenant_id: T,
      p_bundle_group_id: groupId,
      p_rows: preps.map(x => x.prep.row),
      p_merges: merges.map(m => ({
        id: m.id, bundle_id: m.bundle_id, bundle_group_id: m.bundle_group_id,
        amount: m.amount, total_amount: m.total_amount, payment_status: m.payment_status,
      })),
    });
  } catch(e) {
    console.error('bundle atomic RPC failed:', e && e.message); logError(env, {source:'hRegisterBundle', message:'bundle atomic RPC failed:', error:e && e.message});
    return jsonErr('套組報名失敗，未建立任何報名：' + ((e && e.message) || '資料庫交易失敗'));
  }
  if (!res || res.ok === false) {
    return jsonErr('套組報名失敗，未建立任何報名：' + ((res && res.error) || '名額不足'));
  }

  // 3) 交易成功後，才做非交易性的後續（財務明細、會員、攤位、寄信）。
  //    絕不可提早，否則失敗時信已經寄出去了。
  for (const { bb, prep } of preps) {
    await finalizeRegistrationSafely(env, T, bb, prep.ses, prep.id, prep.meta, ctx);
  }

  const dueTotal = merges.reduce((n, m) => n + m._due, 0)
                 + preps.reduce((n, x) => n + x.prep.meta.total, 0);
  return jsonOk({
    success: true, bundleGroupId: groupId, count: sids.length,
    mergedCount: merges.length,
    dueTotal,
    registrations: preps.map(x => ({ id: x.prep.id, sessionId: x.bb.sessionId, status: x.prep.meta.status, total: x.prep.meta.total })),
    merged: merges.map(m => ({ id: m.id, sessionId: m._sessionId, total: m.total_amount, paid: m._paid, due: m._due })),
  });
}

async function hRegister(env, b, ctx) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const prep = await prepareRegistration(env, b);
  if (prep.error) return jsonErr(prep.error);
  const { ses, id, row, meta } = prep;

  // M-01：insert 之前原子鎖定名額。
  // B-05：舊寫法 if (!b.bundleGroupId && claim 失敗) 會讓套組情境略過這道檢查。claim 失敗永遠要擋。
  const claimResult = await dbRpc(env, 'claim_session_slot', {
    p_tenant_id: TENANT, p_session_id: b.sessionId, p_stall_count: meta.stallCount
  });
  if (!claimResult || claimResult.ok === false) {
    return jsonErr(claimResult ? (claimResult.error || '名額不足') : '名額鎖定失敗，請稍後再試');
  }

  try {
    await dbInsert(env, 'registrations', row);
  } catch(e) {
    console.error('DB INSERT registrations failed:', e && e.message ? e.message : e); logError(env, {source:'hRegister', message:'DB INSERT registrations failed:', error:e && e.message ? e.message : e});
    // FIX-02：registrations 寫入失敗，把名額還回去
    try {
      await dbRpc(env, 'release_session_slot', {
        p_tenant_id: TENANT, p_session_id: b.sessionId, p_stall_count: meta.stallCount
      });
    } catch(re) { console.error('release_session_slot failed after register error', re&&re.message); logError(env, {source:'hRegister', message:'release_session_slot failed after register error', error:re&&re.message}); }
    return jsonErr('報名建立失敗，請稍後再試（名額已釋放）');
  }

  await finalizeRegistrationSafely(env, TENANT, b, ses, id, meta, ctx);
  return jsonOk({success:true, ok:true, id, status:meta.status, total:meta.total});
}


async function createRegistrationFinanceRecords(env, TENANT, regId, sessionId, email, fee, deposit, equipTotal, addonTotal, invoicePayload) {
  const items = [];
  if (safeNum(fee) > 0) items.push({id:genId('ITEM'), registration_id:regId, item_type:'stall_fee', item_name:'報名費／攤位費', quantity:1, unit_price:safeNum(fee), amount:safeNum(fee), note:'tax_included'});
  if (safeNum(deposit) > 0) items.push({id:genId('ITEM'), registration_id:regId, item_type:'deposit', item_name:'押金', quantity:1, unit_price:safeNum(deposit), amount:safeNum(deposit), note:'exclude_from_invoice'});
  if (safeNum(equipTotal) > 0) items.push({id:genId('ITEM'), registration_id:regId, item_type:'equipment', item_name:'設備費', quantity:1, unit_price:safeNum(equipTotal), amount:safeNum(equipTotal), note:''});
  if (safeNum(addonTotal) > 0) items.push({id:genId('ITEM'), registration_id:regId, item_type:'addon', item_name:'加購項目', quantity:1, unit_price:safeNum(addonTotal), amount:safeNum(addonTotal), note:'tax_included'});
  for (const it of items) await dbInsert(env, 'registration_items', Object.assign({tenant_id: TENANT}, it));

  const invoiceTotal = safeNum(fee) + safeNum(equipTotal) + safeNum(addonTotal);
  if (invoiceTotal > 0 && invoicePayload && invoicePayload.invoice_status) {
    const untaxed = Math.round(invoiceTotal / 1.05);
    const tax = invoiceTotal - untaxed;
    await dbInsert(env, 'invoices', {
      tenant_id: TENANT,
      id: genId('INV'),
      registration_id: regId,
      invoice_type: invoicePayload.invoice_type || '',
      invoice_title: invoicePayload.invoice_title || '',
      tax_id: invoicePayload.tax_id || '',
      email: invoicePayload.invoice_email || email || '',
      carrier: invoicePayload.invoice_carrier || '',
      amount: invoiceTotal,
      status: invoicePayload.invoice_status,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }
}

// upsertMember
async function upsertMember(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  b.email = normEmail(b.email);
  b.phone = normPhone(b.phone);
  if (!b.email) return;
  const now = nowIso();
  const rows = await dbGet(env, 'members', `tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(b.email)}&select=*`);
  const data = {
    email:b.email, tenant_id:TENANT,
    name:b.name||'', phone:String(b.phone||''),
    brand_name:b.brand||'', brand_intro:b.brandIntro||'',
    sell_category:b.sellCat||b.sellCategory||'',
    photo_url:b.photo||b.photo_url||'', fb_url:b.fb||b.fb_url||'', ig_url:b.ig||b.ig_url||'',
    collab_url:b.collabUrl||b.collab_url||b.website||b.web||'', collab_desc:b.collabDesc||b.collab_desc||'',
    company:b.company||b.invoiceTitle||'', tax_id:b.taxId||'',
    invoice_type:b.invoiceType||'', invoice_title:b.invoiceTitle||b.company||'',
    invoice_email:b.invoiceEmail||'', invoice_carrier:b.invoiceCarrier||'',
    collab_items:b.collabItems||'', city:b.city||'', line_id:b.lineId||'', updated_at:now,
  };
  // 部分流程只會帶入少數欄位；更新既有會員時，沒傳來的欄位必須保留，
  // 不可把原本已填的社群／官網或品牌資料洗成空白。
  if (rows.length) {
    const supplied=(...keys)=>keys.some(k=>Object.prototype.hasOwnProperty.call(b,k));
    if(!supplied('name')) delete data.name;
    if(!supplied('phone')) delete data.phone;
    if(!supplied('brand')) delete data.brand_name;
    if(!supplied('brandIntro')) delete data.brand_intro;
    if(!supplied('sellCat','sellCategory')) delete data.sell_category;
    if(!supplied('photo')) delete data.photo_url;
    if(!supplied('fb','fb_url')) delete data.fb_url;
    if(!supplied('ig','ig_url')) delete data.ig_url;
    if(!supplied('collabUrl','collab_url','website','web')) delete data.collab_url;
    if(!supplied('collabDesc','collab_desc')) delete data.collab_desc;
    if(!supplied('company','invoiceTitle')) delete data.company;
    if(!supplied('taxId')) delete data.tax_id;
    if(!supplied('invoiceType')) delete data.invoice_type;
    if(!supplied('invoiceTitle','company')) delete data.invoice_title;
    if(!supplied('invoiceEmail')) delete data.invoice_email;
    if(!supplied('invoiceCarrier')) delete data.invoice_carrier;
    if(!supplied('collabItems')) delete data.collab_items;
    if(!supplied('city')) delete data.city;
    if(!supplied('lineId')) delete data.line_id;
  }
  if (!rows.length) {
    data.joined_at = now; data.fast_pass = false;
    await dbInsert(env, 'members', data);
  } else {
    data.joined_at = rows[0].joined_at;
    await dbUpdate(env, 'members', `email=ilike.${encodeURIComponent(b.email)}&tenant_id=eq.${TENANT}`, data);
  }
}

// holdStall helper
async function holdStall(env, sessionId, stallNumber, regId, email, tenantId) {
  const TENANT = tenantId ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env, 'stalls', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&stall_no=eq.${encodeURIComponent(stallNumber)}&select=*`);
  if (!rows.length) return;
  const s = rows[0];
  if ((s.status==='鎖定'||s.status==='預留') && String(s.registration_id||s.reg_id||'')!==String(regId)) return;
  await dbUpdate(env, 'stalls', `id=eq.${s.id}&tenant_id=eq.${TENANT}`, {status:'預留',reg_id:regId,email,hold_time:nowIso()});
}

// saveMember
async function hSaveMember(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const email = normEmail(b && b.email);
  // authPhone＝目前已驗證的「舊手機」；b.phone＝要存進去的「新手機」。兩者絕不可混用，
  // 否則改手機時會拿新手機驗自己，等於誰都能改。
  const authPhone = normPhone(b && b.authPhone);
  if (!email || !authPhone) return jsonErr('請先以 Email 與手機完成身份驗證');
  const verified = await findVerifiedMemberByEmailPhone(env, TENANT, email, authPhone);
  if (!verified || normEmail(verified.email) !== email) return jsonErr('身份驗證失敗，無權限修改此會員資料');
  const socialOrWebsite=String(b.fb||'').trim()||String(b.ig||'').trim()||String(b.collabUrl||b.website||b.web||'').trim();
  if(!socialOrWebsite) return jsonErr('FB、IG 或官網至少需要填寫一項');
  b.email = email;
  await upsertMember(env, b);
  const savedRows = await dbGet(env,'members',`tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(email)}&select=*`).catch(()=>[]);
  const saved = savedRows.length ? {...savedRows[0], _source:'members'} : null;
  const _ps = _memberProfileStatus(saved||{});
  return jsonOk({success:true, member: saved?memberPayloadFromRow(saved):null, profileComplete:_ps.profileComplete, missingFields:_ps.missingFields});
}

// cancelReg
// ── 組合套組同進退共用核心 ──
// 規則：組合套組（bundle_group_id 相同）是綁定優惠，退一場＝整組一起退／取消，
// 不可只退其中一場（否則等於用組合價買單場）。三條路（前台取消／後台取消／申請退費）共用此核心。
async function getBundleGroupRegs(env, TENANT, reg){
  const gid = String(reg && reg.bundle_group_id || '').trim();
  if(!gid) return [reg];
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&bundle_group_id=eq.${encodeURIComponent(gid)}&select=*`).catch(()=>[]);
  return rows.length ? rows : [reg];
}
async function releaseRegistrationSeats(env,TENANT,reg,reason){
  let count=0;
  // 每日排位才是正式位置來源。取消／完成退費時只釋放這一筆報名，
  // 不得重新整理或移動同場其他攤商。
  try{
    const daily=await dbGet(env,'registration_day_seats',`tenant_id=eq.${TENANT}&registration_id=eq.${encodeURIComponent(reg.id)}&select=activity_date,seat_code`).catch(()=>[]);
    count=daily.length;
    await dbDelete(env,'registration_day_seats',`tenant_id=eq.${TENANT}&registration_id=eq.${encodeURIComponent(reg.id)}`);
    await dbUpdate(env,'registration_day_ops',`tenant_id=eq.${TENANT}&registration_id=eq.${encodeURIComponent(reg.id)}`,{stall_number:'',updated_at:nowIso()});
  }catch(e){ logError(env,{source:'releaseRegistrationSeats',message:(reason||'release seats failed')+' (daily)',error:e&&e.message?e.message:e}); }
  try{
    const st=await dbGet(env,'stalls',`tenant_id=eq.${TENANT}&reg_id=eq.${encodeURIComponent(reg.id)}&select=id`);
    for(const s of st){ await dbUpdate(env,'stalls',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(s.id)}`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null,updated_at:nowIso()}); }
  }catch(e){ logError(env,{source:'releaseRegistrationSeats',message:reason||'release seats failed',error:e&&e.message?e.message:e}); }
  try{ await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.id)}`,{stall_number:null,seat_choice_status:'released',seat_choice_type:null,seat_hold_expires_at:null}); }catch(e){}
  return count;
}
async function hCancelReg(env, b) {
  const TENANT = (b && b._tenantId);
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if(!rows.length) return jsonErr('找不到報名');
  const reg=rows[0];
  const own=regOwnerGuard(reg,b,'取消'); if(own) return own;
  if(isPaidStatus(_payStatus(reg)) || safeNum(reg.paid_amount)>0) return jsonErr('已有實收金額，請走退款申請流程');
  if(isCapacityInactiveTransferStatus(reg.transfer_status)) return jsonErr('此報名已進入退款或退費完成流程，不能用取消流程處理');
  const group=await getBundleGroupRegs(env,TENANT,reg);
  if(group.some(g=>isPaidStatus(_payStatus(g))||safeNum(g.paid_amount)>0)) return jsonErr('此組合已有實收金額，整組必須走退款申請流程');
  for(const g of group){
    if(_reviewStatus(g)==='已取消') continue;
    const active=isActiveForCapacity(g);
    const note=(String(g.admin_note||'').trim()+' [前台] 取消未繳費報名'+(group.length>1?'（組合整組取消）':'')+' '+nowTaipeiText()).trim();
    await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(g.id)}`,{
      review_status:'已取消', payment_status:'已取消', transfer_status:null,
      payment_report_amount:0,payment_last5:null,payment_reported_at:null,
      stall_number:null,seat_choice_status:'released',seat_choice_type:null,seat_hold_expires_at:null,admin_note:note
    });
    if(active) await adjustSessionCurrentCount(env,TENANT,g.session_id,-(safeNum(g.stall_count)||1));
    await releaseRegistrationSeats(env,TENANT,g,'member_cancel');
    try{ await dbUpdate(env,'payments',`tenant_id=eq.${TENANT}&registration_id=eq.${encodeURIComponent(g.id)}&status=eq.%E5%BE%85%E7%A2%BA%E8%AA%8D`,{status:'已取消'}); }catch(e){}
  }
  try{ const sesName=await getSessionName(env,reg.session_id,TENANT); const tc=await getTenantCtx(env,TENANT); await mailCancelReg(env,reg.email,getDisplayName(reg.name,reg.brand_name||'',''),sesName,tc); }catch(e){}
  return jsonOk({success:true,bundleCount:group.length});
}
// ── 加價選位模組（V8）────────────────────────────────────────
function seatTypeLabel(t){ return ({auto:'自動排位', paid:'加價選位', service:'服務台', closed:'不開放'})[String(t||'auto')] || '自動排位'; }
function normalizeSeatType(t){
  const v=String(t||'auto').trim();
  if(['auto','paid','service','closed'].includes(v)) return v;
  if(v.includes('加價')) return 'paid';
  if(v.includes('服務')) return 'service';
  if(v.includes('不開')) return 'closed';
  return 'auto';
}
function isSeatOccupiedActive(row){
  const st=String(row.status||'');
  if(st==='鎖定') return true;
  if(st==='預留'){
    const exp=row.seat_hold_expires_at||row.hold_expires_at||'';
    if(!exp) return true;
    return Date.parse(exp) > Date.now();
  }
  return false;
}
function seatCodeOf(row){ return row.seat_code || row.stall_no || row.number || ''; }
function seatRegId(row){ return row.registration_id || row.reg_id || ''; }
function addHoursIso(h){ return new Date(Date.now() + (Number(h)||24)*60*60*1000).toISOString(); }
function isHoldExpiredAt(v){ return !!v && Date.parse(v) <= Date.now(); }
function isPaidSeatHoldExpired(reg){
  return String(reg?.seat_choice_intent||'')==='paid' && String(reg?.seat_choice_status||'')==='reserved' && isHoldExpiredAt(reg?.seat_hold_expires_at);
}
async function getExistingSeatFeeFromItems(env, regId, tenantId){
  try {
    const _t=String(tenantId||'').trim();
    const rows = await dbGet(env,'registration_items',`${_t?`tenant_id=eq.${encodeURIComponent(_t)}&`:''}registration_id=eq.${encodeURIComponent(regId)}&item_type=eq.seat_fee&select=amount`);
    return rows.reduce((sum,r)=>sum+safeNum(r.amount),0);
  } catch(e) { return 0; }
}
async function releasePaidSeatHold(env, tenantId, reg, reason='expired'){
  if(!reg || !reg.id) return;
  try{
    await dbUpdate(env,'stalls',`tenant_id=eq.${tenantId}&reg_id=eq.${encodeURIComponent(reg.id)}&status=eq.預留`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null});
  }catch(e){ console.error('releasePaidSeatHold stalls skipped', e&&e.message?e.message:e); logError(env, {source:'releasePaidSeatHold', message:'releasePaidSeatHold stalls skipped', error:e&&e.message?e.message:e}); }
  const oldSeatFee = await getExistingSeatFeeFromItems(env, reg.id, tenantId);
  try{ await rebuildSeatFeeItem(env,tenantId,reg,reg.session_id,0); }catch(e){}
  const baseAmount=Math.max(0,(safeNum(reg.total_amount)||safeNum(reg.amount)||0)-oldSeatFee);
  try{
    await dbUpdate(env,'registrations',`tenant_id=eq.${tenantId}&id=eq.${encodeURIComponent(reg.id)}`,{
      stall_number:null, seat_choice_status:'released', seat_choice_type:null,
      seat_fee_total:0, seat_hold_expires_at:null, amount:baseAmount, total_amount:baseAmount
    });
  }catch(e){ console.error('releasePaidSeatHold reg skipped', e&&e.message?e.message:e); logError(env, {source:'releasePaidSeatHold', message:'releasePaidSeatHold reg skipped', error:e&&e.message?e.message:e}); }
}
async function claimSeatRowAtomic(env, tenantId, seat, reg, expiresAt){
  const code=seatCodeOf(seat);
  if(String(seatRegId(seat)||'')===String(reg.id||'') && String(seat.status||'')==='預留' && !isHoldExpiredAt(seat.seat_hold_expires_at)){
    const rows=await dbUpdateReturning(env,'stalls',`tenant_id=eq.${tenantId}&id=eq.${encodeURIComponent(seat.id)}&reg_id=eq.${encodeURIComponent(reg.id)}`,{status:'預留',email:reg.email,hold_time:nowIso(),seat_hold_expires_at:expiresAt});
    if(!rows.length) throw new Error('此位置已被選走，請重新選擇其他位置。');
    return rows[0];
  }
  const rows=await dbUpdateReturning(env,'stalls',`tenant_id=eq.${tenantId}&id=eq.${encodeURIComponent(seat.id)}&status=eq.空閒&reg_id=is.null&is_active=eq.true`,{status:'預留',reg_id:reg.id,email:reg.email,hold_time:nowIso(),seat_hold_expires_at:expiresAt});
  if(!rows.length) throw new Error(code+' 已被選走，請重新選擇其他位置。');
  return rows[0];
}
async function getSessionSeatSetting(env, tenantId, sessionId){
  const rows=await dbGet(env,'sessions',`tenant_id=eq.${tenantId}&id=eq.${encodeURIComponent(sessionId)}&select=id,seat_pricing_enabled,seat_hold_hours,seat_map_url`);
  if(!rows.length) return {enabled:false, holdHours:SEAT_HOLD_HOURS, mapUrl:''};
  const s=rows[0];
  return {enabled:s.seat_pricing_enabled===true||s.seat_pricing_enabled==='true', holdHours:safeNum(s.seat_hold_hours)||SEAT_HOLD_HOURS, mapUrl:s.seat_map_url||''};
}
async function getSeatRows(env, tenantId, sessionId){
  return await dbGet(env,'stalls',`tenant_id=eq.${tenantId}&session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=map_order.asc,seat_code.asc`);
}
// B-02：公開選位圖不得回傳 id／regId／email。
// 前台只需要知道「這格是不是我的」，所以改回 mine 旗標；ownRegId 由後端驗證後帶入，
// 呼叫端無法自行指定別人的 regId 來探測。
function publicSeat(row, ownRegId){
  const code=seatCodeOf(row);
  const type=normalizeSeatType(row.seat_type);
  const rid=String(seatRegId(row)||'');
  return {
    code, stallNo:code, seatCode:code,
    type, typeLabel:seatTypeLabel(type),
    price:safeNum(row.price_delta), priceDelta:safeNum(row.price_delta),
    x:safeNum(row.map_x), y:safeNum(row.map_y), order:safeNum(row.map_order),
    active: (type==='auto'||type==='paid') && row.is_active!==false && row.is_active!=='false',
    note:row.note||'', status:row.status||'空閒',
    mine: !!(ownRegId && rid && rid===String(ownRegId)),
    holdExpiresAt:row.seat_hold_expires_at||'',
    occupied:isSeatOccupiedActive(row)
  };
}
async function hGetSeatMap(env,p){
  const TENANT=p._tenantId;
  if(!p.sessionId) return jsonErr('缺少場次編號');
  const setting=await getSessionSeatSetting(env,TENANT,p.sessionId);
  let rows=[]; try{ rows=await getSeatRows(env,TENANT,p.sessionId); }catch(e){ rows=[]; }
  // 只有通過 Email＋手機驗證的本人，才會拿到自己那格的 mine=true；
  // 未驗證者一律看到「已被佔用」，看不出是誰。
  let ownRegId='';
  if (p.regId && p.email && p.phone) {
    const regRows=await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(p.regId)}&select=id,email,phone`).catch(()=>[]);
    if (regRows.length && isRegistrationOwner(regRows[0], p.email, p.phone)) ownRegId=String(regRows[0].id);
  }
  const seats=rows.map(r=>publicSeat(r, ownRegId));
  return jsonOk({enabled:setting.enabled, holdHours:setting.holdHours, mapUrl:setting.mapUrl, seats});
}
// ══════════════════════════════════════════════════════════════
// 活動限定拍照框（行銷工具）
//   顯示條件：開關開 AND（無限期 或 現在在區間內）AND 範圍相符
//   優先序：場次框 > 活動框 > 全站框；同層取 start_at 較晚者（新上架勝出）
// ══════════════════════════════════════════════════════════════
function photoFrameActiveNow(f, nowMs){
  if(!f) return false;
  if(f.is_active===false || f.is_active==='false') return false;
  if(f.is_unlimited===true || f.is_unlimited==='true') return true;
  const st = f.start_at ? Date.parse(f.start_at) : NaN;
  const en = f.end_at   ? Date.parse(f.end_at)   : NaN;
  if(!isNaN(st) && nowMs < st) return false;
  if(!isNaN(en) && nowMs > en) return false;
  return true;
}
function photoFramePickLatest(list){
  if(!list || !list.length) return null;
  return list.slice().sort((a,b)=>{
    const sa = a.start_at ? Date.parse(a.start_at) : (a.created_at ? Date.parse(a.created_at) : 0);
    const sb = b.start_at ? Date.parse(b.start_at) : (b.created_at ? Date.parse(b.created_at) : 0);
    return (isNaN(sb)?0:sb) - (isNaN(sa)?0:sa);
  })[0] || null;
}
// 前台：問「現在這個場次／活動該顯示哪張框」（不需登入）
// 前台：一次取回目前所有「有效中」的框，讓前端自行對應各場次（省去逐卡打 API）
async function hListActivePhotoFrames(env,b){
  const T=b._tenantId; if(!T) return jsonOk({frames:[]});
  let rows=[];
  try{ rows=await dbGet(env,'photo_frames',`tenant_id=eq.${T}&select=*`); }
  catch(e){ logError(env,{source:'hListActivePhotoFrames',message:'read frames failed',error:e&&e.message?e.message:e}); return jsonOk({frames:[]}); }
  const now=Date.now();
  const list=(rows||[]).filter(f=>photoFrameActiveNow(f,now)).map(f=>({
    id:f.id, name:f.name||'', frameUrl:f.frame_url||'',
    scopeType:String(f.scope_type||'all'),
    scopeEventId:f.scope_event_id||'', scopeSessionId:f.scope_session_id||'',
    startAt:f.start_at||'', createdAt:f.created_at||''
  }));
  return jsonOk({frames:list});
}
// 前台：用專屬連結／QR 直接開啟某一張框（公開，不需登入、不需場次）
async function hGetPhotoFrameById(env,b){
  const T=b._tenantId; if(!T) return jsonErr('缺少主辦代碼');
  const id=String(b.frameId||'').trim();
  if(!id) return jsonErr('缺少拍照框編號');
  let rows=[];
  try{ rows=await dbGet(env,'photo_frames',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(id)}&select=*`); }
  catch(e){ logError(env,{source:'hGetPhotoFrameById',message:'read frame failed',error:e&&e.message?e.message:e}); return jsonErr('讀取失敗'); }
  const f=(rows||[])[0];
  if(!f) return jsonErr('找不到這張拍照框');
  if(!photoFrameActiveNow(f,Date.now())) return jsonErr('這張拍照框目前未開放');
  return jsonOk({frame:{id:f.id,name:f.name||'',frameUrl:f.frame_url||'',scopeType:String(f.scope_type||'none')}});
}
// 前台：送出問卷（不建會員、不登入）
async function hSubmitPhotoLead(env,b){
  const T=b._tenantId; if(!T) return jsonErr('缺少主辦代碼');
  const name=String(b.name||'').trim();
  const email=String(b.email||'').trim();
  if(!name) return jsonErr('請填姓名或暱稱');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonErr('Email 格式不正確');
  const id=genId('PLD');
  try{
    await dbInsert(env,'photo_leads',{
      id, tenant_id:T,
      frame_id:String(b.frameId||'')||null,
      event_id:String(b.eventId||'')||null,
      session_id:String(b.sessionId||'')||null,
      name, email,
      phone:String(b.phone||'').trim(),
      first_time:String(b.firstTime||''),
      source:String(b.source||''),
      marketing_consent:(b.consent===true||b.consent==='true'),
      created_at:nowIso()
    });
  }catch(e){
    logError(env,{source:'hSubmitPhotoLead',message:'insert lead failed',error:e&&e.message?e.message:e});
    return jsonErr('送出失敗，請稍後再試');
  }
  return jsonOk({success:true,id});
}
// 後台：框清單（含每張框收到幾筆、其中幾筆願意收訊息）
async function hListPhotoFrames(env,b){
  const T=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,T,'sessions')) return jsonErr('無權限');
  const rows=_scopePhotoFrames(b,await dbGet(env,'photo_frames',`tenant_id=eq.${T}&select=*`));
  let leads=[];
  try{ leads=await dbGet(env,'photo_leads',`tenant_id=eq.${T}&select=frame_id,marketing_consent`); }catch(e){ leads=[]; }
  if(b._authz && b._authz.allowedSessionIds!==null){const ids=new Set(rows.map(x=>String(x.id)));leads=leads.filter(x=>ids.has(String(x.frame_id)));}
  const cnt={}, con={};
  for(const l of (leads||[])){
    const k=String(l.frame_id||'');
    cnt[k]=(cnt[k]||0)+1;
    if(l.marketing_consent===true||l.marketing_consent==='true') con[k]=(con[k]||0)+1;
  }
  const list=(rows||[]).map(f=>Object.assign({},f,{lead_count:cnt[String(f.id)]||0, consent_count:con[String(f.id)]||0}))
    .sort((a,b2)=>String(b2.created_at||'').localeCompare(String(a.created_at||'')));
  return jsonOk({frames:list, total_leads:(leads||[]).length});
}
// 後台：新增／修改框
async function hSavePhotoFrame(env,b){
  const T=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,T,'sessions')) return jsonErr('無權限');
  const name=String(b.name||'').trim();
  if(!name) return jsonErr('請填框名稱');
  const scope=['none','all','event','session'].includes(String(b.scopeType||'')) ? String(b.scopeType) : 'none';
  if(scope==='event' && !String(b.scopeEventId||'').trim()) return jsonErr('請選擇要綁定的活動');
  if(scope==='session' && !String(b.scopeSessionId||'').trim()) return jsonErr('請選擇要綁定的場次');
  const unlimited=(b.isUnlimited===true||b.isUnlimited==='true');
  const startAt=String(b.startAt||'').trim();
  const endAt=String(b.endAt||'').trim();
  if(!unlimited && startAt && endAt && Date.parse(endAt) < Date.parse(startAt)) return jsonErr('結束時間不可早於開始時間');
  const payload={
    tenant_id:T, name,
    frame_url:String(b.frameUrl||'').trim(),
    is_active:(b.isActive===false||b.isActive==='false')?false:true,
    is_unlimited:unlimited,
    start_at: (!unlimited && startAt) ? startAt : null,
    end_at:   (!unlimited && endAt)   ? endAt   : null,
    scope_type:scope,
    scope_event_id:  scope==='event'   ? String(b.scopeEventId||'').trim()   : null,
    scope_session_id:scope==='session' ? String(b.scopeSessionId||'').trim() : null,
    note:String(b.note||''),
    updated_at:nowIso()
  };
  if(b.frameId){
    await dbUpdate(env,'photo_frames',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.frameId)}`,payload);
    return jsonOk({success:true,id:b.frameId,updated:true});
  }
  const id=genId('PFR');
  await dbInsert(env,'photo_frames',Object.assign({id,created_at:nowIso()},payload));
  return jsonOk({success:true,id});
}
// 後台：刪除框（不影響已收到的名單）
async function hDeletePhotoFrame(env,b){
  const T=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,T,'sessions')) return jsonErr('無權限');
  if(!b.frameId) return jsonErr('缺少框編號');
  await dbDelete(env,'photo_frames',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.frameId)}`);
  return jsonOk({success:true});
}
// 後台：名單（可依框／來源／是否願意收訊息／日期篩選）
async function hListPhotoLeads(env,b){
  const T=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,T,'sessions')) return jsonErr('無權限');
  let qs=`tenant_id=eq.${T}&select=*`;
  if(b.frameId) qs+=`&frame_id=eq.${encodeURIComponent(b.frameId)}`;
  if(b.source)  qs+=`&source=eq.${encodeURIComponent(b.source)}`;
  if(b.consentOnly===true||b.consentOnly==='true') qs+='&marketing_consent=eq.true';
  if(b.from) qs+=`&created_at=gte.${encodeURIComponent(b.from)}`;
  if(b.to)   qs+=`&created_at=lte.${encodeURIComponent(b.to)}`;
  let rows=await dbGet(env,'photo_leads',qs);
  if(b._authz && b._authz.allowedSessionIds!==null){const frames=_scopePhotoFrames(b,await dbGet(env,'photo_frames',`tenant_id=eq.${T}&select=id,scope_type,scope_event_id,scope_session_id`).catch(()=>[])),ids=new Set(frames.map(x=>String(x.id)));rows=(rows||[]).filter(x=>ids.has(String(x.frame_id)));}
  const list=(rows||[]).sort((a,b2)=>String(b2.created_at||'').localeCompare(String(a.created_at||'')));
  const consent=list.filter(l=>l.marketing_consent===true||l.marketing_consent==='true').length;
  const bySource={};
  for(const l of list){ const k=String(l.source||'未填'); bySource[k]=(bySource[k]||0)+1; }
  return jsonOk({leads:list, total:list.length, consent_total:consent, by_source:bySource});
}

// 活動名單：把「拍照框名單（民眾）」與「會員（攤商）」以 Email 合併去重，
// 產生單一份可再行銷的人名單。只讀不寫，不建立任何會員。
async function hListContactLeads(env,b){
  const T=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,T,'sessions')) return jsonErr('無權限');
  let leads=[], mems=[];
  try{ leads=await dbGet(env,'photo_leads',`tenant_id=eq.${T}&select=name,email,phone,source,first_time,marketing_consent,frame_id,session_id,created_at`); }catch(e){ leads=[]; }
  try{ mems=await dbGet(env,'members',`tenant_id=eq.${T}&select=name,display_name,brand_name,email,phone,joined_at,last_login_at`); }catch(e){ mems=[]; }
  const map={};
  const keyOf=e=>String(e||'').trim().toLowerCase();
  for(const l of (leads||[])){
    const k=keyOf(l.email); if(!k) continue;
    const cur=map[k]||{email:String(l.email||'').trim(),name:'',phone:'',isPublic:false,isVendor:false,brand:'',consent:false,sources:[],lastAt:''};
    cur.name=cur.name||String(l.name||'');
    cur.phone=cur.phone||String(l.phone||'');
    cur.isPublic=true;
    if(l.marketing_consent===true||l.marketing_consent==='true') cur.consent=true;
    const src=String(l.source||'').trim(); if(src && cur.sources.indexOf(src)<0) cur.sources.push(src);
    const t=String(l.created_at||''); if(t>cur.lastAt) cur.lastAt=t;
    map[k]=cur;
  }
  for(const m of (mems||[])){
    const k=keyOf(m.email); if(!k) continue;
    const cur=map[k]||{email:String(m.email||'').trim(),name:'',phone:'',isPublic:false,isVendor:false,brand:'',consent:false,sources:[],lastAt:''};
    cur.name=cur.name||String(m.name||m.display_name||'');
    cur.phone=cur.phone||String(m.phone||'');
    cur.brand=cur.brand||String(m.brand_name||'');
    cur.isVendor=true;
    const t=String(m.last_login_at||m.joined_at||''); if(t>cur.lastAt) cur.lastAt=t;
    map[k]=cur;
  }
  const list=Object.keys(map).map(k=>map[k]).sort((a,b2)=>String(b2.lastAt||'').localeCompare(String(a.lastAt||'')));
  return jsonOk({
    contacts:list,
    total:list.length,
    consent_total:list.filter(x=>x.consent).length,
    public_total:list.filter(x=>x.isPublic).length,
    vendor_total:list.filter(x=>x.isVendor).length,
    both_total:list.filter(x=>x.isPublic&&x.isVendor).length
  });
}

// ── 常用場地圖庫（租戶層級可重用：圖片 + 整份攤位清單） ──
function normalizeVenueMapSeats(raw){
  const parsed=safeJson(raw,[]);
  if(Array.isArray(parsed)) return parsed;
  if(parsed && Array.isArray(parsed.seats)) return parsed.seats;
  if(parsed && Array.isArray(parsed.items)) return parsed.items;
  return [];
}
// 選位設定唯一正規化來源：後台只管理「攤位（固定）／服務台／禁用」。
// 固定攤位由 price 自動映射為 auto（0 元）或 paid（>0 元）；舊 category 不再沿用。
function normalizeSeatConfigItem(raw={}, index=0){
  const code=String(raw.code||raw.seatCode||raw.seat_code||raw.stallNo||raw.stall_no||raw.number||'').trim();
  const oldType=normalizeSeatType(raw.type||raw.seatType||raw.seat_type||'auto');
  const legacyInactive=(raw.active===false||raw.active==='false'||raw.is_active===false||raw.is_active==='false');
  let kind=(oldType==='service')?'service':((oldType==='closed'||legacyInactive)?'closed':'fixed');
  let price=Math.max(0,safeNum(raw.price||raw.priceDelta||raw.price_delta));
  if(kind!=='fixed') price=0;
  const type=kind==='service'?'service':kind==='closed'?'closed':(price>0?'paid':'auto');
  return {
    code,
    type,
    price,
    x:safeNum(raw.x||raw.mapX||raw.map_x),
    y:safeNum(raw.y||raw.mapY||raw.map_y),
    order:safeNum(raw.order||raw.mapOrder||raw.map_order)||index+1,
    note:String(raw.note||''),
    active:type==='auto'||type==='paid',
    category:''
  };
}
function normalizeSeatConfigList(raw){
  return normalizeVenueMapSeats(raw).map((item,index)=>normalizeSeatConfigItem(item,index)).filter(item=>item.code);
}
function seatMapApplyErrorMessage(err){
  const m=String(err&&err.message?err.message:err||'');
  if(/column.*number|Could not find.*number/i.test(m)) return '資料庫攤位欄位版本不一致（舊 number 欄位），請更新 Worker 後再試。';
  if(/seat_assign_days_before/i.test(m)) return '資料庫缺少自動排位設定欄位，請先執行正式場地圖資料庫更新。';
  if(/venue_map_template_id/i.test(m)) return '資料庫缺少常用場地圖關聯欄位，請先執行正式場地圖資料庫更新。';
  if(/duplicate key|unique constraint/i.test(m)) return '場地圖內有重複攤位號碼，請檢查常用圖號碼。';
  return '資料庫寫入失敗，錯誤已記錄。';
}
async function hListVenueMaps(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  const rows=await dbGet(env,'venue_map_templates',`tenant_id=eq.${TENANT}&select=*&order=updated_at.desc`);
  // seats_json 為 JSONB；舊資料可能曾被存成 JSON 字串，回傳前一律正規化成陣列。
  const maps=(rows||[]).map(r=>({...r,seats_json:normalizeSeatConfigList(r.seats_json)}));
  return jsonOk({maps});
}
async function hSaveVenueMap(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  const name=String(b.name||'').trim();
  if(!name) return jsonErr('請填常用圖名稱');
  const seats=normalizeSeatConfigList(b.seats||[]);
  // JSONB 直接寫正規化陣列；category／active 不再形成第二套控制來源。
  const payload={ tenant_id:TENANT, name, seat_map_url:b.mapUrl||'', seats_json:seats, note:b.note||'', updated_at:nowIso() };
  const exist=await dbGet(env,'venue_map_templates',`tenant_id=eq.${TENANT}&name=eq.${encodeURIComponent(name)}&select=id`);
  if(exist&&exist.length){
    await dbUpdate(env,'venue_map_templates',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(exist[0].id)}`,payload);
    return jsonOk({success:true,id:exist[0].id,updated:true});
  }
  const id=genId('VMT');
  await dbInsert(env,'venue_map_templates',{id,...payload,created_at:nowIso()});
  return jsonOk({success:true,id});
}
async function hApplyVenueMap(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  if(!b.sessionId) return jsonErr('缺少場次編號');
  const rows=await dbGet(env,'venue_map_templates',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.mapId)}&select=*`);
  if(!rows||!rows.length) return jsonErr('找不到常用圖');
  const tpl=rows[0];
  const seats=normalizeSeatConfigList(tpl.seats_json);
  try{
    const r=await hSaveSeatMap(env,{_tenantId:TENANT,email:b.email,token:b.token,sessionId:b.sessionId,enabled:b.enabled!==false,holdHours:b.holdHours,assignDaysBefore:b.assignDaysBefore,mapUrl:tpl.seat_map_url,seats});
    try{ await dbUpdate(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId)}`,{venue_map_template_id:tpl.id}); }catch(e){ logError(env,{source:'hApplyVenueMap',message:'set template id failed',error:e&&e.message?e.message:e}); }
    return r;
  }catch(e){
    logError(env,{source:'hApplyVenueMap',message:'apply venue map failed',error:e&&e.message?e.message:e,meta:{sessionId:b.sessionId,mapId:b.mapId}});
    return jsonErr('套用場地圖失敗：'+seatMapApplyErrorMessage(e));
  }
}
async function hDeleteVenueMap(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  if(!b.mapId) return jsonErr('缺少常用圖編號');
  await dbDelete(env,'venue_map_templates',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.mapId)}`);
  return jsonOk({success:true});
}
async function hSaveSeatMapImage(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  if(!b.sessionId) return jsonErr('缺少場次編號');
  await dbUpdate(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId)}`,{
    seat_map_url:String(b.mapUrl||'').trim()
  });
  return jsonOk({success:true,mapUrl:String(b.mapUrl||'').trim()});
}
async function hSaveSeatMap(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  if(!b.sessionId) return jsonErr('缺少場次編號');
  const seats=normalizeSeatConfigList(b.seats||[]);
  const codes=new Set();
  for(const s of seats){
    const code=String(s.code||s.seatCode||s.stallNo||'').trim();
    if(!code) return jsonErr('攤位代碼不可空白');
    if(codes.has(code)) return jsonErr('同一場次攤位代碼不可重複：'+code);
    codes.add(code);
  }
  const _sesUpd={
    seat_pricing_enabled: !!b.enabled,
    seat_hold_hours: Number(b.holdHours)||SEAT_HOLD_HOURS,
    seat_map_url: b.mapUrl||''
  };
  if(b.assignDaysBefore!=null && b.assignDaysBefore!=='') _sesUpd.seat_assign_days_before=Math.max(3,Number(b.assignDaysBefore)||7);
  await dbUpdate(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId)}`,_sesUpd);
  const existing=await getSeatRows(env,TENANT,b.sessionId);
  for(const item of seats){
    const code=item.code;
    const type=item.type;
    const data={
      tenant_id:TENANT, session_id:b.sessionId,
      // stalls.stall_no 是正式 schema 的必填欄位；seat_code 為新版顯示／排序欄位，兩者同步。
      stall_no:code, seat_code:code,
      seat_type:type, price_delta:type==='paid'?item.price:0,
      category:'',
      map_x:item.x, map_y:item.y, map_order:item.order,
      is_active:item.active, note:item.note,
      status:item.active?'空閒':'停用',
      reg_id:null, email:null, hold_time:null, seat_hold_expires_at:null,
      updated_at:nowIso()
    };
    const old=existing.find(x=>seatCodeOf(x)===code);
    if(old) {
      if (seatRegId(old) && isSeatOccupiedActive(old)) {
        // 套用常用圖不得洗掉已預留／已鎖定的位置。
        data.status = old.status; data.reg_id = seatRegId(old); data.email = old.email; data.hold_time = old.hold_time; data.seat_hold_expires_at = old.seat_hold_expires_at;
      }
      await dbUpdate(env,'stalls',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(old.id)}`,data);
    }
    else await dbInsert(env,'stalls',{id:genId('STL'),...data,created_at:nowIso()});
  }
  // 清單沒帶到的、且未被占用者，自動停用，不直接刪除，避免誤刪歷史。
  for(const old of existing){
    const code=seatCodeOf(old);
    if(code && !codes.has(code) && !seatRegId(old)){
      await dbUpdate(env,'stalls',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(old.id)}`,{is_active:false,status:'停用',updated_at:nowIso()});
    }
  }
  return jsonOk({success:true,count:seats.length});
}
async function rebuildSeatFeeItem(env, tenantId, reg, sessionId, seatFee){
  const _t=String(tenantId||'').trim();
  try{ await dbDelete(env,'registration_items',`${_t?`tenant_id=eq.${encodeURIComponent(_t)}&`:''}registration_id=eq.${encodeURIComponent(reg.id)}&item_type=eq.seat_fee`); }catch(e){}
  if(safeNum(seatFee)>0){
    await dbInsert(env,'registration_items',{id:genId('ITEM'),tenant_id:_t,registration_id:reg.id,item_type:'seat_fee',item_name:'加價選位費',quantity:1,unit_price:safeNum(seatFee),amount:safeNum(seatFee),note:'tax_included'});
  }
}
async function hClaimPaidSeat(env,b){
  const TENANT=b._tenantId;
  if(!b.regId||!b.sessionId) return jsonErr('缺少報名或場次編號');
  const regRows=await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if(!regRows.length) return jsonErr('找不到報名紀錄');
  const reg=regRows[0];
  if(isPaidSeatHoldExpired(reg)){ await releasePaidSeatHold(env,TENANT,reg,'expired_before_claim'); return jsonErr('原選位保留已逾期，位置已釋出，請重新整理後再選擇位置。'); }
  if(String(reg.session_id||'')!==String(b.sessionId||'')) return jsonErr('報名與場次不一致');
  const own=regOwnerGuard(reg,b,'選擇位置的'); if(own) return own;
  if(String(reg.review_status||'')!=='已錄取') return jsonErr('尚未錄取，不能加價選位');
  if(String(reg.payment_status||'')==='免費') return jsonErr('免費報名不開放加價選位');
  if(String(reg.payment_status||'')==='待確認'||String(reg.payment_status||'')==='付款待確認') return jsonErr('付款正在確認中，請先等待主辦確認後再選位');
  if(isCapacityInactiveTransferStatus(reg.transfer_status)) return jsonErr('此報名已取消或進入退費流程');
  if(String(reg.seat_choice_intent||'')!=='paid') return jsonErr('報名時未選擇加價選位意願，不能加購加價選位');
  const setting=await getSessionSeatSetting(env,TENANT,b.sessionId);
  if(!setting.enabled) return jsonErr('此場次未開放加價選位');
  const codes=(Array.isArray(b.seats)?b.seats:[b.seatCode||b.stallNumber]).map(x=>String(x||'').trim()).filter(Boolean);
  const max=Math.max(1,Number(reg.stall_count)||1);
  if(!codes.length) return jsonErr('請選擇位置');
  if(codes.length!==max) return jsonErr('請選滿 '+max+' 個位置，需與報名攤位數一致');
  const rows=await getSeatRows(env,TENANT,b.sessionId); let seatFee=0;
  for(const code of codes){
    const seat=rows.find(x=>seatCodeOf(x)===code); if(!seat) return jsonErr('找不到位置 '+code);
    if(normalizeSeatType(seat.seat_type)!=='paid') return jsonErr(code+' 不是加價選位位置');
    if(seat.is_active===false||seat.is_active==='false') return jsonErr(code+' 未開放');
    if(String(seat.status||'')==='預留'&&isHoldExpiredAt(seat.seat_hold_expires_at)){
      if(seatRegId(seat)){ try{await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(seatRegId(seat))}&seat_choice_status=eq.reserved`,{stall_number:null,seat_choice_status:'released',seat_choice_type:null,seat_hold_expires_at:null});}catch(e){} }
      await dbUpdate(env,'stalls',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(seat.id)}`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null});
      seat.status='空閒'; seat.reg_id=null; seat.email=null; seat.seat_hold_expires_at=null;
    }
    if(isSeatOccupiedActive(seat)&&String(seatRegId(seat)||'')!==String(reg.id)) return jsonErr('此位置已被選走，請重新選擇其他位置。');
    seatFee+=safeNum(seat.price_delta);
  }
  const oldSeatFee=await getExistingSeatFeeFromItems(env,reg.id,TENANT);
  const baseAmount=Math.max(0,(safeNum(reg.total_amount)||safeNum(reg.amount)||0)-oldSeatFee);
  const newTotal=baseAmount+seatFee;
  const wasPaid=isPaidStatus(reg.payment_status);
  const paidAmount=safeNum(reg.paid_amount)||(wasPaid?baseAmount:0);
  const due=Math.max(0,newTotal-paidAmount);
  const expiresAt=addHoursIso(setting.holdHours);
  for(const s of rows.filter(x=>String(seatRegId(x)||'')===String(reg.id)&&normalizeSeatType(x.seat_type)==='paid'&&!codes.includes(seatCodeOf(x)))){
    await dbUpdate(env,'stalls',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(s.id)}`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null});
  }
  const claimed=[];
  for(const code of codes){
    const seat=rows.find(x=>seatCodeOf(x)===code);
    try{ await claimSeatRowAtomic(env,TENANT,seat,reg,expiresAt); claimed.push(seat); }
    catch(e){ for(const got of claimed){try{await dbUpdate(env,'stalls',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(got.id)}&reg_id=eq.${encodeURIComponent(reg.id)}&status=eq.預留`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null});}catch(_e){}} return jsonErr(e.message||'此位置已被選走，請重新選擇其他位置。'); }
  }
  const locked=due<=0;
  if(locked){ for(const got of claimed) await dbUpdate(env,'stalls',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(got.id)}&reg_id=eq.${encodeURIComponent(reg.id)}`,{status:'鎖定',seat_hold_expires_at:null}); }
  const upd={stall_number:codes.join(','),seat_choice_status:locked?'locked':'reserved',seat_choice_type:'paid',seat_fee_total:seatFee,seat_hold_expires_at:locked?null:expiresAt,amount:newTotal,total_amount:newTotal};
  // 舊已繳資料若尚未回填 paid_amount，先把原已繳金額寫回，補款時才只會收選位差額。
  if(wasPaid && paidAmount>safeNum(reg.paid_amount)) upd.paid_amount=paidAmount;
  if(wasPaid&&due>0) Object.assign(upd,{payment_status:'未繳費',payment_report_amount:0,payment_last5:null,payment_reported_at:null});
  await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.id)}`,upd);
  await rebuildSeatFeeItem(env,TENANT,reg,b.sessionId,seatFee);
  const message=locked?'位置已正式鎖定。':(wasPaid?'位置已保留 '+setting.holdHours+' 小時，請補繳加價差額 NT$'+due+'。':'此位置已為您保留 '+setting.holdHours+' 小時，請於期限內完成付款。');
  return jsonOk({success:true,seats:codes,seatFee,total:newTotal,paid:paidAmount,due,expiresAt:locked?'':expiresAt,locked,message});
}
async function autoAssignSeatForPaidReg(env, tenantId, reg){
  // 付款後臨時加入也只跑「鎖住舊位置、補進空位」的每日排位程序。
  const out=await dbRpc(env,'sync_seat_roster_mobile_atomic',{p_tenant_id:tenantId,p_session_id:String(reg.session_id),p_actor_email:'system_payment'});
  const daily=await dbGet(env,'registration_day_seats',`tenant_id=eq.${tenantId}&session_id=eq.${encodeURIComponent(reg.session_id)}&registration_id=eq.${encodeURIComponent(reg.id)}&select=activity_date,seat_code&order=activity_date.asc,seat_code.asc`).catch(()=>[]);
  return daily.length?{success:true,seats:daily.map(x=>String(x.seat_code)),daySeats:daily,existingPositionsLocked:true,result:out}:{skipped:true,reason:'waiting_manual',existingPositionsLocked:true,result:out};
}

// ── 活動前批次自動排位：依繳費順序，帶入 map_order 最前的可排(auto)位置；跳過已鎖(加價選位)位置 ──
async function batchAssignSeatsForSession(env, tenantId, session){
  const out=await dbRpc(env,'sync_seat_roster_mobile_atomic',{p_tenant_id:tenantId,p_session_id:String(session.id),p_actor_email:'system_batch'});
  return {...(out||{}),assigned:safeNum(out&&out.assigned),total:safeNum(out&&out.assigned)+safeNum(out&&out.preserved)+safeNum(out&&out.waiting),existingPositionsLocked:true};
}

// selectStall（相容舊 action，正式轉交加價選位 claimPaidSeat）
async function hSelectStall(env, b) {
  return hClaimPaidSeat(env, b);
}

// ── 後台選位營運（ADMIN_SEAT_OPS_20260725）：看板 / 手動換位指定 / 一鍵批次配位 ──
async function hAdminSeatBoard(env, b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT)) return jsonErr('無權限');
  if(!b.sessionId) return jsonErr('缺少場次編號');
  const [seatRows, regs, sessionRows, daySeatRows, confirmedPayments] = await Promise.all([
    getSeatRows(env,TENANT,b.sessionId).catch(()=>[]),
    dbGet(env,'registrations',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(b.sessionId)}&review_status=eq.%E5%B7%B2%E9%8C%84%E5%8F%96&select=*`).catch(()=>[]),
    dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId)}&select=id,name,dates_json,seat_map_url,seat_board_json,seat_layout_published_at,seat_assign_last_at`).catch(()=>[]),
    dbGet(env,'registration_day_seats',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(b.sessionId)}&select=activity_date,seat_code,registration_id&order=activity_date.asc,seat_code.asc`).catch(()=>[]),
    dbGet(env,'payments',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(b.sessionId)}&status=eq.%E5%B7%B2%E7%A2%BA%E8%AA%8D&select=registration_id,reg_id,paid_at,created_at`).catch(()=>[])
  ]);
  if(!sessionRows.length) return jsonErr('找不到場次');
  const session=sessionRows[0];
  const dateRows=safeJson(session.dates_json,[]);
  const availableDates=(Array.isArray(dateRows)?dateRows:[]).map(x=>String((x&&x.date)||x||'').slice(0,10)).filter(Boolean);
  const requested=String(b.activityDate||'').slice(0,10);
  const activityDate=(requested&&availableDates.includes(requested)?requested:(availableDates[0]||String(daySeatRows[0]&&daySeatRows[0].activity_date||'').slice(0,10)));
  const board=safeJson(session.seat_board_json,{})||{};
  const customMarkers=Array.isArray(board.customMarkers)?board.customMarkers:[];
  const currentAssignments=daySeatRows.filter(x=>String(x.activity_date).slice(0,10)===activityDate);
  const assignedByCode={}; currentAssignments.forEach(x=>{assignedByCode[String(x.seat_code)]=String(x.registration_id||'');});
  const confirmedIds=new Set(confirmedPayments.map(x=>String(x.registration_id||x.reg_id||'')).filter(Boolean));
  const firstPaidAt={}; confirmedPayments.forEach(x=>{const id=String(x.registration_id||x.reg_id||'');const at=x.paid_at||x.created_at||'';if(id&&(!firstPaidAt[id]||String(at)<String(firstPaidAt[id])))firstPaidAt[id]=at;});
  const regById={}; for(const r of regs) regById[String(r.id)]=r;
  const seats=seatRows.map(s=>{
    const code=seatCodeOf(s),rid=assignedByCode[String(code)]||''; const occ=regById[rid];
    return { code:seatCodeOf(s), type:normalizeSeatType(s.seat_type),
      active:s.is_active!==false&&s.is_active!=='false', status:s.status||'空閒',
      occupied:!!occ, priceDelta:safeNum(s.price_delta), x:safeNum(s.map_x), y:safeNum(s.map_y),
      order:safeNum(s.map_order), direction:safeNum((board.mapDirections||{})[code]),
      occupantRegId:(occ?rid:''), occupantName:occ?(occ.brand_name||occ.name||''):'' };
  });
  for(const m of customMarkers){
    if(!m||!m.id)continue;
    seats.push({code:'CUSTOM:'+m.id,id:String(m.id),isCustom:true,type:String(m.markerType||'service'),specialLabel:String(m.label||'自訂位置'),showPublic:m.showPublic!==false,active:true,occupied:false,x:safeNum(m.x),y:safeNum(m.y),direction:safeNum(m.direction),order:100000+seats.length});
  }
  const regsOut=regs
    .filter(r=>!isCapacityInactiveTransferStatus(r.transfer_status))
    .map(r=>({ regId:String(r.id), name:r.name||'', brand:r.brand_name||'',
      stallNumber:currentAssignments.filter(x=>String(x.registration_id)===String(r.id)).map(x=>String(x.seat_code)).join(','), stallCount:Math.max(1,safeNum(r.stall_count)||1),
      intent:(String(r.seat_choice_intent||'auto')==='paid'?'paid':'auto'),
      seatChoiceStatus:r.seat_choice_status||'', payStatus:r.payment_status||'',
      transferStatus:r.transfer_status||'', phone:r.phone||'', paidAt:firstPaidAt[String(r.id)]||r.created_at||'',
      confirmedPaid:String(r.payment_status||'')==='免費'||confirmedIds.has(String(r.id)),
      participatesToday:_registrationDates(r).includes(activityDate),
      equipmentText:_equipmentTextFromMap(_effectiveEquipmentMapForReg(r,session)),
      dayPositions:daySeatRows.filter(x=>String(x.registration_id)===String(r.id)).reduce((out,x)=>{const d=String(x.activity_date).slice(0,10);let row=out.find(y=>y.date===d);if(!row){row={date:d,codes:[]};out.push(row);}row.codes.push(String(x.seat_code));return out;},[])
    }));
  const activeSeats=seats.filter(x=>!x.isCustom&&x.active);
  const assignedStalls=currentAssignments.length;
  const requiredStalls=regsOut.filter(x=>x.confirmedPaid&&x.participatesToday).reduce((n,x)=>n+x.stallCount,0);
  return jsonOk({singleSource:'registration_day_seats',activityDate,availableDates,seats,regs:regsOut,session:{id:session.id,name:session.name||'',seatMapUrl:session.seat_map_url||'',seatBoard:board,seatLayoutPublishedAt:session.seat_layout_published_at||''},summary:{requiredStalls,assignedStalls,waitingPaid:Math.max(0,requiredStalls-assignedStalls),autoFree:Math.max(0,activeSeats.length-assignedStalls),firstAssignedAt:session.seat_assign_last_at||'',equipmentTotalText:_equipmentTextFromMap(regs.reduce((all,r)=>{const m=_effectiveEquipmentMapForReg(r,session);Object.keys(m||{}).forEach(k=>all[k]=(Number(all[k])||0)+(Number(m[k])||0));return all;},{}))}});
}

async function hSyncSeatRoster(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT))return jsonErr('無權限');
  if(!b.sessionId)return jsonErr('缺少場次編號');
  const out=await dbRpc(env,'sync_seat_roster_mobile_atomic',{p_tenant_id:TENANT,p_session_id:String(b.sessionId),p_actor_email:String(b.email||'')});
  return jsonOk(out||{success:true});
}
async function hSaveSeatMarkerPosition(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT))return jsonErr('無權限');
  const code=String(b.seatCode||'').trim(),x=Number(b.x),y=Number(b.y);
  if(!b.sessionId||!code||!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>100||y<0||y>100)return jsonErr('位置資料不正確');
  const rows=await dbUpdateReturning(env,'stalls',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(b.sessionId)}&or=(seat_code.eq.${encodeURIComponent(code)},stall_no.eq.${encodeURIComponent(code)})`,{map_x:x,map_y:y,updated_at:nowIso()});
  if(!rows.length)return jsonErr('找不到這個攤位');
  return jsonOk({success:true,seatCode:code,x,y});
}
async function hSaveSeatMarkerPositions(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT))return jsonErr('無權限');
  const positions=Array.isArray(b.positions)?b.positions:[];
  if(positions.length<2)return jsonErr('至少需要兩個位置');
  const out=await dbRpc(env,'save_seat_marker_positions_atomic',{p_tenant_id:TENANT,p_session_id:String(b.sessionId||''),p_positions:positions});
  return jsonOk(out||{success:true,updated:positions.length});
}
async function hSaveSeatBoardConfig(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT))return jsonErr('無權限');
  const rows=await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId||'')}&select=seat_board_json`);
  if(!rows.length)return jsonErr('找不到場次');
  const board=safeJson(rows[0].seat_board_json,{})||{};
  if(b.mode)board.mode=String(b.mode);
  if(b.mapDirections&&typeof b.mapDirections==='object'&&!Array.isArray(b.mapDirections))board.mapDirections=b.mapDirections;
  await dbUpdate(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId)}`,{seat_board_json:board,updated_at:nowIso()});
  return jsonOk({success:true,seatBoard:board});
}
async function hSaveSeatCustomMarker(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT))return jsonErr('無權限');
  const rows=await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId||'')}&select=seat_board_json`);
  if(!rows.length)return jsonErr('找不到場次');
  const board=safeJson(rows[0].seat_board_json,{})||{},list=Array.isArray(board.customMarkers)?board.customMarkers.slice():[];
  const markerId=String(b.markerId||genId('MARKER')),marker={id:markerId,label:String(b.label||'自訂位置').slice(0,40),markerType:['service','closed'].includes(String(b.markerType))?String(b.markerType):'service',x:Math.max(0,Math.min(100,Number(b.x)||0)),y:Math.max(0,Math.min(100,Number(b.y)||0)),direction:(Number(b.direction)||0)%360,showPublic:b.showPublic!==false};
  const idx=list.findIndex(x=>String(x&&x.id)===markerId);if(idx>=0)list[idx]=marker;else list.push(marker);board.customMarkers=list;
  await dbUpdate(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId)}`,{seat_board_json:board,updated_at:nowIso()});
  return jsonOk({success:true,marker,seatBoard:board});
}
async function hDeleteSeatCustomMarker(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT))return jsonErr('無權限');
  const rows=await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId||'')}&select=seat_board_json`);if(!rows.length)return jsonErr('找不到場次');
  const board=safeJson(rows[0].seat_board_json,{})||{};board.customMarkers=(Array.isArray(board.customMarkers)?board.customMarkers:[]).filter(x=>String(x&&x.id)!==String(b.markerId||''));
  await dbUpdate(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId)}`,{seat_board_json:board,updated_at:nowIso()});
  return jsonOk({success:true,seatBoard:board});
}
async function hPublishSeatLayout(env,b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT))return jsonErr('無權限');
  const at=nowIso();const rows=await dbUpdateReturning(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId||'')}`,{seat_layout_published_at:at,updated_at:at});
  if(!rows.length)return jsonErr('找不到場次');
  const regs=await dbGet(env,'registration_day_seats',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(b.sessionId)}&select=registration_id`).catch(()=>[]);
  return jsonOk({success:true,publishedAt:at,notified:new Set(regs.map(x=>String(x.registration_id))).size});
}
async function hAdminAssignSeat(env, b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT)) return jsonErr('無權限');
  // 舊版只寫 stalls / registrations，會和每日正式排位分裂；保留路由但禁止再寫入。
  return jsonErr('舊的指定位置功能已停用，請使用「補排新攤商」；已排位置會保持不動。');
  /* istanbul ignore next -- legacy implementation retained temporarily for rollback reading only */
  if(!b.regId) return jsonErr('缺少報名編號');
  const rows=await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if(!rows.length) return jsonErr('找不到報名');
  const reg=rows[0];
  if(String(reg.review_status||'')!=='已錄取') return jsonErr('僅已錄取者可安排位置');
  if(isCapacityInactiveTransferStatus(reg.transfer_status)) return jsonErr('此報名已取消或進入退費流程，不能安排位置');
  const codes=(Array.isArray(b.seats)?b.seats:[b.seatCode||b.stallNumber]).map(x=>String(x||'').trim()).filter(Boolean);
  const need=Math.max(1,safeNum(reg.stall_count)||1);
  if(!codes.length) return jsonErr('請選擇位置');
  if(new Set(codes).size!==codes.length) return jsonErr('位置不可重複');
  if(codes.length!==need) return jsonErr('此報名為 '+need+' 攤，請指定 '+need+' 個位置');
  const seatRows=await getSeatRows(env,TENANT,reg.session_id);
  for(const code of codes){
    const seat=seatRows.find(x=>seatCodeOf(x)===code);
    if(!seat) return jsonErr('找不到位置 '+code);
    const type=normalizeSeatType(seat.seat_type);
    if(type==='service'||type==='closed') return jsonErr(code+' 不是可安排的位置（服務台／禁用）');
    if(seat.is_active===false||seat.is_active==='false') return jsonErr(code+' 未開放');
    if(isSeatOccupiedActive(seat) && String(seatRegId(seat)||'')!==String(reg.id)){
      const occ=await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(seatRegId(seat))}&select=name,brand_name`).catch(()=>[]);
      const who=occ.length?(occ[0].brand_name||occ[0].name||'其他報名'):'其他報名';
      return jsonErr(code+' 已被「'+who+'」使用，請先幫對方換位或清空該位置');
    }
  }
  // 先放回這筆原本佔的、且不在新清單裡的位置
  try{
    const old=await dbGet(env,'stalls',`tenant_id=eq.${TENANT}&reg_id=eq.${encodeURIComponent(reg.id)}&select=id,seat_code,stall_no,number`);
    for(const s of old){ if(!codes.includes(seatCodeOf(s))) await dbUpdate(env,'stalls',`id=eq.${s.id}&tenant_id=eq.${TENANT}`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null}); }
  }catch(e){ logError(env,{source:'hAdminAssignSeat',message:'release old skipped',error:e&&e.message?e.message:e}); }
  const locked=[];
  for(const code of codes){
    const seat=seatRows.find(x=>seatCodeOf(x)===code);
    let got;
    if(String(seatRegId(seat)||'')===String(reg.id)){
      got=await dbUpdateReturning(env,'stalls',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(seat.id)}&reg_id=eq.${encodeURIComponent(reg.id)}`,{status:'鎖定',reg_id:reg.id,email:reg.email||'',hold_time:nowIso(),seat_hold_expires_at:null});
    } else {
      got=await dbUpdateReturning(env,'stalls',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(seat.id)}&status=eq.空閒&reg_id=is.null&is_active=eq.true`,{status:'鎖定',reg_id:reg.id,email:reg.email||'',hold_time:nowIso(),seat_hold_expires_at:null});
    }
    if(!got || !got.length){
      for(const g of locked){ try{ await dbUpdate(env,'stalls',`id=eq.${g.id}&tenant_id=eq.${TENANT}&reg_id=eq.${encodeURIComponent(reg.id)}`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null}); }catch(_e){} }
      return jsonErr(code+' 剛剛被別人選走，請重新整理後再安排');
    }
    locked.push(got[0]);
  }
  const anyPaid=codes.some(code=>{ const s=seatRows.find(x=>seatCodeOf(x)===code); return s && normalizeSeatType(s.seat_type)==='paid'; });
  await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.id)}`,{stall_number:codes.join(','),seat_choice_status:'locked',seat_choice_type:(anyPaid?'paid':'auto'),seat_hold_expires_at:null});
  try{ await writeAuditLog(env,TENANT,b.email||'',b.email||'staff','admin_assign_seat','registrations',reg.id,{stall_number:reg.stall_number||''},{stall_number:codes.join(',')},{}); }catch(e){}
  return jsonOk({success:true, seats:codes});
}
async function hRunBatchAssign(env, b){
  const TENANT=b._tenantId;
  if(!await verifyStaff(env,b.email,b.token,TENANT)) return jsonErr('無權限');
  if(!b.sessionId) return jsonErr('缺少場次編號');
  const sRows=await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.sessionId)}&select=*`);
  if(!sRows.length) return jsonErr('找不到場次');
  const res=await batchAssignSeatsForSession(env,TENANT,sRows[0]);
  return jsonOk({success:true, assigned:(res&&res.assigned)||0, total:(res&&res.total)||0});
}

// ── 合併結帳（購物車）：多筆報名一次付款、一次回報、一張合併卡片 ──
// 規則：僅「同一個收款設定」的報名可合併（多主辦不可混收）；報名紀錄仍分場次各一筆，
// 以 payment_group_id 綁定為同一次付款，後台可一次確認。
function buildMergedPaymentCardText(items, who, method, total, groupNo){
  const lines = ['【合併繳費】共 ' + items.length + ' 場', ''];
  for (const it of items) {
    const dep = Number(it.reg.deposit||0);
    const equipText = equipSummaryFromJson(it.reg.equipment_json);
    lines.push('・' + (it.sesName||'場次'));
    lines.push('　攤位 ' + Math.max(Number(it.reg.stall_count||1),1) + ' 攤');
    lines.push('　設備：' + (equipText || '自備'));
    if (dep > 0) lines.push('　保證金 NT$' + dep.toLocaleString());
    lines.push('　NT$' + Number(it.amount||0).toLocaleString());
  }
  lines.push('');
  lines.push(who || '未填名稱');
  lines.push('合計金額：NT$' + Number(total||0).toLocaleString() + '（' + (method||'付款') + '）');
  lines.push('合併編號：' + groupNo);
  return lines.join('\n');
}

async function hSubmitPaymentBatch(env, b) {
  const TENANT = (b && b._tenantId);
  const ids = Array.isArray(b.regIds) ? b.regIds.map(x=>String(x||'').trim()).filter(Boolean) : [];
  if (ids.length < 2) return jsonErr('請至少勾選兩筆報名再合併繳費');
  const method = b.method || '匯款';
  const isBank = /ATM|銀行|轉帳|匯款/.test(String(method));
  const last5 = isBank ? String(b.lastFive||b.last5||'').trim() : '';
  if (isBank && !last5) return jsonErr('ATM／銀行轉帳需填帳號末五碼');

  const items = [];
  let profileKey = null;
  for (const id of ids) {
    const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}&select=*`);
    if (!rows.length) return jsonErr('找不到報名紀錄');
    const reg = rows[0];
    // B-03：每一筆都要用同一組 b.email＋b.phone 驗；任一筆非本人，整批立即失敗。
    // 此迴圈只做驗證與試算，不寫入任何資料，所以不會出現「前幾筆已改、後面才失敗」。
    const _ownBatch = regOwnerGuard(reg, b, '回報付款的'); if (_ownBatch) return _ownBatch;
    if (reg.review_status !== '已錄取') return jsonErr('有場次尚未錄取，無法合併繳費');
    const _totalAmount=Number(reg.total_amount)||Number(reg.amount)||0;
    const _paidAmount=Number(reg.paid_amount)||0;
    const _dueAmount=Math.max(0,_totalAmount-_paidAmount);
    if (isPaidStatus(reg.payment_status) && _dueAmount<=0) return jsonErr('有場次已完成繳費，請重新勾選');
    if (String(reg.seat_choice_intent||'')==='paid' && !['reserved','locked'].includes(String(reg.seat_choice_status||''))) return jsonErr('有場次尚未完成加價選位，請先完成選位');
    const sessionRow = await getSessionRow(env, reg.session_id, TENANT).catch(()=>null);
    let paySnap;
    try {
      paySnap = await ensurePaymentSnapshotForReg(env,TENANT,reg,sessionRow||{}, {writeIfSafe:true});
    } catch(e) {
      return jsonErr(e && e.message ? e.message : '有場次的收款設定無法解析，請聯繫主辦');
    }
    if (!_methodAllowedFromSnapshot(paySnap, method)) return jsonErr('有場次未開放此付款方式，請分開繳費');
    // 多主辦安全：不同收款帳戶不可合併收款
    const key = String((paySnap && paySnap.payment_profile_id) || '');
    if (profileKey === null) profileKey = key;
    else if (profileKey !== key) return jsonErr('勾選的場次收款帳戶不同，需分開繳費');
    const amount = _dueAmount>0?_dueAmount:_totalAmount;
    const sesName = await getSessionName(env, reg.session_id, TENANT);
    items.push({reg, paySnap, amount, sesName});
  }

  // 組合套組完整性檢查：勾選中若含組合場次，該組所有未繳場次都必須一起勾（不可只繳其中一場）
  const _groups = [...new Set(items.map(it=>String(it.reg.bundle_group_id||'').trim()).filter(Boolean))];
  for (const g of _groups) {
    const grp = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&bundle_group_id=eq.${encodeURIComponent(g)}&select=id,payment_status,total_amount,amount,paid_amount`).catch(()=>[]);
    const unpaid = grp.filter(x=>String(x.payment_status||'')!=='免費' && Math.max(0,(Number(x.total_amount)||Number(x.amount)||0)-(Number(x.paid_amount)||0))>0).map(x=>String(x.id));
    const picked = new Set(items.map(it=>String(it.reg.id)));
    if (unpaid.some(id=>!picked.has(id))) return jsonErr('組合優惠場次需整組一起繳費，請一併勾選同組的所有場次');
  }
  const total = items.reduce((s,it)=>s+Number(it.amount||0),0);
  if (!(total > 0)) return jsonErr('合計金額異常，請聯繫主辦');
  const groupId = genId('PGR');
  const now = nowIso();
  const first = items[0].reg;
  const brand = String(first.brand_name || '').trim();
  const nm = String(first.name || '').trim();
  const who = brand && nm ? `${brand}／${nm}` : (brand || nm || '未填名稱');
  const cardText = buildMergedPaymentCardText(items, who, method, total, groupId);

  for (const it of items) {
    const reg = it.reg;
    const note = (reg.admin_note||'')+` [攤友回報·合併] ${method} 合計NT$${total}${last5?' 末5碼:'+last5:''} 編號:${groupId} 時間:${nowTaipeiText()}`;
    await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(reg.id)}&tenant_id=eq.${TENANT}`,{
      payment_status:'待確認', payment_method:method,
      payment_report_amount:it.amount, payment_last5:last5, payment_reported_at:now,
      admin_note:note,
      ..._paymentSnapshotDbPayload(it.paySnap),
    });
    try {
      await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(reg.id)}&tenant_id=eq.${TENANT}`,{
        payment_line_card_text:cardText,
        payment_screenshot_status:'待補截圖',
        payment_group_id:groupId,
      });
    } catch(e) { console.error('optional merged payment columns skipped', e.message||e); logError(env, {source:'hSubmitPaymentBatch', message:'optional merged payment columns skipped', error:e.message||e}); }
    try {
      await dbInsert(env,'payments',{id:genId('PAY'),tenant_id:TENANT,registration_id:reg.id,session_id:reg.session_id,email:reg.email,amount:it.amount,method,status:'待確認',trade_no:last5,paid_at:null,created_at:now,payment_profile_id:(it.paySnap&&it.paySnap.payment_profile_id)||null,payment_profile_snapshot:it.paySnap||{}});
    } catch(e) { console.error('merged payments insert failed', e.message||e); logError(env, {source:'hSubmitPaymentBatch', message:'merged payments insert failed', error:e.message||e}); }
  }
  return jsonOk({success:true, lineCardText:cardText, paymentLineCardText:cardText, payStatus:'待確認', paymentGroupId:groupId, total, count:items.length});
}

// submitPayment（攤友回報匯款）
// 付款回報被擋下時，記錄原因，讓主辦在「設定 → 系統異常」看得到是誰卡在哪一步
function _payReportFail(env, tenantId, reg, msg){
  try{
    logError(env, {source:'付款回報被擋下', tenant_id:tenantId,
      message:String(msg||''),
      error:`報名編號 ${reg&&reg.id||''}｜${(reg&&(reg.brand_name||reg.brand||reg.name))||''}｜場次 ${(reg&&reg.session_id)||''}`});
  }catch(e){}
  return jsonErr(msg);
}
async function hSubmitPayment(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名紀錄');
  const reg = rows[0];
  const _ownPay = regOwnerGuard(reg, b, '回報付款的'); if (_ownPay) return _ownPay;
  if (reg.review_status!=='已錄取') return _payReportFail(env,TENANT,reg,'尚未錄取，無法回報繳費');
  const _totalDueBase=Number(reg.total_amount)||Number(reg.amount)||0;
  const _alreadyPaid=Number(reg.paid_amount)||0;
  const _outstanding=Math.max(0,_totalDueBase-_alreadyPaid);
  if (isPaidStatus(reg.payment_status) && _outstanding<=0) return _payReportFail(env,TENANT,reg,'此報名已完成繳費');
  if (String(reg.seat_choice_intent||'')==='paid' && !['reserved','locked'].includes(String(reg.seat_choice_status||''))) return _payReportFail(env,TENANT,reg,'請先完成加價選位，再回報付款。');
  const now = nowIso();
  const method = b.method || '匯款';
  // 組合套組（bundle_group_id）為綁定優惠：必須整組一起繳，
  // 不可只繳其中一場（否則等於用組合價買單場，與退費同進退規則一致）。
  const _bg = String(reg.bundle_group_id || '').trim();
  if (_bg) {
    const grp = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&bundle_group_id=eq.${encodeURIComponent(_bg)}&select=id,payment_status`).catch(()=>[]);
    const unpaid = grp.filter(g=>!isPaidStatus(g.payment_status) && String(g.payment_status||'')!=='免費');
    if (unpaid.length > 1) return _payReportFail(env,TENANT,reg,'此為組合優惠場次，需與同組場次一起繳費，請使用「前往繳費（組合）」');
  }
  const sessionRow = await getSessionRow(env, reg.session_id, TENANT).catch(()=>null);
  let paySnap;
  try {
    paySnap = await ensurePaymentSnapshotForReg(env,TENANT,reg,sessionRow||{}, {writeIfSafe:true});
  } catch(e) {
    return _payReportFail(env,TENANT,reg,e && e.message ? e.message : '此報名的收款設定無法解析，請聯繫主辦');
  }
  if(!_methodAllowedFromSnapshot(paySnap, method)) return _payReportFail(env,TENANT,reg,'此報名未開放此付款方式，請依系統顯示方式付款');
  // B-06：正式金額只能來自資料庫。前端 b.amount 僅供顯示，絕不可寫入正式紀錄。
  const amount = _outstanding>0?_outstanding:_totalDueBase;
  if (!(amount > 0)) return _payReportFail(env,TENANT,reg,'此報名金額異常，請聯繫主辦');
  const isBank = /ATM|銀行|轉帳|匯款/.test(String(method));
  const last5 = isBank ? String(b.lastFive||b.last5||'').trim() : '';
  if (isBank && !last5) return _payReportFail(env,TENANT,reg,'ATM／銀行轉帳需填帳號末五碼');
  const sesName = await getSessionName(env, reg.session_id, TENANT);
  const cardText = buildPaymentLineCardText(reg, sesName, method, amount, sessionRow || {});
  const note = (reg.admin_note||'')+` [攤友回報] ${method} NT$${amount||''}${last5?' 末5碼:'+last5:''} 時間:${nowTaipeiText()}`;
  await dbUpdate(env, 'registrations', `id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`, {
    payment_status:'待確認', payment_method:method,
    payment_report_amount:amount, payment_last5:last5, payment_reported_at:now,
    admin_note:note,
    ..._paymentSnapshotDbPayload(paySnap),
  });
  // 選配欄位：若資料庫尚未新增，不能讓付款回報失敗。
  try {
    await dbUpdate(env, 'registrations', `id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`, {
      payment_line_card_text:cardText,
      payment_screenshot_status:'待補截圖',
    });
  } catch(e) { console.error('optional payment columns update skipped', e.message||e); logError(env, {source:'hSubmitPayment', message:'optional payment columns update skipped', error:e.message||e}); }
  try {
    const existingPayRows = await dbGet(env,'payments',`tenant_id=eq.${TENANT}&registration_id=eq.${encodeURIComponent(b.regId)}&status=eq.%E5%BE%85%E7%A2%BA%E8%AA%8D&select=id`);
    if (existingPayRows.length) {
      await dbUpdate(env,'payments',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(existingPayRows[0].id)}`,{session_id:reg.session_id,email:reg.email,amount,method,status:'待確認',trade_no:last5,paid_at:null,created_at:now,payment_profile_id:(paySnap&&paySnap.payment_profile_id)||null,payment_profile_snapshot:paySnap||{}});
    } else {
      await dbInsert(env,'payments',{id:genId('PAY'),tenant_id:TENANT,registration_id:b.regId,session_id:reg.session_id,email:reg.email,amount,method,status:'待確認',trade_no:last5,paid_at:null,created_at:now,payment_profile_id:(paySnap&&paySnap.payment_profile_id)||null,payment_profile_snapshot:paySnap||{}});
    }
  } catch(e) { console.error('payments upsert pending failed', e.message||e); logError(env, {source:'hSubmitPayment', message:'payments upsert pending failed', error:e.message||e}); }
  try {
    const sesType = await getSessionType(env, reg.session_id, TENANT);
    const dn = getDisplayName(reg.name, reg.brand_name||'', sesType);
    const tc = await getTenantCtx(env, TENANT);
    await mailPaymentReceived(env, reg.email, dn, sesName, method, amount, last5, b.regId, tc);
  } catch(e) { console.error('mailPaymentReceived failed:', e&&e.message?e.message:e); logError(env, {source:'hSubmitPayment', message:'mailPaymentReceived failed:', error:e&&e.message?e.message:e}); }
  return jsonOk({success:true, lineCardText:cardText, paymentLineCardText:cardText, payStatus:'待確認'});
}

// createLinePayOrder
async function hCreateLinePayOrder(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  return jsonErr('目前採外部付款連結＋人工確認，未啟用 LINE Pay API');
  const rows = await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  if (reg.review_status!=='已錄取') return jsonErr('尚未錄取');
  if (isPaidStatus(reg.payment_status)) return jsonErr('已完成繳費');
  const amount = Number(reg.amount)||0;
  if (amount<=0) return jsonErr('金額錯誤');
  const orderId = 'TBL'+Date.now().toString().slice(-12);
  const sesName = await getSessionName(env, reg.session_id, TENANT);
  const workerUrl = (env.WORKER_URL||WORKER_PUBLIC_URL).replace(/\/$/,'');
  const confirmUrl = workerUrl+'/?action=linePayConfirm&orderId='+orderId;
  const cancelUrl = workerUrl+'/?action=linePayCancel';
  const payload = {
    amount, currency:'TWD', orderId,
    packages:[{id:'pkg_'+orderId, amount, products:[{name:sesName.slice(0,50), quantity:1, price:amount}]}],
    redirectUrls:{confirmUrl, cancelUrl},
  };
  const secret = env.LINEPAY_SECRET||LINEPAY_SECRET;
  const channelId = env.LINEPAY_CHANNEL_ID||LINEPAY_CHANNEL_ID;
  const apiUrl = env.LINEPAY_API_URL||LINEPAY_API_URL;
  const nonce = crypto.randomUUID();
  const ts = Date.now().toString();
  const uri = '/v3/payments/request';
  const sig = await hmacSha256Base64(secret, secret+uri+JSON.stringify(payload)+nonce+ts);
  try {
    const res = await fetch(apiUrl+uri, {
      method:'POST', body:JSON.stringify(payload),
      headers:{'Content-Type':'application/json','X-LINE-ChannelId':channelId,'X-LINE-Authorization-Nonce':nonce,'X-LINE-Authorization-Date':ts,'X-LINE-Authorization':sig},
    });
    const data = await res.json();
    if (data.returnCode!=='0000') return jsonErr(data.returnMessage||'LINE Pay 錯誤');
    await dbInsert(env, 'payments', {id:genId('PAY'),tenant_id:TENANT,registration_id:b.regId,session_id:reg.session_id,email:reg.email,amount,method:'LINE Pay',status:'待付款',trade_no:orderId,created_at:nowIso()});
    return jsonOk({success:true, paymentUrl:data.info.paymentUrl.web});
  } catch(e) { return jsonErr('LINE Pay 連線失敗: '+e.message); }
}

// createEcpayOrder
async function hCreateEcpayOrder(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  return jsonErr('目前採外部付款連結＋人工確認，未啟用信用卡 API');
  const rows = await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  if (reg.review_status!=='已錄取') return jsonErr('尚未錄取');
  if (isPaidStatus(reg.payment_status)) return jsonErr('已完成繳費');
  const amount = Number(reg.amount)||0;
  if (amount<=0) return jsonErr('金額錯誤');
  const merchantId = env.ECPAY_MERCHANT_ID||ECPAY_MERCHANT_ID;
  const hashKey = env.ECPAY_HASH_KEY||ECPAY_HASH_KEY;
  const hashIv = env.ECPAY_HASH_IV||ECPAY_HASH_IV;
  const apiUrl = env.ECPAY_API_URL||ECPAY_API_URL;
  const tradeNo = 'TBL'+Date.now().toString().slice(-10);
  const now = new Date();
  const pad = n=>String(n).padStart(2,'0');
  const td = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const sesName = await getSessionName(env, reg.session_id, TENANT);
  const workerUrl = (env.WORKER_URL||WORKER_PUBLIC_URL).replace(/\/$/,'');
  const params = {
    MerchantID:merchantId, MerchantTradeNo:tradeNo, MerchantTradeDate:td,
    PaymentType:'aio', TotalAmount:String(amount),
    TradeDesc:encodeURIComponent(((await getTenantCtx(env,TENANT)).name||FALLBACK_TENANT_NAME)+'報名費'),
    ItemName:encodeURIComponent(sesName||'報名費'),
    ReturnURL:`${workerUrl}/?action=ecpayReturn`,
    OrderResultURL:(await getTenantCtx(env,TENANT)).siteUrl+'?pay_result=1',
    ChoosePayment:'ALL', EncryptType:'1', ClientBackURL:(await getTenantCtx(env,TENANT)).siteUrl,
  };
  params.CheckMacValue = await ecpayMac(params, hashKey, hashIv);
  await dbInsert(env, 'payments', {id:genId('PAY'),tenant_id:TENANT,registration_id:b.regId,session_id:reg.session_id,email:reg.email,amount,method:'綠界',status:'待付款',trade_no:tradeNo,created_at:nowIso()});
  return jsonOk({success:true, params, apiUrl});
}

async function ecpayMac(params, hashKey, hashIv) {
  const sorted = Object.keys(params).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
  let str = 'HashKey='+hashKey+'&'+sorted.map(k=>k+'='+params[k]).join('&')+'&HashIV='+hashIv;
  str = encodeURIComponent(str).toLowerCase()
    .replace(/%20/g,'+').replace(/%21/g,'!').replace(/%28/g,'(')
    .replace(/%29/g,')').replace(/%2a/g,'*').replace(/%2d/g,'-')
    .replace(/%2e/g,'.').replace(/%5f/g,'_');
  return sha256Hex(str);
}

// AI 主視覺：讀取場次圖片資產
async function hGetSessionVisualAssets(env, p) {
  const TENANT = p._tenantId;
  const sessionId = String(p.sessionId || p.session_id || '').trim();
  if (!sessionId) return jsonErr('缺少 sessionId');
  if (!await verifyPlatformSuperAdmin(env, p.email, p.token, TENANT)) return jsonErr('無權限');
  const rows = await dbGet(env, 'session_visual_assets', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.desc`);
  return jsonOk(rows.map(_aiVisualAssetPublic));
}

// AI 主視覺：讀取生成任務歷史
async function hGetSessionVisualJobs(env, p) {
  const TENANT = p._tenantId;
  const sessionId = String(p.sessionId || p.session_id || '').trim();
  if (!sessionId) return jsonErr('缺少 sessionId');
  if (!await verifyPlatformSuperAdmin(env, p.email, p.token, TENANT)) return jsonErr('無權限');
  const rows = await dbGet(env, 'ai_visual_jobs', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=created_at.desc&limit=30`);
  return jsonOk(rows.map(r => ({
    id:r.id, sessionId:r.session_id, status:r.status, stylePreset:r.style_preset,
    requestedCount:Number(r.requested_count||0), completedCount:Number(r.completed_count||0),
    model:r.model||'', quality:r.quality||'', errorMessage:r.error_message||'',
    createdAt:r.created_at||'', completedAt:r.completed_at||''
  })));
}

// AI 主視覺：固定 1:1、每次生成 1 張
async function hGenerateSessionVisual(env, b) {
  const TENANT = b._tenantId;
  const sessionId = String(b.sessionId || b.session_id || '').trim();
  if (!sessionId) return jsonErr('缺少 sessionId');
  if (!await verifyPlatformSuperAdmin(env, b.email, b.token, TENANT)) return jsonErr('無權限');
  if (!env.OPENAI_API_KEY) return jsonErr('尚未設定 OPENAI_API_KEY，無法產圖');

  const sesRows = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sessionId)}&select=*`);
  if (!sesRows.length) return jsonErr('找不到場次');
  const s = sesRows[0];

  // 防重複扣費：同場次 30 分鐘內已有 processing 任務時，不重複送 OpenAI。
  // 超過 30 分鐘視為中斷任務，標記 failed 後允許重新生成。
  const runningJobs = await dbGet(env, 'ai_visual_jobs', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&status=eq.processing&select=id,created_at`).catch(()=>[]);
  const nowMs = Date.now();
  for (const j of (Array.isArray(runningJobs) ? runningJobs : [])) {
    const ageMs = nowMs - new Date(j.created_at || 0).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 30 * 60 * 1000) return jsonErr('此場次已有 AI 主視覺正在生成，請勿重複送出');
    await dbUpdate(env, 'ai_visual_jobs', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(j.id)}`, {status:'failed', error_message:'逾時中斷，已允許重新生成', completed_at:nowIso()}).catch(()=>{});
  }

  const eventRows = s.event_id ? await dbGet(env, 'events', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(s.event_id)}&select=*`).catch(()=>[]) : [];
  const evt = eventRows[0] || null;
  const title = String(s.name || '').trim();
  const dateText = _aiVisualDateText(s);
  const location = String(s.venue || '').trim();
  if (!title) return jsonErr('請先設定場次名稱');
  if (!dateText) return jsonErr('請先設定活動日期');
  if (!location) return jsonErr('請先設定活動地點');

  const requestedPreset = String(b.stylePreset || b.style_preset || '').trim();
  const presetKey = _detectAiVisualPreset(s, evt, requestedPreset === 'auto' ? '' : requestedPreset);
  if (!presetKey) return jsonErr('無法自動判斷品牌，請在 AI 主視覺區選擇：耶市集／市集小旅行／翻轉市集／幻日祭');

  const jobId = genId('AIJ');
  const createdAt = nowIso();
  const visualThemeNote = String(b.visualThemeNote || b.visual_theme_note || '').trim();
  const prompt1 = _buildAiVisualPrompt(s, evt, presetKey, 1, visualThemeNote);
  const model = String(env.OPENAI_IMAGE_MODEL || AI_VISUAL_DEFAULT_MODEL).trim();
  const quality = String(env.OPENAI_IMAGE_QUALITY || AI_VISUAL_DEFAULT_QUALITY).trim();

  try {
    await dbInsert(env, 'ai_visual_jobs', {
      id: jobId, tenant_id:TENANT, session_id:sessionId, job_type:'session_main_visual',
      status:'processing', style_preset:presetKey, aspect_ratio:'1:1', size:AI_VISUAL_SIZE,
      title_snapshot:title, date_snapshot:dateText, location_snapshot:location,
      description_snapshot:String(s.description||'').slice(0,2000),
      prompt_text:prompt1, requested_count:AI_VISUAL_COUNT, completed_count:0,
      model, quality, created_by:b.email||'', created_at:createdAt,
    });
  } catch (e) {
    if (String(e && e.message || e).includes('uq_ai_visual_jobs_one_processing') || String(e && e.message || e).includes('duplicate key')) {
      return jsonErr('此場次已有 AI 主視覺正在生成，請勿重複送出');
    }
    throw e;
  }

  const uploadedPaths = [];
  const insertedAssetIds = [];
  try {
    // 耶市集先確認正式 Logo 可讀，再呼叫付費產圖 API，避免 Logo 壞掉卻已先產生費用。
    const yeLogoBytes = presetKey === 'ye_market' ? await _fetchYeMarketOfficialLogo() : null;
    const generated = [await _openAiGenerateSquareVisual(env, prompt1)];
    if (generated.length !== AI_VISUAL_COUNT) throw new Error('產圖數量不是 1 張');

    const assets = [];
    for (let i = 0; i < generated.length; i++) {
      const assetId = genId('VIS');
      const isYeMarket = presetKey === 'ye_market';
      const finalBytes = isYeMarket ? _composeYeMarketFinalSvg(generated[i].bytes, yeLogoBytes, s) : generated[i].bytes;
      const finalMime = isYeMarket ? 'image/svg+xml' : 'image/png';
      const finalExt = isYeMarket ? 'svg' : 'png';
      const storagePath = `${TENANT}/${sessionId}/${jobId}/variant_${i+1}.${finalExt}`;
      const publicUrl = await _aiVisualStorageUpload(env, storagePath, finalBytes, finalMime);
      uploadedPaths.push(storagePath);
      const row = await dbInsert(env, 'session_visual_assets', {
        id:assetId, tenant_id:TENANT, session_id:sessionId, job_id:jobId,
        asset_type:'main_visual', style_preset:presetKey, storage_provider:'supabase_storage',
        bucket_name:AI_VISUAL_BUCKET, storage_path:storagePath, public_url:publicUrl,
        mime_type:finalMime, width:1024, height:1024, file_size:finalBytes.length,
        variant_no:i+1, is_selected:false, prompt_text:prompt1,
        created_by:b.email||'', created_at:nowIso(),
      });
      insertedAssetIds.push(assetId);
      assets.push(_aiVisualAssetPublic(row));
    }

    await dbUpdate(env, 'ai_visual_jobs', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(jobId)}`, {
      status:'succeeded', completed_count:AI_VISUAL_COUNT, completed_at:nowIso(), error_message:null,
    });
    await dbUpdate(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sessionId)}`, {
      ai_visual_preset:presetKey,
    });
    await writeAuditLog(env, TENANT, b.email||'', 'admin', 'generate_ai_visual', 'sessions', sessionId, {}, {jobId,presetKey,count:1,composition:presetKey==='ye_market'?'fixed_logo_center':'standard'}, {});
    return jsonOk({ success:true, jobId, stylePreset:presetKey, aspectRatio:'1:1', assets });
  } catch (e) {
    // 閉環回滾：任一張上傳或 DB 寫入失敗，清掉本次所有半成品。
    for (const id of insertedAssetIds) await dbDelete(env, 'session_visual_assets', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}`).catch(()=>{});
    for (const p of uploadedPaths) await _aiVisualStorageDelete(env, p).catch(()=>{});
    await dbUpdate(env, 'ai_visual_jobs', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(jobId)}`, {
      status:'failed', completed_count:0, error_message:String(e && e.message ? e.message : e).slice(0,2000), completed_at:nowIso(),
    }).catch(()=>{});
    await logError(env, {tenantId:TENANT, source:'hGenerateSessionVisual', action:'generateSessionVisual', sessionId, email:b.email||'', error:e});
    return jsonErr('AI 主視覺生成失敗：' + (e && e.message ? e.message : e));
  }
}

// AI 主視覺：二選一設為正式主圖，並同步既有 cover_url，前台不用改框架。
async function hSetSessionMainVisual(env, b) {
  const TENANT = b._tenantId;
  const sessionId = String(b.sessionId || b.session_id || '').trim();
  const assetId = String(b.assetId || b.asset_id || '').trim();
  if (!sessionId || !assetId) return jsonErr('缺少 sessionId 或 assetId');
  if (!await verifyPlatformSuperAdmin(env, b.email, b.token, TENANT)) return jsonErr('無權限');
  const rows = await dbGet(env, 'session_visual_assets', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&id=eq.${encodeURIComponent(assetId)}&select=*`);
  if (!rows.length) return jsonErr('找不到這張主視覺，或圖片不屬於本場次');
  const asset = rows[0];
  if (!asset.public_url) return jsonErr('圖片 URL 缺失，不能設為正式主圖');

  // 022：正式主圖二選一改由 DB RPC 單一交易完成，避免清空舊主圖後新主圖更新失敗的半套狀態。
  const rpcResult = await dbRpc(env, 'set_session_main_visual_atomic', {
    p_tenant_id:TENANT,
    p_session_id:sessionId,
    p_asset_id:assetId,
  });
  await writeAuditLog(env, TENANT, b.email||'', 'admin', 'set_ai_main_visual', 'sessions', sessionId, {}, {assetId,publicUrl:asset.public_url}, {});
  return jsonOk({success:true, asset:_aiVisualAssetPublic({...asset,is_selected:true}), coverUrl:asset.public_url, rpc:rpcResult});
}

// AI 主視覺：刪除未選用圖片；正式主圖禁止直接刪除。
async function hDeleteSessionVisualAsset(env, b) {
  const TENANT = b._tenantId;
  const sessionId = String(b.sessionId || b.session_id || '').trim();
  const assetId = String(b.assetId || b.asset_id || '').trim();
  if (!sessionId || !assetId) return jsonErr('缺少 sessionId 或 assetId');
  if (!await verifyPlatformSuperAdmin(env, b.email, b.token, TENANT)) return jsonErr('無權限');
  const [assets, sessions] = await Promise.all([
    dbGet(env, 'session_visual_assets', `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&id=eq.${encodeURIComponent(assetId)}&select=*`),
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sessionId)}&select=id,main_visual_asset_id`),
  ]);
  if (!assets.length) return jsonErr('找不到圖片');
  const asset = assets[0];
  if (asset.is_selected === true || (sessions[0] && String(sessions[0].main_visual_asset_id||'') === assetId)) return jsonErr('正式主圖不可直接刪除，請先選擇另一張正式主圖');
  await _aiVisualStorageDelete(env, asset.storage_path);
  await dbDelete(env, 'session_visual_assets', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(assetId)}`);
  return jsonOk({success:true, assetId});
}

// createEvent
async function hCreateEvent(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'events')) return jsonErr('無權限');
  const id = genId('EVT');
  await dbInsert(env,'events',{id,tenant_id:TENANT,title:b.title,description:b.desc||'',location:b.location||'',cover_url:b.cover||'',status:'開放中',created_at:nowIso()});
  return jsonOk({success:true,id});
}
// updateEvent
async function hUpdateEvent(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'events')) return jsonErr('無權限');
  const data = {title:b.title,description:b.desc||'',location:b.location||'',cover_url:b.cover||''};
  if (b.status) data.status=b.status;
  await dbUpdate(env,'events',`id=eq.${encodeURIComponent(b.id)}&tenant_id=eq.${TENANT}`,data);
  return jsonOk({success:true});
}
// deleteEvent
async function hDeleteEvent(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyPlatformSuperAdmin(env,b.email,b.token,TENANT)) return jsonErr('刪除主題僅限平台超級管理員');
  await dbDelete(env,'events',`id=eq.${encodeURIComponent(b.id)}&tenant_id=eq.${TENANT}`);
  return jsonOk({success:true});
}

// createSession
// ── 試用方案設定（單一來源：信件文案與實際限制皆引用此處，避免說一套做一套）──
const TRIAL_DAYS = 60;          // 試用天數
const TRIAL_MAX_SESSIONS = 10;  // 試用期可建立的場次數上限

// 試用限制檢查：達上限即擋下並提示升級
async function checkTrialSessionLimit(env, TENANT){
  const rows = await dbGet(env, 'tenants', `id=eq.${TENANT}&select=plan_type,trial_end_at`).catch(()=>[]);
  const t = rows[0];
  if (!t || t.plan_type !== 'trial') return '';   // 非試用方案不限制
  const list = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&select=id`).catch(()=>[]);
  if (list.length >= TRIAL_MAX_SESSIONS) {
    return `試用方案最多可建立 ${TRIAL_MAX_SESSIONS} 個場次（目前已有 ${list.length} 個）。如需新增，請升級方案或聯繫我們。`;
  }
  return '';
}

async function hCreateSession(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  const limitErr = await checkTrialSessionLimit(env, TENANT);
  if (limitErr) return jsonErr(limitErr);
  const scheduleResult = canonicalRegistrationSchedule(b.registrationSchedule, b.dates||[]);
  if (scheduleResult.error) return jsonErr(scheduleResult.error);
  const id = genId('SES');
  await dbInsert(env,'sessions',{
    id, tenant_id:TENANT, event_id:cleanEventId(b.eventId),
    name:b.name, type:b.type||'市集場次', region:b.region||'',
    dates_json:JSON.stringify(b.dates||[]),
    venue:b.venue||'', fee:Number(b.fee)||0, deposit:Number(b.deposit)||0,
    limit_count:Number(b.limit)||0, max_stalls:Number(b.maxStalls)||0, current_count:0,
    status:'報名中', need_review:b.needReview?true:false,
    modules_json:JSON.stringify(b.modules||{}),
    equip_json:JSON.stringify(b.equip||{}),
    basic_equip:b.basicEquip||'',
    invoice_tax_json:JSON.stringify(b.invoiceTax||{stall:true,equip:false,extra:false}),
    theme:b.theme||'', organizer:b.organizer||'', co_organizer:b.coorg||'',
    portals:(b.portals||[]).join(','),
    custom_fields_json:JSON.stringify(b.customFields||[]),
    addons_json:JSON.stringify(b.addons||[]),
    cover_url:b.cover||'', description:b.desc||'',
    seat_pricing_enabled: !!b.seatPricingEnabled,
    seat_hold_hours: Number(b.seatHoldHours)||SEAT_HOLD_HOURS,
    seat_map_url: b.seatMapUrl||'',
    assigned_staff:(b.assignedStaff||[]).join(','),
    force_cancel:false, created_at:nowIso(),
    payment_profile_id:b.paymentProfileId||b.payment_profile_id||null,
    registration_schedule_json: scheduleResult.schedule,
    // ── 合約同意設定 ──────────────────────────────────
    agreement_required:   agreementRequiredOn(b.agreementRequired),
    agreement_title:      b.agreementTitle || '報名合約／活動細則與攤商規範',
    agreement_content:    b.agreementContent || '',
    agreement_version:    b.agreementVersion || '',
    agreement_updated_at: nowIso(),
  });
  return jsonOk({success:true,id});
}
// updateSession
async function hUploadCover(env, b) {
  const T = b._tenantId;
  if (!await verifyStaff(env, b.email, b.token, T)) return jsonErr('無權限');
  const dataUrl = String(b.image || '');
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return jsonErr('圖片格式錯誤（請選 jpg/png 圖片）');
  const mime = m[1];
  let ext = (mime.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg').replace('+xml', '');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > 5 * 1024 * 1024) return jsonErr('圖片太大，請小於 5MB');
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
  const fname = (T || 'tuibile') + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const res = await fetch(base + '/storage/v1/object/covers/' + fname, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': mime, 'x-upsert': 'true' },
    body: bytes
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return jsonErr('上傳失敗（' + res.status + '）：' + txt.slice(0, 140));
  }
  return jsonOk({ url: base + '/storage/v1/object/public/covers/' + fname });
}
async function hUpdateSession(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');

  const patch = {
    event_id:cleanEventId(b.eventId), name:b.name, type:b.type||'市集場次', region:b.region||'',
    dates_json:JSON.stringify(b.dates||[]),
    venue:b.venue||'', fee:Number(b.fee)||0, deposit:Number(b.deposit)||0,
    limit_count:Number(b.limit)||0, max_stalls:Number(b.maxStalls)||0,
    status:b.status||'報名中', need_review:b.needReview?true:false,
    modules_json:JSON.stringify(b.modules||{}),
    theme:b.theme||'', organizer:b.organizer||'', co_organizer:b.coorg||'',
    portals:(b.portals||[]).join(','),
    cover_url:b.cover||'', description:b.desc||'',
    assigned_staff:(b.assignedStaff||[]).join(','),
    payment_profile_id:b.paymentProfileId||b.payment_profile_id||null,
    // ── 合約同意設定 ──────────────────────────────────
    agreement_required:   agreementRequiredOn(b.agreementRequired),
    agreement_title:      b.agreementTitle || '報名合約／活動細則與攤商規範',
    agreement_content:    b.agreementContent || '',
    agreement_version:    b.agreementVersion || '',
    agreement_updated_at: nowIso(),
  };

  // ── 沒送的欄位一律不動（DATA-LOSS 修正）────────────────────────────────
  // 舊寫法是 equip_json:JSON.stringify(b.equip||{})，只要請求沒帶設備，就直接寫成 {}。
  // 而後台在「設備／加購／發票」模組沒勾選時，根本不會送這些欄位；customFields 更是從來沒送過。
  // 結果：取消勾選模組後儲存 → 設備設定被永久刪除；每存一次場次 → 自訂欄位被清空一次。
  // 模組開關只該決定「要不要顯示／啟用」，不該把資料砍掉。
  // 現在改成：欄位有送才寫，沒送就保留資料庫原值。要清空請送空值（{}／[]），意圖明確。
  if (b.equip        !== undefined) patch.equip_json         = JSON.stringify(b.equip);
  if (b.addons       !== undefined) patch.addons_json        = JSON.stringify(b.addons);
  if (b.invoiceTax   !== undefined) patch.invoice_tax_json   = JSON.stringify(b.invoiceTax);
  if (b.customFields !== undefined) patch.custom_fields_json = JSON.stringify(b.customFields);
  if (b.basicEquip   !== undefined) patch.basic_equip        = b.basicEquip || '';
  if (b.registrationSchedule !== undefined) {
    const scheduleResult = canonicalRegistrationSchedule(b.registrationSchedule, b.dates||[]);
    if (scheduleResult.error) return jsonErr(scheduleResult.error);
    patch.registration_schedule_json = scheduleResult.schedule;
  }

  await dbUpdate(env,'sessions',`id=eq.${encodeURIComponent(b.id)}&tenant_id=eq.${TENANT}`, patch);
  return jsonOk({success:true});
}
// deleteSession
async function hDeleteSession(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  // 場次刪除無法復原，且租戶 superadmin 是每個主辦自己的最高權限（第二家也有）。
  // 為避免主辦誤刪救不回，這裡鎖到「平台超級管理員」——只有平台方能刪。
  // 這是真正的權限關卡；前端隱藏按鈕只是輔助，後端一定要擋。
  if (!await verifyPlatformSuperAdmin(env,b.email,b.token,TENANT)) return jsonErr('場次刪除僅限平台超級管理員，請改用「封存」。');
  await dbDelete(env,'sessions',`id=eq.${encodeURIComponent(b.id)}&tenant_id=eq.${TENANT}`);
  return jsonOk({success:true});
}
// toggleSession
async function hToggleSession(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  const id = b.id||b.sessionId;
  const rows = await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}&select=status`);
  if (!rows.length) return jsonErr('找不到場次');
  const next = rows[0].status==='關閉'?'報名中':'關閉';
  await dbUpdate(env,'sessions',`id=eq.${encodeURIComponent(id)}&tenant_id=eq.${TENANT}`,{status:next});
  return jsonOk({success:true, status:next});
}
// toggleSessionStatus（直接設定指定 status）
async function hToggleSessionStatus(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  await dbUpdate(env,'sessions',`id=eq.${encodeURIComponent(b.sessionId)}&tenant_id=eq.${TENANT}`,{status:b.status||'已截止'});
  return jsonOk({success:true});
}
// copySession
async function hCopySession(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  const limitErr = await checkTrialSessionLimit(env, TENANT);
  if (limitErr) return jsonErr(limitErr);
  const rows = await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.id)}&select=*`);
  if (!rows.length) return jsonErr('找不到場次');
  const src = {...rows[0]};
  const newId = genId('SES');
  src.id=newId; src.name=(src.name||'')+'（複製）';
  src.current_count=0; src.status='報名中';
  src.registration_schedule_json={version:1,enabled:false,preset:'three_stage',timezone:REGISTRATION_SCHEDULE_TIME_ZONE,windows:[]};
  src.force_cancel=false; src.force_cancel_target_id=null; src.force_cancel_deadline=null;
  src.created_at=nowIso();
  await dbInsert(env,'sessions',src);
  return jsonOk({success:true,id:newId});
}


async function applyReviewStatusChange(env, TENANT, reg, nextStatus, adminNote) {
  const beforeActive = isActiveForCapacity(reg);
  const upd = {review_status: nextStatus};
  if (adminNote) upd.admin_note = adminNote;
  if (String(nextStatus||'') === '已錄取') {
    const sessionRow = await getSessionRow(env, reg.session_id, TENANT).catch(()=>null);
    if (sessionRow) {
      const snap = await ensurePaymentSnapshotForReg(env,TENANT,reg,sessionRow,{forceWrite:true});
      Object.assign(upd, _paymentSnapshotDbPayload(snap));
    }
  }
  await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(reg.id)}&tenant_id=eq.${TENANT}`,upd);
  const nextReg = {...reg, review_status: nextStatus};
  const afterActive = isActiveForCapacity(nextReg);
  if (beforeActive !== afterActive) {
    await adjustSessionCurrentCount(env, TENANT, reg.session_id, afterActive ? (safeNum(reg.stall_count)||1) : -(safeNum(reg.stall_count)||1));
    await writeAuditLog(env, TENANT, '', 'system', 'review_status_capacity_adjust', 'registrations', reg.id, {review_status:reg.review_status}, {review_status:nextStatus}, {capacity_delta:afterActive ? (safeNum(reg.stall_count)||1) : -(safeNum(reg.stall_count)||1)});
    // SEAT_RELEASE_ON_REJECT_20260725：改成不錄取／婉拒等（離開有效名額）時，
    // 把已排／已鎖／已預留的位置放回空閒，並清掉該筆的選位欄位，避免位置卡住不能再排。
    if (!afterActive) {
      try {
        const st = await dbGet(env,'stalls',`tenant_id=eq.${TENANT}&reg_id=eq.${encodeURIComponent(reg.id)}&select=id`);
        for (const s of st) await dbUpdate(env,'stalls',`id=eq.${s.id}&tenant_id=eq.${TENANT}`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null});
        await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(reg.id)}&tenant_id=eq.${TENANT}`,{stall_number:null,seat_choice_status:'released',seat_choice_type:null,seat_hold_expires_at:null});
      } catch(e) { console.error('review-change stall release skipped', e&&e.message?e.message:e); logError(env,{source:'applyReviewStatusChange',message:'stall release skipped',error:e&&e.message?e.message:e}); }
    }
  }
}

// updateRegStatus（單筆）
async function hUpdateRegStatus(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'review')) return jsonErr('無權限');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  try {
    await applyReviewStatusChange(env, TENANT, reg, b.status, b.adminNote);
  } catch(e) {
    return jsonErr(e && e.message ? e.message : '審核失敗');
  }
  await sendStatusEmail(env, b.status, reg);
  return jsonOk({success:true});
}

// batchUpdateStatus（批次）
async function hBatchUpdateStatus(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'review')) return jsonErr('無權限');
  const results=[];
  for (const regId of (b.regIds||[])) {
    try {
      const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(regId)}&select=*`);
      if (!rows.length) { results.push({error:'找不到報名'}); continue; }
      const reg = rows[0];
      await applyReviewStatusChange(env, TENANT, reg, b.status, b.adminNote);
      await sendStatusEmail(env, b.status, reg);
      results.push({success:true});
    } catch(e) { results.push({error:e.message}); }
  }
  return jsonOk({success:true, results});
}

// 共用：依審核狀態寄信
async function sendStatusEmail(env, status, reg) {
  const TENANT = (reg && reg.tenant_id) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  try {
    const sesName = await getSessionName(env, reg.session_id, TENANT);
    const sesType = await getSessionType(env, reg.session_id, TENANT);
    const dn = getDisplayName(reg.name, reg.brand_name||'', sesType);
    const tc = await getTenantCtx(env, TENANT);
    if (status==='已錄取') {
      const sr = await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.session_id)}&select=basic_equip`);
      const be = sr.length?sr[0].basic_equip||'':'';
      await mailApproval(env,reg.email,dn,sesName,reg.id,Number(reg.amount)||0,reg.stall_count,safeJson(reg.selected_dates_json,[]),reg.equipment_json,be,tc);
    }
    if (status==='不錄取') await mailRejection(env,reg.email,dn,sesName,tc);
  } catch(e) {
    // 原本為 catch {} 全部吞掉：寄信失敗時畫面仍顯示成功，完全查不到原因。
    console.error('sendStatusEmail error:', status, reg && reg.email, e && e.message ? e.message : String(e)); logError(env, {source:'sendStatusEmail', message:'sendStatusEmail error:', error:e && e.message ? e.message : String(e)});
  }
}

// approveReg（與 updateRegStatus 功能相同，保留接口相容性）
async function hApproveReg(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'review')) return jsonErr('無權限');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  const status = b.status||(b.approved?'已錄取':'不錄取');
  try {
    await applyReviewStatusChange(env, TENANT, reg, status, b.adminNote);
  } catch(e) {
    return jsonErr(e && e.message ? e.message : '審核失敗');
  }
  await sendStatusEmail(env, status, reg);
  return jsonOk({success:true, status});
}

// confirmPayment（後台手動確認）
async function hConfirmPayment(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token, TENANT, 'finance')) return jsonErr('無權限');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  // 合併結帳：同一次付款（payment_group_id）之其餘場次一併確認，避免主辦逐場點
  if (!b._groupDone) {
    const gid = String(reg.payment_group_id||'').trim();
    if (gid) {
      const grp = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&payment_group_id=eq.${encodeURIComponent(gid)}&select=id,payment_status`).catch(()=>[]);
      const others = grp.filter(g=>String(g.id)!==String(b.regId) && !isPaidStatus(g.payment_status));
      const res = await hConfirmPayment(env, {...b, _groupDone:true});
      for (const g of others) {
        await hConfirmPayment(env, {...b, regId:g.id, _groupDone:true}).catch(e=>{
          console.error('group confirm skipped', e&&e.message?e.message:e); logError(env, {source:'hConfirmPayment', message:'group confirm skipped', error:e&&e.message?e.message:e});
        });
      }
      return res;
    }
  }
  if (_reviewStatus(reg) !== '已錄取') return jsonErr('尚未錄取，不能確認付款');
  if (isPaidStatus(_payStatus(reg))) return jsonErr('此報名已完成繳費，不能重複確認');
  if (isCapacityInactiveTransferStatus(reg.transfer_status)) return jsonErr('此報名已進入退費流程，不能確認付款');
  const now = nowIso();
  const method = b.method || reg.payment_method || '手動確認';
  const [paySesRows, payItemMap] = await Promise.all([
    dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.session_id)}&select=*`).catch(()=>[]),
    _getRegistrationItemsForRegs(env, [reg]).catch(()=>({})),
  ]);
  const payMoney = _regFinanceAmounts(reg, paySesRows[0] || {}, payItemMap && payItemMap[reg.id]);
  const amount = safeNum(reg.payment_report_amount) || payMoney.cashTotal || safeNum(reg.total_amount) || safeNum(reg.amount);
  const paySnap = await ensurePaymentSnapshotForReg(env,TENANT,reg,paySesRows[0]||{}, {writeIfSafe:true}).catch(()=>_paymentSnapshotFromReg(reg));
  await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`,{
    payment_status:'已繳費', payment_method:method, paid_at:now,
    // 實收獨立記錄。應收(total_amount)日後可能因併入套組而重寫，實收不可被改掉。
    paid_amount: safeNum(reg.paid_amount) + amount,
    ..._paymentSnapshotDbPayload(paySnap),
  });
  try {
    const pendingPayRows = await dbGet(env,'payments',`tenant_id=eq.${TENANT}&registration_id=eq.${encodeURIComponent(b.regId)}&status=eq.%E5%BE%85%E7%A2%BA%E8%AA%8D&select=id`);
    if (pendingPayRows.length) {
      for (const pr of pendingPayRows) {
        await dbUpdate(env,'payments',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(pr.id)}`,{registration_id:b.regId,session_id:reg.session_id,email:reg.email,amount,method,status:'已確認',trade_no:b.merchantTradeNo||reg.payment_last5||'',paid_at:now,payment_profile_id:(paySnap&&paySnap.payment_profile_id)||null,payment_profile_snapshot:paySnap||{}});
      }
    } else {
      await dbInsert(env,'payments',{id:genId('PAY'),tenant_id:TENANT,registration_id:b.regId,session_id:reg.session_id,email:reg.email,amount,method,status:'已確認',trade_no:b.merchantTradeNo||reg.payment_last5||'',paid_at:now,created_at:now,payment_profile_id:(paySnap&&paySnap.payment_profile_id)||null,payment_profile_snapshot:paySnap||{}});
    }
  } catch(e) {
    console.error('payments confirm update failed', e && e.message ? e.message : e); logError(env, {source:'hConfirmPayment', message:'payments confirm update failed', error:e && e.message ? e.message : e});
  }
  try {
    await dbUpdate(env,'stalls',`tenant_id=eq.${TENANT}&reg_id=eq.${encodeURIComponent(b.regId)}&status=eq.預留`,{status:'鎖定',seat_hold_expires_at:null});
    if (String(reg.seat_choice_intent||'auto')==='paid') {
      await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}`,{seat_choice_status:'locked',seat_hold_expires_at:null});
    } else if (!reg.stall_number) {
      // 自動排位：延後至活動前批次統一排（依繳費順序）；若該場批次已排過，代表是批次後才補繳者，需即時補一位，否則他沒有攤位。
      const _sRow=(await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.session_id)}&select=seat_assign_done_at`))[0];
      if (_sRow && _sRow.seat_assign_done_at) await autoAssignSeatForPaidReg(env,TENANT,reg);
    }
  } catch(e) { console.error('seat lock/auto assign failed', e&&e.message?e.message:e); logError(env, {source:'hConfirmPayment', message:'seat lock/auto assign failed', error:e&&e.message?e.message:e}); }
  const sesName = await getSessionName(env, reg.session_id, TENANT);
  const sesType = await getSessionType(env, reg.session_id, TENANT);
  const dn = getDisplayName(reg.name, reg.brand_name||'', sesType);
  let equipStr='';
  try { const eq=safeJson(reg.equipment_json,{}); equipStr=Object.entries(eq).filter(([k,v])=>v>0).map(([k,v])=>k+'x'+v).join('、'); } catch {}
  const tc = await getTenantCtx(env, TENANT);
  try { await mailPaymentConfirm(env,reg.email,dn,sesName,amount,equipStr,reg.stall_number||'',tc); } catch {}
  return jsonOk({success:true});
}

// markPaymentScreenshot（後台標記已回報客服／已收到匯款截圖）
async function hMarkPaymentScreenshot(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token, TENANT)) return jsonErr('無權限');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  if (isPaidStatus(_payStatus(reg))) return jsonErr('此報名已確認付款，不需再標記客服回報');
  if (_reviewStatus(reg)==='已取消') return jsonErr('此報名已取消，不能標記客服回報');
  const now = nowIso();
  const oldNote = String(reg.admin_note||'').trim();
  const append = `[後台] 已回報客服／已收到匯款截圖 ${nowTaipeiText()}`;
  const data = {
    payment_screenshot_status:'已回報客服',
    payment_screenshot_received_at:now,
    admin_note:(oldNote ? oldNote + ' ' : '') + append,
  };
  await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`,data);
  try {
    await dbUpdate(env,'payments',`tenant_id=eq.${TENANT}&registration_id=eq.${encodeURIComponent(b.regId)}&status=eq.待確認`,{
      screenshot_status:'已回報客服',
      screenshot_received_at:now,
      admin_note:append,
    });
  } catch(e) { console.error('payments screenshot optional update skipped', e&&e.message?e.message:e); logError(env, {source:'hMarkPaymentScreenshot', message:'payments screenshot optional update skipped', error:e&&e.message?e.message:e}); }
  return jsonOk({success:true, paymentScreenshotStatus:'已回報客服', paymentScreenshotReceivedAt:now});
}


// sendPaymentReminder（後台手動寄出待付款提醒，支援 email_templates 與 [按鈕:...] 語法）
async function hSendPaymentReminder(env, b) {
  const TENANT = (b && b._tenantId);
  const regId = b.regId || b.id;
  if (!regId) return jsonErr('缺少 regId');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  const sessionId = b.sessionId || b.session_id || reg.session_id;
  if (!await verifyStaff(env,b.email,b.token,TENANT,'review',sessionId)) return jsonErr('無權限');
  if (!reg.email) return jsonErr('此報名沒有 Email，無法寄信');
  if (_reviewStatus(reg) !== '已錄取') return jsonErr('尚未錄取，不適合寄待付款提醒');
  if (isPaidStatus(_payStatus(reg)) || _payStatus(reg) === '免費') return jsonErr('此報名已完成付款或為免費，不需寄待付款提醒');
  if (isCapacityInactiveTransferStatus(reg.transfer_status) || _reviewStatus(reg)==='已取消') return jsonErr('此報名已取消或進入退費流程，不能寄待付款提醒');
  const sesName = await getSessionName(env, sessionId, TENANT);
  const sesType = await getSessionType(env, sessionId, TENANT);
  const tc = await getTenantCtx(env, TENANT);
  const selectedDates = safeJson(reg.selected_dates_json, []);
  const datesText = Array.isArray(selectedDates) ? selectedDates.map(d => typeof d==='object' ? (d.date || d.value || d.label || '') : String(d||'')).filter(Boolean).join('、') : String(selectedDates || '');
  const displayName = getDisplayName(reg.name, reg.brand_name||reg.brand||'', sesType);
  const amount = Number(reg.amount || reg.total_amount || reg.registration_total_amount || 0) || 0;
  const result = await mailDeadlineReminder(env, reg.email, displayName, sesName, reg.id, amount, selectedDates, reg.equipment_json, '', tc);
  if (result && result.disabled) return jsonErr('這封信目前已停用，未寄出');
  if (!result || !result.ok) return jsonErr('寄信失敗：'+((result&&result.error)||'未知錯誤'));
  const oldNote = String(reg.admin_note||'').trim();
  const append = `[後台] 已寄出待付款提醒 ${nowTaipeiText()}`;
  await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.id)}`,{reminder_sent:true,admin_note:(oldNote ? oldNote + ' ' : '') + append}).catch(()=>{});
  return jsonOk({success:true, to:reg.email, subject});
}

// adminCancelReg（後台取消未繳費／待確認報名，保留資料不刪除）
async function hAdminCancelReg(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token, TENANT)) return jsonErr('無權限');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  if (isPaidStatus(_payStatus(reg))) return jsonErr('已繳費報名不可直接取消，請走退款申請流程');
  if (isCapacityInactiveTransferStatus(reg.transfer_status)) return jsonErr('此報名已進入退款或退費完成流程，不能用取消流程處理');
  if (_reviewStatus(reg)==='已取消') return jsonOk({success:true, alreadyCancelled:true});
  // 組合套組同進退：整組一起取消
  const group = await getBundleGroupRegs(env, TENANT, reg);
  for (const g of group) {
    if (_reviewStatus(g)==='已取消') continue;
    const gWasActive = isActiveForCapacity(g);
    const gOldNote = String(g.admin_note||'').trim();
    const gAppend = `[後台] 取消未繳費／待確認報名${group.length>1?'（組合套組同進退）':''} ${nowTaipeiText()}`;
    await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(g.id)}&tenant_id=eq.${TENANT}`,{
      review_status:'已取消',
      transfer_status:null,
      admin_note:(gOldNote ? gOldNote + ' ' : '') + gAppend,
    });
    try {
      if (gWasActive) await adjustSessionCurrentCount(env, TENANT, g.session_id, -(safeNum(g.stall_count)||1));
    } catch(e) { console.error('admin cancel session count skipped', e&&e.message?e.message:e); logError(env, {source:'hAdminCancelReg', message:'admin cancel session count skipped', error:e&&e.message?e.message:e}); }
    try {
      const st = await dbGet(env, 'stalls', `tenant_id=eq.${TENANT}&reg_id=eq.${encodeURIComponent(g.id)}&select=id`);
      for (const s of st) await dbUpdate(env, 'stalls', `id=eq.${s.id}&tenant_id=eq.${TENANT}`, {status:'空閒',reg_id:null,email:null,hold_time:null});
    } catch(e) { console.error('admin cancel stall release skipped', e&&e.message?e.message:e); logError(env, {source:'hAdminCancelReg', message:'admin cancel stall release skipped', error:e&&e.message?e.message:e}); }
  }
  return jsonOk({success:true, status:'已取消', bundleCount: group.length});
}

// refundDeposit
async function hRefundDeposit(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token, TENANT, 'finance')) return jsonErr('無權限');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=review_status,payment_status,transfer_status,deposit`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  if (String(reg.review_status||'') === '已取消') return jsonErr('已取消報名不可退押金');
  if (['申請退費','已退費'].includes(String(reg.transfer_status||''))) return jsonErr('退費中或已退費報名不可走退押金流程');
  if (!(isPaidStatus(reg.payment_status) || String(reg.payment_status||'') === '免費')) return jsonErr('尚未完成付款，不能退押金');
  await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`,{deposit_refunded:'已退押金'});
  return jsonOk({success:true});
}

// checkin
// ── 報到共用核心：後台「現場」tab 與工讀生通行碼頁共用同一份規則 ──
// 規則：報到必須「已錄取」＋「已繳費或免費」＋非退費流程中；取消報到一律寫「未報到」。
function checkinGuard(reg, undo){
  if (undo) return '';
  if (_reviewStatus(reg) !== '已錄取') return '尚未錄取，不能報到';
  if (!(isPaidStatus(_payStatus(reg)) || _payStatus(reg) === '免費')) return '尚未完成繳費，不能報到';
  if (['申請退費','已退費'].includes(String(reg.transfer_status||''))) return '此報名已進入退費流程，不能報到';
  return '';
}
function checkinData(undo, now){
  return undo ? {checkin_status:'未報到', checkin_at:null}
              : {checkin_status:'已報到', checkin_at:now};
}

async function hCheckin(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'checkin')) return jsonErr('無權限');
  const undo = b.undo===true||b.undo==='true';
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=review_status,payment_status,transfer_status`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  const err = checkinGuard(reg, undo);
  if (err) return jsonErr(err);
  const now = nowIso();
  await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`, checkinData(undo, now));
  const operator = await staffDisplayName(env, TENANT, b.email);
  await dbInsert(env,'seat_operation_logs',{ id: genId('OPL'), tenant_id: TENANT, session_id: (b.sessionId||null), registration_id: b.regId, stall_id: null, action: undo?'undoCheckin':'checkin', operator_type:'admin', operator_id: operator, note: null, created_at: now }).catch(()=>{});
  return jsonOk({success:true, undo});
}

async function hUpdateRegistrationAction(env, b) {
  const TENANT = (b && b._tenantId);
  const regId = b.regId || b.id;
  const action = String(b.regAction || b.actionName || b.mode || '').trim();
  if (!regId) return jsonErr('缺少 regId');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  const sessionId = b.sessionId || b.session_id || reg.session_id;
  if (!await verifyStaff(env,b.email,b.token,TENANT,'',sessionId)) return jsonErr('無權限');
  if (action === 'approve') return hApproveReg(env,{...b,regId,status:'已錄取',approved:true,sessionId});
  if (action === 'reject') return hApproveReg(env,{...b,regId,status:'不錄取',approved:false,sessionId});
  if (action === 'waitlist') return hApproveReg(env,{...b,regId,status:'備取',sessionId});
  if (action === 'markPaymentReported') return hMarkPaymentScreenshot(env,{...b,regId,sessionId});
  if (action === 'confirmPayment') return hConfirmPayment(env,{...b,regId,sessionId});
  if (action === 'cancelUnpaid') return hAdminCancelReg(env,{...b,regId,sessionId});
  if (action === 'remindPayment') return hSendPaymentReminder(env,{...b,regId,sessionId});
  if (action === 'checkin') return hCheckin(env,{...b,regId,sessionId});
  if (action === 'undoCheckin') return hCheckin(env,{...b,regId,sessionId,undo:true});
  if (action === 'markUnpaid') {
    if (!await verifyStaff(env,b.email,b.token,TENANT,'finance',sessionId)) return jsonErr('無權限');
    if (isPaidStatus(_payStatus(reg))) return jsonErr('已繳費資料不可直接改回未繳費，請走退費或人工校正流程');
    await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(regId)}`,{payment_status:'未繳費'});
    return jsonOk({success:true});
  }
  return jsonErr('未知操作：'+action);
}

// markClear（已清場）
async function hMarkClear(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'checkin')) return jsonErr('無權限');
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=review_status,payment_status,transfer_status`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  if (String(reg.review_status||'') !== '已錄取') return jsonErr('尚未錄取，不能清場');
  if (!(isPaidStatus(reg.payment_status) || String(reg.payment_status||'') === '免費')) return jsonErr('尚未完成付款，不能清場');
  if (['申請退費','已退費'].includes(String(reg.transfer_status||''))) return jsonErr('此報名已進入退費流程，不能清場');
  const data = {clear_status:'已清場'};
  if (b.refunded) data.deposit_refunded='已退押金';
  await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`,data);
  return jsonOk({success:true});
}

// sendNotify
async function hSendNotify(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const ok = (await verifyStaff(env,b.email,b.token,TENANT,'review'))||(await verifyStaff(env,b.email,b.token,TENANT,'announce'));
  if (!ok) return jsonErr('無權限');
  let qs = `tenant_id=eq.${TENANT}&select=email,name,review_status`;
  if (b.sessionId) qs+=`&session_id=eq.${encodeURIComponent(b.sessionId)}`;
  if (b.regId) qs+=`&id=eq.${encodeURIComponent(b.regId)}`;
  let rows = await dbGet(env,'registrations',qs);
  if (b.target&&b.target!=='all') rows=rows.filter(r=>r.review_status===b.target);
  let sent=0, skipped=0;
  const tc = await getTenantCtx(env, TENANT);
  for (const r of rows) if(r.email) {
    try {
      const dn = getDisplayName(r.name, r.brand_name||'', '');
      const result = await sendTemplateEmail(env, TENANT, 'custom_notice', r.email, {
        '主辦名稱': tc.name || FALLBACK_TENANT_NAME,
        '顯示名稱': dn || r.name || '',
        '通知內容': b.content || b.message || '',
        '場次名稱': b.sessionName || '',
      }, tc, r.id, {targetId:r.id,targetTable:'registrations',actorEmail:b.email||'',actorRole:'announce'});
      if (result && result.skipped) skipped++; else if(result && result.ok) sent++;
    } catch {}
  }
  return jsonOk({success:true, sent, skipped});
}

// resendInvite
async function hResendInvite(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  const rows = await dbGet(env,'staff',`tenant_id=eq.${TENANT}&email=eq.${encodeURIComponent(b.targetEmail)}&select=*`);
  if (!rows.length) return jsonErr('找不到此管理員');
  const s=rows[0];
  const ls=s.limit_sessions?String(s.limit_sessions).split(',').filter(Boolean):[];
  const tc = await getTenantCtx(env, TENANT);
  try { await mailStaffInvite(env,s.email,s.name||'',s.role||'organizer_admin',safeJson(s.perms_json,{}),ls,tc); } catch(e) { return jsonErr('寄信失敗：'+e.message); }
  return jsonOk({success:true});
}

// 租戶後台不得建立 platform_super_admin；平台身分只能存在 platform_staff。
const VALID_STAFF_ROLES = new Set(['organizer_admin','session_admin','finance_admin','onsite_staff']);
function normalizeStaffRoleInput(role) {
  const r = String(role || '').trim();
  const map = {
    'organizer_admin':'organizer_admin',
    'session_admin':'session_admin',
    'finance_admin':'finance_admin',
    'onsite_staff':'onsite_staff'
  };
  return map[r] || '';
}
function assertValidStaffRole(role){
  const normalized=normalizeStaffRoleInput(role);
  if(!VALID_STAFF_ROLES.has(normalized)) throw new Error('不支援的管理身分');
  return normalized;
}

async function syncStaffSessionPermissions(env, tenantId, staffEmail, sessionIds) {
  const ids = (sessionIds||[]).map(x=>String(x||'').trim()).filter(Boolean);
  await dbDelete(env, 'staff_session_permissions', `tenant_id=eq.${tenantId}&staff_email=eq.${encodeURIComponent(staffEmail)}`).catch(()=>{});
  for (const sid of ids) {
    await dbInsert(env, 'staff_session_permissions', {
      id: genId('SSP'), tenant_id: tenantId, staff_email: staffEmail, session_id: sid,
      can_view: true, can_checkin: true, can_mark_absent: true, can_note: true, can_mark_refund_flag: true,
      is_active: true, created_at: nowIso(), updated_at: nowIso()
    }).catch(()=>{});
  }
}

// addStaff
async function hAddStaff(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  const ex = await dbGet(env,'staff',`tenant_id=eq.${TENANT}&email=eq.${encodeURIComponent(b.targetEmail)}&select=email`);
  if (ex.length) return jsonErr('此帳號已存在');
  let normalizedRole; try{ normalizedRole = assertValidStaffRole(b.role || 'organizer_admin'); }catch(e){ return jsonErr(e.message); }
  const displayRole = normalizedRole;
  const perms = b.perms || (normalizedRole === 'onsite_staff' ? {checkin:true} : {});
  // 所有非 owner 租戶角色都必須先指定 event 或 session，不建立全租戶權限。
  const scopeType = ['event','session'].includes(b.scopeType) ? b.scopeType : (normalizedRole==='organizer_admin'?'event':'session');
  const scopeEventId = scopeType==='event' ? String(b.scopeEventId||'').trim() : '';
  if(normalizedRole==='organizer_admin' && (!scopeEventId || scopeType!=='event')) return jsonErr('主辦管理員必須指定一個活動系列');
  if(scopeEventId){const ev=await dbGet(env,'events',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(scopeEventId)}&select=id`).catch(()=>[]);if(!ev.length)return jsonErr('指定的活動系列不存在');}
  await dbInsert(env,'staff',{
    id:crypto.randomUUID(),
    email:b.targetEmail,
    tenant_id:TENANT,
    name:b.targetName||'',
    role:displayRole,
    normalized_role:normalizedRole,
    role_id:normalizedRole,
    perms_json:JSON.stringify(perms),
    limit_sessions:(b.limitSessions||[]).join(','),
    scope_type:scopeType,
    scope_event_id:scopeEventId,
    active:true,
    is_active:true,
  });
  await syncStaffSessionPermissions(env, TENANT, b.targetEmail, b.limitSessions||[]);
  const tcStaff = await getTenantCtx(env, TENANT);
  try { await mailStaffInvite(env,b.targetEmail,b.targetName||'',displayRole,perms,b.limitSessions||[],tcStaff); } catch {}
  return jsonOk({success:true});
}
// setStaffActive（開放／關閉帳號，保留人員資料與場次權限）
async function hSetStaffActive(env, b) {
  const TENANT = (b && b._tenantId);
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  if (!b.targetEmail) return jsonErr('缺少 targetEmail');
  const active = b.active === true || b.active === 'true' || b.active === 1 || b.active === '1';
  await dbUpdate(env,'staff',`email=eq.${encodeURIComponent(b.targetEmail)}&tenant_id=eq.${TENANT}`,{
    is_active:active,
    active:active,
    updated_at:nowIso(),
  });
  return jsonOk({success:true, active});
}

// removeStaff
async function hRemoveStaff(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  if (!b.targetEmail) return jsonErr('缺少 targetEmail');
  if (String(b.targetEmail).toLowerCase() === String(b.email).toLowerCase()) return jsonErr('不能刪除目前登入中的自己');
  await dbDelete(env,'staff',`email=eq.${encodeURIComponent(b.targetEmail)}&tenant_id=eq.${TENANT}`);
  return jsonOk({success:true});
}
// updateStaffPerms
async function hUpdateStaffPerms(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  await dbUpdate(env,'staff',`email=eq.${encodeURIComponent(b.targetEmail)}&tenant_id=eq.${TENANT}`,{perms_json:JSON.stringify(b.perms||{})});
  return jsonOk({success:true});
}
// updateStaffSessions
async function hUpdateStaffSessions(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  const sessions = b.sessions || b.sessionIds || [];
  const scopeType = b.scopeType || b.scope_type || 'all';
  const scopeEventId = (scopeType === 'event') ? (b.scopeEventId || b.scope_event_id || '') : '';
  const normalizedScopeType = scopeType === 'sessions' ? 'session' : scopeType;
  if (!['all','event','session'].includes(normalizedScopeType)) return jsonErr('不支援的授權範圍');
  const targetRows=await dbGet(env,'staff',`tenant_id=eq.${TENANT}&email=eq.${encodeURIComponent(b.targetEmail)}&select=role,normalized_role`).catch(()=>[]);
  if(!targetRows.length)return jsonErr('找不到管理者');
  const nextRole=String(b.role||targetRows[0].normalized_role||targetRows[0].role||'');
  if(nextRole==='organizer_admin'&&(normalizedScopeType!=='event'||!scopeEventId))return jsonErr('主辦管理員必須指定一個活動系列');
  if(scopeEventId){const ev=await dbGet(env,'events',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(scopeEventId)}&select=id`).catch(()=>[]);if(!ev.length)return jsonErr('指定的活動系列不存在');}
  const staffUpd = {limit_sessions:sessions.join(','), scope_type:normalizedScopeType, scope_event_id:scopeEventId, scope_session_ids:sessions, updated_at:nowIso()};
  if (b.role) { let nr; try{ nr=assertValidStaffRole(b.role); }catch(e){ return jsonErr(e.message); } staffUpd.normalized_role=nr; staffUpd.role=nr; staffUpd.role_id=nr; }
  await dbUpdate(env,'staff',`email=eq.${encodeURIComponent(b.targetEmail)}&tenant_id=eq.${TENANT}`,staffUpd);
  await syncStaffSessionPermissions(env, TENANT, b.targetEmail, sessions);
  return jsonOk({success:true});
}

// saveAnnouncement
async function hSaveAnnouncement(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'announce')) return jsonErr('無權限');
  if (b.id) {
    await dbUpdate(env,'announcements',`id=eq.${encodeURIComponent(b.id)}&tenant_id=eq.${TENANT}`,{title:b.title,content:b.content||'',url:b.url||'',url_text:b.urlText||''});
    return jsonOk({success:true});
  }
  const id=genId('ANN');
  await dbInsert(env,'announcements',{id,tenant_id:TENANT,title:b.title,content:b.content||'',url:b.url||'',url_text:b.urlText||'',created_at:nowIso()});
  return jsonOk({success:true,id});
}
// deleteAnnouncement
async function hDeleteAnnouncement(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyPlatformSuperAdmin(env,b.email,b.token,TENANT)) return jsonErr('刪除公告僅限平台超級管理員');
  await dbDelete(env,'announcements',`id=eq.${encodeURIComponent(b.id)}&tenant_id=eq.${TENANT}`);
  return jsonOk({success:true});
}

// saveFinanceItem
async function hSaveFinanceItem(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'finance')) return jsonErr('無權限');
  const id=String(b.id||genId('FIN'));
  const sessionId=String(b.sessionId||'').trim();
  if(!sessionId) return jsonErr('缺少場次');
  const ses=await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sessionId)}&select=id`);
  if(!ses.length) return jsonErr('找不到場次');
  const locked=await dbGet(env,'operation_settlements',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&locked_at=not.is.null&select=id`).catch(()=>[]);if(locked.length)return jsonErr('本場已正式結算，不能修改支出');
  const data={tenant_id:TENANT,session_id:sessionId,type:String(b.type||b.category||'其他支出'),name:String(b.name||b.type||'支出'),amount:Math.max(0,Number(b.amount)||0),is_auto:false};
  if(!(data.amount>0))return jsonErr('支出金額必須大於 0');
  const old=await dbGet(env,'finance_items',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}&select=id`).catch(()=>[]);
  if(old.length)await dbUpdate(env,'finance_items',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}`,data);else await dbInsert(env,'finance_items',{id,...data,created_at:nowIso()});
  return jsonOk({success:true,id});
}
// deleteFinanceItem
async function hDeleteFinanceItem(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'finance')) return jsonErr('無權限');
  const rows=await dbGet(env,'finance_items',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.id)}&select=session_id,is_auto`);if(!rows.length)return jsonErr('找不到支出');if(rows[0].is_auto)return jsonErr('系統自動支出不可刪除');
  const locked=await dbGet(env,'operation_settlements',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(rows[0].session_id)}&locked_at=not.is.null&select=id`).catch(()=>[]);if(locked.length)return jsonErr('本場已正式結算，不能刪除支出');
  await dbDelete(env,'finance_items',`id=eq.${encodeURIComponent(b.id)}&tenant_id=eq.${TENANT}`);
  return jsonOk({success:true});
}
// updateInvoiceStatus
async function hUpdateInvoiceStatus(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token, TENANT)) return jsonErr('無權限');
  await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`,{invoice_status:b.status});
  return jsonOk({success:true});
}

// setFastPass
async function hSetFastPass(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'checkin')) return jsonErr('無權限');
  // email 大小寫不一致會造成「設定成功但報名時查不到」的靜默失效，故一律不分大小寫比對
  const em = String(b.targetEmail||'').trim();
  if (!em) return jsonErr('缺少會員 Email');
  const rows = await dbGet(env,'members',`tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(em)}&select=email`);
  if (!rows.length) return jsonErr('找不到會員');
  await dbUpdate(env,'members',`email=ilike.${encodeURIComponent(em)}&tenant_id=eq.${TENANT}`,{fast_pass:b.enable?true:false});
  return jsonOk({success:true, enabled:!!b.enable});
}
// saveSiteConfig
async function hSaveSiteConfig(env, b) {
  const TENANT = (b && b._tenantId) ;
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  const existing = await dbGet(env,'tenants',`id=eq.${TENANT}&select=config_json`);
  const oldCfg = existing.length ? safeJson(existing[0].config_json, {}) : {};
  const config = {...oldCfg};
  if ('heroImg' in b) config.heroImg = b.heroImg || '';
  if ('infoText' in b) config.infoText = b.infoText || '';
  if ('logoUrl' in b) config.logoUrl = b.logoUrl || '';
  await dbUpdate(env,'tenants',`id=eq.${TENANT}`,{config_json:JSON.stringify(config)});
  return jsonOk({success:true});
}

// ── 本場收款設定：資料庫為唯一來源 ─────────────────────────────
function _paymentMethodsAllowed(v){
  const x = (v && typeof v === 'object') ? v : safeJson(v, {});
  return {bank:x.bank!==false, linepay:!!x.linepay, card:!!x.card};
}
function _paymentProfilePublic(r){
  if(!r) return null;
  const allowed=_paymentMethodsAllowed(r.allowed_methods);
  return {
    id:r.id||'', name:r.name||'', mode:r.mode||'tuibile_self', ownerName:r.owner_name||'',
    isDefault:r.is_default===true, isEnabled:r.is_enabled!==false,
    allowedMethods:allowed,
    bankAccount:{bankName:r.bank_name||'', branchName:r.bank_branch||'', accountName:r.account_name||'', accountNumber:r.bank_account||''},
    linepay:{displayName:r.linepay_display_name||'', url:r.linepay_url||''},
    card:{displayName:r.card_display_name||'', url:r.card_url||''},
    note:r.note||'', updatedAt:r.updated_at||'', createdAt:r.created_at||''
  };
}
function _paymentProfileRowFromBody(b,TENANT,id){
  const allowed=_paymentMethodsAllowed(b.allowedMethods||b.allowed_methods||{});
  return {
    id, tenant_id:TENANT,
    name:String(b.name||'').trim() || '未命名收款設定',
    mode:String(b.mode||'tuibile_self').trim() || 'tuibile_self',
    owner_name:String(b.ownerName||b.owner_name||'').trim(),
    allowed_methods:allowed,
    bank_name:String(b.bankName||b.bank_name||'').trim(),
    bank_branch:String(b.bankBranch||b.bank_branch||'').trim(),
    account_name:String(b.accountName||b.account_name||'').trim(),
    bank_account:String(b.bankAccount||b.bank_account||'').trim(),
    linepay_display_name:String(b.linepayDisplayName||b.linepay_display_name||'').trim(),
    linepay_url:String(b.linepayUrl||b.linepay_url||'').trim(),
    card_display_name:String(b.cardDisplayName||b.card_display_name||'').trim(),
    card_url:String(b.cardUrl||b.card_url||'').trim(),
    note:String(b.note||'').trim(),
    is_default:!!b.isDefault || !!b.is_default,
    is_enabled:b.isEnabled===false || b.is_enabled===false ? false : true,
    updated_at:nowIso()
  };
}
async function _seedDefaultPaymentProfileIfNeeded(env,TENANT){
  const rows=await dbGet(env,'payment_profiles',`tenant_id=eq.${TENANT}&select=*&order=is_default.desc,created_at.asc`).catch(e=>{throw e;});
  if(rows.length) return rows;
  const trows=await dbGet(env,'tenants',`id=eq.${TENANT}&select=name,payment_config_json,bank_info,line_url`).catch(()=>[]);
  const t=trows[0]||{}; const cfg=safeJson(t.payment_config_json,{});
  const id=genId('PAYPROF');
  const linePayUrl = cfg.linePayUrl || cfg.linePay || cfg.linepay || cfg.line_pay_url || '';
  const cardUrl = cfg.cardPayUrl || cfg.creditCardUrl || cfg.ecpayUrl || cfg.card || cfg.card_pay_url || '';
  const allowed={bank:true,linepay:!!linePayUrl,card:!!cardUrl};
  const payload={
    id, tenant_id:TENANT, name:'兔彼樂預設收款', mode:'tuibile_self', owner_name:t.name||'兔彼樂',
    allowed_methods:allowed,
    bank_name:cfg.bankName||cfg.bank||'', bank_branch:cfg.bankBranch||cfg.branch||'', account_name:cfg.accountName||cfg.account_name||'', bank_account:cfg.bankAccount||cfg.account||'',
    linepay_display_name:linePayUrl?'LINE Pay':'', linepay_url:linePayUrl,
    card_display_name:cardUrl?'信用卡':'', card_url:cardUrl,
    note:cfg.paymentNote||cfg.note||t.bank_info||'', is_default:true, is_enabled:true, created_at:nowIso(), updated_at:nowIso()
  };
  await dbInsert(env,'payment_profiles',payload);
  return [payload];
}
async function _getDefaultPaymentProfile(env,TENANT){
  let rows=await _seedDefaultPaymentProfileIfNeeded(env,TENANT);
  let hit=rows.find(r=>r.is_default===true && r.is_enabled!==false) || rows.find(r=>r.is_enabled!==false) || rows[0];
  return hit||null;
}
async function _resolvePaymentProfileForSession(env,TENANT,sessionRow){
  const sid = sessionRow && (sessionRow.payment_profile_id||sessionRow.paymentProfileId||'');
  if(sid){
    // 已啟用的指定收款設定：正常回傳
    const rows=await dbGet(env,'payment_profiles',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sid)}&is_enabled=eq.true&select=*`).catch(()=>[]);
    if(rows.length) return rows[0];
    // 多主辦安全：場次「有指定」收款設定卻查不到（已停用或不存在）時，
    // 絕不可靜默落回預設（兔彼樂）帳戶，以免跨主辦收錯帳。直接丟明確錯誤擋下。
    throw new Error('此場次指定的收款設定已停用或不存在，請主辦重新指定收款設定後再操作');
  }
  // 場次從未指定收款設定：沿用租戶預設
  return _getDefaultPaymentProfile(env,TENANT);
}
function _paymentSnapshotFromProfile(profile){
  const p=_paymentProfilePublic(profile);
  if(!p) return null;
  return {
    payment_profile_id:p.id,
    payment_profile_name:p.name,
    payment_owner_mode:p.mode,
    owner_name:p.ownerName,
    allowed_methods:p.allowedMethods,
    bank_account:p.bankAccount,
    linepay:p.linepay,
    card:p.card,
    snapshot_created_at:nowIso()
  };
}
function _paymentSnapshotFromReg(r){
  const snap=safeJson(r.payment_profile_snapshot, null);
  if(snap && typeof snap==='object') return snap;
  if(r.payment_profile_id || r.bank_account_snapshot){
    return {
      payment_profile_id:r.payment_profile_id||'', payment_profile_name:r.payment_profile_name||'',
      payment_owner_mode:r.payment_owner_mode||'', owner_name:r.payment_owner_name||'',
      allowed_methods:safeJson(r.payment_methods_allowed,{bank:true,linepay:false,card:false}),
      bank_account:safeJson(r.bank_account_snapshot,{}), linepay:safeJson(r.linepay_config_snapshot,{}), card:safeJson(r.card_config_snapshot,{})
    };
  }
  return null;
}
function _paymentSnapshotPublic(snap){
  const s=snap&&typeof snap==='object'?snap:{};
  const allowed=_paymentMethodsAllowed(s.allowed_methods||s.allowedMethods||{});
  const bank=s.bank_account||s.bankAccount||{};
  return {
    paymentProfileId:s.payment_profile_id||s.paymentProfileId||'', paymentProfileName:s.payment_profile_name||s.paymentProfileName||'',
    paymentOwnerMode:s.payment_owner_mode||s.paymentOwnerMode||'', paymentOwnerName:s.owner_name||s.payment_owner_name||'',
    allowedMethods:allowed,
    bankAccount:{bankName:bank.bankName||bank.bank_name||'', branchName:bank.branchName||bank.branch_name||'', accountName:bank.accountName||bank.account_name||'', accountNumber:bank.accountNumber||bank.bankAccount||bank.bank_account||''},
    linepay:s.linepay||{}, card:s.card||{},
    snapshotCreatedAt:s.snapshot_created_at||s.payment_snapshot_created_at||'', legacy:!!s.legacy
  };
}
function _paymentSnapshotDbPayload(snap){
  const pub=_paymentSnapshotPublic(snap);
  return {
    payment_profile_id:pub.paymentProfileId||null,
    payment_profile_snapshot:snap||{},
    payment_owner_mode:pub.paymentOwnerMode||'',
    payment_methods_allowed:pub.allowedMethods,
    bank_account_snapshot:pub.bankAccount,
    linepay_config_snapshot:pub.linepay||{},
    card_config_snapshot:pub.card||{},
    payment_snapshot_created_at:nowIso()
  };
}
function _isPaymentStarted(reg){
  const ps=String(reg && reg.payment_status || '').trim();
  return isPaidStatus(ps) || ['待確認','付款待確認','已回報','免費'].includes(ps);
}
async function ensurePaymentSnapshotForReg(env,TENANT,reg,sessionRow,opts={}){
  const existing=_paymentSnapshotFromReg(reg);
  if(existing){
    // 快照凍結於錄取當下。若主辦事後才開啟 LINE Pay／信用卡，舊快照仍是 false，
    // 攤友就永遠看不到新付款方式。因此：尚未開始付款的報名，
    // 「可用付款方式」與「付款連結」同步最新收款設定；
    // 「收款帳戶」一律沿用快照不動（帳戶若跟著變，會造成跨主辦收錯帳）。
    if(!_isPaymentStarted(reg)){
      try{
        const latest=await _resolvePaymentProfileForSession(env,TENANT,sessionRow||{});
        if(latest && String(latest.id||'')===String(existing.payment_profile_id||'')){
          const fresh=_paymentSnapshotFromProfile(latest);
          existing.allowed_methods = fresh.allowed_methods;
          existing.linepay        = fresh.linepay;
          existing.card           = fresh.card;
        }
      }catch(e){ console.error('refresh allowed methods skipped', e&&e.message?e.message:e); logError(env, {source:'ensurePaymentSnapshotForReg', message:'refresh allowed methods skipped', error:e&&e.message?e.message:e}); }
    }
    return existing;
  }
  const profile=await _resolvePaymentProfileForSession(env,TENANT,sessionRow||{});
  if(!profile) throw new Error('此租戶尚未設定可用收款設定');
  const snap=_paymentSnapshotFromProfile(profile);
  const canWrite = opts.forceWrite || (!_isPaymentStarted(reg));
  if(canWrite && reg && reg.id){
    await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.id)}`,_paymentSnapshotDbPayload(snap)).catch(e=>{ console.error('payment snapshot write skipped', e&&e.message?e.message:e); logError(env, {source:'ensurePaymentSnapshotForReg', message:'payment snapshot write skipped', error:e&&e.message?e.message:e}); });
  } else if (_isPaymentStarted(reg)) {
    snap.legacy = true;
  }
  return snap;
}
function _paymentMethodKey(method){
  const s=String(method||'').toLowerCase();
  if(s.includes('line')) return 'linepay';
  if(s.includes('信用')||s.includes('刷卡')||s.includes('card')||s.includes('綠界')) return 'card';
  return 'bank';
}
function _methodAllowedFromSnapshot(snap,method){
  const key=_paymentMethodKey(method);
  const allowed=_paymentMethodsAllowed((snap&&snap.allowed_methods)||{});
  return !!allowed[key];
}
async function hGetPaymentProfiles(env,p){
  const TENANT=(p&&p._tenantId);
  if(!await verifyStaff(env,p.email,p.token,TENANT,'finance')) return jsonErr('無權限');
  const rows=await _seedDefaultPaymentProfileIfNeeded(env,TENANT);
  return jsonOk(rows.map(_paymentProfilePublic));
}
async function hSavePaymentProfile(env,b){
  const TENANT=(b&&b._tenantId);
  if(!await verifyStaff(env,b.email,b.token,TENANT,'finance')) return jsonErr('無權限');
  const id=String(b.id||'').trim() || genId('PAYPROF');
  const payload=_paymentProfileRowFromBody(b,TENANT,id);
  if(payload.is_default){ await dbUpdate(env,'payment_profiles',`tenant_id=eq.${TENANT}&id=neq.${encodeURIComponent(id)}`,{is_default:false}).catch(()=>{}); }
  const old=await dbGet(env,'payment_profiles',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}&select=id`).catch(()=>[]);
  if(old.length) await dbUpdate(env,'payment_profiles',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(id)}`,payload);
  else await dbInsert(env,'payment_profiles',{...payload,created_at:nowIso()});
  await writeAuditLog(env,TENANT,b.email||'','finance_admin','payment_profile_saved','payment_profiles',id,null,payload,{});
  return jsonOk({success:true,id});
}
async function hDisablePaymentProfile(env,b){
  const TENANT=(b&&b._tenantId);
  if(!await verifyStaff(env,b.email,b.token,TENANT,'finance')) return jsonErr('無權限');
  if(!b.id) return jsonErr('請提供收款設定 ID');
  const rows=await dbGet(env,'payment_profiles',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.id)}&select=is_default`).catch(()=>[]);
  if(rows[0] && rows[0].is_default) return jsonErr('預設收款設定不可停用，請先設定其他預設');
  // 多主辦安全：停用前確認沒有場次仍指定此收款設定，避免停用後場次靜默落回預設帳戶
  const inUse=await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&payment_profile_id=eq.${encodeURIComponent(b.id)}&select=id,name`).catch(()=>[]);
  if(inUse.length){
    const names=inUse.map(s=>s.name||s.id).slice(0,5).join('、');
    return jsonErr('此收款設定仍被 '+inUse.length+' 個場次使用（'+names+(inUse.length>5?' 等':'')+'），請先將這些場次改用其他收款設定，再停用');
  }
  await dbUpdate(env,'payment_profiles',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.id)}`,{is_enabled:false,updated_at:nowIso()});
  await writeAuditLog(env,TENANT,b.email||'','finance_admin','payment_profile_disabled','payment_profiles',b.id,null,{is_enabled:false},{});
  return jsonOk({success:true});
}
async function hGetFinancePaymentGroups(env,p){
  const TENANT=(p&&p._tenantId);
  if(!await verifyStaff(env,p.email,p.token,TENANT,'finance')) return jsonErr('無權限');
  const sId=p.sessionId||p.session_id||'';
  let qs=`tenant_id=eq.${TENANT}&select=*`;
  if(sId) qs+=`&session_id=eq.${encodeURIComponent(sId)}`;
  const [regsRaw,sessionsRaw]=await Promise.all([dbGet(env,'registrations',qs).catch(()=>[]), dbGet(env,'sessions',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[])]);
  const regs=_scopeRows(p,regsRaw),sessions=_scopeSessionRows(p,sessionsRaw);
  const smap={}; sessions.forEach(s=>smap[s.id]=s);
  const itemMap=await _getRegistrationItemsForRegs(env,regs).catch(()=>({}));
  const groups={};
  for(const r of regs.filter(_isReceivableReg)){
    const ses=smap[r.session_id]||{};
    const money=_regFinanceAmounts(r,ses,itemMap[r.id]);
    const snap=_paymentSnapshotPublic(_paymentSnapshotFromReg(r) || {payment_profile_name:'既有收款設定', payment_owner_mode:'legacy', allowed_methods:{bank:true}});
    const key=(snap.paymentProfileId||'legacy')+'|'+(snap.paymentOwnerMode||'legacy');
    if(!groups[key]) groups[key]={paymentProfileId:snap.paymentProfileId, paymentProfileName:snap.paymentProfileName||'既有收款設定', ownerMode:_paymentOwnerModeLabel(snap.paymentOwnerMode), ownerName:snap.paymentOwnerName||'', count:0, receivable:0, received:0, deposit:0, transferDue:0};
    groups[key].count++;
    groups[key].receivable+=money.cashTotal;
    if(_isConfirmedPaidReg(r)) groups[key].received+=money.cashTotal;
    groups[key].deposit+=money.depositTotal;
    if((snap.paymentOwnerMode||'')==='tuibile_agency') groups[key].transferDue+=Math.max(0, money.cashTotal-money.depositTotal);
  }
  return jsonOk(Object.values(groups));
}

async function hGetPaymentSettings(env, p) {
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env,p.email,p.token,TENANT)) return jsonErr('無權限');
  const rows = await dbGet(env, 'tenants', `id=eq.${TENANT}&select=payment_config_json,line_url,bank_info`);
  if (!rows.length) return jsonErr('找不到租戶設定');
  const t = rows[0]; const cfg = safeJson(t.payment_config_json, {});
  let payMethods = Array.isArray(cfg.payMethods) ? cfg.payMethods.filter(m=>m && m.name) : [];
  if (!payMethods.length) {
    const seed = [];
    const lp = cfg.linePayText || cfg.linePay || cfg.linePayUrl || cfg.line_pay_url || '';
    const cp = cfg.creditCardText || cfg.creditCard || cfg.cardPayUrl || cfg.creditCardUrl || cfg.ecpayUrl || cfg.card || cfg.card_pay_url || '';
    if (lp) seed.push({name:'LINE Pay', url:lp});
    if (cp) seed.push({name:'信用卡／綠界', url:cp});
    payMethods = seed;
  }
  const profiles = await _seedDefaultPaymentProfileIfNeeded(env,TENANT).then(x=>x.map(_paymentProfilePublic)).catch(()=>[]);
  return jsonOk({paymentNote: cfg.paymentNote || cfg.note || '', bankName: cfg.bankName || cfg.bank || '', bankBranch: cfg.bankBranch || cfg.branch || '', accountName: cfg.accountName || cfg.account_name || '', bankAccount: cfg.bankAccount || cfg.account || '', payMethods, lineUrl: t.line_url || '', bankInfo: t.bank_info || '', paymentProfiles:profiles});
}
async function hSavePaymentSettings(env, b) {
  const TENANT = (b && b._tenantId);
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  const payMethods = Array.isArray(b.payMethods) ? b.payMethods.map(m=>({name:String((m&&m.name)||'').trim(), url:String((m&&m.url)||'').trim()})).filter(m=>m.name) : [];
  const payment = {paymentNote:b.paymentNote||'', bankName:b.bankName||'', bankBranch:b.bankBranch||'', accountName:b.accountName||'', bankAccount:b.bankAccount||'', payMethods, updatedAt:nowIso()};
  const bankInfo = [payment.paymentNote, payment.bankName, payment.bankBranch, payment.accountName, payment.bankAccount].filter(Boolean).join('\n');
  await dbUpdate(env,'tenants',`id=eq.${TENANT}`,{payment_config_json:payment, bank_info:bankInfo});
  // 同步更新預設收款設定檔，確保前台付款資訊從資料庫收款設定出來。
  try {
    const rows=await _seedDefaultPaymentProfileIfNeeded(env,TENANT);
    const def=rows.find(x=>x.is_default)||rows[0];
    if(def){
      await dbUpdate(env,'payment_profiles',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(def.id)}`,{
        bank_name:payment.bankName, bank_branch:payment.bankBranch, account_name:payment.accountName, bank_account:payment.bankAccount,
        note:payment.paymentNote, allowed_methods:{bank:true,linepay:payMethods.some(m=>/line/i.test(m.name)),card:payMethods.some(m=>/信用|刷卡|card|綠界/i.test(m.name))},
        linepay_url:(payMethods.find(m=>/line/i.test(m.name))||{}).url||'', card_url:(payMethods.find(m=>/信用|刷卡|card|綠界/i.test(m.name))||{}).url||'', updated_at:nowIso()
      });
    }
  } catch(e) { console.error('sync default payment profile skipped', e&&e.message?e.message:e); logError(env, {source:'hSavePaymentSettings', message:'sync default payment profile skipped', error:e&&e.message?e.message:e}); }
  return jsonOk({success:true});
}
async function hGetCompanySettings(env, p) {
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env,p.email,p.token,TENANT)) return jsonErr('無權限');
  const rows = await dbGet(env, 'tenants', `id=eq.${TENANT}&select=id,name,slug,config_json,email_from,email_reply_to,footer_text,site_url,line_url`);
  if (!rows.length) return jsonErr('找不到租戶設定');
  const t=rows[0], cfg=safeJson(t.config_json, {}), c=cfg.company||{};
  return jsonOk({systemName:c.systemName||'2BL 報名管理系統', companyName:c.companyName||t.name||'', serviceEmail:c.serviceEmail||t.email_reply_to||'', serviceLine:c.serviceLine||t.line_url||'', phone:c.phone||'', website:c.website||t.site_url||'', loginText:c.loginText||'', serviceInfo:c.serviceInfo||'', logoUrl:'https://raw.githubusercontent.com/ndiangrace-create/2bL/main/logo.jpg'});
}
async function hSaveCompanySettings(env, b) {
  const TENANT = (b && b._tenantId);
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  const rows = await dbGet(env,'tenants',`id=eq.${TENANT}&select=config_json`);
  if (!rows.length) return jsonErr('找不到租戶設定');
  const cfg=safeJson(rows[0].config_json, {});
  cfg.company={systemName:b.systemName||'', companyName:b.companyName||'', serviceEmail:b.serviceEmail||'', serviceLine:b.serviceLine||'', phone:b.phone||'', website:b.website||'', loginText:b.loginText||'', serviceInfo:b.serviceInfo||''};
  const data={config_json:JSON.stringify(cfg)};
  if (b.companyName!==undefined) data.name=b.companyName||'';
  if (b.website!==undefined) data.site_url=b.website||'';
  if (b.serviceEmail!==undefined) data.email_reply_to=b.serviceEmail||'';
  if (b.serviceLine!==undefined) data.line_url=b.serviceLine||'';
  await dbUpdate(env,'tenants',`id=eq.${TENANT}`,data);
  return jsonOk({success:true});
}
async function hGetEmailTemplates(env, p) {
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env,p.email,p.token,TENANT,'announce')) return jsonErr('無權限');
  const dbRows = await dbGet(env, 'email_templates', `tenant_id=eq.${TENANT}&select=*&order=template_key.asc`).catch(()=>[]);
  const map = new Map();
  for (const d of defaultEmailTemplates()) map.set(d.template_key, {...d, isDefault:true});
  for (const r of (Array.isArray(dbRows)?dbRows:[])) {
    const base = map.get(r.template_key) || {};
    map.set(r.template_key, {
      ...base,
      id:r.id,
      template_key:r.template_key,
      title:r.title||base.title||'',
      subject:r.subject||base.subject||'',
      body:r.body||r.body_html||base.body||'',
      is_active:r.is_active!==false,
      updated_at:r.updated_at||'',
      updated_by:r.updated_by||'',
      isDefault:false,
    });
  }
  return jsonOk(Array.from(map.values()).map(r=>({
    id:r.id||'', templateKey:r.template_key, template_key:r.template_key, title:r.title||'', subject:r.subject||'',
    body:r.body||'', isActive:r.is_active!==false, is_active:r.is_active!==false, isDefault:!!r.isDefault,
    group:r.group||'', updatedAt:r.updated_at||'', updatedBy:r.updated_by||''
  })));
}
async function hSaveEmailTemplate(env, b) {
  const TENANT = (b && b._tenantId);
  if (!await verifyStaff(env,b.email,b.token,TENANT,'announce')) return jsonErr('無權限');
  const key=String(b.templateKey||b.template_key||'').trim();
  if(!key) return jsonErr('缺少 templateKey');
  const existing = await dbGet(env,'email_templates',`tenant_id=eq.${TENANT}&template_key=eq.${encodeURIComponent(key)}&select=id`).catch(()=>[]);
  const bodyText = b.body || b.content || '';
  const row={
    tenant_id:TENANT,
    template_key:key,
    title:b.title||'',
    subject:b.subject||'',
    body:bodyText,           // 資料庫欄位為 body（原寫 body_html，找不到該欄位而存檔失敗）
    is_active:(b.isActive===false||b.is_active===false||b.isActive==='false'||b.is_active==='false')?false:true,
    updated_by:b.email||'',
    updated_at:nowIso()
  };
  if (existing && existing[0] && existing[0].id) row.id = existing[0].id;
  const saved=await dbUpsert(env,'email_templates',row,'tenant_id,template_key');
  await writeAuditLog(env,TENANT,b.email||'','announce','email_template_saved','email_templates',key,null,{template_key:key,is_active:row.is_active},{});
  return jsonOk({success:true, template:saved});
}
function formatMemberRow(r){ const fastPass=r.fast_pass===true||r.fast_pass==='true',ps=_memberProfileStatus(r); return {id:r.id||'', email:r.email||'', name:r.name||r.display_name||'', phone:r.phone||'', brand:r.brand_name||r.brand||'', brandName:r.brand_name||r.brand||'', fb:r.fb_url||r.facebook||r.fb||'', ig:r.ig_url||r.instagram||r.ig||'', website:r.collab_url||'', web:r.collab_url||'', collabUrl:r.collab_url||'', category:r.category||r.sell_category||r.sale_category||'', sellCategory:r.sell_category||'', intro:r.intro||r.brand_intro||r.description||'', profileComplete:ps.profileComplete,missingFields:ps.missingFields, fastPass, fast_pass:fastPass, adminNote:r.admin_note||'', admin_note:r.admin_note||'', adminNoteAt:r.admin_note_updated_at||'', createdAt:r.created_at||'', updatedAt:r.updated_at||''}; }
// 會員「管理者備註」：只有主辦看得到，前台攤商永遠拿不到
// （前台會員資料走 memberPayloadFromRow 白名單，不含 admin_note）
async function hSaveMemberNote(env, b) {
  const TENANT = b._tenantId;
  if (!await verifyStaff(env, b.email, b.token, TENANT, 'members')) return jsonErr('無權限');
  const target = normEmail(b.memberEmail || b.targetEmail || '');
  if (!target) return jsonErr('缺少會員 Email');
  const note = String(b.note || '');
  const rows = await dbGet(env, 'members', `tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(target)}&select=email`);
  if (!rows || !rows.length) return jsonErr('找不到這位會員');
  await dbUpdate(env, 'members', `tenant_id=eq.${TENANT}&email=ilike.${encodeURIComponent(target)}`, {
    admin_note: note,
    admin_note_updated_at: nowIso(),
    admin_note_updated_by: String(b.email || ''),
    updated_at: nowIso()
  });
  return jsonOk({ success: true });
}
async function hGetMembers(env, p) {
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env,p.email,p.token,TENANT,'review')) return jsonErr('無權限');
  const [membersRaw,ledger,regs]=await Promise.all([dbGet(env,'members',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),dbGet(env,'member_credit_ledger',`tenant_id=eq.${TENANT}&status=eq.${encodeURIComponent('有效')}&select=member_email,direction,amount`).catch(()=>[]),dbGet(env,'registrations',`tenant_id=eq.${TENANT}&select=email,session_id`).catch(()=>[])]);
  const scopedEmails = new Set(_scopeRows(p, regs).map(r=>normEmail(r.email)).filter(Boolean));
  const members = p._authz && p._authz.allowedSessionIds !== null ? membersRaw.filter(m=>scopedEmails.has(normEmail(m.email))) : membersRaw;
  const balances={};for(const x of ledger){const k=normEmail(x.member_email);balances[k]=(balances[k]||0)+(x.direction==='debit'?-safeNum(x.amount):safeNum(x.amount));}
  return jsonOk(members.map(r=>({...formatMemberRow(r),activityCreditBalance:Math.max(0,balances[normEmail(r.email)]||0)})));
}
async function hAdjustMemberCredit(env,b){
  const T=b._tenantId;if(!await verifyStaff(env,b.email,b.token,T,'finance'))return jsonErr('無權限');
  const result=await dbRpc(env,'adjust_member_credit_atomic',{p_tenant_id:T,p_member_email:normEmail(b.memberEmail),p_direction:String(b.direction||''),p_amount:safeNum(b.amount),p_note:String(b.note||''),p_actor_email:String(b.email||'')});return jsonOk(result||{success:true});
}
async function hVoidMemberCredit(env,b){
  const T=b._tenantId;if(!await verifyStaff(env,b.email,b.token,T,'finance'))return jsonErr('無權限');
  const result=await dbRpc(env,'void_manual_member_credit_atomic',{p_tenant_id:T,p_ledger_id:String(b.ledgerId||''),p_note:String(b.note||''),p_actor_email:String(b.email||'')});return jsonOk(result||{success:true});
}
async function hSaveMemberCategory(env,b){
  const T=b._tenantId;if(!await verifyStaff(env,b.email,b.token,T,'members'))return jsonErr('無權限');const target=normEmail(b.memberEmail);if(!target)return jsonErr('缺少會員 Email');
  await dbUpdate(env,'members',`tenant_id=eq.${T}&email=ilike.${encodeURIComponent(target)}`,{category:String(b.category||'').slice(0,80),updated_at:nowIso()});return jsonOk({success:true,category:String(b.category||'')});
}
async function hGetMemberHistory(env, p) {
  const TENANT = (p && p._tenantId);
  if (!await verifyStaff(env,p.email,p.token,TENANT,'review')) return jsonErr('無權限');
  const key=String(p.memberKey||p.key||p.email||p.phone||p.brand||'').trim();
  if(!key) return jsonOk([]);
  const q=encodeURIComponent('*'+key+'*');
  const [regsRaw,sessionsRaw,eventsRaw]=await Promise.all([dbGet(env,'registrations',`tenant_id=eq.${TENANT}&or=(email.ilike.${q},phone.ilike.${q},brand_name.ilike.${q},name.ilike.${q})&select=*&order=created_at.desc`), dbGet(env,'sessions',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[]), dbGet(env,'events',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[])]);
  const regs=_scopeRows(p,regsRaw),sessions=_scopeSessionRows(p,sessionsRaw),events=_scopeEventRows(p,eventsRaw);
  const smap={}; sessions.forEach(s=>smap[s.id]=s); const emap={}; events.forEach(e=>emap[e.id]=e);
  return jsonOk(regs.map(r=>_formatAdminRegistration(r, smap[r.session_id]||{}, emap[(smap[r.session_id]||{}).event_id]||{})));
}
async function hUpdateStaffScope(env, b) {
  const TENANT = (b && b._tenantId);
  if (!await verifyStaff(env,b.email,b.token,TENANT,'superadmin')) return jsonErr('無權限');
  const targetEmail=String(b.targetEmail||b.target_email||'').trim();
  if(!targetEmail) return jsonErr('缺少 targetEmail');
  const raw=String(b.scopeType||b.scope_type||'all').trim();
  const scopeType=raw==='sessions'?'session':(raw==='series'?'event':(['all','event','session'].includes(raw)?raw:'all'));
  const scopeEventId=scopeType==='event'?String(b.eventId||b.scopeEventId||b.scope_event_id||'').trim():'';
  const targetRows=await dbGet(env,'staff',`tenant_id=eq.${TENANT}&email=eq.${encodeURIComponent(targetEmail)}&select=role,normalized_role`).catch(()=>[]);
  if(!targetRows.length)return jsonErr('找不到管理者');
  if(String(targetRows[0].normalized_role||targetRows[0].role||'')==='organizer_admin'&&(scopeType!=='event'||!scopeEventId))return jsonErr('主辦管理員必須指定一個活動系列');
  if(scopeEventId){const ev=await dbGet(env,'events',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(scopeEventId)}&select=id`).catch(()=>[]);if(!ev.length)return jsonErr('指定的活動系列不存在');}
  const ids=(b.limitSessions||b.scopeSessionIds||b.scope_session_ids||[]).map(x=>String(x||'').trim()).filter(Boolean);
  const data={scope_type:scopeType, scope_event_id:scopeEventId, limit_sessions:scopeType==='session'?ids.join(','):'', updated_at:nowIso()};
  await dbUpdate(env,'staff',`tenant_id=eq.${TENANT}&email=eq.${encodeURIComponent(targetEmail)}`,data);
  await syncStaffSessionPermissions(env,TENANT,targetEmail,scopeType==='session'?ids:[]);
  return jsonOk({success:true,scopeType,scopeEventId,limitSessions:ids});
}


// getAgreementTemplates（取得所有範本，最多3款，向下相容舊資料）
async function hGetAgreementTemplate(env, p) {
  const TENANT = (p && p._tenantId);
  const rows = await dbGet(env, 'tenant_agreement_templates',
    `tenant_id=eq.${TENANT}&select=*&order=created_at.asc`);
  // 向下相容：舊資料沒有 slot_no，自動指派為 slot 1
  const slotMap = {};
  rows.forEach((r, i) => {
    const slot = (r.slot_no && r.slot_no >= 1 && r.slot_no <= 3) ? r.slot_no : (i + 1);
    if (!slotMap[slot]) slotMap[slot] = r;
  });
  const result = [1,2,3].map(slot => {
    const r = slotMap[slot] || {};
    return {
      slot_no: slot,
      label: r.label || (slot === 1 && r.title ? '預設合約' : `範本${slot}`),
      title: r.title || '',
      content: r.content || '',
      version: r.version || '',
    };
  });
  return jsonOk(result);
}

// saveAgreementTemplate（儲存指定 slot 的範本）
async function hSaveAgreementTemplate(env, b) {
  const TENANT = (b && b._tenantId);
  if (!await verifyStaff(env, b.email, b.token, TENANT, 'superadmin')) return jsonErr('無權限');
  const slot = Number(b.slot_no) || 1;
  if (slot < 1 || slot > 3) return jsonErr('slot_no 必須為 1~3');
  const now = new Date().toISOString();
  const rows = await dbGet(env, 'tenant_agreement_templates',
    `tenant_id=eq.${TENANT}&slot_no=eq.${slot}&select=id`);
  if (rows.length) {
    await dbUpdate(env, 'tenant_agreement_templates',
      `tenant_id=eq.${TENANT}&slot_no=eq.${slot}`, {
      label: b.label || `範本${slot}`,
      title: b.title || '',
      content: b.content || '',
      version: b.version || '',
      updated_at: now,
    });
  } else {
    await dbInsert(env, 'tenant_agreement_templates', {
      id: genId('AGT'),
      tenant_id: TENANT,
      slot_no: slot,
      label: b.label || `範本${slot}`,
      title: b.title || '',
      content: b.content || '',
      version: b.version || '',
      updated_at: now,
      created_at: now,
    });
  }
  return jsonOk({ ok: true });
}

// forceCancel（不可抗力宣告）
async function hForceCancel(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  if (!await verifyStaff(env,b.email,b.token,TENANT,'sessions')) return jsonErr('無權限');
  const dl = new Date(); dl.setHours(dl.getHours()+48);
  await dbUpdate(env,'sessions',`id=eq.${encodeURIComponent(b.sessionId)}&tenant_id=eq.${TENANT}`,{
    force_cancel:true, force_cancel_target_id:b.targetSessionId||null, force_cancel_deadline:dl.toISOString(),
  });
  const sesName = await getSessionName(env, b.sessionId, TENANT);
  let targetSesName='';
  if (b.targetSessionId) targetSesName=await getSessionName(env, b.targetSessionId, TENANT);
  const dlStr=`${dl.getMonth()+1}/${dl.getDate()} ${dl.getHours()}:00`;
  const regs = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(b.sessionId)}&review_status=in.(%E5%B7%B2%E9%8C%84%E5%8F%96,%E5%BE%85%E5%AF%A9%E6%A0%B8)&select=*`);
  const tcForce = await getTenantCtx(env, TENANT);
  for (const r of regs) {
    const st = await getSessionType(env, r.session_id, TENANT);
    const dn = getDisplayName(r.name,r.brand_name||'',st);
    try { await mailForceCancelChoice(env,r.email,dn,sesName,targetSesName,dlStr,tcForce); } catch {}
  }
  return jsonOk({success:true, notified:regs.length});
}

// agreeTransfer（延期）
async function hAgreeTransfer(env, b) {
  const TENANT = (b && b._tenantId) ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
  const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  // 身份驗證：前台必須傳入 email，驗證與報名 email 吻合（不可讓不相關者觸發延期）
  if (!b.email) return jsonErr('請提供 email');
  if (String(reg.email||'').toLowerCase() !== String(b.email||'').toLowerCase()) return jsonErr('無權限操作此報名');
  const now = nowIso();
  await dbUpdate(env,'registrations',`id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`,{
    transfer_status:'已延期', transfer_target_session_id:b.targetSessionId, transfer_chosen_at:now,
  });
  const newSes = await getSessionRow(env, b.targetSessionId, TENANT);
  if (!newSes) return jsonErr('找不到目標場次');
  const newRegId = genId('REG');
  const newFee = calcFee(newSes, safeJson(reg.selected_dates_json,[]), reg.stall_count);
  const newTotal = newFee+(Number(newSes.deposit)||0);
  await dbInsert(env,'registrations',{
    id:newRegId, tenant_id:TENANT,
    session_id:b.targetSessionId, event_id:cleanEventId(newSes.event_id),
    email:reg.email, name:reg.name, phone:reg.phone,
    brand_name:reg.brand_name||'', brand_intro:reg.brand_intro||'',
    sell_category:reg.sell_category||'', sell_items:reg.sell_items||'',
    sell_link:reg.sell_link||'', photo_url:reg.photo_url||'',
    equipment_json:reg.equipment_json||'{}',
    custom_fields_json:reg.custom_fields_json||'{}',
    stall_count:reg.stall_count, deposit:Number(newSes.deposit)||0,
    review_status:'已錄取',
    payment_status:isPaidStatus(reg.payment_status)?reg.payment_status:'未繳費',
    amount:newTotal, total_amount:newTotal,
    checkin_status:'未報到', clear_status:'未清場', deposit_refunded:'未退押金',
    stall_number:'', selected_dates_json:reg.selected_dates_json||'[]',
    original_session_id:reg.session_id, created_at:now,
  });
  // M-01：延期新場次名額扣減改用原子 RPC
  await dbRpc(env, 'claim_session_slot', {
    p_tenant_id: TENANT, p_session_id: b.targetSessionId, p_stall_count: (safeNum(reg.stall_count)||1)
  });
  const oldFee = Number(reg.amount||0);
  const dn = getDisplayName(reg.name, reg.brand_name||'', newSes.type||'');
  const tcTransfer = await getTenantCtx(env, TENANT);
  try {
    if (newTotal!==oldFee) await mailTransferDiffFee(env,reg.email,dn,newSes.name,newTotal,oldFee,tcTransfer);
    else await mailTransferSameFee(env,reg.email,dn,newSes.name,tcTransfer);
  } catch {}
  return jsonOk({success:true, newRegId});
}


// ── AA8-2 退款規則：由資料庫規則帶出行政費建議，退款金額由扣項自動計算 ──
function firstSessionDateValue(ses, reg) {
  const selected = safeJson(reg && reg.selected_dates_json, []);
  if (Array.isArray(selected) && selected.length) return selected[0];
  const dates = safeJson(ses && ses.dates_json, []);
  if (Array.isArray(dates) && dates.length) return dates.map(d=>d.date||d.startDate||d.day||'').filter(Boolean)[0] || '';
  return (ses && (ses.date || ses.start_date || ses.start_at)) || '';
}
function daysBeforeEvent(eventDateValue, baseIso) {
  if (!eventDateValue) return null;
  const eventDate = new Date(String(eventDateValue).slice(0,10) + 'T00:00:00+08:00');
  const baseDate = new Date(String(baseIso || nowIso()).slice(0,10) + 'T00:00:00+08:00');
  if (isNaN(eventDate.getTime()) || isNaN(baseDate.getTime())) return null;
  return Math.floor((eventDate.getTime() - baseDate.getTime()) / 86400000);
}
function normalizeRefundRules(rawRules) {
  const rulesObj = rawRules && typeof rawRules === 'object' ? rawRules : DEFAULT_REFUND_RULES;
  const list = Array.isArray(rulesObj.rules) && rulesObj.rules.length ? rulesObj.rules : DEFAULT_REFUND_RULES.rules;
  return { transferFeeDefault: safeNum(rulesObj.transferFeeDefault), rules:list };
}
function pickRefundRule(rulesObj, daysBefore) {
  const rules = normalizeRefundRules(rulesObj).rules;
  if (daysBefore === null || daysBefore === undefined) return { key:'manual', label:'無法自動判斷日期，請主辦手動確認', adminFeeType:'fixed', adminFee:0 };
  const sorted = rules.slice().sort((a,b)=>(Number(b.minDays)||-9999)-(Number(a.minDays)||-9999));
  return sorted.find(rule=>{
    const min = rule.minDays === undefined ? -9999 : Number(rule.minDays);
    const max = rule.maxDays === undefined ? 99999 : Number(rule.maxDays);
    return daysBefore >= min && daysBefore <= max;
  }) || sorted[sorted.length-1] || DEFAULT_REFUND_RULES.rules[DEFAULT_REFUND_RULES.rules.length-1];
}
function calcAdminFeeByRule(rule, paidAmount) {
  const paid = safeNum(paidAmount);
  if (!rule) return 0;
  if (rule.adminFeeType === 'percent') return Math.round(paid * (Number(rule.adminFeePercent)||0) / 100);
  return Math.min(paid, safeNum(rule.adminFee));
}
async function calcRefundSuggestion(env, TENANT, reg) {
  const [sesRows, tenantCtx, itemMap] = await Promise.all([
    dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.session_id)}&select=*`),
    getTenantCtx(env,TENANT),
    _getRegistrationItemsForRegs(env, [reg]).catch(()=>({}))
  ]);
  const ses = sesRows[0] || {};
  const sessionRules = safeJson(ses.refund_rules_json, null);
  const rulesObj = normalizeRefundRules(sessionRules || tenantCtx.defaultRefundRules || DEFAULT_REFUND_RULES);
  const money = _regFinanceAmounts(reg, ses, itemMap && itemMap[reg.id]);
  const paidAmount = safeNum(reg.paid_amount) || (isPaidStatus(reg.payment_status) ? (money.cashTotal || safeNum(reg.amount || reg.total_amount)) : 0);
  const requestDate = reg.transfer_chosen_at || nowIso();
  const eventDate = firstSessionDateValue(ses, reg);
  const daysBefore = daysBeforeEvent(eventDate, requestDate);
  const rule = pickRefundRule(rulesObj, daysBefore);
  const refundAdminFee = Math.min(paidAmount, calcAdminFeeByRule(rule, paidAmount));
  const refundTransferFee = Math.min(Math.max(0, paidAmount - refundAdminFee), safeNum(rulesObj.transferFeeDefault));
  const refundAmount = Math.max(0, paidAmount - refundAdminFee - refundTransferFee);
  return {
    paidAmount,
    eventDate: eventDate || '',
    requestDate,
    daysBefore,
    refundRuleKey: rule.key || '',
    refundRuleLabel: rule.label || '主辦手動確認',
    refundAdminFee,
    refundTransferFee,
    refundAmount,
  };
}

// getRefundSuggestion（後台開啟退費彈窗時，從 Worker 依資料庫規則帶出建議扣項）
async function hGetRefundSuggestion(env, b) {
  const TENANT=(b&&b._tenantId);
  if(!await verifyStaff(env,b.email,b.token,TENANT,'finance')) return jsonErr('無權限');
  const rows=await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if(!rows.length) return jsonErr('找不到報名');
  const group=await getBundleGroupRegs(env,TENANT,rows[0]);
  const targets=group.filter(g=>(isPaidStatus(g.payment_status)||safeNum(g.paid_amount)>0)&&!['已退費','refunded'].includes(String(g.transfer_status||'')));
  if(!targets.length) return jsonErr('此報名尚未完成付款或已完成退費');
  const details=[];
  for(const g of targets) details.push({reg:g,...await calcRefundSuggestion(env,TENANT,g)});
  const paidAmount=details.reduce((n,x)=>n+x.paidAmount,0);
  const refundAdminFee=details.reduce((n,x)=>n+x.refundAdminFee,0);
  const refundTransferFee=details.reduce((n,x)=>n+x.refundTransferFee,0);
  return jsonOk({success:true,bundleCount:group.length,paidAmount,refundAdminFee,refundTransferFee,refundAmount:Math.max(0,paidAmount-refundAdminFee-refundTransferFee),eventDate:targets.length>1?'組合共 '+targets.length+' 場（依各場日期計算）':details[0].eventDate,daysBefore:targets.length>1?null:details[0].daysBefore,refundRuleLabel:targets.length>1?'組合場次已依各場退款規則加總':details[0].refundRuleLabel,details:details.map(x=>({regId:x.reg.id,sessionId:x.reg.session_id,paidAmount:x.paidAmount,refundAdminFee:x.refundAdminFee,refundTransferFee:x.refundTransferFee,refundAmount:x.refundAmount,eventDate:x.eventDate,daysBefore:x.daysBefore,refundRuleLabel:x.refundRuleLabel}))});
}
// applyRefund（攤友申請退費）
async function hApplyRefund(env, b) {
  const TENANT=(b&&b._tenantId);
  const rows=await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if(!rows.length) return jsonErr('找不到報名');
  const reg=rows[0]; const own=regOwnerGuard(reg,b,'申請退款的'); if(own) return own;
  if(['已退費','refunded'].includes(String(reg.transfer_status||''))) return jsonErr('此報名已完成退費');
  const group=await getBundleGroupRegs(env,TENANT,reg);
  if(!group.some(g=>isPaidStatus(g.payment_status)||safeNum(g.paid_amount)>0)) return jsonErr('尚未確認付款，不能申請退款');
  for(const g of group){
    if(['已退費','refunded'].includes(String(g.transfer_status||''))) continue;
    const active=isActiveForCapacity(g);
    await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(g.id)}`,{transfer_status:'退費中',transfer_chosen_at:nowIso(),stall_number:null,seat_choice_status:'released',seat_choice_type:null,seat_hold_expires_at:null});
    if(active) await adjustSessionCurrentCount(env,TENANT,g.session_id,-(safeNum(g.stall_count)||1));
    await releaseRegistrationSeats(env,TENANT,g,'refund_requested');
    await writeAuditLog(env,TENANT,b.email||g.email,'member','refund_requested_release_capacity_and_stall','registrations',g.id,{transfer_status:g.transfer_status},{transfer_status:'退費中'},{capacity_delta:active?-(safeNum(g.stall_count)||1):0,bundle_group:group.length>1,stall_release:true});
  }
  try{const sesName=await getSessionName(env,reg.session_id,TENANT);const tc=await getTenantCtx(env,TENANT);await mailRefundRequestReceived(env,reg.email,getDisplayName(reg.name,reg.brand_name||'',await getSessionType(env,reg.session_id,TENANT)),sesName,tc);}catch(e){}
  return jsonOk({success:true,bundleCount:group.length});
}
// confirmRefund（後台確認退款）
async function hConfirmRefund(env, b) {
  const TENANT=(b&&b._tenantId);
  if(!await verifyStaff(env,b.email,b.token,TENANT,'finance')) return jsonErr('無權限');
  const rows=await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if(!rows.length) return jsonErr('找不到報名');
  const group=await getBundleGroupRegs(env,TENANT,rows[0]);
  const targets=group.filter(g=>!['已退費','refunded'].includes(String(g.transfer_status||'')) && (isCapacityInactiveTransferStatus(g.transfer_status)||isPaidStatus(g.payment_status)||safeNum(g.paid_amount)>0));
  if(!targets.length) return jsonErr('此報名已完成退費或沒有可處理資料');
  const suggestions=[]; for(const g of targets) suggestions.push({reg:g,...await calcRefundSuggestion(env,TENANT,g)});
  const paidTotal=suggestions.reduce((n,x)=>n+x.paidAmount,0);
  const adminTotal=safeNum(b.refundAdminFee??b.refund_admin_fee), transferTotal=safeNum(b.refundTransferFee??b.refund_transfer_fee);
  if(adminTotal+transferTotal>paidTotal) return jsonErr('行政費與轉帳手續費不可大於已繳金額');
  function allocate(total,key){ let used=0; return suggestions.map((x,i)=>{ if(i===suggestions.length-1)return Math.max(0,total-used); const v=paidTotal>0?Math.floor(total*x.paidAmount/paidTotal):0; used+=v; return v; }); }
  const adminAlloc=allocate(adminTotal,'admin'), transferAlloc=allocate(transferTotal,'transfer');
  let refundTotal=0;
  for(let i=0;i<suggestions.length;i++){
    const x=suggestions[i],g=x.reg,active=isActiveForCapacity(g),refundAmount=Math.max(0,x.paidAmount-adminAlloc[i]-transferAlloc[i]); refundTotal+=refundAmount;
    const ruleLabel=String(b.refundRuleLabel||b.refund_rule_label||x.refundRuleLabel||'主辦手動確認').slice(0,120);
    const upd={transfer_status:'已退費',payment_status:'已退費',refund_amount:refundAmount,refund_admin_fee:adminAlloc[i],refund_transfer_fee:transferAlloc[i],refund_rule_label:ruleLabel,refunded_at:nowIso(),refund_note:String(b.refundNote||'').slice(0,500),stall_number:null,seat_choice_status:'released',seat_choice_type:null,seat_hold_expires_at:null};
    await dbUpdate(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(g.id)}`,upd);
    if(active) await adjustSessionCurrentCount(env,TENANT,g.session_id,-(safeNum(g.stall_count)||1));
    await releaseRegistrationSeats(env,TENANT,g,'refund_confirmed');
    await writeAuditLog(env,TENANT,b.email||'','finance_admin','refund_confirmed_release_capacity_and_stall','registrations',g.id,{transfer_status:g.transfer_status},upd,{capacity_delta:active?-(safeNum(g.stall_count)||1):0,stall_release:true,bundle_group:targets.length>1});
    try{const sesName=await getSessionName(env,g.session_id,TENANT);const tc=await getTenantCtx(env,TENANT);await mailRefundConfirm(env,g.email,getDisplayName(g.name,g.brand_name||'',await getSessionType(env,g.session_id,TENANT)),sesName,tc,refundAmount);}catch(e){}
  }
  return jsonOk({success:true,bundleCount:targets.length,paidAmount:paidTotal,refundAmount:refundTotal,refundAdminFee:adminTotal,refundTransferFee:transferTotal,refundRuleLabel:targets.length>1?'組合場次整組完成退費':'退費完成'});
}
// ── SECTION 12-FM: 不可抗力取消／延期／退款模組 ─────────────────

// 1. previewForceCancelSession（GET：預覽不可抗力影響人數，不寫入資料）
async function hPreviewForceCancelSession(env, p) {
  const TENANT = (p && p._tenantId) ;
  if (!await verifyStaff(env, p.email, p.token, TENANT)) return jsonErr('無權限');
  const sesId = p.sessionId || p.session_id;
  if (!sesId) return jsonErr('請提供 sessionId');
  const sesRows = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sesId)}&select=*`);
  if (!sesRows.length) return jsonErr('找不到場次');
  const ses = sesRows[0];
  if (ses.force_cancel) return jsonErr('此場次已啟動不可抗力處理，不可重複啟動');
  const forceMode = p.forceMode || p.force_mode || '';
  if (!['transfer_or_refund','refund_only'].includes(forceMode)) return jsonErr('請選擇處理模式（transfer_or_refund 或 refund_only）');
  const regs = await dbGet(env, 'registrations',
    `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sesId)}&select=review_status,payment_status,transfer_status`);
  const tier1 = [], tier2 = [], tier3 = [];
  for (const r of regs) {
    const layer = classifyForceLayer(r);
    if (layer === 1) tier1.push(r);
    else if (layer === 2) tier2.push(r);
    else tier3.push(r);
  }
  return jsonOk({
    ok: true,
    sessionId: sesId,
    sessionName: ses.name || sesId,
    forceMode,
    eligible_count: tier1.length,    // 第一層：可選延期或退費
    notice_only_count: tier2.length, // 第二層：只通知
    skip_count: tier3.length,        // 第三層：不進入流程
    total: regs.length,
    breakdown: {
      tier1_labels: tier1.map(r=>({review_status:r.review_status,payment_status:r.payment_status})),
      tier2_labels: tier2.map(r=>({review_status:r.review_status,payment_status:r.payment_status})),
    },
  });
}

// 2. forceCancelSession（POST：正式啟動不可抗力處理）
async function hForceCancelSession(env, b) {
  const TENANT = (b && b._tenantId) ;
  if (!await verifyStaff(env, b.email, b.token, TENANT, 'sessions')) return jsonErr('無權限');
  const sesId = b.sessionId || b.session_id;
  if (!sesId) return jsonErr('請提供 sessionId');
  const reasonCode = b.reasonCode || b.reason_code || '';
  const reasonLabel = FORCE_REASON_CODES[reasonCode] || reasonCode || '不可抗力因素';
  const forceMode = b.forceMode || b.force_mode || '';
  if (!['transfer_or_refund','refund_only'].includes(forceMode)) return jsonErr('請選擇正確的處理模式');
  if (forceMode === 'transfer_or_refund' && !(b.transferTargetSessionId||b.transfer_target_session_id)) return jsonErr('提供延期場次模式必須指定目標場次 ID');
  if (forceMode === 'refund_only' && (b.transferTargetSessionId||b.transfer_target_session_id)) return jsonErr('無延期模式不可指定延期目標場次');
  const targetSesId = (forceMode === 'transfer_or_refund') ? (b.transferTargetSessionId||b.transfer_target_session_id) : null;

  const sesRows = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sesId)}&select=*`);
  if (!sesRows.length) return jsonErr('找不到場次');
  const ses = sesRows[0];
  if (ses.force_cancel) return jsonErr('此場次已啟動不可抗力處理，不可重複啟動');
  let targetSesName = '';
  if (targetSesId) {
    const tgtRows = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(targetSesId)}&select=id,name`);
    if (!tgtRows.length) return jsonErr('找不到延期目標場次');
    targetSesName = tgtRows[0].name || '';
  }

  const now = new Date();
  // 選擇期限採用主辦設定（1～168 小時），未填則用系統預設
  let _hrs = Number(b.choiceHours || b.choice_hours);
  if (!Number.isFinite(_hrs) || _hrs <= 0) _hrs = FORCE_CHOICE_HOURS;
  _hrs = Math.min(168, Math.max(1, Math.round(_hrs)));
  const deadline = new Date(now.getTime() + _hrs * 60 * 60 * 1000);
  const deadlineText = deadline.toLocaleString('zh-TW', {timeZone:'Asia/Taipei', hour12:false});
  const _note = String(b.note || '').trim();

  await dbUpdate(env, 'sessions', `id=eq.${encodeURIComponent(sesId)}&tenant_id=eq.${TENANT}`, {
    force_cancel: true,
    force_cancel_target_id: targetSesId || null,
    force_cancel_deadline: deadline.toISOString(),
    status: '關閉',
    updated_at: now.toISOString(),
  });

  const regs = await dbGet(env, 'registrations',
    `tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sesId)}&select=*`);
  const tc = await getTenantCtx(env, TENANT);
  let notified = 0, tier1cnt = 0, tier2cnt = 0, skipped = 0, refundMarked = 0;

  for (const r of regs) {
    const layer = classifyForceLayer(r);
    if (layer === 1) tier1cnt++;
    else if (layer === 2) tier2cnt++;
    else { skipped++; continue; }

    if (forceMode === 'refund_only' && layer === 1) {
      await dbUpdate(env, 'registrations', `id=eq.${encodeURIComponent(r.id)}&tenant_id=eq.${TENANT}`, {
        transfer_status: '申請退費',
        transfer_chosen_at: now.toISOString(),
      }).catch(()=>{});
      refundMarked++;
    }

    if (r.email) {
      try {
        const dn = getDisplayName(r.name, r.brand_name||'', ses.type||'');
        await mailForceCancelNotice(env, r.email, dn, ses.name||sesId, tc,
          {targetSesName, deadlineText, reasonLabel, note:_note});
        notified++;
      } catch(e) { console.error('mailForceCancelNotice failed', r.email, e&&e.message); logError(env, {source:'hForceCancelSession', message:'mailForceCancelNotice failed', error:e&&e.message}); }
    }
  }

  return jsonOk({
    success: true, sessionId: sesId, reasonCode, reasonLabel, forceMode, targetSesId,
    notified, tier1: tier1cnt, tier2: tier2cnt, skipped, refundMarked,
    forceChoiceDeadline: deadline.toISOString(), choiceHours: _hrs, deadlineText,
  });
}

// 3. agreeForceTransfer（POST：攤友同意延期 — 不可抗力專用）
async function hAgreeForceTransfer(env, b) {
  const TENANT = (b && b._tenantId) ;
  if (!b.email) return jsonErr('請提供 email');
  if (!b.regId) return jsonErr('請提供報名編號');
  const rows = await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  if (String(reg.email||'').toLowerCase() !== String(b.email||'').toLowerCase()) return jsonErr('無權限操作此報名');

  const sesRows = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.session_id)}&select=*`);
  if (!sesRows.length) return jsonErr('找不到原場次');
  const ses = sesRows[0];
  if (!ses.force_cancel) return jsonErr('此場次尚未啟動不可抗力處理');
  const targetSesId = ses.force_cancel_target_id;
  if (!targetSesId) return jsonErr('未設定延期目標場次');
  if (ses.force_cancel_deadline && new Date() > new Date(ses.force_cancel_deadline)) return jsonErr('選擇期限已過（48小時），已自動申請退費');
  if (String(reg.transfer_status||'') === '已延期') return jsonErr('此報名已完成延期');
  if (String(reg.transfer_status||'') === '申請退費') return jsonErr('此報名已申請退費，不能再選擇延期');

  const tgtRows = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(targetSesId)}&select=*`);
  if (!tgtRows.length) return jsonErr('找不到延期目標場次');
  const tgtSes = tgtRows[0];
  const claimResult = await dbRpc(env, 'claim_session_slot', {
    p_tenant_id: TENANT, p_session_id: targetSesId, p_stall_count: safeNum(reg.stall_count)||1
  });
  if (!claimResult || claimResult.ok === false) {
    return jsonErr(claimResult ? (claimResult.error || '目標場次名額不足') : '名額鎖定失敗，請稍後再試');
  }

  const nowStr = nowIso();
  const newRegId = genId('REG');
  try {
    await dbInsert(env, 'registrations', {
      id: newRegId, tenant_id: TENANT,
      session_id: targetSesId, event_id: cleanEventId(tgtSes.event_id),
      email: reg.email, name: reg.name, phone: reg.phone||'',
      brand_name: reg.brand_name||'', brand_intro: reg.brand_intro||'',
      sell_category: reg.sell_category||'', sell_items: reg.sell_items||'',
      sell_link: reg.sell_link||'', photo_url: reg.photo_url||'',
      fb_url: reg.fb_url||'', ig_url: reg.ig_url||'',
      equipment_json: reg.equipment_json||'{}', custom_fields_json: reg.custom_fields_json||'[]', participants_json: reg.participants_json||'{}',
      stall_count: reg.stall_count||1, deposit: reg.deposit||0,
      review_status: '已錄取', payment_status: reg.payment_status,
      amount: reg.amount||0, total_amount: reg.total_amount||reg.amount||0,
      paid_at: reg.paid_at||null, payment_method: reg.payment_method||'', payment_last5: reg.payment_last5||'',
      addon_qty_json: reg.addon_qty_json||'{}', addon_amount: reg.addon_amount||0, selected_dates_json: reg.selected_dates_json||'[]',
      stall_number: '', checkin_status: '未報到', clear_status: '未清場', deposit_refunded: '未退押金', reminder_sent: false,
      original_session_id: reg.session_id, transferred_from_registration_id: reg.id, created_at: nowStr,
    });
  } catch(e) {
    await dbRpc(env, 'release_session_slot', { p_tenant_id:TENANT, p_session_id:targetSesId, p_stall_count:safeNum(reg.stall_count)||1 }).catch(()=>{});
    throw e;
  }
  // 費用明細（攤位費／押金／設備／加購…）也要跟著搬到新場次，
  // 否則新場次的財務統計會少一筆，對不上實際收款。
  try {
    const oldItems = await dbGet(env, 'registration_items',
      `tenant_id=eq.${TENANT}&registration_id=eq.${encodeURIComponent(reg.id)}&select=*`).catch(()=>[]);
    for (const it of (oldItems||[])) {
      const copy = Object.assign({}, it);
      copy.id = genId('ITEM');
      copy.registration_id = newRegId;
      copy.tenant_id = TENANT;
      if ('session_id' in copy) copy.session_id = targetSesId;
      if ('created_at' in copy) copy.created_at = nowStr;
      await dbInsert(env, 'registration_items', copy);
    }
  } catch(e) {
    logError(env, {source:'hAgreeForceTransfer', tenant_id:TENANT,
      message:'延期時費用明細搬移失敗，請人工確認新場次財務',
      error:`原報名 ${reg.id} → 新報名 ${newRegId}｜${e&&e.message?e.message:e}`});
  }
  await dbUpdate(env, 'registrations', `id=eq.${encodeURIComponent(reg.id)}&tenant_id=eq.${TENANT}`, {
    transfer_status: '已延期', transfer_target_session_id: targetSesId, transfer_chosen_at: nowStr,
  });
  try {
    const tc = await getTenantCtx(env, TENANT);
    const dn = getDisplayName(reg.name, reg.brand_name||'', ses.type||'');
    await mailForceTransferDone(env, reg.email, dn, ses.name||reg.session_id, tgtSes.name||targetSesId, safeNum(reg.amount), tc);
  } catch(e) { console.error('mailForceTransferDone failed', e&&e.message); logError(env, {source:'hAgreeForceTransfer', message:'mailForceTransferDone failed', error:e&&e.message}); }
  return jsonOk({ success:true, newRegId, transferredTo:targetSesId });
}

// 4. applyForceRefundFM（POST：攤友選擇申請退費 — 不可抗力專用）
async function hApplyForceRefundFM(env, b) {
  const TENANT = (b && b._tenantId) ;
  if (!b.email) return jsonErr('請提供 email');
  if (!b.regId) return jsonErr('請提供報名編號');
  const rows = await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  if (String(reg.email||'').toLowerCase() !== String(b.email||'').toLowerCase()) return jsonErr('無權限操作此報名');
  const sesRows = await dbGet(env, 'sessions', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(reg.session_id)}&select=id,name,type,force_cancel,force_cancel_deadline`);
  const ses = sesRows[0]||{};
  if (!ses.force_cancel) return jsonErr('此場次尚未啟動不可抗力處理');
  if (ses.force_cancel_deadline && new Date() > new Date(ses.force_cancel_deadline)) return jsonErr('選擇期限已過');
  if (String(reg.transfer_status||'') === '已延期') return jsonErr('此報名已完成延期，不能再申請退費');
  if (String(reg.transfer_status||'') === '申請退費') return jsonErr('此報名已申請退費');
  const now = nowIso();
  await dbUpdate(env, 'registrations', `id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`, { transfer_status: '申請退費', transfer_chosen_at: now });
  return jsonOk({ success:true, forceStatus:'refund_requested', transferStatus:'申請退費' });
}

// 5. runForceChoiceDeadline（POST：系統排程或手動執行 48 小時逾期處理）
async function hRunForceChoiceDeadline(env, b) {
  const TENANT = (b && b._tenantId) ;
  if (b.email && b.token) { if (!await verifyStaff(env, b.email, b.token, TENANT)) return jsonErr('無權限'); }
  const now = new Date();
  let sesQs = `force_cancel=eq.true&select=id,tenant_id,name,type,force_cancel_deadline`;
  if (TENANT) sesQs = `tenant_id=eq.${TENANT}&` + sesQs;
  const sessions = await dbGet(env, 'sessions', sesQs).catch(()=>[]);
  let processed = 0;
  for (const ses of sessions) {
    if (!ses.force_cancel_deadline) continue;
    if (now < new Date(ses.force_cancel_deadline)) continue;
    const regs = await dbGet(env, 'registrations', `tenant_id=eq.${ses.tenant_id}&session_id=eq.${encodeURIComponent(ses.id)}&review_status=eq.%E5%B7%B2%E9%8C%84%E5%8F%96&select=*`).catch(()=>[]);
    for (const r of regs) {
      if (String(r.transfer_status||'')) continue;
      const nowStr = now.toISOString();
      await dbUpdate(env, 'registrations', `id=eq.${encodeURIComponent(r.id)}&tenant_id=eq.${r.tenant_id}`, { transfer_status: '申請退費', transfer_chosen_at: nowStr });
      try { const tc = await getTenantCtx(env, r.tenant_id); const dn = getDisplayName(r.name, r.brand_name||'', ses.type||''); await mailForceCancelNotice(env, r.email, dn, ses.name||r.session_id, tc); } catch(e) {}
      processed++;
    }
  }
  return jsonOk({ success:true, processed });
}

// 6. confirmForceRefund（POST：後台確認不可抗力退款完成）
async function hConfirmForceRefund(env, b) {
  const TENANT = (b && b._tenantId) ;
  if (!await verifyStaff(env, b.email, b.token, TENANT, 'finance')) return jsonErr('無權限');
  if (!b.regId) return jsonErr('請提供報名編號');
  const rows = await dbGet(env, 'registrations', `tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
  if (!rows.length) return jsonErr('找不到報名');
  const reg = rows[0];
  if (String(reg.transfer_status||'') !== '申請退費') return jsonErr('此報名不在可確認退款狀態，目前狀態：' + (reg.transfer_status||'空'));
  const refundAmount = safeNum(b.refundAmount ?? b.refund_amount ?? reg.amount);
  if (refundAmount < 0) return jsonErr('退費金額不可小於 0');
  const nowStr = nowIso();
  await dbUpdate(env, 'registrations', `id=eq.${encodeURIComponent(b.regId)}&tenant_id=eq.${TENANT}`, {
    transfer_status: '已退費', transfer_chosen_at: reg.transfer_chosen_at || nowStr,
    refund_amount: refundAmount, refund_note: String(b.note||b.refundNote||'').slice(0,500), refunded_at: nowStr, payment_status: '已退費',
  });
  try { const st = await dbGet(env, 'stalls', `tenant_id=eq.${TENANT}&reg_id=eq.${encodeURIComponent(b.regId)}&select=id`); for (const s of st) await dbUpdate(env, 'stalls', `id=eq.${s.id}&tenant_id=eq.${TENANT}`, {status:'空閒',reg_id:null,email:null,hold_time:null}); } catch {}
  try { const tc = await getTenantCtx(env, TENANT); const sesName = await getSessionName(env, reg.session_id, TENANT); const sesType = await getSessionType(env, reg.session_id, TENANT); const dn = getDisplayName(reg.name, reg.brand_name||'', sesType); await mailForceRefundDone(env, reg.email, dn, sesName, refundAmount, tc); } catch(e) { console.error('mailForceRefundDone failed', e&&e.message); logError(env, {source:'hConfirmForceRefund', message:'mailForceRefundDone failed', error:e&&e.message}); }
  return jsonOk({ success:true, forceStatus:'refunded', transferStatus:'已退費', refundAmount });
}

// ── SECTION 13: ECPay / LINE Pay 回調 ───────────────────────────

// ECPay 付款回調（POST form）
// LINE Pay confirm redirect（GET）

async function getStaffScopeForOperations(env,email,token,tenantId){
  const auth=await loadFreshAdminAuthorization(env,email,token,tenantId); if(!auth) return null;
  if(auth.allowedSessionIds===null) return {all:true,sessionIds:null,eventId:null};
  return {all:false,eventId:auth.scopeEventId||null,sessionIds:auth.allowedSessionIds||[]};
}
async function hGetOperationsReport(env,p){
  const TENANT=p._tenantId;
  if(!await verifyStaff(env,p.email,p.token,TENANT,'finance')) return jsonErr('無權限');
  const scope=await getStaffScopeForOperations(env,p.email,p.token,TENANT); if(!scope) return jsonErr('無權限');
  let eventId=String(p.eventId||'').trim()||null;
  if(scope.eventId){ if(eventId && eventId!==scope.eventId) return jsonErr('無權限'); eventId=scope.eventId; }

  const [sessionsRaw,events,allRegs,financeItems,refunds,shareSettings,settlements]=await Promise.all([
    dbGet(env,'sessions',`tenant_id=eq.${TENANT}&select=*`),
    dbGet(env,'events',`tenant_id=eq.${TENANT}&select=id,title,name`).catch(()=>[]),
    dbGet(env,'registrations',`tenant_id=eq.${TENANT}&select=*`),
    dbGet(env,'finance_items',`tenant_id=eq.${TENANT}&select=session_id,amount,type`).catch(()=>[]),
    dbGet(env,'refund_transactions',`tenant_id=eq.${TENANT}&status=eq.${encodeURIComponent('已退款')}&select=session_id,refund_amount`).catch(()=>[]),
    dbGet(env,'operation_share_settings',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),
    dbGet(env,'operation_settlements',`tenant_id=eq.${TENANT}&select=session_id,locked_at`).catch(()=>[]),
  ]);
  const itemMap=await _getRegistrationItemsForRegs(env,allRegs);
  const eventMap={}; for(const e of events) eventMap[String(e.id)]=e;
  const from=String(p.dateFrom||'').slice(0,10), to=String(p.dateTo||'').slice(0,10);
  let sessions=sessionsRaw.filter(s=>{
    if(eventId && String(s.event_id||'')!==eventId) return false;
    if(scope.sessionIds&&scope.sessionIds.length&&!scope.sessionIds.includes(String(s.id))) return false;
    const d=String(_sessionDateValue(s)||'').slice(0,10);
    if(from && d && d<from) return false;
    if(to && d && d>to) return false;
    return true;
  });
  const rows=sessions.map(s=>{
    const sid=String(s.id), eid=String(s.event_id||'');
    const regs=allRegs.filter(r=>String(r.session_id)===sid);
    const summary=_buildAdminSessionRow(s,regs,eventMap[eid]||{},itemMap);
    // 可分潤收入不得包含可退押金；活動金已實際扣抵時才算本場已投入收入。
    const totalIncome=Number(summary?.finance?.receivedTotal)||0;
    const depositTotal=Number(summary?.finance?.depositTotal)||0;
    const confirmedRevenue=Number(summary?.finance?.revenueTotal ?? summary?.finance?.invoiceTotal)||0;
    const refundAmount=refunds.filter(r=>String(r.session_id)===sid).reduce((n,r)=>n+(Number(r.refund_amount)||0),0);
    const expenseAmount=financeItems.filter(i=>String(i.session_id)===sid).reduce((n,i)=>n+(Number(i.amount)||0),0);
    const sessionSetting=shareSettings.find(x=>String(x.session_id||'')===sid);
    const eventSetting=shareSettings.find(x=>!x.session_id&&String(x.event_id||'')===eid);
    const setting=sessionSetting||eventSetting||null;
    const companyRatio=Number(setting?.company_ratio ?? 50);
    const partnerRatio=Number(setting?.partner_ratio ?? 50);
    // confirmedRevenue 只包含仍有效的已繳費報名，已退費報名早已排除。
    // refundAmount 僅供歷史對帳顯示，不可再從營業收入扣第二次。
    const distributableProfit=confirmedRevenue-expenseAmount;
    const companyShare=Math.floor(distributableProfit*companyRatio/100);
    const partnerShare=distributableProfit-companyShare;
    return {
      sessionId:sid,
      sessionName:s.name||sid,
      eventId:eid||null,
      eventTitle:(eventMap[eid]?.title||eventMap[eid]?.name||'未歸屬'),
      totalIncome,depositTotal,confirmedRevenue,netRevenue:confirmedRevenue,refundAmount,expenseAmount,distributableProfit,
      activePaidBrands:safeNum(summary?.stats?.paid),contractedStalls:safeNum(summary?.stats?.contractedStalls),maxDailyStalls:safeNum(summary?.stats?.maxDailyStalls),stallDays:safeNum(summary?.stats?.stallDays),dailyStalls:summary?.equipment?.dailyRows||[],
      companyRatio,partnerRatio,companyShare,partnerShare,
      partnerName:setting?.partner_name||'',
      shareSource:sessionSetting?'session':(eventSetting?'event':'default_50_50'),
      settlementLocked:settlements.some(x=>String(x.session_id)===sid&&x.locked_at)
    };
  });
  const totals=rows.reduce((a,r)=>{a.totalIncome+=r.totalIncome;a.depositTotal+=r.depositTotal;a.confirmedRevenue+=r.confirmedRevenue;a.netRevenue+=r.netRevenue;a.refundAmount+=r.refundAmount;a.expenseAmount+=r.expenseAmount;a.distributableProfit+=r.distributableProfit;a.companyShare+=r.companyShare;a.partnerShare+=r.partnerShare;return a;},{totalIncome:0,depositTotal:0,confirmedRevenue:0,netRevenue:0,refundAmount:0,expenseAmount:0,distributableProfit:0,companyShare:0,partnerShare:0});
  return jsonOk({rows,totals,scoped:!scope.all});
}
async function _sessionFinanceReportData(env,TENANT,sessionId){
  const [sesRows,regs,events,items,refunds,settings,settlements]=await Promise.all([
    dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(sessionId)}&select=*`),dbGet(env,'registrations',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&select=*`),dbGet(env,'events',`tenant_id=eq.${TENANT}&select=id,title,name`).catch(()=>[]),dbGet(env,'finance_items',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&select=*`).catch(()=>[]),dbGet(env,'refund_transactions',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&status=eq.${encodeURIComponent('已退款')}&select=refund_amount`).catch(()=>[]),dbGet(env,'operation_share_settings',`tenant_id=eq.${TENANT}&select=*`).catch(()=>[]),dbGet(env,'operation_settlements',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&select=*`).catch(()=>[])
  ]);if(!sesRows.length)throw new Error('找不到場次');
  const s=sesRows[0],itemMap=await _getRegistrationItemsForRegs(env,regs),evt=events.find(x=>String(x.id)===String(s.event_id))||{},summary=_buildAdminSessionRow(s,regs,evt,itemMap),finance=summary.finance||{};
  const totalIncome=safeNum(finance.receivedTotal),depositTotal=safeNum(finance.depositTotal),confirmedRevenue=safeNum(finance.revenueTotal??finance.invoiceTotal),refundAmount=refunds.reduce((n,x)=>n+safeNum(x.refund_amount),0),netRevenue=confirmedRevenue,totalExpense=items.reduce((n,x)=>n+safeNum(x.amount),0),sessionSetting=settings.find(x=>String(x.session_id||'')===String(sessionId)),eventSetting=settings.find(x=>!x.session_id&&String(x.event_id||'')===String(s.event_id||'')),setting=sessionSetting||eventSetting||{},companyRatio=Number(setting.company_ratio??50),partnerRatio=Number(setting.partner_ratio??50),distributableProfit=netRevenue-totalExpense,companyShare=Math.floor(distributableProfit*companyRatio/100),partnerShare=distributableProfit-companyShare,settlement=settlements.find(x=>x.locked_at)||null;
  return {session:{id:s.id,name:s.name||s.id,dates:_sessionDates(s),venue:s.venue||s.region||''},totalIncome,businessRevenue:confirmedRevenue,confirmedRevenue,cashReceived:totalIncome,activityCreditApplied:safeNum(finance.activityCreditTotal),depositTotal,refundAmount,refundAlreadyReflected:true,netRevenue,totalExpense,distributableProfit,companyRatio,partnerRatio,companyShare,partnerShare,partnerName:setting.partner_name||'',activePaidBrands:safeNum(summary?.stats?.paid),contractedStalls:safeNum(summary?.stats?.contractedStalls),maxDailyStalls:safeNum(summary?.stats?.maxDailyStalls),stallDays:safeNum(summary?.stats?.stallDays),dailyStalls:summary?.equipment?.dailyRows||[],shareSource:sessionSetting?'session':eventSetting?'event':'default_50_50',settlementLocked:!!settlement,settlement:settlement?{lockedAt:settlement.locked_at,lockedBy:settlement.locked_by}:null,expenseItems:items.map(x=>({id:x.id,type:x.type,name:x.name,amount:safeNum(x.amount),isAuto:!!x.is_auto,createdAt:x.created_at})),warnings:[],generatedAt:nowIso()};
}
async function hGetSessionFinanceReport(env,p){const T=p._tenantId;if(!await verifyStaff(env,p.email,p.token,T,'finance',p.sessionId))return jsonErr('無權限');try{return jsonOk(await _sessionFinanceReportData(env,T,String(p.sessionId||'')));}catch(e){return jsonErr(e.message||String(e));}}
async function hAccountingReport(env,p){
  const T=p._tenantId;if(!await verifyStaff(env,p.email,p.token,T,'finance'))return jsonErr('無權限');
  const mode=String(p.mode||'month'),anchorText=String(p.anchor||new Date().toISOString().slice(0,10)).slice(0,10),parts=anchorText.split('-').map(Number);let start,end,label='';
  if(mode==='custom'){start=String(p.start||'');end=String(p.end||'');label=`${start}～${end}`;}else{const y=parts[0]||new Date().getUTCFullYear(),m=Math.max(0,(parts[1]||1)-1),fmt=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;if(mode==='year'){start=`${y}-01-01`;end=`${y}-12-31`;label=`${y} 年`;}else if(mode==='quarter'){const q=Math.floor(m/3)*3;start=fmt(new Date(Date.UTC(y,q,1)));end=fmt(new Date(Date.UTC(y,q+3,0)));label=`${y} 第 ${q/3+1} 季`;}else{start=fmt(new Date(Date.UTC(y,m,1)));end=fmt(new Date(Date.UTC(y,m+1,0)));label=`${y}/${String(m+1).padStart(2,'0')}`;}}
  const response=await hGetOperationsReport(env,{...p,dateFrom:start,dateTo:end}),body=await response.clone().json();if(body.ok===false)return response;const data=body.data||body,rows=data.rows||[];
  const sessions=rows.map(r=>({date:'',sessionId:r.sessionId,sessionName:r.sessionName,totalIncome:r.totalIncome,deposit:r.depositTotal,income:r.confirmedRevenue,refund:r.refundAmount,netIncome:r.confirmedRevenue,expense:r.expenseAmount,profit:r.distributableProfit,companyShare:r.companyShare,partnerShare:r.partnerShare})),totals=sessions.reduce((a,r)=>{a.totalIncome+=r.totalIncome;a.deposit+=r.deposit;a.income+=r.income;a.refund+=r.refund;a.expense+=r.expense;a.profit+=r.profit;return a;},{totalIncome:0,deposit:0,income:0,refund:0,expense:0,profit:0});totals.netIncome=totals.income;
  return jsonOk({period:{start,end,label},basis:'總收入含押金；營業收入不含押金。已退費報名已排除，退款只列歷史紀錄、不再重複扣除；盈餘再扣正式支出。',totals,counts:{sessions:sessions.length,profitable:sessions.filter(x=>x.profit>=0).length,loss:sessions.filter(x=>x.profit<0).length},sessions,expenseBreakdown:[]});
}
async function hLockFinanceSettlement(env,b){const T=b._tenantId;if(!await verifyStaff(env,b.email,b.token,T,'finance',b.sessionId))return jsonErr('無權限');const report=await _sessionFinanceReportData(env,T,String(b.sessionId||''));if(report.settlementLocked)return jsonErr('本場已結算鎖定');const ses=(await dbGet(env,'sessions',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(b.sessionId)}&select=event_id`))[0]||{};await dbInsert(env,'operation_settlements',{id:crypto.randomUUID(),tenant_id:T,event_id:ses.event_id||null,session_id:String(b.sessionId),snapshot_json:report,locked_at:nowIso(),locked_by:String(b.email||''),updated_at:nowIso()});return jsonOk({success:true});}
async function hUnlockFinanceSettlement(env,b){const T=b._tenantId;if(!await verifyPlatformSuperAdmin(env,b.email,b.token,T))return jsonErr('僅平台超級管理員可解除結算');await dbUpdate(env,'operation_settlements',`tenant_id=eq.${T}&session_id=eq.${encodeURIComponent(b.sessionId||'')}`,{locked_at:null,locked_by:null,updated_at:nowIso()});return jsonOk({success:true});}
const FINANCE_SHARE_CODE_LEN=10;
function genFinanceShareCode(){
  const arr=new Uint32Array(FINANCE_SHARE_CODE_LEN);crypto.getRandomValues(arr);let code='';
  for(let i=0;i<FINANCE_SHARE_CODE_LEN;i++)code+=SHORT_CODE_ALPHABET[arr[i]%SHORT_CODE_ALPHABET.length];
  return code;
}
function financeShareShortUrl(siteUrl,tenantId,code){
  const url=new URL('admin.html',siteUrl||FALLBACK_SITE_URL);
  url.searchParams.set('tenant',tenantId);
  url.searchParams.set('fs',code);
  return url.toString();
}
async function hCreateFinanceShare(env,b){
  const T=b._tenantId;if(!await verifyStaff(env,b.email,b.token,T,'finance',b.sessionId))return jsonErr('無權限');
  const sid=String(b.sessionId||''),ses=await dbGet(env,'sessions',`tenant_id=eq.${T}&id=eq.${encodeURIComponent(sid)}&select=id,name`);if(!ses.length)return jsonErr('找不到場次');
  const ctx=await getTenantCtx(env,T),active=await dbGet(env,'finance_share_links',`tenant_id=eq.${T}&session_id=eq.${encodeURIComponent(sid)}&is_active=eq.true&expires_at=gt.${encodeURIComponent(nowIso())}&order=expires_at.desc&limit=1&select=code,expires_at`).catch(()=>[]);
  if(active.length)return jsonOk({url:financeShareShortUrl(ctx&&ctx.siteUrl,T,active[0].code),code:active[0].code,expiresAt:active[0].expires_at,sessionName:ses[0].name||'',created:false});
  const expiresAt=new Date(Date.now()+14*24*3600*1000).toISOString();let row=null,lastError='';
  for(let i=0;i<6&&!row;i++){
    const code=genFinanceShareCode();
    try{row=await dbInsert(env,'finance_share_links',{code,tenant_id:T,session_id:sid,expires_at:expiresAt,is_active:true,created_by:String(b.email||'')});}
    catch(e){lastError=e&&e.message?e.message:String(e);if(!/duplicate|unique|23505/i.test(lastError)){logError(env,{source:'hCreateFinanceShare',message:'finance share insert failed',error:lastError,sessionId:sid,tenantId:T});break;}}
  }
  if(!row)return jsonErr('財報短網址建立失敗，請稍後再試');
  return jsonOk({url:financeShareShortUrl(ctx&&ctx.siteUrl,T,row.code),code:row.code,expiresAt:row.expires_at||expiresAt,sessionName:ses[0].name||'',created:true});
}
async function hPublicFinanceShare(env,p){
  const T=p._tenantId,code=String(p.shareCode||'').trim().toLowerCase();
  if(code){
    if(!new RegExp(`^[a-z2-9]{${FINANCE_SHARE_CODE_LEN}}$`).test(code))return jsonErr('財報分享連結不存在');
    const rows=await dbGet(env,'finance_share_links',`tenant_id=eq.${T}&code=eq.${encodeURIComponent(code)}&select=tenant_id,session_id,expires_at,is_active,access_count`).catch(()=>[]),row=rows[0];
    if(!row)return jsonErr('財報分享連結不存在');
    if(row.is_active===false)return jsonErr('財報分享連結已停用');
    if(!row.expires_at||new Date(row.expires_at).getTime()<=Date.now())return jsonErr('分享連結已過期，請向主辦取得新的連結');
    const finance=await _sessionFinanceReportData(env,T,String(row.session_id));
    await dbUpdate(env,'finance_share_links',`tenant_id=eq.${T}&code=eq.${encodeURIComponent(code)}`,{access_count:(Number(row.access_count)||0)+1,last_access_at:nowIso()}).catch(()=>{});
    return jsonOk({session:finance.session,finance,expiresAt:row.expires_at});
  }
  // 舊版完整 JWT 連結保留相容，避免先前已傳給夥伴的連結立即失效。
  const token=String(p.shareToken||'');if(!token)return jsonErr('財報分享連結不完整');
  const payload=await verifyAdminJwt(token,env);
  if(!payload||payload.iss!=='2BL-FINANCE-SHARE'||payload.type!=='finance_share'||String(payload.tenant_id)!==String(T))return jsonErr('財報分享連結無效或已過期');
  const finance=await _sessionFinanceReportData(env,T,String(payload.session_id));return jsonOk({session:finance.session,finance,expiresAt:new Date(payload.expires_at).toISOString()});
}
async function verifyPlatformOwner(env,email,token,tenantId){
  if(!await verifyPlatformSuperAdmin(env,email,token,tenantId)) return false;
  const rows=await dbGet(env,'staff',`tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&select=perms_json,active,is_active`).catch(()=>[]);
  const st=rows[0]; if(!st || st.active===false || st.is_active===false) return false;
  return safeJson(st.perms_json,{}).platform_owner===true;
}
async function hSaveOperationShareSetting(env,b){
  const TENANT=b._tenantId;
  if(!await verifyPlatformOwner(env,b.email,b.token,TENANT)) return jsonErr('僅公司平台管理員可設定分潤');
  const company=Number(b.companyRatio), partner=Number(b.partnerRatio);
  if(!Number.isFinite(company)||!Number.isFinite(partner)||Math.abs(company+partner-100)>0.000001||company<0||partner<0) return jsonErr('公司比例與夥伴比例合計必須為100%');
  const sessionId=String(b.sessionId||'').trim()||null, eventId=String(b.eventId||'').trim()||null;
  if(!sessionId&&!eventId) return jsonErr('請指定活動系列或場次');
  let existing=[];
  if(sessionId) existing=await dbGet(env,'operation_share_settings',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&select=*`);
  else existing=await dbGet(env,'operation_share_settings',`tenant_id=eq.${TENANT}&event_id=eq.${encodeURIComponent(eventId)}&session_id=is.null&select=*`);
  if(sessionId){const locked=await dbGet(env,'operation_settlements',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(sessionId)}&locked_at=not.is.null&select=id`).catch(()=>[]);if(locked.length)return jsonErr('此結算已鎖定，不能修改比例');}
  const data={tenant_id:TENANT,event_id:eventId,session_id:sessionId,partner_name:b.partnerName||null,company_ratio:company,partner_ratio:partner,updated_by:b.email,updated_at:nowIso()};
  if(existing.length) await dbUpdate(env,'operation_share_settings',`id=eq.${existing[0].id}&tenant_id=eq.${TENANT}`,data);
  else await dbInsert(env,'operation_share_settings',{...data,id:crypto.randomUUID(),created_by:b.email,created_at:nowIso()});
  return jsonOk({success:true});
}
// ── SECTION 14: Cron 定時任務 ───────────────────────────────────

// 繳費期限檢查（02:00 UTC）
async function cronCheckPayments(env) {
  const now = new Date();
  // 跨租戶：撈所有租戶的待繳費報名
  const regs = await dbGet(env,'registrations',`review_status=eq.%E5%B7%B2%E9%8C%84%E5%8F%96&payment_status=eq.%E6%9C%AA%E7%B9%B3%E8%B2%BB&select=*`);
  // 快取 tenantCtx 避免重複 DB 查詢
  const tcCache = {};
  async function getTc(tid) {
    if (!tcCache[tid]) tcCache[tid] = await getTenantCtx(env, tid);
    return tcCache[tid];
  }
  for (const r of regs) {
    const TENANT = r.tenant_id ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
    const created = new Date(r.created_at);
    if (isNaN(created)) continue;
    const hrs = (now-created)/(1000*60*60);
    if (hrs>=PAY_DEADLINE_HOURS) {
      await dbUpdate(env,'registrations',`id=eq.${r.id}&tenant_id=eq.${TENANT}`,{review_status:'已取消',admin_note:(r.admin_note||'')+' 逾期未繳費自動取消'});
      // M-01：逾期取消需釋放名額，與手動取消保持一致
      try { await adjustSessionCurrentCount(env, TENANT, r.session_id, -(safeNum(r.stall_count)||1)); } catch(e) { console.error('cronCheckPayments release slot failed', e&&e.message?e.message:e); }
      const sesName=await getSessionName(env, r.session_id, TENANT);
      const sesType=await getSessionType(env, r.session_id, TENANT);
      const dn=getDisplayName(r.name,r.brand_name||'',sesType);
      const tc=await getTc(TENANT);
      try { await mailAutoCancel(env,r.email,dn,sesName,tc); } catch {}
    } else if (hrs>=REMINDER_HOURS && !r.reminder_sent) {
      await dbUpdate(env,'registrations',`id=eq.${r.id}&tenant_id=eq.${TENANT}`,{reminder_sent:true});
      const sesName=await getSessionName(env, r.session_id, TENANT);
      const sesType=await getSessionType(env, r.session_id, TENANT);
      const dn=getDisplayName(r.name,r.brand_name||'',sesType);
      const sr=await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(r.session_id)}&select=basic_equip`);
      const be=sr.length?sr[0].basic_equip||'':'';
      const tc=await getTc(TENANT);
      try { await mailDeadlineReminder(env,r.email,dn,sesName,r.id,Number(r.amount||0),safeJson(r.selected_dates_json,[]),r.equipment_json,be,tc); } catch {}
    }
  }
}

// 釋出逾期預留攤位（02:00 UTC）
async function cronReleaseStalls(env) {
  const nowMs = Date.now();
  // 跨租戶：以 seat_hold_expires_at 為正式期限；舊資料沒有期限時才用 hold_time 相容判斷。
  const stalls = await dbGet(env,'stalls',`status=eq.%E9%A0%90%E7%95%99&select=*`);
  const releasedRegs = new Set();
  for (const s of (stalls||[])) {
    const expMs = s.seat_hold_expires_at ? Date.parse(s.seat_hold_expires_at) : NaN;
    const oldMs = s.hold_time ? Date.parse(s.hold_time) : NaN;
    const expired = Number.isFinite(expMs)
      ? expMs <= nowMs
      : (Number.isFinite(oldMs) && (nowMs-oldMs) >= STALL_HOLD_DAYS*24*60*60*1000);
    if (!expired) continue;
    const tenantId = s.tenant_id;
    const regId = String(seatRegId(s)||'');
    if (regId && !releasedRegs.has(tenantId+'|'+regId)) {
      const rr = await dbGet(env,'registrations',`tenant_id=eq.${tenantId}&id=eq.${encodeURIComponent(regId)}&select=*`).catch(()=>[]);
      if (rr.length) await releasePaidSeatHold(env,tenantId,rr[0],'cron_expired');
      else await dbUpdate(env,'stalls',`id=eq.${s.id}&tenant_id=eq.${tenantId}`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null});
      releasedRegs.add(tenantId+'|'+regId);
    } else if (!regId) {
      await dbUpdate(env,'stalls',`id=eq.${s.id}&tenant_id=eq.${tenantId}`,{status:'空閒',reg_id:null,email:null,hold_time:null,seat_hold_expires_at:null});
    }
  }
}

// 行前提醒（01:00 UTC = 09:00 台灣）
async function cronPreEventReminders(env) {
  const now = new Date();
  // 跨租戶：撈所有啟用場次
  const sessions = await dbGet(env,'sessions',`status=eq.%E5%A0%B1%E5%90%8D%E4%B8%AD&select=*`);
  const tcCache = {};
  async function getTc(tid) {
    if (!tcCache[tid]) tcCache[tid] = await getTenantCtx(env, tid);
    return tcCache[tid];
  }
  for (const s of sessions) {
    const TENANT = s.tenant_id ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
    const dates = safeJson(s.dates_json,[]);
    if (!dates.length) continue;
    const first = new Date(dates[0].date);
    const diff = Math.ceil((first-now)/(1000*60*60*24));
    // 活動前 N 天（每場可設，預設 7；不小於 3 以確保排在行前通知之前）批次自動排位，每場只排一次
    const assignDay = Math.max(3, Number(s.seat_assign_days_before)||7);
    if (diff<=assignDay && diff>=0 && !s.seat_assign_done_at) {
      try {
        await batchAssignSeatsForSession(env, TENANT, s);
        await dbUpdate(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(s.id)}`,{seat_assign_done_at:nowIso()});
        s.seat_assign_done_at = nowIso();
      } catch(e){ console.error('batch assign failed', e&&e.message?e.message:e); logError(env,{source:'cronPreEventReminders',message:'batch assign failed',error:e&&e.message?e.message:e}); }
    }
    if (diff!==3) continue;
    // 保險：行前通知寄出前，若尚未批次排位，即時補排一次，確保信裡一定有號碼
    if (!s.seat_assign_done_at) {
      try { await batchAssignSeatsForSession(env, TENANT, s); await dbUpdate(env,'sessions',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(s.id)}`,{seat_assign_done_at:nowIso()}); s.seat_assign_done_at=nowIso(); } catch(e){ logError(env,{source:'cronPreEventReminders',message:'pre-mail batch assign failed',error:e&&e.message?e.message:e}); }
    }
    const regs = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(s.id)}&review_status=eq.%E5%B7%B2%E9%8C%84%E5%8F%96&select=*`);
    const tc = await getTc(TENANT);
    for (const r of regs) {
      if (!isPaidStatus(r.payment_status)) continue;
      const dn=getDisplayName(r.name,r.brand_name||'',s.type||'');
      try { await mailPreEventReminder(env,r.email,dn,s.name,dates[0].date,s.venue||'',tc,r.id,equipSummaryFromJson(r.equipment_json),r.stall_number||'',s.seat_map_url||''); } catch {}
    }
  }
}

// 不可抗力逾期自動退費（02:00 UTC）
async function cronForceCancelExpiry(env) {
  const now = new Date();
  // 跨租戶
  const sessions = await dbGet(env,'sessions',`force_cancel=eq.true&select=*`);
  for (const s of sessions) {
    const TENANT = s.tenant_id ;  // M-02：tenant 已由路由層驗證（見 routeGet/routePost）
    if (!s.force_cancel_deadline) continue;
    if (now<new Date(s.force_cancel_deadline)) continue;
    // 找出未做選擇的報名（transfer_status 為空或 null）
    const regs = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&session_id=eq.${encodeURIComponent(s.id)}&review_status=in.(%E5%B7%B2%E9%8C%84%E5%8F%96,%E5%BE%85%E5%AF%A9%E6%A0%B8)&select=*`);
    const unprocessed = regs.filter(r=>!r.transfer_status||r.transfer_status==='');
    const tcFc = await getTenantCtx(env, TENANT);
    for (const r of unprocessed) {
      await dbUpdate(env,'registrations',`id=eq.${r.id}&tenant_id=eq.${TENANT}`,{transfer_status:'申請退費',transfer_chosen_at:nowIso()});
      const st=await getSessionType(env, r.session_id, TENANT);
      const dn=getDisplayName(r.name,r.brand_name||'',st);
      try { await mailAutoRefund(env,r.email,dn,s.name,tcFc); } catch {}
    }
  }
}

// ── SECTION 15: 路由 ────────────────────────────────────────────

async function routeGet(env, action, p, req) {
  // 不需要 tenant 的路由
  if (action==='adminMe') return await hAdminMe(env, p);
  if (action==='applyList') return await hApplyList(env, p);
  if (action==='getTenantsAdmin') return await hGetTenantsAdmin(env, p);

  // M-02：解析租戶，缺少 tenant 一律回傳 400
  const TENANT = getTenantId(p);
  if (!TENANT) {
    return new Response(JSON.stringify({ok:false, error:'缺少 tenant 參數'}), {status:400, headers:corsHeaders()});
  }
  p._tenantId = TENANT;  // 注入供 handler 使用
  // 連線測試 / 診斷
  if (action==='ping') {
    let supabaseOk=false, staffCount=0, sessionCount=0, errMsg='';
    try {
      const rows = await dbGet(env,'staff',`tenant_id=eq.${TENANT}&select=email,role`);
      supabaseOk=true; staffCount=rows.length;
    } catch(e) { errMsg=e.message; }
    try {
      const rows = await dbGet(env,'sessions',`tenant_id=eq.${TENANT}&select=id`);
      sessionCount=rows.length;
    } catch(e) {}
    return jsonOk({
      ok:true, tenant:TENANT,
      supabase: supabaseOk ? '✅ 正常' : '❌ 失敗：'+errMsg,
      staffCount, sessionCount,
      env_supabase_url: env.SUPABASE_URL ? '✅ 已設定' : '❌ 未設定',
      env_supabase_key: env.SUPABASE_KEY ? '✅ 已設定' : '❌ 未設定',
      env_resend_key: env.RESEND_KEY ? '✅ 已設定' : '❌ 未設定',
    });
  }
  if (action==='ecpayReturn') {
    return new Response('0|付款 API 尚未啟用',{status:200});
  }
  if (action==='linePayConfirm') return Response.redirect(FALLBACK_SITE_URL+'?pay_result=disabled',302);
  if (action==='linePayCancel') return Response.redirect(FALLBACK_SITE_URL+'?linepay_cancel=1',302);

  const getAuthz = await authorizeAdminAction(env, action, p);
  if (getAuthz && getAuthz.error) return jsonErr(getAuthz.error, 403);

  switch(action) {
    case 'frontBootstrap':      return hFrontBootstrap(env,p);
    case 'getEvents':           return hGetEvents(env,p);
    case 'getSessions':         return hGetSessions(env,p);
    case 'getBundlesPublic':    return hGetBundlesPublic(env,p);
    case 'getBundles':          return hGetBundles(env,p);
    case 'getSession':          return hGetSession(env,p);
    case 'getSessionAgreement': return hGetSessionAgreement(env,p);
    case 'getMember':           return hGetMember(env,p);
    case 'getMyRegs':           return hGetMyRegs(env,p);
    case 'getRegLookup':        return hGetRegLookup(env,p);
    case 'getAnnouncements':    return hGetAnnouncements(env,p);
    case 'getSeatMap':          return hGetSeatMap(env,p);
    case 'getSessionShortLink': return hGetSessionShortLink(env,p);
    case 'getErrorLogs':        return hGetErrorLogs(env,p);
    case 'adminLogin':          return hAdminLogin(env,p);
    case 'applyTrial':          return hApplyTrial(env,p);
    case 'approveApply':        return hApproveApply(env,p);
    case 'lockTenant':          return hLockTenant(env,p);
    case 'unlockTenant':        return hUnlockTenant(env,p);
    case 'adminLogout':         return hAdminLogout(env,p);
    case 'adminMe':             return hAdminMe(env,p);
    case 'getDashboard':        return hGetDashboard(env,p);
    case 'adminBusinessOverview': return hAdminBusinessOverview(env,p);
    case 'financeOverview':      return hFinanceOverview(env,p);
    case 'getOperationsReport':   return hGetOperationsReport(env,p);
    case 'adminFinanceAnomalies': return hAdminFinanceAnomalies(env,p);
    case 'getSessionDashboard': return hGetSessionDashboard(env,p);
    case 'getTodos': return hGetTodos(env,p);
    case 'getAdminSessionsDashboard': return hGetSessionDashboard(env,p);
    case 'getAdminSessionDashboard': return hGetSessionDashboard(env,p);
    case 'getSessionRegistrations': return hGetSessionRegistrations(env,p);
    case 'getSessionEquipmentDetails': return hGetSessionEquipmentDetails(env,p);
    case 'getPaymentSettings': return hGetPaymentSettings(env,p);
    case 'getPaymentProfiles': return hGetPaymentProfiles(env,p);
    case 'getFinancePaymentGroups': return hGetFinancePaymentGroups(env,p);
    case 'getEmailTemplates': return hGetEmailTemplates(env,p);
    case 'getMembers': return hGetMembers(env,p);
    case 'getMemberHistory': return hGetMemberHistory(env,p);
    case 'getCompanySettings': return hGetCompanySettings(env,p);
    case 'downloadSession':     return hDownloadSession(env,p);
    case 'getRegs':             return hGetRegs(env,p);
    case 'getRegsBySession':    return hGetRegsBySession(env,p);
    case 'onsiteSessions':      return hOnsiteSessions(env,p);
    case 'onsiteRegs':          return hOnsiteRegs(env,p);
    case 'onsiteDaySummary':    return hOnsiteDaySummary(env,p);
    case 'opsDashboard':        return hOpsDashboard(env,p);
    case 'onsitePasscodeVerify': return hOnsitePasscodeVerify(env,p);
    case 'onsitePasscodeList':   return hOnsitePasscodeList(env,p);
    case 'getStaff':            return hGetStaff(env,p);
    case 'getEventsAdmin':      return hGetEventsAdmin(env,p);
    case 'getSessionsAdmin':    return hGetSessionsAdmin(env,p);
    case 'getSessionVisualAssets': return hGetSessionVisualAssets(env,p);
    case 'getSessionVisualJobs': return hGetSessionVisualJobs(env,p);
    case 'getPayments':         return hGetPayments(env,p);
    case 'getFinance':          return hGetFinance(env,p);
    case 'getSessionFinanceReport': return hGetSessionFinanceReport(env,p);
    case 'accountingReport':    return hAccountingReport(env,p);
    case 'publicFinanceShare':  return hPublicFinanceShare(env,p);
    case 'adminManualSession':  return hAdminManualSession(env,p);
    case 'memberNotifications': return hMemberNotifications(env,p);
    case 'getInvoiceList':      return hGetInvoiceList(env,p);
    case 'getSiteConfig':       return hGetSiteConfig(env,p);
    case 'getAgreementTemplate': return hGetAgreementTemplate(env,p);
    case 'getAgreementTemplates': return hGetAgreementTemplate(env,p);
    case 'getForceRefundList':  return hGetForceRefundList(env,p);
    case 'previewForceCancelSession': return hPreviewForceCancelSession(env,p);
    default: return jsonErr('unknown GET action: '+action);
  }
}

async function routePost(env, action, b, ctx, req) {
  // M-02：解析租戶，缺少 tenant 一律回傳 400
  const TENANT = getTenantId(b);
  if (!TENANT) {
    return new Response(JSON.stringify({ok:false, error:'缺少 tenant 參數'}), {status:400, headers:corsHeaders()});
  }
  b._tenantId = TENANT;  // 注入供 handler 使用
  // 注入來源 IP 與 User-Agent（供不可抗力同意證據寫入）
  if (req) {
    b._ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || req.headers.get('X-Real-IP') || null;
    b._userAgent = req.headers.get('User-Agent') || null;
  }
  const postAuthz = await authorizeAdminAction(env, action, b);
  if (postAuthz && postAuthz.error) return jsonErr(postAuthz.error, 403);
  if (action==='resendRegConfirm') {
    if (!await verifyStaff(env,b.email,b.token,TENANT,'review')) return jsonErr('無權限');
    const rows = await dbGet(env,'registrations',`tenant_id=eq.${TENANT}&id=eq.${encodeURIComponent(b.regId)}&select=*`);
    if(!rows.length) return jsonErr('找不到報名資料');
    const reg=rows[0];
    const sesName = await getSessionName(env, reg.session_id, TENANT);
    const sesType = await getSessionType(env, reg.session_id, TENANT);
    const dn = getDisplayName(reg.name, reg.brand_name||'', sesType);
    const total = Number(reg.amount)||0;
    const stallCount = Number(reg.stall_count)||1;
    const selectedDates = safeJson(reg.selected_dates_json,[]);
    const equip = safeJson(reg.equipment_json,{});
    const tcResend = await getTenantCtx(env, TENANT);
    try { await mailRegConfirm(env,reg.email,dn,sesName,reg.id,total,stallCount,selectedDates,equip,tcResend); }
    catch(e){ return jsonErr('寄信失敗：'+e.message); }
    return jsonOk({ok:true});
  }
  if (action==='testEmail') {
    if (!await verifyStaff(env,b.email,b.token, TENANT)) return jsonErr('無權限');
    const to = b.to;
    if(!to) return jsonErr('缺少收件地址');
    const tcTest = await getTenantCtx(env, TENANT);
    const result = await sendEmail(env, to, `【${tcTest.name}】信件系統測試`, emailWrap(`
<p>✅ 這是一封測試信件。</p>
<p>如果您收到這封信，代表 <strong>${tcTest.name}</strong> 的信件系統設定正確！</p>
<p style="color:#888;font-size:12px">測試時間：${nowIso()}</p>
`, tcTest), tcTest);
    if(result.ok) return jsonOk({ok:true});
    return jsonErr('寄信失敗：'+(result.error||'未知錯誤'));
  }
  switch(action) {
    case 'register':            return hRegister(env,b,ctx);
    case 'registerBundle':      return hRegisterBundle(env,b,ctx);
    case 'saveBundle':          return hSaveBundle(env,b);
    case 'createShortLink':     return hCreateShortLink(env,b);
    case 'purgeErrorLogs':      return hPurgeErrorLogs(env,b);
    case 'deleteBundle':        return hDeleteBundle(env,b);
    case 'saveMember':          return hSaveMember(env,b);
    case 'saveMemberNote':      return hSaveMemberNote(env,b);
    case 'saveMemberCategory':  return hSaveMemberCategory(env,b);
    case 'adjustMemberCredit':  return hAdjustMemberCredit(env,b);
    case 'voidMemberCredit':    return hVoidMemberCredit(env,b);
    case 'cancelReg':           return hCancelReg(env,b);
    case 'selectStall':         return hSelectStall(env,b);
    case 'claimPaidSeat':       return hClaimPaidSeat(env,b);
    case 'saveSeatMap':         return hSaveSeatMap(env,b);
    case 'adminSeatBoard':      return hAdminSeatBoard(env,b);
    case 'syncSeatRoster':      return hSyncSeatRoster(env,b);
    case 'saveSeatMarkerPosition': return hSaveSeatMarkerPosition(env,b);
    case 'saveSeatMarkerPositions': return hSaveSeatMarkerPositions(env,b);
    case 'saveSeatBoardConfig': return hSaveSeatBoardConfig(env,b);
    case 'saveSeatCustomMarker': return hSaveSeatCustomMarker(env,b);
    case 'deleteSeatCustomMarker': return hDeleteSeatCustomMarker(env,b);
    case 'publishSeatLayout':   return hPublishSeatLayout(env,b);
    case 'adminAssignSeat':     return hAdminAssignSeat(env,b);
    case 'runBatchAssign':      return hRunBatchAssign(env,b);
    case 'saveSeatMapImage':    return hSaveSeatMapImage(env,b);
    case 'undoPaymentReport':   return hUndoPaymentReport(env,b);
    case 'submitPayment':       return hSubmitPayment(env,b);
    case 'submitPaymentBatch':  return hSubmitPaymentBatch(env,b);
    case 'createLinePayOrder':  return hCreateLinePayOrder(env,b);
    case 'createEcpayOrder':    return hCreateEcpayOrder(env,b);
    case 'createEvent':         return hCreateEvent(env,b);
    case 'updateEvent':         return hUpdateEvent(env,b);
    case 'deleteEvent':         return hDeleteEvent(env,b);
    case 'createSession':       return hCreateSession(env,b);
    case 'updateSession':       return hUpdateSession(env,b);
    case 'uploadCover': return hUploadCover(env, b);
    case 'generateSessionVisual': return hGenerateSessionVisual(env,b);
    case 'setSessionMainVisual': return hSetSessionMainVisual(env,b);
    case 'deleteSessionVisualAsset': return hDeleteSessionVisualAsset(env,b);
    case 'deleteSession':       return hDeleteSession(env,b);
    case 'toggleSession':       return hToggleSession(env,b);
    case 'toggleSessionStatus': return hToggleSessionStatus(env,b);
    case 'copySession':         return hCopySession(env,b);
    case 'updateRegStatus':     return hUpdateRegStatus(env,b);
    case 'batchUpdateStatus':   return hBatchUpdateStatus(env,b);
    case 'approveReg':          return hApproveReg(env,b);
    case 'confirmPayment':      return hConfirmPayment(env,b);
    case 'markPaymentScreenshot': return hMarkPaymentScreenshot(env,b);
    case 'saveRegNote': return hSaveRegNote(env,b);
    case 'sendPaymentReminder': return hSendPaymentReminder(env,b);
    case 'adminCancelReg':      return hAdminCancelReg(env,b);
    case 'refundDeposit':       return hRefundDeposit(env,b);
    case 'checkin':             return hCheckin(env,b);
    case 'onsiteMark':          return hOnsiteMark(env,b);
    case 'previewRegistrationResolution': return hPreviewRegistrationResolution(env,b);
    case 'resolveRegistration': return hResolveRegistration(env,b);
    case 'partialDayRefund':    return hPartialDayRefund(env,b);
    case 'activityCreditCheckout': return hActivityCreditCheckout(env,b);
    case 'adminPreviewRegistration': return hAdminPreviewRegistration(env,b);
    case 'adminCreateRegistration': return hAdminCreateRegistration(env,b);
    case 'markMemberNotificationRead': return hMarkMemberNotificationRead(env,b);
    case 'onsitePasscodeVerify':   return hOnsitePasscodeVerify(env,b);
    case 'onsitePasscodeGenerate': return hOnsitePasscodeGenerate(env,b);
    case 'onsitePasscodeToggle':   return hOnsitePasscodeToggle(env,b);
    case 'markClear':           return hMarkClear(env,b);
    case 'sendNotify':          return hSendNotify(env,b);
    case 'resendInvite':        return hResendInvite(env,b);
    case 'addStaff':            return hAddStaff(env,b);
    case 'removeStaff':         return hRemoveStaff(env,b);
    case 'setStaffActive':      return hSetStaffActive(env,b);
    case 'updateStaffPerms':    return hUpdateStaffPerms(env,b);
    case 'updateStaffSessions': return hUpdateStaffSessions(env,b);
    case 'saveAnnouncement':    return hSaveAnnouncement(env,b);
    case 'deleteAnnouncement':  return hDeleteAnnouncement(env,b);
    case 'saveOperationShareSetting': return hSaveOperationShareSetting(env,b);
    case 'saveFinanceShare':    return hSaveOperationShareSetting(env,b);
    case 'createFinanceShare':  return hCreateFinanceShare(env,b);
    case 'lockFinanceSettlement': return hLockFinanceSettlement(env,b);
    case 'unlockFinanceSettlement': return hUnlockFinanceSettlement(env,b);
    case 'saveFinanceItem':     return hSaveFinanceItem(env,b);
    case 'deleteFinanceItem':   return hDeleteFinanceItem(env,b);
    case 'updateInvoiceStatus': return hUpdateInvoiceStatus(env,b);
    case 'checkMemberEmailPhone': return hCheckMemberEmailPhone(env,b);
    case 'listActivePhotoFrames': return hListActivePhotoFrames(env,b);
    case 'getPhotoFrameById':   return hGetPhotoFrameById(env,b);
    case 'submitPhotoLead':     return hSubmitPhotoLead(env,b);
    case 'listPhotoFrames':     return hListPhotoFrames(env,b);
    case 'savePhotoFrame':      return hSavePhotoFrame(env,b);
    case 'deletePhotoFrame':    return hDeletePhotoFrame(env,b);
    case 'listPhotoLeads':      return hListPhotoLeads(env,b);
    case 'listContactLeads':    return hListContactLeads(env,b);
    case 'listVenueMaps':       return hListVenueMaps(env,b);
    case 'saveVenueMap':        return hSaveVenueMap(env,b);
    case 'applyVenueMap':       return hApplyVenueMap(env,b);
    case 'deleteVenueMap':      return hDeleteVenueMap(env,b);
    case 'setFastPass':         return hSetFastPass(env,b);
    case 'saveSiteConfig':      return hSaveSiteConfig(env,b);
    case 'updateRegistrationAction':       return hUpdateRegistrationAction(env,b);
    case 'savePaymentSettings':       return hSavePaymentSettings(env,b);
    case 'savePaymentProfile':       return hSavePaymentProfile(env,b);
    case 'disablePaymentProfile':    return hDisablePaymentProfile(env,b);
    case 'saveEmailTemplate':       return hSaveEmailTemplate(env,b);
    case 'saveCompanySettings':       return hSaveCompanySettings(env,b);
    case 'updateStaffScope':       return hUpdateStaffScope(env,b);
    case 'setStaffScope':       return hUpdateStaffScope(env,b);
    case 'saveAgreementTemplate': return hSaveAgreementTemplate(env,b);
    case 'saveAgreementTemplates': return hSaveAgreementTemplate(env,b);
    case 'forceCancel':         return hForceCancel(env,b);
    case 'agreeTransfer':       return hAgreeTransfer(env,b);
    case 'applyRefund':         return hApplyRefund(env,b);
    case 'confirmRefund':       return hConfirmRefund(env,b);
    // ── 不可抗力模組（獨立 action，不覆蓋原有邏輯）──
    case 'forceCancelSession':   return hForceCancelSession(env,b);
    case 'agreeForceTransfer':   return hAgreeForceTransfer(env,b);
    case 'applyForceRefund':     // alias：規格名稱
    case 'applyForceRefundFM':   return hApplyForceRefundFM(env,b);
    case 'runForceChoiceDeadline': return hRunForceChoiceDeadline(env,b);
    case 'confirmForceRefund':   return hConfirmForceRefund(env,b);
    case 'getRefundSuggestion': return hGetRefundSuggestion(env,b);
    // 允許 POST 呼叫的 GET actions
    case 'getFinance':          return hGetFinance(env,b);
    case 'getRegsBySession':    return hGetRegsBySession(env,b);
    default: return jsonErr('unknown POST action: '+action);
  }
}

// 僅供自動化驗證直接走與正式環境相同的簽章及即時授權流程；HTTP 入口仍由 default export 控制。
export { issueAdminToken, issueMemberToken, loadFreshAdminAuthorization };

// ── SECTION 16: 主進入點 ────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method==='OPTIONS') {
      return new Response(null, {status:204, headers:corsHeaders()});
    }
    // 出錯時要能回答「誰、在做什麼、哪一筆」。一路填進去，最外層 catch 就有線索可寫。
    const _logCtx = {method:request.method, path:'', action:'', tenantId:'', email:'', regId:'', sessionId:''};
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const action = url.searchParams.get('action')||'';
      _logCtx.path = pathname;
      _logCtx.action = action;

      // ── Google OAuth 路由（GET）──
      if (request.method==='GET' && pathname.endsWith('/auth/google/start')) {
        return await hGoogleStart(env, url);
      }
      if (request.method==='GET' && pathname.endsWith('/auth/google/callback')) {
        return await hGoogleCallback(env, url);
      }
      // 統一登入
      if (request.method==='GET' && pathname.endsWith('/auth/google/unified/start')) {
        return await hGoogleUnifiedStart(env, url);
      }
      if (request.method==='GET' && pathname.endsWith('/auth/google/unified/callback')) {
        return await hGoogleUnifiedCallback(env, url);
      }

      // ── 短網址轉址：/s/<code> ──
      // 由 Cloudflare Route「2b-love.com/s/*」導進來；不帶 action，也不需要 tenant。
      const shortMatch = pathname.match(/^\/s\/([a-z0-9]{4,16})$/i);
      if (request.method==='GET' && shortMatch) {
        return await hShortRedirect(env, shortMatch[1].toLowerCase());
      }

      if (request.method==='GET') {
        const p = Object.fromEntries(url.searchParams);
        _logCtx.tenantId  = p._tenantId || p.tenant || '';
        _logCtx.email     = p.email || '';
        _logCtx.regId     = p.regId || '';
        _logCtx.sessionId = p.sessionId || '';
        // /admin/me
        if (pathname.endsWith('/admin/me') || action==='adminMe') return await hAdminMe(env, p);
        return await routeGet(env, action, p, request);
      }

      if (request.method==='POST') {
        // ECPay 回調：付款 API 尚未啟用
        if (action==='ecpayReturn') {
          return new Response('0|付款 API 尚未啟用',{status:200});
        }
        // 一般 POST：支援 application/json 與 text/plain 內的 JSON
        let body={};
        try {
          const raw = await request.text();
          body = raw ? JSON.parse(raw) : {};
        } catch(e) {
          return jsonErr('invalid JSON body');
        }
        // action 可在 URL 或 body 中
        const act = action || body.action || '';
        _logCtx.action    = act;
        _logCtx.tenantId  = body._tenantId || body.tenant || '';
        _logCtx.email     = body.email || '';
        _logCtx.regId     = body.regId || '';
        _logCtx.sessionId = body.sessionId || '';
        // /admin/logout
        if (pathname.endsWith('/admin/logout') || act==='adminLogout') return await hAdminLogout(env, body);
        // 申請試用（不需登入）
        if (pathname.endsWith('/apply') || act==='applyTrial') return await hApplyTrial(env, body);
        // 一鍵開通（平台管理員）
        if (act==='approveApply') return await hApproveApply(env, body);
        // 鎖定 / 解鎖
        if (act==='lockTenant') return await hLockTenant(env, body);
        if (act==='unlockTenant') return await hUnlockTenant(env, body);
        return await routePost(env, act, body, ctx, request);
      }

      return jsonErr('Method Not Allowed');
    } catch(e) {
      console.error('Worker error:', e);
      // 全域攔截：任何漏接的錯誤都要留下線索，否則攤友看到「異常」，你我都只能猜。
      // 用 waitUntil 在背景寫，不拖慢回應。
      const _logIt = logError(env, {
        source: 'worker',
        action: (_logCtx && _logCtx.action) || '',
        tenantId: (_logCtx && _logCtx.tenantId) || '',
        email: (_logCtx && _logCtx.email) || '',
        regId: (_logCtx && _logCtx.regId) || '',
        sessionId: (_logCtx && _logCtx.sessionId) || '',
        error: e,
        detail: {method: (_logCtx && _logCtx.method) || '', path: (_logCtx && _logCtx.path) || ''},
      });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(_logIt); else await _logIt;
      return jsonErr('系統發生異常，已記錄。請聯繫主辦並提供發生時間。');
    }
  },

  async scheduled(event, env, ctx) {
    const utcHour = new Date(event.scheduledTime).getUTCHours();
    if (utcHour===1) {
      await cronPreEventReminders(env);
      await cronTrialExpireReminders(env); // 試用到期提醒
    } else {
      // 02:00 UTC = 10:00 台灣 → 繳費期限 + 攤位釋出 + 不可抗力逾期
      await cronCheckPayments(env);
      await cronReleaseStalls(env);
      await cronForceCancelExpiry(env);
      // 不可抗力選擇逾期自動轉退費
      await hRunForceChoiceDeadline(env, {});
    }
  },
};
