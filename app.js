(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const ROUND = { warm: 5, words: 10, spell: 10, sentences: 10, fixit: 10, tricky: 10 };
  const TITLES = {
    warm: ["⌨️ Warm-up", "⌨️ Opvarmning"], words: ["🌼 Word Garden", "🌼 Ordhaven"], spell: ["🐝 Spelling Bee", "🐝 Stavebien"],
    sentences: ["🌊 Sentence Stream", "🌊 Sætningsstrømmen"], fixit: ["🔧 Fix-It", "🔧 Ret fejlen"],
    tricky: ["🎯 Tricky Words", "🎯 Svære ord"], practise: ["✏️ Practice", "✏️ Øvelse"],
  };
  // Practice (user's request, 2026-10-27): the words of one day that weren't right first try in Spelling Bee.
  // Each word is shown and typed until it has been typed PRACTISE_REPS times with no wrong key.
  const PRACTISE_REPS = 5;
  let practiceDay = ""; // the day being practised, as Date.toDateString()
  // Timed games: Spelling Bee is a 20-minute session with as many words as Luke can manage.
  // Words come in batches of ROUND.spell, and none repeats within a session.
  // Spelling Bee lengths (user's request, 2026-10-28): one card, then a choice of 10 or 20 minutes.
  const LENGTHS = { quick: 5, short: 10, long: 20 }; // test build only (live: { short: 10, long: 20 })
  // The time bar flashes red for the last 2.5% of a session: 30 s of 20 minutes, 7.5 s of 5 (the test build).
  const ENDING = 0.025;
  // When time runs out mid-word, Luke gets up to 10 s more to finish that word (user's request, 2026-10-26).
  const GRACE = 10000;
  const PRAISE = ["Lovely!", "Brilliant!", "Smooth!", "Nice and calm.", "Great typing!", "Spot on!"];
  const PRAISE_DA = ["Dejligt!", "Fantastisk!", "Flot!", "Roligt og fint.", "Godt skrevet!", "Lige i øjet!"];

  // ---------- Saved progress (per browser) ----------
  // Several people can use Typing Zen in one browser. typingZen.v2 holds { current, users: { id: profile } };
  // `profile` is the current user's record. 1.0 kept one profile in typingZen.v1: on the first visit with
  // this version it becomes the first user (v1 itself is left as it was).
  const KEY = "typingZen.v2-test";
  const OLD_KEY = "typingZen.v1-test";
  const DEFAULTS = () => ({ name: "", year: "", bucket: "Y1", bestWpm: 0, stars: 0, rounds: 0, tricky: {}, seen: {}, sessions: [], mute: false, keySound: "red", voice: "au-female", practised: {}, practiseOrder: "order", learned: {}, streak: {}, lang: "en", byLang: {}, setAt: {} });
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
  const saveLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage unavailable */ } };
  // A change to the current user's progress or settings: saved here, and for a Google user also sent to the
  // cloud a few seconds later (onSave is set in the Google section).
  let onSave = null;
  const save = () => { saveLocal(); if (onSave) onSave(); };
  // When each setting was last changed by hand (user's bug report, 2026-11-04: Practice order went back to In order
  // after another device's sync). A sync keeps, setting by setting, the value changed last (mergeProfile).
  const stamp = (...keys) => { profile.setAt = profile.setAt || {}; const t = new Date().toISOString(); for (const k of keys) profile.setAt[k] = t; };
  // A user's scores and history, as they are after Clear history or for a language not used yet.
  const FRESH = () => ({ bestWpm: 0, stars: 0, rounds: 0, tricky: {}, seen: {}, sessions: [], practised: {}, learned: {}, streak: {}, beeToday: null });
  // Each language keeps its own history and voice (user's request, 2026-11-04): the profile holds the current
  // language's, and profile.byLang[lang] the others', put away by stashLang() and brought back by restoreLang().
  // Sessions carry their language, so a sync puts another device's sessions under the right one.
  const LANG_KEYS = [...Object.keys(FRESH()), "voice"];
  // A session with no language (saved before 2026-11-04) is English (user's request): untagged() files it there.
  // A session whose words are Chinese characters is Chinese, whatever it says (1.18 could save a Chinese round as
  // English when a sync switched the language mid-round: user's bug report, 2026-11-04).
  const HAN = /\p{Script=Han}/u;
  const isChinese = (x) => [...(x.firstTryWords || []), ...(x.struggledWords || [])].some((w) => HAN.test(w));
  function untagged(p) {
    // Mis-filed Chinese sessions go back under Chinese first.
    let moved = false;
    p.byLang = p.byLang || {};
    const lists = [[p.lang || "en", p, "sessions"], ...Object.entries(p.byLang).map(([L, b]) => [L, b, "sessions"])];
    for (const [L, holder] of lists) {
      if (L === "zh" || !holder.sessions) continue;
      const wrong = holder.sessions.filter(isChinese);
      if (!wrong.length) continue;
      holder.sessions = holder.sessions.filter((x) => !isChinese(x));
      for (const x of wrong) x.lang = "zh";
      const zh = (p.lang || "en") === "zh" ? p : (p.byLang.zh || (p.byLang.zh = { ...FRESH(), voice: "zh-female" }));
      zh.sessions = [...zh.sessions, ...wrong].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-500);
      moved = true;
    }
    const old = p.sessions.filter((x) => !x.lang);
    if (!old.length) return moved;
    for (const x of old) x.lang = "en";
    if ((p.lang || "en") === "en") return true;
    p.byLang = p.byLang || {};
    const en = p.byLang.en || (p.byLang.en = { ...FRESH(), voice: "au-female" });
    en.sessions = [...(en.sessions || []), ...old].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-500);
    p.sessions = p.sessions.filter((x) => x.lang !== "en");
    return true;
  }
  function stashLang(p) {
    untagged(p);
    const L = p.lang || "en";
    p.byLang = p.byLang || {};
    p.byLang[L] = Object.fromEntries(LANG_KEYS.map((k) => [k, p[k]]));
  }
  function restoreLang(p, L) {
    p.byLang = p.byLang || {};
    const kept = p.byLang[L];
    delete p.byLang[L];
    Object.assign(p, FRESH(), { voice: DEFAULT_VOICE[L] }, kept || {}, { lang: L });
  }
  // Profiles saved before sessions had a language: filed once, and saved (only if something moved).
  if (Object.values(store.users).map(untagged).some(Boolean)) saveLocal();

  // ---------- Language ----------
  // English or Danish, chosen per user in Settings (user's request, 2026-10-29). It sets the words
  // (words.js or words-da.js), the keyboard layout, the voices and the page's text. Text written by the code
  // gives both languages to tx(); index.html's own text is swapped from DA_TEXT (data.js) by translatePage().
  // The language on screen: the user's, except that a link ending #dk (or #da, #en) opens the start screens
  // in that language before anyone is chosen, and a new user made there starts in it (user's request: #dk).
  // The start screens use store.lang: the language picked in Settings there, or else the last chosen user's
  // (Hermes R39.1). It is kept in step in useProfile() and switchLang().
  // Chinese (user's request, 2026-11-04): words-zh.js's words, shown in characters and typed as pinyin without
  // tones on the English keyboard, with a Mandarin voice. The page's own text stays English (tx() gives English
  // for "zh"); only the words, the voices and the typing change.
  const HASH_LANG = { "#dk": "da", "#da": "da", "#en": "en", "#zh": "zh", "#cn": "zh" }[location.hash.toLowerCase()] || null;
  let shownLang = HASH_LANG || store.lang || (store.users[store.current] ? profile.lang : "en");
  const DA = () => shownLang === "da";
  const ZH = () => shownLang === "zh";
  // The language whose words, voices and layout are used: "en", "da" or "zh".
  const wordLang = () => (shownLang === "da" || shownLang === "zh" ? shownLang : "en");
  const tx = (en, da) => (DA() ? da : en);

  // ---------- Keyboard model ----------
  // A full-size keyboard laid out like TypingClub's: every row is 15 key-widths wide,
  // so the rows stagger the way a real keyboard does. [label, id, width]; a bare string is a 1-wide key.
  // Danish is the Danish layout (user's request, 2026-10-29): å, æ and ø where a Danish keyboard has them,
  // the < key beside the left Shift, and Enter over two rows (the lower half is "enter-2", typing Enter too).
  // Enter and Shift show ↵ and ⇧, as on Danish keyboards (the narrow keys can't fit the words on a phone).
  const LAYOUTS = {
    en: {
      rows: [
        ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", ["backspace", "backspace", 2]],
        [["tab", "tab", 1.5], "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", ["\\", "\\", 1.5]],
        [["caps lock", "caps", 1.75], "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", ["enter", "enter", 2.25]],
        [["shift", "shift-l", 2.25], "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", ["shift", "shift-r", 2.75]],
        [["ctrl", "ctrl-l", 2.25], ["alt", "alt-l", 1.5], ["", " ", 6.25], ["alt", "alt-r", 1.5], ["ctrl", "ctrl-r", 3.5]],
      ],
      fingers: {
        "left pinky": "`1qaz", "left ring": "2wsx", "left middle": "3edc", "left index": "45rtfgvb",
        "right index": "67yuhjnm", "right middle": "8ik,", "right ring": "9ol.", "right pinky": "0-=p[];'/\\",
      },
      shifted: { "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
        "_": "-", "+": "=", "{": "[", "}": "]", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/", "~": "`", "|": "\\" },
    },
    da: {
      rows: [
        ["½", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "+", "´", ["backspace", "backspace", 2]],
        [["tab", "tab", 1.5], "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "å", "¨", ["↵", "enter", 1.5]],
        [["caps lock", "caps", 1.75], "a", "s", "d", "f", "g", "h", "j", "k", "l", "æ", "ø", "'", ["", "enter-2", 1.25]],
        [["⇧", "shift-l", 1.25], "<", "z", "x", "c", "v", "b", "n", "m", ",", ".", "-", ["⇧", "shift-r", 2.75]],
        [["ctrl", "ctrl-l", 2.25], ["alt", "alt-l", 1.5], ["", " ", 6.25], ["alt gr", "alt-r", 1.5], ["ctrl", "ctrl-r", 3.5]],
      ],
      fingers: {
        "left pinky": "½1qaz<", "left ring": "2wsx", "left middle": "3edc", "left index": "45rtfgvb",
        "right index": "67yuhjnm", "right middle": "8ik,", "right ring": "9ol.", "right pinky": "0+´på¨æø'-",
      },
      shifted: { "§": "½", "!": "1", '"': "2", "#": "3", "¤": "4", "%": "5", "&": "6", "/": "7", "(": "8", ")": "9",
        "=": "0", "?": "+", "`": "´", "^": "¨", "*": "'", ">": "<", ";": ",", ":": ".", "_": "-" },
    },
  };
  // The current user's layout, set by setLayout(): its rows, which finger types each key, Shift's symbols,
  // and each key's row (for its sound).
  let ROWS, SHIFTED, SHIFT_LABEL;
  const fingerOf = {}, rowOf = {};
  function setLayout() {
    const L = LAYOUTS[DA() ? "da" : "en"];
    ROWS = L.rows;
    SHIFTED = L.shifted;
    SHIFT_LABEL = Object.fromEntries(Object.entries(SHIFTED).map(([sym, key]) => [key, sym]));
    for (const o of [fingerOf, rowOf]) for (const k of Object.keys(o)) delete o[k];
    for (const [f, keys] of Object.entries(L.fingers)) for (const k of keys) fingerOf[k] = f;
    Object.assign(fingerOf, { " ": "thumb", tab: "left pinky", caps: "left pinky", "shift-l": "left pinky",
      backspace: "right pinky", enter: "right pinky", "enter-2": "right pinky", "shift-r": "right pinky" });
    rowOf.escape = 0;
    ROWS.forEach((row, r) => row.forEach((spec) => { rowOf[Array.isArray(spec) ? spec[1] : spec] = r; }));
  }
  setLayout();

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
    kbd.textContent = "";
    for (const row of ROWS) {
      const el = document.createElement("div");
      el.className = "row";
      for (const spec of row) {
        const [label, id, width] = Array.isArray(spec) ? spec : [spec, spec, 1];
        const k = document.createElement("div");
        k.className = "key " + (id === "enter-2" ? "mod" : (fingerOf[id] || "mod").split(" ").pop());
        if (id.length > 1) k.classList.add("named");
        if (id === "f" || id === "j") k.classList.add("bump");
        k.style.setProperty("--w", width);
        k.dataset.key = id;
        k.textContent = label;
        if (id === "backspace") k.dataset.short = "⌫"; // phones show the symbol: the word doesn't fit (user, 2026-11-01)
        el.append(k);
      }
      kbd.append(el);
    }
  }
  const keyEl = (id) => document.querySelector(`.kbd [data-key="${CSS.escape(id)}"]`);

  // The on-screen keys show what they would type right now: Caps Lock makes letters capital,
  // Shift makes symbols and flips letters (so Shift with Caps Lock on gives lower case).
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
    if (id === "enter" || id === "enter-2") key = "Enter";
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
  // iPhones and iPads on silent (the ring/silent switch) mute a web page's sound; Settings > Voice says so.
  // 1.05 asked iOS to play like a music app (navigator.audioSession.type = "playback") so the switch didn't mute
  // it. Reverted (user's request, 2026-10-31): on an iPad with an external keyboard, keys then went missing,
  // with only about one press every 6 seconds reaching the page after each key sound.
  let audio;
  function tone(freq, dur = 0.08, type = "sine", vol = 0.05) {
    if (muted()) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== "running") audio.resume(); // see keySound()
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
      // Safari also has "interrupted" (another sound, such as the spoken word, took over on iPhone/iPad):
      // resume from anything but running, or every key stays silent after the first word is read.
      if (audio.state !== "running") audio.resume();
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
  // A triumph sound when a Spelling Bee ends, bigger with more stars (user's picks, 2026-11-02, from six made for
  // them: 1A "Little lift", 2A "Bright arpeggio", 3B "Rocket sparkle"). Made here like the other sounds, so it
  // needs no file and works offline. Spelling Bee is never muted, so neither is this.
  function triumph(stars) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== "running") audio.resume();
    } catch { return; }
    const a = audio, t = a.currentTime + 0.05;
    const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.51, G6 = 1567.98, C7 = 2093;
    // One note: brass-like (triangle and a quieter octave) or a bell (sine partials), quick attack, gentle fade.
    const note = (at, f, dur, vol = 0.12, bell = false) => {
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
      g.gain.setValueAtTime(vol, at + Math.max(0.03, dur * 0.6));
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      g.connect(a.destination);
      for (const [type, mult, level] of bell ? [["sine", 1, 1], ["sine", 2, 0.35], ["sine", 3, 0.12]] : [["triangle", 1, 1], ["sine", 2, 0.25]]) {
        const o = a.createOscillator(), og = a.createGain();
        o.type = type; o.frequency.value = f * mult; og.gain.value = level;
        o.connect(og).connect(g); o.start(at); o.stop(at + dur + 0.05);
      }
    };
    if (stars === 1) { note(t, C5, 0.18, 0.1); note(t + 0.15, E5, 0.18, 0.1); note(t + 0.3, G5, 0.45, 0.1); }
    else if (stars === 2) {
      [C5, E5, G5, C6].forEach((f, i) => note(t + i * 0.09, f, 0.18, 0.1));
      [C5, E5, G5, C6].forEach((f) => note(t + 0.4, f, 0.9, 0.07));
    } else if (stars >= 3) {
      [C5, E5, G5, C6, E6, G6].forEach((f, i) => note(t + i * 0.07, f, 0.2, 0.09));
      [C5, G5, C6, E6].forEach((f) => note(t + 0.5, f, 1.4, 0.08));
      for (let i = 0; i < 9; i++) note(t + 0.55 + i * 0.06, [C7, G6, E6][i % 3] * (1 + i * 0.002), 0.25, 0.035, true);
    }
  }

  // Speaks each text in turn with a one-second pause between them.
  // Any new call (or leaving the game) stops a sequence that is still playing.
  // The voice for words and sentences: three choices (user's request, 2026-10-27: Daniel, Samantha and Karen,
  // Karen by default; no Automatic, Female or Male). Those are Apple voices, so on other devices each choice
  // uses the nearest voice there, shown under its real name: a British man, an American woman, an Australian
  // woman. Names are matched from the start ("Microsoft Zira - English (United States)"); the first match wins.
  // Danish (user's request, 2026-10-29): Apple's Sara and Magnus, Windows' Helle, Edge's Christel and Jeppe.
  const VOICES = { en: [
    { id: "gb-male", accent: "British", kind: "male", lang: "en-GB",
      names: ["daniel", "google uk english male", "microsoft ryan", "microsoft george", "microsoft thomas", "arthur", "oliver"] },
    { id: "us-female", accent: "American", kind: "female", lang: "en-US",
      names: ["samantha", "google us english", "microsoft jenny", "microsoft aria", "microsoft zira", "ava", "allison", "susan"] },
    { id: "au-female", accent: "Australian", kind: "female", lang: "en-AU",
      names: ["karen", "microsoft natasha", "microsoft catherine", "catherine"] },
  ], da: [
    { id: "da-female", accent: "Danish", kind: "female", lang: "da-DK",
      names: ["sara", "microsoft christel", "microsoft helle", "helle"] },
    { id: "da-male", accent: "Danish", kind: "male", lang: "da-DK",
      names: ["magnus", "microsoft jeppe", "jeppe"] },
  ],
  // Mandarin (Putonghua): Apple's Tingting / Lili, Google's 普通话, Microsoft's Xiaoxiao / Huihui and Yunxi / Kangkang.
  zh: [
    { id: "zh-female", accent: "Mandarin", kind: "female", lang: "zh-CN",
      names: ["tingting", "ting-ting", "lili", "google 普通话", "microsoft xiaoxiao", "microsoft huihui", "xiaoxiao", "huihui"] },
    { id: "zh-male", accent: "Mandarin", kind: "male", lang: "zh-CN",
      names: ["microsoft yunxi", "microsoft kangkang", "yunxi", "kangkang", "li-mu", "yu-shu"] },
  ] };
  const DEFAULT_VOICE = { en: "au-female", da: "da-female", zh: "zh-female" };
  // Earlier test builds saved "daniel", "samantha" or "karen".
  const OLD_VOICE = { daniel: "gb-male", samantha: "us-female", karen: "au-female" };
  // When a device has none of a choice's voices, the list is topped up with its other English voices: British
  // women first (the default Google voice on Windows), then any. Their kind is guessed from the name.
  const FEMALE = /female|tingting|ting-ting|lili|meijia|mei-jia|xiaoxiao|huihui|yaoyao|samantha|karen|catherine|natasha|zira|jenny|aria|hazel|susan|sonia|libby|serena|kate|moira|tessa|ava\b|allison|google us english|sara|helle|christel/i;
  const MALE = /\bmale\b|yunxi|kangkang|li-mu|yu-shu|daniel|ryan|george|thomas|david|mark\b|guy\b|william|arthur|oliver|rishi|\blee\b|james|magnus|jeppe/i;
  const ACCENTS = { "en-GB": "British", "en-US": "American", "en-AU": "Australian", "en-IE": "Irish", "en-IN": "Indian",
    "en-ZA": "South African", "en-NZ": "New Zealand", "en-CA": "Canadian", "da-DK": "Danish", "zh-CN": "Mandarin", "zh-TW": "Mandarin (Taiwan)" };
  const langOf = (v) => v.lang.replace("_", "-");
  // The device's voices in the user's language.
  const langVoices = () => ("speechSynthesis" in window ? speechSynthesis.getVoices() : [])
    // Chinese: Mandarin voices only (zh-CN, zh-TW, cmn), never Cantonese (zh-HK, yue), which reads characters differently.
    .filter((v) => ({ da: /^da([-_]|$)/i, zh: /^(zh|cmn)([-_](cn|tw|hans|hant|sg)|$)/i }[wordLang()] || /^en([-_]|$)/i).test(v.lang));
  const startsWith = (v, n) => new RegExp("^" + n + "\\b", "i").test(v.name);
  // The three entries this device offers: [{ id, voice, label }], at most three, no voice twice.
  function voiceChoices(vs = langVoices()) {
    const used = new Set(), out = [];
    for (const x of VOICES[wordLang()]) {
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
      // iOS can list the same voice twice ("Sara" and "Sara"): one entry per name (user's report, 2026-10-29).
      if (out.some((c) => shortName(c.voice) === shortName(v))) continue;
      used.add(v);
      out.push(extraVoice(v));
    }
    return out;
  }
  // The name shown in Settings: "Microsoft Ryan Online (Natural) - English (United Kingdom)" → "Ryan".
  const shortName = (v) => v.name.replace(/\s+-\s+(English|Danish|Dansk|Chinese).*$/, "").replace(/^Microsoft\s+/, "").replace(/\s+Online \(Natural\)$/, "");
  const extraVoice = (v) => ({ id: v.voiceURI, voice: v, accent: ACCENTS[langOf(v)] || v.lang,
    kind: FEMALE.test(v.name) ? "female" : MALE.test(v.name) ? "male" : "" });
  // The saved choice if this device can meet it, even when a changed voice list (Edge's online voices arriving,
  // a voice pack added) has pushed it out of the three (Hermes R19.1); else the Australian woman (the default),
  // else a British woman (Chrome on Windows, Hermes R19.2), else the first woman listed, else the first entry.
  function chosenVoice(cs = voiceChoices()) {
    const want = OLD_VOICE[profile.voice] || profile.voice;
    // A voice saved by its voiceURI (earlier builds) that is already one of the three is that entry, not a 4th.
    const kept = !cs.some((c) => c.id === want || c.voice.voiceURI === want) && langVoices().find((v) => v.voiceURI === want);
    return cs.find((c) => c.id === want || c.voice.voiceURI === want) || (kept ? extraVoice(kept) : null) || cs.find((c) => c.id === DEFAULT_VOICE[wordLang()]) ||
      cs.find((c) => c.kind === "female" && langOf(c.voice) === "en-GB") || cs.find((c) => c.kind === "female") || cs[0] || null;
  }
  function pickVoice() {
    const c = chosenVoice();
    return c ? c.voice : null;
  }
  // Sound is always on in Spelling Bee (it is spoken, and its mute button is hidden) and while Settings is open
  // (to try voices and key sounds). profile.mute itself is left as it was, so it applies again everywhere else
  // (user's request, 2026-10-28).
  // Spelling Bee and Practice always have sound (Practice: user's report, 2026-11-04, no word or key sound there when
  // the account's mute was on): they are about hearing the word. Mute still applies to the other games.
  const muted = () => profile.mute && !(game && (game.mode === "spell" || game.mode === "practise") && !$("#play").hidden) && $("#sheet").hidden;
  let speechRun = 0;
  let speakTimer = 0; // the short wait before a new item is spoken; cleared by stopSpeech()
  // texts are said one after another with a 1 s gap; sayThenSpell() uses a shorter one.
  const speak = (...texts) => speakGap(1000, ...texts);
  function speakGap(gap, ...all) {
    const texts = all.filter(Boolean); // a Chinese word has no sentence
    const run = ++speechRun;
    if (muted() || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const say = (i) => {
      if (run !== speechRun || i >= texts.length) return;
      const u = new SpeechSynthesisUtterance(texts[i]);
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : ZH() ? "zh-CN" : tx("en-GB", "da-DK");
      u.rate = 0.85;
      u.onend = () => setTimeout(() => say(i + 1), gap);
      speechSynthesis.speak(u);
    };
    say(0);
  }
  // A word letter by letter, for Practice (user's request, 2026-11-01): "joyfully" → "J O Y F U L L Y".
  // Capitals, so voices say each letter's name; an apostrophe or hyphen is said by name. Spaces, not commas,
  // between them, so the letters come without a pause between each (user's request, 2026-11-01).
  const spelledOut = (w) => [...w].map((c) => (c === "'" ? tx("apostrophe", "apostrof") : c === "-" ? tx("hyphen", "bindestreg")
    : c === " " ? tx("space", "mellemrum") : c.toUpperCase())).join(" ");
  // Practice: the word, then its spelling 0.3 s later (user's request, 2026-11-01: a shorter pause than 1 s).
  // In Chinese the word is said again instead: a Mandarin voice reading pinyin letters makes no sense.
  const sayThenSpell = (w) => (ZH() ? speakGap(600, w, w) : speakGap(300, w, spelledOut(w)));
  const stopSpeech = () => { clearTimeout(speakTimer); speechRun++; if ("speechSynthesis" in window) speechSynthesis.cancel(); };

  // ---------- Building a round ----------
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // Chinese words also carry their pinyin with tones and the typed form, one syllable per character with spaces
  // between (words-zh.js: "peng you"). The spaces are only drawn (user's requests, 2026-11-04): the target is
  // typed without them ("pengyou"), and `breaks` holds the letters after which the line leaves a gap.
  const syllableBreaks = (spaced) => { const out = new Set(); let at = 0; for (const s of spaced.split(" ").slice(0, -1)) out.add((at += s.length) - 1); return out; };
  // The tone mark of each typed letter that carries one, from the toned pinyin (user's request, 2026-11-04: only the
  // tones are shown above the line, not the letters): 蜜蜂 mì fēng -> { 1: "ˋ", 3: "ˉ" } over "mifeng".
  const TONE_MARK = { "\u0304": "ˉ", "\u0301": "ˊ", "\u030c": "ˇ", "\u0300": "ˋ" };
  const tonesOf = (pinyin) => {
    const out = {}; let i = 0;
    for (const c of pinyin.normalize("NFD")) {
      if (TONE_MARK[c]) out[i - 1] = TONE_MARK[c];
      else if (/[a-z]/i.test(c)) i++;
    }
    return out;
  };
  const toWord = ([word, meaning, sentence, why, pinyin, spaced]) =>
    ({ word, meaning, sentence, why: why === "simple, phonetic" ? "" : why,
      ...(spaced ? { pinyin, type: spaced.replace(/ /g, ""), breaks: syllableBreaks(spaced), tones: tonesOf(pinyin) } : {}) });
  const typeOf = (w) => w.type || w.word; // what is typed: the word itself, or a Chinese word's pinyin
  const groups = () => ({ da: WORD_GROUPS_DA, zh: WORD_GROUPS_ZH }[wordLang()] || WORD_GROUPS);
  const allWords = () => groups().flatMap((g) => g.words.map(toWord));
  // One level per school year (wordlist/years.txt), with hand-picked sample words.
  // `name` matches words.js and the saved level; `label` is what the button shows. In Danish the years are
  // Danish school classes of the same age (Year 1 is 0. klasse), with words-da.js's words.
  const BUCKETS = [
    { name: "Y1", en: "Year 1", da: "0. klasse", sample: ["dog, house, friend", "kat, hus, ven", "你好, 朋友, 苹果"] },
    { name: "Y2", en: "Year 2", da: "1. klasse", sample: ["because, people, water", "fordi, hjerte, hvalp", "时间, 帮助, 漂亮"] },
    { name: "Y3", en: "Year 3", da: "2. klasse", sample: ["answer, remember, young", "pludselig, nysgerrig, fløjte", "世界, 勇敢, 发现"] },
    { name: "Y4", en: "Year 4", da: "3. klasse", sample: ["believe, surprise, library", "hemmelighed, chokolade, bjerg", "历史, 合作, 风景"] },
    { name: "Y5", en: "Year 5", da: "4. klasse", sample: ["queue, receive, doubt", "kø, modtage, tvivl", "祖国, 智慧, 探索"] },
    { name: "Y6", en: "Year 6", da: "5. klasse", sample: ["necessary, rhythm, conscience", "rytme, succes, champignon", "一心一意, 奋斗, 灿烂"] },
  ];
  // Each level's label and words in the user's language (applyLang).
  function setBuckets() {
    for (const b of BUCKETS) {
      b.label = tx(b.en, b.da);
      b.words = groups().filter((g) => g.level === b.name).flatMap((g) => g.words);
    }
  }
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
    // Letters in any language count (æ, ø, å), so "en" isn't found inside "søen".
    const re = new RegExp(`(?<![\\p{L}\\d_'-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d_'-])`, "iu");
    return sentence.search(re);
  }
  function blankOut(sentence, word) {
    const at = findWord(sentence, word);
    if (at < 0) return escapeHtml(sentence);
    // One underscore per letter, so the gap matches the length of the word.
    const gap = `<span class="gap" aria-label="${word.length} ${tx("letters", "bogstaver")}">${"_".repeat(word.length)}</span>`;
    return escapeHtml(sentence.slice(0, at)) + gap + escapeHtml(sentence.slice(at + word.length));
  }
  // A Chinese word's example sentence (user's request, 2026-11-04), with the word marked in it.
  const zhSentence = (it) => {
    if (!it.sentence) return "";
    const at = it.sentence.indexOf(it.word);
    const s = at < 0 ? escapeHtml(it.sentence)
      : escapeHtml(it.sentence.slice(0, at)) + `<mark>${escapeHtml(it.word)}</mark>` + escapeHtml(it.sentence.slice(at + it.word.length));
    return `<div class="clue zh-clue" lang="zh-CN">${s}</div>`;
  };
  const tricky = () => tx("Tricky bit:", "Svært:");
  const tip = (it) => (it.why ? `<div class="why">${tricky()} ${escapeHtml(it.why)}</div>` : "");

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
  // How Spelling Bee and Word Garden fill a round (user's requests, 2026-10-28 and 2026-11-01): words not yet mastered,
  // those with the shortest run of right-first-try spellings first, then the ones not seen for longest. About one
  // round in three also brings back one mastered word (the one not seen for longest) to check it; otherwise mastered
  // words come only when nothing else is left.
  function pickRound(list, n, mastered) {
    if (n <= 0) return [];
    const notYet = list.filter((w) => !mastered.has(w.word)), known = list.filter((w) => mastered.has(w.word));
    const streakFirst = (w) => profile.streak[w.word] || 0;
    const check = known.length && Math.random() < 1 / 3 ? freshPick(known, 1, byWord) : [];
    const picked = [...check, ...freshPick(notYet, n - check.length, byWord, streakFirst)];
    if (picked.length < n) picked.push(...freshPick(known.filter((w) => !check.includes(w)), n - picked.length, byWord, streakFirst));
    return picked;
  }
  // The level's words mastered so far: in a Spelling Bee also counting this session's spellings.
  const masteredNow = () => masteredOf(game && game.mode === "spell" ? game.res : resultsIn(profile, currentBucket().name));
  const repeat = (n, make) => Array.from({ length: n }, make).join(" ");
  const randomLetters = (keys, groups, size) => repeat(groups, () => Array.from({ length: size }, () => pick(keys)).join(""));
  // Up-and-down reaches from a home key and back: "frf", "jmj".
  // The Danish home row ends in æ (and ø), with å above it.
  const REACHES = ["fr", "fv", "ft", "fg", "fb", "ju", "jm", "jy", "jh", "jn", "de", "dc", "ki", "k,", "sw", "sx", "lo", "l.", "aq", "az"];
  const W = () => (DA() ? WARMUP_DA : WARMUP); // Chinese uses the English drills (the English keyboard)
  const WARMUP_KINDS = [
    ["Home row: keep your fingers on the F and J bumps", "Grundrækken: hold fingrene på knopperne på F og J", () => randomLetters(tx("asdfghjkl", "asdfghjklæø"), 5, 3)],
    ["Home row words", "Ord på grundrækken", () => pickN(W().homeWords, 4).join(" ")],
    ["Top row: reach up and come back home", "Øverste række: ræk op, og kom hjem igen", () => randomLetters(tx("qwertyuiop", "qwertyuiopå"), 5, 3)],
    ["Top row words", "Ord på øverste række", () => pickN(W().topWords, 4).join(" ")],
    ["Bottom row: reach down and come back home", "Nederste række: ræk ned, og kom hjem igen", () => randomLetters("zxcvbnm", 5, 3)],
    ["Bottom row words", "Ord på nederste række", () => pickN(W().bottomWords, 4).join(" ")],
    ["Finger reaches: start and finish on the home key", "Fingerræk: start og slut på grundtasten",
      () => pickN([...REACHES, tx(";p", "æå")], 5).map((r) => r[0] + r[1] + r[0]).join(" ")],
    ["Numbers: use the finger above each home key", "Tal: brug fingeren over hver grundtast", () => repeat(4, () => String(10 + Math.floor(Math.random() * 90)))],
    ["Capital letters: Shift with the other hand", "Store bogstaver: Skift med den anden hånd", () => pickN(W().names, 4).join(" ")],
    ["Punctuation", "Tegnsætning", () => pickN(W().phrases, 2).join(" ")],
    ["Every letter of the alphabet", "Alle alfabetets bogstaver", () => pick(W().pangrams)],
    ["Words from your level", "Ord fra dit niveau",
      () => pickN(currentBucket().words.map((w) => (w[5] || w[0]).replace(/ /g, "")).filter((w) => /^[a-zæøå]{3,7}$/.test(w)), 4).join(" ")],
  ];

  function buildItems(mode) {
    const n = ROUND[mode];
    const pool = currentBucket().words.map(toWord);
    switch (mode) {
      case "warm":
        // Five different kinds of drill each round, each freshly made.
        return shuffle(WARMUP_KINDS).slice(0, n).map(([en, da, make]) => ({ tag: tx(en, da), target: make() }));
      case "words": {
        // Picked like Spelling Bee's words; words learned here in the last 7 days and not yet spelled in Spelling Bee
        // wait, so the garden doesn't keep teaching the same words (user's request, 2026-11-01).
        const waiting = (w) => Date.parse(profile.learned[w.word]) >= Date.now() - 7 * 864e5;
        const fresh = pickRound(pool.filter((w) => !waiting(w)), n, masteredNow());
        return [...fresh, ...freshPick(pool.filter(waiting), n - fresh.length, byWord)].map((w) => ({ ...w, target: typeOf(w) }));
      }
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
        // Words learned in Word Garden in the last 7 days come a little sooner than the others: at most 2 a round,
        // the ones not seen for longest (user's requests, 2026-10-28 and 2026-11-01, "don't repeat them too much").
        // A word leaves profile.learned once it has been spelled here.
        const week = Date.now() - 7 * 864e5;
        const learned = freshPick(left.filter((w) => !tricky.includes(w) && Date.parse(profile.learned[w.word]) >= week),
          Math.min(2, n - tricky.length), byWord);
        // The rest of the round as pickRound() fills it (mastered words rarely).
        const fresh = pickRound(left.filter((w) => !tricky.includes(w) && !learned.includes(w)), n - tricky.length - learned.length, masteredNow());
        const short = n - tricky.length - learned.length - fresh.length;
        const topUp = short > 0 ? freshPick(spare, short, byWord, (w) => profile.streak[w.word] || 0) : [];
        return shuffle([...tricky, ...learned, ...fresh, ...topUp]).map((w) => ({ ...w, target: typeOf(w), hidden: true }));
      }
      case "tricky": {
        const tricky = allWords().filter((w) => profile.tricky[w.word]);
        return shuffle(tricky).slice(0, n).map((w) => ({ ...w, target: typeOf(w), hidden: true }));
      }
      case "sentences":
        return freshPick(pool, n, (w) => "s:" + w.word).map((w) => ({ ...w, target: w.sentence }));
      case "fixit":
        return freshPick(FIXITS, n, (f) => "f:" + f.right).map((f) => ({ ...f, target: f.right, hidden: true, open: true }));
      case "practise": {
        // Shown, not hidden: he copies each word, as many goes as it takes to get 5 clean ones.
        // Progress is kept (user's request, 2026-10-28): each word starts from its saved clean goes, and words
        // already done are left out. A day can only be started while it has a word left (home and View stats both
        // check, R69/R51.1), so the "all done: run every word again from 0" fallback below no longer happens.
        // Every language's words, so a word always finds its own entry (a Chinese one its pinyin).
        const known = new Map([WORD_GROUPS, WORD_GROUPS_DA, WORD_GROUPS_ZH].flatMap((gs) => gs.flatMap((g) => g.words.map(toWord))).map((w) => [w.word, w]));
        for (const w of allWords()) known.set(w.word, w); // this language's entry first where a word is in two
        const words = missedByDay(profile)[practiceDay] || [];
        const saved = practisedOn(profile, practiceDay);
        const left = words.filter((w) => (saved[w] || 0) < PRACTISE_REPS);
        const list = (left.length ? left : words).map((word) =>
          ({ word, meaning: "", sentence: "", why: "", ...known.get(word), target: known.has(word) ? typeOf(known.get(word)) : word, reps: left.length ? saved[word] || 0 : 0 }));
        return profile.practiseOrder === "random" ? shuffle(list) : list; // Settings > Practice order

      }
    }
  }

  // ---------- Game state ----------
  let game = null;

  // length: "short" or "long" for Spelling Bee (its card's data-length); kept for Play again.
  function start(mode, length) {
    cancelAsk();
    game = null; // a new session must not see the last one's words as used
    loadSwitch(currentSwitch()); // fetch the key sounds now (a click), so the first key isn't silent
    const items = buildItems(mode);
    if (!items.length) return;
    game = { mode, length, items, lang: profile.lang || "en", batch: 0, missedIn: {}, idx: 0, correct: 0, errors: 0, ms: 0, missed: new Set(), firstTry: [], struggled: [], over: false,
      res: mode === "spell" ? resultsIn(profile, currentBucket().name) : {}, newMastered: new Set() };
    game.minutes = mode === "spell" ? LENGTHS[length] || LENGTHS.long : 0;
    if (game.minutes) game.endsAt = Date.now() + game.minutes * 60000;
    $("#modeTitle").textContent = tx(...TITLES[mode]);
    $("#trail").innerHTML = game.endsAt ? '<i class="time"><b></b></i>' : items.map(() => "<i></i>").join("");
    $("#clock").hidden = !game.endsAt;
    $("#muteBtn").hidden = mode === "spell" || mode === "practise";
    show("play");
    // Phones type on their own keyboard by default (user's request, like TypingClub); tablets show the
    // on-screen one (see TABLET). This runs inside the tap that started the game, which iOS needs before it
    // will show the keyboard.
    $("#kbdToggle").hidden = !TOUCH;
    deviceKeyboard(TOUCH && !TABLET);
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
    if (game.pausedAt && game.grace) clock.textContent = `${tx("Finish", "Skriv færdig")}: ${Math.ceil((game.endsAt + GRACE - now) / 1000)}`;
    if (left > 0 || game.pausedAt || $("#play").hidden) return;
    // Time is up. A word he has started gets up to GRACE more to finish; one finished in that time is
    // counted, and next() then ends the game. If it isn't finished by then, it isn't counted.
    const inWord = game.itemStart !== null && !game.wait;
    const graceLeft = game.endsAt + GRACE - now;
    if (inWord && graceLeft > 0) {
      if (!game.grace) {
        game.grace = true;
        $("#msg").className = "msg";
        $("#msg").textContent = tx("Time's up! Finish this word.", "Tiden er gået! Skriv ordet færdigt.");
      }
      clock.textContent = `${tx("Finish", "Skriv færdig")}: ${Math.ceil(graceLeft / 1000)}`;
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
    // A Chinese word takes the smaller line too: its card also has the characters and the pinyin hint.
    $("#line").className = "line" + (it.target.length > 24 || it.type ? " small" : "");
    if (!game.endsAt) [...$("#trail").children].forEach((el, i) => { el.className = i < game.idx ? "done" : i === game.idx ? "now" : ""; });
    renderCard(it);
    renderLine();
    // Kept in speakTimer, so leaving or the end of a timed game stops a word that hasn't been spoken yet.
    clearTimeout(speakTimer);
    if (it.hidden && !it.open) speakTimer = setTimeout(() => speak(it.word, it.sentence), 250);
    else if (game.mode === "practise" && (!it.spoken || it.sayAgain)) {
      // Practice says the word and then spells it, on its first go and again after a go with a slip (user's
      // requests, 2026-11-01); a clean go is followed by the next go in silence.
      it.spoken = true;
      it.sayAgain = false;
      speakTimer = setTimeout(() => sayThenSpell(it.word), 250);
    }
    else if (game.mode === "words") speakTimer = setTimeout(() => speak(it.word), 250);
    else if (game.mode === "sentences") speakTimer = setTimeout(() => speak(it.sentence), 250);
  }

  function renderCard(it) {
    const card = $("#card");
    const m = game.mode;
    const means = tx("means", "betyder");
    if (m === "warm") {
      card.innerHTML = `<div class="tagline">${escapeHtml(it.tag)}</div>`;
    } else if (it.type && (m === "spell" || m === "tricky")) {
      // Chinese: the characters, their meaning and the example sentence with the word marked. The line shows each
      // syllable's tone mark above its letter as a hint (renderLine), not the pinyin itself (user's requests, 2026-11-04).
      card.innerHTML = `<div class="hanzi" lang="zh-CN">${escapeHtml(it.word)}</div>
        <div class="meaning">${tx("It means", "Det betyder")} ${escapeHtml(it.meaning)}</div>
        ${zhSentence(it)}
        <div class="tools"><button class="ghost" data-say="word">🔊 ${tx("Hear the word", "Hør ordet")}</button>${it.sentence ? `<button class="ghost" data-say="sentence">🔊 ${tx("Hear the sentence", "Hør sætningen")}</button>` : ""}</div>`;
    } else if (it.type) {
      // Chinese, shown (Word Garden, Practice): the characters, their pinyin with tones and the meaning.
      card.innerHTML = (m === "practise" ? `<div class="tagline">${tx(`Type it ${PRACTISE_REPS} times with no mistakes`, `Skriv det ${PRACTISE_REPS} gange uden fejl`)}</div>
        <div class="reps" role="img" aria-label="${repsSaid(it)}">${repsDots(it)}</div>` : "") +
        `<div class="hanzi" lang="zh-CN">${escapeHtml(it.word)}</div>
        <div class="pinyin">${escapeHtml(it.pinyin)}</div>
        <div class="meaning">${tx("It means", "Det betyder")} ${escapeHtml(it.meaning)}</div>
        ${zhSentence(it)}
        <div class="tools"><button class="ghost" data-say="word">🔊 ${tx("Hear it", "Hør det")}</button>${it.sentence ? `<button class="ghost" data-say="sentence">🔊 ${tx("Hear the sentence", "Hør sætningen")}</button>` : ""}</div>`;
    } else if (m === "words") {
      card.innerHTML = `<div class="meaning"><b>${escapeHtml(it.word)}</b> ${means} ${escapeHtml(it.meaning)}</div>
        ${tip(it)}
        <div class="tools"><button class="ghost" data-say="word">🔊 ${tx("Hear it again", "Hør det igen")}</button></div>`;
    } else if (m === "practise") {
      card.innerHTML = `<div class="tagline">${tx(`Type it ${PRACTISE_REPS} times with no mistakes`, `Skriv det ${PRACTISE_REPS} gange uden fejl`)}</div>
        <div class="reps" role="img" aria-label="${repsSaid(it)}">${repsDots(it)}</div>
        ${it.meaning ? `<div class="meaning"><b>${escapeHtml(it.word)}</b> ${means} ${escapeHtml(it.meaning)}</div>` : ""}
        <div class="tools"><button class="ghost" data-say="word">🔊 ${tx("Hear it", "Hør det")}</button></div>`;
    } else if (m === "spell" || m === "tricky") {
      card.innerHTML = `<div class="meaning">${tx("It means", "Det betyder")} ${escapeHtml(it.meaning)}</div>
        <div class="clue">${blankOut(it.sentence, it.word)}</div>
        <div class="tools"><button class="ghost" data-say="word">🔊 ${tx("Hear the word", "Hør ordet")}</button><button class="ghost" data-say="sentence">🔊 ${tx("Hear the sentence", "Hør sætningen")}</button></div>`;
    } else if (m === "sentences") {
      card.innerHTML = `<div class="tagline">${tx("Remember the capital letter and the full stop", "Husk det store bogstav og punktummet")}</div>
        <div class="meaning"><b>${escapeHtml(it.word)}</b> ${means} ${escapeHtml(it.meaning)}</div>
        <div class="tools"><button class="ghost" data-say="sentence">🔊 ${tx("Hear it again", "Hør det igen")}</button></div>`;
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
    if (box) { box.innerHTML = repsDots(it); box.setAttribute("aria-label", repsSaid(it)); }
  }
  const repsSaid = (it) => tx(`${it.reps} of ${PRACTISE_REPS} done`, `${it.reps} af ${PRACTISE_REPS} klaret`);

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
        if (it.breaks && it.breaks.has(i)) cls += " brk"; // a Chinese word: a gap after each syllable
        const tone = it.tones && it.tones[i] ? ` data-tone="${it.tones[i]}"` : ""; // and its tone mark above the letter
        html += `<span class="${cls}"${tone}>${vis(ch)}</span>`;
      }
    }
    $("#line").innerHTML = html;
    showNextKey();
    updateLive();
  }
  const vis = (ch) => escapeHtml(ch); // a space stays a normal-width space, even when it is next

  const FINGER_DA = {
    "left pinky": "venstre lillefinger", "left ring": "venstre ringfinger", "left middle": "venstre langfinger", "left index": "venstre pegefinger",
    "right index": "højre pegefinger", "right middle": "højre langfinger", "right ring": "højre ringfinger", "right pinky": "højre lillefinger",
  };
  function showNextKey() {
    document.querySelectorAll(".kbd .next").forEach((k) => k.classList.remove("next"));
    const it = game.items[game.idx];
    const ch = it.target[game.typed.length];
    const finger = $("#finger");
    if (!ch || game.wait) { finger.textContent = ""; return; }
    if (it.hidden && !game.revealed) {
      finger.textContent = game.mode === "fixit" ? tx("Type the fixed sentence from the start.", "Skriv den rettede sætning fra begyndelsen.")
        : it.type ? "Type its pinyin, without tones (ü is v). Press 🔊 to hear it again."
        : tx("Spell it from memory. Press 🔊 to hear it again.", "Stav det udenad. Tryk på 🔊 for at høre det igen.");
      return;
    }
    const { key, shift } = baseKey(ch);
    keyEl(key)?.classList.add("next");
    const f = fingerOf[key] || "";
    let text = f === "thumb" ? tx("Space bar: either thumb", "Mellemrumstasten: en af tommelfingrene")
      : tx(`Use your ${f} finger`, `Brug ${FINGER_DA[f] || f}`);
    if (shift && capsOn) {
      // Caps Lock is on, so this is a lower-case letter: either Shift will do.
      keyEl("shift-l").classList.add("next");
      keyEl("shift-r").classList.add("next");
      text += tx(" and hold either Shift (Caps Lock is on)", " og hold en af Skift-tasterne nede (Caps Lock er slået til)");
    } else if (shift) {
      const side = f.startsWith("left") ? "r" : "l";
      keyEl("shift-" + side).classList.add("next");
      text += tx(` and hold Shift with your ${side === "l" ? "left" : "right"} pinky`,
        ` og hold Skift nede med ${side === "l" ? "venstre" : "højre"} lillefinger`);
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

  const CASELESS = new Set(["X-ray"]);
  function press(raw) {
    const it = game.items[game.idx];
    const ch = raw === "’" || raw === "‘" ? "'" : raw;
    const want = it.target[game.typed.length];
    if (game.itemStart === null) game.itemStart = performance.now();
    const { key } = baseKey(ch);
    const k = keyEl(key);
    // A word that starts its example sentence ("_____ go to the park.") may be typed with a capital first letter
    // (user's request, 2026-11-01): it counts as right, and the word is kept as it is in the list.
    const capitalOk = !game.typed && it.word && it.sentence && ch !== want && ch === want.toUpperCase() &&
      findWord(it.sentence, it.word) === it.sentence.search(/\p{L}/u);

    // Chinese pinyin: a capital counts (Caps Lock), and ü may be typed u as well as v (input methods use v).
    const pinyinOk = ZH() && it.type && (ch.toLowerCase() === want || (want === "v" && ch.toLowerCase() === "u"));
    // Words whose capitals are a matter of style, not spelling: in the Spelling Bee and Practice any case counts (user's request, 2026-11-06).
    const caseOk = (game.mode === "spell" || game.mode === "practise") && CASELESS.has(it.word) && ch.toLowerCase() === want.toLowerCase();
    if (ch === want || capitalOk || pinyinOk || caseOk) {
      game.typed += want;
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
      if (it.hidden && game.revealed) $("#msg").textContent = tx("Here's a hint: type the orange letter.", "Her er et hint: skriv det orange bogstav.");
      // Practice: a go with any wrong key doesn't count, but the word keeps the goes it has (user's requests,
      // 2026-11-01; it used to start the 5 again). complete() just doesn't add one.
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
    // 2026-10-28); wrong keys on two letters, or a hint, don't. In Practice any wrong key is a mistake (user's
    // request, 2026-11-01).
    const missed = game.itemErr > 0 && (game.mode === "practise" || game.errAt.size > 1 || game.hinted);
    if (game.endsAt) (missed ? game.struggled : game.firstTry).push(it.word);
    // Word Garden is the learning mode: the words typed there wait for Spelling Bee (7 days at most).
    if (game.mode === "words") {
      profile.learned[it.word] = new Date().toISOString();
      const week = Date.now() - 7 * 864e5;
      for (const w of Object.keys(profile.learned)) if (!(Date.parse(profile.learned[w]) >= week)) delete profile.learned[w];
    }
    if (game.mode === "spell") {
      delete profile.learned[it.word]; // spelled from memory: no longer waiting
      // Mastery in this level, kept up as the session goes: a word reaching 3 right first try in a row is new.
      const r = game.res[it.word] = game.res[it.word] || [], was = isMastered(r);
      r.push(!missed);
      if (!was && isMastered(r)) game.newMastered.add(it.word);
      else if (was && !isMastered(r)) game.newMastered.delete(it.word);
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
    if (game.mode === "practise" && missed) it.sayAgain = true; // the next go hears the word and its spelling again
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
    const praise = !missed ? pick(tx(PRAISE, PRAISE_DA)) : tx("Done. Keep going!", "Klaret. Fortsæt!");
    if (game.mode === "fixit") {
      msg.className = "msg good";
      msg.innerHTML = `✓ Fixed it! <span class="rule">${escapeHtml(it.rule)}</span><span class="rule">Press <kbd>Enter</kbd> for the next one.</span>`;
      game.wait = "enter";
    } else if (game.mode === "practise") {
      msg.className = "msg good";
      msg.textContent = missed ? tx(`Not counted: there was a slip. Still ${it.reps} of ${PRACTISE_REPS}. Type it again.`, `Tæller ikke: der var en fejl. Stadig ${it.reps} af ${PRACTISE_REPS}. Skriv det igen.`)
        : it.reps < PRACTISE_REPS ? `✓ ${it.reps} ${tx("of", "af")} ${PRACTISE_REPS}. ${praise}`
        : `✓ ${it.word}: ${tx(`all ${PRACTISE_REPS} done!`, `alle ${PRACTISE_REPS} klaret!`)} ${praise}`;
      setTimeout(next, missed ? 1200 : 700);
    } else {
      msg.className = "msg good";
      msg.innerHTML = escapeHtml((it.hidden ? `✓ ${it.word}. ` : "✓ ") + praise) +
        (it.hidden && it.why ? `<span class="rule">${tricky()} ${escapeHtml(it.why)}</span>` : "");
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
      date: new Date().toISOString(), game: game.mode, lang: game.lang || profile.lang || "en", level: currentBucket().name, minutes, length: game.minutes, finished,
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

    if (game.mode === "spell" && done) triumph(stars);
    if (game.mode === "spell") afterBee(done);
    else $("#boardBtn").hidden = true;
    $("#stars").innerHTML = [1, 2, 3].map((i) => `<span class="${i <= stars ? "" : "off"}">⭐</span>`).join("");
    const who = profile.name ? `, ${escapeHtml(profile.name)}` : "";
    $("#resTitle").innerHTML = !done ? tx(`Time's up${who}! No words this time.`, `Tiden er gået${who}! Ingen ord denne gang.`)
      : (stars === 3 ? tx(`Wonderful${who}!`, `Fantastisk${who}!`) : stars === 2 ? tx(`Well done${who}!`, `Godt gået${who}!`)
        : tx(`Good effort${who}!`, `Flot kæmpet${who}!`)) + (newBest ? tx(" New best speed!", " Ny rekordfart!") : "");
    $("#resWpm").textContent = speed;
    $("#resAcc").textContent = done ? acc + "%" : "–"; // nothing typed: no accuracy to claim
    $("#resItems").textContent = game.items.length;
    // Spelling Bee shows three groups (user's request, 2026-11-01): new words mastered, the other words right first
    // try, and the words that need more practice, as figures and as word lists. A word missed and later spelled
    // right in the same session is only in the last group.
    const masteredNow = [...game.newMastered];
    const rightOnly = [...new Set(game.firstTry)].filter((w) => !game.newMastered.has(w) && !game.missed.has(w));
    // Each Spelling Bee figure counts its own word list (Hermes R55.1).
    $("#resFirst").textContent = game.mode === "spell" ? rightOnly.length : game.firstTry.length;
    $("#resStruggled").textContent = game.mode === "spell" ? game.missed.size : game.struggled.length;
    for (const id of ["#figFirst", "#figStruggled"]) $(id).hidden = !game.endsAt;
    // Spelling Bee: the words mastered in this session (user's request, 2026-11-01).
    $("#figMastered").hidden = game.mode !== "spell";
    $("#resMastered").textContent = game.newMastered.size;
    $("#figItems").hidden = !!game.endsAt;
    const list = (label, cls, words, mark = "") => (words.length
      ? `<div class="label">${label}</div><div class="tricky-list ${cls}">${words.map((w) => `<span>${mark}${escapeHtml(w)}</span>`).join("")}</div>` : "");
    $("#resTricky").innerHTML = game.mode === "spell"
      ? list(tx("New words mastered", "Nye ord mestret"), "mastered", masteredNow, "★ ") + list(tx("Right first try", "Rigtigt i første forsøg"), "right", rightOnly) +
        list(tx("Needs more practice", "Skal øves mere"), "again", [...game.missed])
      : list(tx("Words to practise again", "Ord at øve igen"), "", [...game.missed]);
    // Practice ends with Home only: there is no round to play again (user's request, 2026-11-01).
    $("#againBtn").hidden = game.mode === "practise";
    show("results");
  }

  // ---------- Screens ----------
  function show(id) {
    if (id !== "results") cancelAsk(); // the share question belongs to the results screen (Hermes R73.1)
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
    $("#todayStats").innerHTML = t.words ? `${tx("Today", "I dag")}: ${wordsAndRate(t)}` : tx("Today: no words yet.", "I dag: ingen ord endnu.");
    const open = unlocked(profile.year);
    for (const b of document.querySelectorAll(".level")) {
      b.disabled = !open.includes(b.dataset.bucket);
      b.setAttribute("aria-checked", String(b.dataset.bucket === currentBucket().name));
      // A "12% mastered" badge once more than 1% of that year's words are mastered (user's requests, 2026-11-01).
      const lv = BUCKETS.find((x) => x.name === b.dataset.bucket);
      const share = lv.words.length ? (masteredOf(resultsIn(profile, lv.name)).size / lv.words.length) * 100 : 0;
      b.querySelector("b").innerHTML = escapeHtml(lv.label) +
        (share > 1 ? ` <small class="mastery">${Math.round(share)}% ${tx("mastered", "mestret")}</small>` : "");
    }
    const parts = [];
    if (profile.rounds) parts.push(`⭐ ${profile.stars} ${tx("stars", "stjerner")}`, `🏃 ${tx("best", "bedst")} ${profile.bestWpm} ${tx("wpm", "ord/min")}`,
      tx(`${profile.rounds} rounds played`, `${profile.rounds} runder spillet`));
    $("#homeStats").textContent = parts.join("   ·   ");
    const tricky = Object.keys(profile.tricky).length;
    // Sentence Stream, Fix-It and Tricky Words are hidden on home (user's request, 2026-10-28); their code stays.
    // Practice: today's words that weren't right first try. Other days are chosen in View stats.
    // Greyed out once every word missed today has its 5 goes (user's request, 2026-11-01); other days' words are
    // practised from View stats.
    const today = new Date().toDateString(), missedToday = missedByDay(profile)[today] || [];
    const todays = missedToday.length, done = practisedOn(profile, today);
    const left = missedToday.filter((w) => !(done[w] >= PRACTISE_REPS)).length;
    $("#practiseBtn").disabled = !left;
    // Cards show state only, no instructions (UX-PRINCIPLES.md, Hermes UX.1 and UX.6).
    $("#practiseInfo").textContent = !todays ? tx("None today", "Ingen i dag")
      : !left ? (todays === 1 ? tx("Practised today ✓", "Øvet i dag ✓") : tx(`All ${todays} practised today ✓`, `Alle ${todays} øvet i dag ✓`))
      : left < todays ? tx(`${left} of ${todays} words left today`, `${left} af ${todays} ord tilbage i dag`)
      : tx(`${todays} word${todays === 1 ? "" : "s"} today, ${PRACTISE_REPS} times each`, `${todays} ord i dag, ${PRACTISE_REPS} gange hver`);
    $("#trickyInfo").textContent = tx(`${tricky} word${tricky === 1 ? "" : "s"} you found hard`, `${tricky} ord, du fandt svære`);
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
    b.setAttribute("aria-label", profile.mute ? tx("Sound is off. Turn sound on", "Lyden er slået fra. Slå lyden til")
      : tx("Sound is on. Turn sound off", "Lyden er slået til. Slå lyden fra"));
    b.title = profile.mute ? tx("Sound off", "Lyd fra") : tx("Sound on", "Lyd til");
  }

  // ---------- Device keyboard (touch screens) ----------
  // A hidden text box (#typer) has the focus, so the device's own keyboard is up and our on-screen one is
  // hidden. iOS sends real keydown events, which the game handler below takes (and stops them reaching the
  // box). Android sends "Unidentified" keys, so the letter arrives in the box instead: each one is passed on as
  // a keydown, like a tap on the on-screen keyboard. The button switches between the two keyboards.
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const TOUCH = window.matchMedia ? matchMedia("(pointer: coarse)").matches : false;
  // Tablets (shorter side 600px or more: every iPad) start with the on-screen keyboard, as they are often used
  // with an external or Bluetooth keyboard, which a web page can't detect (user's request, 2026-10-28).
  // Phones start with their own keyboard. The button switches either way.
  const TABLET = TOUCH && Math.min(screen.width, screen.height) >= 600;
  const typer = $("#typer");
  function deviceKeyboard(on) {
    $("#play").classList.toggle("native", on);
    kbdLabel();
    if (on) typer.focus({ preventScroll: true });
    else typer.blur();
  }
  function kbdLabel() {
    const b = $("#kbdToggle"), on = $("#play").classList.contains("native");
    b.setAttribute("aria-label", on ? tx("Use the on-screen keyboard", "Brug skærmtastaturet") : tx("Use the device keyboard", "Brug enhedens tastatur"));
    b.title = b.getAttribute("aria-label");
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
  // Phones only: tablets keep the on-screen keyboard until the button is used (Hermes R32.1).
  $("#play .stage").addEventListener("click", (e) => { if (TOUCH && !TABLET && !e.target.closest("button")) deviceKeyboard(true); });
  $("#kbdToggle").addEventListener("click", () => deviceKeyboard(!$("#play").classList.contains("native")));

  // ---------- Key log (?keylog in the address) ----------
  // For finding out why keys from an iPad's external keyboard are sometimes missed (user's report,
  // 2026-10-30): lists the last key events as the page receives them, before the game handles them.
  if (/[?&]keylog\b/.test(location.search)) {
    const box = document.createElement("pre");
    box.id = "keylog";
    box.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:99;margin:0;padding:6px 8px;max-width:calc(100vw - 8px);" +
      "font:11px/1.35 ui-monospace,monospace;background:rgba(0,0,0,.78);color:#fff;border-radius:6px;pointer-events:none;white-space:pre-wrap";
    document.body.append(box);
    const lines = [], t0 = performance.now();
    const el = (x) => (x && x.nodeType === 1 ? x.id || x.tagName.toLowerCase() : String(x));
    const log = (e) => {
      const g = game && !$("#play").hidden ? ` want=${JSON.stringify(game.items[game.idx].target[game.typed.length] || "")}${game.wait ? " wait=" + game.wait : ""}${game.leaving ? " leaving" : ""}` : "";
      lines.push(`${((performance.now() - t0) / 1000).toFixed(2)} ${e.type} key=${JSON.stringify(e.key ?? e.data ?? "")}` +
        (e.code ? ` code=${e.code}` : "") + (e.keyCode ? ` kc=${e.keyCode}` : "") + (e.repeat ? " repeat" : "") +
        (e.isComposing ? " composing" : "") + (e.inputType ? ` ${e.inputType}` : "") + (e.isTrusted ? "" : " synthetic") +
        ` on=${el(e.target)} focus=${el(document.activeElement)}${g}` + (navigator.audioSession ? ` audio=${navigator.audioSession.type}` : "") + (audio ? ` ctx=${audio.state}` : ""));
      if (lines.length > 24) lines.shift();
      box.textContent = lines.join("\n");
    };
    for (const t of ["keydown", "keyup", "beforeinput", "input", "compositionstart", "compositionend"]) window.addEventListener(t, log, true);
    // Also when the page itself loses or gets the focus, is hidden, or is touched: if keys stop arriving
    // with no event at all, these show whether Safari moved the keyboard focus away from the page.
    const note = (e) => {
      lines.push(`${((performance.now() - t0) / 1000).toFixed(2)} ${e.type === "visibilitychange" ? "visibility=" + document.visibilityState : e.type}` +
        (e.pointerType ? ` ${e.pointerType} on=${el(e.target)}` : e.target === window ? " window" : "") +
        ` focus=${el(document.activeElement)} hasFocus=${document.hasFocus()}`);
      if (lines.length > 24) lines.shift();
      box.textContent = lines.join("\n");
    };
    for (const t of ["focus", "blur"]) window.addEventListener(t, (e) => { if (e.target === window) note(e); });
    document.addEventListener("visibilitychange", note);
    window.addEventListener("pointerdown", note, true);
  }

  // ---------- Events ----------
  document.addEventListener("keydown", (e) => {
    if (e.target.id === "newName") return; // typing a name on the welcome screen
    const playing = !$("#play").hidden;
    if (!$("#shareSheet").hidden || !$("#boardSheet").hidden || !$("#updSheet").hidden) return; // the share question, the board or the update question is open
    if (!$("#results").hidden && e.key === "Enter") { e.preventDefault(); return $("#againBtn").hidden ? show("home") : start(game.mode, game.length); }
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
    msg.innerHTML = tx(`Leave this round? Press <kbd>Esc</kbd> again to go home, or keep typing to stay.`,
      `Forlad runden? Tryk på <kbd>Esc</kbd> igen for at gå hjem, eller skriv videre for at blive.`) +
      (game.endsAt ? ` <span class="rule">${tx("The clock is paused.", "Uret er sat på pause.")}</span>` : "");
    pauseClock();
  }


  // The level and year buttons, and the other choices drawn by the code, in the user's language (applyLang).
  function renderChoices() {
    $("#levels").innerHTML = BUCKETS.map((b) =>
      `<button class="level" data-bucket="${b.name}" role="radio"><b>${b.label}</b><span>${b.words.length} ${tx("words, like", "ord, f.eks.")} ${ZH() ? b.sample[2] : tx(b.sample[0], b.sample[1])}</span></button>`).join("");
    for (const id of ["#segYear", "#newYear"])
      $(id).innerHTML = BUCKETS.map((b) => `<button type="button" role="radio" aria-checked="false" data-year="${b.name}">${b.label}</button>`).join("");
    // One button per entry in LENGTHS, so the test build's extra 5-minute choice needs no change to index.html.
    $("#lenChoices").innerHTML = Object.entries(LENGTHS).map(([id, m]) =>
      `<button type="button" class="primary" data-length="${id}">${tx(`${m} minute${m === 1 ? "" : "s"}`, `${m} minut${m === 1 ? "" : "ter"}`)}</button>`).join("");
    $("#segSound").innerHTML = SWITCH_LOOK.map(([id, en, enHow, da, daHow, colour, extra]) => {
      const name = tx(en, da), how = tx(enHow, daHow);
      return `<button type="button" role="radio" aria-checked="false" data-sound="${id}" aria-label="${name}" title="${name}: ${how}">${switchPicture(colour, extra)}</button>`;
    }).join("");
  }
  $("#levels").addEventListener("click", (e) => {
    const b = e.target.closest(".level");
    if (b && !b.disabled) { profile.bucket = b.dataset.bucket; stamp("bucket"); save(); renderHome(); }
  });
  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => {
    b.blur();
    if (b.dataset.mode === "spell") return openLength();
    if (b.dataset.mode === "practise") practiceDay = new Date().toDateString();
    start(b.dataset.mode);
  }));
  // Spelling Bee asks how long first. The labels come from LENGTHS, so the test build's short sessions show.
  const lenSheet = $("#lenSheet");
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
  // Add to Home Screen (user's request, 2026-10-28, the same design as Violin Toolkit's; called Use offline until
  // Google sign-in, which needs the internet, 2026-10-31): a button in Settings opens
  // steps for iPhone / iPad, Android and Mac / PC, starting on this device's. Hidden when Typing Zen already runs
  // from the home screen, or inside another page (the claude.ai copy), where it can't be added.
  const howto = $("#howto");
  (() => {
    const ua = navigator.userAgent, standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const ios = IOS;
    $("#installRow").hidden = standalone || window.top !== window;
    const showDev = (d) => {
      for (const b of $("#segDev").children) b.setAttribute("aria-checked", String(b.dataset.dev === d));
      $("#stepsIos").hidden = d !== "ios";
      $("#stepsAndroid").hidden = d !== "android";
      $("#stepsDesktop").hidden = d !== "desktop";
      $("#howtoDesk").hidden = d !== "desktop";
    };
    const close = () => { howto.hidden = true; document.removeEventListener("keydown", onKey, true); $("#openHowto").focus(); };
    // Esc and Tab here only (capture, so Settings underneath doesn't also take them).
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); return close(); }
      if (e.key !== "Tab") return;
      e.stopImmediatePropagation();
      const items = [...howto.querySelectorAll("button")], i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
    $("#openHowto").addEventListener("click", () => {
      showDev(ios ? "ios" : /Android/i.test(ua) ? "android" : "desktop");
      howto.hidden = false;
      document.addEventListener("keydown", onKey, true);
      $("#howtoCard").focus();
    });
    $("#segDev").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showDev(b.dataset.dev); });
    $("#howtoDone").addEventListener("click", close);
    howto.addEventListener("click", (e) => { if (e.target === howto) close(); });
  })();
  // Switch user and Clear history live in Settings (user's request, 2026-10-28), so home stays clean.
  $("#switchUserBtn").addEventListener("click", () => { closeSheet(); showPanel("switch"); });
  // Clear history asks twice (user's request): what will go, then "are you sure".
  function showClear(step) {
    $("#clearConfirm").hidden = !step;
    $("#clearBtn").hidden = !!step || (!profile.rounds && !Object.keys(profile.tricky).length && !profile.sessions.length);
    if (!step) return;
    $("#clearAsk").textContent = step === 1 ? (profile.google
      ? tx(`Clear all stars, best speed, tricky words and history for ${profile.name}, on every device signed in with this Google account?`,
        `Slet alle stjerner, bedste fart, svære ord og historik for ${profile.name} på alle enheder, der er logget ind med denne Google-konto?`)
      : tx(`Clear all stars, best speed, tricky words and history for ${profile.name}?`,
        `Slet alle stjerner, bedste fart, svære ord og historik for ${profile.name}?`))
      : tx("Are you sure? This can't be undone.", "Er du sikker? Det kan ikke fortrydes.");
    $("#clearYes").textContent = step === 1 ? tx("Yes, clear", "Ja, slet") : tx("Yes, clear everything", "Ja, slet alt");
    $("#clearYes").dataset.step = step;
    $("#clearYes").focus();
  }
  $("#clearBtn").addEventListener("click", () => showClear(1));
  $("#clearNo").addEventListener("click", () => { showClear(0); $("#clearBtn").hidden || $("#clearBtn").focus(); });
  $("#clearYes").addEventListener("click", () => {
    if ($("#clearYes").dataset.step === "1") return showClear(2);
    // Keeps the name, level, mute, key sound and voice; wipes scores, tricky words and the session history.
    // resetAt: a Google user's other devices drop everything from before it too.
    Object.assign(profile, FRESH(), { byLang: {}, resetAt: new Date().toISOString() }); // every language's history
    save();
    showClear(0);
    renderHome();
    if (!$("#welcome").hidden) fillBack(profile); // opened from View stats
    $("#switchUserBtn").focus();
  });
  // ---------- Settings ----------
  // Appearance is Light, Dark or Automatic. THEME (set up in index.html's <head>) saves it to
  // typingZen.theme, apart from the progress in typingZen.v2. Your year is the current user's school
  // year: it sets which three levels are open.
  // Settings also opens from the welcome screen (user's request, 2026-10-29), before anyone is chosen: there
  // the settings that belong to a user (year, key sound, voice, practice order, Switch user, Clear history)
  // are greyed out, and Language only sets the language of the start screens and of new users.
  const sheet = $("#sheet");
  function syncSheet() {
    const none = !chosen;
    sheet.classList.toggle("no-user", none);
    for (const el of sheet.querySelectorAll(".user-only button, .user-only select")) el.disabled = none;
    $("#langNote").hidden = !none;
    $("#langNote").textContent = tx("Sets the language of the start screens and of new users. Choose a user first to change their language.",
      "Vælger sproget på startskærmene og for nye brugere. Vælg først en bruger for at skifte brugerens sprog.");
    fillVoices();
    for (const b of $("#segApp").children) b.setAttribute("aria-checked", String(b.dataset.themeMode === THEME.mode));
    for (const b of $("#segYear").children) b.setAttribute("aria-checked", String(b.dataset.year === profile.year));
    for (const b of $("#segSound").children) b.setAttribute("aria-checked", String(b.dataset.sound === (currentSwitch() || "off")));
    showClear(0);
    showLogout(0);
    showSync();
    showShare();
    for (const b of $("#segLang").children) b.setAttribute("aria-checked", String(b.dataset.lang === wordLang()));
    for (const b of $("#segOrder").children) b.setAttribute("aria-checked", String(b.dataset.order === (profile.practiseOrder === "random" ? "random" : "order")));
    for (const b of $("#segUpd").children) b.setAttribute("aria-checked", String((b.dataset.upd === "on") === autoUpd()));
    // No one chosen: no one's year, sound or order is shown as picked.
    if (none) for (const b of sheet.querySelectorAll("#segYear button, #segSound button, #segOrder button")) b.setAttribute("aria-checked", "false");
  }
  function openSheet() {
    syncSheet();
    $("#verMsg").textContent = tx("Check for updates", "Søg efter opdateringer");
    sheet.hidden = false;
    document.addEventListener("keydown", onSheetKey);
    $("#sheetCard").focus();
  }
  function closeSheet() {
    sheet.hidden = true;
    document.removeEventListener("keydown", onSheetKey);
    $($("#welcome").hidden ? "#settingsBtn" : "#welcomeSettingsBtn").focus();
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
  $("#welcomeSettingsBtn").addEventListener("click", openSheet);
  // "Check for updates" (like Violin Toolkit): compares this page with the site's version.json, never cached.
  // The test build also stamps a build on both, so a new test deploy counts as an update. With the offline copy
  // (sw.js), it fetches the new copy into the device and reloads; without one, it opens the new version with ?v=
  // in the address, so the browser fetches fresh files instead of reusing old ones.
  const CACHE_PREFIX = "typing-zen-test-"; // this site's offline copies (the test build uses typing-zen-test-)
  // Asks for the new sw.js; it saves the new copy and takes over (skipWaiting + claim). Resolves true once it
  // has, false if there was nothing new or it took over 60 s.
  const newCopy = (reg) => new Promise((done) => {
    const sw = navigator.serviceWorker, t = setTimeout(() => done(false), 60000);
    sw.addEventListener("controllerchange", () => { clearTimeout(t); done(true); }, { once: true });
    reg.update().then(() => { if (!reg.installing && !reg.waiting) { clearTimeout(t); done(false); } },
      () => { clearTimeout(t); done(false); });
  });
  // The release on the site when it is newer than this page, else null; throws when the site can't be reached
  // (offline, or the single-file copy). A different build stamp counts as newer (test builds keep the number).
  const verNum = (v) => String(v).split(".").reduce((n, p, i) => n + (+p || 0) / 1000 ** i, 0);
  async function newerVersion() {
    const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const live = await r.json(), mine = $("#appVersion");
    return (mine.dataset.build ? live.build !== mine.dataset.build : verNum(live.version) > verNum(mine.textContent)) ? live : null;
  }
  // With the offline copy (sw.js), fetches the new copy into the device and reloads; without one, opens the new
  // version with ?v= in the address, so the browser fetches fresh files instead of reusing old ones.
  async function updateTo(live) {
    const sw = navigator.serviceWorker, reg = sw && sw.controller && (await sw.getRegistration());
    if (reg && !(await newCopy(reg))) {
      // No new copy came (an old sw.js, say): drop this site's saved copies so the reload fetches everything.
      const mine = new RegExp("^" + CACHE_PREFIX + "[0-9a-f]{10}$");
      await Promise.all((await caches.keys()).filter((k) => mine.test(k)).map((k) => caches.delete(k)));
      await reg.unregister();
    }
    location.replace(location.pathname + "?v=" + encodeURIComponent(live.build || live.version));
  }
  $("#verBtn").addEventListener("click", async () => {
    const msg = $("#verMsg");
    msg.textContent = tx("Checking…", "Søger…");
    try {
      const live = await newerVersion();
      if (!live) { msg.textContent = tx("Up to date", "Du har den nyeste version"); return; }
      msg.textContent = `${tx("Updating to", "Opdaterer til")} ${live.version}…`;
      await updateTo(live);
    } catch {
      msg.textContent = navigator.onLine === false ? tx("Can't check while offline", "Kan ikke søge uden internet") : tx("Can't check here", "Kan ikke søge her");
    }
  });
  // Automatic update check (user's request, 2026-11-03, like Violin Toolkit): when the app opens, and when it
  // comes back after 6 hours away (a Home Screen app is often resumed rather than reopened). It asks first, only
  // on the welcome or home screen with nothing else open (never in a round), and once per release per visit.
  // Offline it stays quiet and tries again on the next return. Settings > Automatic update check turns it off
  // for this device (typingZen.autoUpd = "off", shared by the live and test sites like the appearance).
  // A function declaration, so syncSheet can read it whenever it runs.
  function autoUpd() { try { return localStorage.getItem("typingZen.autoUpd") !== "off"; } catch { return true; } }
  const updSheet = $("#updSheet");
  let updPending = null, updOffered = "", updLast = 0, updOpener = null;
  async function autoCheck() {
    if (!autoUpd() || document.hidden || Date.now() - updLast < 6 * 3600e3) return;
    updLast = Date.now();
    try {
      const live = await newerVersion();
      if (live && (live.build || live.version) !== updOffered) askUpdate(live);
    } catch { updLast = 0; }
  }
  function askUpdate(live) {
    if (!autoUpd()) return;
    // A half-filled first-visit form counts as busy too, focused or not, so the question never takes the caret or
    // Enter from it (Hermes R76.1, R76.3, R76.4); it asks on home once the user has joined.
    const typing = document.activeElement === $("#newName") // Hermes R76.4: the caret in the box, even empty
      || (!$("#welcome").hidden && !$("#intro-new").hidden && !!$("#newName").value.trim());
    const busy = document.hidden || typing || ($("#welcome").hidden && $("#home").hidden) || [...document.querySelectorAll(".sheet")].some((el) => !el.hidden);
    if (busy) { setTimeout(() => askUpdate(live), 5000); return; }
    updPending = live; updOffered = live.build || live.version;
    $("#updMsg").textContent = tx(`Version ${live.version} is ready. Update now?`, `Version ${live.version} er klar. Vil du opdatere nu?`);
    updOpener = document.activeElement;
    updSheet.hidden = false;
    document.addEventListener("keydown", onUpdKey, true);
    $("#updNow").focus();
  }
  function onUpdKey(e) { trapFor(updSheet, closeUpd)(e); }
  function closeUpd() {
    updSheet.hidden = true;
    document.removeEventListener("keydown", onUpdKey, true);
    try { updOpener.focus(); } catch { /* it has gone */ }
  }
  $("#updLater").addEventListener("click", closeUpd);
  updSheet.addEventListener("click", (e) => { if (e.target === updSheet) closeUpd(); });
  $("#updNow").addEventListener("click", () => {
    closeUpd();
    if (updPending) updateTo(updPending).catch(() => location.reload());
  });
  $("#segUpd").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    try { localStorage.setItem("typingZen.autoUpd", b.dataset.upd); } catch { /* storage unavailable */ }
    syncSheet();
  });
  setTimeout(autoCheck, 1500);
  document.addEventListener("visibilitychange", autoCheck);
  $("#sheetDone").addEventListener("click", closeSheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
  // Practice order (user's request, 2026-10-28): the day's words in the order they were missed, or shuffled.
  $("#segOrder").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { profile.practiseOrder = b.dataset.order; stamp("practiseOrder"); save(); syncSheet(); }
  });
  $("#segApp").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) { THEME.set(b.dataset.themeMode); syncSheet(); }
  });
  // Key sound choices are drawn as switches (user's request, 2026-10-27): a side view of the housing with the
  // stem in the switch's colour; a bump for tactile, sound lines for clicky, a line through for Off. The name
  // is the button's label for screen readers and its tooltip.
  const SWITCH_LOOK = [
    ["red", "Linear Red", "Light and smooth, with a soft bottom-out", "Lineær rød", "Let og glat, med en blød bund", "#d43a2f", ""],
    ["black", "Linear Black", "Heavier, with a deeper, fuller bottom-out", "Lineær sort", "Tungere, med en dybere og fyldigere bund", "#202326", ""],
    ["yellow", "Linear Yellow", "Medium weight and smooth, a little brighter", "Lineær gul", "Mellemtung og glat, lidt lysere", "#e6b929", ""],
    ["brown", "Tactile Brown", "A small bump, then a soft thud", "Taktil brun", "Et lille bump, så et blødt dunk", "#7b4b2a", "bump"],
    ["blue", "Clicky Blue", "A sharp click, then the bottom-out", "Klikkende blå", "Et skarpt klik, så bunden", "#2f6bd8", "click"],
    ["off", "Off", "No sound for keys (speech still plays)", "Fra", "Ingen lyd fra tasterne (oplæsning spiller stadig)", "#9aa1a8", "off"],
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
  // Voice: the three entries this device offers, each under its real name. Voices can arrive after the page
  // loads (voiceschanged).
  const sample = () => tx("This is how I will read your words.", "Sådan læser jeg dine ord op.");
  function fillVoices() {
    const cs = voiceChoices();
    const c = chosenVoice(cs);
    if (c && !cs.includes(c) && !cs.some((x) => x.id === c.id || x.voice === c.voice)) cs.push(c); // a saved voice outside the three stays listed
    $("#voiceSel").innerHTML = cs.map((c) => {
      const about = (DA() ? ["dansk", { female: "kvinde", male: "mand" }[c.kind]] : [c.accent, c.kind]).filter(Boolean).join(", ");
      const name = shortName(c.voice);
      return `<option value="${escapeHtml(c.id)}">${escapeHtml(name)} (${escapeHtml(about)})</option>`;
    }).join("");
    if (c) $("#voiceSel").value = c.id;
    // Chrome lists no voices until its first voiceschanged, so the note waits until some voice is listed.
    // Chinese (Hermes R79.1): say which voice is missing, and how to get one.
    $("#voiceNote").textContent = ZH() ? "This device has no Chinese voice. Add a Mandarin voice in your device settings to hear the words."
      : tx("This device has no English voice, so words are read in its own voice.",
      "Denne enhed har ingen dansk stemme, så ordene læses op med enhedens egen stemme.");
    $("#voiceNote").hidden = cs.length > 0 || !("speechSynthesis" in window && speechSynthesis.getVoices().length);
    // iPhone and iPad: before iOS 16.4 the silent switch still mutes the page.
    $("#silentNote").hidden = !IOS;
    $("#silentNote").textContent = tx("No sound? Check that the iPhone or iPad isn't on silent, and turn the volume up.",
      "Ingen lyd? Tjek, at din iPhone eller iPad ikke er på lydløs, og skru op for lyden.");
    $("#voiceRow").hidden = !("speechSynthesis" in window);
  }
  if ("speechSynthesis" in window && speechSynthesis.addEventListener) speechSynthesis.addEventListener("voiceschanged", fillVoices);
  $("#voiceSel").addEventListener("change", (e) => { profile.voice = e.target.value; stamp("voice." + (profile.lang || "en")); save(); fillVoices(); speak(sample()); });
  $("#voiceTry").addEventListener("click", () => speak(sample()));
  // Key sound: choosing one plays a sample of it.
  $("#segSound").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    profile.keySound = b.dataset.sound;
    stamp("keySound");
    save();
    syncSheet();
    // A sample: a letter's press, then its release.
    loadSwitch(currentSwitch()).then(() => { keySound("j"); setTimeout(() => keySound("j", "release"), 110); });
  });
  // View stats: back to the welcome screen's 7 days, with the user still chosen (Hermes R39.2).
  $("#statsBtn").addEventListener("click", () => showWelcome(true));
  $("#segYear").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    profile.year = b.dataset.year;
    stamp("year", "bucket");
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
    profile.mute = !profile.mute; stamp("mute"); save();
    showSoundIcon();
    e.currentTarget.blur();
  });
  $("#card").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !game) return;
    const it = game.items[game.idx];
    if (b.dataset.say === "word") game.mode === "practise" ? sayThenSpell(it.word) : speak(it.word);
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
      const t = days[k] || (days[k] = { words: 0, first: 0, practised: 0 });
      t.first += s.firstTry || 0;
      t.words += (s.firstTry || 0) + (s.struggled || 0);
      // Of those not right first try, the ones practised all 5 times since (light green in the week chart).
      const reps = practisedOn(u, k);
      if (Array.isArray(s.struggledWords)) t.practised += s.struggledWords.filter((w) => reps[w] >= PRACTISE_REPS).length;
    }
    return days;
  }
  // Mastered words (user's request, 2026-11-01). Every Spelling Bee result is in the saved sessions (with the
  // level it was played at), so a word's results in a level are read back from them: synced with Google, and gone
  // with Clear history. A word is mastered in that level when its last 3 spellings there were all right first try;
  // a miss takes it away until it has 3 in a row again.
  const MASTER_RUN = 2; // test build only (live: 3)
  // { word: [right first try?, …] } in one level, oldest first, from the sessions that ended before `until` (ms).
  function resultsIn(u, level, until = Infinity) {
    const out = {};
    const list = (u.sessions || []).filter((s) => s && s.game === "spell" && s.level === level && Date.parse(s.date) < until)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const s of list) {
      // Within a session a word missed and then spelled right again later was missed first.
      for (const w of Array.isArray(s.struggledWords) ? s.struggledWords : []) (out[w] = out[w] || []).push(false);
      for (const w of Array.isArray(s.firstTryWords) ? s.firstTryWords : []) (out[w] = out[w] || []).push(true);
    }
    return out;
  }
  const isMastered = (r) => !!r && r.length >= MASTER_RUN && r.slice(-MASTER_RUN).every(Boolean);
  const masteredOf = (res) => new Set(Object.keys(res).filter((w) => isMastered(res[w])));
  const levelOf = (u) => BUCKETS.find((b) => b.name === u.bucket && unlocked(u.year || "Y1").includes(b.name)) || BUCKETS.find((b) => b.name === u.year) || BUCKETS[0];

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
  // Both lists for the stats (user's request, 2026-11-01): per local day of the last 7 (newest first), the words
  // right first try and the words that need more practice. A word that needed another try that day is only in the
  // second list, even if another session got it right first time.
  function wordsByDay(u) {
    const missed = missedByDay(u), from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 6);
    const days = {};
    for (const s of u.sessions || []) {
      const d = s && s.date ? new Date(s.date) : null;
      if (!d || isNaN(d) || d < from || !Array.isArray(s.firstTryWords)) continue;
      const again = missed[d.toDateString()] || [];
      const list = days[d.toDateString()] || (days[d.toDateString()] = []);
      for (const w of s.firstTryWords) if (typeof w === "string" && !list.includes(w) && !again.includes(w)) list.push(w);
    }
    for (const day of Object.keys(missed)) days[day] = days[day] || [];
    // A day with words tested but no word lists (rounds saved before the lists were kept) still has a section,
    // with its count (user's request, 2026-11-04: the button shows whenever words were tested in the last 7 days).
    const totals = dayTotals(u);
    for (const [day, t] of Object.entries(totals)) if (t.words && new Date(day) >= from) days[day] = days[day] || [];
    return Object.entries(days).filter(([day, l]) => l.length || (missed[day] || []).length || (totals[day] && totals[day].words))
      .sort(([a], [b]) => new Date(b) - new Date(a)).map(([day, first]) => ({ day, first, again: missed[day] || [], tested: (totals[day] || {}).words || 0 }));
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
  // A word's count only goes up: a slip in Practice isn't counted but takes nothing away (R63).
  function savePractice(day, word, reps) {
    const d = practisedOn(profile, day);
    d[word] = Math.max(d[word] || 0, reps);
    if (!d[word]) delete d[word];
    profile.practised[day] = d;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 6);
    for (const k of Object.keys(profile.practised)) if (!(new Date(k) >= from)) delete profile.practised[k];
    save();
  }
  const wordsAndRate = (t) =>
    tx(`<b>${t.words}</b> word${t.words === 1 ? "" : "s"} tested · <b>${Math.round((t.first / t.words) * 100)}%</b> right first try`,
      `<b>${t.words}</b> ord testet · <b>${Math.round((t.first / t.words) * 100)}%</b> rigtigt i første forsøg`);
  const locale = () => tx("en-GB", "da-DK");

  // Welcome back: the last 7 days (today and the 6 before) as a line and a daily bar chart (user's request):
  // each day shows its words tested in Spelling Bee above the bar and its right-first-try rate under the day name.
  function renderWeek(u) {
    const totals = dayTotals(u);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0); // midday, so a daylight-saving change can't skip or repeat a day
      d.setDate(d.getDate() - i);
      days.push({ d, ...(totals[d.toDateString()] || { words: 0, first: 0, practised: 0 }) });
    }
    const week = days.reduce((a, x) => ({ words: a.words + x.words, first: a.first + x.first }), { words: 0, first: 0 });
    $("#weekLine").innerHTML = week.words ? `${tx("Last 7 days", "De sidste 7 dage")}: ${wordsAndRate(week)}` : tx("Last 7 days: no words yet.", "De sidste 7 dage: ingen ord endnu.");
    renderMastery(u, days);
    const chart = $("#weekChart");
    chart.hidden = !week.words;
    $("#weekKey").hidden = !week.words;
    if (!week.words) return;
    const most = Math.max(...days.map((x) => x.words));
    chart.innerHTML = days.map((x, i) => {
      const name = i === 6 ? tx("Today", "I dag") : x.d.toLocaleDateString(locale(), { weekday: "short" });
      const full = x.d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
      const rate = x.words ? Math.round((x.first / x.words) * 100) + "%" : "–";
      const done = Math.min(x.practised, x.words - x.first), again = x.words - x.first - done;
      const said = !x.words ? tx("no words", "ingen ord") : tx(`${x.words} word${x.words === 1 ? "" : "s"}: ${x.first} right first try, ${done} practised, ${again} to practise, ${rate} right first try`,
        `${x.words} ord: ${x.first} rigtigt i første forsøg, ${done} øvet, ${again} skal øves, ${rate} rigtigt i første forsøg`);
      // One bar per day in three colours (user's requests, 2026-10-27 and 2026-11-01): to practise (orange) on top
      // of practised (light green) on top of right first try (dark green). Empty parts are left out, so the top
      // one always gets the rounded corners.
      const h = x.words ? Math.max(6, (x.words / most) * 100) : 0;
      const part = (cls, n) => (n ? `<i class="${cls}" style="height:${(h * n) / x.words}%"></i>` : "");
      return `<li aria-label="${full}: ${said}"><span class="n">${x.words || ""}</span>` +
        `<span class="bar">${part("again", again)}${part("practised", done)}${part("first", x.first)}</span>` +
        `<span class="d">${name}</span><span class="r">${rate}</span></li>`;
    }).join("");
  }

  // Mastered words over the last 7 days, as a line under the bars (user's request, 2026-11-01): each day's point is
  // the share of the level's words mastered by the end of that day. One series, so no legend: the line above names
  // it. The scale's top is a round number just above the highest point, so small gains still show.
  function renderMastery(u, days) {
    const level = levelOf(u), total = level.words.length;
    const ever = Object.keys(resultsIn(u, level.name)).length;
    $("#masterLine").hidden = $("#masterChart").hidden = !ever || !total;
    if (!ever || !total) return;
    const counts = days.map(({ d }) => {
      const end = new Date(d);
      end.setHours(24, 0, 0, 0);
      return masteredOf(resultsIn(u, level.name, end.getTime())).size;
    });
    const pct = (n) => Math.round((n / total) * 100);
    // The week's gain counts from the start of its first day, so a word mastered that day counts (Hermes R55.2).
    const start = new Date(days[0].d);
    start.setHours(0, 0, 0, 0);
    const now = counts[6], gain = now - masteredOf(resultsIn(u, level.name, start.getTime())).size;
    $("#masterLine").innerHTML = tx(`Mastered: <b>${pct(now)}%</b> of ${level.label} words (${now} of ${total})`,
      `Mestret: <b>${pct(now)}%</b> af ordene i ${level.label} (${now} af ${total})`) +
      (gain > 0 ? tx(` · <b>+${gain}</b> this week`, ` · <b>+${gain}</b> denne uge`) : "");
    const top = [5, 10, 20, 25, 50, 100].find((t) => t >= Math.max(...counts.map(pct))) || 100;
    const pts = counts.map((n, i) => [((i + 0.5) / 7) * 100, 100 - ((n / total) * 100 / top) * 100]);
    $("#masterChart").innerHTML =
      `<span class="grid-top">${top}%</span>` +
      `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="0" x2="100" y2="0" class="grid"/><line x1="0" y1="100" x2="100" y2="100" class="base"/>` +
      `<polyline points="${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")}"/></svg>` +
      counts.map((n, i) => {
        const full = days[i].d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
        const said = tx(`${full}: ${pct(n)}% mastered (${n} word${n === 1 ? "" : "s"})`, `${full}: ${pct(n)}% mestret (${n} ord)`);
        return `<span class="pt" style="left:${pts[i][0]}%;top:${pts[i][1]}%" title="${said}" role="img" aria-label="${said}"><i></i>` +
          (i === 6 ? `<b>${pct(n)}%</b>` : "") + `</span>`;
      }).join("");
  }

  // ---------- Who's typing: welcome, new user, switch user ----------
  // First visit: two questions, name and year. Every later visit opens on "Welcome back" with
  // Continue, Switch user and I'm new here (like Violin Toolkit's start overlay).
  const users = () => Object.values(store.users).sort((a, b) => (b.lastUsed || "").localeCompare(a.lastUsed || ""));
  let newYear = null;
  let chosen = false; // someone has been chosen (useProfile), rather than the welcome screen being up

  function showWelcome(keep) {
    const last = store.users[store.current];
    if (!last) return showPanel("new");
    fillBack(last);
    showPanel("back", keep);
  }
  // The text of the "Welcome back" panel and the user list, written again when the start screens' language changes.
  // The stats card shows the history of the language on screen (user's request, 2026-11-04): the user's own, or, when
  // the start screens were switched to another language before choosing anyone, that language's put-away history.
  function inShownLang(u) {
    const L = wordLang();
    if ((u.lang || "en") === L) return u;
    return { ...u, ...FRESH(), ...((u.byLang || {})[L] || {}), lang: L };
  }
  function fillBack(user) {
    const last = inShownLang(user);
    $("#backName").textContent = last.name;
    renderWeek(last);
    $("#continueBtn").textContent = tx(`Continue as ${last.name}`, `Fortsæt som ${last.name}`);
    $("#missedBtn").hidden = !wordsByDay(last).length;
    $("#missedBtn").textContent = tx("See the words", "Se ordene");
    $("#rankBtn").hidden = !(last.google && last.share === true && cloudOn());
  }
  function fillUsers() {
    $("#userList").innerHTML = users().map((u) =>
      `<button type="button" class="user" data-id="${u.id}"><b>${escapeHtml(u.name)}</b><span>${yearLabel(u.year)}${u.google ? " · Google" : ""}</span></button>`).join("");
  }
  // keep: the current user stays chosen (View stats); every other way here leaves no one chosen.
  function showPanel(which, keep) {
    if (!keep) chosen = false;
    show("welcome");
    for (const id of ["new", "back", "switch"]) $("#intro-" + id).hidden = id !== which;
    $("#googleSwitch").hidden = !cloudOn();
    if (which === "new") {
      setGoogle(null);
      $("#googleNewRow").hidden = !cloudOn();
      setError("google", "");
      newYear = null;
      for (const b of $("#newYear").children) b.setAttribute("aria-checked", "false");
      setError("name", "");
      setError("year", "");
      $("#newBack").hidden = !users().length;
      $("#newName").focus();
    } else if (which === "switch") {
      fillUsers();
      $("#userList button")?.focus();
    } else {
      $("#continueBtn").focus();
    }
  }
  function useProfile(id) {
    store.current = id;
    chosen = true;
    profile = store.users[id];
    profile.lastUsed = new Date().toISOString();
    store.lang = profile.lang;
    seenTick = Math.max(0, ...Object.values(profile.seen));
    saveLocal(); // opening a user isn't a change to sync: it would make this device's copy look newest
    shownLang = profile.lang;
    applyLang();
    show("home");
    if (profile.google) syncNow();
  }
  // Shows (or with "" clears) the message under a question, and marks the field for screen readers.
  function setError(field, text) {
    const el = $(`#${field}Err`);
    el.textContent = text;
    el.hidden = !text;
    if (field === "google") return;
    (field === "name" ? $("#newName") : $("#newYear")).setAttribute("aria-invalid", String(!!text));
  }

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
    const name = pendingGoogle ? googleName(pendingGoogle) : tidyName($("#newName").value);
    // A Google name isn't checked: it may match someone who typed theirs, and the list marks which is which.
    const taken = name && !pendingGoogle && users().find((u) => u.name.toLowerCase() === name.toLowerCase());
    setError("name", !name ? tx("Please type your name. It's needed to keep your progress.", "Skriv dit navn. Det skal bruges til at gemme dine fremskridt.")
      : taken ? tx(`${taken.name} already uses Typing Zen here. Go back and choose Switch user.`,
        `${taken.name} bruger allerede Typing Zen her. Gå tilbage, og vælg Skift bruger.`) : "");
    setError("year", newYear ? "" : tx("Please choose your year.", "Vælg din klasse."));
    if (!name || taken) return $("#newName").focus();
    if (!newYear) return $("#newYear button").focus();
    const id = newId();
    // A new user starts in the language on screen (the last user's).
    const lang = wordLang();
    store.users[id] = { ...DEFAULTS(), name, year: newYear, bucket: newYear, lang, voice: DEFAULT_VOICE[lang], id, created: new Date().toISOString() };
    if (pendingGoogle) Object.assign(store.users[id], { google: googleOf(pendingGoogle), updated: new Date().toISOString() });
    useProfile(id);
  });
  $("#newBack").addEventListener("click", () => showWelcome());
  $("#continueBtn").addEventListener("click", () => useProfile(store.current));

  // The words of the last 7 days: an overlay over the stats, one group per day with the words right first try and
  // the words that need more practice (those with their Practise button), in the week chart's two colours.
  const missedSheet = $("#missedSheet");
  function openMissed() {
    const u = inShownLang(store.users[store.current]);
    const today = new Date().toDateString(), yesterday = new Date(Date.now() - 864e5).toDateString();
    const chips = (l) => `<div class="tricky-list">${l}</div>`;
    $("#missedDays").innerHTML = wordsByDay(u).map(({ day, first, again: words, tested }) => {
      const name = day === today ? tx("Today", "I dag") : day === yesterday ? tx("Yesterday", "I går")
        : new Date(day).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
      const reps = practisedOn(u, day);
      const done = words.filter((w) => reps[w] >= PRACTISE_REPS), todo = words.filter((w) => !(reps[w] >= PRACTISE_REPS));
      const group = (cls, label, l, chip) => (l.length ? `<p class="words-label"><i class="${cls}"></i>${label} (${l.length})</p>` + chips(l.map(chip).join("")) : "");
      // The same three groups and colours as the week chart.
      const unlisted = !first.length && !words.length
        ? `<p class="note">${tx(`${tested} word${tested === 1 ? "" : "s"} tested. The words themselves weren't kept for this day.`, `${tested} ord testet. Selve ordene blev ikke gemt for denne dag.`)}</p>` : "";
      return `<section class="missed-day"><h3>${name}</h3>` + unlisted +
        group("first", tx("Right first try", "Rigtigt i første forsøg"), first, (w) => `<span>${escapeHtml(w)}</span>`) +
        group("practised", tx("Practised", "Øvet"), done, (w) => `<span class="done">✓ ${escapeHtml(w)}</span>`) +
        group("again", tx("To practise", "Skal øves"), todo, (w) => reps[w]
          ? `<span title="${tx(`${reps[w]} of ${PRACTISE_REPS} goes done`, `${reps[w]} af ${PRACTISE_REPS} gange klaret`)}">${escapeHtml(w)} <small>${reps[w]}/${PRACTISE_REPS}</small></span>`
          : `<span>${escapeHtml(w)}</span>`) +
        // Only while some word is left to practise (Hermes R51.1): a day with every word practised asks for nothing.
        (todo.length ? `<button type="button" class="primary small" data-day="${escapeHtml(day)}">${day === today ? tx("Practise today's " + (todo.length === 1 ? "word" : "words"), "Øv dagens ord")
            : todo.length === 1 ? tx("Practise this word", "Øv dette ord") : tx("Practise these words", "Øv disse ord")}</button>` : "") +
        `</section>`;
    }).join("") || `<p class="note">${tx("No words from the last 7 days.", "Ingen ord fra de sidste 7 dage.")}</p>`;
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
  // No "I'm new here" on Welcome back (user's request, 2026-11-01): a new user starts from Switch user.
  $("#switchNew").addEventListener("click", () => showPanel("new"));
  $("#switchBack").addEventListener("click", () => showWelcome());
  $("#userList").addEventListener("click", (e) => { const b = e.target.closest(".user"); if (b) useProfile(b.dataset.id); });

  // ---------- Google sign-in and sync ----------
  // Besides a typed name (this device only), a user can sign in with Google (user's request, 2026-10-31): the
  // name comes from the Google account and can't be edited, and the progress is kept in Firebase (Firestore,
  // one document per Google account plus one per Spelling Bee session) so it follows them to every device.
  // FIREBASE is the web app's public config (tools/FIREBASE-SETUP.md); while it is null, or inside another page
  // (the claude.ai copy), Google sign-in isn't offered. The Firebase SDK is loaded only when it's needed.
  const FIREBASE = {
    apiKey: "AIzaSyBe7H-BsJI6eRYJaIdSy-_ZfFYpbYccPNk",
    authDomain: "typing-zen.firebaseapp.com",
    projectId: "typing-zen",
    storageBucket: "typing-zen.firebasestorage.app",
    messagingSenderId: "264177378932",
    appId: "1:264177378932:web:21d84598f0b33b88075321",
  };
  const CLOUD = "typingZen.users-test"; // the Firestore collection; the test build uses its own (deploy_test.py)
  const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/10.12.2/firebase-";
  const cloudOn = () => !!FIREBASE && window.top === window;
  // Each Google user keeps their own sign-in on the device (user's request, 2026-11-01): one Firebase app per
  // user, named after their account, so signing in as someone else never signs them out. Signing in happens on
  // the default app, and the account then moves to its own (keepSignIn). Builds before this kept everyone on the
  // default app; userCloud() moves such a sign-in across the first time it's needed.
  let sdk = null; // Promise of [app, auth, firestore] modules
  const clouds = {}; // app name -> Promise of { auth, db, au, fs }, once that app knows who is signed in
  function cloudFor(name) {
    if (!sdk) {
      sdk = Promise.all(["app", "auth", "firestore"].map((n) => import(`${FIREBASE_SDK}${n}.js`)));
      sdk.catch(() => { sdk = null; }); // offline: try again next time
    }
    if (!clouds[name]) {
      clouds[name] = sdk.then(([app, au, fs]) => {
        const a = name === "[DEFAULT]" ? app.initializeApp(FIREBASE) : app.initializeApp(FIREBASE, name), auth = au.getAuth(a);
        return new Promise((done) => { const off = au.onAuthStateChanged(auth, () => { off(); done({ auth, db: fs.getFirestore(a), au, fs }); }); });
      });
      clouds[name].catch(() => { delete clouds[name]; });
    }
    return clouds[name];
  }
  const loadCloud = () => cloudFor("[DEFAULT]");
  const appOf = (uid) => "u-" + uid;
  // The signed-in account u (on the default app) moves to its own app, and the default app is left signed out.
  async function keepSignIn(u) {
    const [mine, front] = await Promise.all([cloudFor(appOf(u.uid)), loadCloud()]);
    await mine.au.updateCurrentUser(mine.auth, u);
    if (front.auth.currentUser) await front.au.signOut(front.auth);
    return mine;
  }
  // A Google user's own app, with their sign-in moved over from the default app if an older build left it there.
  async function userCloud(uid) {
    const mine = await cloudFor(appOf(uid));
    if (!mine.auth.currentUser) {
      const front = await loadCloud();
      if (front.auth.currentUser && front.auth.currentUser.uid === uid) return keepSignIn(front.auth.currentUser);
    }
    return mine;
  }
  // At most 20 characters, as a typed name (Hermes R46.2): a longer full name becomes the first name.
  const googleName = (u) => {
    const n = tidyName(u.displayName || (u.email || "").split("@")[0]);
    return (n.length > 20 ? n.split(/\s+/)[0] : n).slice(0, 20);
  };
  const googleOf = (u) => ({ uid: u.uid, email: u.email || "" });
  let pendingGoogle = null; // signed in, with no progress saved yet: the new-user form asks only for the year

  // The new-user form for a Google user: the name is Google's and is shown but can't be edited.
  function setGoogle(u) {
    pendingGoogle = u;
    const input = $("#newName");
    input.readOnly = !!u;
    input.classList.toggle("locked", !!u);
    input.value = u ? googleName(u) : "";
    $("#googleAs").hidden = !u;
    $("#googleNewRow").hidden = !!u || !cloudOn();
    if (u) $("#googleAsText").textContent = tx(`Your name comes from your Google account (${u.email}).`, `Dit navn kommer fra din Google-konto (${u.email}).`);
  }
  // From the home screen (iOS), the Google window can't open, so the app goes to Google's sign-in page itself and
  // Google sends it back with an ID token in the address (user's report, 2026-10-31); the browser keeps the window.
  // GOOGLE_CLIENT is the project's OAuth client (public); its Authorized redirect URIs list both sites' addresses.
  const GOOGLE_CLIENT = "264177378932-18e7s9sn645bslvufmr48gkk75c0lib9.apps.googleusercontent.com";
  const GOOGLE_BACK = "typingZen.google-test"; // { state, nonce, why }, while the app is away at Google
  const homeApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const backTo = () => location.origin + location.pathname.replace(/index\.html$/, "");
  function signInByPage(why) {
    const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const go = { state: rnd(), nonce: rnd(), why };
    localStorage.setItem(GOOGLE_BACK, JSON.stringify(go));
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: GOOGLE_CLIENT,
      redirect_uri: backTo(), response_type: "id_token", scope: "openid email profile", prompt: "select_account", state: go.state, nonce: go.nonce }));
    return new Promise(() => {}); // the page is leaving
  }
  // Back from Google: the token (or nothing, if they cancelled) is taken out of the address at once.
  function cameBack() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.has("state")) return null;
    let go = null;
    try { go = JSON.parse(localStorage.getItem(GOOGLE_BACK)); } catch {}
    const ours = !!go && go.state === h.get("state"); // not ours: the token still leaves the address (Hermes R50.1)
    localStorage.removeItem(GOOGLE_BACK);
    history.replaceState(null, "", location.pathname + location.search);
    if (!ours) return null;
    const token = h.get("id_token");
    if (!token) return { why: go.why, user: Promise.reject({ code: "popup-closed-by-user" }) };
    return { why: go.why, user: loadCloud().then((c) => c.au.signInWithCredential(c.auth, c.au.GoogleAuthProvider.credential(token))).then((r) => r.user) };
  }
  async function signInGoogle(why) {
    if (homeApp()) return signInByPage(why);
    const c = await loadCloud();
    const provider = new c.au.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return (await c.au.signInWithPopup(c.auth, provider)).user;
  }
  const signInError = (e) => {
    const code = (e && e.code) || "";
    if (/popup-closed-by-user|cancelled-popup-request/.test(code)) return "";
    if (/popup-blocked/.test(code)) return tx("The Google window was blocked. Allow pop-ups for this site and try again.", "Google-vinduet blev blokeret. Tillad pop op-vinduer for denne side, og prøv igen.");
    return navigator.onLine ? tx("Couldn't sign in with Google. Please try again.", "Kunne ikke logge ind med Google. Prøv igen.")
      : tx("You're offline. Signing in with Google needs the internet.", "Du er offline. Det kræver internet at logge ind med Google.");
  };
  // From the new-user form or Who's typing: a Google account already on this device opens its user; one with
  // progress saved from another device becomes a user here; a new one fills in the form's name.
  async function googleStart(btn, back) {
    setError("google", "");
    btn.disabled = true;
    try {
      const u = await (back || signInGoogle("start"));
      const c = await keepSignIn(u);
      const mine = users().find((x) => x.google && x.google.uid === u.uid);
      if (mine) { mine.name = googleName(u); return useProfile(mine.id); }
      const snap = await c.fs.getDoc(c.fs.doc(c.db, CLOUD, u.uid));
      if (snap.exists()) {
        const r = snap.data(), id = newId();
        store.users[id] = { ...DEFAULTS(), ...pickShared(r.p || {}), name: googleName(u), google: googleOf(u), id,
          created: new Date().toISOString(), updated: r.updated || "", resetAt: r.resetAt || "" };
        return useProfile(id); // the sessions come with the first sync
      }
      if ($("#intro-new").hidden) showPanel("new");
      setGoogle(u);
      $("#newYear button").focus();
    } catch (e) {
      if ($("#intro-new").hidden) showPanel("new");
      setError("google", signInError(e));
    } finally {
      btn.disabled = false;
    }
  }
  $("#googleNew").addEventListener("click", () => googleStart($("#googleNew")));
  $("#googleSwitch").addEventListener("click", () => googleStart($("#googleSwitch")));
  $("#googleUndo").addEventListener("click", () => { setGoogle(null); $("#newName").focus(); });

  // Syncing. Nothing is lost when two devices were used apart: sessions are joined (by when they ended),
  // best speed, stars and rounds keep the higher number, words seen, learned and practised are joined word by
  // word, and the rest (year, level, tricky words, sounds, voice, language) comes from whichever copy was
  // changed last (`updated`). Clear history sets `resetAt`, which wins over anything older on every device.
  // Each language's history is kept apart (byLang): the cloud copy carries the other languages' scores (their
  // sessions are in the sessions collection, tagged with their language). Each language's scores merge only into the
  // same language; a device's language changes only when it was chosen later on another device.
  const SYNC_MAX = ["bestWpm", "stars", "rounds"];
  // From the later copy: settings shared by every language, and this language's own (its voice too). The language
  // itself is per device (user's bug report, 2026-11-04: a Chinese iPhone flipped to English when the same account
  // was used in English elsewhere); `lang` is sent only so that a new device starts in the account's last language.
  const SYNC_SHARED = ["year", "bucket", "mute", "keySound", "practiseOrder", "share", "shareAsk"];
  const SYNC_PER_LANG = ["tricky", "streak", "beeToday", "voice"];
  const SYNC_LATEST = [...SYNC_SHARED, ...SYNC_PER_LANG, "lang", "setAt"]; // what the cloud copy carries
  const SYNC_JOINED = ["seen", "learned", "practised"];
  const pickShared = (p) => ({ ...Object.fromEntries([...SYNC_MAX, ...SYNC_LATEST, ...SYNC_JOINED].filter((k) => k in p).map((k) => [k, p[k]])),
    byLang: Object.fromEntries(Object.entries(p.byLang || {}).map(([L, { sessions, ...rest }]) => [L, rest])) });
  const allSessions = (p) => [...p.sessions, ...Object.values(p.byLang || {}).flatMap((b) => b.sessions || [])];
  function mergeProfile(p, r, sessions) {
    if (r && r.resetAt > (p.resetAt || "")) {
      Object.assign(p, FRESH(), { byLang: {}, resetAt: r.resetAt });
      p.cloud.sentTo = r.resetAt;
    }
    // Cleared here since the cloud copy was saved: nothing in that copy comes back (Hermes R46.4).
    const stale = p.resetAt && (!r || (r.resetAt || "") < p.resetAt);
    const rp = (!stale && r && r.p) || {};
    const newer = !stale && r && (r.updated || "") > (p.updated || "");
    const theirLang = rp.lang || "en";
    p.byLang = p.byLang || {};
    // A setting takes the other copy's value when it was changed there later (user's request, 2026-11-04: every setting
    // follows the cloud when the cloud's is newer); with no times on either side (set before 2026-11-04), the copy
    // changed last wins as before.
    p.setAt = p.setAt || {};
    const theirStamps = rp.setAt || {};
    const later = (k, newer) => (theirStamps[k] || p.setAt[k] ? (theirStamps[k] || "") > (p.setAt[k] || "") : newer);
    // The language too, but only when it was chosen later there (never just because the copy is newer: that flipped a
    // Chinese device to English in 1.18), and not in the middle of a round on this device (it follows after).
    const playing = p === profile && game && !game.over;
    const langWaits = (theirStamps.lang || "") > (p.setAt.lang || "") && theirLang !== (p.lang || "en");
    if (langWaits && !playing) { stashLang(p); restoreLang(p, theirLang); }
    const cur = p.lang || "en";
    // The cloud copy holds its device's language at the top and the others in byLang. Each language's part is merged
    // into the same language here: this device's current one at the top, the others in p.byLang.
    const parts = { ...(rp.byLang || {}) };
    if (Object.keys(rp).length) parts[theirLang] = Object.fromEntries(LANG_KEYS.filter((k) => k !== "sessions" && k in rp).map((k) => [k, rp[k]]));
    for (const [L, b] of Object.entries(parts)) {
      if (!b) continue;
      const mine = L === cur ? p : (p.byLang[L] || (p.byLang[L] = { ...FRESH(), voice: DEFAULT_VOICE[L] }));
      for (const k of SYNC_MAX) mine[k] = Math.max(mine[k] || 0, b[k] || 0);
      if (newer) for (const k of ["tricky", "streak", "beeToday"]) if (k in b) mine[k] = b[k];
      if ("voice" in b && later("voice." + L, newer)) mine.voice = b.voice; // a voice chosen later on another device
      mine.seen = mine.seen || {}; mine.learned = mine.learned || {}; mine.practised = mine.practised || {};
      for (const [k, n] of Object.entries(b.seen || {})) mine.seen[k] = Math.max(mine.seen[k] || 0, n);
      for (const [w, d] of Object.entries(b.learned || {})) if (!(mine.learned[w] >= d)) mine.learned[w] = d;
      for (const day of Object.keys(b.practised || {})) {
        const d = practisedOn(mine, day);
        for (const [w, n] of Object.entries(practisedOn(b, day))) d[w] = Math.max(d[w] || 0, n);
        mine.practised[day] = d;
      }
    }
    for (const k of SYNC_SHARED) if (k in rp && later(k, newer)) p[k] = rp[k];
    // While a round holds the switch, the language's time is not taken here, and syncNow skips the profile write
    // for that sync, so the cloud keeps the other device's choice and the first sync after the round makes it (R84.1).
    for (const [k, t] of Object.entries(theirStamps)) if (t > (p.setAt[k] || "") && !(k === "lang" && langWaits && playing)) p.setAt[k] = t;
    if (newer) p.updated = r.updated;
    const held = langWaits && playing; // the switch waits for this round to end (see syncNow)
    // Sessions go under their own language (one saved before 2026-11-04 has none: English).
    const lists = { [cur]: p.sessions };
    for (const [L, b] of Object.entries(p.byLang)) lists[L] = b.sessions || [];
    const known = new Set(allSessions(p).map((x) => x.date));
    for (const x of sessions) {
      if (!x || !x.date || known.has(x.date)) continue;
      const L = isChinese(x) ? "zh" : x.lang || "en";
      if (!lists[L]) { p.byLang[L] = { ...FRESH(), voice: DEFAULT_VOICE[L] }; lists[L] = p.byLang[L].sessions; }
      lists[L].push(x);
      known.add(x.date);
    }
    const tidy = (l) => l.filter((x) => !p.resetAt || x.date >= p.resetAt).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-500);
    p.sessions = tidy(lists[cur]);
    for (const [L, b] of Object.entries(p.byLang)) b.sessions = tidy(lists[L]);
    return held;
  }
  let syncing = null, syncAgain = false, syncTimer = 0;
  // A change to a Google user: mark it newer and send it a few seconds later (several changes go together).
  onSave = () => {
    if (!chosen || !profile.google) return;
    profile.updated = new Date().toISOString();
    saveLocal();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 4000);
  };
  function syncNow() {
    clearTimeout(syncTimer);
    if (!chosen || !profile.google || !cloudOn()) return Promise.resolve();
    if (syncing) { syncAgain = true; return syncing; }
    const p = profile, cs = p.cloud || (p.cloud = {});
    cs.state = "busy";
    showSync();
    syncing = (async () => {
      const c = await userCloud(p.google.uid), { fs } = c;
      if (!c.auth.currentUser || c.auth.currentUser.uid !== p.google.uid) { cs.state = "out"; return; }
      const ref = fs.doc(c.db, CLOUD, p.google.uid), col = fs.collection(ref, "sessions");
      untagged(p); // tagged before they go up, so every device files them under English
      const sentTo = cs.sentTo || "", mine = allSessions(p).filter((x) => x.date > sentTo); // made here since the last sync, any language
      const r = (await fs.getDoc(ref)).data() || null;
      const got = await fs.getDocs(fs.query(col, fs.where("up", ">", fs.Timestamp.fromMillis(cs.pulled || 0))));
      let pulled = cs.pulled || 0;
      const theirs = got.docs.map((d) => { const x = d.data(); pulled = Math.max(pulled, x.up ? x.up.toMillis() : 0); delete x.up; return x; });
      const lang = p.lang;
      // A language switch held for a round (Hermes R84.1): the profile isn't written this time, or this device's copy
      // would erase the other device's choice from the cloud before the next sync can follow it.
      const held = mergeProfile(p, r, theirs);
      // Up: this device's new sessions, then the profile; a reset made here also clears the older sessions there.
      const writes = mine.filter((x) => !p.resetAt || x.date >= p.resetAt).map((x) => (b) => b.set(fs.doc(col, x.date), { ...x, up: fs.serverTimestamp() }));
      if (p.resetAt && (!r || (r.resetAt || "") < p.resetAt)) {
        for (const d of (await fs.getDocs(fs.query(col, fs.where("date", "<", p.resetAt)))).docs) writes.push((b) => b.delete(d.ref));
      }
      if (!held) writes.push((b) => b.set(ref, { p: pickShared(p), updated: p.updated || "", resetAt: p.resetAt || "" }));
      for (let i = 0; i < writes.length; i += 400) {
        const b = fs.writeBatch(c.db);
        for (const w of writes.slice(i, i + 400)) w(b);
        await b.commit();
      }
      cs.sentTo = allSessions(p).reduce((m, x) => (x.date > m ? x.date : m), sentTo);
      cs.pulled = pulled;
      cs.at = new Date().toISOString();
      cs.state = "ok";
      if (p === profile) refreshAfterSync(lang !== p.lang);
    })().catch(() => { cs.state = navigator.onLine ? "error" : "offline"; }).finally(() => {
      syncing = null;
      saveLocal();
      showSync();
      if (syncAgain) { syncAgain = false; syncNow(); }
    });
    return syncing;
  }
  // What's on screen follows the merged progress (never in the middle of a game).
  function refreshAfterSync(langChanged) {
    seenTick = Math.max(0, ...Object.values(profile.seen));
    if (langChanged) { shownLang = store.lang = profile.lang; applyLang(); }
    if (!$("#home").hidden) renderHome();
    if (!$("#welcome").hidden && !$("#intro-back").hidden) fillBack(profile);
    if (!sheet.hidden) syncSheet();
  }
  // Leaving the page (or the iPad going to sleep) sends a waiting change now; coming back fetches the others'.
  document.addEventListener("visibilitychange", () => syncNow());
  window.addEventListener("online", () => syncNow());

  // Settings for a Google user: how the sync is going, and Log out. A typed-name user gets Remove account in its
  // place (user's request, 2026-11-01).
  function showSync() {
    const g = chosen && profile.google && cloudOn();
    $("#syncRow").hidden = !g;
    $("#logoutBtn").hidden = !chosen;
    $("#logoutBtn").textContent = profile.google ? tx("Log out", "Log ud") : tx("Remove account", "Fjern konto");
    if (!g) return;
    const cs = profile.cloud || {}, email = profile.google.email;
    const at = cs.at ? new Date(cs.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : "";
    $("#syncNote").textContent = {
      busy: tx("Syncing with Google…", "Synkroniserer med Google …"),
      out: tx(`Not syncing: sign in with Google as ${email} again.`, `Synkroniserer ikke: log ind med Google som ${email} igen.`),
      offline: tx("Offline. Progress is kept on this device and syncs when you're back online.", "Offline. Fremskridt gemmes på denne enhed og synkroniseres, når du er online igen."),
      error: tx("Couldn't sync just now. It will try again.", "Kunne ikke synkronisere lige nu. Det prøves igen."),
    }[cs.state] || (at ? tx(`Synced with Google (${email}) at ${at}.`, `Synkroniseret med Google (${email}) kl. ${at}.`)
      : tx(`Signed in with Google (${email}).`, `Logget ind med Google (${email}).`));
    $("#syncSignIn").hidden = cs.state !== "out";
  }
  async function syncSignIn(back) {
    try {
      const u = await (back || signInGoogle("sync"));
      if (u.uid !== profile.google.uid) {
        $("#syncNote").textContent = tx(`That's a different Google account (${u.email}). Sign in as ${profile.google.email}.`,
          `Det er en anden Google-konto (${u.email}). Log ind som ${profile.google.email}.`);
        return;
      }
      await keepSignIn(u);
      await syncNow();
    } catch (e) {
      const m = signInError(e);
      if (m) $("#syncNote").textContent = m;
    }
  }
  $("#syncSignIn").addEventListener("click", () => syncSignIn());
  // ---------- Sharing: words tested this week, among everyone who shares ----------
  // User's requests, 2026-11-03. After a Spelling Bee a Google user who hasn't decided is asked "Would you like to
  // share and view your result?" (Yes / No / Don't remind me again); Settings has a Yes/No toggle; a user who
  // shares gets "See where you rank" on every Spelling Bee result. Only Google users can share (the board needs a
  // signed-in account). The board holds one document per account in BOARD: a masked name (masked on the device, so
  // the full name never leaves it), words tested per day for the last 7 days, and when it was written. Everyone is
  // compared on words tested in the last 7 days, across all years.
  const BOARD = "typingZen.board-test"; // the test build uses its own (deploy_test.py)
  // Others see a name like "Lu*****g": a few first letters and the last one, the rest as stars; short names too.
  const maskName = (name) => {
    const c = [...(name || "").trim()], n = c.length;
    if (n <= 1) return "*";
    if (n === 2) return c[0] + "*";
    if (n <= 4) return c[0] + "*".repeat(n - 2) + c[n - 1];
    const keep = n >= 7 ? 2 : 1;
    return c.slice(0, keep).join("") + "*".repeat(n - keep - 1) + c[n - 1];
  };
  // The last 7 local days as "YYYY-MM-DD", today last.
  const weekKeys = () => Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-") + "|" + d.toDateString();
  });
  const canShare = () => !!(chosen && profile.google && cloudOn());
  // The board counts the words tested in every language together (user's request, 2026-11-04).
  function myWeek(u) {
    const totals = dayTotals({ ...u, sessions: allSessions(u) }), days = {};
    for (const k of weekKeys()) { const [iso, ds] = k.split("|"); if (totals[ds] && totals[ds].words) days[iso] = totals[ds].words; }
    return days;
  }
  // Puts this user's week on the board (or takes it off). Quietly does nothing offline or signed out.
  async function shareWrite(on, u = profile) {
    if (!u.google || !cloudOn()) return false;
    // The entry is this user's words over every device, so it is written only after a sync has brought the other
    // devices' sessions here (user's report, 2026-11-04: 100+ words dropped to 35 after a round on another device).
    // A user not chosen yet (the stats card) isn't synced: the board is read, the entry left as it is.
    if (on) {
      if (u !== profile || !chosen) return false;
      await syncNow();
      if ((u.cloud || {}).state !== "ok") return false;
    }
    try {
      const c = await userCloud(u.google.uid);
      if (!c.auth.currentUser || c.auth.currentUser.uid !== u.google.uid) return false;
      const b = c.fs.writeBatch(c.db), ref = c.fs.doc(c.db, BOARD, u.google.uid);
      if (on) b.set(ref, { name: maskName(u.name), days: myWeek(u), updated: new Date().toISOString() });
      else b.delete(ref);
      await b.commit();
      return true;
    } catch { return false; }
  }
  const shareSheet = $("#shareSheet"), boardSheet = $("#boardSheet");
  // The question waits 0.6 s after the results; leaving the results screen first cancels it (Hermes R73.1), so it
  // can never open over the next round or Home.
  // (var and a function declaration: show() and start() call it, and show() runs before this line at start-up.)
  var askTimer = 0;
  function cancelAsk() { clearTimeout(askTimer); askTimer = 0; }
  // Both sheets are modal to the keyboard, like Settings (Hermes R73.2): Esc closes, Tab stays inside.
  const trapFor = (sheetEl, close) => (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.key !== "Tab") return;
    const items = [...sheetEl.querySelectorAll("button")].filter((b) => !b.hidden && !b.disabled);
    const first = items[0], last = items[items.length - 1];
    if (!sheetEl.contains(document.activeElement)) { e.preventDefault(); return first.focus(); }
    if (e.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const onShareKey = trapFor(shareSheet, () => closeShare()), onBoardKey = trapFor(boardSheet, () => closeBoard());
  function askShare() {
    askTimer = 0;
    if ($("#results").hidden) return;
    shareSheet.hidden = false;
    document.addEventListener("keydown", onShareKey, true);
    $("#shareYes").focus();
  }
  function closeShare() {
    shareSheet.hidden = true;
    document.removeEventListener("keydown", onShareKey, true);
    $("#againBtn").focus();
  }
  $("#shareYes").addEventListener("click", async () => {
    profile.share = true;
    stamp("share");
    save();
    closeShare();
    $("#boardBtn").hidden = false;
    await openBoard();
  });
  $("#shareNo").addEventListener("click", () => closeShare()); // asked again next time
  $("#shareNever").addEventListener("click", () => { profile.shareAsk = false; stamp("shareAsk"); save(); closeShare(); });
  // After a Spelling Bee: share this week's count if the user shares, else ask (unless told not to).
  function afterBee(done) {
    cancelAsk();
    $("#boardBtn").hidden = !(canShare() && profile.share === true);
    if (!canShare()) return;
    if (profile.share === true) shareWrite(true);
    // Asked only after a Bee with words done: a round that tested nothing has no result to share (Hermes note).
    else if (done && profile.share === undefined && profile.shareAsk !== false) askTimer = setTimeout(askShare, 600);
  }
  // The board: the top three on stairs (1 in the middle and highest, 2 on the left, 3 on the right), then a list
  // of 4 and 5, and the users just above and below this one, with "…" for anyone skipped. Others' names are
  // masked; this user's own name is shown.
  // u: the user whose rank it shows (the stats card passes the user it shows, who may not be chosen yet).
  async function openBoard(u = profile) {
    boardOpener = document.activeElement;
    boardSheet.hidden = false;
    document.addEventListener("keydown", onBoardKey, true);
    $("#boardDone").focus();
    const body = $("#boardBody");
    body.innerHTML = `<p class="note">${tx("Loading…", "Henter …")}</p>`;
    await shareWrite(true, u);
    let rows;
    try {
      const c = await userCloud(u.google.uid);
      const snap = await c.fs.getDocs(c.fs.query(c.fs.collection(c.db, BOARD)));
      const keys = weekKeys().map((k) => k.split("|")[0]);
      rows = snap.docs.map((d) => {
        const x = d.data() || {}, id = d.id || (d.ref && d.ref.path || "").split("/").pop();
        return { id, name: String(x.name || "*"), words: keys.reduce((n, k) => n + (Number((x.days || {})[k]) || 0), 0) };
      });
    } catch {
      body.innerHTML = `<p class="note">${navigator.onLine ? tx("Couldn't load the board just now. Please try again.", "Kunne ikke hente tavlen lige nu. Prøv igen.")
        : tx("You're offline. The board needs the internet.", "Du er offline. Tavlen kræver internet.")}</p>`;
      return;
    }
    const me = u.google.uid;
    if (!rows.some((r) => r.id === me)) rows.push({ id: me, name: maskName(u.name), words: Object.values(myWeek(u)).reduce((a, b) => a + b, 0) });
    rows = rows.filter((r) => r.words > 0 || r.id === me).sort((a, b) => b.words - a.words || a.name.localeCompare(b.name));
    const at = rows.findIndex((r) => r.id === me);
    const label = (r) => (r.id === me ? escapeHtml(u.name) : escapeHtml(r.name));
    const wordsOf = (n) => tx(`${n} word${n === 1 ? "" : "s"}`, `${n} ord`);
    const spot = (i, cls, medal) => (rows[i] ? `<div class="spot ${cls}${rows[i].id === me ? " me" : ""}"><span class="medal">${medal}</span>` +
      `<span class="who">${label(rows[i])}</span><span class="n">${wordsOf(rows[i].words)}</span><div class="stair">${i + 1}</div></div>` : `<div class="spot ${cls}"></div>`);
    const shown = [...new Set([3, 4, at - 1, at, at + 1])].filter((i) => i >= 3 && i < rows.length).sort((a, b) => a - b);
    let list = "", last = 2;
    for (const i of shown) {
      if (i > last + 1) list += `<li class="gap" aria-hidden="true">…</li>`;
      list += `<li class="${rows[i].id === me ? "me" : ""}"><span class="r">#${i + 1}</span><span>${label(rows[i])}${rows[i].id === me ? ` (${tx("you", "dig")})` : ""}</span><span class="w">${wordsOf(rows[i].words)}</span></li>`;
      last = i;
    }
    if (rows.length - 1 > last) list += `<li class="gap" aria-hidden="true">…</li>`;
    body.innerHTML = `<p class="note">${tx(`You're #${at + 1} of ${rows.length}.`, `Du er nr. ${at + 1} af ${rows.length}.`)}</p>` +
      `<div class="podium">${spot(1, "p2", "🥈")}${spot(0, "p1", "🥇")}${spot(2, "p3", "🥉")}</div>` + (list ? `<ol class="board-list">${list}</ol>` : "");
  }
  function closeBoard() {
    boardSheet.hidden = true;
    document.removeEventListener("keydown", onBoardKey, true);
    const back = boardOpener && !boardOpener.hidden && boardOpener.isConnected ? boardOpener : ($("#boardBtn").hidden ? $("#againBtn") : $("#boardBtn"));
    back.focus();
  }
  let boardOpener = null;
  $("#boardBtn").addEventListener("click", () => openBoard());
  // The stats card (Welcome back, View stats) has the same button for a user who shares (user's request, 2026-11-04).
  $("#rankBtn").addEventListener("click", () => { const u = store.users[store.current]; if (u) openBoard(u); });
  $("#boardDone").addEventListener("click", closeBoard);
  boardSheet.addEventListener("click", (e) => { if (e.target === boardSheet) closeBoard(); });
  // Settings: Share my results, Yes or No. Only a Google user can share; No takes this user off the board.
  function showShare() {
    const g = chosen && profile.google && cloudOn();
    for (const b of $("#segShare").children) {
      b.disabled = !g;
      b.setAttribute("aria-checked", String(!!g && (b.dataset.share === "yes") === (profile.share === true)));
    }
    $("#shareNote").textContent = !chosen ? "" : !g ? tx("Sharing needs a Google account.", "Deling kræver en Google-konto.")
      : profile.share === true ? tx("Your words tested this week are on the board, with your name masked.", "Dine testede ord denne uge er på tavlen, med dit navn skjult.") : "";
  }
  $("#segShare").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const on = b.dataset.share === "yes";
    profile.share = on;
    stamp("share", "shareAsk");
    if (!on) profile.shareAsk = false; // a clear No in Settings: don't ask after each Bee either
    save();
    showShare();
    await shareWrite(on);
  });

  // Log out warns first: this user and their history leave this device (they stay with the Google account and
  // come back on signing in again). Anything not yet synced is sent first; if that fails, it says it will be lost.
  const unsynced = () => { const cs = profile.cloud || {}; return (profile.updated || "") > (cs.at || "") || profile.sessions.some((x) => x.date > (cs.sentTo || "")); };
  // Log out (a Google user) only asks to be sure: the progress stays with the Google account (user's request,
  // 2026-11-01). Remove account (a typed name) warns: its progress lives only on this device and goes with it, so
  // it asks twice, as Clear history does (Hermes R61.2, user's "Yes", 2026-11-01). step: 0 closed, 1, 2.
  function showLogout(step) {
    $("#logoutConfirm").hidden = !step;
    $("#logoutYes").dataset.step = step || 0;
    if (!step) return;
    const n = profile.name;
    if (profile.google) {
      $("#logoutAsk").textContent = tx(
        `Are you sure you want to log out? ${n}'s progress is still saved, and carries on from whichever device ${n} signs in on next.`,
        `Er du sikker på, at du vil logge ud? ${owner(n)} fremskridt er stadig gemt og fortsætter på den enhed, ${n} logger ind på næste gang.`) +
        (unsynced() ? " " + tx("Some progress from this device isn't saved to Google yet; it will be sent first, but if this device is offline it will be lost.",
          "Nogle fremskridt fra denne enhed er ikke gemt på Google endnu; de sendes først, men hvis enheden er offline, går de tabt.") : "");
      $("#logoutYes").textContent = tx("Log out", "Log ud");
    } else if (step === 2) {
      $("#logoutAsk").textContent = tx("Are you sure? This can't be undone.", "Er du sikker? Det kan ikke fortrydes.");
      $("#logoutYes").textContent = tx(`Yes, remove ${n}`, `Ja, fjern ${n}`);
    } else {
      $("#logoutAsk").textContent = tx(
        `Remove ${n}? ${n} and all of ${n}'s progress (stars, best speed, tricky words, words to practise, mastered words and the history) will be deleted from this device. This can't be undone.`,
        `Fjern ${n}? ${n} og alle ${owner(n)} fremskridt (stjerner, bedste fart, svære ord, ord at øve, mestrede ord og historikken) slettes fra denne enhed. Det kan ikke fortrydes.`);
      $("#logoutYes").textContent = tx("Yes, remove", "Ja, fjern");
    }
    $("#logoutYes").focus();
  }
  $("#logoutBtn").addEventListener("click", () => { showClear(0); showLogout(1); });
  $("#logoutNo").addEventListener("click", () => { showLogout(0); $("#logoutBtn").focus(); });
  $("#logoutYes").addEventListener("click", async () => {
    const p = profile;
    if (!p.google && $("#logoutYes").dataset.step === "1") return showLogout(2); // a typed name is asked twice
    $("#logoutYes").disabled = true;
    if (p.google && cloudOn()) {
      await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 8000))]);
      try {
        const c = await Promise.race([userCloud(p.google.uid), new Promise((r) => setTimeout(r, 3000))]);
        if (c && c.auth.currentUser && c.auth.currentUser.uid === p.google.uid) await c.au.signOut(c.auth); // only this user
      } catch { /* offline: the account is forgotten here anyway */ }
    }
    $("#logoutYes").disabled = false;
    delete store.users[p.id];
    chosen = false;
    store.current = users()[0] ? users()[0].id : null;
    profile = store.users[store.current] || DEFAULTS();
    saveLocal();
    sheet.hidden = true;
    document.removeEventListener("keydown", onSheetKey);
    showWelcome();
  });

  // ---------- Language setting ----------
  // Settings > Language: a user's language switches at once and keeps each language's history apart (user's request,
  // 2026-11-04; until then switching cleared it after a warning). With no one chosen, only the start screens change.
  // Danish possessive: "Lukes", but "Klaus'".
  const owner = (n) => (/[sxz]$/i.test(n) ? n + "'" : n + "s");
  // A user's language: this one's history is put away and the other's brought back (or started), nothing is
  // cleared (user's request, 2026-11-04; it used to clear the history after a warning). The year and level stay.
  function switchLang(lang) {
    stashLang(profile);
    restoreLang(profile, lang);
    stamp("lang"); // so the user's other devices follow this choice
    shownLang = store.lang = lang;
    seenTick = Math.max(0, ...Object.values(profile.seen));
    // A sharer's board entry follows: it counts the words of the language now in use.
    if (canShare() && profile.share === true) shareWrite(true);
    save();
    applyLang();
    syncSheet();
    renderHome();
    if (!$("#welcome").hidden) fillBack(profile); // opened from View stats
    $(`#segLang [data-lang="${lang}"]`).focus();
  }
  // From the welcome screen, with no one chosen: only the start screens change, and no history is touched.
  function setScreenLang(lang) {
    shownLang = store.lang = lang;
    save();
    applyLang();
    syncSheet();
    const last = store.users[store.current];
    if (last) fillBack(last);
    fillUsers();
    for (const b of $("#newYear").children) b.setAttribute("aria-checked", String(b.dataset.year === newYear));
    setError("name", "");
    setError("year", "");
    $(`#segLang [data-lang="${lang}"]`).focus();
  }
  $("#segLang").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.lang === wordLang()) return;
    if (!chosen) return setScreenLang(b.dataset.lang);
    switchLang(b.dataset.lang);
  });

  // index.html's own text, kept in English as it was at load, each piece swapped for its Danish in DA_TEXT
  // (data.js). Text the code writes later is left alone: it comes from tx().
  const PAGE_TEXT = [];
  (() => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) if (n.nodeValue.trim()) PAGE_TEXT.push([n, null, n.nodeValue]);
    for (const a of ["aria-label", "title", "placeholder", "alt"])
      for (const el of document.querySelectorAll(`[${a}]`)) PAGE_TEXT.push([el, a, el.getAttribute(a)]);
  })();
  function translatePage() {
    for (const [node, attr, en] of PAGE_TEXT) {
      const core = en.trim(), da = DA() && DA_TEXT[core];
      const text = da ? en.replace(core, da) : en;
      if (attr) node.setAttribute(attr, text);
      else node.nodeValue = text;
    }
  }
  // Everything that follows the user's language: run at start and whenever the user or language changes.
  function applyLang() {
    document.documentElement.lang = tx("en-GB", "da"); // Chinese words carry lang="zh-CN" themselves
    translatePage();
    setLayout();
    buildKeyboard();
    refreshKeyboard();
    setBuckets();
    renderChoices();
    showSoundIcon();
    kbdLabel();
  }

  applyLang();
  showWelcome();
  const back = cloudOn() && cameBack();
  if (back && back.why === "sync") syncSignIn(back.user);
  else if (back) googleStart(users().length ? $("#googleSwitch") : $("#googleNew"), back.user);
})();
