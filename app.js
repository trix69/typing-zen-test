(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const ROUND = { warm: 5, words: 10, spell: 10, sentences: 10, fixit: 10, tricky: 10 };
  const TITLES = {
    warm: "⌨️ Warm-up", words: "🌼 Word Garden", spell: "🐝 Spelling Bee",
    sentences: "🌊 Sentence Stream", fixit: "🔧 Fix-It", tricky: "🎯 Tricky Words",
  };
  const PRAISE = ["Lovely!", "Brilliant!", "Smooth!", "Nice and calm.", "Great typing!", "Spot on!"];

  // ---------- Saved progress (per browser) ----------
  const KEY = "typingZen.v1-test";
  const profile = Object.assign(
    { name: "Luke", bucket: "Y1", bestWpm: 0, stars: 0, rounds: 0, tricky: {}, seen: {}, mute: false },
    (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })()
  );
  // Names start with a capital, and a blank name falls back to Luke.
  const tidyName = (n) => { n = (n || "").trim(); return n ? n[0].toUpperCase() + n.slice(1) : "Luke"; };
  profile.name = tidyName(profile.name); // earlier visits may have saved "luke" or a blank name
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* storage unavailable */ } };

  // ---------- Keyboard model ----------
  // A full-size keyboard laid out like TypingClub's: every row is 15 key-widths wide,
  // so the rows stagger the way a real keyboard does. [label, id, width]; a bare string is a 1-wide key.
  const ROWS = [
    ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", ["backspace", "backspace", 2]],
    [["tab", "tab", 1.5], "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", ["\\", "\\", 1.5]],
    [["caps lock", "caps", 1.75], "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", ["enter", "enter", 2.25]],
    [["shift", "shift-l", 2.25], "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", ["shift", "shift-r", 2.75]],
    [["ctrl", "ctrl-l", 2.25], ["alt", "alt-l", 1.5], ["", " ", 6.25], ["alt", "alt-r", 1.5], ["ctrl", "ctrl-r", 3.5]],
  ];
  const FINGERS = {
    "left pinky": "`1qaz", "left ring": "2wsx", "left middle": "3edc", "left index": "45rtfgvb",
    "right index": "67yuhjnm", "right middle": "8ik,", "right ring": "9ol.", "right pinky": "0-=p[];'/\\",
  };
  const fingerOf = {};
  for (const [f, keys] of Object.entries(FINGERS)) for (const k of keys) fingerOf[k] = f;
  Object.assign(fingerOf, { " ": "thumb", tab: "left pinky", caps: "left pinky", "shift-l": "left pinky",
    backspace: "right pinky", enter: "right pinky", "shift-r": "right pinky" });
  const SHIFTED = { "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
    "_": "-", "+": "=", "{": "[", "}": "]", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/", "~": "`", "|": "\\" };

  let capsOn = false; // Caps Lock, as last reported by the real keyboard
  let shiftHeld = false;

  // Which on-screen key types ch, and whether Shift is needed (letters flip when Caps Lock is on).
  function baseKey(ch) {
    if (SHIFTED[ch]) return { key: SHIFTED[ch], shift: true };
    const lower = ch.toLowerCase();
    if (lower !== ch.toUpperCase()) return { key: lower, shift: (ch !== lower) !== capsOn };
    return { key: ch, shift: false };
  }

  function buildKeyboard() {
    const kbd = $("#kbd");
    for (const row of ROWS) {
      const el = document.createElement("div");
      el.className = "row";
      for (const spec of row) {
        const [label, id, width] = Array.isArray(spec) ? spec : [spec, spec, 1];
        const k = document.createElement("div");
        k.className = "key " + (fingerOf[id] || "mod").split(" ").pop();
        if (id.length > 1) k.classList.add("named");
        if (id === "f" || id === "j") k.classList.add("bump");
        k.style.setProperty("--w", width);
        k.dataset.key = id;
        k.textContent = label;
        el.append(k);
      }
      kbd.append(el);
    }
  }
  const keyEl = (id) => document.querySelector(`.kbd [data-key="${CSS.escape(id)}"]`);

  // The on-screen keys show what they would type right now: Caps Lock makes letters capital,
  // Shift makes symbols and flips letters (so Shift with Caps Lock on gives lower case).
  const SHIFT_LABEL = Object.fromEntries(Object.entries(SHIFTED).map(([sym, key]) => [key, sym]));
  function refreshKeyboard() {
    for (const k of document.querySelectorAll(".kbd .key")) {
      const id = k.dataset.key;
      if (id.length !== 1 || id === " ") continue;
      const isLetter = id !== id.toUpperCase();
      k.textContent = isLetter ? (shiftHeld !== capsOn ? id.toUpperCase() : id) : shiftHeld ? SHIFT_LABEL[id] || id : id;
    }
    keyEl("shift-l").classList.toggle("held", shiftHeld);
    keyEl("shift-r").classList.toggle("held", shiftHeld);
    keyEl("caps").classList.toggle("locked", capsOn);
  }
  function readModifiers(e) {
    const caps = e.getModifierState ? e.getModifierState("CapsLock") : capsOn;
    if (caps === capsOn && e.shiftKey === shiftHeld) return;
    const capsChanged = caps !== capsOn;
    capsOn = caps;
    shiftHeld = e.shiftKey;
    refreshKeyboard();
    if (capsChanged && game && !$("#play").hidden) showNextKey(); // Shift may now be needed or not
  }
  document.addEventListener("keydown", readModifiers);
  document.addEventListener("keyup", readModifiers);
  window.addEventListener("blur", () => { shiftHeld = false; refreshKeyboard(); });

  // ---------- Sound ----------
  let audio;
  function tone(freq, dur = 0.08, type = "sine", vol = 0.05) {
    if (profile.mute) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.connect(g).connect(audio.destination);
      o.start(); o.stop(audio.currentTime + dur);
    } catch { /* no audio */ }
  }
  const sfx = {
    tap: () => tone(660 + Math.random() * 60, 0.05, "sine", 0.03),
    miss: () => tone(150, 0.15, "triangle", 0.06),
    chime: () => { tone(784, 0.25); setTimeout(() => tone(1047, 0.35), 110); },
  };

  // Speaks each text in turn with a one-second pause between them.
  // Any new call (or leaving the game) stops a sequence that is still playing.
  let speechRun = 0;
  function speak(...texts) {
    const run = ++speechRun;
    if (profile.mute || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const say = (i) => {
      if (run !== speechRun || i >= texts.length) return;
      const u = new SpeechSynthesisUtterance(texts[i]);
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find((v) => v.lang === "en-GB") || voices.find((v) => v.lang.startsWith("en")) || null;
      u.lang = "en-GB";
      u.rate = 0.85;
      u.onend = () => setTimeout(() => say(i + 1), 1000);
      speechSynthesis.speak(u);
    };
    say(0);
  }
  const stopSpeech = () => { speechRun++; if ("speechSynthesis" in window) speechSynthesis.cancel(); };

  // ---------- Building a round ----------
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const toWord = ([word, meaning, sentence, why]) => ({ word, meaning, sentence, why: why === "simple, phonetic" ? "" : why });
  const allWords = () => WORD_GROUPS.flatMap((g) => g.words.map(toWord));
  // One level per school year (wordlist/years.txt), with hand-picked sample words.
  // `name` matches words.js and the saved level; `label` is what the button shows.
  const BUCKETS = [
    { name: "Y1", label: "Year 1", sample: "dog, house, friend" },
    { name: "Y2", label: "Year 2", sample: "because, people, water" },
    { name: "Y3", label: "Year 3", sample: "answer, remember, young" },
    { name: "Y4", label: "Year 4", sample: "believe, surprise, library" },
    { name: "Y5", label: "Year 5", sample: "queue, receive, doubt" },
    { name: "Y6", label: "Year 6", sample: "necessary, rhythm, conscience" },
  ];
  for (const b of BUCKETS) b.words = WORD_GROUPS.filter((g) => g.level === b.name).flatMap((g) => g.words);
  const currentBucket = () => BUCKETS.find((b) => b.name === profile.bucket) || BUCKETS[0];
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Where the word sits in its sentence, matching whole words only (so "a" never matches inside "cat").
  function findWord(sentence, word) {
    const re = new RegExp(`(?<![\\w'-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w'-])`, "i");
    return sentence.search(re);
  }
  function blankOut(sentence, word) {
    const at = findWord(sentence, word);
    if (at < 0) return escapeHtml(sentence);
    // One underscore per letter, so the gap matches the length of the word.
    const gap = `<span class="gap" aria-label="${word.length} letters">${"_".repeat(word.length)}</span>`;
    return escapeHtml(sentence.slice(0, at)) + gap + escapeHtml(sentence.slice(at + word.length));
  }
  const tip = (it) => (it.why ? `<div class="why">Tricky bit: ${escapeHtml(it.why)}</div>` : "");

  // ---------- Warm-up drills ----------
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const pickN = (list, n) => shuffle(list).slice(0, n);

  // Picks n items, preferring the ones practised longest ago (never-seen first), so rounds rotate
  // through the whole level before repeating. profile.seen maps item key -> pick counter.
  let seenTick = Math.max(0, ...Object.values(profile.seen));
  function freshPick(list, n, key) {
    const picked = shuffle(list).sort((a, b) => (profile.seen[key(a)] || 0) - (profile.seen[key(b)] || 0)).slice(0, n);
    seenTick++;
    for (const it of picked) profile.seen[key(it)] = seenTick;
    save();
    return shuffle(picked);
  }
  const byWord = (w) => w.word;
  const repeat = (n, make) => Array.from({ length: n }, make).join(" ");
  const randomLetters = (keys, groups, size) => repeat(groups, () => Array.from({ length: size }, () => pick(keys)).join(""));
  // Up-and-down reaches from a home key and back: "frf", "jmj".
  const REACHES = ["fr", "fv", "ft", "fg", "fb", "ju", "jm", "jy", "jh", "jn", "de", "dc", "ki", "k,", "sw", "sx", "lo", "l.", "aq", "az", ";p"];
  const WARMUP_KINDS = [
    ["Home row: keep your fingers on the F and J bumps", () => randomLetters("asdfghjkl", 5, 3)],
    ["Home row words", () => pickN(WARMUP.homeWords, 4).join(" ")],
    ["Top row: reach up and come back home", () => randomLetters("qwertyuiop", 5, 3)],
    ["Top row words", () => pickN(WARMUP.topWords, 4).join(" ")],
    ["Bottom row: reach down and come back home", () => randomLetters("zxcvbnm", 5, 3)],
    ["Bottom row words", () => pickN(WARMUP.bottomWords, 4).join(" ")],
    ["Finger reaches: start and finish on the home key", () => pickN(REACHES, 5).map((r) => r[0] + r[1] + r[0]).join(" ")],
    ["Numbers: use the finger above each home key", () => repeat(4, () => String(10 + Math.floor(Math.random() * 90)))],
    ["Capital letters: Shift with the other hand", () => pickN(WARMUP.names, 4).join(" ")],
    ["Punctuation", () => pickN(WARMUP.phrases, 2).join(" ")],
    ["Every letter of the alphabet", () => pick(WARMUP.pangrams)],
    ["Words from your level", () => pickN(currentBucket().words.map((w) => w[0]).filter((w) => /^[a-z]{3,7}$/.test(w)), 4).join(" ")],
  ];

  function buildItems(mode) {
    const n = ROUND[mode];
    const pool = currentBucket().words.map(toWord);
    switch (mode) {
      case "warm":
        // Five different kinds of drill each round, each freshly made.
        return shuffle(WARMUP_KINDS).slice(0, n).map(([tag, make]) => ({ tag, target: make() }));
      case "words":
        return freshPick(pool, n, byWord).map((w) => ({ ...w, target: w.word }));
      case "spell": {
        // Up to 3 tricky words from this level come back for another go; the rest are fresh words.
        const tricky = pickN(pool.filter((w) => profile.tricky[w.word]), 3);
        const fresh = freshPick(pool.filter((w) => !tricky.includes(w)), n - tricky.length, byWord);
        return shuffle([...tricky, ...fresh]).map((w) => ({ ...w, target: w.word, hidden: true }));
      }
      case "tricky": {
        const tricky = allWords().filter((w) => profile.tricky[w.word]);
        return shuffle(tricky).slice(0, n).map((w) => ({ ...w, target: w.word, hidden: true }));
      }
      case "sentences":
        return freshPick(pool, n, (w) => "s:" + w.word).map((w) => ({ ...w, target: w.sentence }));
      case "fixit":
        return freshPick(FIXITS, n, (f) => "f:" + f.right).map((f) => ({ ...f, target: f.right, hidden: true, open: true }));
    }
  }

  // ---------- Game state ----------
  let game = null;

  function start(mode) {
    const items = buildItems(mode);
    if (!items.length) return;
    game = { mode, items, idx: 0, correct: 0, errors: 0, ms: 0, missed: new Set() };
    $("#modeTitle").textContent = TITLES[mode];
    $("#trail").innerHTML = items.map(() => "<i></i>").join("");
    show("play");
    loadItem();
  }

  function loadItem() {
    const it = game.items[game.idx];
    Object.assign(game, { typed: "", posErr: 0, revealed: false, itemErr: 0, itemStart: null, wait: false, leaving: null });
    $("#msg").className = "msg";
    $("#msg").innerHTML = "";
    $("#line").className = "line" + (it.target.length > 24 ? " small" : "");
    [...$("#trail").children].forEach((el, i) => { el.className = i < game.idx ? "done" : i === game.idx ? "now" : ""; });
    renderCard(it);
    renderLine();
    if (it.hidden && !it.open) setTimeout(() => speak(it.word, it.sentence), 250);
    else if (game.mode === "words") setTimeout(() => speak(it.word), 250);
    else if (game.mode === "sentences") setTimeout(() => speak(it.sentence), 250);
  }

  function renderCard(it) {
    const card = $("#card");
    const m = game.mode;
    if (m === "warm") {
      card.innerHTML = `<div class="tagline">${escapeHtml(it.tag)}</div>`;
    } else if (m === "words") {
      card.innerHTML = `<div class="meaning"><b>${escapeHtml(it.word)}</b> means ${escapeHtml(it.meaning)}</div>
        ${tip(it)}
        <div class="tools"><button class="ghost" data-say="word">🔊 Hear it again</button></div>`;
    } else if (m === "spell" || m === "tricky") {
      card.innerHTML = `<div class="meaning">It means ${escapeHtml(it.meaning)}</div>
        <div class="clue">${blankOut(it.sentence, it.word)}</div>
        <div class="tools"><button class="ghost" data-say="word">🔊 Hear the word</button><button class="ghost" data-say="sentence">🔊 Hear the sentence</button></div>`;
    } else if (m === "sentences") {
      card.innerHTML = `<div class="tagline">Remember the capital letter and the full stop</div>
        <div class="meaning"><b>${escapeHtml(it.word)}</b> means ${escapeHtml(it.meaning)}</div>
        <div class="tools"><button class="ghost" data-say="sentence">🔊 Hear it again</button></div>`;
    } else if (m === "fixit") {
      card.innerHTML = `<div class="tagline">${escapeHtml(it.tag)} · find the mistake</div>
        <div class="wrong">${escapeHtml(it.wrong)}</div>
        <div class="meaning">Type the sentence correctly.</div>
        <div class="tools"><button class="ghost" data-hint>💡 Show the rule</button></div>`;
    }
  }

  function renderLine() {
    const it = game.items[game.idx];
    const t = it.target, n = game.typed.length;
    let html = "";
    if (it.hidden && it.open) {
      // Fix-It: the answer length stays secret, show only what has been typed.
      html = `<span class="done">${escapeHtml(game.typed)}</span>`;
      if (n < t.length) html += game.revealed ? `<span class="hint cur">${vis(t[n])}</span>` : `<span class="caret"></span>`;
    } else {
      let vocabAt = -1;
      if (game.mode === "sentences") vocabAt = findWord(t, it.word);
      for (let i = 0; i < t.length; i++) {
        let cls, ch = t[i];
        if (i < n) cls = "done";
        else if (it.hidden) { cls = i === n ? "blank cur" : "blank"; if (!(i === n && game.revealed)) ch = "_"; else cls = "hint cur"; }
        else cls = i === n ? "todo cur" : "todo";
        if (vocabAt >= 0 && i >= vocabAt && i < vocabAt + it.word.length) cls += " vocab";
        html += `<span class="${cls}">${vis(ch)}</span>`;
      }
    }
    $("#line").innerHTML = html;
    showNextKey();
    updateLive();
  }
  const vis = (ch) => escapeHtml(ch); // a space stays a normal-width space, even when it is next

  function showNextKey() {
    document.querySelectorAll(".kbd .next").forEach((k) => k.classList.remove("next"));
    const it = game.items[game.idx];
    const ch = it.target[game.typed.length];
    const finger = $("#finger");
    if (!ch || game.wait) { finger.textContent = ""; return; }
    if (it.hidden && !game.revealed) {
      finger.textContent = game.mode === "fixit" ? "Type the fixed sentence from the start." : "Spell it from memory. Press 🔊 to hear it again.";
      return;
    }
    const { key, shift } = baseKey(ch);
    keyEl(key)?.classList.add("next");
    const f = fingerOf[key] || "";
    let text = f === "thumb" ? "Space bar: either thumb" : `Use your ${f} finger`;
    if (shift && capsOn) {
      // Caps Lock is on, so this is a lower-case letter: either Shift will do.
      keyEl("shift-l").classList.add("next");
      keyEl("shift-r").classList.add("next");
      text += " and hold either Shift (Caps Lock is on)";
    } else if (shift) {
      const side = f.startsWith("left") ? "r" : "l";
      keyEl("shift-" + side).classList.add("next");
      text += ` and hold Shift with your ${side === "l" ? "left" : "right"} pinky`;
    }
    finger.textContent = text;
  }

  function updateLive() {
    const ms = game.ms + (game.itemStart ? performance.now() - game.itemStart : 0);
    $("#liveWpm").textContent = wpm(game.correct, ms);
    $("#liveAcc").textContent = accuracy();
  }
  const wpm = (chars, ms) => (ms < 1500 ? 0 : Math.round(chars / 5 / (ms / 60000)));
  const accuracy = () => { const t = game.correct + game.errors; return t ? Math.round((game.correct / t) * 100) : 100; };

  function press(raw) {
    const it = game.items[game.idx];
    const ch = raw === "’" || raw === "‘" ? "'" : raw;
    const want = it.target[game.typed.length];
    if (game.itemStart === null) game.itemStart = performance.now();
    const { key } = baseKey(ch);
    const k = keyEl(key);

    if (ch === want) {
      game.typed += ch;
      game.correct++;
      game.posErr = 0;
      game.revealed = false;
      sfx.tap();
      if (k) { k.classList.add("hit"); setTimeout(() => k.classList.remove("hit"), 90); }
      if (game.typed === it.target) return complete(it);
    } else {
      game.errors++;
      game.itemErr++;
      game.posErr++;
      if (game.posErr >= 2) game.revealed = true;
      sfx.miss();
      const line = $("#line");
      line.classList.remove("shake"); void line.offsetWidth; line.classList.add("shake");
      if (k) { k.classList.add("miss"); setTimeout(() => k.classList.remove("miss"), 200); }
      if (it.hidden && game.revealed) $("#msg").textContent = "Here's a hint: type the orange letter.";
    }
    renderLine();
  }

  function complete(it) {
    game.ms += performance.now() - game.itemStart;
    game.itemStart = null;
    game.wait = true;
    renderLine();
    $("#line").classList.add("win");
    sfx.chime();

    if (it.word && game.mode !== "sentences") {
      if (game.itemErr > 0) {
        profile.tricky[it.word] = (profile.tricky[it.word] || 0) + 1;
        game.missed.add(it.word);
      } else if (profile.tricky[it.word] && (game.mode === "spell" || game.mode === "tricky")) {
        // Spelling it cleanly from memory earns the word its way off the list.
        if (--profile.tricky[it.word] <= 0) delete profile.tricky[it.word];
      }
      save();
    }

    const msg = $("#msg");
    const praise = game.itemErr === 0 ? PRAISE[Math.floor(Math.random() * PRAISE.length)] : "Done. Keep going!";
    if (game.mode === "fixit") {
      msg.className = "msg good";
      msg.innerHTML = `✓ Fixed it! <span class="rule">${escapeHtml(it.rule)}</span><span class="rule">Press <kbd>Enter</kbd> for the next one.</span>`;
      game.wait = "enter";
    } else {
      msg.className = "msg good";
      msg.innerHTML = escapeHtml((it.hidden ? `✓ ${it.word}. ` : "✓ ") + praise) +
        (it.hidden && it.why ? `<span class="rule">Tricky bit: ${escapeHtml(it.why)}</span>` : "");
      setTimeout(next, it.hidden ? 1300 : 700);
    }
  }

  function next() {
    if (!game) return;
    game.idx++;
    if (game.idx >= game.items.length) finish();
    else loadItem();
  }

  function finish() {
    const acc = accuracy();
    const speed = wpm(game.correct, game.ms);
    const stars = acc >= 95 ? 3 : acc >= 85 ? 2 : 1;
    const newBest = speed > profile.bestWpm && game.mode !== "fixit";
    profile.stars += stars;
    profile.rounds++;
    if (newBest) profile.bestWpm = speed;
    save();

    $("#stars").innerHTML = [1, 2, 3].map((i) => `<span class="${i <= stars ? "" : "off"}">⭐</span>`).join("");
    const who = profile.name ? `, ${escapeHtml(profile.name)}` : "";
    $("#resTitle").innerHTML = (stars === 3 ? `Wonderful${who}!` : stars === 2 ? `Well done${who}!` : `Good effort${who}!`) + (newBest ? " New best speed!" : "");
    $("#resWpm").textContent = speed;
    $("#resAcc").textContent = acc + "%";
    $("#resItems").textContent = game.items.length;
    $("#resTricky").innerHTML = game.missed.size
      ? `<div class="label">Words to practise again</div><div class="tricky-list">${[...game.missed].map((w) => `<span>${escapeHtml(w)}</span>`).join("")}</div>`
      : "";
    show("results");
  }

  // ---------- Screens ----------
  function show(id) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
    if (id === "home") renderHome();
  }

  function renderHome() {
    game = null;
    stopSpeech();
    $("#name").value = profile.name;
    for (const b of document.querySelectorAll(".level")) b.setAttribute("aria-checked", String(b.dataset.bucket === currentBucket().name));
    const parts = [];
    if (profile.rounds) parts.push(`⭐ ${profile.stars} stars`, `🏃 best ${profile.bestWpm} wpm`, `${profile.rounds} rounds played`);
    $("#homeStats").textContent = parts.length ? parts.join("   ·   ") : "Pick a level and a game to begin.";
    $("#clearBtn").hidden = !profile.rounds && !Object.keys(profile.tricky).length;
    $("#clearConfirm").hidden = true;
    const tricky = Object.keys(profile.tricky).length;
    $("#trickyBtn").hidden = tricky === 0;
    // A word missed in several rounds needs that many clean spellings to clear.
    const repeats = Object.values(profile.tricky).some((n) => n > 1);
    $("#trickyInfo").textContent = `${tricky} word${tricky === 1 ? "" : "s"} you found hard. Spell ${tricky === 1 ? "it" : "each one"} right to clear it` +
      (repeats ? ", or a few times if you missed it more than once." : ".");
    showSoundIcon();
  }

  // Speaker icons: green with sound waves when sound is on, red with a cross when muted.
  const SPEAKER = '<path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/>';
  const SOUND_ON = `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const SOUND_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}<path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  function showSoundIcon() {
    const b = $("#muteBtn");
    b.innerHTML = profile.mute ? SOUND_OFF : SOUND_ON;
    b.classList.toggle("muted", profile.mute);
    b.setAttribute("aria-label", profile.mute ? "Sound is off. Turn sound on" : "Sound is on. Turn sound off");
    b.title = profile.mute ? "Sound off" : "Sound on";
  }

  // ---------- Events ----------
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "name") return;
    const playing = !$("#play").hidden;
    if (!$("#results").hidden && e.key === "Enter") { e.preventDefault(); return start(game.mode); }
    if (!$("#results").hidden && e.key === "Escape") return show("home");
    if (!playing || !game) return;
    if (e.key === "Escape") return leave();
    if (game.leaving) {
      // Any other key means "stay": put the message back, and type the key as normal.
      $("#msg").className = game.leaving.cls;
      $("#msg").innerHTML = game.leaving.html;
      game.leaving = null;
      if (e.key === "Enter" && game.wait !== "enter") { e.preventDefault(); return; }
    }
    if (game.wait === "enter") { if (e.key === "Enter") { e.preventDefault(); next(); } return; }
    if (game.wait || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;
    e.preventDefault(); // stops space scrolling and quick-find on ' and /
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    press(e.key);
  });

  // Esc asks first, so a stray press doesn't throw away the round. A second Esc leaves.
  function leave() {
    if (game.leaving || (game.idx === 0 && !game.typed)) return show("home");
    const msg = $("#msg");
    game.leaving = { cls: msg.className, html: msg.innerHTML };
    msg.className = "msg";
    msg.innerHTML = `Leave this round? Press <kbd>Esc</kbd> again to go home, or keep typing to stay.`;
  }

  $("#name").addEventListener("input", (e) => { profile.name = tidyName(e.target.value); save(); });
  $("#name").addEventListener("change", (e) => { e.target.value = profile.name; });
  $("#name").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  $("#levels").innerHTML = BUCKETS.map((b) =>
    `<button class="level" data-bucket="${b.name}" role="radio"><b>${b.label}</b><span>${b.words.length} words, like ${b.sample}</span></button>`).join("");
  $("#levels").addEventListener("click", (e) => {
    const b = e.target.closest(".level");
    if (b) { profile.bucket = b.dataset.bucket; save(); renderHome(); }
  });
  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => { b.blur(); start(b.dataset.mode); }));
  $("#clearBtn").addEventListener("click", () => { $("#clearBtn").hidden = true; $("#clearConfirm").hidden = false; });
  $("#clearNo").addEventListener("click", renderHome);
  $("#clearYes").addEventListener("click", () => {
    // Keeps the name, level and sound setting; wipes scores and tricky words.
    Object.assign(profile, { bestWpm: 0, stars: 0, rounds: 0, tricky: {}, seen: {} });
    save();
    renderHome();
  });
  // ---------- Settings ----------
  // Appearance is Light, Dark or Automatic. THEME (set up in index.html's <head>) saves it to
  // typingZen.theme, apart from the progress in typingZen.v1.
  const sheet = $("#sheet");
  function syncSheet() {
    for (const b of $("#segApp").children) b.setAttribute("aria-checked", String(b.dataset.themeMode === THEME.mode));
  }
  function openSheet() {
    syncSheet();
    sheet.hidden = false;
    document.addEventListener("keydown", onSheetKey);
    $("#sheetCard").focus();
  }
  function closeSheet() {
    sheet.hidden = true;
    document.removeEventListener("keydown", onSheetKey);
    $("#settingsBtn").focus();
  }
  // Esc closes the sheet, and Tab stays inside it.
  function onSheetKey(e) {
    if (e.key === "Escape") { e.preventDefault(); return closeSheet(); }
    if (e.key !== "Tab") return;
    const items = [...sheet.querySelectorAll("button")];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === $("#sheetCard"))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  $("#settingsBtn").addEventListener("click", openSheet);
  $("#sheetDone").addEventListener("click", closeSheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
  $("#segApp").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { THEME.set(b.dataset.themeMode); syncSheet(); }
  });

  $("#backBtn").addEventListener("click", () => show("home"));
  $("#homeBtn").addEventListener("click", () => show("home"));
  $("#againBtn").addEventListener("click", () => start(game.mode));
  $("#muteBtn").addEventListener("click", (e) => {
    profile.mute = !profile.mute; save();
    showSoundIcon();
    e.currentTarget.blur();
  });
  $("#card").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !game) return;
    const it = game.items[game.idx];
    if (b.dataset.say === "word") speak(it.word);
    if (b.dataset.say === "sentence") speak(it.sentence);
    if ("hint" in b.dataset) $("#msg").innerHTML = `💡 <span class="rule">${escapeHtml(it.rule)}</span>`;
    b.blur();
  });
  setInterval(() => { if (game && !$("#play").hidden && game.itemStart) updateLive(); }, 1000);

  buildKeyboard();
  show("home");
})();
