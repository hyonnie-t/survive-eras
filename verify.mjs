#!/usr/bin/env node
// verify.mjs — 데이터 검사. 사용: node verify.mjs [교과서 쪽별 텍스트 경로]
// 통과하면 종료 코드 0. 교과서 경로를 주면 SOURCES의 말이 그 쪽 원문에 있는지도 맞춰 본다.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'data.js'), 'utf8') + '\n;globalThis.D={SOURCES,SPEAKERS,CARDS,DEATHS,EVENTS,NODES,ERAS,GLOSSARY};', ctx);
const { SOURCES, SPEAKERS, CARDS, DEATHS, EVENTS, NODES, ERAS, GLOSSARY } = ctx.D;

const errs = [];
const err = (no, m) => errs.push(`[${no}] ${m}`);
const len = s => String(s).replace(/\s/g, '').length;
const eachLine = fn => {
  Object.entries(NODES).forEach(([id, n]) => {
    (n.lines || []).forEach(l => fn(l, id));
    (n.pass || []).forEach(l => fn(l, id));
    (n.choices || []).forEach(c => (c.then || []).forEach(l => fn(l, id)));
  });
};

// 1. next·ending 참조
const okNext = id => id === 'END' || NODES[id];
Object.entries(NODES).forEach(([id, n]) => {
  if (n.next && !okNext(n.next)) err(1, `${id}.next → 없는 노드 ${n.next}`);
  if (n.rewind && !NODES[n.rewind]) err(1, `${id}.rewind → 없는 노드 ${n.rewind}`);
  (n.choices || []).forEach(c => {
    if (c.death && !DEATHS[c.death]) err(1, `${id}/${c.id} → 없는 죽음 ${c.death}`);
    const slip = c.death && DEATHS[c.death] && DEATHS[c.death].kind === 'slip';
    if (!slip && !okNext(c.next)) err(1, `${id}/${c.id}.next → ${c.next}`);
    if (slip && c.next) err(1, `${id}/${c.id}: 어긋난 죽음에는 next를 두지 않는다`);
  });
  (n.look ? n.look.spots : []).forEach(s => { if (!CARDS[s.card]) err(1, `${id}/${s.id} → 없는 카드 ${s.card}`); });
});

// 2. 도달 가능: 사건 시작에서 닿지 않는 노드 0, 사건마다 END에 닿음
const seen = new Set();
Object.entries(EVENTS).forEach(([eid, ev]) => {
  if (!NODES[ev.start]) { err(2, `사건 ${eid} 시작 ${ev.start} 없음`); return; }
  const stack = [ev.start]; let end = false; const mine = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (id === 'END') { end = true; continue; }
    if (mine.has(id)) continue;
    mine.add(id); seen.add(id);
    const n = NODES[id];
    if (n.next) stack.push(n.next);
    (n.choices || []).forEach(c => { if (c.next) stack.push(c.next); });
  }
  if (!end) err(2, `사건 ${eid}: END에 닿지 않음`);
});
Object.keys(NODES).forEach(id => { if (!seen.has(id)) err(2, `닿지 않는 노드 ${id}`); });

// 3. 시대 진행표: 모든 사건이 한 번씩, 공통 2개 이상
const inFlow = ERAS.flatMap(e => e.flow.filter(f => typeof f === 'string'));
Object.keys(EVENTS).forEach(e => { if (inFlow.filter(x => x === e).length !== 1) err(3, `사건 ${e}가 진행표에 ${inFlow.filter(x => x === e).length}번`); });
ERAS.forEach(e => {
  if (e.flow.filter(f => f.essay).length !== 1) err(3, `시대 ${e.id}: 서술형 1개가 아님`);
  if (e.flow.filter(f => typeof f === 'string' && EVENTS[f].tier === '공통').length !== 2) err(3, `시대 ${e.id}: 공통 사건 2개가 아님`);
});

// 4. 사실 줄 출처: 모든 줄은 src 또는 creative, src는 SOURCES에 있어야
eachLine((l, id) => {
  const o = l[2] || {};
  if (!o.src && !o.creative) err(4, `${id}: 출처도 창작 표시도 없는 줄 «${l[1].slice(0, 20)}»`);
  if (o.src && !SOURCES[o.src]) err(4, `${id}: 없는 출처 ${o.src}`);
  if (l[0] && !SPEAKERS[l[0]]) err(4, `${id}: 없는 화자 ${l[0]}`);
});
[...Object.values(CARDS), ...Object.values(DEATHS), ...Object.values(EVENTS).map(e => e.real)].forEach(x => {
  if (!x.src || !SOURCES[x.src]) err(4, `출처 없음: ${x.title || x.lines && x.lines[0]}`);
  if (!x.p) err(4, `쪽수 없음: ${x.title || x.lines && x.lines[0]}`);
});

// 5. 심판: 근거 카드가 그 사건 둘러보기에서 나오고, 기본 선택지가 있어 막히지 않음
Object.entries(NODES).filter(([, n]) => n.trial).forEach(([id, n]) => {
  if (!n.fallback || !n.fallback.t) err(5, `${id}: 근거 없음 선택지 없음`);
  const look = NODES[n.rewind];
  if (!look || !look.look) { err(5, `${id}: rewind가 둘러보기가 아님`); return; }
  const cards = look.look.spots.map(s => s.card);
  n.ok.forEach(c => { if (!cards.includes(c)) err(5, `${id}: 맞는 카드 ${c}가 둘러보기에 없음`); });
  cards.filter(c => !n.ok.includes(c)).forEach(c => { if (!n.replies[c]) err(5, `${id}: ${c} 되묻기 문장 없음`); });
});

// 6. 학생 화면 금지 라벨
const screen = ['data.js', 'app.js', 'logic.js', 'index.html'].filter(f => fs.existsSync(path.join(dir, f))).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
const noComment = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
screen.forEach(([f, s]) => {
  ['검수', '원문 대조', '대조 전', '미확인', '[2차]', '(2차)', '확인 전'].forEach(w => { if (noComment(s).includes(w)) err(6, `${f}: 금지 라벨 «${w}»`); });
});

// 7. 무작위 판정 금지, 원작 문자열 금지
screen.forEach(([f, s]) => {
  if (noComment(s).includes('Math.random')) err(7, `${f}: Math.random`);
  ['장연화', '막례', '윤귀인', '장씨궁중록', '기숙사'].forEach(w => { if (noComment(s).includes(w)) err(7, `${f}: «${w}»`); });
});

// 8. 갈림길: 사는 길 1개 이상, 글자 수 차이 작게, 어긋난 죽음이 있으면 귓속말
const GAP = 12;
Object.entries(NODES).filter(([, n]) => n.choices).forEach(([id, n]) => {
  const alive = n.choices.filter(c => !(c.death && DEATHS[c.death].kind === 'slip'));
  const slips = n.choices.filter(c => c.death && DEATHS[c.death].kind === 'slip');
  if (!alive.length) err(8, `${id}: 사는 길 없음`);
  if (slips.length && !n.whisper) err(8, `${id}: 귓속말 없음`);
  const ls = n.choices.map(c => len(c.t));
  if (Math.max(...ls) - Math.min(...ls) > GAP) err(8, `${id}: 글자 수 차이 ${Math.max(...ls) - Math.min(...ls)} (${ls.join(',')})`);
  if (!n.q) err(8, `${id}: 질문 없음`);
});

// 9. 죽음: 모두 쓰이고, 사건·단서·설명 있음. 단서·제목에 답이 드러나지 않게 설명보다 짧게
const used = new Set(Object.values(NODES).flatMap(n => (n.choices || []).map(c => c.death).filter(Boolean)));
Object.entries(DEATHS).forEach(([k, d]) => {
  if (!used.has(k)) err(9, `안 쓰는 죽음 ${k}`);
  if (!d.clue || !d.why || !d.title) err(9, `${k}: 빈 칸`);
  if (!EVENTS[d.event] || EVENTS[d.event].era !== d.era) err(9, `${k}: 사건·시대가 어긋남`);
});
const start = Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [e.start.split('_')[0], k]));
Object.entries(NODES).forEach(([id, n]) => (n.choices || []).forEach(c => {
  if (c.death && DEATHS[c.death].event !== start[id.split('_')[0]]) err(9, `${id}: 죽음 ${c.death}의 사건이 다름`);
}));

// 10. 교과서 원문 대조(경로를 줄 때만)
const book = process.argv[2];
let matched = 0;
if (book) {
  const pages = {}; let p = 0;
  fs.readFileSync(book, 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^===== p\.(\d+) /);
    if (m) { p = +m[1]; pages[p] = ''; return; }
    if (p && !/^\s*\d{1,2}\s*$/.test(l) && !/^\s*[➊-➓]\s*$/.test(l)) pages[p] += l;
  });
  Object.keys(pages).forEach(k => { pages[k] = pages[k].replace(/\s/g, ''); });
  Object.values(SOURCES).forEach(s => s.q.forEach(q => {
    if ((pages[s.p] || '').includes(q)) matched++; else err(10, `${s.p}쪽 원문에 없음: ${q}`);
  }));
}

const nCh = Object.values(NODES).flatMap(n => n.choices || []);
let lines = 0; eachLine(() => { lines++; });
console.log(`사건 ${Object.keys(EVENTS).length} / 노드 ${Object.keys(NODES).length} / 대사 ${lines}줄 / 선택지 ${nCh.length}개 / 사료 카드 ${Object.keys(CARDS).length}장 / 죽음 ${Object.keys(DEATHS).length}종 / 낱말 ${Object.keys(GLOSSARY).length}개`);
if (book) console.log(`교과서 원문 일치 ${matched}건`);
if (errs.length) { console.log('실패 ' + errs.length + '건'); errs.forEach(e => console.log(' ' + e)); process.exit(1); }
console.log('통과');
