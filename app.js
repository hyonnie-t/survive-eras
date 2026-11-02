/* 시대를 건너 살아남기 — 로직(app.js)
 * 주소 옵션: ?sid=30512&name=이름 (자동 채움) / ?preview=1 (저장 안 함) / ?mode=2|3 (시대당 장면 2개=공통, 3개=유연, 기본 2)
 *            / ?upto=1~4 (이번 시간에 열어 둘 마지막 시대, 기본 4) / ?teacher=1 (기숙사 결산) */
const CONFIG = {
  SHEET_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbyXSjCfWY_HiZFqW_OBR-FQDoIfF1z_STqyKWUI31MacHeY3u7hbirFSFDvW-5yuUHaJQ/exec",
  /* 포털 커리큘럼 관리에 이 id 하나로 등록한다(글자까지 같아야 포인트·진행률에 잡힌다). */
  GAME_NAME: "총복습_시대를건너살아남기",
  ESSAY_MIN: 30,     // 시대 끝 서술형 최소 글자 수
  ESSAY_SCORE: 2     // 서술형을 쓰면 주는 생존 점수(내용 평가 아님)
};

const S = {
  sid: "", name: "", grade: 0, ban: 0, preview: false, teacher: false,
  mode: 2, upto: 4,
  house: "", charName: "", origin: "",
  eraIdx: 0, sceneIdx: 0,          // 현재 시대(ERAS 순서)·그 시대 안 장면 순서
  log: [],                          // {id, pick, s, rescued}
  essays: {},                       // {eraId: text}
  ending: "",
  deadPick: -1, retrying: false,
  sending: false, submitted: false, padletUrl: "",
  started: false
};

const $ = id => document.getElementById(id);
const skip = () => S.preview;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function parseSid(sid) {
  if (!/^\d{5}$/.test(sid)) return null;
  return { grade: Number(sid[0]), ban: Number(sid.slice(1, 3)), num: Number(sid.slice(3)) };
}
function countChars(t) { return String(t || "").replace(/\s/g, "").length; }

/* ── 장면 목록: 모드에 따라 유연 장면을 켜고 끈다 ── */
function scenesOf(eraId) { return SCENES.filter(sc => sc.era === eraId && (S.mode >= 3 || sc.tier === "공통")); }
function curEra() { return ERAS[S.eraIdx]; }
function curScene() { return scenesOf(curEra().id)[S.sceneIdx]; }
function totalScore() {
  let t = S.log.reduce((a, l) => a + l.s, 0);
  Object.keys(S.essays).forEach(k => { if (countChars(S.essays[k]) >= CONFIG.ESSAY_MIN) t += CONFIG.ESSAY_SCORE; });
  return t;
}
function deaths() { return S.log.filter(l => l.rescued).length; }

/* ── 진행 저장(학번별, 미리보기 제외) ── */
function storeKey() { return "survive_eras:" + CONFIG.GAME_NAME + ":" + S.sid; }
function saveProgress() {
  if (S.preview || !S.sid) return;
  try {
    localStorage.setItem(storeKey(), JSON.stringify({
      house: S.house, charName: S.charName, origin: S.origin, eraIdx: S.eraIdx, sceneIdx: S.sceneIdx,
      log: S.log, essays: S.essays, submitted: S.submitted, ts: Date.now()
    }));
  } catch (e) { /* 저장소가 막히면 메모리만 */ }
}
function loadProgress() {
  if (S.preview) return false;
  try {
    const v = JSON.parse(localStorage.getItem(storeKey()) || "null");
    if (!v || !v.charName) return false;
    S.house = v.house || S.house; S.charName = v.charName; S.origin = v.origin || "";
    S.eraIdx = Math.min(v.eraIdx || 0, ERAS.length - 1); S.sceneIdx = v.sceneIdx || 0;
    S.log = Array.isArray(v.log) ? v.log : []; S.essays = v.essays || {}; S.submitted = !!v.submitted;
    return true;
  } catch (e) { return false; }
}

/* ── 화면 전환 ── */
function show(key) {
  ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"].forEach(k => { $(k).hidden = (k !== key); });
  $("topbar").hidden = !(key === "s2" || key === "s3" || key === "s4" || key === "s5");
  renderTop();
  window.scrollTo(0, 0);
}
function renderTop() {
  if (!S.started) return;
  const era = curEra(), list = scenesOf(era.id);
  $("tbEra").textContent = era.name;
  $("tbScene").textContent = $("s5").hidden ? ("장면 " + Math.min(S.sceneIdx + 1, list.length) + "/" + list.length) : "서술형";
  $("tbHouse").textContent = (HOUSES.find(h => h.id === S.house) || { ic: "" }).ic + " " + S.house;
  $("tbScore").textContent = totalScore();
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
  if (S.padletUrl) { a.href = S.padletUrl; a.hidden = false; $("padletMsg").textContent = ""; }
  else { a.hidden = true; $("padletMsg").textContent = "패들렛 링크는 선생님이 알려 준 곳을 써 줘."; }
}

/* ── 0. 시작 ── */
function renderHouses() {
  const g = $("houseGrid"); g.innerHTML = "";
  HOUSES.forEach(h => {
    const b = el("button", "house" + (S.house === h.id ? " on" : ""));
    b.type = "button";
    b.appendChild(el("span", "ic", h.ic));
    b.appendChild(document.createTextNode(h.id));
    b.appendChild(el("small", "", h.dir));
    b.addEventListener("click", () => { S.house = h.id; renderHouses(); });
    g.appendChild(b);
  });
}
function startApp() {
  const sid = $("sid").value.trim(), name = $("sname").value.trim();
  const p = parseSid(sid);
  if (!p) { $("startErr").textContent = "학번은 숫자 5자리로 써 줘. (예: 30512)"; return; }
  if (!name) { $("startErr").textContent = "이름을 써 줘."; return; }
  if (!S.house && !skip()) { $("startErr").textContent = "기숙사를 골라 줘."; return; }
  if (!S.house) S.house = HOUSES[0].id;
  $("startErr").textContent = "";
  S.sid = sid; S.name = name; S.grade = p.grade; S.ban = p.ban;
  FocusGuard.start({ key: CONFIG.GAME_NAME + ":" + sid }); // 작성 중 화면 이탈·붙여넣기 기록 (history26 snippets/focus_guard.js)
  if (window.DraftGuard) DraftGuard.start({ key: CONFIG.GAME_NAME, sid: sid }); // 서술형·엔딩 글 임시저장
  loadPadletUrl(p.grade, p.ban).then(u => { S.padletUrl = u; renderPadlet(); });
  S.started = true;
  if (loadProgress()) { // 이어하기: 지난 시간에 만든 캐릭터·진행이 있으면 그 자리로
    renderHouses();
    if (S.submitted) { renderEnding(); show("s6"); return; }
    enterEra(); return;
  }
  renderOrigins(); show("s1");
}

/* ── 1. 캐릭터 ── */
function renderOrigins() {
  const g = $("originGrid"); g.innerHTML = "";
  ORIGINS.forEach(o => {
    const b = el("button", "origin" + (S.origin === o.id ? " on" : ""));
    b.type = "button"; b.innerHTML = "<b>" + o.name + "</b> — " + o.tag;
    b.addEventListener("click", () => { S.origin = o.id; renderOrigins(); });
    g.appendChild(b);
  });
}
function makeChar() {
  const n = $("charName").value.trim();
  if ((n.length < 2 || n.length > 8) && !skip()) { $("s1Err").textContent = "캐릭터 이름은 2~8자로 지어 줘."; return; }
  if (!S.origin && !skip()) { $("s1Err").textContent = "출신을 하나 골라 줘."; return; }
  S.charName = n || "나그네"; if (!S.origin) S.origin = ORIGINS[0].id;
  $("s1Err").textContent = "";
  S.eraIdx = 0; S.sceneIdx = 0; S.log = []; S.essays = {};
  saveProgress();
  enterEra();
}

/* ── 2. 시대 들어가기 ── */
function enterEra() {
  const era = curEra();
  const locked = era.id > S.upto;
  $("eraCard").style.setProperty("--era", era.color);
  $("eraNo").textContent = "환생 " + era.id + " / " + ERAS.length + " · 교과서 " + era.pages + "쪽";
  $("eraTitle").textContent = era.name;
  $("eraSpan").textContent = era.span;
  $("eraIntro").textContent = S.charName + josa(S.charName, "이", "가") + " " + era.intro;
  $("eraLocked").hidden = !locked;
  $("eraGo").hidden = locked;
  show("s2");
}
function goScene() {
  const list = scenesOf(curEra().id);
  if (S.sceneIdx >= list.length) { renderEssay(); show("s5"); return; }
  renderScene();
  show("s3");
}

/* ── 3. 장면 ── */
function renderScene() {
  const sc = curScene();
  $("scYear").textContent = sc.year;
  $("scTitle").textContent = sc.title;
  $("scRole").textContent = sc.role.replace(/^너는/, S.charName + ", 너는");
  const t = $("scText"); t.innerHTML = "";
  sc.situ.forEach(s => t.appendChild(el("p", "", s)));
  const c = $("choices"); c.innerHTML = "";
  sc.choices.forEach((ch, i) => {
    const b = el("button", "choice"); b.type = "button";
    b.appendChild(el("span", "k", String(i + 1)));
    b.appendChild(el("span", "", ch.t));
    if (S.retrying && i === S.deadPick) b.disabled = true;
    b.addEventListener("click", () => pick(i));
    c.appendChild(b);
  });
  revealChoices();
  $("result").hidden = true;
  c.parentElement.hidden = false;
  renderTop();
}
/* 선택지 카드는 보이는 순간 한 장씩 떠오른다(Scroll-triggered) */
function revealChoices() {
  const cards = Array.from(document.querySelectorAll("#choices .choice"));
  if (!("IntersectionObserver" in window)) { cards.forEach(c => c.classList.add("show")); return; }
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { const i = cards.indexOf(en.target); setTimeout(() => en.target.classList.add("show"), i * 60); io.unobserve(en.target); } });
  }, { threshold: 0.2 });
  cards.forEach(c => io.observe(c));
  setTimeout(() => cards.forEach(c => c.classList.add("show")), 900); // 관찰이 안 되는 환경(숨은 탭 등)에서도 반드시 보이게
}
/* 이름 뒤 조사: 받침 있으면 앞 글자, 없으면 뒷 글자 */
function josa(word, withBatchim, without) {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return without;
  return (code - 0xac00) % 28 ? withBatchim : without;
}
function pick(i) {
  const sc = curScene(), ch = sc.choices[i];
  if (ch.s === 0 && !S.retrying) { S.deadPick = i; renderDeath(sc, ch); show("s4"); return; }
  const score = S.retrying ? 1 : ch.s; // 구출 뒤 재도전은 살아남아도 1점
  S.log.push({ id: sc.id, pick: i, s: score, rescued: S.retrying });
  S.retrying = false; S.deadPick = -1;
  saveProgress();
  $("rsText").textContent = ch.r;
  $("rsPage").textContent = "📖 교과서 " + ch.p + "쪽";
  $("rsScore").textContent = score === 3 ? "❤ +3 살아남았다!" : (score === 1 ? (S.log[S.log.length - 1].rescued ? "🛟 +1 친구 덕에 살아남았다" : "❤ +1 겨우 살아남았다") : "");
  document.querySelectorAll("#choices .choice").forEach(b => { b.disabled = true; });
  $("result").hidden = false;
  renderTop();
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}
function nextScene() {
  S.sceneIdx += 1; saveProgress();
  goScene();
}

/* ── 4. 사망·구출 ── */
function renderDeath(sc, ch) {
  $("deathTitle").textContent = S.charName + ", " + sc.year.split(" · ")[0] + "에 쓰러지다";
  $("deathWhy").textContent = ch.r;
  $("deathPage").textContent = "📖 교과서 " + ch.p + "쪽";
  $("rescueBox").hidden = false; $("hintBox").hidden = true;
}
function rescue() {
  $("hintText").textContent = curScene().hint;
  $("rescueBox").hidden = true; $("hintBox").hidden = false;
}
function retry() {
  S.retrying = true;
  renderScene(); show("s3");
}

/* ── 5. 시대 끝 서술형 ── */
function renderEssay() {
  const era = curEra(), es = era.essay;
  $("esEra").textContent = era.name + " · 교과서 " + es.pages + "쪽";
  $("esQ").textContent = es.q;
  $("esGuide").textContent = es.guide;
  const o = $("esOpts"); o.innerHTML = "";
  es.opts.forEach(op => { const d = el("div", "es-opt"); d.appendChild(el("b", "", op.t)); d.appendChild(document.createTextNode(op.d)); o.appendChild(d); });
  $("esHint").textContent = es.hint; $("esHint").hidden = true;
  const ta = $("esText");
  ta.id = "esText"; ta.setAttribute("data-draft", "essay-" + era.id); // 시대마다 다른 칸으로 임시저장
  ta.value = S.essays[era.id] || "";
  $("esCount").textContent = countChars(ta.value);
  $("s5Err").textContent = "";
  renderTop();
}
function leaveEra() {
  const era = curEra(), txt = $("esText").value.trim();
  if (countChars(txt) < CONFIG.ESSAY_MIN && !skip()) { $("s5Err").textContent = "최소 " + CONFIG.ESSAY_MIN + "자는 써 줘. 고른 쪽과 그 까닭이면 돼."; return; }
  S.essays[era.id] = txt;
  if (S.eraIdx + 1 >= ERAS.length) { saveProgress(); renderEnding(); show("s6"); return; }
  S.eraIdx += 1; S.sceneIdx = 0; saveProgress();
  enterEra();
}

/* ── 6. 엔딩 ── */
function originTag() { return (ORIGINS.find(o => o.id === S.origin) || { tag: "" }).tag; }
function sceneById(id) { return SCENES.find(s => s.id === id); }
function renderEnding() {
  $("endSummary").textContent = S.charName + " — " + originTag() + ". " + ERAS.length + "번 태어나 " + S.log.length + "번 선택했고, " + deaths() + "번 쓰러졌다가 친구 덕에 일어났다.";
  const tl = $("timeline"); tl.innerHTML = "";
  ERAS.forEach(era => {
    const card = el("div", "tl"); card.style.setProperty("--era", era.color);
    card.appendChild(el("h3", "", era.id + ". " + era.name));
    const ul = el("ul");
    S.log.filter(l => sceneById(l.id).era === era.id).forEach(l => {
      const sc = sceneById(l.id);
      const li = el("li", l.rescued ? "dead" : "ok", (l.rescued ? "🛟 " : (l.s === 3 ? "✅ " : "〰 ")) + sc.year.split(" · ")[0] + " " + sc.title);
      ul.appendChild(li);
    });
    const e = S.essays[era.id];
    if (e) ul.appendChild(el("li", "", "✍ " + era.essay.q));
    card.appendChild(ul);
    tl.appendChild(card);
  });
  $("endText").value = S.ending || "";
  $("endCount").textContent = countChars($("endText").value);
  $("endScore").textContent = totalScore();
  $("submitBtn").disabled = S.submitted;
  $("submitBtn").textContent = S.submitted ? "제출 완료" : "제출";
  updateRealCount();
  renderPadlet();
}
function scrollTimeline(dir) { $("timeline").scrollBy({ left: dir * 230, behavior: "smooth" }); }

/* 복사 글: 학생 본문 중심. 시대 이름 꼬리표만 최소로 붙인다(채점·패들렛 분량 착각 방지). */
function studentTexts() {
  const parts = [];
  ERAS.forEach(era => { const t = (S.essays[era.id] || "").trim(); if (t) parts.push("[" + era.name + "] " + t); });
  const end = $("endText").value.trim();
  if (end) parts.push("[엔딩] " + end);
  return parts;
}
function buildOutText() { return studentTexts().join("\n"); }
function updateRealCount() {
  const body = ERAS.map(e => (S.essays[e.id] || "")).concat([$("endText").value]).map(countChars).reduce((a, b) => a + b, 0);
  $("realCount").textContent = "실제 쓴 글자(양식 빼고): " + body + "자";
}
async function submitAll() {
  if (S.sending || S.submitted) return;
  S.ending = $("endText").value.trim();
  if (countChars(S.ending) > 0 && countChars(S.ending) < 20 && !skip() && !confirm("엔딩 글이 아주 짧아. 이대로 제출할까?")) return;
  S.sending = true; $("submitBtn").disabled = true; $("submitBtn").textContent = "보내는 중…";
  const score = totalScore();
  const payload = {
    studentId: S.sid, studentName: S.name, gameName: CONFIG.GAME_NAME,
    groupId: S.house, // 조번호 열 = 기숙사
    choiceSummary: "기숙사 " + S.house + " / 생존 점수 " + score + " / 쓰러짐 " + deaths() + "회 / " + S.charName + "(" + originTag() + ")",
    diffSummary: "",
    reflection: buildOutText(), // 시트 G열: 시대별 서술형 + 엔딩 글
    choicesJson: JSON.stringify({
      sid: S.sid, name: S.name, ban: S.ban, house: S.house, charName: S.charName, origin: S.origin,
      mode: S.mode, score: score, deaths: deaths(), log: S.log, essays: S.essays, ending: S.ending, ts: new Date().toISOString()
    })
  };
  Object.assign(payload, FocusGuard.payload());
  try { await postToSheet(payload); }
  catch (e) {
    $("s6Err").textContent = e.locked ? e.message : "저장이 안 됐어. 인터넷을 확인하고 다시 눌러 줘.";
    S.sending = false; $("submitBtn").disabled = false; $("submitBtn").textContent = "제출";
    return;
  }
  S.sending = false; S.submitted = true; saveProgress();
  if (window.DraftGuard) DraftGuard.clear(); // 저장 성공 → 임시저장 삭제(공용 태블릿 보호)
  $("s6Err").textContent = "";
  $("submitBtn").textContent = "제출 완료";
  $("outMsg").textContent = S.preview ? "미리보기라 저장하지 않았어." : "제출했어! 글 복사를 눌러 패들렛에 올리면 끝.";
}
async function copyOut() {
  const text = buildOutText();
  if (!text) { $("outMsg").textContent = "복사할 글이 아직 없어."; return; }
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = el("textarea"); ta.value = text; ta.setAttribute("data-no-draft", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  $("outMsg").textContent = S.submitted ? "복사했어. 패들렛에 붙여넣기 해." : "복사했어. 제출 버튼도 꼭 눌러 줘!";
}

/* ── 7. 교사 결산: 토큰은 이 화면에서 입력받아 요청에만 쓰고 저장하지 않는다 ── */
let tallyText = "";
async function loadTally() {
  const token = $("tkInput").value.trim();
  if (!token) { $("tkMsg").textContent = "교사 토큰을 넣어 주세요."; return; }
  $("tkMsg").textContent = "불러오는 중…";
  let rows;
  try {
    const res = await fetch(CONFIG.SHEET_WEBAPP_URL + "?token=" + encodeURIComponent(token) + "&game=" + encodeURIComponent(CONFIG.GAME_NAME));
    const json = await res.json();
    if (json.result !== "success") throw new Error(json.message || "조회 실패");
    rows = json.rows || [];
  } catch (e) { $("tkMsg").textContent = "조회 실패: " + e.message; return; }
  const byBan = {}; // ban -> house -> {sum, n, deaths, names[]}
  const seen = {};
  rows.forEach(r => {
    let j = {}; try { j = JSON.parse(r.choicesJson || "{}"); } catch (e) { j = {}; }
    const sid = String(r.studentId || ""); if (seen[sid]) return; seen[sid] = true; // 학생당 1행(먼저 나온 행)
    const ban = j.ban || (parseSid(sid) || { ban: 0 }).ban, house = j.house || r.groupId || "미정";
    byBan[ban] = byBan[ban] || {};
    const h = byBan[ban][house] = byBan[ban][house] || { sum: 0, n: 0, deaths: 0, names: [] };
    h.sum += Number(j.score) || 0; h.n += 1; h.deaths += Number(j.deaths) || 0; h.names.push(String(r.studentName || sid));
  });
  const box = $("tally"); box.innerHTML = ""; const lines = [];
  const bans = Object.keys(byBan).sort((a, b) => a - b);
  if (!bans.length) { $("tkMsg").textContent = "제출된 기록이 아직 없어요."; return; }
  bans.forEach(ban => {
    box.appendChild(el("h3", "", "3학년 " + ban + "반"));
    lines.push("[3-" + ban + "]");
    const t = el("table"); const thead = el("thead"); thead.innerHTML = "<tr><th>기숙사</th><th>합계</th><th>인원</th><th>평균</th><th>쓰러짐</th></tr>"; t.appendChild(thead);
    const tb = el("tbody");
    const order = HOUSES.map(h => h.id).concat(Object.keys(byBan[ban]).filter(k => !HOUSES.some(h => h.id === k)));
    const ranked = order.filter(k => byBan[ban][k]).sort((a, b) => byBan[ban][b].sum - byBan[ban][a].sum);
    ranked.forEach((k, i) => {
      const h = byBan[ban][k], ic = (HOUSES.find(x => x.id === k) || { ic: "" }).ic;
      const tr = el("tr", i === 0 ? "top" : "");
      tr.innerHTML = "<td>" + (i === 0 ? "🏆 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : "") + ic + " " + k + "</td><td class='n'>" + h.sum + "</td><td class='n'>" + h.n + "</td><td class='n'>" + (h.n ? (h.sum / h.n).toFixed(1) : "-") + "</td><td class='n'>" + h.deaths + "</td>";
      tr.title = h.names.join(", ");
      tb.appendChild(tr);
      lines.push((i + 1) + ". " + k + " 합계 " + h.sum + " (" + h.n + "명, 평균 " + (h.n ? (h.sum / h.n).toFixed(1) : "-") + ")");
    });
    t.appendChild(tb); box.appendChild(t);
  });
  tallyText = lines.join("\n");
  $("tkMsg").textContent = "제출 " + Object.keys(seen).length + "명 · " + new Date().toLocaleTimeString("ko-KR") + " 기준. 표 줄에 마우스를 올리면 명단이 보여요.";
}
async function copyTally() {
  if (!tallyText) { $("tkMsg").textContent = "먼저 불러오기를 눌러 주세요."; return; }
  try { await navigator.clipboard.writeText(tallyText); $("tkMsg").textContent = "복사했어요."; } catch (e) { $("tkMsg").textContent = "복사 실패"; }
}

/* ── 부팅 (모든 함수 선언 뒤, 파일 맨 마지막) ── */
function init() {
  const q = new URLSearchParams(location.search);
  S.preview = q.get("preview") === "1";
  S.teacher = q.get("teacher") === "1";
  S.mode = q.get("mode") === "3" ? 3 : 2;
  S.upto = Math.min(4, Math.max(1, Number(q.get("upto")) || 4));
  let sid = (q.get("sid") || "").trim(), name = (q.get("name") || "").trim();
  if (S.preview) { $("previewBar").hidden = false; if (!sid) sid = "30512"; if (!name) name = "미리보기"; }
  $("sid").value = sid; $("sname").value = name;

  renderHouses();
  $("startBtn").addEventListener("click", startApp);
  $("s1Back").addEventListener("click", () => show("s0"));
  $("s1Next").addEventListener("click", makeChar);
  $("eraGo").addEventListener("click", goScene);
  $("rsNext").addEventListener("click", nextScene);
  $("rescueBtn").addEventListener("click", rescue);
  $("retryBtn").addEventListener("click", retry);
  $("esHintBtn").addEventListener("click", () => { $("esHint").hidden = !$("esHint").hidden; });
  $("esText").addEventListener("input", () => { $("esCount").textContent = countChars($("esText").value); });
  $("s5Next").addEventListener("click", leaveEra);
  $("tlPrev").addEventListener("click", () => scrollTimeline(-1));
  $("tlNext").addEventListener("click", () => scrollTimeline(1));
  $("endText").addEventListener("input", () => { $("endCount").textContent = countChars($("endText").value); updateRealCount(); });
  $("submitBtn").addEventListener("click", submitAll);
  $("copyBtn").addEventListener("click", copyOut);
  $("tkLoad").addEventListener("click", loadTally);
  $("tkCopy").addEventListener("click", copyTally);

  if (S.teacher) { show("s7"); return; }
  Glossary.start({ terms: GLOSSARY, skip: ["#topbar", ".house", ".origin", ".tl"] }); // 어려운 낱말 풀이 (glossary.js)
}

init();
