const api = axios.create({ baseURL: "/api", withCredentials: true });
const { createApp } = Vue;

createApp({
  data() {
    return {
      booted: true,
      user: null,
      tab: "moods",
      weatherState: "mist",
      weatherGreeting: "",
      weatherSubtitle: "",
      unreadPrivateCount: 0,
      echoPendingCount: 0,
      echoVisible: false,
      echoRecords: [],
      rainAudioOn: false,
      audioCtx: null,
      rainNodes: null,
      musicOn: false,
      musicNodes: null,
      authMode: "login",
      auth: { username: "", password: "", aiName: "小树", aiPersona: "温柔小姐姐" },
      moods: [],
      newMood: { content: "", isPublic: false },
      squareMoods: [],
      privateChats: [],
      privateMessages: [],
      currentPrivateTargetId: null,
      currentPrivateAlias: "",
      currentPrivateBlockedByMe: false,
      currentPrivateBlockedMe: false,
      privateInput: "",
      onlyUnreadPrivate: false,
      showHiddenPrivate: false,
      aiRecords: [],
      aiInput: "",
      aiSource: "",
      aiReason: "",
      aiSending: false,
      gameResult: "",
      petResult: "",
      profile: {
        nickname: "",
        avatarUrl: "",
        bio: "",
        aiName: "小树",
        aiPersona: "温柔小姐姐",
        aiAddressing: "",
        aiSupportStyle: "共情倾听",
        aiTaboo: ""
      },
      moodSaving: false,
      isAdmin: false,
      adminUsers: []
    };
  },
  computed: {
    aiDisplayName() {
      return (this.user && this.user.aiName) || this.profile.aiName || "小树";
    },
    tabTitle() {
      const m = {
        moods: "我的树洞",
        square: "匿名广场",
        private: "我的私聊",
        chat: "AI 对话",
        graph: "心灵气候",
        game: "解压游戏",
        profile: "个人主页",
        admin: "管理员控制台"
      };
      return m[this.tab] || "我的树洞";
    },
    tabDesc() {
      const m = {
        moods: "记录当下，给情绪一个被看见的位置。",
        square: "在温柔的匿名空间里，与世界轻轻连接。",
        private: "一对一会话更安静，消息也更聚焦。",
        chat: "把心里话交给 AI，慢慢说就好。",
        graph: "用可视化看见最近七天的情绪起伏，让心灵的天气有迹可循。",
        game: "用轻量互动让紧绷慢慢松下来。",
        profile: "管理昵称、头像和个人介绍。",
        admin: "统一管理用户能力与权限开关。"
      };
      return m[this.tab] || "";
    }
  },
  watch: {
    weatherState(v) {
      if (v !== "rain" && this.rainAudioOn) this.stopRainAudio();
    }
  },
  mounted() {
    this.booted = true;
    this.refreshMe();
  },
  beforeUnmount() {
    this.stopRainAudio();
    this.stopMusic();
  },
  methods: {
    fmt(v) {
      return v ? new Date(v).toLocaleString() : "";
    },
    async refreshMe() {
      try {
        const { data } = await api.get("/me");
        if (!data.ok) return;
        this.user = data.user;
        this.isAdmin = this.user && this.user.role === "ADMIN";
        this.weatherState = data.weatherState || "mist";
        this.weatherGreeting = data.weatherGreeting || "";
        this.weatherSubtitle = data.weatherSubtitle || "";
        this.unreadPrivateCount = data.unreadPrivateCount || 0;
        this.echoPendingCount = data.echoPendingCount || 0;
        await this.loadTab();
      } catch (_) {}
    },
    async login() {
      const { data } = await api.post("/auth/login", this.auth);
      if (!data.ok) return alert(data.message || "登录失败");
      await this.refreshMe();
    },
    switchAuthMode(mode) {
      this.authMode = mode;
    },
    async register() {
      const { data } = await api.post("/auth/register", {
        username: this.auth.username,
        password: this.auth.password,
        confirmPassword: this.auth.password,
        aiName: this.auth.aiName,
        aiPersona: this.auth.aiPersona
      });
      if (!data.ok) return alert(data.message || "注册失败");
      alert("注册成功，请登录");
      this.authMode = "login";
    },
    async logout() {
      this.stopRainAudio();
      await api.post("/auth/logout");
      location.reload();
    },
    async switchTab(t) {
      this.tab = t;
      await this.loadTab();
    },
    async loadTab() {
      if (!this.user) return;
      if (this.tab === "moods") await this.loadMoods();
      if (this.tab === "square") await this.loadSquare();
      if (this.tab === "private") await this.loadPrivateChats();
      if (this.tab === "chat") await this.loadAiRecords();
      if (this.tab === "graph") await this.loadGraph();
      if (this.tab === "profile") await this.loadProfile();
      if (this.tab === "admin" && this.isAdmin) await this.loadAdminUsers();
    },
    async loadMoods() {
      const { data } = await api.get("/moods");
      this.moods = data.moods || [];
    },
    async addMood() {
      if (!this.newMood.content.trim()) return;
      if (this.moodSaving) return;
      this.moodSaving = true;
      try {
        await api.post("/moods", { content: this.newMood.content, isPublic: this.newMood.isPublic ? 1 : 0 });
        this.newMood = { content: "", isPublic: false };
        await this.loadMoods();
        await this.refreshMe();
      } finally {
        this.moodSaving = false;
      }
    },
    async deleteMood(id) {
      await api.delete(`/moods/${id}`);
      await this.loadMoods();
      await this.refreshMe();
    },
    talkFromComment(mood) {
      this.tab = "chat";
      const comment = mood.ai_comment || mood.aiComment || "";
      this.aiInput = `我刚写下这段心情：“${mood.content || ""}”。你刚刚回应“${comment}”，可以陪我继续聊聊吗？`;
      this.loadAiRecords();
    },
    async loadSquare() {
      const { data } = await api.get("/square");
      if (!data.ok) return alert(data.message || "无法访问匿名广场");
      this.squareMoods = data.moods || [];
    },
    async likeMood(moodId) {
      await api.post("/square/like", { moodId });
      await this.loadSquare();
    },
    async loadPrivateChats() {
      const { data } = await api.get(`/private/chats?includeHidden=${this.showHiddenPrivate ? 1 : 0}`);
      this.privateChats = data.chats || [];
      this.unreadPrivateCount = data.unreadPrivateCount || 0;
    },
    async loadPrivateMessages(targetId) {
      this.currentPrivateTargetId = targetId;
      const { data } = await api.get(`/private/messages/${targetId}`);
      this.privateMessages = data.records || [];
      this.currentPrivateAlias = data.targetAlias || "";
      this.currentPrivateBlockedByMe = !!data.blockedByMe;
      this.currentPrivateBlockedMe = !!data.blockedMe;
      this.unreadPrivateCount = data.unreadPrivateCount || 0;
      await this.loadPrivateChats();
    },
    openPrivate(targetId) {
      if (this.user && Number(targetId) === Number(this.user.id)) {
        alert("不能和自己私聊");
        return;
      }
      this.tab = "private";
      this.loadPrivateChats().then(() => this.loadPrivateMessages(targetId));
    },
    async sendPrivateMessage() {
      if (!this.currentPrivateTargetId || !this.privateInput.trim()) return;
      if (this.currentPrivateBlockedByMe) return alert("你已拉黑对方，无法发送消息");
      if (this.currentPrivateBlockedMe) return alert("对方已拒收你的私聊消息");
      const { data } = await api.post("/private/messages", { targetId: this.currentPrivateTargetId, message: this.privateInput });
      if (!data.ok) return alert(data.message || "发送失败");
      this.privateInput = "";
      await this.loadPrivateMessages(this.currentPrivateTargetId);
    },
    async setPrivateSetting(targetId, patch) {
      const body = { targetId, ...patch };
      const { data } = await api.post("/private/settings", body);
      if (!data.ok) return alert(data.message || "操作失败");
      await this.loadPrivateChats();
      // If we are hiding the currently opened chat, clear the right panel softly.
      if (patch && patch.hidden === 1 && Number(targetId) === Number(this.currentPrivateTargetId)) {
        this.currentPrivateTargetId = null;
        this.currentPrivateAlias = "";
        this.privateMessages = [];
        this.currentPrivateBlockedByMe = false;
        this.currentPrivateBlockedMe = false;
      }
    },
    async togglePrivateBlock() {
      if (!this.currentPrivateTargetId) return;
      const next = this.currentPrivateBlockedByMe ? 0 : 1;
      const { data } = await api.post("/private/block", { targetId: this.currentPrivateTargetId, blocked: next });
      if (!data.ok) return alert(data.message || "操作失败");
      await this.loadPrivateMessages(this.currentPrivateTargetId);
      await this.loadPrivateChats();
    },
    async loadAiRecords() {
      const { data } = await api.get("/ai/records");
      this.aiRecords = data.records || [];
    },
    async clearAiRecords() {
      if (!confirm("确认清除全部 AI 对话记录吗？")) return;
      await api.delete("/ai/records");
      this.aiSource = "";
      this.aiReason = "";
      await this.loadAiRecords();
    },
    async sendAi() {
      if (!this.aiInput.trim()) return;
      if (this.aiSending) return;
      const msg = this.aiInput;
      this.aiInput = "";
      this.aiSending = true;
      try {
        const { data } = await api.post("/ai/chat", { msg });
        if (!data.ok) return alert(data.message || "发送失败");
        this.aiSource = data.aiSource || "";
        this.aiReason = data.aiReason || "";
        await this.loadAiRecords();
      } finally {
        this.aiSending = false;
      }
    },
    async loadGraph() {
      const { data } = await api.get("/graph");
      await this.$nextTick();
      const el = document.getElementById("mainChart");
      if (!el) return;
      if(this.graphChart) {
        this.graphChart.dispose();
      }
      this.graphChart = echarts.init(el);
      
      const chart = this.graphChart;
      chart.setOption({
        tooltip: { 
          trigger: "axis",
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          borderColor: 'rgba(244, 162, 97, 0.3)',
          textStyle: { color: '#2b3240' },
          extraCssText: 'box-shadow: 0 8px 32px 0 rgba(31,38,135,0.07); border-radius: 12px;'
        },
        grid: { left: '3%', right: '4%', bottom: '5%', top: '8%', containLabel: true },
        xAxis: { 
          type: "category", 
          boundaryGap: false,
          data: data.dates || [],
          axisLine: { lineStyle: { color: '#d2d6de' } },
          axisLabel: { color: '#687082', margin: 12 }
        },
        yAxis: { 
          type: "value", 
          min: 0, 
          max: 100,
          splitLine: { lineStyle: { color: '#eef0f4', type: 'dashed' } },
          axisLabel: { color: '#687082' }
        },
        series: [{ 
          type: "line", 
          smooth: true, 
          symbol: 'circle',
          symbolSize: 8,
          itemStyle: { color: '#f4a261', borderWidth: 2, borderColor: '#fff' },
          lineStyle: { width: 4, color: '#f4a261', shadowColor: 'rgba(244,162,97,0.3)', shadowBlur: 10, shadowOffsetY: 5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(244,162,97,0.4)' },
              { offset: 1, color: 'rgba(244,162,97,0.0)' }
            ])
          },
          data: data.scores || [] 
        }]
      });
      
      window.addEventListener('resize', () => chart.resize());
    },
    async openEcho() {
      this.echoVisible = true;
      const { data } = await api.get("/echo");
      this.echoRecords = data.records || [];
      this.echoPendingCount = data.pendingCount || 0;
      if (this.echoPendingCount > 0) {
        const mark = await api.post("/echo/open", { id: 0 });
        this.echoPendingCount = mark.data?.pendingCount || 0;
      }
    },
    closeEcho() {
      this.echoVisible = false;
    },
    talkFromEcho(e) {
      this.echoVisible = false;
      this.tab = "chat";
      this.aiInput = `我在时光回声里看到这条旧记录：“${e.content || ""}”。你愿意陪我聊聊现在的感受吗？`;
      this.loadAiRecords();
    },
    async play(move) {
      const { data } = await api.post("/game/play", { move });
      this.gameResult =
        data.detail ||
        `你出：${data.userMove || ""}\n我出：${data.aiMove || ""}\n结果：${data.resultText || data.result || ""}\n\n${data.quote || ""}`;
    },
    async pet(animal) {
      const { data } = await api.post("/game/pet", { animal });
      this.petResult = `${data.animalName || ""}：${data.feedback || ""}（${data.energy || ""}）`;
    },
    async loadProfile() {
      const { data } = await api.get("/profile");
      this.profile = data.profile || this.profile;
    },
    async saveProfile() {
      await api.post("/profile", this.profile);
      await this.refreshMe();
      alert("保存成功");
    },
    async loadAdminUsers() {
      const { data } = await api.get("/admin/users");
      this.adminUsers = data.users || [];
    },
    async deleteUserMood(id) {
      if (!confirm("确定要删除这条心情记录吗？")) return;
      await api.post("/admin/delete-mood", { moodId: id });
      await this.loadSquare();
    },
    async toggleUserAi(id) {
      await api.post("/admin/toggle-ai", { targetId: id });
      await this.loadAdminUsers();
    },
    async toggleUserSquare(id) {
      await api.post("/admin/toggle-square", { targetId: id });
      await this.loadAdminUsers();
    },
    toggleRainAudio() {
      if (this.rainAudioOn) this.stopRainAudio();
      else this.startRainAudio();
    },
    startRainAudio() {
      try {
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = this.audioCtx;
        if (ctx.state === "suspended") ctx.resume();
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.22;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 900;
        const gain = ctx.createGain();
        gain.gain.value = 0.12;
        source.connect(lowpass);
        lowpass.connect(gain);
        gain.connect(ctx.destination);
        source.start();
        this.rainNodes = { source };
        this.rainAudioOn = true;
      } catch (_) {}
    },
    stopRainAudio() {
      try {
        if (this.rainNodes?.source) this.rainNodes.source.stop();
      } catch (_) {}
      this.rainNodes = null;
      this.rainAudioOn = false;
    },
    toggleMusic() {
      if (this.musicOn) this.stopMusic();
      else this.startMusic();
    },
    startMusic() {
      try {
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = this.audioCtx;
        if (ctx.state === "suspended") ctx.resume();

        const master = ctx.createGain();
        master.gain.value = 0.0001;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 920;
        lowpass.Q.value = 0.65;

        const tones = [
          { freq: 196.0, type: "sine", gain: 0.55 }, // G3
          { freq: 246.94, type: "sine", gain: 0.36 }, // B3
          { freq: 293.66, type: "triangle", gain: 0.22 } // D4
        ];

        const oscNodes = tones.map((t) => {
          const o = ctx.createOscillator();
          o.type = t.type;
          o.frequency.value = t.freq;
          const g = ctx.createGain();
          g.gain.value = t.gain;
          o.connect(g);
          g.connect(lowpass);
          return { o, g };
        });

        // Slow "breathing" envelope (15s cycle).
        const schedule = () => {
          const now = ctx.currentTime;
          master.gain.cancelScheduledValues(now);
          master.gain.setValueAtTime(0.0001, now);
          master.gain.linearRampToValueAtTime(0.095, now + 2.8);
          master.gain.linearRampToValueAtTime(0.06, now + 7.5);
          master.gain.linearRampToValueAtTime(0.09, now + 12.5);
          master.gain.linearRampToValueAtTime(0.05, now + 15.0);
        };
        schedule();
        const interval = setInterval(() => {
          try {
            schedule();
          } catch (_) {}
        }, 15000);

        lowpass.connect(master);
        master.connect(ctx.destination);

        oscNodes.forEach(({ o }) => o.start());
        this.musicNodes = { master, lowpass, oscNodes, interval };
        this.musicOn = true;
      } catch (_) {}
    },
    stopMusic() {
      try {
        if (this.musicNodes?.interval) clearInterval(this.musicNodes.interval);
      } catch (_) {}
      try {
        this.musicNodes?.oscNodes?.forEach(({ o }) => {
          try {
            o.stop();
          } catch (_) {}
        });
      } catch (_) {}
      this.musicNodes = null;
      this.musicOn = false;
    }
  },
  template: `
  <div class="app-root" v-if="booted" :class="'weather-' + (weatherState || 'mist')">
    <div class="weather-layer" v-if="user"></div>

    <div class="floating-right-actions" v-if="user">
      <button v-if="weatherState==='rain'" class="action-fab rain-fab" :class="{ active: rainAudioOn }" @click="toggleRainAudio" :title="rainAudioOn ? '关闭雨声' : '开启雨声'">
        <span class="fab-ic">🌧️</span>
        <span class="fab-tx">{{ rainAudioOn ? "关雨" : "开雨" }}</span>
      </button>

      <button class="action-fab music-fab" :class="{ active: musicOn }" @click="toggleMusic" :title="musicOn ? '关闭音乐' : '开启音乐'">
        <span class="fab-ic">🎵</span>
        <span class="fab-tx">{{ musicOn ? "关乐" : "开乐" }}</span>
      </button>

      <button class="action-fab echo-fab" @click="openEcho">
        <span class="fab-ic">🫙</span>
        <span class="fab-tx">拾遗</span>
        <span class="dot" v-if="echoPendingCount>0">{{ echoPendingCount }}</span>
      </button>
    </div>

    <div class="echo-mask" v-if="echoVisible" @click.self="closeEcho">
      <div class="echo-modal">
        <div class="section-title-row echo-title-row">
          <h5 class="m-0" style="letter-spacing: 2px;">⌛ 时光拾遗</h5>
          <button class="btn btn-outline-light btn-soft" @click="closeEcho" style="background: rgba(255,255,255,0.1)!important; border:none; backdrop-filter:blur(4px);">盖上时光瓶</button>
        </div>
        <div class="echo-paper" v-for="e in echoRecords" :key="e.id">
          <div class="echo-meta" style="color: #6a6660; border-bottom: 1px dashed #dcd3c6; padding-bottom: 8px; margin-bottom: 16px;">
            这是一封来自百日前的跨时空信件。<br>
            记录于 {{ fmt(e.createTime || e.create_time || e.echoDate) }} · 当时的心情指数是 {{ e.moodScore || 0 }}/100。
          </div>
          <div class="mb-3" style="font-size: 19px; white-space: pre-wrap;">"{{ e.content }}"</div>
          <div class="bubble bubble-comment bubble-block" v-if="e.aiComment" style="background: transparent; border: 1px solid rgba(220,190,160,0.5); box-shadow:none;">
            <div class="ai-label">{{ aiDisplayName }} 当时的评语：</div>
            <div style="font-size: 16px;">{{ e.aiComment }}</div>
          </div>
          <div class="text-end mt-3">
             <button class="btn btn-outline-primary btn-soft talk-btn" style="border-radius: 8px!important;" @click="talkFromEcho(e)">跨越时光，和{{ aiDisplayName }}继续聊聊 ➔ </button>
          </div>
        </div>
        <div class="text-white text-center py-4" v-if="echoRecords.length===0" style="opacity: 0.8;">
          你发向未来的漂流瓶还在海里，偶尔也会想要起航。<br>先回树洞写点什么吧。
        </div>
      </div>
    </div>

    <div class="app-shell">
      <div class="card-soft p-4 mb-3" v-if="user">
        <div class="d-flex justify-content-between align-items-center gap-3 flex-wrap">
          <div>
            <span class="chip mb-2">Healing Space</span>
            <h4 class="mb-1" v-if="weatherGreeting">{{ weatherGreeting }}</h4>
            <div class="text-muted">{{ weatherSubtitle }}</div>
          </div>
          <div class="d-flex gap-2 align-items-center" v-if="user">
            <span class="badge text-bg-light">{{ user.nickname || user.username }}</span>
            <button class="btn btn-outline-secondary btn-soft" @click="logout">暂别，等候你的下次倾诉</button>
          </div>
        </div>
      </div>

    <div class="card-soft p-4 auth-hero" v-if="!user">
      <div class="row g-4 align-items-stretch">
        <div class="col-lg-7">
          <div class="auth-hero-left">
            <span class="chip mb-3">My Tree Hole</span>
            <h2 class="auth-title">把情绪放在这里，慢慢变轻</h2>
            <p class="auth-subtitle">今天不需要很完美，只要真实。写下此刻的感受，和 AI 一起把情绪梳理成更温柔的节奏。</p>
            <div class="auth-tags">
              <span>匿名倾诉</span>
              <span>AI 温暖评语</span>
              <span>心灵气候</span>
              <span>私聊陪伴</span>
            </div>
            <div class="auth-visual" aria-hidden="true">
              <div class="orb orb-a"></div>
              <div class="orb orb-b"></div>
              <div class="orb orb-c"></div>
              <div class="seedling">🌱</div>
              <div class="visual-text">把今天交给树洞收好</div>
            </div>
          </div>
        </div>
        <div class="col-lg-5">
          <div class="auth-login-card">
            <div class="d-flex gap-2 mb-3">
              <button class="btn flex-grow-1" :class="authMode==='login' ? 'btn-primary' : 'btn-light'" @click="switchAuthMode('login')">登录</button>
              <button class="btn flex-grow-1" :class="authMode==='register' ? 'btn-primary' : 'btn-light'" @click="switchAuthMode('register')">注册</button>
            </div>
            <h4 class="mb-2">{{ authMode==='login' ? '欢迎登录' : '创建账号' }}</h4>
            <div class="mb-3 p-3 rounded-4" style="background: rgba(255,255,255,0.62);">
              <div class="small fw-semibold mb-1">填写说明</div>
              <div class="small text-muted">用户名：用于登录账号（建议 4-20 位）</div>
              <div class="small text-muted">密码：登录与注册都使用该密码（建议至少 6 位）</div>
              <div class="small text-muted" v-if="authMode==='register'">AI 名字：用于对话与树洞评语的显示名</div>
              <div class="small text-muted" v-if="authMode==='register'">AI 性格：决定 AI 回复风格，可在个人主页修改</div>
            </div>
            <label class="form-label small text-muted mb-1">用户名</label>
            <input class="form-control mb-2" v-model="auth.username" placeholder="例如：xiaoyu">
            <label class="form-label small text-muted mb-1">密码</label>
            <input class="form-control mb-2" type="password" v-model="auth.password" placeholder="请输入登录密码">
            <template v-if="authMode==='register'">
            <label class="form-label small text-muted mb-1">AI 名字（注册时生效）</label>
            <input class="form-control mb-2" v-model="auth.aiName" placeholder="例如：木木 / 小岛">
            <label class="form-label small text-muted mb-1">AI 性格（注册时生效）</label>
            <select class="form-control mb-3" v-model="auth.aiPersona">
              <option>温柔小姐姐</option>
              <option>理性教练</option>
              <option>安静倾听者</option>
              <option>幽默伙伴</option>
            </select>
            </template>
            <div class="d-flex gap-2">
              <button v-if="authMode==='login'" class="btn btn-primary btn-soft flex-grow-1" @click="login">登录</button>
              <button v-else class="btn btn-primary btn-soft flex-grow-1" @click="register">注册并开始</button>
            </div>
            <div class="auth-hint mt-3" v-if="authMode==='register'">首次注册后即可开始记录心情，并获得专属 AI 陪伴。</div>
          </div>
        </div>
      </div>
    </div>

    <template v-else>
      <div class="card-soft p-3 mb-3 nav-pill">
        <button class="btn" :class="tab==='moods'?'btn-primary':'btn-light'" @click="switchTab('moods')">我的树洞</button>
        <button class="btn" :class="tab==='square'?'btn-primary':'btn-light'" @click="switchTab('square')">匿名广场</button>
        <button class="btn" :class="tab==='graph'?'btn-primary':'btn-light'" @click="switchTab('graph')">心灵气候</button>
        <button class="btn" :class="tab==='chat'?'btn-primary':'btn-light'" @click="switchTab('chat')">AI对话</button>
        <button class="btn" :class="tab==='game'?'btn-primary':'btn-light'" @click="switchTab('game')">解压游戏</button>
        <button class="btn" :class="tab==='profile'?'btn-primary':'btn-light'" @click="switchTab('profile')">个人主页</button>
        <button class="btn position-relative" :class="tab==='private'?'btn-primary':'btn-light'" @click="switchTab('private')">
          我的私聊 <span class="unread-dot ms-1" v-if="unreadPrivateCount>0">{{ unreadPrivateCount }}</span>
        </button>
        <button v-if="isAdmin" class="btn" :class="tab==='admin'?'btn-primary':'btn-light'" @click="switchTab('admin')">管理员</button>
      </div>

      <div class="card-soft p-4 mb-3 section-head">
        <h5 class="mb-1">{{ tabTitle }}</h5>
        <div class="text-muted">{{ tabDesc }}</div>
      </div>

      <div v-if="tab==='moods'" class="panel panel-moods">
        <div class="card-soft p-4 mb-3">
          <h5>写下此刻的感受</h5>
          <textarea class="form-control mb-2" rows="4" v-model="newMood.content"></textarea>
          <div class="d-flex justify-content-between align-items-center">
            <label><input type="checkbox" v-model="newMood.isPublic"> 同步到匿名广场</label>
            <button class="btn btn-primary btn-soft" :disabled="moodSaving" @click="addMood">
              <span v-if="moodSaving" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              {{ moodSaving ? "保存中…" : "把此刻托付给树洞" }}
            </button>
          </div>
          <div class="text-muted small mt-2" v-if="moodSaving">AI 正在生成温暖评语，请稍等一会儿…</div>
        </div>
        <div class="card-soft p-3 mb-3 mood-card" v-for="m in moods" :key="m.id">
          <div class="small text-muted mb-1">{{ fmt(m.create_time || m.createTime) }} · {{ m.ai_tag || m.aiTag }} · {{ m.mood_score || m.moodScore }}/100</div>
          <div class="bubble bubble-entry bubble-block">{{ m.content }}</div>
          <div class="bubble bubble-comment bubble-block" v-if="m.ai_comment || m.aiComment">
            <div class="ai-label">{{ aiDisplayName }} 的温暖评语</div>
            <div>{{ m.ai_comment || m.aiComment }}</div>
            <div class="ai-extra" v-if="m.ai_practice || m.aiPractice || m.ai_action || m.aiAction">
              <div class="ai-extra-item"><span class="k">微练习</span><span class="v">{{ m.ai_practice || m.aiPractice }}</span></div>
              <div class="ai-extra-item"><span class="k">小行动</span><span class="v">{{ m.ai_action || m.aiAction }}</span></div>
            </div>
            <button class="btn btn-outline-primary btn-soft talk-btn" @click="talkFromComment(m)">和{{ aiDisplayName }}聊聊</button>
          </div>
          <div class="d-flex justify-content-end">
            <button class="icon-btn" @click="deleteMood(m.id)" title="删除" aria-label="删除">
              <span class="icon" aria-hidden="true">🗑</span>
              <span class="label">删除</span>
            </button>
          </div>
        </div>
        <div class="card-soft p-4 text-center text-muted" v-if="moods.length===0">还没有记录，先写下今天的第一句心情。</div>
      </div>

      <div v-if="tab==='square'" class="panel panel-square">
        <div class="card-soft p-3 mb-3 note-card" v-for="m in squareMoods" :key="m.id">
          <div class="small text-muted mb-1">{{ m.username }} · {{ fmt(m.create_time || m.createTime) }} · {{ m.mood_score || m.moodScore }}/100</div>
          <div class="bubble bubble-entry bubble-block">{{ m.content }}</div>
          <div class="bubble bubble-comment bubble-block" v-if="m.ai_comment || m.aiComment">
            <div class="ai-label">{{ aiDisplayName }} 的温暖评语</div>
            <div>{{ m.ai_comment || m.aiComment }}</div>
            <div class="ai-extra" v-if="m.ai_practice || m.aiPractice || m.ai_action || m.aiAction">
              <div class="ai-extra-item"><span class="k">微练习</span><span class="v">{{ m.ai_practice || m.aiPractice }}</span></div>
              <div class="ai-extra-item"><span class="k">小行动</span><span class="v">{{ m.ai_action || m.aiAction }}</span></div>
            </div>
            <button class="btn btn-outline-primary btn-soft talk-btn" @click="talkFromComment(m)">和{{ aiDisplayName }}聊聊</button>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-primary btn-soft" :disabled="m.hasLiked" @click="likeMood(m.id)">抱抱 {{ m.likeCount || m.like_count || 0 }}</button>
            <button class="btn btn-sm btn-outline-secondary btn-soft" v-if="(m.user_id || m.userId) !== (user && user.id)" @click="openPrivate(m.user_id || m.userId)">私聊TA</button>
            <button class="btn btn-sm btn-outline-secondary btn-soft" v-else disabled>这是你自己</button>
            <button v-if="isAdmin" class="btn btn-sm btn-outline-danger btn-soft ms-auto" @click="deleteUserMood(m.id)">删除(管理)</button>
          </div>
        </div>
        <div class="card-soft p-4 text-center text-muted" v-if="squareMoods.length===0">匿名广场暂时还没有内容。</div>
      </div>

      <div v-if="tab==='private'" class="row g-3 panel panel-private">
        <div class="col-md-4">
          <div class="card-soft p-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h6 class="mb-0">会话列表</h6>
              <div class="d-flex gap-3 align-items-center">
                <label class="small text-muted" style="user-select:none;">
                  <input type="checkbox" v-model="onlyUnreadPrivate" /> 只看未读
                </label>
                <label class="small text-muted" style="user-select:none;">
                  <input type="checkbox" v-model="showHiddenPrivate" @change="loadPrivateChats" /> 显示隐藏
                </label>
              </div>
            </div>
            <div
              class="chat-thread-row mb-2"
              v-for="c in (onlyUnreadPrivate ? privateChats.filter(x => (x.unreadCount||0)>0) : privateChats)"
              :key="c.receiverId"
            >
              <button class="btn btn-light w-100 text-start btn-soft chat-thread-btn" @click="loadPrivateMessages(c.receiverId)">
                <div class="d-flex justify-content-between align-items-start gap-2">
                  <div>
                    <div class="d-flex align-items-center gap-2">
                      <strong>{{ c.username }}</strong>
                      <span v-if="Number(c.pinned||0)===1" class="small text-muted">置顶</span>
                      <span v-if="Number(c.muted||0)===1" class="small text-muted">静音</span>
                      <span v-if="Number(c.hidden||0)===1" class="small text-muted">已隐藏</span>
                    </div>
                    <div class="small text-muted">{{ c.message }}</div>
                  </div>
                  <div class="d-flex align-items-center gap-1">
                    <span v-if="(c.unreadCount||0)>0" class="unread-dot">{{ c.unreadCount }}</span>
                  </div>
                </div>
              </button>
              <div class="d-flex justify-content-end gap-2 mt-2">
                <button class="icon-btn" title="置顶/取消置顶" @click.stop="setPrivateSetting(c.receiverId, { pinned: Number(c.pinned||0) ? 0 : 1 })">
                  <span class="mini-ic" aria-hidden="true">P</span><span class="label">{{ Number(c.pinned||0) ? "取消置顶" : "置顶" }}</span>
                </button>
                <button class="icon-btn" title="静音/取消静音" @click.stop="setPrivateSetting(c.receiverId, { muted: Number(c.muted||0) ? 0 : 1 })">
                  <span class="mini-ic" aria-hidden="true">M</span><span class="label">{{ Number(c.muted||0) ? "取消静音" : "静音" }}</span>
                </button>
                <button v-if="Number(c.hidden||0)===0" class="icon-btn" title="隐藏会话" @click.stop="setPrivateSetting(c.receiverId, { hidden: 1 })">
                  <span class="mini-ic" aria-hidden="true">H</span><span class="label">隐藏</span>
                </button>
                <button v-else class="icon-btn" title="恢复显示" @click.stop="setPrivateSetting(c.receiverId, { hidden: 0 })">
                  <span class="mini-ic" aria-hidden="true">S</span><span class="label">恢复</span>
                </button>
              </div>
            </div>
            <div class="text-muted small" v-if="privateChats.length===0">还没有私聊会话，可在匿名广场里发起。</div>
          </div>
        </div>
        <div class="col-md-8">
          <div class="card-soft p-3">
            <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
              <h6 class="mb-0">{{ currentPrivateAlias || '选择一个会话' }}</h6>
              <button v-if="currentPrivateTargetId" class="btn btn-sm btn-outline-secondary btn-soft" @click="togglePrivateBlock">
                {{ currentPrivateBlockedByMe ? "取消拉黑" : "拉黑TA" }}
              </button>
            </div>
            <div class="text-muted small mb-2" v-if="currentPrivateTargetId && (currentPrivateBlockedByMe || currentPrivateBlockedMe)">
              {{ currentPrivateBlockedMe ? "对方已拒收你的私聊消息，你仍可查看历史记录。" : "你已拉黑对方，消息发送已关闭。" }}
            </div>
            <div class="msg-box mb-2">
              <div v-for="r in privateMessages" :key="r.id" :class="(r.senderId||r.sender_id)===user.id?'text-end':''">
                <span class="bubble" :class="(r.senderId||r.sender_id)===user.id?'bubble-user':'bubble-ai'">{{ r.message }}</span>
              </div>
              <div class="text-muted text-center py-4" v-if="privateMessages.length===0">先打个招呼吧，这里会显示完整聊天记录。</div>
            </div>
            <div class="d-flex gap-2">
              <input class="form-control" v-model="privateInput" :disabled="currentPrivateBlockedByMe || currentPrivateBlockedMe" @keyup.enter="sendPrivateMessage">
              <button class="btn btn-primary btn-soft" :disabled="currentPrivateBlockedByMe || currentPrivateBlockedMe" @click="sendPrivateMessage">发送</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="tab==='chat'" class="card-soft p-3 panel panel-chat">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="small text-muted">当前陪伴AI：{{ user?.aiName || profile.aiName || '小树' }}（{{ user?.aiPersona || profile.aiPersona || '温柔陪伴' }}）</div>
          <button class="btn btn-sm btn-outline-danger btn-soft" @click="clearAiRecords">清除全部聊天</button>
        </div>
        <div class="text-muted small mb-2" v-if="aiSource==='fallback'">
          当前使用兜底回复（{{ aiReason==='NO_AI_KEY' ? '未配置 AI Key' : '上游接口异常' }}）
        </div>
        <div class="msg-box mb-2">
          <div v-for="r in aiRecords" :key="r.id" :class="r.sender==='user'?'text-end':''">
            <span class="bubble" :class="r.sender==='user'?'bubble-user':'bubble-ai'">{{ r.message }}</span>
          </div>
          <div v-if="aiSending" class="text-start">
            <span class="bubble bubble-ai">
              <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              AI 正在回复…
            </span>
          </div>
          <div class="text-muted text-center py-4" v-if="aiRecords.length===0">开始对话后，AI 记录会显示在这里。</div>
        </div>
        <div class="d-flex gap-2">
          <input class="form-control" v-model="aiInput" :disabled="aiSending" @keyup.enter="sendAi">
          <button class="btn btn-primary btn-soft" :disabled="aiSending" @click="sendAi">
            <span v-if="aiSending" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            {{ aiSending ? "发送中…" : "发送" }}
          </button>
        </div>
      </div>

      <div v-if="tab==='graph'" class="panel panel-graph">
        <div class="row g-4">
          <div class="col-lg-8">
            <div class="card-soft p-4 h-100">
              <h5 class="mb-4">
                <span style="font-size: 28px; vertical-align: middle; margin-right: 8px;">📊</span>情绪波动曲线
              </h5>
              <div id="mainChart" style="height:400px; width:100%;"></div>
              <div class="text-muted text-center py-3 mt-2" v-if="(!moods || moods.length===0)">还没有足够的数据。先写几条树洞记录，我们再把情绪画成一条柔和的曲线。</div>
            </div>
          </div>
          <div class="col-lg-4">
            <div class="card-soft p-4 h-100 d-flex flex-column justify-content-center text-center graph-summary-card">
              <div class="mb-4">
                <div class="weather-icon-large">
                  {{ weatherState === 'sunbeam' ? '☀️' : weatherState === 'afternoon' ? '🌤️' : weatherState === 'starlight' ? '🌌' : weatherState === 'rain' ? '🌧️' : '🌫️' }}
                </div>
                <h4 class="mt-3" style="font-weight: 700">{{ weatherGreeting || '气候平稳' }}</h4>
                <p class="text-muted mt-2 px-2">{{ weatherSubtitle || '伴随着时间的推移，情绪也在诉说着自己的故事。' }}</p>
              </div>
              <div class="graph-tip-card p-3 rounded-4 mt-auto">
                <div class="small fw-bold text-muted mb-2">心灵小贴士</div>
                <div class="small" style="color: #4a5568">无论高低起伏，都是生命中美妙的乐章。接纳每一刻真实的自己。</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="tab==='game'" class="card-soft p-3 panel panel-game">
        <h6>AI 解压小游戏</h6>
        <div class="game-grid">
          <button class="btn game-card-btn btn-soft" @click="play('rock')"><span class="icon">🪨</span><span>石头</span></button>
          <button class="btn game-card-btn btn-soft" @click="play('scissors')"><span class="icon">✂️</span><span>剪刀</span></button>
          <button class="btn game-card-btn btn-soft" @click="play('paper')"><span class="icon">🧻</span><span>布</span></button>
        </div>
        <div class="result-panel game-result-modern mt-3" v-if="gameResult">
          <div class="result-title">最近战报</div>
          <div class="result-content">{{ gameResult }}</div>
        </div>
        <h6 class="mt-4"><span class="me-2">🐾</span>云撸宠物 (内心抚慰)</h6>
        <div class="text-muted small mb-3">领养一只小可爱，在浮躁的时刻轻轻抚摸它们。</div>
        <div class="game-grid">
          <button class="btn game-card-btn btn-soft" @click="pet('cat')"><span class="icon">🐱</span><span>撸撸猫</span></button>
          <button class="btn game-card-btn btn-soft" @click="pet('dog')"><span class="icon">🐶</span><span>抱抱狗</span></button>
          <button class="btn game-card-btn btn-soft" @click="pet('rabbit')"><span class="icon">🐰</span><span>摸摸兔</span></button>
        </div>
        <div class="result-panel pet-result-modern mt-2" v-if="petResult">
          <div class="result-title">亲密互动</div>
          <div class="result-content">{{ petResult }}</div>
        </div>
      </div>

      <div v-if="tab==='profile'" class="panel panel-profile">
        <div class="row g-3">
          <div class="col-lg-4">
            <div class="card-soft p-4 profile-preview-card">
              <div class="profile-avatar-wrap mb-3">
                <img v-if="profile.avatarUrl" :src="profile.avatarUrl" alt="avatar" class="profile-avatar-img">
                <div v-else class="profile-avatar-fallback">{{ (profile.nickname || user?.username || '我').slice(0,1) }}</div>
              </div>
              <div class="profile-name">{{ profile.nickname || user?.username || '未设置昵称' }}</div>
              <div class="profile-bio">{{ profile.bio || '写一段简介，让这个树洞更像你。' }}</div>
              <div class="profile-ai-pill mt-3">陪伴AI：{{ profile.aiName || '小树' }} · {{ profile.aiPersona || '温柔小姐姐' }}</div>
            </div>
          </div>
          <div class="col-lg-8">
            <div class="card-soft p-4 profile-edit-card">
              <h6 class="mb-3">编辑资料</h6>
              <div class="row g-3">
                <div class="col-md-6">
                  <label class="form-label small text-muted">昵称</label>
                  <input class="form-control" v-model="profile.nickname" placeholder="例如：晚风">
                </div>
                <div class="col-md-6">
                  <label class="form-label small text-muted">头像 URL</label>
                  <input class="form-control" v-model="profile.avatarUrl" placeholder="https://...">
                </div>
                <div class="col-12">
                  <label class="form-label small text-muted">个人简介</label>
                  <textarea class="form-control" rows="3" v-model="profile.bio" placeholder="简单介绍一下现在的你"></textarea>
                </div>
                <div class="col-md-6">
                  <label class="form-label small text-muted">AI 名字</label>
                  <input class="form-control" v-model="profile.aiName" placeholder="例如：木木">
                </div>
                <div class="col-md-6">
                  <label class="form-label small text-muted">AI 性格</label>
                  <select class="form-control" v-model="profile.aiPersona">
                    <option>温柔小姐姐</option>
                    <option>理性教练</option>
                    <option>安静倾听者</option>
                    <option>幽默伙伴</option>
                  </select>
                </div>

                <div class="col-12">
                  <div class="ai-profile-head">AI 关怀档案</div>
                  <div class="small text-muted">让 AI 更懂你：称呼、陪伴方式、以及你不想被触碰的雷区。</div>
                </div>
                <div class="col-md-6">
                  <label class="form-label small text-muted">希望 AI 怎么称呼你</label>
                  <input class="form-control" v-model="profile.aiAddressing" placeholder="例如：小鱼 / 你 / 我自己">
                </div>
                <div class="col-md-6">
                  <label class="form-label small text-muted">偏好的陪伴方式</label>
                  <select class="form-control" v-model="profile.aiSupportStyle">
                    <option>共情倾听</option>
                    <option>理性梳理</option>
                    <option>行动计划</option>
                    <option>轻松陪伴</option>
                  </select>
                </div>
                <div class="col-12">
                  <label class="form-label small text-muted">不想被提及的内容（可选）</label>
                  <textarea class="form-control" rows="2" v-model="profile.aiTaboo" placeholder="例如：不要用说教口吻 / 不要提起某个人 / 不要轻易下结论"></textarea>
                </div>
              </div>
              <div class="d-flex justify-content-end mt-3">
                <button class="btn btn-primary btn-soft" @click="saveProfile">保存资料</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="tab==='admin'" class="card-soft p-3 panel panel-admin">
        <h6>管理员控制台</h6>
        <table class="table align-middle">
          <thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>AI</th><th>广场</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="u in adminUsers" :key="u.id">
              <td>{{ u.id }}</td><td>{{ u.username }}</td><td>{{ u.role }}</td>
              <td>{{ u.aiChatEnabled ? '开' : '关' }}</td><td>{{ u.publicSquareEnabled ? '开' : '关' }}</td>
              <td>
                <button class="btn btn-sm btn-outline-secondary btn-soft me-1" @click="toggleUserAi(u.id)" :disabled="u.role==='ADMIN'">切AI</button>
                <button class="btn btn-sm btn-outline-secondary btn-soft" @click="toggleUserSquare(u.id)" :disabled="u.role==='ADMIN'">切广场</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`
}).mount("#app");

