/* 시대를 건너 살아남기 — 화면(app.js). 판정은 logic.js, 콘텐츠는 data.js.
 * 주소 옵션: ?sid=30512&name=이름 / ?preview=1(저장 안 함) / ?mode=2|3(시대당 사건 2개=공통, 3개=유연, 기본 2)
 *            / ?upto=1~4(이번 시간에 열어 둘 마지막 시대, 기본 4) */
const CONFIG = {
  SHEET_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbyXSjCfWY_HiZFqW_OBR-FQDoIfF1z_STqyKWUI31MacHeY3u7hbirFSFDvW-5yuUHaJQ/exec",
  /* 포털 커리큘럼 관리에 이 id 하나로 등록한다(글자까지 같아야 진행률에 잡힌다). */
  GAME_NAME: "총복습_시대를건너살아남기",
  ESSAY_MIN: 30,
  TYPE_MS: 24
};

const S = { sid: "", name: "", grade: 0, ban: 0, preview: false, mode: 2, upto: 4, padletUrl: "", sending: false, outText: "", queue: [], playing: false, typing: null, onDone: null };
let st = Logic.newState();   // 저장되는 진행
let G = st;                  // 지금 움직이는 상태(자유 탐험이면 임시 상태)
let exploreEvent = null;

const $ = id => document.getElementById(id);
const skip = () => S.preview;
const noMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
/* 효과음(2026-11-09): 파일 없이 브라우저가 짧은 음을 만든다. 교실이 시끄럽지 않게 기본은 꺼짐, 머리띠 🔇 버튼으로 켠다.
 * 켬·끔은 이 기기에만 기억한다. 소리가 막힌 기기에서는 조용히 넘어간다. */
const Sound = (() => {
  const KEY = "survive_eras_sound";
  const SEQ = {
    slip: [[247, 0, .16, "square"], [185, .15, .34, "square"]],   // 어긋난 죽음: 낮게 두 번 떨어짐
    memory: [[330, 0, 1.1, "sine"]],                               // 역사 속 죽음: 낮은 종 한 번
    rescue: [[392, 0, .14, "triangle"], [494, .12, .14, "triangle"], [587, .24, .34, "triangle"]], // 등불 다시 켜짐: 오름
    pass: [[659, 0, .12, "triangle"], [880, .11, .28, "triangle"]], // 심판 통과
    on: [[523, 0, .18, "sine"]]
  };
  let on = false, ctx = null;
  try { on = localStorage.getItem(KEY) === "1"; } catch (e) { /* 막히면 꺼짐 */ }
  function play(kind) {
    if (!on || !SEQ[kind]) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      if (ctx.state === "suspended") { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      const t0 = ctx.currentTime + .02;
      SEQ[kind].forEach(([f, at, dur, type]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(type === "square" ? .05 : .12, t0 + at + .02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + at); o.stop(t0 + at + dur + .05);
      });
    } catch (e) { /* 소리 없이 진행 */ }
  }
  function toggle() {
    on = !on;
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* 이번 화면에서만 */ }
    play("on");
    return on;
  }
  return { play, toggle, isOn: () => on };
})();

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function parseSid(sid) { return /^\d{5}$/.test(sid) ? { grade: Number(sid[0]), ban: Number(sid.slice(1, 3)) } : null; }
function countChars(t) { return String(t || "").replace(/\s/g, "").length; }

/* ── 저장: 학번별. 죽음·등불은 고르는 즉시 저장해 새로고침으로 되돌릴 수 없다 ── */
function storeKey() { return "survive_eras_v2:" + CONFIG.GAME_NAME + ":" + S.sid; }
function save() {
  if (S.preview || !S.sid) return;
  try { localStorage.setItem(storeKey(), JSON.stringify(st)); } catch (e) { /* 저장소가 막히면 메모리만 */ }
}
function load() {
  if (S.preview) return false;
  try {
    const v = JSON.parse(localStorage.getItem(storeKey()) || "null");
    if (!v || !v.charName) return false;
    st = Object.assign(Logic.newState(), v); G = st;
    return true;
  } catch (e) { return false; }
}

/* ── 화면 전환 ── */
const SCREENS = ["s0", "s1", "s2", "sPlay", "sDeath", "sMemory", "sRescue", "sReal", "s5", "s6", "sExplore"];
function show(key) {
  SCREENS.forEach(k => { $(k).hidden = k !== key; });
  $("topbar").hidden = !["s2", "sPlay", "sDeath", "sMemory", "sRescue", "sReal", "s5"].includes(key);
  renderTop();
  window.scrollTo(0, 0);
}
function curEra() { return ERAS[Math.min(G.eraIdx, ERAS.length - 1)]; }
function lampText(n) { return "🏮".repeat(n) + "<span class='off'>" + "🏮".repeat(Math.max(0, Logic.LAMPS - n)) + "</span>"; }
function renderTop() {
  const era = exploreEvent ? ERAS[EVENTS[exploreEvent].era - 1] : curEra();
  $("tbEra").textContent = era.name;
  $("tbLamps").innerHTML = G.explore ? "🧭 탐험 중" : lampText(G.lamps);
  $("tbCardN").textContent = G.cards.length;
  $("tbDexN").textContent = st.dex.length;
  renderSound();
}
function renderSound() {
  const b = $("tbSound"), on = Sound.isOn();
  b.textContent = on ? "🔊" : "🔇";
  b.setAttribute("aria-pressed", on ? "true" : "false");
  b.setAttribute("aria-label", on ? "효과음 끄기" : "효과음 켜기");
}
/* 의미 있는 순간에만 한 번 눈에 띄게: 등불이 다시 켜질 때 머리띠 등불이 반짝 */
function pulseLamps() {
  if (noMotion()) return;
  const t = $("tbLamps");
  t.classList.remove("relit"); void t.offsetWidth; t.classList.add("relit");
}

/* ── 시트 전송 ── */
async function postToSheet(payload) {
  if (S.preview) return { result: "success", preview: true };
  const res = await fetch(CONFIG.SHEET_WEBAPP_URL, { method: "POST", body: JSON.stringify(payload) });
  const json = await res.json();
  if (json.result !== "success") { const err = new Error(json.message || "저장 실패"); err.locked = !!json.locked; throw err; }
  return json;
}
function ensureUrlScheme(u) { u = String(u || "").trim(); return u && !/^https?:\/\//i.test(u) ? "https://" + u : u; }
/* 패들렛 링크는 백엔드 학년정보(포트폴리오)에서 가져온다(반 정보가 든 링크라 레포에 적지 않는다). */
async function loadPadletUrl(grade, ban) {
  try {
    const res = await fetch(CONFIG.SHEET_WEBAPP_URL + "?mode=curriculum");
    const json = await res.json();
    const pf = json && json.grades && json.grades[String(grade)] && json.grades[String(grade)].portfolio;
    if (!pf) return "";
    return ensureUrlScheme(pf.urlByBan ? (pf.urlByBan[ban] || pf.urlByBan[String(ban)] || "") : (pf.url || ""));
  } catch (e) { return ""; }
}
function renderPadlet() {
  const a = $("padletBtn");
  if (!st.submitted) { a.hidden = true; $("padletMsg").textContent = S.padletUrl ? "제출하면 패들렛 버튼이 열려." : ""; }
  else if (S.padletUrl) { a.href = S.padletUrl; a.hidden = false; $("padletMsg").textContent = ""; }
  else { a.hidden = true; $("padletMsg").textContent = "패들렛 링크는 선생님이 알려 준 곳을 써 줘."; }
}

/* ── 시작 ── */
function startApp() {
  const sid = $("sid").value.trim(), name = $("sname").value.trim();
  const p = parseSid(sid);
  if (!p) { $("startErr").textContent = "학번은 숫자 5자리로 써 줘. (예: 30512)"; return; }
  if (!name) { $("startErr").textContent = "이름을 써 줘."; return; }
  $("startErr").textContent = "";
  S.sid = sid; S.name = name; S.grade = p.grade; S.ban = p.ban;
  FocusGuard.start({ key: CONFIG.GAME_NAME + ":" + sid }); // 작성 중 화면 이탈·붙여넣기 기록
  loadPadletUrl(p.grade, p.ban).then(u => { S.padletUrl = u; renderPadlet(); });
  if (load()) { S.mode = st.mode || S.mode; resume(); return; }
  show("s1");
}
function makeChar() {
  const n = $("charName").value.trim();
  if ((n.length < 2 || n.length > 8) && !skip()) { $("s1Err").textContent = "이름은 2~8자로 지어 줘."; return; }
  $("s1Err").textContent = "";
  st = Logic.newState(); G = st;
  st.charName = n || "나그네"; st.mode = S.mode;
  save();
  enterEra();
}
/* 이어하기: 죽음 화면·구출을 건너뛸 수 없게 저장된 자리로 돌아간다 */
function resume() {
  if (st.submitted) { try { S.outText = sessionStorage.getItem(storeKey() + ":out") || ""; } catch (e) { S.outText = ""; } }
  if (st.submitted || st.atEnding) { renderEnding(); show("s6"); return; }
  if (st.pendingDeath) { showDeathScreen(st.pendingDeath); return; }
  enterEra();
}

/* ── 시대 카드 ── */
function enterEra() {
  const era = curEra(), locked = era.id > S.upto;
  $("eraCard").style.setProperty("--era", era.color);
  $("eraNo").textContent = (era.id) + " / " + ERAS.length + " 번째 시대 · 교과서 " + era.pages + "쪽";
  $("eraTitle").textContent = era.name;
  $("eraSpan").textContent = era.span;
  $("eraIntro").textContent = st.charName + ", " + era.intro;
  $("eraLocked").hidden = !locked;
  $("eraGo").hidden = locked;
  show("s2");
}
function curFlow() { return Logic.flowOf(curEra(), EVENTS, S.mode); }
/* 시대 진행표의 지금 칸으로 간다 */
function runStep() {
  const flow = curFlow();
  if (G.stepIdx >= flow.length) { nextEra(); return; }
  const step = flow[G.stepIdx];
  if (step.essay) { renderEssay(); show("s5"); return; }
  if (!G.node || (G.node !== "END" && !NODES[G.node])) { G.node = EVENTS[step].start; G.pendingDeath = null; save(); } // 재배포로 자리가 없어져도 막히지 않게
  beginEvent(step);
  goNode(G.node);
}
function nextEra() {
  if (G.eraIdx + 1 >= ERAS.length) { st.atEnding = true; save(); renderEnding(); show("s6"); return; }
  st.eraIdx += 1; st.stepIdx = 0; st.node = null; st.lamps = Logic.LAMPS; save();
  enterEra();
}
function curEventId() { return exploreEvent || curFlow()[G.stepIdx]; }

/* ── 이야기 진행 ── */
function beginEvent(eid) {
  const ev = EVENTS[eid];
  $("stage").style.setProperty("--era", ERAS[ev.era - 1].color);
  $("sceneBg").src = "scenes/" + eid + ".webp";
  $("sceneWho").hidden = true; $("sceneWho").dataset.key = "";
  $("scYear").textContent = ev.year;
  $("scTitle").textContent = ev.title;
  $("scRole").textContent = "너는 " + ev.role + " " + (st.charName || "");
  $("exitExplore").hidden = !G.explore;
  $("log").innerHTML = "";
  clearPanel();
  show("sPlay");
}
function clearPanel() {
  $("panel").hidden = true;
  $("panelBody").innerHTML = ""; $("panelQ").textContent = ""; $("panelNote").textContent = "";
  $("panelReply").hidden = true; $("panelNext").hidden = true; $("panelWords").hidden = true;
}
function goNode(id) {
  if (!G.explore && G.lamps <= 0) { showRescue(id); return; }
  if (id === "END") { showReal(); return; }
  G.node = id; save();
  clearPanel();
  const n = NODES[id];
  const lines = (n.lines || []).filter(l => !l[3] || l[3](G));
  show("sPlay");
  playLines(lines, () => afterLines(id, n));
}
function afterLines(id, n) {
  if (n.look) { renderLook(id, n); return; }
  if (n.choices) { renderFork(id, n); return; }
  if (n.trial) { renderTrial(id, n); return; }
  goNode(n.next);
}
function playLines(lines, done) {
  S.queue = lines.slice(); S.onDone = done; S.playing = true;
  nextLine();
}
function nextLine() {
  if (S.typing) { finishTyping(); return; }
  if (!S.playing) return;
  if (!S.queue.length) { S.playing = false; $("nextBtn").hidden = true; const d = S.onDone; S.onDone = null; if (d) d(); return; }
  addLine(S.queue.shift());
  $("nextBtn").hidden = false;
}
function faceSrc(key) { return "scenes/p_" + key + ".webp"; }
function setSceneWho(key) {
  const fig = $("sceneWho");
  if (!key) { fig.classList.add("quiet"); return; }
  fig.classList.remove("quiet");
  if (fig.dataset.key === key && !fig.hidden) return;
  fig.dataset.key = key;
  fig.hidden = false;
  fig.classList.remove("in"); void fig.offsetWidth; fig.classList.add("in"); // 바뀔 때 한 번 떠오름
  $("sceneFace").onerror = () => { fig.hidden = true; }; // 그림이 안 오면 액자째 숨김
  $("sceneFace").src = faceSrc(key);
  $("sceneName").textContent = SPEAKERS[key].name;
}
function addLine(l) {
  const row = el("div", "line" + (l[0] ? " said" : ""));
  setSceneWho(l[0]);
  if (l[0]) {
    const sp = SPEAKERS[l[0]];
    const av = el("span", "avatar");
    const im = document.createElement("img");
    im.alt = ""; im.src = faceSrc(l[0]);
    im.onerror = () => { av.textContent = sp.ic; }; // 그림이 안 오면 예전 그림 글자
    av.appendChild(im);
    row.appendChild(av);
    const box = el("div", "said-box");
    box.appendChild(el("b", "who", sp.name));
    const p = el("p", "txt"); box.appendChild(p); row.appendChild(box);
    typeInto(p, l[1]);
  } else {
    const p = el("p", "txt"); row.appendChild(p);
    typeInto(p, l[1]);
  }
  $("log").appendChild(row);
  row.scrollIntoView({ behavior: "auto", block: "nearest" });
}
/* 한 글자씩 나타나는 동안에는 낱말 밑줄을 긋지 않고, 다 나온 뒤에 긋는다 */
function typeInto(p, text) {
  if (noMotion() || S.preview) { p.textContent = text; return; }
  p.setAttribute("data-no-gloss", "");
  let i = 0;
  const t = setInterval(() => {
    i += 1; p.textContent = text.slice(0, i);
    if (i >= text.length) finishTyping();
  }, CONFIG.TYPE_MS);
  S.typing = { p, text, t };
}
function finishTyping() {
  const ty = S.typing; if (!ty) return;
  clearInterval(ty.t); ty.p.textContent = ty.text; ty.p.removeAttribute("data-no-gloss");
  S.typing = null;
}

/* 누르는 칸 안에는 낱말 밑줄이 없으니, 칸 밖에 모아 보여 준다(webapp-rules 19) */
function renderWords(text) {
  const box = $("panelWords");
  const found = Object.keys(GLOSSARY).filter(k => text.includes(k));
  const words = found.filter(k => !found.some(o => o !== k && o.includes(k)));
  box.innerHTML = ""; box.hidden = !words.length;
  if (!words.length) return;
  box.appendChild(el("span", "words-label", "모르는 낱말:"));
  words.forEach(w => box.appendChild(el("span", "word", w)));
}
function panelButton(k, title, sub, onClick, cls) {
  const b = el("button", "choice " + (cls || "")); b.type = "button";
  b.appendChild(el("span", "k", String(k)));
  const body = el("span", "ch-body");
  body.appendChild(el("span", "ch-t", title));
  if (sub) body.appendChild(el("span", "ch-sub", sub));
  b.appendChild(body);
  b.addEventListener("click", onClick);
  return b;
}
function revealPanel() {
  $("panel").hidden = false;
  const cards = Array.from(document.querySelectorAll("#panelBody .choice"));
  cards.forEach((c, i) => setTimeout(() => c.classList.add("show"), noMotion() ? 0 : i * 60));
  if (window.innerWidth < 900) $("panel").scrollIntoView({ behavior: noMotion() ? "auto" : "smooth", block: "nearest" });
  renderTop();
}

/* ── 둘러보기 ── */
function renderLook(id, n) {
  const limit = Logic.lookLimit(G, id, n), v = G.visited[id] || [];
  const left = limit - v.length;
  $("panelQ").textContent = "어디를 들러 볼까?";
  $("panelNote").textContent = left > 0 ? left + "곳 더 들를 수 있어." : "다 둘러봤어.";
  const body = $("panelBody"); body.innerHTML = "";
  Logic.shuffled(n.look.spots, S.sid + id).forEach((s, i) => {
    const seen = v.includes(s.id);
    const b = panelButton(i + 1, s.name, seen ? "📜 " + CARDS[s.card].title : "", () => visitSpot(id, n, s), seen ? "seen" : "");
    b.disabled = seen || left <= 0;
    body.appendChild(b);
  });
  $("panelNext").hidden = !(left <= 0 || skip());
  $("panelNext").textContent = "다음으로 →";
  $("panelNext").onclick = () => goNode(n.next);
  $("panelWords").hidden = true;
  revealPanel();
}
function visitSpot(id, n, spot) {
  if (!Logic.visit(G, id, n, spot.id)) return;
  save();
  clearPanel();
  playLines([[null, spot.line, _c]], () => { showCard(spot.card); renderLook(id, n); });
}
function showCard(cid) {
  const c = CARDS[cid];
  const row = el("div", "line got");
  row.appendChild(el("b", "got-t", "📜 " + c.title));
  row.appendChild(el("p", "txt", c.text));
  row.appendChild(el("span", "got-p", "교과서 " + c.p + "쪽"));
  $("log").appendChild(row);
  renderTop();
}

/* ── 갈림길 ── */
function renderFork(id, n) {
  $("panelQ").textContent = n.q;
  $("panelNote").textContent = Logic.showWhisper(G, id, n, DEATHS) ? "💭 누군가의 귓속말: " + n.whisper : "";
  const body = $("panelBody"); body.innerHTML = "";
  const dead = G.dead[id] || [];
  const order = Logic.shuffled(n.choices, S.sid + id);
  order.forEach((c, i) => {
    const b = panelButton(i + 1, c.t, "", () => pickChoice(id, n, c.id), dead.includes(c.id) ? "dead" : "");
    b.disabled = dead.includes(c.id);
    body.appendChild(b);
  });
  renderWords(order.map(c => c.t).join(" "));
  revealPanel();
}
function pickChoice(id, n, cid) {
  const r = Logic.choose(G, id, n, cid, DEATHS, curEventId());
  save(); // 화면을 바꾸기 전에 저장한다
  if (r.type === "blocked") return;
  if (r.type === "slip") { showDeathScreen(r.death); return; }
  if (r.type === "memory") { showMemoryScreen(r.death); return; }
  clearPanel();
  show("sPlay");
  playLines(r.then, () => goNode(r.next));
}

/* ── 어긋난 죽음 ── */
function showDeathScreen(did) {
  const d = DEATHS[did];
  if (d.kind === "memory") { showMemoryScreen(did); return; }
  $("deathTitle").textContent = d.title;
  $("deathWhy").textContent = d.why;
  $("deathPage").textContent = "📖 교과서 " + d.p + "쪽";
  $("deathLamps").innerHTML = G.explore ? "" : lampText(G.lamps);
  $("deathNext").textContent = !G.explore && G.lamps <= 0 ? "등불이 없어… 다음으로" : "그 갈림길로 돌아간다";
  show("sDeath");
  Sound.play("slip");
}
function leaveDeath() {
  G.pendingDeath = null; save();
  beginEvent(curEventId());
  goNode(G.node);
}
/* ── 역사 속 죽음 ── */
function showMemoryScreen(did) {
  const d = DEATHS[did];
  $("memTitle").textContent = d.title;
  $("memWhy").textContent = d.why;
  $("memPage").textContent = "📖 교과서 " + d.p + "쪽";
  show("sMemory");
  Sound.play("memory");
}
function leaveMemory() { G.pendingDeath = null; save(); goNode(G.node); }

/* ── 심판 ── */
function renderTrial(id, n) {
  $("panelQ").textContent = "근거를 골라 줘";
  $("panelNote").textContent = "네가 모은 사료만 낼 수 있어. 틀린 사료를 내면 등불이 꺼져.";
  const body = $("panelBody"); body.innerHTML = "";
  const look = NODES[n.rewind].look.spots.map(s => s.card);
  const mine = Logic.shuffled(look.filter(c => G.cards.includes(c)), S.sid + id);
  const wrong = G.dead[id] || [];
  mine.forEach((c, i) => {
    const b = panelButton(i + 1, "📜 " + CARDS[c].title, CARDS[c].text, () => trialPick(id, n, c), wrong.includes(c) ? "dead" : "");
    b.disabled = wrong.includes(c);
    body.appendChild(b);
  });
  body.appendChild(panelButton(mine.length + 1, n.fallback.t, "", () => trialNone(n), "none"));
  $("panelReply").hidden = true;
  renderWords(mine.map(c => CARDS[c].text).join(" "));
  revealPanel();
}
function trialPick(id, n, cid) {
  const r = Logic.trialCard(G, id, n, cid);
  if (r.type === "blocked") return;
  save();
  if (r.type === "ask") { clearPanel(); renderTop(); playLines([[null, r.reply, _c], [null, "등불이 하나 꺼졌다.", _c]], () => goNode(id)); return; }
  clearPanel();
  Sound.play("pass");
  playLines(n.pass, () => goNode(r.next));
}
function trialNone(n) {
  const r = Logic.trialNoEvidence(G, n);
  save();
  clearPanel();
  const more = (G.visited[r.next] || []).length < NODES[r.next].look.spots.length;
  playLines([[null, n.fallback.line, _c], [null, more ? "다시 둘러보자. 이번에는 한 곳 더 들를 수 있어." : "모은 사료를 다시 읽어 보자.", _c]], () => goNode(r.next));
  renderTop();
}

/* ── 구출 ── */
function showRescue(id) {
  const ev = EVENTS[curEventId()], n = NODES[id] || {};
  $("rescueWhere").textContent = ev.year + " «" + ev.title + "»" + (n.q ? " — " + n.q : "");
  const dead = (G.dead[id] || []);
  const ul = $("rescueChoices"); ul.innerHTML = "";
  (n.choices || []).forEach(c => { if (!dead.includes(c.id)) ul.appendChild(el("li", "", c.t)); });
  $("rescueErr").textContent = ""; $("friendSid").value = "";
  show("sRescue");
}
function findLook(eid) {
  const prefix = EVENTS[eid].start.split("_")[0] + "_";
  const id = Object.keys(NODES).find(k => k.startsWith(prefix) && NODES[k].look);
  return id ? { id, node: NODES[id] } : null;
}
function doRescue() {
  const f = $("friendSid").value.trim();
  const c = skip() ? { ok: true } : Logic.rescueCheck(S.sid, f);
  if (!c.ok) { $("rescueErr").textContent = c.msg; return; }
  const lk = findLook(curEventId());
  const card = Logic.rescue(G, f, lk && lk.id, lk && lk.node);
  save();
  beginEvent(curEventId());
  if (card) showCard(card);
  goNode(G.node);
  Sound.play("rescue");
  pulseLamps();
}
function doRestart() {
  const eid = curEventId();
  Logic.restartEvent(G, eid, EVENTS[eid], NODES);
  save();
  beginEvent(eid);
  goNode(G.node);
}

/* ── 실제 역사 ── */
function showReal() {
  const eid = curEventId(), ev = EVENTS[eid];
  $("realTitle").textContent = ev.year + " · " + ev.title;
  /* 내 선택 → 먼저 짐작 → 펼치기(벤치마크 2차 2026-11-09). 자유 탐험은 길을 기록하지 않아 «내가 고른 길»이 없다 */
  const mine = G.path.filter(p => p.event === eid);
  const ul = $("realMineList"); ul.innerHTML = "";
  mine.forEach(p => ul.appendChild(el("li", p.memory ? "mem" : "", p.t)));
  $("realMine").hidden = !mine.length;
  const b = $("realBody"); b.innerHTML = "";
  ev.real.lines.forEach(t => b.appendChild(el("p", "real-line", t)));
  $("realPage").textContent = "📖 교과서 " + ev.real.p + "쪽";
  $("realGuess").hidden = false;
  $("realShown").hidden = true;
  show("sReal");
  if (skip()) openReal(); // 미리보기는 바로 펼친다
}
/* 정답 공개 순간: 실제 역사 문장이 한 줄씩 떠오름(Scroll-triggered와 같은 0.3초·간격) */
function openReal() {
  $("realGuess").hidden = true;
  $("realShown").hidden = false;
  document.querySelectorAll("#realBody .real-line").forEach((p, i) => setTimeout(() => p.classList.add("show"), noMotion() ? 0 : 80 + i * 160));
  if (window.innerWidth < 900) $("realShown").scrollIntoView({ behavior: noMotion() ? "auto" : "smooth", block: "nearest" });
}
function leaveReal() {
  const done = curEventId();
  if (!st.doneEvents.includes(done)) st.doneEvents.push(done);
  if (G.explore) { exitExploreRun(); return; }
  st.stepIdx += 1; st.node = null; save();
  runStep();
}

/* ── 서술형 ── */
function renderEssay() {
  const era = curEra(), es = era.essay;
  $("esEra").textContent = era.name + " · 교과서 " + es.pages + "쪽";
  $("esQ").textContent = es.q;
  $("esGuide").textContent = es.guide;
  const o = $("esOpts"); o.innerHTML = "";
  es.opts.forEach(op => { const d = el("div", "es-opt"); d.appendChild(el("b", "", op.t)); d.appendChild(document.createTextNode(op.d)); o.appendChild(d); });
  $("esHint").textContent = es.hint; $("esHint").hidden = true;
  const rows = st.path.filter(p => EVENTS[p.event].era === era.id);
  const ul = $("esPath"); ul.innerHTML = "";
  rows.forEach(p => ul.appendChild(el("li", p.memory ? "mem" : "", p.t)));
  $("esPathCard").hidden = !rows.length;
  $("esText").value = st.essays[era.id] || "";
  $("esCount").textContent = countChars($("esText").value);
  $("s5Err").textContent = "";
}
function essayInput() {
  $("esCount").textContent = countChars($("esText").value);
  st.essays[curEra().id] = $("esText").value; save(); // 쓰는 대로 저장(새로고침해도 남는다)
}
function leaveEssay() {
  const era = curEra(), txt = $("esText").value.trim();
  if (countChars(txt) < CONFIG.ESSAY_MIN && !skip()) { $("s5Err").textContent = "최소 " + CONFIG.ESSAY_MIN + "자는 써 줘. 고른 쪽과 그 까닭이면 돼."; return; }
  st.essays[era.id] = txt;
  st.stepIdx += 1; st.node = null; save();
  runStep();
}

/* ── 엔딩 ── */
function renderEnding() {
  const sum = Logic.summary(st, ERAS, DEATHS);
  $("endSummary").textContent = st.charName + " — " + ERAS.length + "번의 시대를 건너며 갈림길 " + sum.crossed + "곳을 지났고, 등불 " + sum.lampsLost + "개가 꺼졌어. 도감 " + sum.dex + " / " + sum.dexTotal + ".";
  const ti = $("endTitles"); ti.innerHTML = "";
  Logic.titles(st, DEATHS).forEach(t => ti.appendChild(el("li", "", "🏅 " + t)));
  const tl = $("timeline"); tl.innerHTML = "";
  ERAS.forEach(era => {
    const card = el("div", "tl"); card.style.setProperty("--era", era.color);
    card.appendChild(el("h3", "", era.id + ". " + era.name));
    const ul = el("ul");
    const rows = st.path.filter(p => EVENTS[p.event].era === era.id);
    rows.forEach((p, i) => {
      ul.appendChild(el("li", "tl-pick" + (p.memory ? " mem" : ""), p.t));
      NODES[p.node].choices.filter(c => c.id !== p.pick).forEach(c => {
        const hidden = c.death && !st.dex.includes(c.death);
        ul.appendChild(el("li", "tl-other", hidden ? "??? (아직 안 가 본 길)" : c.t));
      });
      // 그 사건의 마지막 갈림길 뒤에 실제 역사 한 줄(내 선택 / 실제 역사를 나란히)
      const nx = rows[i + 1];
      if (!nx || nx.event !== p.event) ul.appendChild(el("li", "tl-real", "📖 실제: " + EVENTS[p.event].real.lines[0]));
    });
    card.appendChild(ul);
    tl.appendChild(card);
  });
  renderReview();
  $("endText").value = st.ending || "";
  $("endCount").textContent = countChars($("endText").value);
  $("submitBtn").disabled = st.submitted;
  $("submitBtn").textContent = st.submitted ? "제출 완료" : "제출하고 복사하기";
  $("copyBtn").hidden = !st.submitted;
  $("exploreBtn").hidden = !st.submitted;
  updateRealCount();
  renderPadlet();
}
/* 끝나고 틀린 것만 복기(벤치마크 2차): 어긋난 죽음·심판에서 틀린 사료와 그 까닭·쪽수. 카드가 보이는 순간 한 장씩 떠오름 */
function renderReview() {
  const items = Logic.reviewList(st, DEATHS, CARDS, NODES);
  const box = $("reviewList"); box.innerHTML = "";
  $("reviewNone").hidden = !!items.length;
  items.forEach(it => {
    const d = el("div", "review " + it.kind);
    d.appendChild(el("b", "", (it.kind === "slip" ? "💀 " : "📜 심판에서 낸 사료: ") + it.title));
    d.appendChild(el("p", "", it.why));
    d.appendChild(el("span", "got-p", "교과서 " + it.p + "쪽"));
    box.appendChild(d);
  });
  const cards = Array.from(box.children);
  if (noMotion() || !("IntersectionObserver" in window)) { cards.forEach(c => c.classList.add("show")); return; }
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const i = cards.indexOf(e.target);
    setTimeout(() => e.target.classList.add("show"), (i % 6) * 50);
    io.unobserve(e.target);
  }), { threshold: 0.15 });
  cards.forEach(c => io.observe(c));
}
function scrollTimeline(dir) { $("timeline").scrollBy({ left: dir * 240, behavior: noMotion() ? "auto" : "smooth" }); }
/* 복사 글: 학생 본문 중심. 시대 이름 꼬리표만 최소로 붙인다 */
function buildOutText() {
  const parts = [];
  ERAS.forEach(era => { const t = (st.essays[era.id] || "").trim(); if (t) parts.push("[" + era.name + "] " + t); });
  const end = $("endText").value.trim();
  if (end) parts.push("[엔딩] " + end);
  return parts.join("\n") || S.outText;
}
function updateRealCount() {
  const body = ERAS.map(e => st.essays[e.id] || "").concat([$("endText").value]).map(countChars).reduce((a, b) => a + b, 0);
  $("realCount").textContent = st.submitted ? "" : "실제 쓴 글자(양식 빼고): " + body + "자";
}
async function submitAll() {
  if (S.sending || st.submitted) return;
  st.ending = $("endText").value.trim();
  if (countChars(st.ending) > 0 && countChars(st.ending) < 20 && !skip() && !confirm("엔딩 글이 아주 짧아. 이대로 제출할까?")) return;
  S.sending = true; $("submitBtn").disabled = true; $("submitBtn").textContent = "보내는 중…";
  const sum = Logic.summary(st, ERAS, DEATHS);
  const out = buildOutText();
  const copyP = Promise.race([copyText(out), new Promise(r => setTimeout(() => r(false), 3000))]); // 클릭 직후에 복사를 먼저 시작해야 브라우저가 허용한다
  const payload = {
    studentId: S.sid, studentName: S.name, gameName: CONFIG.GAME_NAME,
    choiceSummary: "갈림길 " + sum.crossed + "곳 / 등불 꺼짐 " + sum.lampsLost + "개 / 도감 " + sum.dex + "종 / 구출 " + sum.rescues + "번",
    diffSummary: "",
    reflection: out, // 시트 G열: 시대별 서술형 + 엔딩 글
    choicesJson: JSON.stringify({
      v: 2, sid: S.sid, name: S.name, ban: S.ban, charName: st.charName, mode: S.mode,
      path: st.path.map(p => ({ node: p.node, pick: p.pick })), deaths: st.deathLog.map(d => d.id), dex: st.dex,
      lampsLost: st.lampsLost, rescues: st.rescues, essays: st.essays, ending: st.ending, ts: new Date().toISOString()
    })
  };
  Object.assign(payload, FocusGuard.payload());
  try { await postToSheet(payload); }
  catch (e) {
    $("s6Err").textContent = e.locked ? e.message : "저장이 안 됐어. 인터넷을 확인하고 다시 눌러 줘.";
    S.sending = false; $("submitBtn").disabled = false; $("submitBtn").textContent = "제출하고 복사하기";
    return;
  }
  const copied = await copyP;
  S.sending = false; S.outText = out; st.submitted = true;
  try { sessionStorage.setItem(storeKey() + ":out", out); } catch (e) { /* 막히면 메모리만 */ }
  st.essays = {}; st.ending = ""; // 제출한 글은 공용 태블릿에 남기지 않는다(복사는 이 화면에서만)
  save();
  $("s6Err").textContent = "";
  $("submitBtn").textContent = "제출 완료";
  $("copyBtn").hidden = false;
  $("exploreBtn").hidden = false;
  $("realCount").textContent = "";
  renderPadlet();
  $("outMsg").textContent = S.preview ? "미리보기라 저장하지 않았어." : (copied ? "제출했고 글도 복사했어!" : "제출했어! 복사가 안 됐으니 «다시 복사»를 눌러 줘.");
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = el("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}
async function copyOut() {
  const text = S.outText || buildOutText();
  if (!text) { $("outMsg").textContent = st.submitted ? "제출한 글은 이 태블릿에 남겨 두지 않아. 다시 복사할 수 없어." : "복사할 글이 아직 없어."; return; }
  const ok = await copyText(text);
  $("outMsg").textContent = !ok ? "복사가 안 됐어. 한 번 더 눌러 줘." : (st.submitted ? "복사했어. 필요한 곳에 붙여넣기 해." : "복사했어. 제출 버튼도 꼭 눌러 줘!");
}

/* ── 자유 탐험(제출 뒤, 미리보기): 임시 상태로 움직여 제출 기록은 그대로다. 도감만 공유한다 ── */
function renderExplore() {
  const box = $("exploreList"); box.innerHTML = "";
  ERAS.forEach(era => {
    box.appendChild(el("h3", "", era.name));
    era.flow.filter(f => typeof f === "string").forEach(eid => {
      const ev = EVENTS[eid];
      const b = el("button", "btn ghost", ev.year + " " + ev.title); b.type = "button";
      b.addEventListener("click", () => startExploreRun(eid));
      box.appendChild(b);
    });
  });
  show("sExplore");
}
function startExploreRun(eid) {
  G = Logic.newState(); G.explore = true; G.dex = st.dex; G.charName = st.charName;
  G.eraIdx = EVENTS[eid].era - 1;
  exploreEvent = eid;
  G.node = EVENTS[eid].start;
  beginEvent(eid);
  goNode(G.node);
}
function exitExploreRun() { save(); stopLines(); G = st; exploreEvent = null; renderExplore(); }
function stopLines() { finishTyping(); S.queue = []; S.playing = false; S.onDone = null; $("nextBtn").hidden = true; }

/* ── 모은 사료·도감 ── */
function openSheet(title, fill) {
  $("sheetTitle").textContent = title;
  const b = $("sheetBody"); b.innerHTML = "";
  fill(b);
  $("sheet").hidden = false;
}
function openCards() {
  openSheet("📜 모은 사료", b => {
    if (!G.cards.length) { b.appendChild(el("p", "note", "아직 모은 사료가 없어. 둘러보면 모여.")); return; }
    G.cards.forEach(id => {
      const c = CARDS[id], d = el("div", "src-card");
      d.appendChild(el("b", "", c.title));
      d.appendChild(el("p", "", c.text));
      d.appendChild(el("span", "got-p", "교과서 " + c.p + "쪽"));
      b.appendChild(d);
    });
  });
}
function openDex() {
  const all = Object.keys(DEATHS);
  openSheet("💀 죽음 도감 " + st.dex.length + " / " + all.length, b => {
    b.appendChild(el("p", "note", "지나간 사건의 칸에는 단서가 보여. 다 모으려면 제출한 뒤 자유 탐험을 해 봐."));
    ERAS.forEach(era => {
      b.appendChild(el("h3", "dex-era", era.name));
      all.filter(k => DEATHS[k].era === era.id).forEach(k => {
        const d = DEATHS[k], seen = st.dex.includes(k), passed = st.doneEvents.includes(d.event);
        const row = el("div", "dex " + d.kind + (seen ? " seen" : ""));
        row.appendChild(el("b", "", seen ? (d.kind === "memory" ? "🕯 " : "💀 ") + d.title : "??? "));
        row.appendChild(el("p", "", seen ? d.why : (passed ? d.clue : "아직 지나가지 않은 사건이야.")));
        if (seen) row.appendChild(el("span", "got-p", "교과서 " + d.p + "쪽"));
        b.appendChild(row);
      });
    });
  });
}

/* ── 조작: 터치(이야기 칸 누르기)·스페이스·엔터·숫자키 ── */
function onKey(e) {
  if (e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
  if (!$("sheet").hidden) { if (e.key === "Escape") $("sheet").hidden = true; return; }
  if (!$("sPlay").hidden && (e.key === " " || e.key === "Enter") && (S.playing || S.typing)) { e.preventDefault(); nextLine(); return; }
  if (!$("sPlay").hidden && !$("panel").hidden && !S.playing && /^[1-6]$/.test(e.key)) {
    const b = document.querySelectorAll("#panelBody .choice")[Number(e.key) - 1];
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
  }
}
function onStageTap(e) {
  if (e.target.closest && e.target.closest(".term")) return; // 낱말 풀이를 누른 것
  if (S.playing || S.typing) nextLine();
}

/* ── 부팅 (모든 함수 선언 뒤, 파일 맨 마지막) ── */
function init() {
  const q = new URLSearchParams(location.search);
  S.preview = q.get("preview") === "1";
  S.mode = q.get("mode") === "3" ? 3 : 2;
  S.upto = Math.min(4, Math.max(1, Number(q.get("upto")) || 4));
  let sid = (q.get("sid") || "").trim(), name = (q.get("name") || "").trim();
  if (S.preview) { $("previewBar").hidden = false; if (!sid) sid = "30512"; if (!name) name = "미리보기"; $("pvJump").hidden = false; }
  $("sid").value = sid; $("sname").value = name;
  if (!S.preview && parseSid(sid) && name) {
    $("idFields").hidden = true;
    $("knownWho").hidden = false;
    $("knownWho").textContent = name + " (" + sid + ")";
  }

  $("startBtn").addEventListener("click", startApp);
  $("s1Next").addEventListener("click", makeChar);
  $("eraGo").addEventListener("click", () => { runStep(); });
  $("stage").addEventListener("click", onStageTap);
  $("deathNext").addEventListener("click", leaveDeath);
  $("memNext").addEventListener("click", leaveMemory);
  $("rescueBtn").addEventListener("click", doRescue);
  $("restartBtn").addEventListener("click", doRestart);
  $("realNext").addEventListener("click", leaveReal);
  $("realOpen").addEventListener("click", openReal);
  $("tbSound").addEventListener("click", () => { Sound.toggle(); renderSound(); });
  $("esHintBtn").addEventListener("click", () => { $("esHint").hidden = !$("esHint").hidden; });
  $("esText").addEventListener("input", essayInput);
  $("s5Next").addEventListener("click", leaveEssay);
  $("tlPrev").addEventListener("click", () => scrollTimeline(-1));
  $("tlNext").addEventListener("click", () => scrollTimeline(1));
  $("endText").addEventListener("input", () => { $("endCount").textContent = countChars($("endText").value); st.ending = $("endText").value; save(); updateRealCount(); });
  $("submitBtn").addEventListener("click", submitAll);
  $("copyBtn").addEventListener("click", copyOut);
  $("endDex").addEventListener("click", openDex);
  $("exploreBtn").addEventListener("click", renderExplore);
  $("exploreBack").addEventListener("click", () => { G = st; exploreEvent = null; if (st.charName && (st.atEnding || st.submitted)) { renderEnding(); show("s6"); } else show("s0"); });
  $("exitExplore").addEventListener("click", e => { e.stopPropagation(); exitExploreRun(); });
  $("tbCards").addEventListener("click", openCards);
  $("tbDex").addEventListener("click", openDex);
  $("sheetClose").addEventListener("click", () => { $("sheet").hidden = true; });
  $("pvJump").addEventListener("click", () => { S.sid = $("sid").value.trim() || "30512"; S.name = $("sname").value.trim() || "미리보기"; st.charName = "미리보기"; renderExplore(); });
  document.addEventListener("keydown", onKey);
  Glossary.start({ terms: GLOSSARY, skip: ["#topbar", ".word-skip"] }); // 어려운 낱말 풀이
}

init();
