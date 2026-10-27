(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const ROUND = { warm: 5, words: 10, spell: 10, sentences: 10, fixit: 10, tricky: 10 };
  const TITLES = {
    warm: "⌨️ Warm-up", words: "🌼 Word Garden", spell: "🐝 Spelling Bee",
    sentences: "🌊 Sentence Stream", fixit: "🔧 Fix-It", tricky: "🎯 Tricky Words", practise: "✏️ Practice",
  };
  // Practice (user's request, 2026-10-27): the words of one day that weren't right first try in Spelling Bee.
  // Each word is shown and typed until it has been typed PRACTISE_REPS times with no wrong key.
  const PRACTISE_REPS = 5;
  let practiceDay = ""; // the day being practised, as Date.toDateString()
  // Timed games: Spelling Bee is a 20-minute session with as many words as Luke can manage.
  // Words come in batches of ROUND.spell, and none repeats within a session.
  // Spelling Bee lengths (user's request, 2026-10-28): one card, then a choice of 10 or 20 minutes.
  const LENGTHS = { short: 1, long: 2 }; // test build only (live: { short: 10, long: 20 })
  // The time bar flashes red for the last 2.5% of a session: 30 s of 20 minutes, 3 s of 2 (the test build).
  const ENDING = 0.025;
  // When time runs out mid-word, Luke gets up to 10 s more to finish that word (user's request, 2026-10-26).
  const GRACE = 10000;
  const PRAISE = ["Lovely!", "Brilliant!", "Smooth!", "Nice and calm.", "Great typing!", "Spot on!"];

  // ---------- Saved progress (per browser) ----------
  // Several people can use Typing Zen in one browser. typingZen.v2 holds { current, users: { id: profile } };
  // `profile` is the current user's record. 1.0 kept one profile in typingZen.v1: on the first visit with
  // this version it becomes the first user (v1 itself is left as it was).
  const KEY = "typingZen.v2-test";
  const OLD_KEY = "typingZen.v1-test";
  const DEFAULTS = () => ({ name: "", year: "", bucket: "Y1", bestWpm: 0, stars: 0, rounds: 0, tricky: {}, seen: {}, sessions: [], mute: false, keySound: "red", voice: "au-female", practised: {}, practiseOrder: "order", learned: {}, streak: {} });
  // Names start with a capital letter. A blank name stays blank: the welcome form asks for one.
  const tidyName = (n) => { n = (n || "").trim(); return n ? n[0].toUpperCase() + n.slice(1) : ""; };
  const newId = () => "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const store = (() => {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.users) return s; } catch { /* start fresh */ }
    const s = { current: null, users: {} };
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY));
      if (old && typeof old === "object") {
        const id = newId();
        s.users[id] = { ...DEFAULTS(), ...old, name: tidyName(old.name) || "Luke", id };
        s.current = id;
      }
    } catch { /* nothing to bring over */ }
    return s;
  })();
  for (const u of Object.values(store.users)) {
    for (const [k, v] of Object.entries(DEFAULTS())) if (!(k in u)) u[k] = v;
    // A 1.0 profile has no school year: take its level as the year (it can be changed in Settings).
    if (!/^Y[1-6]$/.test(u.year)) u.year = /^Y[1-6]$/.test(u.bucket) ? u.bucket : "Y1";
    // The first key sounds were replaced by five switches (2026-10-27): keep each user's nearest one.
    u.keySound = { soft: "red", cushioned: "red", thock: "black", tactile: "brown", clicky: "blue" }[u.keySound] || u.keySound;
  }
  let profile = store.users[store.current] || DEFAULTS(); // replaced by useProfile() once someone is chosen
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage unavailable */ } };

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
    if (e.fromScreen) return; // a tap on the on-screen keyboard: Shift and Caps Lock are set by tapKey()
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

  // ---------- Tapping or clicking the on-screen keyboard ----------
  // Each key types what it shows (user's request, 2026-10-27, for touch screens and the mouse): the tap is
  // sent through the same keydown handler as a real key. The on-screen Shift works for the next key only,
  // and Caps Lock toggles. Tab, backspace, ctrl and alt type nothing, as on the real keyboard in the games.
  let screenShift = false;
  function tapKey(id) {
    if (id === "shift-l" || id === "shift-r" || id === "caps") pressSound(id);
    if (id === "shift-l" || id === "shift-r") {
      screenShift = shiftHeld = !screenShift;
      return refreshKeyboard();
    }
    if (id === "caps") {
      capsOn = !capsOn;
      refreshKeyboard();
      if (game && !$("#play").hidden) showNextKey(); // Shift may now be needed or not
      return;
    }
    let key = null;
    if (id === "enter") key = "Enter";
    else if (id === " ") key = " ";
    else if (id.length === 1) {
      const isLetter = id !== id.toUpperCase();
      key = isLetter ? (shiftHeld !== capsOn ? id.toUpperCase() : id) : shiftHeld ? SHIFT_LABEL[id] || id : id;
    }
    if (!key) { if (game && !$("#play").hidden) pressSound(id); return; } // tab, backspace, ctrl, alt: a sound only
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    ev.fromScreen = true;
    document.dispatchEvent(ev);
    if (screenShift) {
      screenShift = shiftHeld = false;
      refreshKeyboard();
    }
  }
  $("#kbd").addEventListener("pointerdown", (e) => {
    const k = e.target.closest(".key");
    if (!k) return;
    e.preventDefault(); // no text selection, no focus change, no double-tap zoom
    tapKey(k.dataset.key);
  });
  // Lifting the finger (or the mouse button) plays the release sound.
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
    $("#kbd").addEventListener(ev, (e) => { const k = e.target.closest(".key"); if (k) releaseSound(k.dataset.key); });
  }

  // ---------- Sound ----------
  let audio;
  function tone(freq, dur = 0.08, type = "sine", vol = 0.05) {
    if (muted()) return;
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
  // Key sounds, chosen in Settings: five mechanical keyboard switches (user's choice, 2026-10-27).
  // Recordings from kbsim by Thomas Lai (MIT licence, see sounds/SOURCE.md): one press sound per keyboard
  // row (GENERIC_R0..R4, so Esc, Tab, Caps Lock and Shift sound like their rows), Space, Enter and Backspace's
  // own press and release where the switch has them, and a release sound when the key comes up. A switch's
  // files are fetched and decoded the first time it is used; the artifact copy carries them in
  // window.TZ_SOUNDS (tools/bundle.py).
  const SWITCHES = { red: true, black: true, yellow: true, brown: true, blue: false }; // true: has Space/Enter/Backspace files
  const SPECIAL = { " ": "SPACE", enter: "ENTER", backspace: "BACKSPACE" };
  const rowOf = { escape: 0 };
  ROWS.forEach((row, r) => row.forEach((spec) => { rowOf[Array.isArray(spec) ? spec[1] : spec] = r; }));
  const loaded = {}; // switch -> Promise, with .bufs { "press/GENERIC_R1": AudioBuffer, ... }
  const sounding = new Set(); // keys whose press played, so their release plays when they come up
  const currentSwitch = () => (profile.keySound === "off" ? null : SWITCHES[profile.keySound] !== undefined ? profile.keySound : "red");
  function loadSwitch(sw) {
    if (!sw) return Promise.resolve();
    if (loaded[sw]) return loaded[sw];
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch { return Promise.resolve(); }
    const names = ["release/GENERIC"];
    for (let r = 0; r < 5; r++) names.push(`press/GENERIC_R${r}`);
    if (SWITCHES[sw]) for (const n of Object.values(SPECIAL)) names.push(`press/${n}`, `release/${n}`);
    const bufs = {};
    loaded[sw] = Promise.all(names.map((n) => {
      const path = `sounds/${sw}/${n}.mp3`;
      return fetch((window.TZ_SOUNDS && window.TZ_SOUNDS[path]) || path)
        .then((r) => r.arrayBuffer())
        .then((a) => new Promise((ok, no) => audio.decodeAudioData(a, ok, no)))
        .then((b) => { bufs[n] = b; })
        .catch(() => { /* a missing file stays silent */ });
    }));
    loaded[sw].bufs = bufs;
    return loaded[sw];
  }
  // Plays the press (or release) recording for an on-screen key id ("a", " ", "shift-l", "escape"…).
  function keySound(id, phase = "press") {
    const sw = currentSwitch();
    if (muted() || !sw) return;
    loadSwitch(sw);
    const bufs = loaded[sw] && loaded[sw].bufs;
    const name = SPECIAL[id] && SWITCHES[sw] ? `${phase}/${SPECIAL[id]}`
      : phase === "press" ? `press/GENERIC_R${rowOf[id] ?? 1}` : "release/GENERIC";
    const buf = bufs && bufs[name];
    if (!buf) return; // still loading
    try {
      if (audio.state === "suspended") audio.resume();
      const src = audio.createBufferSource(), g = audio.createGain();
      src.buffer = buf;
      g.gain.value = 0.8;
      src.connect(g).connect(audio.destination);
      src.start();
    } catch { /* no audio */ }
  }
  const pressSound = (id) => { keySound(id); sounding.add(id); };
  const releaseSound = (id) => { if (sounding.delete(id)) keySound(id, "release"); };
  // Keys that type nothing still make their sound during a game, like a real keyboard.
  const SOUND_ID = { CapsLock: "caps", Escape: "escape", Backspace: "backspace", Tab: "tab", Enter: "enter" };
  function soundId(e) {
    if (e.key === "Shift") return e.code === "ShiftRight" ? "shift-r" : "shift-l";
    if (e.key === "Control") return e.code === "ControlRight" ? "ctrl-r" : "ctrl-l";
    if (e.key === "Alt") return e.code === "AltRight" ? "alt-r" : "alt-l";
    return SOUND_ID[e.key];
  }
  document.addEventListener("keydown", (e) => {
    if (e.repeat || !game || $("#play").hidden) return;
    const id = soundId(e);
    if (id) pressSound(id);
  });
  document.addEventListener("keyup", (e) => {
    if (!game || $("#play").hidden) return sounding.clear(); // left the round with a key still down: no stray release
    const id = soundId(e) || (e.key && e.key.length === 1 ? baseKey(e.key).key : null);
    if (id) releaseSound(id);
  });
  const sfx = {
    miss: () => tone(150, 0.15, "triangle", 0.06),
    chime: () => { tone(784, 0.25); setTimeout(() => tone(1047, 0.35), 110); },
  };

  // Speaks each text in turn with a one-second pause between them.
  // Any new call (or leaving the game) stops a sequence that is still playing.
  // The voice for words and sentences: three choices (user's request, 2026-10-27: Daniel, Samantha and Karen,
  // Karen by default; no Automatic, Female or Male). Those are Apple voices, so on other devices each choice
  // uses the nearest voice there, shown under its real name: a British man, an American woman, an Australian
  // woman. Names are matched from the start ("Microsoft Zira - English (United States)"); the first match wins.
  const VOICES = [
    { id: "gb-male", accent: "British", kind: "male", lang: "en-GB",
      names: ["daniel", "google uk english male", "microsoft ryan", "microsoft george", "microsoft thomas", "arthur", "oliver"] },
    { id: "us-female", accent: "American", kind: "female", lang: "en-US",
      names: ["samantha", "google us english", "microsoft jenny", "microsoft aria", "microsoft zira", "ava", "allison", "susan"] },
    { id: "au-female", accent: "Australian", kind: "female", lang: "en-AU",
      names: ["karen", "microsoft natasha", "microsoft catherine", "catherine"] },
  ];
  // Earlier test builds saved "daniel", "samantha" or "karen".
  const OLD_VOICE = { daniel: "gb-male", samantha: "us-female", karen: "au-female" };
  // When a device has none of a choice's voices, the list is topped up with its other English voices: British
  // women first (the default Google voice on Windows), then any. Their kind is guessed from the name.
  const FEMALE = /female|samantha|karen|catherine|natasha|zira|jenny|aria|hazel|susan|sonia|libby|serena|kate|moira|tessa|ava\b|allison|google us english/i;
  const MALE = /\bmale\b|daniel|ryan|george|thomas|david|mark\b|guy\b|william|arthur|oliver|rishi|\blee\b|james/i;
  const ACCENTS = { "en-GB": "British", "en-US": "American", "en-AU": "Australian", "en-IE": "Irish", "en-IN": "Indian",
    "en-ZA": "South African", "en-NZ": "New Zealand", "en-CA": "Canadian" };
  const langOf = (v) => v.lang.replace("_", "-");
  const englishVoices = () => ("speechSynthesis" in window ? speechSynthesis.getVoices() : []).filter((v) => /^en([-_]|$)/i.test(v.lang));
  const startsWith = (v, n) => new RegExp("^" + n + "\\b", "i").test(v.name);
  // The three entries this device offers: [{ id, voice, label }], at most three, no voice twice.
  function voiceChoices(vs = englishVoices()) {
    const used = new Set(), out = [];
    for (const x of VOICES) {
      let v = null;
      for (const n of x.names) {
        const named = vs.filter((w) => !used.has(w) && startsWith(w, n));
        v = named.find((w) => w.name.toLowerCase() === n) || named[0]; // "Daniel" before "Daniel (Enhanced)"
        if (v) break;
      }
      // Android names its voices by language only ("English Australia"), so take that accent's voice.
      v = v || vs.find((w) => !used.has(w) && langOf(w) === x.lang && !(x.kind === "female" ? MALE : FEMALE).test(w.name));
      if (v) { used.add(v); out.push({ id: x.id, voice: v, accent: x.accent, kind: (x.kind === "female" ? FEMALE : MALE).test(v.name) ? x.kind : "" }); }
    }
    const rest = vs.filter((w) => !used.has(w))
      .sort((a, b) => (langOf(b) === "en-GB" && FEMALE.test(b.name)) - (langOf(a) === "en-GB" && FEMALE.test(a.name)));
    for (const v of rest) {
      if (out.length >= 3) break;
      used.add(v);
      out.push(extraVoice(v));
    }
    return out;
  }
  const extraVoice = (v) => ({ id: v.voiceURI, voice: v, accent: ACCENTS[langOf(v)] || v.lang,
    kind: FEMALE.test(v.name) ? "female" : MALE.test(v.name) ? "male" : "" });
  // The saved choice if this device can meet it, even when a changed voice list (Edge's online voices arriving,
  // a voice pack added) has pushed it out of the three (Hermes R19.1); else the Australian woman (the default),
  // else a British woman (Chrome on Windows, Hermes R19.2), else the first woman listed, else the first entry.
  function chosenVoice(cs = voiceChoices()) {
    const want = OLD_VOICE[profile.voice] || profile.voice;
    // A voice saved by its voiceURI (earlier builds) that is already one of the three is that entry, not a 4th.
    const kept = !cs.some((c) => c.id === want || c.voice.voiceURI === want) && englishVoices().find((v) => v.voiceURI === want);
    return cs.find((c) => c.id === want || c.voice.voiceURI === want) || (kept ? extraVoice(kept) : null) || cs.find((c) => c.id === "au-female") ||
      cs.find((c) => c.kind === "female" && langOf(c.voice) === "en-GB") || cs.find((c) => c.kind === "female") || cs[0] || null;
  }
  function pickVoice() {
    const c = chosenVoice();
    return c ? c.voice : null;
  }
  // Sound is always on in Spelling Bee (it is spoken, and its mute button is hidden) and while Settings is open
  // (to try voices and key sounds). profile.mute itself is left as it was, so it applies again everywhere else
  // (user's request, 2026-10-28).
  const muted = () => profile.mute && !(game && game.mode === "spell" && !$("#play").hidden) && $("#sheet").hidden;
  let speechRun = 0;
  let speakTimer = 0; // the short wait before a new item is spoken; cleared by stopSpeech()
  function speak(...texts) {
    const run = ++speechRun;
    if (muted() || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const say = (i) => {
      if (run !== speechRun || i >= texts.length) return;
      const u = new SpeechSynthesisUtterance(texts[i]);
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : "en-GB";
      u.rate = 0.85;
      u.onend = () => setTimeout(() => say(i + 1), 1000);
      speechSynthesis.speak(u);
    };
    say(0);
  }
  const stopSpeech = () => { clearTimeout(speakTimer); speechRun++; if ("speechSynthesis" in window) speechSynthesis.cancel(); };

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
  // A user's school year unlocks three levels: the year below, their year and the year above,
  // kept inside Year 1 to Year 6 (Year 1: 1-3, Year 3: 2-4, Year 6: 4-6).
  const unlocked = (year) => {
    const from = Math.min(Math.max(+year.slice(1) - 1, 1), 4);
    return [from, from + 1, from + 2].map((n) => "Y" + n);
  };
  const currentBucket = () =>
    BUCKETS.find((b) => b.name === profile.bucket && unlocked(profile.year).includes(b.name)) ||
    BUCKETS.find((b) => b.name === profile.year);
  const yearLabel = (y) => BUCKETS.find((b) => b.name === y)?.label || "";
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
  let seenTick = 0; // set for each user in useProfile()
  // rank (optional) goes first: a lower rank is picked sooner, whatever was seen when.
  function freshPick(list, n, key, rank = () => 0) {
    const picked = shuffle(list).sort((a, b) => rank(a) - rank(b) || (profile.seen[key(a)] || 0) - (profile.seen[key(b)] || 0)).slice(0, n);
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
        // Each batch (a "round" of 10): up to 3 words come back for another go, then Word Garden words, then
        // fresh ones. Words already in this session are left out, except the retries.
        const playing = game && game.mode === "spell";
        const round = playing ? game.batch + 1 : 0;
        const missedIn = playing ? game.missedIn : {};
        const used = new Set(playing ? game.items.map((it) => it.word) : []);
        // Twice right first try in a row today: not picked again today, unless the level runs out of other
        // words, and then only as many as the round needs (user's request, 2026-10-28).
        const clean = beeToday().clean;
        const doneToday = (w) => (clean[w.word] || 0) >= 2;
        let left = pool.filter((w) => !used.has(w.word) && !doneToday(w));
        const spare = pool.filter((w) => !used.has(w.word) && doneToday(w));
        // Missed today (in this session or an earlier one): back in a later round, but not the very next one
        // after the miss (user's request, 2026-10-28).
        const missedToday = new Set([...(missedByDay(profile)[new Date().toDateString()] || []), ...Object.keys(missedIn)]);
        const retry = pickN(pool.filter((w) => missedToday.has(w.word) && !doneToday(w) && missedIn[w.word] !== round - 1), 3);
        left = left.filter((w) => !retry.includes(w));
        const tricky = [...retry, ...pickN(left.filter((w) => profile.tricky[w.word]), 3 - retry.length)];
        // Words learned in Word Garden in the last 7 days come next, before fresh ones (user's request,
        // 2026-10-28). A word leaves profile.learned once it has been spelled here.
        const week = Date.now() - 7 * 864e5;
        const learned = shuffle(left.filter((w) => !tricky.includes(w) && Date.parse(profile.learned[w.word]) >= week))
          .slice(0, n - tricky.length);
        // A word right first try in several Spelling Bees in a row waits longer (user's request, 2026-10-28):
        // words are taken by their run of right-first-try spellings, shortest first, then the usual rotation.
        const fresh = freshPick(left.filter((w) => !tricky.includes(w) && !learned.includes(w)), n - tricky.length - learned.length,
          byWord, (w) => profile.streak[w.word] || 0);
        const short = n - tricky.length - learned.length - fresh.length;
        const topUp = short > 0 ? freshPick(spare, short, byWord, (w) => profile.streak[w.word] || 0) : [];
        return shuffle([...tricky, ...learned, ...fresh, ...topUp]).map((w) => ({ ...w, target: w.word, hidden: true }));
      }
      case "tricky": {
        const tricky = allWords().filter((w) => profile.tricky[w.word]);
        return shuffle(tricky).slice(0, n).map((w) => ({ ...w, target: w.word, hidden: true }));
      }
      case "sentences":
        return freshPick(pool, n, (w) => "s:" + w.word).map((w) => ({ ...w, target: w.sentence }));
      case "fixit":
        return freshPick(FIXITS, n, (f) => "f:" + f.right).map((f) => ({ ...f, target: f.right, hidden: true, open: true }));
      case "practise": {
        // Shown, not hidden: he copies each word, as many goes as it takes to get 5 clean ones.
        // Progress is kept (user's request, 2026-10-28): each word starts from its saved clean goes, and words
        // already done are left out. When every word is done, the whole day runs again from 0.
        const known = new Map(allWords().map((w) => [w.word, w]));
        const words = missedByDay(profile)[practiceDay] || [];
        const saved = practisedOn(profile, practiceDay);
        const left = words.filter((w) => (saved[w] || 0) < PRACTISE_REPS);
        const list = (left.length ? left : words).map((word) =>
          ({ word, meaning: "", sentence: "", why: "", ...known.get(word), target: word, reps: left.length ? saved[word] || 0 : 0 }));
        return profile.practiseOrder === "random" ? shuffle(list) : list; // Settings > Practice order

      }
    }
  }

  // ---------- Game state ----------
  let game = null;

  // length: "short" or "long" for Spelling Bee (its card's data-length); kept for Play again.
  function start(mode, length) {
    game = null; // a new session must not see the last one's words as used
    loadSwitch(currentSwitch()); // fetch the key sounds now (a click), so the first key isn't silent
    const items = buildItems(mode);
    if (!items.length) return;
    game = { mode, length, items, batch: 0, missedIn: {}, idx: 0, correct: 0, errors: 0, ms: 0, missed: new Set(), firstTry: [], struggled: [], over: false };
    game.minutes = mode === "spell" ? LENGTHS[length] || LENGTHS.long : 0;
    if (game.minutes) game.endsAt = Date.now() + game.minutes * 60000;
    $("#modeTitle").textContent = TITLES[mode];
    $("#trail").innerHTML = game.endsAt ? '<i class="time"><b></b></i>' : items.map(() => "<i></i>").join("");
    $("#clock").hidden = !game.endsAt;
    $("#muteBtn").hidden = mode === "spell";
    show("play");
    // Phones and tablets type on their own keyboard by default (user's request, like TypingClub). This runs
    // inside the tap that started the game, which iOS needs before it will show the keyboard.
    $("#kbdToggle").hidden = !TOUCH;
    deviceKeyboard(TOUCH);
    tickClock();
    loadItem();
  }

  // Shows the time left, and ends a timed game at 0:00, or up to GRACE later if a word is being typed.
  function tickClock() {
    if (!game || !game.endsAt || game.over) return;
    const now = game.pausedAt || Date.now(); // frozen while paused
    const left = Math.max(0, game.endsAt - now);
    const secs = Math.ceil(left / 1000);
    const clock = $("#clock");
    clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    clock.classList.toggle("low", secs <= 60);
    clock.classList.toggle("paused", !!game.pausedAt);
    // The bar fills from the left as time passes, and flashes red near the end.
    const total = game.minutes * 60000;
    const bar = $("#trail .time b");
    if (bar) {
      bar.style.width = ((total - left) / total) * 100 + "%";
      bar.classList.toggle("ending", left <= total * ENDING);
    }
    clock.classList.toggle("grace", !left && !!game.grace);
    // Paused inside the grace: keep showing the frozen "Finish: n" rather than 0:00.
    if (game.pausedAt && game.grace) clock.textContent = `Finish: ${Math.ceil((game.endsAt + GRACE - now) / 1000)}`;
    if (left > 0 || game.pausedAt || $("#play").hidden) return;
    // Time is up. A word he has started gets up to GRACE more to finish; one finished in that time is
    // counted, and next() then ends the game. If it isn't finished by then, it isn't counted.
    const inWord = game.itemStart !== null && !game.wait;
    const graceLeft = game.endsAt + GRACE - now;
    if (inWord && graceLeft > 0) {
      if (!game.grace) {
        game.grace = true;
        $("#msg").className = "msg";
        $("#msg").textContent = "Time's up! Finish this word.";
      }
      clock.textContent = `Finish: ${Math.ceil(graceLeft / 1000)}`;
      clock.classList.add("grace");
      return;
    }
    if (game.wait && game.grace) return; // the grace word was just finished: next() ends it after the praise
    finish();
  }

  // The clock pauses while "Leave this round?" is on screen (user's request, 2026-10-26). Resuming moves
  // the end time (and the current word's start, for wpm) on by the paused time, so it isn't counted anywhere.
  function pauseClock() {
    if (game.endsAt && !game.pausedAt) { game.pausedAt = Date.now(); tickClock(); }
  }
  function resumeClock() {
    if (!game.pausedAt) return;
    const paused = Date.now() - game.pausedAt;
    game.endsAt += paused;
    if (game.itemStart !== null) game.itemStart += paused;
    game.pausedAt = null;
    tickClock();
  }

  function loadItem() {
    const it = game.items[game.idx];
    resumeClock(); // a safety net: next() no longer loads a word while "Leave this round?" is up
    Object.assign(game, { typed: "", posErr: 0, revealed: false, itemErr: 0, errAt: new Set(), hinted: false, itemStart: null, wait: false, leaving: null });
    $("#msg").className = "msg";
    $("#msg").innerHTML = "";
    $("#line").className = "line" + (it.target.length > 24 ? " small" : "");
    if (!game.endsAt) [...$("#trail").children].forEach((el, i) => { el.className = i < game.idx ? "done" : i === game.idx ? "now" : ""; });
    renderCard(it);
    renderLine();
    // Kept in speakTimer, so leaving or the end of a timed game stops a word that hasn't been spoken yet.
    clearTimeout(speakTimer);
    if (it.hidden && !it.open) speakTimer = setTimeout(() => speak(it.word, it.sentence), 250);
    else if (game.mode === "words" || (game.mode === "practise" && !it.spoken)) {
      it.spoken = true; // Practice says the word on its first go only
      speakTimer = setTimeout(() => speak(it.word), 250);
    }
    else if (game.mode === "sentences") speakTimer = setTimeout(() => speak(it.sentence), 250);
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
    } else if (m === "practise") {
      card.innerHTML = `<div class="tagline">Type it ${PRACTISE_REPS} times with no mistakes</div>
        <div class="reps" role="img" aria-label="${it.reps} of ${PRACTISE_REPS} done">${repsDots(it)}</div>
        ${it.meaning ? `<div class="meaning"><b>${escapeHtml(it.word)}</b> means ${escapeHtml(it.meaning)}</div>` : ""}
        <div class="tools"><button class="ghost" data-say="word">🔊 Hear it</button></div>`;
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

  // Practice's five dots, filled for each clean go.
  const repsDots = (it) => Array.from({ length: PRACTISE_REPS }, (_, i) => `<i class="${i < it.reps ? "on" : ""}"></i>`).join("");
  function showReps(it) {
    const box = $("#card .reps");
    if (box) { box.innerHTML = repsDots(it); box.setAttribute("aria-label", `${it.reps} of ${PRACTISE_REPS} done`); }
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
    if (game.pausedAt) return; // the clock is paused: the live figures stay where they were (Hermes R4.1)
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
      pressSound(key);
      if (k) { k.classList.add("hit"); setTimeout(() => k.classList.remove("hit"), 90); }
      if (game.typed === it.target) return complete(it);
    } else {
      game.errors++;
      game.itemErr++;
      game.errAt.add(game.typed.length); // which letters had a wrong key
      game.posErr++;
      if (game.posErr >= 2) game.revealed = game.hinted = true; // the orange hint letter shows
      sfx.miss();
      const line = $("#line");
      line.classList.remove("shake"); void line.offsetWidth; line.classList.add("shake");
      if (k) { k.classList.add("miss"); setTimeout(() => k.classList.remove("miss"), 200); }
      if (it.hidden && game.revealed) $("#msg").textContent = "Here's a hint: type the orange letter.";
      // Practice: a real slip starts this word's 5 again, here and in the saved count (user's request,
      // 2026-10-28). One typo put right before the hint is forgiven, as in Spelling Bee.
      if (game.mode === "practise" && (game.errAt.size > 1 || game.hinted)) { it.reps = 0; showReps(it); savePractice(practiceDay, it.word, 0, true); }
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

    // Timed games count each word: right first try (no wrong key at all), or needed another try.
    // One typo, put right before the orange hint showed, still counts as right first try (user's request,
    // 2026-10-28), in Practice too; wrong keys on two letters, or a hint, don't.
    const missed = game.itemErr > 0 && (game.errAt.size > 1 || game.hinted);
    if (game.endsAt) (missed ? game.struggled : game.firstTry).push(it.word);
    // Word Garden is the learning mode: the words typed there wait for Spelling Bee (7 days at most).
    if (game.mode === "words") {
      profile.learned[it.word] = new Date().toISOString();
      const week = Date.now() - 7 * 864e5;
      for (const w of Object.keys(profile.learned)) if (!(Date.parse(profile.learned[w]) >= week)) delete profile.learned[w];
    }
    if (game.mode === "spell") {
      delete profile.learned[it.word]; // spelled from memory: no longer waiting
      // The run of right-first-try spellings: one more, or back to 0 after a miss.
      if (missed) delete profile.streak[it.word];
      else profile.streak[it.word] = (profile.streak[it.word] || 0) + 1;
      const today = new Date().toDateString(), day = beeToday();
      if (missed) {
        game.missedIn[it.word] = game.batch; // its round, so it skips the next one
        delete day.clean[it.word]; // a miss in between: the two right-first-try spellings start again
      }
      else {
        // Spelled right after being missed today: that counts as one of its 5 Practice goes (user's request).
        const missedEarlier = (missedByDay(profile)[today] || []).includes(it.word) || game.struggled.includes(it.word);
        if (missedEarlier) savePractice(today, it.word, (practisedOn(profile, today)[it.word] || 0) + 1);
        day.clean[it.word] = (day.clean[it.word] || 0) + 1;
      }
    }

    // Practice counts the clean goes; copying a word doesn't change the tricky words.
    if (game.mode === "practise" && !missed) {
      it.reps++;
      showReps(it); // fill the dot now, with the message, not on the next go (so the fifth one shows too; Hermes R20.2)
      savePractice(practiceDay, it.word, it.reps); // every clean go is kept, not just the fifth
    }
    if (it.word && game.mode !== "sentences" && game.mode !== "practise") {
      if (missed) {
        profile.tricky[it.word] = (profile.tricky[it.word] || 0) + 1;
        game.missed.add(it.word);
        // Missed again after practising it today: it needs practice again, so its green tick comes off
        // (Hermes R23.1). A tick on an earlier day's list stays.
        const today = new Date().toDateString(), done = practisedOn(profile, today);
        if (done[it.word]) { delete done[it.word]; profile.practised[today] = done; }
      } else if (profile.tricky[it.word] && (game.mode === "spell" || game.mode === "tricky")) {
        // Spelling it cleanly from memory earns the word its way off the list.
        if (--profile.tricky[it.word] <= 0) delete profile.tricky[it.word];
      }
      save();
    }

    const msg = $("#msg");
    const praise = !missed ? PRAISE[Math.floor(Math.random() * PRAISE.length)] : "Done. Keep going!";
    if (game.mode === "fixit") {
      msg.className = "msg good";
      msg.innerHTML = `✓ Fixed it! <span class="rule">${escapeHtml(it.rule)}</span><span class="rule">Press <kbd>Enter</kbd> for the next one.</span>`;
      game.wait = "enter";
    } else if (game.mode === "practise") {
      msg.className = "msg good";
      msg.textContent = missed ? "A slip starts the count again. Type it again."
        : it.reps < PRACTISE_REPS ? `✓ ${it.reps} of ${PRACTISE_REPS}. ${praise}` : `✓ ${it.word}: all ${PRACTISE_REPS} done! ${praise}`;
      setTimeout(next, missed ? 1200 : 700);
    } else {
      msg.className = "msg good";
      msg.innerHTML = escapeHtml((it.hidden ? `✓ ${it.word}. ` : "✓ ") + praise) +
        (it.hidden && it.why ? `<span class="rule">Tricky bit: ${escapeHtml(it.why)}</span>` : "");
      setTimeout(next, it.hidden ? 1300 : 700);
    }
  }

  function next() {
    if (!game || game.over) return;
    // "Leave this round?" is up (asked just after a word): the next word waits for his answer.
    if (game.leaving) { game.nextWaiting = true; return; }
    if (game.endsAt && (game.pausedAt || Date.now()) >= game.endsAt) return finish(); // time is up: no next word
    if (game.mode === "practise" && game.items[game.idx].reps < PRACTISE_REPS) return loadItem(); // the same word again
    game.idx++;
    // A timed game never runs out of words: add another batch (if the level has any left).
    if (game.endsAt && game.idx >= game.items.length) { game.items.push(...buildItems(game.mode)); game.batch++; }
    if (game.idx >= game.items.length) finish();
    else loadItem();
  }

  // Keeps a record of each timed session in the saved progress, newest last (at most 500).
  function saveSession(finished) {
    if (!game || !game.endsAt || game.saved) return;
    game.saved = true;
    const now = game.pausedAt || Date.now(); // leaving from the paused question: the pause isn't counted
    const minutes = Math.round((Math.min(now, game.endsAt) - (game.endsAt - game.minutes * 60000)) / 60000);
    if (!finished && !game.firstTry.length && !game.struggled.length) return; // left before doing anything
    profile.sessions.push({
      date: new Date().toISOString(), game: game.mode, level: currentBucket().name, minutes, length: game.minutes, finished,
      firstTry: game.firstTry.length, struggled: game.struggled.length,
      firstTryWords: game.firstTry, struggledWords: game.struggled,
    });
    profile.sessions = profile.sessions.slice(-500);
    save();
  }

  function finish() {
    if (game.over) return;
    game.over = true;
    stopSpeech();
    // A word left half typed when time runs out isn't counted at all: its keys come out of accuracy and
    // speed, as it's in neither word list (every typed letter was a correct key, every miss raised itemErr).
    if (game.itemStart !== null) {
      game.correct -= game.typed.length;
      game.errors -= game.itemErr;
    }
    game.itemStart = null;
    saveSession(true);
    const done = game.endsAt ? game.firstTry.length + game.struggled.length : game.items.length;
    const acc = accuracy();
    const speed = wpm(game.correct, game.ms);
    // No words done (a timed game where time ran out first) earns no stars and no round.
    const stars = !done ? 0 : acc >= 95 ? 3 : acc >= 85 ? 2 : 1;
    // Best speed is for typing from memory: not Fix-It, Practice or Word Garden, where the text is on screen (Hermes R20.1).
    const newBest = speed > profile.bestWpm && !["fixit", "practise", "words"].includes(game.mode); // Word Garden too: the word is shown
    if (done) {
      profile.stars += stars;
      profile.rounds++;
    }
    if (newBest) profile.bestWpm = speed;
    save();

    $("#stars").innerHTML = [1, 2, 3].map((i) => `<span class="${i <= stars ? "" : "off"}">⭐</span>`).join("");
    const who = profile.name ? `, ${escapeHtml(profile.name)}` : "";
    $("#resTitle").innerHTML = !done ? `Time's up${who}! No words this time.`
      : (stars === 3 ? `Wonderful${who}!` : stars === 2 ? `Well done${who}!` : `Good effort${who}!`) + (newBest ? " New best speed!" : "");
    $("#resWpm").textContent = speed;
    $("#resAcc").textContent = done ? acc + "%" : "–"; // nothing typed: no accuracy to claim
    $("#resItems").textContent = game.items.length;
    $("#resFirst").textContent = game.firstTry.length;
    $("#resStruggled").textContent = game.struggled.length;
    for (const id of ["#figFirst", "#figStruggled"]) $(id).hidden = !game.endsAt;
    $("#figItems").hidden = !!game.endsAt;
    $("#resTricky").innerHTML = game.missed.size
      ? `<div class="label">Words to practise again</div><div class="tricky-list">${[...game.missed].map((w) => `<span>${escapeHtml(w)}</span>`).join("")}</div>`
      : "";
    show("results");
  }

  // ---------- Screens ----------
  function show(id) {
    if (id !== "play") $("#typer").blur(); // the device keyboard goes away with the game
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
    if (id === "home") renderHome();
  }

  function renderHome() {
    if (game && !game.over) saveSession(false); // left a timed game early: keep what was done
    game = null;
    stopSpeech();
    $("#userName").textContent = profile.name;
    // Today, from midnight local time: words finished in this user's Spelling Bee sessions, and how many of
    // them were right first try (user's request, 2026-10-26).
    const t = dayTotals(profile)[new Date().toDateString()] || { words: 0, first: 0 };
    $("#todayStats").innerHTML = t.words ? `Today: ${wordsAndRate(t)}` : "Today: no words yet.";
    const open = unlocked(profile.year);
    for (const b of document.querySelectorAll(".level")) {
      b.disabled = !open.includes(b.dataset.bucket);
      b.setAttribute("aria-checked", String(b.dataset.bucket === currentBucket().name));
    }
    const parts = [];
    if (profile.rounds) parts.push(`⭐ ${profile.stars} stars`, `🏃 best ${profile.bestWpm} wpm`, `${profile.rounds} rounds played`);
    $("#homeStats").textContent = parts.join("   ·   ");
    const tricky = Object.keys(profile.tricky).length;
    $("#trickyBtn").hidden = tricky === 0;
    // Practice: today's words that weren't right first try. Other days are chosen in View stats.
    const todays = (missedByDay(profile)[new Date().toDateString()] || []).length;
    $("#practiseBtn").disabled = !todays;
    // Cards show state only, no instructions (UX-PRINCIPLES.md, Hermes UX.1 and UX.6).
    $("#practiseInfo").textContent = todays ? `${todays} word${todays === 1 ? "" : "s"} today, ${PRACTISE_REPS} times each` : "None today";
    $("#trickyInfo").textContent = `${tricky} word${tricky === 1 ? "" : "s"} you found hard`;
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

  // ---------- Device keyboard (touch screens) ----------
  // A hidden text box (#typer) has the focus, so the device's own keyboard is up and our on-screen one is
  // hidden. iOS sends real keydown events, which the game handler below takes (and stops them reaching the
  // box). Android sends "Unidentified" keys, so the letter arrives in the box instead: each one is passed on as
  // a keydown, like a tap on the on-screen keyboard. The button switches between the two keyboards.
  const TOUCH = window.matchMedia ? matchMedia("(pointer: coarse)").matches : false;
  const typer = $("#typer");
  function deviceKeyboard(on) {
    $("#play").classList.toggle("native", on);
    const b = $("#kbdToggle");
    b.setAttribute("aria-label", on ? "Use the on-screen keyboard" : "Use the device keyboard");
    b.title = b.getAttribute("aria-label");
    if (on) typer.focus({ preventScroll: true });
    else typer.blur();
  }
  typer.addEventListener("input", () => {
    const text = typer.value;
    typer.value = "";
    for (const key of text) {
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      ev.fromScreen = true;
      document.dispatchEvent(ev);
    }
  });
  // Closing the device keyboard (its own button, or a tap elsewhere) brings the on-screen one back.
  typer.addEventListener("blur", () => { if (!$("#play").hidden) deviceKeyboard(false); });
  // The button must not take the focus itself, or the keyboard would close before the tap is read.
  $("#kbdToggle").addEventListener("pointerdown", (e) => e.preventDefault());
  // Nor may "Hear the word" or the speaker button while the device keyboard is up.
  $("#play").addEventListener("pointerdown", (e) => {
    if ($("#play").classList.contains("native") && e.target.closest("#card button, #muteBtn")) e.preventDefault();
  });
  // Tapping the word (like tapping a text box) brings the device keyboard up.
  $("#play .stage").addEventListener("click", (e) => { if (TOUCH && !e.target.closest("button")) deviceKeyboard(true); });
  $("#kbdToggle").addEventListener("click", () => deviceKeyboard(!$("#play").classList.contains("native")));

  // ---------- Events ----------
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "newName") return; // typing a name on the welcome screen
    const playing = !$("#play").hidden;
    if (!$("#results").hidden && e.key === "Enter") { e.preventDefault(); return start(game.mode, game.length); }
    if (!$("#results").hidden && e.key === "Escape") return show("home");
    if (!playing || !game) return;
    if (e.key === "Escape") return leave();
    if (game.leaving) {
      // Any other key means "stay": put the message back, and type the key as normal.
      $("#msg").className = game.leaving.cls;
      $("#msg").innerHTML = game.leaving.html;
      game.leaving = null;
      resumeClock();
      // He carried on after a question asked between words: now load the word that was waiting.
      // The key itself is used up, as the last word is already done.
      if (game.nextWaiting) { game.nextWaiting = false; e.preventDefault(); return next(); }
      if (e.key === "Enter" && game.wait !== "enter") { e.preventDefault(); return; }
    }
    if (game.wait === "enter") { if (e.key === "Enter") { e.preventDefault(); next(); } return; }
    if (game.wait || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;
    e.preventDefault(); // stops space scrolling and quick-find on ' and /
    const f = document.activeElement;
    if (f && f !== document.body && f !== typer) f.blur(); // the typing box keeps the focus: it holds the device keyboard up
    press(e.key);
  });

  // Esc asks first, so a stray press doesn't throw away the round. A second Esc leaves.
  function leave() {
    if (game.leaving || (game.idx === 0 && !game.typed)) return show("home");
    const msg = $("#msg");
    game.leaving = { cls: msg.className, html: msg.innerHTML };
    msg.className = "msg";
    msg.innerHTML = `Leave this round? Press <kbd>Esc</kbd> again to go home, or keep typing to stay.` +
      (game.endsAt ? ` <span class="rule">The clock is paused.</span>` : "");
    pauseClock();
  }


  $("#levels").innerHTML = BUCKETS.map((b) =>
    `<button class="level" data-bucket="${b.name}" role="radio"><b>${b.label}</b><span>${b.words.length} words, like ${b.sample}</span></button>`).join("");
  $("#levels").addEventListener("click", (e) => {
    const b = e.target.closest(".level");
    if (b && !b.disabled) { profile.bucket = b.dataset.bucket; save(); renderHome(); }
  });
  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => {
    b.blur();
    if (b.dataset.mode === "spell") return openLength();
    if (b.dataset.mode === "practise") practiceDay = new Date().toDateString();
    start(b.dataset.mode);
  }));
  // Spelling Bee asks how long first. The labels come from LENGTHS, so the test build's short sessions show.
  const lenSheet = $("#lenSheet");
  for (const b of $("#lenChoices").children) {
    const m = LENGTHS[b.dataset.length];
    b.textContent = `${m} minute${m === 1 ? "" : "s"}`;
  }
  function openLength() {
    lenSheet.hidden = false;
    document.addEventListener("keydown", onLengthKey);
    $("#lenChoices button").focus();
  }
  function closeLength() {
    lenSheet.hidden = true;
    document.removeEventListener("keydown", onLengthKey);
  }
  // Esc closes it, and Tab stays inside it (as in Settings).
  function onLengthKey(e) {
    if (e.key === "Escape") { e.preventDefault(); closeLength(); return $('.mode[data-mode="spell"]').focus(); }
    if (e.key !== "Tab") return;
    const items = [...lenSheet.querySelectorAll("button")];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === $("#lenCard"))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  $("#lenChoices").addEventListener("click", (e) => {
    const b = e.target.closest("[data-length]");
    if (b) { closeLength(); start("spell", b.dataset.length); }
  });
  $("#lenCancel").addEventListener("click", () => { closeLength(); $('.mode[data-mode="spell"]').focus(); });
  lenSheet.addEventListener("click", (e) => { if (e.target === lenSheet) closeLength(); });
  // Add to home screen (user's request, 2026-10-28): the steps for this browser only. Hidden when Typing Zen
  // already runs from the home screen, or inside another page (the claude.ai copy), where it can't be added.
  (() => {
    const ua = navigator.userAgent, standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const edge = /Edg\//.test(ua), firefox = /Firefox\//.test(ua), chrome = /Chrome\//.test(ua) && !edge;
    const hint = ios ? "Tap the Share button, then Add to Home Screen."
      : /Android/.test(ua) ? "Tap ⋮ at the top right, then Add to home screen."
      : edge ? "Click ⋯ at the top right, then Apps, then Install this site as an app."
      : chrome ? "Click ⋮ at the top right, then Cast, save and share, then Create shortcut."
      : firefox ? "Drag the padlock in the address bar onto your desktop."
      : /Safari\//.test(ua) ? "Choose File, then Add to Dock." : "";
    $("#installHint").textContent = hint;
    $("#installRow").hidden = !hint || standalone || window.top !== window;
  })();
  // Switch user and Clear history live in Settings (user's request, 2026-10-28), so home stays clean.
  $("#switchUserBtn").addEventListener("click", () => { closeSheet(); showPanel("switch"); });
  // Clear history asks twice (user's request): what will go, then "are you sure".
  function showClear(step) {
    $("#clearConfirm").hidden = !step;
    $("#clearBtn").hidden = !!step || (!profile.rounds && !Object.keys(profile.tricky).length && !profile.sessions.length);
    if (!step) return;
    $("#clearAsk").textContent = step === 1 ? `Clear all stars, best speed, tricky words and history for ${profile.name}?`
      : "Are you sure? This can't be undone.";
    $("#clearYes").textContent = step === 1 ? "Yes, clear" : "Yes, clear everything";
    $("#clearYes").dataset.step = step;
    $("#clearYes").focus();
  }
  $("#clearBtn").addEventListener("click", () => showClear(1));
  $("#clearNo").addEventListener("click", () => { showClear(0); $("#clearBtn").hidden || $("#clearBtn").focus(); });
  $("#clearYes").addEventListener("click", () => {
    if ($("#clearYes").dataset.step === "1") return showClear(2);
    // Keeps the name, level, mute, key sound and voice; wipes scores, tricky words and the session history.
    Object.assign(profile, { bestWpm: 0, stars: 0, rounds: 0, tricky: {}, seen: {}, sessions: [], practised: {}, learned: {}, streak: {}, beeToday: null });
    save();
    showClear(0);
    renderHome();
    $("#switchUserBtn").focus();
  });
  // ---------- Settings ----------
  // Appearance is Light, Dark or Automatic. THEME (set up in index.html's <head>) saves it to
  // typingZen.theme, apart from the progress in typingZen.v2. Your year is the current user's school
  // year: it sets which three levels are open.
  const sheet = $("#sheet");
  function syncSheet() {
    fillVoices();
    for (const b of $("#segApp").children) b.setAttribute("aria-checked", String(b.dataset.themeMode === THEME.mode));
    for (const b of $("#segYear").children) b.setAttribute("aria-checked", String(b.dataset.year === profile.year));
    for (const b of $("#segSound").children) b.setAttribute("aria-checked", String(b.dataset.sound === (currentSwitch() || "off")));
    showClear(0);
    for (const b of $("#segOrder").children) b.setAttribute("aria-checked", String(b.dataset.order === (profile.practiseOrder === "random" ? "random" : "order")));
  }
  function openSheet() {
    syncSheet();
    $("#verMsg").textContent = "Check for updates";
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
  // "Check for updates" (like Violin Toolkit): compares this page with the site's version.json, never cached.
  // The test build also stamps a build time on both, so a new test deploy counts as an update. If they differ
  // it opens the new version with ?v= in the address: index.html stamps its own files with the version, so the
  // browser fetches fresh copies instead of reusing old ones.
  $("#verBtn").addEventListener("click", async () => {
    const msg = $("#verMsg"), mine = $("#appVersion");
    msg.textContent = "Checking…";
    try {
      const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const live = await r.json();
      const same = mine.dataset.build ? live.build === mine.dataset.build : live.version === mine.textContent;
      if (same) { msg.textContent = "Up to date"; return; }
      msg.textContent = `Updating to ${live.version}…`;
      location.replace(location.pathname + "?v=" + encodeURIComponent(live.build || live.version));
    } catch {
      msg.textContent = navigator.onLine === false ? "Can't check while offline" : "Can't check here";
    }
  });
  $("#sheetDone").addEventListener("click", closeSheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
  // Practice order (user's request, 2026-10-28): the day's words in the order they were missed, or shuffled.
  $("#segOrder").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { profile.practiseOrder = b.dataset.order; save(); syncSheet(); }
  });
  $("#segApp").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { THEME.set(b.dataset.themeMode); syncSheet(); }
  });
  // Key sound choices are drawn as switches (user's request, 2026-10-27): a side view of the housing with the
  // stem in the switch's colour; a bump for tactile, sound lines for clicky, a line through for Off. The name
  // is the button's label for screen readers and its tooltip.
  const SWITCH_LOOK = [
    ["red", "Linear Red", "Light and smooth, with a soft bottom-out", "#d43a2f", ""],
    ["black", "Linear Black", "Heavier, with a deeper, fuller bottom-out", "#202326", ""],
    ["yellow", "Linear Yellow", "Medium weight and smooth, a little brighter", "#e6b929", ""],
    ["brown", "Tactile Brown", "A small bump, then a soft thud", "#7b4b2a", "bump"],
    ["blue", "Clicky Blue", "A sharp click, then the bottom-out", "#2f6bd8", "click"],
    ["off", "Off", "No sound for keys (speech still plays)", "#9aa1a8", "off"],
  ];
  const switchPicture = (colour, extra) => `<svg class="switch" viewBox="0 0 64 48" aria-hidden="true">
      <rect class="sw-stem" x="25" y="3" width="14" height="14" rx="2" fill="${colour}"/>
      ${extra === "bump" ? `<path class="sw-stem" d="M39 7 l4 3 l-4 3 z" fill="${colour}"/>` : ""}
      <path class="sw-top" d="M14 30 L18 15 H46 L50 30 Z"/>
      <rect class="sw-base" x="12" y="29" width="40" height="11" rx="2.5"/>
      <path class="sw-pin" d="M24 40 v5 M40 40 v5"/>
      ${extra === "click" ? `<path class="sw-lines" d="M50 6 q5 5 0 10 M55 3 q8 8 0 16"/>` : ""}
      ${extra === "off" ? `<path class="sw-off" d="M10 44 L54 4"/>` : ""}
    </svg>`;
  $("#segSound").innerHTML = SWITCH_LOOK.map(([id, name, how, colour, extra]) =>
    `<button type="button" role="radio" aria-checked="false" data-sound="${id}" aria-label="${name}" title="${name}: ${how}">${switchPicture(colour, extra)}</button>`).join("");
  // Voice: the three entries this device offers, each under its real name. Voices can arrive after the page
  // loads (voiceschanged).
  const SAMPLE = "This is how I will read your words.";
  function fillVoices() {
    const cs = voiceChoices();
    const c = chosenVoice(cs);
    if (c && !cs.includes(c) && !cs.some((x) => x.id === c.id || x.voice === c.voice)) cs.push(c); // a saved voice outside the three stays listed
    $("#voiceSel").innerHTML = cs.map((c) => {
      const about = [c.accent, c.kind].filter(Boolean).join(", ");
      // "Microsoft Ryan Online (Natural) - English (United Kingdom)" → "Ryan"
      const name = c.voice.name.replace(/\s+-\s+English.*$/, "").replace(/^Microsoft\s+/, "").replace(/\s+Online \(Natural\)$/, "");
      return `<option value="${escapeHtml(c.id)}">${escapeHtml(name)} (${escapeHtml(about)})</option>`;
    }).join("");
    if (c) $("#voiceSel").value = c.id;
    // Chrome lists no voices until its first voiceschanged, so the note waits until some voice is listed.
    $("#voiceNote").hidden = cs.length > 0 || !("speechSynthesis" in window && speechSynthesis.getVoices().length);
    $("#voiceRow").hidden = !("speechSynthesis" in window);
  }
  if ("speechSynthesis" in window && speechSynthesis.addEventListener) speechSynthesis.addEventListener("voiceschanged", fillVoices);
  $("#voiceSel").addEventListener("change", (e) => { profile.voice = e.target.value; save(); fillVoices(); speak(SAMPLE); });
  $("#voiceTry").addEventListener("click", () => speak(SAMPLE));
  // Key sound: choosing one plays a sample of it.
  $("#segSound").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    profile.keySound = b.dataset.sound;
    save();
    syncSheet();
    // A sample: a letter's press, then its release.
    loadSwitch(currentSwitch()).then(() => { keySound("j"); setTimeout(() => keySound("j", "release"), 110); });
  });
  $("#statsBtn").addEventListener("click", showWelcome); // View stats: back to the welcome screen's 7 days
  $("#segYear").innerHTML = BUCKETS.map((b) => `<button type="button" role="radio" aria-checked="false" data-year="${b.name}">${b.label}</button>`).join("");
  $("#segYear").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    profile.year = b.dataset.year;
    // Keep the chosen level if it's still open, otherwise practise the new year.
    if (!unlocked(profile.year).includes(profile.bucket)) profile.bucket = profile.year;
    save();
    syncSheet();
    renderHome();
  });

  $("#backBtn").addEventListener("click", () => show("home"));
  $("#homeBtn").addEventListener("click", () => show("home"));
  $("#againBtn").addEventListener("click", () => start(game.mode, game.length));
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
  setInterval(() => {
    if (game && !$("#play").hidden && game.itemStart) updateLive();
    tickClock();
  }, 1000);

  // ---------- Practice statistics ----------
  // Words and right-first-try counts per local day ("Mon Oct 26 2026"), from a user's saved sessions. A session
  // counts on the day it ended (its date). Damaged records are skipped rather than breaking the page.
  function dayTotals(u) {
    const days = {};
    for (const s of u.sessions || []) {
      const d = s && s.date ? new Date(s.date) : null;
      if (!d || isNaN(d)) continue;
      const k = d.toDateString();
      const t = days[k] || (days[k] = { words: 0, first: 0 });
      t.first += s.firstTry || 0;
      t.words += (s.firstTry || 0) + (s.struggled || 0);
    }
    return days;
  }
  // The words that weren't right first try, per local day of the last 7 (newest day first), each word once.
  function missedByDay(u) {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 6);
    const days = {};
    for (const s of u.sessions || []) {
      const d = s && s.date ? new Date(s.date) : null;
      if (!d || isNaN(d) || d < from || !Array.isArray(s.struggledWords)) continue;
      const list = days[d.toDateString()] || (days[d.toDateString()] = []);
      for (const w of s.struggledWords) if (typeof w === "string" && !list.includes(w)) list.push(w);
    }
    return Object.fromEntries(Object.entries(days).filter(([, l]) => l.length)
      .sort(([a], [b]) => new Date(b) - new Date(a)));
  }
  // Spelling Bee today: { day, clean: { word: times right first try today } }; starts again each new day.
  function beeToday() {
    const day = new Date().toDateString();
    if (!profile.beeToday || profile.beeToday.day !== day) profile.beeToday = { day, clean: {} };
    return profile.beeToday;
  }
  // Practice progress: profile.practised maps a day (as in missedByDay) to { word: clean goes so far }. A word
  // with all 5 stays in Words to practise, shown in green (user's request, 2026-10-27); fewer show as "2/5".
  // Days older than 7 are dropped. Builds from before 2026-10-28 saved a list of finished words instead.
  function practisedOn(u, day) {
    const v = (u.practised || {})[day];
    return Array.isArray(v) ? Object.fromEntries(v.map((w) => [w, PRACTISE_REPS])) : { ...v };
  }
  // exact: set the count as given (a slip sets it to 0); otherwise it only goes up.
  function savePractice(day, word, reps, exact = false) {
    const d = practisedOn(profile, day);
    d[word] = exact ? reps : Math.max(d[word] || 0, reps);
    if (!d[word]) delete d[word];
    profile.practised[day] = d;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 6);
    for (const k of Object.keys(profile.practised)) if (!(new Date(k) >= from)) delete profile.practised[k];
    save();
  }
  const wordsAndRate = (t) =>
    `<b>${t.words}</b> word${t.words === 1 ? "" : "s"} tested · <b>${Math.round((t.first / t.words) * 100)}%</b> right first try`;

  // Welcome back: the last 7 days (today and the 6 before) as a line and a daily bar chart (user's request):
  // each day shows its words tested in Spelling Bee above the bar and its right-first-try rate under the day name.
  function renderWeek(u) {
    const totals = dayTotals(u);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0); // midday, so a daylight-saving change can't skip or repeat a day
      d.setDate(d.getDate() - i);
      days.push({ d, ...(totals[d.toDateString()] || { words: 0, first: 0 }) });
    }
    const week = days.reduce((a, x) => ({ words: a.words + x.words, first: a.first + x.first }), { words: 0, first: 0 });
    $("#weekLine").innerHTML = week.words ? `Last 7 days: ${wordsAndRate(week)}` : "Last 7 days: no words yet.";
    const chart = $("#weekChart");
    chart.hidden = !week.words;
    $("#weekKey").hidden = !week.words;
    if (!week.words) return;
    const most = Math.max(...days.map((x) => x.words));
    chart.innerHTML = days.map((x, i) => {
      const name = i === 6 ? "Today" : x.d.toLocaleDateString("en-GB", { weekday: "short" });
      const full = x.d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      const rate = x.words ? Math.round((x.first / x.words) * 100) + "%" : "–";
      const again = x.words - x.first;
      const said = x.words ? `${x.words} word${x.words === 1 ? "" : "s"}: ${x.first} right first try, ${again} needed another try, ${rate} right first try` : "no words";
      // One bar per day in two colours (user's request, 2026-10-27): needed another try (orange) on top of
      // right first try (green). Empty parts are left out, so the top one always gets the rounded corners.
      const h = x.words ? Math.max(6, (x.words / most) * 100) : 0;
      const part = (cls, n) => (n ? `<i class="${cls}" style="height:${(h * n) / x.words}%"></i>` : "");
      return `<li aria-label="${full}: ${said}"><span class="n">${x.words || ""}</span>` +
        `<span class="bar">${part("again", again)}${part("first", x.first)}</span>` +
        `<span class="d">${name}</span><span class="r">${rate}</span></li>`;
    }).join("");
  }

  // ---------- Who's typing: welcome, new user, switch user ----------
  // First visit: two questions, name and year. Every later visit opens on "Welcome back" with
  // Continue, Switch user and I'm new here (like Violin Toolkit's start overlay).
  const users = () => Object.values(store.users).sort((a, b) => (b.lastUsed || "").localeCompare(a.lastUsed || ""));
  let newYear = null;

  function showWelcome() {
    const last = store.users[store.current];
    if (!last) return showPanel("new");
    $("#backName").textContent = last.name;
    renderWeek(last);
    $("#continueBtn").textContent = `Continue as ${last.name}`;
    const missed = Object.values(missedByDay(last)).reduce((n, l) => n + l.length, 0);
    $("#missedBtn").hidden = !missed;
    $("#missedBtn").textContent = `Words to practise (${missed})`;
    showPanel("back");
  }
  function showPanel(which) {
    show("welcome");
    for (const id of ["new", "back", "switch"]) $("#intro-" + id).hidden = id !== which;
    if (which === "new") {
      $("#newName").value = "";
      newYear = null;
      for (const b of $("#newYear").children) b.setAttribute("aria-checked", "false");
      setError("name", "");
      setError("year", "");
      $("#newBack").hidden = !users().length;
      $("#newName").focus();
    } else if (which === "switch") {
      $("#userList").innerHTML = users().map((u) =>
        `<button type="button" class="user" data-id="${u.id}"><b>${escapeHtml(u.name)}</b><span>${yearLabel(u.year)}</span></button>`).join("");
      $("#userList button")?.focus();
    } else {
      $("#continueBtn").focus();
    }
  }
  function useProfile(id) {
    store.current = id;
    profile = store.users[id];
    profile.lastUsed = new Date().toISOString();
    seenTick = Math.max(0, ...Object.values(profile.seen));
    save();
    show("home");
  }
  // Shows (or with "" clears) the message under a question, and marks the field for screen readers.
  function setError(field, text) {
    const el = $(`#${field}Err`);
    el.textContent = text;
    el.hidden = !text;
    (field === "name" ? $("#newName") : $("#newYear")).setAttribute("aria-invalid", String(!!text));
  }

  $("#newYear").innerHTML = BUCKETS.map((b) => `<button type="button" role="radio" aria-checked="false" data-year="${b.name}">${b.label}</button>`).join("");
  function chooseYear(b) {
    newYear = b.dataset.year;
    for (const x of $("#newYear").children) x.setAttribute("aria-checked", String(x === b));
    setError("year", "");
  }
  $("#newYear").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) chooseYear(b);
  });
  // Enter on a year: an unchosen year is chosen (as a click would), Enter on the chosen year submits the
  // form, as Enter in the name box does. Focus stays where it is. (Hermes R3.2, R3.3.)
  $("#newYear").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const b = e.target.closest("button");
    if (b && b.dataset.year !== newYear) return chooseYear(b);
    const form = $("#newForm");
    if (form.requestSubmit) form.requestSubmit();
    else form.querySelector('[type="submit"]').click(); // Safari before 16
  });
  $("#newName").addEventListener("input", () => setError("name", ""));
  $("#newForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = tidyName($("#newName").value);
    const taken = name && users().find((u) => u.name.toLowerCase() === name.toLowerCase());
    setError("name", !name ? "Please type your name. It's needed to keep your progress."
      : taken ? `${taken.name} already uses Typing Zen here. Go back and choose Switch user.` : "");
    setError("year", newYear ? "" : "Please choose your year.");
    if (!name || taken) return $("#newName").focus();
    if (!newYear) return $("#newYear button").focus();
    const id = newId();
    store.users[id] = { ...DEFAULTS(), name, year: newYear, bucket: newYear, id, created: new Date().toISOString() };
    useProfile(id);
  });
  $("#newBack").addEventListener("click", showWelcome);
  $("#continueBtn").addEventListener("click", () => useProfile(store.current));

  // Words to practise: an overlay over the stats, one group per day, each with its own Practise button.
  const missedSheet = $("#missedSheet");
  function openMissed() {
    const u = store.users[store.current];
    const today = new Date().toDateString(), yesterday = new Date(Date.now() - 864e5).toDateString();
    $("#missedDays").innerHTML = Object.entries(missedByDay(u)).map(([day, words]) => {
      const name = day === today ? "Today" : day === yesterday ? "Yesterday"
        : new Date(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      const reps = practisedOn(u, day);
      const count = words.filter((w) => reps[w] >= PRACTISE_REPS).length;
      return `<section class="missed-day"><h3>${name} · ${words.length} word${words.length === 1 ? "" : "s"}${count ? ` · ${count} practised` : ""}</h3>
        <div class="tricky-list">${words.map((w) => reps[w] >= PRACTISE_REPS
          ? `<span class="done" title="Practised">✓ ${escapeHtml(w)}</span>`
          : reps[w] ? `<span title="${reps[w]} of ${PRACTISE_REPS} goes done">${escapeHtml(w)} <small>${reps[w]}/${PRACTISE_REPS}</small></span>`
          : `<span>${escapeHtml(w)}</span>`).join("")}</div>
        <button type="button" class="primary small" data-day="${escapeHtml(day)}">${day === today ? "Practise today's " + (words.length === 1 ? "word" : "words")
          : words.length === 1 ? "Practise this word" : "Practise these words"}</button></section>`;
    }).join("") || `<p class="note">No words to practise from the last 7 days.</p>`;
    missedSheet.hidden = false;
    document.addEventListener("keydown", onMissedKey);
    $("#missedCard").focus();
  }
  function closeMissed() {
    missedSheet.hidden = true;
    document.removeEventListener("keydown", onMissedKey);
    $("#missedBtn").focus();
  }
  // Esc closes it, and Tab stays inside it (as in Settings).
  function onMissedKey(e) {
    if (e.key === "Escape") { e.preventDefault(); return closeMissed(); }
    if (e.key !== "Tab") return;
    const items = [...missedSheet.querySelectorAll("button")];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === $("#missedCard"))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  $("#missedBtn").addEventListener("click", openMissed);
  $("#missedDone").addEventListener("click", closeMissed);
  missedSheet.addEventListener("click", (e) => {
    if (e.target === missedSheet) return closeMissed();
    const b = e.target.closest("[data-day]");
    if (!b) return;
    closeMissed();
    useProfile(store.current);
    practiceDay = b.dataset.day;
    start("practise");
  });
  $("#switchBtn").addEventListener("click", () => showPanel("switch"));
  $("#newBtn").addEventListener("click", () => showPanel("new"));
  $("#switchNew").addEventListener("click", () => showPanel("new"));
  $("#switchBack").addEventListener("click", showWelcome);
  $("#userList").addEventListener("click", (e) => { const b = e.target.closest(".user"); if (b) useProfile(b.dataset.id); });

  buildKeyboard();
  showWelcome();
})();
