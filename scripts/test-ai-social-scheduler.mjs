import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  socialBuildImagePrompt,
  socialCampaignSchema,
  socialHashtags,
  socialMentionStatus,
  socialNormalizeSchedule,
  socialPostView,
  socialWorkersAIJson,
  socialEncryptToken,
  socialDecryptToken,
} from '../worker.js';

const worker=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../social.html',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/ai_social_scheduler.sql',import.meta.url),'utf8');
const threadsSql=fs.readFileSync(new URL('../supabase/20260819210736_add_threads_social_scheduler.sql',import.meta.url),'utf8');
const auth=fs.readFileSync(new URL('../lib/admin-authorization.js',import.meta.url),'utf8');
const wrangler=fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');

assert.match(admin,/AI 貼文排程小幫手/,'後台必須有工具入口');
assert.match(admin,/role!==['"]platform_super_admin['"]\) return/,'後台入口只可顯示給平台總管理員');
assert.match(page,/新增宣傳/); assert.match(page,/貼文排程/); assert.match(page,/Facebook／Instagram／Threads 連接/);
assert.match(page,/確認全部並發布排程/); assert.match(page,/複製圖片語法/); assert.match(page,/上傳／更換圖片/);
assert.match(page,/合作帳號/); assert.match(page,/活動固定 Hashtag/); assert.match(page,/該篇專屬 Hashtag/);
assert.match(page,/Facebook 粉專 ID/); assert.match(page,/此工具僅限平台總管理員使用/);
assert.match(page,/自訂 1～20 篇/); assert.match(page,/免費 AI 產圖/); assert.match(page,/Cloudflare 免費 AI/);
assert.match(page,/應用程式網域/); assert.match(page,/facebookInstagramRedirectUri/); assert.match(page,/threadsRedirectUri/);

for(const action of ['socialCreateCampaign','socialSavePartner','socialGenerateCampaign','socialUpdatePost','socialRegeneratePost','socialRegenerateHashtags','socialRegenerateImagePrompt','socialUploadPostImage','socialGeneratePostImage','socialScheduleCampaign','socialSelectMetaAccounts','socialThreadsDisconnect']){
  assert.match(worker,new RegExp(`case '${action}'`),`${action} 必須接到 Worker`);
  assert.match(auth,new RegExp(`'${action}'`),`${action} 必須接到既有管理權限`);
}
assert.match(worker,/\/auth\/meta\/start/); assert.match(worker,/\/auth\/meta\/callback/);
assert.match(worker,/\/auth\/threads\/start/); assert.match(worker,/\/auth\/threads\/callback/);
assert.match(worker,/const SOCIAL_OAUTH_APP_DOMAIN = '2bl-v7\.ndiangrace\.workers\.dev'/);
assert.match(worker,/const SOCIAL_META_REDIRECT_URI = `\$\{WORKER_PUBLIC_URL\}\/auth\/meta\/callback`/);
assert.match(worker,/const SOCIAL_THREADS_REDIRECT_URI = `\$\{WORKER_PUBLIC_URL\}\/auth\/threads\/callback`/);
assert.match(worker,/const SOCIAL_THREADS_DEAUTHORIZE_URI = `\$\{WORKER_PUBLIC_URL\}\/auth\/threads\/deauthorize`/);
assert.match(worker,/const SOCIAL_THREADS_DELETE_URI = `\$\{WORKER_PUBLIC_URL\}\/auth\/threads\/delete`/);
assert.match(worker,/hSocialThreadsDeauthorize\(env, request\)/);
assert.match(worker,/hSocialThreadsDelete\(env, request\)/);
assert.match(worker,/socialOAuthCallbackError\(url,'Facebook／Instagram'\)/);
assert.match(worker,/socialOAuthCallbackError\(url,'Threads'\)/);
assert.match(worker,/threads_basic,threads_content_publish/); assert.match(worker,/graph\.threads\.net\/me\/threads_publish/);
assert.match(worker,/graph\.threads\.net\/refresh_access_token/); assert.match(worker,/th_refresh_token/);
assert.match(worker,/claim_due_social_posts/); assert.match(worker,/social_publish_attempts/);
assert.match(worker,/event\.cron === '\* \* \* \* \*'/);
assert.match(wrangler,/"\* \* \* \* \*"/);
assert.match(wrangler,/"ai"\s*:\s*\{\s*"binding"\s*:\s*"AI"/);

const socialSection=worker.slice(worker.indexOf('// ── AI 貼文排程小幫手（成本控制第一版）'));
assert.match(socialSection,/env\.AI\.run/,'貼文文字與圖片必須使用 Workers AI binding');
assert.match(worker,/@cf\/meta\/llama-3\.1-8b-instruct-fast/);
assert.match(worker,/@cf\/bytedance\/stable-diffusion-xl-lightning/);
assert.doesNotMatch(worker,new RegExp('api\\.'+'open'+'ai\\.com'),'不得保留付費 AI 網路端點');
assert.doesNotMatch(wrangler,new RegExp('OPEN'+'AI_API_KEY'),'不得再要求付費 AI secret');
assert.match(socialSection,/existing\.length/,'重新整理或重按不得重複生成整批');

for(const table of ['social_partners','social_campaigns','social_posts','social_meta_connections','social_publish_attempts']){
  assert.match(sql,new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(sql,new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
}
assert.match(sql,/schedule_social_campaign/); assert.match(sql,/claim_due_social_posts/);
assert.match(sql,/for update skip locked/); assert.match(sql,/unique \(tenant_id, post_id, platform\)/);
assert.match(sql,/facebook_partner_ids/); assert.match(sql,/instagram_partner_ids/); assert.match(sql,/mention_status/);
assert.match(sql,/fixed_hashtags/); assert.match(sql,/topic_hashtags/);
assert.match(threadsSql,/add column if not exists threads_text/);
assert.match(threadsSql,/encrypted_threads_token/); assert.match(threadsSql,/selected_threads_id/);
assert.match(threadsSql,/platform in \('facebook','instagram','threads'\)/);
assert.match(threadsSql,/platforms \? 'threads'/); assert.match(threadsSql,/Threads 文章/);
assert.match(worker,/verifyPlatformSuperAdmin\(env, input\.email, input\.token, tenantId\)/,'貼文工具後端必須限平台總管理員');
assert.match(auth,/PLATFORM_ADMIN_ACTIONS[\s\S]*socialBootstrap/,'貼文工具必須屬於平台總管權限');
assert.doesNotMatch(auth,/TENANT_OWNER_ACTIONS[\s\S]*socialBootstrap/,'貼文工具不得保留租戶主要管理者權限');

const campaign={title:'測試活動',event_date:'2026/09/19',event_time:'11:00–18:00',location:'美麗島',organizer:'兔彼樂',co_organizer:'合作單位'};
const styles=[
  {label:'攝影',palette:'藍綠',composition:'廣角'},
  {label:'拼貼',palette:'橘藍',composition:'不對稱'},
];
const a=socialBuildImagePrompt(campaign,{angle:'活動公布',visualConcept:'全場景',focalSubject:'入口'},styles[0],0,2);
const b=socialBuildImagePrompt(campaign,{angle:'公益理念',visualConcept:'互動',focalSubject:'雙手'},styles[1],1,2);
assert.notEqual(a,b); assert.match(a,/測試活動/); assert.match(a,/不得自行增加/); assert.match(a,/不要生成任何中文字/);

const fixed=socialCampaignSchema('5');
assert.equal(fixed.properties.posts.minItems,5); assert.equal(fixed.properties.posts.maxItems,5);
const custom=socialCampaignSchema('7'); assert.equal(custom.properties.posts.minItems,7); assert.equal(custom.properties.posts.maxItems,7);
assert.ok(fixed.properties.fixedHashtags); assert.ok(fixed.properties.posts.items.properties.facebookPartnerIds); assert.ok(fixed.properties.posts.items.properties.instagramPartnerIds);
assert.ok(fixed.properties.posts.items.properties.threadsText); assert.deepEqual(fixed.properties.posts.items.properties.platforms.items.enum,['facebook','instagram','threads']);
const dynamic=socialCampaignSchema('until_end');
assert.equal(dynamic.properties.posts.minItems,1); assert.equal(dynamic.properties.posts.maxItems,20);

let workersAiRequest=null;
const workersAiResult=await socialWorkersAIJson({AI:{run:async(model,request)=>{workersAiRequest={model,request};return {response:JSON.stringify({topicHashtags:['#免費AI']}),usage:{prompt_tokens:10}};}}},'hashtags','規則','文章',socialHashtagSchemaForTest(),900);
assert.equal(workersAiRequest.model,'@cf/meta/llama-3.1-8b-instruct-fast');
assert.equal(workersAiRequest.request.response_format.type,'json_schema');
assert.deepEqual(workersAiResult.data.topicHashtags,['#免費AI']);

const future=socialNormalizeSchedule('2099-01-01T19:00:00+08:00',0,5,{event_date:'2099/01/10'});
assert.ok(!Number.isNaN(Date.parse(future)));
const view=socialPostView({id:'p',campaign_id:'c',sequence_no:1,hashtags:['#一'],platforms:['facebook'],status:'scheduled'});
assert.deepEqual(view.hashtags,['#一']); assert.equal(view.statusLabel,'已排程');
const threadsView=socialPostView({id:'p2',campaign_id:'c',sequence_no:2,threads_text:'脆文',platforms:['threads'],status:'draft'});
assert.equal(threadsView.threadsText,'脆文'); assert.deepEqual(threadsView.platforms,['threads']);

assert.deepEqual(socialHashtags(['活動','##公益','#活動']),['#活動','#公益']);
assert.deepEqual(socialHashtags(['#','']),[]);
const partners=[{id:'a',name:'A',facebook_page_id:'12345',facebook_page_url:'https://www.facebook.com/a',instagram_username:'a.tw'},{id:'b',name:'B',facebook_page_id:null,instagram_username:null}];
const mentionOff=socialMentionStatus({},partners,['a','b'],['a','b']);
assert.equal(mentionOff.facebook.items[0].state,'unsupported');
assert.equal(mentionOff.facebook.items[1].state,'unavailable');
assert.equal(mentionOff.instagram.items[0].state,'ready');
assert.equal(mentionOff.instagram.items[1].state,'unavailable');
const mentionOn=socialMentionStatus({META_FACEBOOK_PAGE_MENTIONING_ENABLED:'true'},partners,['a'],[]);
assert.equal(mentionOn.facebook.items[0].state,'ready');
assert.match(worker,/createContainer\(false\)/,'IG 標註失敗時必須改為不標註發布');
assert.match(worker,/publish\(false\)/,'FB 標註失敗時必須改為不標註發布');
assert.match(worker,/user_tags/,'IG 必須使用 Meta 官方 user_tags 欄位');
assert.match(worker,/message_tags/,'FB 標註必須讀取 Meta 發布結果驗證');
assert.match(page,/Threads 暫不自動標註合作帳號/,'Threads 不可假裝已支援合作帳號標註');

const encrypted=await socialEncryptToken({META_TOKEN_ENCRYPTION_KEY:'test-only-secret'},'meta-token-value');
assert.notEqual(encrypted,'meta-token-value');
assert.equal(await socialDecryptToken({META_TOKEN_ENCRYPTION_KEY:'test-only-secret'},encrypted),'meta-token-value');

console.log('AI social scheduler contract tests: OK');

function socialHashtagSchemaForTest(){return {type:'object',additionalProperties:false,required:['topicHashtags'],properties:{topicHashtags:{type:'array',items:{type:'string'}}}};}
