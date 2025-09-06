const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const { getOrDownloadVideo } = require('../utils/videoCacheManager');
let ytdlp;
// simple concurrency control for playback meta builds per id/url
const playbackLocks = new Map();

// --- Simple in-memory cache for playback meta (tiktok_id keyed) ---
const playbackCache = new Map();
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FAIL_TTL_MS = 30 * 60 * 1000; // 30m

async function validateMp4Url(url) {
  try {
    // Try a ranged GET for 1-2 bytes to check 206 Partial Content support
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
      redirect: 'follow',
    });
    const ct = resp.headers.get('content-type') || '';
    const acceptRanges = resp.headers.get('accept-ranges') || '';
    const cl = resp.headers.get('content-length') || '';
    const okStatus = resp.status === 206 || resp.status === 200;
    const isMp4 = ct.includes('mp4') || url.endsWith('.mp4');
    const hasRanges = acceptRanges.includes('bytes') || resp.status === 206;
    const hasCL = !!cl;
    return okStatus && isMp4 && hasRanges && hasCL;
  } catch (e) {
    return false;
  }
}

function selectPlayableFromFormats(formats = []) {
  if (!Array.isArray(formats)) return {};
  // Prefer mp4 with direct url
  const mp4Candidate = formats.find((f) => (f.ext === 'mp4' || (f.vcodec && f.ext)) && f.url);
  // HLS / m3u8 candidates
  const hlsCandidate =
    formats.find((f) => (f.ext === 'm3u8' || (f.protocol && f.protocol.includes('m3u8')) || (f.format && /hls/i.test(f.format))) && f.url) ||
    formats.find((f) => (f.manifest_url && /m3u8/i.test(f.manifest_url)));
  return {
    mp4Url: mp4Candidate?.url || null,
    hlsUrl: hlsCandidate?.url || hlsCandidate?.manifest_url || null,
  };
}

async function buildPlaybackMetaFromInfo(info, sourceUrl) {
  const id = info?.id || null;
  const cacheKey = id || sourceUrl;
  const now = Date.now();
  const cached = playbackCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { ...cached.data, diagnostics: { ...(cached.data?.diagnostics || {}), cache_hit: true } };
  }

  let playable_url = null;
  let hls_url = null;
  let poster_url = null;
  let strategy = 'yt-dlp';
  let fallback_embed = id ? `https://www.tiktok.com/embed/v2/${id}` : null;

  // Poster
  poster_url = info?.thumbnail || (Array.isArray(info?.thumbnails) ? info.thumbnails[0]?.url : null) || null;

  // From formats
  const { mp4Url, hlsUrl } = selectPlayableFromFormats(info?.formats || []);

  // Validate mp4 direct url if present
  if (mp4Url && (await validateMp4Url(mp4Url))) {
    playable_url = mp4Url;
  } else if (hlsUrl) {
    hls_url = hlsUrl;
  }

  // Cache policy
  const success = playable_url || hls_url;
  const data = {
    tiktok_id: id,
    playable_url: playable_url || null,
    hls_url: hls_url || null,
    poster_url,
    fallback_embed,
    expires_at: new Date(now + SUCCESS_TTL_MS).toISOString(),
    diagnostics: { strategy, cache_hit: false },
  };

  playbackCache.set(cacheKey, {
    data,
    expiresAt: now + (success ? SUCCESS_TTL_MS : FAIL_TTL_MS),
    failCount: success ? 0 : (cached?.failCount || 0) + 1,
  });

  return data;
}

async function getPlaybackMetaWithLock(info, sourceUrl) {
  const id = info?.id || null;
  const key = id || sourceUrl;
  if (!key) return buildPlaybackMetaFromInfo(info, sourceUrl);
  if (playbackLocks.has(key)) {
    return playbackLocks.get(key);
  }
  const p = buildPlaybackMetaFromInfo(info, sourceUrl)
    .catch((e) => {
      return {
        tiktok_id: id,
        playable_url: null,
        hls_url: null,
        poster_url: info?.thumbnail || null,
        fallback_embed: id ? `https://www.tiktok.com/embed/v2/${id}` : null,
        expires_at: new Date(Date.now() + FAIL_TTL_MS).toISOString(),
        diagnostics: { strategy: 'yt-dlp', cache_hit: false, error: String(e) },
      };
    })
    .finally(() => {
      playbackLocks.delete(key);
    });
  playbackLocks.set(key, p);
  return p;
}

// TikTok Shop 专业分析 Prompt（v2.1 - 灵活时间线版）
const getTikTokShopPrompt = () => `STRICTLY RETURN JSON ONLY — no Markdown code fences, no prose, no explanations.
If any data is missing, you MUST still return the full JSON with empty strings/arrays as needed.
If you cannot fill a field, put "" or [] — do NOT omit keys.

================================================================
1. USAGE NOTES
- Output **actionable analysis & improvements**, not vague advice.
- Scoring is simplified but faithful: keep the core weights and fatal-flaw circuit breakers; drop long formulas.
- The Knowledge Base below is fixed; anchor to it for intent/type, but you may paraphrase/adapt wording in "recommendations".
- Sections: **Overview → Timeline Diagnosis → Three-Dimensional Analysis → Recommendations (exactly 3, focused) → Forecast → Core Insights → Improvement Summary**.
- FOCUSED MODE: Generate recommendations ONLY for problematic segments (severity ∈ {"major","critical"} OR score < 7 OR ceiling_rules_triggered non-empty). If <3, fill with [Systemic].
  
================================================================
1. ROLE & OBJECTIVES
You are the TikTok Shop Video Analysis System.

Goals:
1. Predict e-commerce potential (views/conversion/GMV ranges).
2. Rapidly identify fatal flaws in the **first 0–3 seconds**.
3. Produce ready-to-use optimization plans with concrete oral hooks and **on-screen text**.
  
================================================================
2. INPUT SPEC
Required: video file or equivalent transcript + shot description.
Optional creator data: last-7-day posts & avg views; last-30-day GMV (total, converting videos, AOV); optional historical completion/engagement/viral rate.

Data completeness & confidence:
- Complete (>80%): confidence 80–95%
- Partial (50–80%): confidence 65–80% (forecast ranges widen ×2)
- Sparse (<50%): confidence 50–65% (forecast ranges widen ×5)
  
================================================================
3. EVALUATION PIPELINE
1. Three-Dimensional Quick Check: Market Saturation → Product Potential → Creator Performance (defines ceiling).
2. Strategy Fit Check: execution vs product level.
3. Key Timeline Diagnosis: Hook / Trust / Desire / CTA (exactly 4 phases; time windows are FLEXIBLE based on content; score each; flag issues).
4. Composite Score & Grade.
5. Forecast ranges (views/GMV/pass probability).
6. Recommendations: exactly 3 FOCUSED recommendations per Section 9.
7. Core Insights (biggest strength / fatal weakness).
8. Improvement Summary: conversational 8–12 sentences (Section 12).
  
================================================================
4. SCORING (SIMPLIFIED BUT STRICT)
4.1 Weights (sum=100):
- Hook effectiveness (0–3s): 40
- Product display clarity: 25
- Creator credibility/naturalness: 20
- CTA naturalness & motivating power: 15
  
4.2 Light Adjusters:
- Market saturation factor: Low 1.10 / Mid 1.00 / High 0.85
If High and **no clear differentiation**, apply additional **−5 hard penalty**.
- Product potential factor: S 1.15 / A 1.10 / B 1.00 / C 0.90
  
Final score = (weighted pillars) × (saturation factor) × (product factor), capped at 100.

4.3 Grade bands:
S: 90–100 (rare, <2%) / A: 80–89 / B: 70–79 / C: 60–69 / D: <60

4.4 Circuit breakers / downgrades (apply strictly):
- No hook in 0–3s → ceiling C (final ≤69)
- Poor video/audio quality → D
- No product shown in first 3s → ceiling B
- Spoken line duplicates on-screen text (redundant) → treat hook ineffective (0–3s ≤3 → ceiling **C**)
- Excessively salesy tone → drop one grade
  
================================================================
5. THREE-DIMENSIONAL DIAGNOSIS (SETS CEILING)
5.1 Market Saturation (1–10): High(8–10) / Mid(4–7) / Low(1–3) with short reason.
5.2 Product Potential (S/A/B/C) — concise criteria:
- S: strong visual/contrast; understood <5s.
- A: functional innovation; "I didn't know it could do that".
- B: quality/experience-led; needs **scenes + creator trust**.
- C: commodity/high homogeneity; price/discount or live stream driven.
5.3 Creator Performance (1–10): on-camera naturalness; clarity (1–2 core points); fluent, authentic speech.

================================================================
6. TIMELINE DIAGNOSIS — FLEXIBLE SEGMENTS (4 phases required)
- Produce exactly 4 non-overlapping segments labeled "hook" → "trust" → "desire" → "cta" in this order.
- Do NOT use fixed time windows like 0–3 / 3–15 / 15–25 / 25–30 by default. **Detect boundaries by content**.
  
6.1 Phase identification cues
- Hook: stop-scrolling reason; visual novelty; bold claim; on-screen text hook.
- Trust: feature/process/contrast demos; brand mention; proof building.
- Desire: benefits, feelings, "after using" talk; beauty shots; transformation moments.
- CTA: spoken cues ("buy/link/cart/price/sale/grab/get yours/don't miss"), OR visual cues (pointing at orange cart, price tags, discount text, add-to-cart gestures).
  - Typical CTA duration **3–10s**. If CTA is a single line, 2–4s is fine.
  - Do NOT stretch CTA to unrelated demo/proof content.
  - If NO CTA is detected, create a minimal CTA segment at the tail (last 2–4s), set severity="critical", and issue="No CTA found".
    
6.2 Time rules
- t_start, t_end are integers (seconds), **0 ≤ t_start < t_end ≤ video_length**.
- The 4 segments must cover the video contiguously without overlap.
- Keep text fields concise (≤120 characters).
  
6.3 Fields per segment (must fill all; best-effort if no transcript)
For each segment return:
- segment: "start-end s" (e.g., "8-31s")
- phase: one of ["hook","trust","desire","cta"]
- t_start, t_end: integers (seconds)
- score: integer 0–10
- spoken_excerpt: 5–20 words; verbatim if transcript exists; else concise paraphrase prefixed with "~"
- screen_text: on-screen text ("" if none)
- visual_cue: short description (product visible? hands? A/B comparison?)
- product_visible: boolean
- severity: one of ["none","minor","major","critical"]
- ceiling_rules_triggered: [] (list any circuit-breakers activated here)
- pillar_contrib: { hook_0_3s:0–10, display_clarity:0–10, creator_trust:0–10, cta_effectiveness:0–10 }
- issue, risk, fix_hint:
  - If no major problem: 
    - issue: "No major issue — keep as-is."
    - risk: "Low risk; maintain current approach."
    - fix_hint: "Optional micro-optimization: <one-line tweak>"
      
================================================================
7. FORECAST (SIMPLIFIED)
- Views ≈ creator avg × grade multiplier (S 50–100× / A 10–30× / B 5–10× / C 0.5–2× / D <0.5×)
- GMV ≈ views ÷ 1000 × $10 baseline × coefficient (S 2–3× / A 1–1.5× / B ≈1× / C 0.3–0.6× / D ≈0)
- Algorithm pass probability (est.): S >50% / A 30–50% / B 15–30% / C 5–15% / D ≈0
- Frequency correction: low-posting (<5/mo) ×0.7; high-posting (>20/mo) ×1.2
- High-saturation lanes suppress ceiling — stay conservative.
  
================================================================
8. OUTPUT FORMAT — RETURN THIS JSON ONLY
- All scores MUST be integers.
- Pillars MUST be on a 0–10 scale (do NOT return weighted points).
- Keep each text field ≤120 characters.
- If transcript is missing, still fill timeline fields best-effort.
- The timeline array must contain exactly four items for phases: hook, trust, desire, cta (flexible times).
  
{
  "overview": {
    "grade": "S|A|B|C|D",
    "score": 0,
    "confidence": "85%",
    "summary": "≤120 chars.",
    "main_issue": "≤120 chars."
  },
  "pillars": {
    "hook_0_3s": 0,
    "display_clarity": 0,
    "creator_trust": 0,
    "cta_effectiveness": 0
  },
  "flags": {
    "fatal_flaw": false,
    "upper_bound_c": false,
    "upper_bound_b": false,
    "penalties": []
  },
  "three_dimensional": {
    "market_saturation": { "score": 0, "level": "low|mid|high", "reason": "" },
    "product_potential": { "grade": "S|A|B|C", "reason": "" },
    "creator_performance": { "score": 0, "strengths": [], "weaknesses": [] }
  },
  "timeline": [
    {
      "segment": "start-end s",
      "phase": "hook",
      "t_start": 0,
      "t_end": 0,
      "score": 0,
      "spoken_excerpt": "",
      "screen_text": "",
      "visual_cue": "",
      "product_visible": false,
      "severity": "none",
      "ceiling_rules_triggered": [],
      "pillar_contrib": { "hook_0_3s": 0, "display_clarity": 0, "creator_trust": 0, "cta_effectiveness": 0 },
      "issue": "",
      "risk": "",
      "fix_hint": ""
    },
    {
      "segment": "start-end s",
      "phase": "trust",
      "t_start": 0,
      "t_end": 0,
      "score": 0,
      "spoken_excerpt": "",
      "screen_text": "",
      "visual_cue": "",
      "product_visible": false,
      "severity": "none",
      "ceiling_rules_triggered": [],
      "pillar_contrib": { "hook_0_3s": 0, "display_clarity": 0, "creator_trust": 0, "cta_effectiveness": 0 },
      "issue": "",
      "risk": "",
      "fix_hint": ""
    },
    {
      "segment": "start-end s",
      "phase": "desire",
      "t_start": 0,
      "t_end": 0,
      "score": 0,
      "spoken_excerpt": "",
      "screen_text": "",
      "visual_cue": "",
      "product_visible": false,
      "severity": "none",
      "ceiling_rules_triggered": [],
      "pillar_contrib": { "hook_0_3s": 0, "display_clarity": 0, "creator_trust": 0, "cta_effectiveness": 0 },
      "issue": "",
      "risk": "",
      "fix_hint": ""
    },
    {
      "segment": "start-end s",
      "phase": "cta",
      "t_start": 0,
      "t_end": 0,
      "score": 0,
      "spoken_excerpt": "",
      "screen_text": "",
      "visual_cue": "",
      "product_visible": false,
      "severity": "none",
      "ceiling_rules_triggered": [],
      "pillar_contrib": { "hook_0_3s": 0, "display_clarity": 0, "creator_trust": 0, "cta_effectiveness": 0 },
      "issue": "",
      "risk": "",
      "fix_hint": ""
    }
  ],
  "recommendations": [
    {
      "problem": "Concrete issue (with timestamp if segment-specific) or prefix with [Systemic] for cross-cutting.",
      "solution": "Exact operational fix.",
      "examples": {
        "oral": [
          { "text": "Oral example 1", "source": { "type": "curiosity|pain_point|sale|social_proof|cta.soft|cta.urgency|authenticity|main_body", "key": "you_wont_believe" } },
          { "text": "Oral example 2", "source": { "type": "pain_point", "key": "tired_of___so_i" } }
        ],
        "text": { "text": "On-screen text example", "source": { "type": "text_on_screen", "key": "stop_scrolling" } }
      },
      "difficulty": "simple|medium|reshoot",
      "expected_lift": "+10%~+30%"
    }
  ],
  "forecast": {
    "views_range": "e.g., 5x–10x creator_avg",
    "gmv_range": "$lower–$upper or $X–$Y per 100k views",
    "pass_probability": "30%"
  },
  "insights": {
    "what_worked": "≤120 chars.",
    "what_failed": "≤120 chars."
  },
  "improvement_summary": "8–12 full sentences, friendly and conversational; everyday words; medium length; pack value; not a list; avoid just restating the timeline; suggest clear, practical next steps.",
  "data_quality": {
    "completeness": 0.0,
    "widen_factor": 1,
    "notes": []
  },
  "knowledge_refs": [
    { "section": "hook.curiosity", "ids": ["just_wait_for_it","you_wont_believe"] },
    { "section": "cta.soft", "ids": ["drop_link_below","orange_cart_price"] }
  ],
  "model_meta": {
    "detail_level": "full",
    "model_version": "v2.1",
    "seed": 42,
    "created_at": ""
  }
}

================================================================
9. RECOMMENDATIONS — FOCUSED (EXACTLY 3)
A) TRIGGERS (segment becomes a candidate):
- severity ∈ {"major","critical"} OR
- score < 7 OR
- ceiling_rules_triggered is non-empty
  
B) SELECTION PRIORITY (choose up to 3):
- Rank candidates by: severity (critical>major>minor) + ceiling_rules (+2) + score_gap (7-score) + CTA-impact bonus (+1 if CTA)
- Pick top 3 by priority.
- If fewer than 3 candidates, fill remaining with [Systemic] (cross-segment or structural issues like pacing, order of proof, text overlay usage, brand consistency).
  
C) FORMAT per recommendation:
- Problem (with timestamp if segment-specific; otherwise prefix **[Systemic]**)
- Solution: concrete operational steps.
- Examples: ≥2 oral hooks + 1 on-screen text (use Knowledge Base type/key)
- Difficulty: simple / medium / reshoot
- Expected effect: views/conversion lift (range or %)

D) KNOWLEDGE BASE ANCHORING
- Use KB entries as intent anchors (curiosity, pain_point, cta.urgency, etc.). You may adapt wording to fit the video context.
- Personalize with concrete details from THIS video (brand, price, proof shots, gestures). Avoid generic or template-sounding lines.
- Across the 3 recommendations, do not repeat the same hook/text; cover at least two different KB types.

  
================================================================
10. CTA SEGMENT IDENTIFICATION (PATCH)
- Do NOT assign CTA by fixed seconds (e.g., 25–30s).
- Detect CTA by semantic + visual cues:
  - Spoken: "buy", "link", "cart", "price", "sale", "grab", "get yours", "don't miss", "limited stock", "tap".
  - Visual: orange cart, price overlays, discount text, add-to-cart gesture, pointing at link/button.
- Once CTA begins, label that range as "cta" until video ends OR until content clearly shifts away from selling.
- Typical CTA duration **3–10s**; if only one line, 2–4s is fine.
- Do not stretch CTA to cover proof/demo segments.
- If no CTA detected: create a minimal tail CTA (last 2–4s), severity="critical", issue="No CTA found".
  
================================================================
11. HARD REQUIREMENTS
- Return JSON only.
- All numeric scores are integers. Pillars must be 0–10.
- Timeline items must include: phase, t_start, t_end, spoken_excerpt, screen_text, visual_cue, product_visible, severity, ceiling_rules_triggered, pillar_contrib.
- Timeline never leaves issue/risk/fix_hint empty — use micro-optimization phrasing when severity="none".
- Recommendations list = exactly 3 items (focused + [Systemic] if needed).
- Keep each text field ≤120 characters.
- Confidence ties to data completeness; if completeness <0.8, add note "widened ×2" and set widen_factor=2; if <0.5, "widened ×5" and set widen_factor=5 (explicitly mention the factor in data_quality.notes).
- Apply circuit breakers and reflect them in flags and in any ceiling_rules_triggered.
  
================================================================
12. IMPROVEMENT SUMMARY (CONVERSATIONAL, 8–12 SENTENCES)
- Write as if giving friendly feedback to a teammate.
- Use everyday words; keep it medium length; **8–12 full sentences**.
- Pack value: highlight 2–3 biggest wins and 2–3 specific next steps.
- Do not just restate timeline; synthesize into a natural flow.
- Encourage action: mention what to move earlier, what to trim, what to overlay, and how to phrase the CTA.
- Prefer adapted, conversational lines over verbatim KB quotes; keep it human and specific to the footage.

  
================================================================
================================================================
13. BUILT-IN KNOWLEDGE BASE (USE AS ANCHOR; ADAPT WORDING)
Use the Knowledge Base as intent anchors. You may paraphrase and context-fit lines to the specific video.
Prefer friendly, natural phrasing over rigid quotes. Avoid generic claims; ground in on-screen details.
  
A) Authenticity Principle — sound like sharing with a friend, not selling
Natural language
Feelings > specs
Embrace slight imperfection
B) Hook Design (0–5s)

— Oral Hooks —
BUILD CURIOSITY: "Just wait for it..."; "You won't believe what happened next..."; "Keep watching because the end is wild...";
"I was today years old when I found out this existed..."; "Do not get scammed into buying...";
"This $10 item literally changed my life..."; "This is going to sound crazy but just hear me out...";
"I thought they were being dramatic about ___ but do you see this..."

PAIN POINT: "I was so tired of waking up with a stiff neck so I..."; "I was wasting so much time doing ___ so I got this...";
"I didn't realize how bad my ___ was until I tried this...";
"Tell me I'm not the only one dealing with this..."; "This product just saved me from ___";
"I was sick of my cellulite showing through my leggings so I got these...";
"I didn't think anyone could fix ___ but then I tried ___"; "My dogs kept tracking in their muddy paw prints so I got this..."

SALE/URGENCY: "No one was going to tell me that ___ was on sale right now";
"Just in case no one told you ___ is ___ right now"; "To think that I almost missed the sale on ___";
"___ is finally back in stock but not for long!!"; "DO NOT BUY ___ !!!! Because right now you can get it for ___"

SOCIAL PROOF / WORKING FOR ME: "This is your sign to ___ (never use a regular dog brush ever again)";
"To the girl on my FYP who told me about ___ CONFIDENCE!!!";
"Did you guys see the video of that girl advertising ___ because she got me and ___";
"I tried the viral ___ and this is what they aren't telling you...";
"Whoever came up with this idea I freaking love you..."

— On-Screen Text (keep until intro ends) —
"What they don't want you to know..."; "Not your average ___"; "I owe her...";
"Make it make sense"; "STOP scrolling. You need this."; "This will sell out again... run.";
"TikTok made me buy it — worth every penny."; "I wish I found this sooner 😩";
"Why is no one talking about this?!"; "This went viral for a REASON.";
"Everyone's sleeping on this..."; "This looks dumb but it's actually genius."; Aesthetic: ✨product name✨

C) Main Body (5–25s)
35–45s total performs best; cover 1–2 core points; each needs a demo.
Effect language: "Look at this..." (visual); "Do you see how..." (contrast); "Watch what happens when..." (process).
Feeling language: "It literally feels like..."; "You know that feeling when... This is exactly that"; "I can't even describe how..."

D) CTA (closing)
Soft-landing (3–5% CTR): "I'm going to drop the link down below for you!"; "I'll put the link with the sale price in that orange cart!";
"Every now and then you can get it on sale so make sure you click through cart to check for it!!!"
Urgency (4–6% CTR): "I don't know how much longer the sale has so I'll link it down below so you can grab it before it's gone!";
"I FINALLY got my hands on ___ before it went out of stock again..."; "I was lucky enough to get one before they sold out...";
"This has been out of stock for MONTHS"; "If you don't see that little orange cart it does mean that it's sold out yet again!!!!"

E) Market Fit
High saturation (apparel/beauty): visual differentiation > correctness; unique presentation > product alone; scene value > feature list.
Low saturation (novelty): product education > shock visuals; functional demos > emotional varnish; trust building > urgency.`;

// 控制器函数
exports.uploadVideo = async (req, res) => {
  const startTime = Date.now();
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file uploaded'
      });
    }

    // 使用内存中的buffer（因为multer配置为memoryStorage）
    const videoBuffer = req.file.buffer;
    
    console.log(`[分析开始] 文件: ${req.file.originalname}, 大小: ${(req.file.size / 1024 / 1024).toFixed(2)}MB`);

    // 初始化Gemini模型 - 使用Gemini 2.0 Flash
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: {
        temperature: 0.4,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: "application/json", // 强制JSON输出
      },
    });

    // 将视频buffer转为base64
    const base64Video = videoBuffer.toString('base64');

    // 构建消息 - 使用正确的Gemini API格式
    const prompt = getTikTokShopPrompt();
    const promptHash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 12);
    console.log(`[PROMPT] v2.1 hash=${promptHash} len=${prompt.length}`);
    console.log('[Gemini API] 正在发送请求...');
    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {  // 注意：使用camelCase而不是snake_case
          mimeType: req.file.mimetype,
          data: base64Video,
        },
      },
    ]);
    
    if (!result || !result.response) {
      throw new Error('Gemini API返回空响应');
    }

    const rawText = result.response.text();
    console.log('[Gemini API] 收到响应，长度:', rawText.length, '字符');

    // 尝试解析JSON响应
    let parsedData = null;
    let validationStatus = {
      is_valid_json: false,
      is_complete_structure: false,
      missing_fields: [],
      has_actual_scores: false,
    };

    try {
      // 清理可能的markdown代码块
      const cleanedText = rawText
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      
      parsedData = JSON.parse(cleanedText);
      validationStatus.is_valid_json = true;
      
      // 验证结构完整性
      const requiredFields = ['overview', 'pillars', 'timeline', 'recommendations', 'forecast'];
      const missingFields = requiredFields.filter(field => !parsedData[field]);
      validationStatus.missing_fields = missingFields;
      validationStatus.is_complete_structure = missingFields.length === 0;
      
      // 检查是否有实际分数（非零值）
      if (parsedData.pillars) {
        const hasNonZeroScores = Object.values(parsedData.pillars).some(score => score > 0);
        validationStatus.has_actual_scores = hasNonZeroScores;
      }

      // 时间戳守卫
      if (parsedData.timeline && Array.isArray(parsedData.timeline)) {
        parsedData.timeline = parsedData.timeline.map(segment => {
          // 确保t_start和t_end存在且合理
          let t_start = parseInt(segment.t_start) || 0;
          let t_end = parseInt(segment.t_end) || t_start + 3;
          
          // 交换如果顺序错误
          if (t_start > t_end) {
            [t_start, t_end] = [t_end, t_start];
          }
          
          // Clamp到合理范围
          t_start = Math.max(0, Math.min(300, t_start));
          t_end = Math.max(t_start, Math.min(300, t_end));
          
          return {
            ...segment,
            t_start,
            t_end,
            // 确保phase存在
            phase: segment.phase || inferPhaseFromSegment(segment.segment),
            // 确保severity是有效值
            severity: ['none', 'minor', 'major', 'critical'].includes(segment.severity) 
              ? segment.severity 
              : 'none'
          };
        });
      }

      // 处理widen_factor
      if (parsedData.data_quality) {
        const completeness = parsedData.data_quality.completeness || 0.8;
        if (completeness < 0.5) {
          parsedData.data_quality.widen_factor = 5;
          if (!parsedData.data_quality.notes.includes('widened ×5')) {
            parsedData.data_quality.notes.push('Forecast ranges widened ×5 due to low data completeness');
          }
        } else if (completeness < 0.8) {
          parsedData.data_quality.widen_factor = 2;
          if (!parsedData.data_quality.notes.includes('widened ×2')) {
            parsedData.data_quality.notes.push('Forecast ranges widened ×2 due to partial data completeness');
          }
        } else {
          parsedData.data_quality.widen_factor = 1;
        }
      }

      console.log(`[ANALYZER] recs=${parsedData?.recommendations?.length}, timeline=${parsedData?.timeline?.length}`);
      console.log('[JSON解析] 成功，包含所有必需字段');
    } catch (parseError) {
      console.error('[JSON解析] 失败:', parseError.message);
      console.log('[原始响应]', rawText.substring(0, 500));
    }

    // 构建响应
    const analysisTime = Date.now() - startTime;
    const response = {
      success: true,
      analysisResult: {
        full_analysis: rawText,
        raw_response: rawText, // 保存原始响应
        parsed_data: parsedData, // 解析后的数据
        validation_status: validationStatus,
        metadata: {
          filename: req.file.originalname,
          filesize: req.file.size,
          mimetype: req.file.mimetype,
          analysis_time: analysisTime,
          timestamp: new Date().toISOString(),
        },
        controller_meta: {
          prompt_version: 'v2.1',
          prompt_hash: typeof promptHash !== 'undefined' ? promptHash : null,
          recs_len: parsedData && Array.isArray(parsedData.recommendations) ? parsedData.recommendations.length : null,
        }
      },
    };

    // 使用内存存储，无需清理临时文件

    console.log(`[分析完成] 耗时: ${analysisTime}ms`);
    res.json(response);
  } catch (error) {
    console.error('[错误] 视频分析失败:', error);
    
    // 使用内存存储，无需清理文件

    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze video',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

// 辅助函数：从segment推断phase
function inferPhaseFromSegment(segment) {
  if (!segment) return 'hook';
  if (segment.includes('0-3') || segment.includes('0–3')) return 'hook';
  if (segment.includes('3-15') || segment.includes('3–15')) return 'trust';
  if (segment.includes('15-25') || segment.includes('15–25')) return 'desire';
  if (segment.includes('25-30') || segment.includes('25–30')) return 'cta';
  return 'hook'; // 默认值
}

// 新增：通过URL下载TikTok视频并分析
// 约束：仅允许 tiktok.com/vt.tiktok.com 域名，大小 ≤ 50MB
exports.analyzeUrl = async (req, res) => {
  const MAX_BYTES = 50 * 1024 * 1024;
  const ALLOWED_HOSTS = ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vt.tiktok.com'];
  const startTime = Date.now();

  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ ok: false, code: 'INVALID_URL', message: 'Missing or invalid url' });
    }
    let host;
    try {
      host = new URL(url).hostname;
    } catch (e) {
      return res.status(400).json({ ok: false, code: 'INVALID_URL', message: 'URL parse failed' });
    }
    if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
      return res.status(415).json({ ok: false, code: 'UNSUPPORTED_HOST', host });
    }

    // 延迟加载yt-dlp-exec，避免在未安装环境下require时报错
    if (!ytdlp) {
      try {
        ytdlp = require('yt-dlp-exec');
      } catch (e) {
        return res.status(500).json({ ok: false, code: 'DEPENDENCY_MISSING', message: 'yt-dlp-exec not installed' });
      }
    }

    // 1) 先获取元信息估算大小/格式
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      referer: 'https://www.tiktok.com/'
    });

    const formats = Array.isArray(info?.formats) ? info.formats : [];
    const mp4 = formats.find((f) => f.ext === 'mp4' && (f.filesize || f.filesize_approx));
    const candidate = mp4 || formats.find((f) => f.filesize || f.filesize_approx) || null;
    const est = candidate?.filesize || candidate?.filesize_approx || info?.filesize || info?.filesize_approx;
    if (est && est > MAX_BYTES) {
      return res.status(413).json({ ok: false, code: 'TOO_LARGE', limit: MAX_BYTES, est });
    }

    // 2) 使用视频缓存管理器下载并获取自托管URL
    console.log('[analyze_url] Starting video cache download for:', url);
    const cacheResult = await getOrDownloadVideo(url);
    
    let playbackMeta;
    let videoFilePath;
    
    if (cacheResult.success) {
      // 成功获取/下载视频
      playbackMeta = {
        tiktok_id: cacheResult.tiktokId,
        playable_url: `http://localhost:5001${cacheResult.playableUrl}`, // 完整URL
        hls_url: null, // 暂不支持HLS
        poster_url: null,
        fallback_embed: cacheResult.tiktokId ? `https://www.tiktok.com/embed/v2/${cacheResult.tiktokId}` : null,
        expires_at: cacheResult.expiresAt,
        diagnostics: {
          strategy: 'self-hosted',
          cache_hit: cacheResult.cacheHit,
          storage: cacheResult.storage
        }
      };
      
      // 使用缓存的文件路径
      const { getCacheFilePath } = require('../utils/videoCacheManager');
      videoFilePath = getCacheFilePath(cacheResult.tokenId);
      
      console.log('[analyze_url] Video cache result:', {
        tokenId: cacheResult.tokenId,
        cacheHit: cacheResult.cacheHit,
        playableUrl: playbackMeta.playable_url
      });
    } else {
      // 下载失败，使用降级方案
      console.error('[analyze_url] Video cache failed:', cacheResult.error);
      
      // 回退到原始的playbackMeta逻辑
      playbackMeta = await getPlaybackMetaWithLock(info, url);
      
      // 如果也没有playbackMeta，至少提供fallback embed
      if (!playbackMeta || (!playbackMeta.playable_url && !playbackMeta.hls_url)) {
        const tiktokId = cacheResult.tiktokId || info?.id;
        playbackMeta = {
          tiktok_id: tiktokId,
          playable_url: null,
          hls_url: null,
          poster_url: null,
          fallback_embed: tiktokId ? `https://www.tiktok.com/embed/v2/${tiktokId}` : null,
          expires_at: null,
          diagnostics: {
            strategy: 'fallback',
            cache_hit: false,
            error: cacheResult.error
          }
        };
      }
      
      // 仍需要下载视频进行分析
      const tmpName = `tiktok-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`;
      const tmpFile = path.join(os.tmpdir(), tmpName);
      await ytdlp(url, {
        ...(candidate?.format_id ? { format: candidate.format_id } : {}),
        output: tmpFile,
        noWarnings: true,
        noCheckCertificates: true,
        referer: 'https://www.tiktok.com/'
      });
      videoFilePath = tmpFile;
    }

    // 3) 真实大小校验
    const stat = fs.statSync(videoFilePath);
    if (stat.size > MAX_BYTES) {
      // 如果是临时文件，删除它
      if (videoFilePath.includes(os.tmpdir())) {
        try { fs.unlinkSync(videoFilePath); } catch {}
      }
      return res.status(413).json({ ok: false, code: 'TOO_LARGE', limit: MAX_BYTES, actual: stat.size });
    }

    // 4) 读入内存并调用与上传一致的分析逻辑（复用当前实现）
    const buffer = fs.readFileSync(videoFilePath);
    // 如果是临时文件，删除它
    if (videoFilePath.includes(os.tmpdir())) {
      try { fs.unlinkSync(videoFilePath); } catch {}
    }

    // 以下逻辑直接复用 uploadVideo 的实现，确保返回结构一致
    // 初始化Gemini模型
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      generationConfig: {
        temperature: 0.4,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    });

    const base64Video = buffer.toString('base64');
    const prompt = getTikTokShopPrompt();
    const promptHash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 12);
    console.log(`[URL分析] 开始，host=${host}, size=${(stat.size/1024/1024).toFixed(2)}MB`);
    console.log(`[PROMPT] v2.1 hash=${promptHash} len=${prompt.length}`);
    console.log('[Gemini API] 正在发送请求...');

    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: 'video/mp4',
          data: base64Video,
        },
      },
    ]);

    if (!result || !result.response) {
      throw new Error('Gemini API返回空响应');
    }

    const rawText = result.response.text();
    console.log('[Gemini API] 收到响应，长度:', rawText.length, '字符');

    // 尝试解析JSON响应（与上传一致）
    let parsedData = null;
    let validationStatus = {
      is_valid_json: false,
      is_complete_structure: false,
      missing_fields: [],
      has_actual_scores: false,
    };

    try {
      const cleanedText = rawText
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsedData = JSON.parse(cleanedText);
      validationStatus.is_valid_json = true;

      const requiredFields = ['overview', 'pillars', 'timeline', 'recommendations', 'forecast'];
      const missingFields = requiredFields.filter(field => !parsedData[field]);
      validationStatus.missing_fields = missingFields;
      validationStatus.is_complete_structure = missingFields.length === 0;

      if (parsedData.pillars) {
        const hasNonZeroScores = Object.values(parsedData.pillars).some(score => score > 0);
        validationStatus.has_actual_scores = hasNonZeroScores;
      }

      if (parsedData.timeline && Array.isArray(parsedData.timeline)) {
        parsedData.timeline = parsedData.timeline.map(segment => {
          let t_start = parseInt(segment.t_start) || 0;
          let t_end = parseInt(segment.t_end) || t_start + 3;
          if (t_start > t_end) { [t_start, t_end] = [t_end, t_start]; }
          t_start = Math.max(0, Math.min(300, t_start));
          t_end = Math.max(t_start, Math.min(300, t_end));
          return {
            ...segment,
            t_start,
            t_end,
            phase: segment.phase || inferPhaseFromSegment(segment.segment),
            severity: ['none', 'minor', 'major', 'critical'].includes(segment.severity) ? segment.severity : 'none'
          };
        });
      }

      if (parsedData.data_quality) {
        const completeness = parsedData.data_quality.completeness || 0.8;
        if (completeness < 0.5) {
          parsedData.data_quality.widen_factor = 5;
          if (!parsedData.data_quality.notes.includes('widened ×5')) {
            parsedData.data_quality.notes.push('Forecast ranges widened ×5 due to low data completeness');
          }
        } else if (completeness < 0.8) {
          parsedData.data_quality.widen_factor = 2;
          if (!parsedData.data_quality.notes.includes('widened ×2')) {
            parsedData.data_quality.notes.push('Forecast ranges widened ×2 due to partial data completeness');
          }
        } else {
          parsedData.data_quality.widen_factor = 1;
        }
      }

      console.log(`[ANALYZER] recs=${parsedData?.recommendations?.length}, timeline=${parsedData?.timeline?.length}`);
      console.log('[JSON解析] 成功，包含所有必需字段');
    } catch (parseError) {
      console.error('[JSON解析] 失败:', parseError.message);
      console.log('[原始响应]', rawText.substring(0, 500));
    }

    const analysisTime = Date.now() - startTime;
    const response = {
      success: true,
      analysisResult: {
        full_analysis: rawText,
        raw_response: rawText,
        parsed_data: parsedData,
        validation_status: validationStatus,
        metadata: {
          filename: path.basename(videoFilePath),
          filesize: stat.size,
          mimetype: 'video/mp4',
          analysis_time: analysisTime,
          timestamp: new Date().toISOString(),
        },
        controller_meta: {
          prompt_version: 'v2.1',
          prompt_hash: typeof promptHash !== 'undefined' ? promptHash : null,
          recs_len: parsedData && Array.isArray(parsedData.recommendations) ? parsedData.recommendations.length : null,
        }
      },
    };

    // 同时附加ok/source/meta（不破坏前端兼容）
    res.json({
      ok: true,
      source: 'url',
      meta: {
        platform: 'tiktok',
        durationSec: info?.duration,
        filesize: stat.size,
        tiktok_id: playbackMeta.tiktok_id || info?.id || null,
        playable_url: playbackMeta.playable_url || null,
        hls_url: playbackMeta.hls_url || null,
        poster_url: playbackMeta.poster_url || null,
        fallback_embed: playbackMeta.fallback_embed || null,
        expires_at: playbackMeta.expires_at || null,
        diagnostics: playbackMeta.diagnostics || { strategy: 'yt-dlp', cache_hit: false }
      },
      ...response,
    });
  } catch (err) {
    console.error('analyze_url error', err);
    const code = /timed out|Timeout/i.test(String(err)) ? 'UPSTREAM_TIMEOUT' : 'DOWNLOAD_FAILED';
    const status = code === 'UPSTREAM_TIMEOUT' ? 504 : 422;
    res.status(status).json({ ok: false, code, message: err?.message || String(err) });
  }
};
