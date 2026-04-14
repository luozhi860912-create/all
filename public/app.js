// ==================== WeChatSim 独立应用 ====================
'use strict';

// ===== 辅助工具 =====
const U = {
  time() { const n = new Date(); return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`; },
  fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date(), diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff/60000) + '分钟前';
    if (diff < 86400000) return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return `${d.getMonth()+1}/${d.getDate()}`;
  },
  fmtMsgTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    const t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return d.toDateString() === now.toDateString() ? t : `${d.getMonth()+1}月${d.getDate()}日 ${t}`;
  },
  hash(s) { let h=0; for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;} return h; },
  avatar(name='') {
    const c=['#07C160','#FA5151','#576B95','#FF8800','#C44AFF','#00BFFF'];
    const cl=c[Math.abs(U.hash(name))%c.length];
    const ini=(name||'?')[0];
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="${cl}" width="100" height="100" rx="12"/><text x="50" y="62" fill="white" font-size="42" font-family="Arial" text-anchor="middle" font-weight="bold">${ini}</text></svg>`)}`;
  },
  esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
  escAttr(s) { return (s||'').replace(/'/g,"\\'").replace(/"/g,'\\"'); },
  uid() { return Date.now()+'_'+Math.random().toString(36).substr(2,8); }
};

// ===== API通信 =====
const SV = {
  token: null,
  async post(url, data) {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','X-Token':this.token||''}, body:JSON.stringify(data), credentials:'include' });
    return r.json();
  },
  async get(url) {
    const r = await fetch(url, { headers:{'X-Token':this.token||''}, credentials:'include' });
    return r.json();
  },
  async upload(file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/upload', { method:'POST', headers:{'X-Token':this.token||''}, body:fd, credentials:'include' });
    return r.json();
  }
};

// ===== 数据管理 =====
const D = {
  _d: {},
  _dirty: false,
  _timer: null,

  defaults: {
    apiEndpoint:'', apiKey:'', modelId:'', availableModels:[], maxTokens:2048, temperature:0.85,
    playerName:'我', playerAvatar:'', playerPersona:'', playerId:'wxid_player', playerSignature:'',
    walletBalance:8888.88, backpack:[],
    friends:[], groups:[], chatHistories:{}, moments:[],
    followedOA:[], shoppingCart:[], forumCache:[],
    chatBg:'', momentBg:'',
    stickers:[], // {id, url, desc}
    worldBooks:[], // {id, name, type:'global'|'character', content:'', assignedTo:[]}
  },

  async load() {
    try {
      const data = await SV.get('/api/data');
      this._d = data || {};
      for (const k in this.defaults) {
        if (this._d[k] === undefined || this._d[k] === null) this._d[k] = JSON.parse(JSON.stringify(this.defaults[k]));
      }
    } catch(e) {
      console.error('Load data failed:', e);
      this._d = JSON.parse(JSON.stringify(this.defaults));
    }
  },

  save() {
    this._dirty = true;
    if (!this._timer) {
      this._timer = setTimeout(async () => {
        this._timer = null;
        if (this._dirty) {
          this._dirty = false;
          try { await SV.post('/api/data', this._d); } catch(e) { console.error('Save fail:', e); this._dirty = true; }
        }
      }, 800);
    }
  },

  async forceSave() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    try { await SV.post('/api/data', this._d); this._dirty = false; } catch(e) { console.error('Force save fail:', e); }
  },

  get(k) { return this._d[k]; },
  set(k,v) { this._d[k] = v; this.save(); },
  getHistory(id) { if (!this._d.chatHistories[id]) this._d.chatHistories[id] = []; return this._d.chatHistories[id]; },
  addMsg(chatId, msg) {
    const h = this.getHistory(chatId);
    msg.id = U.uid(); msg.timestamp = Date.now();
    h.push(msg); this.save(); return msg;
  },
  getFriend(id) { return this._d.friends.find(f=>f.id===id); },
  getFriendByName(n) { return this._d.friends.find(f=>f.name===n); },
  getGroup(id) { return this._d.groups.find(g=>g.id===id); },
  addFriend(f) { if(!this._d.friends.find(x=>x.id===f.id)){this._d.friends.push(f);this.save();} },
  removeFriend(id) { this._d.friends=this._d.friends.filter(f=>f.id!==id); delete this._d.chatHistories[id]; this.save(); },
  addBackpack(item) {
    const ex = this._d.backpack.find(i=>i.name===item.name);
    if(ex) ex.count=(ex.count||1)+(item.count||1); else { item.count=item.count||1; this._d.backpack.push(item); }
    this.save();
  },
  removeBackpack(name,n=1) {
    const it=this._d.backpack.find(i=>i.name===name); if(!it) return false;
    it.count-=n; if(it.count<=0) this._d.backpack=this._d.backpack.filter(i=>i.name!==name);
    this.save(); return true;
  },
  getWorldBooks(type, charName) {
    const wbs = this._d.worldBooks || [];
    if (type === 'global') return wbs.filter(w => w.type === 'global');
    if (type === 'character' && charName) return wbs.filter(w => w.type === 'character' && (w.assignedTo || []).includes(charName));
    return wbs;
  },
  getAllWBContent(charName) {
    const globals = this.getWorldBooks('global');
    const chars = charName ? this.getWorldBooks('character', charName) : [];
    return [...globals, ...chars].map(w => w.content || '').join('\n\n');
  },
  getStickers() { return this._d.stickers || []; },
  addSticker(s) { this._d.stickers.push(s); this.save(); },
  removeSticker(id) { this._d.stickers = this._d.stickers.filter(s=>s.id!==id); this.save(); }
};

// ===== AI API =====
const AI = {
  getBase() {
    let ep = (D.get('apiEndpoint')||'').trim().replace(/\/+$/,'');
    if (!ep) return '';
    if (!ep.endsWith('/v1')) ep += '/v1';
    return ep;
  },
  async fetchModels() {
    const base = this.getBase(), key = D.get('apiKey');
    if (!base || !key) return [];
    try {
      const r = await fetch(`${base}/models`, { headers:{'Authorization':`Bearer ${key}`} });
      const d = await r.json();
      let models = [];
      if (d.data && Array.isArray(d.data)) models = d.data.map(m=>({id:m.id,name:m.id}));
      D.set('availableModels', models);
      return models;
    } catch(e) { return []; }
  },
  async gen(sysPrompt, msgs, opts={}) {
    const base=this.getBase(), key=D.get('apiKey'), model=D.get('modelId');
    if (!base||!key||!model) return '请先配置API';
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method:'POST',
        headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},
        body:JSON.stringify({model, stream:false, max_tokens:opts.maxTokens||D.get('maxTokens'), temperature:opts.temperature||D.get('temperature'), messages:[{role:'system',content:sysPrompt},...msgs]})
      });
      const d = await r.json();
      return d.choices?.[0]?.message?.content || '生成失败';
    } catch(e) { return 'API错误: '+e.message; }
  },
  parseJSON(raw) {
    let c = raw.trim().replace(/^```json\s*/i,'').replace(/\s*```$/i,'');
    try { return JSON.parse(c); } catch {
      const m = c.match(/\[[\s\S]*\]/); if (m) try { return JSON.parse(m[0]); } catch {}
      const m2 = c.match(/\{[\s\S]*\}/); if (m2) try { return JSON.parse(m2[0]); } catch {}
      return null;
    }
  },
  buildWorldContext(charName) {
    const wbContent = D.getAllWBContent(charName);
    const stickers = D.getStickers();
    const stickerInfo = stickers.length ? '\n可用表情包：' + stickers.map(s => `[${s.desc}](${s.url})`).join(', ') : '';
    return wbContent + stickerInfo;
  },
  async chatReply(chatId, isGroup) {
    const history = D.getHistory(chatId);
    const recent = history.slice(-40);
    let charName = '';
    let chatInfo = '';
    if (isGroup) {
      const g = D.getGroup(chatId);
      if (g) { chatInfo = `群聊"${g.name}"，成员：${g.members.map(m=>m.name).join('、')}`; charName = g.name; }
    } else {
      const f = D.getFriend(chatId);
      if (f) { chatInfo = `与"${f.name}"私聊`; charName = f.name;
        if (f.persona) chatInfo += `\n好友人设：${f.persona}`;
        if (f.chatStyle) chatInfo += `\n聊天风格：${f.chatStyle}`;
      }
    }
    const wbCtx = this.buildWorldContext(charName);
    const progressSummary = recent.map(m => `[${m.sender}](${m.type}): ${m.type==='text'?m.content : m.type==='image'?`[图片:${m.url||''}]` : m.type==='sticker'?`[表情:${m.desc||''}]` : `[${m.type}]`}`).join('\n');

    const sys = `你是微信聊天模拟AI。扮演联系人回复。

世界书设定：
${wbCtx.substring(0,2000)}

当前聊天：${chatInfo}
玩家：${D.get('playerName')}
玩家人设：${D.get('playerPersona')}

聊天记录：
${progressSummary}

回复规则：
1. 模拟真实微信聊天风格
2. 回复JSON数组，可以多条(1-5条不等)：
[
  {"type":"text","content":"内容","sender":"角色名"},
  {"type":"image","url":"世界书中的真实图片链接","sender":"角色名"},
  {"type":"sticker","url":"世界书或表情包中的真实链接","desc":"表情描述","sender":"角色名"},
  {"type":"pat","sender":"拍的人","target":"被拍的人"},
  {"type":"redpacket","sender":"角色名","greeting":"祝福语","amount":数字}
]
3. 图片url必须使用世界书中的真实链接！
4. 表情包优先使用可用表情包列表中的链接
5. 参考玩家发送的图片内容来回复(你有视觉能力)
6. 群聊可多个不同sender
7. 只输出JSON数组，不要其他文字`;

    const apiMsgs = [];
    for (const m of recent.slice(-20)) {
      const role = m.sender === D.get('playerName') ? 'user' : 'assistant';
      if (m.type === 'image' && m.url && role === 'user') {
        apiMsgs.push({ role, content: [
          { type:'text', text:`[${m.sender}发送了图片]` },
          { type:'image_url', image_url:{ url: m.url } }
        ]});
      } else {
        let txt = `[${m.sender}](${m.type}): ${m.type==='text'?m.content : m.type==='image'?`[图片:${m.url}]` : m.type==='sticker'?`[表情:${m.desc||''}]` : `[${m.type}]`}`;
        apiMsgs.push({ role, content: txt });
      }
    }

    const raw = await this.gen(sys, apiMsgs);
    const parsed = this.parseJSON(raw);
    if (parsed) return Array.isArray(parsed) ? parsed : [parsed];
    return [{ type:'text', content:raw, sender: this.defaultSender(chatId,isGroup) }];
  },

  defaultSender(chatId, isGroup) {
    if (isGroup) { const g=D.getGroup(chatId); if(g?.members?.length){ const np=g.members.filter(m=>m.name!==D.get('playerName')); return np.length?np[Math.floor(Math.random()*np.length)].name:g.members[0].name; } return '群友'; }
    const f=D.getFriend(chatId); return f?f.name:'对方';
  },

  async momentComments(text, images) {
    const friends = D.get('friends').slice(0,10);
    const names = friends.map(f=>f.name).join('、');
    const wbCtx = this.buildWorldContext('');
    const imgRef = images?.length ? `\n发了${images.length}张图片: ${images.map(u=>`[图片:${u}]`).join(',')}` : '';

    const sys = `玩家"${D.get('playerName')}"发朋友圈："${text}"${imgRef}
好友：${names||'暂无'}
世界书：${wbCtx.substring(0,800)}
生成JSON：{"likes":["点赞人名数组"],"comments":[{"sender":"人名","content":"评论"}]}
评论要符合各人性格。只输出JSON。`;

    const msgs = [];
    if (images?.length) {
      msgs.push({ role:'user', content: [
        { type:'text', text:`朋友圈内容：${text}` },
        ...images.slice(0,3).map(u => ({ type:'image_url', image_url:{url:u} }))
      ]});
    }

    const raw = await this.gen(sys, msgs);
    return this.parseJSON(raw) || { likes:[], comments:[] };
  },

  async generateFriendInfo(name) {
    const wbCtx = this.buildWorldContext(name);
    const sys = `世界书信息：${wbCtx.substring(0,1500)}
生成角色"${name}"的微信好友信息JSON：
{"name":"${name}","avatar":"头像图片链接(用世界书中的真实链接)","persona":"人设描述","chatStyle":"聊天风格","signature":"个性签名","photos":["照片链接数组"]}
优先使用世界书中的真实链接。只输出JSON。`;
    const raw = await this.gen(sys, []);
    return this.parseJSON(raw);
  },

  async genShopItems(keyword='') {
    const wbCtx = this.buildWorldContext('');
    const sys = `${keyword?'搜索商品："'+keyword+'"':'推荐商品'}\n参考：${wbCtx.substring(0,500)}\n生成6-8个JSON数组：[{"name":"商品名","price":价格,"desc":"描述","emoji":"emoji"}]\n只输出JSON。`;
    const raw = await this.gen(sys, []);
    return this.parseJSON(raw) || [{name:'礼盒',price:99,desc:'惊喜',emoji:'🎁'}];
  },

  async genForumPosts(keyword='') {
    const friends = D.get('friends').slice(0,8);
    const names = friends.map(f=>f.name).join('、')||'路人甲、路人乙';
    const wbCtx = this.buildWorldContext('');
    const sys = `${keyword?'搜索帖子："'+keyword+'"':'生成帖子'}\n用户：${names}\n参考：${wbCtx.substring(0,500)}\n生成4-6条JSON：[{"author":"发帖人","title":"标题","content":"内容","likes":数字,"time":"时间","replies":[{"author":"回复人","content":"回复","time":"时间"}]}]\n只输出JSON。`;
    const raw = await this.gen(sys, []);
    return this.parseJSON(raw) || [];
  },

  async searchOA(query) {
    const sys = `搜索公众号："${query}"\n生成3-5个JSON：[{"name":"名称","desc":"简介","avatar":"emoji"}]\n只输出JSON。`;
    const raw = await this.gen(sys, []);
    return this.parseJSON(raw) || [{name:query+'资讯',desc:'关注获取资讯',avatar:'📰'}];
  },

  async genArticles(name) {
    const sys = `公众号"${name}"推送文章。生成3篇JSON：[{"title":"标题","summary":"摘要","content":"完整内容200-500字","readCount":数字}]\n只输出JSON。`;
    const raw = await this.gen(sys, []);
    return this.parseJSON(raw) || [];
  },

  async genMoments() {
    const friends = D.get('friends').slice(0,8);
    const names = friends.map(f=>f.name).join('、');
    const wbCtx = this.buildWorldContext('');
    const sys = `好友：${names}\n世界书：${wbCtx.substring(0,1000)}\n生成3-5条好友朋友圈JSON数组：
[{"author":"发布人","text":"朋友圈内容","images":["世界书中的真实图片链接"],"likes":["点赞人"],"comments":[{"sender":"评论人","content":"评论"}]}]
图片链接必须使用世界书中的真实链接。只输出JSON。`;
    const raw = await this.gen(sys, []);
    return this.parseJSON(raw) || [];
  }
};

// ===== 图片压缩 =====
async function compressImage(file, maxDim=1200, quality=0.8) {
  return new Promise((resolve) => {
    if (file.type === 'image/gif') { resolve(file); return; }
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w <= maxDim && h <= maxDim && file.size <= 500*1024) { resolve(file); return; }
      const scale = Math.min(maxDim/w, maxDim/h, 1);
      w = Math.round(w*scale); h = Math.round(h*scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => { resolve(blob || file); }, 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

async function uploadFile(file) {
  if (file.type?.startsWith('image/') && file.type !== 'image/gif') {
    file = await compressImage(file);
  }
  const result = await SV.upload(file);
  return result.url || null;
}

function pickFile(accept='image/*') {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = e => resolve(e.target.files[0] || null);
    inp.click();
  });
}

// ==================== 主应用 ====================
const App = {
  el: null,
  page: 'chat-list',
  stack: [],
  chatId: null,
  chatIsGroup: false,
  generating: false,
  shopItems: [],
  forumPosts: [],
  currentForumPost: null,
  oaName: '',
  oaArticles: [],
  currentArticle: null,
  momentImgs: [],
  contactId: null,
  rpDetailMsg: null,

  async start() {
    this.el = document.getElementById('app');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

    const check = await SV.get('/api/check');
    if (check.authed) {
      await D.load();
      this.render();
      setInterval(() => { const t = this.el.querySelector('.statusbar .time'); if(t) t.textContent = U.time(); }, 30000);
      // 自动保存
      setInterval(() => D.save(), 10000);
      window.addEventListener('beforeunload', () => D.forceSave());
      document.addEventListener('visibilitychange', () => { if(document.visibilityState==='hidden') D.forceSave(); });
    } else {
      this.renderAuth(check.hasUser);
    }
  },

  // ===== 认证页 =====
  renderAuth(hasUser) {
    const isLogin = hasUser;
    this.el.innerHTML = `<div class="login-page">
      <h1>🟢 WeChatSim</h1>
      <p>微信模拟器 v4.0</p>
      <div class="login-box">
        <input id="auth-user" placeholder="用户名" autocomplete="username"/>
        <input id="auth-pass" type="password" placeholder="密码" autocomplete="current-password"/>
        <button onclick="App.doAuth(${isLogin})">${isLogin ? '登录' : '注册'}</button>
        <div class="login-err" id="auth-err"></div>
        ${hasUser ? '' : '<div class="switch">首次使用，请注册账号</div>'}
      </div>
    </div>`;
  },

  async doAuth(isLogin) {
    const user = document.getElementById('auth-user')?.value?.trim();
    const pass = document.getElementById('auth-pass')?.value;
    if (!user||!pass) { document.getElementById('auth-err').textContent='请填写完整'; return; }
    const url = isLogin ? '/api/login' : '/api/register';
    const r = await SV.post(url, { username:user, password:pass });
    if (r.ok) { SV.token = r.token; await D.load(); this.render(); }
    else { document.getElementById('auth-err').textContent = r.error || '失败'; }
  },

  // ===== 渲染 =====
  render() {
    const pg = this.page;
    let h = '';
    if (pg === 'chat-list') h = this.pgChatList();
    else if (pg === 'contacts') h = this.pgContacts();
    else if (pg === 'discover') h = this.pgDiscover();
    else if (pg === 'me') h = this.pgMe();
    else if (pg === 'chat') h = this.pgChat();
    else if (pg === 'moments') h = this.pgMoments();
    else if (pg === 'compose-moment') h = this.pgComposeMoment();
    else if (pg === 'wallet') h = this.pgWallet();
    else if (pg === 'backpack') h = this.pgBackpack();
    else if (pg === 'stickers') h = this.pgStickers();
    else if (pg === 'worldbook') h = this.pgWorldBook();
    else if (pg === 'wb-edit') h = this.pgWBEdit();
    else if (pg === 'persona') h = this.pgPersona();
    else if (pg === 'settings') h = this.pgSettings();
    else if (pg === 'profile') h = this.pgProfile();
    else if (pg === 'oa-list') h = this.pgOAList();
    else if (pg === 'oa-detail') h = this.pgOADetail();
    else if (pg === 'article') h = this.pgArticle();
    else if (pg === 'shop') h = this.pgShop();
    else if (pg === 'forum') h = this.pgForum();
    else if (pg === 'forum-detail') h = this.pgForumDetail();
    else if (pg === 'rp-detail') h = this.pgRPDetail();
    else h = this.pgChatList();

    this.el.innerHTML = h;
    if (pg === 'chat') this.scrollChat();
  },

  nav(pg) { this.stack.push(this.page); this.page = pg; this.render(); },
  goBack() { this.page = this.stack.pop() || 'chat-list'; this.render(); },
  switchTab(t) {
    const map = {chats:'chat-list',contacts:'contacts',discover:'discover',me:'me'};
    this.page = map[t]||'chat-list'; this.stack=[]; this.render();
  },
  scrollChat() { setTimeout(()=>{ const c=document.getElementById('chat-msgs'); if(c) c.scrollTop=c.scrollHeight; },50); },

  // ===== 通用组件 =====
  statusBar() {
    return `<div class="statusbar">
      <span class="time">${U.time()}</span>
      <button class="ai-btn ${this.generating?'loading':''}" onclick="App.doAI()">⚡ AI</button>
      <span class="icons">📶 🔋</span>
    </div>`;
  },
  navbar(title, back=false, actions='') {
    return `<div class="navbar">${back?`<button class="back" onclick="App.goBack()">‹</button>`:'<div></div>'}<div class="title">${title}</div><div class="actions">${actions}</div></div>`;
  },
  tabbar(active='chats') {
    const tabs = [
      {id:'chats',label:'微信',icon:'💬'},
      {id:'contacts',label:'通讯录',icon:'👥'},
      {id:'discover',label:'发现',icon:'🌍'},
      {id:'me',label:'我',icon:'👤'}
    ];
    return `<div class="tabbar">${tabs.map(t=>`<button class="tab ${active===t.id?'active':''}" onclick="App.switchTab('${t.id}')"><span class="tab-icon">${t.icon}</span><span>${t.label}</span></button>`).join('')}</div>`;
  },
  toast(msg) {
    const old = document.querySelector('.toast'); if(old) old.remove();
    const t = document.createElement('div'); t.className='toast'; t.textContent=msg;
    document.body.appendChild(t);
    setTimeout(()=>t.remove(), 2200);
  },
  modal(title, body, btns) {
    const old = document.querySelector('.overlay'); if(old) old.remove();
    const o = document.createElement('div'); o.className='overlay';
    o.innerHTML = `<div class="modal">${title?`<div class="modal-hd">${title}</div>`:''}<div class="modal-bd">${body}</div><div class="modal-ft">${btns.map(b=>`<button class="${b.cls||''}" onclick="${b.action}">${b.label}</button>`).join('')}</div></div>`;
    document.body.appendChild(o);
  },
  closeModal() { document.querySelector('.overlay')?.remove(); },
  getAvatar(name, custom) { return custom || U.avatar(name); },

  // ===== AI按钮（状态栏中间） =====
  async doAI() {
    if (this.generating) return;
    const pg = this.page;
    if (pg === 'chat') await this.doChatReply();
    else if (pg === 'moments') await this.genMoments();
    else if (pg === 'forum') await this.refreshForum();
    else { this.toast('当前页面：聊天/朋友圈/论坛可用AI'); }
  },

  async doChatReply() {
    if (!this.chatId) return;
    this.generating = true; this.render();
    try {
      const replies = await AI.chatReply(this.chatId, this.chatIsGroup);
      for (const r of replies) {
        const sender = r.sender || AI.defaultSender(this.chatId, this.chatIsGroup);
        if (r.type==='pat') D.addMsg(this.chatId, {type:'pat',sender:r.sender||sender,target:r.target||D.get('playerName')});
        else if (r.type==='redpacket') D.addMsg(this.chatId, {type:'redpacket',sender,greeting:r.greeting||'恭喜发财',amount:r.amount||Math.random()*10,opened:false});
        else if (r.type==='image') D.addMsg(this.chatId, {type:'image',url:r.url||'',sender});
        else if (r.type==='sticker') D.addMsg(this.chatId, {type:'sticker',url:r.url||'',desc:r.desc||'',sender});
        else D.addMsg(this.chatId, {type:'text',content:r.content||r.text||'',sender});
      }
    } catch(e) { this.toast('生成失败'); }
    this.generating = false; this.render();
  },

  async genMoments() {
    this.generating = true; this.render();
    try {
      const moments = await AI.genMoments();
      for (const m of moments) {
        const f = D.getFriendByName(m.author);
        D._d.moments.push({
          id: U.uid(), author: m.author, avatar: f?.avatar || '', text: m.text || '',
          images: m.images || [], timestamp: Date.now() - Math.random()*3600000,
          likes: m.likes || [], comments: m.comments || []
        });
      }
      D.save();
    } catch(e) { this.toast('生成失败'); }
    this.generating = false; this.render();
  },

  // ==================== 页面: 聊天列表 ====================
  pgChatList() {
    const chats = [];
    D.get('friends').forEach(f => {
      const h = D.getHistory(f.id); const last = h[h.length-1];
      if (last) chats.push({id:f.id,name:f.name,avatar:f.avatar,lastMsg:last.type==='text'?last.content:`[${last.type}]`,time:U.fmtTime(last.timestamp),ts:last.timestamp,isGroup:false});
    });
    D.get('groups').forEach(g => {
      const h = D.getHistory(g.id); const last = h[h.length-1];
      if (last) chats.push({id:g.id,name:g.name,avatar:g.avatar,lastMsg:`${last.sender}: ${last.type==='text'?last.content:`[${last.type}]`}`,time:U.fmtTime(last.timestamp),ts:last.timestamp,isGroup:true});
    });
    chats.sort((a,b)=>b.ts-a.ts);

    return `${this.statusBar()}${this.navbar('微信',false,`<button onclick="App.showAddMenu()">➕</button>`)}
<div class="page">
  <div class="search-bar"><input placeholder="搜索" oninput="App.searchChats(this.value)"/></div>
  <div id="chat-items">
    ${chats.map(c=>`<div class="chat-item" onclick="App.openChat('${c.id}',${c.isGroup})">
      <img class="av" src="${this.getAvatar(c.name,c.avatar)}" onerror="this.src='${U.avatar(c.name)}'"/>
      <div class="info"><div class="name-row"><span class="name">${c.name}</span><span class="time">${c.time}</span></div><div class="preview">${U.esc(c.lastMsg).substring(0,30)}</div></div>
    </div>`).join('')}
    ${chats.length===0?'<div class="empty">暂无聊天<br>点击右上角 ➕ 添加好友</div>':''}
  </div>
</div>${this.tabbar('chats')}`;
  },
  searchChats(q) { document.querySelectorAll('#chat-items .chat-item').forEach(el=>{const n=el.querySelector('.name')?.textContent||'';el.style.display=n.includes(q)?'flex':'none';}); },

  // ==================== 页面: 聊天 ====================
  pgChat() {
    const isG = this.chatIsGroup;
    const info = isG ? D.getGroup(this.chatId) : D.getFriend(this.chatId);
    if (!info) return this.pgChatList();
    const history = D.getHistory(this.chatId);
    const title = info.name + (isG ? ` (${info.members?.length||0})` : '');
    const pName = D.get('playerName');
    const chatBg = D.get('chatBg');
    const bgStyle = chatBg ? `background-image:url('${chatBg}');` : '';

    const msgs = history.map((msg,i) => {
      const isSelf = msg.sender === pName;
      const av = isSelf ? this.getAvatar(pName,D.get('playerAvatar')) : (info.avatar || U.avatar(msg.sender||info.name));

      let timeLbl = '';
      if (i===0||(msg.timestamp-history[i-1].timestamp>300000)) timeLbl = `<div class="msg-time">${U.fmtMsgTime(msg.timestamp)}</div>`;

      if (msg.type==='system') return `${timeLbl}<div class="msg-sys">${U.esc(msg.content)}</div>`;
      if (msg.type==='pat') return `${timeLbl}<div class="msg-pat">"${msg.sender}" 拍了拍 "${msg.target}"</div>`;

      if (msg.type==='redpacket') {
        return `${timeLbl}<div class="msg-row ${isSelf?'self':''}">
          <img class="m-av" src="${av}" onerror="this.src='${U.avatar(msg.sender)}'"/>
          <div class="msg-wrap">${!isSelf&&isG?`<div class="msg-sender">${msg.sender}</div>`:''}
            <div class="bubble rp-b ${msg.opened?'opened':''}" onclick="App.openRP('${msg.id}')">
              <div class="rp-body"><div class="rp-icon">🧧</div><div class="rp-text">${U.esc(msg.greeting||'恭喜发财')}</div></div>
              <div class="rp-footer">微信红包${msg.opened?' · 已领取':''}</div>
            </div></div></div>`;
      }
      if (msg.type==='gift') {
        return `${timeLbl}<div class="msg-row ${isSelf?'self':''}">
          <img class="m-av" src="${av}" onerror="this.src='${U.avatar(msg.sender)}'"/>
          <div class="msg-wrap"><div class="bubble gift-b"><div class="g-icon">${msg.emoji||'🎁'}</div><div class="g-name">${U.esc(msg.giftName||'礼物')}</div></div></div></div>`;
      }
      if (msg.type==='image') {
        return `${timeLbl}<div class="msg-row ${isSelf?'self':''}">
          <img class="m-av" src="${av}" onerror="this.src='${U.avatar(msg.sender)}'"/>
          <div class="msg-wrap"><div class="bubble img-b"><img src="${msg.url}" onerror="this.alt='加载失败'" onclick="App.viewImg('${U.escAttr(msg.url)}')"/></div></div></div>`;
      }
      if (msg.type==='sticker') {
        return `${timeLbl}<div class="msg-row ${isSelf?'self':''}">
          <img class="m-av" src="${av}" onerror="this.src='${U.avatar(msg.sender)}'"/>
          <div class="msg-wrap"><div class="bubble sticker-b"><img src="${msg.url}" onerror="this.alt='${msg.desc||'表情'}'" title="${U.esc(msg.desc||'')}"/></div></div></div>`;
      }
      if (msg.type==='video') {
        return `${timeLbl}<div class="msg-row ${isSelf?'self':''}">
          <img class="m-av" src="${av}" onerror="this.src='${U.avatar(msg.sender)}'"/>
          <div class="msg-wrap"><div class="bubble vid-b" onclick="App.playVid('${U.escAttr(msg.url)}')"><video src="${msg.url}" preload="metadata"></video><div class="play-o">▶</div></div></div></div>`;
      }
      if (msg.type==='location') {
        return `${timeLbl}<div class="msg-row ${isSelf?'self':''}">
          <img class="m-av" src="${av}" onerror="this.src='${U.avatar(msg.sender)}'"/>
          <div class="msg-wrap"><div class="bubble loc-b"><div class="loc-map">📍</div><div class="loc-name">${U.esc(msg.content||'位置')}</div></div></div></div>`;
      }

      return `${timeLbl}<div class="msg-row ${isSelf?'self':''}">
        <img class="m-av" src="${av}" onerror="this.src='${U.avatar(msg.sender||'')}'"/>
        <div class="msg-wrap">${!isSelf&&isG?`<div class="msg-sender">${msg.sender}</div>`:''}
          <div class="bubble">${U.esc(msg.content||'')}</div>
        </div></div>`;
    }).join('');

    return `${this.statusBar()}${this.navbar(title,true,`<button onclick="App.chatMenu()">⋯</button>`)}
<div class="chat-page">
  <div class="chat-msgs" id="chat-msgs" style="${bgStyle}">${msgs}</div>
  <div class="input-bar">
    <button onclick="App.showStickers()">😊</button>
    <textarea id="chat-inp" rows="1" placeholder="输入消息..." oninput="App.onInp(this)" onkeydown="App.onKey(event)"></textarea>
    <button onclick="App.toggleMore()">➕</button>
    <button class="send-btn" id="send-btn" onclick="App.sendMsg()">发送</button>
  </div>
  <div class="more-panel" id="more-panel">
    <div class="more-item" onclick="App.sendPhoto()"><div class="mi-icon">📷</div><span>照片</span></div>
    <div class="more-item" onclick="App.sendVideo()"><div class="mi-icon">🎬</div><span>视频</span></div>
    <div class="more-item" onclick="App.sendRP()"><div class="mi-icon">🧧</div><span>红包</span></div>
    <div class="more-item" onclick="App.sendGift()"><div class="mi-icon">🎁</div><span>礼物</span></div>
    <div class="more-item" onclick="App.doPat()"><div class="mi-icon">👋</div><span>拍一拍</span></div>
    <div class="more-item" onclick="App.sendLocation()"><div class="mi-icon">📍</div><span>定位</span></div>
    <div class="more-item" onclick="App.sendFromBP()"><div class="mi-icon">🎒</div><span>背包</span></div>
  </div>
</div>`;
  },

  onInp(ta) { const btn=document.getElementById('send-btn'); if(ta.value.trim()) btn?.classList.add('show'); else btn?.classList.remove('show'); ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,100)+'px'; },
  onKey(e) { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();this.sendMsg();} },
  sendMsg() {
    const inp=document.getElementById('chat-inp'); const text=inp?.value?.trim();
    if(!text) return;
    D.addMsg(this.chatId, {type:'text',content:text,sender:D.get('playerName')});
    inp.value=''; inp.style.height='auto'; document.getElementById('send-btn')?.classList.remove('show');
    this.render();
  },
  toggleMore() { document.getElementById('more-panel')?.classList.toggle('show'); },

  async sendPhoto() {
    this.closeModal();
    const body = `<div>
      <div class="field"><label>图片链接</label><input id="ph-url" placeholder="输入链接"/></div>
      <div style="text-align:center;padding:8px;color:var(--text2);font-size:13px;">— 或 —</div>
      <div class="field"><label>本地上传</label><input type="file" accept="image/*,image/gif" id="ph-file" style="font-size:14px;"/></div>
    </div>`;
    this.modal('发送照片', body, [
      {label:'取消',action:'App.closeModal()'},
      {label:'发送',cls:'primary',action:'App.doSendPhoto()'}
    ]);
  },
  async doSendPhoto() {
    const url = document.getElementById('ph-url')?.value?.trim();
    const fi = document.getElementById('ph-file');
    let src = url;
    if (!src && fi?.files?.length) {
      this.toast('上传中...');
      src = await uploadFile(fi.files[0]);
    }
    if (!src) { this.toast('请选择图片'); return; }
    D.addMsg(this.chatId, {type:'image',url:src,sender:D.get('playerName')});
    this.closeModal(); this.render();
  },

  async sendVideo() {
    const body = `<div>
      <div class="field"><label>视频链接</label><input id="vid-url" placeholder="输入链接"/></div>
      <div style="text-align:center;padding:8px;color:var(--text2);font-size:13px;">— 或 —</div>
      <div class="field"><label>本地上传</label><input type="file" accept="video/*" id="vid-file" style="font-size:14px;"/></div>
    </div>`;
    this.modal('发送视频', body, [
      {label:'取消',action:'App.closeModal()'},
      {label:'发送',cls:'primary',action:'App.doSendVideo()'}
    ]);
  },
  async doSendVideo() {
    const url = document.getElementById('vid-url')?.value?.trim();
    const fi = document.getElementById('vid-file');
    let src = url;
    if (!src && fi?.files?.length) { this.toast('上传中...'); src = await uploadFile(fi.files[0]); }
    if (!src) return;
    D.addMsg(this.chatId, {type:'video',url:src,sender:D.get('playerName')});
    this.closeModal(); this.render();
  },

  sendLocation() {
    const body = `<div class="field"><label>位置名称</label><input id="loc-name" placeholder="如：星巴克（天河路店）"/></div>`;
    this.modal('发送定位', body, [
      {label:'取消',action:'App.closeModal()'},
      {label:'发送',cls:'primary',action:'App.doSendLocation()'}
    ]);
  },
  doSendLocation() {
    const name = document.getElementById('loc-name')?.value?.trim();
    if (!name) { this.toast('请输入位置'); return; }
    D.addMsg(this.chatId, {type:'location',content:name,sender:D.get('playerName')});
    this.closeModal(); this.render();
  },

  showStickers() {
    const stickers = D.getStickers();
    const emojis = ['😊','😂','🤣','❤️','😍','🤔','😢','😎','👍','🙏','🎉','😴','😭','😘','🥰','😤','😱','🤗','👋','✨','🔥','💪','🤝','👏'];
    const body = `<div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:8px;">快捷表情</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
        ${emojis.map(e=>`<span style="font-size:28px;cursor:pointer;padding:2px;" onclick="App.putEmoji('${e}')">${e}</span>`).join('')}
      </div>
      ${stickers.length?`<div style="font-size:13px;color:var(--text2);margin-bottom:8px;">自定义表情包</div>
      <div class="sticker-grid">
        ${stickers.map(s=>`<div class="sticker-item" onclick="App.sendSticker('${U.escAttr(s.url)}','${U.escAttr(s.desc)}')">
          <img src="${s.url}" onerror="this.style.display='none'"/>
          <div class="st-desc">${U.esc(s.desc)}</div>
        </div>`).join('')}
      </div>`:''}
    </div>`;
    this.modal('表情', body, [{label:'关闭',action:'App.closeModal()'}]);
  },
  putEmoji(e) { const inp=document.getElementById('chat-inp'); if(inp){inp.value+=e;inp.focus();this.onInp(inp);} this.closeModal(); },
  sendSticker(url, desc) {
    D.addMsg(this.chatId, {type:'sticker',url,desc,sender:D.get('playerName')});
    this.closeModal(); this.render();
  },

  sendRP() {
    const body = `<div>
      <div class="field"><label>金额</label><input id="rp-amt" type="number" value="6.66" step="0.01"/></div>
      <div class="field"><label>祝福语</label><input id="rp-greet" value="恭喜发财"/></div>
    </div>`;
    this.modal('发红包', body, [
      {label:'取消',action:'App.closeModal()'},
      {label:'塞钱进红包',cls:'primary',action:'App.doSendRP()'}
    ]);
  },
  doSendRP() {
    const amt = parseFloat(document.getElementById('rp-amt')?.value)||6.66;
    const greet = document.getElementById('rp-greet')?.value||'恭喜发财';
    if (amt>D.get('walletBalance')) { this.toast('余额不足'); return; }
    D.set('walletBalance', D.get('walletBalance')-amt);
    D.addMsg(this.chatId, {type:'redpacket',sender:D.get('playerName'),greeting:greet,amount:amt,opened:false});
    this.closeModal(); this.render();
  },

  openRP(msgId) {
    const h = D.getHistory(this.chatId);
    const msg = h.find(m=>m.id===msgId);
    if (!msg) return;
    if (msg.opened) { this.rpDetailMsg=msg; this.nav('rp-detail'); return; }
    msg.opened = true;
    if (msg.sender !== D.get('playerName')) D.set('walletBalance', D.get('walletBalance')+msg.amount);
    D.save();
    this.rpDetailMsg = msg;
    this.nav('rp-detail');
  },

  pgRPDetail() {
    const msg = this.rpDetailMsg;
    if (!msg) return this.pgChatList();
    return `${this.statusBar()}${this.navbar('红包详情',true)}
<div class="page">
  <div class="rp-detail"><div class="rpd-sender">${msg.sender}的红包</div><div class="rpd-greeting">${U.esc(msg.greeting)}</div><div class="rpd-total">¥${msg.amount.toFixed(2)}</div></div>
  <div class="rp-record"><span>${msg.sender===D.get('playerName')?'对方':D.get('playerName')}领取了红包</span><span class="rpr-amt">¥${msg.amount.toFixed(2)}</span></div>
</div>`;
  },

  sendGift() {
    const gifts = [{emoji:'🌹',name:'玫瑰花',price:5.20},{emoji:'💍',name:'钻戒',price:520},{emoji:'🧸',name:'泰迪熊',price:66},{emoji:'🍫',name:'巧克力',price:13.14}];
    const body = `<div>${gifts.map(g=>`<div class="list-row" onclick="App.doGift('${g.emoji}','${g.name}',${g.price})"><span style="font-size:24px">${g.emoji}</span><span class="lr-name">${g.name}</span><span style="color:var(--danger)">¥${g.price}</span></div>`).join('')}</div>`;
    this.modal('送礼物', body, [{label:'关闭',action:'App.closeModal()'}]);
  },
  doGift(emoji,name,price) {
    if (price>D.get('walletBalance')) { this.toast('余额不足'); return; }
    D.set('walletBalance', D.get('walletBalance')-price);
    D.addMsg(this.chatId, {type:'gift',emoji,giftName:name,content:`送出了${name}`,sender:D.get('playerName'),price});
    this.closeModal(); this.render();
  },

  doPat() {
    if (!this.chatIsGroup) {
      const f=D.getFriend(this.chatId);
      if(f) { D.addMsg(this.chatId, {type:'pat',sender:D.get('playerName'),target:f.name}); this.render(); }
      return;
    }
    const g=D.getGroup(this.chatId); if(!g) return;
    const ms = g.members.filter(m=>m.name!==D.get('playerName'));
    const body = `<div>${ms.map(m=>`<div class="list-row" onclick="App.confirmPat('${U.escAttr(m.name)}')"><img class="lr-av" src="${this.getAvatar(m.name,m.avatar)}"/><span class="lr-name">${m.name}</span></div>`).join('')}</div>`;
    this.modal('拍谁', body, [{label:'取消',action:'App.closeModal()'}]);
  },
  confirmPat(name) { D.addMsg(this.chatId, {type:'pat',sender:D.get('playerName'),target:name}); this.closeModal(); this.render(); },

  sendFromBP() {
    const items = D.get('backpack');
    if (!items.length) { this.toast('背包空'); return; }
    const body = `<div>${items.map(it=>`<div class="list-row" onclick="App.doSendBP('${U.escAttr(it.name)}')"><span style="font-size:24px">${it.emoji||'📦'}</span><span class="lr-name">${it.name} ×${it.count}</span></div>`).join('')}</div>`;
    this.modal('背包送出', body, [{label:'关闭',action:'App.closeModal()'}]);
  },
  doSendBP(name) {
    D.addMsg(this.chatId, {type:'gift',emoji:'📦',giftName:name,content:`送出了${name}`,sender:D.get('playerName')});
    D.removeBackpack(name);
    this.closeModal(); this.render();
  },

  chatMenu() {
    const body = `<div>
      <div class="list-row" onclick="App.clearHistory()">🗑️ <span class="lr-name">清空聊天</span></div>
    </div>`;
    this.modal('', body, [{label:'关闭',action:'App.closeModal()'}]);
  },
  clearHistory() { D._d.chatHistories[this.chatId]=[]; D.save(); this.closeModal(); this.render(); },

  viewImg(url) {
    const o = document.createElement('div'); o.className='img-viewer'; o.onclick=()=>o.remove();
    o.innerHTML = `<img src="${url}"/>`;
    document.body.appendChild(o);
  },
  playVid(url) {
    const o = document.createElement('div'); o.className='overlay'; o.style.background='#000';
    o.innerHTML = `<video src="${url}" controls autoplay style="max-width:100%;max-height:100%;"></video>`;
    o.onclick = e => { if(e.target===o) o.remove(); };
    document.body.appendChild(o);
  },

  openChat(id, isGroup) { this.chatId=id; this.chatIsGroup=isGroup; this.nav('chat'); },

  // ==================== 页面: 通讯录 ====================
  pgContacts() {
    const friends = [...D.get('friends')].sort((a,b)=>a.name.localeCompare(b.name,'zh'));
    return `${this.statusBar()}${this.navbar('通讯录',false,`<button onclick="App.showAddFriend()">👤+</button>`)}
<div class="page">
  <div class="search-bar"><input placeholder="搜索"/></div>
  <div class="contact-feat" onclick="App.showAddFriend()"><div class="cf-icon" style="background:#FA9D3B;">👤</div><span>新的朋友</span></div>
  <div class="contact-feat" onclick="App.showGroupList()"><div class="cf-icon" style="background:var(--green);">👥</div><span>群聊</span></div>
  <div class="contact-section">好友 (${friends.length})</div>
  ${friends.map(f=>`<div class="contact-item" onclick="App.viewContactProfile('${f.id}')"><img class="av" src="${this.getAvatar(f.name,f.avatar)}" onerror="this.src='${U.avatar(f.name)}'"/><span class="cname">${f.name}</span></div>`).join('')}
  ${friends.length===0?'<div class="empty">暂无好友</div>':''}
</div>${this.tabbar('contacts')}`;
  },

  showAddFriend() {
    const body = `<div>
      <div class="field"><label>好友昵称</label><input id="af-name" placeholder="角色名称"/></div>
      <div class="field"><label>头像(可选，留空自动)</label><input id="af-avatar" placeholder="链接"/>
        <input type="file" accept="image/*" id="af-file" style="font-size:13px;margin-top:4px;"/></div>
      <div class="field"><label>人设(可选，留空AI生成)</label><textarea id="af-persona" placeholder="角色描述"></textarea></div>
    </div>`;
    this.modal('添加好友', body, [
      {label:'取消',action:'App.closeModal()'},
      {label:'添加',cls:'primary',action:'App.doAddFriend()'}
    ]);
  },

  async doAddFriend() {
    const name = document.getElementById('af-name')?.value?.trim();
    if (!name) { this.toast('请输入昵称'); return; }
    if (D.getFriendByName(name)) { this.toast('已是好友'); return; }

    let avatar = document.getElementById('af-avatar')?.value?.trim()||'';
    let persona = document.getElementById('af-persona')?.value?.trim()||'';
    const fi = document.getElementById('af-file');
    if (!avatar && fi?.files?.length) { this.toast('上传头像...'); avatar = await uploadFile(fi.files[0])||''; }

    this.closeModal(); this.toast('生成好友信息...');

    if (!avatar || !persona) {
      try {
        const gen = await AI.generateFriendInfo(name);
        if (gen) { if(!avatar&&gen.avatar) avatar=gen.avatar; if(!persona&&gen.persona) persona=gen.persona; }
      } catch(e) {}
    }

    const fid = 'f_'+name.replace(/\s/g,'_')+'_'+Date.now();
    D.addFriend({id:fid, name, avatar, persona, chatStyle:'', signature:'', addedAt:Date.now()});
    this.toast(`已添加"${name}"`); this.render();
  },

  showAddMenu() {
    const body = `<div>
      <div class="list-row" onclick="App.closeModal();App.showAddFriend();">👤 <span class="lr-name">添加好友</span></div>
      <div class="list-row" onclick="App.closeModal();App.showCreateGroup();">👥 <span class="lr-name">创建群聊</span></div>
    </div>`;
    this.modal('', body, [{label:'关闭',action:'App.closeModal()'}]);
  },

  showGroupList() {
    const groups = D.get('groups');
    const body = `<div>
      ${groups.map(g=>`<div class="list-row" onclick="App.closeModal();App.openChat('${g.id}',true);"><span class="lr-name">${g.name} (${g.members?.length||0})</span></div>`).join('')}
      ${groups.length===0?'<div style="padding:20px;text-align:center;color:var(--text2);">暂无群聊</div>':''}
      <button class="set-btn green" onclick="App.closeModal();App.showCreateGroup();">创建群聊</button>
    </div>`;
    this.modal('群聊', body, [{label:'关闭',action:'App.closeModal()'}]);
  },

  showCreateGroup() {
    const friends = D.get('friends');
    const body = `<div>
      <div class="field"><label>群名</label><input id="grp-name"/></div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:8px;">选择成员：</div>
      ${friends.map(f=>`<label class="list-row"><input type="checkbox" class="grp-chk" value="${f.id}" style="margin-right:8px;"/><span class="lr-name">${f.name}</span></label>`).join('')}
    </div>`;
    this.modal('创建群聊', body, [
      {label:'取消',action:'App.closeModal()'},
      {label:'创建',cls:'primary',action:'App.doCreateGroup()'}
    ]);
  },
  doCreateGroup() {
    const name = document.getElementById('grp-name')?.value?.trim();
    if (!name) { this.toast('输入群名'); return; }
    const cbs = document.querySelectorAll('.grp-chk:checked');
    const members = [{id:D.get('playerId'),name:D.get('playerName'),avatar:D.get('playerAvatar')}];
    cbs.forEach(cb=>{ const f=D.getFriend(cb.value); if(f) members.push({id:f.id,name:f.name,avatar:f.avatar}); });
    if (members.length<2) { this.toast('至少选1人'); return; }
    const gid='g_'+Date.now();
    D._d.groups.push({id:gid,name,avatar:'',members}); D.save();
    D.addMsg(gid, {type:'system',content:`创建了群聊"${name}"`,sender:'系统'});
    this.closeModal(); this.openChat(gid,true);
  },

  viewContactProfile(id) { this.contactId=id; this.nav('profile'); },
  pgProfile() {
    const f = D.getFriend(this.contactId);
    if (!f) return this.pgContacts();
    return `${this.statusBar()}${this.navbar('详细资料',true)}
<div class="page" style="background:var(--bg);">
  <div class="profile-card">
    <img class="pf-av" src="${this.getAvatar(f.name,f.avatar)}" onerror="this.src='${U.avatar(f.name)}'"/>
    <div><div class="pf-name">${f.name}</div><div class="pf-id">${f.signature||f.id}</div></div>
  </div>
  <button class="pf-btn green" onclick="App.openChat('${f.id}',false)">发消息</button>
  <button class="pf-btn red" onclick="App.deleteFriend('${f.id}')">删除好友</button>
</div>`;
  },
  deleteFriend(id) {
    this.modal('确认', '<div style="text-align:center">确定删除？</div>', [
      {label:'取消',action:'App.closeModal()'},
      {label:'删除',cls:'danger',action:`App.doDeleteFriend('${id}')`}
    ]);
  },
  doDeleteFriend(id) { D.removeFriend(id); this.closeModal(); this.toast('已删除'); this.switchTab('contacts'); },

  // ==================== 页面: 发现 ====================
  pgDiscover() {
    return `${this.statusBar()}${this.navbar('发现')}
<div class="page" style="background:var(--bg);">
  <div class="disc-group"><div class="disc-item" onclick="App.nav('moments')"><span class="di-icon">🌅</span><span class="di-text">朋友圈</span><span class="di-arrow">›</span></div></div>
  <div class="disc-group"><div class="disc-item" onclick="App.nav('oa-list')"><span class="di-icon">📰</span><span class="di-text">公众号</span><span class="di-arrow">›</span></div></div>
  <div class="disc-group"><div class="disc-item" onclick="App.openShop()"><span class="di-icon">🛒</span><span class="di-text">购物</span><span class="di-arrow">›</span></div></div>
  <div class="disc-group"><div class="disc-item" onclick="App.openForum()"><span class="di-icon">💬</span><span class="di-text">论坛</span><span class="di-arrow">›</span></div></div>
</div>${this.tabbar('discover')}`;
  },

  // ==================== 页面: 我 ====================
  pgMe() {
    const av = D.get('playerAvatar')||U.avatar(D.get('playerName'));
    return `${this.statusBar()}${this.navbar('我')}
<div class="page" style="background:var(--bg);">
  <div class="me-card" onclick="App.nav('persona')"><img class="me-av" src="${av}" onerror="this.src='${U.avatar(D.get('playerName'))}'"/><div><div class="me-name">${D.get('playerName')}</div><div class="me-id">${D.get('playerId')}</div></div></div>
  <div class="me-group">
    <div class="me-item" onclick="App.nav('wallet')"><span class="mi-icon">💰</span><span class="mi-text">钱包</span><span class="mi-extra">¥${D.get('walletBalance').toFixed(2)}</span><span class="mi-arrow">›</span></div>
  </div>
  <div class="me-group">
    <div class="me-item" onclick="App.nav('backpack')"><span class="mi-icon">🎒</span><span class="mi-text">背包</span><span class="mi-extra">${D.get('backpack').length}件</span><span class="mi-arrow">›</span></div>
  </div>
  <div class="me-group">
    <div class="me-item" onclick="App.nav('stickers')"><span class="mi-icon">😄</span><span class="mi-text">表情包管理</span><span class="mi-arrow">›</span></div>
    <div class="me-item" onclick="App.nav('worldbook')"><span class="mi-icon">📖</span><span class="mi-text">世界书</span><span class="mi-arrow">›</span></div>
    <div class="me-item" onclick="App.nav('persona')"><span class="mi-icon">✏️</span><span class="mi-text">个人设置</span><span class="mi-arrow">›</span></div>
    <div class="me-item" onclick="App.nav('settings')"><span class="mi-icon">⚙️</span><span class="mi-text">API设置</span><span class="mi-arrow">›</span></div>
  </div>
  <div class="me-group">
    <div class="me-item" onclick="App.logout()"><span class="mi-icon">🚪</span><span class="mi-text" style="color:var(--danger)">退出登录</span></div>
  </div>
</div>${this.tabbar('me')}`;
  },

  async logout() { await SV.post('/api/logout',{}); location.reload(); },

  // ==================== 朋友圈 ====================
  pgMoments() {
    const moments = [...D.get('moments')].sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
    const av = D.get('playerAvatar')||U.avatar(D.get('playerName'));
    const bg = D.get('momentBg')||'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#1a1a2e"/><stop offset="100%" style="stop-color:#16213e"/></linearGradient></defs><rect fill="url(#g)" width="400" height="260"/></svg>');

    return `${this.statusBar()}${this.navbar('朋友圈',true,`<button onclick="App.nav('compose-moment')">📷</button>`)}
<div class="page" style="background:white;">
  <div class="moment-header">
    <img class="m-cover" src="${bg}"/>
    <div class="m-profile"><span class="m-profile-name">${D.get('playerName')}</span><img class="m-profile-av" src="${av}"/></div>
  </div>
  ${moments.map(m => this.renderMoment(m)).join('')}
  ${moments.length===0?'<div class="empty">朋友圈空空如也～<br>点击状态栏⚡AI按钮生成好友朋友圈</div>':''}
</div>`;
  },

  renderMoment(m) {
    const av = m.avatar || U.avatar(m.author);
    const imgs = m.images?.length ? `<div class="m-imgs g${Math.min(m.images.length,3)}">${m.images.map(i=>`<img src="${i}" onerror="this.style.display='none'" onclick="App.viewImg('${U.escAttr(i)}')" />`).join('')}</div>` : '';
    const inter = (m.likes?.length||m.comments?.length) ? `<div class="m-interactions">
      ${m.likes?.length?`<div class="m-likes">❤️ ${m.likes.join('，')}</div>`:''}
      ${m.comments?.length?`<div class="m-comments">${m.comments.map(c=>`<div class="m-comment"><span class="cm-name">${c.sender}</span>${c.replyTo?` 回复 <span class="cm-name">${c.replyTo}</span>`:''}：${U.esc(c.content)} <span class="cm-reply-btn" onclick="event.stopPropagation();App.replyMomentComment('${m.id}','${U.escAttr(c.sender)}')">回复</span></div>`).join('')}</div>`:''}
    </div>` : '';

    return `<div class="moment">
      <img class="m-av" src="${av}" onerror="this.src='${U.avatar(m.author)}'"/>
      <div class="m-body">
        <div class="m-name">${m.author}</div>
        <div class="m-text">${U.esc(m.text)}</div>
        ${imgs}
        <div class="m-time-row"><span class="m-time">${U.fmtTime(m.timestamp)}</span><button class="m-action-btn" onclick="App.momentAction('${m.id}')">💬</button></div>
        ${inter}
      </div>
    </div>`;
  },

  momentAction(mid) {
    const body = `<div class="field"><label>评论</label><input id="mc-text" placeholder="写评论..."/></div>`;
    this.modal('评论', body, [
      {label:'取消',action:'App.closeModal()'},
      {label:'发送',cls:'primary',action:`App.doMomentComment('${mid}','')`}
    ]);
  },

  replyMomentComment(mid, replyTo) {
    const body = `<div class="field"><label>回复 ${replyTo}</label><input id="mc-text" placeholder="回复..."/></div>`;
    this.modal('回复', body, [
      {label:'取消',action:'App.closeModal()'},
      {label:'发送',cls:'primary',action:`App.doMomentComment('${mid}','${U.escAttr(replyTo)}')`}
    ]);
  },

  doMomentComment(mid, replyTo) {
    const text = document.getElementById('mc-text')?.value?.trim();
    if (!text) return;
    const m = D._d.moments.find(x=>x.id===mid);
    if (!m) return;
    if (!m.comments) m.comments = [];
    m.comments.push({ sender:D.get('playerName'), content:text, replyTo:replyTo||undefined });
    D.save();
    this.closeModal(); this.render();
  },

  pgComposeMoment() {
    return `${this.statusBar()}${this.navbar('发表',true,`<button onclick="App.publishMoment()" style="background:var(--green);color:white;border:none;border-radius:4px;padding:4px 12px;font-size:14px;">发表</button>`)}
<div class="page" style="background:white;padding:16px;">
  <textarea id="mt-text" placeholder="这一刻的想法..." style="width:100%;min-height:120px;border:none;outline:none;font-size:16px;resize:none;font-family:inherit;"></textarea>
  <div id="mt-imgs" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
    ${this.momentImgs.map(i=>`<img src="${i}" style="width:80px;height:80px;object-fit:cover;border-radius:4px;"/>`).join('')}
    <div onclick="App.addMomentImg()" style="width:80px;height:80px;border:1px dashed #ccc;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:28px;color:#ccc;">+</div>
  </div>
  <div class="field" style="margin-top:10px;"><label>图片链接(可选)</label><input id="mt-imgurl" placeholder="输入链接后点+号"/></div>
</div>`;
  },
  async addMomentImg() {
    const url = document.getElementById('mt-imgurl')?.value?.trim();
    if (url) { this.momentImgs.push(url); document.getElementById('mt-imgurl').value=''; this.render(); return; }
    const file = await pickFile('image/*');
    if (file) { this.toast('上传中...'); const u = await uploadFile(file); if(u) { this.momentImgs.push(u); this.render(); } }
  },
  async publishMoment() {
    const text = document.getElementById('mt-text')?.value?.trim();
    if (!text) { this.toast('请输入内容'); return; }
    const moment = { id:U.uid(), author:D.get('playerName'), avatar:D.get('playerAvatar'), text, images:[...this.momentImgs], timestamp:Date.now(), likes:[], comments:[] };
    D._d.moments.push(moment); D.save();
    this.momentImgs = [];
    this.toast('已发布');
    this.goBack();
    try {
      const reactions = await AI.momentComments(text, moment.images);
      const m = D._d.moments.find(x=>x.id===moment.id);
      if (m) { m.likes=reactions.likes||[]; m.comments=reactions.comments||[]; D.save(); if(this.page==='moments') this.render(); }
    } catch(e) {}
  },

  // ==================== 钱包 ====================
  pgWallet() {
    return `${this.statusBar()}${this.navbar('钱包',true)}
<div class="page" style="background:var(--bg);">
  <div class="wallet-card"><div class="w-label">余额</div><div class="w-amount">¥${D.get('walletBalance').toFixed(2)}</div></div>
  <button class="set-btn green" onclick="App.walletRecharge()">💰 充值</button>
</div>`;
  },
  walletRecharge() {
    this.modal('充值', '<div class="field"><input id="rc-amt" type="number" value="100"/></div>', [
      {label:'取消',action:'App.closeModal()'},
      {label:'充值',cls:'primary',action:'App.doRecharge()'}
    ]);
  },
  doRecharge() { const amt=parseFloat(document.getElementById('rc-amt')?.value)||0; if(amt<=0) return; D.set('walletBalance',D.get('walletBalance')+amt); this.closeModal(); this.render(); this.toast(`+¥${amt}`); },

  // ==================== 背包 ====================
  pgBackpack() {
    const items = D.get('backpack');
    return `${this.statusBar()}${this.navbar('背包',true)}
<div class="page" style="background:var(--bg);padding:12px;">
  ${items.length?`<div class="bp-grid">${items.map(it=>`<div class="bp-item"><div class="bp-icon">${it.emoji||'📦'}</div><div class="bp-name">${it.name}</div><div class="bp-count">×${it.count}</div></div>`).join('')}</div>`:'<div class="empty">背包空空<br>去购物吧</div>'}
</div>`;
  },

  // ==================== 表情包管理 ====================
  pgStickers() {
    const stickers = D.getStickers();
    return `${this.statusBar()}${this.navbar('表情包管理',true)}
<div class="page" style="background:var(--bg);padding:12px;">
  <button class="set-btn green" onclick="App.addStickerDialog()" style="margin:0 0 12px;">+ 添加表情包</button>
  ${stickers.length?`<div class="sticker-grid" style="background:white;padding:12px;border-radius:8px;">
    ${stickers.map(s=>`<div class="sticker-item" onclick="App.removeStickerDialog('${s.id}')">
      <img src="${s.url}" onerror="this.alt='加载失败'"/>
      <div class="st-desc">${U.esc(s.desc)}</div>
    </div>`).join('')}
  </div>`:'<div class="empty">暂无自定义表情包</div>'}
</div>`;
  },
  addStickerDialog() {
    const body = `<div>
      <div class="field"><label>图片链接</label><input id="sk-url" placeholder="输入链接"/></div>
      <div style="text-align:center;padding:4px;color:var(--text2);font-size:12px;">— 或上传 —</div>
      <div class="field"><input type="file" accept="image/*,image/gif" id="sk-file" style="font-size:14px;"/></div>
      <div class="field"><label>简要描述 (必填，AI参考用)</label><input id="sk-desc" placeholder="如：开心跳舞、生气踢人"/></div>
    </div>`;
    this.modal('添加表情包', body, [
      {label:'取消',action:'App.closeModal()'},
      {label:'添加',cls:'primary',action:'App.doAddSticker()'}
    ]);
  },
  async doAddSticker() {
    const desc = document.getElementById('sk-desc')?.value?.trim();
    if (!desc) { this.toast('请输入描述'); return; }
    let url = document.getElementById('sk-url')?.value?.trim();
    const fi = document.getElementById('sk-file');
    if (!url && fi?.files?.length) { this.toast('上传中...'); url = await uploadFile(fi.files[0]); }
    if (!url) { this.toast('请提供图片'); return; }
    D.addSticker({ id:U.uid(), url, desc });
    this.closeModal(); this.toast('已添加'); this.render();
  },
  removeStickerDialog(id) {
    this.modal('操作', '<div style="text-align:center">删除此表情？</div>', [
      {label:'取消',action:'App.closeModal()'},
      {label:'删除',cls:'danger',action:`App.doRemoveSticker('${id}')`}
    ]);
  },
  doRemoveSticker(id) { D.removeSticker(id); this.closeModal(); this.render(); },

  // ==================== 世界书 ====================
  pgWorldBook() {
    const wbs = D.get('worldBooks')||[];
    const globals = wbs.filter(w=>w.type==='global');
    const chars = wbs.filter(w=>w.type==='character');
    return `${this.statusBar()}${this.navbar('世界书',true)}
<div class="page" style="background:var(--bg);padding:12px;">
  <button class="wb-add-btn" onclick="App.addWB('global')">+ 新建全局世界书</button>
  <button class="wb-add-btn" style="background:var(--link);" onclick="App.addWB('character')">+ 新建角色世界书</button>
  ${globals.length?'<div style="padding:8px 0;font-size:14px;font-weight:600;color:var(--text2);">全局世界书</div>':''}
  ${globals.map(w=>`<div class="wb-entry"><div class="wb-hd" onclick="App.editWB('${w.id}')"><span class="wb-name">${w.name||'未命名'}</span><span class="wb-type">全局</span></div>
    <div class="wb-body">${U.esc((w.content||'').substring(0,100))}${w.content?.length>100?'...':''}</div>
  </div>`).join('')}
  ${chars.length?'<div style="padding:8px 0;font-size:14px;font-weight:600;color:var(--text2);">角色世界书</div>':''}
  ${chars.map(w=>`<div class="wb-entry"><div class="wb-hd" onclick="App.editWB('${w.id}')"><span class="wb-name">${w.name||'未命名'}</span><span class="wb-type">角色: ${(w.assignedTo||[]).join(',')}</span></div>
    <div class="wb-body">${U.esc((w.content||'').substring(0,100))}${w.content?.length>100?'...':''}</div>
  </div>`).join('')}
  ${wbs.length===0?'<div class="empty">暂无世界书<br>世界书内容对AI生成所有内容生效<br>格式不限，直接写文本即可</div>':''}
</div>`;
  },

  addWB(type) {
    const id = 'wb_'+U.uid();
    D._d.worldBooks.push({ id, name:'', type, content:'', assignedTo:[] });
    D.save();
    this._editWBId = id;
    this.nav('wb-edit');
  },
  editWB(id) { this._editWBId = id; this.nav('wb-edit'); },

  pgWBEdit() {
    const wb = (D.get('worldBooks')||[]).find(w=>w.id===this._editWBId);
    if (!wb) return this.pgWorldBook();
    const friends = D.get('friends');
    return `${this.statusBar()}${this.navbar('编辑世界书',true,`<button onclick="App.saveWB()" style="background:var(--green);color:white;border:none;border-radius:4px;padding:4px 12px;font-size:14px;">保存</button>`)}
<div class="page" style="background:white;padding:16px;">
  <div class="field"><label>名称</label><input id="wb-name" value="${U.esc(wb.name)}"/></div>
  <div class="field"><label>类型</label>
    <select id="wb-type"><option value="global" ${wb.type==='global'?'selected':''}>全局</option><option value="character" ${wb.type==='character'?'selected':''}>角色</option></select>
  </div>
  <div class="field" id="wb-assign-area" style="${wb.type==='character'?'':'display:none'}">
    <label>挂载到角色</label>
    <div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;">
      ${friends.map(f=>`<label style="display:flex;align-items:center;gap:8px;padding:4px 0;"><input type="checkbox" class="wb-assign-chk" value="${f.name}" ${(wb.assignedTo||[]).includes(f.name)?'checked':''}/><span>${f.name}</span></label>`).join('')}
      ${friends.length===0?'<div style="color:var(--text2);font-size:13px;">暂无好友</div>':''}
    </div>
  </div>
  <div class="field"><label>内容 (纯文本，格式不限)</label><textarea id="wb-content" style="min-height:250px;font-size:14px;line-height:1.6;">${U.esc(wb.content)}</textarea></div>
  <button class="set-btn red" onclick="App.deleteWB('${wb.id}')">删除此世界书</button>
</div>
<script>document.getElementById('wb-type').onchange=function(){document.getElementById('wb-assign-area').style.display=this.value==='character'?'':'none';}</script>`;
  },

  saveWB() {
    const wb = (D.get('worldBooks')||[]).find(w=>w.id===this._editWBId);
    if (!wb) return;
    wb.name = document.getElementById('wb-name')?.value?.trim()||'未命名';
    wb.type = document.getElementById('wb-type')?.value||'global';
    wb.content = document.getElementById('wb-content')?.value||'';
    wb.assignedTo = [];
    document.querySelectorAll('.wb-assign-chk:checked').forEach(c => wb.assignedTo.push(c.value));
    D.save();
    this.toast('已保存'); this.goBack();
  },

  deleteWB(id) {
    D._d.worldBooks = (D._d.worldBooks||[]).filter(w=>w.id!==id);
    D.save(); this.toast('已删除'); this.goBack();
  },

  // ==================== 个人设置 ====================
  pgPersona() {
    return `${this.statusBar()}${this.navbar('个人设置',true,`<button onclick="App.savePersona()" style="background:var(--green);color:white;border:none;border-radius:4px;padding:4px 12px;font-size:14px;">保存</button>`)}
<div class="page" style="background:white;padding:16px;">
  <div class="field"><label>昵称</label><input id="ps-name" value="${D.get('playerName')}"/></div>
  <div class="field"><label>头像链接</label><input id="ps-avatar" value="${D.get('playerAvatar')}" placeholder="链接"/>
    <input type="file" accept="image/*" id="ps-file" style="font-size:13px;margin-top:4px;"/></div>
  <div class="field"><label>微信号</label><input id="ps-wxid" value="${D.get('playerId')}"/></div>
  <div class="field"><label>个性签名</label><input id="ps-sig" value="${D.get('playerSignature')}"/></div>
  <div class="field"><label>人设描述</label><textarea id="ps-persona" style="min-height:100px;">${D.get('playerPersona')}</textarea></div>
  <div class="field"><label>聊天背景</label><input id="ps-chatbg" value="${D.get('chatBg')}" placeholder="链接"/>
    <input type="file" accept="image/*" id="ps-chatbg-file" style="font-size:13px;margin-top:4px;"/></div>
  <div class="field"><label>朋友圈背景</label><input id="ps-momentbg" value="${D.get('momentBg')}" placeholder="链接"/>
    <input type="file" accept="image/*" id="ps-momentbg-file" style="font-size:13px;margin-top:4px;"/></div>
</div>`;
  },
  async savePersona() {
    D.set('playerName', document.getElementById('ps-name')?.value?.trim()||'我');
    let av = document.getElementById('ps-avatar')?.value?.trim()||'';
    const fi = document.getElementById('ps-file');
    if (!av && fi?.files?.length) { av = await uploadFile(fi.files[0])||''; }
    D.set('playerAvatar', av);
    D.set('playerId', document.getElementById('ps-wxid')?.value?.trim()||'wxid_player');
    D.set('playerSignature', document.getElementById('ps-sig')?.value?.trim()||'');
    D.set('playerPersona', document.getElementById('ps-persona')?.value?.trim()||'');

    let cbg = document.getElementById('ps-chatbg')?.value?.trim()||'';
    const cbgF = document.getElementById('ps-chatbg-file');
    if (!cbg && cbgF?.files?.length) { cbg = await uploadFile(cbgF.files[0])||''; }
    D.set('chatBg', cbg);

    let mbg = document.getElementById('ps-momentbg')?.value?.trim()||'';
    const mbgF = document.getElementById('ps-momentbg-file');
    if (!mbg && mbgF?.files?.length) { mbg = await uploadFile(mbgF.files[0])||''; }
    D.set('momentBg', mbg);

    this.toast('已保存'); this.goBack();
  },

  // ==================== API设置 ====================
  pgSettings() {
    const models = D.get('availableModels')||[];
    return `${this.statusBar()}${this.navbar('API设置',true)}
<div class="page" style="background:var(--bg);padding:12px;">
  <div class="settings-group">
    <h4>API配置</h4>
    <div class="set-row"><label>API地址</label><input id="st-ep" value="${D.get('apiEndpoint')}" placeholder="https://api.xxx.com/v1"/></div>
    <div class="set-row"><label>API Key</label><input id="st-key" type="password" value="${D.get('apiKey')}"/></div>
    <div class="set-row"><button class="set-btn green" onclick="App.fetchModels()">拉取模型列表</button></div>
    <div class="set-row"><label>选择模型</label>
      <select id="st-model">${models.map(m=>`<option value="${m.id}" ${m.id===D.get('modelId')?'selected':''}>${m.name}</option>`).join('')}<option value="">手动输入↓</option></select>
    </div>
    <div class="set-row"><label>自定义模型ID</label><input id="st-model-custom" value="${D.get('modelId')}"/></div>
  </div>
  <div class="settings-group">
    <h4>生成参数</h4>
    <div class="set-row"><label>最大Token</label><input id="st-tokens" type="number" value="${D.get('maxTokens')}"/></div>
    <div class="set-row"><label>Temperature</label><input id="st-temp" type="number" step="0.05" value="${D.get('temperature')}"/></div>
  </div>
  <button class="set-btn green" onclick="App.saveSettings()">💾 保存设置</button>
  <div class="settings-group" style="margin-top:12px;">
    <h4>数据管理</h4>
    <button class="set-btn gray" onclick="App.exportData()">📤 导出数据</button>
    <button class="set-btn gray" onclick="document.getElementById('imp-f').click()">📥 导入数据</button>
    <input type="file" id="imp-f" accept=".json" style="display:none;" onchange="App.doImport(this)"/>
    <button class="set-btn red" onclick="App.resetData()">🗑️ 重置数据</button>
  </div>
</div>`;
  },

  async fetchModels() {
    D.set('apiEndpoint', document.getElementById('st-ep')?.value?.trim()||'');
    D.set('apiKey', document.getElementById('st-key')?.value?.trim()||'');
    this.toast('拉取中...');
    const models = await AI.fetchModels();
    this.toast(models.length?`获取${models.length}个模型`:'获取失败');
    this.render();
  },
  saveSettings() {
    D.set('apiEndpoint', document.getElementById('st-ep')?.value?.trim()||'');
    D.set('apiKey', document.getElementById('st-key')?.value?.trim()||'');
    const sel = document.getElementById('st-model')?.value;
    const cus = document.getElementById('st-model-custom')?.value?.trim();
    D.set('modelId', cus||sel||'');
    D.set('maxTokens', parseInt(document.getElementById('st-tokens')?.value)||2048);
    D.set('temperature', parseFloat(document.getElementById('st-temp')?.value)||0.85);
    this.toast('已保存');
  },
  exportData() {
    const data = JSON.stringify(D._d, null, 2);
    const blob = new Blob([data],{type:'application/json'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`wechatsim_${Date.now()}.json`; a.click();
  },
  doImport(input) {
    if (!input.files?.length) return;
    const r = new FileReader();
    r.onload = e => {
      try { const data=JSON.parse(e.target.result); Object.assign(D._d, data); D.forceSave(); this.toast('已导入'); this.render(); }
      catch { this.toast('导入失败'); }
    };
    r.readAsText(input.files[0]);
  },
  resetData() {
    this.modal('确认','<div style="text-align:center">重置所有数据？不可撤销！</div>',[
      {label:'取消',action:'App.closeModal()'},
      {label:'重置',cls:'danger',action:'App.doReset()'}
    ]);
  },
  doReset() {
    D._d = JSON.parse(JSON.stringify(D.defaults));
    D.forceSave(); this.closeModal(); this.switchTab('chats'); this.toast('已重置');
  },

  // ==================== 公众号 ====================
  pgOAList() {
    const followed = D.get('followedOA')||[];
    return `${this.statusBar()}${this.navbar('公众号',true)}
<div class="page" style="background:var(--bg);">
  <div style="padding:8px 12px;display:flex;gap:8px;"><input id="oa-q" placeholder="搜索公众号" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;"/><button onclick="App.searchOA()" style="background:var(--green);color:white;border:none;border-radius:6px;padding:8px 14px;">搜索</button></div>
  ${followed.length?'<div style="padding:8px 16px;font-size:13px;color:var(--text2);">已关注</div>':''}
  ${followed.map(oa=>`<div class="oa-item" onclick="App.openOA('${U.escAttr(oa.name)}')"><div class="oa-av">${oa.avatar||'📰'}</div><div><div class="oa-name">${oa.name}</div><div class="oa-desc">${oa.desc||''}</div></div></div>`).join('')}
  <div id="oa-results"></div>
</div>`;
  },
  async searchOA() {
    const q=document.getElementById('oa-q')?.value?.trim(); if(!q) return;
    this.toast('搜索中...');
    const accounts = await AI.searchOA(q);
    const div = document.getElementById('oa-results');
    if (div) {
      div.innerHTML = accounts.map(oa=>{
        const isF = (D.get('followedOA')||[]).find(f=>f.name===oa.name);
        return `<div class="oa-item"><div class="oa-av">${oa.avatar||'📰'}</div><div style="flex:1"><div class="oa-name">${oa.name}</div><div class="oa-desc">${oa.desc||''}</div></div><button class="follow-btn ${isF?'followed':''}" onclick="event.stopPropagation();App.followOA('${U.escAttr(oa.name)}','${U.escAttr(oa.desc||'')}','${U.escAttr(oa.avatar||'📰')}')">${isF?'已关注':'+ 关注'}</button></div>`;
      }).join('');
    }
  },
  followOA(name,desc,avatar) {
    const followed = D.get('followedOA')||[];
    if (followed.find(f=>f.name===name)) return;
    followed.push({name,desc,avatar}); D.set('followedOA',followed);
    this.toast(`已关注"${name}"`); this.render();
  },
  openOA(name) { this.oaName=name; this.oaArticles=[]; this.nav('oa-detail'); },
  pgOADetail() {
    return `${this.statusBar()}${this.navbar(this.oaName,true,`<button onclick="App.pushArticles()" style="background:var(--green);color:white;border:none;border-radius:4px;padding:4px 8px;font-size:13px;">推送</button>`)}
<div class="page" style="background:var(--bg);">
  ${this.oaArticles.map(a=>`<div style="background:white;margin:8px;border-radius:8px;padding:14px;cursor:pointer;" onclick='App.readArticle(${JSON.stringify(a).replace(/'/g,"&#39;")})'><div style="font-size:16px;font-weight:600;">${U.esc(a.title)}</div><div style="font-size:13px;color:var(--text2);margin-top:6px;">${U.esc(a.summary||'')}</div></div>`).join('')}
  ${this.oaArticles.length===0?'<div class="empty">点击推送获取文章</div>':''}
</div>`;
  },
  async pushArticles() { this.toast('获取中...'); this.oaArticles = await AI.genArticles(this.oaName); this.render(); },
  readArticle(a) { this.currentArticle=a; this.nav('article'); },
  pgArticle() {
    const a=this.currentArticle; if(!a) return this.pgOADetail();
    return `${this.statusBar()}${this.navbar('文章',true)}
<div class="page"><div class="article-reader"><div class="ar-title">${U.esc(a.title)}</div><div class="ar-meta">阅读 ${a.readCount||0}</div><div class="ar-body">${a.content?a.content.split('\n').map(p=>`<p>${U.esc(p)}</p>`).join(''):''}</div></div></div>`;
  },

  // ==================== 购物 ====================
  async openShop() {
    this.nav('shop');
    if (!this.shopItems.length) { this.shopItems = await AI.genShopItems(); this.render(); }
  },
  pgShop() {
    const cart = D.get('shoppingCart')||[];
    const cartN = cart.reduce((s,c)=>s+c.qty,0);
    const cartT = cart.reduce((s,c)=>s+c.price*c.qty,0);
    return `${this.statusBar()}${this.navbar('购物',true)}
<div style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
  <div style="flex:1;overflow-y:auto;">
    <div style="padding:8px 12px;display:flex;gap:8px;"><input id="shop-q" placeholder="搜索商品" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;"/><button onclick="App.searchShop()" style="background:var(--green);color:white;border:none;border-radius:6px;padding:8px 14px;">搜索</button></div>
    <div class="shop-grid">${this.shopItems.map(it=>`<div class="shop-card" onclick="App.addCart('${U.escAttr(it.name)}',${it.price},'${it.emoji||'📦'}')"><div class="sc-img">${it.emoji||'📦'}</div><div class="sc-info"><div class="sc-name">${U.esc(it.name)}</div><div class="sc-price">¥${it.price}</div></div></div>`).join('')}
    ${this.shopItems.length===0?'<div class="empty" style="grid-column:span 2;">加载中...</div>':''}</div>
  </div>
  <div class="cart-bar"><div class="cb-icon">🛒${cartN>0?`<span class="cb-badge">${cartN}</span>`:''}</div><div class="cb-total">¥${cartT.toFixed(2)}</div><button class="cb-checkout" onclick="App.checkout()">结算(${cartN})</button></div>
</div>`;
  },
  async searchShop() { const q=document.getElementById('shop-q')?.value?.trim(); if(!q) return; this.toast('搜索中...'); this.shopItems = await AI.genShopItems(q); this.render(); },
  addCart(name,price,emoji) {
    const cart = D.get('shoppingCart')||[];
    const ex = cart.find(c=>c.name===name);
    if(ex) ex.qty++; else cart.push({name,price,emoji,qty:1});
    D.save(); this.render(); this.toast(`已加入: ${name}`);
  },
  checkout() {
    const cart = D.get('shoppingCart')||[];
    if(!cart.length) return;
    const total = cart.reduce((s,c)=>s+c.price*c.qty,0);
    if(total>D.get('walletBalance')) { this.toast('余额不足'); return; }
    D.set('walletBalance', D.get('walletBalance')-total);
    cart.forEach(c=>D.addBackpack({name:c.name,emoji:c.emoji,price:c.price,count:c.qty}));
    D.set('shoppingCart',[]); this.toast('购买成功！'); this.render();
  },

  // ==================== 论坛 ====================
  async openForum() { this.nav('forum'); if(!this.forumPosts.length){ this.forumPosts=await AI.genForumPosts(); this.render(); } },
  pgForum() {
    return `${this.statusBar()}${this.navbar('论坛',true,`<button onclick="App.refreshForum()" style="background:var(--green);color:white;border:none;border-radius:4px;padding:4px 8px;font-size:13px;">刷新</button>`)}
<div class="page" style="background:var(--bg);padding:8px;">
  <div style="display:flex;gap:8px;margin-bottom:8px;"><input id="forum-q" placeholder="搜索" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;"/><button onclick="App.searchForum()" style="background:var(--green);color:white;border:none;border-radius:6px;padding:8px 14px;">搜索</button></div>
  ${this.forumPosts.map((p,i)=>`<div class="forum-post" onclick="App.openForumPost(${i})"><div class="fp-hd"><img class="fp-av" src="${U.avatar(p.author)}"/><div><div class="fp-author">${p.author}</div><div class="fp-time">${p.time||'刚刚'}</div></div></div><div class="fp-title">${U.esc(p.title)}</div><div class="fp-content">${U.esc(p.content).substring(0,80)}...</div><div class="fp-stats"><span>👍${p.likes||0}</span><span>💬${p.replies?.length||0}</span></div></div>`).join('')}
  ${this.forumPosts.length===0?'<div class="empty">加载中...</div>':''}
</div>`;
  },
  async refreshForum() { this.toast('刷新中...'); this.forumPosts=await AI.genForumPosts(); this.render(); },
  async searchForum() { const q=document.getElementById('forum-q')?.value?.trim(); if(!q) return; this.toast('搜索中...'); this.forumPosts=await AI.genForumPosts(q); this.render(); },
  openForumPost(idx) { this.currentForumPost=this.forumPosts[idx]; this.nav('forum-detail'); },
  pgForumDetail() {
    const p=this.currentForumPost; if(!p) return this.pgForum();
    return `${this.statusBar()}${this.navbar('帖子',true)}
<div class="page" style="background:var(--bg);">
  <div style="background:white;padding:16px;"><div style="font-size:20px;font-weight:700;margin-bottom:8px;">${U.esc(p.title)}</div><div style="font-size:13px;color:var(--text2);margin-bottom:12px;">${p.author} · ${p.time||'刚刚'} · 👍${p.likes||0}</div><div style="font-size:15px;line-height:1.6;">${U.esc(p.content)}</div></div>
  <div style="padding:8px 16px;font-size:14px;font-weight:600;background:var(--bg);">回复 (${p.replies?.length||0})</div>
  ${(p.replies||[]).map(r=>`<div class="forum-reply"><div class="fr-hd"><img class="fr-av" src="${U.avatar(r.author)}"/><span class="fr-name">${r.author}</span><span class="fr-time">${r.time||''}</span></div><div class="fr-text">${U.esc(r.content)}</div></div>`).join('')}
  ${(p.replies||[]).length===0?'<div class="empty">暂无回复</div>':''}
</div>`;
  }
};

// ==================== 启动 ====================
window.App = App;
document.addEventListener('DOMContentLoaded', () => App.start());
