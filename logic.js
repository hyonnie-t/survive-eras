/* 시대를 건너 살아남기 — 판정 로직(logic.js). 화면을 건드리지 않는다. 같은 입력이면 늘 같은 결과(무작위 없음). */
const Logic = (() => {
  const LAMPS = 3;

  /* 학번·노드로 만든 씨앗으로 섞는다: 같은 학생은 늘 같은 순서, 다른 학생은 다른 순서 */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shuffled(arr, seedText) {
    const a = arr.slice();
    let s = hash(seedText);
    for (let i = a.length - 1; i > 0; i--) {
      s = Math.imul(s ^ (s >>> 15), 2654435761) >>> 0;
      const j = s % (i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function newState() {
    return {
      charName: "", eraIdx: 0, stepIdx: 0, node: null, lamps: LAMPS,
      flags: {}, cards: [], visited: {}, extraLook: {}, dead: {}, eventDeaths: {},
      path: [], deathLog: [], dex: [], rescues: [], essays: {}, ending: "",
      pendingDeath: null, pendingReal: null, atEnding: false, submitted: false, explore: false,
      lampsLost: 0, doneEvents: [], trialMiss: []
    };
  }

  /* 모드에 따른 시대 진행표: 유연 사건은 mode 3에서만 */
  function flowOf(era, events, mode) {
    return era.flow.filter(f => f.essay || mode >= 3 || events[f].tier === "공통");
  }

  /* 이 갈림길에서 한 번 죽었고 아직 죽는 길이 남아 있을 때 귓속말을 보여 준다 */
  function showWhisper(st, nodeId, node, deaths) {
    const dead = st.dead[nodeId] || [];
    if (!dead.length || !node.whisper) return false;
    return node.choices.some(c => c.death && deaths[c.death].kind === "slip" && !dead.includes(c.id));
  }

  function addDex(st, id) { if (!st.dex.includes(id)) st.dex.push(id); }

  /* 갈림길 선택. 결과 종류: slip(등불 꺼짐, 같은 갈림길로) / memory(도감에 넣고 다음으로) / go(다음으로) */
  function choose(st, nodeId, node, choiceId, deaths, event) {
    const ch = node.choices.find(c => c.id === choiceId);
    if (!ch) throw new Error("없는 선택지: " + choiceId);
    const dead = st.dead[nodeId] || [];
    if (dead.includes(choiceId)) return { type: "blocked" };
    if (ch.death && deaths[ch.death].kind === "slip") {
      st.dead[nodeId] = dead.concat(choiceId);
      addDex(st, ch.death);
      st.deathLog.push({ id: ch.death, node: nodeId });
      st.eventDeaths[event] = (st.eventDeaths[event] || 0) + 1;
      if (!st.explore) { st.lamps = Math.max(0, st.lamps - 1); st.lampsLost += 1; }
      st.pendingDeath = ch.death;
      return { type: "slip", death: ch.death };
    }
    node.choices.forEach(c => (c.flags || []).forEach(f => { delete st.flags[f]; }));
    (ch.flags || []).forEach(f => { st.flags[f] = true; });
    recordPath(st, nodeId, node, ch, event);
    if (ch.death) { // 역사 속 죽음
      addDex(st, ch.death);
      st.deathLog.push({ id: ch.death, node: nodeId });
      st.pendingDeath = ch.death;
      st.node = ch.next;
      return { type: "memory", death: ch.death, next: ch.next };
    }
    st.node = ch.next;
    return { type: "go", next: ch.next, then: ch.then || [] };
  }

  /* 같은 갈림길은 한 줄만 남긴다: 새로고침·되감기로 다시 지나가도 기록이 불어나지 않는다 */
  function recordPath(st, nodeId, node, ch, event) {
    if (st.explore) return;
    const row = { node: nodeId, event, q: node.q, pick: ch.id, t: ch.t, memory: !!ch.death };
    const i = st.path.findIndex(p => p.node === nodeId);
    if (i >= 0) st.path[i] = row; else st.path.push(row);
  }

  /* 둘러보기: 곳당 카드 한 장, 정해진 수까지만 */
  function lookLimit(st, nodeId, node) { return Math.min(node.look.spots.length, node.look.pick + (st.extraLook[nodeId] || 0)); }
  function canVisit(st, nodeId, node, spotId) {
    const v = st.visited[nodeId] || [];
    return !v.includes(spotId) && v.length < lookLimit(st, nodeId, node);
  }
  function visit(st, nodeId, node, spotId) {
    if (!canVisit(st, nodeId, node, spotId)) return false;
    st.visited[nodeId] = (st.visited[nodeId] || []).concat(spotId);
    const spot = node.look.spots.find(s => s.id === spotId);
    if (!st.cards.includes(spot.card)) st.cards.push(spot.card);
    return true;
  }

  /* 심판: 맞는 카드면 통과, 틀린 카드는 등불이 꺼지고 그 카드는 다시 못 낸다.
     근거 없음은 둘러보기로 되돌아가 한 곳 더 본다. 어느 곳을 고를지는 운이라 등불을 끄지 않는다. */
  function trialCard(st, nodeId, node, cardId) {
    if (!st.cards.includes(cardId) || (st.dead[nodeId] || []).includes(cardId)) return { type: "blocked" };
    if (node.ok.includes(cardId)) { st.node = node.next; return { type: "pass", next: node.next }; }
    st.dead[nodeId] = (st.dead[nodeId] || []).concat(cardId);
    if (!st.explore) { st.lamps = Math.max(0, st.lamps - 1); st.lampsLost += 1; st.trialMiss = (st.trialMiss || []).concat({ node: nodeId, card: cardId }); }
    return { type: "ask", reply: node.replies[cardId] || "그 사료로는 설명이 안 돼." };
  }
  function trialNoEvidence(st, node) {
    const look = node.rewind;
    st.extraLook[look] = (st.extraLook[look] || 0) + 1;
    st.node = look;
    return { type: "rewind", next: look };
  }

  /* 구출: 같은 반 다른 학생의 학번이어야 한다 */
  function rescueCheck(mySid, friendSid) {
    if (!/^\d{5}$/.test(friendSid)) return { ok: false, msg: "친구 학번 5자리를 넣어 줘." };
    if (friendSid === mySid) return { ok: false, msg: "구출은 다른 친구가 해 줘야 해." };
    if (friendSid.slice(0, 3) !== String(mySid).slice(0, 3)) return { ok: false, msg: "같은 반 친구의 학번을 넣어 줘." };
    return { ok: true };
  }
  /* 등불 1개를 켜고, 지금 사건에서 못 본 사료 카드 1장을 연다(곳 순서대로라 늘 같다) */
  function rescue(st, friendSid, lookNodeId, lookNode) {
    st.lamps = Math.max(st.lamps, 1);
    st.rescues.push({ by: friendSid, node: st.node });
    let card = null;
    if (lookNode) {
      const spot = lookNode.look.spots.find(s => !st.cards.includes(s.card));
      if (spot) {
        st.visited[lookNodeId] = (st.visited[lookNodeId] || []).concat(spot.id);
        st.cards.push(spot.card);
        card = spot.card;
      }
    }
    return card;
  }
  /* 사건 처음부터: 친구를 못 부를 때 쓰는 길. 어떤 경우에도 막히지 않게 등불을 다시 채운다 */
  function restartEvent(st, eventId, ev, nodes) {
    st.lamps = LAMPS;
    st.node = ev.start;
    st.pendingDeath = null;
    Object.keys(nodes).forEach(id => {
      if (!id.startsWith(ev.start.split("_")[0] + "_")) return;
      delete st.dead[id]; delete st.visited[id]; delete st.extraLook[id];
      const n = nodes[id];
      (n.choices || []).forEach(c => (c.flags || []).forEach(f => { delete st.flags[f]; }));
      if (n.look) n.look.spots.forEach(s => { st.cards = st.cards.filter(c => c !== s.card); });
    });
    st.eventDeaths[eventId] = 0;
  }

  /* 제출 요약 */
  function summary(st, eras, deaths) {
    const total = Object.keys(deaths).length;
    return { crossed: st.path.length, lampsLost: st.lampsLost, dex: st.dex.length, dexTotal: total, rescues: st.rescues.length };
  }

  /* 칭호: 수치 대신 보여 주는 성취 */
  function titles(st, deaths) {
    const out = [];
    const slips = Object.keys(deaths).filter(k => deaths[k].kind === "slip");
    if (st.lampsLost === 0) out.push("등불을 하나도 끄지 않고 건넌 사람");
    if (st.rescues.length) out.push("친구 덕에 다시 일어선 사람");
    if (slips.length && slips.every(k => st.dex.includes(k))) out.push("어긋난 죽음을 모두 본 사람");
    return out;
  }

  /* 다시 볼 것(엔딩 복기): 어긋난 죽음과 심판에서 틀린 사료만, 처음 겪은 순서대로 한 번씩.
     역사 속 죽음은 실수가 아니라 넣지 않는다. 자유 탐험은 임시 상태라 여기 안 잡힌다. */
  function reviewList(st, deaths, cards, nodes) {
    const out = [], seen = {};
    st.deathLog.forEach(d => {
      const x = deaths[d.id];
      if (!x || x.kind !== "slip" || seen["d:" + d.id]) return;
      seen["d:" + d.id] = true;
      out.push({ kind: "slip", era: x.era, title: x.title, why: x.why, p: x.p });
    });
    (st.trialMiss || []).forEach(m => {
      const c = cards[m.card], n = nodes[m.node];
      if (!c || !n || seen["t:" + m.node + m.card]) return;
      seen["t:" + m.node + m.card] = true;
      out.push({ kind: "trial", era: Number(String(m.node)[0]) || 0, title: c.title, why: (n.replies && n.replies[m.card]) || "그 사료로는 설명이 안 돼.", p: c.p });
    });
    return out.map((x, i) => [x, i]).sort((a, b) => (a[0].era - b[0].era) || (a[1] - b[1])).map(a => a[0]); // 시대 순서대로
  }

  return { LAMPS, hash, shuffled, newState, flowOf, addDex, showWhisper, choose, recordPath, lookLimit, canVisit, visit, trialCard, trialNoEvidence, rescueCheck, rescue, restartEvent, summary, titles, reviewList };
})();
