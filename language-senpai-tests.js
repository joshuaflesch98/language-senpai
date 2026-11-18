/*
 * Language Senpai — automated checks (489 at V24.3)
 * ------------------------------------------------
 * What this is: a script that opens the app in an invisible browser and uses it like a person would —
 * typing answers, building sentences, quitting drills, pasting AI answers, corrupting a save on purpose —
 * and checks after every step that the app did the right thing. Run it before handing over every new version:
 * if an old feature silently broke, a check fails and says which one.
 *
 * How to run (for a developer): needs Node.js and Playwright (npm i playwright; npx playwright install chromium).
 * Point FILE below at the app's HTML file, then: node language-senpai-tests.js  → prints PASS/FAIL per check and a total.
 * It takes about five minutes. Where a single command is time-limited, run it detached:
 *   setsid nohup node language-senpai-tests.js > tests.log 2>&1 < /dev/null &   — then read tests.log.
 * When a version changes behaviour on purpose, update the matching check in the same step.
 */
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.env.APP || './index.html');
const KEY = 'language_senpai_v1';

let pass = 0, fail = 0; const failures = [];
function ok(cond, name) { if (cond) { pass++; console.log('  PASS', name); } else { fail++; failures.push(name); console.log('  FAIL', name); } }

function word(nl, de, extra = {}) { return Object.assign({ nl, de, everSeen: true, mastered: false, streak: 0, misses: 0, days: [] }, extra); }
function state(lists, settings = {}) {
  return {
    lists, activeListId: null, view: 'library', groupOrder: { learn: [], learned: [] }, collapsed: {}, lastExport: Date.now(), welcomed: true,
    settings: Object.assign({ typeDutch: true, typoTolerance: false, strictSpelling: false, accentChars: '', timeMatters: false, slipResets: true, retypeOnError: true }, settings)
  };
}
function list(name, words) { return { id: 'l' + Math.random().toString(36).slice(2, 8), name, group: '', folder: 'learn', completions: [], words }; }
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

const errors = [];
async function fresh(browser, st, viewport = { width: 900, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|403|ERR_|net::/i.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(FILE);
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, st]);
  await page.reload();
  await page.waitForTimeout(250);
  return { ctx, page };
}
const getS = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const term = async page => (await page.textContent('.term')).trim();
const fb = async page => (await page.textContent('#fb')).replace(/\s+/g, ' ').trim();
const cardCls = page => page.getAttribute('#card', 'class');
async function typeEnter(page, v) { await page.fill('#ans', v); await page.press('#ans', 'Enter'); await page.waitForTimeout(120); }
async function answerCorrect(page, map) { const t = await term(page); const a = map[t]; if (!a) throw new Error('no answer for ' + t); await typeEnter(page, a); await page.waitForTimeout(750); }
const dotCount = page => page.$$eval('.dots .dot', d => d.length);
async function headSum(page) { const t = await page.textContent('.progress .head .k'); return (t.match(/\d+/g) || []).map(Number).reduce((a, b) => a + b, 0); }

(async () => {
  const browser = await chromium.launch();

  // ---------------- 1. teal after a wrong answer ----------------
  console.log('\n[1] Teal while correcting a miss');
  {
    const { ctx, page } = await fresh(browser, state([list('Teal test', [word('dichtbij [nabij] [vlakbij]', 'nahe')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await term(page) === 'nahe', 'card prompts "nahe"');
    await typeEnter(page, 'xyz');
    let f = await fb(page);
    ok(/Not quite/.test(f) && /dichtbij/.test(f), 'wrong answer shows "Not quite → dichtbij"');
    ok((await cardCls(page)).includes('flash-bad'), 'card is red after the miss');
    ok((await getS(page)).lists[0].words[0].misses === 1, 'the miss is one strike');
    await typeEnter(page, 'nabij');
    f = await fb(page);
    ok(/“nabij” is also a valid translation/.test(f), 'alternative during correction → teal message');
    ok(/dichtbij/.test(f) && !/Not quite/.test(f), 'target word still shown, "Not quite" gone');
    ok(!!(await page.$('#fb .teal')), 'message is styled teal');
    let cls = await cardCls(page);
    ok(cls.includes('flash-teal') && !cls.includes('flash-bad'), 'card border switches red → teal');
    ok((await getS(page)).lists[0].words[0].misses === 1, 'alternative adds NO extra strike');
    ok(await page.inputValue('#ans') === '' && !(await page.$eval('#ans', i => i.readOnly)), 'input cleared and still typeable');
    await typeEnter(page, 'qqq');
    f = await fb(page); cls = await cardCls(page);
    ok(/Not quite/.test(f) && cls.includes('flash-bad') && !cls.includes('flash-teal'), 'nonsense after teal → back to red "Not quite"');
    ok((await getS(page)).lists[0].words[0].misses === 1, 'still only one strike (retype never adds strikes)');
    await typeEnter(page, 'vlakbij');
    ok(/“vlakbij” is also a valid translation/.test(await fb(page)), 'second alternative also recognised');
    await typeEnter(page, 'dichtbij');
    await page.waitForTimeout(200);
    ok(!(await page.$eval('#fb', e => e.classList.contains('show'))), 'typing the target advances to a fresh card');
    ok((await getS(page)).lists[0].words[0].misses === 1, 'final tally: exactly one strike');
    await typeEnter(page, 'nabij');
    ok(/is a valid translation — but this card is drilling a different word/.test(await fb(page)), 'regression: normal-phase teal unchanged');
    await ctx.close();
  }

  {
    // pre-existing blink: the card must stay visible during/after the shake, and the shake must still play
    const { ctx, page } = await fresh(browser, state([list('Blink', [word('dichtbij', 'nahe'), word('huis', 'Haus')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(1000);
    const r = await page.evaluate(async () => {
      const i = document.getElementById('ans'); i.value = 'xyz'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const card = document.getElementById('card');
      const running = card.getAnimations().filter(a => a.playState === 'running').length;
      let minOp = 1; for (let k = 0; k < 16; k++) { minOp = Math.min(minOp, parseFloat(getComputedStyle(card).opacity)); await new Promise(res => setTimeout(res, 50)); }
      i.value = 'nope'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const running2 = card.getAnimations().filter(a => a.playState === 'running').length;
      let minOp2 = 1; for (let k = 0; k < 16; k++) { minOp2 = Math.min(minOp2, parseFloat(getComputedStyle(card).opacity)); await new Promise(res => setTimeout(res, 50)); }
      return { running, minOp, running2, minOp2 };
    });
    ok(r.running > 0 && r.running2 > 0, 'shake still plays on a miss and on a wrong retype');
    ok(r.minOp > 0.99 && r.minOp2 > 0.99, 'card never fades out after a miss (was invisible ~0.5s in V18)');
    await ctx.close();
  }

  // ---------------- 2. edit mid-session ----------------
  console.log('\n[2] Edit the current card mid-session');
  {
    const st = state([list('Edit test', [word('dichtbij [nabij]', 'nahe', { days: ['2026-9-1'], hard: true }), word('huis', 'Haus')])]);
    const { ctx, page } = await fresh(browser, st);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await term(page) === 'nahe', 'starts on "nahe"');
    ok(!!(await page.$('.prompt-meta .rightgrp .dir + #editBtn')), 'pencil sits right of the direction label');
    await typeEnter(page, 'xyz');
    await page.click('#editBtn'); await page.waitForTimeout(150);
    ok(await page.$eval('#cardOverlay', o => o.classList.contains('open')), 'pencil opens the card editor');
    ok(await page.inputValue('#cardWord') === 'dichtbij [nabij]' && await page.inputValue('#cardMeaning') === 'nahe', 'editor prefilled with this card, markup intact');
    ok((await page.textContent('#cardWordNote')) === '(what you type)' && (await page.textContent('#cardMeaningNote')) === '(the prompt)', 'labels say which side is typed / prompted');
    await page.fill('#cardWord', ''); await page.click('#cardSave');
    ok(/Both sides need text/.test(await page.textContent('#cardErr')) && await page.$eval('#cardOverlay', o => o.classList.contains('open')), 'empty side rejected, editor stays open');
    await page.fill('#cardWord', 'a = b'); await page.click('#cardSave');
    ok(/“=”/.test(await page.textContent('#cardErr')), '"=" in the word rejected (would break list round-trip)');
    await page.fill('#cardWord', '[nabij]'); await page.click('#cardSave');
    ok(/main word/.test(await page.textContent('#cardErr')), 'brackets-only side rejected (uncompletable card)');
    await page.fill('#cardWord', 'dichtbij [nabij] [naast]');
    await page.fill('#cardMeaning', 'nahe (bij het station)');
    await page.press('#cardMeaning', 'Enter'); await page.waitForTimeout(250);
    ok(!(await page.$eval('#cardOverlay', o => o.classList.contains('open'))), 'Enter saves and closes');
    ok(await term(page) === 'nahe', 'SAME card after saving');
    ok(/bij het station/.test(await page.textContent('.prompt-hint')), 'new hint visible immediately');
    ok(!(await page.$eval('#fb', e => e.classList.contains('show'))) && await page.inputValue('#ans') === '' && !(await page.$eval('#ans', i => i.readOnly)), 'fresh blank attempt');
    let w = (await getS(page)).lists[0].words[0];
    ok(w.nl === 'dichtbij [nabij] [naast]' && w.de === 'nahe (bij het station)', 'edit saved to storage');
    ok(w.misses === 1, 'strike from before the edit is kept');
    ok(w.hard === true && w.everSeen === true && JSON.stringify(w.days) === '["2026-9-1"]', 'Difficult flag, seen-state and day history preserved');
    await typeEnter(page, 'naast');
    ok(/valid translation/.test(await fb(page)) && (await getS(page)).lists[0].words[0].misses === 1, 'newly added alternative works at once (teal, no strike)');
    await ctx.close();
  }
  {
    // cancel keeps the in-progress state; Escape closes
    const { ctx, page } = await fresh(browser, state([list('Cancel test', [word('dichtbij', 'nahe'), word('huis', 'Haus')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await typeEnter(page, 'xyz');
    await page.click('#editBtn'); await page.click('#cardCancel'); await page.waitForTimeout(100);
    ok(!(await page.$eval('#cardOverlay', o => o.classList.contains('open'))) && /Not quite/.test(await fb(page)), 'Cancel closes and leaves the correction on screen');
    await page.click('#editBtn'); await page.press('#cardWord', 'Escape'); await page.waitForTimeout(100);
    ok(!(await page.$eval('#cardOverlay', o => o.classList.contains('open'))), 'Escape closes the editor');
    await page.click('#editBtn'); await page.mouse.click(10, 10); await page.waitForTimeout(100);
    ok(!(await page.$eval('#cardOverlay', o => o.classList.contains('open'))), 'clicking the backdrop closes without saving');
    ok((await getS(page)).lists[0].words[0].nl === 'dichtbij', 'cancelled edits are not saved');
    await typeEnter(page, 'dichtbij'); await page.waitForTimeout(150);
    ok(!/Not quite|Correct|Almost/.test(await fb(page)), 'retype still works after cancelling');   // V24.2: the next card may show the previous word
    await ctx.close();
  }
  {
    // auto-advance must not fire underneath the open editor
    const { ctx, page } = await fresh(browser, state([list('Timer test', [word('dichtbij', 'nahe'), word('huis', 'Haus')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    const t0 = await term(page);
    await page.fill('#ans', t0 === 'nahe' ? 'dichtbij' : 'huis'); await page.press('#ans', 'Enter');
    await page.$eval('#editBtn', b => b.click());   // immediate, inside the 700ms auto-advance window
    await page.waitForTimeout(1200);
    ok(await page.$eval('#cardOverlay', o => o.classList.contains('open')) && await term(page) === t0, 'correct answer + edit: card does not advance under the editor');
    await page.click('#cardCancel'); await page.waitForTimeout(100);
    ok((await page.textContent('#go')).includes('Next'), 'after cancelling, "Next" is waiting');
    await page.press('#ans', 'Enter'); await page.waitForTimeout(200);
    ok(!/Not quite|Correct|Almost/.test(await fb(page)) && await term(page) !== t0, 'Enter continues to the next card');   // V24.2: the previous word may wait in the box
    await ctx.close();
  }
  {
    // retype OFF: edit from the revealed-miss state also gives a fresh attempt
    const { ctx, page } = await fresh(browser, state([list('NoRetype', [word('dichtbij', 'nahe'), word('huis', 'Haus')])], { retypeOnError: false }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    const t0 = await term(page);
    await typeEnter(page, 'xyz');
    ok(await page.$eval('#ans', i => i.readOnly), 'retype off: miss locks the input');
    await page.click('#editBtn'); await page.click('#cardSave'); await page.waitForTimeout(200);
    ok(await term(page) === t0 && !(await page.$eval('#ans', i => i.readOnly)), 'retype off: save gives the same card, typeable again');
    await ctx.close();
  }
  {
    // editing inside a Difficult drill writes through to the home list
    const ws = [word('boom', 'Baum', { hard: true }), word('fiets', 'Fahrrad', { hard: true }), word('kaas', 'Käse', { hard: true })];
    const { ctx, page } = await fresh(browser, state([list('Home list', ws)]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    const t0 = await term(page);
    await page.click('#editBtn');
    await page.fill('#cardMeaning', t0 + ' (edited in drill)');
    await page.click('#cardSave'); await page.waitForTimeout(200);
    const home = (await getS(page)).lists[0].words.find(x => x.de.startsWith(t0));
    ok(home && home.de === t0 + ' (edited in drill)', 'drill edit lands on the word in its home list');
    ok(/edited in drill/.test(await page.textContent('.prompt-hint')), 'drill card shows the new hint');
    await ctx.close();
  }

  // ---------------- 3. dots update live ----------------
  console.log('\n[3] Progress dots update when a word is unmarked');
  {
    const ws = ['een', 'twee', 'drie', 'vier', 'vijf', 'zes'].map((n, i) => word(n, 'M' + i, { hard: true }));
    const { ctx, page } = await fresh(browser, state([list('Dots home', ws)]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    ok(await dotCount(page) === 6 && await headSum(page) === 6, 'drill starts with 6 dots, counter sums to 6');
    await page.click('#hardBtn'); await page.waitForTimeout(250);
    ok(await dotCount(page) === 5, 'unmark current word → 5 dots instantly');
    ok(await headSum(page) === 5, 'counter line drops to 5 too');
    await page.click('#hardBtn'); await page.waitForTimeout(250);
    ok(await dotCount(page) === 4 && await headSum(page) === 4, 'second unmark → 4');
    await page.click('#backBtn'); await page.waitForTimeout(200);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await dotCount(page) === 6, 'normal session of the home list still shows all 6');
    await ctx.close();
  }

  // ---------------- 4. quitting a drill ----------------
  console.log('\n[4] Quitting a Difficult drill mid-way');
  const qWords = () => ['een', 'twee', 'drie', 'vier', 'vijf', 'zes'].map((n, i) => word(n, 'Q' + i, { hard: true, days: ['2026-9-1'] }));
  const qMap = { Q0: 'een', Q1: 'twee', Q2: 'drie', Q3: 'vier', Q4: 'vijf', Q5: 'zes' };
  {
    const { ctx, page } = await fresh(browser, state([list('Quit home', qWords())]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await answerCorrect(page, qMap);
    await answerCorrect(page, qMap);
    await typeEnter(page, 'wrong'); await typeEnter(page, qMap[await term(page)]); await page.waitForTimeout(150);
    await page.click('#backBtn'); await page.waitForTimeout(250);
    const h2 = (await page.textContent('.screen h2')).trim();
    ok(h2 === '2 of 6 rivals faced', 'quit screen headline: "' + h2 + '"');
    ok(/You surpassed both on the first try/.test(await page.textContent('.screen p')), 'quit screen reports 2 aced');
    ok((await page.textContent('#unmarkAced')).trim() === 'Leave those 2 behind you', 'unmark button offered on quit');
    const days = (await getS(page)).lists[0].words.map(x => x.days);
    ok(days.every(d => !d.includes(todayStr())), 'quitting stamps no day credit (kept as is)');
    await page.click('#unmarkAced'); await page.waitForTimeout(250);
    const hard = (await getS(page)).lists[0].words.filter(x => x.hard).length;
    ok(hard === 4, 'after confirming, exactly the 2 aced words left the pile (4 remain)');
    ok(!!(await page.$('#hardGo')), 'back in the library');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser, state([list('Quit home', qWords())]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await typeEnter(page, 'wrong'); await typeEnter(page, qMap[await term(page)]); await page.waitForTimeout(150);
    await page.click('#backBtn'); await page.waitForTimeout(250);
    ok(!(await page.$('.screen h2')) && !!(await page.$('#hardGo')), 'quit with nothing aced → straight to library');
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await page.click('#backBtn'); await page.waitForTimeout(250);
    ok(!(await page.$('.screen h2')) && !!(await page.$('#hardGo')), 'quit before answering → straight to library');
    await ctx.close();
  }
  {
    // quitting inside the 700ms auto-advance window must not yank you back into study
    const { ctx, page } = await fresh(browser, state([list('Quit home', qWords())]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await page.fill('#ans', qMap[await term(page)]); await page.press('#ans', 'Enter');
    await page.click('#backBtn');
    await page.waitForTimeout(1200);
    ok(!!(await page.$('.screen h2')) && !(await page.$('#ans')), 'quit during auto-advance: stays on the quit screen');
    await page.click('#lib'); await page.waitForTimeout(200);
    ok(!!(await page.$('#hardGo')), '"Back to library" works from the quit screen');
    await ctx.close();
  }
  {
    // same race in a normal list (pre-existing bug, fixed by clearing the timer)
    const { ctx, page } = await fresh(browser, state([list('Normal', [word('dichtbij', 'nahe'), word('huis', 'Haus')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await page.fill('#ans', (await term(page)) === 'nahe' ? 'dichtbij' : 'huis'); await page.press('#ans', 'Enter');
    await page.click('#backBtn');
    await page.waitForTimeout(1200);
    ok(!(await page.$('#ans')) && !!(await page.$('[data-a="study"]')), 'normal list: quitting during auto-advance stays in library');
    await ctx.close();
  }
  {
    // natural finish keeps its old behaviour + new headline
    const ws = [word('een', 'Q0', { hard: true, days: ['2026-9-1'] }), word('twee', 'Q1', { hard: true, days: ['2026-9-1'] })];
    const { ctx, page } = await fresh(browser, state([list('Finish home', ws)]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    for (let i = 0; i < 10 && await page.$('#ans'); i++) await answerCorrect(page, qMap);
    ok((await page.textContent('.screen h2')).trim() === 'Both rivals faced', 'natural finish: "All difficult words cleared"');
    ok(/You surpassed both on the first try\. You decide whether to leave them behind you or face them again\./.test(await page.textContent('.screen p')), 'natural finish body unchanged');
    ok((await getS(page)).lists[0].words.every(x => x.days.includes(todayStr())), 'natural finish still stamps day credit');
    await ctx.close();
  }

  console.log('\n[4b] Leaving via the Language Senpai wordmark');
  {
    const { ctx, page } = await fresh(browser, state([list('Quit home', qWords())]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await answerCorrect(page, qMap);
    await page.click('#brand'); await page.waitForTimeout(250);
    ok(((await page.textContent('.screen h2')) || '').trim() === '1 of 6 rivals faced', 'wordmark mid-drill → quit screen with the unmark');
    await page.click('#brand'); await page.waitForTimeout(250);
    ok(!(await page.$('.screen h2')) && !!(await page.$('#hardGo')), 'wordmark on the quit screen → library');
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await typeEnter(page, 'wrong'); await typeEnter(page, qMap[await term(page)]); await page.waitForTimeout(150);
    await page.click('#brand'); await page.waitForTimeout(250);
    ok(!(await page.$('.screen h2')) && !!(await page.$('#hardGo')), 'wordmark mid-drill, nothing aced → library');
    await page.click('#brand'); await page.waitForTimeout(200);
    ok(!!(await page.$('#hardGo')), 'wordmark in the library stays in the library');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser, state([list('Quit home', qWords())]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await page.fill('#ans', qMap[await term(page)]); await page.press('#ans', 'Enter');
    await page.click('#brand'); await page.waitForTimeout(1200);
    ok(!!(await page.$('.screen h2')) && !(await page.$('#ans')), 'wordmark during auto-advance (drill): stays on the quit screen');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser, state([list('Normal', [word('dichtbij', 'nahe'), word('huis', 'Haus')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await page.fill('#ans', (await term(page)) === 'nahe' ? 'dichtbij' : 'huis'); await page.press('#ans', 'Enter');
    await page.click('#brand'); await page.waitForTimeout(1200);
    ok(!(await page.$('#ans')) && !!(await page.$('[data-a="study"]')), 'wordmark during auto-advance (normal list): stays in library');
    await ctx.close();
  }

  // ---------------- 5. regressions ----------------
  console.log('\n[5] Regressions');
  {
    const ws = [word('huis / woning', 'Haus'), word('boom', 'Baum')];
    const { ctx, page } = await fresh(browser, state([list('Reg', ws)]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    const map = { Haus: 'woning', Baum: 'boom' };
    await page.fill('#ans', map[await term(page)]); await page.press('#ans', 'Enter'); await page.waitForTimeout(80);
    ok(/Correct/.test(await fb(page)), '"/" alternative accepted as correct');
    await page.waitForTimeout(700);
    await page.click('#setBtn'); await page.waitForTimeout(100); await page.click('#setClose'); await page.waitForTimeout(250);
    ok(!!(await page.$('#ans')), 'settings open/close mid-study keeps you in study');
    for (let i = 0; i < 20 && await page.$('#ans'); i++) await answerCorrect(page, map);
    ok(/shuriken/i.test(await page.textContent('.screen h2')), 'normal list completes with a crown screen');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser, state([list('Last', [word('boom', 'Baum', { hard: true })])]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await page.click('#hardBtn'); await page.waitForTimeout(250);
    ok(!!(await page.$('.screen h2')), 'unmarking the last drill word still ends the drill cleanly');
    await ctx.close();
  }

  // ======================= V20-specific =======================
  let lastDialog = '';
  async function freshD(st, viewport) {
    const r = await fresh(browser, st, viewport);
    r.page.removeAllListeners('dialog');
    r.page.on('dialog', d => { lastDialog = d.message(); d.accept(); });
    return r;
  }
  const rw = (n, extra = {}) => word('r' + n, 'R' + n, Object.assign({ hard: true, days: ['2026-9-1'] }, extra));
  const rMap = {}; for (let i = 0; i < 30; i++) rMap['R' + i] = 'r' + i;
  const h2 = async page => ((await page.textContent('.screen h2')) || '').trim();
  const pText = async page => ((await page.textContent('.screen p')) || '').replace(/\s+/g, ' ').trim();

  console.log('\n[6] Backups from older versions');
  {
    const { ctx, page } = await fresh(browser, state([list('x', [word('a', 'A')])]));
    const bk = state([list('From a V19 backup', [word('kaas', 'Käse', { hard: true })])]);
    require('fs').writeFileSync(path.join(require('os').tmpdir(), 'v19_backup.json'), JSON.stringify(bk));
    await page.click('#setBtnHdr'); await page.waitForTimeout(150);
    await page.setInputFiles('#importFile', path.join(require('os').tmpdir(), 'v19_backup.json')); await page.waitForTimeout(500);
    ok((await page.$$eval('.listcard .name', e => e.map(x => x.textContent))).includes('From a V19 backup'), 'a V19/V20 backup file imports into V21');
    ok(Array.isArray((await getS(page)).sLists), 'imported backup gets an (empty) sentence library');
    await ctx.close();
  }

  console.log('\n[7] Singular / plural wording');
  {
    let { ctx, page } = await freshD(state([list('None', [word('a', 'A')])]));
    ok((await page.textContent('.hardcard .hc-sub')).trim() === 'No rivals right now' && !(await page.$('#hardGo')), 'hub: 0 → "No rivals right now", no button');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('One', [rw(0), word('b', 'B')])])));
    ok((await page.textContent('.hardcard .hc-sub')).trim() === '1 rival awaits you', 'hub: "1 rival awaits you"');
    ok((await page.textContent('#hardGo')).trim() === 'Challenge your rival', 'hub button: "Challenge your rival"');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('Three', [rw(0), rw(1), rw(2)])])));
    ok((await page.textContent('.hardcard .hc-sub')).trim() === '3 rivals await you' && (await page.textContent('#hardGo')).trim() === 'Challenge your rivals', 'hub: "3 rivals await you" / "Challenge your rivals"');
    await ctx.close();
  }
  {
    // partial, 1 faced & aced
    const { ctx, page } = await freshD(state([list('P1', [0, 1, 2, 3, 4, 5].map(i => rw(i)))]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await answerCorrect(page, rMap);
    await page.click('#backBtn'); await page.waitForTimeout(250);
    ok(await h2(page) === '1 of 6 rivals faced', 'quit: "1 of 6 rivals faced"');
    ok(await pText(page) === 'You surpassed it on the first try. You decide whether to leave it behind you or face it again.', 'quit, one surpassed: "it" throughout');
    ok((await page.textContent('#unmarkAced')).trim() === 'Leave this one behind you', 'button: "Leave this one behind you"');
    ok(/^It leaves your Rivals\./.test((await page.textContent('.acedhint')).trim()), 'hint singular: "It leaves your Rivals."');
    await page.click('#unmarkAced'); await page.waitForTimeout(200);
    ok(lastDialog === 'Leave this rival behind you? It will leave your Rivals.', 'confirm singular: "' + lastDialog + '"');
    await ctx.close();
  }
  {
    // partial, 3 faced & all aced
    const { ctx, page } = await freshD(state([list('P3', [0, 1, 2, 3, 4, 5].map(i => rw(i)))]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    for (let i = 0; i < 3; i++) await answerCorrect(page, rMap);
    await page.click('#backBtn'); await page.waitForTimeout(250);
    ok(await h2(page) === '3 of 6 rivals faced', 'quit: "3 of 6 rivals faced"');
    ok(await pText(page) === 'You surpassed all 3 on the first try. You decide whether to leave them behind you or face them again.', 'quit, all 3 surpassed: "all 3" / "them"');
    ok((await page.textContent('#unmarkAced')).trim() === 'Leave those 3 behind you', 'button: "Leave those 3 behind you"');
    ok(/^They leave your Rivals\./.test((await page.textContent('.acedhint')).trim()), 'hint plural: "They leave your Rivals."');
    await page.click('#unmarkAced'); await page.waitForTimeout(200);
    ok(lastDialog === 'Leave these 3 rivals behind you? They will leave your Rivals.', 'confirm plural: "' + lastDialog + '"');
    ok((await getS(page)).lists[0].words.filter(w => w.hard).length === 3, 'confirming leaves exactly those 3 behind');
    await ctx.close();
  }
  {
    // partial quit where one finished word was missed first (so surpassed < faced)
    const { ctx, page } = await freshD(state([list('Mix', Array.from({ length: 20 }, (_, i) => word('r' + i, 'R' + i, { hard: true })))]));   // all need 3 answers
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await answerCorrect(page, rMap);                                              // a clean first-try win
    const missedPrompt = await term(page);
    await typeEnter(page, 'nope'); await typeEnter(page, rMap[missedPrompt]); await page.waitForTimeout(120);
    for (let i = 0; i < 60 && await page.$('#ans'); i++) {
      const w = (await getS(page)).lists[0].words.find(x => x.de === missedPrompt);
      if (w.mastered) break;
      await answerCorrect(page, rMap);
    }
    const ws = (await getS(page)).lists[0].words;
    const fc = ws.filter(w => w.mastered).length, ac = ws.filter(w => w.hard && w._aced && w.mastered).length;
    await page.click('#backBtn'); await page.waitForTimeout(250);
    ok(await h2(page) === fc + ' of 20 rivals faced', 'mixed quit headline: "' + fc + ' of 20 rivals faced"');
    const expect = ac === 1 ? 'You surpassed 1 of them on the first try. You decide whether to leave it behind you or face it again.'
                            : 'You surpassed ' + ac + ' of them on the first try. You decide whether to leave them behind you or face them again.';
    ok(ac === fc - 1 && await pText(page) === expect, 'mixed quit body: "' + expect.slice(0, 44) + '…" (' + ac + ' of ' + fc + ')');
    await ctx.close();
  }
  {
    // natural finishes: 1 word aced / 1 word missed / 3 words all aced / 2 words with 1 aced
    let { ctx, page } = await freshD(state([list('N1', [rw(0), word('x', 'X')])]));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    for (let i = 0; i < 5 && await page.$('#ans'); i++) await answerCorrect(page, rMap);
    ok(await h2(page) === '1 rival faced' && await pText(page) === 'You surpassed it on the first try. You decide whether to leave it behind you or face it again.', 'finish, 1 rival: "1 rival faced" + "it"');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('N0', [rw(0), word('x', 'X')])])));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await typeEnter(page, 'nope'); await typeEnter(page, 'r0'); await page.waitForTimeout(150);
    for (let i = 0; i < 12 && await page.$('#ans'); i++) await answerCorrect(page, rMap);
    ok(await h2(page) === '1 rival faced' && /^No first-try wins this round\./.test(await pText(page)) && !(await page.$('#unmarkAced')), 'finish, none surpassed: no leave-behind button');
    ok(((await page.getAttribute('#again', 'class')) || '').includes('rival'), '"Challenge again" becomes the main button when nothing was surpassed');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('N3', [rw(0), rw(1), rw(2)])])));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    for (let i = 0; i < 12 && await page.$('#ans'); i++) await answerCorrect(page, rMap);
    ok(await h2(page) === 'All 3 rivals faced' && /^You surpassed all 3 on the first try\./.test(await pText(page)), 'finish, 3 rivals: "All 3 rivals faced" / "all 3"');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('N2', [rw(0), rw(1)])])));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await answerCorrect(page, rMap);
    await typeEnter(page, 'nope'); await typeEnter(page, rMap[await term(page)]); await page.waitForTimeout(150);
    for (let i = 0; i < 20 && await page.$('#ans'); i++) await answerCorrect(page, rMap);
    ok(await h2(page) === 'Both rivals faced', 'finish, 2 rivals: "Both rivals faced"');
    ok(await pText(page) === 'You surpassed 1 of them on the first try. You decide whether to leave it behind you or face it again.', 'finish, 1 of 2 surpassed: "1 of them" then "it"');
    ok((await page.textContent('#unmarkAced')).trim() === 'Leave this one behind you', 'finish, 1 of 2: "Leave this one behind you"');
    await ctx.close();
  }

  console.log('\n[8] Shurikens, labels and completion screens');
  {
    const lists = [
      Object.assign(list('Zero', [word('a', 'A')]), { completions: [] }),
      Object.assign(list('One', [word('b', 'B')]), { completions: ['2026-9-1'] }),
      Object.assign(list('Two', [word('c', 'C')]), { completions: ['2026-9-1', '2026-9-2'] }),
      Object.assign(list('Gold', [word('d', 'D')]), { completions: ['2026-9-1', '2026-9-2', '2026-9-3'], folder: 'learned' }),
    ];
    const { ctx, page } = await freshD(state(lists));
    const rows = await page.$$eval('.listcard', cs => cs.map(c => ({ n: c.querySelector('.name').textContent, s: c.querySelectorAll('.shuri.silver').length, g: c.querySelectorAll('.shuri.gold').length, o: c.querySelectorAll('.shuri.ghost').length })));
    const by = n => rows.find(r => r.n === n);
    ok(by('Zero').o === 3 && by('Zero').s === 0, '0 days: three empty shurikens');
    ok(by('One').s === 1 && by('One').o === 2, '1 day: one silver, two empty');
    ok(by('Two').s === 2 && by('Two').o === 1, '2 days: two silver, one empty');
    ok(by('Gold').g === 3, 'mastered: three gold');
    const heads = await page.$$eval('.folder h3', e => e.map(x => x.textContent.replace('▾', '').replace(/\d+/g, '').trim()));
    ok(heads[0] === 'Student' && heads[1] === 'Master', 'folders read Student / Master');
    const moves = await page.$$eval('[data-a="move"]', e => e.map(x => x.textContent.trim()));
    ok(moves.includes('Move to Master') && moves.includes('Back to Student'), 'move buttons: "Move to Master" / "Back to Student"');
    ok(/three separate days/.test(await page.textContent('.lib-intro')) && /straight to Master/.test(await page.textContent('.lib-intro')), 'intro says "three separate days" and Master');
    ok(await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(243, 238, 228)', 'paper background');
    ok(await page.$eval('.hardcard', e => getComputedStyle(e).backgroundColor) === 'rgb(250, 237, 234)', 'Rivals card in vermilion tint');
    await page.click('[data-a="edit"]'); await page.waitForTimeout(150);
    ok(await page.$eval('#listSave', e => e.getBoundingClientRect().height) >= 40, 'modal buttons have real height (' + Math.round(await page.$eval('#listSave', e => e.getBoundingClientRect().height)) + 'px, was 20)');
    await page.click('#listCancel'); await page.click('#setBtnHdr'); await page.waitForTimeout(150);
    ok(await page.$eval('#setClose', e => e.getBoundingClientRect().height) >= 40, 'settings "Done" has real height');
    await page.click('#setClose'); await ctx.close();
  }
  {
    const oneWord = (comp, folder) => Object.assign(list('Solo', [word('zon', 'Sonne', { days: ['2026-9-1'] })]), { completions: comp, folder: folder || 'learn' });
    let { ctx, page } = await freshD(state([oneWord([])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await page.$$eval('#tally .shuri.ghost', e => e.length) === 3, 'study header shows the list\'s shurikens');
    ok(((await page.getAttribute('#hardBtn', 'title')) || '') === 'Mark as a rival', 'bolt tooltip: "Mark as a rival"');
    await page.click('#hardBtn'); await page.waitForTimeout(80);
    ok(((await page.getAttribute('#hardBtn', 'title')) || '') === 'One of your rivals — tap to remove', 'bolt tooltip when on: "One of your rivals — tap to remove"');
    await page.click('#hardBtn');
    ok(await page.$eval('#go', e => getComputedStyle(e).backgroundColor) === 'rgb(42, 74, 128)', 'Check button in indigo');
    await answerCorrect(page, { Sonne: 'zon' });
    ok(await h2(page) === 'Silver shuriken earned' && await page.$$eval('.bigshuri .shuri.silver', e => e.length) === 1, 'day 1: "Silver shuriken earned" + big silver shuriken');
    ok(/1\/3 days complete · 2 more to gold/.test(await page.textContent('.toward')), 'day 1 progress line');
    ok(await page.$eval('#again', e => e.getBoundingClientRect().height) >= 40, 'completion buttons have real height');
    await page.click('#again'); await page.waitForTimeout(300);
    await answerCorrect(page, { Sonne: 'zon' });
    ok(await h2(page) === "Today's shuriken is already yours", 'same day again: no second shuriken claimed');
    ok((await getS(page)).lists[0].completions.length === 1, 'same day again: completions unchanged');
    await ctx.close();
    ({ ctx, page } = await freshD(state([oneWord(['2026-9-1'])])));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300); await answerCorrect(page, { Sonne: 'zon' });
    ok(await h2(page) === 'Second silver shuriken', 'day 2: "Second silver shuriken"');
    await ctx.close();
    ({ ctx, page } = await freshD(state([oneWord(['2026-9-1', '2026-9-2'])])));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300); await answerCorrect(page, { Sonne: 'zon' });
    ok(await h2(page) === 'Golden shurikens!', 'day 3: "Golden shurikens!"');
    ok(await pText(page) === "You've mastered this whole list on three separate days. It's yours now.", 'gold text kept word for word');
    const sizes = await page.$$eval('.bigshuri.trio .shuri.gold', e => e.map(x => Math.round(x.getBoundingClientRect().width)));
    ok(sizes.length === 3 && sizes[1] > sizes[0] && sizes[0] === sizes[2], 'three gold shurikens, middle one larger (' + sizes.join('/') + ')');
    ok(!!(await page.$('#mv')) && (await page.textContent('#mv')).trim() === 'Move to Master', 'gold list in Student: "Move to Master" offered');
    await page.click('#mv'); await page.waitForTimeout(200);
    ok((await getS(page)).lists[0].folder === 'learned', 'Move to Master works');
    await ctx.close();
    ({ ctx, page } = await freshD(state([oneWord(['2026-9-1', '2026-9-2', '2026-9-3'], 'learned')])));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300); await answerCorrect(page, { Sonne: 'zon' });
    ok(await h2(page) === 'Golden shurikens!' && !(await page.$('#mv')), 'gold list already in Master: no pointless move button');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('D', [rw(0), rw(1)])])));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    ok(/· Rivals/.test(await page.textContent('#crumb')), 'drill header reads "· Rivals"');
    ok((await page.textContent('.progress .head .g')).trim() === 'practice · no shurikens', 'drill progress line: "practice · no shurikens"');
    await ctx.close();
  }

  console.log('\n[9] List editor keeps progress when a line changes');
  {
    const A = word('dichtbij [nabij]', 'nahe', { days: ['2026-9-1'], hard: true, streak: 2 });
    const B = word('huiss', 'Haus', { days: ['2026-9-2'] });
    const C = word('boom', 'Baum', { days: ['2026-9-3'], hard: true });
    const D = word('als', 'als (comparison)', { days: ['2026-8-1'] });
    const E = word('als', 'wenn (time)', { days: ['2026-8-2'] });
    const L = Object.assign(list('Editor test', [A, B, C, D, E]), { completions: ['2026-9-1', '2026-9-2'] });
    const { ctx, page } = await freshD(state([L]));
    await page.click('[data-a="edit"]'); await page.waitForTimeout(150);
    await page.fill('#listArea', ['dichtbij [nabij] [vlakbij] = nahe (bij het station)', 'huis = Haus', 'fiets = Fahrrad', 'als = wenn (time)', 'als = als (comparison)', 'baum2 = Baum'].join('\n'));
    await page.click('#listSave'); await page.waitForTimeout(200);
    const ws = (await getS(page)).lists[0].words;
    ok(ws[0].nl === 'dichtbij [nabij] [vlakbij]' && ws[0].de === 'nahe (bij het station)' && ws[0].days[0] === '2026-9-1' && ws[0].hard === true, 'added hint + alternative: progress and rival flag kept');
    ok(ws[1].nl === 'huis' && ws[1].days[0] === '2026-9-2', 'fixed a typo in the word (same place, same meaning): progress kept');
    ok(ws[2].nl === 'fiets' && ws[2].days.length === 0 && ws[2].everSeen === false, 'a genuinely new word starts fresh');
    ok(ws[3].de === 'wenn (time)' && ws[3].days[0] === '2026-8-2' && ws[4].de === 'als (comparison)' && ws[4].days[0] === '2026-8-1', 'two lines with the same word, reordered: each keeps its own progress');
    ok(ws[5].nl === 'baum2' && ws[5].days.length === 0 && !ws[5].hard, 'a new line elsewhere with a deleted word\'s meaning does NOT inherit its progress');
    ok((await getS(page)).lists[0].completions.length === 2, 'list keeps its shurikens');
    await ctx.close();
  }

  // ======================= V21-specific =======================
  const sw = (nl, de, extra = {}) => Object.assign(word(nl, de), extra);
  function sstate(sLists, settings = {}, extra = {}) { const st = state([list('Words', [word('a', 'A')])], Object.assign({ sQuick: false, sShowFirst: true }, settings)); st.sLists = sLists; st.dojo = 'sentence'; return Object.assign(st, extra); }
  function slist(name, items, extra = {}) { return Object.assign(list(name, items), { kind: 'sentence' }, extra); }
  const bankT = page => page.$$eval('#sbank .tile:not(.ghost)', e => e.map(x => x.textContent));
  const lineT = page => page.$$eval('#sline .tile', e => e.map(x => x.textContent));
  async function tapBank(page, text, nth = 0) { const els = await page.$$('#sbank .tile:not(.ghost)'); let k = 0; for (const el of els) { if ((await el.textContent()) === text) { if (k === nth) { await el.click(); await page.waitForTimeout(40); return; } k++; } } throw new Error('no bank tile ' + text); }
  async function build(page, words) { for (const w of words) await tapBank(page, w); }
  const fbT = async page => ((await page.textContent('#fb')) || '').replace(/\s+/g, ' ').trim();
  const sitem = async page => (await getS(page)).sLists[0].words[0];
  async function dragTo(page, fromSel, toSel, side = 'left') {
    const a = await (await page.$(fromSel)).boundingBox(), b = await (await page.$(toSel)).boundingBox();
    const tx = side === 'left' ? b.x + 4 : b.x + b.width - 4, ty = b.y + b.height / 2;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + a.width / 2 + (tx - a.x - a.width / 2) * i / 8, a.y + a.height / 2 + (ty - a.y - a.height / 2) * i / 8);
    await page.mouse.up(); await page.waitForTimeout(150);
  }

  console.log('\n[10] Small fixes');
  {
    const { ctx, page } = await freshD(state([list('One', [word('zon', 'Sonne', { days: ['2026-9-1'] })])]));
    await page.click('#setBtnHdr'); await page.waitForTimeout(150);
    ok(!/recommended/.test(await page.textContent('#slipToggle')), '"A slip resets the word": no "(recommended)"');
    ok(/recommended/.test(await page.textContent('#dirToggle')), 'prompt-direction keeps its "(recommended)" (as asked)');
    await page.click('#setClose');
    const src = require('fs').readFileSync(process.env.APP || './index.html', 'utf8');
    const oldKeyName = new RegExp('stam' + 'pen', 'i');   // V24.3: built from parts, so the old key's name never appears in the public repo
    ok(!oldKeyName.test(src) && !/OLD_KEYS/.test(src), 'old storage key name gone from the source');
    ok(!/♕/.test(src), 'no crown glyph left anywhere');
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await page.fill('#ans', 'zon'); await page.press('#ans', 'Enter'); await page.waitForTimeout(120);
    ok(!!(await page.$('#fb .shuri.gold.mini')) && !!(await page.$('#mlbl .shuri.gold.mini')), '"mastered" shows a tiny gold shuriken');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('One', [word('zon', 'Sonne')])]));
    await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; });
    await page.click('#setBtnHdr'); await page.waitForTimeout(100); await page.click('#typoToggle'); await page.waitForTimeout(150);
    ok(/couldn't save/.test(lastDialog) && /export a backup/i.test(lastDialog), 'a failed save warns loudly instead of failing silently');
    await ctx.close();
  }

  console.log('\n[11] Folding, quiet updates, back to where you were');
  const many = (n, group, folder = 'learn') => Array.from({ length: n }, (_, i) => Object.assign(list('Frequency ' + (3001 + i * 25) + '–' + (3025 + i * 25), [word('w' + i, 'W' + i, { days: ['2026-9-1'] })]), { group, folder }));
  {
    const L = many(6, 'Frequency 3001–3500').concat(many(2, 'Old', 'learned'));
    const { ctx, page } = await freshD(state(L));
    ok(await page.$$eval('#learnWrap .subhead .nm', e => e.map(x => x.textContent).join()) === 'Frequency 3001–3500', 'a lone named group now has a header');
    await page.evaluate(() => { window.__mark = document.querySelector('#learnWrap .listcard'); });
    await page.click('#learnWrap .subhead'); await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.contains(window.__mark)), 'folding a group does not rebuild the library');
    ok(await page.$eval('#learnWrap .subgroup .fold', e => e.classList.contains('shut') && e.hasAttribute('inert')), 'the lone group folds');
    const k = Object.keys((await getS(page)).collapsed); ok(k.some(x => x.includes('Frequency 3001–3500')), 'fold state saved');
    await page.reload(); await page.waitForTimeout(400);
    ok(await page.$eval('#learnWrap .subgroup .fold', e => e.classList.contains('shut')), 'fold state survives a reload');
    await page.click('#learnWrap .subhead'); await page.waitForTimeout(400);
    const before = await page.$eval('#learnedWrap', e => e.getBoundingClientRect().top);
    await page.click('.fhead[data-fk="learn"]'); await page.waitForTimeout(450);
    const after = await page.$eval('#learnedWrap', e => e.getBoundingClientRect().top);
    ok(after < before - 200, 'folding Student pulls Master up (' + Math.round(before) + ' → ' + Math.round(after) + ')');
    await page.reload(); await page.waitForTimeout(400);
    ok(await page.$eval('.fhead[data-fk="learn"]', e => e.classList.contains('collapsed')), 'folder fold survives a reload');
    await page.focus('.fhead[data-fk="learn"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    ok(!(await page.$eval('.fhead[data-fk="learn"]', e => e.classList.contains('collapsed'))), 'folders fold with the keyboard too');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('No group A', [word('a', 'A')]), list('No group B', [word('b', 'B')])]));
    ok(!(await page.$('#learnWrap .subhead')), 'lists without any group stay flat (no "Ungrouped" header)');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state(many(30, 'Frequency 3001–3500')), { width: 900, height: 800 });
    await page.waitForTimeout(700);   // V23: let the page settle first — at 250 ms this check was timing-flaky in V22.6 too
    await page.evaluate(() => window.scrollTo(0, 1200)); await page.waitForTimeout(100);
    const y0 = await page.evaluate(() => window.scrollY);
    const dn = (await page.$$('[data-a="down"]'))[10]; await dn.click();
    const op = await page.$eval('#learnWrap', e => getComputedStyle(e.closest('.folder')).opacity);
    const y1 = await page.evaluate(() => window.scrollY);
    ok(op === '1' && Math.abs(y1 - y0) < 2, 'reordering keeps the page still (no fade replay, scroll kept)');
    // study list #24, come back via Library and via the wordmark
    const target = (await getS(page)).lists[24];
    await page.click(`.listcard[data-id="${target.id}"] [data-a="study"]`); await page.waitForTimeout(300);
    await page.click('#backBtn'); await page.waitForTimeout(250);
    const r = await page.$eval(`.listcard[data-id="${target.id}"]`, e => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, here: e.classList.contains('here') }; });
    ok(r.t >= 0 && r.b <= 800 && r.here, 'back from a session lands on the list you studied (highlighted)');
    await page.click(`.listcard[data-id="${target.id}"] [data-a="study"]`); await page.waitForTimeout(300);
    await page.click('#brand'); await page.waitForTimeout(250);
    const r2 = await page.$eval(`.listcard[data-id="${target.id}"]`, e => e.getBoundingClientRect().top);
    ok(r2 >= 0 && r2 <= 800, 'same via the wordmark');
    await page.click(`.listcard[data-id="${target.id}"] [data-a="study"]`); await page.waitForTimeout(300);
    await page.fill('#ans', 'w24'); await page.press('#ans', 'Enter'); await page.waitForTimeout(900);
    await page.click('#lib'); await page.waitForTimeout(250);
    const r3 = await page.$eval(`.listcard[data-id="${target.id}"]`, e => e.getBoundingClientRect().top);
    ok(r3 >= 0 && r3 <= 800, 'and after finishing a list ("Back to library")');
    await ctx.close();
  }

  console.log('\n[12] Dojos and per-dojo settings');
  {
    const { ctx, page } = await freshD(state([list('Word list', [word('a', 'A')])]));
    const tiles = await page.$$eval('.dojo', e => e.map(x => x.querySelector('.dn').childNodes[0].textContent + '|' + x.querySelector('.dk').textContent + '|' + x.classList.contains('on')));
    ok(tiles.join() === 'Word Dojo|語|true,Sentence Dojo|文|false', 'two dojo tiles under the wordmark: 語 Word Dojo (active), 文 Sentence Dojo');
    const t0 = await page.$eval('.dojos', e => e.getBoundingClientRect().top), h0 = await page.$eval('header', e => e.getBoundingClientRect().bottom);
    ok(t0 >= h0 && t0 - h0 < 60, 'tiles sit right under the header');
    await page.click('[data-dojo="sentence"]'); await page.waitForTimeout(350);
    ok((await getS(page)).dojo === 'sentence', 'switching dojo is remembered');
    ok((await page.$$eval('.listcard .name', e => e.map(x => x.textContent))).join() === 'Dojo sentences (sample)', 'Sentence Dojo shows its own lists (starter sample on first visit)');
    ok(/Build each sentence/.test(await page.textContent('.lib-intro')), 'intro text belongs to the Sentence Dojo');
    ok(/5 sentences/.test(await page.textContent('.listcard .meta')), 'list cards count sentences');
    await page.click('#setBtnHdr'); await page.waitForTimeout(150);
    ok(!(await page.$eval('#setSentPane', e => e.hidden)) && await page.$eval('#setWordPane', e => e.hidden), 'settings open on the Sentence Dojo pane');
    await page.click('#setSentPane .moreopts summary'); await page.click('#sSlipToggle'); await page.waitForTimeout(80);
    const st = (await getS(page)).settings; ok(st.sSlipResets === false, 'sentence settings toggle and save (under More options)');
    await page.click('#setDojo [data-sd="word"]'); await page.waitForTimeout(80);
    ok(await page.$eval('#setSentPane', e => e.hidden) && !(await page.$eval('#setWordPane', e => e.hidden)), 'header switches to the Word Dojo pane');
    ok(!(await page.$eval('#exportBtn', e => e.offsetParent === null)), 'backup stays available under both');
    await page.click('#setClose');
    await page.click('#addBtn'); await page.waitForTimeout(150);
    ok(/One sentence per line/.test(await page.textContent('#listHelp')), 'list editor explains the sentence format');
    await page.fill('#listName', 'My sentences'); await page.fill('#listArea', 'Ik lees een boek. = Ich lese ein Buch.\nZij werkt thuis. = Sie arbeitet zu Hause.');
    ok((await page.textContent('#listCount')).trim() === '2 sentences', 'editor counts sentences');
    await page.click('#listSave'); await page.waitForTimeout(200);
    const S2 = await getS(page);
    ok(S2.sLists.some(l => l.name === 'My sentences' && l.kind === 'sentence') && S2.lists.length === 1, 'new list lands in the Sentence Dojo only');
    await page.click('[data-dojo="word"]'); await page.waitForTimeout(300);
    ok((await page.$$eval('.listcard .name', e => e.map(x => x.textContent))).join() === 'Word list', 'Word Dojo untouched');
    await page.click('#addBtn'); await page.waitForTimeout(150);
    ok(/One pair per line/.test(await page.textContent('#listHelp')), 'word editor help is back in the Word Dojo');
    await ctx.close();
  }

  console.log('\n[13] Sentence card');
  const A = 'Ik ga morgen naar huis. / Morgen ga ik naar huis.', AD = 'Ich gehe morgen nach Hause.';
  {
    const { ctx, page } = await freshD(sstate([slist('S', [sw(A, AD)])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok((await page.textContent('.sprompt')).trim() === AD, 'prompt is the translation');
    const b = await bankT(page);
    ok(b.length === 5 && b.includes('ik') && !b.includes('Ik'), '5 tiles, first word in lowercase (no giveaway)');
    ok((await page.textContent('.sfin')) === '.', 'final full stop sits fixed at the end');
    ok(await page.$eval('#go', e => e.disabled), 'Check waits until every word is placed');
    await tapBank(page, 'naar');
    ok((await lineT(page)).join() === 'naar' && await page.$$eval('#sbank .tile.ghost', e => e.length) === 1, 'tap moves a tile into the sentence, its bank spot stays as an outline');
    await page.click('#sline .tile'); await page.waitForTimeout(50);
    ok((await lineT(page)).length === 0 && await page.$$eval('#sbank .tile.ghost', e => e.length) === 0, 'tap again sends it back');
    await build(page, ['ik', 'ga', 'morgen', 'naar', 'huis']);
    ok(!(await page.$eval('#go', e => e.disabled)), 'Check enabled once complete');
    await page.click('#go'); await page.waitForTimeout(150);
    const f = await fbT(page);
    ok(/^Correct/.test(f) && /Ik ga morgen naar huis\./.test(await page.textContent('.sfull')) && /Morgen ga ik naar huis\./.test(await page.textContent('.salso')), 'correct: shows the sentence properly written + the other valid order');
    ok((await sitem(page)).streak === 1 && (await sitem(page)).misses === 0, 'counts as a correct answer');
    ok((await page.textContent('#go')).trim() === 'Next →', 'button turns into Next');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    ok((await lineT(page)).length === 0 && (await page.textContent('#go')).trim() === 'Check', 'Enter goes to the next card');
    await build(page, ['morgen', 'ga', 'ik', 'naar', 'huis']); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    ok(/^Correct/.test(await fbT(page)) && /Morgen ga ik/.test(await page.textContent('.sfull')) && /Ik ga morgen/.test(await page.textContent('.salso')), 'the alternative order is accepted (Enter = Check)');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('S', [sw(A, AD)])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    await build(page, ['ik', 'ga', 'naar', 'huis', 'morgen']);
    await page.click('#go'); await page.waitForTimeout(150);
    ok(/^Not yet/.test(await fbT(page)), 'wrong order: "Not yet"');
    const pins = await page.$$eval('#sline .tile.pin', e => e.map(x => x.textContent));
    ok(pins.join() === 'ik,ga', 'the right words are pinned green (ik, ga)');
    ok((await sitem(page)).misses === 1 && (await sitem(page)).streak === 0, 'one miss counted');
    await dragTo(page, '#sline .tile[data-pos="4"]', '#sline .tile[data-pos="0"]', 'left');
    ok((await lineT(page)).join(' ') === 'ik ga naar huis morgen', 'a green (pinned) slot is not a drop target');
    await dragTo(page, '#sline .tile[data-pos="4"]', '#sline .tile[data-pos="2"]', 'left');
    ok((await lineT(page)).join(' ') === 'ik ga morgen huis naar', 'drag "morgen" onto "naar" → the two swap');
    await dragTo(page, '#sline .tile[data-pos="4"]', '#sline .tile[data-pos="3"]', 'left');
    ok((await lineT(page)).join(' ') === 'ik ga morgen naar huis', 'another swap fixes the order');
    ok((await page.$$eval('#sline .tile.pin', e => e.map(x => x.textContent))).join() === 'ik,ga', 'pinned words never moved');
    await page.click('#go'); await page.waitForTimeout(150);
    ok(/^Solved/.test(await fbT(page)) && (await sitem(page)).misses === 1 && (await sitem(page)).streak === 0, 'solved after a miss: "Solved", no credit, no extra miss');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('S', [sw(A, AD)])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    await page.click('#hintBtn'); await page.waitForTimeout(80);
    ok((await page.$$eval('#sline .tile.pin', e => e.map(x => x.textContent))).join() === 'ik' && /Hint used/.test(await fbT(page)), 'first hint pins the first word');
    await page.click('#hintBtn'); await page.waitForTimeout(80);
    ok((await page.$$eval('#sline .tile.pin', e => e.map(x => x.textContent))).join() === 'ik,ga' && (await sitem(page)).misses === 1, 'second hint pins the second word; still one miss');
    for (let i = 0; i < 3; i++) { await page.click('#hintBtn'); await page.waitForTimeout(80); }
    ok(/^Solved/.test(await fbT(page)), 'hints all the way → solved');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('S', [sw('Hij zegt het boek te lezen. / Het boek zegt hij te lezen.', 'x')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    await build(page, ['het', 'boek']);
    await page.click('#hintBtn'); await page.waitForTimeout(80);
    ok((await page.$$eval('#sline .tile.pin', e => e.map(x => x.textContent))).join() === 'het', 'hint follows the valid order you are already building');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('S', [sw('De man ziet de vrouw.', 'Der Mann sieht die Frau.')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    await tapBank(page, 'de', 1); await build(page, ['man', 'ziet', 'de', 'vrouw']);
    await page.click('#go'); await page.waitForTimeout(150);
    ok(/^Correct/.test(await fbT(page)), 'two identical words are interchangeable');
    await ctx.close();
  }
  {
    const C = 'Omdat het regent, blijven we thuis.';
    let { ctx, page } = await freshD(sstate([slist('S', [sw(C, 'Weil es regnet, bleiben wir zu Hause.')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok((await bankT(page)).length === 6 && !(await bankT(page)).includes(','), 'punctuation off: no comma tile');
    await build(page, ['omdat', 'het', 'regent', 'blijven', 'we', 'thuis']); await page.click('#go'); await page.waitForTimeout(150);
    ok(/^Correct/.test(await fbT(page)) && (await page.textContent('.sfull')).trim() === C, 'solved sentence shown with its comma');
    await ctx.close();
    ({ ctx, page } = await freshD(sstate([slist('S', [sw(C, 'x')])], { punctTiles: true })));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok(!(await bankT(page)).includes(',') && (await bankT(page)).length === 6, 'commas are never tiles now, even with the old setting saved');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('S', [sw('Jan woont in Groningen. / In Groningen woont Jan.', 'x')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok((await bankT(page)).includes('Jan'), 'a name keeps its capital (it is capitalised elsewhere too)');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('S', [Object.assign(word(A, AD), { everSeen: false })])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok(/New sentence/.test(await page.textContent('.prompt-meta')) && (await page.textContent('.s-answer')).trim() === 'Ik ga morgen naar huis.', 'new sentence: shown once to copy');
    await build(page, ['ik', 'ga', 'morgen', 'naar', 'huis']); await page.click('#go'); await page.waitForTimeout(150);
    const it = await sitem(page); ok(it.everSeen === true && it.streak === 1, 'building it once introduces it');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('S', [sw(A, AD)])], { sSlipResets: false }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    for (let i = 0; i < 2; i++) { await build(page, ['ik', 'ga', 'morgen', 'naar', 'huis']); await page.click('#go'); await page.waitForTimeout(100); await page.click('#go'); await page.waitForTimeout(250); }
    ok((await sitem(page)).streak === 2, 'two correct builds → streak 2');
    await build(page, ['huis', 'ga', 'morgen', 'naar', 'ik']); await page.click('#go'); await page.waitForTimeout(150);
    ok((await sitem(page)).streak === 1, '"A slip resets the sentence" off: a miss costs one step (2 → 1)');
    const before = await page.$$eval('#sline .tile:not(.pin)', e => e.length);
    await page.focus('#sline'); await page.keyboard.press('Backspace'); await page.waitForTimeout(80);
    ok(await page.$$eval('#sline .tile:not(.pin)', e => e.length) === before - 1, 'Backspace returns the last placed word');
    await ctx.close();
  }
  {
    const items = [sw(A, AD, { days: ['2026-9-1'] }), sw('Ik weet het niet.', 'Ich weiß es nicht.', { days: ['2026-9-1'] })];
    const { ctx, page } = await freshD(sstate([slist('S', items)]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    await page.click('#hardBtn'); await page.waitForTimeout(80);
    ok((await getS(page)).sLists[0].words.filter(w => w.hard).length === 1, 'bolt marks a sentence as a rival');
    await page.click('#editBtn'); await page.waitForTimeout(150);
    ok((await page.textContent('#cardWordLbl')) === 'Sentence' && (await page.textContent('#cardMeaningLbl')) === 'Translation', 'pencil editor speaks sentences');
    const dv = await page.inputValue('#cardMeaning'); await page.fill('#cardMeaning', dv + ' (zelfde volgorde)'); await page.click('#cardSave'); await page.waitForTimeout(200);
    ok(/zelfde volgorde/.test(await page.textContent('.prompt-hint')) && (await lineT(page)).length === 0, 'saved edit shows at once on a fresh attempt');
    // finish the list → silver shuriken, sentence wording
    for (let i = 0; i < 6 && await page.$('#sline'); i++) {
      const pr = (await page.textContent('.sprompt')).trim();
      const ws = pr.startsWith('Ich gehe') ? ['ik', 'ga', 'morgen', 'naar', 'huis'] : ['ik', 'weet', 'het', 'niet'];
      await build(page, ws); await page.click('#go'); await page.waitForTimeout(120); await page.click('#go'); await page.waitForTimeout(250);
    }
    ok(await h2(page) === 'Silver shuriken earned' && /Every sentence in this list/.test(await pText(page)), 'finishing a sentence list earns a silver shuriken');
    await page.click('#lib'); await page.waitForTimeout(250);
    ok((await page.textContent('.hardcard .hc-sub')).trim() === '1 rival awaits you' && (await getS(page)).dojo === 'sentence', 'back in the Sentence Dojo; its Rivals count only sentences');
    await page.click('[data-dojo="word"]'); await page.waitForTimeout(250);
    ok((await page.textContent('.hardcard .hc-sub')).trim() === 'No rivals right now', 'Word Dojo rivals unaffected');
    await page.click('[data-dojo="sentence"]'); await page.waitForTimeout(250);
    await page.click('#hardGo'); await page.waitForTimeout(350);
    ok(!!(await page.$('#sline')), 'the sentence Rivals drill uses the sentence card');
    await build(page, ['ik', 'ga', 'morgen', 'naar', 'huis']); await page.click('#go'); await page.waitForTimeout(150);
    ok(/^Correct/.test(await fbT(page)), 'a rival sentence can be beaten');
    await ctx.close();
  }

  // ======================= V22-specific =======================
  const DAY = 864e5;
  console.log('\n[14] Safety nets');
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } }); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('dialog', d => d.accept());
    await page.goto(FILE); await page.evaluate(k => { localStorage.clear(); localStorage.setItem(k, '{broken'); }, KEY); await page.reload(); await page.waitForTimeout(400);
    ok(!!(await page.$('#rescueNote')), 'unreadable save: a clear warning instead of a silent fresh start');
    const keys = await page.evaluate(() => Object.keys(localStorage));
    const rk = keys.find(k => k.startsWith('language_senpai_v1_rescued_'));
    ok(!!rk && await page.evaluate(k => localStorage.getItem(k), rk) === '{broken', 'the unreadable save is set aside untouched');
    await page.click('[data-dojo="sentence"]'); await page.waitForTimeout(250);
    ok(JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY)).dojo === 'sentence' && await page.evaluate(k => localStorage.getItem(k), rk) === '{broken', 'new saves go to the normal key; the rescued copy stays');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rescueExport')]);
    const p = path.join(require('os').tmpdir(), 'rescued.json'); await dl.saveAs(p);
    ok(dl.suggestedFilename() === 'language-senpai-rescued-save.json' && require('fs').readFileSync(p, 'utf8') === '{broken', 'the saved copy can be exported as it was');
    await page.click('#rescueDismiss'); await page.waitForTimeout(150);
    ok(!(await page.$('#rescueNote')), 'and the warning dismissed');
    await page.evaluate(k => { localStorage.clear(); localStorage.setItem(k, '{"foo":1}'); }, KEY); await page.reload(); await page.waitForTimeout(300);
    ok(!!(await page.$('#rescueNote')), 'a save without lists is treated the same way');
    await ctx.close();
  }
  {
    // storage full: the rescue copy can't be written → nothing at all is saved until the user exports
    const ctx = await browser.newContext(); const page = await ctx.newPage(); page.on('dialog', d => d.accept());
    await page.goto(FILE); await page.evaluate(k => { localStorage.clear(); localStorage.setItem(k, '{broken'); }, KEY);
    await ctx.addInitScript(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).includes('_rescued_')) throw new Error('QuotaExceededError'); return o.call(this, k, v); }; });
    await page.reload(); await page.waitForTimeout(400);
    ok(/nothing will be saved until you export/.test(await page.textContent('#rescueNote')), 'storage full: says nothing will be saved until it is exported');
    await page.click('[data-dojo="sentence"]'); await page.waitForTimeout(200);
    ok(await page.evaluate(k => localStorage.getItem(k), KEY) === '{broken', '…and really saves nothing over it');
    await Promise.all([page.waitForEvent('download'), page.click('#rescueExport')]); await page.waitForTimeout(150);
    await page.click('[data-dojo="word"]'); await page.waitForTimeout(200);
    ok((await page.evaluate(k => localStorage.getItem(k), KEY)).startsWith('{"lists"'), 'after the export, saving resumes');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('One', [word('a', 'A')])]));
    await page.click('#setBtnHdr'); await page.waitForTimeout(120);
    ok(/Language Senpai V\d+/.test(await page.textContent('#verLine')) && /what's new/i.test(await page.textContent('#verLine')), 'Settings shows the version and what is new');
    await ctx.close();
  }
  {
    const st = state([list('One', [word('a', 'A')])]); delete st.lastExport;
    let { ctx, page } = await freshD(st);
    ok(/Last backup: never/.test((await page.textContent('#backupNote')) || ''), 'backup reminder when progress exists and no backup was ever made');
    await page.click('#nLater'); await page.waitForTimeout(150);
    ok(!(await page.$('#backupNote')), '"Later" hides it');
    await page.reload(); await page.waitForTimeout(300);
    ok(!(await page.$('#backupNote')), 'and it stays hidden for a few days');
    await ctx.close();
    const st2 = state([list('One', [word('a', 'A')])]); st2.lastExport = Date.now() - 10 * DAY;
    ({ ctx, page } = await freshD(st2));
    ok(!!(await page.$('#backupNote')), 'reminder when the last backup is over a week old');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#nExport')]); await page.waitForTimeout(150);
    ok(dl.suggestedFilename() === 'language-senpai-backup.json' && !(await page.$('#backupNote')) && Date.now() - (await getS(page)).lastExport < 60000, 'exporting from the reminder works and clears it');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('One', [word('a', 'A')])])));
    ok(!(await page.$('#backupNote')), 'no reminder right after a backup');
    await ctx.close();
  }

  console.log('\n[15] First run: Japanese sample lists; starter fix');
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(FILE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(400);
    if (await page.$('#wlOverlay.open')) { await page.click('#wlSkip'); await page.waitForTimeout(100); }
    ok((await page.$$eval('.listcard .name', e => e.map(x => x.textContent))).join() === 'Dojo words (sample)', 'new users get "Dojo words (sample)" — no Dutch samples');
    ok(/8 words/.test(await page.textContent('.listcard .meta')) && !(await page.$('#backupNote')), 'eight sample words; no backup nagging for a brand-new user');
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok((await page.textContent('.term')).trim() === 'senior / mentor' && /先輩/.test(await page.textContent('.prompt-hint')), 'first card: "senior / mentor" with 先輩 as the hint');
    await page.fill('#ans', 'senpai'); await page.press('#ans', 'Enter'); await page.waitForTimeout(150);
    ok((await getS(page)).lists[0].words[0].everSeen === true, 'the sample card works like any card');
    await page.click('#backBtn'); await page.waitForTimeout(200);
    await page.click('[data-dojo="sentence"]'); await page.waitForTimeout(300);
    ok((await page.$$eval('.listcard .name', e => e.map(x => x.textContent))).join() === 'Dojo sentences (sample)' && /5 sentences/.test(await page.textContent('.listcard .meta')), 'Sentence Dojo: "Dojo sentences (sample)", five sentences');
    const S0 = await getS(page);
    ok(S0.lists[0].words.some(w => w.nl === 'dōjō / dojo') && S0.lists[0].words.some(w => /\[shishō/.test(w.nl)) && S0.sLists[0].words.some(w => / \/ /.test(w.nl)), 'samples show off "/", "[ ]" and other word orders');
    await ctx.close();
  }
  {
    const old = Object.assign(list('Starter sentences (sample)', [sw('Kun je het raam even dichtdoen?', 'Kannst du kurz das Fenster zumachen?', { streak: 2, days: ['2026-9-30'] }), sw('Ze belt haar moeder elke zondag op. / Elke zondag belt ze haar moeder op.', 'Sie ruft …'), sw('Wat ga je dit weekend doen? (mijn versie)', 'x')]), { kind: 'sentence' });
    const st = state([list('W', [word('a', 'A')])]); st.sLists = [old];
    const { ctx, page } = await freshD(st);
    const ws = (await getS(page)).sLists[0].words;
    ok(ws[0].nl === 'Kun je het raam even dichtdoen? / Kun je even het raam dichtdoen?' && ws[0].days[0] === '2026-9-30', 'your starter list gets "Kun je even het raam dichtdoen?" (progress kept)');
    ok(/ \/ Ze belt elke zondag haar moeder op\.$/.test(ws[1].nl), '…and "Ze belt elke zondag haar moeder op."');
    ok(ws[2].nl === 'Wat ga je dit weekend doen? (mijn versie)', 'edited sentences are left alone');
    await ctx.close();
  }

  console.log('\n[16] Get words / Get sentences');
  const wl = list('Frequency 1–25', [word('therapie', 'Therapie'), word('bank', 'Bank'), word('huis', 'Haus')]);
  {
    const { ctx, page } = await freshD(state([wl]));
    ok((await page.textContent('#gwBtn')).trim() === 'Get words', '"Get words" sits next to "+ New list"');
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    ok(await page.$eval('#gwOverlay', o => o.classList.contains('open')) && (await page.textContent('#gwTitle')) === 'Get words' && await page.$eval('#gwFromWrap', e => e.hidden), 'panel opens (no "use the words from" in the Word Dojo)');
    await page.fill('#gwLearn', 'Dutch'); await page.fill('#gwMeaning', 'German'); await page.fill('#gwTopic', 'psychology');
    await page.selectOption('#gwLevel', 'B2'); await page.selectOption('#gwCount', '25'); await page.waitForTimeout(80);
    const pr = await page.inputValue('#gwPrompt');
    ok(/learning Dutch, with the meanings in German/.test(pr) && /Topic: psychology/.test(pr) && /Level: B2 \(CEFR\)/.test(pr), 'prompt carries language, meanings, topic and level');
    ok(/Give 30 words/.test(pr) && /Dutch word = German meaning/.test(pr) && /article/.test(pr) && /" \/ "/.test(pr) && /only the lines/.test(pr), 'asks for a buffer (30 for 25), the exact format, articles and "/"');
    ok(await page.inputValue('#gwName') === 'Psychology B2' && await page.inputValue('#gwGroup') === 'Psychology', 'list name and group filled in from the topic');
    await page.click('#gwCopy'); await page.waitForTimeout(200);
    ok(((await page.textContent('#gwStatus')) || '').length > 5, 'Copy prompt gives feedback');
    const answer = ["Here are your words:", "```text", "1. **de therapie** = die Therapie", "2. het geheugen = das Gedächtnis", "- de bank = das Sofa", "* de waarneming – die Wahrnehmung", "3. het geheugen = das Gedächtnis", "4. de angst = die Angst", "```"].join("\n");
    await page.fill('#gwPaste', answer); await page.waitForTimeout(120);
    const sum = await page.textContent('#gwSum');
    ok(/3 new/.test(sum) && /2 are already in your lists/.test(await page.textContent('#gwDups')) && /1 repeated/.test(sum) && /1 other line/.test(sum), 'cleans numbering, bold, bullets, fences; counts: ' + sum.trim());
    ok(/Frequency 1–25/.test(await page.textContent('#gwDups')), 'duplicates say where you already have them ("de therapie" = "therapie": articles ignored)');
    await page.click('#gwDupOne'); await page.check('#gwDups input[data-k="1"]'); await page.waitForTimeout(60);
    await page.click('#gwCreate'); await page.waitForTimeout(300);
    const S1 = await getS(page); const made = S1.lists.find(l => l.name === 'Psychology B2');
    ok(made && made.group === 'Psychology' && made.words.length === 4 && made.words.some(w => w.de === 'das Sofa') && !made.words.some(w => /therapie/.test(w.nl)), 'list created: 3 new + "bank = Sofa" kept as a second meaning; "therapie" skipped');
    ok(S1.gw.history.length === 1 && S1.gw.history[0].listIds[0] === made.id && S1.gw.learn === 'Dutch', 'request remembered (languages too)');
    ok(!!(await page.$(`.listcard.here[data-id="${made.id}"]`)), 'the new list is shown and highlighted');
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    ok(await page.inputValue('#gwLearn') === 'Dutch' && await page.inputValue('#gwMeaning') === 'German', 'languages come back next time');
    await page.click('.chip[data-h]'); await page.waitForTimeout(100);
    const pr2 = await page.inputValue('#gwPrompt');
    ok(await page.inputValue('#gwTopic') === 'psychology' && /Don't include any of these words, which I already know: .*waarneming/.test(pr2), '"Get more" continues the topic and leaves out its words');
    const fresh30 = Array.from({ length: 30 }, (_, i) => `woord${i} = Wort${i}`).join('\n');
    await page.selectOption('#gwCount', '50'); await page.fill('#gwPaste', fresh30); await page.waitForTimeout(100);
    ok((await page.textContent('#gwCreate')).trim() === 'Fill up and create 1 list' && /21 will fill up “Psychology B2” to 25/.test(await page.textContent('#gwSum')), '30 new words for a topic whose last list has 4 → "Fill up and create 1 list", and it says so');
    await page.click('#gwCreate'); await page.waitForTimeout(300);
    const SL = (await getS(page)).lists, names = SL.map(l => l.name);
    ok(SL.find(l => l.name === 'Psychology B2').words.length === 25 && SL.find(l => l.name === 'Psychology B2 · 2').words.length === 9 && !names.includes('Psychology B2 · 3'), 'last list filled to 25, the other 9 in "Psychology B2 · 2" (no stray list)');
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwTopic', 'travel'); await page.selectOption('#gwCount', '25');
    await page.fill('#gwPaste', Array.from({ length: 30 }, (_, i) => `reis${i} = Reise${i}`).join('\n')); await page.waitForTimeout(100);
    ok(/using the first 25/.test(await page.textContent('#gwSum')) && (await page.textContent('#gwCreate')).trim() === 'Create list', 'more than asked for → uses the number you chose');
    await page.click('#gwClose');
    await ctx.close();
  }
  {
    const big = list('Big', Array.from({ length: 400 }, (_, i) => word('w' + i, 'W' + i)));
    const st = state([big]); st.gw = { learn: 'Dutch', meaning: 'German', history: [{ id: 'h1', dojo: 'word', learn: 'Dutch', meaning: 'German', topic: 'everything', level: '', listIds: [big.id], at: 1 }] };
    const { ctx, page } = await freshD(st);
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwTopic', 'everything'); await page.waitForTimeout(80);
    const ex = (await page.inputValue('#gwPrompt')).match(/already know: (.*)\.$/m);
    ok(ex && ex[1].split(', ').length === 300, 'the exclusion list is capped at 300 words (prompt stays short)');
    await page.fill('#gwTopic', ''); await page.waitForTimeout(80);
    ok(/I already know roughly the 400 most common Dutch words, so choose less common ones/.test(await page.inputValue('#gwPrompt')), 'general vocabulary with a big library → steers to less common words');
    await page.click('#gwClose'); await ctx.close();
  }
  {
    const st = sstate([slist('S', [sw('Ik lees een boek.', 'Ich lese ein Buch.')])], { sQuick: true, sShowFirst: false });
    st.lists = [list('Frequency 1–25', [word('lezen', 'lesen'), word('boek', 'Buch')])];
    const { ctx, page } = await freshD(st);
    ok((await page.textContent('#gwBtn')).trim() === 'Get sentences', 'Sentence Dojo: "Get sentences"');
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    ok(!(await page.$eval('#gwFromWrap', e => e.hidden)), '"Use the words from" offered');
    await page.fill('#gwLearn', 'Dutch'); await page.fill('#gwMeaning', 'German'); await page.fill('#gwTopic', 'reading');
    await page.selectOption('#gwFrom', { label: 'Frequency 1–25' }); await page.waitForTimeout(80);
    const pr = await page.inputValue('#gwPrompt');
    ok(/Each sentence should use at least one of these words: lezen, boek/.test(pr) && /= German translation/.test(pr) && /BEFORE the "="/.test(pr) && /another order that is also correct/.test(pr), 'sentence prompt: your words, the format, other orders after "/"');
    await page.fill('#gwPaste', ['IK LEES EEN BOEK', 'Zij leest een krant. / Een krant leest zij. = Sie liest eine Zeitung.', 'Ik lees een boek = Ich lese ein Buch'].join('\n')); await page.waitForTimeout(100);
    const sum = await page.textContent('#gwSum');
    ok(/1 new/.test(sum) && /1 is already in your lists/.test(await page.textContent('#gwDups')), 'a sentence you have (other capitals/punctuation) is caught: ' + sum.trim());
    await page.click('#gwCreate'); await page.waitForTimeout(250);
    ok((await getS(page)).sLists.some(l => l.kind === 'sentence' && l.words.some(w => /krant/.test(w.nl))), 'creates a sentence list');
    await ctx.close();
  }

  console.log('\n[17] Sentence Dojo rhythm');
  {
    const { ctx, page } = await freshD(sstate([slist('S', [Object.assign(word(A, AD), { everSeen: false })])], { sQuick: true, sShowFirst: false }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok(!(await page.$('.s-answer')) && /Build the sentence/.test(await page.textContent('.prompt-meta')), 'default: no copy-first — a new sentence is a real attempt');
    ok(await page.$$eval('#segs .seg', e => e.length) === 1, 'one segment: one clean build is enough');
    await build(page, ['ik', 'ga', 'morgen', 'naar', 'huis']); await page.click('#go'); await page.waitForTimeout(150);
    ok((await sitem(page)).mastered === true && (await sitem(page)).everSeen === true, 'right first time → mastered for today');
    await page.click('#go'); await page.waitForTimeout(300);
    ok(await h2(page) === 'Silver shuriken earned', 'a one-sentence list is done after one clean build');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('S', [sw(A, AD)])], { sQuick: true, sShowFirst: false }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    await build(page, ['huis', 'ga', 'morgen', 'naar', 'ik']); await page.click('#go'); await page.waitForTimeout(120);
    ok(await page.$$eval('#segs .seg', e => e.length) === 2, 'after a miss it needs two');
    for (let i = 0; i < 4 && (await page.$$('#sline .tile:not(.pin)')).length; i++) { await page.click('#hintBtn'); await page.waitForTimeout(60); }
    await page.click('#go'); await page.waitForTimeout(300);
    await build(page, ['ik', 'ga', 'morgen', 'naar', 'huis']); await page.click('#go'); await page.waitForTimeout(150);
    ok((await sitem(page)).streak === 1 && (await sitem(page)).mastered === false, 'first correct build after the miss: 1 of 2');
    await page.click('#go'); await page.waitForTimeout(300);
    await build(page, ['ik', 'ga', 'morgen', 'naar', 'huis']); await page.click('#go'); await page.waitForTimeout(150);
    ok((await sitem(page)).mastered === true, 'second correct build: mastered');
    await ctx.close();
  }
  {
    let { ctx, page } = await freshD(sstate([slist('S', [Object.assign(word(A, AD), { everSeen: false })])], { sQuick: true, sShowFirst: true }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok(!!(await page.$('.s-answer')), '"Show new sentences first" on → the sentence is shown to copy');
    await ctx.close();
    ({ ctx, page } = await freshD(sstate([slist('S', [sw(A, AD)])], { sQuick: false, sShowFirst: false })));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok(await page.$$eval('#segs .seg', e => e.length) === 3, '"One clean build is enough" off → the word rhythm (3)');
    await page.click('#setBtn'); await page.waitForTimeout(120);
    ok(!(await page.$eval('#sShowToggle', e => e.classList.contains('on'))) && !(await page.$eval('#sQuickToggle', e => e.classList.contains('on'))), 'both switches live in the Sentence Dojo settings');
    await page.click('#setClose'); await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('W', [word('a', 'A')])]));
    ok((await page.textContent('.dojo[data-dojo="sentence"] .beta')).trim() === 'beta' && !(await page.$('.dojo[data-dojo="word"] .beta')), 'Sentence Dojo tile carries a "beta" tag (Word Dojo none)');
    await ctx.close();
  }


  console.log('\n[18] V22.1: clean lists of 25');
  {
    const lib = list('Frequency 1–25', [word('bank', 'Bank')]);
    const { ctx, page } = await freshD(state([lib]));
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwLearn', 'Dutch'); await page.fill('#gwMeaning', 'German'); await page.fill('#gwTopic', 'furniture');
    await page.selectOption('#gwCount', '50'); await page.waitForTimeout(60);
    ok(/Give 60 words/.test(await page.inputValue('#gwPrompt')), 'buffer: 60 asked for 50');
    await page.selectOption('#gwCount', '100'); await page.waitForTimeout(60);
    ok(/Give 120 words/.test(await page.inputValue('#gwPrompt')), 'buffer: 120 asked for 100');
    await page.selectOption('#gwCount', '25');
    const ans = ['de bank = das Sofa'].concat(Array.from({ length: 27 }, (_, i) => `meubel${i} = Möbel${i}`)).join('\n');
    await page.fill('#gwPaste', ans); await page.waitForTimeout(100);
    await page.click('#gwDupOne'); await page.check('#gwDups input[data-k="0"]'); await page.waitForTimeout(60);
    ok((await page.textContent('#gwCreate')).trim() === 'Create list' && /including 1 kept/.test(await page.textContent('#gwSum')), 'a kept second meaning counts toward the 25 (no 25 + 1)');
    await page.click('#gwCreate'); await page.waitForTimeout(250);
    const made = (await getS(page)).lists.find(l => l.name === 'Furniture');
    ok(made && made.words.length === 25 && made.words.some(w => w.de === 'das Sofa'), 'one list of exactly 25, the kept meaning included');
    await ctx.close();
  }
  {
    const L20 = Object.assign(list('Food · 1', Array.from({ length: 20 }, (_, i) => word('eten' + i, 'Essen' + i))), { group: 'Food' });
    const st = state([L20]); st.gw = { learn: 'Dutch', meaning: 'German', history: [{ id: 'h1', dojo: 'word', learn: 'Dutch', meaning: 'German', topic: 'food', level: '', listIds: [L20.id], at: 1 }] };
    const { ctx, page } = await freshD(st);
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwTopic', 'food'); await page.selectOption('#gwCount', '25');
    await page.fill('#gwPaste', Array.from({ length: 5 }, (_, i) => `brood${i} = Brot${i}`).join('\n')); await page.waitForTimeout(100);
    ok((await page.textContent('#gwCreate')).trim() === 'Add to “Food · 1”', 'only a few words → "Add to “Food · 1”"');
    await page.click('#gwCreate'); await page.waitForTimeout(250);
    const S2 = await getS(page);
    ok(S2.lists.length === 1 && S2.lists[0].words.length === 25 && S2.lists[0].words.slice(0, 20).every(w => w.everSeen), 'the list is topped up to 25, its existing words untouched');
    ok(!!(await page.$(`.listcard.here[data-id="${L20.id}"]`)), 'and it is the one highlighted');
    await ctx.close();
  }
  {
    const L10 = Object.assign(list('Food · 1', Array.from({ length: 10 }, (_, i) => word('eten' + i, 'Essen' + i))), { group: 'Food', folder: 'learned' });
    const st = state([L10]); st.gw = { learn: 'Dutch', meaning: 'German', history: [{ id: 'h1', dojo: 'word', learn: 'Dutch', meaning: 'German', topic: 'food', level: '', listIds: [L10.id], at: 1 }] };
    const { ctx, page } = await freshD(st);
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwTopic', 'food');
    await page.fill('#gwPaste', Array.from({ length: 5 }, (_, i) => `brood${i} = Brot${i}`).join('\n')); await page.waitForTimeout(100);
    ok((await page.textContent('#gwCreate')).trim() === 'Create list', 'a short list already in Master is not refilled');
    await page.click('#gwCreate'); await page.waitForTimeout(250);
    const S3 = await getS(page);
    ok(S3.lists.find(l => l.id === L10.id).words.length === 10 && S3.lists.some(l => l.name === 'Food · 2' && l.words.length === 5), 'a new list "Food · 2" instead; the mastered list stays as it was');
    await ctx.close();
  }


  console.log('\n[19] V22.2');
  {
    const { ctx, page } = await freshD(state([list('Z', [word('(zich) wassen', 'sich waschen')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await page.fill('#ans', 'zich wassen'); await page.press('#ans', 'Enter'); await page.waitForTimeout(120);
    ok(/Correct/.test(await fb(page)), '"( ) is never required": "zich wassen" accepted for "(zich) wassen"');
    await page.waitForTimeout(800);
    await page.fill('#ans', 'wassen'); await page.press('#ans', 'Enter'); await page.waitForTimeout(120);
    ok(/Correct/.test(await fb(page)), '…and so is plain "wassen"');
    ok(await page.$eval('#ans', e => e.getAttribute('spellcheck')) === 'false', 'answer field: no spell-check underlining');
    await ctx.close();
  }
  {
    const lib = list('Frequency 1–25', [word('therapie', 'Therapie'), word('bank', 'Bank')]);
    const { ctx, page } = await freshD(state([lib]));
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwLearn', 'Dutch'); await page.fill('#gwMeaning', 'German'); await page.fill('#gwTopic', 'misc');
    ok(/Double-check every article/.test(await page.inputValue('#gwPrompt')), 'word prompt: double-check every article');
    ok((await page.$$eval('#gwCount option', e => e.map(x => x.textContent))).join() === '10,25,50,100', 'words: 10 / 25 / 50 / 100');
    await page.fill('#gwPaste', 'de bank = das Sofa\nde therapie = die Therapie\nhet huis2 = das Haus2'); await page.waitForTimeout(100);
    ok(/2 are already in your lists/.test(await page.textContent('#gwDups')) && await page.$eval('#gwDups [data-all="skip"]', e => e.classList.contains('on')) && await page.$eval('#gwDupList', e => e.hidden), 'one simple question: "2 are already in your lists" — Skip them (default) / Keep them; the list stays tucked away');
    await page.click('#gwDups [data-all="keep"]'); await page.waitForTimeout(60);
    await page.click('#gwDupOne'); await page.waitForTimeout(60);
    ok(await page.$$eval('#gwDupList input:checked', e => e.length) === 2 && /^Keep/.test((await page.textContent('#gwDupList .gwdup')).trim()), '"Keep them" ticks every row; each row clearly says "Keep"');
    await page.uncheck('#gwDups input[data-k="1"]'); await page.waitForTimeout(60);
    ok(!(await page.$eval('#gwDups [data-all="keep"]', e => e.classList.contains('on'))) && !(await page.$eval('#gwDups [data-all="skip"]', e => e.classList.contains('on'))), 'mixed choice → neither button lit');
    await page.click('#gwCreate'); await page.waitForTimeout(250);
    const made = (await getS(page)).lists.find(l => l.name === 'Misc');
    ok(made && made.words.length === 2 && made.words.some(w => w.de === 'das Sofa'), 'creates the new word plus the one kept');
    await ctx.close();
  }
  {
    const st = state([list('W', [word('a', 'A')])]); st.settings.wListSize = 10;
    const { ctx, page } = await freshD(st);
    await page.click('#setBtnHdr'); await page.waitForTimeout(120);
    ok(!(await page.isVisible('#strictToggle')) && await page.isVisible('#typoToggle') && await page.isVisible('#retypeToggle') && await page.isVisible('#dirToggle'), 'Settings: essentials visible, the rest tucked under More options');
    await page.click('#setWordPane .moreopts summary'); await page.waitForTimeout(80);
    ok(await page.isVisible('#strictToggle') && await page.inputValue('#wListSel') === '10', 'More options opens; words per list shows 10');
    await page.click('#wnBtn'); await page.waitForTimeout(120);
    ok(await page.$eval('#wnOverlay', e => e.classList.contains('open')) && /Version 22\.2/.test(await page.textContent('#wnList')), '"What\'s new" opens a window with versions, latest first');
    await page.click('#wnClose'); await page.waitForTimeout(80);
    ok(!(await page.$eval('#wnOverlay', e => e.classList.contains('open'))) && await page.$eval('#setOverlay', e => e.classList.contains('open')), 'closing it returns to Settings exactly as it was');
    await page.click('#setClose'); await page.waitForTimeout(120);
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwLearn', 'Dutch'); await page.fill('#gwMeaning', 'German'); await page.fill('#gwTopic', 'colours');
    await page.fill('#gwPaste', Array.from({ length: 25 }, (_, i) => `kleur${i} = Farbe${i}`).join('\n')); await page.waitForTimeout(100);
    ok((await page.textContent('#gwCreate')).trim() === 'Create 3 lists', 'words per list = 10 → 25 words become 3 lists');
    await page.click('#gwCreate'); await page.waitForTimeout(250);
    const sizes = (await getS(page)).lists.filter(l => /^Colours/.test(l.name)).map(l => l.words.length).join();
    ok(sizes === '10,10,5', 'lists of 10, 10 and 5 (' + sizes + ')');
    await ctx.close();
  }
  {
    const st = sstate([slist('S', [sw('Ik lees een boek.', 'Ich lese ein Buch.')])], { sQuick: true, sShowFirst: false });
    const { ctx, page } = await freshD(st);
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    ok((await page.$$eval('#gwCount option', e => e.map(x => x.textContent))).join() === '5,10,20,50' && await page.inputValue('#gwCount') === '10', 'sentences: 5 / 10 / 20 / 50, default 10');
    await page.fill('#gwLearn', 'Dutch'); await page.fill('#gwMeaning', 'German'); await page.fill('#gwTopic', 'family');
    ok(/you MUST add each such version/.test(await page.inputValue('#gwPrompt')), 'sentence prompt: other correct orders are a must');
    await page.selectOption('#gwCount', '50');
    await page.fill('#gwPaste', Array.from({ length: 25 }, (_, i) => `Zin nummer ${i} is hier. = Satz ${i}.`).join('\n')); await page.waitForTimeout(100);
    await page.click('#gwCreate'); await page.waitForTimeout(250);
    const sizes = (await getS(page)).sLists.filter(l => /^Family/.test(l.name)).map(l => l.words.length).join();
    ok(sizes === '10,10,5', 'sentence lists of 10 by default (' + sizes + ')');
    await ctx.close();
  }
  {
    const M = 'Mijn moeder is vandaag erg boos.';
    const { ctx, page } = await freshD(sstate([slist('S', [sw(M, 'Meine Mutter ist heute sehr böse.')])], { sQuick: true, sShowFirst: false }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    await build(page, ['mijn', 'moeder', 'is']);
    await page.click('#sline [data-pos="1"]'); await page.waitForTimeout(60);
    ok(await page.$eval('#sline [data-pos="1"]', e => e.classList.contains('slot')) && (await page.textContent('#sline [data-pos="2"]')) === 'is', 'removing a middle word leaves its slot empty — the others stay put');
    await dragTo(page, '#sbank .tile:not(.ghost)', '#sline [data-pos="4"]', 'left');
    ok(await page.$$eval('#sline .tile', e => e.length) === 3 && !(await page.$eval('#sline [data-pos="4"]', e => e.classList.contains('slot'))), 'a word can be dropped straight into the last slot');
    await page.click('#sline [data-pos="4"]'); await page.click('#sline [data-pos="2"]'); await page.click('#sline [data-pos="0"]'); await page.waitForTimeout(60);
    await build(page, ['vandaag', 'is', 'mijn', 'moeder', 'erg', 'boos'].slice(0, 6).filter(x => true));
    await page.waitForTimeout(60);
    const built = (await lineT(page)).join(' ');
    if (built !== 'vandaag is mijn moeder erg boos') { // normalise in case of leftovers: clear and rebuild
      for (let q = 5; q >= 0; q--) { const e = await page.$(`#sline .tile[data-pos="${q}"]`); if (e) await e.click(); }
      await build(page, ['vandaag', 'is', 'mijn', 'moeder', 'erg', 'boos']);
    }
    await page.click('#go'); await page.waitForTimeout(150);
    ok(/^Not yet/.test(await fbT(page)) && !!(await page.$('#mineOk')), 'unknown but plausible order → "Not yet" with "My order is also correct"');
    await page.click('#mineOk'); await page.waitForTimeout(200);
    const it = await sitem(page);
    ok(/^Correct/.test(await fbT(page)) && it.misses === 0 && it.mastered === true, 'one tap: counted as correct, the miss taken back');
    ok(/ \/ Vandaag is mijn moeder erg boos\.$/.test(it.nl), 'the card now knows that order for good');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('S', [sw('Mijn moeder is vandaag erg boos.', 'x')])], { sQuick: true, sShowFirst: false }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    await page.click('#hintBtn'); await page.waitForTimeout(60);
    await build(page, ['vandaag', 'is', 'moeder', 'erg', 'boos']); await page.click('#go'); await page.waitForTimeout(150);
    ok(!(await page.$('#mineOk')), 'after a hint there is no "My order is also correct"');
    await ctx.close();
  }
  {
    const st = state([list('R', [word('zon', 'Sonne', { days: ['2026-9-1'] }), word('maan', 'Mond', { days: ['2026-9-1'] })])], { slipResets: false });
    const { ctx, page } = await freshD(st);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await page.fill('#ans', 'xyz'); await page.press('#ans', 'Enter'); await page.waitForTimeout(150);
    ok(await page.$$eval('#segs .seg', e => e.length) === 3, '"A slip resets the word" off: missing a word you knew on its first showing costs the full three again (V22.6)');
    await ctx.close();
    const st2 = state([list('R', [word('zon', 'Sonne', { days: ['2026-9-1'] }), word('maan', 'Mond', { days: ['2026-9-1'] })])], { slipResets: true });
    const r2 = await freshD(st2);
    await r2.page.click('[data-a="study"]'); await r2.page.waitForTimeout(300);
    await r2.page.fill('#ans', 'xyz'); await r2.page.press('#ans', 'Enter'); await r2.page.waitForTimeout(150);
    ok(await r2.page.$$eval('#segs .seg', e => e.length) === 3, '…while "on" keeps the strict rule (back to three)');
    await r2.ctx.close();
  }


  console.log('\n[20] V22.3 hotfix: word orders after the "="');
  {
    const st = sstate([slist('Old', [sw('Onder stress neemt de cognitieve flexibiliteit soms af', 'Unter Stress nimmt die kognitive Flexibilität manchmal ab. / De cognitieve flexibiliteit neemt onder stress soms af')])], { sQuick: true, sShowFirst: false });
    const { ctx, page } = await freshD(st);
    const w0 = (await getS(page)).sLists[0].words[0];
    ok(/ \/ De cognitieve flexibiliteit neemt onder stress soms af$/.test(w0.nl) && w0.de === 'Unter Stress nimmt die kognitive Flexibilität manchmal ab.', 'a list imported before the fix is repaired on opening (order moved, translation clean)');
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    ok(!/flexibiliteit/.test(await page.textContent('.sprompt')), 'the Dutch no longer shows in the prompt');
    await page.click('#backBtn'); await page.waitForTimeout(200);
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwLearn', 'Dutch'); await page.fill('#gwMeaning', 'German'); await page.fill('#gwTopic', 'psychology'); await page.selectOption('#gwCount', '20');
    await page.fill('#gwPaste', `Trauma kan het gevoel van veiligheid diepgaand aantasten = Trauma kann das Sicherheitsgefühl tiefgreifend beeinträchtigen.
Vaak spelen onbewuste processen een belangrijke rol = Oft spielen unbewusste Prozesse eine wichtige Rolle. / Onbewuste processen spelen vaak een belangrijke rol
Onder stress neemt de cognitieve flexibiliteit soms af = Unter Stress nimmt die kognitive Flexibilität manchmal ab. / De cognitieve flexibiliteit neemt onder stress soms af
Vermijding kan angst op korte termijn verminderen = Vermeidung kann Angst kurzfristig reduzieren.
Op lange termijn kan vermijding angst versterken = Langfristig kann Vermeidung Angst verstärken. / Angst kan op lange termijn door vermijding toenemen
Dat is goed. = Das ist gut. / Das ist schön.`); await page.waitForTimeout(120);
    await page.click('#gwCreate'); await page.waitForTimeout(300);
    const all = (await getS(page)).sLists.flatMap(l => l.words);
    const a = all.find(x => /^Vaak spelen/.test(x.nl)), b = all.find(x => /^Op lange termijn/.test(x.nl)), c = all.find(x => /^Dat is goed/.test(x.nl));
    ok(a && a.nl === 'Vaak spelen onbewuste processen een belangrijke rol / Onbewuste processen spelen vaak een belangrijke rol' && a.de === 'Oft spielen unbewusste Prozesse eine wichtige Rolle.', 'pasted answer: the reordering after "=" lands on the sentence side');
    ok(b && b.nl === 'Op lange termijn kan vermijding angst versterken' && b.de === 'Langfristig kann Vermeidung Angst verstärken.', 'a Dutch paraphrase after "=" is dropped (it could never be built from the same tiles)');
    ok(c && c.de === 'Das ist gut. / Das ist schön.', 'genuine alternative translations stay untouched');
    await ctx.close();
  }


  console.log('\n[22] V22.4: welcome, Help, phone typing, accent bar');
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } }); const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(FILE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(500);
    ok(await page.$eval('#wlOverlay', e => e.classList.contains('open')) && /Your language journey begins here/.test(await page.textContent('#wlOverlay')), 'first visit: a welcome');
    await page.click('#wlTour'); await page.waitForTimeout(150);
    ok(await page.$eval('#helpOverlay', e => e.classList.contains('open')) && /Pick a dojo/.test(await page.textContent('#helpBody')), '"Show me around" opens Help at Getting started');
    await page.click('#helpNav [data-help="save"]'); await page.waitForTimeout(80);
    const hs = await page.textContent('#helpBody');
    ok(/Private or incognito/.test(hs) && /small icon to the left of the address/.test(hs) && /about a week/.test(hs) && /once a week/.test(hs), 'Help: private windows, allowing this site, Safari\'s week, weekly backups');
    await page.click('#persistBtn'); await page.waitForTimeout(400);
    ok(((await page.textContent('#persistStatus')) || '').length > 5, '"Ask my browser to protect this page\'s data" answers');
    await page.click('#helpClose'); await page.waitForTimeout(80);
    await page.click('#setBtnHdr'); await page.waitForTimeout(120);
    ok(await page.inputValue('#accentField') === '', 'new users start without an accent bar');
    await page.click('#setClose'); await page.reload(); await page.waitForTimeout(400);
    ok(!(await page.$eval('#wlOverlay', e => e.classList.contains('open'))), 'the welcome does not come back once seen');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(FILE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(500);
    await page.click('#wlFix'); await page.waitForTimeout(120);
    ok(/Saving your progress/.test(await page.textContent('#helpBody')), '"Here\'s how to fix it" opens Saving your progress');
    await ctx.close();
    const st = state([list('W', [word('a', 'A')])]); delete st.welcomed;
    const r = await freshD(st);
    ok(await r.page.$eval('#wlOverlay', e => e.classList.contains('open')), 'people updating from an older version see the welcome once');
    await r.ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('P', [word('een', 'eins'), word('twee', 'zwei'), word('drie', 'drei')])]));
    await page.click('#helpBtnHdr'); await page.waitForTimeout(100);
    ok(/Pick a dojo/.test(await page.textContent('#helpBody')), 'Help button in the header');
    await page.click('#helpClose'); await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await page.$eval('#helpBtnHdr', e => e.style.display === 'none'), 'during study the header Help gives way to the card bar');
    await page.click('#helpBtn'); await page.waitForTimeout(100);
    ok(/You see the prompt and type the answer/.test(await page.textContent('#helpBody')), 'Help from a word card opens the Word Dojo section');
    await page.click('#helpClose'); await page.waitForTimeout(80);
    ok(await page.$eval('#ans', e => !!e.closest('form') && e.getAttribute('enterkeyhint') === 'go'), 'answer field sits in a form with a "Go" key');
    await page.evaluate(() => { window.__ans = document.getElementById('ans'); });
    const map = { eins: 'een', zwei: 'twee', drei: 'drie' };
    for (let i = 0; i < 2; i++) { await page.fill('#ans', map[(await page.textContent('.term')).trim()]); await page.press('#ans', 'Enter'); await page.waitForTimeout(800); }
    ok(await page.evaluate(() => document.getElementById('ans') === window.__ans && document.activeElement === window.__ans), 'the same answer field stays focused from card to card (keeps a phone keyboard open)');
    ok(await page.inputValue('#ans') === '' && !(await page.$eval('#ans', e => e.readOnly)) && !/Not quite|Correct|Almost/.test(await fb(page)), '…cleared, typeable, fresh feedback');
    await page.fill('#ans', 'xyz'); await page.evaluate(() => document.getElementById('ansForm').requestSubmit()); await page.waitForTimeout(150);
    ok(/Not quite/.test(await fb(page)), 'submitting the form (what a phone\'s Go key does) checks the answer');
    await page.fill('#ans', map[(await page.textContent('.term')).trim()]); await page.click('#go'); await page.waitForTimeout(100);
    ok(await page.evaluate(() => document.activeElement === document.getElementById('ans')), 'tapping Check keeps the field focused');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('A', [word('één', 'eins'), word('ruïne', 'Ruine'), word('café', 'Café'), word('meeëten', 'mitessen'), word('中文', 'Chinesisch')])]));
    await page.click('#setBtnHdr'); await page.waitForTimeout(120);
    await page.fill('#accentField', 'ł ś'); await page.waitForTimeout(60);
    await page.locator('#accentPresets .preset', { hasText: /^Dutch$/ }).click(); await page.waitForTimeout(60);
    ok(await page.inputValue('#accentField') === "é è ë ï ö ü á à '", 'a preset fills the bar');
    await page.locator('#accentPresets .preset', { hasText: /^My own$/ }).click(); await page.waitForTimeout(60);
    ok(await page.inputValue('#accentField') === 'ł ś' && (await getS(page)).settings.accentCustom === 'ł ś', '"My own" brings your typed set back (nothing lost to a preset)');
    await page.locator('#accentPresets .preset', { hasText: /^From my lists$/ }).click(); await page.waitForTimeout(60);
    const fm = await page.inputValue('#accentField');
    ok(/é/.test(fm) && /ë/.test(fm) && /ï/.test(fm) && !/中/.test(fm), '"From my lists" collects the special letters your words use (' + fm + '), never Chinese characters');
    await page.locator('#accentPresets .preset', { hasText: /^Polish$/ }).click(); await page.waitForTimeout(60);
    ok(await page.inputValue('#accentField') === 'ą ć ę ł ń ó ś ź ż', 'more languages, e.g. Polish');
    await ctx.close();
  }

  console.log('\n[23] V22.5: every accepted form with the answer, Help, Home Screen note');
  {
    // a new word with two accepted forms: the copy step shows both (Mandarin: characters and pinyin)
    const { ctx, page } = await freshD(state([list('M', [word('貴姓 / guìxìng', 'your surname (polite)', { everSeen: false })])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    ok(((await page.textContent('.show-answer')) || '').trim() === '貴姓', 'copy step: the first form is the big one');
    const also = page.locator('.show-also');
    ok(await also.count() === 1 && /^or:\s*guìxìng$/.test((await also.textContent()).trim()), 'copy step: the other form is shown too ("or: guìxìng", V24.3)');
    await page.fill('#ans', 'guìxìng'); await page.press('#ans', 'Enter'); await page.waitForTimeout(900);
    ok(((await getS(page)).lists[0].words[0].everSeen) === true, 'either form counts in the copy step');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('N', [word('huis', 'Haus', { everSeen: false })])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    ok(await page.locator('.show-also').count() === 0, 'a word with one form shows no "or:" line');
    await ctx.close();
  }
  {
    // a miss shows every accepted form — with "retype" on, and again while retyping
    const { ctx, page } = await freshD(state([list('R', [word('貴姓 / guìxìng', 'your surname')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    await typeEnter(page, 'xyz');
    let t = await fb(page);
    ok(/Not quite/.test(t) && /貴姓/.test(t) && /\bor: guìxìng/.test(t) && !/\bor:[^.]*貴姓/.test(t), 'a miss shows the answer and its other form (' + t + ')');
    await typeEnter(page, 'abc');
    ok(/\bor: guìxìng/.test(await fb(page)), 'still shown when the retype is wrong too');
    await typeEnter(page, 'guìxìng'); await page.waitForTimeout(300);
    ok(!/Not quite/.test(await fb(page)), 'retyping the other form continues');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('R2', [word('貴姓 / guìxìng', 'your surname'), word('huis', 'Haus')])], { retypeOnError: false }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    const first = await term(page);
    await typeEnter(page, 'xyz');
    const t = await fb(page);
    if (first === 'your surname') ok(/\bor: guìxìng/.test(t), 'without retype, the revealed answer lists the other form too');
    else ok(/Not quite/.test(t) && !/\bor:/.test(t), 'without retype, a one-form word reveals just the answer');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('H', [word('een', 'eins')])]));
    await page.click('#helpBtnHdr'); await page.waitForTimeout(100);
    await page.click('#helpNav [data-help="word"]'); await page.waitForTimeout(60);
    let h = await page.textContent('#helpBody');
    ok(await page.locator('#helpBody .help-ico.bolt svg').count() > 0 && await page.locator('#helpBody .help-ico.pencil svg').count() > 0 && /top-left corner/.test(h) && /top-right corner/.test(h), 'Help shows the real bolt and pencil and where they sit');
    const box = await page.locator('#helpBody .help-ico.bolt').first().boundingBox();
    ok(box && box.width < 30 && box.height < 30, 'the Help icons stay text-sized');
    await page.click('#helpNav [data-help="rivals"]'); await page.waitForTimeout(60);
    ok(/top-left corner/.test(await page.textContent('#helpBody')), 'Rivals help says where the bolt is');
    await page.click('#helpNav [data-help="lists"]'); await page.waitForTimeout(60);
    h = await page.textContent('#helpBody');
    ok(/Groups/.test(h) && /Group field/.test(h) && /renames it/.test(h) && /dōjō \/ dojo = training hall/.test(h) && !/lopen|nahe|wassen/.test(h), 'Your lists: groups explained, Japanese examples');
    await page.click('#helpNav [data-help="save"]'); await page.waitForTimeout(60);
    ok(/keeps its own storage/.test(await page.textContent('#helpBody')), 'Saving: the Home Screen app keeps its own storage');
    await page.click('#helpClose'); await page.waitForTimeout(60);
    await page.click('#addBtn'); await page.waitForTimeout(150);
    const lh = await page.textContent('#listHelp');
    ok(/dōjō \/ dojo = training hall/.test(lh) && /sensei \[shishō\]/.test(lh) && /arigatō \(gozaimasu\)/.test(lh) && !/lopen|nahe|wassen/.test(lh), 'list editor help uses Japanese examples');
    ok(await page.getAttribute('#gwLearn', 'placeholder') === 'e.g. Japanese' && await page.getAttribute('#gwMeaning', 'placeholder') === 'e.g. English', 'Get words examples: Japanese, English');
    ok(await page.evaluate(() => document.documentElement.innerHTML.includes('APP_VERSION="24.3"')), 'version 24.3');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(FILE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(400);
    ok(await page.$eval('#wlHome', e => e.hidden && getComputedStyle(e).display === 'none'), 'in a normal browser tab the Home Screen note stays hidden');
    await ctx.close();
    const ctx2 = await browser.newContext(); await ctx2.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'standalone', { get() { return true; }, configurable: true }); });
    const p2 = await ctx2.newPage();
    await p2.goto(FILE); await p2.evaluate(() => localStorage.clear()); await p2.reload(); await p2.waitForTimeout(400);
    ok(await p2.$eval('#wlOverlay', e => e.classList.contains('open')) && await p2.$eval('#wlHome', e => !e.hidden && getComputedStyle(e).display !== 'none') && /keeps its own storage/.test(await p2.textContent('#wlHome')), 'opened from the Home Screen: the welcome explains its own storage');
    await ctx2.close();
  }

  console.log('\n[24] V22.6: misses vs. slips on spacers, word tiles for Chinese, Japanese and Thai');
  {
    // a word you knew (2nd/3rd shuriken run): right first time = mastered at once; a real miss = three again; a slip on a spacer = one
    const st = state([list('Sp', [word('zon', 'Sonne', { days: ['2026-9-1'] }), word('maan', 'Mond', { days: ['2026-9-1'] })])], { slipResets: false });
    const { ctx, page } = await freshD(st);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    const map = { 'Sonne': 'zon', 'Mond': 'maan' };
    const t1 = await term(page);
    await answerCorrect(page, map);
    let S1 = await getS(page);
    ok(S1.lists[0].words.find(w => w.nl === map[t1]).mastered === true, 'a word you knew, right the first time: mastered at once');
    const t2 = await term(page);
    ok(t2 !== t1, 'the other word comes next');
    await typeEnter(page, 'xyz');
    ok(await page.$$eval('#segs .seg', e => e.length) === 3, 'off: missed before it is mastered in this run → three correct answers again');
    await typeEnter(page, map[t2]); await page.waitForTimeout(800);
    const t3 = await term(page);
    ok(t3 === t1, 'the mastered word comes back as a spacer');
    await typeEnter(page, 'xyz');
    ok(await page.$$eval('#segs .seg', e => e.length) === 1, 'off: a slip on a spacer costs just one answer');
    S1 = await getS(page);
    const sp = S1.lists[0].words.find(w => w.nl === map[t1]), lw = S1.lists[0].words.find(w => w.nl === map[t2]);
    ok(sp.lapsed === false && sp.mastered === false && lw.lapsed === true, 'only the real miss is remembered as one (spacer: lapsed false; missed word: lapsed true)');
    await ctx.close();
  }
  {
    const st = state([list('On', [word('zon', 'Sonne', { days: ['2026-9-1'] }), word('maan', 'Mond', { days: ['2026-9-1'] })])], { slipResets: true });
    const { ctx, page } = await freshD(st);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    const map = { 'Sonne': 'zon', 'Mond': 'maan' };
    const t1 = await term(page); await answerCorrect(page, map);
    const t2 = await term(page); await typeEnter(page, 'xyz'); await typeEnter(page, map[t2]); await page.waitForTimeout(800);
    if (await term(page) === t1) { await typeEnter(page, 'xyz'); ok(await page.$$eval('#segs .seg', e => e.length) === 3, 'on (strict): even a slip on a spacer costs three'); }
    else ok(false, 'on: spacer expected');
    await ctx.close();
  }
  {
    // the session start resets the flag
    const st = state([list('Reset', [word('zon', 'Sonne', { days: ['2026-9-1'], lapsed: true, misses: 2 })])], { slipResets: false });
    const { ctx, page } = await freshD(st);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok((await getS(page)).lists[0].words[0].lapsed === false, 'a new run starts with no misses remembered');
    await ctx.close();
  }
  async function tilesOf(sentence) {
    const { ctx, page } = await freshD(sstate([slist('Seg', [word(sentence, 'translation', { everSeen: true })])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    return { ctx, page, tiles: await bankT(page) };
  }
  {
    const S0 = '我每天学习中文';
    const { ctx, page, tiles } = await tilesOf(S0 + '。');
    const ordered = tiles.slice().sort((a, b) => S0.indexOf(a) - S0.indexOf(b));
    ok(tiles.length >= 3 && ordered.join('') === S0 && !tiles.some(t => /[。，]/.test(t)), 'Chinese without spaces: word tiles (' + ordered.join(' | ') + '), no punctuation tile');
    await build(page, ordered); await page.click('#go'); await page.waitForTimeout(200);
    ok(/^Correct/.test(await fbT(page)) && (await page.textContent('.sfull')).trim() === S0 + '。', 'built in order: Correct, shown without spaces and with its 。');
    await ctx.close();
  }
  {
    const S0 = '毎日日本語を勉強します';
    const { ctx, tiles } = await tilesOf(S0 + '。');
    const ordered = tiles.slice().sort((a, b) => S0.indexOf(a) - S0.indexOf(b));
    ok(tiles.length >= 4 && ordered.join('') === S0, 'Japanese without spaces: word tiles (' + ordered.join(' | ') + ')');
    await ctx.close();
  }
  {
    const S0 = 'ฉันเรียนภาษาไทยทุกวัน';
    const { ctx, tiles } = await tilesOf(S0);
    const ordered = tiles.slice().sort((a, b) => S0.indexOf(a) - S0.indexOf(b));
    ok(tiles.length >= 4 && ordered.join('') === S0, 'Thai without spaces: word tiles (' + ordered.join(' | ') + ')');
    await ctx.close();
  }
  {
    const { ctx, tiles } = await tilesOf('我 每天 学习 中文。');
    ok(tiles.length === 4 && tiles.slice().sort().join('|') === ['中文', '学习', '我', '每天'].sort().join('|'), 'spaces you type still decide the tiles');
    await ctx.close();
  }
  {
    const { ctx, tiles } = await tilesOf('Ik ga morgen naar huis.');
    ok(tiles.length === 5, 'sentences with spaces split as before');
    await ctx.close();
  }

  console.log('\n[25] V23: Revisit');
  const mk = (n, pre, days, extra = {}) => Array.from({ length: n }, (_, i) => word(pre + i, 'M' + pre + i, Object.assign({ days: days.slice() }, extra)));
  const glist = (name, group, folder, words) => Object.assign(list(name, words), { group, folder });
  const ansMap = st => { const m = {}; st.lists.forEach(l => l.words.forEach(w => { m[w.de] = w.nl; })); return m; };
  const TODAY = (() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
  {
    const st = state([glist('Emo', 'Emotions', 'learned', mk(3, 'e', ['2026-7-2'])), glist('Psy', 'Psychology', 'learn', mk(2, 'p', ['2026-9-1'])), glist('New', '', 'learn', [word('nieuw', 'neu')])]);
    const { ctx, page } = await freshD(st);
    const order = await page.evaluate(() => { const f = document.querySelectorAll('.folder'), r = document.getElementById('revCard');
      return !!r && f.length === 2 && !!(f[0].compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(r.compareDocumentPosition(f[1]) & Node.DOCUMENT_POSITION_FOLLOWING); });
    ok(order, 'the Revisit card sits between Student and Master');
    const sub = await page.textContent('#rvSub');
    ok(/^5 words/.test(sub) && /oldest last seen 2 Jul/.test(sub), 'card shows the count and the oldest day (' + sub + ')');
    ok((await page.textContent('#rvGo')).trim() === 'Revisit 5 words', 'button: "Revisit 5 words"');
    ok(await page.$eval('#rvPanel', e => e.hidden) && /All groups/.test(await page.textContent('#rvPick')), 'From: All groups, panel folded away');
    await ctx.close();
  }
  {
    // oldest first, one list-size round, every finished word dated today, shurikens untouched
    const st = state([glist('Old', 'A', 'learned', mk(12, 'o', ['2026-7-2'])), glist('Newer', 'B', 'learned', mk(5, 'n', ['2026-9-1']))], { wListSize: 10, slipResets: false });
    const { ctx, page } = await freshD(st); const map = ansMap(st);
    await page.click('#rvGo'); await page.waitForTimeout(300);
    let seen = new Set(), guard = 0;
    while (await page.$('#ans') && guard++ < 30) { const t = await term(page); seen.add(t); await answerCorrect(page, map); }
    ok(seen.size === 10 && [...seen].every(t => /^Mo/.test(t)), 'a round = the 10 oldest words (all from the older list)');
    ok(/10 words revisited/.test(await page.textContent('.screen h2')) && /Next up: 7 words last seen around 2 Jul/.test(await page.textContent('.screen p')), 'round done: count, and what comes next');
    const S2 = await getS(page);
    ok(S2.lists[0].words.filter(w => w.days.includes(TODAY)).length === 10 && S2.lists[1].words.every(w => !w.days.includes(TODAY)), 'finished words are dated today');
    ok(S2.lists.every(l => l.completions.length === 0), 'Revisit never adds shurikens');
    await page.click('#rvMore'); await page.waitForTimeout(300);
    const t1 = await term(page);
    ok(/^Mo1[01]$/.test(t1), 'Keep going: the next round starts with the remaining oldest');
    await ctx.close();
  }
  {
    // stop halfway, switch groups, come back: nothing done is lost
    const st = state([glist('Emo', 'Emotions', 'learned', mk(4, 'e', ['2026-7-2'])), glist('Psy', 'Psychology', 'learned', mk(4, 'p', ['2026-7-3']))], { revisitGroups: { word: ['Emotions'] } });
    const { ctx, page } = await freshD(st); const map = ansMap(st);
    ok(/Emotions/.test(await page.textContent('#rvPick')), 'the group choice is remembered');
    await page.click('#rvGo'); await page.waitForTimeout(300);
    const done = []; for (let i = 0; i < 2; i++) { done.push(await term(page)); await answerCorrect(page, map); }
    await page.click('#backBtn'); await page.waitForTimeout(300);
    let S3 = await getS(page);
    ok(S3.lists[0].words.filter(w => w.days.includes(TODAY)).length === 2, 'stopping halfway keeps the words already done (dated at once)');
    ok(/^2 words/.test(await page.textContent('#rvSub')) && /2 revisited today/.test(await page.textContent('#rvSub')), 'card: 2 left in Emotions, 2 revisited today');
    await page.click('#rvPick'); await page.click('#rvPanel [data-gk="Emotions"]'); await page.click('#rvPanel [data-gk="Psychology"]'); await page.waitForTimeout(100);
    ok(/Psychology/.test(await page.textContent('#rvPick')) && /^4 words/.test(await page.textContent('#rvSub')), 'switched to Psychology');
    await page.click('#rvGo'); await page.waitForTimeout(300); await answerCorrect(page, map);
    await page.click('#backBtn'); await page.waitForTimeout(300);
    await page.click('#rvPick'); await page.click('#rvPanel [data-gk="Psychology"]'); await page.click('#rvPanel [data-gk="Emotions"]'); await page.waitForTimeout(100);
    await page.click('#rvGo'); await page.waitForTimeout(300);
    const again = []; let g = 0; while (await page.$('#ans') && g++ < 10) { again.push(await term(page)); await answerCorrect(page, map); }
    ok(again.length === 2 && again.every(t => !done.includes(t)), 'back in Emotions: only the 2 not yet done (' + again.join(', ') + ')');
    ok(/2 words revisited/.test(await page.textContent('.screen h2')) && /everything you picked/.test(await page.textContent('.screen p')) && !(await page.$('#rvMore')), 'then: everything picked is done for today');
    await ctx.close();
  }
  {
    // the home lists keep their progress: a round only borrows it (stop halfway, or finish)
    const st = state([glist('Home', 'H', 'learned', mk(12, 'h', ['2026-7-2'], { mastered: true, streak: 1 }))], { wListSize: 10 });
    const { ctx, page } = await freshD(st); const map = ansMap(st);
    await page.click('#rvGo'); await page.waitForTimeout(300);
    await answerCorrect(page, map); await page.fill('#ans', 'xyz'); await page.press('#ans', 'Enter'); await page.waitForTimeout(150);
    await page.click('#backBtn'); await page.waitForTimeout(300);
    let H = (await getS(page)).lists[0].words;
    ok(H.every(w => w.mastered === true && w.streak === 1 && !('_home' in w)), 'leaving a round halfway gives the home list its progress back');
    ok(/12 words mastered|12 mastered/.test(await page.textContent('.listcard')), 'the home list card still shows everything mastered');
    await page.click('#rvGo'); await page.waitForTimeout(300);
    let g = 0; while (await page.$('#ans') && g++ < 30) await answerCorrect(page, map);
    H = (await getS(page)).lists[0].words;
    ok(H.every(w => w.mastered === true && !('_home' in w)), 'finishing a round does too');
    await ctx.close();
  }
  {
    // the picker: filter, tick all shown, back to all
    const st = state([glist('F1', 'Frequency (1-500)', 'learned', mk(2, 'a', ['2026-7-2'])), glist('F2', 'Frequency (501-1000)', 'learned', mk(2, 'b', ['2026-7-2'])), glist('P', 'Psychology', 'learned', mk(2, 'c', ['2026-7-2']))]);
    const { ctx, page } = await freshD(st);
    await page.click('#rvPick'); await page.waitForTimeout(80);
    ok(!(await page.$eval('#rvPanel', e => e.hidden)) && await page.$$eval('#rvPanel .rv-list .rv-row', r => r.length) === 3, 'panel opens with every group that has mastered words');
    await page.fill('#rvQ', 'freq'); await page.waitForTimeout(60);
    ok(await page.$$eval('#rvPanel .rv-list .rv-row', r => r.filter(x => !x.hidden).length) === 2, 'typing filters the groups');
    await page.click('#rvTick'); await page.waitForTimeout(100);
    const sel = (await getS(page)).settings.revisitGroups.word;
    ok(sel && sel.length === 2 && sel.every(g => /^Frequency/.test(g)) && /Frequency \(1-500\) \+ 1 more/.test(await page.textContent('#rvPick')), '"Tick all shown" picks both Frequency groups');
    ok(/^4 words/.test(await page.textContent('#rvSub')), 'the count follows the choice');
    await page.click('#rvAll'); await page.waitForTimeout(100);
    ok((await getS(page)).settings.revisitGroups.word === null && /All groups/.test(await page.textContent('#rvPick')), '"All groups" resets the choice');
    await ctx.close();
  }
  {
    const st = state([glist('T', 'G', 'learned', mk(2, 't', ['2026-7-2', TODAY]))]);
    const { ctx, page } = await freshD(st);
    ok(/All caught up for today/.test(await page.textContent('#rvSub')) && !(await page.$('#rvGo')), 'words done today wait until tomorrow');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('Fresh', [word('huis', 'Haus')])]));
    ok(/Words you master come back here/.test(await page.textContent('#rvSub')) && !(await page.$('#rvGo')) && !(await page.$('#rvPick')), 'nothing mastered yet: a quiet card, no button');
    await page.click('#helpBtnHdr'); await page.waitForTimeout(80);
    await page.click('#helpNav [data-help="revisit"]'); await page.waitForTimeout(60);
    ok(/oldest words/.test(await page.textContent('#helpBody')) && /never changes a list's shurikens/.test(await page.textContent('#helpBody')), 'Help explains Revisit');
    await ctx.close();
  }
  {
    const ss = sstate([Object.assign(slist('Zinnen', [word('Ik ga naar huis.', 'Ich gehe nach Hause.', { days: ['2026-7-2'] })]), { group: 'S', folder: 'learned' })]);
    const { ctx, page } = await freshD(ss);
    ok(/^1 sentence/.test(await page.textContent('#rvSub')) && (await page.textContent('#rvGo')).trim() === 'Revisit 1 sentence', 'Sentence Dojo has its own Revisit');
    await ctx.close();
  }

  console.log('\n[26] V23.1: new typefaces, normal capitals, the logo');
  {
    const { ctx, page } = await freshD(state([list('Look', [word('貴姓 / guìxìng', 'your surname (polite)', { everSeen: false })])]));
    const ff = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, h1: getComputedStyle(document.querySelector('.brand h1')).fontFamily }));
    ok(/Familjen Grotesk/.test(ff.body) && /Shippori Mincho B1/.test(ff.h1) && !/Fraunces|Zen Kaku/.test(ff.body + ff.h1), 'V23.2: Shippori Mincho for headings, Familjen Grotesk (the sturdier text font) for text');
    const wt = await page.evaluate(() => ({ name: getComputedStyle(document.querySelector('.listcard .name')).fontWeight, h1: getComputedStyle(document.querySelector('.brand h1')).fontWeight }));
    ok(+wt.name >= 700 && +wt.h1 >= 700, 'small mincho headings are bold enough to read (list name ' + wt.name + ')');
    ok(await page.$('.brand h1 .seal rect[fill="#CF4A2E"]') !== null, 'the red seal sits next to the name in the header');
    const icons = await page.evaluate(() => [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map(l => l.rel + ':' + (l.type || '') + ':' + l.getAttribute('href').slice(0, 22)));
    ok(icons.some(x => /^icon:image\/png:data:image\/png/.test(x)) && icons.some(x => /^icon:image\/svg\+xml:data:image\/svg/.test(x)) && icons.some(x => /^apple-touch-icon::apple-touch-icon\.png/.test(x)), 'tab icons (PNG + SVG) and the Home Screen icon are linked');
    const tt = await page.evaluate(() => [document.querySelector('.folder h3'), document.querySelector('.modal h4')].filter(Boolean).map(e => getComputedStyle(e).textTransform));
    ok(tt.length >= 1 && tt.every(t => t === 'none'), 'folder headings use normal capitals');
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    const meta = await page.evaluate(() => ({ tt: getComputedStyle(document.querySelector('.prompt-meta')).textTransform, dir: document.querySelector('.prompt-meta .dir').innerText, tag: document.querySelector('.new-tag').innerText, ml: document.querySelector('.mastery .ml').innerText,
      term: getComputedStyle(document.querySelector('.term')).fontFamily, fs: getComputedStyle(document.querySelector('.term')).fontStyle }));
    ok(meta.tt === 'none' && meta.dir === 'Meaning → word' && meta.tag === 'Copy it to learn it' && meta.ml === 'Mastery', 'card labels read normally: "Meaning → word", "Copy it to learn it", "Mastery"');
    ok(/Shippori Mincho B1/.test(meta.term) && meta.fs === 'normal', 'the big word is set in the mincho, without fake italics');
    await ctx.close();
  }

  console.log('\n[27] V23.3: related topics, no page translation of cards, storage line, teal typos');
  {
    // Get words: an earlier "emotions" request also counts for "emotions and feelings"
    const emo = Object.assign(list('Emotions B1', [word('boos', 'angry'), word('blij', 'happy')]), { id: 'emo1', group: 'Emotions' });
    const st = state([emo]); st.gw = { history: [{ id: 'h1', dojo: 'word', topic: 'emotions', learn: 'Dutch', meaning: 'English', level: '', listIds: ['emo1'] }] };
    const { ctx, page } = await freshD(st);
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwLearn', 'Dutch'); await page.fill('#gwMeaning', 'English'); await page.fill('#gwTopic', 'emotions and feelings'); await page.waitForTimeout(80);
    let ex = (await page.inputValue('#gwPrompt')).match(/already know: (.*)\.$/m);
    ok(ex && /boos/.test(ex[1]) && /blij/.test(ex[1]), 'a related topic leaves out the words you got for "emotions"');
    await page.fill('#gwTopic', 'transport'); await page.waitForTimeout(80);
    ex = (await page.inputValue('#gwPrompt')).match(/already know: (.*)\.$/m);
    ok(!ex || !/boos/.test(ex[1]), 'an unrelated topic does not');
    await page.fill('#gwTopic', 'emotions'); await page.fill('#gwMeaning', 'German'); await page.waitForTimeout(80);
    ex = (await page.inputValue('#gwPrompt')).match(/already know: (.*)\.$/m);
    ok(!ex || !/boos/.test(ex[1]), 'other languages stay separate');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('Room', [word('huis', 'Haus')])]));
    await page.click('#setBtnHdr'); await page.waitForTimeout(150);
    ok(/^Saved data: (under 0\.1|\d+\.\d) MB of about 5 MB/.test((await page.textContent('#storageLine')).trim()), 'Settings & backup shows how much room the save takes');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('Tr', [word('huis', 'Haus')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await page.getAttribute('.term', 'translate') === 'no', 'the card word is marked "do not translate" for the browser');
    await typeEnter(page, 'xyz');
    ok(await page.getAttribute('#fb .correct', 'translate') === 'no', 'so is the revealed answer');
    ok(await page.evaluate(() => document.querySelector('.prompt-meta .dir').getAttribute('translate') !== 'no'), 'menus and labels stay translatable');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(sstate([slist('TrS', [word('Ik ga naar huis.', 'Ich gehe nach Hause.', { everSeen: true })])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    ok(await page.$$eval('#sbank .tile', ts => ts.length > 0 && ts.every(t => t.getAttribute('translate') === 'no')), 'sentence tiles are never translated');
    await ctx.close();
  }
  {
    // teal: typing a teal alternative exactly is never "wrong", even when it is one letter from the drilled word
    const { ctx, page } = await freshD(state([list('T1', [word('huis [huiz]', 'Haus')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await typeEnter(page, 'huiz');
    ok(!!(await page.$('#fb .teal')) && !/Not quite/.test(await fb(page)), 'an exact teal answer beats a near-miss of the green one');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('T2', [word('dichtbij [nabij]', 'nahe')])], { typoTolerance: true }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await typeEnter(page, 'nabiij');
    ok(!!(await page.$('#fb .teal')), '"Accept small typos" on: a typo in a teal alternative counts as teal');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('T3', [word('dichtbij [nabij]', 'nahe')])], { typoTolerance: false }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await typeEnter(page, 'nabiij');
    ok(!(await page.$('#fb .teal')) && /Not quite/.test(await fb(page)), '…and with it off, the typo stays wrong');
    await ctx.close();
  }

  console.log('\n[28] V24: reading aloud');
  async function freshTTS(st, voices, viewport = { width: 900, height: 900 }) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(vs => {
      window.__spoken = [];
      const fake = { getVoices: () => vs.map(v => ({ lang: v, name: 'Test ' + v, voiceURI: v })), speak: u => { window.__spoken.push({ t: u.text, lang: u.lang, rate: u.rate }); }, cancel: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
      Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
      window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    }, voices);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('dialog', d => d.accept());
    await page.goto(FILE);
    await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, st]);
    await page.reload(); await page.waitForTimeout(250);
    return { ctx, page };
  }
  const spoken = page => page.evaluate(() => window.__spoken);
  const NL = { speak: { word: { lang: 'nl-NL', auto: false }, sentence: { lang: 'nl-NL', auto: false } } };
  {
    // typing the Dutch word: no speaker before answering (it would give the answer away); after a miss, next to the answer
    const { ctx, page } = await freshTTS(state([list('A', [word('kort daarna [kort daarop]', 'kurz danach')])], NL), ['nl-NL']);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await page.$$eval('#card .spk', b => b.length) === 0, 'Meaning → word: no speaker before you answer');
    await typeEnter(page, 'xyz');
    const b = await page.$('#fb .spk');
    ok(!!b && await b.getAttribute('data-spk') === 'kort daarna' && await b.getAttribute('data-lang') === 'nl-NL' && !(await b.getAttribute('class')).includes('off'), 'after a miss: a speaker next to the answer (main form only, Dutch)');
    await b.click(); await page.waitForTimeout(60);
    let sp = await spoken(page);
    ok(sp.length === 1 && sp[0].t === 'kort daarna' && sp[0].lang === 'nl-NL' && sp[0].rate === 0.9, 'tap: heard at normal speed');
    await page.click('#fb .spk'); await page.waitForTimeout(60);
    sp = await spoken(page);
    ok(sp.length === 2 && sp[1].rate === 0.6, 'tap again: slower');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'ans'), 'the answer box keeps the focus');
    await ctx.close();
  }
  {
    // word → meaning: the speaker sits next to the word on the card; automatic reading plays it as the card appears
    const { ctx, page } = await freshTTS(state([list('B', [word('de therapie', 'die Therapie')])], { typeDutch: false, speak: { word: { lang: 'nl-NL', auto: true } } }), ['nl-NL']);
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    ok(!!(await page.$('.term .spk')), 'Word → meaning: a speaker next to the word');
    let sp = await spoken(page);
    ok(sp.length === 1 && sp[0].t === 'de therapie', 'read aloud automatically: the word plays as the card appears (article included)');
    await ctx.close();
  }
  {
    // the copy step shows the speaker; automatic reading after you answer in "Meaning → word"
    const { ctx, page } = await freshTTS(state([list('C', [word('huis', 'Haus', { everSeen: false }), word('boom', 'Baum')])], { speak: { word: { lang: 'nl-NL', auto: true } } }), ['nl-NL']);
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    const first = await term(page);
    if (first === 'Haus') {
      ok(!!(await page.$('.show-answer .spk')), 'copy step: a speaker next to the word to copy');
      ok((await spoken(page)).some(x => x.t === 'huis'), 'copy step reads the word automatically');
    } else {
      await typeEnter(page, 'boom'); await page.waitForTimeout(400);
      ok((await spoken(page)).some(x => x.t === 'boom'), 'after a correct answer the word is read automatically');
      ok(true, 'copy-step check skipped (other card came first)');
    }
    await ctx.close();
  }
  {
    // nothing set yet: the faded speaker opens Settings; a language without a voice opens Help
    const { ctx, page } = await freshTTS(state([list('D', [word('huis', 'Haus')])], { typeDutch: false }), ['nl-NL']);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok((await page.getAttribute('.term .spk', 'class')).includes('off') && await page.getAttribute('.term .spk', 'data-lang') === '', 'no language chosen: the speaker is faded');
    await page.click('.term .spk'); await page.waitForTimeout(150);
    ok(await page.$eval('#setOverlay', o => o.classList.contains('open')), '…and tapping it opens Settings');
    await page.selectOption('#wLangSel', 'nl-NL'); await page.waitForTimeout(80);
    ok((await getS(page)).settings.speak.word.lang === 'nl-NL' && /Test nl-NL/.test(await page.textContent('#wLangNote')), 'Settings: the language is saved and the note names the voice');
    await page.click('#wAutoToggle'); await page.waitForTimeout(60);
    ok((await getS(page)).settings.speak.word.auto === true, 'Settings: "Read words aloud automatically"');
    await ctx.close();
  }
  {
    const ja = Object.assign(list('JA', [word('先生', 'teacher'), word('ありがとう', 'thank you')]), { lang: 'ja-JP' });
    const { ctx, page } = await freshTTS(state([ja], Object.assign({ typeDutch: false }, NL)), ['nl-NL']);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await page.getAttribute('.term .spk', 'data-lang') === 'ja-JP' && (await page.getAttribute('.term .spk', 'class')).includes('off'), 'a list in Japanese on a device without a Japanese voice: faded');
    await page.click('.term .spk'); await page.waitForTimeout(150);
    ok(await page.$eval('#helpOverlay', o => o.classList.contains('open')) && /Spoken Content/.test(await page.textContent('#helpBody')), '…and tapping it explains how to add a voice');
    await ctx.close();
  }
  {
    // characters decide when nothing else does; a Chinese setting keeps its region (Taiwan)
    const { ctx, page } = await freshTTS(state([list('Mix', [word('ありがとう', 'thank you')])], Object.assign({ typeDutch: false }, NL)), ['nl-NL', 'ja-JP', 'zh-CN', 'zh-TW']);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await page.getAttribute('.term .spk', 'data-lang') === 'ja-JP', 'kana are read by a Japanese voice even when Settings say Dutch');
    await ctx.close();
    const tw = await freshTTS(state([list('TW', [word('貴姓 / guìxìng', 'your surname')])], { typeDutch: false, speak: { word: { lang: 'zh-TW', auto: false } } }), ['zh-CN', 'zh-TW']);
    await tw.page.click('[data-a="study"]'); await tw.page.waitForTimeout(300);
    ok(await tw.page.getAttribute('.term .spk', 'data-lang') === 'zh-TW' && await tw.page.getAttribute('.term .spk', 'data-spk') === '貴姓', 'Chinese with Settings on Taiwan: zh-TW, and only the characters are read');
    await tw.ctx.close();
  }
  {
    // the list editor: a list can read in another language
    const { ctx, page } = await freshTTS(state([list('E', [word('huis', 'Haus')])], NL), ['nl-NL', 'ja-JP']);
    await page.click('[data-a="edit"]'); await page.waitForTimeout(150);
    ok(/Same as Settings \(Dutch\)/.test(await page.textContent('#listLang option')), 'list editor: "Same as Settings (Dutch)" by default');
    await page.selectOption('#listLang', 'ja-JP'); await page.click('#listSave'); await page.waitForTimeout(150);
    ok((await getS(page)).lists[0].lang === 'ja-JP', 'saving keeps the list language');
    await ctx.close();
  }
  {
    // Sentence Dojo: the finished sentence gets a speaker, and is read automatically when on
    const { ctx, page } = await freshTTS(sstate([slist('S', [word('Ik ga naar huis.', 'Ich gehe nach Hause.', { everSeen: true })])], { speak: { word: { lang: 'nl-NL' }, sentence: { lang: 'nl-NL', auto: true } } }), ['nl-NL']);
    await page.click('[data-a="study"]'); await page.waitForTimeout(400);
    ok(await page.$$eval('#card .spk', b => b.length) === 0, 'Sentence Dojo: no speaker while you build');
    await build(page, ['ik', 'ga', 'naar', 'huis']); await page.click('#go'); await page.waitForTimeout(250);
    ok(!!(await page.$('.sfull .spk')) && (await spoken(page)).some(x => x.t === 'Ik ga naar huis.'), 'after building: a speaker on the sentence, read automatically');
    await ctx.close();
  }

  console.log('\n[29] V24.1: Help keeps up with the app');
  {
    const { ctx, page } = await freshD(state([list('H', [word('huis', 'Haus')])]));
    const v = await page.evaluate(() => { const h = document.documentElement.innerHTML; return { app: (h.match(/APP_VERSION="([^"]+)"/) || [])[1], news: (h.match(/const CHANGELOG=\[[^{]*\{v:"([^"]+)"/) || [])[1] }; });
    ok(v.app && v.app === v.news, 'every version has its own "What\'s new" entry (newest = ' + v.news + ')');
    await page.click('#helpBtnHdr'); await page.waitForTimeout(100);
    const sec = async id => { await page.click('#helpNav [data-help="' + id + '"]'); await page.waitForTimeout(50); return page.textContent('#helpBody'); };
    const st = await sec('start');
    ok(/Revisit/.test(st) && /speaker/.test(st), 'Getting started mentions Revisit and the speaker');
    ok(/Reading aloud/.test(await sec('settings')) , 'Help → Settings covers reading aloud');
    ok(/related topics/.test(await sec('get')), 'Help → Get words covers related topics');
    ok(/how much room/.test(await sec('save')), 'Help → Saving mentions the storage gauge');
    await ctx.close();
  }

  console.log('\n[30] V24.2: Chinese shapes, language first, the previous word');
  {
    // Chinese characters: out of the Japanese mincho; with Taiwan chosen, marked zh-TW
    const { ctx, page } = await freshD(state([list('ZH', [word('Lǐ / Li', '李')])], { speak: { word: { lang: 'zh-TW' } } }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    const t = await page.evaluate(() => { const e = document.querySelector('.term'); return { cls: e.className, lang: e.getAttribute('lang'), ff: getComputedStyle(e).fontFamily }; });
    ok(/\bcjk\b/.test(t.cls) && t.lang === 'zh-TW' && !/Shippori/.test(t.ff), 'Chinese with Taiwan chosen: device font, marked zh-TW (' + t.ff.slice(0, 40) + ')');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('ZH2', [word('Lǐ / Li', '李')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    const t = await page.evaluate(() => { const e = document.querySelector('.term'); return { cls: e.className, lang: e.getAttribute('lang') }; });
    ok(/\bcjk\b/.test(t.cls) && !t.lang, 'nothing chosen: the device decides, as before V23.1');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('JA', [word('arigatō', '有難う'), word('sensei', '先生')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    const t = await page.evaluate(() => { const e = document.querySelector('.term'); return { cls: e.className, lang: e.getAttribute('lang'), txt: e.textContent }; });
    if (/有難う/.test(t.txt)) ok(!/\bcjk\b/.test(t.cls) && t.lang === 'ja', 'kanji with kana: stays in the Japanese font, marked ja');
    else ok(/\bcjk\b/.test(t.cls), 'kanji alone, nothing chosen: treated like Chinese (device font)');
    await ctx.close();
  }
  {
    const demo = Object.assign(list('Dojo words (sample)', [word('senpai', 'senior (先輩)')]), { demo: true, group: 'Samples' });
    const { ctx, page } = await freshD(state([demo]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    const h = await page.evaluate(() => { const e = document.querySelector('.prompt-hint'); return e ? { cls: e.className, lang: e.getAttribute('lang') } : null; });
    ok(h && h.lang === 'ja-JP' && !/\bcjk\b/.test(h.cls), 'the sample lists count as Japanese (hint 先輩 keeps the Japanese font)');
    await ctx.close();
  }
  {
    // your setting keeps its region over a list's guessed one (voice)
    const zh = Object.assign(list('ZH3', [word('貴姓', 'your surname')]), { lang: 'zh-CN' });
    const { ctx, page } = await freshD(state([zh], { typeDutch: false, speak: { word: { lang: 'zh-TW' } } }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await page.getAttribute('.term .spk', 'data-lang') === 'zh-TW', 'Settings on Taiwan beat a list marked zh-CN');
    await ctx.close();
  }
  {
    // Settings: the language comes first, with the switch for the previous word under More options
    const { ctx, page } = await freshD(state([list('S', [word('huis', 'Haus')])]));
    await page.click('#setBtnHdr'); await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.querySelector('#setWordPane h4').textContent === 'Your language' && !!document.querySelector('#setWordPane h4 + label #wLangSel')), 'Settings open with "Your language"');
    ok(/draw characters/.test(await page.textContent('#setWordPane label.setsel')), 'the setting explains it decides how characters are drawn');
    ok(await page.$eval('#prevToggle', e => e.classList.contains('on') && !!e.closest('details.moreopts')), '"Show the previous word" is on, under More options');
    await ctx.close();
  }
  {
    // welcome: optional language question, sets both dojos
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(FILE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(400);
    ok(await page.$eval('#wlOverlay', e => e.classList.contains('open')) && !!(await page.$('#wlLang')), 'the welcome screen asks which language you are learning');
    await page.selectOption('#wlLang', 'zh-TW'); await page.waitForTimeout(80);
    const sp = (await getS(page)).settings.speak;
    ok(sp.word.lang === 'zh-TW' && sp.sentence.lang === 'zh-TW', '…and the answer sets both dojos');
    await ctx.close();
  }
  {
    // the previous word waits in the feedback box until you answer
    const { ctx, page } = await freshD(state([list('P', [word('huis', 'Haus'), word('boom', 'Baum'), word('kat', 'Katze')])]));
    const map = { Haus: 'huis', Baum: 'boom', Katze: 'kat' };
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(!(await page.$('#fb .prev')), 'first card: no previous word yet');
    const t1 = await term(page); await answerCorrect(page, map);
    const pv = await page.$eval('#fb', e => e.textContent);
    ok(new RegExp('Previous: ' + map[t1]).test(pv) && !!(await page.$('#fb .prev .spk')) && await page.$eval('#fb', e => e.classList.contains('show')), 'next card: "Previous: ' + map[t1] + '" with its speaker, in the feedback box');
    const t2 = await term(page); await typeEnter(page, 'xyz');
    ok(!/Previous/.test(await fb(page)) && /Not quite/.test(await fb(page)), 'answering turns the same box into the feedback');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('P2', [word('huis', 'Haus'), word('boom', 'Baum')])], { showPrev: false }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await answerCorrect(page, { Haus: 'huis', Baum: 'boom' });
    ok(!(await page.$('#fb .prev')), 'switched off: no previous word');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('P3', [word('zijn', 'sein'), word('zijn', 'wesen')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await answerCorrect(page, { sein: 'zijn', wesen: 'zijn' });
    ok(!(await page.$('#fb .prev')), 'the same word next: the line hides itself (never gives the answer away)');
    await ctx.close();
  }

  console.log('\n[31] V24.3: Import backup, Help links and shorthand, accent rows, stray symbols, Revisit round size and count, today\'s tally');
  {
    const { ctx, page } = await freshD(state([list('I', [word('huis', 'Haus')])]));
    await page.click('#setBtnHdr'); await page.waitForTimeout(120);
    ok((await page.textContent('#importBtn')).trim() === '⤒ Import backup', '"Restore backup" is now "Import backup"');
    const setTxt = await page.textContent('#setOverlay');
    require('fs').writeFileSync(path.join(require('os').tmpdir(), 'v243_backup.json'), JSON.stringify(state([list('From a backup', [word('kaas', 'Käse')])])));
    await page.setInputFiles('#importFile', path.join(require('os').tmpdir(), 'v243_backup.json')); await page.waitForTimeout(500);
    ok(lastDialog === 'Backup imported.' && (await page.$$eval('.listcard .name', e => e.map(x => x.textContent))).includes('From a backup'), 'importing a backup says "Backup imported."');
    await page.click('#helpBtnHdr'); await page.waitForTimeout(80);
    let all = '';
    for (const id of await page.$$eval('#helpNav [data-help]', b => b.map(x => x.dataset.help))) { await page.click(`#helpNav [data-help="${id}"]`); await page.waitForTimeout(30); all += ' ' + await page.textContent('#helpBody'); }
    const wl = await page.evaluate(() => document.getElementById('wlOverlay').textContent);
    ok(!/restor/i.test(all + ' ' + wl + ' ' + setTxt) && /Import backup/.test(all) && /import it here/.test(wl), 'no "restore" left in Help, the welcome screen or Settings');
    ok(/a line under the dojos shows what you learned and revisited today/.test(all) && /Words per round/.test(all) && /how many you revisited today/.test(all), 'Help covers the tally, the round size and the revisited count');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('H', [word('huis', 'Haus')])]));
    await page.click('#helpBtnHdr'); await page.waitForTimeout(80);
    await page.click('#helpNav [data-help="rivals"]'); await page.waitForTimeout(50);
    ok(/A rival is a word \(or sentence\) that keeps beating you/.test(await page.textContent('#helpBody')), 'Help says what a rival is');
    await page.click('#helpNav [data-help="word"]'); await page.waitForTimeout(50);
    const wd = await page.textContent('#helpBody');
    ok(/the \+ in “sensei\+”, is ignored/.test(wd) && /after “or:”/.test(wd), 'Word Dojo help: stray symbols are ignored; other forms come after "or:"');
    ok(await page.$eval('#helpBody a.hl', a => getComputedStyle(a).color) === 'rgb(42, 74, 128)', 'Help links look like normal indigo links');
    await page.click('#helpBody a.hl:text-is("rival")'); await page.waitForTimeout(80);
    ok(await page.$eval('#helpNav .chip.on', e => e.dataset.help) === 'rivals', '"rival" links to the Rivals section');
    await page.click('#helpNav [data-help="word"]'); await page.waitForTimeout(50);
    await page.click('#helpBody a.hl:has-text("Teal")'); await page.waitForTimeout(150);
    const box = await page.evaluate(() => { const b = document.getElementById('hShorthand'), m = document.querySelector('#helpOverlay .modal'); if (!b) return null; const r = b.getBoundingClientRect(), q = m.getBoundingClientRect(); return { flash: b.classList.contains('help-flash'), inView: r.top >= q.top - 1 && r.bottom <= q.bottom + 1, sec: document.querySelector('#helpNav .chip.on').dataset.help, txt: b.textContent }; });
    ok(!!box && box.sec === 'lists' && box.flash && box.inView, '"Teal" opens Your lists at the card shorthand box, briefly ringed');
    ok(!!box && /either counts/.test(box.txt) && /also valid, but type the first/.test(box.txt) && /optional/.test(box.txt) && /dōjō \/ dojo/.test(box.txt) && /sensei \[shishō\]/.test(box.txt) && /arigatō \(gozaimasu\)/.test(box.txt), 'the box explains / [ ] ( ) in plain words, one example each');
    await page.click('#helpNav [data-help="revisit"]'); await page.waitForTimeout(50);
    await page.click('#helpBody a.hl:has-text("shurikens")'); await page.waitForTimeout(150);
    ok(await page.$eval('#helpNav .chip.on', e => e.dataset.help) === 'start' && await page.$eval('#hGold', e => e.classList.contains('help-flash')), '"shurikens" links to how gold works');
    await page.click('#helpBody a.hl:has-text("Export backup")'); await page.waitForTimeout(250);
    const st = await page.evaluate(() => { const o = document.getElementById('setOverlay'), h = document.getElementById('setBackup'), m = o.querySelector('.modal'); const r = h.getBoundingClientRect(), q = m.getBoundingClientRect(); return { help: document.getElementById('helpOverlay').classList.contains('open'), set: o.classList.contains('open'), inView: r.top >= q.top - 1 && r.top < q.bottom - 20 }; });
    ok(!st.help && st.set && st.inView, '"Export backup" closes Help and opens Settings at the backup');
    await page.click('#setClose'); await page.waitForTimeout(100);
    await page.click('[data-dojo="sentence"]'); await page.waitForTimeout(250);
    await page.click('#helpBtnHdr'); await page.waitForTimeout(80);
    await page.click('#helpNav [data-help="word"]'); await page.waitForTimeout(50);
    await page.click('#helpBody a.hl:has-text("More options")'); await page.waitForTimeout(250);
    ok(await page.$eval('#setOverlay', o => o.classList.contains('open')) && !(await page.$eval('#setWordPane', e => e.hidden)) && await page.$eval('#setWordPane details.moreopts', d => d.open) && await page.isVisible('#prevToggle'), '"Settings → More options" opens the Word Dojo\'s More options, even from the Sentence Dojo');
    await page.click('#setClose'); await page.waitForTimeout(100);
    await page.click('[data-dojo="word"]'); await page.waitForTimeout(250);
    await page.click('#addBtn'); await page.waitForTimeout(150);
    ok(!!(await page.$('#listOverlay .modal-head .qmark')), 'the list editor has a "?"');
    await page.click('#listOverlay .qmark'); await page.waitForTimeout(150);
    const q = await page.evaluate(() => ({ help: document.getElementById('helpOverlay').classList.contains('open'), sec: document.querySelector('#helpNav .chip.on').dataset.help, flash: document.getElementById('hShorthand').classList.contains('help-flash'), list: document.getElementById('listOverlay').classList.contains('open') }));
    ok(q.help && q.sec === 'lists' && q.flash && q.list, '"?" opens Help at the card shorthand, over the editor');
    await page.click('#helpClose'); await page.waitForTimeout(100);
    ok(await page.$eval('#listOverlay', o => o.classList.contains('open')) && !(await page.$eval('#helpOverlay', o => o.classList.contains('open'))), 'closing Help returns to the list editor');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('A', [word('één', 'eins')])]));
    await page.click('#setBtnHdr'); await page.waitForTimeout(120);
    const r = await page.evaluate(() => { const p = document.getElementById('accentPresets'), rows = [...p.querySelectorAll(':scope > .preset-row')], lbl = p.querySelector('.preset-lbl');
      return { rows: rows.map(x => [...x.querySelectorAll('.preset')].map(b => b.textContent)), lbl: lbl ? lbl.textContent : '', between: rows.length === 2 && rows[0].nextElementSibling === lbl && lbl.nextElementSibling === rows[1],
        a: getComputedStyle(rows[0].querySelector('.preset.auto')).backgroundColor, m: getComputedStyle(rows[0].querySelector('.preset.mine')).backgroundColor, l: getComputedStyle(rows[1].querySelector('.preset')).backgroundColor }; });
    ok(r.rows.length === 2 && r.rows[0].join() === 'From my lists,My own,None' && r.rows[1].length === 13 && r.rows[1][0] === 'Dutch', 'accent bar: "From my lists" and "My own" in a row of their own, the 13 languages below');
    ok(r.lbl === 'Or pick a language:' && r.between, '"Or pick a language:" sits between the two rows');
    ok(r.a === 'rgb(229, 233, 240)' && r.m === r.a && r.l !== r.a, 'your own two are tinted; the language buttons are not');
    await ctx.close();
  }
  {
    let { ctx, page } = await freshD(state([list('S1', [word('sensei', 'teacher'), word('dōjō', 'training hall')])]));
    const m1 = { teacher: 'sensei', 'training hall': 'dōjō' };
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await typeEnter(page, m1[await term(page)] + '+');
    ok(/Correct/.test(await fb(page)), 'a stray "+" after the word: still correct');
    await page.waitForTimeout(800);
    await typeEnter(page, ';' + m1[await term(page)] + '*');
    ok(/Correct/.test(await fb(page)) && (await getS(page)).lists[0].words.every(w => w.misses === 0), 'stray symbols before and after: correct, no miss');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('S2', [word('sensei', 'teacher')])])));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await typeEnter(page, '+');
    ok(!/Not quite|Correct/.test(await fb(page)) && (await getS(page)).lists[0].words[0].misses === 0, 'only a stray symbol: nothing happens, no miss');
    await typeEnter(page, 'sensi');
    ok(/Not quite/.test(await fb(page)), 'letters still count: a misspelling is still wrong');
    await typeEnter(page, 'sensei~'); await page.waitForTimeout(200);
    ok(!/Not quite/.test(await fb(page)), 'retyping with a stray symbol counts too');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('S3', [word('C#', 'a language')])])));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await typeEnter(page, 'C');
    ok(/Not quite/.test(await fb(page)), 'a card that uses a symbol ("C#") still needs it');
    await ctx.close();
    ({ ctx, page } = await freshD(state([list('S4', [word('C#', 'a language')])])));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await typeEnter(page, 'C#+');
    ok(/Correct/.test(await fb(page)), '…while other stray symbols are still ignored there');
    await ctx.close();
  }
  {
    const st = state([glist('Old', 'A', 'learned', mk(12, 'o', ['2026-7-2']))]);
    const { ctx, page } = await freshD(st);
    ok((await page.$$eval('#rvSize option', o => o.map(x => x.textContent))).join() === '10,20,25,50' && await page.inputValue('#rvSize') === '25', 'Revisit: "Words per round" (10/20/25/50), starting at the list size');
    ok(/From .*Words per round/.test((await page.textContent('.rv-from')).replace(/\s+/g, ' ')) && (await page.textContent('#rvGo')).trim() === 'Revisit 12 words', 'it sits next to From; the button follows it (12 words left)');
    await page.selectOption('#rvSize', '10'); await page.waitForTimeout(100);
    ok((await page.textContent('#rvGo')).trim() === 'Revisit 10 words' && (await getS(page)).settings.revisitSize.word === 10, 'choosing 10: "Revisit 10 words", remembered');
    await page.click('#rvGo'); await page.waitForTimeout(300);
    ok(await page.$$eval('.dots .dot', d => d.length) === 10, 'the round has 10 words');
    await page.click('#backBtn'); await page.waitForTimeout(250);
    ok(await page.inputValue('#rvSize') === '10', 'the choice stays');
    await ctx.close();
  }
  {
    const ss = sstate([Object.assign(slist('Zinnen', [word('Ik ga naar huis.', 'Ich gehe nach Hause.', { days: ['2026-7-2'] })]), { group: 'S', folder: 'learned' })]);
    const { ctx, page } = await freshD(ss);
    ok((await page.$$eval('#rvSize option', o => o.map(x => x.textContent))).join() === '5,10,15,20,25' && /Sentences per round/.test(await page.textContent('.rv-from')), 'the Sentence Dojo has its own sizes (5–25 sentences)');
    await ctx.close();
  }
  {
    // "done today" counts only revisits; today's tally counts both
    const st = state([glist('Old', 'A', 'learned', mk(3, 'o', ['2026-7-2'])), glist('New', 'B', 'learn', [word('nieuw', 'neu', { days: ['2026-9-1'] })])]);
    const { ctx, page } = await freshD(st); const map = ansMap(st);
    ok(!(await page.$('#tallyLine')), 'nothing done today: no tally line');
    await page.click('.listcard:has-text("New") [data-a="study"]'); await page.waitForTimeout(300);
    await answerCorrect(page, map);
    await page.click('#lib'); await page.waitForTimeout(300);
    ok(!/today/.test(await page.textContent('#rvSub')), 'a word learned in a list today is not counted as revisited (V24.2 said "1 done today")');
    ok((await page.textContent('#tallyLine')).replace(/\s+/g, ' ').trim() === 'Today: 1 learned · 0 revisited', 'the tally: "Today: 1 learned · 0 revisited"');
    await page.click('#rvGo'); await page.waitForTimeout(300);
    await answerCorrect(page, map);
    await page.click('#backBtn'); await page.waitForTimeout(300);
    ok(/· 1 revisited today/.test(await page.textContent('#rvSub')), 'after revisiting one word: "1 revisited today"');
    ok((await page.textContent('#tallyLine')).replace(/\s+/g, ' ').trim() === 'Today: 1 learned · 1 revisited', '…and the tally: "Today: 1 learned · 1 revisited"');
    ok(await page.evaluate(() => { const d = document.querySelector('.dojos'), l = document.getElementById('tallyLine'), i = document.querySelector('.lib-intro'); return !!(d.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(l.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'the tally sits right under the dojo tiles');
    await page.click('[data-dojo="sentence"]'); await page.waitForTimeout(300);
    ok(!(await page.$('#tallyLine')), 'each dojo has its own tally (nothing in the Sentence Dojo yet)');
    await ctx.close();
  }

  // ---------------- screenshots ----------------
  {
    const st = state([list('Shots', [word('dichtbij [nabij] [vlakbij]', 'nahe (bij het station)', { hard: true }), word('huis', 'Haus')])]);
    let { ctx, page } = await fresh(browser, st, { width: 900, height: 860 });
    await page.click('[data-a="study"]'); await page.waitForTimeout(900);
    await page.screenshot({ path: 'shot_card.png' });
    await typeEnter(page, 'xyz'); await typeEnter(page, 'nabij'); await page.waitForTimeout(400);
    await page.screenshot({ path: 'shot_teal_retype.png' });
    await page.click('#editBtn'); await page.waitForTimeout(300);
    await page.screenshot({ path: 'shot_editor.png' });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, st, { width: 390, height: 844 }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(900);
    await page.screenshot({ path: 'shot_mobile.png' });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, state([list('Quit home', qWords())]), { width: 900, height: 860 }));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await answerCorrect(page, qMap); await answerCorrect(page, qMap);
    await page.click('#backBtn'); await page.waitForTimeout(700);
    await page.screenshot({ path: 'shot_quit.png' });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, state([list('Shots M', [word('貴姓 / guìxìng', 'your surname (polite)', { everSeen: false }), word('先生 / xiānshēng', 'Mr.')])]), { width: 900, height: 860 }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(900);
    await page.screenshot({ path: 'shot_v225_copy.png' });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, state([list('Shots R', [word('貴姓 / guìxìng', 'your surname')])]), { width: 900, height: 860 }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(900);
    await typeEnter(page, 'xyz'); await page.waitForTimeout(400);
    await page.screenshot({ path: 'shot_v225_miss.png' });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, state([list('Shots H', [word('een', 'eins')])]), { width: 900, height: 860 }));
    await page.click('#helpBtnHdr'); await page.waitForTimeout(100); await page.click('#helpNav [data-help="word"]'); await page.waitForTimeout(100);
    await page.screenshot({ path: 'shot_v225_help.png' });
    await ctx.close();
    {
      const g = (name, group, n, pre, day) => Object.assign(list(name, Array.from({ length: n }, (_, i) => word(pre + i, 'M' + pre + i, { days: [day] }))), { group, folder: 'learned' });
      const st = state([g('E', 'Emotions', 3, 'e', '2026-7-2'), g('F1', 'Frequency (1-500)', 3, 'a', '2026-7-14'), g('F2', 'Frequency (501-1000)', 3, 'b', '2026-8-2'), Object.assign(list('Stud', [word('x', 'y')]), { group: 'Psychology' })]);
      ({ ctx, page } = await fresh(browser, st, { width: 900, height: 900 }));
      await page.click('#rvPick'); await page.fill('#rvQ', 'freq'); await page.waitForTimeout(500);
      await page.screenshot({ path: 'shot_v23_revisit.png', fullPage: true });
      await ctx.close();
    }
    ({ ctx, page } = await fresh(browser, state([list('Shots L', [word('貴姓 / guìxìng', 'your surname (polite)', { everSeen: false })])]), { width: 900, height: 820 }));
    await page.waitForTimeout(1200); await page.screenshot({ path: 'shot_v231_library.png' });
    await page.click('[data-a="study"]'); await page.waitForTimeout(1200);
    await page.screenshot({ path: 'shot_v231_card.png' });
    await ctx.close();
    {
      const st = state([glist('Frequency 1-25', 'Frequency (1-500)', 'learned', mk(14, 'o', ['2026-7-2'])), Object.assign(list('Psychology 1', [word('de therapie', 'die Therapie', { md: TODAY }), word('het geheugen', 'das Gedächtnis', { md: TODAY, rv: TODAY })]), { group: 'Psychology' })]);
      ({ ctx, page } = await fresh(browser, st, { width: 900, height: 900 }));
      await page.waitForTimeout(900); await page.screenshot({ path: 'shot_v243_library.png', fullPage: true });
      await ctx.close();
      ({ ctx, page } = await fresh(browser, st, { width: 390, height: 844 }));
      await page.waitForTimeout(900); await page.screenshot({ path: 'shot_v243_phone.png', fullPage: true });
      await ctx.close();
      ({ ctx, page } = await fresh(browser, st, { width: 900, height: 900 }));
      await page.click('#helpBtnHdr'); await page.waitForTimeout(100); await page.click('#helpNav [data-help="word"]'); await page.waitForTimeout(80);
      await page.click('#helpBody a.hl:has-text("Teal")'); await page.waitForTimeout(400);
      await page.screenshot({ path: 'shot_v243_shorthand.png' });
      await page.click('#helpClose'); await page.click('#setBtnHdr'); await page.waitForTimeout(150);
      await page.evaluate(() => document.querySelector('.accbar-cfg').scrollIntoView({ block: 'center' })); await page.waitForTimeout(150);
      await page.screenshot({ path: 'shot_v243_accent.png' });
      await page.click('#setClose'); await page.click('#addBtn'); await page.waitForTimeout(250);
      await page.screenshot({ path: 'shot_v243_editor.png' });
      await ctx.close();
    }
  }

  ok(errors.length === 0, 'no page/console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('FAILED:', failures.join('; '));
  await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
