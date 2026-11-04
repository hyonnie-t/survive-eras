// 판정 로직 테스트. 사용: node tests/logic.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'data.js'), 'utf8') + '\n' + fs.readFileSync(path.join(dir, 'logic.js'), 'utf8') + '\n;globalThis.X={Logic,NODES,DEATHS,EVENTS,ERAS};', ctx);
const { Logic, NODES, DEATHS, EVENTS, ERAS } = ctx.X;
const fresh = () => JSON.parse(JSON.stringify(Logic.newState())); // 저장·불러오기를 흉내 낸다
const reload = st => JSON.parse(JSON.stringify(st));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const alive = c => !(c.death && DEATHS[c.death].kind === 'slip');
const forks = Object.entries(NODES).filter(([, x]) => x.choices);

t('같은 학번·같은 노드면 순서가 늘 같다', () => {
  const a = Logic.shuffled(NODES['1a_fork'].choices, '30512' + '1a_fork').map(c => c.id);
  const b = Logic.shuffled(NODES['1a_fork'].choices, '30512' + '1a_fork').map(c => c.id);
  assert.deepStrictEqual([...a], [...b]);
});
t('섞기는 원본을 바꾸지 않고 항목을 잃지 않는다', () => {
  const orig = NODES['1a_fork'].choices.map(c => c.id).join();
  const s = Logic.shuffled(NODES['1a_fork'].choices, 'x');
  assert.strictEqual(NODES['1a_fork'].choices.map(c => c.id).join(), orig);
  assert.strictEqual(s.map(c => c.id).sort().join(), orig.split(',').sort().join());
});
t('1번만 눌러서는 못 건넌다: 학생 100명 평균, 1번이 사는 길인 비율이 전체 사는 길 비율 근처', () => {
  let hit = 0, tot = 0, base = 0;
  for (let s = 0; s < 100; s++) {
    const sid = '305' + String(s).padStart(2, '0');
    forks.forEach(([id, f]) => {
      const first = Logic.shuffled(f.choices, sid + id)[0];
      tot++; if (alive(first)) hit++;
      base += f.choices.filter(alive).length / f.choices.length;
    });
  }
  const rate = hit / tot, expect = base / tot;
  assert.ok(Math.abs(rate - expect) < 0.1, `1번 생존 ${rate.toFixed(2)} / 기대 ${expect.toFixed(2)}`);
  assert.ok(rate < 0.85, '1번이 거의 늘 사는 길이면 안 된다');
});
t('짝과 번호를 그대로 베낄 수 없다: 학생마다 순서가 다르다', () => {
  const order = sid => forks.map(([id, f]) => Logic.shuffled(f.choices, sid + id).map(c => c.id).join()).join('|');
  assert.notStrictEqual(order('30512'), order('30513'));
});
t('모든 갈림길: 사는 길이 항상 있다', () => {
  forks.forEach(([id, f]) => assert.ok(f.choices.some(alive), id));
});
t('어긋난 죽음: 등불이 꺼지고 같은 갈림길에 남는다, 도감에 들어간다', () => {
  const st = fresh(); st.node = '1a_fork';
  const r = Logic.choose(st, '1a_fork', NODES['1a_fork'], 'iron', DEATHS, '1A');
  assert.strictEqual(r.type, 'slip'); assert.strictEqual(st.lamps, 2); assert.strictEqual(st.node, '1a_fork');
  assert.ok(st.dex.includes('d_iron')); assert.strictEqual(st.pendingDeath, 'd_iron'); assert.strictEqual(st.path.length, 0);
});
t('같은 죽음은 다시 고를 수 없고 등불도 다시 안 꺼진다', () => {
  const st = fresh(); st.node = '1a_fork';
  Logic.choose(st, '1a_fork', NODES['1a_fork'], 'iron', DEATHS, '1A');
  const r = Logic.choose(st, '1a_fork', NODES['1a_fork'], 'iron', DEATHS, '1A');
  assert.strictEqual(r.type, 'blocked'); assert.strictEqual(st.lamps, 2);
});
t('[재현 버그] 죽은 뒤 새로고침해도 죽음·등불이 그대로다', () => {
  let st = fresh(); st.node = '1a_fork';
  Logic.choose(st, '1a_fork', NODES['1a_fork'], 'iron', DEATHS, '1A');
  st = reload(st);
  assert.strictEqual(st.pendingDeath, 'd_iron'); assert.strictEqual(st.lamps, 2);
  assert.ok(st.dead['1a_fork'].includes('iron'));
});
t('[재현 버그] 같은 갈림길을 다시 지나도 지나온 길이 불어나지 않는다', () => {
  let st = fresh(); st.node = '1a_fork';
  Logic.choose(st, '1a_fork', NODES['1a_fork'], 'farm', DEATHS, '1A');
  st = reload(st); st.node = '1a_fork';
  Logic.choose(st, '1a_fork', NODES['1a_fork'], 'hunt', DEATHS, '1A');
  assert.strictEqual(st.path.length, 1); assert.strictEqual(st.path[0].pick, 'hunt');
});
t('역사 속 죽음: 등불은 그대로, 도감에 들어가고 다음으로 건너간다', () => {
  const st = fresh(); st.node = '3b_fork2';
  const r = Logic.choose(st, '3b_fork2', NODES['3b_fork2'], 'rise', DEATHS, '3B');
  assert.strictEqual(r.type, 'memory'); assert.strictEqual(st.lamps, 3); assert.ok(st.dex.includes('m_ugeumchi'));
  assert.strictEqual(st.node, 'END'); assert.strictEqual(st.path.length, 1);
});
t('둘러보기: 2곳까지만, 다시 못 간다', () => {
  const st = fresh(), n = NODES['1b_look'];
  assert.ok(Logic.visit(st, '1b_look', n, 'scout')); assert.ok(!Logic.visit(st, '1b_look', n, 'scout'));
  assert.ok(Logic.visit(st, '1b_look', n, 'wall')); assert.ok(!Logic.visit(st, '1b_look', n, 'tent'));
  assert.deepStrictEqual([...st.cards].sort(), ['c_liaodong', 'c_tired'].sort());
});
t('심판: 맞는 카드 통과, 틀린 카드는 등불 꺼짐·다시 못 냄, 안 가진 카드는 막힘', () => {
  const st = fresh(), n = NODES['1b_trial']; st.cards = ['c_poem', 'c_tired'];
  assert.strictEqual(Logic.trialCard(st, '1b_trial', n, 'c_liaodong').type, 'blocked');
  const a = Logic.trialCard(st, '1b_trial', n, 'c_poem'); assert.strictEqual(a.type, 'ask'); assert.strictEqual(st.lamps, 2);
  assert.strictEqual(Logic.trialCard(st, '1b_trial', n, 'c_poem').type, 'blocked'); assert.strictEqual(st.lamps, 2);
  assert.strictEqual(Logic.trialCard(st, '1b_trial', n, 'c_tired').type, 'pass'); assert.strictEqual(st.node, '1b_fork2');
});
t('심판 근거 없음: 등불은 그대로, 둘러보기로 되감아 한 곳 더 열림', () => {
  const st = fresh(), n = NODES['1b_trial'], lk = NODES['1b_look'];
  Logic.visit(st, '1b_look', lk, 'wall'); Logic.visit(st, '1b_look', lk, 'tent');
  Logic.trialNoEvidence(st, n);
  assert.strictEqual(st.lamps, 3); assert.strictEqual(st.node, '1b_look');
  assert.ok(Logic.visit(st, '1b_look', lk, 'scout')); assert.ok(st.cards.includes('c_tired'));
});
t('모든 심판: 2곳만 골라 맞는 카드를 못 얻어도 근거 없음 → 되감기로 반드시 얻을 수 있다', () => {
  Object.entries(NODES).filter(([, x]) => x.trial).forEach(([id, n]) => {
    const look = NODES[n.rewind], spots = look.look.spots;
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      const st = fresh();
      Logic.visit(st, n.rewind, look, spots[i].id); Logic.visit(st, n.rewind, look, spots[j].id);
      if (!n.ok.some(c => st.cards.includes(c))) {
        Logic.trialNoEvidence(st, n);
        const rest = spots.find(s => !(st.visited[n.rewind] || []).includes(s.id));
        assert.ok(Logic.visit(st, n.rewind, look, rest.id), id);
      }
      assert.ok(n.ok.some(c => st.cards.includes(c)), id + ' 맞는 카드를 못 얻음');
    }
  });
});
t('구출: 같은 반 다른 학생만, 등불 1개와 못 본 카드 1장', () => {
  assert.ok(!Logic.rescueCheck('30512', '30512').ok);
  assert.ok(!Logic.rescueCheck('30512', '30612').ok);
  assert.ok(!Logic.rescueCheck('30512', '123').ok);
  assert.ok(Logic.rescueCheck('30512', '30513').ok);
  const st = fresh(), lk = NODES['1b_look']; st.lamps = 0; st.cards = ['c_liaodong'];
  const c = Logic.rescue(st, '30513', '1b_look', lk);
  assert.strictEqual(st.lamps, 1); assert.ok(c && st.cards.includes(c) && c !== 'c_liaodong'); assert.strictEqual(st.rescues.length, 1);
});
t('사건 처음부터: 등불이 3개로 차고, 그 사건 기록만 지워진다', () => {
  const st = fresh(); st.node = '1a_fork'; st.lamps = 0; st.cards = ['c_river', 'c_tired'];
  st.dead['1a_fork'] = ['iron']; st.visited['1a_look'] = ['river']; st.dead['1b_fork1'] = ['tang'];
  Logic.restartEvent(st, '1A', EVENTS['1A'], NODES);
  assert.strictEqual(st.lamps, 3); assert.strictEqual(st.node, '1a_open');
  assert.ok(!st.dead['1a_fork']); assert.ok(st.dead['1b_fork1']); assert.ok(st.cards.includes('c_tired')); assert.ok(!st.cards.includes('c_river'));
});
t('귓속말: 이 갈림길에서 죽은 뒤, 죽는 길이 남았을 때만', () => {
  const st = fresh(), n = NODES['1a_fork']; st.node = '1a_fork';
  assert.strictEqual(Logic.showWhisper(st, '1a_fork', n, DEATHS), false);
  Logic.choose(st, '1a_fork', n, 'iron', DEATHS, '1A');
  assert.strictEqual(Logic.showWhisper(st, '1a_fork', n, DEATHS), true);
  Logic.choose(st, '1a_fork', n, 'king', DEATHS, '1A');
  assert.strictEqual(Logic.showWhisper(st, '1a_fork', n, DEATHS), false);
});
t('[검토 재현] 근거 없음을 몇 번 눌러도 둘러보기가 막히지 않는다', () => {
  Object.entries(NODES).filter(([, x]) => x.trial).forEach(([id, n]) => {
    const st = fresh(), lk = NODES[n.rewind];
    for (let k = 0; k < 5; k++) {
      Logic.trialNoEvidence(st, n);
      lk.look.spots.forEach(s => Logic.visit(st, n.rewind, lk, s.id));
      const v = st.visited[n.rewind] || [];
      assert.ok(Logic.lookLimit(st, n.rewind, lk) - v.length <= 0, id + ' 다음 버튼이 숨는다');
    }
  });
});
t('[검토 재현] 같은 갈림길을 다시 고르면 앞 선택 표시가 지워진다', () => {
  const st = fresh(), n = NODES['3b_fork1']; st.node = '3b_fork1';
  Logic.choose(st, '3b_fork1', n, 'jip', DEATHS, '3B');
  st.node = '3b_fork1';
  Logic.choose(st, '3b_fork1', n, 'home', DEATHS, '3B');
  assert.ok(st.flags.home && !st.flags.jip);
});
t('자유 탐험: 등불이 줄지 않고 지나온 길도 안 바뀐다', () => {
  const st = fresh(); st.explore = true; st.node = '1a_fork';
  Logic.choose(st, '1a_fork', NODES['1a_fork'], 'iron', DEATHS, '1A');
  Logic.choose(st, '1a_fork', NODES['1a_fork'], 'farm', DEATHS, '1A');
  assert.strictEqual(st.lamps, 3); assert.strictEqual(st.path.length, 0);
});
t('모드: 공통은 시대당 사건 2개, 유연은 3개', () => {
  ERAS.forEach(e => {
    assert.strictEqual(Logic.flowOf(e, EVENTS, 2).filter(f => typeof f === 'string').length, 2, e.name);
    assert.strictEqual(Logic.flowOf(e, EVENTS, 3).filter(f => typeof f === 'string').length, 3, e.name);
  });
});
console.log('통과 ' + n + '건');
