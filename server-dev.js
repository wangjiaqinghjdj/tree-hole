const express = require("express");
require("dotenv").config();
const axios = require("axios");
const https = require("https");
const dns = require("dns");
const HttpsProxyAgent = require("https-proxy-agent");
const session = require("express-session");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mysql = require("mysql2/promise");

const app = express();
const upload = multer({ dest: path.join(__dirname, "uploads") });

const db = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "123456",
  database: process.env.DB_NAME || "student_db",
  charset: "utf8mb4"
};

let pool;
async function conn() {
  if (!pool) {
    pool = mysql.createPool({ ...db, waitForConnections: true, connectionLimit: 10 });
    await ensureSchema();
  }
  return pool;
}

async function ensureSchema() {
  const c = await pool.getConnection();
  try {
    const safeAlter = async (sql) => {
      try {
        await c.query(sql);
      } catch (e) {
        if (e && (e.code === "ER_DUP_FIELDNAME" || e.code === "ER_CANT_CREATE_TABLE")) return;
        throw e;
      }
    };

    await c.query(
      "CREATE TABLE IF NOT EXISTS users (" +
        "id INT AUTO_INCREMENT PRIMARY KEY, " +
        "username VARCHAR(60) NOT NULL UNIQUE, " +
        "password VARCHAR(120) NOT NULL, " +
        "role VARCHAR(20) NOT NULL DEFAULT 'USER', " +
        "ai_chat_enabled TINYINT NOT NULL DEFAULT 1, " +
        "public_square_enabled TINYINT NOT NULL DEFAULT 1, " +
        "nickname VARCHAR(60) NULL, " +
        "avatar_url VARCHAR(255) NULL, " +
        "bio VARCHAR(300) NULL, " +
        "ai_name VARCHAR(60) NULL, " +
        "ai_persona VARCHAR(60) NULL, " +
        "ai_addressing VARCHAR(60) NULL, " +
        "ai_support_style VARCHAR(60) NULL, " +
        "ai_taboo VARCHAR(300) NULL" +
      ")"
    );
    await c.query(
      "CREATE TABLE IF NOT EXISTS mood_records (" +
        "id INT AUTO_INCREMENT PRIMARY KEY, " +
        "user_id INT NOT NULL, " +
        "content TEXT NOT NULL, " +
        "ai_tag VARCHAR(30) NULL, " +
        "mood_score INT DEFAULT 60, " +
        "is_public TINYINT DEFAULT 0, " +
        "ai_comment TEXT NULL, " +
        "ai_practice VARCHAR(200) NULL, " +
        "ai_action VARCHAR(200) NULL, " +
        "is_pinned TINYINT DEFAULT 0, " +
        "echo_date DATETIME NULL, " +
        "echo_opened TINYINT DEFAULT 0, " +
        "create_time DATETIME DEFAULT CURRENT_TIMESTAMP" +
      ")"
    );

    await c.query(
      "CREATE TABLE IF NOT EXISTS private_messages (" +
        "id INT AUTO_INCREMENT PRIMARY KEY, sender_id INT NOT NULL, receiver_id INT NOT NULL, message TEXT NOT NULL, " +
        "is_read TINYINT DEFAULT 0, create_time DATETIME DEFAULT CURRENT_TIMESTAMP" +
      ")"
    );
    await c.query(
      "CREATE TABLE IF NOT EXISTS private_chat_settings (" +
        "user_id INT NOT NULL, partner_id INT NOT NULL, pinned TINYINT DEFAULT 0, muted TINYINT DEFAULT 0, hidden TINYINT DEFAULT 0, " +
        "update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, " +
        "PRIMARY KEY (user_id, partner_id)" +
      ")"
    );
    await c.query(
      "CREATE TABLE IF NOT EXISTS user_blocks (" +
        "blocker_id INT NOT NULL, blocked_id INT NOT NULL, create_time DATETIME DEFAULT CURRENT_TIMESTAMP, " +
        "PRIMARY KEY (blocker_id, blocked_id)" +
      ")"
    );
    await c.query(
      "CREATE TABLE IF NOT EXISTS chat_records (" +
        "id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, sender VARCHAR(20) NOT NULL, message TEXT NOT NULL, " +
        "create_time DATETIME DEFAULT CURRENT_TIMESTAMP" +
      ")"
    );
    await c.query(
      "CREATE TABLE IF NOT EXISTS likes (" +
        "id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, mood_id INT NOT NULL, UNIQUE KEY uk_like (user_id,mood_id)" +
      ")"
    );

    await safeAlter("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'USER'");
    await safeAlter("ALTER TABLE users ADD COLUMN ai_chat_enabled TINYINT NOT NULL DEFAULT 1");
    await safeAlter("ALTER TABLE users ADD COLUMN public_square_enabled TINYINT NOT NULL DEFAULT 1");
    await safeAlter("ALTER TABLE users ADD COLUMN nickname VARCHAR(60) NULL");
    await safeAlter("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255) NULL");
    await safeAlter("ALTER TABLE users ADD COLUMN bio VARCHAR(300) NULL");
    await safeAlter("ALTER TABLE users ADD COLUMN ai_name VARCHAR(60) NULL");
    await safeAlter("ALTER TABLE users ADD COLUMN ai_persona VARCHAR(60) NULL");
    await safeAlter("ALTER TABLE users ADD COLUMN ai_addressing VARCHAR(60) NULL");
    await safeAlter("ALTER TABLE users ADD COLUMN ai_support_style VARCHAR(60) NULL");
    await safeAlter("ALTER TABLE users ADD COLUMN ai_taboo VARCHAR(300) NULL");
    await safeAlter("ALTER TABLE mood_records ADD COLUMN ai_practice VARCHAR(200) NULL");
    await safeAlter("ALTER TABLE mood_records ADD COLUMN ai_action VARCHAR(200) NULL");
    await safeAlter("ALTER TABLE mood_records ADD COLUMN is_pinned TINYINT DEFAULT 0");
    await safeAlter("ALTER TABLE mood_records ADD COLUMN echo_date DATETIME NULL");
    await safeAlter("ALTER TABLE mood_records ADD COLUMN echo_opened TINYINT DEFAULT 0");
    await safeAlter("ALTER TABLE private_messages ADD COLUMN is_read TINYINT DEFAULT 0");

    await c.query("UPDATE users SET role='ADMIN', ai_chat_enabled=1, public_square_enabled=1 WHERE username='admin'");
    await c.query(
      "INSERT INTO users (username,password,role,ai_chat_enabled,public_square_enabled) " +
      "SELECT 'admin','admin123','ADMIN',1,1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users WHERE username='admin')"
    );
  } finally {
    c.release();
  }
}

app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "client_index.html")));
app.get("/main.js", (req, res) => res.sendFile(path.join(__dirname, "main.js")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(__dirname, "styles.css")));
// Ambient music (user-provided)
app.get("/music/ambient.mp3", (req, res) => res.sendFile(path.join(__dirname, "1.mp3")));
app.get("/vendor/vue.global.prod.js", (req, res) => res.sendFile(path.join(__dirname, "node_modules", "vue", "dist", "vue.global.prod.js")));
app.get("/vendor/axios.min.js", (req, res) => res.sendFile(path.join(__dirname, "node_modules", "axios", "dist", "axios.min.js")));
app.get("/vendor/echarts.min.js", (req, res) => res.sendFile(path.join(__dirname, "node_modules", "echarts", "dist", "echarts.min.js")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "tree-hole-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 3600 * 1000 }
  })
);

function needLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok: false, message: "NOT_LOGIN" });
  next();
}
function isAdmin(req) {
  return req.session.user && req.session.user.role === "ADMIN";
}
function aiIdentity(user) {
  const name = (user?.aiName || "").trim() || "小树";
  const persona = (user?.aiPersona || "").trim() || "温柔陪伴";
  return { name, persona };
}
function aiCareProfile(user) {
  const addressing = (user?.aiAddressing || "").trim().slice(0, 60);
  const supportStyle = (user?.aiSupportStyle || "").trim().slice(0, 60) || "共情倾听";
  const taboo = (user?.aiTaboo || "").trim().slice(0, 300);
  return { addressing, supportStyle, taboo };
}
function moodExtraFallback(tag, score) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const practice =
    score < 40
      ? pick(["微练习：慢慢呼气到 6 秒", "微练习：手放胸口 5 秒", "微练习：看向远处数 3 次呼吸"])
      : score < 65
      ? pick(["微练习：吸气 4 秒呼气 4 秒", "微练习：轻轻放松肩颈", "微练习：给自己一句小肯定"])
      : pick(["微练习：闭眼 2 秒感受放松", "微练习：慢慢伸展背部", "微练习：给今天的自己点个赞"]);
  const action =
    tag === "悲伤"
      ? pick(["小行动：给自己倒一杯温水", "小行动：给朋友发一句“我在”", "小行动：把手机放下 5 分钟"])
      : tag === "疲惫"
      ? pick(["小行动：做一次 3 分钟伸展", "小行动：把待办只留 1 件", "小行动：今晚早点洗个热水澡"])
      : tag === "平静"
      ? pick(["小行动：写下 1 件小确幸", "小行动：把房间开窗 2 分钟", "小行动：散步 8 分钟"])
      : tag === "轻松"
      ? pick(["小行动：把这份轻松记录一句", "小行动：给自己准备点好吃的", "小行动：和喜欢的人说句话"])
      : pick(["小行动：把开心分享给自己", "小行动：做一件让自己骄傲的小事", "小行动：给未来的自己留一句话"]);
  return { practice, action };
}
async function generateAiMoodPack({ aiName, aiPersona, addressing, supportStyle, taboo, content, tag, score }) {
  const profileLine = [
    addressing ? `用户希望被称呼为：${addressing}` : "",
    supportStyle ? `用户偏好陪伴方式：${supportStyle}` : "",
    taboo ? `用户不希望被提及/雷区：${taboo}` : ""
  ]
    .filter(Boolean)
    .join("；");

  const systemPrompt =
    `你是名为“${aiName}”的心理陪伴助手，性格是“${aiPersona}”。` +
    "你要温柔、克制、支持性强，不下诊断，不夸大承诺，不使用极端建议。" +
    "请只输出严格 JSON（不要代码块，不要额外文本），格式为：" +
    '{"comment":"...","practice":"...","action":"..."}。' +
    'comment：20-55字的温暖回应（可包含“我在”之类共情）；practice：一句“微练习：...”的简短指引；action：一句“小行动：...”的轻量建议。';

  const userPrompt =
    `${profileLine ? "用户画像：" + profileLine + "\n" : ""}` +
    `用户刚记录了树洞内容：“${content || "（空）"}”。情绪标签：${tag}，心情指数：${score}/100。`;

  const raw = await generateAiText({ systemPrompt, userPrompt, maxOutputTokens: 320, temperature: 0.85 });
  let obj;
  try {
    obj = JSON.parse(String(raw || "").trim());
  } catch (_) {
    // try to salvage JSON substring
    const s = String(raw || "");
    const m = s.match(/\{[\s\S]*\}/);
    if (m) obj = JSON.parse(m[0]);
  }
  const comment = String(obj?.comment || "").trim();
  const practice = String(obj?.practice || "").trim();
  const action = String(obj?.action || "").trim();
  if (!comment || !practice || !action) throw new Error("BAD_AI_JSON");
  return { comment, practice, action };
}
function weatherText(state) {
  const map = {
    sunbeam: ["今天树洞里透进一束光，适合把轻松慢慢摊开。", "这一周的心情像有光穿过叶隙。"],
    afternoon: ["今天像一段安静的午后，适合把心事放在柔软处。", "你的近况更接近柔和午后。"],
    starlight: ["今晚像一片星光，安静地陪你。", "最近的波动在慢慢沉静下来。"],
    rain: ["今天树洞里下了一场小雨，适合静静听心跳。", "最近的情绪有些潮湿，先慢一点。"],
    mist: ["今天树洞里有一点晨雾，先别急，慢慢看清自己也很好。", "页面会根据最近七天的心情变化轻轻调整氛围。"]
  };
  return map[state] || map.mist;
}
function weatherState(avg7, avg3, latest, count) {
  if (!count) return "mist";
  const short = count === 1 ? latest * 0.8 + avg7 * 0.2 : count === 2 ? latest * 0.65 + avg3 * 0.35 : latest * 0.55 + avg3 * 0.3 + avg7 * 0.15;
  let idx = short < 30 ? 0 : short < 45 ? 1 : short < 60 ? 2 : short < 80 ? 3 : 4;
  const deltaW = short - avg7;
  const deltaI = latest - avg3;
  if (deltaW >= 4) idx += 1;
  if (deltaW <= -4) idx -= 1;
  if (deltaI >= 10) idx += 1;
  if (deltaI <= -10) idx -= 1;
  idx = Math.max(0, Math.min(4, idx));
  return ["rain", "mist", "starlight", "afternoon", "sunbeam"][idx];
}
async function unreadCount(userId) {
  const p = await conn();
  const [rows] = await p.query("SELECT COALESCE(SUM(CASE WHEN is_read=0 OR is_read IS NULL THEN 1 ELSE 0 END),0) n FROM private_messages WHERE receiver_id=?", [userId]);
  return Number(rows[0]?.n || 0);
}
async function echoPendingCount(userId) {
  const p = await conn();
  const [rows] = await p.query(
    "SELECT COUNT(*) n FROM mood_records WHERE user_id=? AND echo_date IS NOT NULL AND echo_date<=NOW() AND (echo_opened=0 OR echo_opened IS NULL)",
    [userId]
  );
  return Number(rows[0]?.n || 0);
}
async function echoRecords(userId) {
  const p = await conn();
  const [rows] = await p.query(
    "SELECT id, content, mood_score moodScore, ai_comment aiComment, create_time createTime, echo_date echoDate, IFNULL(echo_opened,0) echoOpened " +
    "FROM mood_records WHERE user_id=? AND echo_date IS NOT NULL AND echo_date<=NOW() ORDER BY echo_date DESC LIMIT 30",
    [userId]
  );
  return rows || [];
}
async function mePayload(userId) {
  const p = await conn();
  const [[r7]] = await p.query("SELECT COUNT(*) c, COALESCE(AVG(mood_score),55) a FROM mood_records WHERE user_id=? AND create_time>=DATE_SUB(CURDATE(), INTERVAL 7 DAY)", [userId]);
  const [[r3]] = await p.query("SELECT COALESCE(AVG(mood_score),55) a FROM (SELECT mood_score FROM mood_records WHERE user_id=? ORDER BY create_time DESC LIMIT 3)t", [userId]);
  const [[rl]] = await p.query("SELECT COALESCE(mood_score,55) s FROM mood_records WHERE user_id=? ORDER BY create_time DESC LIMIT 1", [userId]);
  const state = weatherState(Number(r7.a), Number(r3.a), Number(rl ? rl.s : r3.a), Number(r7.c));
  const [greeting, subtitle] = weatherText(state);
  return {
    weatherState: state,
    weatherGreeting: greeting,
    weatherSubtitle: subtitle,
    unreadPrivateCount: await unreadCount(userId),
    echoPendingCount: await echoPendingCount(userId)
  };
}
function normalizeRpsMove(v) {
  const raw = String(v || "").trim();
  const x = raw.toLowerCase();
  if (["rock", "r", "1"].includes(x) || raw.includes("石") || raw.includes("鐭")) return "rock";
  if (["scissors", "s", "2"].includes(x) || raw.includes("剪") || raw.includes("鍓")) return "scissors";
  if (["paper", "p", "3"].includes(x) || raw.includes("布") || raw.includes("甯")) return "paper";
  return "";
}
function humanMove(v) {
  if (v === "rock") return "石头";
  if (v === "scissors") return "剪刀";
  if (v === "paper") return "布";
  return "";
}

function rpsReason(user, ai) {
  if (user === ai) return "你们出的一样，这一局是平局。";
  if (user === "rock" && ai === "scissors") return "石头克剪刀，所以你赢了。";
  if (user === "scissors" && ai === "paper") return "剪刀克布，所以你赢了。";
  if (user === "paper" && ai === "rock") return "布克石头，所以你赢了。";
  return "这局对方刚好克制了你的出招，所以你输了。";
}

function rpsWarmReply(result) {
  const win = [
    "很好，你的节奏很稳，像是给自己打了一个小小的“我可以”的信号。",
    "漂亮的一局。赢不是为了证明什么，而是提醒你：你也能把事情做对。",
    "你抓得很准。把这份确定感，先轻轻放进今天的口袋里。"
  ];
  const lose = [
    "没关系，这一局只是一个回合，不是你今天的全部。",
    "输一局也很正常。我们可以把它当作一次轻量的放松，而不是对错。",
    "别急着责备自己。下一局，我们慢慢来，给自己一点空间。"
  ];
  const draw = [
    "默契局。像两朵云刚好飘到同一条风里。",
    "平局也很可爱，说明你们在同一个节奏上停了一下。",
    "这一局像是暂停键。呼吸一下，再继续也不迟。"
  ];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (result === "WIN") return pick(win);
  if (result === "LOSE") return pick(lose);
  return pick(draw);
}

function rpsNextHint(result) {
  const hints = {
    WIN: [
      "想再玩一局的话，可以试试换一种出法，保持灵活。",
      "如果你愿意，把刚才那一下“赢”的轻松感，留给自己 10 秒钟就好。"
    ],
    LOSE: [
      "下一局可以先用“布”试探一下，或者干脆随心选一个，让手替你做决定。",
      "如果你觉得紧绷，先把肩膀放松一下，再出招。我们不是在考试。"
    ],
    DRAW: [
      "要不要试试刻意换一个出法，看看节奏会不会不一样？",
      "平局之后更适合随心一点，随便出一个就好。"
    ]
  };
  const arr = hints[result] || hints.DRAW;
  return arr[Math.floor(Math.random() * arr.length)];
}

function rpsMicroPractice(result) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (result === "LOSE") {
    return pick([
      "微练习：把下颌放松，肩膀轻轻往下沉一下，然后慢慢呼气到 6 秒。",
      "微练习：把手掌贴在胸口 5 秒钟，感受一下心跳的节奏，再继续。",
      "微练习：看向屏幕外的一个固定点，默数 3 次呼吸，让注意力回到当下。"
    ]);
  }
  if (result === "WIN") {
    return pick([
      "微练习：闭眼 2 秒，感受一下身体哪里更放松了，把这种放松记住。",
      "微练习：轻轻吸气 4 秒，呼气 6 秒，让身体把“顺利”的感觉接住。",
      "微练习：给自己一句很小的肯定，比如“我在变好”，只说一遍就够。"
    ]);
  }
  return pick([
    "微练习：把视线从屏幕移开 2 秒，回来看一眼，再出招，节奏会更稳。",
    "微练习：吸气 4 秒，呼气 4 秒，像按下一个温柔的暂停键。",
    "微练习：感受一下脚踩在地面的支撑感，确认自己是安全的、稳的。"
  ]);
}

function rpsReflection(result) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (result === "WIN") {
    return pick([
      "小复盘：你在“很快做决定”这件事上做得不错。哪怕只是一个小游戏，也说明你有能力把握节奏。",
      "小复盘：你刚才的出招像是一次清爽的落点。把这份干净利落，借给今天别的事情一点点。",
      "小复盘：赢的感觉不需要夸张地庆祝，它更像一盏小灯：你可以、你也值得被肯定。"
    ]);
  }
  if (result === "LOSE") {
    return pick([
      "小复盘：输掉的一局不会定义你。它只是告诉我们：此刻的你可能更需要被安抚，而不是被催促。",
      "小复盘：如果你有一点失落，这是很自然的反应。我们先允许它存在，再决定要不要继续玩。",
      "小复盘：你没有做错什么，只是遇到了克制关系。把“对错”放下，留下“继续也可以”的余地。"
    ]);
  }
  return pick([
    "小复盘：平局像一次同步呼吸。你和对方都停在同一拍上，挺温柔的。",
    "小复盘：平局并不尴尬，它像是提醒我们：不必急着赢，先把自己安顿好也很重要。",
    "小复盘：你没有落后，也没有领先。只是刚好在中间停了一下，允许自己慢一点。"
  ]);
}

const AI_API_KEY =
  process.env.ARK_API_KEY ||
  process.env.VOLCENGINE_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.AI_API_KEY ||
  "";
const AI_BASE_URL = (
  process.env.ARK_BASE_URL ||
  process.env.VOLCENGINE_BASE_URL ||
  process.env.AI_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  "https://api.openai.com/v1"
).replace(/\/+$/, "");
const AI_MODEL =
  process.env.ARK_MODEL ||
  process.env.VOLCENGINE_MODEL ||
  process.env.AI_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-4.1-mini";
const AI_PROXY_URL = process.env.AI_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
const AI_PROVIDER = (AI_BASE_URL.includes("volces.com") || AI_MODEL.startsWith("ep-")) ? "ark" : "openai_compat";
const realDnsResolver = new dns.promises.Resolver();
realDnsResolver.setServers(["223.5.5.5", "119.29.29.29", "1.1.1.1", "8.8.8.8"]);
const dohCache = new Map();

function isFakeIp(ip) {
  return /^198\.18\./.test(ip || "");
}

async function resolveIpv4ByDoh(hostname) {
  const key = String(hostname || "").toLowerCase();
  const now = Date.now();
  const cached = dohCache.get(key);
  if (cached && cached.expireAt > now) return cached.ip;

  const endpoints = [
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`
  ];

  for (const ep of endpoints) {
    try {
      const resp = await fetchWithTimeout(
        ep,
        {
          method: "GET",
          headers: ep.includes("cloudflare-dns.com") ? { accept: "application/dns-json" } : undefined
        },
        1800
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      const answers = Array.isArray(data?.Answer) ? data.Answer : [];
      const ip = answers.map((a) => String(a?.data || "").trim()).find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x) && !isFakeIp(x));
      if (ip) {
        dohCache.set(key, { ip, expireAt: now + 60 * 1000 });
        return ip;
      }
    } catch (_) {}
  }
  throw new Error("DOH_RESOLVE_FAILED");
}

function realLookup(hostname, options, callback) {
  if (!hostname || hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return dns.lookup(hostname, options, callback);
  }
  resolveIpv4ByDoh(hostname)
    .then((ip) => callback(null, ip, 4))
    .catch(() =>
      realDnsResolver.resolve4(hostname)
        .then((ips) => {
          const list = (ips || []).filter((ip) => !isFakeIp(ip));
          const chosen = list[0] || (ips && ips[0]);
          if (!chosen) return dns.lookup(hostname, options, callback);
          callback(null, chosen, 4);
        })
        .catch(() => dns.lookup(hostname, options, callback))
    );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("NETWORK_TIMEOUT");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function generateAiText({ systemPrompt, userPrompt, maxOutputTokens = 220, temperature = 0.8 }) {
  if (!AI_API_KEY) throw new Error("NO_AI_KEY");
  const isArk = AI_BASE_URL.includes("volces.com") || AI_MODEL.startsWith("ep-");
  const arkCandidates = [
    AI_BASE_URL,
    "https://ark.cn-beijing.volces.com/api/v3",
    "https://ark.cn-shanghai.volces.com/api/v3",
    "https://ark.cn-hangzhou.volces.com/api/v3"
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AI_API_KEY}`
  };

  if (!isArk) {
    try {
      const resp = await fetchWithTimeout(`${AI_BASE_URL}/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: AI_MODEL,
          temperature,
          max_output_tokens: maxOutputTokens,
          input: [
            { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
            { role: "user", content: [{ type: "input_text", text: userPrompt }] }
          ]
        })
      }, 2000);
      if (!resp.ok) throw new Error(`RESPONSES_${resp.status}`);
      const data = await resp.json();
      const txt = (data.output_text || "").trim();
      if (txt) return txt;
    } catch (_) {}
  }

  const proxyConfig = (() => {
    if (!AI_PROXY_URL) return null;
    try {
      const u = new URL(AI_PROXY_URL);
      return {
        protocol: u.protocol.replace(":", ""),
        host: u.hostname,
        port: Number(u.port || (u.protocol === "https:" ? 443 : 80))
      };
    } catch (_) {
      return null;
    }
  })();

  const attemptOnce = async (base, useProxy) => {
    const proxyAgent = useProxy && AI_PROXY_URL ? new HttpsProxyAgent(AI_PROXY_URL) : null;
    const resp = await axios.post(
      `${base}/chat/completions`,
      {
        model: AI_MODEL,
        temperature,
        max_tokens: maxOutputTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      },
      {
        timeout: 12000,
        headers,
        httpsAgent: proxyAgent || undefined,
        proxy: false,
        validateStatus: () => true
      }
    );
    if (resp.status < 200 || resp.status >= 300) {
      const errMsg = resp?.data?.error?.message || `CHAT_${resp.status}`;
      throw new Error(errMsg);
    }
    const txt = (resp?.data?.choices?.[0]?.message?.content || "").trim();
    if (!txt) throw new Error("EMPTY_AI_REPLY");
    return txt;
  };

  const errs = [];
  const bases = isArk ? arkCandidates : [AI_BASE_URL];
  for (const base of bases) {
    try {
      return await attemptOnce(base, false);
    } catch (e1) {
      errs.push(`${base}::${e1.code || e1.message || "ERR"}`);
      if (proxyConfig) {
        try {
          return await attemptOnce(base, true);
        } catch (e2) {
          errs.push(`${base}::PROXY::${e2.code || e2.message || "ERR"}`);
        }
      }
    }
  }
  throw new Error(errs.join(" | ") || "UPSTREAM_ERROR");
}

app.post("/api/auth/login", async (req, res) => {
  const p = await conn();
  const { username, password } = req.body;
  const [rows] = await p.query("SELECT * FROM users WHERE username=? AND password=? LIMIT 1", [username, password]);
  if (!rows.length) return res.json({ ok: false, message: "用户名或密码错误" });
  const u = rows[0];
  req.session.user = {
    id: u.id,
    username: u.username,
    role: u.role,
    aiChatEnabled: u.ai_chat_enabled === 1,
    publicSquareEnabled: u.public_square_enabled === 1,
    nickname: u.nickname,
    avatarUrl: u.avatar_url,
    bio: u.bio,
    aiName: u.ai_name,
    aiPersona: u.ai_persona,
    aiAddressing: u.ai_addressing,
    aiSupportStyle: u.ai_support_style,
    aiTaboo: u.ai_taboo
  };
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/auth/register", async (req, res) => {
  const p = await conn();
  const { username, password, confirmPassword } = req.body;
  const aiName = String(req.body.aiName || "").trim().slice(0, 60) || "小树";
  const aiPersona = String(req.body.aiPersona || "").trim().slice(0, 60) || "温柔陪伴";
  if (!password || password !== confirmPassword) return res.json({ ok: false, message: "两次密码不一致" });
  const [exists] = await p.query("SELECT id FROM users WHERE username=?", [username]);
  if (exists.length) return res.json({ ok: false, message: "用户名已存在" });
  await p.query(
    "INSERT INTO users (username,password,role,ai_chat_enabled,public_square_enabled,ai_name,ai_persona) VALUES (?,?, 'USER',1,1,?,?)",
    [username, password, aiName, aiPersona]
  );
  res.json({ ok: true });
});
app.post("/api/auth/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", needLogin, async (req, res) => res.json({ ok: true, user: req.session.user, ...(await mePayload(req.session.user.id)) }));

app.get("/api/moods", needLogin, async (req, res) => {
  const p = await conn();
  const [rows] = await p.query(
    "SELECT id,content,ai_tag,mood_score,is_public,ai_comment,ai_practice,ai_action,create_time FROM mood_records WHERE user_id=? ORDER BY create_time DESC",
    [req.session.user.id]
  );
  res.json({ ok: true, moods: rows });
});
app.post("/api/moods", needLogin, async (req, res) => {
  const p = await conn();
  const { content } = req.body;
  let isPublic = req.body.isPublic === "1" || req.body.isPublic === 1 ? 1 : 0;
  if (!req.session.user.publicSquareEnabled) isPublic = 0;
  const score = Math.max(1, Math.min(100, Number(req.body.moodScore || 60)));
  const { name: aiName, persona: aiPersona } = aiIdentity(req.session.user);
  const { addressing, supportStyle, taboo } = aiCareProfile(req.session.user);
  const tag = score < 35 ? "悲伤" : score < 50 ? "疲惫" : score < 65 ? "平静" : score < 80 ? "轻松" : "喜悦";
  let comment = "";
  let practice = "";
  let action = "";
  try {
    const pack = await generateAiMoodPack({ aiName, aiPersona, addressing, supportStyle, taboo, content, tag, score });
    comment = pack.comment;
    practice = pack.practice;
    action = pack.action;
  } catch (_) {
    comment = "谢谢你认真记录这一刻。先把心安顿好，慢慢来就很好。";
    const fb = moodExtraFallback(tag, score);
    practice = fb.practice;
    action = fb.action;
  }
  if (comment && !String(comment).startsWith(`${aiName}：`)) comment = `${aiName}：${comment}`;
  await p.query(
    "INSERT INTO mood_records (user_id,content,ai_tag,mood_score,is_public,ai_comment,ai_practice,ai_action,echo_date,echo_opened) VALUES (?,?,?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 100 DAY),0)",
    [req.session.user.id, content || "", tag, score, isPublic, comment, practice, action]
  );
  res.json({ ok: true });
});
app.delete("/api/moods/:id", needLogin, async (req, res) => {
  const p = await conn();
  await p.query("DELETE FROM mood_records WHERE id=? AND user_id=?", [req.params.id, req.session.user.id]);
  res.json({ ok: true });
});

app.get("/api/square", needLogin, async (req, res) => {
  if (!req.session.user.publicSquareEnabled) return res.json({ ok: false, message: "匿名广场已被管理员禁用" });
  const p = await conn();
  const [rows] = await p.query(
    "SELECT m.*, (SELECT COUNT(*) FROM likes WHERE mood_id=m.id) likeCount, " +
    "(SELECT COUNT(*) FROM likes WHERE mood_id=m.id AND user_id=?) hasLiked " +
    "FROM mood_records m WHERE m.is_public=1 ORDER BY m.is_pinned DESC, m.create_time DESC",
    [req.session.user.id]
  );
  res.json({
    ok: true,
    moods: rows.map((r) => ({
      ...r,
      username: `树洞旅人 ${String(Math.abs(r.user_id % 100)).padStart(2, "0")}`,
      hasLiked: r.hasLiked > 0
    }))
  });
});
app.post("/api/square/like", needLogin, async (req, res) => {
  const p = await conn();
  await p.query("INSERT IGNORE INTO likes (user_id,mood_id) VALUES (?,?)", [req.session.user.id, req.body.moodId]);
  res.json({ ok: true });
});

app.get("/api/private/chats", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const includeHidden = String(req.query.includeHidden || "") === "1";
  const hiddenWhere = includeHidden ? "1=1" : "COALESCE(s.hidden,0)=0";
  const [rows] = await p.query(
    "SELECT t.partner_id receiverId, t.latest_time createTime, t.latest_message message, t.unread_count unreadCount, " +
    "COALESCE(s.pinned,0) pinned, COALESCE(s.muted,0) muted, COALESCE(s.hidden,0) hidden " +
    "FROM (" +
    " SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END partner_id, MAX(create_time) latest_time, " +
    " SUBSTRING_INDEX(GROUP_CONCAT(message ORDER BY create_time DESC SEPARATOR '\\n'),'\\n',1) latest_message, " +
    " SUM(CASE WHEN receiver_id=? AND (is_read=0 OR is_read IS NULL) THEN 1 ELSE 0 END) unread_count " +
    " FROM private_messages WHERE sender_id=? OR receiver_id=? " +
    " GROUP BY CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END" +
    ") t " +
    "LEFT JOIN private_chat_settings s ON s.user_id=? AND s.partner_id=t.partner_id " +
    "LEFT JOIN user_blocks b1 ON b1.blocker_id=? AND b1.blocked_id=t.partner_id " +
    "LEFT JOIN user_blocks b2 ON b2.blocker_id=t.partner_id AND b2.blocked_id=? " +
    `WHERE ${hiddenWhere} AND b1.blocker_id IS NULL AND b2.blocker_id IS NULL ` +
    "ORDER BY COALESCE(s.pinned,0) DESC, t.latest_time DESC",
    [uid, uid, uid, uid, uid, uid, uid, uid]
  );
  res.json({
    ok: true,
    chats: rows.map((r) => ({
      ...r,
      username: `树洞旅人 ${String(Math.abs(r.receiverId % 100)).padStart(2, "0")}`,
      pinned: Number(r.pinned || 0),
      muted: Number(r.muted || 0),
      hidden: Number(r.hidden || 0)
    })),
    unreadPrivateCount: await unreadCount(uid)
  });
});
app.post("/api/private/settings", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const tid = Number(req.body.targetId);
  if (!tid || tid === uid) return res.json({ ok: false, message: "参数错误" });
  const [[cur]] = await p.query("SELECT pinned, muted, hidden FROM private_chat_settings WHERE user_id=? AND partner_id=? LIMIT 1", [uid, tid]);
  const to01 = (v) => (v === 1 || v === "1" || v === true ? 1 : 0);
  const pinned = req.body.pinned === undefined ? Number(cur?.pinned || 0) : to01(req.body.pinned);
  const muted = req.body.muted === undefined ? Number(cur?.muted || 0) : to01(req.body.muted);
  const hidden = req.body.hidden === undefined ? Number(cur?.hidden || 0) : to01(req.body.hidden);
  await p.query(
    "INSERT INTO private_chat_settings (user_id,partner_id,pinned,muted,hidden) VALUES (?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE pinned=VALUES(pinned), muted=VALUES(muted), hidden=VALUES(hidden)",
    [uid, tid, pinned, muted, hidden]
  );
  res.json({ ok: true });
});
app.post("/api/private/block", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const tid = Number(req.body.targetId);
  if (!tid || tid === uid) return res.json({ ok: false, message: "参数错误" });
  const blocked = req.body.blocked === 1 || req.body.blocked === "1" ? 1 : 0;
  if (blocked) {
    await p.query("INSERT IGNORE INTO user_blocks (blocker_id,blocked_id) VALUES (?,?)", [uid, tid]);
    await p.query(
      "INSERT INTO private_chat_settings (user_id,partner_id,pinned,muted,hidden) VALUES (?,?,0,0,1) " +
        "ON DUPLICATE KEY UPDATE hidden=1, pinned=0",
      [uid, tid]
    );
  } else {
    await p.query("DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?", [uid, tid]);
    // Unblock should restore the chat visibility, otherwise it will "disappear" from the list.
    await p.query(
      "INSERT INTO private_chat_settings (user_id,partner_id,pinned,muted,hidden) VALUES (?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE hidden=0",
      [uid, tid, 0, 0, 0]
    );
  }
  res.json({ ok: true });
});
app.get("/api/private/messages/:targetId", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const tid = Number(req.params.targetId);
  const [[b1]] = await p.query("SELECT 1 x FROM user_blocks WHERE blocker_id=? AND blocked_id=? LIMIT 1", [uid, tid]);
  const [[b2]] = await p.query("SELECT 1 x FROM user_blocks WHERE blocker_id=? AND blocked_id=? LIMIT 1", [tid, uid]);
  await p.query("UPDATE private_messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND (is_read=0 OR is_read IS NULL)", [tid, uid]);
  const [rows] = await p.query(
    "SELECT id, sender_id senderId, receiver_id receiverId, message, create_time createTime FROM private_messages " +
    "WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY create_time ASC",
    [uid, tid, tid, uid]
  );
  res.json({
    ok: true,
    targetAlias: `树洞旅人 ${String(Math.abs(tid % 100)).padStart(2, "0")}`,
    records: rows,
    blockedByMe: !!b1,
    blockedMe: !!b2,
    unreadPrivateCount: await unreadCount(uid)
  });
});
app.post("/api/private/messages", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const tid = Number(req.body.targetId);
  const msg = String(req.body.message || "").trim();
  if (!msg) return res.json({ ok: false, message: "消息不能为空" });
  if (tid === uid) return res.json({ ok: false, message: "不能给自己发消息" });
  const [[b1]] = await p.query("SELECT 1 x FROM user_blocks WHERE blocker_id=? AND blocked_id=? LIMIT 1", [uid, tid]);
  const [[b2]] = await p.query("SELECT 1 x FROM user_blocks WHERE blocker_id=? AND blocked_id=? LIMIT 1", [tid, uid]);
  if (b1) return res.json({ ok: false, message: "你已拉黑对方，无法发送消息" });
  if (b2) return res.json({ ok: false, message: "对方已拒收你的私聊消息" });
  await p.query("INSERT INTO private_messages (sender_id, receiver_id, message, is_read) VALUES (?,?,?,0)", [uid, tid, msg]);
  res.json({ ok: true });
});

app.get("/api/ai/records", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const [countRows] = await p.query("SELECT COUNT(*) c FROM chat_records WHERE user_id=?", [uid]);
  if (!Number(countRows[0]?.c || 0)) {
    const { name } = aiIdentity(req.session.user);
    const { addressing } = aiCareProfile(req.session.user);
    const greeting = `你好，我是${name}。这里是温馨树洞，欢迎你的倾诉。${addressing ? `我会称呼你为“${addressing}”。` : ""}`;
    await p.query("INSERT INTO chat_records (user_id,sender,message) VALUES (?,?,?)", [uid, "ai", greeting]);
  }
  const [rows] = await p.query("SELECT id, sender, message, create_time createTime FROM chat_records WHERE user_id=? ORDER BY create_time ASC", [uid]);
  res.json({ ok: true, records: rows });
});
app.delete("/api/ai/records", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  await p.query("DELETE FROM chat_records WHERE user_id=?", [uid]);
  const { name } = aiIdentity(req.session.user);
  const { addressing } = aiCareProfile(req.session.user);
  const greeting = `你好，我是${name}。这里是温馨树洞，欢迎你的倾诉。${addressing ? `我会称呼你为“${addressing}”。` : ""}`;
  await p.query("INSERT INTO chat_records (user_id,sender,message) VALUES (?,?,?)", [uid, "ai", greeting]);
  res.json({ ok: true });
});
app.post("/api/ai/chat", needLogin, async (req, res) => {
  const p = await conn();
  if (!req.session.user.aiChatEnabled) return res.json({ ok: false, message: "AI对话已被管理员禁用" });
  const msg = String(req.body.msg || "").trim();
  if (!msg) return res.json({ ok: false, message: "消息不能为空" });
  const { name: aiName, persona: aiPersona } = aiIdentity(req.session.user);
  const { addressing, supportStyle, taboo } = aiCareProfile(req.session.user);
  const styledMsg = `你是${aiName}，请以“${aiPersona}”的风格回复。用户消息：${msg}`;
  let reply = "";
  let aiSource = "fallback";
  let aiReason = "UNKNOWN";
  try {
    reply = await generateAiText({
      systemPrompt:
        [
          `你是名为“${aiName}”的心理陪伴助手，性格是“${aiPersona}”。`,
          addressing ? `用户希望被称呼为：${addressing}。` : "",
          supportStyle ? `用户偏好陪伴方式：${supportStyle}。` : "",
          taboo ? `用户雷区/不想被提及：${taboo}。请严格避免。` : "",
          "请使用中文回复，2-5句，先共情，再给一个可执行的小建议。不要下医学诊断，不要夸大承诺，不要说教，不要用命令式口吻。"
        ]
          .filter(Boolean)
          .join(""),
      userPrompt: styledMsg,
      maxOutputTokens: 260,
      temperature: 0.8
    });
    aiSource = "real";
    aiReason = "OK";
  } catch (e) {
    aiReason = AI_API_KEY ? (e?.message || "UPSTREAM_ERROR") : "NO_AI_KEY";
    reply = `${aiName}在呢，我们一步一步来。`;
    reply = "我在，慢慢说。你的感受很重要，我们一步一步来。";
  }
  if (aiSource !== "real") reply = `${aiName}在呢，我们一步一步来。`;
  await p.query("INSERT INTO chat_records (user_id,sender,message) VALUES (?,?,?)", [req.session.user.id, "user", msg]);
  await p.query("INSERT INTO chat_records (user_id,sender,message) VALUES (?,?,?)", [req.session.user.id, "ai", reply]);
  res.json({ ok: true, reply, aiSource, aiReason, aiProvider: AI_PROVIDER });
});

app.get("/api/graph", needLogin, async (req, res) => {
  const p = await conn();
  const [rows] = await p.query(
    "SELECT DATE(create_time) dt, AVG(mood_score) avg_score FROM mood_records " +
    "WHERE user_id=? AND create_time>=DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY DATE(create_time) ORDER BY dt ASC",
    [req.session.user.id]
  );
  res.json({ ok: true, dates: rows.map((x) => String(x.dt).slice(5, 10)), scores: rows.map((x) => Number(x.avg_score || 0)) });
});

app.get("/api/echo", needLogin, async (req, res) => {
  const uid = req.session.user.id;
  const records = await echoRecords(uid);
  res.json({ ok: true, records, pendingCount: await echoPendingCount(uid) });
});
app.post("/api/echo/open", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const id = Number(req.body.id || 0);
  if (id > 0) {
    await p.query("UPDATE mood_records SET echo_opened=1 WHERE id=? AND user_id=?", [id, uid]);
  } else {
    await p.query("UPDATE mood_records SET echo_opened=1 WHERE user_id=? AND echo_date IS NOT NULL AND echo_date<=NOW()", [uid]);
  }
  res.json({ ok: true, pendingCount: await echoPendingCount(uid) });
});

app.post("/api/game/play", needLogin, async (req, res) => {
  const user = normalizeRpsMove(req.body.move);
  if (!user) return res.json({ ok: false, message: "出招无效" });
  const ai = ["rock", "scissors", "paper"][Math.floor(Math.random() * 3)];
  const win = (user === "rock" && ai === "scissors") || (user === "scissors" && ai === "paper") || (user === "paper" && ai === "rock");
  const result = user === ai ? "DRAW" : win ? "WIN" : "LOSE";
  const userMove = humanMove(user);
  const aiMove = humanMove(ai);
  const reason = rpsReason(user, ai);
  const warm = rpsWarmReply(result);
  const hint = rpsNextHint(result);
  const reflection = rpsReflection(result);
  const practice = rpsMicroPractice(result);
  const resultText = result === "WIN" ? "你赢了" : result === "LOSE" ? "你输了" : "平局";
  const detail =
    `这一局回放\n` +
    `你出：${userMove}\n` +
    `我出：${aiMove}\n` +
    `结果：${resultText}\n` +
    `原因：${reason}\n\n` +
    `${warm}\n\n` +
    `${reflection}\n\n` +
    `${practice}\n` +
    `下一步：${hint}\n\n` +
    `如果你愿意，也可以告诉我：你现在更像“紧绷 / 疲惫 / 空空的 / 还好”？我会按你的状态陪你玩。`;
  res.json({
    ok: true,
    aiMove,
    userMove,
    result,
    resultText,
    quote: warm,
    reason,
    hint,
    reflection,
    practice,
    detail
  });
});
app.post("/api/game/pet", needLogin, (req, res) => {
  const animal = String(req.body.animal || "cat");
  const map = {
    cat: ["小猫", "小猫蹭了蹭你，呼噜声很治愈。", "治愈值 +18"],
    dog: ["小狗", "小狗摇着尾巴扑过来。", "活力值 +12"],
    rabbit: ["小兔", "小兔安静地靠在你手边。", "平静值 +15"]
  };
  const x = map[animal] || map.cat;
  res.json({ ok: true, animalName: x[0], feedback: x[1], energy: x[2] });
});

app.get("/api/profile", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const [[u]] = await p.query(
    "SELECT username, role, ai_chat_enabled, public_square_enabled, nickname, avatar_url avatarUrl, bio, ai_name aiName, ai_persona aiPersona, " +
      "ai_addressing aiAddressing, ai_support_style aiSupportStyle, ai_taboo aiTaboo " +
      "FROM users WHERE id=?",
    [uid]
  );
  const [[s1]] = await p.query("SELECT COUNT(*) total, COALESCE(AVG(mood_score),0) avgScore FROM mood_records WHERE user_id=?", [uid]);
  const [[s2]] = await p.query("SELECT COUNT(*) publicMoods FROM mood_records WHERE user_id=? AND is_public=1", [uid]);
  const [[s3]] = await p.query("SELECT COUNT(*) totalLikesReceived FROM likes WHERE mood_id IN (SELECT id FROM mood_records WHERE user_id=?)", [uid]);
  res.json({
    ok: true,
    profile: { ...u, aiChatEnabled: u.ai_chat_enabled === 1, publicSquareEnabled: u.public_square_enabled === 1 },
    ...s1,
    ...s2,
    ...s3,
    profileAlias: `树洞旅人 ${String(Math.abs(uid % 100)).padStart(2, "0")}`
  });
});
app.post("/api/profile", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const nickname = (req.body.nickname || "").trim() || null;
  const bio = (req.body.bio || "").trim() || null;
  const avatarUrl = (req.body.avatarUrl || "").trim() || null;
  const aiName = (req.body.aiName || "").trim().slice(0, 60) || null;
  const aiPersona = (req.body.aiPersona || "").trim().slice(0, 60) || null;
  const aiAddressing = (req.body.aiAddressing || "").trim().slice(0, 60) || null;
  const aiSupportStyle = (req.body.aiSupportStyle || "").trim().slice(0, 60) || null;
  const aiTaboo = (req.body.aiTaboo || "").trim().slice(0, 300) || null;
  await p.query(
    "UPDATE users SET nickname=?, avatar_url=?, bio=?, ai_name=?, ai_persona=?, ai_addressing=?, ai_support_style=?, ai_taboo=? WHERE id=?",
    [nickname, avatarUrl, bio, aiName, aiPersona, aiAddressing, aiSupportStyle, aiTaboo, uid]
  );
  const [rows] = await p.query("SELECT * FROM users WHERE id=?", [uid]);
  const u = rows[0];
  req.session.user = {
    ...req.session.user,
    nickname: u.nickname,
    avatarUrl: u.avatar_url,
    bio: u.bio,
    aiName: u.ai_name,
    aiPersona: u.ai_persona,
    aiAddressing: u.ai_addressing,
    aiSupportStyle: u.ai_support_style,
    aiTaboo: u.ai_taboo
  };
  res.json({ ok: true });
});
app.post("/api/profile/avatar", needLogin, upload.single("avatar"), async (req, res) => {
  if (!req.file) return res.json({ ok: false, message: "未选择文件" });
  const ext = path.extname(req.file.originalname || ".png");
  const fileName = `u${req.session.user.id}_${Date.now()}${ext}`;
  const target = path.join(__dirname, "uploads", fileName);
  fs.renameSync(req.file.path, target);
  const avatarUrl = `/uploads/${fileName}`;
  const p = await conn();
  await p.query("UPDATE users SET avatar_url=? WHERE id=?", [avatarUrl, req.session.user.id]);
  req.session.user.avatarUrl = avatarUrl;
  res.json({ ok: true, avatarUrl });
});

app.get("/api/admin/users", needLogin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, message: "FORBIDDEN" });
  const p = await conn();
  const [rows] = await p.query("SELECT id, username, role, ai_chat_enabled, public_square_enabled FROM users ORDER BY role DESC, id ASC");
  res.json({ ok: true, users: rows.map((r) => ({ ...r, aiChatEnabled: r.ai_chat_enabled === 1, publicSquareEnabled: r.public_square_enabled === 1 })) });
});
app.post("/api/admin/toggle-ai", needLogin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, message: "FORBIDDEN" });
  const p = await conn();
  await p.query("UPDATE users SET ai_chat_enabled=CASE WHEN ai_chat_enabled=1 THEN 0 ELSE 1 END WHERE id=? AND role<>'ADMIN'", [req.body.targetId]);
  res.json({ ok: true });
});
app.post("/api/admin/toggle-square", needLogin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, message: "FORBIDDEN" });
  const p = await conn();
  await p.query("UPDATE users SET public_square_enabled=CASE WHEN public_square_enabled=1 THEN 0 ELSE 1 END WHERE id=? AND role<>'ADMIN'", [req.body.targetId]);
  res.json({ ok: true });
});

app.post("/api/admin/delete-mood", needLogin, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, message: "FORBIDDEN" });
  const { moodId } = req.body;
  if (!moodId) return res.json({ ok: false, message: "缺失 ID" });
  const p = await conn();
  await p.query("DELETE FROM mood_records WHERE id=?", [moodId]);
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 3000);
conn()
  .then(() => app.listen(port, () => console.log(`API server http://localhost:${port}`)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
