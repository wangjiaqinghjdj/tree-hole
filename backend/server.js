const express = require("express");
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
    await c.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'USER'");
    await c.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_chat_enabled TINYINT NOT NULL DEFAULT 1");
    await c.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS public_square_enabled TINYINT NOT NULL DEFAULT 1");
    await c.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(60) NULL");
    await c.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255) NULL");
    await c.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(300) NULL");
    await c.query("ALTER TABLE mood_records ADD COLUMN IF NOT EXISTS is_pinned TINYINT DEFAULT 0");
    await c.query("ALTER TABLE mood_records ADD COLUMN IF NOT EXISTS echo_date DATETIME NULL");
    await c.query("ALTER TABLE mood_records ADD COLUMN IF NOT EXISTS echo_opened TINYINT DEFAULT 0");
    await c.query("ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS is_read TINYINT DEFAULT 0");
    await c.query(
      "CREATE TABLE IF NOT EXISTS private_messages (" +
        "id INT AUTO_INCREMENT PRIMARY KEY, sender_id INT NOT NULL, receiver_id INT NOT NULL, message TEXT NOT NULL, " +
        "is_read TINYINT DEFAULT 0, create_time DATETIME DEFAULT CURRENT_TIMESTAMP" +
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
app.use(
  session({
    secret: "tree-hole-dev-secret",
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
async function mePayload(userId) {
  const p = await conn();
  const [[r7]] = await p.query("SELECT COUNT(*) c, COALESCE(AVG(mood_score),55) a FROM mood_records WHERE user_id=? AND create_time>=DATE_SUB(CURDATE(), INTERVAL 7 DAY)", [userId]);
  const [[r3]] = await p.query("SELECT COALESCE(AVG(mood_score),55) a FROM (SELECT mood_score FROM mood_records WHERE user_id=? ORDER BY create_time DESC LIMIT 3)t", [userId]);
  const [[rl]] = await p.query("SELECT COALESCE(mood_score,55) s FROM mood_records WHERE user_id=? ORDER BY create_time DESC LIMIT 1", [userId]);
  const state = weatherState(Number(r7.a), Number(r3.a), Number(rl ? rl.s : r3.a), Number(r7.c));
  const [greeting, subtitle] = weatherText(state);
  return { weatherState: state, weatherGreeting: greeting, weatherSubtitle: subtitle, unreadPrivateCount: await unreadCount(userId) };
}

app.post("/api/auth/login", async (req, res) => {
  const p = await conn();
  const { username, password } = req.body;
  const [rows] = await p.query("SELECT * FROM users WHERE username=? AND password=? LIMIT 1", [username, password]);
  if (!rows.length) return res.json({ ok: false, message: "用户名或密码错误" });
  const u = rows[0];
  req.session.user = {
    id: u.id, username: u.username, role: u.role,
    aiChatEnabled: u.ai_chat_enabled === 1,
    publicSquareEnabled: u.public_square_enabled === 1,
    nickname: u.nickname, avatarUrl: u.avatar_url, bio: u.bio
  };
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/auth/register", async (req, res) => {
  const p = await conn();
  const { username, password, confirmPassword } = req.body;
  if (!password || password !== confirmPassword) return res.json({ ok: false, message: "两次密码不一致" });
  const [exists] = await p.query("SELECT id FROM users WHERE username=?", [username]);
  if (exists.length) return res.json({ ok: false, message: "用户名已存在" });
  await p.query("INSERT INTO users (username,password,role,ai_chat_enabled,public_square_enabled) VALUES (?,?, 'USER',1,1)", [username, password]);
  res.json({ ok: true });
});
app.post("/api/auth/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", needLogin, async (req, res) => res.json({ ok: true, user: req.session.user, ...(await mePayload(req.session.user.id)) }));

app.get("/api/moods", needLogin, async (req, res) => {
  const p = await conn();
  const [rows] = await p.query("SELECT id,content,ai_tag,mood_score,is_public,ai_comment,create_time FROM mood_records WHERE user_id=? ORDER BY create_time DESC", [req.session.user.id]);
  res.json({ ok: true, moods: rows });
});
app.post("/api/moods", needLogin, async (req, res) => {
  const p = await conn();
  const { content } = req.body;
  let isPublic = req.body.isPublic === "1" || req.body.isPublic === 1 ? 1 : 0;
  if (!req.session.user.publicSquareEnabled) isPublic = 0;
  const score = Math.max(1, Math.min(100, Number(req.body.moodScore || 60)));
  const tag = score < 35 ? "悲伤" : score < 50 ? "疲惫" : score < 65 ? "平静" : score < 80 ? "轻松" : "喜悦";
  const comment = req.body.aiComment || "谢谢你认真记录这一刻。先把心安顿好，慢慢来就很好。";
  await p.query(
    "INSERT INTO mood_records (user_id,content,ai_tag,mood_score,is_public,ai_comment,echo_date,echo_opened) VALUES (?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 100 DAY),0)",
    [req.session.user.id, content || "", tag, score, isPublic, comment]
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
  res.json({ ok: true, moods: rows.map(r => ({ ...r, username: `树洞旅人 ${String(Math.abs(r.user_id % 100)).padStart(2, "0")}`, hasLiked: r.hasLiked > 0 })) });
});
app.post("/api/square/like", needLogin, async (req, res) => {
  const p = await conn();
  await p.query("INSERT IGNORE INTO likes (user_id,mood_id) VALUES (?,?)", [req.session.user.id, req.body.moodId]);
  res.json({ ok: true });
});

app.get("/api/private/chats", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const [rows] = await p.query(
    "SELECT t.partner_id receiverId, t.latest_time createTime, t.latest_message message, t.unread_count unreadCount " +
    "FROM (" +
    " SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END partner_id, MAX(create_time) latest_time, " +
    " SUBSTRING_INDEX(GROUP_CONCAT(message ORDER BY create_time DESC SEPARATOR '\\n'),'\\n',1) latest_message, " +
    " SUM(CASE WHEN receiver_id=? AND (is_read=0 OR is_read IS NULL) THEN 1 ELSE 0 END) unread_count " +
    " FROM private_messages WHERE sender_id=? OR receiver_id=? " +
    " GROUP BY CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END" +
    ") t ORDER BY t.latest_time DESC",
    [uid, uid, uid, uid, uid]
  );
  res.json({
    ok: true,
    chats: rows.map(r => ({ ...r, username: `树洞旅人 ${String(Math.abs(r.receiverId % 100)).padStart(2, "0")}` })),
    unreadPrivateCount: await unreadCount(uid)
  });
});
app.get("/api/private/messages/:targetId", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const tid = Number(req.params.targetId);
  await p.query("UPDATE private_messages SET is_read=1 WHERE sender_id=? AND receiver_id=? AND (is_read=0 OR is_read IS NULL)", [tid, uid]);
  const [rows] = await p.query(
    "SELECT id, sender_id senderId, receiver_id receiverId, message, create_time createTime FROM private_messages " +
    "WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY create_time ASC",
    [uid, tid, tid, uid]
  );
  res.json({ ok: true, targetAlias: `树洞旅人 ${String(Math.abs(tid % 100)).padStart(2, "0")}`, records: rows, unreadPrivateCount: await unreadCount(uid) });
});
app.post("/api/private/messages", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const tid = Number(req.body.targetId);
  const msg = String(req.body.message || "").trim();
  if (!msg) return res.json({ ok: false, message: "消息不能为空" });
  if (tid === uid) return res.json({ ok: false, message: "不能给自己发消息" });
  await p.query("INSERT INTO private_messages (sender_id, receiver_id, message, is_read) VALUES (?,?,?,0)", [uid, tid, msg]);
  res.json({ ok: true });
});

app.get("/api/ai/records", needLogin, async (req, res) => {
  const p = await conn();
  const [rows] = await p.query("SELECT id, sender, message, create_time createTime FROM chat_records WHERE user_id=? ORDER BY create_time ASC", [req.session.user.id]);
  res.json({ ok: true, records: rows });
});
app.post("/api/ai/chat", needLogin, async (req, res) => {
  const p = await conn();
  if (!req.session.user.aiChatEnabled) return res.json({ ok: false, message: "AI对话已被管理员禁用" });
  const msg = String(req.body.msg || "").trim();
  if (!msg) return res.json({ ok: false, message: "消息不能为空" });
  const reply = "我在，慢慢说。你的感受很重要，我们一步一步来。";
  await p.query("INSERT INTO chat_records (user_id,sender,message) VALUES (?,?,?)", [req.session.user.id, "user", msg]);
  await p.query("INSERT INTO chat_records (user_id,sender,message) VALUES (?,?,?)", [req.session.user.id, "ai", reply]);
  res.json({ ok: true, reply });
});

app.get("/api/graph", needLogin, async (req, res) => {
  const p = await conn();
  const [rows] = await p.query(
    "SELECT DATE_FORMAT(DATE(create_time), '%Y-%m-%d') dt, AVG(mood_score) avg_score FROM mood_records " +
    "WHERE user_id=? AND create_time>=DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY DATE_FORMAT(DATE(create_time), '%Y-%m-%d') ORDER BY dt ASC",
    [req.session.user.id]
  );
  res.json({ ok: true, dates: rows.map(x => String(x.dt || "")), scores: rows.map(x => Number(x.avg_score || 0)) });
});

app.post("/api/game/play", needLogin, async (req, res) => {
  const normalize = (v) => {
    const raw = String(v || "").trim();
    const x = raw.toLowerCase();
    if (["rock", "r", "1", "石头"].includes(x) || raw.includes("石")) return "石头";
    if (["scissors", "s", "2", "剪刀"].includes(x) || raw.includes("剪")) return "剪刀";
    if (["paper", "p", "3", "布"].includes(x) || raw.includes("布")) return "布";
    return "";
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const userMove = normalize(req.body.move);
  if (!userMove) return res.json({ ok: false, message: "出招无效" });

  const moves = ["石头", "剪刀", "布"];
  const aiMove = moves[Math.floor(Math.random() * 3)];
  const win = (userMove === "石头" && aiMove === "剪刀") || (userMove === "剪刀" && aiMove === "布") || (userMove === "布" && aiMove === "石头");
  const result = userMove === aiMove ? "DRAW" : win ? "WIN" : "LOSE";

  const reason =
    userMove === aiMove
      ? "你们出的一样，这一局是平局。"
      : win
      ? (userMove === "石头" ? "石头克剪刀，所以你赢了。" : userMove === "剪刀" ? "剪刀克布，所以你赢了。" : "布克石头，所以你赢了。")
      : "这局对方刚好克制了你的出招，所以你输了。";

  const warm =
    result === "WIN"
      ? pick([
          "很好，你的节奏很稳，像是给自己打了一个小小的“我可以”的信号。",
          "漂亮的一局。赢不是为了证明什么，而是提醒你：你也能把事情做对。",
          "你抓得很准。把这份确定感，先轻轻放进今天的口袋里。"
        ])
      : result === "LOSE"
      ? pick([
          "没关系，这一局只是一个回合，不是你今天的全部。",
          "输一局也很正常。我们可以把它当作一次轻量的放松，而不是对错。",
          "别急着责备自己。下一局，我们慢慢来，给自己一点空间。"
        ])
      : pick([
          "默契局。像两朵云刚好飘到同一条风里。",
          "平局也很可爱，说明你们在同一个节奏上停了一下。",
          "这一局像是暂停键。呼吸一下，再继续也不迟。"
        ]);

  const reflection =
    result === "WIN"
      ? pick([
          "小复盘：你在“很快做决定”这件事上做得不错。哪怕只是一个小游戏，也说明你有能力把握节奏。",
          "小复盘：你刚才的出招像是一次清爽的落点。把这份干净利落，借给今天别的事情一点点。",
          "小复盘：赢的感觉不需要夸张地庆祝，它更像一盏小灯：你可以、你也值得被肯定。"
        ])
      : result === "LOSE"
      ? pick([
          "小复盘：输掉的一局不会定义你。它只是告诉我们：此刻的你可能更需要被安抚，而不是被催促。",
          "小复盘：如果你有一点失落，这是很自然的反应。我们先允许它存在，再决定要不要继续玩。",
          "小复盘：你没有做错什么，只是遇到了克制关系。把“对错”放下，留下“继续也可以”的余地。"
        ])
      : pick([
          "小复盘：平局像一次同步呼吸。你和对方都停在同一拍上，挺温柔的。",
          "小复盘：平局并不尴尬，它像是提醒我们：不必急着赢，先把自己安顿好也很重要。",
          "小复盘：你没有落后，也没有领先。只是刚好在中间停了一下，允许自己慢一点。"
        ]);

  const practice =
    result === "LOSE"
      ? pick([
          "微练习：把下颌放松，肩膀轻轻往下沉一下，然后慢慢呼气到 6 秒。",
          "微练习：把手掌贴在胸口 5 秒钟，感受一下心跳的节奏，再继续。",
          "微练习：看向屏幕外的一个固定点，默数 3 次呼吸，让注意力回到当下。"
        ])
      : result === "WIN"
      ? pick([
          "微练习：闭眼 2 秒，感受一下身体哪里更放松了，把这种放松记住。",
          "微练习：轻轻吸气 4 秒，呼气 6 秒，让身体把“顺利”的感觉接住。",
          "微练习：给自己一句很小的肯定，比如“我在变好”，只说一遍就够。"
        ])
      : pick([
          "微练习：把视线从屏幕移开 2 秒，回来看一眼，再出招，节奏会更稳。",
          "微练习：吸气 4 秒，呼气 4 秒，像按下一个温柔的暂停键。",
          "微练习：感受一下脚踩在地面的支撑感，确认自己是安全的、稳的。"
        ]);

  const hint =
    result === "WIN"
      ? pick(["想再玩一局的话，可以试试换一种出法，保持灵活。", "如果你愿意，把刚才那一下“赢”的轻松感，留给自己 10 秒钟就好。"])
      : result === "LOSE"
      ? pick(["下一局可以先用“布”试探一下，或者干脆随心选一个，让手替你做决定。", "如果你觉得紧绷，先把肩膀放松一下，再出招。我们不是在考试。"])
      : pick(["要不要试试刻意换一个出法，看看节奏会不会不一样？", "平局之后更适合随心一点，随便出一个就好。"]);

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

  res.json({ ok: true, aiMove, userMove, result, resultText, quote: warm, reason, hint, reflection, practice, detail });
});
app.post("/api/game/pet", needLogin, (req, res) => {
  const animal = req.body.animal;
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
  const [[u]] = await p.query("SELECT username, role, ai_chat_enabled, public_square_enabled, nickname, avatar_url avatarUrl, bio FROM users WHERE id=?", [uid]);
  const [[s1]] = await p.query("SELECT COUNT(*) total, COALESCE(AVG(mood_score),0) avgScore FROM mood_records WHERE user_id=?", [uid]);
  const [[s2]] = await p.query("SELECT COUNT(*) publicMoods FROM mood_records WHERE user_id=? AND is_public=1", [uid]);
  const [[s3]] = await p.query("SELECT COUNT(*) totalLikesReceived FROM likes WHERE mood_id IN (SELECT id FROM mood_records WHERE user_id=?)", [uid]);
  res.json({ ok: true, profile: { ...u, aiChatEnabled: u.ai_chat_enabled === 1, publicSquareEnabled: u.public_square_enabled === 1 }, ...s1, ...s2, ...s3, profileAlias: `树洞旅人 ${String(Math.abs(uid % 100)).padStart(2, "0")}` });
});
app.post("/api/profile", needLogin, async (req, res) => {
  const p = await conn();
  const uid = req.session.user.id;
  const nickname = (req.body.nickname || "").trim() || null;
  const bio = (req.body.bio || "").trim() || null;
  const avatarUrl = (req.body.avatarUrl || "").trim() || null;
  await p.query("UPDATE users SET nickname=?, avatar_url=?, bio=? WHERE id=?", [nickname, avatarUrl, bio, uid]);
  const [rows] = await p.query("SELECT * FROM users WHERE id=?", [uid]);
  const u = rows[0];
  req.session.user = { ...req.session.user, nickname: u.nickname, avatarUrl: u.avatar_url, bio: u.bio };
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
  res.json({ ok: true, users: rows.map(r => ({ ...r, aiChatEnabled: r.ai_chat_enabled === 1, publicSquareEnabled: r.public_square_enabled === 1 })) });
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

const port = Number(process.env.PORT || 3000);
conn()
  .then(() => app.listen(port, () => console.log(`API server http://localhost:${port}`)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
