/* Typing Zen service worker, written by tools/make_sw.py: do not edit by hand.
   It keeps an offline copy of every file the app uses. VERSION changes whenever any of them does. */
const VERSION = "typing-zen-test-5013698343";
/* Only this site's caches: the live and test sites share trix69.github.io, so never touch the other's. */
const MINE = (k) => /^typing\-zen\-test\-[0-9a-f]{10}$/.test(k);
const FILES = [
  "./",
  "index.html",
  "style.css?v=dc5d8c301c",
  "words.js?v=dc5d8c301c",
  "words-da.js?v=dc5d8c301c",
  "data.js?v=dc5d8c301c",
  "app.js?v=dc5d8c301c",
  "manifest.webmanifest",
  "fonts/atkinson-hyperlegible-latin-400-normal.woff2",
  "fonts/atkinson-hyperlegible-latin-700-normal.woff2",
  "fonts/dm-mono-latin-400-normal.woff2",
  "fonts/dm-mono-latin-500-normal.woff2",
  "fonts/dm-sans-latin-wght-normal.woff2",
  "fonts/outfit-latin-wght-normal.woff2",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512-maskable.png",
  "icons/icon-512.png",
  "sounds/black/press/BACKSPACE.mp3",
  "sounds/black/press/ENTER.mp3",
  "sounds/black/press/GENERIC_R0.mp3",
  "sounds/black/press/GENERIC_R1.mp3",
  "sounds/black/press/GENERIC_R2.mp3",
  "sounds/black/press/GENERIC_R3.mp3",
  "sounds/black/press/GENERIC_R4.mp3",
  "sounds/black/press/SPACE.mp3",
  "sounds/black/release/BACKSPACE.mp3",
  "sounds/black/release/ENTER.mp3",
  "sounds/black/release/GENERIC.mp3",
  "sounds/black/release/SPACE.mp3",
  "sounds/blue/press/GENERIC_R0.mp3",
  "sounds/blue/press/GENERIC_R1.mp3",
  "sounds/blue/press/GENERIC_R2.mp3",
  "sounds/blue/press/GENERIC_R3.mp3",
  "sounds/blue/press/GENERIC_R4.mp3",
  "sounds/blue/release/GENERIC.mp3",
  "sounds/brown/press/BACKSPACE.mp3",
  "sounds/brown/press/ENTER.mp3",
  "sounds/brown/press/GENERIC_R0.mp3",
  "sounds/brown/press/GENERIC_R1.mp3",
  "sounds/brown/press/GENERIC_R2.mp3",
  "sounds/brown/press/GENERIC_R3.mp3",
  "sounds/brown/press/GENERIC_R4.mp3",
  "sounds/brown/press/SPACE.mp3",
  "sounds/brown/release/BACKSPACE.mp3",
  "sounds/brown/release/ENTER.mp3",
  "sounds/brown/release/GENERIC.mp3",
  "sounds/brown/release/SPACE.mp3",
  "sounds/red/press/BACKSPACE.mp3",
  "sounds/red/press/ENTER.mp3",
  "sounds/red/press/GENERIC_R0.mp3",
  "sounds/red/press/GENERIC_R1.mp3",
  "sounds/red/press/GENERIC_R2.mp3",
  "sounds/red/press/GENERIC_R3.mp3",
  "sounds/red/press/GENERIC_R4.mp3",
  "sounds/red/press/SPACE.mp3",
  "sounds/red/release/BACKSPACE.mp3",
  "sounds/red/release/ENTER.mp3",
  "sounds/red/release/GENERIC.mp3",
  "sounds/red/release/SPACE.mp3",
  "sounds/yellow/press/BACKSPACE.mp3",
  "sounds/yellow/press/ENTER.mp3",
  "sounds/yellow/press/GENERIC_R0.mp3",
  "sounds/yellow/press/GENERIC_R1.mp3",
  "sounds/yellow/press/GENERIC_R2.mp3",
  "sounds/yellow/press/GENERIC_R3.mp3",
  "sounds/yellow/press/GENERIC_R4.mp3",
  "sounds/yellow/press/SPACE.mp3",
  "sounds/yellow/release/BACKSPACE.mp3",
  "sounds/yellow/release/ENTER.mp3",
  "sounds/yellow/release/GENERIC.mp3",
  "sounds/yellow/release/SPACE.mp3"
];
self.addEventListener("install", (e) => {
  /* Everything at once, so a half-saved copy is never used; the old copy stays until this one is complete. */
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION && MINE(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.cache === "no-store") return; /* Settings > Check for updates asks the network */
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    /* Pages open from the saved copy (any ?v= in the address is ignored); files come from it too. */
    const hit = req.mode === "navigate" ? (await c.match("index.html")) : await c.match(req);
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      return req.mode === "navigate"
        ? new Response("Typing Zen isn't saved on this device yet. Open it once with the internet on.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
        : Response.error();
    }
  })());
});
