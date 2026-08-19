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

// 付款完成後的大群組邀請。正式設定保存於 tenants.config_json.officialGroup；
// tuibile fallback 只用於承接既有正式功能，儲存後即以資料庫內容為準。
const LEGACY_TUIBILE_OFFICIAL_GROUP = Object.freeze({
  enabled: true,
  name: '全台市集藝文資訊中心 大群組',
  inviteText: '您已被邀請加入「全台市集藝文資訊中心 大群組」！請點選以下連結加入社群！',
  url: 'https://line.me/ti/g2/cp-K_Los4J2zBc6rGcRA14TJCx3e99v0i4p-hQ?utm_source=invitation&utm_medium=link_copy&utm_campaign=default',
  password: '8825',
});
const EMPTY_OFFICIAL_GROUP = Object.freeze({enabled:false,name:'',inviteText:'',url:'',password:''});
function normalizeOfficialGroupConfig(raw, tenantId='') {
  const hasStored = raw && typeof raw === 'object' && !Array.isArray(raw);
  const source = hasStored ? raw : (String(tenantId||'') === 'tuibile' ? LEGACY_TUIBILE_OFFICIAL_GROUP : EMPTY_OFFICIAL_GROUP);
  const clean = (value, max) => String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
  const url = clean(source.url, 1200);
  return {
    enabled: source.enabled === true || source.enabled === 'true',
    name: clean(source.name, 80),
    inviteText: clean(source.inviteText, 240),
    url: /^https:\/\//i.test(url) ? url : '',
    password: clean(source.password, 40),
  };
}

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
// AI 貼文排程小幫手：第一版只使用文字模型產文與圖片 Prompt，
// 絕不從此模組呼叫付費圖片 API。
const SOCIAL_TEXT_MODEL_DEFAULT = 'gpt-5.6-terra';
const SOCIAL_IMAGE_BUCKET = 'covers';
const SOCIAL_TENANT_ID = 'tuibile';
const SOCIAL_VISUAL_STYLES = Object.freeze([
  {key:'editorial_photo',label:'自然紀實攝影',palette:'清透自然光、鼠尾草綠與米白',composition:'廣角環境敘事，人物與活動空間有前中後景'},
  {key:'paper_collage',label:'紙張拼貼',palette:'珊瑚橘、海軍藍與暖米色',composition:'不對稱拼貼，主物件偏左並保留右側呼吸空間'},
  {key:'watercolor',label:'透明水彩插畫',palette:'霧藍、淡綠與柔和赭紅',composition:'水平故事場景，焦點在互動人物與活動細節'},
  {key:'minimal_objects',label:'極簡物件攝影',palette:'象牙白、深綠與單一亮黃點綴',composition:'俯拍幾何排列，大量留白與單一視覺焦點'},
  {key:'hand_drawn',label:'手繪線條插畫',palette:'墨黑線條、奶油白與活潑原色',composition:'近景人物動作，線條引導視線形成動態節奏'},
  {key:'cinematic_story',label:'電影感故事畫面',palette:'黃昏暖光、深藍陰影與琥珀色',composition:'低視角情境敘事，主角置於三分線並有景深'},
  {key:'information_design',label:'資訊設計主視覺',palette:'高對比藍綠、白與少量橘紅',composition:'模組化方格資訊區，主視覺與留字區清楚分離'},
  {key:'community_documentary',label:'公益社群紀實',palette:'溫暖膚色、自然綠與柔灰',composition:'中距離真實互動瞬間，視線集中在人與人的連結'},
  {key:'market_illustration',label:'市集情境插畫',palette:'磚紅、森林綠、芥末黃與米白',composition:'略高視角看見攤位、人流與活動層次'},
  {key:'bold_poster',label:'大膽活動海報',palette:'深藍、亮橘與純白',composition:'大型單一圖形焦點，斜向節奏與明確留字區'},
  {key:'quiet_editorial',label:'文青編輯風',palette:'低飽和灰綠、沙色與墨色',composition:'局部特寫、細膩材質與大量安靜留白'},
  {key:'playful_family',label:'親子繪本感',palette:'天空藍、草綠、暖黃與柔紅',composition:'平視歡樂群像，圓潤物件分布但避免圓形卡片模板'},
  {key:'night_scene',label:'夜間燈光攝影',palette:'靛藍夜色、暖黃燈串與少量桃紅',composition:'由燈光形成視線動線，前景細節與遠景人群並存'},
  {key:'retro_print',label:'復古網版印刷',palette:'墨綠、磚橘與紙張米色',composition:'兩至三層套色圖形，粗獷印刷質感與不對稱版面'},
  {key:'architectural_wide',label:'寬闊場域攝影',palette:'天空藍、建築米白與自然綠',composition:'超廣角呈現空間尺度，人物作為比例與活動線索'},
  {key:'closeup_craft',label:'手作細節特寫',palette:'木質棕、亞麻白與植物綠',composition:'淺景深近拍雙手與物件，背景僅保留活動氣氛'},
  {key:'surreal_concept',label:'概念超現實拼貼',palette:'深青、亮黃與灰白',composition:'單一象徵物放大，結合小型場景形成意外視覺'},
  {key:'countdown_type',label:'倒數數字視覺',palette:'單色深綠、米白與警示橘',composition:'巨大倒數數字留白區，周圍配置少量活動物件'},
  {key:'map_story',label:'手繪地圖故事',palette:'湖水綠、土色、珊瑚橘與白',composition:'鳥瞰路線與地標圖像，資訊清楚但不畫不存在設施'},
  {key:'finale_energy',label:'活動最終日動感',palette:'亮紅、深藍與金黃色塊',composition:'斜向人群與旗幟動勢，中央保留活動資訊區'}
]);
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
    if (payload.expires_at && D