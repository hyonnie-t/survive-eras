// 엔딩 «다시 볼 것» 목록(reviewList)과 심판 오답 기록(trialMiss) 테스트. 사용: node tests/review.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'data.js'), 'utf8') + '\n' + fs.readFileSync(path.join(dir, 'logic.js'), 'utf8') + '\n;globalThis.X={Logic,NODES,DEATHS,CARDS};', ctx);
const { Logic, NODES, DEATHS, CARDS } = ctx.X;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

const slipKey = Object.keys(DEATHS).find(k => DEATHS[k].kind === 'slip');
const memKey = Object.keys(DEATHS).find(k => DEATHS[k].kind === 'memory');
const trials = Object.keys(NODES).filter(k => NODES[k].trial);

t('어긋난 죽음은 한 번만, 역사 속 죽음은 빠진다', () => {
  const st = Logic.newState();
  st.deathLog.push({ id: slipKey, node: 'x' }, { id: slipKey, node: 'x' }, { id: memKey, node: 'y' });
  const r = Logic.reviewList(st, DEATHS, CARDS, NODES);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].kind, 'slip');
  assert.strictEqual(r[0].title, DEATHS[slipKey].title);
  assert.strictEqual(r[0].p, DEATHS[slipKey].p);
});

t('모든 심판의 모든 틀린 사료가 복기에 사료 제목·까닭·쪽수로 남는다', () => {
  assert.ok(trials.length > 0);
  trials.forEach(id => {
    const tn = NODES[id];
    const look = NODES[tn.rewind].look.spots.map(s => s.card);
    look.filter(c => !tn.ok.includes(c)).forEach(wrong => {
      const st = Logic.newState(); st.cards = look.slice();
      const res = Logic.trialCard(st, id, tn, wrong);
      assert.strictEqual(res.type, 'ask');
      Logic.trialCard(st, id, tn, wrong); // 다시 누르면 blocked
      assert.strictEqual(st.trialMiss.length, 1);
      const r = Logic.reviewList(st, DEATHS, CARDS, NODES);
      assert.strictEqual(r.length, 1);
      assert.strictEqual(r[0].kind, 'trial');
      assert.strictEqual(r[0].title, CARDS[wrong].title);
      assert.strictEqual(r[0].p, CARDS[wrong].p);
      assert.strictEqual(r[0].why, tn.replies[wrong] || '그 사료로는 설명이 안 돼.');
    });
  });
});

t('사건 처음부터 해도 심판 오답 기록은 남는다', () => {
  const id = trials[0], tn = NODES[id];
  const look = NODES[tn.rewind].look.spots.map(s => s.card);
  const wrong = look.find(c => !tn.ok.includes(c));
  const st = Logic.newState(); st.cards = look.slice();
  Logic.trialCard(st, id, tn, wrong);
  const prefix = id.split('_')[0];
  const ev = { start: prefix + '_open' };
  Logic.restartEvent(st, 'E', ev, NODES);
  assert.strictEqual(Logic.reviewList(st, DEATHS, CARDS, NODES).length, 1);
});

t('자유 탐험의 오답은 복기에 안 남는다', () => {
  const id = trials[0], tn = NODES[id];
  const look = NODES[tn.rewind].look.spots.map(s => s.card);
  const wrong = look.find(c => !tn.ok.includes(c));
  const st = Logic.newState(); st.explore = true; st.cards = look.slice();
  Logic.trialCard(st, id, tn, wrong);
  assert.strictEqual(st.trialMiss.length, 0);
});

t('복기는 시대 순서대로(심판 오답이 그 시대 죽음 사이에 들어감)', () => {
  const st = Logic.newState();
  const s1 = Object.keys(DEATHS).find(k => DEATHS[k].kind === 'slip' && DEATHS[k].era === 1);
  const s3 = Object.keys(DEATHS).find(k => DEATHS[k].kind === 'slip' && DEATHS[k].era === 3);
  st.deathLog.push({ id: s1, node: 'a' }, { id: s3, node: 'b' });
  const id = trials.find(k => k[0] === '2') || trials[0], tn = NODES[id];
  const wrong = NODES[tn.rewind].look.spots.map(s => s.card).find(c => !tn.ok.includes(c));
  st.trialMiss.push({ node: id, card: wrong });
  const eras = Logic.reviewList(st, DEATHS, CARDS, NODES).map(x => x.era);
  assert.deepStrictEqual([...eras], [...eras].sort((a, b) => a - b));
});

t('trialMiss가 없는 예전 저장본도 깨지지 않는다', () => {
  const old = JSON.parse(JSON.stringify(Logic.newState())); delete old.trialMiss;
  assert.strictEqual(Logic.reviewList(old, DEATHS, CARDS, NODES).length, 0);
});

console.log('통과', n);
