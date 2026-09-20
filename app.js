"use strict";

const SESSION_SIZE = 40;
const STORAGE_KEY = "nomenDrillCarryover";
const ui = Object.fromEntries([
  "question", "stage", "progress", "noun", "feedback", "next",
  "main-result", "main-summary", "mistakes", "review-start", "final-result",
  "final-summary", "review-summary", "carryover-count", "carryover-list", "restart", "storage-notice"
].map((id) => [id, document.getElementById(id)]));
const articleButtons = document.querySelectorAll("[data-article]");
let nouns = [];
let state = "loading"; // loading / main / mainResult / review / final / error
let mainQuestions = [];
let reviewQuestions = [];
let mainAnswers = [];
let reviewAnswers = [];
let questionIndex = 0;
let answered = false;
let carryoverInMemory = [];
let carryoverSaveFailed = false;

async function loadNouns() {
  const response = await fetch("./data/nouns.json");
  if (!response.ok) throw new Error("Die Nomen konnten nicht geladen werden.");
  const data = await response.json();
  if (!Array.isArray(data.nouns) || data.nouns.length === 0 || !data.nouns.every((item) =>
    item && typeof item.noun === "string" && item.noun.trim() &&
    ["der", "die", "das"].includes(item.article)
  )) throw new Error("Die Nomenliste hat ein ungültiges Format.");
  // 名詞文字列を識別子として使用するため、重複データを除外する。
  return [...new Map(data.nouns.map((item) => [item.noun, item])).values()];
}

function showStorageNotice(message = "") {
  ui["storage-notice"].textContent = message;
  ui["storage-notice"].hidden = !message;
}

function validCarryover(value) {
  if (!Array.isArray(value)) return [];
  const known = new Set(nouns.map((item) => item.noun));
  return [...new Set(value.filter((name) => typeof name === "string" && known.has(name)))];
}

function loadCarryover() {
  // 保存に失敗した直後は、古い保存値より今回の結果を優先する。
  if (carryoverSaveFailed) return validCarryover(carryoverInMemory);
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    carryoverInMemory = validCarryover(saved ? JSON.parse(saved) : []);
    showStorageNotice();
  } catch (error) {
    showStorageNotice("Gespeicherte Wörter konnten nicht gelesen werden. Du kannst trotzdem üben.");
  }
  return validCarryover(carryoverInMemory);
}

function saveCarryover(names) {
  carryoverInMemory = validCarryover(names);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(carryoverInMemory));
    carryoverSaveFailed = false;
    showStorageNotice();
  } catch (error) {
    carryoverSaveFailed = true;
    showStorageNotice("Die Wörter konnten nicht dauerhaft gespeichert werden. Lass diese Seite für die nächste Runde geöffnet.");
  }
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function groupNounsByArticle(items) {
  const groups = { der: [], die: [], das: [] };
  items.forEach((item) => groups[item.article].push(item));
  return groups;
}

// 40語未満のときだけ、従来の全語を一巡ずつ出す方式を使う。
function createRepeatedQuestions(priority) {
  const used = new Set(priority.map((item) => item.noun));
  const questions = [...priority, ...shuffle(nouns.filter((item) => !used.has(item.noun)))];
  // 全語を使い切るたびにシャッフル。周回の境界でも連続出題を避ける。
  while (questions.length < SESSION_SIZE) {
    const batch = shuffle(nouns);
    if (batch.length > 1 && batch[0].noun === questions[questions.length - 1].noun) {
      [batch[0], batch[1]] = [batch[1], batch[0]];
    }
    questions.push(...batch);
  }
  return questions.slice(0, SESSION_SIZE);
}

function createMainQuestions(carryover) {
  const byName = new Map(nouns.map((item) => [item.noun, item]));
  const priority = validCarryover(carryover)
    .slice(0, SESSION_SIZE)
    .map((name) => byName.get(name));
  if (nouns.length < SESSION_SIZE) return createRepeatedQuestions(priority);

  const used = new Set(priority.map((item) => item.noun));
  const groups = groupNounsByArticle(nouns.filter((item) => !used.has(item.noun)));
  const counts = { der: 0, die: 0, das: 0 };
  priority.forEach((item) => counts[item.article]++);

  // 同数の冠詞の優先順を毎セット変える。通常は先頭の冠詞が14問になる。
  const articleOrder = shuffle(["der", "die", "das"]);
  articleOrder.forEach((article) => { groups[article] = shuffle(groups[article]); });
  const selected = [];
  while (priority.length + selected.length < SESSION_SIZE) {
    // 在庫がある冠詞の中で最少のものを補充する。
    // 繰り越しが偏っていても削除せず、残りで差を小さくする。
    const available = articleOrder.filter((article) => groups[article].length > 0);
    const minimum = Math.min(...available.map((article) => counts[article]));
    const article = available.find((article) => counts[article] === minimum);
    selected.push(groups[article].pop());
    counts[article]++;
  }
  return [...priority, ...shuffle(selected)];
}

function setScreen(screen) {
  ui.question.hidden = screen !== "question";
  ui["main-result"].hidden = screen !== "main-result";
  ui["final-result"].hidden = screen !== "final-result";
}

function setAnswerButtonsEnabled(enabled) {
  articleButtons.forEach((button) => { button.disabled = !enabled; });
}

function startSession() {
  mainQuestions = createMainQuestions(loadCarryover());
  mainAnswers = [];
  reviewAnswers = [];
  reviewQuestions = [];
  questionIndex = 0;
  state = "main";
  showQuestion();
}

function currentQuestions() {
  return state === "review" ? reviewQuestions : mainQuestions;
}

function showQuestion() {
  const questions = currentQuestions();
  answered = false;
  setScreen("question");
  ui.stage.textContent = state === "review" ? "Wiederholung" : "Hauptrunde";
  ui.progress.textContent = `${questionIndex + 1} / ${questions.length}`;
  ui.noun.textContent = questions[questionIndex].noun;
  ui.feedback.textContent = "";
  delete ui.feedback.dataset.result;
  setAnswerButtonsEnabled(true);
  ui.next.disabled = true;
  ui.next.textContent = questionIndex === questions.length - 1 ? "Ergebnis anzeigen" : "Nächste Aufgabe";
  articleButtons[0].focus();
}

function checkAnswer(selectedArticle) {
  if (!["main", "review"].includes(state) || answered || !["der", "die", "das"].includes(selectedArticle)) return;
  // 状態を先にロックし、連打による重複記録を防ぐ。
  answered = true;
  const item = currentQuestions()[questionIndex];
  const correct = selectedArticle === item.article;
  const answers = state === "main" ? mainAnswers : reviewAnswers;
  answers.push({ item, selectedArticle, correct });
  ui.feedback.textContent = correct ? "Richtig!" : `Leider falsch. Richtig ist: ${item.article} ${item.noun}.`;
  ui.feedback.dataset.result = correct ? "correct" : "incorrect";
  setAnswerButtonsEnabled(false);
  ui.next.disabled = false;
  ui.next.focus();
}

function nextQuestion() {
  if (!["main", "review"].includes(state) || !answered) return;
  answered = false;
  questionIndex++;
  if (questionIndex < currentQuestions().length) showQuestion();
  else if (state === "main") showMainResult();
  else finishReview();
}

function mainSummary() {
  const correct = mainAnswers.filter((answer) => answer.correct).length;
  const percent = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(correct / SESSION_SIZE * 100);
  return `${correct} / ${SESSION_SIZE} richtig · Trefferquote: ${percent} %`;
}

function renderMistakes() {
  ui.mistakes.replaceChildren();
  mainAnswers.forEach((answer, index) => {
    if (answer.correct) return;
    const row = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `Aufgabe ${index + 1}: ${answer.item.noun}`;
    row.append(title);
    if (typeof answer.item.meaning === "string" && answer.item.meaning.trim()) {
      const meaning = document.createElement("span");
      meaning.lang = "ja";
      meaning.textContent = ` (${answer.item.meaning})`;
      row.append(meaning);
    }
    const detail = document.createElement("p");
    detail.textContent = `Deine Antwort: ${answer.selectedArticle} · Richtig: ${answer.item.article}`;
    row.append(detail);
    ui.mistakes.append(row);
  });
}

function showMainResult() {
  state = "mainResult";
  const mistakes = mainAnswers.filter((answer) => !answer.correct);
  // 同じ名詞を何回間違えても、復習キューには1回だけ登録する。
  reviewQuestions = [...new Map(mistakes.map((answer) => [answer.item.noun, answer.item])).values()];
  if (reviewQuestions.length === 0) {
    finishReview();
    return;
  }
  setScreen("main-result");
  ui["main-summary"].textContent = mainSummary();
  renderMistakes();
  ui["review-start"].textContent = `Wiederholung starten (${reviewQuestions.length})`;
  ui["main-result"].focus();
}

function startReview() {
  if (state !== "mainResult") return;
  state = "review";
  questionIndex = 0;
  reviewAnswers = [];
  showQuestion();
}

function finishReview() {
  const remaining = reviewAnswers.filter((answer) => !answer.correct).map((answer) => answer.item.noun);
  // 完了時だけ置き換える。途中で閉じても以前の保存内容は残る。
  saveCarryover(remaining);
  showFinalResult(remaining);
}

function showFinalResult(remaining) {
  state = "final";
  setScreen("final-result");
  ui["final-summary"].textContent = mainSummary();
  const reviewCorrect = reviewAnswers.filter((answer) => answer.correct).length;
  ui["review-summary"].textContent = reviewQuestions.length === 0
    ? "Alles richtig! Keine Wiederholung nötig."
    : `Wiederholung: ${reviewQuestions.length} Aufgaben · Richtig: ${reviewCorrect} · Falsch: ${remaining.length}`;
  ui["carryover-count"].textContent = `Wörter für die nächste Runde: ${remaining.length}`;
  ui["carryover-list"].replaceChildren();
  remaining.forEach((name) => {
    const item = nouns.find((entry) => entry.noun === name);
    const row = document.createElement("li");
    row.textContent = `${item.article} ${item.noun}`;
    ui["carryover-list"].append(row);
  });
  ui["final-result"].focus();
}

function setupEvents() {
  articleButtons.forEach((button) => {
    button.addEventListener("click", () => checkAnswer(button.dataset.article));
  });
  ui.next.addEventListener("click", nextQuestion);
  ui["review-start"].addEventListener("click", startReview);
  ui.restart.addEventListener("click", () => {
    if (state === "final") startSession();
  });
}

async function initializeApp() {
  setupEvents();
  try {
    nouns = await loadNouns();
    startSession();
  } catch (error) {
    state = "error";
    ui.noun.textContent = "Fehler beim Laden";
    ui.feedback.textContent = "Die Daten konnten nicht geladen werden. Bitte öffne die App über einen lokalen Server und lade die Seite neu.";
    ui.feedback.dataset.result = "error";
    setAnswerButtonsEnabled(false);
    ui.next.disabled = true;
    console.error(error);
  }
}

initializeApp();
