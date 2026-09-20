// 実際のapp.jsを、画面とlocalStorageの小さな代用品で実行する回帰テスト。
function assert(value, message) {
  if (!value) throw new Error(message);
}
function equal(a, b, message) {
  assert(JSON.stringify(a) === JSON.stringify(b), message);
}
function fakeElement() {
  return {
    dataset: {}, hidden: false, disabled: false, textContent: "", children: [],
    addEventListener(type, handler) { this[type] = handler; },
    focus() {}, append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; }
  };
}
function makeApp(storage, data = DATA) {
  const elements = {};
  const buttons = ["der", "die", "das"].map((article) => {
    const button = fakeElement(); button.dataset.article = article; return button;
  });
  const document = {
    getElementById(id) { return elements[id] ||= fakeElement(); },
    querySelectorAll() { return buttons; },
    createElement: fakeElement
  };
  const source = APP_SOURCE.replace(/initializeApp\(\);\s*$/, "");
  const factory = new Function("document", "localStorage", "testData", source + `
    nouns = testData;
    setupEvents();
    return {
      startSession, startReview, checkAnswer, nextQuestion, createMainQuestions,
      get state() { return state; }, get questions() { return mainQuestions; },
      get review() { return reviewQuestions; }, get mainAnswers() { return mainAnswers; },
      get reviewAnswers() { return reviewAnswers; },
      get current() { return currentQuestions()[questionIndex]; }
    };`);
  const app = factory(document, storage, data);
  app.elements = elements; app.buttons = buttons;
  app.startSession();
  return app;
}
function storageWith(value = []) {
  return {
    value: JSON.stringify(value), writes: 0,
    getItem(key) { assert(key === "nomenDrillCarryover", "storage key"); return this.value; },
    setItem(key, value) { assert(key === "nomenDrillCarryover", "storage key"); this.value = value; this.writes++; }
  };
}
function answer(app, correct) {
  const article = app.current.article;
  app.checkAnswer(correct ? article : ["der", "die", "das"].find(a => a !== article));
  const count = app.mainAnswers.length + app.reviewAnswers.length;
  app.checkAnswer(article);
  equal(app.mainAnswers.length + app.reviewAnswers.length, count, "double answer ignored");
  assert(app.buttons.every(b => b.disabled), "buttons locked");
  app.nextQuestion();
}
function mainRound(app, wrong) {
  for (let i = 0; i < 40; i++) answer(app, wrong(i, app.current) === false);
  equal(app.mainAnswers.length, 40, "exactly 40 answers");
}
const results = [];
{
  const storage = storageWith([DATA[0].noun]);
  const app = makeApp(storage);
  mainRound(app, () => false);
  equal(app.state, "final", "test1 skips review");
  equal(JSON.parse(storage.value), [], "test1 clears old carryover");
  assert(app.elements["final-summary"].textContent.includes("100 %"), "100 percent");
  results.push("Test 1: all 40 correct, no review, previous carryover cleared");
}
{
  const storage = storageWith(); const app = makeApp(storage);
  mainRound(app, i => i < 5);
  equal(app.review.length, 5, "test2 five distinct nouns");
  equal(app.state, "mainResult", "main results before review");
  equal(app.elements.mistakes.children.length, 5, "five mistake rows");
  equal(app.elements.mistakes.children[0].children.length, 2, "no meaning field required");
  app.startReview();
  for (let i = 0; i < 5; i++) answer(app, true);
  equal(app.state, "final", "test2 final");
  equal(JSON.parse(storage.value), [], "test2 no carryover");
  results.push("Test 2: five mistakes, all five corrected, no carryover");
}
{
  const storage = storageWith(); const app = makeApp(storage);
  mainRound(app, i => i < 5); app.startReview();
  const remaining = app.review.slice(0, 2).map(n => n.noun);
  for (let i = 0; i < 5; i++) answer(app, i >= 2);
  equal(app.reviewAnswers.length, 5, "test3 review never repeats");
  equal(app.state, "final", "test3 final");
  equal(JSON.parse(storage.value), remaining, "test3 saves only two wrong nouns");
  equal(storage.writes, 1, "save only at completion");
  results.push("Test 3: two review mistakes saved, no further repetition");
  app.elements.restart.click();
  equal(app.questions.length, 40, "test4 forty questions");
  equal(app.questions.slice(0, 2).map(n => n.noun), remaining, "test4 priority on restart");
  results.push("Test 4: restart has the two carryover nouns first, total 40");
  const reloaded = makeApp(storage);
  equal(reloaded.questions.slice(0, 2).map(n => n.noun), remaining, "test5 reload priority");
  equal(reloaded.mainAnswers.length, 0, "progress not persisted");
  equal(JSON.parse(storage.value), remaining, "reload preserves saved value");
  results.push("Test 5: new app instance restores carryover, not unfinished progress");
}
{
  const app = makeApp(storageWith(), DATA.slice(0, 10));
  const name = app.questions[0].noun;
  mainRound(app, (_, item) => item.noun === name);
  equal(app.mainAnswers.filter(a => !a.correct).length, 4, "four repeated mistakes");
  equal(app.review.length, 1, "test6 review deduplicated");
  app.startReview(); answer(app, false);
  equal(app.state, "final", "one review only");
  results.push("Test 6: four mistakes on the same noun produce one review question");
}
{
  for (const size of [1, 2, 10, 39, 40, 60]) {
    const data = Array.from({length: size}, (_, i) => ({noun: `Nomen${i}`, article: "das"}));
    const app = makeApp(storageWith(), data);
    for (let attempt = 0; attempt < 50; attempt++) {
      const questions = app.createMainQuestions([data[0].noun]);
      equal(questions.length, 40, "40 regardless of vocabulary size");
      equal(questions[0].noun, data[0].noun, "carryover first");
      if (size > 1) assert(questions.every((n, i) => i === 0 || n.noun !== questions[i - 1].noun), "no consecutive noun");
      for (let offset = 0; offset < 40; offset += size) {
        const cycle = questions.slice(offset, offset + size);
        equal(new Set(cycle.map(n => n.noun)).size, cycle.length, "each cycle unique");
      }
    }
  }
  const app = makeApp(storageWith(["removed", DATA[0].noun, DATA[0].noun, null]));
  equal(app.questions[0].noun, DATA[0].noun, "ignore unknown and duplicate stored nouns");
  const broken = storageWith(); broken.value = "invalid JSON";
  equal(makeApp(broken).questions.length, 40, "corrupt storage still playable");
  const blocked = {getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }};
  const fallback = makeApp(blocked);
  mainRound(fallback, i => i === 0); fallback.startReview();
  const name = fallback.current.noun; answer(fallback, false);
  assert(!fallback.elements["storage-notice"].hidden, "storage error explained");
  fallback.startSession(); equal(fallback.questions[0].noun, name, "in-memory fallback");
  results.push("Additional: 1/2/10/39/40/60 nouns, shuffle cycles, double clicks, invalid/blocked storage");
}
// 再現可能な乱数で、多数のセットと繰り越しの偏りを検証する。
const originalRandom = Math.random;
let seed = 20260920;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
function articleCounts(questions) {
  return questions.reduce((counts, item) => {
    counts[item.article]++;
    return counts;
  }, {der: 0, die: 0, das: 0});
}
function verifySet(questions, priority = []) {
  equal(questions.length, 40, "balanced set totals 40");
  equal(new Set(questions.map(item => item.noun)).size, 40, "all nouns unique");
  equal(questions.slice(0, priority.length).map(item => item.noun), priority, "carryover stays first");
  assert(questions.every(item => DATA.some(n => n.noun === item.noun && n.article === item.article)), "only real vocabulary");
}
function verifyBalance(questions) {
  equal(Object.values(articleCounts(questions)).sort((a, b) => a - b), [13, 13, 14], "13/13/14 balance");
}
{
  const app = makeApp(storageWith());
  const extraArticles = new Set();
  const sequences = new Set();
  for (let i = 0; i < 300; i++) {
    app.startSession();
    verifySet(app.questions); verifyBalance(app.questions);
    const counts = articleCounts(app.questions);
    extraArticles.add(Object.keys(counts).find(article => counts[article] === 14));
    sequences.add(app.questions.map(item => item.noun).join(","));
  }
  equal(extraArticles.size, 3, "all three articles can receive 14");
  assert(sequences.size > 1, "random ordering varies");
  mainRound(app, () => false);
  app.elements.restart.click();
  verifySet(app.questions); verifyBalance(app.questions);
  results.push("Balance tests 1–3: 300 sets + restart, 13/13/14, all three extra articles, no duplicates");
}
{
  const priority = [
    ...DATA.filter(item => item.article === "der").slice(0, 2),
    DATA.find(item => item.article === "die")
  ].map(item => item.noun);
  const app = makeApp(storageWith(priority));
  verifySet(app.questions, priority); verifyBalance(app.questions);
  results.push("Balance tests 4–5: localStorage carryover 2 der + 1 die, first three, balanced, no repeats");
}
{
  for (const article of ["der", "die", "das"]) {
    for (const count of [13, 14, 16, 25, 39, 40]) {
      const priority = DATA.filter(item => item.article === article).slice(0, count).map(item => item.noun);
      const app = makeApp(storageWith(priority));
      verifySet(app.questions, priority);
      const counts = articleCounts(app.questions);
      if (count <= 14) verifyBalance(app.questions);
      else {
        equal(counts[article], count, "no carryover lost, no extra overrepresented nouns");
        const others = Object.keys(counts).filter(key => key !== article).map(key => counts[key]);
        assert(Math.abs(others[0] - others[1]) <= 1, "remaining slots balanced");
        if (count === 16) equal(others, [12, 12], "16/12/12");
      }
    }
  }
  // 複数の冠詞が目安を超える場合も、繰り越しを全て残す。
  const priority = [
    ...DATA.filter(item => item.article === "der").slice(0, 16),
    ...DATA.filter(item => item.article === "die").slice(0, 16)
  ].map(item => item.noun);
  const app = makeApp(storageWith(priority));
  verifySet(app.questions, priority);
  equal(articleCounts(app.questions), {der: 16, die: 16, das: 8}, "two overrepresented articles");
  results.push("Balance test 6: skewed carryover retained, including 16/12/12, 16/16/8 and 40 carryover nouns");
}
{
  const app = makeApp(storageWith());
  mainRound(app, i => i < 5);
  equal(app.elements["main-summary"].textContent, "35 / 40 richtig · Trefferquote: 87,5 %", "main score");
  equal(app.elements.mistakes.children.length, 5, "mistake list");
  const reviewNames = app.review.map(item => item.noun);
  equal(reviewNames, app.mainAnswers.filter(a => !a.correct).map(a => a.item.noun), "review only actual mistakes");
  app.startReview();
  for (let i = 0; i < 5; i++) answer(app, i >= 2);
  equal(app.state, "final", "review finishes once");
  app.elements.restart.click();
  verifySet(app.questions, reviewNames.slice(0, 2)); verifyBalance(app.questions);
  results.push("Balance test 7: result, mistake list, single review, save and balanced restart preserved");
}
Math.random = originalRandom;
JSON.stringify(results);
