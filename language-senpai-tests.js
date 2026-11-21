/*
 * Language Senpai — automated checks (755 at V25.4)
 * ------------------------------------------------
 * What this is: a script that opens the app in an invisible browser and uses it like a person would —
 * typing answers, building sentences, quitting drills, pasting AI answers, corrupting a save on purpose —
 * and checks after every step that the app did the right thing. Run it before handing over every new version:
 * if an old feature silently broke, a check fails and says which one.
 *
 * How to run (for a developer): needs Node.js and Playwright (npm i playwright; npx playwright install chromium).
 * Point FILE below at the app's HTML file, then: node language-senpai-tests.js  → prints PASS/FAIL per check and a total.
 * It takes about ten minutes. Screenshots go to the folder in $SHOTS, else the system's temp folder. Where a single command is time-limited, run it detached:
 *   setsid nohup node language-senpai-tests.js > tests.log 2>&1 < /dev/null &   — then read tests.log.
 * When a version changes behaviour on purpose, update the matching check in the same step.
 */
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(process.env.APP || './index.html');
const KEY = 'language_senpai_v1';
const SHOT = f => path.join(process.env.SHOTS || require('os').tmpdir(), f);   // screenshots: $SHOTS, else the system's temp folder

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
    ok(/Give 30 words/.test(pr) && /Dutch word = German meaning/.test(pr) && /article/.test(pr) && /" \/ "/.test(pr) && /only the numbered lines/.test(pr), 'asks for a buffer (30 for 25), the exact format, articles and "/"');
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
    ok(await page.evaluate(() => document.documentElement.innerHTML.includes('APP_VERSION="25.4"')), 'version 25.4');
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

  console.log('\n[32] V24.4: sorting lists and groups (name, date created, last practised), Undo, new lists keep their date');
  const L32 = (name, group, folder, extra = {}) => Object.assign(list(name, [word('w' + name, 'm' + name)]), { group, folder }, extra);
  const namesIn = (page, g) => page.$$eval('.subgroup', (gs, g) => { const s = gs.find(x => x.querySelector('.nm').textContent === g); return s ? [...s.querySelectorAll('.listcard .name')].map(n => n.textContent) : null; }, g);
  const groupNames = (page, fk) => page.$$eval(`#${fk}Wrap .subgroup .nm`, e => e.map(x => x.textContent));
  const sortBtn = g => `.subgroup:has(.nm:text-is("${g}")) [data-ga="sort"]`;
  const toastTxt = async page => (await page.$eval('#sortToast', t => t.hidden ? '' : [...t.children].map(c => c.textContent).join(' '))).replace(/\s+/g, ' ').trim();
  const menuOpen = page => page.$eval('#sortMenu', m => !m.hidden);
  {
    const st = state([L32('Word List (1001-1500)', 'Frequency', 'learn'), L32('Word List (1-500)', 'Frequency', 'learn'), L32('Emotions 2', 'Psychology', 'learn'), L32('Word List (501-1000)', 'Frequency', 'learn'), L32('Emotions 1', 'Psychology', 'learn'), L32('Loose', '', 'learn'), L32('Old B', 'Basics', 'learned'), L32('Old A', 'Basics', 'learned')]);
    const { ctx, page } = await freshD(st);
    ok(!!(await page.$(sortBtn('Frequency'))) && !!(await page.$(sortBtn('Psychology'))) && !!(await page.$(sortBtn('Basics'))) && !(await page.$(sortBtn('Ungrouped'))), 'a sort button next to every group with two or more lists (none for a single list)');
    ok(!!(await page.$('.fhead[data-fk="learn"] .fsort')) && !(await page.$('.fhead[data-fk="learned"] .fsort')), 'Student (two groups) has one; Master (one group) has none');
    ok((await page.textContent('.fhead[data-fk="learn"]')) === '▾Student 6' && /^✎▲▼$/.test((await page.textContent('.subgroup:has(.nm:text-is("Frequency")) .subgrip')).trim()), 'the button adds no text to the headings (an icon only)');
    const before = await getS(page);
    await page.click(sortBtn('Frequency')); await page.waitForTimeout(150);
    ok(await menuOpen(page) && (await page.textContent('#sortTitle')) === 'Sort the lists in “Frequency”', 'the menu opens: "Sort the lists in “Frequency”"');
    const btns = await page.$$eval('#sortMenu [data-sort]', b => b.map(x => x.textContent));
    ok(JSON.stringify(btns) === JSON.stringify(['A → Z', 'Z → A', 'Newest first', 'Oldest first', 'Longest ago first', 'Most recent first']) && /Name.*Date created.*Last practised/.test(await page.textContent('#sortMenu')), 'three ways to sort, each both ways');
    ok(!(await page.$eval('.subgroup:has(.nm:text-is("Frequency")) .subhead', h => h.classList.contains('collapsed'))) && JSON.stringify((await getS(page)).collapsed) === JSON.stringify(before.collapsed), 'opening it doesn\'t fold the group');
    await page.click('#sortMenu [data-sort="az"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await namesIn(page, 'Frequency')) === JSON.stringify(['Word List (1-500)', 'Word List (501-1000)', 'Word List (1001-1500)']), 'A → Z puts numbers in order: 1-500, 501-1000, 1001-1500');
    ok(!(await menuOpen(page)) && (await toastTxt(page)) === 'Lists sorted by name (A → Z). Undo', 'the menu closes; a note says "Lists sorted by name (A → Z)." with Undo');
    ok(JSON.stringify(await namesIn(page, 'Psychology')) === JSON.stringify(['Emotions 2', 'Emotions 1']) && JSON.stringify((await getS(page)).lists.filter(l => l.group !== 'Frequency').map(l => l.name)) === JSON.stringify(before.lists.filter(l => l.group !== 'Frequency').map(l => l.name)), 'other groups and lists stay where they were');
    ok(JSON.stringify((await getS(page)).lists.map(l => l.name)) === JSON.stringify(['Word List (1-500)', 'Word List (501-1000)', 'Emotions 2', 'Word List (1001-1500)', 'Emotions 1', 'Loose', 'Old B', 'Old A']), 'the new order is saved (the lists swap into the same places)');
    await page.click('#sortUndo'); await page.waitForTimeout(200);
    ok(JSON.stringify((await getS(page)).lists.map(l => l.name)) === JSON.stringify(before.lists.map(l => l.name)) && JSON.stringify(await namesIn(page, 'Frequency')) === JSON.stringify(['Word List (1001-1500)', 'Word List (1-500)', 'Word List (501-1000)']), 'Undo brings back the order you had, saved');
    ok((await toastTxt(page)) === 'Back to the order you had.', '…and says "Back to the order you had."');
    await page.click(sortBtn('Frequency')); await page.click('#sortMenu [data-sort="za"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await namesIn(page, 'Frequency')) === JSON.stringify(['Word List (1001-1500)', 'Word List (501-1000)', 'Word List (1-500)']), 'Z → A');
    await page.click('.subgroup:has(.nm:text-is("Frequency")) .listcard:has-text("Word List (1-500)") [data-a="up"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await namesIn(page, 'Frequency')) === JSON.stringify(['Word List (1001-1500)', 'Word List (1-500)', 'Word List (501-1000)']), 'after sorting, ↑ still moves a list by hand');
    ok((await toastTxt(page)) === '', 'moving something by hand ends the Undo');
    await page.click(sortBtn('Frequency')); await page.click('#sortMenu [data-sort="za"]'); await page.waitForTimeout(150);
    await page.click(sortBtn('Frequency')); await page.click('#sortMenu [data-sort="za"]'); await page.waitForTimeout(150);
    ok((await toastTxt(page)) === 'Already in that order: name (Z → A).', 'sorting an already sorted group says so, without Undo');
    await page.reload(); await page.waitForTimeout(400);
    ok(JSON.stringify(await namesIn(page, 'Frequency')) === JSON.stringify(['Word List (1001-1500)', 'Word List (501-1000)', 'Word List (1-500)']), 'the sorted order is still there after reloading');
    // the menu closes: Escape (focus back on the button), a tap outside, a second tap, or another sort button
    await page.click(sortBtn('Psychology')); await page.waitForTimeout(100);
    await page.keyboard.press('Escape'); await page.waitForTimeout(80);
    ok(!(await menuOpen(page)) && await page.evaluate(() => document.activeElement && document.activeElement.dataset.ga === 'sort'), 'Escape closes the menu and puts focus back on the button');
    await page.click(sortBtn('Psychology')); await page.waitForTimeout(100);
    await page.mouse.click(30, 300); await page.waitForTimeout(100);
    ok(!(await menuOpen(page)) && JSON.stringify(await namesIn(page, 'Psychology')) === JSON.stringify(['Emotions 2', 'Emotions 1']) && (await toastTxt(page)) === '', 'a tap outside closes it without sorting');
    await page.click(sortBtn('Psychology')); await page.waitForTimeout(80); await page.click(sortBtn('Psychology')); await page.waitForTimeout(80);
    ok(!(await menuOpen(page)), 'a second tap on the button closes it');
    await page.click(sortBtn('Psychology')); await page.waitForTimeout(80); await page.click('.fhead[data-fk="learn"] .fsort'); await page.waitForTimeout(100);
    ok(await menuOpen(page) && (await page.textContent('#sortTitle')) === 'Sort the groups in Student' && await page.$$eval('.srt.on', e => e.length) === 1, 'another sort button switches the menu over');
    ok(!(await page.$eval('.fhead[data-fk="learn"]', h => h.classList.contains('collapsed'))), '…and opening it doesn\'t fold Student');
    await page.keyboard.press('Escape');
    await page.focus(sortBtn('Psychology')); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
    ok(await menuOpen(page) && await page.evaluate(() => document.activeElement && document.activeElement.dataset.sort === 'az'), 'with the keyboard: Enter opens the menu, focus on the first choice');
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    ok(JSON.stringify(await namesIn(page, 'Psychology')) === JSON.stringify(['Emotions 1', 'Emotions 2']), '…and Enter sorts');
    await page.click('[data-a="study"]'); await page.waitForTimeout(250);
    ok((await toastTxt(page)) === '', 'starting a session ends the Undo');
    await ctx.close();
  }
  {
    const t0 = new Date(2026, 0, 10).getTime();
    const st = state([L32('B made 2nd', 'G', 'learn', { created: t0 + 2e6 }), L32('A undated', 'G', 'learn'), L32('C made 3rd', 'G', 'learn', { created: t0 + 3e6 }), L32('D made 1st', 'G', 'learn', { created: t0 + 1e6 }), L32('E undated', 'G', 'learn')]);
    const { ctx, page } = await freshD(st);
    await page.click(sortBtn('G')); await page.waitForTimeout(100);
    ok(/Lists created before V24\.4 count as oldest; lists you never practised go last\./.test(await page.textContent('#sortMenu .snote')), 'the menu says lists created before V24.4 count as oldest, never-practised ones go last');
    await page.click('#sortMenu [data-sort="new"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await namesIn(page, 'G')) === JSON.stringify(['C made 3rd', 'B made 2nd', 'D made 1st', 'A undated', 'E undated']), 'Newest first; lists without a date count as oldest (and keep their order)');
    await page.click(sortBtn('G')); await page.click('#sortMenu [data-sort="old"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await namesIn(page, 'G')) === JSON.stringify(['A undated', 'E undated', 'D made 1st', 'B made 2nd', 'C made 3rd']), 'Oldest first');
    ok((await toastTxt(page)) === 'Lists sorted by date created (oldest first). Undo', 'the note names the sort: "date created (oldest first)"');
    await ctx.close();
  }
  {
    const hourAgo = Date.now() - 3600e3;
    const st = state([L32('Never 1', 'P', 'learn'), Object.assign(list('Fresh', [word('f', 'F')]), { group: 'P', practisedAt: hourAgo }), Object.assign(list('Stale', [word('s', 'S', { days: ['2026-1-5'] })]), { group: 'P' }), L32('Never 2', 'P', 'learn'), Object.assign(list('Mid', [word('m', 'M')]), { group: 'P', completions: ['2026-6-1'] }), Object.assign(list('Revisited', [word('r', 'R', { days: ['2026-2-1'], rv: '2026-8-9' })]), { group: 'P' })]);
    const { ctx, page } = await freshD(st);
    await page.click(sortBtn('P')); await page.click('#sortMenu [data-sort="stale"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await namesIn(page, 'P')) === JSON.stringify(['Stale', 'Mid', 'Revisited', 'Fresh', 'Never 1', 'Never 2']), 'Longest ago first: from mastered days, finished days and Revisit; never-practised lists go last');
    await page.click(sortBtn('P')); await page.click('#sortMenu [data-sort="fresh"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await namesIn(page, 'P')) === JSON.stringify(['Fresh', 'Revisited', 'Mid', 'Stale', 'Never 1', 'Never 2']), 'Most recent first; never-practised lists still go last');
    await ctx.close();
  }
  {
    const now = Date.now();
    const st = state([L32('z1', 'Zeta', 'learn', { created: 5000 }), L32('u1', '', 'learn', { created: 9000, practisedAt: now }), L32('a1', 'alpha', 'learn', { created: 1000, practisedAt: now - 600e3 }), L32('b1', 'Beta', 'learn', { created: 3000 }), Object.assign(list('b2', [word('q', 'Q', { days: ['2026-3-3'] })]), { group: 'Beta', created: 8000 })]);
    st.groupOrder = { learn: ['Zeta', 'Ungrouped', 'alpha', 'Beta'], learned: [] };
    const { ctx, page } = await freshD(st);
    ok(JSON.stringify(await groupNames(page, 'learn')) === JSON.stringify(['Zeta', 'Ungrouped', 'alpha', 'Beta']), '(groups start as Zeta, Ungrouped, alpha, Beta)');
    await page.click('.fhead[data-fk="learn"] .fsort'); await page.waitForTimeout(100);
    ok(/Ungrouped stays last/.test(await page.textContent('#sortMenu')), 'the groups menu says Ungrouped stays last');
    await page.click('#sortMenu [data-sort="az"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await groupNames(page, 'learn')) === JSON.stringify(['alpha', 'Beta', 'Zeta', 'Ungrouped']) && JSON.stringify((await getS(page)).groupOrder.learn) === JSON.stringify(['alpha', 'Beta', 'Zeta', 'Ungrouped']), 'Student\'s button sorts its groups A → Z (capitals don\'t matter), Ungrouped last; saved');
    ok((await toastTxt(page)) === 'Groups sorted by name (A → Z). Undo', 'the note says "Groups sorted…"');
    await page.click('.fhead[data-fk="learn"] .fsort'); await page.click('#sortMenu [data-sort="new"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await groupNames(page, 'learn')) === JSON.stringify(['Zeta', 'Beta', 'alpha', 'Ungrouped']), 'Newest first: a group is as old as its oldest list');
    await page.click('.fhead[data-fk="learn"] .fsort'); await page.click('#sortMenu [data-sort="fresh"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await groupNames(page, 'learn')) === JSON.stringify(['alpha', 'Beta', 'Zeta', 'Ungrouped']), 'Most recent first: a group goes by its latest practice; never practised last');
    await page.click('#sortUndo'); await page.waitForTimeout(200);
    ok(JSON.stringify(await groupNames(page, 'learn')) === JSON.stringify(['Zeta', 'Beta', 'alpha', 'Ungrouped']), 'Undo works for groups too');
    await page.click('.subgroup:has(.nm:text-is("Zeta")) [data-ga="down"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await groupNames(page, 'learn')) === JSON.stringify(['Beta', 'Zeta', 'alpha', 'Ungrouped']), 'after sorting, ▼ still moves a group by hand');
    await ctx.close();
  }
  {
    const st = state([L32('b10', '', 'learn'), L32('a1', '', 'learn'), L32('b2', '', 'learn'), L32('m1', '', 'learned')]);
    const { ctx, page } = await freshD(st);
    ok(!(await page.$('.subgroup')) && !!(await page.$('.fhead[data-fk="learn"] .fsort')) && !(await page.$('.fhead[data-fk="learned"] .fsort')), 'a folder without groups: the button sorts its lists (not shown for a single list)');
    await page.click('.fhead[data-fk="learn"] .fsort'); await page.waitForTimeout(100);
    ok((await page.textContent('#sortTitle')) === 'Sort the lists in Student', '"Sort the lists in Student"');
    await page.click('#sortMenu [data-sort="az"]'); await page.waitForTimeout(200);
    ok(JSON.stringify(await page.$$eval('#learnWrap .listcard .name', e => e.map(x => x.textContent))) === JSON.stringify(['a1', 'b2', 'b10']), 'its lists sorted A → Z: a1, b2, b10');
    await ctx.close();
  }
  {
    const ss = sstate([slist('S c', [word('Ik ben thuis.', 'Ich bin zu Hause.')], { group: 'Zinnen' }), slist('S a', [word('Ik ben hier.', 'Ich bin hier.')], { group: 'Zinnen' })]);
    ss.lists = [L32('W2', 'Woorden', 'learn'), L32('W1', 'Woorden', 'learn')];
    const { ctx, page } = await freshD(ss);
    await page.click(sortBtn('Zinnen')); await page.click('#sortMenu [data-sort="az"]'); await page.waitForTimeout(200);
    const S2 = await getS(page);
    ok(JSON.stringify(await namesIn(page, 'Zinnen')) === JSON.stringify(['S a', 'S c']) && JSON.stringify(S2.sLists.map(l => l.name)) === JSON.stringify(['S a', 'S c']) && JSON.stringify(S2.lists.map(l => l.name)) === JSON.stringify(['W2', 'W1']), 'the Sentence Dojo sorts its own lists; the Word Dojo\'s stay put');
    await page.click('[data-dojo="word"]'); await page.waitForTimeout(250);
    ok((await toastTxt(page)) === '', 'switching dojos ends the Undo');
    await ctx.close();
  }
  {
    // new lists keep the time they were made; every answer stamps the time on its list (also from Rivals)
    const st = state([list('Practise me', [word('huis', 'Haus'), word('kaas', 'Käse')]), Object.assign(list('Rival home', [word('boom', 'Baum', { hard: true })]), { group: 'R' })]);
    const { ctx, page } = await freshD(st);
    const t1 = Date.now();
    await page.click('#addBtn'); await page.waitForTimeout(150);
    await page.fill('#listName', 'Made today'); await page.fill('#listArea', 'fiets = Fahrrad'); await page.click('#listSave'); await page.waitForTimeout(250);
    let s = await getS(page); const made = s.lists.find(l => l.name === 'Made today');
    ok(made && typeof made.created === 'number' && made.created >= t1 - 5 && made.created <= Date.now() + 5, '+ New list: the list keeps the time it was made');
    ok(!s.lists.find(l => l.name === 'Practise me').created, 'older lists get no made-up date');
    await page.click('#gwBtn'); await page.waitForTimeout(150);
    await page.fill('#gwPaste', 'de tafel = der Tisch\nde stoel = der Stuhl'); await page.fill('#gwName', 'From Get words'); await page.waitForTimeout(120);
    await page.click('#gwCreate'); await page.waitForTimeout(300);
    s = await getS(page);
    ok(typeof (s.lists.find(l => l.name === 'From Get words') || {}).created === 'number', 'Get words: the new list keeps its date too');
    await page.click('.listcard:has-text("Practise me") [data-a="study"]'); await page.waitForTimeout(250);
    const t2 = Date.now();
    await typeEnter(page, 'xyz'); await page.waitForTimeout(150);
    s = await getS(page);
    ok((s.lists.find(l => l.name === 'Practise me').practisedAt || 0) >= t2 - 5, 'one answer (even a wrong one) stamps "last practised" on the list');
    await page.click('#backBtn'); await page.waitForTimeout(300);
    await page.click('#hardGo'); await page.waitForTimeout(250);
    const t3 = Date.now();
    await typeEnter(page, 'boom'); await page.waitForTimeout(150);
    s = await getS(page);
    ok((s.lists.find(l => l.name === 'Rival home').practisedAt || 0) >= t3 - 5, 'a Rivals answer stamps the list the word comes from');
    await ctx.close();
  }
  {
    const ss = sstate([slist('Zin', [word('Ik ben hier.', 'Ich bin hier.')])]);
    const { ctx, page } = await freshD(ss);
    await page.click('[data-a="study"]'); await page.waitForTimeout(350);
    const t = Date.now();
    await build(page, ['ik', 'ben', 'hier']); await page.click('#go'); await page.waitForTimeout(200);
    const s = await getS(page);
    ok(/^Correct/.test(await fbT(page)) && (s.sLists[0].practisedAt || 0) >= t - 5, 'Sentence Dojo: building a sentence stamps "last practised" too');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(FILE); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(400);
    await page.click('#wlSkip'); await page.waitForTimeout(150);
    const s = await getS(page);
    ok(!!s && typeof s.lists[0].created === 'number' && typeof s.sLists[0].created === 'number', 'a new user\'s sample lists have a date created');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('H', [word('huis', 'Haus')])]));
    await page.click('#helpBtnHdr'); await page.waitForTimeout(80);
    await page.click('#helpNav [data-help="lists"]'); await page.waitForTimeout(60);
    const h = await page.textContent('#helpBody');
    ok(!!(await page.$('#hSort .help-ico.srtico svg')) && /next to a group's name it sorts that group's lists/.test(h) && /next to Student or Master it sorts their groups/.test(h), 'Help → Your lists shows the sort button and what it sorts');
    ok(/1-500 comes before 501-1000/.test(h) && /date created/.test(h) && /last practised/.test(h) && /either way round/.test(h) && /Undo/.test(h) && /Lists created before V24\.4 count as oldest/.test(h) && /never practised go last/.test(h) && !/lopen|nahe|wassen/.test(h), 'Help explains the three sorts, Undo, undated and never-practised lists');
    await ctx.close();
  }
  {
    // phone: the menu stays on screen next to Student's button, and a menu low on the page stays reachable
    const st = state([L32('A', 'G1', 'learn'), L32('B', 'G1', 'learn'), L32('C', 'G2', 'learn'), L32('D', 'G2', 'learn'), L32('E', 'G3', 'learned'), L32('F', 'G3', 'learned'), L32('G', 'G4', 'learned'), L32('H', 'G4', 'learned')]);
    const { ctx, page } = await freshD(st, { width: 390, height: 844 });
    await page.click('.fhead[data-fk="learn"] .fsort'); await page.waitForTimeout(120);
    let r = await page.$eval('#sortMenu', m => { const b = m.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, vw: document.documentElement.clientWidth, vh: innerHeight }; });
    ok(r.l >= 7 && r.r <= r.vw - 7 && r.t >= 0 && r.b <= r.vh, 'phone: the menu fits on the screen (' + Math.round(r.l) + '–' + Math.round(r.r) + ' of ' + r.vw + ')');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));
    const lastBtn = sortBtn('G4');
    await page.evaluate(sel => { const b = document.querySelector(sel); window.scrollBy(0, b.getBoundingClientRect().top - innerHeight + 40); }, '.subgroup:nth-last-child(1) [data-ga="sort"]');
    await page.click(lastBtn); await page.waitForTimeout(150);
    r = await page.$eval('#sortMenu', m => { const b = m.getBoundingClientRect(); return { t: b.top, b: b.bottom, vh: innerHeight }; });
    ok(r.t >= 0 && r.b <= r.vh + 1, 'a menu opened at the bottom of the screen is fully visible');
    await page.click('#sortMenu [data-sort="za"]'); await page.waitForTimeout(200);
    r = await page.$eval('#sortToast', t => { const b = t.getBoundingClientRect(); return { l: b.left, r: b.right, vw: document.documentElement.clientWidth, b: b.bottom, vh: innerHeight }; });
    ok(r.l >= 0 && r.r <= r.vw && r.b <= r.vh, 'phone: the Undo note fits on the screen');
    await ctx.close();
  }

  console.log('\n[33] V24.5: pasted lists that lost their line breaks (phones) never become one giant card');
  const P33 = ['le marché = der Markt, der Wochenmarkt', "faire les courses = einkaufen gehen", 'un rendez-vous = eine Verabredung', 'une fourchette (am Tisch) = die Gabel'];
  const N33 = P33.map((x, i) => (i + 1) + '. ' + x);
  {
    const { ctx, page } = await freshD(state([list('Have', [word('huis', 'Haus')])]));
    const paste = async txt => { await page.fill('#gwPaste', txt); await page.waitForTimeout(150); return { sum: (await page.textContent('#gwSum')).replace(/\s+/g, ' ').trim(), off: await page.$eval('#gwCreate', b => b.disabled), warn: await page.$eval('#gwDups', d => (d.querySelector('#gwGlued') || {}).textContent || '') }; };
    await page.click('#gwBtn'); await page.waitForTimeout(120);
    let r = await paste(P33.join(' '));
    ok(/^4 new/.test(r.sum) && !r.off && !r.warn, 'a phone copy with line separators (U+2028) → 4 new (V24.4 said "1 new")');
    r = await paste(P33.join(' '));
    ok(/^4 new/.test(r.sum) && !r.off, '…paragraph separators (U+2029) count too');
    r = await paste(N33.join(' '));
    ok(/^4 new/.test(r.sum) && !r.off && !r.warn, 'line breaks lost, but the lines are numbered → split at the numbers: 4 new');
    r = await paste(P33.join(' '));
    ok(/^0 new/.test(r.sum) && r.off && /This arrived as one long line/.test(r.warn) && /tap the Copy button on its code box/.test(r.warn), 'one long line without numbers → "This arrived as one long line…" and Create is off (no giant card)');
    r = await paste(P33.slice(0, 3).join('\n') + '\nun ami = der Freund une amie = die Freundin');
    ok(/^3 new/.test(r.sum) && r.off && /1 line holds several word pairs/.test(r.warn), 'one glued line among good ones → named, and Create stays off until it\'s fixed');
    r = await paste(P33.slice(0, 3).join('\n') + '\nun ami = der Freund\nune amie = die Freundin');
    ok(/^5 new/.test(r.sum) && !r.off && !r.warn, 'putting each pair on its own line clears the warning');
    await page.fill('#gwLearn', 'French'); await page.fill('#gwMeaning', 'German'); await page.waitForTimeout(80);
    const pr = await page.inputValue('#gwPrompt');
    ok(/Number the lines \(1\. 2\. 3\. …\) and put them all in one code block/.test(pr) && /only the numbered lines/.test(pr) && !/No numbering/.test(pr), 'the prompt asks for numbered lines in one code block');
    ok(/Copy button on its code box/.test(await page.getAttribute('#gwPaste', 'placeholder')), 'the paste box says to copy with the code box\'s Copy button');
    r = await paste('Here you go: ```text ' + N33.join(' ') + ' ```');
    ok(r.sum === '4 new · 1 other line ignored' && !r.off, 'a whole message copied with separators: the fences drop out, the intro is the 1 other line, 4 new');
    r = await paste('```text ' + N33.join(' ') + ' ```');
    ok(/^4 new/.test(r.sum) && !r.off, 'numbered lines and code fences glued into one line → still 4 new');
    await page.fill('#gwName', 'Rescued'); await page.click('#gwCreate'); await page.waitForTimeout(300);
    const made = (await getS(page)).lists.find(l => l.name === 'Rescued');
    ok(!!made && JSON.stringify(made.words.map(w => w.nl + ' = ' + w.de)) === JSON.stringify(P33), 'the four cards come out clean: no numbers, no backticks');
    await ctx.close();
  }
  {
    const ss = sstate([slist('Have', [word('Ik ben hier.', 'Ich bin hier.')])]);
    const { ctx, page } = await freshD(ss);
    await page.click('#gwBtn'); await page.waitForTimeout(120);
    const SN = ['1. Ik ga morgen naar huis. / Morgen ga ik naar huis. = Ich gehe morgen nach Hause.', '2. Zij leest een boek. = Sie liest ein Buch.', '3. Wij wonen in Groningen. = Wir wohnen in Groningen.'];
    await page.fill('#gwPaste', SN.join(' ')); await page.waitForTimeout(150);
    ok(/^3 new/.test((await page.textContent('#gwSum')).trim()) && !(await page.$eval('#gwCreate', b => b.disabled)), 'Get sentences: numbered sentences that lost their line breaks → 3 new');
    await page.fill('#gwName', 'Zinnen'); await page.click('#gwCreate'); await page.waitForTimeout(300);
    const z = (await getS(page)).sLists.find(l => l.name === 'Zinnen');
    ok(!!z && z.words.length === 3 && z.words[0].nl === 'Ik ga morgen naar huis. / Morgen ga ik naar huis.' && z.words[2].de === 'Wir wohnen in Groningen.', '…each sentence its own card, other word order kept');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('Have', [word('huis', 'Haus')])]));
    const count = async () => (await page.textContent('#listCount')).replace(/\s+/g, ' ').trim();
    await page.click('#addBtn'); await page.waitForTimeout(120);
    await page.fill('#listName', 'Separators'); await page.fill('#listArea', P33.join(' ')); await page.waitForTimeout(80);
    ok(await count() === '4 words', '+ New list: line separators count as line breaks ("4 words")');
    await page.click('#listSave'); await page.waitForTimeout(250);
    let S5 = await getS(page);
    ok(JSON.stringify((S5.lists.find(l => l.name === 'Separators') || { words: [] }).words.map(w => w.nl + ' = ' + w.de)) === JSON.stringify(P33), '…and saves four cards');
    await page.click('#addBtn'); await page.waitForTimeout(120);
    await page.fill('#listName', 'Glued'); await page.fill('#listArea', P33.join(' ')); await page.waitForTimeout(80);
    ok(await count() === '0 words · 1 line holds several pairs' && await page.$eval('#listCount .lc-warn', e => getComputedStyle(e).color) === 'rgb(176, 60, 35)', 'a glued line is flagged in the counter, in vermilion');
    lastDialog = '';
    await page.click('#listSave'); await page.waitForTimeout(200);
    S5 = await getS(page);
    ok(/One line holds several pairs/.test(lastDialog) && /one giant card/.test(lastDialog) && /AI's Copy button/.test(lastDialog) && !S5.lists.some(l => l.name === 'Glued') && await page.$eval('#listOverlay', o => o.classList.contains('open')), 'saving it explains what happened, saves nothing and keeps the editor open');
    await page.fill('#listArea', N33.join(' ')); await page.waitForTimeout(80);
    ok(await count() === '4 words', 'numbered pairs glued into one line → split at the numbers ("4 words")');
    await page.click('#listSave'); await page.waitForTimeout(250);
    S5 = await getS(page);
    ok(JSON.stringify((S5.lists.find(l => l.name === 'Glued') || { words: [] }).words.map(w => w.nl + ' = ' + w.de)) === JSON.stringify(P33), '…saved as four clean cards (numbers gone)');
    await page.click('#addBtn'); await page.waitForTimeout(120);
    await page.fill('#listName', 'Numbered'); await page.fill('#listArea', N33.join('\n')); await page.click('#listSave'); await page.waitForTimeout(250);
    S5 = await getS(page);
    ok(JSON.stringify((S5.lists.find(l => l.name === 'Numbered') || { words: [] }).words.map(w => w.nl)) === JSON.stringify(P33.map(x => x.split(' = ')[0])), 'a pasted list numbered throughout loses its numbers');
    await page.click('#addBtn'); await page.waitForTimeout(120);
    await page.fill('#listName', 'One date'); await page.fill('#listArea', '1. Mai = der erste Mai\nzon = Sonne'); await page.click('#listSave'); await page.waitForTimeout(250);
    S5 = await getS(page);
    ok(JSON.stringify((S5.lists.find(l => l.name === 'One date') || { words: [] }).words.map(w => w.nl)) === JSON.stringify(['1. Mai', 'zon']), '…but a single word that starts with a number keeps it');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('H', [word('huis', 'Haus')])]));
    await page.click('#helpBtnHdr'); await page.waitForTimeout(80);
    await page.click('#helpNav [data-help="get"]'); await page.waitForTimeout(60);
    const h = await page.textContent('#helpBody');
    ok(/numbers its lines and puts them in a box/.test(h) && /Copy button rather than selecting the text/.test(h) && /one giant card/.test(h), 'Help → Get words: copy with the box\'s Copy button; what happens if the line breaks get lost');
    await ctx.close();
  }
  console.log('\n[33b] V24.5: a safety net for other AIs\' habits — tables, markup, arrows, quotes, invisible characters');
  {
    const { ctx, page } = await freshD(state([list('Have', [word('huis', 'Haus')])], { strictSpelling: true }));
    const gw = async (txt, name) => {
      await page.click('#gwBtn'); await page.waitForTimeout(100);
      await page.fill('#gwTopic', name); await page.fill('#gwPaste', txt); await page.waitForTimeout(150);
      const sum = (await page.textContent('#gwSum')).replace(/\s+/g, ' ').trim();
      const warn = await page.$eval('#gwDups', d => [...d.querySelectorAll('.gwwarn')].map(x => x.id + ':' + x.textContent).join(' '));
      if (await page.$eval('#gwCreate', b => b.disabled)) { await page.click('#gwClose'); await page.waitForTimeout(80); return { sum, warn, cards: null }; }
      await page.fill('#gwName', name); await page.click('#gwCreate'); await page.waitForTimeout(250);
      const l = (await getS(page)).lists.find(x => x.name === name);
      return { sum, warn, cards: l ? l.words.map(w => w.nl + ' = ' + w.de) : null };
    };
    const same = (r, arr) => !!r.cards && JSON.stringify(r.cards) === JSON.stringify(arr);
    let r = await gw('| French | German |\n|---|---|\n| le chat | die Katze |\n| le chien | der Hund |', 'T1');
    ok(same(r, ['le chat = die Katze', 'le chien = der Hund']), 'a Markdown table → one card per row; the header row is skipped');
    r = await gw('| # | Französisch | Deutsch |\n|:-:|:--|--:|\n| 1 | la maison | das Haus |\n| 2 | le jardin | der Garten |', 'T2');
    ok(same(r, ['la maison = das Haus', 'le jardin = der Garten']), '…also with a number column and alignment marks in the divider');
    r = await gw('1\tla porte\tdie Tür\n2\tla fenêtre\tdas Fenster', 'T3');
    ok(same(r, ['la porte = die Tür', 'la fenêtre = das Fenster']), 'tab-separated columns (a table copied as text) → cards, number column dropped');
    r = await gw('1. **le pain** = das Brot\n**2. le beurre** = die Butter\n*le lait* = _die Milch_\n- 3. le sel = das Salz', 'T4');
    ok(same(r, ['le pain = das Brot', 'le beurre = die Butter', 'le lait = die Milch', 'le sel = das Salz']), 'bold, italics, numbers inside bold and "- 1." are all cleaned off');
    r = await gw('🔹 la pomme = der Apfel\n✅ la poire = die Birne\n1️⃣ la cerise = die Kirsche\n➡️ la prune = die Pflaume', 'T5');
    ok(same(r, ['la pomme = der Apfel', 'la poire = die Birne', 'la cerise = die Kirsche', 'la prune = die Pflaume']), 'emoji bullets (🔹 ✅ 1️⃣ ➡️) are cleaned off');
    r = await gw('le train → der Zug\nle bus -> der Bus\nle vélo => das Fahrrad', 'T6');
    ok(same(r, ['le train = der Zug', 'le bus = der Bus', 'le vélo = das Fahrrad']), 'arrows (→ -> =>) work instead of "="');
    r = await gw('"le livre" = "das Buch"\n„la page“ = „die Seite“\n«le stylo» = «der Stift»\nla gomme = der Radiergummi,\nla règle = das Lineal;', 'T7');
    ok(same(r, ['le livre = das Buch', 'la page = die Seite', 'le stylo = der Stift', 'la gomme = der Radiergummi', 'la règle = das Lineal']), 'quotes around words and a trailing , or ; are dropped');
    r = await gw('你好 ＝ hello\n谢谢　＝　thank you', 'T8');
    ok(same(r, ['你好 = hello', '谢谢 = thank you']), 'the wide ＝ (and wide spaces) of Chinese/Japanese keyboards work');
    r = await gw('le dé\u200Bsir = das Ver\u00ADlangen\nle re\u0302ve = der Traum', 'T9');
    ok(same(r, ['le désir = das Verlangen', 'le r\u00eave = der Traum']) && r.cards[1].charCodeAt(4) === 0xEA, 'invisible characters are removed and accents stored in one form (e + ^ → ê, U+00EA)');
    r = await gw('le soleil\nder Sonne\nla lune', 'T10');
    ok(r.cards === null && /gwNone:No line here looks like “word = meaning”/.test(r.warn), 'nothing with the right shape → "No line here looks like “word = meaning”", nothing created');
    r = await gw('le ciel → der Himmel la mer → das Meer', 'T11');
    ok(r.cards === null && /gwGlued/.test(r.warn), 'arrow pairs glued into one line are caught too');
    // the point of it: a card pasted with a decomposed accent can be answered with exact accents on
    await page.click('.listcard:has-text("T9") [data-a="study"]'); await page.waitForTimeout(300);
    const t9 = { 'das Verlangen': 'le désir', 'der Traum': 'le rêve' };
    const p1 = await term(page); await typeEnter(page, t9[p1]); await page.waitForTimeout(150);
    ok(!/Not quite/.test(await fb(page)), 'with exact accents on, typing "' + t9[p1] + '" counts as right');
    await ctx.close();
  }
  {
    // cards saved before V24.5 with invisible characters or decomposed accents are repaired on opening, and in backups
    const bad = Object.assign(list('Old paste', [word('le re\u0302ve\u200B', 'der Traum'), word('la nuit', 'die Nacht')]), {});
    const { ctx, page } = await freshD(state([bad]));
    const w0 = (await getS(page)).lists[0].words[0];
    ok(w0.nl === 'le rêve' && w0.nl.length === 7, 'an old card with a zero-width space and a decomposed ê is repaired on opening (and saved)');
    require('fs').writeFileSync(path.join(require('os').tmpdir(), 'v245_backup.json'), JSON.stringify(state([list('From backup', [word('la plénitude', 'die Fülle')])])));
    await page.click('#setBtnHdr'); await page.waitForTimeout(120);
    await page.setInputFiles('#importFile', path.join(require('os').tmpdir(), 'v245_backup.json')); await page.waitForTimeout(500);
    ok((await getS(page)).lists[0].words[0].nl === 'la plénitude', '…and so is a card in an imported backup');
    await ctx.close();
  }
  {
    const { ctx, page } = await freshD(state([list('Edit me', [word('la clé', 'der Schlüssel'), word('la porte', 'die Tür')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await page.click('#editBtn'); await page.waitForTimeout(150);
    await page.fill('#cardMeaning', 'der Schlüssel = the key'); await page.click('#cardSave'); await page.waitForTimeout(120);
    ok(/The meaning can't contain “=” either/.test(await page.textContent('#cardErr')), 'the card editor refuses "=" in the meaning too (it would split the card in two)');
    await page.fill('#cardMeaning', 'der Schlüssel ＝ the key'); await page.click('#cardSave'); await page.waitForTimeout(120);
    ok(/The meaning can't contain “=” either/.test(await page.textContent('#cardErr')), '…the wide ＝ as well');
    await page.click('#cardCancel'); await page.waitForTimeout(80);
    await page.click('#backBtn'); await page.waitForTimeout(250);
    await page.click('#addBtn'); await page.waitForTimeout(120);
    await page.fill('#listName', 'Wide'); await page.fill('#listArea', '你好 ＝ hello\nle gâteau = der Kuchen​'); await page.click('#listSave'); await page.waitForTimeout(250);
    const wl = (await getS(page)).lists.find(l => l.name === 'Wide');
    ok(!!wl && JSON.stringify(wl.words.map(w => w.nl + ' = ' + w.de)) === JSON.stringify(['你好 = hello', 'le gâteau = der Kuchen']), '+ New list: the wide ＝ works, invisible characters go, accents in one form');
    await ctx.close();
  }

  console.log('\n[34] V24.6: phones (iPhone and Android sizes): no zoom, the page behind stays put, full-screen windows with ×; "Date created"; ( ) as hint and optional');
  const { devices: DEV } = require('playwright');
  async function phone34(kind, st) {
    const o = Object.assign({}, DEV[kind === 'android' ? 'Pixel 7' : 'iPhone 14']); delete o.defaultBrowserType;
    const ctx = await browser.newContext(o); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('dialog', d => { lastDialog = d.message(); d.accept(); });
    await page.goto(FILE); await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, st]); await page.reload(); await page.waitForTimeout(350);
    return { ctx, page };
  }
  const smallFields = page => page.evaluate(() => [...document.querySelectorAll('input,select,textarea')].filter(e => !['file', 'checkbox', 'hidden'].includes(e.type) && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => (e.id || e.className) + ' ' + getComputedStyle(e).fontSize));
  const box = (page, sel) => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  const locked = page => page.evaluate(() => document.documentElement.classList.contains('modal-open') && getComputedStyle(document.documentElement).overflow === 'hidden');
  for (const kind of ['iphone', 'android']) {
    const tag = kind === 'iphone' ? 'iPhone size' : 'Android (Pixel 7)';
    const st = state([Object.assign(list('Frequency 1', [word('huis', 'Haus'), word('kaas', 'Käse')]), { group: 'Frequency' }), Object.assign(list('Frequency 2', [word('boom', 'Baum')]), { group: 'Frequency' }), Object.assign(list('Done', [word('zon', 'Sonne', { days: ['2026-1-2'] })]), { folder: 'learned' })]);
    const { ctx, page } = await phone34(kind, st);
    await page.click('#rvPick'); await page.waitForTimeout(150);
    let small = await smallFields(page);
    ok(small.length === 0, tag + ': no text box or menu under 16 px, so iPhone Safari never zooms in' + (small.length ? ' — ' + small.join(', ') : ''));
    await page.evaluate(() => window.scrollTo(0, 220)); await page.waitForTimeout(100);
    const y0 = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => document.getElementById('addBtn').click()); await page.waitForTimeout(250);
    ok(Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 2, tag + ': opening a window keeps the library where it was');
    let m = await box(page, '#listOverlay .modal');
    ok(Math.abs(m.l) < 1 && Math.abs(m.t) < 1 && Math.abs(m.w - m.vw) < 1 && Math.abs(m.h - m.vh) < 1, tag + ': + New list fills the screen');
    ok(await locked(page), tag + ': the page behind it is locked');
    let x = await box(page, '#listOverlay .xclose');
    ok(x.r > x.vw - 20 && x.t < 40 && x.w >= 32, tag + ': a × sits in the top-right corner');
    await page.evaluate(() => { const md = document.querySelector('#listOverlay .modal'); md.scrollTop = md.scrollHeight; }); await page.waitForTimeout(150);
    const x2 = await box(page, '#listOverlay .xclose'), sv = await box(page, '#listSave');
    ok(Math.abs(x2.t - x.t) < 2 && sv.b <= sv.vh, tag + ': scrolled to the bottom, the × is still there and Save is reachable');
    await page.fill('#listName', 'Never saved'); await page.fill('#listArea', 'zee = Meer');
    await page.tap('#listOverlay .xclose'); await page.waitForTimeout(200);
    ok(!(await page.$eval('#listOverlay', o => o.classList.contains('open'))) && !(await getS(page)).lists.some(l => l.name === 'Never saved'), tag + ': tapping × closes it like Cancel (nothing saved)');
    ok(!(await page.evaluate(() => document.documentElement.classList.contains('modal-open'))) && Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 2, tag + ': the page is unlocked again, at the same spot');
    await page.evaluate(() => document.getElementById('setBtnHdr').click()); await page.waitForTimeout(250);
    await page.mouse.move(150, 400); for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(100); }
    const sc = await page.$eval('#setOverlay .modal', md => [Math.round(md.scrollTop), md.scrollHeight - md.clientHeight]);
    ok(sc[0] > 0 && Math.abs(sc[0] - sc[1]) < 2 && Math.abs((await page.evaluate(() => window.scrollY)) - y0) < 2, tag + ': scrolling past the end of a window doesn\'t move the page behind it');
    await page.tap('#setOverlay .xclose'); await page.waitForTimeout(150);
    // every window: × closes it
    const closes = [];
    await page.click('#gwBtn'); await page.waitForTimeout(150); await page.tap('#gwOverlay .xclose'); await page.waitForTimeout(150); closes.push(await page.$eval('#gwOverlay', o => !o.classList.contains('open')));
    await page.click('#setBtnHdr'); await page.waitForTimeout(150); await page.tap('#setOverlay .xclose'); await page.waitForTimeout(150); closes.push(await page.$eval('#setOverlay', o => !o.classList.contains('open')));
    await page.click('#helpBtnHdr'); await page.waitForTimeout(150); await page.tap('#helpOverlay .xclose'); await page.waitForTimeout(150); closes.push(await page.$eval('#helpOverlay', o => !o.classList.contains('open')));
    await page.click('#setBtnHdr'); await page.waitForTimeout(150); await page.click('#wnBtn'); await page.waitForTimeout(150); await page.tap('#wnOverlay .xclose'); await page.waitForTimeout(150);
    closes.push(await page.$eval('#wnOverlay', o => !o.classList.contains('open')) && await page.$eval('#setOverlay', o => o.classList.contains('open')));
    await page.tap('#setOverlay .xclose'); await page.waitForTimeout(150);
    ok(closes.every(Boolean), tag + ': × closes Get words, Settings, Help and What\'s new (What\'s new back to Settings)');
    await page.click('#addBtn'); await page.waitForTimeout(150); await page.click('#listOverlay .qmark'); await page.waitForTimeout(200);
    await page.tap('#helpOverlay .xclose'); await page.waitForTimeout(150);
    ok(await page.$eval('#listOverlay', o => o.classList.contains('open')) && await locked(page), tag + ': Help opened from the list editor\'s "?" closes back to the editor');
    await page.tap('#listOverlay .xclose'); await page.waitForTimeout(150);
    // a study card with touch: answer, then the pencil's window and its ×
    await page.tap('.listcard:has-text("Frequency 1") [data-a="study"]'); await page.waitForTimeout(350);
    const map = { 'Haus': 'huis', 'Käse': 'kaas' };
    await page.fill('#ans', map[await term(page)]); await page.tap('#go'); await page.waitForTimeout(250);
    ok(/Correct/.test(await fb(page)), tag + ': a study card answered with taps');
    await page.waitForTimeout(800);
    await page.tap('#editBtn'); await page.waitForTimeout(200);
    m = await box(page, '#cardOverlay .modal');
    await page.tap('#cardOverlay .xclose'); await page.waitForTimeout(150);
    ok(Math.abs(m.w - m.vw) < 1 && !(await page.$eval('#cardOverlay', o => o.classList.contains('open'))) && !!(await page.$('#ans')), tag + ': the card editor fills the screen too, and × takes you back to the card');
    if (kind === 'iphone') { await page.click('#backBtn'); await page.waitForTimeout(300); await page.click('#addBtn'); await page.waitForTimeout(300); await page.screenshot({ path: SHOT('shot_v246_phone_editor.png') }); }
    await ctx.close();
  }
  {
    // the computer: windows look as before (plus ×), fields keep their sizes, the page isn't locked
    const { ctx, page } = await freshD(state([list('Desk', [word('huis', 'Haus')])]));
    await page.click('#addBtn'); await page.waitForTimeout(200);
    const m = await box(page, '#listOverlay .modal'), x = await box(page, '#listOverlay .xclose'), q = await box(page, '#listOverlay .qmark'), t = await box(page, '#listTitle');
    ok(Math.round(m.w) === 520 && m.t > 10 && x.r <= m.r && x.r > m.r - 20 && x.t < m.t + 30, 'computer: the list editor stays a 520 px window, with the × in its corner');
    ok(q.l - t.r >= 0 && q.l - t.r <= 16, 'the "?" now sits right after the title (the corner is the ×\'s)');
    ok(await page.$eval('#listArea', e => getComputedStyle(e).fontSize) === '13.5px' && !(await page.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden')), 'computer: the list box keeps its size and the page isn\'t locked');
    // ( ) explained as two jobs
    const lh = (await page.textContent('#listHelp')).replace(/\s+/g, ' ');
    ok(/\( \) on the side you're asked — a hint, shown under the question: karai = hot \(spicy\) asks “hot” with the hint “spicy”/.test(lh) && /\( \) on the side you type — optional, accepted but never needed: arigatō \(gozaimasu\) = thank you/.test(lh) && !/never required/.test(lh), 'list editor: ( ) on the side you\'re asked = a hint (karai = hot (spicy)), on the side you type = optional, each with its example');
    await page.click('#listOverlay .qmark'); await page.waitForTimeout(200);
    const bx = await page.$eval('#hShorthand', e => ({ title: e.querySelector('h5').textContent, dts: [...e.querySelectorAll('dt')].map(d => d.textContent.replace(/\s+/g, ' ').trim()), txt: e.textContent }));
    ok(bx.title === 'Card shorthand' && bx.dts.length === 4 && /a hint, on the side you're asked/.test(bx.dts[2]) && /optional, on the side you type/.test(bx.dts[3]) && /karai = hot \(spicy\): you're asked “hot” with the hint “spicy”/.test(bx.txt), 'Help\'s box: four entries — the hint has its own line and example ("Card shorthand" kept)');
    await page.click('#helpOverlay .xclose'); await page.waitForTimeout(150);
    ok(await page.$eval('#listOverlay', o => o.classList.contains('open')), 'computer: × on Help returns to the list editor');
    await page.click('#listOverlay .xclose'); await page.waitForTimeout(150);
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    await page.click('#editBtn'); await page.waitForTimeout(150);
    ok(/\( \) a hint on the side you're asked, optional on the side you type/.test((await page.textContent('#cardHelp')).replace(/\s+/g, ' ')), 'the card editor\'s line says the same');
    await page.click('#cardOverlay .xclose'); await page.waitForTimeout(150);
    await ctx.close();
  }
  {
    // the example in Help works as described: asked "hot", hint "spicy", answer karai
    const { ctx, page } = await freshD(state([list('Hint', [word('karai', 'hot (spicy)')])]));
    await page.click('[data-a="study"]'); await page.waitForTimeout(300);
    ok(await term(page) === 'hot' && /Hint:\s*spicy/.test(await page.textContent('.prompt-hint')), 'Help\'s example is true: "karai = hot (spicy)" asks "hot" with the hint "spicy"');
    await typeEnter(page, 'karai');
    ok(/Correct/.test(await fb(page)), '…and "karai" is the answer');
    await ctx.close();
  }

  console.log('\n[35] V25: the Grammar Dojo — Articles mode (rapid fire on the nouns in your Word Dojo lists)');
  {
    const NL = { speak: { word: { lang: 'nl-NL', auto: false }, sentence: { lang: '', auto: false } } };
    const lang = l => ({ speak: { word: { lang: l, auto: false }, sentence: { lang: '', auto: false } } });
    const dayNo = (off = 0) => { const d = new Date(); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5) + off; };
    const gItem = page => page.evaluate(() => ({ slot: document.getElementById('gSlot').textContent, f: document.getElementById('gFrame').textContent.replace(/\s+/g, ' ').trim(), n: document.querySelectorAll('#gPills .pill').length, meaning: document.getElementById('gMeaning').hidden ? '' : document.getElementById('gMeaning').textContent, count: document.getElementById('gCount').textContent }));
    // the right button for what's on the card: arts maps a noun (or "noun|meaning") to its article
    function rightIdx(it, arts, set = ['de', 'het']) {
      const a = n => arts[n + '|' + it.meaning] || arts[n];
      if (/^Article/.test(it.slot)) return set.indexOf(a(it.f));
      if (/^This \/ that/.test(it.slot)) { const m = it.f.match(/^(.*) (hier|daar)$/); return (m[2] === 'daar' ? 2 : 0) + set.indexOf(a(m[1])); }
      const m = it.f.match(/^mijn (.*?),/); return set.indexOf(a(m[1]));
    }
    const DEV35 = require('playwright').devices;
    const ready = page => page.waitForFunction(() => !document.getElementById('gFrame') || !!document.querySelector('#gPills[data-ready]'), null, { timeout: 6000 });
    async function pill(page, i) { await page.waitForSelector('#gPills[data-ready]', { timeout: 6000 }); await page.click(`#gPills .pill[data-i="${i}"]`, { force: true }); }
    const fbG = async page => ((await page.textContent('#gFb')) || '').replace(/\s+/g, ' ').trim();
    async function startRound(page, slot = 'art') { await page.click(`#gdCard [data-go="${slot}"]`); await page.waitForTimeout(30); await ready(page); }
    async function playAll(page, arts, set, wrong = () => false) {   // answers every card; returns what was shown
      const seen = []; let guard = 0;
      while (await page.$('#gFrame') && guard++ < 120) {
        const it = await gItem(page); const r = rightIdx(it, arts, set), bad = wrong(it);
        seen.push(Object.assign({ right: !bad }, it));
        await pill(page, bad ? (r === 0 ? 1 : 0) : r);
        await page.waitForTimeout(30); await ready(page);
      }
      return seen;
    }
    const gr = (S, nl) => { for (const l of S.lists) for (const w of l.words) if (w.nl === nl) return w.gr || null; return undefined; };

    // --- the tile: languages with articles only
    {
      const { ctx, page } = await freshD(state([list('Nouns', [word('de appel', 'der Apfel'), word('het huis', 'das Haus'), word('lopen', 'laufen')])], NL));
      const tiles = await page.$$eval('.dojo', e => e.map(x => x.querySelector('.dn').childNodes[0].textContent + '|' + x.querySelector('.dk').textContent + '|' + x.querySelector('.ds').textContent));
      ok(tiles.length === 3 && tiles[2] === 'Grammar Dojo|法|2 nouns' && (await page.textContent('.dojo[data-dojo="gram"] .beta')).trim() === 'beta', 'Dutch: a third tile, 法 Grammar Dojo with a beta tag, counting the nouns (2)');
      const tops = await page.$$eval('.dojo', e => e.map(x => Math.round(x.getBoundingClientRect().top)));
      ok(tops[0] === tops[1] && tops[1] === tops[2], 'the three tiles sit side by side');
      await page.click('[data-dojo="gram"]'); await page.waitForTimeout(300);
      ok((await getS(page)).dojo === 'gram' && !!(await page.$('#gdCard')) && /Rapid fire on the nouns in your Word Dojo lists/.test(await page.textContent('.lib-intro')), 'tapping it opens the Grammar Dojo (remembered), with its own intro and the Articles card');
      ok(!(await page.$('.listcard')) && !(await page.$('.hardcard')) && !(await page.$('#revCard')), 'no lists, Rivals or Revisit here');
      await page.reload(); await page.waitForTimeout(350);
      ok(!!(await page.$('#gdCard')), 'still the Grammar Dojo after a reload');
      await ctx.close();
    }
    {
      let hidden = 0;
      for (const l of ['zh-TW', 'ja-JP', 'en-GB', 'ru-RU', 'tr-TR']) {
        const { ctx, page } = await freshD(state([list('X', [word('de appel', 'der Apfel'), word('het huis', 'das Haus')])], lang(l)));
        if ((await page.$$('.dojo')).length === 2) hidden++;
        await ctx.close();
      }
      ok(hidden === 5, 'languages without articles (Chinese, Japanese, English, Russian, Turkish): no Grammar Dojo tile');
      let { ctx, page } = await freshD(state([list('X', [word('het huis', 'das Haus'), word('het boek', 'das Buch'), word('het raam', 'das Fenster'), word('de tafel', 'der Tisch')])]));
      ok((await page.$$('.dojo')).length === 3 && /4 nouns/.test(await page.textContent('.dojo[data-dojo="gram"] .ds')), 'no language chosen, but cards with "het": taken as Dutch, the tile shows');
      await ctx.close();
      // nothing chosen in Settings, but the last Get words list was French (a demo for a friend): the Dutch cards still win
      const stF = state([list('X', [word('het huis', 'das Haus'), word('het boek', 'das Buch'), word('het raam', 'das Fenster')])]); stF.gw = { learn: 'French', meaning: 'German' };
      ({ ctx, page } = await freshD(stF));
      await page.click('[data-dojo="gram"]'); await page.waitForTimeout(200);
      ok(await page.textContent('#gdCard .gd-sub') === 'de · het · deze · dit · die · dat' && !(await page.$('#gdSetup')), 'nothing chosen and a French Get words list on record: the Dutch cards still make it Dutch');
      await page.click('#setBtnHdr'); await page.waitForTimeout(150);
      ok(await page.$eval('#gLangSel', e => e.value) === 'nl-NL', '…and Settings → Grammar Dojo shows Dutch');
      await ctx.close();
      ({ ctx, page } = await freshD(state([list('X', [word('a', 'A'), word('der', 'the')])])));
      ok((await page.$$('.dojo')).length === 2, 'no language and no article cards: two tiles, as before');
      await ctx.close();
      // a saved "gram" dojo for a language without articles falls back to the Word Dojo
      const st = state([list('X', [word('de appel', 'der Apfel')])], lang('zh-CN')); st.dojo = 'gram';
      ({ ctx, page } = await freshD(st));
      ok(!!(await page.$('.listcard')) && await page.$eval('.dojo.on', e => e.dataset.dojo) === 'word', 'a saved Grammar Dojo for a language without articles opens the Word Dojo instead');
      await ctx.close();
    }
    // --- another language: type its articles in Settings
    {
      const { ctx, page } = await freshD(state([list('EL', [word('ο σκύλος', 'dog'), word('η πόρτα', 'door'), word('το σπίτι', 'house'), word('τρώω', 'eat')])], lang('el-GR')));
      ok(/Set up/.test(await page.textContent('.dojo[data-dojo="gram"] .ds')), 'Greek (no built-in articles): the tile says "Set up"');
      await page.click('[data-dojo="gram"]'); await page.waitForTimeout(250);
      ok(/Which articles does Greek have\?/.test(await page.textContent('#gdCard')) && !!(await page.$('#gdSetup')), 'the card asks which articles Greek has');
      await page.click('#gdSetup'); await page.waitForTimeout(250);
      ok(await page.$eval('#setGramPane', e => !e.hidden) && await page.evaluate(() => document.activeElement && document.activeElement.id === 'gArts') && await page.$eval('#gLabBox', e => e.hidden), '"Set the articles" opens Settings → Grammar Dojo with the field ready (no label switch: only Dutch has labels)');
      await page.fill('#gArts', 'ο η το'); await page.waitForTimeout(100);
      await page.click('#setClose'); await page.waitForTimeout(300);
      ok(/3 nouns/.test(await page.textContent('.dojo[data-dojo="gram"] .ds')) && /ο · η · το/.test(await page.textContent('#gdCard .gd-sub')), 'typed "ο η το": three nouns found, buttons ο · η · το');
      ok((await page.$$('#gdCard .gd-row')).length === 1 && /Article/.test(await page.textContent('#gdCard .gd-row')), 'own articles: the article gap only');
      await startRound(page);
      const seen = await playAll(page, { 'σκύλος': 'ο', 'πόρτα': 'η', 'σπίτι': 'το' }, ['ο', 'η', 'το']);
      ok(seen.length === 3 && seen.every(s => s.n === 3 && s.slot === 'Article') && /3 nouns done/.test(await page.textContent('.screen h2')), 'a round with ο / η / το works like de / het');
      await ctx.close();
    }
    // --- which cards count: one entry per noun, ambiguous ones out, the meaning only for het blik / de blik
    {
      const st = state([list('A', [word('de appel', 'der Apfel'), word('het huis', 'das Haus'), word('het blik', 'die Dose'), word('de blik', 'der Blick'), word('het blik / de blik', 'egal'), word('huis', 'Haus (ohne)'), word('het', 'es'), word('de bank', 'die Bank'), word('de bank', 'das Sofa'), word('het spijt me', 'es tut mir leid'), word('De Kat', 'die Katze')])], NL);
      const { ctx, page } = await freshD(st);
      ok(/7 nouns/.test(await page.textContent('.dojo[data-dojo="gram"] .ds')), 'nouns: appel, huis, het blik, de blik, bank (twice = once), spijt me, Kat — not "het blik / de blik", not "huis", not "het" alone');
      await page.click('[data-dojo="gram"]'); await page.waitForTimeout(250);
      ok(await page.textContent('#gdCard .gd-sub') === 'de · het · deze · dit · die · dat' && (await page.$$eval('#gdCard .gd-row', e => e.map(x => x.dataset.slot))).join() === 'art,dem,rel', 'Dutch: three bars (article, this/that, relative) and all six forms');
      ok(/0 of 7 automatic/.test(await page.textContent('#gdCard .gd-row')), '"0 of 7 automatic"');
      await startRound(page);
      const first = await gItem(page);
      ok(first.slot === 'Article' && first.n === 2 && first.count === '1 / 7' && /^\S/.test(first.f), 'a round: the article gap first, two buttons, "1 / 7"');
      ok(await page.$eval('#card', c => getComputedStyle(c).opacity === '1' && getComputedStyle(c).animationName === 'none'), 'the card is there at once (no fade-in in rapid fire)');
      const seen = await playAll(page, { appel: 'de', huis: 'het', 'blik|die Dose': 'het', 'blik|der Blick': 'de', bank: 'de', 'spijt me': 'het', Kat: 'de' });
      const bl = seen.filter(s => s.f === 'blik');
      ok(bl.length === 2 && bl.map(s => s.meaning).sort().join() === 'der Blick,die Dose' && seen.filter(s => s.f !== 'blik').every(s => !s.meaning), 'het blik and de blik say what they mean; other nouns show no meaning');
      ok(seen.length === 7 && seen.every(s => s.slot === 'Article'), 'one gap per noun per round (seven nouns, seven article gaps)');
      ok(/7 nouns done/.test(await page.textContent('.screen h2')) && /7 right · 7 of them fast/.test(await page.textContent('#gdSum')) && /No misses this round/.test(await page.textContent('.screen')), 'end of the round: "7 nouns done", "7 right · 7 of them fast", no misses');
      const S2 = await getS(page), td = dayNo();
      ok(new RegExp('^' + td + 'f10$').test(gr(S2, 'de appel').art) && new RegExp('^' + td + 'f11$').test(gr(S2, 'het huis').art), 'stored on the card, compactly: day, fast, 1 fast day, the article (de appel → "…f10", het huis → "…f11")');
      const banks = S2.lists[0].words.filter(w => w.nl === 'de bank');
      ok(!!banks[0].gr && !banks[1].gr, 'the same noun twice: its progress sits on one card');
      ok(S2.lists[0].words.find(w => w.nl === 'het blik / de blik').gr === undefined && S2.lists[0].words.find(w => w.nl === 'huis').gr === undefined, 'cards that aren\'t asked get nothing');
      await ctx.close();
    }
    // --- rounds: you pick the gap on the card; misses first; right and fast waits until tomorrow; the labelled grid
    {
      const ARTS = { appel: 'de', huis: 'het', tafel: 'de' };
      const st = state([list('B', [word('de appel', 'der Apfel', { days: ['2026-9-1'] }), word('het huis', 'das Haus', { days: ['2026-9-1'] }), word('de tafel', 'der Tisch', { days: ['2026-9-1'] })])], NL); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      ok((await page.$$eval('#gdCard button.gd-row', e => e.map(x => x.dataset.go))).join() === 'art,dem,rel' && !(await page.$('#gdGo')), 'each row on the card starts its own round: Article, This / that, Relative (no mixed rounds)');
      await page.click('#gdCard [data-go="art"]'); await page.waitForTimeout(40);
      const anim = await page.evaluate(() => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#gPills')).length);
      const early = await page.$('#gPills[data-ready]');
      await page.click('#gPills .pill[data-i="0"]', { force: true }); await page.waitForTimeout(60);
      ok(anim >= 2 && !early && (await fbG(page)) === '', 'the buttons pop out of the middle at the start; taps wait until they\'re in place');
      await ready(page);
      const seen = await playAll(page, ARTS, undefined, it => it.f === 'huis');
      ok(seen.length === 4 && seen.every(s => /^Article/.test(s.slot) && s.n === 2), 'an Article round: article gaps only, the same two buttons all round');
      ok(seen[3].f === 'huis' && seen[3].slot === 'Article · again' && seen.filter(s => s.f === 'huis').length === 2, 'the miss (huis) comes back once more in the same round, marked "again"');
      ok(/3 nouns done/.test(await page.textContent('.screen h2')) && /2 right · 2 of them fast/.test(await page.textContent('#gdSum')), 'end: "2 right · 2 of them fast"');
      ok(/Coming back first next round/.test(await page.textContent('#gMiss')) && (await page.$$eval('.gchip', e => e.map(x => x.textContent))).join() === 'het huis', 'the miss is listed: "het huis", coming back first');
      await page.click('#gdMore'); await page.waitForTimeout(30); await ready(page);
      const r2 = await playAll(page, ARTS);
      ok(r2.length === 1 && r2[0].f === 'huis' && r2[0].slot === 'Article', 'Keep going: the same gap again — the miss (huis); right and fast today waits until tomorrow');
      ok(/That's everything you picked, for today/.test(await page.textContent('.screen')) && !(await page.$('#gdMore')), 'when the gap is done for today: "That\'s everything you picked, for today", no Keep going');
      await page.click('#gdLib'); await page.waitForTimeout(250);
      ok(!(await page.$('#gdCard button[data-go="art"]')) && /All caught up for today/.test(await page.textContent('#gdCard .gd-row[data-slot="art"]')) && !!(await page.$('#gdCard button[data-go="dem"]')), 'the Article row says "All caught up for today"; the other rows still start rounds');
      await startRound(page, 'dem');
      const g = await page.evaluate(() => { const R = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), right: Math.round(r.right), b: Math.round(r.bottom) }; };
        return { p: [...document.querySelectorAll('#gPills .pill')].map(e => Object.assign(R(e), { t: e.textContent.replace(/\d/g, '') })), h: [...document.querySelectorAll('#gPills .pl-h')].map(e => Object.assign(R(e), { t: e.textContent })), r: [...document.querySelectorAll('#gPills .pl-r')].map(e => Object.assign(R(e), { t: e.textContent })) }; });
      const P = g.p;
      ok(P.map(b => b.t).join() === 'deze,dit,die,dat' && P[0].x < P[1].x && P[0].y === P[1].y && P[2].y > P[0].y && P[2].x === P[0].x && P[3].x === P[1].x, 'four buttons in two rows: deze dit (here) over die dat (there), de-forms on the left');
      ok(g.h.map(x => x.t).join() === 'de,het' && g.r.map(x => x.t).join() === 'hier,daar' && Math.abs(g.h[0].cx - P[0].cx) <= 3 && Math.abs(g.h[1].cx - P[1].cx) <= 3 && g.h[0].b <= P[0].y && g.r[0].right <= P[0].x && Math.abs(g.r[0].cy - P[0].cy) <= 3 && Math.abs(g.r[1].cy - P[2].cy) <= 3, 'labelled: de and het above the columns, hier and daar beside the rows');
      const DEM = { de: ['deze', 'die'], het: ['dit', 'dat'] }; let good = 0, n = 0;
      while (await page.$('#gFrame')) {
        await page.waitForSelector('#gPills[data-ready]'); const it = await gItem(page);
        await page.keyboard.press(String(rightIdx(it, ARTS) + 1)); await page.waitForTimeout(80);
        const m = it.f.match(/^(.*) (hier|daar)$/), want = DEM[ARTS[m[1]]][m[2] === 'hier' ? 0 : 1] + ' ' + m[1] + ' ' + m[2];
        if ((await page.textContent('#gFrame')).trim() === want && (await fbG(page)) === 'Fast' && it.slot === 'This / that' && it.n === 4) good++;
        n++; await ready(page);
      }
      ok(n === 3 && good === 3, 'a This / that round: this/that only, keys 1–4 answer, the gap fills ("dit huis hier", "die appel daar")');
      await page.click('#gdLib'); await page.waitForTimeout(250);
      await startRound(page, 'rel');
      const it3b = await gItem(page);
      ok(it3b.slot === 'Relative' && /^mijn (appel|huis|tafel), (je al kent|ik je liet zien|je gisteren zag)$/.test(it3b.f) && it3b.n === 2 && (await page.$$eval('#gPills .pill', e => e.map(x => x.textContent.replace(/\d/g, '')))).join() === 'die,dat' && (await page.$$eval('#gPills .pl-h', e => e.map(x => x.textContent))).join() === 'de,het', 'relative: "mijn appel, __ je al kent" — the article hidden — with die | dat under de | het');
      await page.keyboard.press(rightIdx(it3b, ARTS) === 0 ? 'ArrowLeft' : 'ArrowRight'); await page.waitForTimeout(80);
      ok(/Fast/.test(await fbG(page)) && new RegExp(', ' + (ARTS[it3b.f.match(/^mijn (.*?),/)[1]] === 'de' ? 'die' : 'dat') + ' ').test(await page.textContent('#gFrame')), '← / → answer two buttons ("mijn appel, die je al kent")');
      await ready(page);
      while (await page.$('#gFrame')) { const it = await gItem(page); await pill(page, rightIdx(it, ARTS)); await page.waitForTimeout(30); await ready(page); }
      await page.click('#gdLib'); await page.waitForTimeout(300);
      ok((await page.$$('#gdCard button.gd-row')).length === 0 && (await page.$$('#gdCard .gd-row.done')).length === 3, 'all three gaps done for today: every row says so');
      ok(/Today: 11 answered · 0 now automatic/.test(await page.textContent('#tallyLine')), 'today\'s line under the tiles counts every answer, second chances too: "Today: 11 answered"');
      await ctx.close();
    }
    // --- v25.2: the second chance comes after five other cards; a miss earns nothing that day
    {
      const ns = ['huis', 'boek', 'raam', 'bed', 'dak', 'kind', 'jaar', 'land'];
      const td = dayNo();
      const st = state([list('R', ns.map(n => word('het ' + n, n.toUpperCase())))], NL); st.dojo = 'gram';
      st.lists[0].words[0].gr = { art: (td - 1) + 'f21' };   // huis: right and fast on two earlier days
      const { ctx, page } = await freshD(st);
      await startRound(page);
      const order = []; let missed = null, k = 0;
      while (await page.$('#gFrame')) {
        const it = await gItem(page); order.push(it.f + (/again/.test(it.slot) ? '*' : ''));
        if (k === 0) { missed = it.f; await pill(page, 0); } else await pill(page, 1);
        k++; await page.waitForTimeout(30); await ready(page);
      }
      ok(order.length === 9 && order[6] === missed + '*' && order.slice(1, 6).every(f => f !== missed), 'a miss on the first card comes back as card 7: after five other cards (' + order.join(' ') + ')');
      await page.click('#gdMore'); await page.waitForTimeout(30); await ready(page);
      const r2 = await playAll(page, Object.fromEntries(ns.map(n => [n, 'het'])));
      const w = (await getS(page)).lists[0].words.find(x => x.nl === 'het ' + missed);
      const before = missed === 'huis' ? 1 : 0;
      ok(r2.length === 1 && r2[0].f === missed && w.gr.art === td + 'f' + before + '1!', 'next round it comes first; right and fast now only takes it out — no fast day today (stays at ' + before + ')');
      ok(/That's everything you picked, for today/.test(await page.textContent('.screen')), 'and it waits until tomorrow, like the others');
      await ctx.close();
      // the next day it earns again
      const st2 = state([list('R2', [word('het huis', 'HUIS', { gr: { art: (td - 1) + 'f11!' } })])], NL); st2.dojo = 'gram';
      const r = await freshD(st2);
      await r.page.click('#gdCard [data-go="art"]'); await r.page.waitForTimeout(30); await ready(r.page);
      await pill(r.page, 1); await r.page.waitForTimeout(100);
      ok((await getS(r.page)).lists[0].words[0].gr.art === td + 'f21', 'a day later the "missed" mark is gone and a fast answer earns its day again');
      await r.ctx.close();
    }
    // --- a slip, a slow answer, automatic after three separate days
    {
      const td = dayNo();
      const st = state([list('C', [word('de appel', 'der Apfel', { gr: { art: (td - 1) + 'f20' } }), word('het huis', 'das Haus'), word('de tafel', 'der Tisch'), word('het boek', 'das Buch', { gr: { art: (td - 3) + 'f31' } })])], Object.assign({ gram: { slots: { art: true, dem: false, rel: false } } }, NL));
      st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      ok(/1 of 4 automatic/.test(await page.textContent('#gdCard .gd-row[data-slot="art"]')), 'the Article row: "1 of 4 automatic" (het boek)');
      await startRound(page);
      await playAll(page, { appel: 'de', huis: 'het', tafel: 'de', boek: 'het' }, undefined, it => it.f === 'huis' || it.f === 'tafel' || it.f === 'boek');
      ok(/1 newly automatic/.test(await page.textContent('#gdSum')), 'appel right and fast on a third day: "1 newly automatic"');
      let S2 = await getS(page);
      ok(gr(S2, 'de appel').art === td + 'f30' && gr(S2, 'het boek').art === td + 'm21!', 'appel → 3 fast days; a miss on an automatic noun costs one (boek 3 → 2), once, though its second chance was missed too');
      ok((await page.$$('.gchip')).length === 3, 'three misses listed');
      const chip = await page.$('.gchip:text-is("de tafel")'); await chip.click(); await page.waitForTimeout(100);
      S2 = await getS(page);
      ok(await chip.evaluate(e => e.classList.contains('slip') && e.getAttribute('aria-pressed') === 'true') && gr(S2, 'de tafel').art === td + 'x00', 'tapping a miss marks it a slip: greyed, stored as a slip that costs nothing');
      const bk = await page.$('.gchip:text-is("het boek")'); await bk.click(); await page.waitForTimeout(100);
      ok(gr((await getS(page)), 'het boek').art === td + 'x31', '…and gives back the step a slip took (boek back to 3)');
      await bk.click(); await page.waitForTimeout(100);
      ok(gr((await getS(page)), 'het boek').art === td + 'm21!', 'tap again: a miss after all');
      await page.click('#gdMore'); await page.waitForTimeout(30); await ready(page);
      const r2 = []; while (await page.$('#gFrame')) { const it = await gItem(page); r2.push(it.f); await pill(page, rightIdx(it, { huis: 'het', boek: 'het' })); await page.waitForTimeout(30); await ready(page); }
      ok(r2.sort().join() === 'boek,huis', 'next round: the misses come back (huis, boek), the slip (tafel) doesn\'t');
      const S3 = await getS(page);
      ok(gr(S3, 'het boek').art === td + 'f21!' && gr(S3, 'het huis').art === td + 'f01!', 'a miss earns nothing that day: right and fast later only takes it out of "comes back first" (boek stays at 2, huis at 0)');
      await page.click('#gdLib'); await page.waitForTimeout(250);
      ok(/Today: 9 answered · 1 now automatic/.test(await page.textContent('#tallyLine')), 'the line: 9 answers (second chances included), 1 now automatic — boek doesn\'t win its step back today');
      await ctx.close();
    }
    {
      // slow: your own median sets the bar (here 8 × 100 ms → anything over 600 ms is slow)
      const st = state([list('D', [word('de appel', 'der Apfel'), word('het huis', 'das Haus')])], Object.assign({ gram: { slots: { art: true, dem: false, rel: false } } }, NL));
      st.dojo = 'gram'; st.gram = { rt: { art: [100, 100, 100, 100, 100, 100, 100, 100], dem: [], rel: [] }, day: {} };
      const { ctx, page } = await freshD(st);
      await startRound(page);
      let it = await gItem(page); await page.waitForTimeout(1150);
      await pill(page, rightIdx(it, { appel: 'de', huis: 'het' })); await page.waitForTimeout(100);
      const slowFb = await fbG(page);
      await ready(page);
      it = await gItem(page); await pill(page, rightIdx(it, { appel: 'de', huis: 'het' })); await page.waitForTimeout(100);
      ok(slowFb === 'Right, a bit slow' && (await fbG(page)) === 'Fast', 'right but slower than 1.5 × your median: "Right, a bit slow"; quick: "Fast"');
      await ready(page);
      const S2 = await getS(page), td = dayNo(), sl = S2.lists[0].words.map(w => w.gr.art);
      ok(sl.filter(x => x === td + 's00' || x === td + 's01').length === 1 && S2.gram.rt.art.length === 10, 'a slow answer is stored as slow (no fast day); your times are kept for the median');
      await page.click('#gdMore'); await page.waitForTimeout(30); await ready(page);
      ok((await page.$$eval('#gCount', e => e[0].textContent)) === '1 / 1', 'the slow one comes back in the next round, the fast one waits');
      await ctx.close();
    }
    // --- a phrase ("het risico lopen") gets the article gap only
    {
      const st = state([list('Ph', [word('het risico lopen', 'Gefahr laufen', { days: ['2026-9-1'] }), word('de appel', 'der Apfel', { days: ['2026-9-1'] })])], NL); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      const totals = await page.$$eval('#gdCard .gd-row .gd-rl > span:last-child', e => e.map(x => x.textContent));
      ok(totals.join('|') === '0 of 2 automatic|0 of 1 automatic|0 of 1 automatic', 'the bars count a phrase for the article only (2 · 1 · 1)');
      await startRound(page);
      const r1 = await playAll(page, { 'risico lopen': 'het', appel: 'de' });
      await page.click('#gdLib'); await page.waitForTimeout(250);
      await startRound(page, 'dem');
      const r2 = await playAll(page, { 'risico lopen': 'het', appel: 'de' });
      ok(r1.length === 2 && r1.every(x => x.slot === 'Article') && r2.length === 1 && r2[0].f.startsWith('appel') && r2[0].slot === 'This / that', 'Article: both; This / that: only appel — no "__ risico lopen hier"');
      await ctx.close();
    }
    // --- a miss on the card
    {
      const st = state([list('E', [word('het verzoek', 'die Anfrage')])], NL); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      await startRound(page);
      await pill(page, 0); await page.waitForTimeout(120);
      const cls = await page.$$eval('#gPills .pill', e => e.map(x => x.className));
      ok(/no/.test(cls[0]) && /right/.test(cls[1]) && (await page.getAttribute('#gFrame', 'class')).includes('no') && (await page.textContent('#gFrame')).trim() === 'het verzoek', 'a miss: your button red, the right one ringed green, the phrase "het verzoek" in red');
      ok((await fbG(page)) === 'het, not de' && /flash-bad/.test(await page.getAttribute('#card', 'class')), '"het, not de"');
      await ready(page);
      const again = await gItem(page);
      ok(again.slot === 'Article · again' && again.f === 'verzoek' && again.count === '2 / 2', 'a miss waits longer (to read it), then moves on by itself — here straight to its second chance');
      await pill(page, 1); await page.waitForTimeout(100);
      ok((await fbG(page)) === 'Fast' && (await getS(page)).lists[0].words[0].gr.art === dayNo() + 'm01!', 'right on the second chance: still a miss for today (practice only)');
      await ready(page);
      ok(/1 noun done/.test(await page.textContent('.screen h2')) && /0 right · 0 of them fast/.test(await page.textContent('#gdSum')) && (await page.$$eval('.gchip', e => e.map(x => x.textContent))).join() === 'het verzoek', 'the end counts nouns, not second chances: "1 noun done", "0 right", het verzoek coming back first');
      await ctx.close();
    }
    // --- not a noun
    {
      const st = state([list('F', [word('het spijt me', 'es tut mir leid'), word('het spijt me', 'es tut mir leid (2)')])], Object.assign({ gram: { slots: { art: true, dem: false, rel: false } } }, NL)); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      await startRound(page);
      await page.click('#gNotNoun'); await page.waitForTimeout(250);
      ok(/“spijt me” won't come back here/.test(await page.textContent('#gramToast')) && !!(await page.$('#gramUndo')), '"Not a noun": a note with Undo');
      let S2 = await getS(page);
      ok(S2.lists[0].words.every(w => w.gr && w.gr.x === 1) && /0 nouns done/.test(await page.textContent('.screen h2')), 'both copies of the card are out, and the round skips it');
      await page.click('#gdLib'); await page.waitForTimeout(250);
      ok(/0 nouns/.test(await page.textContent('.dojo[data-dojo="gram"] .ds')) && /No nouns yet/.test(await page.textContent('#gdCard')), 'the tile counts one noun fewer');
      await page.click('#setBtnHdr'); await page.waitForTimeout(200);
      ok(await page.$eval('#setGramPane', e => !e.hidden) && /2 cards you marked “Not a noun” stay out of the Grammar Dojo/.test(await page.textContent('#gNotBox')), 'Settings → Grammar Dojo lists them');
      await page.click('#gNotBack'); await page.waitForTimeout(100);
      S2 = await getS(page);
      ok(S2.lists[0].words.every(w => !w.gr.x) && await page.$eval('#gNotBox', e => e.hidden), '"Bring them back" brings them back');
      await page.click('#setClose'); await page.waitForTimeout(250);
      ok(/1 noun\b/.test(await page.textContent('.dojo[data-dojo="gram"] .ds')), 'and the tile counts it again');
      await startRound(page);
      await page.click('#gNotNoun'); await page.waitForTimeout(150);
      await page.click('#gramUndo'); await page.waitForTimeout(150);
      ok((await getS(page)).lists[0].words.every(w => !w.gr || !w.gr.x) && /It's back/.test(await page.textContent('#gramToast')), 'Undo in the note works too');
      await ctx.close();
    }
    // --- leaving, Settings and Help in the middle of a round, reloading
    {
      const nouns = ['huis', 'boek', 'raam', 'bed', 'dak'].map(n => word('het ' + n, n.toUpperCase()));
      const st = state([list('G', nouns)], NL); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      await startRound(page);
      await pill(page, 1); await page.waitForTimeout(30); await ready(page);
      ok((await gItem(page)).count === '2 / 5' && /· Articles/.test(await page.textContent('#crumb')) && await page.$eval('#setBtnHdr', e => e.style.display === 'none'), 'in a round: "2 / 5", the header says "· Articles"');
      await page.click('#setBtn'); await page.waitForTimeout(200);
      ok(await page.$eval('#setGramPane', e => !e.hidden) && await page.$eval('#sdGram', e => !e.hidden && e.classList.contains('on')), 'Settings from a round opens on the Grammar Dojo');
      await page.click('#setClose'); await page.waitForTimeout(250);
      ok((await gItem(page)).count === '2 / 5' && !!(await page.$('#gPills .pill')), 'closing Settings: back on the same card');
      await page.click('#helpBtn'); await page.waitForTimeout(200);
      ok(await page.$eval('#helpNav .chip.on', e => e.dataset.help) === 'grammar', 'Help from a round opens the Grammar Dojo section');
      await page.click('#helpClose'); await page.waitForTimeout(150);
      await pill(page, 1); await page.waitForTimeout(100);
      ok((await fbG(page)) === 'Fast', 'back from Help: the time you spent there doesn\'t count');
      await ready(page);
      await page.click('#backBtn'); await page.waitForTimeout(300);
      ok(!!(await page.$('#gdCard')) && (await getS(page)).view === 'library', '‹ Grammar Dojo leaves the round; answers so far are kept');
      ok((await getS(page)).lists[0].words.filter(w => w.gr && w.gr.art).length === 2, '(two answers saved)');
      await startRound(page);
      await page.click('#brand'); await page.waitForTimeout(300);
      ok(!!(await page.$('#gdCard')), 'the wordmark leaves a round too');
      await startRound(page); await pill(page, 1); await page.waitForTimeout(30);
      await page.reload(); await page.waitForTimeout(400);
      ok(!!(await page.$('#gdCard')) && !(await page.$('#gFrame')), 'a reload in the middle of a round lands on the Grammar Dojo\'s card');
      await page.waitForTimeout(800);
      ok(!!(await page.$('#gdCard')), 'no leftover timer pulls you back into a round');
      await page.click('#helpBtnHdr'); await page.waitForTimeout(200);
      ok(await page.$eval('#helpNav .chip.on', e => e.dataset.help) === 'grammar', 'Help in the Grammar Dojo opens its section');
      const h = (await page.textContent('#helpBody')).replace(/\s+/g, ' ');
      ok(/__ verzoek → het/.test(h) && /__ antwoord hier → dit/.test(h) && /mijn nummer, __ je al kent → dat/.test(h) && /Not a noun/.test(h) && /three separate days/.test(h) && /ο η το/.test(h), 'Help explains the three gaps, speed, Not a noun and other languages');
      await page.click('#helpNav [data-help="start"]'); await page.waitForTimeout(80);
      ok(/Grammar Dojo \(rapid fire on the articles of your nouns\)/.test(await page.textContent('#helpBody')), 'Getting started names the Grammar Dojo');
      await page.click('#helpClose'); await ctx.close();
    }
    // --- From: one group; settings: switching gaps
    {
      const st = state([Object.assign(list('Freq', [word('de appel', 'A'), word('het huis', 'H')]), { group: 'Frequency' }), Object.assign(list('Psy', [word('de therapie', 'T')]), { group: 'Psychology' })], NL); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      await page.click('#gdPick'); await page.waitForTimeout(150);
      ok((await page.$$eval('#gdPanel .rv-list .rv-row', e => e.map(x => x.firstElementChild.textContent.trim() + ' ' + x.querySelector('.n').textContent))).join('|') === 'Frequency 2|Psychology 1', 'From lists the groups that hold nouns, with counts');
      await page.check('#gdPanel [data-gk="Psychology"]'); await page.waitForTimeout(150);
      ok(/Psychology/.test(await page.textContent('#gdPick')) && /0 of 1 automatic/.test(await page.textContent('#gdCard .gd-row')) && JSON.stringify((await getS(page)).settings.gram.from) === '["Psychology"]', 'picking Psychology: the bars count its one noun; remembered');
      await page.selectOption('#gdSize', '10'); await page.waitForTimeout(100);
      ok((await getS(page)).settings.gram.size === 10, 'Per round is remembered');
      await startRound(page);
      ok((await gItem(page)).f === 'therapie' && (await gItem(page)).count === '1 / 1', 'a round takes only that group');
      await page.click('#backBtn'); await page.waitForTimeout(250);
      await page.click('#setBtnHdr'); await page.waitForTimeout(200);
      ok(await page.$eval('#gLangSel', e => e.value) === 'nl-NL' && await page.$eval('#gArtsBox', e => e.hidden) && !(await page.$('#gArtToggle')), 'Settings → Grammar Dojo: the language (shared with the Word Dojo); no gap switches — you pick the gap on the card');
      ok(await page.$eval('#gLabBox', e => !e.hidden) && await page.$eval('#gLabToggle', e => e.classList.contains('on')), 'Settings → Grammar Dojo: "Show the labels", on');
      await page.click('#gLabToggle'); await page.waitForTimeout(80);
      ok((await getS(page)).settings.gram.labels === false, 'switched off: remembered');
      await page.click('#setClose'); await page.waitForTimeout(250);
      await startRound(page, 'dem');
      const nl = await page.evaluate(() => { const P = [...document.querySelectorAll('#gPills .pill')].map(e => e.getBoundingClientRect()); return { lab: document.querySelectorAll('#gPills .pl-h, #gPills .pl-r').length, cls: document.getElementById('gPills').className, n: P.length, grid: P.length === 4 && Math.round(P[0].top) === Math.round(P[1].top) && Math.round(P[2].left) === Math.round(P[0].left) && P[2].top > P[0].top }; });
      ok(nl.lab === 0 && !/lab/.test(nl.cls) && nl.n === 4 && nl.grid, 'labels off: the same 2 × 2, without hier/daar and de/het');
      await page.click('#backBtn'); await page.waitForTimeout(250);
      await page.click('#setBtnHdr'); await page.waitForTimeout(150);
      await page.selectOption('#gLangSel', 'zh-TW'); await page.waitForTimeout(150);
      ok(await page.$eval('#gNoArts', e => !e.hidden) && (await getS(page)).settings.speak.word.lang === 'zh-TW', 'choosing Chinese there sets the Word Dojo\'s language and says the Grammar Dojo has nothing to drill');
      await page.click('#setClose'); await page.waitForTimeout(250);
      ok((await page.$$('.dojo')).length === 2 && await page.$eval('.dojo.on', e => e.dataset.dojo) === 'word', '…and on closing, the tile is gone and you\'re in the Word Dojo');
      await ctx.close();
    }
    // --- German: der / die / das as a triangle; a corrected article starts afresh; no motion with "reduce motion"
    {
      const st = state([list('DE', [word('das Haus', 'house'), word('der Tisch', 'table'), word('die Lampe', 'lamp')])], lang('de-DE')); st.dojo = 'gram';
      const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: 'reduce' }); const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      await page.goto(FILE); await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, st]); await page.reload(); await page.waitForTimeout(300);
      ok(await page.textContent('#gdCard .gd-sub') === 'der · die · das' && (await page.$$('#gdCard .gd-row')).length === 1, 'German: der · die · das, the article gap');
      await page.click('#gdCard [data-go="art"]'); await page.waitForTimeout(60);
      ok(await page.evaluate(() => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#gPills')).length) === 0, '"Reduce motion": the buttons don\'t fly in');
      const b = await page.$$eval('#gPills .pill', e => e.map(x => { const r = x.getBoundingClientRect(); return { t: x.textContent.replace(/\d/g, ''), cx: Math.round(r.left + r.width / 2), y: Math.round(r.top) }; }));
      ok(b.map(x => x.t).join() === 'der,die,das' && b[0].y < b[1].y && b[1].y === b[2].y && Math.abs(b[0].cx - (b[1].cx + b[2].cx) / 2) <= 2, 'three buttons as a triangle: der on top, die · das below');
      const it = await gItem(page);
      ok(!!(await page.$('#gPills[data-ready]')), '…and they take answers straight away');
      await page.keyboard.press(String(rightIdx(it, { Haus: 'das', Tisch: 'der', Lampe: 'die' }, ['der', 'die', 'das']) + 1)); await page.waitForTimeout(80);
      ok((await fbG(page)) === 'Fast', '…and keys 1–3 answer at once');
      await ctx.close();
      // a card whose article was corrected starts afresh
      const td = dayNo();
      const st2 = state([list('V', [word('het verzoek', 'Anfrage', { gr: { art: (td - 1) + 'f20' } })])], NL); st2.dojo = 'gram';
      const r = await freshD(st2);
      ok(/0 of 1 automatic/.test(await r.page.textContent('#gdCard .gd-row')), 'progress made for "de verzoek" doesn\'t count once the card says "het verzoek"');
      await r.page.click('#gdCard [data-go="art"]'); await r.page.waitForTimeout(30); await ready(r.page);
      await pill(r.page, 1); await r.page.waitForTimeout(100);
      ok((await getS(r.page)).lists[0].words[0].gr.art === td + 'f11', 'it starts again from its first fast day');
      await r.ctx.close();
    }
    // --- phones: big buttons, no field under 16 px, taps; backups carry the progress
    {
      const o = Object.assign({}, DEV35['iPhone 14']); delete o.defaultBrowserType;
      const ctx = await browser.newContext(o); const page = await ctx.newPage();
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      const st = state([Object.assign(list('P', [word('de appel', 'A'), word('het huis', 'H'), word('de tafel', 'T')]), { group: 'Basics' })], NL); st.dojo = 'gram';
      await page.goto(FILE); await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, st]); await page.reload(); await page.waitForTimeout(350);
      await page.tap('#gdPick'); await page.waitForTimeout(150);
      const small = await page.evaluate(() => [...document.querySelectorAll('input,select,textarea')].filter(e => !['file', 'checkbox', 'hidden'].includes(e.type) && e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.id || e.className));
      ok(small.length === 0, 'phone: no box or menu under 16 px on the Grammar Dojo card' + (small.length ? ' — ' + small.join(', ') : ''));
      const tops = await page.$$eval('.dojo', e => e.map(x => Math.round(x.getBoundingClientRect().top)));
      ok(tops.length === 3 && tops[0] === tops[1] && tops[1] === tops[2], 'phone: the three tiles share one row');
      await page.tap('#gdPick'); await page.waitForTimeout(100);
      await page.tap('#gdCard [data-go="art"]'); await page.waitForTimeout(30); await ready(page);
      const ph = await page.$$eval('#gPills .pill', e => e.map(x => x.getBoundingClientRect().height));
      ok(ph.length === 2 && ph.every(h => h >= 56), 'phone: big buttons (≥ 56 px tall)');
      const it = await gItem(page);
      await page.tap(`#gPills .pill[data-i="${rightIdx(it, { appel: 'de', huis: 'het', tafel: 'de' })}"]`, { force: true }); await page.waitForTimeout(80);
      ok((await fbG(page)) === 'Fast', 'phone: a tap answers');
      await ready(page);
      await page.tap('#backBtn'); await page.waitForTimeout(250);
      await page.tap('#setBtnHdr'); await page.waitForTimeout(200);
      const seg = await page.$$eval('#setDojo button', e => e.filter(x => !x.hidden).map(x => x.getBoundingClientRect().height));
      ok(seg.length === 3 && Math.max(...seg) < 44, 'phone: Word / Sentence / Grammar Dojo fit on one line in Settings');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.tap('#exportBtn')]);
      const fp = path.join(require('os').tmpdir(), 'v25_backup.json'); await dl.saveAs(fp);
      const bk = JSON.parse(require('fs').readFileSync(fp, 'utf8'));
      ok(bk.lists[0].words.some(w => w.gr && /^\d+f1\d$/.test(w.gr.art)) && bk.gram && bk.gram.day && bk.gram.day.n === 1 && bk.settings.gram && bk.settings.gram.size === 25, 'the backup carries Grammar Dojo progress and settings');
      await ctx.close();
      // an older backup (no Grammar Dojo at all) imports fine
      const old = state([list('Old', [word('de appel', 'A')])], NL); delete old.settings.gram;
      require('fs').writeFileSync(path.join(require('os').tmpdir(), 'v25_old.json'), JSON.stringify(old));
      const r = await freshD(state([list('Now', [word('het huis', 'H')])], NL));
      await r.page.click('#setBtnHdr'); await r.page.waitForTimeout(150);
      await r.page.setInputFiles('#importFile', path.join(require('os').tmpdir(), 'v25_old.json')); await r.page.waitForTimeout(500);
      const S3 = await getS(r.page);
      ok(S3.gram && Array.isArray(S3.gram.rt.art) && S3.settings.gram.size === 25 && /1 noun\b/.test(await r.page.textContent('.dojo[data-dojo="gram"] .ds')), 'a backup from before V25 imports fine (Grammar Dojo defaults added)');
      await r.ctx.close();
    }

    // ---------------- V25.3 ----------------
    console.log('\n[35b] V25.3: more languages built in, Help in your language, mixed-up buttons, automatic forms come back');
    // --- eight more languages, nothing to type
    {
      const cases = [['sv-SE', 'en · ett', 2, [word('en bil', 'car'), word('ett hus', 'house')]], ['da-DK', 'en · et', 2, [word('en bil', 'car'), word('et hus', 'house')]],
        ['nb-NO', 'en · ei · et', 3, [word('en bil', 'car'), word('ei jente', 'girl'), word('et hus', 'house')]],
        ['fr-FR', 'le · la', 2, [word('le livre', 'book'), word('la maison', 'house'), word("l'homme", 'man'), word('les gens', 'people')]],
        ['es-MX', 'el · la', 2, [word('el libro', 'book'), word('la casa', 'house'), word('los niños', 'children')]],
        ['it-IT', 'il · lo · la', 3, [word('il libro', 'book'), word('lo zaino', 'backpack'), word('la casa', 'house')]],
        ['pt-BR', 'o · a', 2, [word('o livro', 'book'), word('a casa', 'house')]], ['ro-RO', 'un · o', 2, [word('un scaun', 'chair'), word('o carte', 'book')]]];
      const bad = [];
      for (const [l, forms, n, ws] of cases) {
        const st = state([list('L', ws)], lang(l)); st.dojo = 'gram';
        const { ctx, page } = await freshD(st);
        const sub = await page.textContent('#gdCard .gd-sub').catch(() => ''), cnt = await page.textContent('.dojo[data-dojo="gram"] .ds').catch(() => '');
        if (!(sub === forms && cnt === n + ' nouns' && !(await page.$('#gdSetup')))) bad.push(l + ': ' + sub + ' / ' + cnt);
        await ctx.close();
      }
      ok(!bad.length, "built in, nothing to type: Swedish en · ett, Danish en · et, Norwegian en · ei · et, French le · la (not l' or les), Spanish el · la (not los), Italian il · lo · la, Portuguese o · a, Romanian un · o" + (bad.length ? ' — ' + bad.join('; ') : ''));
    }
    {
      const st = state([list('SV', [word('en bil', 'car'), word('ett hus', 'house'), word('ett äpple', 'apple')])], lang('sv-SE')); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      await startRound(page);
      const it = await gItem(page);
      ok(it.n === 2 && (await page.$$eval('#gPills .pill', e => e.map(x => x.textContent.replace(/\d/g, '')))).join() === 'en,ett', 'Swedish: a round with en | ett');
      await pill(page, rightIdx(it, { bil: 'en', hus: 'ett', 'äpple': 'ett' }, ['en', 'ett'])); await page.waitForTimeout(60);
      ok((await fbG(page)) === 'Fast', '…and the right one counts');
      await page.click('#backBtn'); await page.waitForTimeout(250);
      await page.click('#setBtnHdr'); await page.waitForTimeout(200);
      ok(await page.$eval('#gArtsBox', e => e.hidden) && await page.$eval('#gBtnBox', e => !e.hidden) && await page.$eval('#gLabBox', e => e.hidden) && await page.$eval('#gMixToggle', e => !e.classList.contains('on')), 'Settings → Grammar Dojo for Swedish: no articles to type, no labels switch, "Mix up the buttons" (off)');
      await page.click('#setClose'); await page.waitForTimeout(200);
      await page.click('#helpBtnHdr'); await page.waitForTimeout(200);
      const h = (await page.textContent('#helpBody')).replace(/\s+/g, ' ');
      ok(/ett hus = a house/.test(h) && /__ hus → ett/.test(h) && /en, ett/.test(h) && !/verzoek|antwoord|spijt|Antrag/.test(h), 'Help speaks Swedish: ett hus = a house, __ hus → ett, nothing Dutch');
      await page.click('#helpNav [data-help="lists"]'); await page.waitForTimeout(80);
      ok(/like ett hus = a house/.test((await page.textContent('#helpBody')).replace(/\s+/g, ' ')), 'Your lists: the article example in Swedish too');
      await page.click('#helpClose'); await ctx.close();
    }
    // --- Help follows the language you're learning
    {
      const hOf = async st => { const { ctx, page } = await freshD(st); await page.click('#helpBtnHdr'); await page.waitForTimeout(150);
        await page.click('#helpNav [data-help="grammar"]'); await page.waitForTimeout(80); const h = (await page.textContent('#helpBody')).replace(/\s+/g, ' ');
        await page.click('#helpNav [data-help="lists"]'); await page.waitForTimeout(80); const l = (await page.textContent('#helpBody')).replace(/\s+/g, ' ');
        await ctx.close(); return { h, l }; };
      const de = await hOf(state([list('D', [word('das Haus', 'house'), word('der Tisch', 'table')])], lang('de-DE')));
      ok(/das Haus = the house/.test(de.h) && /__ Haus → das/.test(de.h) && /der, die, das/.test(de.h) && !/verzoek|daar/.test(de.h), 'German: German examples, der, die, das');
      const ja = await hOf(state([list('J', [word('sensei', 'teacher')])], lang('ja-JP')));
      ok(/languages whose nouns carry an article/.test(ja.h) && !/verzoek|Antrag|das Haus/.test(ja.h + ja.l) && /In a language with articles, write nouns with their article/.test(ja.l), 'Japanese (no articles): a short neutral note, no Dutch or German example anywhere in Help');
      const gk = await hOf(state([list('G', [word('το σπίτι', 'house'), word('η πόρτα', 'door')])], Object.assign({ gram: { arts: 'ο η το' } }, lang('el-GR'))));
      ok(/το σπίτι = house/.test(gk.h) && /__ σπίτι → το/.test(gk.h) && /like το σπίτι = house/.test(gk.l), 'typed articles (Greek ο η το): the example comes from your own cards');
      const nl = await hOf(state([list('N', [word('de appel', 'der Apfel')])], NL));
      ok(/het verzoek = the request/.test(nl.h) && /__ antwoord hier → dit/.test(nl.h) && /mix up the buttons/.test(nl.h) && !/der Antrag/.test(nl.h + nl.l), 'Dutch: the three gaps as before; the example in English now (no "der Antrag")');
    }
    // --- mixed-up buttons: new places on every card, the same buttons, their own speed record
    {
      const nouns = ['appel:de', 'huis:het', 'tafel:de', 'boek:het', 'raam:het', 'stoel:de', 'deur:de', 'bed:het', 'kast:de', 'dak:het'];
      const arts = Object.fromEntries(nouns.map(x => x.split(':')));
      const st = state([list('M', nouns.map(x => { const [n, a] = x.split(':'); return word(a + ' ' + n, n.toUpperCase()); }))], NL); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      await page.click('#setBtnHdr'); await page.waitForTimeout(200);
      await page.click('#gMixToggle'); await page.waitForTimeout(80);
      ok((await getS(page)).settings.gram.mix === true && await page.$eval('#gMixToggle', e => e.classList.contains('on')), 'Settings → Grammar Dojo: "Mix up the buttons" switched on, remembered');
      await page.click('#setClose'); await page.waitForTimeout(200);
      await startRound(page, 'dem');
      await page.evaluate(() => document.querySelectorAll('#gPills .pill').forEach(p => { p.__keep = 1; }));
      const orders = new Set(); let allRight = true, kept = true, labs = 0, cards = 0;
      while (cards < 10) {
        const it = await gItem(page); if (!/^This/.test(it.slot)) break; cards++;
        orders.add((await page.$$eval('#gPills .pill', e => e.map(x => x.textContent.replace(/\d/g, '')))).join());
        labs += await page.$$eval('#gPills .pl-h, #gPills .pl-r', e => e.length);
        kept = kept && await page.evaluate(() => [...document.querySelectorAll('#gPills .pill')].every(p => p.__keep === 1));
        const r = rightIdx(it, arts);
        if (cards % 2) { const pos = await page.$eval(`#gPills .pill[data-i="${r}"]`, e => +e.dataset.pos); await page.waitForSelector('#gPills[data-ready]'); await page.keyboard.press(String(pos + 1)); }
        else await pill(page, r);
        await page.waitForTimeout(40);
        if (!/Fast|Right/.test(await fbG(page))) allRight = false;
        await page.waitForTimeout(500); await ready(page);
      }
      ok(cards === 10 && orders.size >= 3, 'mixed up: dit, dat, deze and die change places from card to card (' + orders.size + ' different orders in ' + cards + ' cards)');
      ok(labs === 0, '…without the hier / daar and de / het labels');
      ok(kept, '…on the same buttons, so nothing pops in again between cards');
      ok(allRight, '…and tapping the right word, or pressing the number of the place where it sits, counts as right');
      const S1 = await getS(page);
      ok(Array.isArray(S1.gram.rt['dem~m']) && S1.gram.rt['dem~m'].length === 10 && !(S1.gram.rt.dem || []).length, 'mixed-up answers keep their own speed record, apart from the fixed grid\'s');
      await ctx.close();
    }
    // --- automatic forms come back after a growing pause, a few per round
    {
      const td = dayNo();
      const mk = (a, n, g) => word(a + ' ' + n, n.toUpperCase(), g ? { gr: { art: g } } : {});
      const ws = [mk('de', 'appel', (td - 15) + 'f30'), mk('het', 'huis', (td - 5) + 'f31'), mk('de', 'tafel', (td - 31) + 'f40'), mk('het', 'boek', (td - 20) + 'f41')];
      for (let k = 0; k < 12; k++) ws.push(mk(k % 2 ? 'het' : 'de', 'nieuw' + k));
      const arts = Object.fromEntries(ws.map(w => [w.nl.split(' ')[1], w.nl.split(' ')[0]]));
      const st = state([list('A', ws)], Object.assign({ gram: { size: 10 } }, NL)); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      ok(/4 of 16 automatic/.test(await page.textContent('#gdCard .gd-row')), 'checked forms still count as automatic (4 of 16)');
      await startRound(page);
      const names = (await playAll(page, arts)).map(x => x.f);
      ok(names.length === 10 && names.includes('appel') && names.includes('tafel') && !names.includes('huis') && !names.includes('boek'), 'automatic forms come back when their pause is over (appel after two weeks, tafel after a month), between the new ones; huis (5 days) and boek (20 of 30 days) rest');
      const S2 = await getS(page);
      ok(gr(S2, 'de appel').art === td + 'f40' && gr(S2, 'de tafel').art === td + 'f50', 'right and fast again: the pause grows (appel 3 → 4, tafel 4 → 5)');
      await ctx.close();
    }
    {
      const td = dayNo(), ws = [];
      for (let k = 0; k < 5; k++) ws.push(word('de oud' + k, 'O', { gr: { art: (td - 40) + 'f30' } }));
      for (let k = 0; k < 10; k++) ws.push(word('het nieuw' + k, 'N'));
      const arts = Object.fromEntries(ws.map(w => [w.nl.split(' ')[1], w.nl.split(' ')[0]]));
      const st = state([list('C', ws)], Object.assign({ gram: { size: 10 } }, NL)); st.dojo = 'gram';
      const { ctx, page } = await freshD(st);
      await startRound(page);
      let missed = null;
      const seen = await playAll(page, arts, undefined, it => { if (!missed && /^oud/.test(it.f) && !/again/.test(it.slot)) { missed = it.f; return true; } return false; });
      const firsts = seen.filter(x => !/again/.test(x.slot));
      ok(firsts.length === 10 && firsts.filter(x => /^oud/.test(x.f)).length === 2, 'five automatic forms due, a round of 10: two of them, eight new ones');
      ok(!!missed && gr(await getS(page), 'de ' + missed).art === td + 'm20!', 'a miss sends an automatic form back to practice (3 → 2)');
      await ctx.close();
    }

    // ---------------- V25.4 ----------------
    console.log('\n[36] V25.4: Send feedback');
    {
      const { ctx, page } = await freshD(state([list('N', [word('de appel', 'A')])], NL));
      const want = 'https://tally.so/r/OQ7Q4K?version=' + await page.evaluate(() => document.documentElement.innerHTML.match(/APP_VERSION="([^"]+)"/)[1]);
      await page.click('#setBtnHdr'); await page.waitForTimeout(200);
      const a = await page.$eval('#fbSet', e => ({ href: e.getAttribute('href'), t: e.target, rel: e.rel, txt: e.textContent.trim(), vis: !!e.offsetParent }));
      ok(a.href === want && a.t === '_blank' && /noopener/.test(a.rel) && a.txt === 'Send feedback' && a.vis, 'Settings: "Send feedback" next to the version number opens the form in a new tab, the version filled in');
      await page.click('#setClose'); await page.waitForTimeout(150);
      await page.click('#helpBtnHdr'); await page.waitForTimeout(150);
      const b = await page.$eval('#fbHelp', e => ({ href: e.getAttribute('href'), t: e.target, vis: !!e.offsetParent }));
      ok(b.href === want && b.t === '_blank' && b.vis, 'Help: the same link at the bottom, in every section');
      await page.click('#helpNav [data-help="settings"]'); await page.waitForTimeout(80);
      const h = (await page.textContent('#helpBody')).replace(/\s+/g, ' ');
      ok(/Send feedback/.test(h) && /Mix up the buttons/.test(h) && !/other than Dutch and German/.test(h), 'Help → Settings: Send feedback, and the Grammar Dojo\'s settings as they are now');
      await page.click('#helpClose'); await ctx.close();
    }
  }

  // ---------------- screenshots ----------------
  {
    const st = state([list('Shots', [word('dichtbij [nabij] [vlakbij]', 'nahe (bij het station)', { hard: true }), word('huis', 'Haus')])]);
    let { ctx, page } = await fresh(browser, st, { width: 900, height: 860 });
    await page.click('[data-a="study"]'); await page.waitForTimeout(900);
    await page.screenshot({ path: SHOT('shot_card.png') });
    await typeEnter(page, 'xyz'); await typeEnter(page, 'nabij'); await page.waitForTimeout(400);
    await page.screenshot({ path: SHOT('shot_teal_retype.png') });
    await page.click('#editBtn'); await page.waitForTimeout(300);
    await page.screenshot({ path: SHOT('shot_editor.png') });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, st, { width: 390, height: 844 }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(900);
    await page.screenshot({ path: SHOT('shot_mobile.png') });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, state([list('Quit home', qWords())]), { width: 900, height: 860 }));
    await page.click('#hardGo'); await page.waitForTimeout(300);
    await answerCorrect(page, qMap); await answerCorrect(page, qMap);
    await page.click('#backBtn'); await page.waitForTimeout(700);
    await page.screenshot({ path: SHOT('shot_quit.png') });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, state([list('Shots M', [word('貴姓 / guìxìng', 'your surname (polite)', { everSeen: false }), word('先生 / xiānshēng', 'Mr.')])]), { width: 900, height: 860 }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(900);
    await page.screenshot({ path: SHOT('shot_v225_copy.png') });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, state([list('Shots R', [word('貴姓 / guìxìng', 'your surname')])]), { width: 900, height: 860 }));
    await page.click('[data-a="study"]'); await page.waitForTimeout(900);
    await typeEnter(page, 'xyz'); await page.waitForTimeout(400);
    await page.screenshot({ path: SHOT('shot_v225_miss.png') });
    await ctx.close();
    ({ ctx, page } = await fresh(browser, state([list('Shots H', [word('een', 'eins')])]), { width: 900, height: 860 }));
    await page.click('#helpBtnHdr'); await page.waitForTimeout(100); await page.click('#helpNav [data-help="word"]'); await page.waitForTimeout(100);
    await page.screenshot({ path: SHOT('shot_v225_help.png') });
    await ctx.close();
    {
      const g = (name, group, n, pre, day) => Object.assign(list(name, Array.from({ length: n }, (_, i) => word(pre + i, 'M' + pre + i, { days: [day] }))), { group, folder: 'learned' });
      const st = state([g('E', 'Emotions', 3, 'e', '2026-7-2'), g('F1', 'Frequency (1-500)', 3, 'a', '2026-7-14'), g('F2', 'Frequency (501-1000)', 3, 'b', '2026-8-2'), Object.assign(list('Stud', [word('x', 'y')]), { group: 'Psychology' })]);
      ({ ctx, page } = await fresh(browser, st, { width: 900, height: 900 }));
      await page.click('#rvPick'); await page.fill('#rvQ', 'freq'); await page.waitForTimeout(500);
      await page.screenshot({ path: SHOT('shot_v23_revisit.png'), fullPage: true });
      await ctx.close();
    }
    ({ ctx, page } = await fresh(browser, state([list('Shots L', [word('貴姓 / guìxìng', 'your surname (polite)', { everSeen: false })])]), { width: 900, height: 820 }));
    await page.waitForTimeout(1200); await page.screenshot({ path: SHOT('shot_v231_library.png') });
    await page.click('[data-a="study"]'); await page.waitForTimeout(1200);
    await page.screenshot({ path: SHOT('shot_v231_card.png') });
    await ctx.close();
    {
      const st = state([glist('Frequency 1-25', 'Frequency (1-500)', 'learned', mk(14, 'o', ['2026-7-2'])), Object.assign(list('Psychology 1', [word('de therapie', 'die Therapie', { md: TODAY }), word('het geheugen', 'das Gedächtnis', { md: TODAY, rv: TODAY })]), { group: 'Psychology' })]);
      ({ ctx, page } = await fresh(browser, st, { width: 900, height: 900 }));
      await page.waitForTimeout(900); await page.screenshot({ path: SHOT('shot_v243_library.png'), fullPage: true });
      await ctx.close();
      ({ ctx, page } = await fresh(browser, st, { width: 390, height: 844 }));
      await page.waitForTimeout(900); await page.screenshot({ path: SHOT('shot_v243_phone.png'), fullPage: true });
      await ctx.close();
      ({ ctx, page } = await fresh(browser, st, { width: 900, height: 900 }));
      await page.click('#helpBtnHdr'); await page.waitForTimeout(100); await page.click('#helpNav [data-help="word"]'); await page.waitForTimeout(80);
      await page.click('#helpBody a.hl:has-text("Teal")'); await page.waitForTimeout(400);
      await page.screenshot({ path: SHOT('shot_v243_shorthand.png') });
      await page.click('#helpClose'); await page.click('#setBtnHdr'); await page.waitForTimeout(150);
      await page.evaluate(() => document.querySelector('.accbar-cfg').scrollIntoView({ block: 'center' })); await page.waitForTimeout(150);
      await page.screenshot({ path: SHOT('shot_v243_accent.png') });
      await page.click('#setClose'); await page.click('#addBtn'); await page.waitForTimeout(250);
      await page.screenshot({ path: SHOT('shot_v243_editor.png') });
      await ctx.close();
    }
    {
      const now = Date.now();
      const L = (name, group, folder, extra = {}) => Object.assign(list(name, [word('w' + name, 'm' + name)]), { group, folder }, extra);
      const st = state([L('Word List (1001-1500)', 'Frequency', 'learn', { practisedAt: now - 864e5 }), L('Word List (1-500)', 'Frequency', 'learn', { practisedAt: now - 9 * 864e5 }), L('Word List (501-1000)', 'Frequency', 'learn', { practisedAt: now - 3 * 864e5 }), L('Emotions 1', 'Psychology', 'learn'), L('Emotions 2', 'Psychology', 'learn'), L('Travel basics', 'Travel', 'learned'), L('At the station', 'Travel', 'learned')]);
      ({ ctx, page } = await fresh(browser, st, { width: 900, height: 900 }));
      await page.waitForTimeout(800);
      await page.click('.subgroup:has(.nm:text-is("Frequency")) [data-ga="sort"]'); await page.waitForTimeout(300);
      await page.screenshot({ path: SHOT('shot_v244_menu.png') });
      await page.click('#sortMenu [data-sort="az"]'); await page.waitForTimeout(400);
      await page.screenshot({ path: SHOT('shot_v244_toast.png') });
      await ctx.close();
      ({ ctx, page } = await fresh(browser, st, { width: 390, height: 844 }));
      await page.waitForTimeout(800);
      await page.click('.fhead[data-fk="learn"] .fsort'); await page.waitForTimeout(300);
      await page.screenshot({ path: SHOT('shot_v244_phone.png') });
      await ctx.close();
      ({ ctx, page } = await fresh(browser, st, { width: 900, height: 900 }));
      await page.click('#helpBtnHdr'); await page.waitForTimeout(100); await page.click('#helpNav [data-help="lists"]'); await page.waitForTimeout(80);
      await page.evaluate(() => document.getElementById('hSort').scrollIntoView({ block: 'center' })); await page.waitForTimeout(150);
      await page.screenshot({ path: SHOT('shot_v244_help.png') });
      await ctx.close();
    }
    {
      ({ ctx, page } = await fresh(browser, state([list('Have', [word('huis', 'Haus')])]), { width: 390, height: 844 }));
      await page.click('#gwBtn'); await page.waitForTimeout(150);
      await page.fill('#gwPaste', ['le marché = der Markt, der Wochenmarkt', "faire les courses = einkaufen gehen", 'un rendez-vous = eine Verabredung'].join(' ')); await page.waitForTimeout(200);
      await page.evaluate(() => document.getElementById('gwPaste').scrollIntoView({ block: 'start' })); await page.waitForTimeout(150);
      await page.screenshot({ path: SHOT('shot_v245_glued.png') });
      await ctx.close();
    }
  }

  // V25 screenshots: the Grammar Dojo on a phone (home, a this/that card, an answer, the end of a round)
  {
    const o = Object.assign({}, require('playwright').devices['iPhone 14']); delete o.defaultBrowserType;
    const ctx = await browser.newContext(o); const page = await ctx.newPage();
    const st = state([Object.assign(list('Frequency 1', ['de plaats', 'de vrouw', 'het kind', 'het leven', 'de man', 'het uur'].map(n => word(n, n.toUpperCase(), { days: ['2026-9-1'] }))), { group: 'Frequency' })], { speak: { word: { lang: 'nl-NL', auto: false }, sentence: { lang: '', auto: false } } });
    st.dojo = 'gram';
    await page.goto(FILE); await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, st]); await page.reload(); await page.waitForTimeout(800);
    await page.screenshot({ path: SHOT('shot_v25_home.png') });
    await page.tap('#gdCard [data-go="dem"]'); await page.waitForSelector('#gPills[data-ready]'); await page.waitForTimeout(100);
    await page.screenshot({ path: SHOT('shot_v25_card.png') });
    await page.tap('#gPills .pill[data-i="0"]', { force: true }); await page.waitForTimeout(150);
    await page.screenshot({ path: SHOT('shot_v25_answer.png') });
    for (let k = 0; k < 8 && await page.$('#gFrame'); k++) { await page.waitForSelector('#gPills[data-ready]', { timeout: 4000 }).catch(() => {}); if (!(await page.$('#gFrame'))) break; await page.tap('#gPills .pill[data-i="0"]', { force: true }); await page.waitForTimeout(1700); }
    await page.screenshot({ path: SHOT('shot_v25_done.png') });
    await ctx.close();
  }
  ok(errors.length === 0, 'no page/console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('FAILED:', failures.join('; '));
  await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
