const app = document.getElementById("app");

// Read one-time login token injected via URL param (e.g. from Electron iframe embed).
// Store it, then clean the URL so the token is not visible in the address bar.
(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      localStorage.setItem("skillStore.token", token);
      window.history.replaceState({}, "", window.location.pathname || "/");
    }
  } catch (_) {}
})();

const categories = ["全部", "工作", "学习", "生活"];
const priceFilters = [
  { id: "all", label: "全部价格" },
  { id: "free", label: "免费" },
  { id: "low", label: "1-99" },
  { id: "mid", label: "100-199" },
  { id: "high", label: "200+" }
];
const sortOptions = [
  { id: "popular", label: "最受欢迎" },
  { id: "rating", label: "评分最高" },
  { id: "price", label: "价格从低到高" }
];

const state = {
  token: localStorage.getItem("skillStore.token") || "",
  user: readJsonStorage("skillStore.user", null),
  favoriteIds: readJsonStorage("skillStore.favorites", []),
  skills: [],
  purchases: [],
  query: "",
  category: "全部",
  price: "all",
  sort: "popular",
  detailTab: "overview",
  toast: "",
  modal: null,
  loading: false
};

const creatorSkills = [
  { id: "creator_research", name: "行业研究模板包", category: "研究", status: "已上架", price: 199, sales: 1286, rating: 4.9, updated: "2026-05-05" },
  { id: "creator_report", name: "经营分析报告助手", category: "分析", status: "已上架", price: 159, sales: 932, rating: 4.8, updated: "2026-05-01" },
  { id: "creator_proposal", name: "商务方案写作器", category: "写作", status: "已上架", price: 129, sales: 0, rating: "-", updated: "2026-04-29" }
];

const recentOrders = [
  { orderNo: "SO20260507001", skill: "行业研究模板包", buyer: "市场部", amount: 199, time: "2026-05-07 14:32", status: "已支付" },
  { orderNo: "SO20260507002", skill: "经营分析报告助手", buyer: "财务部", amount: 159, time: "2026-05-07 13:47", status: "已支付" },
  { orderNo: "SO20260506018", skill: "商务方案写作器", buyer: "销售部", amount: 129, time: "2026-05-06 18:22", status: "已支付" }
];

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function persistFavorites() {
  localStorage.setItem("skillStore.favorites", JSON.stringify(state.favoriteIds));
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  const price = Number(value || 0);
  return price > 0 ? `¥${price}` : "免费";
}

function initials(name) {
  return String(name || "U").trim().slice(0, 1).toUpperCase();
}

function getTenantId(user) {
  return user?.departmentId || user?.tenant_id || "tenant_001";
}

function headers() {
  return {
    "Content-Type": "application/json",
    "X-User-Id": state.user?.id || "user_001",
    "X-Tenant-Id": getTenantId(state.user),
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
  };
}

async function request(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data.message || `${method} ${path} failed`;
    throw new Error(message);
  }
  return data;
}

function setLoading(value) {
  state.loading = value;
  document.body.classList.toggle("is-loading", value);
}

function showToast(message) {
  state.toast = message;
  renderFloating();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    if (state.toast === message) {
      state.toast = "";
      renderFloating();
    }
  }, 2400);
}

function showModal(title, body, actions = []) {
  state.modal = { title, body, actions };
  renderFloating();
}

function closeModal() {
  state.modal = null;
  renderFloating();
}

function renderFloating() {
  let floating = document.getElementById("floating");
  if (!floating) {
    floating = document.createElement("div");
    floating.id = "floating";
    document.body.appendChild(floating);
  }
  floating.innerHTML = `
    ${state.toast ? `<div class="toast" role="status">${html(state.toast)}</div>` : ""}
    ${
      state.modal
        ? `<div class="modal-mask" role="dialog" aria-modal="true">
            <section class="modal">
              <button class="icon-btn modal-close" data-modal-close aria-label="关闭">×</button>
              <h3>${html(state.modal.title)}</h3>
              <div class="modal-body">${state.modal.body}</div>
              <div class="modal-actions">
                ${state.modal.actions
                  .map((action) => `<button class="btn ${action.primary ? "btn-primary" : "btn-ghost"}" data-modal-action="${html(action.id)}">${html(action.label)}</button>`)
                  .join("")}
              </div>
            </section>
          </div>`
        : ""
    }
  `;
  floating.querySelectorAll("[data-modal-close]").forEach((button) => button.addEventListener("click", closeModal));
  floating.querySelectorAll("[data-modal-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = state.modal?.actions.find((item) => item.id === button.dataset.modalAction);
      if (action?.run) action.run();
      closeModal();
    });
  });
}

async function login(identifier, password) {
  const result = await request("/api/auth/login", "POST", { username: identifier, password });
  state.token = result.token || "";
  localStorage.setItem("skillStore.token", state.token);
  const user = result.user || (await request("/api/auth/me"));
  state.user = user;
  localStorage.setItem("skillStore.user", JSON.stringify(user));
}

function logout() {
  state.token = "";
  state.user = null;
  state.skills = [];
  state.purchases = [];
  localStorage.removeItem("skillStore.token");
  localStorage.removeItem("skillStore.user");
  nav("/login");
}

async function loadStoreData() {
  const [skills, purchases] = await Promise.all([request("/api/store/skills"), request("/api/store/my-purchases")]);
  state.skills = Array.isArray(skills) ? skills.map(normalizeSkillForUi) : [];
  state.purchases = Array.isArray(purchases) ? purchases : [];
}

function normalizeSkillForUi(skill, index = 0) {
  const categoryMap = {
    work: "工作",
    study: "学习",
    life: "生活",
    "工作": "工作",
    "学习": "学习",
    "生活": "生活",
    writing: "写作",
    research: "研究",
    docs: "文档",
    document: "文档",
    documents: "文档",
    productivity: "效率",
    efficiency: "效率",
    analysis: "分析",
    creative: "创意",
    art: "创意",
    developer: "开发",
    dev: "开发"
  };
  const rawCategory = String(skill.category || inferCategory(skill) || "效率").trim();
  const category = categoryMap[rawCategory.toLowerCase()] || (categories.includes(rawCategory) ? rawCategory : "工作");
  const rating = Number(skill.rating || (4.5 + ((index % 5) * 0.1)).toFixed(1));
  const sales = Number(skill.sales || 1200 + index * 143);
  const tags = Array.isArray(skill.tags) && skill.tags.length ? skill.tags : [category, ...(String(skill.name || "").split(/[-_\s]+/).filter(Boolean).slice(0, 2))];
  return { ...skill, category, rating, sales, tags };
}

function inferCategory(skill) {
  const text = `${skill.name || ""} ${skill.description || ""} ${skill.skill_id || ""}`.toLowerCase();
  if (text.includes("research") || text.includes("paper") || text.includes("scientific") || text.includes("arxiv")) return "研究";
  if (text.includes("study") || text.includes("learn")) return "学习";
  if (text.includes("life") || text.includes("daily")) return "生活";
  if (text.includes("ppt") || text.includes("doc") || text.includes("slide")) return "文档";
  if (text.includes("eval") || text.includes("metric") || text.includes("analysis") || text.includes("data")) return "分析";
  if (text.includes("art") || text.includes("story") || text.includes("creative")) return "创意";
  if (text.includes("code") || text.includes("benchmark") || text.includes("developer")) return "开发";
  if (text.includes("write") || text.includes("writing") || text.includes("rewrite")) return "写作";
  return "工作";
}

function nav(path) {
  history.pushState({}, "", path);
  render().catch(renderError);
}

function pageShell(content, active = "store") {
  const userName = state.user?.displayName || state.user?.username || "演示用户";
  return `
    <header class="topbar">
      <a href="#" class="brand" data-nav="/store" aria-label="AI Office Skill Store">
        <span class="brand-mark">AI</span>
        <span><strong>AI Office</strong><small>Skill Store</small></span>
      </a>
      <nav class="nav">
        <a href="#" data-nav="/store" class="${active === "store" ? "active" : ""}">商店</a>
        <a href="#" data-nav="/creator" class="${active === "creator" ? "active" : ""}">创作者中心</a>
        <a href="#" data-nav="/account" class="${active === "account" ? "active" : ""}">我的工作台</a>
      </nav>
      <div class="topbar-actions">
        <button class="icon-btn" data-action="open-help" title="帮助中心" aria-label="帮助中心">?</button>
        <div class="profile">
          <button class="avatar-button" data-action="toggle-profile" aria-haspopup="menu" aria-label="打开用户菜单">
            <span class="avatar">${html(initials(userName))}</span>
            <span class="user-name">${html(userName)}</span>
          </button>
          <div class="profile-menu" role="menu">
            <button data-nav="/account">我的工作台</button>
            <button data-action="show-favorites">收藏夹</button>
            <button data-nav="/creator">创作者中心</button>
            <button data-action="open-help">帮助中心</button>
            <button data-action="logout">退出登录</button>
          </div>
        </div>
      </div>
    </header>
    ${content}
  `;
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-page">
      <section class="login-hero">
        <div class="eyebrow">AI Office Skill Store</div>
        <h1>让团队把可靠的 AI 能力像插件一样安装、购买和管理</h1>
        <p>一个面向办公场景的 Skill 商店：发现能力、查看指标、购买授权、收藏备选和管理创作者收入都在同一个系统里。</p>
        <div class="hero-metrics">
          <div><strong>36</strong><span>可安装 Skill</span></div>
          <div><strong>8</strong><span>办公分类</span></div>
          <div><strong>闭环</strong><span>购买到授权</span></div>
        </div>
      </section>
      <section class="auth-panel">
        <div class="panel-title">
          <div><span class="eyebrow">欢迎回来</span><h2>登录商店</h2></div>
          <span class="pill">演示可用</span>
        </div>
        <form id="loginForm" class="form">
          <label>账号<input id="identifier" value="demo@ai-office.local" autocomplete="username" required /></label>
          <label>密码<input id="password" type="password" value="demo" autocomplete="current-password" required /></label>
          <button class="btn btn-primary full" type="submit">进入 Skill Store</button>
          <p id="loginError" class="error" aria-live="polite"></p>
        </form>
      </section>
    </main>
  `;
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoading(true);
    document.getElementById("loginError").textContent = "";
    try {
      await login(document.getElementById("identifier").value.trim(), document.getElementById("password").value);
      await loadStoreData();
      nav("/store");
      showToast("已登录");
    } catch (error) {
      document.getElementById("loginError").textContent = error.message;
    } finally {
      setLoading(false);
    }
  });
}

function filteredSkills() {
  const query = state.query.trim().toLowerCase();
  let rows = state.skills.filter((skill) => {
    const matchesQuery = !query || [skill.name, skill.description, skill.category, ...(skill.tags || [])].join(" ").toLowerCase().includes(query);
    const matchesCategory = state.category === "全部" || skill.category === state.category;
    const price = Number(skill.price || 0);
    const matchesPrice =
      state.price === "all" ||
      (state.price === "free" && price === 0) ||
      (state.price === "low" && price > 0 && price <= 99) ||
      (state.price === "mid" && price >= 100 && price <= 199) ||
      (state.price === "high" && price >= 200);
    return matchesQuery && matchesCategory && matchesPrice;
  });
  return [...rows].sort((a, b) => {
    if (state.sort === "rating") return Number(b.rating || 0) - Number(a.rating || 0);
    if (state.sort === "price") return Number(a.price || 0) - Number(b.price || 0);
    return Number(b.sales || 0) - Number(a.sales || 0);
  });
}

function stats() {
  const owned = state.skills.filter((skill) => skill.purchased).length;
  const avgRating = state.skills.length ? (state.skills.reduce((sum, skill) => sum + Number(skill.rating || 0), 0) / state.skills.length).toFixed(1) : "0.0";
  return { total: state.skills.length, owned, avgRating, favorites: state.favoriteIds.length };
}

function renderStore() {
  const rows = filteredSkills();
  const storeStats = stats();
  const featured = rows[0] || state.skills[0];
  const content = `
    <main class="store-page">
      <aside class="filter-panel">
        <div class="panel-section">
          <span class="eyebrow">浏览</span>
          <h3>Skill 分类</h3>
          <div class="vertical-list">
            ${categories.map((category) => `<button class="filter-item ${state.category === category ? "active" : ""}" data-category="${html(category)}">${html(category)}<span>${categoryCount(category)}</span></button>`).join("")}
          </div>
        </div>
        <div class="panel-section">
          <h3>价格</h3>
          <div class="vertical-list">
            ${priceFilters.map((item) => `<button class="filter-item ${state.price === item.id ? "active" : ""}" data-price="${item.id}">${item.label}</button>`).join("")}
          </div>
        </div>
      </aside>
      <section class="store-main">
        <section class="store-hero">
          <div class="hero-copy">
            <span class="eyebrow">精选商店</span>
            <h1>把高频办公流程变成可复用 Skill</h1>
            <p>团队可以在这里发现能力、比较指标、收藏候选、完成购买，并在工作台里管理已购资产。</p>
            <div class="hero-actions">
              <button class="btn btn-primary" data-action="focus-search">搜索 Skill</button>
              <button class="btn btn-ghost" data-nav="/account">我的工作台</button>
            </div>
          </div>
          <div class="hero-visual">
            <div class="visual-card primary">
              <span>${html(featured?.category || "效率")}</span>
              <strong>${html(featured?.name || "Skill")}</strong>
              <small>${html(featured?.description || "")}</small>
            </div>
            <div class="visual-card secondary"><strong>${storeStats.total}</strong><span>在线 Skill</span></div>
            <div class="visual-card tertiary"><strong>${storeStats.avgRating}</strong><span>平均评分</span></div>
          </div>
        </section>
        <section class="toolbar">
          <div class="search-box"><span>⌕</span><input id="searchInput" value="${html(state.query)}" placeholder="搜索写作、研究、PPT、文档..." /></div>
          <select id="sortSelect" aria-label="排序">${sortOptions.map((option) => `<option value="${option.id}" ${state.sort === option.id ? "selected" : ""}>${option.label}</option>`).join("")}</select>
        </section>
        <section class="metric-strip light">
          <div><strong>${storeStats.total}</strong><span>全部 Skill</span></div>
          <div><strong>${storeStats.owned}</strong><span>已购买</span></div>
          <div><strong>${storeStats.favorites}</strong><span>已收藏</span></div>
        </section>
        <section class="section-head">
          <div><span class="eyebrow">结果</span><h2>可安装 Skill</h2></div>
          <button class="btn btn-ghost compact" data-action="clear-filters">重置筛选</button>
        </section>
        <section class="skill-grid">${rows.length ? rows.map(skillCard).join("") : emptyState("没有找到匹配的 Skill", "换一个关键词或重置筛选条件。")}</section>
      </section>
    </main>
  `;
  app.innerHTML = pageShell(content, "store");
  wireCommonEvents();
  wireStoreEvents();
}

function categoryCount(category) {
  if (category === "全部") return state.skills.length;
  return state.skills.filter((skill) => skill.category === category).length;
}

function skillCard(skill) {
  const tags = (skill.tags || []).slice(0, 3);
  const favorite = state.favoriteIds.includes(skill.skill_id);
  return `
    <article class="skill-card" data-detail="${html(skill.skill_id)}" tabindex="0" aria-label="查看 ${html(skill.name)}">
      <button class="favorite-pin ${favorite ? "active" : ""}" data-favorite="${html(skill.skill_id)}" aria-label="${favorite ? "取消收藏" : "收藏"}">${favorite ? "★" : "☆"}</button>
      <div class="skill-thumb ${thumbClass(skill.category)}"><span>${html(initials(skill.name))}</span></div>
      <div class="skill-card-body">
        <div class="card-topline"><span class="pill">${html(skill.category || "效率")}</span><span class="rating">★ ${html(skill.rating || "4.6")}</span></div>
        <h3>${html(skill.name)}</h3>
        <p>${html(skill.description)}</p>
        <div class="tag-row">${tags.map((tag) => `<span>${html(tag)}</span>`).join("")}</div>
      </div>
      <div class="card-footer">
        <strong>${money(skill.price)}</strong>
        <button class="btn ${skill.purchased ? "btn-ghost" : "btn-primary"} compact buy-btn" data-buy="${html(skill.skill_id)}" ${skill.purchased ? "disabled" : ""}>${skill.purchased ? "已拥有" : "购买"}</button>
      </div>
    </article>
  `;
}

function thumbClass(category) {
  if (category === "写作") return "tone-red";
  if (category === "研究") return "tone-blue";
  if (category === "文档") return "tone-green";
  if (category === "分析") return "tone-violet";
  if (category === "创意") return "tone-gold";
  if (category === "开发") return "tone-slate";
  return "tone-teal";
}

function emptyState(title, text) {
  return `<div class="empty-state"><strong>${html(title)}</strong><p>${html(text)}</p></div>`;
}

function wireStoreEvents() {
  app.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
    state.category = button.dataset.category;
    renderStore();
  }));
  app.querySelectorAll("[data-price]").forEach((button) => button.addEventListener("click", () => {
    state.price = button.dataset.price;
    renderStore();
  }));
  document.getElementById("searchInput")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderStore();
  });
  document.getElementById("sortSelect")?.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderStore();
  });
}

async function buySkill(event, skillId) {
  event?.stopPropagation();
  const skill = state.skills.find((item) => item.skill_id === skillId);
  if (!skill || skill.purchased) return;
  showModal("确认购买", `<p>购买 <strong>${html(skill.name)}</strong> 后会立即写入当前账号授权，价格为 <strong>${money(skill.price)}</strong>。</p>`, [
    { id: "cancel", label: "取消" },
    {
      id: "buy",
      label: "确认购买",
      primary: true,
      run: async () => {
        setLoading(true);
        try {
          await request(`/api/store/skills/${skillId}/purchase`, "POST");
          await loadStoreData();
          render().catch(renderError);
          showToast("购买成功");
        } catch (error) {
          showToast(error.message);
        } finally {
          setLoading(false);
        }
      }
    }
  ]);
}

function toggleFavorite(skillId, rerender = true) {
  if (state.favoriteIds.includes(skillId)) {
    state.favoriteIds = state.favoriteIds.filter((id) => id !== skillId);
    showToast("已取消收藏");
  } else {
    state.favoriteIds = [...state.favoriteIds, skillId];
    showToast("已加入收藏夹");
  }
  persistFavorites();
  if (rerender) render().catch(renderError);
}

function renderSkillDetail(skillId) {
  const skill = state.skills.find((item) => item.skill_id === skillId);
  if (!skill) return nav("/store");
  const related = state.skills.filter((item) => item.category === skill.category && item.skill_id !== skill.skill_id).slice(0, 3);
  const favorite = state.favoriteIds.includes(skill.skill_id);
  const content = `
    <main class="detail-page">
      <div class="breadcrumb"><a href="#" data-nav="/store">商店</a><span>/</span><span>${html(skill.category)}</span><span>/</span><strong>${html(skill.name)}</strong></div>
      <section class="detail-hero">
        <div class="detail-cover ${thumbClass(skill.category)}"><span>${html(initials(skill.name))}</span><strong>${html(skill.category)}</strong></div>
        <div class="detail-meta">
          <div class="card-topline"><span class="pill">Premium Skill</span><span class="rating">★ ${html(skill.rating || "4.6")} · ${Number(skill.sales || 0).toLocaleString()} 次安装</span></div>
          <h1>${html(skill.name)}</h1>
          <p>${html(skill.description)}</p>
          <div class="tag-row">${(skill.tags || []).map((tag) => `<span>${html(tag)}</span>`).join("")}</div>
          <div class="info-grid">
            <div><span>版本</span><strong>${html(skill.latest_version || "1.0.0")}</strong></div>
            <div><span>授权</span><strong>${skill.purchased ? "已拥有" : "未购买"}</strong></div>
            <div><span>安全模式</span><strong>闭环执行</strong></div>
            <div><span>收藏</span><strong>${favorite ? "已收藏" : "未收藏"}</strong></div>
          </div>
        </div>
        <aside class="purchase-panel">
          <span class="eyebrow">当前价格</span>
          <h2>${money(skill.price)}</h2>
          <button class="btn btn-primary full" data-buy="${html(skill.skill_id)}" ${skill.purchased ? "disabled" : ""}>${skill.purchased ? "已拥有" : "购买并授权"}</button>
          <button class="btn btn-ghost full" data-favorite="${html(skill.skill_id)}">${favorite ? "取消收藏" : "加入收藏夹"}</button>
          <button class="btn btn-ghost full" data-nav="/account">在工作台查看</button>
          <p>购买记录、收藏夹和相关推荐都会汇总到“我的工作台”，不会在页面里放无效入口。</p>
        </aside>
      </section>
      <section class="detail-tabs">${["overview", "workflow", "reviews", "version"].map((tab) => `<button class="${state.detailTab === tab ? "active" : ""}" data-tab="${tab}">${tabLabel(tab)}</button>`).join("")}</section>
      <section class="detail-content">${detailTabContent(skill)}</section>
      <section class="section-head"><div><span class="eyebrow">同类推荐</span><h2>更多 ${html(skill.category)} Skill</h2></div></section>
      <section class="skill-grid compact-grid">${related.length ? related.map(skillCard).join("") : emptyState("暂无同类推荐", "返回商店可以查看全部分类。")}</section>
    </main>
  `;
  app.innerHTML = pageShell(content, "store");
  wireCommonEvents();
  app.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    state.detailTab = button.dataset.tab;
    renderSkillDetail(skillId);
  }));
}

function tabLabel(tab) {
  return { overview: "介绍", workflow: "流程", reviews: "评价", version: "版本" }[tab] || tab;
}

function detailTabContent(skill) {
  if (state.detailTab === "workflow") {
    return `<div class="step-list"><div><strong>1. 输入资料</strong><p>上传或粘贴任务背景、目标读者和约束条件。</p></div><div><strong>2. Skill 生成</strong><p>按内置流程拆解任务，并输出结构化结果。</p></div><div><strong>3. 人工确认</strong><p>用户可以继续编辑、导出或保存到业务系统。</p></div></div>`;
  }
  if (state.detailTab === "reviews") {
    return `<div class="review-list"><div><strong>市场部 · 4.9</strong><p>输出结构稳定，适合把重复写作流程标准化。</p></div><div><strong>研究组 · 4.8</strong><p>对资料整理很有帮助，版本信息也清楚。</p></div></div>`;
  }
  if (state.detailTab === "version") {
    return `<table class="table"><thead><tr><th>版本</th><th>状态</th><th>说明</th></tr></thead><tbody><tr><td>${html(skill.latest_version || "1.0.0")}</td><td>稳定</td><td>当前商店可安装版本。</td></tr></tbody></table>`;
  }
  return `<div class="copy-block"><h3>适用场景</h3><p>${html(skill.description)} 适合团队把高频办公任务做成标准流程，并通过商店统一分发、付费和授权。</p><h3>能力边界</h3><p>Skill 运行在闭环安全模型中，关键文件、版本和签名信息由 Skill Library 管理。</p></div>`;
}

function renderCreatorCenter() {
  const gross = creatorSkills.reduce((sum, item) => sum + Number(item.price) * Number(item.sales), 0);
  const sales = creatorSkills.reduce((sum, item) => sum + item.sales, 0);
  const available = Math.round(gross * 0.72);
  const content = `
    <main class="creator-page">
      <aside class="filter-panel">
        <span class="eyebrow">创作者</span>
        <h3>经营管理</h3>
        <div class="vertical-list">
          <button class="filter-item active">概览</button>
          <button class="filter-item" data-nav="/creator/publish">发布 Skill</button>
          <button class="filter-item" data-action="withdraw">提现</button>
        </div>
      </aside>
      <section class="store-main">
        <section class="creator-hero">
          <div><span class="eyebrow">Creator Console</span><h1>创作者中心</h1><p>发布、定价、销售、提现和版本管理放在一起，不把财务动作藏到侧边栏里。</p></div>
          <button class="btn btn-primary" data-nav="/creator/publish">发布新 Skill</button>
        </section>
        <section class="creator-metrics">
          <div class="metric-card revenue">
            <span>累计成交额</span>
            <strong>¥${gross.toLocaleString()}</strong>
            <button class="btn btn-primary compact" data-action="withdraw">提现</button>
          </div>
          <div class="metric-card"><span>可提现余额</span><strong>¥${available.toLocaleString()}</strong></div>
          <div class="metric-card"><span>总销量</span><strong>${sales.toLocaleString()}</strong></div>
          <div class="metric-card"><span>我的 Skill</span><strong>${creatorSkills.length}</strong></div>
        </section>
        <section class="table-card">
          <div class="section-head"><div><span class="eyebrow">资产</span><h2>我发布的 Skill</h2></div></div>
          <table class="table">
            <thead><tr><th>Skill</th><th>分类</th><th>价格</th><th>状态</th><th>销量</th><th>评分</th><th>更新</th><th>操作</th></tr></thead>
            <tbody>${creatorSkills.map((skill) => `<tr><td><strong>${html(skill.name)}</strong></td><td>${html(skill.category)}</td><td>${money(skill.price)}</td><td><span class="status">${html(skill.status)}</span></td><td>${Number(skill.sales).toLocaleString()}</td><td>${html(skill.rating)}</td><td>${html(skill.updated)}</td><td><button class="btn btn-ghost compact" data-action="edit-skill" data-id="${html(skill.id)}">编辑</button> <button class="btn btn-ghost compact" data-action="off-skill" data-id="${html(skill.id)}">下架</button></td></tr>`).join("")}</tbody>
          </table>
        </section>
        <section class="table-card">
          <div class="section-head"><div><span class="eyebrow">订单</span><h2>最近成交</h2></div></div>
          <table class="table"><thead><tr><th>订单号</th><th>Skill</th><th>购买方</th><th>金额</th><th>时间</th><th>状态</th></tr></thead><tbody>${recentOrders.map((order) => `<tr><td>${html(order.orderNo)}</td><td>${html(order.skill)}</td><td>${html(order.buyer)}</td><td>${money(order.amount)}</td><td>${html(order.time)}</td><td>${html(order.status)}</td></tr>`).join("")}</tbody></table>
        </section>
      </section>
    </main>
  `;
  app.innerHTML = pageShell(content, "creator");
  wireCommonEvents();
  app.querySelectorAll("[data-action='withdraw']").forEach((button) => button.addEventListener("click", openWithdrawModal));
  app.querySelectorAll("[data-action='edit-skill']").forEach((button) => button.addEventListener("click", () => showToast(`进入编辑：${button.dataset.id}`)));
  app.querySelectorAll("[data-action='off-skill']").forEach((button) => button.addEventListener("click", () => showToast(`已下架：${button.dataset.id}`)));
}

function renderPublishPage() {
  const content = `
    <main class="detail-page">
      <div class="breadcrumb"><a href="#" data-nav="/creator">创作者中心</a><span>/</span><strong>发布 Skill</strong></div>
      <section class="publish-layout">
        <section class="table-card">
          <div class="section-head"><div><span class="eyebrow">发布配置</span><h2>新 Skill 指标</h2></div></div>
          <form id="publishForm" class="publish-form">
            <label>Skill ID<input name="skill_id" value="meeting_notes_v1" required /></label>
            <label>名称<input name="name" value="会议纪要整理助手" required /></label>
            <label>分类<select name="category">${categories.filter((item) => item !== "全部").map((item) => `<option>${item}</option>`).join("")}</select></label>
            <label>价格<input name="price" type="number" min="0" value="99" required /></label>
            <label>版本<input name="version" value="1.0.0" required /></label>
            <label>目标用户<input name="audience" value="行政、项目经理、销售负责人" /></label>
            <label>输入格式<input name="input_schema" value="音频转写文本、会议议程、参会人名单" /></label>
            <label>输出格式<input name="output_schema" value="摘要、决议、待办、责任人、截止日期" /></label>
            <label>质量指标<input name="quality_metrics" value="摘要覆盖率、行动项召回率、责任人准确率" /></label>
            <label>安全边界<input name="safety" value="闭环执行，不外调第三方 Skill" /></label>
            <label>包文件路径<input name="package_file" value="meeting_notes_v1-1.0.0.aoskin" /></label>
            <label class="wide">描述<textarea name="description" rows="4">把会议原始记录整理成可执行纪要，自动区分决议、风险和后续动作。</textarea></label>
            <div class="form-actions wide">
              <button class="btn btn-ghost" type="button" data-nav="/creator">取消</button>
              <button class="btn btn-primary" type="submit">直接发布</button>
            </div>
          </form>
        </section>
        <aside class="table-card publish-guide">
          <span class="eyebrow">后端接口</span>
          <h3>已预留发布接口</h3>
          <p>提交后会调用 <code>POST /api/creator/skills</code>。当前阶段先完成契约和前端流程，不接真实包仓库和支付系统。</p>
          <p>发布不需要审核；提现也不走审核，只进入金额确认和支付跳转占位。</p>
        </aside>
      </section>
    </main>
  `;
  app.innerHTML = pageShell(content, "creator");
  wireCommonEvents();
  document.getElementById("publishForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.price = Number(payload.price || 0);
    try {
      await request("/api/creator/skills", "POST", payload);
      showToast("Skill 已发布");
      nav("/creator");
    } catch (error) {
      showToast(error.message);
    }
  });
}

function openWithdrawModal() {
  showModal("提现", `<div class="form modal-form"><label>提现金额<input id="withdrawAmount" type="number" min="1" value="1000" /></label><label>收款账户<input value="企业钱包 · 6214 **** 8821" /></label><p class="muted">下一步会跳转到支付确认页；当前环境不发起真实支付。</p></div>`, [
    { id: "cancel", label: "取消" },
    {
      id: "pay",
      label: "前往支付确认",
      primary: true,
      run: async () => {
        const amount = Number(document.getElementById("withdrawAmount")?.value || 0);
        try {
          await request("/api/creator/withdrawals", "POST", { amount, account: "企业钱包 · 6214 **** 8821" });
          showToast("已进入支付确认占位页");
        } catch (error) {
          showToast(error.message);
        }
      }
    }
  ]);
}

function renderAccountPage() {
  const owned = state.skills.filter((skill) => skill.purchased);
  const favorites = state.skills.filter((skill) => state.favoriteIds.includes(skill.skill_id));
  const purchaseMap = new Map(state.purchases.map((purchase) => [purchase.skill_id, purchase]));
  const recommendations = state.skills.filter((skill) => !skill.purchased).slice(0, 4);
  const content = `
    <main class="account-page">
      <section class="workspace-hero">
        <div><span class="eyebrow">我的工作台</span><h1>技能、收藏和购买记录</h1><p>把“已购资产”“收藏候选”“购买记录”和“继续发现”放在一个页面，避免开一个只做展示的空页面。</p></div>
      </section>
      <section class="metric-strip light">
        <div><strong>${owned.length}</strong><span>已购 Skill</span></div>
        <div><strong>${favorites.length}</strong><span>收藏候选</span></div>
        <div><strong>${state.purchases.length}</strong><span>购买记录</span></div>
      </section>
      <section class="workspace-grid">
        <section class="table-card">
          <div class="section-head"><div><span class="eyebrow">资产</span><h2>已购 Skill</h2></div><button class="btn btn-ghost compact" data-nav="/store">继续购买</button></div>
          <div class="mini-card-list">${owned.length ? owned.map((skill) => miniSkill(skill, purchaseMap.get(skill.skill_id))).join("") : emptyState("还没有已购 Skill", "去商店购买后会出现在这里。")}</div>
        </section>
        <section class="table-card">
          <div class="section-head"><div><span class="eyebrow">收藏</span><h2>收藏夹</h2></div></div>
          <div class="mini-card-list">${favorites.length ? favorites.map((skill) => miniSkill(skill)).join("") : emptyState("收藏夹为空", "在详情页或卡片右上角收藏 Skill。")}</div>
        </section>
      </section>
      <section class="table-card">
        <div class="section-head"><div><span class="eyebrow">记录</span><h2>购买记录</h2></div></div>
        <table class="table"><thead><tr><th>Skill</th><th>价格</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>${state.purchases.length ? state.purchases.map((purchase) => `<tr><td>${html(purchase.skill?.name || purchase.skill_id)}</td><td>${money(purchase.price)}</td><td>${html(purchase.payment_status || "paid")}</td><td>${purchase.created_at ? new Date(purchase.created_at).toLocaleString() : "-"}</td><td><button class="btn btn-ghost compact" data-detail="${html(purchase.skill_id)}">详情</button></td></tr>`).join("") : `<tr><td colspan="5">暂无购买记录</td></tr>`}</tbody></table>
      </section>
      <section class="section-head"><div><span class="eyebrow">推荐</span><h2>可能还需要</h2></div></section>
      <section class="skill-grid compact-grid">${recommendations.map(skillCard).join("")}</section>
    </main>
  `;
  app.innerHTML = pageShell(content, "account");
  wireCommonEvents();
}

function miniSkill(skill, purchase) {
  return `<article class="mini-skill"><div class="mini-icon ${thumbClass(skill.category)}">${html(initials(skill.name))}</div><div><strong>${html(skill.name)}</strong><p>${html(skill.description)}</p><span>${html(skill.category)} · ${purchase?.created_at ? new Date(purchase.created_at).toLocaleDateString() : "收藏候选"}</span></div><button class="btn btn-ghost compact" data-detail="${html(skill.skill_id)}">详情</button></article>`;
}

function showHelp() {
  showModal(
    "帮助中心",
    `<div class="help-content">
      <div><strong>购买 Skill</strong><p>在商店中搜索、筛选并进入详情页，确认价格后购买。购买后会出现在“我的工作台”。</p></div>
      <div><strong>收藏夹</strong><p>卡片右上角和详情页都可以收藏，适合先比较多个候选 Skill。</p></div>
      <div><strong>创作者发布</strong><p>发布页需要填写 ID、版本、定价、输入输出格式、质量指标和安全边界。当前接口已预留，暂不接真实包仓库。</p></div>
      <div><strong>提现</strong><p>创作者中心的成交额卡片旁可以发起提现，下一步进入支付确认占位页。</p></div>
    </div>`,
    [{ id: "ok", label: "知道了", primary: true }]
  );
}

function wireCommonEvents() {
  app.querySelectorAll("[data-nav]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      nav(element.getAttribute("data-nav"));
    });
  });
  app.querySelectorAll("[data-action='logout']").forEach((button) => button.addEventListener("click", logout));
  app.querySelectorAll("[data-action='open-help']").forEach((button) => button.addEventListener("click", showHelp));
  app.querySelectorAll("[data-action='toggle-profile']").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    button.closest(".profile")?.classList.toggle("open");
  }));
  app.querySelectorAll("[data-action='show-favorites']").forEach((button) => button.addEventListener("click", () => nav("/account")));
  app.querySelectorAll("[data-action='focus-search']").forEach((button) => button.addEventListener("click", () => document.getElementById("searchInput")?.focus()));
  app.querySelectorAll("[data-action='clear-filters']").forEach((button) => button.addEventListener("click", () => {
    state.query = "";
    state.category = "全部";
    state.price = "all";
    state.sort = "popular";
    renderStore();
  }));
  app.querySelectorAll("[data-buy]").forEach((button) => button.addEventListener("click", (event) => buySkill(event, button.dataset.buy)));
  app.querySelectorAll("[data-favorite]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(button.dataset.favorite);
  }));
  app.querySelectorAll(".skill-card[data-detail]").forEach((card) => {
    card.addEventListener("click", () => nav(`/store/skills/${card.dataset.detail}`));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") nav(`/store/skills/${card.dataset.detail}`);
    });
  });
  app.querySelectorAll("button[data-detail]").forEach((button) => button.addEventListener("click", () => nav(`/store/skills/${button.dataset.detail}`)));
  document.addEventListener("click", () => document.querySelectorAll(".profile.open").forEach((menu) => menu.classList.remove("open")), { once: true });
}

async function render() {
  const path = window.location.pathname;

  // Auto-login via URL params: GET /login?account=...&password=...
  if (path === "/login" && !state.user) {
    const params = new URLSearchParams(window.location.search);
    const account = params.get("account");
    const password = params.get("password");
    if (account && password) {
      // Clear credentials from URL immediately before anything is rendered
      history.replaceState({}, "", "/login");
      setLoading(true);
      try {
        await login(account, password);
        await loadStoreData();
        nav("/store");
        return;
      } catch (_err) {
        // Fall through to show the login form on failure
      } finally {
        setLoading(false);
      }
    }
  }

  if (!state.user && path !== "/login") {
    history.replaceState({}, "", "/login");
    renderLogin();
    return;
  }
  if (!state.user && path === "/login") return renderLogin();
  if (state.user && !state.skills.length) {
    setLoading(true);
    try {
      await loadStoreData();
    } finally {
      setLoading(false);
    }
  }
  if (path === "/" || path === "/store") return renderStore();
  if (path.startsWith("/store/skills/")) return renderSkillDetail(path.split("/").pop());
  if (path === "/creator") return renderCreatorCenter();
  if (path === "/creator/publish") return renderPublishPage();
  if (path === "/account") return renderAccountPage();
  nav("/store");
}

function renderError(error) {
  app.innerHTML = `<main class="error-page"><section class="empty-state"><strong>页面加载失败</strong><p>${html(error.message)}</p><button class="btn btn-primary" data-action="retry">重试</button></section></main>`;
  app.querySelector("[data-action='retry']").addEventListener("click", () => {
    state.skills = [];
    render().catch(renderError);
  });
}

window.addEventListener("popstate", () => render().catch(renderError));
render().catch(renderError);
